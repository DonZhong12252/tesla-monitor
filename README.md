# tesla-monitor

Use your Tesla's center screen as a **low-latency extended monitor** for your MacBook, with **touch control** — the in-car browser sends taps and drags back to your Mac as real mouse events.

```
[ Mac apps ]
     │ drag window onto BetterDisplay virtual screen
     ▼
[ Virtual display ]
     │ Chrome getDisplayMedia
     ▼
[ Mac /sender ]  ──── WebRTC video ────▶  [ Tesla /receiver ]   ◀── you tap the screen
       │                                          │
       │           ◀── /api/inject ◀── WebRTC DataChannel ───────┘
       ▼
[ cliclick → real mouse events on Mac ]

       (Cloudflare Tunnel gives the Tesla a public HTTPS URL to reach the Mac
        from any network — home Wi-Fi, hotspot, or Tesla LTE.)
```

## Quick start

```bash
git clone https://github.com/DonZhong12252/tesla-monitor.git
cd tesla-monitor
npm install
brew install cloudflared cliclick
brew install --cask betterdisplay
npm start
```

That single `npm start` does everything: launches the server, opens a Cloudflare HTTPS tunnel, opens your browser to the sender, and prints the Tesla URL.

**→ See [SETUP.md](./SETUP.md) for full step-by-step setup (Mac + Tesla).**

## Features

- **Cloudflare Tunnel** — public HTTPS URL, no router config, works from any network
- **WebRTC H.264 Baseline** — no B-frames, ~150ms end-to-end through the tunnel
- **Touch control** — tap, drag, click on Tesla → real mouse events on Mac (via `cliclick`)
- **One-command launch** — `npm start` spawns server + tunnel + opens browser
- **Profiles** — built-in presets for MCU1/2, MCU3, highway; save your own
- **PIN auth** — optional, set in `config.json`
- **Auto-reconnect** + live stats overlay (fps / kbps / rtt / jitter / drops)

## Files

- `start.js` — one-command launcher (server + tunnel + browser)
- `server.js` — Node WebSocket signaling + `/api/inject` endpoint
- `config.json` — PIN, port, display offset for touch coords
- `public/sender.{html,js}` — Mac-side capture, profiles, touch forwarding
- `public/receiver.{html,js}` — Tesla-side playback, touch capture, stats
- `scripts/install-launchd.js` — install/uninstall macOS LaunchAgent
- `scripts/detect-displays.js` — print display geometry for `config.json`

## Notes

- **Park only.** Tesla disables the browser in Drive on most firmware.
- **Tunnel URL changes each session** (free tier). Permanent URL needs a free Cloudflare account + named tunnel.
- **Touch is mouse, not multitouch.** Tap = click, drag = mouse drag. No pinch/scroll wheel yet.
- **Latency** is ~80-140ms on clean LAN, ~150-250ms through the tunnel.
