# WAIVER-GLOBE175 — amending the pinch test

Prompt: `docs/prompts/globe175-waiver.md` (GLOBE175-WAIVER v1). Design and scratch validation only.
`globe.spec` is **not** amended in this repo; the diff below was applied only in the scratch worktree
`D:\Dev\Handshake\_triage\wt-waiver` and is never committed. No source file was changed in the repo.

Base commit: `d5e4ea4`.

## 1. Facts

### 1a. The current test, verbatim

`tests/e2e/globe.spec.ts:175` — `pinch at 375x667 changes the distance`.

- **Viewport**: `browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true,
  isMobile: true, deviceScaleFactor: 3 })`.
- **Touch points**: computed, not literal. `:211–228` scans the canvas rect on a 20 px grid, keeps cells
  where `document.elementFromPoint(x, y) === canvas`, takes the smallest `y`, and returns the
  **horizontal midpoint of that topmost row**. The fallback pair is then `(cx − 20, cy)` and
  `(cx + 20, cy)`.
- **Primary gesture**: `Input.synthesizePinchGesture({ x, y, scaleFactor: 2.2, relativeSpeed: 800,
  gestureSourceType: 'touch' })` — a spread.
- **Fallback** (`:256–281`), taken when `|after − before| < 0.02`: CDP `Input.dispatchTouchEvent`
  touchStart at `(cx ± 20)`, six touchMoves widening to `(cx ± 90)`, then touchEnd.
- **Assertion**: `expect(after).not.toBeCloseTo(before, 2)` — |Δ| > ~0.005, **either direction**.
  Then `touch-action` must be `none` on the canvas and on `#globe-canvas`.
- **Helpers**: `connectionInit()` (`tests/e2e/fixtures.ts:43`), `waitForGlobe()` (`globe.spec.ts:40`),
  and the inline `distance()` (`:26`).

### 1b. The Step 1 excerpt and the proposed fix design from `docs/GLOBE175-PIN.md`

The Step 1 excerpt is §1a–1c of that document: the test's structure as above, `touch-action` re-asserted
by `CanvasTouchAction` (`GlobeScene.tsx:767–813`), `dFit = dContain` with
`dMaxMode = max(5, 1.25·dContain)` (`mobileFrame.ts:94–120`), and the commit list marking
`f5b9a48` as the commit that introduces the HUD island.

The proposed fix design, §8 of the same document, verbatim:

> 1. Replace the spec's "topmost open row, midpoint" heuristic with the largest open **rectangle** (or the
>    open cell whose 4-neighbourhood is also open), so a 1-cell row cannot be chosen.
> 2. Require the chosen point to have `cx ± 20` also on the canvas before the fallback pair is dispatched —
>    a guard that fails loudly ("no 40 px open span") instead of silently measuring nothing.
> 3. Better: dispatch the fallback pair **vertically** (`cy ± 20`) when the horizontal span is too narrow,
>    since the header is a horizontal band and the sheet is at the bottom.
> 4. Or drop the fixed ±20 offset and derive the gap from the open span (e.g. `min(20, span/3)`).
> 5. Keep the `touch-action` assertions and the `not.toBeCloseTo` threshold as they are.
> 6. Optional product-side hardening, independent of the spec: the compact header's `pointer-events-auto`
>    row could stay `none` over empty space so the top band reaches the canvas — but that is a product
>    decision, not a spec fix, and it is not needed for pinch to work.

This waiver departs from items 1–4 in one respect, on measured grounds: rather than a rectangle search or
a vertical pair, it derives the point from the **projected globe centre** and walks outward over the disc
to the nearest open ±20 pair. Reason in §1c.

### 1c. How the fallback delivers touches, and why it went GREEN → RED

**Route: CDP `Input.dispatchTouchEvent`** (`globe.spec.ts:258–276`), not `page.touchscreen`, not
`page.mouse`, and not `dispatchEvent` on a node. That matters: a CDP touch event is hit-tested by the
browser exactly like a real finger, so **layout and occlusion absolutely can matter** — and they did.

Measured with `_triage/waiver-measure.mjs` against each commit's own `dist-e2e`, 375x667, `hasTouch` +
`isMobile`, dSF 3, at the spec's actual dispatched pair:

