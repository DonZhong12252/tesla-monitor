// Sender: captures display via getDisplayMedia, sends to receiver over WebRTC,
// receives touch events back via DataChannel and forwards them to /api/inject
// so the local server can inject mouse events on the Mac via cliclick.

const logEl = document.getElementById('log');
const log = (...a) => { console.log(...a); logEl.textContent += a.join(' ') + '\n'; logEl.scrollTop = logEl.scrollHeight; };

const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const preview = document.getElementById('preview');
const profileSel = document.getElementById('profile');
const saveProfileBtn = document.getElementById('saveProfile');
const delProfileBtn = document.getElementById('delProfile');
const wIn = document.getElementById('w');
const hIn = document.getElementById('h');
const fpsIn = document.getElementById('fps');
const kbpsIn = document.getElementById('kbps');
const pinIn = document.getElementById('pin');
const touchStatus = document.getElementById('touchStatus');
const audioSrcSel = document.getElementById('audioSrc');
const audioKbpsIn = document.getElementById('audioKbps');
const refreshAudioBtn = document.getElementById('refreshAudio');

let pc, ws, dc, localStream, micStream;
let serverCfg = { touch: false };

const BUILT_IN = {
  'MCU3 — 1600×1000 @ 30 (default)': { w: 1600, h: 1000, fps: 30, kbps: 8000 },
  'MCU3 — 1920×1200 @ 30':           { w: 1920, h: 1200, fps: 30, kbps: 10000 },
  'MCU3 — 1600×1000 @ 60 (smooth)':  { w: 1600, h: 1000, fps: 60, kbps: 12000 },
  'MCU1/2 — 1280×800 @ 30':          { w: 1280, h: 800,  fps: 30, kbps: 4000 },
  'Highway (low bandwidth)':         { w: 1280, h: 800,  fps: 20, kbps: 2500 },
};
function loadProfiles() {
  const custom = JSON.parse(localStorage.getItem('tm.profiles') || '{}');
  return { ...BUILT_IN, ...custom };
}
function saveCustom(custom) { localStorage.setItem('tm.profiles', JSON.stringify(custom)); }
function renderProfiles() {
  const all = loadProfiles();
  const active = localStorage.getItem('tm.activeProfile') || Object.keys(BUILT_IN)[0];
  while (profileSel.firstChild) profileSel.removeChild(profileSel.firstChild);
  for (const name of Object.keys(all)) {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    if (name === active) o.selected = true;
    profileSel.appendChild(o);
  }
  applyProfile(all[active] || BUILT_IN[Object.keys(BUILT_IN)[0]]);
}
function applyProfile(p) { wIn.value = p.w; hIn.value = p.h; fpsIn.value = p.fps; kbpsIn.value = p.kbps; }
profileSel.onchange = () => {
  const all = loadProfiles();
  localStorage.setItem('tm.activeProfile', profileSel.value);
  applyProfile(all[profileSel.value]);
};
saveProfileBtn.onclick = () => {
  const name = prompt('Profile name?');
  if (!name) return;
  const custom = JSON.parse(localStorage.getItem('tm.profiles') || '{}');
  custom[name] = { w: +wIn.value, h: +hIn.value, fps: +fpsIn.value, kbps: +kbpsIn.value };
  saveCustom(custom);
  localStorage.setItem('tm.activeProfile', name);
  renderProfiles();
};
delProfileBtn.onclick = () => {
  const name = profileSel.value;
  if (name in BUILT_IN) return alert('cannot delete built-in profile');
  const custom = JSON.parse(localStorage.getItem('tm.profiles') || '{}');
  delete custom[name]; saveCustom(custom); renderProfiles();
};
pinIn.value = localStorage.getItem('tm.pin') || '';
pinIn.onchange = () => localStorage.setItem('tm.pin', pinIn.value);

// ───────── Audio source ─────────
// 'none'   → video only
// 'system' → getDisplayMedia system audio (Chrome + macOS 14.2+ ScreenCaptureKit)
// <id>     → an input device, e.g. a BlackHole loopback carrying Mac output
const AUDIO_CONSTRAINTS = {
  echoCancellation: false, noiseSuppression: false, autoGainControl: false,
  channelCount: 2, sampleRate: 48000, sampleSize: 16,
};
audioKbpsIn.value = localStorage.getItem('tm.audioKbps') || 160;
audioKbpsIn.onchange = () => localStorage.setItem('tm.audioKbps', audioKbpsIn.value);
audioSrcSel.onchange = () => localStorage.setItem('tm.audioSrc', audioSrcSel.value);
refreshAudioBtn.onclick = () => renderAudioSources();

async function renderAudioSources() {
  const saved = localStorage.getItem('tm.audioSrc') || 'system';
  const opts = [['system', 'System audio (share in picker)'], ['none', 'No sound']];
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
    devs.forEach((d, i) => opts.push([d.deviceId, 'Input: ' + (d.label || `device ${i + 1} (grant mic access to see names)`)]));
  } catch {}
  while (audioSrcSel.firstChild) audioSrcSel.removeChild(audioSrcSel.firstChild);
  for (const [value, label] of opts) {
    const o = document.createElement('option');
    o.value = value; o.textContent = label;
    if (value === saved) o.selected = true;
    audioSrcSel.appendChild(o);
  }
}

