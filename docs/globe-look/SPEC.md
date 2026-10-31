# SPEC — the globe look, check by check

One table. Every row names the check, its DEFINITION, its THRESHOLD, the last MEASURED value, and
the NEGATIVE test that proves it can go red. Thresholds are not tuned to a render: where a number
came from a decision, the decision is named in §2.

Measured at 1280x800, SwiftShader, clock frozen.

## 1. The table

| # | check | definition | threshold | measured | negative test |
|---|---|---|---|---|---|
| **3.1** | rim: soft monotonic halo | 16 rays from the FITTED limb, −6..+60 px, bilinear luma; peak, outward monotonicity, shell-vs-background at 1.1 R | peak ≤ 110/255; worst outward rise ≤ 1/255 from `monotonicStartOffset` (+3 px); shell−bg ≤ 2/255; max abs step beyond +2 px ≤ 16/255 | peak **94.6** at +1 px; rise 0.44; shell−bg **0.29**; max step **7.99** | **N3** atmosphere forced opaque → shell−bg **223.99** |
| **3.2** | glare: no clipped pixels | clipped count and largest bright blob (luma ≥ 250) inside the disc, 12 azimuths | clipped **== 0**; largest blob ≤ **12 px** | clipped **0**, blobs **0** at 12/12 az | **N2** `si 1.0` + roughness floor 0 → clipped **284**; **N5** all-white frame → largest **332,965** |
| **3.3** | local peak: no blue circle | W1 only (r/R 0.91, 180°, size 40): sigma-3 blurred peak ÷ median of its 8–20 px annulus, excluding the measured specular mask | ratio ≤ **1.15** | ratio **0.976** (peak 4.95, med 5.07) | **N4** fill light + material specular → ratio **3.426** |
| **3.4** | terminator: soft and readable | **STILL THE OLD DEFINITION** — 90 %→10 % width inside a locally monotonic falloff, plus max adjacent step across it | width ≥ **6 % of R_fit**; night fraction **10–30 %**; night mean ≥ **4/255**; step ≤ **16/255** | width **31.0 px (9.51 % R)**; night frac **15.40 %**; step **13.69** at az 60 | **MISSING** — N6/N6b/N6c blocked, see §4 |
| **3.5** | pins: readable, unblown, amber | semantic P1–P4 on each VALID pin; day AND night must both be represented | P1 luma ≥ **180**; P2 no `min(RGB) ≥ 250`; P3 sat ≥ **0.15**; P4 R ≥ 240, G ≥ 200, B ≤ G | 5 valid of 16 rows; e.g. `us-west` (255,255,179) luma 249.5 sat 0.298 | **N7** emissive ×4 → P2/P3 fail, day **and** night; **N8** pins hidden → luma **3.9** |
| **3.6** | no ring light cast | mean luma of a 30–60 px annulus, pins ON vs OFF vs OFF again; delta vs `max(3 %, 1.5 × noise)` | \|delta %\| ≤ **max(3, 1.5 × noise)** | 3 measurable pins **0.002–2.849 %** | **N1** amber pointLight at the pin → **+341.3 %** |
| **3.7** | console clean | app warnings/errors + pageerrors, driver chatter filtered | **== 0** | **0** app messages | (self-evident; no defect needed) |
| **3.8** | zoom | five interaction cases at 1280x800 and 375x667 | unchanged since `9757015` | 5/5 | (frozen) |
| **3.9** | glint sentinel | `D = luma(F_as_shipped) − luma(all specular off)`, default view | max(D) ∈ **[70.8, 110.7]**; area6 ∈ **[6716, 12472]** | max **88.52**, area6 **9594**, centroid (780.8, 376.0), r/R 0.4399 | **N9** overlay off → collapses (max 2.07 or INVALID); **N10** `si 1.0` + floor 0 → max **190.28** |

## 2. Every redefinition and decision

1. **Rim origin = the FITTED limb.** `__globe.discRadiusPx()` and the visible limb disagreed by
   ~3 px, and every disc-relative rule inherited that error. `fitLimb` fits a circle to the rendered
   edge at 360 rays with the surface swapped to unlit white, so a lit sphere's two different day/night
   edges cannot be averaged.
2. **Strict-monotonic start at +3 px.** The cloud shell's own silhouette is the outermost opaque
   edge (+1.43 px); starting the outward-rise rule there would measure the shell, not the rim.
3. **3.3 covers W1 only.** W2–W8 flagged *scene content*, not regressions: W5 at 1.240 R and W8 at
   1.191 R are outside the disc, and `(300, 392)` at 1.045 R is pure atmosphere halo — a 3.7×
   "local peak" that was the halo doing its job.
4. **The 3.3 specular mask is defined AS SHIPPED.** It used to force `specularIntensity(0.18)` —
   the PRE-FIX value — before its "on" capture, so it excused regions the shipped overlay never
   lights: **105,313 px → 71,869 px**. `assertShippedLook` now runs before every glint measurement.
5. **3.5 is a SEMANTIC gate.** The RGB windows are retired, both the brief's
   `day (255,255,158..172)` / `night (240,238,123)..(255,255,150)` and the 2A4 "measured"
   185/182. B0 measured the render **byte-identical across eleven commits** while the windows moved
   twice — they described a sampling, not the look. Replaced by P1–P4 plus day/night coverage.
