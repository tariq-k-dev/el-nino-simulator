# HERMES HANDOFF — Super El Niño Simulator

Written for a fresh Hermes session with no memory of this work. Every fact below was read
out of the repo with `git`, `ls`, `grep` and `cat` at the time of writing. Anything not
verified is marked **UNKNOWN**.

---

## 1. REPO STATE

**Path: `D:\Dev\Handshake\Build-an-Interactive-Data-Visualization` — the ONLY repo.**
Ignore any other path, including `D:\Dev\Portfolio` and `D:\Dev\ZTM\*`.

- Package name: `super-el-nino-simulator` (from `package.json`)
- Branch: `main`
- HEAD: **`f7124a611898b1c61739f51dacbab49b6cd6b0fe`** (short `f7124a6`)

`git log --oneline -20`:

```
f7124a6 test(look): 3.5 becomes a semantic gate — the RGB windows are retired
19cc97c docs(look): B0 facts — the pin render never changed, 2A4's windows were mis-sampled
b541b29 docs(look): SPEC.md, PNG budget, pnpm e2e:look; full e2e crashes the browser worker
079726c test(look): negative suite — N2/N5 prove their checks go red, N1/N3/N4 blocked on delivery
b951534 test(look): 3.5 pin thresholds now encode the approved look, not the brief's guesses
47ffc52 docs(3b-1): status after 2A4 -- 3.1/3.2/3.3/3.4/3.6/3.7/3.8 green, 3.5 fails on the blue channel
3b63953 test(look): 3.7 console clean, 3.8 the five zoom cases untouched
c73578f test(look): 3.6 no ring light cast; pacific's annulus is sky, not surface
a398cc2 test(look): 3.5 pin cores measured day and night — FAILS on the blue channel
460e333 fix(look): 3.4 width measured inside the terminator's own falloff
02a05a4 fix(look): 3.3 keeps only W1 — the other seven flagged scene content, not regressions
7e0a70f docs(3b-1): status after 2A3 -- 3.1/3.2/3.4-default green, 3.3 and 3.4-12az stopped with numbers
3a8c511 test(look): 3.4 terminator from pixels; 12-azimuth sweep trips the STOP condition
ab238a6 test(look): 3.2 glare passes at all 12 azimuths after the glint decision
907b51c test(look): 3.3 probe windows are polar and resolved against the fitted limb
4d275d2 fix(look): 3.1's non-monotonic residual is the cloud deck's own silhouette
a2d0be5 docs(look): the glint is a difference image, and 54% of it is gone
2b15ebf fix(look): fit the limb from pixels; the hook was right and the halo was the 3px
ce5453c test(look): look.spec.ts with 3.2 and 3.4 passing; 3.1/3.3 blocked on limb radius
c16bfc3 test(look): shared look harness with unit-tested helpers; retire the throwaway scripts
```

`git status --short` (at time of writing):

```
?? docs/prompts/speclock-2b-c1.md
```

That file is **untracked and was NOT created by this session** — it appeared in the tree
before the handoff task began. Do not delete it; read it, and decide with Tariq whether to
commit it.

---

## 2. COMMANDS

### The gate (run after every step; never `tsc -p`)

```bash
pnpm tsc -b && pnpm lint && pnpm test && pnpm build
```

- `tsc -b` — project build. `tsc -p` is explicitly forbidden by the standing rules.
- `lint` — `eslint . --max-warnings 0` (a warning fails the gate).
- `test` — `vitest run`. Last measured: **597 tests, 21 files**.
- `build` — `tsc -b && vite build && node scripts/check-assets.mjs`. The asset check
  **fails a production build if any E2E hook leaks**.

### Every e2e script in `package.json`

