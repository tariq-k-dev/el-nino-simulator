/**
 * Contributor ablation for the upper-left glare.
 *
 * The brief requires naming the contributor rather than guessing: toggle one
 * candidate at a time at a FIXED camera and see which toggle removes the clipped
 * pixels. This is that harness, kept in the repo so the conclusion is
 * reproducible and a future regression can be re-attributed in one run.
 *
 *   node tests/e2e/globe-ablate.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const BASE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:4197';
const OUT = '.cache/globe-ablate';

function decode(buffer) {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
}
function px(img, x, y) {
  const ix = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const o = (iy * img.width + ix) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2] };
}

function clippedStats(img, cx, cy, radius, t = 250) {
  let hit = 0;
  let total = 0;
  const pts = [];
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y += 1) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      total += 1;
      const p = px(img, x, y);
      if (p.r >= t && p.g >= t && p.b >= t) {
        hit += 1;
        pts.push([x, y]);
      }
    }
  }
  return { hit, total, pct: total ? (100 * hit) / total : 0, pts };
}

/** Connected components of clipped pixels, largest first. */
function blobs(pts) {
  const set = new Set(pts.map(([x, y]) => `${x},${y}`));
  const seen = new Set();
  const out = [];
  for (const [x, y] of pts) {
    const k = `${x},${y}`;
    if (seen.has(k)) continue;
    const stack = [[x, y]];
    seen.add(k);
    const comp = [];
    while (stack.length) {
      const [qx, qy] = stack.pop();
      comp.push([qx, qy]);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const key = `${qx + dx},${qy + dy}`;
          if (set.has(key) && !seen.has(key)) {
            seen.add(key);
            stack.push([qx + dx, qy + dy]);
          }
        }
      }
    }
    const xs = comp.map((c) => c[0]);
    const ys = comp.map((c) => c[1]);
    out.push({
      n: comp.length,
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
      cx: xs.reduce((a, b) => a + b, 0) / comp.length,
      cy: ys.reduce((a, b) => a + b, 0) / comp.length,
    });
  }
  return out.sort((a, b) => b.n - a.n);
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
    for (const el of document.querySelectorAll('body *')) {
      if (chain.has(el)) continue;
      el.style.visibility = 'hidden';
    }
  });

  // The upper-left lit camera from the diagnosis screenshot.
  await page.evaluate(() => window.__globe.setCamera([2.2, 1.6, 2.2]));
  await page.waitForTimeout(400);

  const centre = await page.evaluate(() => window.__globe.project());
  const radius = await page.evaluate(() => window.__globe.discRadiusPx());

  const measure = async (label) => {
    const buf = await page.screenshot({ type: 'png' });
    await writeFile(path.join(OUT, `${label}.png`), buf);
    const img = decode(buf);
    const s = clippedStats(img, centre.x, centre.y, radius);
    const b = blobs(s.pts).slice(0, 4);
    return { label, pct: s.pct, hit: s.hit, blobs: b };
  };

  const set = async (patch) => {
    await page.evaluate((p) => window.__globe.setLookFlags(p), patch);
    await page.waitForTimeout(450);
  };

  const results = [];
  results.push(await measure('00-all-on'));

  // One toggle at a time, everything else left as-is.
  await set({ pins: false });
  results.push(await measure('01-pins-off'));
  await set({ pins: true });

  await set({ specular: false });
  results.push(await measure('02-specular-off'));
  await set({ specular: true });

  await set({ clouds: false });
  results.push(await measure('03-clouds-off'));
  await set({ clouds: true });

  await set({ atmosphere: false });
  results.push(await measure('04-atmosphere-off'));
  await set({ atmosphere: true });

  await set({ bloom: false });
  results.push(await measure('05-bloom-off'));
  await set({ bloom: true });

  await set({ stars: false });
  results.push(await measure('06-stars-off'));
  await set({ stars: true });

  // Everything but the opaque surface: if clipping survives, it is either the
  // tone mapper or the surface material itself.
  await set({ pins: false, specular: false, clouds: false, atmosphere: false, bloom: false, stars: false });
  results.push(await measure('07-surface-only'));
  await set({ pins: true, specular: true, clouds: true, atmosphere: true, bloom: true, stars: true });

  const pins = await page.evaluate(() => window.__globe.pins());

  console.log(
    JSON.stringify(
      { centre, radius, pins, results: results.map((r) => ({ ...r, blobs: r.blobs })) },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(OUT, 'report.json'),
    JSON.stringify({ centre, radius, pins, results }, null, 2),
  );

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
