import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDistribution } from './lib/export.js';
import { buildDistributionV2 } from './lib/export-v2.js';
import { buildDistributionV3 } from './lib/export-v3.js';

const root = dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm' };
export function createAppServer() { const server=createServer(async (req, res) => {
  try {
    const host=`127.0.0.1:${server.address().port}`,origin=`http://${host}`;
    if (req.headers.host !== host) throw new Error('host');
    if (req.method === 'POST' && req.url === '/api/export') {
      if(req.headers.origin!==origin || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new Error('origin');
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>20*1024*1024)throw new Error('too large');chunks.push(chunk);}
      try{const {project,options}=JSON.parse(Buffer.concat(chunks).toString('utf8'));const groups=(project.selectionGroups||[]).some(group=>group.term===options.term&&group.classId===options.classId),timed=(project.weekSeries||[]).some(group=>group.term===options.term&&group.classId===options.classId)||project.lessons.some(cell=>cell.term===options.term&&cell.classId===options.classId&&cell.entries.some(entry=>entry.weekStart||entry.weekEnd||entry.weekSourceNotation));const weeks=(project.weekCalendar||[]).filter(day=>day.scope===options.scope).map(day=>({...day,week:Number(day.week)}));const data=groups?await buildDistributionV3(project,options,weeks):timed?await buildDistributionV2(project,options,weeks):await buildDistribution(project,options);res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({data}));}
      catch(error){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:error.message}));}
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) throw new Error('method');
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = pathname === '/' ? 'web/index.html' : pathname.slice(1);
    if (!relative.startsWith('web/') && !relative.startsWith('node_modules/pdfjs-dist/')) throw new Error('path');
    const path = resolve(root, relative);
    const allowed = resolve(root, relative.startsWith('web/') ? 'web' : 'node_modules/pdfjs-dist');
    if (!path.startsWith(allowed + sep)) throw new Error('path');
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}); return server; }
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))createAppServer().listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173/'));
