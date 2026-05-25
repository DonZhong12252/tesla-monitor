# Setup Guide

Complete setup for both the Mac (sender) and the Tesla (receiver).

---

## Part 1 — Mac setup (one-time, ~10 minutes)

### 1. Install dependencies

```bash
# Clone the repo
gh repo clone DonZhong12252/tesla-monitor
# or: git clone https://github.com/DonZhong12252/tesla-monitor.git

cd tesla-monitor
npm install

# Required Homebrew tools
brew install cliclick                  # for touch control (Tesla → Mac input)
brew install --cask betterdisplay      # for virtual extended display
```

### 2. Create a virtual display in BetterDisplay

1. Open **BetterDisplay** from Applications (it lives in the menu bar).
2. Menu bar icon → **+ New Virtual Screen** → name it "Tesla".
3. Set resolution to **1600×1000** (matches the default profile). You can change later.
4. Open **System Settings → Displays → Arrangement** — drag the new "Tesla" virtual display to wherever you want it relative to your main display (e.g. to the right).

### 3. Find your virtual display's position

The Mac needs to know where the virtual display sits in macOS global coordinate space so touch events land in the right pixels.

```bash
npm run detect-displays
```

This prints all your displays. Identify the virtual one (its name will match what you set in BetterDisplay).

- The **main display's** top-left is always `(0, 0)`.
- A display to the **right** of a 1920×1200 main has `offsetX = 1920`, `offsetY = 0`.
- A display **above** the main has `offsetX = 0`, `offsetY = -<that display's height>`.

For exact pixel-perfect coords, install `displayplacer` and run it:

```bash
brew install jakehilborn/jakehilborn/displayplacer
displayplacer list
```

Look for `origin:(x,y)` on the virtual display.

### 4. Edit `config.json`

```jsonc
{
  "pin": "",                    // optional — set any string to require PIN auth
  "hostname": "tesla-monitor",  // mDNS name → http://tesla-monitor.local:8080
  "port": 8080,
  "display": {
    "offsetX": 1920,            // ← from step 3
    "offsetY": 0,
    "width": 1600,              // ← match the virtual display resolution
    "height": 1000
  },
  "touch": {
    "enabled": true,
    "moveThrottleHz": 60
  }
}
```

### 5. Grant Accessibility permission

`cliclick` (the tool that injects mouse events) needs Accessibility access.

1. **System Settings → Privacy & Security → Accessibility**.
2. Click **+** and add:
   - **Terminal** (or **iTerm**, **Warp**, whatever you launch `npm start` from), OR
   - **Node.js** (if you use the launchd auto-start in step 7).
3. Make sure the toggle is **ON**.

First time you tap on the Tesla, macOS may pop up a permission dialog — accept it.

### 6. (Optional) Set up Mac hotspot for in-car use

If you'll use this in the car (not just parked at home on Wi-Fi):

1. **System Settings → General → Sharing → Internet Sharing**.
2. **Share connection from:** anything that's not Wi-Fi (Ethernet, Thunderbolt, iPhone USB). If your Mac only has Wi-Fi, you can't hotspot — you'll need to use the car's home Wi-Fi instead.
3. **To computers using:** Wi-Fi → check the box.
4. Click **Wi-Fi Options…**:
   - Network name: anything (e.g. `mac-hotspot`)
   - **Channel: pick a 5GHz channel (36, 40, 149, 153, etc.)** — this is critical. 2.4GHz adds 40–80ms latency and constant jitter.
   - Security: WPA2/WPA3 Personal, set a password.
5. Toggle **Internet Sharing** ON.

### 7. (Optional) Auto-start on login

```bash
npm run install-launchd
```

Now the server runs on every login and respawns automatically if it crashes. Logs go to `tesla-monitor.log` in the repo folder. To remove: `npm run uninstall-launchd`.

### 8. Start the server (if not auto-starting)

```bash
npm start
```

You should see:

```
tesla-monitor v0.2 on :8080
pin: (none — set in config.json)
touch: enabled
Sender (open on Mac):  http://localhost:8080/sender
Receiver (Tesla):      http://tesla-monitor.local:8080/receiver
Fallback LAN URLs:
  en0: http://192.168.4.161:8080
  bridge100: http://192.168.2.1:8080
mDNS: published as http://tesla-monitor.local:8080
```

### 9. Open the sender in Chrome

