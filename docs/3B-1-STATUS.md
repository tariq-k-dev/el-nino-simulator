# 3B-1a-SPECLOCK status

Honest state. Gate (`pnpm tsc -b && pnpm lint && pnpm test && pnpm build`) is green at
every commit below. **STEP 3 is NOT complete**: two of its four cases fail, and both
failures are measurement-side, not render-side. Per the task's own rule ("if a real
measurement fails, STOP and report") they were not tuned away.

---

## STEP 0 — PREFLIGHT + DETERMINISM: **DONE** (`9757015`)

- Preflight: tree clean, `git log` contained `2e27939` and `40590e7`, gate green
  (494 tests at that point).
- **Starfield is now seeded.** `Math.random()` → `mulberry32` in
  `src/scene/starfieldData.ts`, seed `STAR_SEED = 0x5eed1e` in one place. 8 unit
  tests assert byte-identical buffers across two independent builds, that a
  different seed re-rolls, and that every attribute stays in range.
- **Scene clock is pinnable.** Flag `animate` in `globeLook.ts` plus
  `SpinState.frozen/frozenAt`, so the planet sits at an absolute longitude instead of
  wherever frame deltas happened to land. This was necessary and not obvious:
  pausing the spin alone still gave **17.4 mean-absolute-luma** difference inside the
  disc between two loads, while the sky (which the spin does not touch) matched to
  0.02. Cloud drift and star twinkle (`uTime`) had the same problem and are pinned
  too.
- **`window.__look`** (E2E-only, added to `FORBIDDEN_HOOKS`): `set`/`get` over the six
  layer booleans, plus `setAzimuth(deg)`. Toggling does **not** remount the Canvas —
  verified in-page: same canvas node, zero new WebGL contexts.
- **`tests/e2e/determinism.spec.ts`** — 2 passing. Latest run:
  `disc meanAbsDiff=0.00000 maxDiff=0.2 differing=3/332965`,
  `star field meanAbsDiff=0.00000 differing=0/564935`.
- One real bug found while writing it: `locator.screenshot()` on the canvas composites
  DOM *over* the canvas, so the EngineBadge's boot text put a 10 px band of
  differences at y 41–50 into the star comparison (368 of 1240 differing pixels).
  Chrome is now hidden for capture.

## STEP 1 — CLIPPED PIXELS: **DONE** (`38aa091`)

Facts in `docs/globe-look/CLIPPED-FACTS.md`.

Cause, from ablation (one toggle at a time, az 150/210/240):

| Toggle | 150 | 210 | 240 |
|---|---:|---:|---:|
| baseline | 49 | 24 | 38 |
| (shader) glint overlay OFF | 49 | 23 | 36 |
| bloom OFF | 44 | 22 | 31 |
| clouds OFF | 49 | 33 | 38 |
| atmosphere OFF | 49 | 24 | 38 |
| pins / rings / stars ON | 49 | 24 | 38 |
| **(material) specularIntensity = 0** | **0** | **0** | **0** |

**Grazing-angle sun glint from the surface material's own GGX specular** — offenders
at r/R 0.73–1.00, worst at the limb. Fixed by
`GLOBE_LOOK.surface.specularIntensity: 0.18 → 0`. Budget at the default view:
**mean luma −1.23%** (≤2%) and **night/day +0.0018** (≤0.02). All 12 azimuths after:
**0 clipped px, largest blob 0 px.**

This also falsified LOOK2's "isolated cloud highlights" explanation — clouds OFF does
not reduce the count and *raises* it at az 210.

## STEP 2 — LOOK HARNESS: **DONE** (`c16bfc3`)

- `src/lib/look/helpers.ts` — pure maths (luma, sampling, blob labelling,
  percentile/median, `transitionWidth`, glint point, sun axis, blur, meanAbsDiff).
  **42 unit tests** in `helpers.test.ts` on synthetic images.
- `tests/e2e/look/capture.ts` — chrome hiding, canvas capture, disc geometry,
  `settleAt`, `setLayers`, `frameNoise`, sun/camera read.
- `tests/e2e/look/measure.ts` — the four catalogues (rim, glare, blue-circle,
  terminator), each writing `test-results/look/*.json`.
- `tests/e2e/look/clipped-probe.mjs` — STEP 1's evidence, kept as the ablation table.
- **14 throwaway scripts deleted** via `git rm`:
  `globe-{measure,ablate,facts,probe2,halo,control}.mjs`, `globePixels.ts`,
  `look2-{ablate,frames,frames2,fix,pins,sweep,final}.mjs`.

