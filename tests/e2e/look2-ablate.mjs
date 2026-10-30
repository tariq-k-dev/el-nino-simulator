/**
 * LOOK2 Step 1 — blue-circle ablation. READ-ONLY.
 *
 * The symptom is a soft light-blue circle on the left of the globe, just above
 * the equator, at the default view. The brief names a suspect (the cool fill
 * DirectionalLight) and explicitly forbids guessing, so this switches each
 * non-sun light off IN TURN and measures where the circle is and how bright.
 *
 * Detection is a LOCAL PEAK on the ocean, not a global maximum: the sun glint is
 * legitimately the brightest thing on the disc, so a global max always finds it
 * and never the circle. The rule implemented is the acceptance rule itself —
 * a pixel whose luminance exceeds 1.15x the median luminance of an annulus
 * around it.
 *
 *   node tests/e2e/look2-ablate.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const BASE = 'http://localhost:4197';
const OUT = '.cache/look2-ablate';

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
const lpx = (img, x, y) => {
  const p = px(img, x, y);
  return lum(p.r, p.g, p.b);
};

/**
 * Local peaks on the disc: a pixel brighter than 1.15x the MEDIAN of an annulus
 * (rIn..rOut) centred on it. Median, not mean, so one bright neighbour cannot
 * mask the peak being tested.
 */
function localPeaks(img, cx, cy, R, { rIn = 18, rOut = 34, ratio = 1.15, minLum = 25 } = {}) {
  const peaks = [];
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(img.height - 1, Math.ceil(cy + R)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(img.width - 1, Math.ceil(cx + R)); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      const v = lpx(img, x, y);
      if (v < minLum) continue;

      // Annulus median.
      const ring = [];
      for (let a = 0; a < 24; a += 1) {
        const th = (a / 24) * Math.PI * 2;
        for (const rr of [rIn, (rIn + rOut) / 2, rOut]) {
          ring.push(lpx(img, x + Math.cos(th) * rr, y + Math.sin(th) * rr));
        }
      }
      ring.sort((p, q) => p - q);
      const med = ring[Math.floor(ring.length / 2)];
      if (med <= 1) continue;
      if (v > ratio * med) peaks.push({ x, y, v: +v.toFixed(1), med: +med.toFixed(1), ratio: +(v / med).toFixed(3) });
    }
  }
  return peaks;
}

