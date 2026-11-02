using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

internal static class Launcher
{
    private static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    private static TcpListener listener;

    private static readonly string[] IndexFiles = { "index.html" };

    private static string ContentType(string path)
    {
        string ext = Path.GetExtension(path).ToLowerInvariant();
        switch (ext)
        {
            case ".html": return "text/html; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".js":
            case ".mjs": return "text/javascript; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".gz": return "application/octet-stream";
            case ".bin": return "application/octet-stream";
            default: return "application/octet-stream";
        }
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

                string rawPath = parts[1].Split('?')[0];
                string relative = Uri.UnescapeDataString(rawPath.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
                if (String.IsNullOrEmpty(relative)) relative = "index.html";
                string candidate = Path.GetFullPath(Path.Combine(Root, relative));
                string rootPrefix = Root.EndsWith(Path.DirectorySeparatorChar.ToString()) ? Root : Root + Path.DirectorySeparatorChar;
                if (!candidate.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(candidate))
                {
                    WriteResponse(stream, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Not found"), false);
                    return;
                }

                byte[] body = File.ReadAllBytes(candidate);
                bool gzip = candidate.EndsWith(".gz", StringComparison.OrdinalIgnoreCase);
                WriteResponse(stream, 200, ContentType(candidate), body, gzip);
            }
            catch
            {
                try { WriteResponse(stream, 500, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("Server error"), false); }
                catch { }
            }
        }
    }

    private static void WriteResponse(NetworkStream stream, int status, string contentType, byte[] body, bool gzip)
    {
        string statusText = status == 200 ? "OK" : status == 404 ? "Not Found" : "Method Not Allowed";
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

    private static void Main()
    {
        listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        string url = "http://127.0.0.1:" + port + "/";
        Console.WriteLine("LBM learning demo: " + url);
        Console.WriteLine("关闭此窗口即可停止本地服务器。");
        try
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
        catch (Exception error)
        {
            Console.WriteLine("无法自动打开浏览器：" + error.Message);
        }
        while (true)
        {
            TcpClient client = listener.AcceptTcpClient();
            Task.Run(() => Serve(client));
        }
    }
}
