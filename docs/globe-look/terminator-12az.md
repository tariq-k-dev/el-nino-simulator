# 3.4 terminator — 12-azimuth table and gate

Night fraction (luma) = share of disc pixels with luminance < 25% of the day mean
(LOOK2.md's measure; the one that produced the 14.1% default-view figure).

Width and step are measured ONLY inside the terminator's own locally monotonic falloff
(`terminatorFalloff`: the longest sustained descent by total luma dropped). Scanning the
whole disc is what produced the impossible 162.76/186.70/188.03% "widths" in 2A3.

| az | night mean | cross step /255 | width px | width %R_fit | night frac |
|---:|---:|---:|---:|---:|---:|
| 0 | 11.04 | 5.05 | 31.0 | 9.51% | 15.40% |
| 30 | 19.09 | 3.73 | 176.5 | 54.20% | 2.65% |
| 60 | 27.84 | 13.69 | 104.4 | 32.06% | 0.40% |
| 90 | 15.72 | 9.31 | 117.8 | 36.18% | 4.97% |
| 120 | 13.09 | 11.67 | 48.1 | 14.78% | 21.29% |
| 150 | 9.88 | 6.55 | 30.9 | 9.49% | 36.77% |
| 180 | 6.68 | 3.34 | 15.6 | 4.80% | 38.57% |
| 210 | 5.58 | 2.95 | 12.0 | 3.68% | 37.55% |
| 240 | 5.14 | 2.10 | 22.1 | 6.79% | 36.41% |
| 270 | 5.35 | 2.58 | 18.0 | 5.54% | 45.81% |
| 300 | 6.15 | 2.62 | 19.8 | 6.08% | 50.33% |
| 330 | 8.04 | 6.53 | 75.7 | 23.23% | 36.58% |

**Gate: 16/255** maximum adjacent 1 px step across the terminator, all 12 azimuths.
Adopted as a fixed constant in 2A4; it equals the 2A3 derivation `ceil(1.25 x 12.31)`.
Max measured: **13.69/255 (az 60)** — under the gate.

Default view: width **31.0 px = 9.51% of R_fit** (>= 6%), night mean 11.04/255 (>= 4),
night fraction 15.40%.

## Why the widths vary so much between azimuths

They are genuine: the terminator is a great circle seen at different angles, so its
projected width changes with the camera's view of it. az 180-300 give 12-22 px (edge-on,
looked through the terminator), az 30-90 give 100-176 px (face-on). The default-view
9.51% is the value the 6%-of-R gate applies to.
