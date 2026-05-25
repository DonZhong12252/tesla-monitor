#!/usr/bin/env node
// One-command launcher: starts the Node server, spawns cloudflared tunnel,
// auto-opens the sender page in the default browser, and prints the Tesla URL.
//
//   npm start

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')).port || 8080;
const URL_FILE = path.join(__dirname, '.last-tunnel-url');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', magenta: '\x1b[35m',
};

function check(cmd, install) {
  if (spawnSync('which', [cmd]).status !== 0) {
    console.error(`${c.red}✗ ${cmd} not found.${c.reset} Install: ${c.bold}${install}${c.reset}`);
    return false;
  }
  return true;
}

const ok = [
  check('cloudflared', 'brew install cloudflared'),
  check('cliclick',    'brew install cliclick'),
].every(Boolean);
if (!ok) process.exit(1);

console.log(`${c.dim}Starting tesla-monitor…${c.reset}`);

// 1. Start the server
const server = spawn('node', [path.join(__dirname, 'server.js')], {
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: __dirname,
});
const serverPrefix = c.dim + '[server]' + c.reset + ' ';
server.stdout.on('data', d => process.stdout.write(d.toString().split('\n').filter(Boolean).map(l => serverPrefix + l).join('\n') + '\n'));
server.stderr.on('data', d => process.stderr.write(d.toString().split('\n').filter(Boolean).map(l => serverPrefix + l).join('\n') + '\n'));

// Wait for the server to be listening
await new Promise((resolve, reject) => {
  const start = Date.now();
  const probe = setInterval(async () => {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/config`);
      if (r.ok) { clearInterval(probe); resolve(); }
    } catch {}
    if (Date.now() - start > 10_000) { clearInterval(probe); reject(new Error('server failed to start within 10s')); }
  }, 200);
});

// 2. Start cloudflared tunnel
const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let tunnelUrl = null;
const onTunnelLine = (line) => {
  const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m && !tunnelUrl) {
    tunnelUrl = m[0];
    fs.writeFileSync(URL_FILE, tunnelUrl);
    printBanner();
    openSender();
  }
};
const tunnelPrefix = c.dim + '[tunnel]' + c.reset + ' ';
const showTunnel = process.argv.includes('--verbose') || process.env.VERBOSE === '1';
tunnel.stdout.on('data', d => {
  const text = d.toString();
  text.split('\n').filter(Boolean).forEach(onTunnelLine);
  if (showTunnel) process.stdout.write(text.split('\n').filter(Boolean).map(l => tunnelPrefix + l).join('\n') + '\n');
});
tunnel.stderr.on('data', d => {
  const text = d.toString();
  text.split('\n').filter(Boolean).forEach(onTunnelLine);
  if (showTunnel) process.stderr.write(text.split('\n').filter(Boolean).map(l => tunnelPrefix + l).join('\n') + '\n');
});

function openSender() {
  spawn('open', [`http://localhost:${PORT}/sender`], { stdio: 'ignore' });
}

function printBanner() {
  const teslaUrl = `${tunnelUrl}/receiver`;
  const lines = [
    '',
    c.green + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + c.reset,
    c.green + '  ✓  tesla-monitor is ready' + c.reset,
    c.green + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + c.reset,
    '',
    c.bold + '  On your Mac' + c.reset + ' (Chrome should be opening):',
    `    ${c.cyan}http://localhost:${PORT}/sender${c.reset}`,
    `    → Click ${c.bold}Start sharing${c.reset} → pick the BetterDisplay virtual screen`,
    '',
    c.bold + '  On your Tesla' + c.reset + ' (type this URL in the browser):',
    `    ${c.yellow}${c.bold}${teslaUrl}${c.reset}`,
    '',
    c.dim + '  URL changes when you restart this command. Saved to .last-tunnel-url' + c.reset,
    c.dim + `  Press Ctrl-C to stop. Add --verbose to see server + tunnel logs.` + c.reset,
    '',
  ];
  console.log(lines.join('\n'));
}

// Graceful shutdown
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${c.dim}Shutting down…${c.reset}`);
  try { tunnel.kill('SIGTERM'); } catch {}
  try { server.kill('SIGTERM'); } catch {}
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
server.on('exit', (code) => { console.error(`${c.red}server exited (${code})${c.reset}`); shutdown(); });
tunnel.on('exit', (code) => { console.error(`${c.red}tunnel exited (${code}) — restart with: npm start${c.reset}`); shutdown(); });