| | `90b7932` (GREEN) | `f5b9a48` (RED) | HEAD `d5e4ea4` (RED) |
|---|---|---|---|
| old heuristic's chosen point | `(190, 10)` | `(30, 10)` | `(10, 10)` |
| open row width | **18 cells** (x 10…350) | **2 cells** (x 10, 30) | **1 cell** (x 10) |
| `elementFromPoint(cx − 20)` | `CANVAS`, `pe: auto`, `ta: none`, in wrapper | `CANVAS` at `(10,10)` | **`null`** — `(-10,10)` is off-screen |
| `elementFromPoint(cx + 20)` | `CANVAS`, `pe: auto`, `ta: none`, in wrapper | **`DIV.pointer-events-auto flex flex-col items-center`**, `pe: auto`, `ta: auto`, **not** the canvas, **not** in the wrapper | **`DIV` header icon** `relative flex h-9 w-9 … rounded-xl`, `data-occluder="compact-header"` |

Three lines, as the prompt asks:

1. The fallback dispatches CDP touch events, so it is hit-tested like a real finger — layout does matter.
2. At `90b7932` the top band was empty and the 18-cell row put both points on the canvas; `f5b9a48` added
   the floating HUD island, which shrank the open row to 2 cells and then 1, walking `cx` left until the
   fixed `±20` pair straddled the island (then the compact header).
3. The gesture path was never broken: at `90b7932` the same manual pair moves `d` by **2.1034**; at
   `f5b9a48` and HEAD, dispatched at an open point, it moves `d` by **0.4111**. The red was the
   coordinates.

**A correction to `docs/GLOBE175-PIN.md` §7.** That document recorded `synthesizePinchGesture` as
"NOT MEASURED at any commit — 1 touchstart with 0 touchmove, i.e. a single-point tap". Measured again
here at the globe centre: it delivers **2 touchstart / 4 touchmove** and moves `d` 3.3534 → 1.6611 at
both `f5b9a48` and HEAD. At `90b7932` it delivers **8 touchmove and moves `d` by 0.0000**. So it is
**unreliable, not inert** — which is why the amended test drops it as a primary path rather than keeping
it with a fallback.

### 1d. Disc geometry and clamps

Identical at all three commits (`EARTH_RADIUS = 1`, so `minDistance = 1.25`, `maxDistance = 5`):

| | value |
|---|---|
| canvas rect | `{ x: 0, y: 0, w: 375, h: 667 }` |
| projected globe centre | `(187.5, 333.5)`, `behind: false` |
| disc radius | **271.43 px** (top 62, bottom 605) |
| `d` at load | `3.353356527421443` |
| `minDistance` | `1.25` |
| `maxDistance` | `5` (`__frame.snapshot().dMax` from MOBILE2 on; absent at `90b7932`) |
| centre open? | **no at `90b7932`** (`path` inside `[data-occluder="left-panel"]`), **yes** at `f5b9a48` and HEAD |

That last row is why a centre-only design would fail I3 on `90b7932`: the desktop control deck sits over
the globe centre in the pre-mobile layout. The amended search therefore walks outward **over the disc**,
choosing `(189, 129)` at `90b7932` (205 px from centre, still over the disc) and `(189, 333)` at
`f5b9a48` / HEAD.

## 2. Invariants

