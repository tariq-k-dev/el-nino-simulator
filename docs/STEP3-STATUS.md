# STEP 3 status

Session log for the Step 3 framing work. One row per step; each prompt lives in `docs/prompts/`.

| step | state | commit | notes |
|---|---|---|---|
| 2B-STEP3-A | PARTIAL — stopped at B, red gate | `8f9e1aa`, `01d0f83` | audit + status only; B was red |
| 2B-STEP3-A-FIX | **STOPPED at B2 — legacy verification red** | `4c7801d`, `01d0f83`, `70ca2b5` | uTime fix landed; N10 fails as a direct result |
| 2B-STEP3-A-FIX2 | D7/D8 diagnosis only | `33d2855`, `dec1745` | no code change; N10 unexplained intermittent |
| 2B-STEP3-A-FIX3 | P0 + D7 | `8c1fceb` | stopped: in-page control pair 0.7152 luma |
| 2B-STEP3-A-FIX3-V2 | P0 + E1 draft | `0aa0352` | stopped: cross-load pair 0.7152 luma / 221 px |
| 2B-STEP3-A-FIX3-V3 | **E1 + B2 done; B3 SKIPPED on D8 reading (3); C not started** | `24c76ab`, `a8f9ea2`, docs | 28/28, zero retries |
| 2B-STEP3-A (close) | **CLOSED** — 784 unit tests, 56 e2e, one waivered failure | `5db822c` | the 3A waiver, documented in `docs/E2E.md` |
| 2B-STEP3-A2 | **CLOSED** — framing behind a live/locked mode; zoom-out fit | `9f38053`…`this` | 819 unit tests; frame 20/20 in two isolated runs |
| 2B-STEP3-B | **CLOSED** — CameraDirector the single camera writer | `4c7801d`…`f1d659c` | 848 unit tests / 38 files; 90 e2e expected |
| 2B-STEP3-B2 | PARTIAL — audit found C1/C2; B (pure facing core) landed | `e1c97a1`, `0ffeddf`, `904b149`, `5e5c9ea`, `b53fded` | 880 unit tests / 39 files; stopped before C |
| 2B-STEP3-B2-CONT | **STOPPED at C** — AM5's pre-edit grep found C3 | `541b58b`, `4787efb` | AM1-AM5 recorded; C3 quantified |
| 2B-STEP3-B2-FIX1 | PARTIAL — A/B/E landed; C stopped at the C2 audit, D measured but not fixed | `2a76c2e`, `9d6bbaf`, `aad1338`, `dcf2214`, `199187e`, `a9df3ab` | 900 unit tests / 40 files; e2e expected 127 |
| 2B-STEP3-B2-CONT2 | **CLOSED** — live face-pin shipped, W1 + W2, Reset control, 22 focus-ux cases | `7cd793b`…`this` | 885 unit tests / 40 files; e2e expected 112 |
| 2B-STEP3-MOBILE1 | **CLOSED** — the mobile snap sheet, the HUD island, the vertical view offset | `f7a8332` | 1020 unit tests; mobile-sheet 15/15 |
| 2B-STEP3-MOBILE2 | **CLOSED** — the layout law, the free rect, the unclamped ceiling, the dock | `cf8b0a6`…`7d7db34` | 1090 unit tests / 48 files; layout-matrix 10 cases |

---

## 2B-STEP3-B2-FIX1 — runner hardening, Reset, cards audit, pin measurement, D10

Head before the step: `5e7c826`. **Steps A, B and E landed; C stopped at its own C2 audit; D measured the
defect and did not fix it.** Reported this way because that is what the tree contains.

| step | commit | result |
|---|---|---|
| P0 | `2a76c2e` | the prompt alone |
| A | `9d6bbaf` | runner hardening: timeout kills the file's tree AND its server, the port is proved free, an HTTP liveness probe runs before every file, a file the harness cannot serve is `not-run (infra)`, summaries archive to `.cache/e2e-archive/`, `--self-test` proves the kill path (7/7 twice) |
| B | `aad1338` | Reset View returns to the exact load state; `reset-ux.spec.ts` 11/11; S1 residual 0 with sha `934ecd13` unchanged |
| C | `dcf2214` | **STOP at C2.** The cards are visually covered by the 86-90 % opaque drawer panel, not blocked by a transparent wrapper |
| D | `199187e` | **measurement only.** front 9/23, back 13/24; hypothesis (f) confirmed, the pin fix not implemented |
| E | `a9df3ab` | D10 report: 15 runs at one commit, 15-320 px, load and warm-up ruled out |

**Unit tests: 900 / 40 files** (885 + 7 for A + 8 for B). **e2e expected 127** (112 + 11 + 4).

### Full batched run (one run, hardened runner)

34.8 min, **15/17 files**, **127 tests ran**: 125 passed, 2 failed, 0 skipped, 127 expected. Zero retries and
zero `not-run (infra)` rows — no timeout fired. Archived immediately to
`.cache/e2e-archive/2026-11-01T07-13-45-821Z-batched-summary.json`.

| file | status | passed | failed | skipped | expected | wall |
|---|---|---:|---:|---:|---:|---:|
| boot | ok | 10 | 0 | 0 | 10 | 404.6 s |
| camera-golden | ok | 9 | 0 | 0 | 9 | 146.3 s |
| determinism | ok | 2 | 0 | 0 | 2 | 15.4 s |
| focus-ux | ok | 22 | 0 | 0 | 22 | 316.0 s |
| frame-director | ok | 5 | 0 | 0 | 5 | 40.3 s |
| frame | ok | 20 | 0 | 0 | 20 | 121.3 s |
| gate-clock | ok | 1 | 0 | 0 | 1 | 52.0 s |
| globe | ok | 5 | 0 | 0 | 5 | 52.9 s |
| harden | ok | 8 | 0 | 0 | 8 | 108.7 s |
| history-gate | ok | 1 | 0 | 0 | 1 | 16.2 s |
| limb | ok | 2 | 0 | 0 | 2 | 15.4 s |
| look | ok | 9 | 0 | 0 | 9 | 317.4 s |
| **negative** | **FAIL** | 13 | **1** | 0 | 14 | 194.1 s |
| **pin-click** | **FAIL** | 3 | **1** | 0 | 4 | 129.2 s |
| ref | ok | 2 | 0 | 0 | 2 | 13.2 s |
| reset-ux | ok | 11 | 0 | 0 | 11 | 135.0 s |
| scene-gate | ok | 2 | 0 | 0 | 2 | 11.0 s |
| **total** | **15/17** | **125** | **2** | **0** | **127** | **34.8 min** |

125 + 2 + 0 = 127. `testsSkipped` came back `null` for every file (Playwright prints no skipped count for a
suite with none); the 0 is that null read as zero.

**Red 1 — N10, KNOWN-RED.** `negative.spec.ts:579`, `differing=263` against `<= 50`, `maxAbs=0.7152` against
`<= 1.0`. Classified by the step-N rule (maxAbs within the floor, only the px assertion failed). `docs/D10-REPORT.md`
measured the same check 15 times at one commit: 15-320 px, 4 greens.

**Red 2 — D4, INTENDED.** `pin-click.spec.ts` D4 asserts post-fix behaviour and the fix is not in the tree.
It names every failing angle; `docs/STEP3D-PIN-AUDIT.md` carries the pre-fix numbers. Not rerun in isolation:
there is nothing for it to pass with, and calling that an artifact would be false.

### Deviations, stated plainly

1. **B needed no WAIVER W3**: the B1 grep found no assertion outside `focus-ux.spec.ts` U5/U6 that the new
   Reset behaviour contradicts, and U5/U6 both still pass unedited (U6's `regionId` null assertion is now also
   satisfied by the selection clear). W3 was therefore not spent.
2. **Reset publishes `hasRegion` through `viewStore`** rather than deriving the enable state from the pose. The
   prompt's wording ("enabled whenever `activeRegion` is non-null") needs that flag somewhere React can read
   without a frame, and the store was already the one thing it reads from the scene.
3. **Step C stopped** rather than choosing among the options, as C2 requires.
4. **Step D implemented no fix.** D1/D2 are measured and committed; the two candidate fixes are specified in
   the audit doc but not written.
5. **Step E's worktree arm was not run** — all 15 runs are at one commit, and the report says so rather than
   presenting three commits it did not check out. Its "after heavy file" and "warm vs cold" arms were also not
   run; both are declared unmeasured in the report.

---

## 2B-STEP3-B2-CONT2 — live face-pin policy closed

Head before the step: `4787efb`. The author accepted WAIVER W2 (option 3 from the C3 stop: a second
named waiver rather than dropping the golden target oracle), so the step ran C through G to completion.

### What shipped

| step | commit | content |
|---|---|---|
| P0'' | `7cd793b` | the cont2 prompt alone |
| C — W1 | `a694a38` | `frame.spec.ts` F8: `aimMoved > 0.1` -> `|target| <= 1e-6`, **3 added / 3 removed** |
| C — W2 | `1d95d22` | `camera-golden.spec.ts`: mode-aware start signal + mode-aware target oracle |
| C — policy | `46870bc` | `runLockedFlyTo` (legacy, verbatim) + `runLiveFlyTo` (face-pin), `viewStore`, probe fields, live goldens regenerated |
| D | `bf25afd` | `ResetViewButton` in the header right cluster, `aria-disabled` per `viewIsDefault`, +5 unit tests |
| E | `170e6a3` | `focus-ux.spec.ts` U1-U10, 22 cases, registered in the batched runner (13 min backstop) |
| F | this commit | `docs/E2E.md`, this file, `docs/STEP3B2-DESIGN.md` §11 as-built |

### The numbers

- **LIVE goldens, after regeneration:** `target = (0,0,0)` and `distance = 4.35719` for all four regions at
  1440x900 — `d_fit` of the OPEN rect, not the pin's legacy `zoom`. LOCKED entries byte-identical in every
  asserted field; only `flyMs` (unasserted) moved.
- **U1:** every region at every viewport has angle error `0.0000` deg and pin px error `<= 0.055`. Worst
  across both final runs: 0.055 px.
- **U2:** 1440x900 disc 276.432 vs analytic 276.432, envelope 306.58 vs `rMax` 306.578, margins to the free
  rect 54.15 / 114.44 px; 1280x800 CLAMPED, analytic envelope overflow **+8.971 px** vs measured 235.556
  (**+0.007 px** agreement); 1024x768 centring only, centre error 0.027 px.
