# Difference table (default view, clock frozen, R_fit 325.959, RMS 0.290, 360 rays)

| diff | max | p99.9 | area>6 | area>3 | bbox | centroid | r/R |
|---|---:|---:|---:|---:|---|---|---:|
| Dt = F[0.18][on] - F[0][off] (approved total) | 164.07 | 105.46 | 15468 | 38024 | [608, 178, 964, 714] | [789.5, 347.8] | 0.4859 |
| Dm = F[0.18][on] - F[0][on] (what si=0 removed) | 162.93 | 104.01 | 5991 | 9583 | [701, 178, 859, 714] | [803.7, 301] | 0.5867 |
| Do = F[0][on] - F[0][off] (overlay today) | 88.52 | 73.89 | 9594 | 22571 | [611, 306, 964, 587] | [780.8, 376] | 0.4388 |
## Verdict V1

Criterion: `max(Do) >= 0.6 * max(Dt)` **and** `area6(Do) >= 0.5 * area6(Dt)`.

| test | measured | threshold | pass |
|---|---:|---:|---|
| max(Do) / max(Dt) | 0.5395 | >= 0.60 | **no** |
| area6(Do) / area6(Dt) | 0.6202 | >= 0.50 | yes |

**V1 fails on peak retention**, so the material lobe is not redundant with the overlay.
Note the two centroids are 75 px apart — (803.7, 301) for the material's GGX lobe vs
(780.8, 376) for the overlay — which is why `sunGlintPoint`'s single orthographic point
was never a valid exclusion for either: it landed at (768.2, 375.8), 89 px from the
material lobe.

## Metric redefinitions in this step

1. **Glint measured as a signed difference image**, not as peak luma in a region.
   Peak-luma-in-a-window counts cloud tops (they reach ~210), which is how a build that
   lost half its specular reported a "92% retained peak".
2. **`sunGlintPoint` deleted.** Its orthographic half-vector projection landed 89 px
   from the measured lobe; a broad lobe has no single point. Replaced by
   `specularMask()`, the measured specular difference dilated 8 px.
3. **3.3's glint exclusion** now uses that mask instead of a 0.15 R circle.
4. **`specularIntensity` is a runtime control** on `__look`, so candidates are compared
   inside one bundle instead of across a rebuild.
