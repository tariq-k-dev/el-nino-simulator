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
| **3.4** | terminator: soft and readable | whole-disc n·L bands in D95 (r/R ≤ 0.95): Ld = median luma for n·L ∈ [0.30,0.50], Ln for n·L ∈ [−0.50,−0.15], A = Ld − Ln. Curve C(k) = 20 bins of 0.02 over n·L ∈ [−0.10,+0.30] | VISIBLE **A ≥ 25** and **Ld/max(Ln,1) ≥ 3**; SOFT **S ≤ 0.25** where S = max\|C(k+1)−C(k)\|/A | default **A 57.28, ratio 12.57, S 0.116** (PASS) — **az 120 S 0.294 and az 150 S 0.268 FAIL**, see §3 | **NOT GATED YET** — N6/N6b/N6c unbuilt, see §3 |
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
8. **Terminator (3.4): REDEFINED at the definition level, STOPPED at the gate level.**

   Three decisions from the prompt, recorded because each corrected an earlier error:

   - **D1 — the 0.95 bound is NOT widened to 0.97.** A 4 px margin is fragile, and widening would not
     remove the second blocker anyway (the sampling one, D3).
   - **D2 — the orthographic hint was WRONG for this camera, and is retracted.** With R = 1, camera
     distance d = 3.3534 and α the central angle from the view axis,
     `r/R = sin(α)·√(d²−1) / (d − cos α)`. At θ = 47.2° that gives crossing **0.830**, n·L=+0.25 at
     **0.614**, n·L=−0.25 at **0.957** — matching the audit's measured 0.829 / 0.613 / 0.957. The old
     hint ("crossing 0.68, −0.25 at 0.84") was orthographic and 0.15 R out. The closed form is now the
     only oracle (`rOverROracle`), unit-tested to ±0.002. **No orthographic hint remains in tests or
     docs.**
   - **D3 — the SAMPLING changed, the THRESHOLDS did not.** Taking Ld/Ln from the 1 px axis profile
     would fail the real default view for a physical reason the audit had already measured: the night
     side is an emissive floor (0.18, independent of n·L), and at n·L = +0.25 the Lambert term has
     barely started — the axis reads 18.6 there against a whole-disc median of 62.3 for the same band.
     One line of albedo is not a level. Ld, Ln and the curve are now whole-disc n·L bands (thousands
     of pixels). A ≥ 25, Ld/max(Ln,1) ≥ 3 and S ≤ 0.25 are **exactly** as first written.

   **RETIRED** (reason, not preference): the `width ≥ 6 % R_fit` gate — it measured the endpoints of a
   locally monotonic segment of a Lambert profile, which has no day plateau, so the "width" was
   wherever a texture-driven descent started and stopped; the audit showed that segment sitting between
   n·L +0.15 and +0.25, entirely on the day side, **not containing the n·L = 0 crossing**. And the
   fixed **16/255** cross-terminator step — inherited from a whole-disc metric that no longer exists,
   and at az 60 it measured 13.69/255 where θ = 8.8° puts the terminator off the planet entirely.
   Both survive as INFORMATION ONLY and are source-guarded so no test may assert them again.
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

## 3. What is NOT established — 3.4, and it is a real STOP

The redefinition is **built** (`tests/e2e/look/terminatorProfile.ts`, 20 unit tests including every
synthetic curve the prompt names and the D2 oracle to ±0.002) and the evaluated set is computed from
**geometry alone and printed before measuring** (`terminatorApplicability.ts`). Three of the seven
evaluated azimuths do not pass the gate on the real render:

