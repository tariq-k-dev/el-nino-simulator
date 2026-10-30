import { test, expect } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * Determinism of the capture path.
 *
 * Every pixel spec in this suite compares against a threshold, and a threshold is
 * only meaningful if the same inputs produce the same frame. This asserts that
 * invariant directly, because it is the one thing that can silently turn a suite
 * into noise: the star field used to be seeded from Math.random() (a different sky
 * on every load) and the planet's spin accumulates from frame deltas (a different
 * longitude on every load).
 *
 * Measured before the fixes: 17.4 mean absolute luma inside the disc between two
 * loads of the same view. After: 0.000, with at most 4 pixels differing by 1/255
 * (renderer-level rounding, not scene state).
 *
 * Requires `pnpm build:e2e`.
 */

const VIEWPORT = { width: 1280, height: 800 };

interface Capture {
  data: Buffer;
  width: number;
  height: number;
}

/**
 * Screenshot the scene with DOM chrome suppressed.
 *
 * `locator.screenshot()` on the canvas does NOT capture the canvas alone: any DOM
 * positioned over it is composited in, because the capture is a viewport
 * screenshot clipped to the element's box. The EngineBadge sits at the top right
 * with `bottom: 68`, and its text changes as DuckDB boots — which put a 10 px
 * tall band of differences at y 41-50 into the star-field comparison and looked
 * exactly like a non-deterministic star field. Measured: 368 of 1240 differing
 * pixels were inside that band.
 *
 * So chrome is hidden for the duration of the capture, by walking the canvas'
 * ancestor chain and hiding every `body *` that is not on it. That is the same
 * rule the LOOK2 harnesses used, and it is version-proof against new panels.
 */
async function hideChrome(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('#globe-canvas canvas');
    if (!canvas) return;
    const chain = new Set<Node>();
    let n: Node | null = canvas;
    while (n) {
      chain.add(n);
      n = n.parentElement;
    }
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (chain.has(el)) continue;
      el.style.visibility = 'hidden';
    }
  });
}

/** Screenshot the canvas element only, with DOM chrome suppressed. */
async function canvasShot(page: import('@playwright/test').Page): Promise<Capture> {
  await hideChrome(page);
  // Two frames after the hide, so the capture cannot race the style change.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  const el = page.locator('#globe-canvas canvas');
  const buf = await el.screenshot({ type: 'png' });
  // Re-decode in the page? No: pngjs is available in Node, use it directly.
  const { PNG } = await import('pngjs');
  const png = PNG.sync.read(buf);
  return { data: png.data as Buffer, width: png.width, height: png.height };
}

/** Mean absolute luma difference over the disc, plus the differing-pixel count. */
function compareDisc(
  a: Capture,
  b: Capture,
  geom: { cx: number; cy: number; r: number },
): { meanAbs: number; maxDiff: number; differing: number; total: number } {
  const lum = (r: number, g: number, bl: number) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  let sum = 0;
  let n = 0;
  let maxDiff = 0;
  let differing = 0;
  for (let y = 0; y < Math.min(a.height, b.height); y += 1) {
    for (let x = 0; x < Math.min(a.width, b.width); x += 1) {
      const dx = x - geom.cx;
      const dy = y - geom.cy;
      if (dx * dx + dy * dy > geom.r * geom.r) continue;
      const o = (y * a.width + x) * 4;
      const la = lum(a.data[o], a.data[o + 1], a.data[o + 2]);
      const lb = lum(b.data[o], b.data[o + 1], b.data[o + 2]);
      const d = Math.abs(la - lb);
      sum += d;
      n += 1;
      if (d > maxDiff) maxDiff = d;
      if (d > 0) differing += 1;
    }
  }
  return { meanAbs: n ? sum / n : NaN, maxDiff, differing, total: n };
}

async function readyLookPage(page: import('@playwright/test').Page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/?debug');
  await expect
    .poll(() => page.evaluate(() => !!window.__look && !!window.__globe), { timeout: 90_000 })
    .toBe(true);
  // A fixed, animated-free frame: no stars, no rings, spin pinned at longitude 0.
  await page.evaluate(async () => {
    window.__look!.set({ stars: false, rings: false });
    await window.__look!.setAzimuth(0);
  });
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    centre: window.__globe!.project(),
    radius: window.__globe!.discRadiusPx(),
  }));
}

