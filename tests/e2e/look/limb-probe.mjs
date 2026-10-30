/**
 * A2 — LIMB GROUND TRUTH probe.
 *
 * Measures the rendered limb four ways at once so the ~3 px gap can be explained
 * from numbers rather than assumed:
 *
 *   R_fit    — 360-ray sub-pixel circle fit of the unlit white disc (ground truth)
 *   hook     — __globe.discRadiusPx()
 *   tangent  — focal * R / sqrt(d^2 - R^2) from the live fov/distance
 *   naive    — focal * R / d
 *
 * Run against a `build:e2e` dist:  node tests/e2e/look/limb-probe.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '.cache/limb';
const BASE = 'http://localhost:4197';
const W = 1280;
const H = 800;

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function decode(buf) {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

function bilinear(img, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (ix, iy) => {
    const cx = Math.min(img.width - 1, Math.max(0, ix));
    const cy = Math.min(img.height - 1, Math.max(0, iy));
    const o = (cy * img.width + cx) * 4;
    return lum(img.data[o], img.data[o + 1], img.data[o + 2]);
  };
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
  const bot = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bot * fy;
}

/** Same definition as src/lib/look/helpers.ts edgeCrossing. */
function edgeCrossing(img, cx, cy, th, rGuess, span = 14, minDrop = 20) {
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const step = 0.25;
  const samples = [];
  for (let r = rGuess - span; r <= rGuess + span + 1e-9; r += step) {
    samples.push({ r, luma: bilinear(img, cx + cos * r, cy + sin * r) });
  }
  if (samples.length < 8) return null;
  const win = Math.round(2 / step);
  let bestIdx = -1;
  let bestDrop = 0;
  for (let i = win; i < samples.length - win; i += 1) {
    const drop = samples[i - win].luma - samples[i + win].luma;
    if (drop > bestDrop) {
      bestDrop = drop;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestDrop < minDrop) return null;
  const innerOf = (r) => {
    let s = 0;
    let n = 0;
    for (let k = 1; k <= 4; k += 1) {
      const rr = r - k;
      if (rr < 0) continue;
      s += bilinear(img, cx + cos * rr, cy + sin * rr);
      n += 1;
    }
    return n ? s / n : NaN;
  };
  const outerOf = (r) => {
    let s = 0;
    let n = 0;
    for (let k = 4; k <= 12; k += 1) {
      s += bilinear(img, cx + cos * (r + k), cy + sin * (r + k));
      n += 1;
    }
    return n ? s / n : NaN;
  };
  const rPeak = samples[bestIdx].r;
  const innerLevel = innerOf(rPeak);
  const outerLevel = outerOf(rPeak);
  if (!Number.isFinite(innerLevel) || !Number.isFinite(outerLevel)) return null;
  if (innerLevel - outerLevel < minDrop) return null;
  const level = (innerLevel + outerLevel) / 2;
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a.luma >= level && b.luma < level) {
      const denom = b.luma - a.luma;
      const f = Math.abs(denom) < 1e-9 ? 0 : (level - a.luma) / denom;
      return a.r + (b.r - a.r) * f;
    }
  }
  return null;
}

/** Kasa algebraic circle fit; same as helpers.fitCircle. */
function fitCircle(points) {
  const n = points.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (const [x, y] of points) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let Suu = 0, Svv = 0, Suv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const [x0, y0] of points) {
    const u = x0 - mx;
    const v = y0 - my;
    Suu += u * u;
    Svv += v * v;
    Suv += u * v;
    Suuu += u * u * u;
    Svvv += v * v * v;
    Suvv += u * v * v;
    Svuu += v * u * u;
  }
  const det = Suu * Svv - Suv * Suv;
  if (Math.abs(det) < 1e-9) return null;
  const rhs1 = 0.5 * (Suuu + Suvv);
  const rhs2 = 0.5 * (Svvv + Svuu);
  const uc = (rhs1 * Svv - rhs2 * Suv) / det;
  const vc = (rhs2 * Suu - rhs1 * Suv) / det;
  const cx = uc + mx;
  const cy = vc + my;
  let rSum = 0;
  for (const [x, y] of points) rSum += Math.hypot(x - cx, y - cy);
  const r = rSum / n;
  let sq = 0;
  for (const [x, y] of points) {
    const d = Math.hypot(x - cx, y - cy) - r;
    sq += d * d;
  }
  return { cx, cy, r, rms: Math.sqrt(sq / n), n };
}

