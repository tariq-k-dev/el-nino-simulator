# FLAT-ALBEDO PROBE — diagnosis of the F5 STOP (step D)

Executed before any threshold moved. Every number below was measured on the stamped E2E bundle
(`srcHash d58d4072ea91`) by `tests/e2e/look/flatAlbedoProbe.spec.ts`, and written to
`test-results/look/flat-albedo-probe.json`.

**Outcome: H1 (geography) accepted. H2 (shading) rejected.** Per rule E3, F5b proceeds.

---

## The question

F5's SOFT gate failed on the real render at az 120 (S 0.294) and az 150 (S 0.268) against 0.25. Two
explanations were live:

| | explanation | prediction for the flat render |
|---|---|---|
| **H1** | **geography** — with the clock frozen the terminator is a fixed great circle, so a 0.02-wide n·L bin is a thin geographic strip and its median luma is whatever land, ocean or ice it crosses | S collapses toward the Lambert expectation, ≈ 0.05 |
| **H2** | **shading** — a real discontinuity in the Earth material near n·L ≈ 0.05 | S stays ≥ 0.25 |

The probe removes the textures (`map` and `emissiveMap` set to null, flat per-channel means put on
`color` and `emissive`), leaving the surface a pure function of n·L. Any step that survives is the
shader.

## Conditions

Identical to P2FIX in every respect that could confound the comparison: the same **7 evaluated
azimuths** `[0, 120, 150, 180, 270, 300, 330]`, flags `stars/pins/rings false`, clock frozen by
`settleAt`, the same camera and the same R_fit, the same sun, lights, overlay and glint. Only the
surface material's textures changed.

Injection went through the **same `__defects` handle** N6c uses — `flatAlbedo`, with the mean colours
computed in-page by drawing each texture to a canvas. No second injection path was introduced and no
production code was touched.

### The flat colours, in LINEAR space

```
day texture mean   [0.1854, 0.2010, 0.2709]
night texture mean [0.0034, 0.0039, 0.0091]
```

Averaging in sRGB would have been wrong by construction: the mean of 0.0 and 1.0 is 0.5 there but
0.21 in linear, and three multiplies in linear light, so an sRGB mean of a mostly-dark ocean renders
far too bright. The night mean is ~0.004 — the night side really is almost black once the emissive
texture's own brightness is folded in.

## Results — 21 measurements, 3 levels × 7 azimuths

`level` scales the day colour only (×0.5, ×1.0, ×1.5, each channel clamped to 1); the night colour is
unchanged so the floor the night side provides is not disturbed.

| az | Ld | Ln | A | Ld/Ln | S | worst bin | worst step | SOFT |
|---:|---:|---:|---:|---:|---:|---:|---:|:--|
| **×0.5** | | | | | | | | |
| 0 | 39.22 | 1.22 | 38.00 | 32.23 | **0.1767** | 14 | 6.72 | pass |
| 120 | 20.08 | 7.94 | 12.14 | 2.53 | **0.1647** | 11 | 2.00 | pass |
| 150 | 20.29 | 7.86 | 12.43 | 2.58 | **0.1582** | 9 | 1.97 | pass |
| 180 | 20.29 | 8.87 | 11.43 | 2.29 | **0.2440** | 15 | 2.79 | pass |
| 270 | 59.22 | 3.15 | 56.07 | 18.81 | **0.1401** | 5 | 7.86 | pass |
| 300 | 33.00 | 2.29 | 30.72 | 14.42 | **0.2256** | 5 | 6.93 | pass |
| 330 | 36.22 | 2.08 | 34.14 | 17.44 | **0.1716** | 5 | 5.86 | pass |
| **×1.0** | | | | | | | | |
| 0 | 45.22 | 3.15 | 42.07 | 14.35 | **0.1476** | 14 | 6.21 | pass |
| 120 | 38.59 | 9.08 | 29.51 | 4.25 | **0.0969** | 6 | 2.86 | pass |
| 150 | 39.37 | 9.02 | 30.36 | 4.37 | **0.0964** | 7 | 2.93 | pass |
| 180 | 38.30 | 10.02 | 28.28 | 3.82 | **0.1035** | 7 | 2.93 | pass |
| 270 | 62.15 | 5.23 | 56.92 | 11.89 | **0.1254** | 11 | 7.14 | pass |
| 300 | 40.15 | 4.37 | 35.78 | 9.19 | **0.1715** | 5 | 6.14 | pass |
| 330 | 43.15 | 4.08 | 39.06 | 10.56 | **0.1464** | 5 | 5.72 | pass |
| **×1.5** | | | | | | | | |
| 0 | 54.45 | 5.52 | 48.93 | 9.87 | **0.1417** | 14 | 6.93 | pass |
| 120 | 58.59 | 11.81 | 46.78 | 4.96 | **0.1068** | 4 | 5.00 | pass |
| 150 | 58.74 | 11.74 | 47.00 | 5.00 | **0.1033** | 4 | 4.86 | pass |
| 180 | 57.52 | 12.81 | 44.71 | 4.49 | **0.1086** | 5 | 4.86 | pass |
| 270 | 66.22 | 8.95 | 57.28 | 7.40 | **0.1234** | 11 | 7.07 | pass |
| 300 | 51.37 | 7.31 | 44.06 | 7.03 | **0.1199** | 5 | 5.28 | pass |
| 330 | 53.37 | 7.16 | 46.20 | 7.45 | **0.1266** | 15 | 5.85 | pass |

