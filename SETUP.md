# Setup Guide

Use your Tesla center screen as an extended Mac monitor — with touch control.
Works from **any network** (home Wi-Fi, hotspot, even Tesla LTE) thanks to a built-in Cloudflare Tunnel.

---

## One-time setup on your MacBook (~5 minutes)

```bash
# 1. Clone & install
cd ~
git clone https://github.com/DonZhong12252/tesla-monitor.git
cd tesla-monitor
npm install

# 2. Install Homebrew tools (if you don't have brew: https://brew.sh)
brew install cloudflared cliclick
brew install --cask betterdisplay

# 3. Create a virtual display in BetterDisplay
#    - Open BetterDisplay (menu bar icon)
#    - + New Virtual Screen, name it "Tesla", resolution 1600×1000
#    - System Settings → Displays → Arrangement → drag "Tesla" to where you want it
```

**Grant Accessibility permission** so touch control works:
- System Settings → Privacy & Security → Accessibility
- Add **Terminal** (or whatever app you launch `npm start` from)

---

## Every time you want to use it

### On your MacBook

```bash
cd ~/tesla-monitor
npm start
```

That's it. The script:
1. Starts the server
2. Spawns a Cloudflare Tunnel (gives you a public HTTPS URL)
3. Opens Chrome to the sender page automatically
4. Prints the Tesla URL in big yellow text

You'll see something like:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓  tesla-monitor is ready
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  On your Mac (Chrome should be opening):
    http://localhost:8080/sender
    → Click Start sharing → pick the BetterDisplay virtual screen

  On your Tesla (type this URL in the browser):
    https://random-words-here.trycloudflare.com/receiver
```

In the Chrome tab that opened:
- Click **Start sharing**
- Pick the BetterDisplay virtual screen "Tesla" from the macOS picker
- Click **Share**

### On your Tesla

1. **Park.** (Browser is disabled while driving.)
2. Tap **App Launcher → Browser**.
3. Type the URL from your Mac terminal (the yellow one) into the address bar.
4. Tap the **bookmark / star icon** to save it.
5. Tap the video once → goes fullscreen, auto-connects.

Drag any window onto the "Tesla" virtual display on your Mac — it appears on the Tesla. Tap on the Tesla — your Mac cursor moves and clicks.

---

## The URL changes each time

Cloudflare's free quick-tunnel gives you a random URL each session. You'll need to update the Tesla bookmark each time you start `npm start`. The URL is also saved to `.last-tunnel-url` in the repo so you can grab it easily.

### Want a permanent URL?

Get a free Cloudflare account + register a free `*.cfargotunnel.com` named tunnel. Setup is ~5 minutes, one-time. Let me know if you want this added.

---

## Daily flow

**Mac (one terminal command):**
```bash
cd ~/tesla-monitor && npm start
```

Then in the Chrome tab that opens → **Start sharing** → pick virtual display.

**Tesla:** park → browser → paste current URL → tap to fullscreen.

To stop: `Ctrl-C` in the terminal.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cloudflared not found` | `brew install cloudflared` |
| `cliclick not found` | `brew install cliclick` (touch control won't work without it) |
| `server failed to start` | Port 8080 might be taken. Edit `config.json` → change `"port"` to e.g. 8081 |
| Tesla says "site can't be reached" | Tunnel URL is stale. Check terminal output for current URL; restart with `npm start` if needed |
| Touch clicks land in wrong spot | Edit `config.json → display` so `offsetX/Y/width/height` match your virtual display's position (run `npm run detect-displays`) |
| Mac sender shows "⚠ touch disabled" | `cliclick` not installed or no Accessibility permission |
| Video is black on Tesla | Pick "MCU1/2" profile in the sender UI |
| Stream feels laggy | Try lower profile (1280×800 @ 30fps); the tunnel adds ~50ms vs LAN-direct |

## Tuning knobs (sender UI)

| Profile | Best for |
|---|---|
| MCU3 — 1600×1000 @ 30 (default) | most usage |
| MCU3 — 1920×1200 @ 30 | sharper text |
| MCU3 — 1600×1000 @ 60 (smooth) | smooth cursor / video |
| MCU1/2 — 1280×800 @ 30 | older Atom/Intel MCU |
| Highway (low bandwidth) | weak signal |

## What the components do

- `npm start` (runs `start.js`) — orchestrator that does everything
- `server.js` — Node WebSocket signaling + touch injection endpoint
- `cloudflared` (subprocess) — public HTTPS tunnel
- BetterDisplay virtual screen — the surface macOS treats as a second monitor
- `cliclick` — injects mouse events on the Mac when Tesla taps

## What changed from earlier versions

The original setup required the Tesla and Mac to be on the same LAN, which kept failing because of router client-isolation, mDNS not working on Tesla browsers, and HTTPS-only mode. The Cloudflare Tunnel approach skips all of that — Cloudflare gives you a real HTTPS URL that works from any network the Tesla can reach.
