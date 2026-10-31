/**
 * STEP 3B / A — read-only containment probe. REPORT ONLY, no fixes.
 *
 *   node tests/e2e/containment-probe.mjs
 *
 * Answers item 3 of `docs/prompts/step3-b.md`: with `controls.target` moved onto a pin by the region
 * fly-to, does the `d_contain` assumption (sphere centred on the VIEW AXIS) still hold, and by how
 * many px does the globe silhouette overflow the free rect in each region at 1440x900, live mode?
 *
 * Method, entirely from hooks that already exist:
 *   - `__frame` gives the free rect, the eased offset (dx, dy) and the live distance.
 *   - `__globe.project([0,0,0])` gives where the SPHERE CENTRE lands on screen through the real
 *     projection matrix; `__globe.discRadiusPx()` gives the silhouette radius the same way the look
 *     suite computes it (asin/R tangent form, full-viewport-height focal length).
 *   - `__globe.target()` gives the orbit aim point, printed beside the origin so the difference is
 *     visible rather than implied.
 *
 * The overflow is `centre + R` against the free rect's right edge (and the four-way max against all
 * edges): positive means the silhouette is OUTSIDE the rectangle the layout left for it.
 *
 * Requires an E2E build (`pnpm build:e2e`) served on E2E_PORT (default 4197) with `framing=live`.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT || 4197);
const URL = `http://localhost:${PORT}/?debug&framing=live`;
const OUT = path.resolve('.cache/containment-probe.json');

const REGION_TEXTS = [
  { id: 'pacific', card: /Pacific/i },
  { id: 'us-west', card: /California/i },
  { id: 'se-asia', card: /Indonesia|Asia/i },
  { id: 'horn-africa', card: /Africa|Horn/i },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it returns exactly `want`, or throw. Never a fixed sleep. */
async function poll(page, fn, want, timeoutMs = 15_000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if ((await page.evaluate(fn)) === want) return true;
    await sleep(120);
  }
  throw new Error(`poll timed out after ${timeoutMs} ms${label ? ` waiting for ${label}` : ''}`);
}

/** The free rect, the offset, the distance and the screen-space disc. */
const readGeometry = () => {
  const g = window.__globe;
  const f = window.__frame;
  const centre = g.project([0, 0, 0]);
  const r = g.discRadiusPx();
  return {
    free: f.free,
    dx: f.current.dx,
    dy: f.current.dy,
    d: g.distance(),
    centre,
    r,
    origin: g.project([0, 0, 0]),
    target: g.target(),
    targetPx: g.project(g.target()),
  };
};

/** Overflow of `centre ± r` beyond each edge of `free`, in px. Positive = overflows. */
function overflow(geom) {
  const { free, centre, r } = geom;
  return {
    left: free.x - (centre.x - r),
    right: centre.x + r - (free.x + free.w),
    top: free.y - (centre.y - r),
    bottom: centre.y + r - (free.y + free.h),
  };
}

async function main() {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const rows = [];
  try {
    await page.goto(URL);
    await poll(page, () => (window.__frame ? window.__frame.mode : null), 'live', 90_000, 'live mode');
    /* Let the insets store settle: it arrives on transitionend, not at mount. */
    await sleep(2500);
    await poll(page, () => window.__frame.settled, true, 20_000, 'initial settle');

    rows.push({ region: '(no selection)', phase: 'settled', ...(await page.evaluate(readGeometry)) });

    for (const { id, card } of REGION_TEXTS) {
      const clicked = await page.evaluate((re) => {
        const rx = new RegExp(re);
        const panel = document.querySelector('[data-occluder="right-panel"]');
        if (!panel) return null;
        const btn = [...panel.querySelectorAll('button, [role="button"]')].find((b) =>
          rx.test(b.textContent ?? ''),
        );
        if (!btn) return null;
        const box = btn.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2, text: btn.textContent };
      }, card.source);
      if (!clicked) {
        rows.push({ region: id, phase: 'NOT-FOUND', error: 'card not found' });
        continue;
      }
      await page.mouse.click(clicked.x, clicked.y);
      /* Wait for the drawer to widen the right inset (316 -> 418) and the fly-to to park. */
      await poll(page, () => window.__frame.insets.right > 400, true, 10_000, `${id} drawer`);
      await sleep(4000); // the fly-to damps asymptotically; `settled` is distance-agnostic here
      const geom = await page.evaluate(readGeometry);
      rows.push({ region: id, phase: 'focused', ...geom });

      /* Close: the drawer's own labelled close button (`RegionDrawer.tsx:196-198`). */
      await page.click('[aria-label="Close region panel"]');
      await poll(page, () => window.__frame.insets.right < 400, true, 10_000, `${id} drawer close`);
      await sleep(1500);
      rows.push({ region: id, phase: 'closed', ...(await page.evaluate(readGeometry)) });
    }
  } finally {
    await browser.close();
  }

  const out = rows.map((row) => ({
    ...row,
    overflow: row.centre && row.r !== undefined ? overflow(row) : null,
    centreOffsetFromFree: row.free
      ? {
          x: row.centre.x - (row.free.x + row.free.w / 2),
          y: row.centre.y - (row.free.y + row.free.h / 2),
        }
      : null,
    targetOffsetFromFree: row.free
      ? {
          x: row.targetPx.x - (row.free.x + row.free.w / 2),
          y: row.targetPx.y - (row.free.y + row.free.h / 2),
        }
      : null,
  }));

  for (const r of out) {
    if (!r.free) {
      console.log(`[contain] ${r.region.padEnd(14)} ${r.phase.padEnd(10)} ${r.error ?? ''}`);
      continue;
    }
    const o = r.overflow;
    console.log(
      `[contain] ${r.region.padEnd(14)} ${r.phase.padEnd(10)} d=${r.d.toFixed(4)} ` +
        `free=(${r.free.x.toFixed(1)},${r.free.y.toFixed(1)},${r.free.w.toFixed(1)}x${r.free.h.toFixed(1)}) ` +
        `dx,dy=(${r.dx.toFixed(3)},${r.dy.toFixed(3)}) centre=(${r.centre.x.toFixed(1)},${r.centre.y.toFixed(1)}) ` +
        `R=${r.r.toFixed(1)} ` +
        `overflow L${o.left.toFixed(1)} R${o.right.toFixed(1)} T${o.top.toFixed(1)} B${o.bottom.toFixed(1)} ` +
        `| origin-vs-free (${r.centreOffsetFromFree.x.toFixed(1)},${r.centreOffsetFromFree.y.toFixed(1)}) ` +
        `aim-vs-free (${r.targetOffsetFromFree.x.toFixed(1)},${r.targetOffsetFromFree.y.toFixed(1)})`,
    );
  }

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n[contain] written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
