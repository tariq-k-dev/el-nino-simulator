/**
 * Two focused read-only probes for CLOSE-A (d) and (e).
 *
 * 1. Pin core RGB, not just luminance. Luminance is channel-blind: an amber core
 *    (255,255,140) and a pure white one (255,255,255) differ by 3 luminance
 *    points but by 115 in channel spread, so "flat pure-white blob" can only be
 *    decided from RGB.
 *
 * 2. Bloom halo around a pin with the pulsing ring HELD CONSTANT. The previous
 *    pass toggled pins and rings together, so the measured delta out to 80 px
 *    conflated the ring's own additive glow with the pin's bloom.
 *
 *   node tests/e2e/globe-probe2.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const BASE = 'http://localhost:4197';
const OUT = '.cache/globe-probe2';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const decode = (buf) => {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
};
function px(img, x, y) {
  const ix = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const o = (iy * img.width + ix) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2] };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/?debug`);
  await page.waitForFunction(() => !!window.__globe, null, { timeout: 90_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const canvas = document.querySelector('#globe-canvas canvas');
    const chain = new Set();
    let n = canvas;
    while (n) {
      chain.add(n);
      n = n.parentElement;
    }
    for (const el of document.querySelectorAll('body *')) if (!chain.has(el)) el.style.visibility = 'hidden';
  });
  await page.evaluate(() => window.__globe.setLookFlags({ stars: false }));

  const shoot = async (name) => {
    const buf = await page.screenshot({ type: 'png' });
    await writeFile(path.join(OUT, `${name}.png`), buf);
    return decode(buf);
  };

  const report = {};

  // ---------------------------------------------------------- (d) pin core RGB ---
  const coreStats = (img, cx, cy, r) => {
    let n = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let smin = 0;
    let smax = 0;
    let lsum = 0;
    let lmax = 0;
    let white = 0;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
        const p = px(img, x, y);
        sr += p.r;
        sg += p.g;
        sb += p.b;
        const sp = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
        smin += sp;
        smax = Math.max(smax, sp);
        const l = lum(p.r, p.g, p.b);
        lsum += l;
        lmax = Math.max(lmax, l);
        if (p.r >= 245 && p.g >= 245 && p.b >= 245) white += 1;
        n += 1;
      }
    }
    return {
      n,
      meanRGB: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)],
      meanLum: +(lsum / n).toFixed(1),
      maxLum: +lmax.toFixed(1),
      meanSpread: +(smin / n).toFixed(1),
      maxSpread: smax,
      pureWhiteShare: +(white / n).toFixed(3),
    };
  };

  // Day side: California pin, zoomed to min distance.
  await page.evaluate(() => window.__globe.setCamera([0, 1.15, 1.25]));
  await page.waitForTimeout(700);
  let img = await shoot('day-zoom');
  let pins = await page.evaluate(() => window.__globe.pins());
  const cal = pins.find((p) => p.id === 'us-west');
  report.day = {
    camera: [0, 1.15, 1.25],
    discRadiusPx: +(await page.evaluate(() => window.__globe.discRadiusPx())).toFixed(1),
    pin: cal,
    atMinZoom: cal && !cal.behind ? coreStats(img, cal.x, cal.y, 6) : null,
  };

  // Same pin at the default distance, where the core is a normal size.
  await page.evaluate(() => window.__globe.setCamera([0, 1.15, 3.15]));
  await page.waitForTimeout(600);
  img = await shoot('day-default');
  pins = await page.evaluate(() => window.__globe.pins());
  const cal2 = pins.find((p) => p.id === 'us-west');
  report.dayDefault = {
    camera: [0, 1.15, 3.15],
    pin: cal2,
    core: cal2 && !cal2.behind ? coreStats(img, cal2.x, cal2.y, 4) : null,
  };

  // Night side: anti-sun camera.
  const sun = [0.72, 0.36, 0.59];
  const len = Math.hypot(...sun);
  const d = 2.55;
  const nightCam = [(-sun[0] / len) * d, (-sun[1] / len) * d + 0.35, (-sun[2] / len) * d];
  await page.evaluate((c) => window.__globe.setCamera(c), nightCam);
  await page.waitForTimeout(700);
  img = await shoot('night-zoom');
  pins = await page.evaluate(() => window.__globe.pins());
  report.night = { camera: nightCam, perPin: [] };
  for (const p of pins.filter((q) => q.facing && !q.behind)) {
    report.night.perPin.push({ id: p.id, core: coreStats(img, p.x, p.y, 5) });
  }

  // A night-side close-up crop for the reviewer.
  const aPin = pins.find((q) => q.facing && !q.behind);
  report.nightPin = aPin;

  // -------------------------------------------- (e) pin-only bloom halo width ---
  /*
   * Ring held ON in both frames and only `pins` toggled, so the delta is the pin
   * itself: core + housing + whatever bloom it produced. If the delta is still
   * above 1/255 at 30-60 px, bloom is smearing the pin wider than the STEP 2c
   * ring-luminance check radius.
   */
  await page.evaluate(() => window.__globe.setCamera([0, 1.15, 2.0]));
  await page.waitForTimeout(600);
  pins = await page.evaluate(() => window.__globe.pins());
  const target = pins.find((p) => p.id === 'us-west' && p.facing && !p.behind) ?? pins.find((p) => p.facing);

  await page.evaluate(() => window.__globe.setLookFlags({ pins: true, hotspotRings: true }));
  await page.waitForTimeout(500);
  const on = await shoot('halo-on');
  await page.evaluate(() => window.__globe.setLookFlags({ pins: false, hotspotRings: true }));
  await page.waitForTimeout(500);
  const off = await shoot('halo-off');
  await page.evaluate(() => window.__globe.setLookFlags({ pins: true, hotspotRings: true }));

  const radial = [];
  for (let r = 0; r <= 100; r += 1) {
    let so = 0;
    let sf = 0;
    for (let a = 0; a < 16; a += 1) {
      const th = (a / 16) * Math.PI * 2;
      const x = target.x + Math.cos(th) * r;
      const y = target.y + Math.sin(th) * r;
      so += lum(px(on, x, y).r, px(on, x, y).g, px(on, x, y).b);
      sf += lum(px(off, x, y).r, px(off, x, y).g, px(off, x, y).b);
    }
    radial.push({
      r,
      on: +(so / 16).toFixed(1),
      off: +(sf / 16).toFixed(1),
      delta: +((so - sf) / 16).toFixed(1),
    });
  }
  // Width where the pin's own contribution is still measurable.
  const lastAbove = (t) => {
    let w = 0;
    for (const row of radial) if (row.delta >= t) w = row.r;
    return w;
  };
  report.halo = {
    pin: target.id,
    x: Math.round(target.x),
    y: Math.round(target.y),
    ringsHeldOn: true,
    radial,
    widthDelta_1: lastAbove(1),
    widthDelta_2: lastAbove(2),
    widthDelta_5: lastAbove(5),
    at30: radial.find((r) => r.r === 30)?.delta ?? null,
    at45: radial.find((r) => r.r === 45)?.delta ?? null,
    at60: radial.find((r) => r.r === 60)?.delta ?? null,
    at80: radial.find((r) => r.r === 80)?.delta ?? null,
    maxDelta: Math.max(...radial.map((r) => r.delta)),
  };

  // Bloom off, same comparison: isolates bloom's share of the halo.
  await page.evaluate(() => window.__globe.setLookFlags({ bloom: false }));
  await page.waitForTimeout(600);
  const onNoBloom = await shoot('halo-on-nobloom');
  await page.evaluate(() => window.__globe.setLookFlags({ pins: false }));
  await page.waitForTimeout(500);
  const offNoBloom = await shoot('halo-off-nobloom');
  await page.evaluate(() => window.__globe.setLookFlags({ pins: true, bloom: true }));

  const radialNoBloom = [];
  for (let r = 0; r <= 100; r += 1) {
    let so = 0;
    let sf = 0;
    for (let a = 0; a < 16; a += 1) {
      const th = (a / 16) * Math.PI * 2;
      const x = target.x + Math.cos(th) * r;
      const y = target.y + Math.sin(th) * r;
      so += lum(px(onNoBloom, x, y).r, px(onNoBloom, x, y).g, px(onNoBloom, x, y).b);
      sf += lum(px(offNoBloom, x, y).r, px(offNoBloom, x, y).g, px(offNoBloom, x, y).b);
    }
    radialNoBloom.push({ r, delta: +((so - sf) / 16).toFixed(1) });
  }
  const lastNoBloom = (t) => {
    let w = 0;
    for (const row of radialNoBloom) if (row.delta >= t) w = row.r;
    return w;
  };
  report.haloNoBloom = {
    radial: radialNoBloom,
    widthDelta_1: lastNoBloom(1),
    widthDelta_2: lastNoBloom(2),
    at30: radialNoBloom.find((r) => r.r === 30)?.delta ?? null,
    at45: radialNoBloom.find((r) => r.r === 45)?.delta ?? null,
    at60: radialNoBloom.find((r) => r.r === 60)?.delta ?? null,
    maxDelta: Math.max(...radialNoBloom.map((r) => r.delta)),
  };

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
