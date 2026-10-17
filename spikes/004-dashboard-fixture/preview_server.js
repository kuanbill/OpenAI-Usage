const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = 8767;
const PAGE = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  if (req.headers.host !== `${HOST}:${PORT}`) {
    res.writeHead(403, { 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (req.method !== 'GET' || (req.url !== '/' && req.url !== '/index.html')) {
    res.writeHead(404, { 'Cache-Control': 'no-store' });
    return res.end();
  }
  try {
    const body = fs.readFileSync(PAGE);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    });
    res.end(body);
  } catch {
    res.writeHead(500, { 'Cache-Control': 'no-store' });
    res.end('Fixture page unavailable');
  }
});

server.listen(PORT, HOST, () => console.log(`Offline Codex dashboard fixture at http://${HOST}:${PORT}`));
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
