// Sender: captures a display via getDisplayMedia, sends to receiver over WebRTC.
// Signaling goes through the local Node WS server; media is peer-to-peer on the LAN.
// Tuned aggressively for low latency on a clean LAN.

const logEl = document.getElementById('log');
const log = (...a) => { console.log(...a); logEl.textContent += a.join(' ') + '\n'; logEl.scrollTop = logEl.scrollHeight; };

const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const preview = document.getElementById('preview');

let pc, ws, localStream;

function connectSignaling() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?role=sender&room=tesla`);
  ws.onopen = () => log('signaling: connected');
  ws.onclose = () => log('signaling: closed');
  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'hello') {
      log('signaling: hello, peerReady=' + msg.peerReady);
      if (msg.peerReady) await makeOffer();
    } else if (msg.type === 'peer-joined' && msg.role === 'receiver') {
      log('receiver joined → offering');
      await makeOffer();
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      log('got answer');
    } else if (msg.type === 'ice' && msg.candidate) {
      try { await pc.addIceCandidate(msg.candidate); } catch (err) { log('ice err', err.message); }
    }
  };
}

// Low-latency SDP munging:
//  1. Reorder m=video to prefer the H.264 Constrained Baseline payload type
//     (profile-level-id=42e0xx). Baseline has no B-frames → no reorder delay.
//  2. Strip B-frame allowance hints just in case.
//  3. Hint a high start bitrate so we don't spend the first seconds ramping up.
function tuneSdp(sdp, startKbps, maxKbps) {
  const lines = sdp.split('\r\n');
  const mIdx = lines.findIndex(l => l.startsWith('m=video'));
  if (mIdx < 0) return sdp;

  // Find all H.264 payload types
  const h264Pts = [];
  for (const l of lines) {
    const m = l.match(/^a=rtpmap:(\d+) H264\/90000/);
    if (m) h264Pts.push(m[1]);
  }
  // Prefer Constrained Baseline (42e0xx). Fall back to any H.264.
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

  // Append Google bandwidth hints to the first preferred H.264 fmtp line.
  if (preferred[0]) {
    const fi = lines.findIndex(l => l.startsWith(`a=fmtp:${preferred[0]} `));
    if (fi >= 0 && !/x-google-max-bitrate/.test(lines[fi])) {
      lines[fi] += `;x-google-min-bitrate=${Math.floor(maxKbps/2)};x-google-start-bitrate=${startKbps};x-google-max-bitrate=${maxKbps}`;
    }
  }

  // b=AS bandwidth line caps the m=video section (in kbps). Insert just after m=.
  if (!lines.slice(mIdx, mIdx + 4).some(l => l.startsWith('b=AS:'))) {
    lines.splice(mIdx + 1, 0, `b=AS:${maxKbps}`);
  }

  return lines.join('\r\n');
}

async function makeOffer() {
  if (!localStream) { log('no stream yet — click Start first'); return; }
  pc = new RTCPeerConnection({
    iceServers: [],            // LAN only — no STUN/TURN
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  });
  pc.onicecandidate = (e) => {
    if (e.candidate) ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate }));
  };
  pc.onconnectionstatechange = () => log('pc:', pc.connectionState);

  const p = new URLSearchParams(location.search);
  const fps   = Number(p.get('fps'))  || 30;
  const kbps  = Number(p.get('kbps')) || 8000;
  const start = Number(p.get('start')) || Math.floor(kbps * 0.75);

  for (const track of localStream.getTracks()) {
    if (track.kind === 'video') {
      // 'detail' = optimize for crisp text/UI (vs 'motion' which smears for video).
      track.contentHint = 'detail';
    }
    pc.addTrack(track, localStream);
  }

  // Configure the video sender BEFORE creating the offer so encodings apply on first frame.
  const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
  if (videoSender) {
    // degradationPreference must be set via transceiver in some browsers.
    const tx = pc.getTransceivers().find(t => t.sender === videoSender);
    if (tx) tx.direction = 'sendonly';
  }

  const offer = await pc.createOffer();
  offer.sdp = tuneSdp(offer.sdp, start, kbps);
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: 'offer', sdp: offer.sdp }));
  log('sent offer (H.264 baseline preferred, b=AS ' + kbps + ')');

  // After local description is set, the encoder exists — now we can set encodings.
  if (videoSender) {
    const params = videoSender.getParameters();
    params.encodings = params.encodings?.length ? params.encodings : [{}];
    params.encodings[0].maxBitrate = kbps * 1000;
    params.encodings[0].maxFramerate = fps;
    params.encodings[0].priority = 'high';
    params.encodings[0].networkPriority = 'high';
    // 'maintain-framerate' = drop resolution before dropping fps (keeps cursor smooth).
    params.degradationPreference = 'maintain-framerate';
    try { await videoSender.setParameters(params); log(`encoding: ${fps}fps, ${kbps}kbps max, maintain-framerate`); }
    catch (e) { log('setParameters failed:', e.message); }
  }
}

async function start() {
  try {
    const constraints = getCaptureConstraints();
    localStream = await navigator.mediaDevices.getDisplayMedia(constraints);
    preview.srcObject = localStream;
    localStream.getVideoTracks()[0].onended = () => stop();
    startBtn.disabled = true; stopBtn.disabled = false;
    log('capture started:', JSON.stringify(localStream.getVideoTracks()[0].getSettings()));
    connectSignaling();
  } catch (e) { log('start failed:', e.message); }
}

function stop() {
  localStream?.getTracks().forEach(t => t.stop());
  pc?.close(); ws?.close();
  localStream = null; pc = null; ws = null;
  preview.srcObject = null;
  startBtn.disabled = false; stopBtn.disabled = true;
  log('stopped');
}

startBtn.onclick = start;
stopBtn.onclick = stop;

// Capture constraints. Defaults tuned for low-latency usable extended monitor:
// 1600×1000 @ 30fps. Override via query string: ?w=1280&h=800&fps=60&kbps=6000.
function getCaptureConstraints() {
  const p = new URLSearchParams(location.search);
  const w = Number(p.get('w')) || 1600;
  const h = Number(p.get('h')) || 1000;
  const fps = Number(p.get('fps')) || 30;
  return {
    video: {
      displaySurface: 'monitor',
      width:  { ideal: w, max: w },
      height: { ideal: h, max: h },
      frameRate: { ideal: fps, max: fps },
      // Cursor should always be visible since we're using this as a monitor.
      cursor: 'always',
    },
    audio: false,
    // Surfaces a clean picker without "current tab" preselected.
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
  };
}
