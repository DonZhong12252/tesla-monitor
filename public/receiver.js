const v = document.getElementById('v');
const statusEl = document.getElementById('status');
const fsBtn = document.getElementById('fs');
const reconnectBtn = document.getElementById('reconnect');
const statsEl = document.getElementById('stats');
const setStatus = (s) => { statusEl.textContent = s; };

let pc, ws, statsTimer, reconnectTimer;

function connect() {
  clearTimeout(reconnectTimer);
  if (ws) { try { ws.close(); } catch {} }
  if (pc) { try { pc.close(); } catch {} }

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=receiver&room=tesla`);
  ws.onopen = () => setStatus('signaling connected, waiting for sender…');
  ws.onclose = () => { setStatus('signaling closed — retrying'); scheduleReconnect(); };
  ws.onerror = () => setStatus('signaling error');

  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'offer') {
      pc = new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });
      pc.ontrack = (ev) => {
        v.srcObject = ev.streams[0];
        document.body.classList.add('connected');
        setStatus('streaming');

        // Lowest possible playout delay on a clean LAN.
        try { ev.receiver.playoutDelayHint = 0; } catch {}
        try { ev.receiver.jitterBufferTarget = 0; } catch {}

        startStatsLoop();
        // Try fullscreen automatically. Tesla browser usually blocks without
        // a user gesture, so we also retry on first tap (see below).
        tryFullscreen();
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) ws.send(JSON.stringify({ type: 'ice', candidate: ev.candidate }));
      };
      pc.onconnectionstatechange = () => {
        setStatus('pc: ' + pc.connectionState);
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          document.body.classList.remove('connected');
          scheduleReconnect();
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

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 1500);
}

function tryFullscreen() {
  if (document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.().catch(() => {});
}

// Stats overlay: shows the numbers that actually matter for "is this usable?".
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

reconnectBtn.onclick = connect;
fsBtn.onclick = tryFullscreen;

// First user tap: also tries fullscreen (gesture context) and unmutes.
// Show UI briefly on tap so the user can find buttons.
document.addEventListener('pointerdown', () => {
  tryFullscreen();
  document.body.classList.add('touched');
  setTimeout(() => document.body.classList.remove('touched'), 3000);
}, { passive: true });

// Auto-connect on page load — Tesla user just navigates to the URL.
connect();
