/**
 * STEP 1 — clipped-pixel investigation. READ-ONLY facts; the fix is a separate
 * decision the table has to justify.
 *
 * Earlier measurements found 13 / 52 / 38 pixels with min(R,G,B) >= 250 inside
 * the disc at azimuths 150 / 210 / 240. This harness reports, for every azimuth:
 * the coordinates, blob sizes and positions of those pixels, then ablates ONE
 * contributor at a time so the cause is read off a table instead of guessed.
 *
 *   node tests/e2e/look/clipped-probe.mjs [--out .cache/clipped]
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '.cache/clipped';
const BASE = 'http://localhost:4197';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function decode(buf) {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}
function px(img, x, y) {
  const ix = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const iy = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const o = (iy * img.width + ix) * 4;
  return { r: img.data[o], g: img.data[o + 1], b: img.data[o + 2] };
}

/** Clipped = all three channels >= 250. Pins and rings are excluded up front. */
function clippedPixels(img, cx, cy, R, exclude) {
  const out = [];
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(img.height - 1, Math.ceil(cy + R)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(img.width - 1, Math.ceil(cx + R)); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > R * R) continue;
      let skip = false;
      for (const e of exclude) {
        if ((x - e.x) ** 2 + (y - e.y) ** 2 <= e.r * e.r) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      const p = px(img, x, y);
      if (p.r >= 250 && p.g >= 250 && p.b >= 250) out.push({ x, y, rgb: [p.r, p.g, p.b] });
    }
  }
  return out;
}

