import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm' };
createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) throw new Error('method');
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'web/index.html' : pathname.slice(1);
    if (!relative.startsWith('web/') && !relative.startsWith('node_modules/pdfjs-dist/')) throw new Error('path');
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep)) throw new Error('path');
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173/'));
