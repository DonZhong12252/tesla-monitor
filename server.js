import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { WebSocketServer } from 'ws';
import bonjourPkg from 'bonjour-service';
const { Bonjour } = bonjourPkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const PORT = config.port || 8080;
const PIN = (config.pin || '').toString();
const HOSTNAME = config.hostname || 'tesla-monitor';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const hasCliclick = spawnSync('which', ['cliclick']).status === 0;
if (config.touch?.enabled && !hasCliclick) {
  console.warn('⚠  cliclick not found — touch control disabled. Install: brew install cliclick');
}

// ───────── HTTP ─────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/api/inject' && req.method === 'POST') return handleInject(req, res);
  if (p === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      pinRequired: !!PIN,
      touch: config.touch?.enabled && hasCliclick,
      display: config.display,
    }));
  }

  let urlPath = p;
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/sender') urlPath = '/sender.html';
  if (urlPath === '/receiver') urlPath = '/receiver.html';
  const filePath = path.join(PUBLIC, urlPath);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ───────── Touch injection ─────────
// Body shape: { type: 'down'|'up'|'move'|'click', x: 0..1, y: 0..1 }
//
// Events are applied strictly in order by ONE cliclick process at a time.
// Spawning a process per event let them race (cursor jumping back and forth),
// so instead we queue, coalesce consecutive moves to the latest position, and
// batch whatever is pending into a single cliclick call. down/up are never
// dropped, so the Mac can't get stuck with the button held.
const injectQueue = [];
let injecting = false;
let buttonDown = false;

function toPx(x, y) {
  const d = config.display;
  return [
    Math.round(d.offsetX + Math.max(0, Math.min(1, x)) * d.width),
    Math.round(d.offsetY + Math.max(0, Math.min(1, y)) * d.height),
  ];
}

function enqueueInject(type, x, y) {
  const last = injectQueue[injectQueue.length - 1];
  if (type === 'move' && last?.type === 'move') { last.x = x; last.y = y; }
  else injectQueue.push({ type, x, y });
  pumpInject();
}

function pumpInject() {
  if (injecting || !injectQueue.length) return;
  const batch = injectQueue.splice(0);
  const args = ['-w', '10'];
  for (const { type, x, y } of batch) {
    const [px, py] = toPx(x, y);
    if (type === 'down') { args.push(`m:${px},${py}`, `dd:${px},${py}`); buttonDown = true; }
    else if (type === 'up') { args.push(`du:${px},${py}`); buttonDown = false; }
    else if (type === 'move') args.push(`${buttonDown ? 'dm' : 'm'}:${px},${py}`);
    else if (type === 'click') args.push(`c:${px},${py}`);
  }
  injecting = true;
  const child = spawn('cliclick', args, { stdio: 'ignore' });
  const done = () => { injecting = false; pumpInject(); };
  child.on('exit', done);
  child.on('error', done);
}

async function handleInject(req, res) {
  if (!hasCliclick || !config.touch?.enabled) { res.writeHead(503); return res.end('touch disabled'); }
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1024) req.destroy(); });
  req.on('end', () => {
    let msg;
    try { msg = JSON.parse(body); } catch { res.writeHead(400); return res.end('bad json'); }
    const { type, x, y } = msg;
    if (typeof x !== 'number' || typeof y !== 'number') { res.writeHead(400); return res.end('bad coords'); }
    if (!['down', 'up', 'move', 'click'].includes(type)) { res.writeHead(400); return res.end('bad type'); }
    enqueueInject(type, x, y);
    res.writeHead(204); res.end();
  });
}

// ───────── Signaling ─────────
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const room = url.searchParams.get('room') || 'tesla';
  const role = url.searchParams.get('role');
  const pin  = url.searchParams.get('pin') || '';
  if (PIN && pin !== PIN) { ws.close(4401, 'bad pin'); return; }
  if (!['sender', 'receiver'].includes(role)) { ws.close(1008, 'bad role'); return; }

  let r = rooms.get(room);
  if (!r) { r = {}; rooms.set(room, r); }
  if (r[role]?.readyState === 1) r[role].close(4000, 'replaced');
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

// ───────── mDNS / Bonjour ─────────
let bonjour;
function startBonjour() {
  bonjour = new Bonjour();
  bonjour.publish({ name: HOSTNAME, type: 'http', port: PORT, host: `${HOSTNAME}.local` });
  console.log(`mDNS: published as http://${HOSTNAME}.local:${PORT}`);
}
function stopBonjour() { try { bonjour?.unpublishAll(() => bonjour.destroy()); } catch {} }
process.on('SIGINT', () => { stopBonjour(); process.exit(0); });
process.on('SIGTERM', () => { stopBonjour(); process.exit(0); });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`tesla-monitor v0.2 on :${PORT}`);
  console.log(`pin: ${PIN ? '****' : '(none — set in config.json)'}`);
  console.log(`touch: ${config.touch?.enabled && hasCliclick ? 'enabled' : 'disabled'}`);
  console.log('Sender (open on Mac):  http://localhost:' + PORT + '/sender');
  console.log(`Receiver (Tesla):      http://${HOSTNAME}.local:${PORT}/receiver`);
  console.log('Fallback LAN URLs:');
  for (const l of lanAddresses()) console.log('  ' + l);
  startBonjour();
});
