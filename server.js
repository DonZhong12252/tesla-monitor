import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = 8080;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/sender') urlPath = '/sender.html';
  if (urlPath === '/receiver') urlPath = '/receiver.html';

  const filePath = path.join(PUBLIC, urlPath);
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// Signaling: rooms keyed by "room" query param. Default room = "tesla".
// Each room holds at most one sender + one receiver; relays SDP/ICE between them.
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const room = url.searchParams.get('room') || 'tesla';
  const role = url.searchParams.get('role'); // 'sender' | 'receiver'
  if (!['sender', 'receiver'].includes(role)) { ws.close(1008, 'bad role'); return; }

  let r = rooms.get(room);
  if (!r) { r = {}; rooms.set(room, r); }
  if (r[role] && r[role].readyState === 1) r[role].close(4000, 'replaced');
  r[role] = ws;
  ws.send(JSON.stringify({ type: 'hello', role, peerReady: !!(r.sender && r.receiver) }));
  const other = role === 'sender' ? 'receiver' : 'sender';
  if (r[other]?.readyState === 1) r[other].send(JSON.stringify({ type: 'peer-joined', role }));

  ws.on('message', (buf) => {
    const peer = rooms.get(room)?.[other];
    if (peer?.readyState === 1) peer.send(buf.toString());
  });
  ws.on('close', () => {
    const cur = rooms.get(room);
    if (cur && cur[role] === ws) {
      delete cur[role];
      if (cur[other]?.readyState === 1) cur[other].send(JSON.stringify({ type: 'peer-left', role }));
      if (!cur.sender && !cur.receiver) rooms.delete(room);
    }
  });
});

function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(`${name}: http://${a.address}:${PORT}`);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`tesla-monitor server on :${PORT}`);
  console.log('Sender (open on Mac):  http://localhost:' + PORT + '/sender');
  console.log('Receiver (open in Tesla browser, use one of these LAN URLs + /receiver):');
  for (const l of lanAddresses()) console.log('  ' + l);
});
