# 3B-1a-SPECLOCK status

After **2B-C2B Part 1** (E0, F1, F2) and **2B-C2B-F3FIX** (G0-G4). Gate
(`pnpm tsc -b && pnpm lint && pnpm test && pnpm build`) green at every commit: **664 unit
tests, 25 files**, 0 test hooks in the production bundle. `pnpm e2e:look` **23 passed, 0
skipped, 0 `test.fixme`**.

HEAD after **2B-C2B Part 2**: see the git log in the final report. Gate green at every commit:
**691 unit tests, 27 files**.

| spec | result | measured |
|---|---|---|
| 3.1 rim | **PASS** | peak 94.2, worst rise 0.44/255 from +3 px |
| 3.2 glare | **PASS** | 0 clipped, 0 blobs, 12/12 az |
| 3.3 local peak | **PASS** | W1 only, ratio 0.976 |
| 3.4 terminator default | **PASS** | width 31.0 px (9.51 % R), night frac 15.40 % - *redefinition pending Part 2* |
| 3.4 terminator 12-az | **PASS** | max step 13.69/255 vs 16/255 gate - *redefinition pending Part 2* |
| 3.5 pins day/night | **PASS (semantic)** | P1-P4 on the valid pins; RGB windows retired |
| 3.6 ring light cast | **PASS** | 3 measurable pins 0.002-2.849 % vs 3 % floor; `horn-africa` now correctly INVALID |
| 3.7 console | **PASS** | 0 app messages |
| 3.8 zoom | **PASS** | 5/5 untouched |
| **3.9 glint** | **PASS (new)** | max(D) **88.52**, area6 **9594**, centroid (780.8, 376.0), r/R 0.4399, max at (782, 374) |

## What 2B-C2B Part 1 changed

### E0 - the instrumented bundle owns `dist-e2e/` (`1fb4580`)

`build:e2e` emitted into `dist/`, the same directory the gate's `pnpm build` writes, so every
gate invalidated the E2E bundle and the stamp guard refused the next spec run with "dist/ was
replaced since the build". That guard fired on the NORMAL workflow, which teaches people to
ignore it. Now `dist/` is the production bundle, `dist-e2e/` is the instrumented one,
`check-assets` takes `--dir`, `playwright.config.ts` serves `dist-e2e/`, and `pnpm e2e:look`
chains its own `build:e2e`. Verified: gate, then `pnpm e2e:look` with no manual rebuild.

### F1 - one pin-validity rule (`4d55d4d`)

`checkPins` tested `n-cam >= 0.1 && r/R <= 0.97`; `checkRingCast` tested annulus COVERAGE only.
Coverage is not facing: `horn-africa` at az 0 faces away (n-cam -0.5747) yet its 30-60 px
annulus is ~100 % inside the disc, so 3.6 called it measurable - which is how the first N1
attempt injected a light behind the globe. Both now call `isValidPin` from
`tests/e2e/look/pinValidity.ts`. 3.6 prints `horn-africa ... INVALID: faces away (normal-camDir
-0.575 < 0.1)`; N1 selects `us-west` by rule instead of by hand (delta **341.3 %** vs 3 % gate).
Non-vacuity is a FAILURE via `requireValidPins`, never a skip. Pins float by design (all four at
|position| 1.10242) - the bound is on the PROJECTED core, which ranges 0.375...1.101 for the
same world radius.

### F2 - N4 is the faithful defect, and it is no longer parked (`eb7550d`)

The original N4 restored one half of the defect. What drew the blue circle at W1 was the cool
fill light acting on a surface that still had GGX specular; at `intensity: 0.32` against a
shipped matte surface it lifts blue ~3/255 and moves three pixels in the whole disc (0.976 ->
0.982). The faithful defect restores both halves from git - `2e27939^` for the light
(position (-5.2, -2.2, -4.6), intensity 0.32, `#2f6fb8`) and `38aa091^` for the material
(`specularIntensity` 0.18, roughness floor 0) - while the 3.3 metric is untouched.