| script | what it does | wall time |
|---|---|---|
| `dev` | `vite` (runs `predev` → `copy-duckdb.mjs` first) | UNKNOWN |
| `build:e2e` | `copy-duckdb.mjs && tsc -b && node scripts/build-e2e.mjs && check-assets.mjs --allow-e2e`. Builds a **VITE_E2E=1** bundle into `dist/`. Required before any look spec. | ~15–25 s observed |
| `e2e` | `playwright test` — every spec in `tests/e2e/` | **5.0 min** (recorded, and it crashed — see §5) |
| `e2e:look` | `cross-env PLAYWRIGHT_HTML_OPEN=never playwright test tests/e2e/look.spec.ts tests/e2e/negative.spec.ts tests/e2e/globe.spec.ts` | **5.3 min** recorded; 15 passed, 3 skipped |
| `e2e:globe` | `cross-env PLAYWRIGHT_HTML_OPEN=never playwright test tests/e2e/globe.spec.ts` — the five zoom cases | 1.4 min observed |
| `e2e:report` | `playwright show-report .cache/e2e-report` | n/a |
| `e2e:golden` | `node scripts/e2e/verify-live-golden.mjs` — engine parity against a recorded golden | UNKNOWN |
| `gen:golden` | `node scripts/gen-engine-golden.mjs` — regenerates `tests/fixtures/engine-golden.json` | UNKNOWN |
| `parity:full` | `node scripts/parity-driver.mjs` — full TS-engine vs DuckDB parity run | UNKNOWN |
| `check:assets` | `node scripts/check-assets.mjs` — asset budget + forbidden-hook scan | ~1 s |
| `data` | `uv run python scripts/generate_enso_data.py` | UNKNOWN |
| `typecheck` | `tsc -b --noEmit false --pretty false` | ~3 s |
| `preview` | `vite preview` | n/a |

Duration source: `docs/3B-1-STATUS.md` and `docs/E2E.md`. Anything not recorded there is
marked UNKNOWN rather than estimated.

Note the two `//`-prefixed pseudo-scripts in `package.json` (`//build:e2e`, `//e2e`,
`//e2e:look`) — they are **comments**, not commands. They record why `build:e2e` is a Node
wrapper rather than `VITE_E2E=1 vite build` (pnpm runs scripts through `cmd.exe`, where the
POSIX assignment parses as a command name).

---

## 3. HARNESS MAP

### `tests/e2e/` (top level)

| file | what it is |
|---|---|
| `fixtures.ts` (265 lines) | Shared Playwright fixtures: byte ledger, throttling profiles, badge readers, error collector. Exports `test`, `expect`. |
| `globals.d.ts` (138) | TypeScript declarations for every `window.__*` hook a spec reads. |
| `look.spec.ts` (502) | The look acceptance specs: 3.1 rim, 3.2 glare, 3.3 local peak, 3.4 terminator (2 cases), 3.5 pins, 3.6 ring cast, 3.7 console. |
| `negative.spec.ts` (512) | N1–N5. Injects defects at run time, asserts the real check reports FAIL and the control passes. |
| `limb.spec.ts` (119) | A2: `R_fit` vs `discRadiusPx()` at 1280×800 and 1024×768. |
| `globe.spec.ts` (379) | The five zoom cases (3.8) plus globe interaction. **Last changed by `9757015`** — treat as frozen. |
| `determinism.spec.ts` (220) | Two loads at the same azimuth must produce identical disc pixels. |
| `boot.spec.ts` (264) | 2B lazy-boot acceptance cases a–i. |
| `gate-clock.spec.ts` (245) | Scene-gate vs texture-timeline clock reconciliation. |
| `history-gate.spec.ts` (194) | CSV fetched at mount, before the gate opens. |
| `harden.spec.ts` (370) | Negative-zero rendering and hardening cases. |
| `scene-gate.spec.ts` (89) | Gate behaviour with hanging textures. |
| `brotli-server.mjs` | The static server Playwright starts on **port 4197** serving `dist/` with Brotli. |
| `acceptance-matrix.mjs`, `boot-timeline.mjs`, `gate-effect.mjs`, `wire-bytes.mjs`, `abort-trace.mjs` | Standalone measurement tools, run by hand. Not specs. |

### `tests/e2e/look/`

| file | what it is |
|---|---|
| `capture.ts` (287) | Browser-side helpers: `hideChrome`, `twoFrames`, `capture` (canvas-only screenshot), `disc`, `settleAt`, `setLayers`, `openGlobe`, `frameNoise`, `sunAndCamera`, `cameraGeometry`, **`fitLimb`**, `ALL_LAYERS`, `VIEWPORT`. |
| `measure.ts` (1046) | The measurement catalogues: `measureRim`, `measureGlare`/`checkGlare`, `measureBlueCircle`, `measureSpecularMask`, `measureTerminator`, `measurePinGates`, `measureRingCast`, `writeResult`. |
| `clipped-probe.mjs` (287) | STEP 1 evidence — the per-azimuth clipped-pixel inventory and ablation table. |
| `edge-attribution.mjs` (121) | Where the old "~328.6 px limb" reading came from (atmosphere halo). |
| `limb-probe.mjs` (254) | A2 probe: R_fit vs hook vs tangent vs naive at two viewports. |
| `pin-probe.mjs` (39) | Exploratory pin core dump. |