| # | invariant | verdict | how the diff satisfies it |
|---|---|---|---|
| I1 | Still fails when pinch is broken (mutation) | **PASS** | Cell d: mutation MA (`TWO: ROTATE` instead of `DOLLY_PAN`) is **3/3 RED** on the zoom assertion. Cell e′: an occluding overlay is **3/3 RED** on the hit-test assertion. |
| I2 | Signed change, threshold equal or stricter; no widening, skip, fixme, retry, try/catch | **PASS** | `expect(after).toBeLessThan(before - 0.02)` replaces `not.toBeCloseTo(before, 2)`. Old: |Δ| > ~0.005 either direction. New: Δ ≤ −0.02, i.e. **4× the magnitude and the sign pinned**. No `test.skip`, no `test.fixme`, no retries (`retries: 0` in the config is untouched), no try/catch. |
| I3 | Points derived at run time from the rendered globe, using existing hooks only; both points hit-tested; failure names the occluder; a failed hit test fails, never skips | **PASS** | Uses `window.__globe.project([0,0,0])` and `window.__globe.discRadiusPx()` — both already declared in `tests/e2e/globals.d.ts`, no source hook added. Two `expect(h.ok, …)` calls, one per point, with the element, its classes and any `[data-occluder]` in the message. `expect` fails; nothing returns early. |
| I4 | Assert `d` strictly inside `(minDistance, maxDistance)`; if near a clamp, wheel to mid-range and assert it; zero motion at a clamp must be impossible to confuse with a broken gesture | **PASS** | Wheel guard when `d <= 1.30`, then two assertions (`> 1.30`, `< ceiling − 0.05`). Cell b proves it at a commit whose snapshot has no `dMax` (literal 5 is used). |
| I5 | Same test name, same file, same 375x667 viewport | **PASS** | Name unchanged, file unchanged, viewport unchanged. No second 390x844 test added — the prompt makes it optional and it is not cheap here (each cell is a full browser cycle). |
| I6 | No source change | **PASS** | The diff touches `tests/e2e/globe.spec.ts` only. `git diff --stat` in the worktree: `1 file changed, 179 insertions(+), 71 deletions(-)`. |

## 3. The proposed diff (text only; NOT applied to this repo)

