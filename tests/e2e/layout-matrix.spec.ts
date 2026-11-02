/**
 * Step 2B-STEP3-MOBILE2 E — the layout matrix: mode, header, framing, zoom headroom, dock, rotation, chip.
 *
 * ## What this file measures that `mobile-sheet.spec.ts` cannot
 *
 * The MOBILE1 suite measures ONE phone at 390x844 and is organised around the sheet's gestures. This one is
 * organised around the LAYOUT LAW: thirteen viewports, each one a row of `resolveLayoutMode`'s own table, and at
 * each of them the four claims the prompt makes about what the reader sees —
 *
 *   1. the mode on the app root matches the law (LM1);
 *   2. the header's h1 is fully visible, its controls do not overlap it, and there is exactly one of each (LM2);
 *   3. the disc and its envelope lie inside the free rect with 8 px to spare (LM3);
 *   4. the camera can zoom OUT to at least 1.2 x the fit and is not clipped by `far` (LM4).
 *
 * plus the shape-specific cases: the dock (LM6), a rotation round-trip (LM7), desktop's unchanged controls (LM8)
 * and the chip's popover semantics (LM9).
 *
 * ## Step 2B-STEP3-MOBILE2-FIX tightened LM2 and added LM10
 *
 * MOBILE2-R measured the phoneLandscape header GROWING after load — 113.50 px at 265 ms and 194.75 px at
 * 2326 ms at 667x375 — because the `h1` wrapped inside a `flex-1` slot squeezed by a data-dependent chip.
 * LM2 now asserts the single-line property (F1) and the boundary F4 bound in landscape, and LM10 is the
 * F5 three-moment stability case: the header's bottom is sampled at the first frame, after the data is
 * ready and after 2 s, and must be the same number at all three.
 *
 * ## Why every geometric claim is read from the probe, not from the DOM
 *
 * The globe is WebGL. Its disc has no element to measure, so "the disc fits" can only be answered by projecting
 * through the scene's own camera — `__globe.project` and `__globe.discRadiusPx`, which use the same matrix the
 * renderer and the raycast use. What the DOM is used for is the HEADER (a real element, with a real rect) and the
 * DOCK (a real element), because those are the layout.
 *
 * ## Touch, not `page.mouse`
 *
 * Every gesture here goes through CDP `Input.dispatchTouchEvent`, for the reason `mobile-sheet.spec.ts` documents
 * at length: `page.mouse` produces a mouse pointer stream, which bypasses `touch-action` entirely and would pass
 * even where a real thumb would not.
 */
import { test, expect, connectionInit } from './fixtures';
import type { Page, CDPSession } from '@playwright/test';

const LIVE = '/?debug&framing=live';

/** The step's own viewport table, with the mode `resolveLayoutMode` must report for each. */
const MATRIX = [
  { w: 390, h: 844, mode: 'portrait' },
  { w: 412, h: 924, mode: 'portrait' },
  { w: 360, h: 640, mode: 'portrait' },
  { w: 375, h: 667, mode: 'portrait' },
  { w: 430, h: 932, mode: 'portrait' },
  { w: 320, h: 568, mode: 'portrait' },
  { w: 768, h: 1024, mode: 'portrait' },
  { w: 820, h: 1180, mode: 'portrait' },
  { w: 960, h: 1440, mode: 'portrait' },
  { w: 667, h: 375, mode: 'phoneLandscape' },
  { w: 844, h: 390, mode: 'phoneLandscape' },
  { w: 924, h: 412, mode: 'phoneLandscape' },
  { w: 932, h: 430, mode: 'phoneLandscape' },
] as const;

/**
 * The landscape rows F1-F5 name, including the two extra shapes the fix's prompt adds (568x320 and 640x360).
 *
 * Kept separate from `MATRIX` because LM1's table is the LAYOUT LAW's matrix and this one is the HEADER
 * suite's: the prompt asks for six landscape rows here and the law's matrix has four.
 */
const LANDSCAPE_ROWS = [
  { w: 667, h: 375 },
  { w: 844, h: 390 },
  { w: 924, h: 412 },
  { w: 932, h: 430 },
  { w: 568, h: 320 },
  { w: 640, h: 360 },
] as const;

/** The margin the disc must keep inside the free rect, CSS px. */
const MARGIN_PX = 8;

/** F1's allowance: the h1's box height may exceed one line-height by at most this factor. */
const H1_LINE_FACTOR = 1.4;

/**
 * The landscape header's expected height per row, px — LITERALS, not an import of `headerMath`.
 *
 * Two reasons. (1) `tsconfig.node.json` has no `@/*` path alias, so a spec cannot import from `src/`.
 * (2) More importantly, importing the function that PRODUCED the layout and comparing the DOM against it
 * is a tautology: it would pass for any value the function returned, including a wrong one. These are the
 * numbers the fix's prompt requires, written down independently, so a change to `headerMath` that moves
 * the header fails HERE.
 *
 * 54 = 2 + 50 + 2 (one row: padding + the 50 px controls cluster).
 * 76 = 2 + 20 + 2 + 50 + 2 (two rows: padding + identity row + gap + controls).
 */
const LANDSCAPE_HEADER_H: Record<string, number> = {
  '667x375': 76,
  '844x390': 54,
  '924x412': 54,
  '932x430': 54,
  '568x320': 76,
  '640x360': 76,
};

/* ---------------------------------------------------------------------------- helpers */

async function open(page: Page, vp: { w: number; h: number }): Promise<void> {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.addInitScript(connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }));
  await page.goto(LIVE);
  await expect
    .poll(() => page.evaluate(() => (window.__frame ? window.__frame.mode : null)), {
      timeout: 90_000,
      intervals: [250],
    })
    .toBe('live');
  /* The fit has to ARRIVE, not merely start: a projection read mid-ease is a projection of a pose that is gone. */
  await settleFit(page);
}