async function loadServerCfg() {
  try { serverCfg = await (await fetch('/api/config')).json(); } catch {}
  touchStatus.textContent = serverCfg.touch ? '✓ touch control enabled' : '⚠ touch disabled — install cliclick: brew install cliclick';
}

function connectSignaling() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const pin = pinIn.value.trim();
  const qs = `role=sender&room=tesla${pin ? '&pin=' + encodeURIComponent(pin) : ''}`;
  ws = new WebSocket(`${proto}://${location.host}/ws?${qs}`);
  ws.onopen = () => log('signaling: connected');
  ws.onclose = (e) => log('signaling: closed' + (e.code === 4401 ? ' (bad PIN)' : ''));
  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') {
      log('signaling: hello, peerReady=' + msg.peerReady);
      if (msg.peerReady) await makeOffer();
    } else if (msg.type === 'peer-joined' && msg.role === 'receiver') {
      log('receiver joined → offering'); await makeOffer();
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }); log('got answer');
    } else if (msg.type === 'ice' && msg.candidate) {
      try { await pc.addIceCandidate(msg.candidate); } catch (err) { log('ice err', err.message); }
    }
  };
}

function tuneSdp(sdp, startKbps, maxKbps) {
  const lines = sdp.split('\r\n');
  const mIdx = lines.findIndex(l => l.startsWith('m=video'));
  if (mIdx < 0) return sdp;
  const h264Pts = [];
  for (const l of lines) { const m = l.match(/^a=rtpmap:(\d+) H264\/90000/); if (m) h264Pts.push(m[1]); }
  const baselinePts = h264Pts.filter(pt => {
    const fmtp = lines.find(l => l.startsWith(`a=fmtp:${pt} `));
    return fmtp && /profile-level-id=42e0[0-9a-f]{2}/i.test(fmtp);
  });
  const preferred = baselinePts.length ? baselinePts : h264Pts;
  if (preferred.length) {
    const parts = lines[mIdx].split(' ');
    const header = parts.slice(0, 3);
    const pts = parts.slice(3);
    lines[mIdx] = [...header, ...preferred, ...pts.filter(p => !preferred.includes(p))].join(' ');
  }
  if (preferred[0]) {
    const fi = lines.findIndex(l => l.startsWith(`a=fmtp:${preferred[0]} `));
    if (fi >= 0 && !/x-google-max-bitrate/.test(lines[fi])) {
      lines[fi] += `;x-google-min-bitrate=${Math.floor(maxKbps/2)};x-google-start-bitrate=${startKbps};x-google-max-bitrate=${maxKbps}`;
    }
  }
  if (!lines.slice(mIdx, mIdx + 4).some(l => l.startsWith('b=AS:'))) {
    lines.splice(mIdx + 1, 0, `b=AS:${maxKbps}`);
  }
  return lines.join('\r\n');
}

// Opus defaults to mono ~32kbps with DTX-style tuning for voice. For music /
// system sound, ask for stereo, a real bitrate, in-band FEC for Wi-Fi loss,
// and no DTX (DTX causes audible gaps during quiet passages).
function tuneOpus(sdp, kbps) {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!m) return sdp;
  const pt = m[1];
  const want = { stereo: 1, 'sprop-stereo': 1, maxaveragebitrate: kbps * 1000, useinbandfec: 1, usedtx: 0, maxplaybackrate: 48000, minptime: 10 };
  const re = new RegExp(`^a=fmtp:${pt} (.*)$`, 'm');
  const fm = sdp.match(re);
  const params = {};
  for (const kv of (fm ? fm[1] : '').split(';')) { const [k, v] = kv.split('='); if (k) params[k.trim()] = v; }
  Object.assign(params, want);
  const line = `a=fmtp:${pt} ` + Object.entries(params).map(([k, v]) => `${k}=${v}`).join(';');
  return fm ? sdp.replace(re, line) : sdp.replace(new RegExp(`^(a=rtpmap:${pt} .*)$`, 'm'), `$1\r\n${line}`);
}