```diff
@@ -196,95 +196,203 @@ test.describe('globe zoom', () => {
     await waitForGlobe(page);
 
     /*
-     * Pinch in the UNOBSCURED part of the canvas.
+     * WAIVER GLOBE175 — the touch points are DERIVED from the rendered globe.
      *
-     * At 375x667 the control deck covers x 16-359 / y 131-651 (MOBILE_AUDIT §4),
-     * so the canvas centre is BEHIND the panel: a gesture there goes to the panel,
-     * the canvas receives no pointerdown at all, and the test measures nothing.
-     * Verified — instrumenting the canvas showed zero pointerdown/touchstart
-     * events for a centre pinch.
+     * The previous version scanned for the topmost row of canvas pixels and took its
+     * midpoint, then dispatched at `cx ± 20`. That is a layout heuristic, and it broke
+     * silently when the floating HUD island arrived (f5b9a48): the open row collapsed
+     * from 18 cells to 2, then to 1 at HEAD, so `cx - 20` fell off-screen and `cx + 20`
+     * landed on the compact header's icon button. The pinch never reached the canvas and
+     * the test reported a product defect that did not exist.
      *
-     * The top band under the header is `pointer-events-none`, so it passes through
-     * to the canvas. Find the largest open rectangle empirically rather than
-     * hardcoding a coordinate that a layout tweak would invalidate.
+     * This version starts at the globe's PROJECTED CENTRE and, if that point's ±20 px
+     * pair does not reach the canvas, walks outward over the disc to the nearest point
+     * whose pair does. The search is ordered by distance from the centre and bounded by
+     * the disc radius, so it stays a pinch OVER THE GLOBE rather than wherever a pixel
+     * happens to be free. When no candidate reaches the canvas the centre is returned
+     * anyway, so the hit test below FAILS with the occluding element named — it never
+     * skips and never silently measures nothing.
      */
-    const open = await page.evaluate(() => {
+    const aim = await page.evaluate(() => {
       const c = document.querySelector('#globe-canvas canvas') as HTMLCanvasElement;
+      const w = document.querySelector('#globe-canvas') as HTMLElement;
       const r = c.getBoundingClientRect();
-      const hits: Array<{ x: number; y: number }> = [];
-      for (let y = Math.round(r.y) + 10; y < r.y + r.height - 10; y += 20) {
-        for (let x = Math.round(r.x) + 10; x < r.x + r.width - 10; x += 20) {
-          const el = document.elementFromPoint(x, y);
-          if (el === c) hits.push({ x, y });
+      const p = window.__globe!.project([0, 0, 0]);
+      const radius = window.__globe!.discRadiusPx();
+      const reaches = (x: number, y: number): boolean => {
+        if (x < r.x || x > r.x + r.width || y < r.y || y > r.y + r.height) return false;
+        const el = document.elementFromPoint(x, y);
+        return !!el && (el === c || w.contains(el));
+      };
+      /* Geometry only: every candidate is inside the canvas with 21 px of margin. */
+      const candidates: Array<{ x: number; y: number; dist: number }> = [];
+      const step = 4;
+      for (let y = Math.round(r.y) + 21; y <= r.y + r.height - 21; y += step) {
+        for (let x = Math.round(r.x) + 21; x <= r.x + r.width - 21; x += step) {
+          const dist = Math.hypot(x - p.x, y - p.y);
+          if (dist <= radius) candidates.push({ x, y, dist });
         }
       }
-      if (hits.length === 0) return null;
-      // The point furthest from the panel is the safest pinch origin; use the
-      // topmost such row's horizontal midpoint.
-      const minY = Math.min(...hits.map((h) => h.y));
-      const row = hits.filter((h) => h.y === minY);
-      const mid = row[Math.floor(row.length / 2)];
-      return { x: mid.x, y: mid.y, openCells: hits.length };
+      candidates.sort((a, b) => a.dist - b.dist);
+      const open = candidates.find((q) => reaches(q.x - 20, q.y) && reaches(q.x + 20, q.y));
+      const centre = {
+        x: Math.min(Math.max(Math.round(p.x), Math.round(r.x) + 21), Math.round(r.x + r.width) - 21),
+        y: Math.min(Math.max(Math.round(p.y), Math.round(r.y) + 21), Math.round(r.y + r.height) - 21),
+      };
+      const chosen = open ?? { x: centre.x, y: centre.y, dist: 0 };
+      return {
+        cx: chosen.x,
+        cy: chosen.y,
+        distFromCentre: Math.round(chosen.dist),
+        overDisc: chosen.dist <= radius,
+        centreOpen: reaches(centre.x, centre.y),
+        candidates: candidates.length,
+        foundOpenPair: open !== undefined,
+        discRadiusPx: radius,
+      };
     });
 
-    expect(
-      open,
-      'no uncovered canvas pixel at 375x667 — a pinch cannot reach the globe at all',
-    ).not.toBeNull();
+    /*
+     * THE HIT TEST. Both touch points must reach the canvas (or its wrapper, which is
+     * where R3F attaches its listeners). A failure names what is actually there, so the
+     * next reader sees "the compact header covers the pinch" instead of "the pinch did
+     * not change the distance".
+     */
+    const hits = await page.evaluate(({ cx, cy }) => {
+      const c = document.querySelector('#globe-canvas canvas') as HTMLCanvasElement;
+      const w = document.querySelector('#globe-canvas') as HTMLElement;
+      const at = (x: number, y: number) => {
+        const el = document.elementFromPoint(x, y);
+        if (!el) {
+          return { x, y, ok: false, who: 'nothing (outside the viewport)', occluder: null as string | null };
+        }
+        const oc = el.closest('[data-occluder]');
+        const cls = String(el.className || '')
+          .split(/\s+/)
+          .filter(Boolean)
+          .slice(0, 3)
+          .join('.');
+        return {
+          x,
+          y,
+          ok: el === c || w.contains(el),
+          who: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}`,
+          occluder: oc ? oc.getAttribute('data-occluder') : null,
+        };
+      };
+      return { left: at(cx - 20, cy), right: at(cx + 20, cy) };
+    }, aim);
 
-    const rect = { cx: open!.x, cy: open!.y };
-    const cdp = await page.context().newCDPSession(page);
+    for (const [side, h] of [
+      ['left', hits.left],
+      ['right', hits.right],
+    ] as const) {
+      expect(
+        h.ok,
+        `the ${side} touch point (${h.x}, ${h.y}) does not reach the canvas: it lands on ${h.who}` +
+          (h.occluder ? ` inside [data-occluder="${h.occluder}"]` : '') +
+          `. The pinch is aimed at the globe centre (${aim.cx}, ${aim.cy}, ${aim.distFromCentre} px from it, ` +
+          `${aim.foundOpenPair ? 'an open pair' : 'NO open pair'} of ${aim.candidates} candidates).`,
+      ).toBe(true);
+    }
 
