/**
 * A2b follow-up — where does the "visible limb ~328.6 px" claim come from?
 *
 * The white-material fit puts the geometric edge at 325.66. The STATUS doc claims
 * the surface "stays bright out to +3". This measures the 50% edge on the LIT
 * surface under four layer states, so the gap is attributable rather than guessed.
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { PNG } from 'pngjs';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function decode(buf) {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

function bilinear(img, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (ix, iy) => {
    const cx = Math.min(img.width - 1, Math.max(0, ix));
    const cy = Math.min(img.height - 1, Math.max(0, iy));
    const o = (cy * img.width + cx) * 4;
    return lum(img.data[o], img.data[o + 1], img.data[o + 2]);
  };
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
    (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

/** Per-ray 50% crossing radius, plus the raw profile on one ray for reporting. */
function crossing(img, cx, cy, th, rGuess, span = 20) {
  const cos = Math.cos(th), sin = Math.sin(th);
  const step = 0.25;
  const samples = [];
  for (let r = rGuess - span; r <= rGuess + span + 1e-9; r += step) {
    samples.push({ r, luma: bilinear(img, cx + cos * r, cy + sin * r) });
  }
  const win = Math.round(2 / step);
  let bestIdx = -1, bestDrop = 0;
  for (let i = win; i < samples.length - win; i += 1) {
    const d = samples[i - win].luma - samples[i + win].luma;
    if (d > bestDrop) { bestDrop = d; bestIdx = i; }
  }
  if (bestIdx < 0 || bestDrop < 5) return { r: null, profile: samples };
  const rPeak = samples[bestIdx].r;
  const inner = (() => { let s = 0, n = 0; for (let k = 1; k <= 4; k++) { s += bilinear(img, cx + cos * (rPeak - k), cy + sin * (rPeak - k)); n++; } return s / n; })();
  const outer = (() => { let s = 0, n = 0; for (let k = 4; k <= 12; k++) { s += bilinear(img, cx + cos * (rPeak + k), cy + sin * (rPeak + k)); n++; } return s / n; })();
  const level = (inner + outer) / 2;
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i], b = samples[i + 1];
    if (a.luma >= level && b.luma < level) {
      const f = (level - a.luma) / (b.luma - a.luma);
      return { r: a.r + (b.r - a.r) * f, inner, outer, level, profile: samples };
    }
  }
  return { r: null, profile: samples };
}

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:4197/?debug');
await page.waitForFunction(() => !!window.__look && !!window.__globe, null, { timeout: 90_000 });
await page.evaluate(() => {
  const c = document.querySelector('#globe-canvas canvas');
  const chain = new Set(); let n = c;
  while (n) { chain.add(n); n = n.parentElement; }
  for (const el of document.querySelectorAll('body *')) { if (!chain.has(el)) el.style.visibility = 'hidden'; }
});
await page.evaluate(() => window.__look.setAzimuth(0));
await page.waitForTimeout(700);

await mkdir('.cache/limb', { recursive: true });

const STATES = {
  'all-on (approved look)': { atmosphere: true, pins: true, clouds: true, stars: false, rings: true },
  'atmosphere OFF, rest on': { atmosphere: false, pins: false, clouds: true, stars: false, rings: false },
  'everything OFF but bloom': { atmosphere: false, pins: false, clouds: false, stars: false, rings: false },
  'everything OFF incl. bloom': { atmosphere: false, pins: false, clouds: false, stars: false, rings: false, bloom: false },
  'white unlit (ground truth)': { atmosphere: false, pins: false, clouds: false, stars: false, rings: false, bloom: false },
};

const centre = await page.evaluate(() => window.__globe.project());
const hook = await page.evaluate(() => window.__globe.discRadiusPx());
const out = { hook: +hook.toFixed(3), centre, states: {} };

for (const [label, flags] of Object.entries(STATES)) {
  await page.evaluate((f) => window.__look.set(f), flags);
  const white = label.startsWith('white');
  if (white) await page.evaluate(() => window.__look.surfaceWhite(true));
  await page.waitForTimeout(500);
  const buf = await page.locator('#globe-canvas canvas').screenshot({ type: 'png' });
  const img = decode(buf);
  if (white) await page.evaluate(() => window.__look.surfaceWhite(false));

  // 16 rays, mean crossing.
  const radii = [];
  let refProfile = null;
  for (let i = 0; i < 16; i += 1) {
    const th = (i / 16) * Math.PI * 2;
    const c = crossing(img, centre.x, centre.y, th, hook, 20);
    if (c.r !== null) radii.push(c.r);
    if (i === 0) refProfile = c.profile.filter((s) => s.r >= hook - 8 && s.r <= hook + 12)
      .map((s) => ({ r: +(s.r - hook).toFixed(2), luma: +s.luma.toFixed(1) }));
  }
  const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
  out.states[label] = {
    rays: radii.length,
    meanCrossing: +mean.toFixed(3),
    minCrossing: +Math.min(...radii).toFixed(3),
    maxCrossing: +Math.max(...radii).toFixed(3),
    minusHook: +(mean - hook).toFixed(3),
    ray0Profile: refProfile,
  };
  console.log(`${label.padEnd(30)} mean=${mean.toFixed(3)}  delta_from_hook=${(mean - hook).toFixed(3)}  rays=${radii.length}`);
}

await writeFile('.cache/limb/edge-attribution.json', JSON.stringify(out, null, 2));
await browser.close();
