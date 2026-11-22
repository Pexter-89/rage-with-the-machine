// Serves app/ at http://localhost:8080 (or PORT) for local runs: `npm run serve`. No build step.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'app');
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(root, path.endsWith('/') ? path + 'index.html' : path));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let body = await readFile(file);
    // index.html is page content only (claude.ai adds the skeleton at publish); add one here too.
    if (extname(file) === '.html' && !/^\s*<!doctype/i.test(body.toString())) {
      body = Buffer.from(
        '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
          '<style>body{margin:0}</style></head><body>' + body + '</body></html>',
      );
    }
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Serving app/ at http://localhost:${port}/`));