Pure maths lives in **`src/lib/look/helpers.ts`** (44 exports) with
**`src/lib/look/helpers.test.ts`** — 95 `it(` blocks, and that file is part of `pnpm test`.

### Every `VITE_E2E`-only hook

All are compile-time gated on `import.meta.env.VITE_E2E === '1'`; `scripts/check-assets.mjs`
lists them in `FORBIDDEN_HOOKS` and fails a production build that contains any of them.

| hook | where | API |
|---|---|---|
| `window.__bootErrors` | `src/main.tsx:24` | `Array<{kind, message, stack}>` captured before React mounts. |
| `window.__engineStore` | `src/main.tsx:44` | Engine store snapshot (`getSnapshot()` → phase/startedAt/loaded/…). |
| `window.__sceneGate` | `src/lib/engine/sceneGate.ts:339` | `{ getState() }` → outcome, openedAt, settledInMs, texturesDone, frameRendered. |
| `window.__textures` | `src/lib/engine/sceneGate.ts` | `{ getState(), describe(gateOpenedAt?) }` — per-texture timeline. |
| `window.__SCENE_GATE_TIMEOUT_OVERRIDE__` | `sceneGate.ts` | Shortens the 120 s gate timeout. Must be set before app code runs. |
| `window.__scene` | `GlobeScene.tsx:235` | The three.js `Scene`. Specs `traverse()` it to find/measure meshes. |
| `window.__camera` | `GlobeScene.tsx:235` | The `PerspectiveCamera`. |
| `window.__gl` | `GlobeScene.tsx:235` | The `WebGLRenderer`. Specs call `gl.render(scene, camera)` to force a draw. |
| `window.__THREE` | `GlobeScene.tsx:244` | The three.js namespace — so the negative suite can construct a real light. |
| `window.__globe` | `GlobeScene.tsx:254` → `createGlobeProbe` | See below. |
| `window.__lookToggles` | `GlobeScene.tsx` | `{ set, get, reset, look }` — raw ablation seam. |
| `window.__look` | `GlobeScene.tsx` | See below. |

`__globe` (from `src/lib/globeProbe.ts`):
`project(point?) → {x,y,behind}` · `discRadiusPx() → number` · `distance() → number` ·
`insets() → Insets` · `pins() → Array<{id,x,y,behind,facing}>` ·
`pinAnchors() → Array<{id,world:[x,y,z]}>` · `lookFlags()` · `setLookFlags(patch)` · `look()` ·
`setCamera([x,y,z]) → Promise` · `setAzimuth(deg) → Promise` ·
`defaultOrbit() → {distance,elevationDeg}` · `setSpin(frozen, angle)`.

`__look` (the narrow, documented API the committed specs use):
`set({stars,rings,atmosphere,clouds,pins,bloom})` · `get()` · `setAzimuth(deg)` ·
`animate(on)` · `surfaceWhite(on) → boolean` · `specularIntensity(v?) → number|null` ·
`surfaceReady() → boolean`.

---

## 4. SPEC STATUS TABLE

`grep -rn "fixme\|\.skip\|\.only" tests/e2e` — **verbatim output**:

```
tests/e2e/negative.spec.ts:116:   * N1 / N3 / N4 are fixme, not skipped for convenience.
tests/e2e/negative.spec.ts:134:   * Left as fixme rather than deleted or weakened: the tests are the evidence that the
tests/e2e/negative.spec.ts:137:  test.fixme('N1: an amber pointLight at a pin makes 3.6 ring luminance FAIL', async ({ page }) => {
tests/e2e/negative.spec.ts:223:  test.fixme('N3: atmosphere alpha forced to 1 at the silhouette makes 3.1 FAIL', async ({ page }) => {
tests/e2e/negative.spec.ts:274:  test.fixme('N4: a blue DirectionalLight at (-5.2,-2.2,-4.6) makes 3.3 FAIL in W1', async ({ page }) => {
```

