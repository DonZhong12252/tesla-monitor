# tesla-monitor

Use your Tesla's center screen as a **low-latency extended monitor** for your MacBook, with **touch control** — the in-car browser sends taps and drags back to your Mac as real mouse events.

```
[ Mac apps ]
     │ drag window onto BetterDisplay virtual screen
     ▼
[ Virtual display ]
     │ Chrome getDisplayMedia
     ▼
[ Mac /sender ]  ─── WebRTC video ──▶  [ Tesla /receiver ]   ◀── you tap the screen
                                                │
[ cliclick ] ◀── /api/inject ◀── WebRTC DataChannel ─────────┘
```

## Features

- **WebRTC H.264 Baseline** — no B-frames, ~80–140ms end-to-end on clean 5GHz LAN.
- **Touch control** — tap, drag, click anywhere on Tesla screen → injected as mouse events on Mac.
- **mDNS** — Tesla connects to `http://tesla-monitor.local:8080/receiver`. No IP memorization.
- **Profiles** — built-in presets for MCU1/2, MCU3, highway; save your own.
- **PIN auth** — optional 4-digit PIN gates the signaling server.
- **Auto-start on login** — launchd LaunchAgent.
- **Auto-reconnect** + live stats overlay (fps / kbps / rtt / jitter / drops).

## 📖 Full setup guide

**→ See [SETUP.md](./SETUP.md) for the complete step-by-step setup for both Mac and Tesla.**

## Quick setup (TL;DR)

```bash
# 1. Clone & install deps
gh repo clone DonZhong12252/tesla-monitor   # or: git clone https://github.com/DonZhong12252/tesla-monitor.git
cd tesla-monitor
npm install

# 2. Install required Homebrew tools
brew install cliclick                       # required for touch control
brew install --cask betterdisplay           # required for virtual extended display

# 3. Create a virtual screen in BetterDisplay (e.g. 1600×1000) and drag it
#    into your desired position in System Settings → Displays → Arrangement.

# 4. Detect display geometry and edit config.json
npm run detect-displays
# Set display.offsetX / offsetY / width / height in config.json to match
# the BetterDisplay virtual screen's position in macOS global coordinates.

# 5. (Optional) Set a PIN in config.json.

# 6. (Optional) Auto-start on login:
npm run install-launchd                     # uninstall: npm run uninstall-launchd
```

Grant **Accessibility** permission when prompted — `cliclick` needs it to inject mouse events. System Settings → Privacy & Security → Accessibility → add Terminal (or whatever launched `node`).

## Each session

1. **Mac hotspot**: System Settings → General → Sharing → Internet Sharing → enable. **Force 5GHz** under "Wi-Fi Options" → Channel (36 / 40 / 149 / etc). 2.4GHz adds 40–80ms.
2. **In the Tesla**: Controls → Wi-Fi → join the hotspot.
3. **On the Mac**: `npm start` (skip if you installed the LaunchAgent).
4. **Mac browser**: open <http://localhost:8080/sender> → pick profile → click *Start sharing* → pick the BetterDisplay virtual screen.
5. **Tesla browser**: navigate to <http://tesla-monitor.local:8080/receiver> → it auto-connects → tap once for fullscreen.

Now drag windows onto the virtual screen — they appear on the Tesla. Tap on the Tesla — your Mac cursor moves and clicks.

## Tuning knobs (sender UI)

| Profile | W × H | fps | kbps | Best for |
|---|---|---|---|---|
| MCU3 — 1600×1000 @ 30 (default) | 1600×1000 | 30 | 8000 | most usage |
| MCU3 — 1920×1200 @ 30 | 1920×1200 | 30 | 10000 | sharper text |
| MCU3 — 1600×1000 @ 60 (smooth) | 1600×1000 | 60 | 12000 | smooth cursor / video |
| MCU1/2 — 1280×800 @ 30 | 1280×800 | 30 | 4000 | older Atom/Intel MCU |
| Highway (low bandwidth) | 1280×800 | 20 | 2500 | weak signal |

Save your own profile via "Save current as…".

## Touch coordinate setup

`config.json → display` tells the server where the BetterDisplay virtual screen sits in macOS global coordinate space. The main display's top-left is `(0,0)`. If your virtual display is to the right of a 1920×1200 main screen:

```json
"display": { "offsetX": 1920, "offsetY": 0, "width": 1600, "height": 1000 }
```

For exact arrangement: `brew install jakehilborn/jakehilborn/displayplacer && displayplacer list`.

## Files

- `server.js` — static files + WS signaling + `/api/inject` + Bonjour
- `config.json` — PIN, port, display offset, touch settings
- `public/sender.{html,js}` — Mac capture, profiles, touch forwarding
- `public/receiver.{html,js}` — Tesla playback, touch capture, stats
- `scripts/install-launchd.js` — install/uninstall LaunchAgent
- `scripts/detect-displays.js` — print display geometry

## Notes / limitations

- **Park only.** Tesla disables the browser in Drive on most firmware.
- **One-way audio omitted.** macOS doesn't expose system audio without a virtual driver (BlackHole). Out of scope.
- **Touch is mouse, not multitouch.** Single-finger tap = click, single-finger drag = mouse drag. No pinch-to-zoom, no scroll wheel.
- **MCU compatibility.** H.264 Baseline works on all known Tesla MCUs (Atom, Intel, Ryzen). If video is black, drop to the `MCU1/2` profile.
