# 3B-1a-SPECLOCK status

Honest state after **2A3**. Gate (`pnpm tsc -b && pnpm lint && pnpm test && pnpm build`)
is green at every commit below: 582 unit tests, 0 test hooks in the production bundle.

## Done and green

| step | commit | spec | result |
|---|---|---|---|
| A2 limb ground truth | `2b15ebf` | — | R_fit 325.664 (RMS 0.244), hook agrees to 0.107 px |
| B1 glint | `a2d0be5` | — | verdict: glint removed, needs your decision |
| B2 rim | `4d275d2` | **3.1** | **PASS** |
| A3 windows | `907b51c` | **3.3** | **FAIL** (W5 1.240, W8 1.191) |
| 3.2 glare | `ab238a6` | **3.2** | **PASS** (0 clipped, 0 blobs, 12/12 az) |
| 3.4 terminator | `3a8c511` | **3.4** default | **PASS** (width 530 px, night frac 15.40%, night mean 11.04) |
| 3.4 terminator | `3a8c511` | **3.4** 12-az | **STOP** — max step 12.31/255 > 12/255 at az 30 |

## Not done

- **3.5 pins day/night** — not started.
- **3.6 ring luminance** — not started.
- **3.7 console clean** — not started.
- **3.8 zoom cases** — not run in this session (untouched).

## Two open defects, both reported rather than tuned

1. **3.3 W5 (centre) ratio 1.240 and W8 (upper centre) ratio 1.191** against a 1.15
   gate. W1 — the window that exists to guard the removed fill light's blue circle —
   passes at 0.976, so the regression is clear. W5/W8 sit outside the measured specular
   mask and are a broad bright patch at/near the disc centre. Threshold untouched.
2. **3.4 cross-terminator step 12.31/255 at az 30** trips the brief's own STOP at
   12/255. The derived gate would be 16/255 but the STOP fires first.
3. Related harness bug: terminator widths of 162–188% of R at az 0/30/90 are not
   physical (see `docs/globe-look/terminator-12az.md`). `transitionWidth` is unit-tested;
   the caller's non-monotonic whole-disc profile is the suspect.

## Glint

`specularIntensity` stays **0**. The material's own lobe contributed a 162.93/255 peak
that the overlay only replaces to 88.52/255 (53.95% retention vs a 60% floor). Both
candidate intensities still clipped at 12 azimuths. `GLINT REMOVED - needs Tariq's
decision` is at the top of `docs/globe-look/CLIPPED-FACTS.md` with
`glint-before-after.png`. The grazing-falloff shader patch was written but never reached
the GPU (`onBeforeCompile` fired zero times because R3F only renders on invalidation),
so it was reverted rather than shipped unvalidated.

## Spec source

`docs/prompts/speclock-2a.md` was missing when 2A3 began and has been restored there as
the committed source of truth for A3/A4, including the 2A3 amendments.