No `.skip` and no `.only` anywhere in `tests/e2e`.

| spec | file | status | threshold currently in code | last changed by |
|---|---|---|---|---|
| **3.1 rim** | `look.spec.ts:64` | **passing** | peak ≤ 110/255; worst outward rise ≤ 1/255 from `monotonic.startOffset` (= +3 px); shell-vs-bg ≤ 2/255; max abs step beyond +2 px ≤ 16/255; `origin.rms` ≤ 0.4 | `4d275d2` |
| **3.2 glare** | `look.spec.ts:133` | **passing** | clipped == 0; largest blob ≤ 12 px; 12 azimuths | `ab238a6` |
| **3.3 local peak** | `look.spec.ts:181` | **passing** | W1 only (0.91 R, 180°); sigma-3 blurred peak ≤ 1.15 × annulus(8..20 px) median | `02a05a4` |
| **3.4 terminator (default)** | `look.spec.ts:236` | **passing** | width ≥ 6 % of R_fit; night fraction 10–30 %; night mean ≥ 4/255; `rms` ≤ 0.4 | `460e333` |
| **3.4 terminator (12 az)** | `look.spec.ts:278` | **passing** | `threshold = 16` (line 312), max adjacent step; night mean ≥ 4/255 | `460e333` |
| **3.5 pins** | `look.spec.ts:344` | **passing** | Semantic: P1 median luma ≥ 180; P2 `min(R,G,B) ≥ 250` count == 0; P3 median saturation ≥ 0.15; P4 median R ≥ 240, G ≥ 200, B ≤ G; ≥ 5 samples; valid if n·cam ≥ 0.1 and r/R ≤ 0.97 | **`f7124a6`** |
| **3.6 ring cast** | `look.spec.ts:412` | **passing** | `|delta%| ≤ Math.max(3, 1.5 × noise%)` (`measure.ts:1010`) | `c73578f` |
| **3.7 console** | `look.spec.ts:455` | **passing** | app warnings/errors + pageerrors == 0 | `3b63953` |
| **3.8 zoom** | `globe.spec.ts` | **passing (5/5)** | unchanged since `9757015` | `9757015` |
| **glint spec** | — | **MISSING (correctly)** | `tests/e2e/glint.spec.ts` does not exist; the rule says write it only if verdict V1 passes or a candidate is adopted, and the verdict was GLINT REMOVED | n/a |
| **N1** pointLight → 3.6 | `negative.spec.ts:137` | **fixme** | expects 3.6 delta% to exceed `max(3, 1.5×noise)` | `079726c` |
| **N2** si=1.0 + roughness 0 → 3.2 | `negative.spec.ts:190` | **passing** | expects clipped > 0 or blob > 12 | `079726c` |
| **N3** atmosphere opaque → 3.1 | `negative.spec.ts:223` | **fixme** | expects shell-vs-bg > 2 | `079726c` |
| **N4** blue DirectionalLight → 3.3 | `negative.spec.ts:274` | **fixme** | expects W1 ratio > 1.15 | `079726c` |
| **N5** black/white frames → 3.2 | `negative.spec.ts:306` | **passing** | black must be INVALID; white must fail | `079726c` |
| **N6, N7, N8** | — | **do not exist** | — | — |

---

## 5. KNOWN OPEN PROBLEMS

These are recorded facts, not opinions. Each is also written up in
`docs/3B-1-STATUS.md` and `docs/globe-look/FACTS-2B.md`.

### 5.1 N1 / N3 / N4 are `test.fixme` — the defect is real, its delivery is not

Measured, control passing, defect showing **no change**:

- **N1**: lights **3 → 4** in the scene graph, annulus mean **59.5052 under the defect vs
  59.5052 in the control** (0.002 % delta against a 3 % gate).
- **N3**: `shellVsBackground` **0.31 under the defect vs 0.30 in the control**.
- **N4**: W1 ratio **0.982 under the defect vs 0.976 in the control**.

A standalone probe proved the N1 injection *can* work: `scene.add(PointLight)` plus a
material rebuild moved that same annulus **4.1697 → 31.3786 (+653 %)**. So the check can
see the defect; what fails is delivery into the measured window. `fitLimb` swaps the
surface to unlit white and restores it, and every `setLayers` call routes through the flag
store into a React re-render; between them the injected light's contribution is compiled
back out before the capture. This is the same R3F invalidation/recompile seam that silently
swallowed the `onBeforeCompile` patch in 2A2.

