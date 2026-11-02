import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 8770);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.bin': 'application/octet-stream',
  '.gz': 'application/octet-stream',
};

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    const candidate = resolve(join(root, pathname === '/' ? 'index.html' : pathname.slice(1)));
    const rel = relative(root, candidate);
    if (rel.startsWith('..') || rel.includes(`..${'\\'}`) || rel.includes(`..${'/'}`)) {
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }
    const body = await readFile(candidate);
    const extension = extname(candidate).toLowerCase();
    const headers = { 'Content-Type': mime[extension] ?? 'application/octet-stream' };
    if (extension === '.gz') {
      headers['Content-Type'] = 'application/octet-stream';
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
      headers['Cache-Control'] = 'public, max-age=31536000, immutable';
    }
    response.writeHead(200, headers);
    response.end(body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`lbm3d-cl static server: http://127.0.0.1:${port}/`);
});