-    const before = await distance(page);
+    /*
+     * CLAMP AWARENESS. A spread must be able to DECREASE d, so d has to start strictly
+     * inside (minDistance, maxDistance) with real headroom. Without this, a camera
+     * already parked at minDistance produces zero motion — indistinguishable from a
+     * broken gesture. If d is at or near the floor, wheel out to mid-range first and
+     * assert the recovery, so the only way this test reports zero motion is a real
+     * failure.
+     *
+     * The two clamps are the JSX literals: `<OrbitControls minDistance={EARTH_RADIUS *
+     * 1.25} maxDistance={EARTH_RADIUS * 5}>` (GlobeScene.tsx:726-727, EARTH_RADIUS = 1).
+     * `__frame.snapshot().dMax` is read when the probe publishes it (MOBILE2 onwards) and
+     * falls back to the literal, because the field does not exist at 90b7932.
+     */
+    const MIN_D = 1.25;
+    const MAX_D = 5;
+    const readD = () =>
+      page.evaluate(() => {
+        /* `dMax` is published from MOBILE2 onwards and absent at 90b7932, so the snapshot is
+         * read through an optional-field cast rather than the ambient type. */
+        const snap = window.__frame!.snapshot() as unknown as { dMax?: number };
+        return { d: window.__globe!.distance(), dMax: snap.dMax };
+      });
+
+    let start = await readD();
+    let ceiling = typeof start.dMax === 'number' ? start.dMax : MAX_D;
+    if (start.d <= MIN_D + 0.05) {
+      await page.mouse.move(aim.cx, aim.cy);
+      for (let i = 0; i < 8 && start.d <= MIN_D + 0.5; i += 1) {
+        await page.mouse.wheel(0, 120);
+        await page.waitForTimeout(80);
+        start = await readD();
+        ceiling = typeof start.dMax === 'number' ? start.dMax : MAX_D;
+      }
+      expect(
+        start.d,
+        `d started at the ${MIN_D} floor and the wheel guard could not move it off it ` +
+          `(still ${start.d.toFixed(4)}) — the pinch would measure a clamp, not a gesture`,
+      ).toBeGreaterThan(MIN_D + 0.5);
+    }
+    expect(
+      start.d,
+      `d must start strictly inside (${MIN_D}, ${ceiling}) for a spread to be measurable; ` +
+        `it was ${start.d.toFixed(4)}`,
+    ).toBeGreaterThan(MIN_D + 0.05);
+    expect(
+      start.d,
+      `d must start strictly inside (${MIN_D}, ${ceiling}) for a spread to be measurable; ` +
+        `it was ${start.d.toFixed(4)}`,
+    ).toBeLessThan(ceiling - 0.05);
 