| az | θ | cross r/R | Ld | Ln | A | Ld/Ln | S | headroom 0.25/S | worst bin | worst step | VISIBLE | SOFT |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|
| **0** | 47.2 | 0.829 | 62.23 | 4.95 | **57.28** | **12.57** | **0.116** | 2.16 | 14 | 6.64 | pass | **pass** |
| 120 | 64.3 | 0.565 | 85.39 | 13.95 | 71.44 | 6.12 | **0.294** | 0.85 | 7 | 20.99 | pass | **FAIL** |
| 150 | 91.1 | 0.025 | 89.56 | 18.10 | 71.46 | 4.95 | **0.268** | 0.93 | 7 | 19.18 | pass | **FAIL** |
| 180 | 115.6 | 0.563 | 89.97 | 20.95 | 69.02 | 4.29 | 0.241 | 1.04 | 7 | 16.60 | pass | pass |
| 270 | 123.6 | 0.703 | 70.58 | 7.74 | 62.83 | 9.12 | 0.110 | 2.27 | 11 | 6.93 | pass | pass |
| 300 | 100.7 | 0.250 | 64.21 | 6.17 | 58.04 | 10.40 | 0.091 | 2.74 | 5 | 5.29 | pass | pass |
| 330 | 74.6 | 0.356 | 62.37 | 5.95 | 56.42 | 10.47 | 0.100 | 2.50 | 15 | 5.64 | pass | pass |

Not evaluated (3 of 12 fail applicability): az 30 and 60 have **no night band at all** (the sun is
almost behind the camera), az 90 and 210 and 240 lack a band or a populated bin. Az 0, 270, 300 and 330
have huge SOFT headroom (S ≈ 0.10, headroom 2.2–2.7).

**Why 120 and 150 fail, stated as a measurement.** Their worst step is in curve bin **7**, i.e. the
n·L bin **[0.04, 0.06)** — about 15–20 px past the terminator — with a step of 21.0 and 19.2 luma
against A ≈ 71. Both azimuths put the terminator almost exactly through the disc CENTRE (crossing at
r/R 0.565 and **0.025**), so the axis and its ±0.1R/±0.2R parallel lines run along the terminator
itself, and the band's albedo changes sharply there. The curve is a median over D95, so this is real
surface content, not aliasing: the terminator sits over a coastline.

The prompt's rule is explicit — *"if the default view fails VISIBLE or SOFT, **or any evaluated azimuth
fails**, STOP and report the full 20-bin curve, Ld, Ln, A, S and the counts; do NOT change definitions
or thresholds."* The default view passes; az 120 and az 150 do not. **Nothing was changed.** 3.4 keeps
its existing (now partly retired) metrics and the new gate is dormant.

**N6 / N6b / N6c are therefore unbuilt** — they were specified as the negatives FOR this gate, and a
negative test for a gate that is not live would be asserting a verdict the suite does not enforce. The
mutation machinery they need is built and unused: `mutateTerminator(img, geom, 'step'|'flat', grey)` and
`evaluateTerminator` are pure and independently tested, so wiring them up after a decision is
mechanical.

Options, none of them mine to pick:

1. **Accept that 3.4 is a per-azimuth property, not a global one.** Gate the default view and report
   the rest; az 120/150 legitimately have a terminator over varying albedo. This is the only option
   that changes no number and no definition — it changes what the spec CLAIMS.
2. **Gate VISIBLE everywhere and SOFT only where the crossing is at r/R > some floor** (az 120 and 150
   have crossings at 0.565 and 0.025, i.e. through the middle of the disc). That is a new applicability
   condition, and adding one after seeing the failures is exactly the shape of tuning.
3. **Reconsider S.** Bins are 0.02 in n·L — S ≤ 0.25 allows an 0.08-n·L transition, about 25 px. If a
   real coastline inside the terminator band can move a bin median by 20 luma, the metric may be
   measuring albedo rather than softness, which is D3's finding applied one level further.

The 20-bin default-view curve, for anyone re-opening this:

```
n·L    -0.09  -0.07  -0.05  -0.03  -0.01   0.01   0.03   0.05   0.07   0.09
luma    5.81   5.80   5.88   5.88   6.59   7.88  12.44  14.30  15.52  16.59
n·L     0.11   0.13   0.15   0.17   0.19   0.21   0.23   0.25   0.27   0.29
luma   18.48  23.36  23.66  22.66  24.87  31.52  35.52  36.45  37.31  36.45
```

Note the non-monotonicity at 0.15→0.17 and 0.27→0.29: that is already albedo intruding on the curve at
the default view, and it is the same phenomenon that fails az 120/150 at a larger amplitude.

## 4. How to run

```bash
pnpm build:e2e                      # instrumented bundle -> dist-e2e/
pnpm e2e:look                       # builds, then look + negative + globe
pnpm e2e                            # batched: one process per spec file
pnpm e2e:raw -- --grep "3.5"        # single process, targeted
```