1. **Chrome on the Mac** → <http://localhost:8080/sender>
2. Pick a profile (default `MCU3 — 1600×1000 @ 30` is a good start).
3. Click **Start sharing**.
4. macOS picker appears → pick the **BetterDisplay virtual screen** (the one you named "Tesla").
5. Click **Share**.

Leave this tab open — closing it kills the stream.

---

## Part 2 — Tesla setup (one-time, ~30 seconds)

### 1. Park the car

The browser is disabled while driving on most firmware.

### 2. Join the network

**Controls → Wi-Fi** → tap your Mac's hotspot (or your home Wi-Fi if at home) → enter password. The Tesla remembers it.

### 3. Open the browser

Tap the app launcher at the bottom of the screen (icon grid) → tap **Browser**.

### 4. Navigate to the receiver

In the address bar, type:

```
http://tesla-monitor.local:8080/receiver
```

Tap **Go**.

> **If `tesla-monitor.local` doesn't resolve** (some MCU1/older browsers don't do mDNS), use the Mac's hotspot IP instead. On the Mac, run `ipconfig getifaddr bridge100` to get the IP (usually `192.168.2.1`). Then on Tesla, use `http://192.168.2.1:8080/receiver`. The hotspot IP is stable across reboots.

### 5. Bookmark it

Tap the **star / bookmark icon** in the address bar. Now it's one tap to open every time.

### 6. Tap once to fullscreen

The first tap on the video triggers fullscreen (Chromium requires a user gesture — can't auto-fullscreen). After that, the receiver:

- Auto-connects to the Mac sender
- Shows live stats (bottom-right): `fps / kbps / rtt / jitter / dropped`
- Sends every tap/drag back to the Mac as a real mouse event

### 7. (If PIN is set) Enter PIN once

If you set a PIN in `config.json`, the Tesla shows a numeric input on first load. Enter it — it's saved in browser storage and won't ask again unless you clear data.

---

## Part 3 — Daily use (once setup is done)

### Mac side

1. Hotspot is on (auto on login if you enabled it in System Settings).
2. Server is running (auto on login if you ran `install-launchd`).
3. Open <http://localhost:8080/sender> in Chrome → **Start sharing** → pick virtual display.

### Tesla side

1. Park, join hotspot if not already joined.
2. Tap browser bookmark → tap video for fullscreen.
3. Drag windows onto the virtual display on your Mac — they appear on the Tesla. Tap on the Tesla — your Mac cursor moves and clicks.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Tesla shows "connecting…" forever | Mac sender tab not open, or different Wi-Fi | Open `/sender` on Mac, confirm both devices on same network |
| `tesla-monitor.local` doesn't load | Tesla MCU doesn't support mDNS | Use IP fallback (`ipconfig getifaddr bridge100`) |
| Video is black on Tesla | H.264 profile too high for MCU | Switch to "MCU1/2" profile in sender UI |
| Choppy / high `rtt` in stats | On 2.4GHz hotspot | Force 5GHz in System Settings → Sharing → Wi-Fi Options |
| Touch does nothing | `cliclick` not installed or no Accessibility permission | `brew install cliclick`; add Terminal to Accessibility |
| Touch clicks land in wrong spot | `display.offsetX/Y/width/height` wrong in `config.json` | Re-run `npm run detect-displays`, verify with `displayplacer list` |
| Mac sender shows "⚠ touch disabled" | Server didn't find `cliclick` on PATH | Restart `npm start` after `brew install cliclick`; if using launchd, the plist's PATH includes `/opt/homebrew/bin` so it should work after reinstall |
| Stream cuts out when Tesla switches to nav | Tesla suspends background browser tabs | Auto-reconnects when you switch back (1.5s) |
| "bad PIN" on Tesla | Stale saved PIN | Tap the input area, retype |

## Performance expectations

On a **5GHz LAN, MCU3, line-of-sight**:
- End-to-end latency: **80–140ms** (sub-frame at 30fps)
- Touch round-trip: **30–60ms** (tap → Mac cursor moves)
- Bandwidth: **4–8 Mbps** at 1600×1000 @ 30fps

On **2.4GHz or weak signal**:
- Latency: **200–400ms**, visible cursor lag
- Frequent jitter spikes, dropped frames

If your stats overlay shows `rtt > 30ms` or `jit > 10ms`, **the network is the problem, not the code**. Fix that first.