test.describe('capture determinism', () => {
  test.setTimeout(180_000);

  test('two loads at the same azimuth produce the same disc pixels', async ({ page }) => {
    const geom1 = await readyLookPage(page);
    const shot1 = await canvasShot(page);

    // A reload is a genuinely fresh module graph, seeded PRNG, and WebGL context.
    await page.reload();
    const geom2 = await readyLookPage(page);
    const shot2 = await canvasShot(page);

    // Disc geometry must itself be stable, or comparing pixels is meaningless.
    expect(geom1.radius).toBeGreaterThan(0);
    // Playwright's expect takes no message argument; fold the label into the value.
    const radiusDriftPct = (Math.abs(geom1.radius - geom2.radius) / geom1.radius) * 100;
    expect(radiusDriftPct, 'disc radius drifted between loads').toBeLessThanOrEqual(2);
    expect(Math.abs(geom1.centre.x - geom2.centre.x)).toBeLessThanOrEqual(2);

    const cmp = compareDisc(shot1, shot2, {
      cx: geom1.centre.x,
      cy: geom1.centre.y,
      r: geom1.radius,
    });
    console.log(
      `[determinism] disc meanAbsDiff=${cmp.meanAbs.toFixed(5)} maxDiff=${cmp.maxDiff.toFixed(1)} ` +
        `differing=${cmp.differing}/${cmp.total}`,
    );

    expect(cmp.total, 'no disc pixels sampled — geometry invalid').toBeGreaterThan(1000);
    expect(Number.isFinite(cmp.meanAbs), 'meanAbs is NaN').toBe(true);
    // 0.05 leaves room for renderer rounding (measured 0.000, max 1/255) but
    // fails instantly on a real determinism break (measured 17.4 before the fix).
    expect(cmp.meanAbs, 'disc pixels differ between two loads of the same view').toBeLessThan(0.05);
  });

  test('the star field is identical across loads', async ({ page }) => {
    const skyShot = async () => {
      await page.goto('/?debug');
      await expect
        .poll(() => page.evaluate(() => !!window.__look && !!window.__globe), { timeout: 90_000 })
        .toBe(true);
      // Stars ON, everything else static, so a star diff cannot hide behind a
      // planet diff.
      await page.evaluate(async () => {
        window.__look!.set({ stars: true, rings: false, pins: false, clouds: false });
        await window.__look!.setAzimuth(0);
      });
      await page.waitForTimeout(400);
      const geom = await page.evaluate(() => ({
        centre: window.__globe!.project(),
        radius: window.__globe!.discRadiusPx(),
      }));
      const shot = await canvasShot(page);
      // Compare only OUTSIDE the disc: pure star field, no planet.
      return { shot, geom };
    };

    const a = await skyShot();
    const b = await skyShot();

    let sum = 0;
    let n = 0;
    let differing = 0;
    const lum = (r: number, g: number, bl: number) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    for (let y = 0; y < a.shot.height; y += 1) {
      for (let x = 0; x < a.shot.width; x += 1) {
        const dx = x - a.geom.centre.x;
        const dy = y - a.geom.centre.y;
        // Skip the disc AND a margin for the atmosphere shell (1.10 R).
        if (dx * dx + dy * dy <= (a.geom.radius * 1.15) ** 2) continue;
        const o = (y * a.shot.width + x) * 4;
        const d = Math.abs(
          lum(a.shot.data[o], a.shot.data[o + 1], a.shot.data[o + 2]) -
            lum(b.shot.data[o], b.shot.data[o + 1], b.shot.data[o + 2]),
        );
        sum += d;
        n += 1;
        if (d > 0) differing += 1;
      }
    }

    console.log(
      `[determinism] star field meanAbsDiff=${(sum / n).toFixed(5)} differing=${differing}/${n}`,
    );
    expect(n, 'no sky pixels sampled').toBeGreaterThan(1000);
    expect(Number.isFinite(sum / n)).toBe(true);
    expect(sum / n, 'star field differs between loads — the seed is not fixed').toBeLessThan(0.05);

    // Persist the raw numbers for the report table.
    const dir = 'test-results/look';
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      `${dir}/determinism.json`,
      JSON.stringify({ skyMeanAbsDiff: sum / n, skyDiffering: differing, skyTotal: n }, null, 2),
    );
  });
});
