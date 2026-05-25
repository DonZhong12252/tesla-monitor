#!/usr/bin/env node
// Install or remove a launchd LaunchAgent so tesla-monitor starts on login.
//   node scripts/install-launchd.js install
//   node scripts/install-launchd.js uninstall

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LABEL = 'com.donzhong.tesla-monitor';
const PLIST = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const LOG = path.join(ROOT, 'tesla-monitor.log');

const cmd = process.argv[2];
if (!['install', 'uninstall'].includes(cmd)) {
  console.error('usage: install-launchd.js <install|uninstall>'); process.exit(2);
}

const nodeBin = process.execPath; // current node binary

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${path.join(ROOT, 'server.js')}</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
`;

function run(...args) {
  const r = spawnSync(args[0], args.slice(1), { stdio: 'inherit' });
  return r.status;
}

if (cmd === 'install') {
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plist);
  // Unload first in case it's already loaded.
  spawnSync('launchctl', ['unload', PLIST], { stdio: 'ignore' });
  const s = run('launchctl', 'load', '-w', PLIST);
  if (s === 0) console.log(`✓ installed launchd agent → ${PLIST}\n  logs: ${LOG}\n  server should now be running on boot/login.`);
  else console.error('launchctl load failed');
} else {
  spawnSync('launchctl', ['unload', PLIST], { stdio: 'ignore' });
  if (fs.existsSync(PLIST)) fs.unlinkSync(PLIST);
  console.log(`✓ removed launchd agent (${PLIST})`);
}
