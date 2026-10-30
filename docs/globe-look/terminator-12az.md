# 3.4 terminator — 12-azimuth table and derived threshold

Night fraction definition: **share of disc pixels with luminance < 25% of the day mean**
(the LOOK2.md "night fraction (luma)" measure, which produced the 14.1% default-view
figure). The 10-30% / 70-90% luma bands belong to the relative before/after comparison and
are NOT gated here.

Cross-terminator step = max adjacent 1 px luma step on the median-of-5 profile, measured
only BETWEEN the 90% and 10% crossings. A step elsewhere is limb darkening or cloud
texture, which no terminator rule may be blamed for.

| az | night mean luma | cross step /255 | width px | width % R_fit | night frac (luma) | R_fit |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 11.04 | 5.05 | 530.0 | 162.76 | 15.40% | 325.664 |
| 30 | 19.09 | 12.31 | 608.0 | 186.70 | 2.65% | 325.671 |
| 60 | 27.84 | 2.90 | 6.7 | 2.05 | 0.40% | 325.67 |
| 90 | 15.72 | 9.31 | 612.3 | 188.03 | 4.97% | 325.664 |
| 120 | 13.09 | 11.67 | 487.7 | 149.75 | 21.29% | 325.672 |
| 150 | 9.88 | 7.98 | 300.2 | 92.18 | 36.77% | 325.671 |
| 180 | 6.68 | 4.05 | 306.6 | 94.13 | 38.57% | 325.663 |
| 210 | 5.58 | 3.11 | 241.7 | 74.21 | 37.55% | 325.671 |
| 240 | 5.14 | 5.38 | 166.9 | 51.26 | 36.41% | 325.671 |
| 270 | 5.35 | 6.02 | 93.6 | 28.74 | 45.81% | 325.663 |
| 300 | 6.15 | 4.16 | 224.7 | 69.00 | 50.33% | 325.672 |
| 330 | 8.04 | 6.53 | 343.4 | 105.43 | 36.58% | 325.671 |

Derived gate: `ceil(1.25 x max measured)` = ceil(1.25 x **12.31**) = **16/255**.

## STOP condition tripped

The brief says: "if any measured step > 12/255, STOP and report." The maximum is
**12.31/255 at az 30**, so this spec is reported and NOT tuned. The
default-view case passes.

## A second, separate harness defect found here

Widths of **162.76% / 186.70% / 188.03% of R_fit** are not physical: the terminator
cannot be wider than the disc. The 90%->10% scan is being run over a profile whose
secondary bright band fools the first-crossing pick, so for az 0/30/90 the reported width
is a scan artifact rather than a softness measure. It does not affect the default-view
gate's outcome direction (530 px still comfortably exceeds 6% of R), but the number
itself is wrong and is recorded here rather than quoted as a real measurement.

`transitionWidth` is unit-tested against synthetic ramps and is not the suspect — the
suspect is the caller passing a whole-disc profile that is not monotonic across it.