async function measureAt(page, label) {
  await page.evaluate(() => window.__look.set({ atmosphere: false, pins: false, clouds: false, stars: false, rings: false }));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__look.surfaceWhite(true));
  await page.waitForTimeout(300);
  const buf = await page.locator('#globe-canvas canvas').screenshot({ type: 'png' });
  const img = decode(buf);
  await writeFile(path.join(OUT, `${label.replace(/\s+/g, '-')}.png`), buf);
  await page.evaluate(() => window.__look.surfaceWhite(false));
  await page.evaluate(() => window.__look.set({ atmosphere: true, pins: true, clouds: true, stars: true, rings: true }));
  await page.waitForTimeout(300);

  const centre = await page.evaluate(() => window.__globe.project());
  const hook = await page.evaluate(() => window.__globe.discRadiusPx());
  const geo = await page.evaluate(() => {
    const cam = window.__camera;
    const canvas = document.querySelector('#globe-canvas canvas');
    return {
      fov: cam.fov,
      height: canvas.clientHeight,
      width: canvas.clientWidth,
      d: window.__globe.distance(),
      R: 1,
    };
  });
  const focal = geo.height / 2 / Math.tan((geo.fov * Math.PI) / 180 / 2);
  const tangent = (focal * geo.R) / Math.sqrt(geo.d * geo.d - geo.R * geo.R);
  const naive = (focal * geo.R) / geo.d;

  const points = [];
  let misses = 0;
  for (let i = 0; i < 360; i += 1) {
    const th = (i / 360) * Math.PI * 2;
    const r = edgeCrossing(img, centre.x, centre.y, th, hook, 14);
    if (i === 0 || i === 90) {
    }
    if (r === null) {
      misses += 1;
      continue;
    }
    points.push([centre.x + Math.cos(th) * r, centre.y + Math.sin(th) * r]);
  }
  const fit = fitCircle(points);
  return {
    label,
    centre,
    hook: +hook.toFixed(3),
    fit: fit && { cx: +fit.cx.toFixed(3), cy: +fit.cy.toFixed(3), r: +fit.r.toFixed(3), rms: +fit.rms.toFixed(3), n: fit.n },
    tangent: +tangent.toFixed(3),
    naive: +naive.toFixed(3),
    focal: +focal.toFixed(3),
    d: +geo.d.toFixed(4),
    geometry: geo,
    misses,
    centreOffset: fit ? +Math.hypot(fit.cx - centre.x, fit.cy - centre.y).toFixed(3) : null,
    hookMinusFit: fit ? +(hook - fit.r).toFixed(3) : null,
    tangentMinusFit: fit ? +(tangent - fit.r).toFixed(3) : null,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(`${BASE}/?debug`);
  await page.waitForFunction(() => !!window.__look && !!window.__globe, null, { timeout: 90_000 });
  await page.evaluate(() => {
    const c = document.querySelector('#globe-canvas canvas');
    const chain = new Set();
    let n = c;
    while (n) {
      chain.add(n);
      n = n.parentElement;
    }
    for (const el of document.querySelectorAll('body *')) {
      if (chain.has(el)) continue;
      el.style.visibility = 'hidden';
    }
  });
  await page.evaluate(() => window.__look.setAzimuth(0));
  await page.waitForTimeout(600);

  const results = [];
  // Two captures for the stability assertion (R_fit within 0.2 px).
  results.push(await measureAt(page, '1280x800 run1'));
  results.push(await measureAt(page, '1280x800 run2'));

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(700);
  results.push(await measureAt(page, '1024x768 run1'));
  results.push(await measureAt(page, '1024x768 run2'));

  const report = { viewport: `${W}x${H}`, results, version: 1 };
  await writeFile(path.join(OUT, 'limb.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
