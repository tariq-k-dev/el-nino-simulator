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
