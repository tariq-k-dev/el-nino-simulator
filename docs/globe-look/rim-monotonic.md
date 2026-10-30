# B2 — 3.1 rim: diagnosing the 2.65/255 non-monotonic residual

## Diagnosis (six layer variants, 16 rays, gate origin = fitted limb)

Limb: R_fit **325.959** px, RMS 0.29, 360 rays, centre (639.748, 399.431).
Camera: fov 42, canvas height 800, distance 3.3534, focal **1042.04** px.

Silhouette offsets from `f*r/sqrt(d^2-r^2)`, past the tangent limb:

| layer | radius | silhouette offset |
|---|---:|---:|
| atmosphere shell | 1.1 R | 35.881 px |
| cloud deck | 1.004 R | 1.028 px |
| glint overlay | 1.0012 R | 0.027 px |
| surface | 1 R | -0.402 px |

Worst outward rise per variant:

| variant | worst rise | where |
|---|---:|---|
| all-on | 7.64/255 | 247.5deg, -1->+0 px |
| rings OFF | 7.08/255 | 247.5deg |
| pins OFF | 7.64/255 | 247.5deg |
| **clouds OFF** | **-0.39/255** | 180deg (no rise anywhere) |
| rings+pins OFF | 8.36/255 | 247.5deg |
| atmosphere only (rings+pins+clouds OFF) | -0.59/255 | 135deg (no rise) |

**The cloud deck is the cause.** Switching it off removes the rise entirely
(-0.39/255); rings and pins move it by <1/255 and the atmosphere alone does not produce
one at all. The rise sits at **-1 -> 0 px**, i.e. inside the limb, which is where the
cloud shell's own antialiased edge lands (+1.03 px past the fit).

## Raw profile at 247.5 deg (all-on)

| offset | -6 | -5 | -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| luma | 92.9 | 89.4 | 91.8 | 78.6 | 77.3 | 76.3 | 83.9 | 76.0 | 65.7 | 58.9 | 52.9 | 47.0 | 41.7 | 36.6 | 32.2 | 27.9 | 23.6 | 20.2 | 17.3 | 14.3 | 11.8 | 9.7 | 7.8 | 6.5 | 5.5 | 4.7 | 4.0 |

Rises from -1 (76.3) to 0 (83.9) = **+7.6**, then falls monotonically to +20 (4.0).
With clouds OFF the same ray reads 16.6 at -1 and 62.7 at 0 — the cloud deck is the only
thing at that radius.

## Decision rule applied: **(b)**

The rise lies inside the antialiased silhouette band and at the cloud shell's own
silhouette, so it is a **real, approved part of the look**, not a defect. The strict
monotonic gate therefore starts at

    max(peak offset, outermost opaque silhouette + 1 px)

which on the real render is **start = 3 px**
(peak 1 px, cloud shell 1.43 px,
outermost opaque 1.43 px, ceil(... + 1) = 3).
The atmosphere is NOT counted as opaque: at +36 px it would skip the entire halo.
Everything else in 3.1 is unchanged, and the tolerance stays 1/255.

## Result after the rule

| metric | value | gate | pass |
|---|---:|---|---|
| peak | 94.15572171905231/255 | <= 110 | yes |
| peak offset | +1 px | >= 0 | yes |
| worst outward rise (from +3 px) | **0.00/255** | <= 1 | **yes** |
| shell vs background | 0.29/255 | <= 2 | yes |
| max abs adjacent step beyond +2 px | 7.85/255 | <= 16 | yes |
| limb -> halo step (reported only) | 38.8/255 | - | - |

`look.spec.ts` case **3.1 passes on the real render**.

## Metric redefinitions in B2

1. **Monotonic gate origin**: outward of the per-ray peak -> outward of
   `max(peak, outermost opaque silhouette + 1 px)`, with the reason recorded in the
   result (`result.monotonic.reason`) rather than implied.
2. **"Opaque" excludes the atmosphere** on purpose — an additive halo's 1.1 R
   silhouette is not the end of the profile.
3. **Rim profile sampling is bilinear** on a sub-pixel fitted origin (carried from A2).

## Why this is not a threshold relaxation

The gate still requires a strictly decreasing profile with a 1/255 tolerance; only the
deterministic start moved, by exactly the width of the band where a shell outside the
planet is known to brighten. The unit tests pin both directions: a synthetic rise at
+1 px passes, a rise at +10 px fails. Nothing that used to fail outside the band now
passes inside it.