- **S8(a):** start 3.77857, minimum 3.77859, end 4.35711 (`d_fit` 4.35719), **0 decreasing steps**, worst
  step 4.44e-16. **S8(b):** span **0.00e+0** in both runs.
- **U4:** 180.00 deg pair (pacific -> horn-africa), dip below start **-1.1e-4** (i.e. it ROSE).
- **U5** all three close paths, **U6**, **U7** (first frame exactly 26.4 % of the remaining arc, pivot
  moved 0.0e+0 R), **U8** (drift 8e-6 deg over 500 ms), **U9** (0.000 px), **U10** (header 118.25 px).
- **S1** residual 0 and sha unchanged in two processes; **S3** worst 1.78e-15 R; **S4** 5/5.
- **Gate:** 885 unit tests / 40 files, lint clean, build clean.

### Deviations (full reasons in `docs/STEP3B2-DESIGN.md` §11)

`viewIsDefault` kept at the prompt's 0.002 and made to work by polling the fit to rest in the spec; U2's
containment oracle is the PIN ENVELOPE rather than the planet (they are different circles); S8(b) carries a
1e-5 backstop for the fit's tail while the direction channel measures exactly 0; U7 samples per rAF because
a CDP round trip is 18 frames; and the drawer occludes the cards, so retargets are driven by keyboard or by
a pin click.

---

## 2B-STEP3-B2-CONT — amendments recorded, stopped before step C on C3

The continuation prompt's AM1-AM5 are recorded in `docs/STEP3B2-DESIGN.md` §8, with the AM1 distance
table computed from `frame.ts` for all four viewports. AM1 and AM5 resolve C1 and (**only**) F8.

**C3, found by the pre-edit grep AM5 mandates.** `tests/e2e/camera-golden.spec.ts` reads
`controls.target` in live mode in two places, neither of them F8:

| site | what it does | under face-pin |
|---|---|---|
| `:236-247` | `flyTo()`'s "the selection was received" poll: `|__globe.target()| > 0.02`, 15 s timeout, used by locked AND live cases | `|target|` is exactly 0 for the whole arc → the poll never turns true → the 4 live cases throw after 15 s |
| `:347` | `expect(err.target).toBeLessThanOrEqual(1e-5)` against fixture targets of `|t|` 0.996-1.000 R | error 0.999 R, 1e5 x the tolerance |

Because `flyTo()` is also what step C's `UPDATE_GOLDEN=1` regeneration runs, **the live golden entries
cannot be regenerated at all** under the live policy — so S3's live half cannot be produced. Repairing
it needs ~8-12 lines in a second existing spec file, i.e. a second S2 exception that AM5 does not
grant (AM5 is "one existing-spec edit", `frame.spec.ts` F8, ≤ 6 lines).

Triggered: **AM5** ("any conflict other than F8 means STOP") and **S2** (second exception).
Not triggered: S1, S3-literal (locked half untouched), S4, S5, S6, S7, S9. No product code changed.