/** Group peaks into blobs so "one circle" is one entry, not 400 pixels. */
function blobify(points, radius = 12) {
  const used = new Set();
  const blobs = [];
  for (const p of points) {
    if (used.has(p)) continue;
    const group = [];
    const stack = [p];
    used.add(p);
    while (stack.length) {
      const q = stack.pop();
      group.push(q);
      for (const o of points) {
        if (used.has(o)) continue;
        if ((o.x - q.x) ** 2 + (o.y - q.y) ** 2 <= radius * radius) {
          used.add(o);
          stack.push(o);
        }
      }
    }
    const best = group.reduce((a, b) => (b.v > a.v ? b : a), group[0]);
    blobs.push({
      n: group.length,
      x: Math.round(group.reduce((s, g) => s + g.x, 0) / group.length),
      y: Math.round(group.reduce((s, g) => s + g.y, 0) / group.length),
      peak: best.v,
      peakAt: [best.x, best.y],
      maxRatio: Math.max(...group.map((g) => g.ratio)),
      med: best.med,
    });
  }
  return blobs.sort((a, b) => b.n - a.n);
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

  const set = async (patch) => {
    await page.evaluate((p) => window.__lookToggles.set(p), patch);
    await page.waitForTimeout(500);
  };

  // Static, reproducible frame: the sun is the only animated thing and it is fixed.
  await page.evaluate(() => window.__lookToggles.set({ stars: false, hotspotRings: false }));
  await page.evaluate(() => window.__globe.setCamera([0, 1.15, 3.15]));
  await page.waitForTimeout(800);

  const centre = await page.evaluate(() => window.__globe.project());
  const R = await page.evaluate(() => window.__globe.discRadiusPx());
  const pins = await page.evaluate(() => window.__globe.pins());

  const measure = (img, label) => {
    const peaks = localPeaks(img, centre.x, centre.y, R);
    const blobs = blobify(peaks);
    // Clipped pixels inside the disc, pins excluded (they are allowed to be bright).
    const exclude = pins.filter((p) => p.facing && !p.behind).map((p) => ({ x: p.x, y: p.y, r: 14 }));
    let clipped = 0;
    let total = 0;
    for (let y = Math.floor(centre.y - R); y <= Math.ceil(centre.y + R); y += 1) {
      for (let x = Math.floor(centre.x - R); x <= Math.ceil(centre.x + R); x += 1) {
        if ((x - centre.x) ** 2 + (y - centre.y) ** 2 > R * R) continue;
        if (exclude.some((e) => (x - e.x) ** 2 + (y - e.y) ** 2 <= e.r * e.r)) continue;
        total += 1;
        const p = px(img, x, y);
        if (p.r >= 250 && p.g >= 250 && p.b >= 250) clipped += 1;
      }
    }
    return {
      label,
      peakCount: peaks.length,
      blobCount: blobs.length,
      top: blobs.slice(0, 5),
      clipped,
      clippedPct: total ? +((100 * clipped) / total).toFixed(4) : 0,
    };
  };

  const results = [];

  // Baseline: everything on.
  let img = await shoot('00-baseline');
  results.push(measure(img, 'all lights on'));

  // One light off at a time — the ablation the brief asks for.
  for (const [flag, label] of [
    ['lightFill', 'fill off (#2f6fb8 anti-sun)'],
    ['lightRim', 'rim off (#c9d8ff behind-left)'],
    ['lightAmbient', 'ambient off (#7aa7d9)'],
    ['lightSun', 'sun off (key)'],
  ]) {
    await set({ [flag]: false });
    img = await shoot(`01-${flag}-off`);
    results.push(measure(img, label));
    await set({ [flag]: true });
  }

  // Fill + rim off together: is the circle one light or the pair?
  await set({ lightFill: false, lightRim: false });
  img = await shoot('02-fill-rim-off');
  results.push(measure(img, 'fill + rim off'));
  await set({ lightFill: true, lightRim: true });

  // --- Characterise the circle precisely, with and without the named suspect.
  await set({ lightFill: false });
  const noFill = await shoot('03-nofill-only');
  await set({ lightFill: true });
  const withFill = await shoot('04-withfill-only');
  await page.waitForTimeout(200);

  const report = {
    centre,
    radius: +R.toFixed(2),
    pins,
    results,
    look: await page.evaluate(() => window.__lookToggles.look().lights),
  };

  // Locate the circle: the peak that disappears when fill is off.
  const peaksWith = blobify(localPeaks(withFill, centre.x, centre.y, R));
  const peaksWithout = blobify(localPeaks(noFill, centre.x, centre.y, R));

  report.circle = {
    withFill: peaksWith.slice(0, 4),
    withoutFill: peaksWithout.slice(0, 4),
  };

  // For the top candidate in `withFill`, report luminance there in both frames.
  const cand = peaksWith.find((b) => !peaksWithout.some((w) => (w.x - b.x) ** 2 + (w.y - b.y) ** 2 < 20 * 20)) ?? peaksWith[0];
  if (cand) {
    const box = (im) => {
      let s = 0;
      let n = 0;
      let mx = 0;
      for (let y = cand.y - 6; y <= cand.y + 6; y += 1) {
        for (let x = cand.x - 6; x <= cand.x + 6; x += 1) {
          if ((x - cand.x) ** 2 + (y - cand.y) ** 2 > 36) continue;
          const v = lpx(im, x, y);
          s += v;
          n += 1;
          mx = Math.max(mx, v);
        }
      }
      return { mean: +(s / n).toFixed(1), max: +mx.toFixed(1) };
    };
    const c = px(withFill, cand.x, cand.y);
    report.circle.subject = {
      x: cand.x,
      y: cand.y,
      areaPx: cand.n,
      rgbWithFill: [c.r, c.g, c.b],
      withFill: box(withFill),
      withoutFill: box(noFill),
      // Offset from the globe centre, so "left of centre" is checkable.
      offsetFromCentre: { dx: cand.x - centre.x, dy: cand.y - centre.y },
      offsetPctRadius: {
        dx: +(((cand.x - centre.x) / R) * 100).toFixed(1),
        dy: +(((cand.y - centre.y) / R) * 100).toFixed(1),
      },
    };
  }

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ results: report.results.map((r) => ({ ...r, top: r.top.slice(0, 3) })), circle: report.circle.subject }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