| quantity | control | defect | gate |
|---|---:|---:|---|
| W1 ratio | 0.998 | **3.426** | <= 1.15 -> FAIL as required |
| W1 blurred peak | 4.84 | **41.46** | - |
| W1 annulus median | 4.86 | 12.10 | - |
| mask-excluded | no | no | must not be excluded |

Informational, no gate: the fill light ALONE with `specularIntensity` 0 moves W1 peak 4.84 ->
5.10 (ratio 0.998 -> 1.000). That is the 3/255 blue lift the old N4 measured, and why a
per-channel blue gate was rejected - it would guard an invisible lift.

### F3FIX G1 - 0.18 is the pre-fix state, documented as such (`dbe7322`)

`src/scene/globeLook.ts` said "the term is back at 0.18" while the value beside it was `0`.
Rewritten: `specularIntensity` is **0 BY DESIGN since 38aa091** (the GGX lobe clipped at grazing
angles, 49 clipped px in the worst case); the visible glint comes ONLY from the overlay shader
(flag `specular`); Tariq accepted this attenuated look. **No value changed.**
`docs/globe-look/glint-diffs.md` now opens with a header stating that `Dt`/`Dm` were measured at
si 0.18 = PRE-FIX and that the shipped glint is the `Do` row. `CLIPPED-FACTS.md` and
`FACTS-2B.md` corrected the same way.

### F3FIX G2 - the specular mask measures the shipped state (`1b01fe1`)

`measureSpecularMask` forced `specularIntensity(0.18)` before its "on" capture, so the mask
described a material lobe the product does not render.

| | mask px |
|---|---:|
| old (forced si 0.18) | 105,313 |
| new (as shipped, si 0) | **71,869** |

-33,444 px (-31.8 %). 3.3 and N4 re-run after the change: **verdicts unchanged**, W1 still not
mask-excluded, N4 control 0.998 -> defect 3.426. Guards added so it cannot regress:
`measureSpecularMask` may not set a non-zero literal, and no test outside the defect engine may
call `specularIntensity(0.18)`.

### F3FIX G3/G4 - 3.9 glint sentinel (`bfa9c66`, `602208b`)

First attempt reproduced 164.07 / 15469 against the recorded 88.52 / 9594 - an 85 % error -
because the acquisition forced 0.18. As shipped, with no override anywhere:

| quantity | recorded | reproduced | gate |
|---|---:|---:|---|
| max(D) | 88.52 | **88.52** (0.00 %) | [70.8, 110.7] |
| area6 | 9594 | **9594** (0.00 %) | [6716, 12472] |
| centroid | (780.8, 376.0) | (780.83, 375.98) | info only |
| centroid r/R | 0.4388 | 0.4399 | info only |
| max location | - | (782, 374) | - |

`assertShippedLook(page)` now runs before every glint measurement and throws "not the shipped
state" if the live `specularIntensity` or overlay flag differs from the committed constants - a
comment could not have prevented the 85 % error, a runtime comparison does.

| test | target | defect | window | result |
|---|---|---|---|---|
| N9 | 3.9 | overlay off | max 2.07, area6 0 | **FAILS as required** |
| N10 | 3.9 | si 1.0, roughness floor 0 | max **190.28**, area6 11261 | **FAILS as required** |
| control (same tests) | 3.9 | - | 88.52 / 9594 | passes |

## Negative-test ledger

| test | targets | state |
|---|---|---|
| N1 pointLight at a pin | 3.6 ring cast | **passing** - +341.3 % vs 3 % gate, survival probe clean |
| N2 si=1.0 + roughness 0 | 3.2 glare | passing |
| N3 atmosphere opaque | 3.1 rim | **passing** - shellVsBg 0.25 -> 223.99 |
| N4 fill light + material specular | 3.3 local peak | **passing** - ratio 0.998 -> 3.426 |
| N5 black/white frames | 3.2 validity | passing |
| N7 pin emissive x4 | 3.5 P2/P3 | passing - day AND night pin |
| N8 pins hidden | 3.5 P1 | passing - luma 247.6 -> 3.9 |
| N9 overlay off | 3.9 sentinel | **passing** - collapses to 2.07 |
| N10 si 1.0 + floor 0 | 3.9 sentinel | **passing** - 190.28 over the 110.7 bound |
| N6 hard step / flat | 3.4 (redefined) | **does not exist - Part 2** |

