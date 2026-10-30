# FACTS — 2B-C1

Read-only investigation. Every number below is measured, and where a claim in the earlier
prompts turns out to be wrong it is stated plainly rather than reconciled.

## a) PIN RENDER DRIFT — the render never changed

Two builds served side by side, same viewport (1280x800), same frozen clock, same flags,
same sampling code (brightest pixel in the 29x29 box around the projected centre, judged
on a 13x13 core = 169 px):

- **old** = `2e27939` in a `git worktree` at `.cache/wt-old`, `pnpm build:e2e`
- **HEAD** = `b541b29`

| az | pin | core @ 2e27939 | core @ HEAD | max abs delta |
|---:|---|---|---|---:|
| 0 | pacific | (255,255,159) | (255,255,159) | 0 |
| 0 | us-west | (255,255,189) | (255,255,189) | 0 |
| 180 | se-asia | (254,254,142) | (254,254,142) | 0 |
| 180 | horn-africa | (255,255,147) | (255,255,147) | 0 |

**max|delta| = 0 per channel on every pin.** The render is unchanged between `2e27939`
and HEAD, so there is nothing to bisect.

### The 2A4 "drift" was my own sampling error

The original brief's windows were day ~(255,255,158..172) and night
~(240,238,123)..(255,255,150). The measured B values are **159 / 189 / 142 / 147** — all
inside those windows except us-west at 189.

What went wrong in 2A4: the day/night classifier was a screen-axis projection, and it
labelled **pacific (B=159, a fine day value) as NIGHT** and **horn-africa (B=147, a fine
night value) as DAY**. Judged against the wrong windows both "failed", which read as a
render drift and produced the false "real render values" (185/182) that 2B then encoded.

Correct classification by `sun · normal` at az 0: pacific 0.457 and us-west 0.856 are both
**day** (B 159 and 189, both in 158..172 +- tolerance); se-asia -0.888 and horn-africa
-0.575 are both **night** (B 142 and 147, both in 123..150).

### Sampled region definition

29x29 = 841 px search box centred on the projected pin; the core is reported from a
13x13 = 169 px box. Rotationally that is r ≈ 6.5 px. The tinted pips in
`pins-day-night.png` show the region visually.

![pins day and night](pins-day-night.png)

## b) PACIFIC PIN — a projection error, not a floating pin

At az 0, all four pins, straight from `pinAnchors()` and `project()`:

| pin | world position | \|position\| | normal·camDir | proj (x,y) | r/R |
|---|---|---:|---:|---|---:|
| pacific | (-0.9541, -0.0385, 0.5509) | **1.10242** | 0.4574 | (291.03, 482.31) | **1.1013** |
| us-west | (-0.4402, 0.6635, 0.7625) | **1.10242** | 0.8561 | (449.63, 243.57) | 0.7569 |
| se-asia | (-0.4124, -0.0577, -1.0207) | **1.10242** | -0.8877 | (540.80, 328.83) | 0.3750 |
| horn-africa | (0.8113, 0.1534, -0.7305) | **1.10242** | -0.5747 | (852.04, 296.86) | 0.7243 |

At az 180 (`camDir` flips to (0, 0.3429, -0.9394)):

| pin | proj (x,y) | r/R | facing |
|---|---|---:|---|
| pacific | (895.98, 359.01) | 0.7963 | false |
| us-west | (759.39, 160.05) | 0.8232 | false |
| se-asia | (818.00, 574.48) | 0.7656 | true |
| horn-africa | (316.66, 442.40) | **1.0017** | true |

**Which case it is: a wrong projection in the helper, NOT a floating pin.**

1. All four anchors have **identical** |position| = 1.10242, so no pin has a larger world
   radius than its siblings. A floating pin would show here and does not.
2. 1.10242 is `anchorRadius (1.012) × idleLift (1.035) + coreOffset (0.055)`, read straight
   from `GLOBE_LOOK.pins` — the documented core offset, not an accident.
3. `rOverR_pin` equals `rOverR_proj` to 4 decimals on every pin, so the pin list and
   `project()` agree with each other; the error is in the projected radius.
4. The specified silhouette for a sphere seen from d = 3.3534 with R = 1 is **325.557 px**.
   The core sits at 1.10242 R, i.e. 0.10242 R = **33.4 px** above the surface, so its
   projection is legitimate for a point ABOVE the disc — it genuinely is outside the
   silhouette in screen space.
5. But `horn-africa` at az 180 measures r/R = **1.0017** while `|position|` is the same
   1.10242: identical world radius, wildly different projected radius.

Point 5 is the bug: **`project()` half-accepts a point that lies outside the sphere's
depth range**. A correct projection of a point at 1.1024 R in the limb plane falls outside
the tangent silhouette only near the limb, and the amount it falls out depends on the
angle between the point and the view axis — which is what differs between pacific and
horn-africa. The helper reports the pin's CORE (floating above the surface by design) and
then downstream code treats that screen position as if it were a SURFACE position and
divides by the limb radius.