**Every one of the 21 is below 0.25.** The worst is az 180 at ×0.5 (0.2440), i.e. still a pass but
with only 2 % headroom — noted, not acted on.

## Real versus flat, the two azimuths that failed

Same geometry, same bins; only the textures differ.

### az 120

| n·L bin centre | −0.09 | −0.07 | −0.05 | −0.03 | −0.01 | 0.01 | 0.03 | 0.05 | 0.07 | 0.09 | 0.11 | 0.13 | 0.15 | 0.17 | 0.19 | 0.21 | 0.23 | 0.25 | 0.27 | 0.29 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **REAL** | 8.4 | 8.7 | 7.6 | 6.0 | 6.9 | 10.4 | 15.9 | **23.4** | **44.4** | 57.3 | 63.2 | 65.6 | 73.3 | 77.7 | 80.0 | 80.2 | 76.7 | 77.0 | 77.3 | 79.8 |
| **FLAT** | 5.2 | 5.0 | 4.1 | 3.4 | 4.4 | 7.2 | 9.4 | **12.2** | **14.4** | 17.2 | 19.2 | 21.2 | 23.2 | 24.3 | 25.5 | 27.2 | 28.3 | 29.3 | 30.3 | 32.2 |

REAL **S 0.2938**, worst bin 7, step **20.99**. FLAT **S 0.0969**, worst bin 6, step **2.86**.

### az 150

| n·L bin centre | −0.09 | −0.07 | −0.05 | −0.03 | −0.01 | 0.01 | 0.03 | 0.05 | 0.07 | 0.09 | 0.11 | 0.13 | 0.15 | 0.17 | 0.19 | 0.21 | 0.23 | 0.25 | 0.27 | 0.29 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **REAL** | 11.8 | 12.4 | 9.4 | 8.6 | 7.9 | 11.7 | 20.2 | **29.6** | **48.7** | 60.5 | 65.0 | 70.1 | 75.5 | 80.1 | 82.2 | 84.8 | 84.1 | 82.1 | 82.6 | 84.8 |
| **FLAT** | 6.2 | 5.4 | 4.3 | 4.1 | 5.1 | 7.2 | 10.1 | **12.2** | **15.2** | 17.2 | 19.3 | 21.2 | 23.2 | 24.3 | 26.2 | 27.3 | 28.3 | 29.4 | 30.6 | 32.4 |

REAL **S 0.2684**, worst bin 7, step **19.18**. FLAT **S 0.0964**, worst bin 7, step **2.93**.

**The 19–21 luma step between bins 7 and 8 is entirely albedo.** The flat curve rises by ~3 luma per
bin — which is the Lambert expectation the prompt's E2 predicted (A ≈ 71 over ≈ 0.4 of n·L ⇒ ~3.6 per
bin ⇒ S ≈ 0.05; measured 0.096 at ×1.0 because the ramp is not perfectly linear in n·L near the
terminator). The real curve rises by 21 at the same place because that strip crosses a coastline.

Both azimuths have their worst step at **bin 7**, n·L ∈ [0.04, 0.06) — the same strip seen from
adjacent azimuths, which is H1's own predicted signature.

## Verdict, by rule E3

> *if the albedo-neutral render passes S <= 0.25 at all evaluated azimuths and all three albedo levels,
> H1 is accepted and F5b is executed. If any albedo-neutral S exceeds 0.25, H2 holds: STOP.*

21 of 21 pass. **H1 accepted.** F5b proceeds: SOFT is measured on the albedo-neutral render, with the
threshold, the bins and the evaluated set all unchanged.

## One implementation finding, recorded because it affects how the gate can be wired

The mutation does not restore cleanly in place. `fitLimb` swaps the surface material for unlit white,
and `setLayers` re-renders React so R3F rebuilds materials; a rebuild that lands after the restore
loop leaves a fresh material carrying the flat values. Three in-place strategies were tried (per-
instance snapshots, a live `saved` array, a pristine record re-applied to every instance) and each
closed one ordering and left another open. Measured symptom: `map=false emissiveMap=false` after
`uninstall()`.

So `assertSurfaceRestored` **reloads the page** when the in-place restore does not hold, re-installs the
defect engine, and reports it. In this run that happened **21 of 21** times — one reload per flat
capture. That is the cost of the probe (7.7 min for 25 captures) and the reason F5b's per-azimuth flat
capture must be budgeted for in the 3.4 tests rather than assumed free.

**The mutation cannot leak:** every capture is preceded by a verified clean surface, and a failure to
restore after a reload is a hard error.