/** Luma>=250 blobs (8-connected), for the "largest blob <= 12 px" rule. */
function lumaBlobs(img, cx, cy, R, exclude) {
  const pts = [];
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(img.height - 1, Math.ceil(cy + R)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(img.width - 1, Math.ceil(cx + R)); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      if (exclude.some((e) => (x - e.x) ** 2 + (y - e.y) ** 2 <= e.r * e.r)) continue;
      const p = px(img, x, y);
      if (lum(p.r, p.g, p.b) >= 250) pts.push([x, y]);
    }
  }
  const set = new Set(pts.map(([x, y]) => `${x},${y}`));
  const seen = new Set();
  const blobs = [];
  for (const [x, y] of pts) {
    const k = `${x},${y}`;
    if (seen.has(k)) continue;
    const st = [[x, y]];
    seen.add(k);
    const comp = [];
    while (st.length) {
      const [qx, qy] = st.pop();
      comp.push([qx, qy]);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const kk = `${qx + dx},${qy + dy}`;
          if (set.has(kk) && !seen.has(kk)) {
            seen.add(kk);
            st.push([qx + dx, qy + dy]);
          }
        }
      }
    }
    const xs = comp.map((c) => c[0]);
    const ys = comp.map((c) => c[1]);
    blobs.push({
      size: comp.length,
      x0: Math.min(...xs),
      x1: Math.max(...xs),
      y0: Math.min(...ys),
      y1: Math.max(...ys),
      cx: xs.reduce((a, b) => a + b, 0) / comp.length,
      cy: ys.reduce((a, b) => a + b, 0) / comp.length,
    });
  }
  return blobs.sort((a, b) => b.size - a.size);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/?debug`);
  await page.waitForFunction(() => !!window.__look, null, { timeout: 90_000 });

  const hideChrome = () =>
    page.evaluate(() => {
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
  await hideChrome();

  const shoot = async (name) => {
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    const buf = await page.screenshot({ type: 'png' });
    await writeFile(path.join(OUT, `${name}.png`), buf);
    return decode(buf);
  };

  const setLook = async (patch) => {
    await page.evaluate((p) => window.__look.set(p), patch);
    await page.waitForTimeout(350);
  };

  const report = { azimuths: {}, ablation: {}, version: 1 };

  // ---------------- A: per-azimuth clipped inventory, default look -------------
  // Stars/pins/rings off: the rule excludes them and they are not suspects.
  await setLook({ stars: false, pins: false, rings: false });

  for (let az = 0; az < 360; az += 30) {
    await page.evaluate((d) => window.__look.setAzimuth(d), az);
    await page.waitForTimeout(450);
    const img = await shoot(`az${String(az).padStart(3, '0')}`);
    const centre = await page.evaluate(() => window.__globe.project());
    const R = await page.evaluate(() => window.__globe.discRadiusPx());
    const clipped = clippedPixels(img, centre.x, centre.y, R, []);
    const blobs = lumaBlobs(img, centre.x, centre.y, R, []);

    report.azimuths[az] = {
      centre,
      radius: +R.toFixed(2),
      clippedCount: clipped.length,
      // Positions relative to the disc.
      clipped: clipped.slice(0, 80).map((p) => {
        const dx = p.x - centre.x;
        const dy = p.y - centre.y;
        const r = Math.hypot(dx, dy);
        return {
          x: p.x,
          y: p.y,
          rgb: p.rgb,
          rOverR: +(r / R).toFixed(3),
          angleDeg: +(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360).toFixed(1),
        };
      }),
      lumaBlobs: blobs.slice(0, 8).map((b) => ({
        size: b.size,
        w: b.x1 - b.x0 + 1,
        h: b.y1 - b.y0 + 1,
        cx: Math.round(b.cx),
        cy: Math.round(b.cy),
        rOverR: +(Math.hypot(b.cx - centre.x, b.cy - centre.y) / R).toFixed(3),
      })),
      largestLumaBlob: blobs.length ? blobs[0].size : 0,
    };
  }

  // ---------------- B: ablation at the three reported azimuths ------------------
  /*
   * One contributor at a time, at az 150 / 210 / 240. Each toggle is reverted
   * before the next, so the column is "clipped count with only this OFF".
   */
  /*
   * Each row switches exactly ONE thing and reverts before the next, so the column
   * reads "clipped count with only this changed". `on: true` entries test the
   * components the rule excludes (pins / rings / stars) in case they are the source.
   */
  const toggles = [
    { key: 'specularOverlay', label: 'specular overlay OFF', patch: { }, mutate: 'overlayOff' },
    { key: 'bloom', label: 'bloom OFF', patch: { bloom: false } },
    { key: 'clouds', label: 'clouds OFF', patch: { clouds: false } },
    { key: 'atmosphere', label: 'atmosphere OFF', patch: { atmosphere: false } },
    { key: 'pins', label: 'pins ON', patch: { pins: true }, revert: { pins: false } },
    { key: 'rings', label: 'rings ON', patch: { rings: true }, revert: { rings: false } },
    { key: 'stars', label: 'stars ON', patch: { stars: true }, revert: { stars: false } },
  ];

  for (const az of [150, 210, 240]) {
    await page.evaluate((d) => window.__look.setAzimuth(d), az);
    await page.waitForTimeout(450);
    const rows = {};

    const measureNow = async (tag) => {
      const img = await shoot(tag);
      const centre = await page.evaluate(() => window.__globe.project());
      const R = await page.evaluate(() => window.__globe.discRadiusPx());
      return clippedPixels(img, centre.x, centre.y, R, []).length;
    };

    rows.baseline = await measureNow(`abl-${az}-baseline`);

    // The specular OVERLAY shader has a flag; three's own GGX highlight does not.
    // Measured separately below so the two specular paths are distinguishable.
    await page.evaluate(() => window.__globe.setLookFlags({ specular: false }));
    await page.waitForTimeout(350);
    rows['(shader) glint overlay OFF'] = await measureNow(`abl-${az}-overlayOff`);
    await page.evaluate(() => window.__globe.setLookFlags({ specular: true }));

    for (const t of toggles.filter((x) => x.key !== 'specularOverlay')) {
      await setLook(t.patch);
      rows[t.label] = await measureNow(`abl-${az}-${t.key}`);
      await setLook(t.revert ?? Object.fromEntries(Object.keys(t.patch).map((k) => [k, true])));
    }

    /*
     * Three's own GGX sun highlight, which no flag controls: set
     * `specularIntensity` to 0 on the live material. This is the one contributor
     * that cannot be ablated through __look, so it is done directly on the material
     * and restored immediately.
     */
    const saved = await page.evaluate(() => {
      let mat = null;
      window.__scene.traverse((o) => {
        if (o.isMesh && o.material && o.material.isMeshPhysicalMaterial) mat = o.material;
      });
      if (!mat) return null;
      const prev = mat.specularIntensity;
      mat.specularIntensity = 0;
      mat.needsUpdate = true;
      return prev;
    });
    await page.waitForTimeout(350);
    rows['(material) specularIntensity = 0'] = await measureNow(`abl-${az}-specInt0`);
    await page.evaluate((prev) => {
      let mat = null;
      window.__scene.traverse((o) => {
        if (o.isMesh && o.material && o.material.isMeshPhysicalMaterial) mat = o.material;
      });
      if (mat && prev !== null) {
        mat.specularIntensity = prev;
        mat.needsUpdate = true;
      }
    }, saved);

    report.ablation[az] = rows;
  }

  await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    azimuths: Object.fromEntries(
      Object.entries(report.azimuths).map(([k, v]) => [k, {
        clipped: v.clippedCount,
        largestLumaBlob: v.largestLumaBlob,
        blobs: v.lumaBlobs,
      }]),
    ),
    ablation: report.ablation,
  }, null, 2));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