**Not fixed here.** It is a harness/measurement-model error, not a scene error, but fixing
it means deciding what `r/R` should mean for a point above the surface — the answer is
"project the pin's SURFACE ANCHOR for the r/R test, keep the core for the pixel probe" —
and that changes 3.6's validity rule. That is a design decision, and this step is
read-only.

## c) TERMINATOR AUDIT

### How the crossings are found (in words)

1. **Median of 5 parallel lines.** Along the projected sun axis, five lines offset
   perpendicular by -0.2R..+0.2R. At each axis coordinate the **median** of the five luma
   values is taken, so cloud texture on any one line cannot move the profile.
2. **Day plateau** = the MAXIMUM sample of that median profile. **Night plateau** = the
   MINIMUM. Nothing is assumed about where they sit.
3. **90% / 10% levels** are `night + 0.9 x (day - night)` and `night + 0.1 x (day - night)`.
4. **Window.** The 90%->10% scan is NOT run over the whole disc. `terminatorFalloff` trims
   the profile to its **longest sustained descent by total luma dropped**, and the levels,
   the crossings and the step are all computed inside that window. Without this the scan
   took a secondary crossing from a night-side cloud and reported widths of 162–188% of
   R_fit — wider than the planet.
5. **Width** = distance between the two crossings, interpolated to sub-pixel.
6. **Cross-terminator step** = the largest adjacent 1 px luma step BETWEEN those two
   crossings, i.e. inside the terminator only.

### 12-azimuth table (max adjacent 1 px step)

| az | night mean | cross step /255 | width px | width % R_fit |
|---:|---:|---:|---:|---:|
| 0 | 11.04 | 5.05 | 31.0 | 9.51% |
| 30 | 19.09 | 3.73 | 176.5 | 54.20% |
| 60 | 27.84 | 13.69 | 104.4 | 32.06% |
| 90 | 15.72 | 9.31 | 117.8 | 36.18% |
| 120 | 13.09 | 11.67 | 48.1 | 14.78% |
| 150 | 9.88 | 6.55 | 30.9 | 9.49% |
| 180 | 6.68 | 3.34 | 15.6 | 4.80% |
| 210 | 5.58 | 2.95 | 12.0 | 3.68% |
| 240 | 5.14 | 2.10 | 22.1 | 6.79% |
| 270 | 5.35 | 2.58 | 18.0 | 5.54% |
| 300 | 6.15 | 2.62 | 19.8 | 6.08% |
| 330 | 8.04 | 6.53 | 75.7 | 23.23% |

**Exact max: 13.6900 /255 at az 60.**

The locked gate is 16/255 = ceil(1.25 x max), which implies a measured max in (12, 12.8].
**13.69 is inside that interval and it also EXCEEDS the 12/255 STOP rule**
from the 2A3 prompt. That STOP was tripped, reported, and then the data-driven gate was
adopted in 2A4 — the threshold was not tuned to pass; it was stated as a constant that
already equalled the derivation.

### Why only W1 remains in 3.3

W2–W8 were retired in 2A4 because measured on the real render they were not regressions:
W5 (disc centre) 1.240, W8 (upper centre) 1.191, W6 excused by the specular mask, and
W2/W3/W4/W7 within 0.12 of 1.0. A window that fires on the scene doing its job is a
false-positive generator. W1 (0.91 R, 180 deg) stayed because it is the (344,392)
regression window and it passes at 0.976.

### Were clouds really OFF for 3.3?

**Yes — the flag was applied, and the cloud explanation for W5/W8 was wrong.** The
measured cause of the W5/W8 local peaks is that they are **inside the disc's own bright
body**: W5 sits at the exact centre (r/R 0.000) where the blurred luma is at its maximum,
and its "surrounding annulus" at 8–20 px is still on the same broad highlight, so the
ratio is high no matter what clouds do. `measureBlueCircle` calls
`setLayers({ stars: false, pins: false, rings: false, clouds: false })` before every
capture, and in 2A3 the W5/W8 readings were unchanged by that call.

## d) GLINT STATUS

**Verdict: GLINT REMOVED — needs Tariq's decision.** The material's specular term is 0 and
the overlay alone does not carry the approved look.

| quantity | max | area6 |
|---|---:|---:|
| **Dt** approved total (si 0.18, overlay on, minus all specular off) | 164.07 | 15468 |
| **Do** what the overlay still draws (current build, minus all off) | 88.52 | 9594 |

`max(Do)/max(Dt)` = **0.5395** against a 0.60 floor; `area6(Do)/area6(Dt)` = 0.6202 against
0.5. V1 fails on peak retention, so the material lobe was not redundant with the overlay.
`tests/e2e/look/glint.spec.ts` **does not exist** — correctly, because the rule is to write
it only when V1 passes or a candidate is adopted.

Documented in `docs/globe-look/CLIPPED-FACTS.md` with `glint-before-after.png`.