The unit tests earned their place immediately: `transitionWidth` was wrong in the
silent direction (reported a 25 px transition as 90 px), which is exactly the error
that makes a hard terminator look soft.

## STEP 3 — look.spec.ts: **PARTIAL — 2 of 4 pass, 2 fail on measurement bugs**

`tests/e2e/look.spec.ts` exists with all four cases. Results:

| Case | Result | Raw measurement |
|---|---|---|
| 3.1 rim | **FAIL** | peak 93.56 @ +1px (≤110 ✔); shellVsBg 0.009 (≤2 ✔); maxAbsStep(+2..) 7.49 (≤16 ✔); **worstIncreaseOutward 15.37/255 @ 247.5°** (≤1 ✘) |
| 3.2 glare (12 azimuths) | **PASS** | 0 clipped, largest blob 0, every azimuth |
| 3.3 blue circle | **FAIL** | (344,392) ratio 1.000 ✔ PASS; **(300,392) ratio 3.702** ✘; (520,250) ratio 1.295 ✘ |
| 3.4 terminator | **PASS** | width measured from pixels (median of 5 parallel lines); noise floor reported |

### Both failures are the harness, not the render

**3.3 is unambiguous.** The window at `(300, 392)` sits at **r = 340.1 px = 1.045 R —
outside the disc.** It samples the atmosphere halo, where a local peak is expected.
That window list is mine, not the brief's: the brief required a 40×40 at (344,392)
(which passes at ratio 1.000) plus "a fixed list" for the others. `(520, 250)` fails
for a related reason — at 0.59 R it straddles the terminator, where a smooth
day/night gradient is a legitimate local maximum.

**3.1 needs one more measurement, not a threshold change.** The 247.5° ray:

| offset | −1 | 0 | +1 | +2 |
|---|---:|---:|---:|---:|
| luma | 77.16 | 72.95 | 89.24 | 72.61 |

Two facts found by probing the image directly:

1. **`__globe.discRadiusPx()` under-reports the visible limb by ~3 px.** The surface
   stays bright out to offset **+3** at *every* angle tested (240–270, 0, 90, 180), so
   the true limb is ≈328.6 px against the probe's 325.56 px. Anything called
   "offset 0" is still inside the planet.
2. The probe's formula is `tan(asin(R/d)) * focal` = 325.55; the perspective-exact
   silhouette is `sin(theta) * focal` = 310.74, and the observed limb implies an
   effective radius of ≈1.057 R. **That discrepancy is unresolved** — 1.057 R is
   suspiciously close to the 1.10 R atmosphere shell, so the "bright to +3" test may
   be catching shell contribution rather than surface. I did not guess in a commit.

So the 15.37/255 rise is a **~3 px mis-registration of the limb**, measured across a
boundary that steepens exactly there; the "outward of the peak" window starts on the
planet. Fixing it means establishing the true limb first (sub-pixel edge fit, or
excluding ±3 px of limb from the monotonicity window), then re-measuring — not
relaxing the 1/255 tolerance.

### Not done

- 3.4 is only partially implemented: the supplied task text was **truncated** at
  "median of 5 parallel lines at offsets -0.2R…". The median-of-5 measurement exists
  and passes, but the thresholds that follow are unwritten because I do not have them.
- Nothing after 3.4 (3.5+, mutation testing) appears in the supplied text, so it is
  not started rather than skipped.

### Next

1. Resolve the limb-radius discrepancy: compare `discRadiusPx()` against a fitted
   sub-pixel edge and decide whether the atmosphere shell contaminates what looks like
   surface. This affects 3.1 *and* every other disc-relative rule.
2. Re-measure 3.1 with the corrected limb.
3. Replace the `(300,392)` probe window with one inside the disc (e.g. `(420,392)`,
   r = 0.68 R); re-check `(520,250)` against the terminator.
4. Get the remainder of the 3.4 text and finish it.

---

## Gate

| Command | Result |
|---|---|
| `pnpm tsc -b` | clean |
| `pnpm lint` | clean (`--max-warnings 0`) |
| `pnpm test` | **544 passed** (21 files; +42 helper tests, +8 starfield tests) |
| `pnpm build` | 17 assets, **0 test hooks**, `check-assets` OK |
| `pnpm e2e` (determinism) | **2/2** |
| `pnpm e2e` (look.spec) | **2/4** — see above |