async function makeOffer() {
  if (!localStream) { log('no stream yet — click Start first'); return; }
  pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
  pc.onicecandidate = (e) => { if (e.candidate) ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate })); };
  pc.onconnectionstatechange = () => log('pc:', pc.connectionState);

  dc = pc.createDataChannel('touch', { ordered: true });
  dc.onopen = () => log('touch channel open');
  dc.onclose = () => log('touch channel closed');
  dc.onmessage = (e) => handleTouch(e.data);

  for (const track of localStream.getTracks()) {
    track.contentHint = track.kind === 'video' ? 'detail' : 'music';
    pc.addTrack(track, localStream);
  }

  const fps   = +fpsIn.value || 30;
  const kbps  = +kbpsIn.value || 8000;
  const start = Math.floor(kbps * 0.75);
  const aKbps = Math.max(32, Math.min(510, +audioKbpsIn.value || 160));

  const offer = await pc.createOffer();
  offer.sdp = tuneOpus(tuneSdp(offer.sdp, start, kbps), aKbps);
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
  log('sent offer (H.264 baseline, ' + kbps + ' kbps cap' + (localStream.getAudioTracks().length ? `, opus stereo ${aKbps} kbps` : ', no audio') + ')');

  const vs = pc.getSenders().find(s => s.track?.kind === 'video');
  if (vs) {
    const params = vs.getParameters();
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    params.encodings[0].maxBitrate = kbps * 1000;
    params.encodings[0].maxFramerate = fps;
    params.encodings[0].priority = 'high';
    params.encodings[0].networkPriority = 'high';
    params.degradationPreference = 'maintain-framerate';
    try { await vs.setParameters(params); log(`encoding: ${fps}fps, maintain-framerate`); }
    catch (e) { log('setParameters failed:', e.message); }
  }

  const as = pc.getSenders().find(s => s.track?.kind === 'audio');
  if (as) {
    const params = as.getParameters();
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    params.encodings[0].maxBitrate = aKbps * 1000;
    params.encodings[0].priority = 'high';
    params.encodings[0].networkPriority = 'high';
    try { await as.setParameters(params); } catch (e) { log('audio setParameters failed:', e.message); }
  }
}

// Forward touch events to the server one at a time, in order. Consecutive
// moves collapse to the latest position; down/up are never dropped (dropping
// an 'up' used to leave the Mac's mouse button stuck down).
const touchQueue = [];
let touchSending = false;
function handleTouch(data) {
  if (!serverCfg.touch) return;
  let msg;
  try { msg = JSON.parse(data); } catch { return; }
  const last = touchQueue[touchQueue.length - 1];
  if (msg.type === 'move' && last?.type === 'move') touchQueue[touchQueue.length - 1] = msg;
  else touchQueue.push(msg);
  pumpTouch();
}
async function pumpTouch() {
  if (touchSending) return;
  touchSending = true;
  while (touchQueue.length) {
    const msg = touchQueue.shift();
    try {
      await fetch('/api/inject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
    } catch {}
  }
  touchSending = false;
}

// Tell the server which screen we captured so taps land on that screen.
async function detectTouchTarget() {
  if (!serverCfg.touch) return;
  const st = localStream?.getVideoTracks()[0]?.getSettings() || {};
  try {
    const r = await (await fetch('/api/display', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: st.deviceId, width: st.width, height: st.height }) })).json();
    const t = r.target;
    log(`touch → ${t.name || 'display'} at (${t.offsetX}, ${t.offsetY}) ${t.width}×${t.height} pt [${t.source}]`);
    if (t.source === 'config.json') log('⚠ could not identify the shared screen — taps use config.json → display. Screens: ' + JSON.stringify(r.screens));
  } catch (e) { log('display detect failed:', e.message); }
}

async function start() {
  try {
    await loadServerCfg();
    const src = audioSrcSel.value;
    localStream = await navigator.mediaDevices.getDisplayMedia(getCaptureConstraints(src === 'system'));
    if (src === 'system' && !localStream.getAudioTracks().length) {
      log('⚠ no system audio — tick “Share system audio” in the picker (needs macOS 14.2+), or choose a loopback input under Sound');
    }
    if (src !== 'system' && src !== 'none') {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { ...AUDIO_CONSTRAINTS, deviceId: { exact: src } } });
        for (const t of micStream.getAudioTracks()) localStream.addTrack(t);
      } catch (e) { log('audio input failed:', e.message); }
    }
    preview.srcObject = localStream;
    localStream.getVideoTracks()[0].onended = () => stop();
    startBtn.disabled = true; stopBtn.disabled = false;
    log('capture started:', JSON.stringify(localStream.getVideoTracks()[0].getSettings()));
    detectTouchTarget();
    const at = localStream.getAudioTracks()[0];
    if (at) log('audio:', at.label || 'track', JSON.stringify(at.getSettings()));
    renderAudioSources(); // device labels become visible once permission is granted
    connectSignaling();
  } catch (e) { log('start failed:', e.message); }
}
function stop() {
  localStream?.getTracks().forEach(t => t.stop());
  micStream?.getTracks().forEach(t => t.stop());
  pc?.close(); ws?.close();
  localStream = null; micStream = null; pc = null; ws = null; dc = null;
  preview.srcObject = null;
  startBtn.disabled = false; stopBtn.disabled = true;
  log('stopped');
}
startBtn.onclick = start;
stopBtn.onclick = stop;

function getCaptureConstraints(withAudio) {
  return {
    video: {
      displaySurface: 'monitor',
      width:  { ideal: +wIn.value, max: +wIn.value },
      height: { ideal: +hIn.value, max: +hIn.value },
      frameRate: { ideal: +fpsIn.value, max: +fpsIn.value },
      cursor: 'always',
    },
    audio: withAudio ? { ...AUDIO_CONSTRAINTS, suppressLocalAudioPlayback: false } : false,
    systemAudio: withAudio ? 'include' : 'exclude',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
  };
}

renderProfiles();
renderAudioSources();
navigator.mediaDevices.addEventListener?.('devicechange', renderAudioSources);
loadServerCfg();
