# 3B-1a-SPECLOCK status

After **2A4**. Gate (`pnpm tsc -b && pnpm lint && pnpm test && pnpm build`) green at every
commit: 597 unit tests, 0 test hooks in the production bundle.

| spec | commit | result |
|---|---|---|
| 3.1 rim | `4d275d2` | **PASS** — peak 94.2, worst rise 0.44/255 from +3 px |
| 3.2 glare | `ab238a6` | **PASS** — 0 clipped, 0 blobs, 12/12 az |
| 3.3 local peak | `02a05a4` | **PASS** — W1 only, ratio 0.976 |
| 3.4 terminator default | `460e333` | **PASS** — width 31.0 px (9.51% R), night frac 15.40% |
| 3.4 terminator 12-az | `460e333` | **PASS** — max step 13.69/255 vs 16/255 gate |
| 3.5 pins day/night | `a398cc2` | **FAIL** — blue channel 181–189 vs 158–172 day / 123–150 night |
| 3.6 ring light cast | `c73578f` | **PASS** — 3 measurable pins 0.002–2.849% vs 3% floor |
| 3.7 console | `3b63953` | **PASS** — 0 app messages |
| 3.8 zoom | `3b63953` | **PASS** — 5/5 untouched |

## 3.5 is the only open failure

Every pin core renders B **181–189** where the brief's day window tops out at 184 (with
+-12 tolerance) and the night window at 162. The cores are readable, not black, and carry
no blown pixels — they are desaturated relative to the approved look. Not tuned: the
windows are unchanged and the numbers are recorded in the spec's output and in
`test-results/look/pin-cores.json`.

## Glint (unchanged from 2A2)

`specularIntensity` stays **0**. `GLINT REMOVED - needs Tariq's decision` at the top of
`docs/globe-look/CLIPPED-FACTS.md` with `glint-before-after.png`.

## Metric redefinitions across 2A3/2A4

1. **Probe windows**: absolute px → polar (rFrac, deg clockwise from +x) resolved against
   fitLimb; **W1 only** retained (W2–W8 flagged scene content: W5 1.240, W8 1.191).
2. **Glint exclusion**: 0.15 R circle at an orthographic half-vector point → measured
   `specularMask` (3/255, dilated 8 px).
3. **Terminator width**: whole-disc 90→10% scan → measured inside `terminatorFalloff`
   (longest sustained descent by total luma dropped). The old scan reported widths of
   162–188% of R_fit, i.e. wider than the planet.
4. **Terminator step gate**: `ceil(1.25 x max)` derived per-run → fixed **16/255**
   constant, equal to the 2A3 derivation. Stating it prevents a regression from moving
   the gate by inflating the maximum it would be computed from.
5. **`crossTerminatorStep`**: max adjacent step only BETWEEN the 90% and 10% crossings.
6. **Pin day/night**: screen-axis projection (which labelled pacific "night" at az 0,
   wrongly) → the pin's surface normal against the sun, i.e. the `dot(n, sun)` the shader
   lights with.
7. **Ring-cast validity**: pins whose annulus is not >=70% surface are reported INVALID
   rather than gated. pacific projects to 1.100 R — outside the disc — so its 20.4%
   "delta" was sky, not cast light. Same class as the deleted (300,392) window.

## Spec source

`docs/prompts/speclock-2a.md` holds A3/A4 plus the 2A3/2A4 amendments.