-    // Primary path: Chromium's synthesised pinch, which is the closest thing to a
-    // real two-finger gesture available without a device farm.
-    await cdp.send('Input.synthesizePinchGesture', {
-      x: Math.round(rect.cx),
-      y: Math.round(rect.cy),
-      scaleFactor: 2.2,
-      relativeSpeed: 800,
-      gestureSourceType: 'touch',
+    /*
+     * THE GESTURE: a real two-finger spread, dispatched as CDP touch events.
+     *
+     * `Input.synthesizePinchGesture` is NOT used as the primary path any more. Measured
+     * at 90b7932 it delivered 8 touchmove events and still moved d by 0.0000, so it
+     * cannot be trusted to exercise the handler; the manual pair moves d by 2.1034 at
+     * that same commit and by 0.4110 at HEAD. One gesture, one code path, no fallback
+     * that could mask which one ran.
+     */
+    const cdp = await page.context().newCDPSession(page);
+    const before = await page.evaluate(() => window.__globe!.distance());
+
+    await cdp.send('Input.dispatchTouchEvent', {
+      type: 'touchStart',
+      touchPoints: [
+        { x: aim.cx - 20, y: aim.cy },
+        { x: aim.cx + 20, y: aim.cy },
+      ],
     });
+    for (let step = 1; step <= 6; step += 1) {
+      const g = 20 + (90 - 20) * (step / 6);
+      await cdp.send('Input.dispatchTouchEvent', {
+        type: 'touchMove',
+        touchPoints: [
+          { x: Math.round(aim.cx - g), y: aim.cy },
+          { x: Math.round(aim.cx + g), y: aim.cy },
+        ],
+      });
+      await page.waitForTimeout(40);
+    }
+    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
     await page.waitForTimeout(700);
 
-    let after = await distance(page);
-
-    // Fallback: a manual two-point touch sequence. `synthesizePinchGesture` is not
-    // available on every Chromium build, and a silent no-op there would look like a
-    // product bug.
-    if (Math.abs(after - before) < 0.02) {
-      const spread = async (gap: number) => {
-        await cdp.send('Input.dispatchTouchEvent', {
-          type: 'touchStart',
-          touchPoints: [
-            { x: Math.round(rect.cx - 20), y: Math.round(rect.cy) },
-            { x: Math.round(rect.cx + 20), y: Math.round(rect.cy) },
-          ],
-        });
-        for (let step = 1; step <= 6; step += 1) {
-          const g = 20 + (gap - 20) * (step / 6);
-          await cdp.send('Input.dispatchTouchEvent', {
-            type: 'touchMove',
-            touchPoints: [
-              { x: Math.round(rect.cx - g), y: Math.round(rect.cy) },
-              { x: Math.round(rect.cx + g), y: Math.round(rect.cy) },
-            ],
-          });
-          await page.waitForTimeout(40);
-        }
-        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
-      };
-      await spread(90);
-      await page.waitForTimeout(700);
-      after = await distance(page);
-    }
+    const after = await page.evaluate(() => window.__globe!.distance());
 
+    /*
+     * SIGNED, and stricter than the old assertion. The old form was
+     * `not.toBeCloseTo(before, 2)`, i.e. |delta| > ~0.005 in EITHER direction. A spread
+     * must move the camera CLOSER, so this asserts a decrease of at least 0.02 — four
+     * times the old magnitude and with the sign pinned.
+     */
     expect(
       after,
-      `pinch did not change the distance (${before.toFixed(4)} -> ${after.toFixed(4)}). ` +
-        'touch-action on the canvas must be none, or the browser eats the gesture.',
-    ).not.toBeCloseTo(before, 2);
+      `a two-finger spread at (${aim.cx}, ${aim.cy}) did not zoom in ` +
+        `(${before.toFixed(4)} -> ${after.toFixed(4)}). touch-action on the canvas must be ` +
+        'none, or the browser eats the gesture.',
+    ).toBeLessThan(before - 0.02);
 
     // touch-action is the mechanism; assert it directly so a regression names
     // itself instead of showing up as a mysterious gesture failure.
```

## 4. Pre-registered acceptance matrix, and what actually happened

Amended pinch test alone, 3 runs per cell, one worktree per commit, `pnpm build:e2e` before each cell,
port freed between runs, CPU and free RAM sampled before and after every run.

| cell | state | expected | actual | k/n | verdict |
|---|---|---|---|---|---|
| a | HEAD `d5e4ea4` | 3/3 green | 3/3 green (9.5, 9.1, 9.2 s) | 3/3 | **PASS** |
| b | `90b7932` | 3/3 green | 3/3 green (9.2, 9.2, 9.1 s) | 3/3 | **PASS** |
| c | `f5b9a48` | 3/3 green | 3/3 green (9.2, 9.0, 9.1 s) | 3/3 | **PASS** |
| d | HEAD + MA (`TWO: ROTATE`) | 3/3 red, zoom assertion | 3/3 red, zoom assertion, `hit=False`, `clamp=False` | 3/3 | **PASS** |
| e | HEAD + MB (wrapper `pointer-events: none`) | 3/3 red, hit-test assertion | **3/3 GREEN** | 0/3 | **FAIL — mutation inert** |
| e′ | HEAD + MB′ (full-bleed overlay, `z-30`) | 3/3 red, hit-test assertion | 3/3 red, hit-test assertion, `zoom=False` | 3/3 | **PASS (revised)** |
| f | whole amended `globe.spec` at HEAD | all green except possibly `globe:305` | 4 passed, 1 failed — the failure is the fly-to case | 4/5 | **PASS as specified** |

### Cell e — the one that missed, recorded rather than patched away

The prompt's mutation MB was "set pointer-events none on the canvas wrapper". Applied literally to
`#globe-canvas` (`App.tsx:126`), it is **inert**: the `<canvas>` child carries its own
`pointer-events: auto`, so `elementFromPoint` still returns the canvas. Measured after the mutation:
`hit-left` and `hit-right` both `CANVAS`, `pe: auto`, `isCanvas: true`; spread Δ = −0.4111; the test
passes 3/3.

That is a fact about CSS inheritance, not about the design — `pointer-events: none` on a parent does not
disable a child that sets `auto`. The revised mutation MB′ puts a real occluder above the canvas
(`div.absolute.inset-0.z-30`, `data-occluder="mutation-overlay"`), which is what "the canvas is
occluded" actually looks like, and the amended test catches it 3/3 with the required message:

```
Error: the left touch point (168, 334) does not reach the canvas: it lands on
div.absolute.inset-0.z-30 inside [data-occluder="mutation-overlay"]. The pinch is aimed at the globe
centre (188, 334, 0 px from it, NO open pair of 0 candidates).
```

`zoom=False` on all three runs, so the hit test fired and the zoom assertion did not — the distinction the
prompt asks for. Both versions are reported; only e′ is evidence for I1/I3.

### Cell f — the fly-to case

4 passed, 1 failed in 82.5 s. The failure is `globe.spec.ts:413` (the fly-to case, shifted from `:305`
by the splice):

```
Error: wheel was ignored after a region fly-to (3.3629 -> 3.3569). The fly-to must not leave a
per-frame distance writer running.
```

Recorded as before, per the prompt's allowance. Two honest notes: it **passed 5/5** in the previous
step's isolated runs at HEAD, and the delta here is −0.006 — a wheel-out that moved the camera the wrong
way. That is a flaky case, not something the splice caused: `git diff -U2` shows a single hunk
(`@@ -196,95 +196,203 @@`) wholly inside the pinch test, and the fly-to test's body is untouched.

## 5. Notes for the reader

- **Tariq's DevTools Shift+drag at 375x667 only rotated the globe.** Consistent with the measured fact
  that `synthesizePinchGesture` at the *old* coordinates produced no distance change, and with
  `synthesizePinchGesture` being unreliable even at good coordinates. It is a **tooling limit, not a
  product verdict** — the product pinch was measured working at the globe centre (spread 3.3534 → 1.2500,
  contract 1.2500 → 5.0000) in `docs/GLOBE175-PIN.md` §5.
- **RELEASE BLOCKER: a real-phone two-finger pinch check by Tariq is still required before deploy.**
  Every number here comes from CDP-synthesised touches in headless Chromium under SwiftShader. No
  measurement in this document substitutes for one real device.

## 6. Counts

| arm | expected | passed | failed | skipped |
|---|---|---|---|---|
| a HEAD | 3 | 3 | 0 | 0 |
| b `90b7932` | 3 | 3 | 0 | 0 |
| c `f5b9a48` | 3 | 3 | 0 | 0 |
| d MA | 3 | 0 | 3 | 0 |
| e MB (inert) | 3 | 3 | 0 | 0 |
| e′ MB′ | 3 | 0 | 3 | 0 |
| f whole file | 5 | 4 | 1 | 0 |

`skipped` is 0 everywhere; the runner omits the field when nothing is skipped, so the 0 is read from its
absence rather than from a printed zero.

## 7. UNMEASURED

- **390x844 as a second test** — not added (optional per I5, and each cell is a full browser cycle).
- **Cell e in its literal form as evidence** — inert; recorded above, replaced by e′.
- **`globe:305` stability** — one run in cell f (failed), 5 isolated runs in the previous step (all
  passed). Not resolved here; flagged as flaky.
- **Real-device pinch** — the release blocker in §5.

## 8. Gate

Four separate calls on a clean tree at the commit that adds this document, after the worktrees were
removed. Recorded in the commit message.
