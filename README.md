# tesla-monitor

Use your Tesla's center screen as an **extended monitor** for a MacBook, over the car's browser app.

```
[ Mac apps ]
     │  (drag window onto BetterDisplay virtual screen)
     ▼
[ BetterDisplay virtual display ]
     │  (Chrome getDisplayMedia picks this screen)
     ▼
[ /sender page in Mac Chrome ]
     │  WebRTC, H.264, peer-to-peer over Wi-Fi
     ▼
[ /receiver page in Tesla browser ]   ← fullscreen <video>
```

## One-time setup

1. **BetterDisplay** (free) — install from <https://github.com/waydabber/BetterDisplay>. Create a *virtual screen* at e.g. 1920×1200. macOS will treat it as a real second monitor you can drag windows onto.
2. **Node 18+** — `node --version` to check.
3. Install deps:
   ```
   cd ~/tesla-monitor
   npm install
   ```

## Each session

1. **Mac hotspot**: System Settings → General → Sharing → Internet Sharing → enable. Note the network name & password.
2. In the Tesla: Controls → Wi-Fi → join your Mac's hotspot.
3. On the Mac, find your hotspot IP: `ipconfig getifaddr bridge100` (usually `192.168.2.1`).
4. Start the server:
   ```
   npm start
   ```
   It prints the LAN URLs it's reachable on.
5. **On the Mac**, open Chrome to <http://localhost:8080/sender> → click *Start sharing* → pick the BetterDisplay virtual screen from the OS picker.
6. **In the Tesla browser**, navigate to `http://<mac-ip>:8080/receiver` → tap *Connect* → tap *Fullscreen* (or tap the video).

You can now drag windows onto the virtual screen on your Mac — they show up on the Tesla.

## Notes / limitations

- **Park only.** Tesla disables the browser in Drive on most firmwares; this is a feature, not a bug.
- **One-way.** Touches on the Tesla screen are not forwarded back to the Mac (Tesla's browser does not expose pointer events to a remote host).
- **Codec.** The sender forces H.264 **Constrained Baseline** (`profile-level-id=42e0xx`) — no B-frames, no reorder delay, hardware-decoded on the MCU.
- **Tuning knobs** (query params on `/sender`): `w`, `h`, `fps`, `kbps`, `start`. Defaults: `1600×1000 @ 30fps`, `8000 kbps` max. Example for older MCU: `/sender?w=1280&h=800&fps=30&kbps=4000`. Example for buttery 60fps cursor on MCU3: `/sender?w=1600&h=1000&fps=60&kbps=12000`.
- **Receiver auto-connects** the moment you load `/receiver` — no button tap needed. Tap once anywhere on the video to trigger fullscreen (Tesla's browser requires a gesture).
- **Stats overlay** (bottom-right on Tesla) shows live fps / kbps / rtt / jitter / dropped frames. If `rtt` > 30ms or `jit` > 10ms, you're on 2.4GHz — fix that first.

## Low-latency checklist (do these or it won't feel like a monitor)

1. **Force the Mac hotspot to 5GHz.** macOS System Settings → General → Sharing → ⓘ next to *Internet Sharing* → set *"Wi-Fi Options" → Channel* to a 5GHz channel (36, 40, 149, etc.). The 2.4GHz default has 40–80ms of extra latency and constant jitter.
2. **Park near the Mac.** Tesla's Wi-Fi antenna is mediocre; 10ft line-of-sight is night-and-day vs 30ft through the car body.
3. **Close other tabs on the Mac.** Chrome shares one encoder thread; a YouTube tab in the background will stutter your stream.
4. **Use BetterDisplay's "Resolution" matching your stream**, not higher. Capturing a 4K virtual screen down to 1600×1000 costs encoder time. Set the virtual display to exactly 1600×1000 (or whatever you stream at).
5. **On MCU3 (Ryzen)** you can push `fps=60, kbps=12000` and it stays smooth. On MCU1/2 (Atom/Intel) cap at `fps=30, kbps=4000, w=1280, h=800`.

Expected end-to-end latency on a clean 5GHz LAN: **80–140ms**. Good enough for browsing, terminals, docs, video. Not good enough for twitch gaming or precise drawing.
- **No internet via hotspot?** That's fine — WebRTC connects directly over the LAN; no STUN/TURN needed.
- **HTTPS.** `getDisplayMedia` requires a secure context on the Mac side, but `http://localhost` qualifies as secure, so Chrome allows it. The Tesla side just plays video — `http://` is fine.

## Files

- `server.js` — static file server + WebSocket signaling broker
- `public/sender.html` + `sender.js` — Mac capture page
- `public/receiver.html` + `receiver.js` — Tesla playback page