**No `test.fixme` and no `test.skip` anywhere.** A source guard asserts the fixme set is
literally empty and that N4 still carries its git provenance.

## Metric redefinitions across 2A3/2A4/2B

1. **Probe windows**: absolute px -> polar (rFrac, deg clockwise from +x) resolved against
   fitLimb; **W1 only** retained (W2-W8 flagged scene content: W5 1.240, W8 1.191).
2. **Glint exclusion**: 0.15 R circle at an orthographic half-vector point -> measured
   `specularMask` (3/255, dilated 8 px) - and since F3FIX G2 that mask is measured on the
   SHIPPED state rather than a forced si 0.18 (71,869 px, was 105,313).
3. **Terminator width**: whole-disc 90->10 % scan -> measured inside `terminatorFalloff`
   (longest sustained descent by total luma dropped). The old scan reported widths of
   162-188 % of R_fit, i.e. wider than the planet. **Still live; Part 2 retires it.**
4. **Terminator step gate**: `ceil(1.25 x max)` derived per-run -> fixed **16/255**
   constant. It equals the 2A3 derivation from the **whole-disc** scan
   (`ceil(1.25 x 12.31)`), not from the current metric: after `terminatorFalloff` the max is
   **13.69**, whose `ceil(1.25 x)` would be **18**. **Still live; Part 2 retires it.**
5. **`crossTerminatorStep`**: max adjacent step only BETWEEN the 90 % and 10 % crossings.
6. **Pin day/night**: screen-axis projection (which labelled pacific "night" at az 0,
   wrongly) -> the pin's surface normal against the sun, i.e. the `dot(n, sun)` the shader
   lights with.
7. **Ring-cast validity**: pins whose annulus is not >=70 % surface are reported INVALID
   rather than gated. pacific projects to 1.100 R - outside the disc - so its 20.4 %
   "delta" was sky, not cast light. Same class as the deleted (300,392) window.
8. **Pin validity is one rule** (F1): front-facing `n-cam >= 0.1` AND projected core
   `r/R <= 0.97`, shared by 3.5, 3.6 and every negative test. Coverage alone was the flaw.
9. **Pacific's r/R**: the pin core floats **by design** at `1.012 x 1.035 + 0.055 = 1.10242`
   R, so `r/R` for a core is not a surface quantity and `r/R <= 0.97` is a conservative
   proxy, not a physical law. `__globe.project` is correct - the closed form reproduces all
   eight pin/azimuth rows to 4 dp. See `docs/globe-look/FACTS-2B.md` section b.

## Glint (settled)

`specularIntensity` is **0**, by design since `38aa091`, and the ONLY glint is the overlay
shader. Verdict **V2: glint ATTENUATED, not removed** - peak retention 0.5395 (V1 needs
>= 0.60, so V1 does not pass) but `area6` retention 0.6202 (needs >= 0.50, so it does).
**Tariq ACCEPTED this attenuated look.** The earlier "GLINT REMOVED" label overstated it and is
retired; so is "restoring the material lobe is open work" - it was abandoned, not deferred.
3.9 now guards the accepted numbers.

## Test runs (2B-C2B Part 1 + F3FIX)

| run | result | wall |
|---|---|---|
| full gate (`tsc -b`, `lint`, `test`, `build`) | **green** - 664 tests / 25 files, 0 hooks | ~14 s |
| `pnpm e2e:look` (3 spec files) | **23 passed, 0 skipped** | 8.5 min |
| full `pnpm e2e` | **not run** - needs the batched runner (F6, Part 2) | n/a |

