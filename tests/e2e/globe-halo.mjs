/**
 * Final, noise-free bloom-halo measurement. READ-ONLY.
 *
 * The earlier passes were contaminated: the hotspot ring pulses on `uTime`, and a
 * control run (two frames with pins OFF) measured an animation floor of up to
 * 66 luminance units in the 0-12 px band and 26 in 25-75 px — larger than the
 * pin's own contribution. Any "halo width" quoted from those frames was really
 * the ring's animation.
 *
 * So this pass removes every animated layer before measuring:
 *   rings OFF, atmosphere OFF (its `breathe` term is a sine of uTime),
 *   stars OFF, clouds left in but static.
 * The ONLY difference between the two frames is the pin itself, so the delta is
 * unambiguous: pin geometry + whatever bloom it generates.
 *
 * Run once with bloom ON and once with bloom OFF; the difference between those
 * two results is bloom's share.
 *
 *   node tests/e2e/globe-halo.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const BASE = 'http://localhost:4197';
const OUT = '.cache/globe-halo';

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

  const shoot = async (name) => {
    const buf = await page.screenshot({ type: 'png' });
    await writeFile(path.join(OUT, `${name}.png`), buf);
    return decode(buf);
  };

  // Static scene: nothing that animates.
  await page.evaluate(() =>
    window.__globe.setLookFlags({
      stars: false,
      hotspotRings: false,
      atmosphere: false,
    }),
  );
  await page.evaluate(() => window.__globe.setCamera([0, 1.15, 2.0]));
  await page.waitForTimeout(800);

  const pins = await page.evaluate(() => window.__globe.pins());
  const target =
    pins.find((p) => p.id === 'us-west' && p.facing && !p.behind) ??
    pins.find((p) => p.facing && !p.behind);
  if (!target) throw new Error('no facing pin');

  const radialDelta = (a, b, radii) => {
    const out = [];
    for (const r of radii) {
      let sa = 0;
      let sb = 0;
      for (let i = 0; i < 24; i += 1) {
        const th = (i / 24) * Math.PI * 2;
        const x = target.x + Math.cos(th) * r;
        const y = target.y + Math.sin(th) * r;
        sa += lum(px(a, x, y).r, px(a, x, y).g, px(a, x, y).b);
        sb += lum(px(b, x, y).r, px(b, x, y).g, px(b, x, y).b);
      }
      out.push({ r, delta: +((sa - sb) / 24).toFixed(2) });
    }
    return out;
  };

  // Noise control: two frames, nothing changed at all.
  const n1 = await shoot('noise-a');
  await page.waitForTimeout(500);
  const n2 = await shoot('noise-b');
  const radii = Array.from({ length: 101 }, (_, i) => i);
  const noise = radialDelta(n1, n2, radii);

  // Pin ON vs OFF, bloom ON.
  await page.evaluate(() => window.__globe.setLookFlags({ pins: true, bloom: true }));
  await page.waitForTimeout(500);
  const onBloom = await shoot('pin-on-bloom');
  await page.evaluate(() => window.__globe.setLookFlags({ pins: false, bloom: true }));
  await page.waitForTimeout(500);
  const offBloom = await shoot('pin-off-bloom');
  const withBloom = radialDelta(onBloom, offBloom, radii);

  // Pin ON vs OFF, bloom OFF.
  await page.evaluate(() => window.__globe.setLookFlags({ pins: true, bloom: false }));
  await page.waitForTimeout(500);
  const onNoBloom = await shoot('pin-on-nobloom');
  await page.evaluate(() => window.__globe.setLookFlags({ pins: false, bloom: false }));
  await page.waitForTimeout(500);
  const offNoBloom = await shoot('pin-off-nobloom');
  const withoutBloom = radialDelta(onNoBloom, offNoBloom, radii);

  const maxAbs = (arr, lo, hi) => {
    const v = arr.filter((x) => x.r >= lo && x.r <= hi).map((x) => Math.abs(x.delta));
    return v.length ? +Math.max(...v).toFixed(2) : null;
  };
  const lastAbove = (arr, t) => {
    let w = 0;
    for (const row of arr) if (row.delta >= t) w = row.r;
    return w;
  };

  const report = {
    pin: target.id,
    x: Math.round(target.x),
    y: Math.round(target.y),
    scene: { rings: false, atmosphere: false, stars: false, camera: [0, 1.15, 2.0] },
    noise: {
      maxAbs_0_12: maxAbs(noise, 0, 12),
      maxAbs_25_75: maxAbs(noise, 25, 75),
      maxAbs_all: maxAbs(noise, 0, 100),
      radial: noise,
    },
    withBloom: {
      maxAbs_0_12: maxAbs(withBloom, 0, 12),
      maxAbs_25_75: maxAbs(withBloom, 25, 75),
      lastRadiusAbove_1: lastAbove(withBloom, 1),
      lastRadiusAbove_3: lastAbove(withBloom, 3),
      at30: withBloom.find((x) => x.r === 30)?.delta ?? null,
      at45: withBloom.find((x) => x.r === 45)?.delta ?? null,
      at60: withBloom.find((x) => x.r === 60)?.delta ?? null,
      at80: withBloom.find((x) => x.r === 80)?.delta ?? null,
      radial: withBloom,
    },
    withoutBloom: {
      maxAbs_0_12: maxAbs(withoutBloom, 0, 12),
      maxAbs_25_75: maxAbs(withoutBloom, 25, 75),
      lastRadiusAbove_1: lastAbove(withoutBloom, 1),
      lastRadiusAbove_3: lastAbove(withoutBloom, 3),
      at30: withoutBloom.find((x) => x.r === 30)?.delta ?? null,
      at45: withoutBloom.find((x) => x.r === 45)?.delta ?? null,
      at60: withoutBloom.find((x) => x.r === 60)?.delta ?? null,
      at80: withoutBloom.find((x) => x.r === 80)?.delta ?? null,
      radial: withoutBloom,
    },
  };

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        pin: report.pin,
        noise: { ...report.noise, radial: undefined },
        withBloom: { ...report.withBloom, radial: undefined },
        withoutBloom: { ...report.withoutBloom, radial: undefined },
      },
      null,
      2,
    ),
  );
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