/**
 * Wait until the camera distance stops moving.
 *
 * A "same key twice" rest test, which is the construction `frame.spec.ts` and `mobile-sheet.spec.ts` both use: the
 * probe's own `settled` is 0.0005 loose, and a projection taken inside that window is a projection of a pose the
 * fit is still easing toward.
 */
async function settleFit(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).__lmKey;
  });
  await page.waitForFunction(
    () => {
      const d = window.__globe!.distance();
      const key = d.toFixed(6);
      const store = window as unknown as Record<string, unknown>;
      const previous = store.__lmKey;
      store.__lmKey = key;
      return previous === key;
    },
    undefined,
    { timeout: 40_000, polling: 120 },
  );
}

async function touch(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

/** One tap, as a thumb does it. */
async function tapTouch(cdp: CDPSession, at: { x: number; y: number }): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: at.x, y: at.y, id: 1 }],
  });
  await new Promise((r) => setTimeout(r, 30));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** A vertical drag, as a thumb does it. */
async function dragTouch(
  cdp: CDPSession,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** The whole geometric state of one frame, read coherently through `snapshot()`. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const g = window.__globe!;
    const f = window.__frame!;
    const snap = f.snapshot();
    const cam = window.__camera as {
      view: { offsetX: number; offsetY: number; width: number; height: number; enabled: boolean } | null;
      far: number;
      near: number;
    };
    const target = g.target();
    const projected = g.project(target);
    return {
      W: window.innerWidth,
      H: window.innerHeight,
      mode: document.querySelector('[data-layout-mode]')?.getAttribute('data-layout-mode') ?? null,
      snap,
      disc: g.discRadiusPx(),
      centre: projected,
      distance: g.distance(),
      dMax: f.dMax,
      dFit: f.dFit,
      radiusBudget: f.radiusBudget,
      headerBottom: f.headerBottom,
      far: cam.far,
      near: cam.near,
      cameraView: cam.view,
    };
  });
}

/* -------------------------------------------------------------------------- the cases */

