// Stub webhook destination for E2E: fails every first attempt with 503, accepts retries.
import { createServer } from 'node:http';

const port = Number(process.env.STUB_PORT ?? 4110);
const received = [];

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200).end('ok');
    return;
  }
  if (req.method === 'GET' && req.url === '/received') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(received));
    return;
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const attempt = Number(req.headers['x-hookline-attempt'] ?? 0);
    received.push({
      method: req.method,
      attempt,
      deliveryId: req.headers['x-hookline-delivery-id'],
      body: Buffer.concat(chunks).toString('utf8'),
    });
    if (attempt === 1) {
      res.writeHead(503, { 'content-type': 'text/plain' }).end('stub: temporarily unavailable');
    } else {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('stub: ok');
    }
  });
}).listen(port, '127.0.0.1', () => console.log(`stub destination on ${port}`));
