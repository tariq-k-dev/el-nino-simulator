/**
 * Controls for the (e) bloom-halo conclusion. READ-ONLY.
 *
 * The halo measurement toggles `pins` between two frames captured ~500 ms apart.
 * The pulsing hotspot ring in both frames is a function of `uTime`, so it drifts
 * between them and its animation alone can produce a luminance delta at the
 * ring's radius. This harness captures TWO frames with pins OFF and the ring ON,
 * so any delta there is pure animation noise — the noise floor against which the
 * pin's own halo has to be judged.
 *
 *   node tests/e2e/globe-control.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const BASE = 'http://localhost:4197';
const OUT = '.cache/globe-control';

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

  await page.evaluate(() => window.__globe.setCamera([0, 1.15, 2.0]));
  await page.waitForTimeout(600);
  const pins = await page.evaluate(() => window.__globe.pins());
  const target = pins.find((p) => p.id === 'us-west' && p.facing && !p.behind) ?? pins.find((p) => p.facing);

  const radialDelta = (a, b) => {
    const out = [];
    for (let r = 0; r <= 100; r += 1) {
      let sa = 0;
      let sb = 0;
      for (let i = 0; i < 16; i += 1) {
        const th = (i / 16) * Math.PI * 2;
        const x = target.x + Math.cos(th) * r;
        const y = target.y + Math.sin(th) * r;
        sa += lum(px(a, x, y).r, px(a, x, y).g, px(a, x, y).b);
        sb += lum(px(b, x, y).r, px(b, x, y).g, px(b, x, y).b);
      }
      out.push({ r, delta: +((sa - sb) / 16).toFixed(1) });
    }
    return out;
  };

  // Control A: pins OFF both frames, ring ON both. Delta == animation noise.
  await page.evaluate(() => window.__globe.setLookFlags({ pins: false, hotspotRings: true, bloom: true }));
  await page.waitForTimeout(600);
  const c1 = await shoot('ctrl-ring-a');
  await page.waitForTimeout(500);
  const c2 = await shoot('ctrl-ring-b');
  const controlA = radialDelta(c1, c2);

  // Control B: same, but bloom OFF. Isolates whether bloom participates in the noise.
  await page.evaluate(() => window.__globe.setLookFlags({ bloom: false }));
  await page.waitForTimeout(600);
  const d1 = await shoot('ctrl-ring-nobloom-a');
  await page.waitForTimeout(500);
  const d2 = await shoot('ctrl-ring-nobloom-b');
  const controlB = radialDelta(d1, d2);

  await page.evaluate(() =>
    window.__globe.setLookFlags({ pins: true, hotspotRings: true, bloom: true }),
  );

  const summarise = (name, arr) => {
    const band = (lo, hi) => {
      const v = arr.filter((r) => r.r >= lo && r.r <= hi).map((r) => Math.abs(r.delta));
      return v.length ? +(Math.max(...v)).toFixed(1) : null;
    };
    return {
      name,
      maxAbs_0_12: band(0, 12),
      maxAbs_25_75: band(25, 75),
      maxAbs_all: band(0, 100),
      at30: arr.find((r) => r.r === 30)?.delta ?? null,
      at45: arr.find((r) => r.r === 45)?.delta ?? null,
      at60: arr.find((r) => r.r === 60)?.delta ?? null,
    };
  };

  const report = {
    pin: target.id,
    x: Math.round(target.x),
    y: Math.round(target.y),
    controlA_bloomOn: summarise('pins off, ring on, bloom on', controlA),
    controlB_bloomOff: summarise('pins off, ring on, bloom off', controlB),
    radialA: controlA,
    radialB: controlB,
  };

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, radialA: undefined, radialB: undefined }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
