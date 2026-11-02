using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

internal static class Launcher
{
    private static string root;
    private static TcpListener listener;
    private static DateTime lastPing = DateTime.MinValue;
    private static int idleSeconds = 180;

    private static string ContentType(string path)
    {
        switch (Path.GetExtension(path).ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".js":
            case ".mjs": return "text/javascript; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".txt": return "text/plain; charset=utf-8";
            default: return "application/octet-stream";
        }
    }

    private static uint Hash(string value)
    {
        uint hash = 2166136261;
        foreach (char c in value) { hash ^= c; hash = hash * 16777619; }
        return hash;
    }

    private static void Extract()
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        string manifest;
        using (Stream stream = assembly.GetManifestResourceStream("LBM.manifest"))
        using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
            manifest = reader.ReadToEnd();

        root = Path.Combine(Path.GetTempPath(), "LBM-learning-3d-" + Hash(manifest).ToString("x8"));
        string marker = Path.Combine(root, "index.html");
        if (!File.Exists(marker))
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
            Directory.CreateDirectory(root);
            foreach (string rawLine in manifest.Split('\n'))
            {
                string line = rawLine.Trim();
                if (line.Length == 0) continue;
                string[] parts = line.Split('|');
                string id = parts[0];
                string relative = parts[1].Replace('/', Path.DirectorySeparatorChar);
                string destination = Path.Combine(root, relative);
                string directory = Path.GetDirectoryName(destination);
                if (!String.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                using (Stream source = assembly.GetManifestResourceStream("LBM." + id))
                using (FileStream target = File.Create(destination))
                    source.CopyTo(target);
            }
        }
    }

    private static void WriteResponse(NetworkStream stream, int status, string contentType, byte[] body, bool gzip)
    {
        string statusText = status == 200 ? "OK" : status == 204 ? "No Content" : status == 404 ? "Not Found" : "Method Not Allowed";
        StringBuilder headers = new StringBuilder();
        headers.Append("HTTP/1.1 ").Append(status).Append(' ').Append(statusText).Append("\r\n");
        headers.Append("Content-Type: ").Append(contentType).Append("\r\n");
        headers.Append("Content-Length: ").Append(body.Length).Append("\r\n");
        headers.Append("Connection: close\r\n");
        if (gzip)
        {
            headers.Append("Content-Encoding: gzip\r\n");
            headers.Append("Vary: Accept-Encoding\r\n");
            headers.Append("Cache-Control: public, max-age=31536000, immutable\r\n");
        }
        headers.Append("\r\n");
        byte[] prefix = Encoding.ASCII.GetBytes(headers.ToString());
        stream.Write(prefix, 0, prefix.Length);
        stream.Write(body, 0, body.Length);
    }

    private static void Serve(TcpClient client)
    {
        using (client)
        using (NetworkStream stream = client.GetStream())
        using (StreamReader reader = new StreamReader(stream, Encoding.ASCII, false, 4096, true))
        {
            try
            {
                string requestLine = reader.ReadLine();
                if (String.IsNullOrEmpty(requestLine)) return;
                string[] parts = requestLine.Split(' ');
                if (parts.Length < 2 || parts[0] != "GET")
                {
                    WriteResponse(stream, 405, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Method Not Allowed"), false);
                    return;
                }
                if (parts[1].Split('?')[0] == "/__lbm_ping")
                {
                    lastPing = DateTime.UtcNow;
                    WriteResponse(stream, 204, "text/plain", new byte[0], false);
                    return;
                }
                string relative = Uri.UnescapeDataString(parts[1].Split('?')[0].TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
                if (relative.Length == 0) relative = "index.html";
                string candidate = Path.GetFullPath(Path.Combine(root, relative));
                string prefix = root.EndsWith(Path.DirectorySeparatorChar.ToString()) ? root : root + Path.DirectorySeparatorChar;
                if (!candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(candidate))
                {
                    WriteResponse(stream, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"), false);
                    return;
                }
                WriteResponse(stream, 200, ContentType(candidate), File.ReadAllBytes(candidate), candidate.EndsWith(".gz", StringComparison.OrdinalIgnoreCase));
            }
            catch
            {
                try { WriteResponse(stream, 500, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Server error"), false); }
                catch { }
            }
        }
    }

    private static string FindEdge()
    {
        string[] candidates =
        {
            Environment.GetEnvironmentVariable("ProgramFiles(x86)") + "\\Microsoft\\Edge\\Application\\msedge.exe",
            Environment.GetEnvironmentVariable("ProgramFiles") + "\\Microsoft\\Edge\\Application\\msedge.exe",
        };
        foreach (string candidate in candidates)
            if (!String.IsNullOrEmpty(candidate) && File.Exists(candidate)) return candidate;
        return null;
    }

    // Opens a chromeless app window so the demo looks like a standalone page.
    private static Process OpenWindow(string url)
    {
        string edge = FindEdge();
        if (edge != null)
        {
            try
            {
                string profile = Path.Combine(Path.GetTempPath(), "LBM-learning-3d-window");
                ProcessStartInfo info = new ProcessStartInfo(edge,
                    "--app=" + url + " --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check --window-size=1440,1000");
                info.UseShellExecute = false;
                return Process.Start(info);
            }
            catch { }
        }
        try { return Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true }); }
        catch { return null; }
    }

    private static void Main(string[] args)
    {
        bool openWindow = true;
        int port = 0;
        foreach (string arg in args)
        {
            if (arg == "--no-browser") openWindow = false;
            else if (arg.StartsWith("--port=")) port = Int32.Parse(arg.Substring(7));
            else if (arg.StartsWith("--idle=")) idleSeconds = Int32.Parse(arg.Substring(7));
        }

        bool created;
        using (Mutex single = new Mutex(true, "LBM-learning-3d-demo", out created))
        {
            if (!created) return;
            Extract();
            listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start();
            int actual = ((IPEndPoint)listener.LocalEndpoint).Port;
            string url = "http://127.0.0.1:" + actual + "/";

            Task.Run(() =>
            {
                while (true)
                {
                    TcpClient client;
                    try { client = listener.AcceptTcpClient(); }
                    catch { return; }
                    Task.Run(() => Serve(client));
                }
            });

            // The page sends a heartbeat; stop the hidden server once the
            // viewer has been closed long enough for the heartbeats to lapse.
            Task.Run(() =>
            {
                while (true)
                {
                    Thread.Sleep(5000);
                    DateTime last = lastPing;
                    if (last != DateTime.MinValue && (DateTime.UtcNow - last).TotalSeconds > idleSeconds) Environment.Exit(0);
                }
            });

            if (openWindow) OpenWindow(url);
            Thread.Sleep(Timeout.Infinite);
        }
    }
}
