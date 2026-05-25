#!/usr/bin/env node
// Prints macOS display geometry so you can fill in config.json → display.
// Uses system_profiler (always present) and falls back to a simple AppleScript probe.

import { spawnSync } from 'node:child_process';

const out = spawnSync('system_profiler', ['SPDisplaysDataType', '-json'], { encoding: 'utf8' });
if (out.status !== 0) {
  console.error('system_profiler failed:', out.stderr); process.exit(1);
}
const data = JSON.parse(out.stdout);
const gpus = data.SPDisplaysDataType || [];
const rows = [];
for (const gpu of gpus) {
  for (const d of gpu.spdisplays_ndrvs || []) {
    rows.push({
      name: d._name,
      resolution: d._spdisplays_resolution || d.spdisplays_resolution || '?',
      pixels: d._spdisplays_pixels || '?',
      main: d.spdisplays_main === 'spdisplays_yes',
      mirror: d.spdisplays_mirror || 'off',
    });
  }
}
console.log('\nDetected displays:\n');
for (const r of rows) {
  console.log(`  ${r.main ? '★ main' : '  '}  ${r.name.padEnd(24)} ${r.resolution}  pixels=${r.pixels}  mirror=${r.mirror}`);
}
console.log(`
Notes for config.json → display:
  • offsetX / offsetY = top-left of the virtual display in macOS global coordinates.
    The MAIN display's top-left is always (0, 0). Other displays sit to its left
    (negative X) or right (positive X = width of main).
  • width / height = the virtual display's native resolution (pixels above).

If the virtual display is to the RIGHT of your main 1920×1200 screen at the same
height, use: { "offsetX": 1920, "offsetY": 0, "width": <virtW>, "height": <virtH> }

For exact arrangement, install displayplacer (brew install jakehilborn/jakehilborn/displayplacer)
and run: displayplacer list
`);
