const v = document.getElementById('v');
const statusEl = document.getElementById('status');
const fsBtn = document.getElementById('fs');
const touchBtn = document.getElementById('touch');
const reconnectBtn = document.getElementById('reconnect');
const statsEl = document.getElementById('stats');
const pinbox = document.getElementById('pinbox');
const pinform = document.getElementById('pinform');
const pinInput = document.getElementById('pin');
const setStatus = (s) => { statusEl.textContent = s; };

let pc, ws, dc, statsTimer, reconnectTimer;
let touchEnabled = true;
let touchActive = false;
let lastMoveSent = 0;
const MOVE_THROTTLE_MS = 16; // ~60Hz
let cfg = { pinRequired: false, touch: false };

function getPin() {
  const url = new URLSearchParams(location.search).get('pin');
  if (url) return url;
  return localStorage.getItem('tm.pin') || '';
}
function savePin(p) { localStorage.setItem('tm.pin', p); }

async function bootstrap() {
  try { cfg = await (await fetch('/api/config')).json(); } catch {}
  if (cfg.pinRequired && !getPin()) { pinbox.classList.remove('hidden'); return; }
  connect();
}

pinform.onsubmit = (e) => {
  e.preventDefault();
  savePin(pinInput.value.trim());
  pinbox.classList.add('hidden');
  connect();
};

function connect() {
  clearTimeout(reconnectTimer);
  if (ws) { try { ws.close(); } catch {} }
  if (pc) { try { pc.close(); } catch {} }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const pin = getPin();
  const qs = `role=receiver&room=tesla${pin ? '&pin=' + encodeURIComponent(pin) : ''}`;
  ws = new WebSocket(`${proto}://${location.host}/ws?${qs}`);
  ws.onopen = () => setStatus('signaling connected, waiting for sender…');
  ws.onclose = (e) => {
    if (e.code === 4401) { setStatus('bad PIN'); savePin(''); pinbox.classList.remove('hidden'); return; }
    setStatus('signaling closed — retrying');
    scheduleReconnect();
  };
  ws.onerror = () => setStatus('signaling error');

  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'offer') {
      pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });
      pc.ondatachannel = (ev) => { dc = ev.channel; setupDc(); };
      pc.ontrack = (ev) => {
        v.srcObject = ev.streams[0];
        document.body.classList.add('connected');
        setStatus('streaming');
        try { ev.receiver.playoutDelayHint = 0; } catch {}
        try { ev.receiver.jitterBufferTarget = 0; } catch {}
        startStatsLoop();
        tryFullscreen();
      };
      pc.onicecandidate = (ev) => { if (ev.candidate) ws.send(JSON.stringify({ type: 'ice', candidate: ev.candidate })); };
      pc.onconnectionstatechange = () => {
        setStatus('pc: ' + pc.connectionState);
        if (['failed','disconnected','closed'].includes(pc.connectionState)) {
          document.body.classList.remove('connected'); scheduleReconnect();
        }
      };
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', sdp: answer.sdp }));
    } else if (msg.type === 'ice' && msg.candidate) {
      try { await pc.addIceCandidate(msg.candidate); } catch (err) { setStatus('ice err: ' + err.message); }
    } else if (msg.type === 'peer-left') {
      setStatus('sender disconnected — waiting');
      document.body.classList.remove('connected');
    }
  };
}

function setupDc() {
  dc.onopen = () => setStatus('touch channel open');
  dc.onclose = () => {};
}

function scheduleReconnect() { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 1500); }
function tryFullscreen() { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); }

// ───────── Touch → DataChannel ─────────
// Compute normalized coords (0..1) of a pointer event relative to the actual
// rendered video frame inside <video> (which uses object-fit:contain so there
// may be letterbox bars). We map only inside-the-frame coordinates.
function pointerToVideoCoords(ev) {
  const rect = v.getBoundingClientRect();
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const dispW = vw * scale, dispH = vh * scale;
  const offX = rect.left + (rect.width  - dispW) / 2;
  const offY = rect.top  + (rect.height - dispH) / 2;
  const x = (ev.clientX - offX) / dispW;
  const y = (ev.clientY - offY) / dispH;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

function sendTouch(type, x, y) {
  if (!touchEnabled || !cfg.touch) return;
  const payload = JSON.stringify({ type, x, y });
  if (dc?.readyState === 'open') dc.send(payload);
  else fetch('/api/inject', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(() => {});
}

v.addEventListener('pointerdown', (ev) => {
  const c = pointerToVideoCoords(ev); if (!c) return;
  if (touchEnabled && cfg.touch) ev.preventDefault();
  touchActive = true;
  v.setPointerCapture(ev.pointerId);
  sendTouch('down', c.x, c.y);
});
v.addEventListener('pointermove', (ev) => {
  if (!touchActive) return;
  const now = performance.now();
  if (now - lastMoveSent < MOVE_THROTTLE_MS) return;
  lastMoveSent = now;
  const c = pointerToVideoCoords(ev); if (!c) return;
  sendTouch('move', c.x, c.y);
});
const endTouch = (ev) => {
  if (!touchActive) return;
  touchActive = false;
  try { v.releasePointerCapture(ev.pointerId); } catch {}
  const c = pointerToVideoCoords(ev); if (!c) return;
  sendTouch('up', c.x, c.y);
};
v.addEventListener('pointerup', endTouch);
v.addEventListener('pointercancel', endTouch);

touchBtn.onclick = (e) => {
  e.stopPropagation();
  touchEnabled = !touchEnabled;
  touchBtn.textContent = 'Touch: ' + (touchEnabled ? 'on' : 'off');
  touchBtn.classList.toggle('on', touchEnabled);
};

// ───────── Stats ─────────
function startStatsLoop() {
  clearInterval(statsTimer);
  let lastBytes = 0, lastTs = 0, lastFrames = 0;
  statsTimer = setInterval(async () => {
    if (!pc) return;
    const stats = await pc.getStats();
    let inbound, candPair;
    stats.forEach(s => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') inbound = s;
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') candPair = s;
    });
    if (!inbound) return;
    const now = inbound.timestamp;
    const dt = lastTs ? (now - lastTs) / 1000 : 0;
    const kbps = dt ? Math.round(((inbound.bytesReceived - lastBytes) * 8) / dt / 1000) : 0;
    const fps = dt ? Math.round((inbound.framesDecoded - lastFrames) / dt) : 0;
    lastBytes = inbound.bytesReceived; lastTs = now; lastFrames = inbound.framesDecoded;
    const rtt = candPair?.currentRoundTripTime != null ? Math.round(candPair.currentRoundTripTime * 1000) : '?';
    const jitter = inbound.jitter != null ? Math.round(inbound.jitter * 1000) : '?';
    statsEl.textContent = `${fps}fps  ${kbps}kbps  rtt:${rtt}ms  jit:${jitter}ms  drop:${inbound.framesDropped||0}`;
  }, 1000);
}

reconnectBtn.onclick = (e) => { e.stopPropagation(); connect(); };
fsBtn.onclick = (e) => { e.stopPropagation(); tryFullscreen(); };

// On first tap anywhere outside the video, also try fullscreen and show UI.
document.addEventListener('pointerdown', (ev) => {
  if (ev.target === v) return; // video has its own handler
  tryFullscreen();
  document.body.classList.add('touched');
  setTimeout(() => document.body.classList.remove('touched'), 3000);
}, { passive: true });

bootstrap();