**Resumption point:** choose one of the three options in `docs/STEP3B2-DESIGN.md` §9 ("The three ways
forward"), amend AM5 into a W1 + W2 pair, then re-enter at step C. Everything before C is committed:
`facing.ts`/`easing.ts` (32 tests, 880 total) are independent of both the director policy and this
spec conflict, so none of that work is at risk.

---

## 2B-STEP3-A2 — FrameOffset and fit distance (zoom-out only)

### Commits

| step | commit | what |
|---|---|---|
| P0 | `9f38053` | prompt alone, `docs/prompts/step3-a2.md` |
| A | `d656f61` | `docs/STEP3-FRAME.md` design memo |
| B | `6ce8359` | `src/layout/frame.ts` + `frame.test.ts` (pure `computeFrame`) |
| C | `f1d6ff3` | `FrameRig`, `framing.ts`, `frameProbe.ts`, insets observer start |
| D | `2ab1e36` | `tests/e2e/frame.spec.ts` (F1-F10) + runner registration |
| E | this commit | docs: framing modes, measured tables, 3A2 closure |

### The framed numbers (measured, not derived)

Insets measured live in the browser via `[data-occluder]` at every viewport:
**L 360.844, R 316, T 118.25, B 0** — the Step 3A figure for 1440x900 exactly, and identical at the
other three viewports because every panel is fixed-size and edge-anchored.

| viewport | free (w x h) | free centre | dx, dy | r_max | d_contain | **d_target** | silhouette at d_target |
|---|---|---|---|---|---|---|---|
| 1280x800 | 603.156 x 681.750 | 662.422, 459.125 | +22.422, +59.125 | 277.578 | 4.282829 | **4.282829** | 250.23 |
| 1024x768 | 347.156 x 649.750 | 534.422, 443.125 | +22.422, +59.125 | 149.578 | 7.454770 | **5.000000** | 204.20 (**clamped**, 54.6 px over) |
| 1440x900 | 763.156 x 781.750 | 742.422, 509.125 | +22.422, +59.125 | 357.578 | 3.778586 | **3.778586** | 321.74 |
| 1280x720 | 603.156 x 601.750 | 662.422, 419.125 | +22.422, +59.125 | 276.875 | 3.893455 | **3.893455** | 249.23 |

`d0` = **3.3533565** (`DEFAULT_POSITION.length()`, shipped as 3.3534), `dMax` = 5.

**The 1024x768 clamp is a product fact, not an implementation detail.** The layout needs 7.455 to fit
the disc but `<OrbitControls maxDistance>` caps at 5, so the disc renders 54.6 px larger than the free
rect allows and `pacific` (1.10 r/R, on the silhouette) falls outside the padded rectangle. Raising
`dMax` is a zoom-range product decision, so it was **not** changed; F4 asserts both branches and
reports which one bound.

### F1-F10 results

| case | result | numbers |
|---|---|---|
| F1 locked default | **pass** | mode locked, `cameraViewIsNull` true, projection element `[8]` = 0, distance 3.3534 |
| F2 centring x4 | **pass** | centre error 1280x800 **(0.016, 0.000)**, 1024x768 **(0.027, 0.036)**, 1440x900 **(0.027, 0.000)**, 1280x720 **(0.039, 0.000)** px |
| F3 fit x4 | **pass** | live distance = `max(d0, d_contain)` to < 0.001 at all four; never below d0 |
| F4 pins x4 | **pass** | 2 front-facing of 4 everywhere; all inside the padded rect where the fit binds; the clamp branch reports `pacific` 51.6 px outside and asserts the overhang |
| F5 resize + return | **pass** | 1440x900 `3.778411` → 1024x768 `4.999797` → back `3.778789` (Δ **0.000378**, limit 0.001); offset returns to (22.4219, 59.1250) exactly |
| F6 user zoom wins | **pass** | fitted 3.7784 → user 3.0462 → after resize **3.0462 unchanged**; fit target moved (3.7786 → 3.8935) and the offset was re-installed |
| F7 orbit invariance | **pass** | az 120 moves the centre **0.016 px**; free centre unchanged |
| F8 drawer x2 | **pass** | see below |
| F9 picking | **pass** | clicked `us-west` at 0.605 r/R with offset (22.42, 59.13) → drawer opened |
| F10 zoom after fly-to | **pass** | d 3.3867 → 3.4747 (Δ **0.088**), polled, no fixed sleep |

### F8 drawer facts

| viewport | right inset | transition | free width | centre error (AIM vs free) | d |
|---|---|---|---|---|---|
| 1440x900 | 316 → 418 | **605 ms** | 763.2 → 661.2 | **(0.024, 0.000)** px | 3.7784 → 2.5962 |
| 1280x720 | 316 → 418 | **450 ms** | 603.2 → 501.2 | **(0.049, 0.000)** px | 3.8935 → 2.5966 |

**The insets store settles AFTER the transition, not during it** — 450-605 ms against the 500 ms
`duration-500` transform, i.e. driven by `transitionend` as designed, not by a `ResizeObserver` (a
transform does not fire one). Closing returns the offset to (22.422, 59.125), aim error 0.037 px.

### Two oracle corrections worth carrying forward

1. **A view offset moves the AIM point, not the world origin.** After a fly-to `controls.target` sits
   on the pin, so `project([0,0,0])` lands 126 px from the free centre while the aim point lands
   0.024 px from it. F8 asserts on the aim point (`__globe.target()` was added for this) and prints
   the origin error beside it so the difference is visible rather than implied.
2. **`__frame.settled` alone is not "the page is at rest".** For ~1 s after load the insets are the
   pre-mount approximation and the rig is correctly settled *against that*: measured `settled: true`
   at dx 14.0313, then the real insets arrive and dx must reach 22.4219. `settleStable()` requires
   the same insets/free/target twice running.

### Bugs this step found in its own code

| bug | symptom | fix |
|---|---|---|
| ease gated on the write threshold | offset stalled at 22.3653 vs target 22.4219, 0.057 px short **forever** — the remaining error fell below `0.01/0.09` so nothing was ever applied again | ease an ideal `easedOffset` that always advances; gate only `setViewOffset` on 0.01 px |
| `settled` = "reached target" with a foreign distance owner | unsatisfiable after any fly-to (camera parks at 2.6, target 5.0), so F8 timed out at 5 s with the offset already correct to 0.03 px | `settled` = offset arrived AND (rig owns distance ? arrived : not moving); "not moving" is a 4-frame span < 2e-4 |
| `camera.view === null` as the offset test | `clearViewOffset()` only sets `view.enabled = false`, so a null check reported the **inverse** of the truth | test `view === null \|\| view.enabled === false` |
| insets observer never started | live mode would have measured `ZERO_INSETS` and written nothing — the registry was built in 3A with a test seam and no caller | `startInsetsObserver(document, window)` at module scope in `main.tsx` |

### Locked-mode proof

| check | result |
|---|---|
| `ref.spec.ts` residual, process 1 | `maxAbs=0 differing=0 perChannelExact=true`, crop 732x732 at (274,34), **735.2 KB** |
| `ref.spec.ts` residual, process 2 | identical |
| PNG sha256 (both) | **934ecd132ee474247136fd429f6442e1d52f1115d46cf1ce50da77b8f4d29a44** — unchanged |
| `globe.spec.ts` isolation | **5/5**, 53.0 s (incl. "zoom still works after a region fly-to") |
| `scene-gate.spec.ts` / `limb.spec.ts` | **2/2** / **2/2** (R_fit vs `discRadiusPx` within 0.111 px) |
| production bundle marker grep | `frame-locked-branch-7f3a`: **0** in `dist/`, **1** in `dist-e2e/assets/index-*.js` |

### Unit tests

**819 passed / 36 files** (3A closed at 784 / 33). New: `frame.test.ts` **19**, `framing.test.ts`
**9**, `frameProbe.test.ts` **7** = **35**; 784 + 35 = 819.

### Deviations from the prompt

1. **`__globe.target()` was added** (one getter) so F8 could assert on the aim point; without it the
   case either asserts the wrong thing or cannot be written.
2. **F4 is conditional on the clamp** at 1024x768 — the blanket assertion is arithmetically
   impossible there without raising `dMax`. Both branches are asserted and the overhang must exceed
   40 px, so the escape hatch cannot swallow a regression.
3. **F5 uses 1024x768, not 1280x720**, as its intermediate viewport: 1440x900 → 1280x720 differs by
   only 0.0357, too little to be meaningful against a 0.001 return tolerance.
4. **F6 asserts the offset is unchanged, not changed** — the insets are identical at 1440x900 and
   1280x720, so `dx`/`dy` are the same numbers by geometry.
5. **`src/scene/FrameRig.tsx` was edited inside the step-D commit** (the 4-frame stillness ring, and
   a fold instead of `Math.max(...)` which `source-guards.test.ts` forbids in `src/`). One commit per
   step is preserved; the file's step-C content is `f1d6ff3`.
6. **The parked `VITE_E2E` vs `?debug` gate mismatch was reported, not fixed** — `__globe` and
   `__frame` need both, the build needs only the env var.

### F: the full batched run

12/12 files ran, **76/76 tests executed** (the 74 expected plus `look.spec.ts`'s 9 and
`negative.spec.ts`'s 14 being counted inside it), 10/12 files green, **0 retries**, 21.7 min total.
Summary copied immediately to `.cache/e2e-results/batched-summary-20261031-133622-full-a2.json`.

| file | passed | failed | skipped | expected | retries | wall |
|---|---:|---:|---:|---:|---:|---:|
| boot.spec.ts | 10 | 0 | 0 | 10 | 0 | 417 s |
| determinism.spec.ts | 2 | 0 | 0 | 2 | 0 | 16 s |
| **frame.spec.ts** | **20** | 0 | 0 | 20 | 0 | 121 s |
| gate-clock.spec.ts | 1 | 0 | 0 | 1 | 0 | 51 s |
| **globe.spec.ts** | **5** | 0 | 0 | 5 | 0 | 54 s |
| harden.spec.ts | 8 | 0 | 0 | 8 | 0 | 121 s |
| history-gate.spec.ts | 1 | 0 | 0 | 1 | 0 | 16 s |
| limb.spec.ts | 2 | 0 | 0 | 2 | 0 | 15 s |
| look.spec.ts | 7 | **2** | 0 | 9 | 0 | 272 s |
| negative.spec.ts | 13 | **1** | 0 | 14 | 0 | 195 s |
| ref.spec.ts | 2 | 0 | 0 | 2 | 0 | 13 s |
| scene-gate.spec.ts | 2 | 0 | 0 | 2 | 0 | 11 s |
| **total** | **73** | **3** | **0** | **76** | **0** | 21.7 min |

`globe.spec.ts` **5/5 including "zoom still works after a region fly-to"** — so S4 does not fire and
the Step 3A waiver is formally cleared for this step.

**Isolation reruns of the two red files:**

| file | isolation result | verdict |
|---|---|---|
| `look.spec.ts` | **9/9**, 318 s | the two full-run failures were **load**, not product. Both are the 3.4 terminator pair, which the audit already documents as needing 7 reloads and 3.3 min on its own. |
| `negative.spec.ts` | 13/14, **N10 fails again** | see the bisection below |

### N10 is pre-existing, bisected, not a 3A2 regression

N10 fails with the documented signature — **control-vs-control in-page `maxAbs = 0.7152`** against a
`<= 1 luma / <= 50 px` tolerance, over **129 differing px** of 333 185 sampled
(`docs/globe-look/SPEC.md` §5.5; V2 measured 221 px inside the same process; D8 measured exact
zeros on fresh contexts). That is the unexplained jitter, not a framing defect.

It is also **not caused by this step**, and the ablation says so: with `startInsetsObserver` removed
from `main.tsx` and the bundle rebuilt, N10 fails identically at **0.7152 / 141 px**, and every other
negative case still passes 13/14 the same way. The only thing 3A2 added to a locked-mode page was
starting that observer, and removing it changes nothing. Restored after the measurement; the tree is
clean.

That makes three independent facts pointing the same way: locked mode is byte-identical (`ref.spec`
strict 0, sha256 unchanged, in two processes), the camera is untouched (F1, `globe.spec` 5/5), and
the one red negative test fails the same with the step's new code switched off.

### Not started, per the prompt

No focus state machine, no `userZoomed` flag (the `lastFit` stand-in is not it), no single
camera-writer refactor, no sun changes, no mobile layout.

---

## 2B-STEP3-A-FIX (current session)

### P0 preflight — done

- HEAD `8f9e1aa`; `git status` showed exactly the four expected untracked files plus the prompt.
- Orphan sweep clean: no `node.exe`, no `ms-playwright` chromium, no Brotli listener. The
  `chrome.exe` entries resolve to `C:\Program Files\Google\Chrome\Application\chrome.exe` —
  the user's own browser, not this repo's.
- Prompt committed alone as `4c7801d`.

### A audit commit — done (`01d0f83`)

`docs/STEP3-AUDIT.md` + `docs/STEP3-STATUS.md`, docs only, by explicit path.

### B1 the uTime fix — done, gate green (`70ca2b5`)

Helper `src/scene/lookTime.ts`:

```ts
export const FROZEN_LOOK_TIME = 0;
export function lookTime(animate: boolean, elapsed: number): number {
  return animate ? elapsed : FROZEN_LOOK_TIME;
}
```

- `animate` true returns `elapsed` unchanged, so the live product is byte-identical.
- `animate` false returns the constant **0** — the same value `Starfield.tsx:109` already froze at,
  chosen so the whole frozen scene shares one number. Not "the last clock value": that differs per
  load, which is the failure `Starfield.tsx:101-108` documents.
- Call sites: `Globe.tsx:224` (atmosphere breathe), `Hotspot.tsx:58` (pin ring pulse).

Formulas, for the record:

| term | formula | at `uTime = 0` |
|---|---|---|
| atmosphere breathe (`shaders.ts:114`) | `1 - uBreatheAmp + uBreatheAmp * sin(uTime * 0.6)` | `1 - 0.015 = 0.985` (the trough) |
| pin ring pulse (`shaders.ts:227`) | `fract(uTime * 0.45 + uPhase)` | `fract(uPhase)` |

Unit tests: 6 in `src/scene/lookTime.test.ts`. Gate (one cell): `tsc -b`, `lint`, `test`
(**760** = 754 + 6), `build` — all green, exit 0.

### B3 residual matrix — done, every pair exactly 0, no tolerance

Three fresh page loads x three captures each, plus cross-load pairs (`scripts/tmp-refmatrix.mjs`,
untracked):

| scope | loads | pairs | max \|dLuma\| | pixels > 1/255 |
|---|---|---|---:|---:|
| in-page | A, B, C | 9 (#0~#1, #1~#2, #0~#2 each) | **0** | **0** |
| cross-load | A~B, A~C, B~C | 6 (#0 and #2 each) | **0** | **0** |

Pre-registered rule applied: **every pair exactly 0 ⇒ the equivalence test requires exactly 0.**
No fallback tolerance was invoked and none is needed. The previous session's residual is gone,
which is the B1 fix working.

### B2 legacy verification — **RED. STOPPED HERE.**

`pnpm e2e:look` through the batched runner: **27/28, not 28/28**. `negative.spec.ts` N10 fails.

| test | control | defect | verdict |
|---|---|---|---|
| N9 (overlay off) | max 88.52, area6 9594 | identical frames, 0 differing px | ok |
| **N10 (si 1.0, no roughness floor)** | max 88.52, area6 9594 | **max 87.52, maxAbs 87.52, area6 9401** | **FAIL** |

N10 requires `defect.max > 110.7` (or `area6 > 12472`) and that the defect *adds* specular. It
measures 87.52 / 9401 — the defect now *lowers* the peak by 1.0.

**Caused by the B1 fix, and the bisection is unambiguous.** Same tree, same bundle pipeline, one
file reverted per build, N10 run in isolation each time:

| Globe.tsx | Hotspot.tsx | N10 defect | verdict |
|---|---|---|---|
| parent `01d0f83` | parent | max 136.96, maxAbs 218.66, area6 10523 | **pass** |
| fixed | fixed | max 87.52, maxAbs 87.52, area6 9401 | **fail** |
| parent | fixed | max 87.52, maxAbs 87.52, area6 9401 | **fail** |
| fixed | parent | max 122.74, maxAbs 196.83, area6 10754 | **pass** |

So it is the **atmosphere** gate specifically, not the hotspot gate. Both files were restored to
HEAD afterwards.

Why an atmosphere change moves a specular difference image: 3.9 is a difference of two frames
that differ only in the specular contribution, and the additive atmosphere shell is composited
over the disc. Freezing the breathe at 0 (its trough) makes the halo ~1.5 % dimmer than the phase
the baselines were recorded at, shifting every compared pixel — so the defect's difference is
taken against a slightly different base. Measured live (`scripts/tmp-n10-phase.mjs`, frozen
`uTime = 1.962` in this build): the control on-vs-off pair is still 88.52 / 9594, i.e. **the
sentinel itself is intact**, and the defect's absolute contribution against the control is still
large (max 195.77 at (807,294), area6 5217). What collapsed is N10's specific defect response
after differencing.

Honest reading: **the frozen phase moved a raw number that N10's defect is tuned against, without
touching any threshold.** Every bound, window and defect definition is untouched, and I changed
none of them.

Consequences:

- **No threshold, window, bound, gate or defect was modified.**
- **B2's disclosure commit has not been made** — there is no green run to disclose against.
- **B3's PNG and registration commits are blocked** behind B2's green run.
- **C (insets registry) and the final full e2e were not started.**

### Deviations / process notes

1. Two of the initial failures were infrastructure, not product: 3.9 and 3.7 died with
   `net::ERR_CONNECTION_REFUSED` after the runner killed a slow file's tree, and
   `negative.spec.ts` was killed at its 480 s `FILE_TIMEOUTS_MS` cap. Both were re-run; N9 passed,
   N10 failed in isolation too.
2. `terminal(notify=...)` is rejected by the tool schema on this host, so E2E runs were driven with
   `Popen` + argv lists from `execute_code`, polling under 240 s, per `docs/E2E.md`.
3. `scripts/tmp-refmatrix.mjs` and `scripts/tmp-n10-phase.mjs` are untracked probes and are **not
   committed**; they are the evidence for the tables above.

### Exact resumption point

One decision, then B2 can go green. I did not pick one:

| option | what it means |
|---|---|
| A. freeze the atmosphere at the phase the baselines were recorded at | keeps N10's defect response; needs that phase value justified from recorded evidence, not chosen to pass |
| B. exclude the atmosphere from the glint acquisition | changes what 3.9 measures — a look-owner decision, not mine |
| C. re-baseline N10's defect expectation | a threshold change, explicitly forbidden by this prompt |

---

## 2B-STEP3-A (previous session, kept for the record)

### P0 preflight — done

- `git log -1` at start: `1f3b300 docs(close): E2E runner invariants and verified runs; SPEC LOCK CLOSED`.
- Tree clean apart from the incoming prompt; prompt committed alone as
  `docs(step3): add prompt 2B-STEP3-A (framing foundations part 1)` (`8f9e1aa`).
- Orphan sweep: no `node.exe`, no Playwright chromium, no leftover Brotli listener. The
  `chrome.exe` / `msedgewebview2.exe` entries present are the user's own browser and the
  Hermes desktop shell, not this repo's.

### A audit — done

`docs/STEP3-AUDIT.md`, committed alone.

### B reference frame — **BLOCKED, red gate, not committed**

The gate is `max residual === 0` between two captures of the same pinned pose. It is not
zero. **No tolerance was invented and no PNG was committed.**

Measured with `tests/e2e/ref.spec.ts` (`pnpm e2e:raw -- tests/e2e/ref.spec.ts`):

| run | max \|Δluma\| | at | pixels > 1/255 |
|---|---:|---|---:|
| run 1 (inside the spec) | 2.0722 | (941, 276) | 7144 |
| run 2 (inside the spec) | 2.0000 | (959, 337) | 2820 |

The residual is **not** deterministic frame noise in the sense of "the same two frames
again": it accumulates monotonically over a sequence of captures, so it is a time-varying
uniform, not a random dither.

#### Bisection (scripts/tmp-refdiag2.mjs, 4 captures per configuration)

| layers | max \|Δ\| vs capture 0 (captures 1, 2, 3) |
|---|---|
| all on | 1.0 → 3.0 → 4.0 |
| stars off | 2.0 → 3.07 → 3.0 |
| bloom off | 1.79 → 2.07 → 2.79 |
| clouds off | 2.0 → 3.0 → 3.0 |
| atmosphere off + pins off | 1.0 → 1.0 → 1.0 |
| **all layers off** | **0 → 0 → 0** |
| atmosphere + pins off (repeat) | 1.0 → 1.0 → 1.0, **gt1 pixels: 0**, at (654, 411) |

So the camera is clean: with every layer off the frame is bit-identical. Removing the
atmosphere and the pins drops the count of pixels differing by more than 1/255 to **zero**
— the only remaining difference is a single pixel at (654, 411) whose luma differs by
exactly 1.0, i.e. 8-bit rounding.

#### Root cause

`src/scene/shaders.ts:114` — the atmosphere fragment shader breathes on the **scene clock**:

```glsl
float breathe = 1.0 - uBreatheAmp + uBreatheAmp * sin(uTime * 0.6);
```

and `src/scene/Globe.tsx:224` writes `u.uTime.value = t` where `t = state.clock.elapsedTime`,
**unconditionally** — unlike `Starfield.tsx:109`, which gates the same uniform on
`look.animate ? state.clock.elapsedTime : 0`. `look.animate` is false in the reference pose
(`__look.setAzimuth` sets it), so every other time-driven effect — planet spin, cloud drift,
star twinkle, star rotation — is frozen and the atmosphere is not.

Amplitude is `GLOBE_LOOK.atmosphere.breatheAmplitude = 0.015` (`globeLook.ts:71`), which is
why the swing is ~1–4/255 on the rim and zero in open sky.

`src/scene/Hotspot.tsx:58` has the same unconditional write
(`uniforms.uTime.value = state.clock.elapsedTime`) for the pin ring shader. It is invisible
while rings are OFF (the reference pose) but it is the same defect, and it would make the
pin ring pulse during any later framing capture that wants rings on.

#### Why this blocks B and why it is not mine to fix in this step

The prompt for this step is explicit: this session changes **no look behaviour**, and every
look threshold and window must stay untouched. Gating the atmosphere breathe on
`look.animate` is a two-line, look-flag-respecting change of exactly the kind
`Starfield.tsx` already does — but it changes the rendered pixels of a live scene over time,
and it is a product decision for the step that owns the look, not a side effect of adding a
reference frame.

The alternative — freezing `uTime` only inside the capture path — is worse: it would make
the reference PNG a picture of a scene the product never renders, which is precisely the
class of mistake `tests/e2e/look/shippedLook.ts` was written to prevent.

### C insets registry — NOT STARTED

Blocked behind B by the prompt's own ordering (`B` before `C`, and C's layout assertion is
supposed to be made against a trustworthy reference frame).

## Exact resumption point

1. Decide the atmosphere/pin-shader clock gating question (above), in whichever step owns
   look behaviour, then re-run `tests/e2e/ref.spec.ts`. Expected after the fix:
   `residual maxAbs=0`, `differingPixels=0`.
2. Resolve the PNG size question (see below) — it is independent and will bite immediately.
3. Re-run B, commit the reference PNG alone, then proceed to C.

## Second, independent problem in B: the 300 KB budget is unreachable as a PNG

Reported at the same time because it is a prompt-level constraint, not a bug:

- The default look at 1280x800 is a **256.7 KB** PNG for the whole canvas
  (`docs/globe-look/look2-default.png`).
- The required crop is the disc **plus 40 px** = 732x732, and cropping to it *raises* the
  encoded size to **680 KB** (default settings, `colorType 2`, `deflateLevel 9`,
  `filterType 4`), because the crop throws away the cheap-to-compress sky that dominated the
  full frame.
- Post-processed frames are noisy by nature, so no PNG setting reaches 300 KB at that size.

Options, none of which I took unilaterally:

| option | size | trade-off |
|---|---|---|
| keep the 732x732 crop as PNG, budget raised to 800 KB | ~680 KB | deviates from the prompt's 300 KB |
| whole canvas, no crop | 257 KB | fits the budget, but the file then changes when unrelated chrome does |
| crop at half resolution (366x366, nearest) | ~190 KB | fits, but the reference stops being pixel-exact |

## Deviation log

- B is **not committed**. The prompt says "commit alone" only on a green capture; the
  capture is red, so there is nothing to commit but a file that records a jittering scene.
- Everything else in A is committed and the audit contains no look/spec/threshold change.

---

## 2B-STEP3-A-FIX3-V3 (this session)

### E1 — N10 re-specified to frame identity (`a8f9ea2`)

Every capture goes through `acquireGlintFrames`; the detector asserts the in-page noise floor
(≤ 1.0 luma, ≤ 50 px differing — a POST-MEASUREMENT tolerance) and the detection rule (> 8 luma,
≥ 100 px > 6, fixed before any defect measurement). Cross-load is printed, not asserted.

| check | threshold | measured | status |
|---|---|---:|---|
| in-page max \|dLuma\| | ≤ 1.0 | 0.7152 | pass |
| in-page differing px | ≤ 50 | 43 | pass |
| defect max \|dLuma\| | > 8 | **249.90** | pass |
| defect px > 6 | ≥ 100 | **11779** | pass |
| precondition | si 1, rough 0, no map | si 0→1, rough 0.9→0, map true→false, version 4→5 | pass |
| cross-load (printed) | — | 0.7152 / 213 px | not asserted |

Bites: identical pair → "defect not detected" (0.00 luma, 0 px); defect applied → passes. The
"defect not applied" variant trips the PRECONDITION assertion first, which is the correct order.

Gate: `tsc -b`, `lint`, `test` **760 passed / 31 files**, `build` — all green.

### B2 — legacy verification, 28/28

`look.spec.ts` 9/9, `negative.spec.ts` 14/14, `globe.spec.ts` 5/5, **zero retries**, 9.8 min total.
Moved raw numbers: 3.1 rim peak 95.24 (unchanged), shell−bg 0.29 (−0.02); 3.5 pins (255,255,179) /
(255,255,149) unchanged; 3.6 us-west Δ2.849% unchanged; 3.9 sentinel 88.5204 / **9593** (−1 px);
N9 identical; N10 defect 3.9 reading 87.52 unchanged. No threshold or window touched.

Disclosure written to `docs/globe-look/SPEC.md` §5; D7 tables, D8 matrix and the jitter location in
`docs/STEP3-DIAG.md`.

### D8 — reading (3) applied, so B3 was SKIPPED

27 pairs across paths A/B/C, in-page and cross-load over three fresh loads: **every pair exactly 0**,
no per-channel histogram entries, no pixel with a 2-LSB delta. Reading (3) = "nothing flips in any
arm: record it as intermittent, finish B2, STOP before B3". That is what was done.

This conflicts with V2's cross-load 0.7152 / 221 px, which was measured inside the real
`negative.spec.ts` process after 13 other tests; D8 used fresh contexts only. Unresolved, recorded as
such. `tests/e2e/look/reference.ts` and `tests/e2e/ref.spec.ts` remain uncommitted.

### CPU-load note

Before `e2e:look`: Hermes 80 CPU-s, Hermes 53, python 48, Gemini 45, chrome 42 — no heavy external
jobs, unlike the earlier degraded run (python 2428, jetbrains-toolbox 3049).

### Throwaway scripts (uncommitted)

`scripts/tmp-d1.py`, `tmp-d234.mjs`, `tmp-d5.mjs`, `tmp-d7.mjs`, `tmp-d8.mjs`,
`tmp-n10-phase.mjs`, `tmp-refmatrix.mjs`. Note: `source-guards.test.ts` scans `scripts/`, so three of
these had to be rewritten to drop `Math.min(...spread)` before the gate would pass.

### Next

B3 (reference frame) needs D8 re-run **inside the negative-spec process state** to settle whether
reading (2) or (3) is real, or an explicit decision to take the D8 result at face value and let
ref.spec's strict 0 stand. Step C (insets registry) was not started.

## Step 3A closes — with a documented F waiver

Step 3A is **closed**. Final gate: **784 unit tests in 33 files**, `tsc -b` / `lint` / `test` /
`build` all exit 0. Full batched e2e: **56 tests ran, 55 passed**, one failure
(`globe.spec.ts "zoom still works after a region fly-to"`) accepted as a load-sensitive Playwright
artifact — see "Known load-sensitive test" in `docs/E2E.md`. Nothing was changed to make it pass: no
threshold, timeout, retry or test body. Five commits carry the step: the uTime gates, the N10
frame-identity re-spec, the strict-0 reference frame, the occluder registry, and this waiver.

## Step 3B — N10 baseline gate (step N, read-only measurement)

Pre-registered order: **BASE `5db822c` x3, HEAD `f440814` x3, BASE x1 as a drift control**. Each run
is its own batched-runner process over `negative.spec.ts` only; the served bundle was rebuilt with
`pnpm build:e2e` after each detached checkout, and the bundle stamp reported `built from <sha>` every
time. The summary JSON was copied to `.cache/n10/<tag>-run<N>-<stamp>-summary.json` immediately after
each run, before anything else ran.

`git diff --stat 5db822c f440814 -- package.json pnpm-lock.yaml` is **empty** (N1 precondition, met).

### The three earlier full-run failures (from `batched-summary-20261031-133622-full-a2.json`)

| spec | test title | failing assertion |
|---|---|---|
| `look.spec.ts:246` | 3.4 terminator: visible on the real render, soft on the albedo-neutral one | `Error: the surface is still flattened AFTER a reload (null: map=false emissiveMap=false)` at `look/flatAlbedo.ts:141` |
| `look.spec.ts:318` | 3.4 terminator: every evaluated azimuth, real visibility and flat softness | same `assertSurfaceRestored` throw, called from `look.spec.ts:352` |
| `negative.spec.ts:579` | N10: the glint sentinel FAILS when si 1.0 and the roughness floor are restored | `expect(cc.differing).toBeLessThanOrEqual(IN_PAGE_MAX_DIFFERING_PX)` at `negative.spec.ts:729` — Expected <= 50, Received **73** |

### What `6d5ac91` changed, and why it was not in the step plan

`6d5ac91` changed **only `src/layout/frame.ts` and its unit test** (+45/-32 lines): the free rectangle
became the INSET rectangle (`freeW = innerW`, no longer `innerW - 2 * padding`) and the padding moved
into the radius formula (`rMax = 0.5 * min(freeW, freeH) - padding`), with `degenerate` re-expressed as
`!(rMax > 0)`. That is the prompt's own definition of `r_max` from `step3-a2.md` step B, which the 3A2
implementation had folded into `free`; the numbers `rMax`, `dContain`, `dTarget`, `dx` and `dy` are
identical either way, only the REPORTED `free` changed. It was not in the step plan because step D
(F3/F4) had already shipped against the folded definition and the difference was found while writing
the docs table, so it landed as a refactor commit after the fact rather than as a planned step.

### Measured readings — N10 alone

| tag | commit | run | file | passed/failed/exp. | in-page `maxAbs` | in-page differing px | verdict |
|---|---|---|---:|---:|---:|---|---|
| BASE | `5db822c` | 1 | failed | 13/1/14 | 0.7152 | **165** | red |
| BASE | `5db822c` | 2 | failed | 13/1/14 | 0.7152 | **189** | red |
| BASE | `5db822c` | 3 | failed | 13/1/14 | 0.7152 | **165** | red |
| HEAD | `f440814` | 1 | failed | 13/1/14 | 0.7152 | **114** | red |
| HEAD | `f440814` | 2 | failed | 13/1/14 | 0.7152 | **95** | red |
| HEAD | `f440814` | 3 | failed | 13/1/14 | 0.7152 | **126** | red |
| DRIFT | `5db822c` | 1 | **passed** | 14/0/14 | 0.7152 | **11** | green |

Every red run failed on the SAME assertion — `negative.spec.ts:729`, the differing-pixel count
`<= 50` — and never on the luma assertion (`<= 1.0`), which read exactly 0.7152 in all seven runs.
The other 13 tests in the file passed in every run, so the red is confined to N10's in-page noise
floor. Because the count is only printed on a run that reaches the print before the assertion, the
cross-load row is present only in the DRIFT run: `maxAbs = 0.9278` over **2558 px**, print-only.

**Reading: R2.** BASE fails 3/3 on the same assertion, so this is **not** caused by 3A2 — the baseline
moved after D9. Recorded, and step A proceeds. Consequence for this session:
**N10 is red in isolation at the baseline** and stays red through 3A2; a red N10 in step F's full run
is therefore expected and is not evidence about 3B, but it also cannot be used as a pass signal.
S6 was not triggered. The drift control (BASE, run 7, 11 px) confirms the failure is not a property of
the environment standing still either — the SAME commit produced 165, 189, 165 and then 11 px, which is
the intermittency `docs/STEP3-DIAG.md` D9 records, now with the BASE commit failing 3 of 4.

### 3B / A — audit and design memo (`docs/STEP3B-DESIGN.md`)

Docs only. The full audit (fly-to, writer inventory, containment numbers, target design, state
machine, allowlist) is in that file; the three findings a reader of this log needs:

1. **The fly-to has no duration.** It is an exponential damp that stops on a convergence test
   (`CameraRig.tsx:122-125`), ~0.8-1.2 s at 60 fps. `controls.target` DOES leave the origin
   (`:54`), the end pose depends on `spin.current.y` at the moment of selection, and **close is a
   fly-to back to the default pose** with the spin resumed (`:57-59`) — not a jump, not a no-op.
   That fixes what `returning` must do in step D.
2. **Six writers exist** and no others: the fly-to, OrbitControls' own input, `__globe.setCamera`,
   `__look.setAzimuth` (**which writes the CAMERA, not the earth group**), `FrameRig`'s offset and
   distance channels, and the initial Canvas `camera` prop.
3. **The `d_contain` assumption breaks once a region is focused.** At 1440x900 live with the drawer
   open, every focused region overflows the free rect: right edge **+250.4 to +462.2 px**, bottom
   edge up to **+306.0 px**, while the aim point sits on the free centre to 0.0 px and the sphere
   centre does not (91.6-331.6 px away). Closing restores containment on all four edges. Measured
   with the existing `__globe.project`, `__globe.discRadiusPx` and `__frame` hooks
   (`scripts/tmp-contain.mjs`, untracked; raw rows in `.cache/containment-probe.json`). Reported
   only — the decision belongs to the next session.

Two contradictions were found and written down rather than stopping on: item 4 puts `setViewOffset`
under the director while item 5 makes `FrameRig` a pure provider (resolved by having the rig hand the
offset up), and `userZoomed` must gate ONLY the distance channel or a wheel event would un-centre the
globe. Neither changes behaviour, so no S-item triggers.

### 3B / C — golden poses captured BEFORE any refactor (`tests/e2e/camera-golden.spec.ts`)

Eight cases: four regions x (locked 1280x800, live 1440x900), plus one comparison test = **9 tests**.
Regenerate with `UPDATE_GOLDEN=1`, assert-only otherwise, exactly like `UPDATE_REF`. Details in
`docs/STEP3B-GOLDEN.md`.

**The step's real finding is that a fly-to pose is not reproducible across loads without pinning the
spin.** The first capture measured `controls.target` differing by up to **8.36e-3 R** and position by
**4.78e-3 R** between processes; the prompt's `max(1e-5, 10x noise)` rule would have fixed the
tolerance at **0.084 R**, ~20 px of disc movement, and S3 would then have been unable to detect a
regression. Cause: `CameraRig.tsx:54` builds the target as `regionDirection(id, spin.current.y)` and
`spin.y` accumulates from frame deltas. Fix: `__globe.setSpin(true, 0)` before selecting — the same
pinning `__look.setAzimuth` already applies to every pixel baseline.

| run | process | result | max component error |
|---|---|---:|---:|
| `cap1-write` (`UPDATE_GOLDEN=1`) | 1 | **9/9 green** | 8.33e-17 |
| `cap2-verify` | 2 | **9/9 green** | 5.55e-17 |
| `cap3-verify` | 3 | **9/9 green** | 5.55e-17 |

**Tolerance: 1e-5 R** — the floor binds, because `10 x 5.55e-17` is `5.55e-16`. Six of eight cases
were exactly 0 on every component. Runner registration: count 9, per-file timeout 6 min (2x the
measured 125.5 s, rounded up). Full-suite total becomes **85**.

Two small additions carried by this step, both necessary and both disclosed: `tests/e2e/globals.d.ts`
declared no `setSpin` although the runtime handle has had it since 3A (`globeProbe.ts:269`) — a
declaration only, no runtime change; and the spec needed `fileURLToPath(import.meta.url)` instead of
`__dirname`, because the Playwright config is ESM and the first run died as `0/9 tests` with
`ReferenceError: __dirname is not defined in ES module scope`.

### 3B / D — `CameraDirector` (`23ff5f4`)

`src/scene/CameraRig.tsx` and `src/scene/FrameRig.tsx` are **deleted**. Their two bodies now run in one
`useFrame` in `src/scene/CameraDirector.tsx`, in the order React used to mount them (fly-to first, fit
second, so the fit reads the camera after the fly-to moved it). `src/scene/cameraIntents.ts` is the
channel `__globe.setCamera` submits through, so the hook no longer writes; `src/scene/focusMachine.ts`
runs the state machine; `userZoomed` replaces `lastFit` and gates the distance channel only.

**The gate, and every proof the prompt asks for:**

| proof | result |
|---|---|
| **S3** camera-golden, 2 separate processes | **9/9 green both**, max error **5.55e-17 R** against a 1e-5 tolerance |
| **S1** ref.spec, 2 separate processes | `maxAbs=0 differing=0 maxChannel=0`, sha `934ecd13…d29a44` **unchanged**, both processes |
| frame.spec **unedited** | **20/20**, `git diff` against the pre-3B commit is empty |
| globe.spec in isolation (**S4**) | **5/5**, 53.7 s |
| scene-gate / limb | **2/2** / **2/2** |
| production bundle marker | `frame-locked-branch-7f3a`: **0** hits in `dist/`, **1** in `dist-e2e/` |
| unit tests | **848 passed / 38 files** (819 + 24 focus machine + 5 single-writer guard) |

**New spec `frame-director.spec.ts`, 5/5, 41.8 s**, with the number that proves each case:

| case | measured |
|---|---|
| wheel sets `userZoomed`, state stays `idle` | d **3.7785 → 4.3621**, `userZoomed` true, `focus` "idle" |
| resize after a wheel leaves the distance alone | d **4.3620 → 4.3620** while the fit's target moved **3.7786 → 5.0000** |
| selecting reaches `focused` | passed through "focusing" to "focused", `regionId` "us-west" |
| closing returns to `idle` | "focused" → "returning" → "idle", target back to (−0.000, 0.000, 0.000) |
| drag during focusing ends in `focused` | "focused", never left in "focusing" |

**The one deviation that matters, recorded in `STEP3B-DESIGN.md` §7.1:** `userZoomed` latches on ANY
distance writer (including the fly-to and `setPose`), not only on user input. The prompt defines the
flag from OrbitControls events; doing only that would have made the fit re-take the distance after
every close and ease 3.3534 → 3.7784, a visible zoom-out that does not happen today. `lastFit` was
invalidated by any writer, so reproducing its behaviour requires the wider latch. Five smaller
deviations are in §7.2-7.6, including an honest statement of what the source guard cannot catch.

### 3B / F — the full batched run, and 3B closed

One full run, `.cache/full3b/full-20261031-153356.log`, bundle stamp `srcHash 53451b321c19
distHash 0f5e57d7b6fe (built from 784168a)`. Summary copied IMMEDIATELY on completion to
`.cache/full3b/batched-summary-20261031-160157-full-3b.json`, before anything else ran.

**14 files ran, 13 passed, 1 failed, 0 retried. 90 tests: 89 passed, 1 failed, 0 skipped, 90 expected**
(the runner's own total reads `actual 90 / expected 90`, `mismatch false`). 24.8 min total.

| file | status | passed | failed | skipped | expected | retries | wall |
|---|---|---:|---:|---:|---:|---:|---:|
| `boot.spec.ts` | passed | 10 | 0 | 0 | 10 | 0 | 404.1 s |
| `camera-golden.spec.ts` | passed | 9 | 0 | 0 | 9 | 0 | 126.5 s |
| `determinism.spec.ts` | passed | 2 | 0 | 0 | 2 | 0 | 15.8 s |
| `frame-director.spec.ts` | passed | 5 | 0 | 0 | 5 | 0 | 42.1 s |
| `frame.spec.ts` | passed | 20 | 0 | 0 | 20 | 0 | 119.3 s |
| `gate-clock.spec.ts` | passed | 1 | 0 | 0 | 1 | 0 | 51.3 s |
| `globe.spec.ts` | passed | 5 | 0 | 0 | 5 | 0 | 53.1 s |
| `harden.spec.ts` | passed | 8 | 0 | 0 | 8 | 0 | 109.4 s |
| `history-gate.spec.ts` | passed | 1 | 0 | 0 | 1 | 0 | 15.9 s |
| `limb.spec.ts` | passed | 2 | 0 | 0 | 2 | 0 | 15.6 s |
| `look.spec.ts` | passed | 9 | 0 | 0 | 9 | 0 | 317.5 s |
| `negative.spec.ts` | **failed** | 13 | 1 | 0 | 14 | 0 | 193.0 s |
| `ref.spec.ts` | passed | 2 | 0 | 0 | 2 | 0 | 13.3 s |
| `scene-gate.spec.ts` | passed | 2 | 0 | 0 | 2 | 0 | 11.0 s |
| **total** | **13/14** | **89** | **1** | **0** | **90** | **0** | **24.8 min** |

Some summary entries carry `skipped: null`, not 0 — the runner's `parseCounts` only writes a skipped
count when Playwright prints one, and this suite has no skipped tests. The arithmetic is
89 + 1 + 0 = 90.

**The one red test, in the full run and in isolation:**

| run | test | assertion | in-page `maxAbs` | differing px |
|---|---|---|---:|---:|
| full run | `negative.spec.ts:579` N10 | `expect(cc.differing).toBeLessThanOrEqual(50)` at `:729` | 0.7152 | **236** |
| isolated rerun (`.cache/full3b/isolated-negative-20261031-160108.log`) | same | same | 0.7152 | **242** |

**N10 is classified by the step-N reading, which was R2**, and not re-derived here: the BASE commit
`5db822c` failed 3 of 3 (165 / 189 / 165 px) while HEAD failed 3 of 3 (114 / 95 / 126 px), and the
drift control at BASE passed at 11 px. The failure therefore predates 3A2 and is not evidence about
3B; it also cannot be used as a pass signal. Nothing was edited to make it pass — no threshold,
window, timeout, retry or test body (S2 not triggered).

**What improved against the 3A2 full run:** `look.spec.ts` is **9/9** here, where 3A2's run had both
3.4 terminator cases red on `assertSurfaceRestored` (`flatAlbedo.ts:141`, "the surface is still
flattened AFTER a reload"). That failure did not reproduce, and nothing was changed to address it.

**Step 3B closes** with: gate green at **848 unit tests / 38 files**, S1 at strict 0 with the sha
unchanged in two processes, S3 at 5.55e-17 R against a 1e-5 tolerance, `frame.spec.ts` 20/20 unedited,
globe/scene-gate/limb green, production bundle free of the locked marker, and one red test that the
baseline gate already owned before this session started.

### The full batched run (step G)

One run of `node scripts/e2e-batched.mjs`, 15 files, one Playwright process each, no retries. Summary
copied to `.cache/full3b2/batched-summary-run3.json` the moment it appeared.

| file | status | passed | failed | skipped | expected | wall | retries |
|---|---|---:|---:|---:|---:|---:|---:|
| `boot.spec.ts` | passed | 10 | 0 | None | 10 | 402.5 s | 0 |
| `camera-golden.spec.ts` | passed | 9 | 0 | None | 9 | 147.9 s | 0 |
| `determinism.spec.ts` | passed | 2 | 0 | None | 2 | 16.0 s | 0 |
| `focus-ux.spec.ts` | passed | 22 | 0 | None | 22 | 317.0 s | 0 |
| `frame-director.spec.ts` | passed | 5 | 0 | None | 5 | 39.3 s | 0 |
| `frame.spec.ts` | passed | 20 | 0 | None | 20 | 120.7 s | 0 |
| `gate-clock.spec.ts` | passed | 1 | 0 | None | 1 | 51.2 s | 0 |
| `globe.spec.ts` | passed | 5 | 0 | None | 5 | 53.4 s | 0 |
| `harden.spec.ts` | passed | 8 | 0 | None | 8 | 109.5 s | 0 |
| `history-gate.spec.ts` | passed | 1 | 0 | None | 1 | 16.1 s | 0 |
| `limb.spec.ts` | passed | 2 | 0 | None | 2 | 15.5 s | 0 |
| `look.spec.ts` | passed | 9 | 0 | None | 9 | 317.7 s | 0 |
| `negative.spec.ts` | **failed** | 13 | 1 | None | 14 | 193.8 s | 0 |
| `ref.spec.ts` | passed | 2 | 0 | None | 2 | 13.1 s | 0 |
| `scene-gate.spec.ts` | passed | 2 | 0 | None | 2 | 11.4 s | 0 |

**Total: 111 passed, 1 failed, 0 skipped, 112 expected — 111 + 1 + 0 = 112.** 14/15 files passed, 0
retries, 30.4 min. Every file's `testsSkipped` came back `null` (the runner only writes a skipped count
when Playwright prints one, and this suite has none); the 0 above is that null read as zero.

**The one red test: N10** (`negative.spec.ts:579`), and it is the KNOWN-RED one, classified by the N10
rule rather than by convenience:

| run | assertion | in-page `maxAbs` | differing px | verdict |
|---|---|---:|---:|---|
| full batch | `expect(cc.differing).toBeLessThanOrEqual(50)` | **0.7874 luma** | 528 | KNOWN-RED |
| isolated rerun | same | 0.7152 luma | 24 | **passes** |

`maxAbs = 0.7874 <= 1.0` and ONLY the differing-pixel assertion failed (the defect-vs-control bound
reported `maxAbs=249.90` against a `> 8` floor and 11 904 px against a `>= 100` floor, i.e. that half is
healthy), which is exactly the signature the rule covers. N10's baseline status is unchanged from step
3B: this check is red at some full-run timings and green at others, because the in-page control pair is
`maxAbs`-identical but 24-528 px apart depending on when the second acquisition lands. It is pre-existing
and no threshold, window or timeout was touched to make it say otherwise.

**Two earlier attempts and what they taught** (both recorded because they are the reason the run above
is the one reported):

- **Run 1** (31.9 min): `boot.spec.ts` hit its 600 s backstop and was killed; every live-mode file after
  it came back `ERR_CONNECTION_REFUSED` on its own port, because the killed tree left the shared server
  in a bad state. 110/112 ran, 5 files red. All 38 red tests — including all 22 of `focus-ux.spec.ts` —
  **passed in isolation**, which is what proved the batch was measuring infrastructure. Its summary file
  was then consumed by the isolation runs' `outputDir` cleanup before it could be archived; the per-file
  table was recovered from the runner's own log instead, and the lesson is in `docs/E2E.md`.
- **Run 2** (30.4 min): `boot.spec.ts` 10/10 in 402.7 s, and 112/112 tests ran. Two reds: `negative`
  N10 (known-red, above) and `focus-ux` U7 `when-focused`, which was `trace 1 frame` — a bug in the new
  spec's sampler, not in the product: it stopped on `focus === 'focused'`, which is already true in that
  leg. Fixed by keying the stop condition on `regionId === 'se-asia' && focus === 'focused'` (commit
  `0bdd19a`), verified 6/6 over `--repeat-each=3`, then 36/36 with `negative.spec.ts` in isolation.

### Deviations of the full run, stated plainly

1. `boot.spec.ts` needed 402-403 s of a 600 s budget and its case `d` (400 kbps) is the bulk of it. It
   passed twice at that cost; it timed out once, in run 1, immediately after a previous file's teardown.
2. `focus-ux.spec.ts` takes 317 s of its 780 s backstop in the batch and ~314-360 s isolated, so the 13
   min budget is 2x its measured isolated time as the prompt requires.
3. `negative.spec.ts`'s N10 remains red in full runs and green in isolation. That divergence is the
   pre-existing behaviour documented in step 3B, not a regression from this step, and the rule in
   `docs/prompts/step3-b2.md` is what classifies it.

## 2B-STEP3B2-FIX2 (this session)

Prompt `docs/prompts/step3-b2-fix2.md`, sentinel `END OF PROMPT 2B-STEP3-B2-FIX2`. Baseline HEAD `54a93f2`,
clean tree. Full audit: **`docs/STEP3B2-FIX2-AUDIT.md`**.

| commit | what |
|---|---|
| `7a143bc` | P0: the prompt, committed alone |
| `9e291a9` | A: the audit memo — **step A STOPPED, no product code** |
| `783a605` | B: the in-drawer region switcher |

### Step A — STOPPED at A1. The prompt's visibility gate contradicts the spec it is meant to satisfy

A3 specifies the proxy raycast to decline when `n · (rayOrigin − pinBaseWorld) <= 0`. With the camera at
distance `D` along `u` and the pin base at radius `rb` along `n`, that expression is `D(n·u) − rb`, so the
rule is **not** a hemisphere test — it is a hard threshold at `n·u > rb/D` on the exact quantity A4 bands
front/grazing/back with.

| quantity | value | angle from camera axis |
|---|---:|---:|
| A4's FRONT band edge | 0.15000 | 81.37° |
| A3's gate at `d_fit` 3.77857, `rb` = 1.04742 | 0.27720 | 73.91° |
| A3's gate at `dMax` = 5 | 0.20948 | 77.91° |

`rb/D <= 0.15` needs `D >= 6.98 R` and `maxDistance` is 5, so **no camera pose in the product** satisfies
both. On the committed 48-pose sweep the gate admits **20 of 23** front rows (87.0 % against the required
100 %) and refuses az 120/300 `us-west` and az 150 `horn-africa`. The physically exact alternative — a true
occlusion test — overshoots the other way and admits **3 rows the spec bands as back**.

The prompt's own A1 rule (`binding unless your measurements refute it; if they do, STOP`) is what was
followed. Two resolutions are recorded in the audit for the author to choose between; neither was
implemented. **Nothing is half-fixed: no product file, spec, threshold or runner table was touched by step A.**

The parts of A3 that DO measure clean are in the audit and stand for the next session: the 14/22 px radius
design is sound (nearest pin pair 0.89532 R, so the neighbour cap is 0.44766 R and a 14 px proxy at `d_fit` is
0.04513 R — 9.9× under it), and `visible = false` objects DO receive pointer events in this repo's
R3F 8.18.0 / three 0.169.0 (`three.module.js:52030-52050` never reads `visible`).

### Step B — the in-drawer region switcher (`783a605`)

B1 was measured before any edit, at both spec viewports: **no spec captures drawer pixels** (`ref.spec.ts`
crops the disc + 40 px from `discRadiusPx()`; the look suite never opens a region) and **every card centre
resolves to a node inside the drawer** (`topInDrawer: true, isCard: false` on all four, both viewports). No
conflicting spec, so no STOP.

The row is a `shrink-0` sibling of the scrolling body, so the extra height is absorbed by the body scroll that
already existed (783 px of content in 613 px at 1440x900, 433 px at 1280x720) and no rect moves:

| proof | 1440x900 | 1280x720 |
|---|---|---|
| drawer wrapper | 418 x 900 at x 1022 (unchanged) | 418 x 720 at x 862 (unchanged) |
| drawer panel | 386 x 808 at (1038, 76) | 386 x 628 at (878, 76) |
| `insets.right` | 418 | 418 |
| body scroll | 784 in 577 | 784 in 397 |
| switcher row | scrollWidth 384 <= clientWidth 384 (wraps, no h-scroll) | same |

`switcher-ux.spec.ts`, **8/8** (4.0 min): S1 retarget at both viewports (real `page.mouse` clicks guarded by
`elementFromPoint`; face-pin error **0.0000 deg**, `d` = `d_fit` exactly, `|target|` 0.0e+0, drawer stays
`aria-hidden="false"`, panel and wrapper rects identical across the retarget, focus stays on the clicked chip),
S2 no-op at both viewports **with a positive control** (the same sampler first SEES a 131.944 deg retarget,
then measures 0.0000 deg and 0.00e+0 for the active chip over 32 and 44 samples), S3 keyboard (Tab from the
close button lands on the first chip; Enter and Space both retarget), S4 all four close paths,
S5 the rects above.

`RegionDrawer.test.tsx` adds **8 unit tests**. Gate: **908 unit tests / 41 files** (900 + 8), `tsc -b`, `lint`,
`build` all green. S1: `ref.spec.ts` residual `maxAbs=0 differing=0`, sha `934ecd13…d29a44` **unchanged, in two
separate processes**. Locked/legacy 23/23 (globe 5, limb 2, scene-gate 2, frame-director 5, camera-golden 9),
0 failures.

### Deviations, stated plainly

1. **Step A implemented nothing**, and that is the prompt's own STOP rule rather than a budget statement.
   `pin-click.spec.ts` was therefore NOT rewritten under waiver W5, so D4 remains red exactly as at the
   baseline. No threshold, window or test body was touched to make it say otherwise.
2. **S4's tab-order assertion is scoped to the chips, not the whole drawer.** Measured: the closed drawer
   still contains ONE live tab stop — the pre-existing close button — which predates this step and which the
   prompt places out of scope ("the drawer X ... untouched"). The chips themselves are `tabIndex -1` and take
   zero of 28 Tab landings. The wider assertion would have made this step's spec the first place that
   pre-existing debt is reported, as a failure of a switcher that did not cause it.
3. **The switcher's no-op is enforced in the component, not in `App.selectRegion`.** `selectRegion` re-centres
   on a repeat click by design (`App.tsx:31-36` bumps `focusNonce`), which is right for the cards and pins and
   wrong for this row.

## 2B-STEP3B2-FIX2-CONT (this session)

Prompt `docs/prompts/step3-b2-fix2-cont.md`, sentinel `END OF PROMPT 2B-STEP3-B2-FIX2-CONT`. Baseline HEAD
`783a605`, tree clean except this file's own pending append. Full audit + resolution:
**`docs/STEP3B2-FIX2-AUDIT.md`**.

| commit | what |
|---|---|
| `282528b` | P0: the prompt, alone |
| `1a3b44f` | A: the pin hit proxy + `pinVisibilityBands.ts` + 28 unit tests |
| `7bde152` | WAIVER W5: `pin-click.spec.ts` rewritten (4 -> 7 cases), runner count raised |

### Step A — the gate, corrected to a constant on the band

`FRONT_EDGE 0.15`, `BACK_EDGE 0`, `PIN_HIT_GATE 0.075`. The bands are ASYMMETRIC, so the midpoint is 0.075
rather than the 0 the prompt anticipated for symmetric ones; a unit test pins
`FRONT_EDGE > PIN_HIT_GATE > BACK_EDGE` strictly. All three live in one module imported by the product and the
spec, which is the structural fix for the two-literal drift that cost 8.7 % of the front band.

| measurement | before | after |
|---|---:|---:|
| sweep front (`>= 0.15`) | 9/23 = 39.1 % | **23/23 = 100 %** |
| sweep back (`< 0`) | 13/24 = 54.2 % | **0/24 = 0 %** |
| sweep grazing | 0/1 | 1/1 (reported, not asserted) |
| spin-on, clean presses | — | front **22/22 = 100 %**, back 0 |

**A7 was checked and not triggered:** front is 100 % and back is 0 % on the committed 48-pose sweep, so the
narrowed STOP condition does not fire. The first run of D1 read 82.6 % and looked like a hit; it was the
measurement (clicks fired mid-flight after a reset), not the gate — see `docs/E2E.md`.

D4/D5/D6 pass: drawer-open pin click retargets at 0.0000 deg with `d` = `d_fit` and the drawer open;
pointer-miss still closes from empty globe AND through a back pin; the limb-band row (az 120 `us-west`,
f 0.2064) selects, asserted as the accepted side effect. `visible=false` proxies receive pointer events, proven
on the running page (D3: top raycast hit, cursor `pointer`).

### Proofs

- S1: `ref.spec` residual `maxAbs=0 differing=0`, sha `934ecd13…d29a44` unchanged, **two separate processes**.
- Locked/legacy **23/23** (globe 5, limb 2, scene-gate 2, frame-director 5, camera-golden 9).
- Switcher **8/8**; `git diff --stat 783a605` shows no switcher file touched.
- Unit **936 tests / 42 files** (900 + 28 new + 8 switcher).
- Gate: `tsc -b`, `lint`, `test`, `build` all green.

### Deviations, stated plainly

1. **The prompt's count of 135 was right, and the baseline it should be measured from is 135, not 127.** `127`
   is the total through FIX1; `switcher-ux.spec.ts`'s 8 were added in `783a605` and are NOT inside it, so the
   tree this step started from expects **127 + 8 = 135**. This step adds three cases to `pin-click.spec.ts`
   (D3, D5, D6 — D4 was rewritten, not added), giving **135 + 3 = 138**, and `expectedCounts()` now says 7 for
   that file. (An earlier draft of this section said 130; that was arithmetic on my side, corrected here.)
2. **D1b states its 100 % on CLEAN presses**, not on all 74 attempts. Measured: the hold is 50 ms but the CDP
   `pointerdown -> pointerup` window is **315-400 ms**, and R3F requires the object to be hit at both ends, so a
   pin at 12-38 px/s leaves a 14 px radius inside its own press. 22 of 74 attempts qualified and **all 22**
   front ones selected. The dirty rows are printed with their window. This is the harness's latency, measured
   rather than assumed — and three earlier versions of the case failed on a correct gate for exactly this
   reason.
3. **`getLookFlags`' `hotspotRings` flag still gates the ring's DRAW.** The proxy is deliberately outside that
   flag: a flag that hides the visual ring must not silently disable the click target, or the ablation seam
   would also change behaviour.

### The full batched run (`7362d13`), and its three reds

`pnpm e2e` at `7362d13` after killing the stray Brotli server on 4197 (netstat empty, `curl` refused, both
confirmed). Summary archived to `.cache/fix2/batched-summary-7362d13.json`:
`15/18 files passed, no retries — 134/138 tests — total 39.6 min`.

| file | result |
|---|---|
| 15 files | ok, including `ref.spec.ts` 2/2, `camera-golden` 9/9, `globe` 5/5, `limb` 2/2, `frame` 20/20, `focus-ux` 22/22, `reset-ux` 11/11, `look` 9/9, `boot` 10/10 |
| `negative.spec.ts` | 13/14 — **N10 known-red** by the existing rule |
| `pin-click.spec.ts` | **TIMEOUT at 3/7** — its own 240 s per-file backstop |
| `switcher-ux.spec.ts` | 6/8 — **S2's positive control saw 0.000 deg of camera motion**, at both viewports |

**pin-click's timeout is my defect, not the product's.** A5 took the file from 4 cases to 7 and its measured
isolated wall to 9.7 min, and I raised `expectedCounts()` without raising `FILE_TIMEOUT_MS`. The budget is
`1_200_000` now — 2x the measured wall, per that table's own rule — with the reason in the code and in its unit
test. It is green in isolation at 7/7 (`.cache/fix2/pinclick-run22-full.log`).

**switcher S2 failed its OWN positive control**, which is the guard working: the sampler must see a real
retarget before "the camera did not move" means anything. The control reported **0.000 deg and 0.0000 distance,
focused 0 left — i.e. nothing moved at all — at both viewports**, while S1 in the same file retargeted every
chip at 0.0000 deg with `d` = `d_fit`. The sampler starts with `setInterval` and is armed by one CDP call, then
the click is delivered by another; when the browser is starved (as it is after the preceding 13 files) the timer
can read a whole flight's worth of samples at one settled pose and return a trace whose first entry is already
the destination. The pre-existing reason this passed before is that it ran after a lighter prefix — nothing in
this step touched `switcher-ux.spec.ts` or `RegionDrawer` (`git diff --stat 783a605` confirms, Step B), so this
is a flake in the sampler's arming, not a switcher regression. Rerunning it isolated is the report's obligation
and is what the run below does; **the file is not edited to pass.**

**N10's numbers fit the known-red rule.** `maxAbs = 0.7152` (rule: at or below 1.0) with only the
differing-pixel assertion failing, `differing = 115` against a `<= 50` bound, every differing pixel on the disc
band and its nearest pin 31.3-221.8 px away — i.e. not on a pin, which is the same signature
`docs/D10-REPORT.md` recorded across 15 runs.

### The isolated reruns, reported beside the batch (C2's obligation)

Each red file was rerun once in isolation, without editing any test:

| file | batched | isolated | verdict |
|---|---|---|---|
| `pin-click.spec.ts` | TIMEOUT at 3/7 (240 s backstop) | **7/7 passed, 9.5 min** | the backstop, not the product; budget raised to 1_200_000 |
| `negative.spec.ts` | 13/14 (N10) | **14/14 passed, 5.3 min** | N10's documented full-run/in-isolation divergence, unchanged |
| `switcher-ux.spec.ts` | 6/8 (S2 control saw 0.000 deg) | **8/8 passed, 4.0 min** — control saw **131.944 deg at both viewports** (25 and 22 samples not "focused") | the sampler's arming race under load; no switcher file was edited |

The control reading is the decisive number: **131.944 deg** isolated against **0.000 deg** in the batch, on the
same build and the same code. A product regression cannot move the camera 132 degrees in one process and 0 in
another; a `setInterval` sampler armed one CDP call before the click can, when the browser is starved by the
thirteen files before it.

So the step's honest totals are: **138 expected, 138 accounted for** — 134 pass in the batch, and the 4 that did
not (3 in `pin-click` behind a timeout I under-funded, 2 switcher S2 cases behind a known sampler race, N10)
are all green when run alone, except N10, which is green alone and known-red in a batch by the existing rule.

## 2B-STEP3-MOBILE1 (this session) — the phone layout, and a spec at a viewport nothing had measured

Commits: P0 `96c4ffc`, P1 `ef09ab3`, A `8488e10`, B `be1b3d2`, C `90b7932`, D `f5b9a48`, E `959bbef` +
`133b2fe`, F `6e46f7c`. Prompt saved verbatim as `docs/prompts/step3-mobile1.md` and committed alone, as P0
asks; the sentinel line is `END OF PROMPT 2B-STEP3-MOBILE1`.

**P1's three STOP conditions, all checked and none hit.** FIX2 is present (`pin-click.spec.ts` at **7** cases
and `RegionDrawer` carrying the in-drawer switcher). The desktop free rect took a SECOND free rect without
moving a desktop pixel, because the mobile fit goes through the same `computeFrame` law with different insets
— the 15 layout rects and the camera goldens are unchanged, and `camera.view` keeps its pre-existing desktop
value (see the correction below). The global anomaly scrubber exists on desktop and is reused verbatim.

**One prompt statement was re-read against the repo, and the honest form is what the spec asserts.**
The prompt says "camera.view must stay null on desktop so the projection matrix is bit-identical". That is
true of the LOCKED build — the E2E default, which returns before computing a frame — and has never been true
of LIVE desktop, which has installed the free-rect offset since Step 3A2. Measured at HEAD:
1280x800 `view { offsetX: -22.421875, offsetY: -59.125 }`, 768x900 `offsetY: 196.8909`. So M1/M2 assert that
desktop's offset equals the DESKTOP FIT's own (`frame.dy` negated) and that the mobile branch left no trace
(`frame.viewOffsetY === 0`, `clampedByMax === false`), which is a statement about THIS step rather than about
a mode. Disclosed as a deviation.

**The measurements that decided the spec's tolerances**, each now a comment at its assertion:

| reading | measured | what the spec does instead of the naive form |
|---|---|---|
| desktop offset vs `-dy` at 1e-6 | 196.8594 vs 196.875; −59.1108 vs −59.125 | asserts within **0.05 px** — the probe's own `settled` bound, i.e. the product's stated accept criterion |
| render counter baseline at `open()` | 12 at t=268 ms, 13 at t=885 ms, then 13 for 18 s | `settledRenders()` takes the baseline at REST; the boot render is the app's, not the drag's |
| PACIFIC pin at 390x844 | projects to **x = −9** | M3 taps only in-viewport pins above the sheet and PRINTS the excluded ids |

**Isolated runs of the new file:** five, because the gate goes green long before a spec that has never
executed does. `mobile-run4` 12/15 (M1, M3, M6), `run5`/`run6` 1 red (M6 control, 0.00 deg), `run7` **15/15
green** (the M6 fix: the control re-parks the camera between taps), `run8` 13/15 on a re-run after the file
changed, `run10` **15/15 at 3.6 min**, `run12` **15/15 at 3.9 min**. The two passing walls are 222 s and
234 s, which is why the runner budget is **480_000** (2x the slower) and not the 450_000 first committed.

**`M10` was a tautology and is now a real check.** It asserted `expect(chipsAtPeek).toBeGreaterThanOrEqual(0)`
on a count of hidden chips — a bound no count can violate. Replaced with a twelve-Tab walk asserted in both
directions: at peek no region chip and no slider is reachable, at full the sliders and all four chips are.
Measured first (`probe-tab`): at peek every chip has `getClientRects().length === 0` inside a `hidden` parent,
and the walk lands only on the island, the three header buttons, the reset control and the handle.

**Counts.** Unit gate **1020 passed / 47 files** at HEAD. The e2e suite is **154 expected** across 19 files
(the 139 before this step, plus `mobile-sheet.spec.ts` 15); the batched run's own table is the arithmetic.

### The full batched run, and what its six reds are

`19 files, 153/153 tests accounted for, 13 files passed, 6 files with 1-2 failing cases each, 0 retries,
47.0 min`. Summary archived as `.cache/e2e-archive/2026-11-01T19-22-31-249Z-batched-summary.json`.
The new file is **15/15 green**.

Every one of the six red files has **zero diff against `5e7c826`** (`git diff 5e7c826 --numstat` = 0 lines in
each), so none of them was edited by this step. Rerun as a batch of exactly those six
(`.cache/mob/rerun-reds.log`):

| file | batched | isolated rerun | verdict |
|---|---|---|---|
| `boot.spec.ts` | 9/10 (case b) | **10/10** | load, not the product: case b is a 4x-CPU-throttled boot under the same process as case a's 3.7 min, i.e. the documented load-sensitive class |
| `frame-director.spec.ts` | 3/5 | **5/5** | load: both reds compared `frame.settled` in a JSON key, and settled is a per-frame value — the poll saw `false` for 20 s on a starved browser |
| `pin-click.spec.ts` | 6/7 | **7/7** | load: the red was `focus` stuck at `focusing` for its 20 s budget |
| `switcher-ux.spec.ts` | 7/8 | 7/8 | the KNOWN sampler race already recorded for this file (S2's positive control saw 0 samples instead of 131.944 deg). Pre-existing, documented, file unedited |
| `negative.spec.ts` | 13/14 | 13/14 | **N10**, the documented known-red (`differing = 211` against `<= 50`, every pixel on the disc band, nearest pin 33.7-221.8 px away). Unchanged signature |
| `globe.spec.ts` | 3/5 | **3/5 — pinch, then 4/5 on a second run** | see below: one REAL consequence of this step, one load flake |

**The one real regression, and it is a consequence of this step working as specified.**
`globe.spec.ts:175` "pinch at 375x667 changes the distance" now fails **deterministically**, twice in
isolation. Cause, measured (`.cache/mob/probe-pinch2/3.spec.ts`): the case picks its pinch origin by scanning
for the topmost open canvas row, which at 375x667 is `y = 10` at `x = 10..30`. Before this step, 375 px wide
was still the desktop layout and that whole top band was open canvas. Now 375 is MOBILE, and the HUD island
occupies `x 63.2-311.8 / y 15-51`, so the surviving open sliver is a 20 px strip beside the capsule. A pinch
dispatched there reaches no OrbitControls surface. Pinching at `(187, 300)` — open canvas below the island,
above the sheet at 546.9 — **works**: `3.3534 -> 2.7035`. So the gesture path is intact and the spec's
coordinate heuristic is what broke.

This is a STOP-class finding under Step 3A2's standing rule ("ANY failure of globe.spec.ts 'zoom still works
after a region fly-to' is a real regression, STOP and report"), except in the other direction: the failing
case is the PINCH one, not the fly-to one, and the fly-to case passes 4/5 runs and 5/5 in a later run. It is
reported rather than fixed, because fixing it means editing a locked spec (`docs/prompts/step3-a2.md` forbids
changing any look/negative/limb/globe threshold or window), and the honest fix is a one-line change of origin
to a point chosen for the mobile layout — a decision for the prompt's author, not for this step.

The `zoom still works after a region fly-to` case: failed once in the full batch (`3.3668 -> 3.3665`, the
wheel ignored), then PASSED in the isolated rerun, PASSED in a second isolated run, and a direct probe of that
exact sequence (`.cache/mob/probe-flywheel.spec.ts`) measured `3.3708 -> 4.1637`, i.e. the wheel worked. So it
is the load flake the file has always had and not a regression.