### 5.2 The 3.5 RGB windows — **RETIRED, no numbers in code**

The gate no longer contains RGB windows. Both sets are gone: the brief's
`day (255,255,158..172)` / `night (240,238,123)..(255,255,150)`, and the 2A4 "measured"
`185` / `182`. Those numbers survive **only inside explanatory comments** at
`tests/e2e/look/measure.ts:740`. The live gate is the semantic P1–P4 set in §4.

Why they were retired: `docs/globe-look/FACTS-2B.md` records the render as
**byte-identical across the eleven commits tested** (`max|delta| = 0` per channel on all
four pins, `2e27939` vs HEAD) while the windows moved twice.

### 5.3 The Pacific pin (Niño 3.4) projects at r/R 1.100

At az 0, from `pinAnchors()` + `project()`:

| pin | world | \|position\| | n·cam | az0 (x,y) | r/R |
|---|---|---:|---:|---|---:|
| pacific | (−0.9541, −0.0385, 0.5509) | **1.10242** | 0.4574 | (291.03, 482.31) | **1.1013** |
| us-west | (−0.4402, 0.6635, 0.7625) | 1.10242 | 0.8561 | (449.63, 243.57) | 0.7569 |
| se-asia | (−0.4124, −0.0577, −1.0207) | 1.10242 | −0.8877 | (540.80, 328.83) | 0.3750 |
| horn-africa | (0.8113, 0.1534, −0.7305) | 1.10242 | −0.5747 | (852.04, 296.86) | 0.7243 |

At az 180 pacific reads 0.7963 and **horn-africa reads 1.0017** at the *same* world radius.

All four \|position\| are identical (`1.012 × 1.035 + 0.055` from `GLOBE_LOOK.pins`), so **no
pin floats**. `rOverR_pin == rOverR_proj` to 4 dp, so the pin list and `project()` agree;
the error is in what `r/R` *means* for a point 33.4 px above the surface. **Not fixed** —
the fix is a design decision (project the pin's surface anchor for the r/R test, keep the
core for the pixel probe) and every task since has been read-only on this point.

### 5.4 Full `pnpm e2e` crashes the browser worker

Recorded in `docs/3B-1-STATUS.md`: **11 failed**, `browserContext.newPage: Target crashed`,
`worker process exited unexpectedly (code=3221225794)`. **0xC0000142** is a DLL
initialisation failure — Chromium exhausts resources after the long serial run
(`workers: 1`, SwiftShader software rendering, dozens of 1280×800 captures). The same specs
pass when split into two batches (`look.spec.ts`, then `negative.spec.ts` +
`globe.spec.ts`). This is an environment limit, not a regression.

### 5.5 Stale-dist risk — the trap that has cost time twice

`playwright.config.ts` serves `dist/` on port 4197. **`pnpm build` writes a production
bundle with every hook dead-code-eliminated.** So the sequence

```
pnpm build && pnpm e2e        # WRONG
```

tests a bundle where `window.__globe` and `window.__look` do not exist, and the look specs
fail on `waitForFunction` timing out after 90 s — which reads as a product bug.

Additionally: **if `pnpm lint` or `pnpm tsc -b` fails, the `&&` chain stops and `dist/`
keeps whatever it had before.** A rerun against that stale `dist/` silently measures the
previous build. When a spec result looks impossible, check that the build actually
succeeded *and* that `grep -rl "__look" dist/assets/` finds the hook.

Correct order for look work: **`pnpm build:e2e`** then `pnpm e2e:look`.

Live demonstration of this at handoff time: after the gate's `pnpm build`, `grep -rl
"__look" dist/assets/` returned **nothing** — the working `dist/` was a production bundle
with every hook stripped, so any look spec run right now would fail on a 90 s
`waitForFunction` timeout. Run `pnpm build:e2e` first.

---

## 6. GOTCHAS

- **Windows / Git Bash.** `taskkill` needs `/PID <pid> /T /F` (`//PID` passes literally and
  silently no-ops). Two processes can LISTEN on one port, so a stale server answers your
  curl and looks like a code bug — check `netstat -ano | grep :4197`. A background
  launcher's reported pid is usually the wrapper, not the listener.