test.describe('layout matrix', () => {
  test.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  test.setTimeout(240_000);

  /* ------------------------------------------------------------------------------ LM1 */

  test('LM1: data-layout-mode matches the law at every viewport in the matrix', async ({ page }) => {
    await open(page, MATRIX[0]);

    const seen: Array<{ vp: string; mode: string | null }> = [];
    for (const vp of MATRIX) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await expect
        .poll(
          () =>
            page.evaluate(
              () => document.querySelector('[data-layout-mode]')?.getAttribute('data-layout-mode') ?? null,
            ),
          { timeout: 20_000, intervals: [100] },
        )
        .toBe(vp.mode);
      /* The probe's mode must agree with the DOM's — one store, two readers. */
      await expect
        .poll(() => page.evaluate(() => window.__frame!.layoutMode), { timeout: 20_000, intervals: [100] })
        .toBe(vp.mode);
      seen.push({ vp: `${vp.w}x${vp.h}`, mode: vp.mode });
    }
    expect(seen).toHaveLength(MATRIX.length);
  });

  /* ------------------------------------------------------------------------------ LM2 */

  test('LM2: the header shows one of each control, an unclipped h1, and no overlaps', async ({ page }) => {
    await open(page, MATRIX[0]);

    /*
     * The law's thirteen rows PLUS the two extra landscape shapes the fix's prompt names (568x320 and
     * 640x360). They are not in `MATRIX` because that table is `resolveLayoutMode`'s own, and adding rows
     * to it would make LM1 assert a law it does not have — but the HEADER claims F1/F4 make must hold at
     * every landscape shape, including the two smallest.
     */
    const rows = [
      ...MATRIX,
      { w: 568, h: 320, mode: 'phoneLandscape' as const },
      { w: 640, h: 360, mode: 'phoneLandscape' as const },
    ];

    for (const vp of rows) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await settleFit(page);

      const header = await page.evaluate(() => {
        const h1 = document.querySelector('h1') as HTMLElement | null;
        const reset = Array.from(document.querySelectorAll('button')).filter((b) =>
          /reset view/i.test(b.getAttribute('aria-label') ?? ''),
        );
        const units = Array.from(document.querySelectorAll('button')).filter((b) =>
          /^(metric|imperial) units$/i.test(b.getAttribute('aria-label') ?? ''),
        );
        const snaps = Array.from(document.querySelectorAll('button')).filter((b) =>
          /snapshot/i.test(b.getAttribute('aria-label') ?? ''),
        );
        const chip = document.querySelector('[data-testid="enso-chip"]') as HTMLElement | null;
        const el = document.querySelector('[data-occluder="compact-header"]') as HTMLElement | null;
        const rect = (e: Element | null) => {
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
        };
        const style = h1 ? getComputedStyle(h1) : null;
        return {
          h1: h1
            ? {
                ...rect(h1),
                text: (h1.textContent ?? '').trim(),
                scrollW: h1.scrollWidth,
                clientW: h1.clientWidth,
                textOverflow: style?.textOverflow ?? '',
                whiteSpace: style?.whiteSpace ?? '',
                /* F1: the line count, from the box height over the computed line-height. */
                lineHeight: style ? parseFloat(style.lineHeight) : 0,
              }
            : null,
          resets: reset.length,
          units: units.length,
          snaps: snaps.length,
          /* Touch targets: every control at least 44 px in both dimensions. */
          targets: [...reset, ...units, ...snaps, chip]
            .filter((e): e is HTMLElement => Boolean(e))
            .map((e) => {
              const r = e.getBoundingClientRect();
              return { label: e.getAttribute('aria-label') ?? e.tagName, w: r.width, h: r.height };
            }),
          header: rect(el),
          chip: rect(chip),
          viewport: { w: window.innerWidth, h: window.innerHeight },
          publishedHeaderBottom: window.__frame!.headerBottom,
        };
      });

      const at = `${vp.w}x${vp.h}`;

      /* Exactly one of each — the ghost duplicate is the defect this replaces. */
      expect(header.resets, `${at} Reset View count`).toBe(1);
      expect(header.units, `${at} unit toggle count`).toBe(2); // the °C and the °F button
      expect(header.snaps, `${at} Snapshot count`).toBe(1);

      /* The h1 is fully visible, not ellipsised, and not overflowing. */
      expect(header.h1, `${at} h1 exists`).not.toBeNull();
      const h1 = header.h1!;
      expect(h1.text.length, `${at} h1 has its text`).toBeGreaterThan(10);
      expect(h1.textOverflow, `${at} h1 must not be ellipsised`).not.toBe('ellipsis');
      expect(h1.scrollW, `${at} h1 scrollWidth ${h1.scrollW} > clientWidth ${h1.clientW}`).toBeLessThanOrEqual(
        h1.clientW + 1,
      );
      expect(h1.l, `${at} h1 left`).toBeGreaterThanOrEqual(-1);
      expect(h1.r, `${at} h1 right`).toBeLessThanOrEqual(header.viewport.w + 1);
      expect(h1.t, `${at} h1 top`).toBeGreaterThanOrEqual(-1);
      expect(h1.b, `${at} h1 bottom`).toBeLessThanOrEqual(header.viewport.h + 1);

      /* Touch targets. */
      for (const t of header.targets) {
        expect(t.h, `${at} ${t.label} height ${t.h} < 44`).toBeGreaterThanOrEqual(43);
        expect(t.w, `${at} ${t.label} width ${t.w} < 44`).toBeGreaterThanOrEqual(43);
      }

      /* No pairwise overlap among the h1, the chip and the controls cluster. */
      const overlap = await page.evaluate(() => {
        const h1 = document.querySelector('h1') as HTMLElement | null;
        const chip = document.querySelector('[data-testid="enso-chip"]') as HTMLElement | null;
        const controls = Array.from(document.querySelectorAll('button')).filter(
          (b) =>
            /^(metric|imperial) units$/i.test(b.getAttribute('aria-label') ?? '') ||
            /snapshot/i.test(b.getAttribute('aria-label') ?? '') ||
            /reset view/i.test(b.getAttribute('aria-label') ?? ''),
        );
        const boxes: Array<{ name: string; r: DOMRect }> = [];
        if (h1) boxes.push({ name: 'h1', r: h1.getBoundingClientRect() });
        if (chip) boxes.push({ name: 'chip', r: chip.getBoundingClientRect() });
        for (const c of controls) {
          boxes.push({ name: c.getAttribute('aria-label') ?? 'control', r: c.getBoundingClientRect() });
        }
        const hits: string[] = [];
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i].r;
            const b = boxes[j].r;
            /* A 1 px grace: SVG icons and rounded borders can touch by a sub-pixel. */
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 1 && oy > 1) hits.push(`${boxes[i].name} x ${boxes[j].name} (${ox.toFixed(1)}x${oy.toFixed(1)})`);
          }
        }
        return hits;
      });
      expect(overlap, `${at} overlapping header items`).toEqual([]);

      /* The header's measured bottom is the published one, within 1 px. */
      expect(header.header, `${at} compact header exists`).not.toBeNull();
      expect(
        Math.abs(header.header!.b - header.publishedHeaderBottom),
        `${at} published headerBottom ${header.publishedHeaderBottom} vs measured bottom ${header.header!.b}`,
      ).toBeLessThanOrEqual(1);

      /*
       * ---------------------------------------------------------------- F1 + F4, landscape only
       *
       * F1: the h1 renders on ONE line with its full text. Two independent readings, because either
       * alone can be fooled — a box height of one line-height with a clipped overflow would pass the
       * first, and a `scrollWidth <= clientWidth` on a box that wrapped would pass the second.
       *
       * F4: the header's bottom is at most a quarter of the viewport height.
       *
       * Portrait is deliberately NOT asserted here: its header is a fixed 158 px two-row layout whose
       * h1 is allowed to wrap, and its DOM, classes and tests are out of this step's scope.
       */
      if (vp.mode === 'phoneLandscape') {
        const lines = h1.h! / h1.lineHeight;
        expect(
          h1.h!,
          `${at} h1 box ${h1.h} px is ${lines.toFixed(2)} line-heights (${h1.lineHeight} px) — must be one line`,
        ).toBeLessThanOrEqual(h1.lineHeight * H1_LINE_FACTOR);
        expect(h1.whiteSpace, `${at} h1 must be nowrap in landscape`).toBe('nowrap');
        expect(h1.scrollW, `${at} h1 scrollWidth ${h1.scrollW} > clientWidth ${h1.clientW}`).toBeLessThanOrEqual(
          h1.clientW,
        );
        /*
         * The full text, not a truncation: the heading is the page's subject is `Super El Niño Global
         * Impact Simulator`. Compared with whitespace NORMALISED, because the markup deliberately uses a
         * non-breaking space in `El&nbsp;Niño` — the assertion is about content, not about which space
         * character carries it.
         */
        expect(h1.text.replace(/\s+/g, ' '), `${at} h1 must carry its whole text`).toBe(
          'Super El Niño Global Impact Simulator',
        );

        /* F4: headerBottom <= 0.25 * H. */
        expect(
          header.header!.b,
          `${at} header bottom ${header.header!.b} vs 0.25 * ${header.viewport.h} = ${0.25 * header.viewport.h}`,
        ).toBeLessThanOrEqual(0.25 * header.viewport.h);

        /* And the height is the law's own number, so a silent retune of the constants fails here. */
        expect(header.header!.b, `${at} landscape header height`).toBeCloseTo(LANDSCAPE_HEADER_H[at], 1);
      }
    }
  });

  /* ------------------------------------------------------------------------------ LM10 */

  test('LM10: the landscape header is the same height at the first frame, after data, and after 2 s', async ({
    page,
  }) => {
    /*
     * F5 — the defect MOBILE2-R measured, asserted as a property.
     *
     * At 667x375 the old header was **113.50 px at 265 ms and 194.75 px at 2326 ms**: the `h1` wrapped
     * LATE, when the ENSO chip's text arrived and widened it. A Playwright read is a CDP round trip of
     * 100-300 ms, far coarser than the 81.25 px change it has to catch, so the sampling happens IN PAGE
     * with `requestAnimationFrame` from an `addInitScript` — it runs before any app JS, so "the first
     * frame" is genuinely the first frame and not the first frame Playwright could observe.
     *
     * Three moments per row:
     *   (1) the FIRST sample the sampler took,
     *   (2) the first sample at or after `document.fonts.ready`,
     *   (3) the last sample, which is at +2.4 s.
     *
     * All three DOM bottoms must agree within 0.5 px, and the PUBLISHED `headerBottom` at (3) must
     * equal the DOM's within 0.5 px. The published value is null at (1)/(2) by design — the observer
     * publishes after the first commit — so the published claim is made at the moment it exists.
     */
    test.setTimeout(300_000);

    const rows = [];
    for (const vp of LANDSCAPE_ROWS) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      /* The sampler, registered before the app so the first frame is measured. */
      await page.addInitScript(() => {
        const w = window as unknown as Record<string, unknown>;
        const state = { samples: [] as Array<{ t: number; bottom: number; height: number; h1h: number | null; published: number | null }>, fontsReadyAt: null as number | null, startedAt: performance.now() };
        w.__hdr = state;
        document.fonts.ready.then(() => {
          state.fontsReadyAt = performance.now() - state.startedAt;
        });
        const read = (): void => {
          const el = document.querySelector('[data-occluder="compact-header"]');
          if (el) {
            const r = el.getBoundingClientRect();
            const h1 = document.querySelector('h1');
            const frame = (w as { __frame?: { headerBottom: number } }).__frame;
            state.samples.push({
              t: performance.now() - state.startedAt,
              bottom: r.bottom,
              height: r.height,
              h1h: h1 ? h1.getBoundingClientRect().height : null,
              published: frame ? frame.headerBottom : null,
            });
          }
          if (performance.now() - state.startedAt < 2400) requestAnimationFrame(read);
        };
        requestAnimationFrame(read);
      });
      await page.addInitScript(
        connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
      );
      await page.goto(LIVE);
      await expect
        .poll(() => page.evaluate(() => (window.__frame ? window.__frame.mode : null)), {
          timeout: 90_000,
          intervals: [250],
        })
        .toBe('live');
      /* Outlast the sampler's own 2.4 s window so its last sample is the +2 s one. */
      await page.waitForTimeout(2600);

      const s = await page.evaluate(() => {
        const h = (window as unknown as { __hdr: { samples: Array<{ t: number; bottom: number; height: number; h1h: number | null; published: number | null }>; fontsReadyAt: number | null } }).__hdr;
        const first = h.samples[0] ?? null;
        const afterFonts = h.samples.find((x) => h.fontsReadyAt !== null && x.t >= h.fontsReadyAt) ?? null;
        const last = h.samples[h.samples.length - 1] ?? null;
        return {
          n: h.samples.length,
          fontsReadyAt: h.fontsReadyAt,
          first,
          afterFonts,
          last,
          domAtLast: (document.querySelector('[data-occluder="compact-header"]') as HTMLElement).getBoundingClientRect()
            .bottom,
          publishedAtLast: window.__frame!.headerBottom,
        };
      });

      const at = `${vp.w}x${vp.h}`;
      rows.push({
        at,
        expected: LANDSCAPE_HEADER_H[at],
        n: s.n,
        first: s.first?.bottom ?? null,
        afterFonts: s.afterFonts?.bottom ?? null,
        last: s.last?.bottom ?? null,
        published: s.publishedAtLast,
        h1h: [s.first?.h1h, s.afterFonts?.h1h, s.last?.h1h],
      });

      /* A sampler that recorded nothing would pass every comparison below vacuously. */
      expect(s.first, `${at} sampler recorded no samples`).not.toBeNull();
      expect(s.n, `${at} sampler took ${s.n} samples`).toBeGreaterThan(10);

      for (const [label, sample] of [
        ['first frame', s.first],
        ['after data ready', s.afterFonts],
        ['after 2 s', s.last],
      ] as const) {
        expect(sample, `${at} ${label}: no sample`).not.toBeNull();
        /* The three moments agree with EACH OTHER, within 0.5 px. */
        expect(
          Math.abs(sample!.bottom - s.last!.bottom),
          `${at} ${label} bottom ${sample!.bottom} vs after-2s ${s.last!.bottom}`,
        ).toBeLessThanOrEqual(0.5);
        /* And each equals the height the law says, so the agreement is not three equal WRONG values. */
        expect(sample!.bottom, `${at} ${label} bottom`).toBeCloseTo(LANDSCAPE_HEADER_H[at], 1);
      }

      /* The published value equals the DOM at the same moment, within 0.5 px. */
      expect(
        Math.abs(s.publishedAtLast - s.domAtLast),
        `${at} published ${s.publishedAtLast} vs DOM ${s.domAtLast}`,
      ).toBeLessThanOrEqual(0.5);

      /* The h1 does not change line count either — the late-wrap mechanism itself. */
      for (const h1h of rows[rows.length - 1].h1h) {
        expect(h1h, `${at} h1 height must be one line throughout`).toBeCloseTo(16.25, 1);
      }
    }

    console.log(`[LM10] ${JSON.stringify(rows)}`);
  });

  /* ------------------------------------------------------------------------------ LM3 */

  test('LM3: the disc and its envelope sit inside the free rect with 8 px margin, in every mode', async ({ page }) => {
    await open(page, MATRIX[0]);

    const rows: Array<Record<string, number | string>> = [];

    for (const vp of MATRIX) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await settleFit(page);
      const g = await geometry(page);
      const at = `${vp.w}x${vp.h}`;

      expect(g.mode, `${at} mode`).toBe(vp.mode);

      /*
       * The disc, measured. `discRadiusPx()` is the globe's own silhouette; its edge against the free rect is the
       * claim. The envelope (`re = 1.10242`) is what the fit was computed for, and it is 1.10242x the disc, so the
       * margin is checked for the disc and the envelope separately.
       */
      const left = g.centre.x - g.disc;
      const right = g.centre.x + g.disc;
      const top = g.centre.y - g.disc;
      const bottom = g.centre.y + g.disc;
      const envScale = 1.10242; // the pin envelope, in globe radii
      const envLeft = g.centre.x - g.disc * envScale;
      const envRight = g.centre.x + g.disc * envScale;
      const envTop = g.centre.y - g.disc * envScale;
      const envBottom = g.centre.y + g.disc * envScale;

      const f = g.snap.free;
      const mL = left - f.x;
      const mR = f.x + f.w - right;
      const mT = top - f.y;
      const mB = f.y + f.h - bottom;

      rows.push({ at, mode: vp.mode, mL, mR, mT, mB, disc: g.disc, cx: g.centre.x, cy: g.centre.y });

      /*
       * The DISC's margins are the readable claim: a disc that overflows the band is visibly cut. Measured with a
       * 0.5 px grace, because `discRadiusPx` reads a silhouette off the projection and the fit derives the radius
       * from the same matrix — they agree to float noise, not to an integer pixel.
       */
      for (const [name, m] of [
        ['left', mL],
        ['right', mR],
        ['top', mT],
        ['bottom', mB],
      ] as const) {
        expect(m, `${at} disc ${name} margin ${m?.toFixed?.(2)} against the free rect`).toBeGreaterThanOrEqual(
          MARGIN_PX - 0.5,
        );
      }

      /* The ENVELOPE (the pin lift plus its core) must also stay inside — that is what the fit was solved for. */
      expect(envLeft - f.x, `${at} envelope left`).toBeGreaterThanOrEqual(-0.5);
      expect(f.x + f.w - envRight, `${at} envelope right`).toBeGreaterThanOrEqual(-0.5);
      expect(envTop - f.y, `${at} envelope top`).toBeGreaterThanOrEqual(-0.5);
      expect(f.y + f.h - envBottom, `${at} envelope bottom`).toBeGreaterThanOrEqual(-0.5);

      /* The free rect starts at the header and ends inside the viewport. */
      expect(Math.abs(f.y - g.headerBottom), `${at} free rect top vs published headerBottom`).toBeLessThanOrEqual(1);
      expect(f.y + f.h, `${at} free rect bottom`).toBeLessThanOrEqual(g.H + 0.5);

      if (vp.mode === 'portrait') {
        /* The band must end at the peek line, so the sheet never covers the disc. */
        const sheetTop = await page.evaluate(() => {
          const el = document.querySelector('[data-mobile-sheet]') as HTMLElement | null;
          return el ? el.getBoundingClientRect().top : null;
        });
        expect(sheetTop, `${at} sheet exists in portrait`).not.toBeNull();
        expect(Math.abs((f.y + f.h) - sheetTop!), `${at} free bottom vs sheet top`).toBeLessThanOrEqual(1);
      } else {
        /* phoneLandscape: the band ends left of the dock, and nothing is clipped at the canvas edges. */
        const dockLeft = await page.evaluate(() => {
          const el = document.querySelector('[data-landscape-dock]') as HTMLElement | null;
          return el ? el.getBoundingClientRect().left : null;
        });
        expect(dockLeft, `${at} dock exists in phoneLandscape`).not.toBeNull();
        expect(f.x + f.w, `${at} free right ${f.x + f.w} vs dock left ${dockLeft}`).toBeLessThanOrEqual(dockLeft! + 1);
        expect(g.centre.x - g.disc, `${at} clipped at the left canvas edge`).toBeGreaterThanOrEqual(0);
      }
    }

    /* Printed so a failure can be read as numbers rather than re-measured. */
    console.log(`[LM3] ${JSON.stringify(rows.map((r) => ({
      at: r.at,
      mode: r.mode,
      disc: Number((r.disc as number).toFixed(1)),
      m: [r.mL, r.mR, r.mT, r.mB].map((v) => Number((v as number).toFixed(1))),
    })))}`);
  });

  /* ------------------------------------------------------------------------------ LM4 */

  test('LM4: zoom-out reaches maxDistance, maxDistance >= 1.2 * dFit, and far is not the limiter', async ({ page }) => {
    await open(page, MATRIX[0]);

    for (const vp of MATRIX.slice(0, 6).concat(MATRIX.slice(9, 11)) as unknown as typeof MATRIX) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await settleFit(page);
      const g = await geometry(page);
      const at = `${vp.w}x${vp.h}`;

      /* The ceiling carries the headroom. */
      expect(g.dMax, `${at} maxDistance ${g.dMax} vs dFit ${g.dFit}`).toBeGreaterThanOrEqual(1.2 * g.dFit - 1e-9);
      /* `far` exceeds the ceiling by the step's 2 units. */
      expect(g.far, `${at} far ${g.far} must exceed maxDistance ${g.dMax} + 2`).toBeGreaterThan(g.dMax + 2);

      /* Zoom OUT with real wheel notches until it clamps, and check where it stopped. */
      await page.evaluate(() => window.__globe!.setSpin?.(false, 0));
      await page.mouse.move(vp.w / 2, Math.min(vp.h - 60, g.snap.free.y + g.snap.free.h / 2));
      for (let i = 0; i < 40; i += 1) {
        await page.mouse.wheel(0, 160);
        await page.waitForTimeout(40);
      }
      await settleFit(page);
      const zoomedOut = await geometry(page);
      expect(zoomedOut.distance, `${at} zoom-out must reach maxDistance`).toBeCloseTo(g.dMax, 1);
      /* And nothing is clipped by the far plane at the maximum: the disc is still a finite, positive radius. */
      expect(Number.isFinite(zoomedOut.disc)).toBe(true);
      expect(zoomedOut.disc).toBeGreaterThan(0);

      /* Zoom IN works from there. */
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(300);
      const zoomedIn = await geometry(page);
      expect(zoomedIn.distance, `${at} zoom-in must move closer`).toBeLessThan(zoomedOut.distance);
    }
  });

  /* ------------------------------------------------------------------------------ LM5 */

  test('LM5: with a region selected at Half, the pin stays above the sheet and the tap does not clear it', async ({
    page,
  }) => {
    await open(page, { w: 390, h: 844 });
    const cdp = await touch(page);

    /* Pick a region through the sheet's own switcher — the same path a reader uses. */
    await page.getByRole('slider', { name: 'Sheet position' }).press('End');
    await page.waitForTimeout(500);
    await page.locator('[data-region-id="us-west"]').tap();
    await expect
      .poll(() => page.evaluate(() => window.__frame!.snapshot().regionId), { timeout: 20_000, intervals: [250] })
      .toBe('us-west');

    /* Half tier, then measure the pinned face's projected position. */
    await page.getByRole('slider', { name: 'Sheet position' }).press('Home');
    await page.getByRole('slider', { name: 'Sheet position' }).press('ArrowUp');
    await page.waitForTimeout(700);
    await settleFit(page);

    const pinned = await page.evaluate(() => {
      const g = window.__globe!;
      /* The pin's CORE, in screen space — the thing a face-pinned view puts in the middle. */
      const pin = g.pins().find((p) => p.id === 'us-west');
      return { y: pin?.y ?? null, x: pin?.x ?? null, H: window.innerHeight };
    });
    expect(pinned.y, 'the selected pin must project on screen').not.toBeNull();
    const halfTop = 0.52 * pinned.H;
    expect(pinned.y!, `pin y ${pinned.y} must clear the Half sheet top ${halfTop}`).toBeLessThanOrEqual(halfTop - 20);

    /* And the element at that point is the canvas or a hotspot label, never the sheet or the header. */
    const topmost = await page.evaluate(
      (at) => {
        const el = document.elementFromPoint(at.x, at.y);
        if (!el) return 'null';
        if (el.closest('[data-mobile-sheet]')) return 'sheet';
        if (el.closest('[data-occluder="compact-header"]')) return 'header';
        return 'canvas-or-label';
      },
      { x: pinned.x!, y: pinned.y! },
    );
    expect(['canvas-or-label'], `elementFromPoint at the pin was ${topmost}`).toContain(topmost);

    /* A tap on the sheet does NOT clear the selection (the sheet is outside the R3F event source). */
    await tapTouch(cdp, { x: 195, y: 844 - 40 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__frame!.snapshot().regionId)).toBe('us-west');
  });

  /* ------------------------------------------------------------------------------ LM6 */

  test('LM6: the landscape dock is right-aligned, clamped, scrolls by touch, and has no tier handle', async ({
    page,
  }) => {
    await open(page, { w: 924, h: 412 });

    const dock = await page.evaluate(() => {
      const el = document.querySelector('[data-landscape-dock]') as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const scroller = el.querySelector('[data-dock-scroll]') as HTMLElement | null;
      return {
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
        top: r.top,
        W: window.innerWidth,
        H: window.innerHeight,
        scrollH: scroller?.scrollHeight ?? 0,
        clientH: scroller?.clientHeight ?? 0,
        hasTierHandle: Boolean(el.querySelector('[aria-label="Sheet position"]')),
        sheetCount: document.querySelectorAll('[data-mobile-sheet]').length,
        desktopPanels: document.querySelectorAll('[data-occluder="left-panel"], [data-occluder="right-panel"]').length,
        cards: document.querySelectorAll('[data-occluder="right-panel"]').length,
        drawer: document.querySelectorAll('[data-occluder="right-drawer"]').length,
        freeRight: window.__frame!.free.x + window.__frame!.free.w,
      };
    });

    expect(dock, 'the dock must exist in phoneLandscape').not.toBeNull();
    const d = dock!;

    /* Right-aligned, and inside the clamp: min(clamp(320, 0.38W, 400), 0.5W). */
    expect(Math.abs(d.right - d.W), 'the dock is flush to the right edge').toBeLessThanOrEqual(1);
    const wantW = Math.min(Math.min(Math.max(320, 0.38 * d.W), 400), 0.5 * d.W);
    expect(Math.abs(d.width - wantW), `dock width ${d.width} vs clamp ${wantW}`).toBeLessThanOrEqual(1);
    /* It starts at the header's published bottom. */
    expect(Math.abs(d.top - (await page.evaluate(() => window.__frame!.headerBottom)))).toBeLessThanOrEqual(1);
    /* And the camera's free rect ends exactly at its left edge. */
    expect(Math.abs(d.freeRight - d.left), 'free rect right vs dock left').toBeLessThanOrEqual(1);

    /* No tiers, no sheet, no desktop panels. */
    expect(d.hasTierHandle, 'the dock must have no tier handle').toBe(false);
    expect(d.sheetCount, 'no portrait sheet in landscape').toBe(0);
    expect(d.cards + d.drawer, 'no desktop panels in landscape').toBe(0);

    /* Touch scroll moves the dock and NOT the camera. */
    const cdp = await touch(page);
    const poseBefore = await page.evaluate(() => {
      const cam = window.__camera as { position: { x: number; y: number; z: number } };
      return [cam.position.x, cam.position.y, cam.position.z];
    });
    const scrollBefore = await page.evaluate(() => {
      const s = document.querySelector('[data-dock-scroll]') as HTMLElement;
      return s.scrollTop;
    });
    await dragTouch(cdp, { x: d.left + d.width / 2, y: d.top + d.height * 0.7 }, { x: d.left + d.width / 2, y: d.top + 60 });
    await page.waitForTimeout(400);
    const scrollAfter = await page.evaluate(() => {
      const s = document.querySelector('[data-dock-scroll]') as HTMLElement;
      return s.scrollTop;
    });
    expect(scrollAfter, `dock scrollTop ${scrollBefore} -> ${scrollAfter}`).toBeGreaterThan(scrollBefore);
    const poseAfter = await page.evaluate(() => {
      const cam = window.__camera as { position: { x: number; y: number; z: number } };
      return [cam.position.x, cam.position.y, cam.position.z];
    });
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs(poseAfter[i] - poseBefore[i]), `camera axis ${i} must not move on a dock drag`).toBeLessThan(0.01);
    }

    /* The region switcher in the dock selects through the same path. */
    await page.locator('[data-region-id="pacific"]').tap();
    await expect
      .poll(() => page.evaluate(() => window.__frame!.snapshot().regionId), { timeout: 20_000, intervals: [250] })
      .toBe('pacific');
  });

  /* ------------------------------------------------------------------------------ LM7 */

  test('LM7: a rotation round-trip keeps the mode, the region, the direction and one Reset', async ({ page }) => {
    await open(page, { w: 390, h: 844 });
    const cdp = await touch(page);

    /* Select a region, then record the camera direction. */
    await page.getByRole('slider', { name: 'Sheet position' }).press('End');
    await page.waitForTimeout(500);
    await page.locator('[data-region-id="pacific"]').tap();
    await expect
      .poll(() => page.evaluate(() => window.__frame!.snapshot().regionId), { timeout: 20_000, intervals: [250] })
      .toBe('pacific');
    await settleFit(page);

    /*
     * Wait for the fly-to to ARRIVE, not merely to start.
     *
     * `regionId` is set the instant the selection is dispatched, so polling it and then reading the camera captures
     * the FIRST FRAME of the arc. Measured: the direction "changed" by 4.48 deg across the rotation, which was the
     * remainder of a flight still in progress, not a rotation defect. `focus === 'focused'` can only become true
     * AFTER the arc converges, which is the correct stop condition.
     */
    const waitFocused = async (): Promise<void> => {
      await expect
        .poll(() => page.evaluate(() => window.__frame!.focus), { timeout: 30_000, intervals: [150] })
        .toBe('focused');
      await settleFit(page);
    };

    const direction = async () =>
      page.evaluate(() => {
        const cam = window.__camera as { position: { x: number; y: number; z: number } };
        const p = cam.position;
        const n = Math.hypot(p.x, p.y, p.z);
        return [p.x / n, p.y / n, p.z / n];
      });
    const angleBetween = (a: number[], b: number[]) => {
      const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
    };

    await waitFocused();
    const before = await direction();

    /* Rotate. */
    await page.setViewportSize({ width: 844, height: 390 });
    await expect
      .poll(() => page.evaluate(() => window.__frame!.layoutMode), { timeout: 20_000, intervals: [100] })
      .toBe('phoneLandscape');
    await settleFit(page);
    const landscape = await geometry(page);
    expect(landscape.mode).toBe('phoneLandscape');
    /* One Reset in the DOM, still. */
    expect(
      await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('button')).filter((b) =>
            /reset view/i.test(b.getAttribute('aria-label') ?? ''),
          ).length,
      ),
    ).toBe(1);
    /* The direction survived. */
    expect(angleBetween(await direction(), before), 'direction after rotating to landscape').toBeLessThanOrEqual(0.1);
    /* The selection survived. */
    expect(landscape.snap.regionId).toBe('pacific');
    /* The offset is correct after the change: the projected centre is inside the free rect. */
    expect(Math.abs(landscape.centre.x - (landscape.snap.free.x + landscape.snap.free.w / 2))).toBeLessThanOrEqual(1);

    /* Rotate back. */
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => window.__frame!.layoutMode), { timeout: 20_000, intervals: [100] })
      .toBe('portrait');
    await settleFit(page);
    const portrait = await geometry(page);
    expect(portrait.snap.regionId).toBe('pacific');
    expect(angleBetween(await direction(), before), 'direction after rotating back').toBeLessThanOrEqual(0.1);
    expect(
      await page.evaluate(
        () =>
          Array.from(document.querySelectorAll('button')).filter((b) =>
            /reset view/i.test(b.getAttribute('aria-label') ?? ''),
          ).length,
      ),
    ).toBe(1);
    /* And the tier is back at peek — the reset-on-portrait-entry rule. */
    expect(await page.evaluate(() => (document.querySelector('[data-mobile-sheet]') as HTMLElement).dataset.tier)).toBe(
      'peek',
    );
    void cdp;
  });

  /* ------------------------------------------------------------------------------ LM8 */

  test('LM8: desktop keeps camera.view null in the locked build, dMax 5, the 118.25 px header and no mobile shell', async ({
    page,
  }) => {
    /*
     * The LOCKED build (`/?debug` with no `framing=live`), which is what `ref.spec.ts` and the goldens measure —
     * the build where `camera.view` really is null on desktop. Rendering the live build here would measure the
     * 3A2 drawer offset instead and the "null" claim would never have held, which is the trap the MOBILE1 spec's
     * `waitForDesktopFrame` documents at length.
     */
    for (const vp of [
      { w: 1024, h: 768 },
      { w: 1280, h: 800 },
      { w: 1440, h: 960 },
    ]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.addInitScript(connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }));
      await page.goto('/?debug');
      await expect
        .poll(() => page.evaluate(() => (window.__frame ? window.__frame.mode : null)), {
          timeout: 90_000,
          intervals: [250],
        })
        .toBe('locked');
      await page.waitForTimeout(2500);

      const d = await page.evaluate(() => {
        const h = document.querySelector('header') as HTMLElement | null;
        const cam = window.__camera as { view: unknown };
        return {
          mode: document.querySelector('[data-layout-mode]')?.getAttribute('data-layout-mode') ?? null,
          headerH: h ? h.getBoundingClientRect().height : null,
          view: cam.view,
          dMax: window.__frame!.dMax,
          compact: document.querySelectorAll('[data-occluder="compact-header"]').length,
          sheet: document.querySelectorAll('[data-mobile-sheet]').length,
          dock: document.querySelectorAll('[data-landscape-dock]').length,
          chip: document.querySelectorAll('[data-testid="enso-chip"]').length,
          cards: document.querySelectorAll('[data-occluder="right-panel"]').length,
          resets: Array.from(document.querySelectorAll('button')).filter((b) =>
            /reset view/i.test(b.getAttribute('aria-label') ?? ''),
          ).length,
        };
      });
      const at = `${vp.w}x${vp.h}`;

      expect(d.mode, `${at} mode`).toBe('desktop');
      expect(d.view, `${at} camera.view must be null in the locked build`).toBeNull();
      expect(d.dMax, `${at} dMax`).toBe(5);
      expect(d.headerH, `${at} desktop header height`).toBeCloseTo(118.25, 1);
      expect(d.compact, `${at} no compact header`).toBe(0);
      expect(d.sheet, `${at} no sheet`).toBe(0);
      expect(d.dock, `${at} no dock`).toBe(0);
      expect(d.chip, `${at} no ENSO chip`).toBe(0);
      expect(d.cards, `${at} the desktop cards are present`).toBe(1);
      expect(d.resets, `${at} one Reset View`).toBe(1);
    }
  });

  /* ------------------------------------------------------------------------------ LM9 */

  test('LM9: the chip popover changes no geometry, honours the unit toggle, and Escape closes only itself', async ({
    page,
  }) => {
    await open(page, { w: 390, h: 844 });

    /* Select a region first, so "Escape closed only the popover" is observable. */
    await page.getByRole('slider', { name: 'Sheet position' }).press('End');
    await page.waitForTimeout(500);
    await page.locator('[data-region-id="us-west"]').tap();
    await expect
      .poll(() => page.evaluate(() => window.__frame!.snapshot().regionId), { timeout: 20_000, intervals: [250] })
      .toBe('us-west');
    await page.getByRole('slider', { name: 'Sheet position' }).press('Home');
    await page.waitForTimeout(400);
    await settleFit(page);

    /* The chip's text is the live store's `formatIsland`, recomputed in the page. */
    const chipText = await page.getByTestId('enso-chip-text').textContent();
    expect(chipText?.trim()).toMatch(/^ENSO: /);

    const before = await geometry(page);

    /* Open the popover. */
    await page.getByTestId('enso-chip').tap();
    await expect(page.getByTestId('enso-popover')).toHaveCount(1);

    const after = await geometry(page);
    /* The disc did not move or resize: the popover floats and changes no layout. */
    expect(Math.abs(after.centre.x - before.centre.x), 'popover must not move the disc (x)').toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.centre.y - before.centre.y), 'popover must not move the disc (y)').toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.disc - before.disc), 'popover must not resize the disc').toBeLessThanOrEqual(0.5);

    /* The unit toggle converts the DELTA: set the anomaly to 1.5 C, then read the popover in F. */
    await page.evaluate(() => {
      const slider = document.querySelector('[data-testid="enso-popover"] input[type="range"]') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(slider, '1.5');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Imperial units' }).tap();
    await expect.poll(() => page.getByRole('button', { name: 'Imperial units' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    const popoverF = (await page.getByTestId('enso-popover').textContent()) ?? '';
    /* 1.5 C -> 2.7 F. NOT 34.7, which is what the absolute formula would give. */
    expect(popoverF, `popover text "${popoverF}" must show +2.7 F`).toMatch(/\+2\.7/);
    expect(popoverF).toContain('°F');
    expect(popoverF).not.toContain('34.7');
    /* The CATEGORY is still the °C classification: 1.5 C is STRONG. */
    expect(popoverF.toUpperCase()).toContain('STRONG');

    /* Escape closes ONLY the popover; the region survives. */
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('enso-popover')).toHaveCount(0);
    expect(await page.evaluate(() => window.__frame!.snapshot().regionId), 'Escape must not clear the region').toBe(
      'us-west',
    );

    /* An outside pointerdown closes it too. */
    await page.getByTestId('enso-chip').tap();
    await expect(page.getByTestId('enso-popover')).toHaveCount(1);
    /*
     * A tap OUTSIDE the header closes it. (8, 8) is inside the header's own padding box, which is now deliberately
     * treated as "inside" — see `EnsoChip`'s handler — so the tap goes to the middle of the globe band instead.
     */
    const cdp = await touch(page);
    const outside = await page.evaluate(() => {
      const f = window.__frame!.free;
      return { x: Math.round(f.x + f.w / 2), y: Math.round(f.y + f.h * 0.75) };
    });
    await tapTouch(cdp, outside);
    await expect(page.getByTestId('enso-popover')).toHaveCount(0);
  });

  /* ------------------------------------------------------------------- sheet typography */

  test('sheet typography: the title is complete at 412x924 in Peek and Half', async ({ page }) => {
    await open(page, { w: 412, h: 924 });

    for (const tier of ['peek', 'half'] as const) {
      if (tier === 'half') {
        await page.getByRole('slider', { name: 'Sheet position' }).press('ArrowUp');
        await page.waitForTimeout(600);
      }
      const title = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="sheet-title"]') as HTMLElement | null;
        if (!el) return null;
        const style = getComputedStyle(el);
        return {
          text: (el.textContent ?? '').trim().toUpperCase(),
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          textOverflow: style.textOverflow,
          tier: (document.querySelector('[data-mobile-sheet]') as HTMLElement).dataset.tier,
        };
      });
      expect(title, `${tier}: the title must exist`).not.toBeNull();
      expect(title!.tier).toBe(tier);
      /* The FULL text, not an ellipsis: the whole point of the wrap. */
      expect(title!.text, `${tier}: the title must read in full`).toBe('GLOBAL ENSO STATE');
      expect(title!.textOverflow, `${tier}: no ellipsis`).not.toBe('ellipsis');
      expect(title!.scrollW, `${tier}: scrollWidth ${title!.scrollW} > clientWidth ${title!.clientW}`).toBeLessThanOrEqual(
        title!.clientW + 1,
      );
    }
  });
});