The handoff records the full suite crashing the worker (`Target crashed`,
`code=3221225794` = 0xC0000142, a DLL init failure). That is an environment limit of a single
long serial run under SwiftShader, not a spec failure; F6's batched runner in Part 2 is the fix.

## Part 2

### F4 - the terminator audit is DONE, and it STOPPED the redefinition (`5f23b50`)

`docs/globe-look/TERMINATOR-AUDIT.md` exists with the full 1 px table at all twelve azimuths.
Headline findings, all measured:

- The implemented lighting is **Lambert diffuse + an emissive night texture** (`Globe.tsx:314-316`,
  `emissiveMap` with `emissiveIntensity` 0.18), **not** a smoothstep day/night mix. There is no
  day-side plateau, which is why a 90 %->10 % width over the whole disc reported 188 % of R.
- True levels: **day 62.31**, **night 5.17** (the old "night mean 11.04" was a different quantity).
- The old 3.4 segment sits between n-L - +0.15 and +0.25 — **entirely on the day side, and it does
  NOT contain the n-L = 0 crossing**, which is at r/R **0.829**.
- **F4(e) STOP:** at the default view the `n-L = -0.25` point is at r/R **0.957**, outside F5's own
  0.95 applicability bound, while F5 requires the default view to be IN the evaluated set. The
  brief's "about 0.68 R" crossing is the **orthographic** value (actual perspective: 0.829).
  Two options are written up in the audit; both need Tariq's decision.

Two geometry bugs were caught by unit tests before any number became a threshold: `sunViewAngleDeg`
used the look direction instead of the axis to the viewer (theta read 132.8 deg = 180 - 47.2), and
the camera basis was mirrored (symptom: at az 150 the "day" band read **darker** than its "night"
band, 27.6 vs 60.0). A third was a test fixture that put the camera 200 units away with a 326 px
disc. `src/lib/look/terminatorGeometry.test.ts` (12 tests) now pins the conventions.

### F6 - the batched runner is DONE (`02c5b81`, `f6adfef`, `6710154`)

`scripts/e2e-batched.mjs` + `scripts/lib/e2e-batch-core.mjs` (15 unit tests). One process and one
port per spec file, per-file artifacts dir, `--trace=off`, retry once only on a worker crash,
tree-kill then wait, cleanup strictly `ms-playwright` between files. `pnpm e2e` calls it;
`pnpm e2e:raw` keeps the old single-process behaviour.

Three real defects were found by actually running it: a shared `outputDir` (file N+1 wiped file N
mid-teardown), a path-vs-regex filter ("No tests found"), and trace teardown deciding results.
`docs/E2E.md` documents all three so they are not rediscovered.

### Still NOT DONE

1. **3.4 is still measured with its OLD definition.** F5 was not implemented because F4(e) stopped
   it; the `width >= 6 % R` and `16/255` step gates are **still live in code**, retired only in
   intent. `docs/globe-look/SPEC.md` says so explicitly rather than pretending otherwise.
2. **N6 / N6b / N6c do not exist** — they belong to the blocked redefinition. The mutation and
   profile machinery they need IS built and unit-agnostic (`tests/e2e/look/terminatorProfile.ts`,
   including `mutateTerminator` for the offline N6/N6b mutations), so implementing them after the
   decision is mechanical.
3. Every other check (3.1-3.3, 3.5-3.9) is green with negative evidence, and N1, N2, N3, N4, N5,
   N7, N8, N9, N10 all go red under their defects.

## Spec source

- `docs/prompts/speclock-2a.md` - A3/A4 plus the 2A3/2A4 amendments.
- `docs/prompts/speclock-2b-c2a.md` - E0, V0, D1, D2, D3.
- `docs/prompts/speclock-2b-c2b.md` - Part 1 of C2B (P0, E0, F1, F2, F3).
- `docs/prompts/speclock-2b-c2b-f3fix.md` - G0-G4, the shipped-si-0 decision and 3.9.