- **`cross-env` is mandatory** for any script that sets an env var. pnpm runs scripts
  through `cmd.exe`, where `VITE_E2E=1 vite build` parses `VITE_E2E` as a command name.
  That is why `build:e2e` is a Node wrapper (`scripts/build-e2e.mjs`).
- **Orphan Chromium.** A killed Playwright run can leave Chromium holding the renderer; a
  later run then fails to launch. Check `ps -W | grep -i chrome` and kill the tree before
  concluding a spec is broken.
- **The byte-measuring tools disable the HTTP cache** via CDP —
  `Network.setCacheDisabled { cacheDisabled: true }` appears in `abort-trace.mjs:62`,
  `acceptance-matrix.mjs:95` and `boot-timeline.mjs:80`. So their byte counts are always
  cold-cache; a warm-cache browser will not match them. (This is a property of those four
  CLI tools, not of every spec — the specs themselves do not set it.)
- **Software-GL numbers are relative.** Everything runs on SwiftShader
  (`--use-gl=swiftshader`), with no GPU. Frame timings and any fps figure are meaningless
  in absolute terms; only ratios and pixel measurements are comparable.
- **The scene clock must be frozen** (`__look.setAzimuth` does this). With only the spin
  paused, two loads differed by **17.4 mean absolute luma** inside the disc while the sky
  matched to 0.02.
- **`fitLimb` swaps the surface material** to flat unlit `MeshBasicMaterial` via
  `__look.surfaceWhite(true)` and restores it in a `finally`. Required, because a lit sphere
  has a different luma edge on day and night sides. Any work that needs to survive that
  call must be re-applied *after* it — this is exactly what defeated N1/N3/N4.
- **`setLayers` re-renders React.** It writes the external flag store, so it causes a
  re-render, which can rebuild materials. A bare `scene.add()` does **not** invalidate the
  R3F frameloop, so nothing is drawn until something else forces a render.
- **Light counts compile into shaders.** three bakes the number of lights into each
  program's defines. Adding a light without marking materials `needsUpdate` leaves it
  present in the scene graph and **completely inert on screen** — measured as lights 3 → 4
  with a 0.002 % pixel delta.
- **`labelBlobs` bounds must not use `Math.min(...xs)`** — an all-white 1280×800 frame is
  one component of ~1 M points and the spread blows the call stack. Fixed to loops; do not
  reintroduce the spread form.
- **Read `docs/globe-look/SPEC.md` before touching a threshold.** It is the single table of
  check → definition → threshold → measured value → negative test.

---

## 7. RULES YOU MUST FOLLOW

1. **One commit per step.** Never batch steps into one commit.
2. **Gate after every step**: `pnpm tsc -b && pnpm lint && pnpm test && pnpm build`.
   Never `tsc -p`.
3. **STOP and report on a real failure.** Report the raw numbers. Do not proceed past a
   failing measurement as though it passed.
4. **Never tune a threshold to pass.** If a measurement fails, the numbers go in the report
   and the task stops (or the threshold decision is escalated to Tariq). Changing a window
   to fit the current render is what produced the 3.5 false alarm documented in §5.2.
5. **Never leave a `test.fixme`.** If you create one, it needs a name, the measurements that
   justify it, and a plan — the three existing ones are the model.
6. **Never commit a defect.** Negative tests inject at run time and clean up in
   `afterEach`. Do not add a broken material or light to source.
7. **Low-turn safeguard**: if running short, **commit what is green**, update
   `docs/3B-1-STATUS.md` with honest done / not-done, and STOP.
8. Pixel specs must assert **input validity** first — disc found, `R_fit` RMS ≤ 0.4, sample
   count > 0, no NaN. A null-vs-null comparison is how a pixel suite silently stops testing.
9. Hooks live **only** under `VITE_E2E`. `check-assets.mjs` must keep failing a production
   build that leaks one.

---

## 8. NEXT TASK

> **Execute `docs/prompts/speclock-2b-c1.md` only. Ignore any older 2B prompt.**

Note that `docs/prompts/speclock-2b-c1.md` is currently **untracked** (see §1). Read it
before acting; if it conflicts with this handoff, the prompt wins for scope and this handoff
wins for measured facts.