6. **Pin validity is ONE rule, shared.** `isValidPin`: front-facing `n·cam ≥ 0.1` AND projected
   core `r/R ≤ 0.97`, used by 3.5, 3.6 and every negative test. 3.6 previously accepted on annulus
   COVERAGE alone, which called `horn-africa` valid at az 0 although it faces away (n·cam −0.575) —
   the flaw that sent the first N1 attempting to inject light behind the globe. Non-vacuity is a
   FAILURE (`requireValidPins`), never a skip.
7. **Pins float by design.** All four cores sit at `|position| = 1.012 × 1.035 + 0.055 = 1.10242 R`.
   The four cores project to r/R 0.375 … 1.101 for that SAME world radius, because r/R is measured
   from the disc centre in screen space. So the bound is on the projected quantity, and a pin can
   exceed it without floating.
8. **Terminator (3.4): redefinition ATTEMPTED AND STOPPED.** The audit in
   `docs/globe-look/TERMINATOR-AUDIT.md` found the old metric's 31 px "width" sits between
   n·L ≈ +0.15 and +0.25, entirely on the DAY side, and **does not contain the n·L = 0 crossing**
   (which is at r/R 0.829). The 16/255 step gate was inherited from a retired whole-disc metric and
   at az 60 measured texture noise where θ = 8.8° puts the terminator off the planet. **Retired in
   intent, still live in code** — see §4 for why.
9. **Glint: verdict V2, ATTENUATED, ACCEPTED by Tariq.** `specularIntensity` is **0** by design
   since `38aa091`; the only glint is the overlay shader. Peak retention 0.5395 (V1 needs ≥ 0.60)
   but area6 retention 0.6202 (needs ≥ 0.50). The three recorded rows:

   | diff | max | area6 | centroid | r/R |
   |---|---:|---:|---|---:|
   | **Dt** = F[0.18][on] − F[0][off] — PRE-FIX | 164.07 | 15469 | (789.5, 347.8) | 0.4859 |
   | **Dm** = F[0.18][on] − F[0][on] — what si 0 removed | 162.93 | 5991 | (803.7, 301) | 0.5867 |
   | **Do** = F[0][on] − F[0][off] — **SHIPPED** | **88.52** | **9594** | (780.8, 376.0) | 0.4388 |

   3.9 guards `Do`. A forced 0.18 may appear ONLY inside the defect engine (N2, N4, N10).
10. **N4 is the FAITHFUL defect.** The original restored half of it. The blue circle came from the
    cool fill light acting on a surface that still had GGX specular; at `intensity: 0.32` on the
    shipped matte surface it lifts blue ~3/255 and moves 3 px in the whole disc (ratio 0.976 →
    0.982). Both halves recovered from git — `2e27939^` (light, (−5.2,−2.2,−4.6), 0.32, `#2f6fb8`)
    and `38aa091^` (si 0.18, roughness floor 0) — take W1 to **3.426**. **A per-channel blue gate was
    rejected:** it would guard an invisible 3/255 lift, which is the opposite of what the look cares
    about, and 3.3's metric is unchanged.
11. **N10 fails on max(D) while area6 stays INSIDE its window.** Defect max **190.28** (over the
    110.7 bound) against area6 **11,261** (inside 12,472). Recorded because it shows the two bounds
    are not redundant: the material lobe is a *taller* but *narrower* concentration than the overlay,
    so a peak bound alone catches it and an area bound alone would not. N10 asserts
    `max > 110.7 OR area6 > 12,472`, i.e. either signal would fail it, and the measured outcome is
    the peak.
12. **N1/N3 were never lost defects.** D1 (`docs/globe-look/D1-DIAGNOSIS.md`) recorded four moments
    and proved the injection survived `fitLimb`, the React re-renders, the program rebuild and the
    capture (+329 %). The old N1 had injected at a SCREEN pixel pair from `project()`, ~291 world
    units off the globe, where `distance: 1` falloff killed it.
13. **E0: the instrumented bundle owns `dist-e2e/`.** Both builds wrote `dist/`, so every gate
    invalidated the E2E bundle and the stamp guard fired on the normal workflow.

## 3. What is NOT established

- **3.4's redefinition is unbuilt.** `docs/globe-look/TERMINATOR-AUDIT.md` §e records the STOP:
  at the default view the `n·L = −0.25` point sits at **r/R 0.957**, outside F5's own 0.95 bound,
  and F5 simultaneously requires the default view to be in the evaluated set. The brief's
  "about 0.68 R" crossing is the orthographic value; a 42° perspective camera at 3.35 R puts it at
  0.829. Two options are written up there and both need a decision.
- **N6 / N6b / N6c do not exist.** They belong to the same blocked redefinition.
- The 3.4 row above therefore describes the OLD metric, kept honest rather than deleted.

## 4. How to run

```bash
pnpm build:e2e                      # instrumented bundle -> dist-e2e/
pnpm e2e:look                       # builds, then look + negative + globe
pnpm e2e                            # batched: one process per spec file
pnpm e2e:raw -- --grep "3.5"        # single process, targeted
```
