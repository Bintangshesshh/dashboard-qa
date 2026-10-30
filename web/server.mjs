import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { fileURLToPath } from 'node:url';
import next from 'next';

const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? '127.0.0.1';
const backend = new URL(process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:3001');
if (!['http:', 'https:'].includes(backend.protocol)) throw new Error('API_INTERNAL_URL must use HTTP(S)');
const request = backend.protocol === 'https:' ? httpsRequest : httpRequest;
const app = next({ dev, dir: fileURLToPath(new URL('.', import.meta.url)), hostname, port });
await app.prepare();
const handle = app.getRequestHandler();
const upgrade = app.getUpgradeHandler();
const upstream = req => {
  const proxy = request({ hostname: backend.hostname, port: backend.port || (backend.protocol === 'https:' ? 443 : 80), method: req.method, path: req.url, headers: { ...req.headers } });
  proxy.setTimeout(30_000, () => proxy.destroy(new Error('Backend timeout')));
  return proxy;
};
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (!['/api', '/artifacts'].some(prefix => path === prefix || path.startsWith(prefix + '/'))) return handle(req, res);
  const proxy = upstream(req);
  proxy.on('response', response => {
    res.writeHead(response.statusCode, response.headers);
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  proxy.on('error', () => {
    if (res.headersSent) return res.destroy();
    res.writeHead(502).end('Backend unavailable');
  });
  req.on('aborted', () => proxy.destroy());
  res.on('close', () => proxy.destroy());
  req.pipe(proxy);
});
server.on('upgrade', (req, socket, head) => {
  if (req.url.split('?')[0] !== '/ws') return upgrade(req, socket, head);
  const proxy = upstream(req);
  proxy.on('upgrade', (response, peer, peerHead) => {
    peer.setTimeout(0);
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' + response.rawHeaders.reduce((lines, value, i, headers) => i % 2 ? lines : lines + value + ': ' + headers[i + 1] + '\r\n', '') + '\r\n');
    if (head.length) peer.write(head);
    if (peerHead.length) socket.write(peerHead);
    peer.on('error', () => socket.destroy());
    socket.on('error', () => peer.destroy());
    peer.on('close', () => socket.destroy());
    socket.on('close', () => peer.destroy());
    socket.pipe(peer).pipe(socket);
  });
  proxy.on('response', response => {
    response.resume();
    socket.end('HTTP/1.1 ' + response.statusCode + ' Upgrade rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  proxy.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  socket.on('error', () => proxy.destroy());
  socket.on('close', () => proxy.destroy());
  proxy.end();
});
server.listen(port, hostname, () => console.log('QA web listening on http://' + hostname + ':' + port));
