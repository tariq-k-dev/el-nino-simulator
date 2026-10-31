# Step 3B — golden camera poses (step C)

Captured on the **pre-CameraDirector** code (commit `8fa42df`, parent `b5587d9`) so that S3 — "golden
fly-to poses differ after the refactor by more than the tolerance fixed in step C" — is checkable at
all. The fixture is `tests/e2e/golden/camera-poses.json`; the spec is
`tests/e2e/camera-golden.spec.ts`.

## What is recorded

For every region, in **locked** mode at 1280x800 and in **live** mode (`framing=live`) at 1440x900,
after the fly-to settles (poll, no fixed sleep): `camera.position`, `camera.quaternion`,
`controls.target`, `camera.position.distanceTo(controls.target)`. `flyMs` is recorded **for the
record, not asserted** — a duration is a machine property, and asserting it would make the suite fail
on a slower day without anything having regressed.

## The number that mattered: the spin phase

The first capture, before pinning the spin, produced noise of **8.36e-3 R** in `controls.target` and
**4.78e-3 R** in position between processes, case to case:

| case | pos | target | quat | d |
|---|---:|---:|---:|---:|
| horn-africa@live | 2.30e-3 | 2.55e-3 | 3.52e-4 | 8.40e-4 |
| se-asia@live | 4.78e-3 | **8.36e-3** | 1.16e-3 | 1.10e-5 |
| pacific@live | 1.37e-3 | 1.41e-3 | 1.78e-4 | 3.10e-5 |
| us-west@live | 7.40e-5 | 2.03e-4 | 3.90e-5 | 1.00e-6 |

`max(1e-5, 10 x 8.36e-3)` would have fixed the tolerance at **0.084 R** — about 20 px of disc
movement at the fitted distance — and S3 would then have been unable to detect any plausible
refactor regression. This is the audit memo's item 1 restated as a measurement: the fly-to target is
`regionDirection(id, spin.current.y)` (`CameraRig.tsx:54`) and `spin.y` accumulates from frame
deltas, so two loads reach the click at different planetary phases.

**Fix:** `__globe.setSpin(true, 0)` before selecting — the same pinning `__look.setAzimuth` already
applies to every pixel baseline by freezing the planet at longitude 0. Angle 0 is the documented
reference phase.

## Result with the spin pinned — three separate runner processes

| run | what | wall | result | max component error |
|---|---|---:|---|---:|
| `cap1-write` | `UPDATE_GOLDEN=1`, writes the fixture, then self-verifies | 126.5 s | **9/9 green** | 8.33e-17 |
| `cap2-verify` | fresh process, verify only | 125.3 s | **9/9 green** | 5.55e-17 |
| `cap3-verify` | fresh process, verify only | 125.5 s | **9/9 green** | 5.55e-17 |

Zero retries in all three. Six of the eight cases were **exactly 0** on every component; the residue
(`5.55e-17`, `8.33e-17`) is one ULP of a `Math.pow`-damped lerp tail, i.e. float noise, not motion.

## Tolerance: 1e-5 R

`max(1e-5, 10 x 5.55e-17) = max(1e-5, 5.55e-16) = **1e-5**`. The floor binds. At the fitted distance
3.7784 with a ~322 px disc, 1e-5 R is ~0.001 px of disc radius, so a changed write order, a dropped
`controls.update()`, or a re-derived quaternion all fail it loudly.

## Registration

| | |
|---|---|
| runner count | `expectedCounts()['camera-golden.spec.ts'] = 9` (8 recorded cases + 1 comparison) |
| per-file timeout | `FILE_TIMEOUTS_MS['camera-golden.spec.ts'] = 6 min` — 2x the measured 125.5 s, rounded up |
| full-suite total | 76 → **85** |

## Regenerating

```bash
UPDATE_GOLDEN=1 pnpm e2e:raw -- tests/e2e/camera-golden.spec.ts   # writes the fixture
pnpm e2e:raw -- tests/e2e/camera-golden.spec.ts                   # verifies it
```
Generation and verification are separate processes by design, mirroring `UPDATE_REF`. **Regenerate only
before a refactor, never after one** — a fixture regenerated after the change certifies nothing.

## A type-only fix this step needed

`tests/e2e/globals.d.ts`'s `GlobeProbeHandle` mirror did not declare `setSpin`, although the runtime
handle has exposed it since 3A (`globeProbe.ts:269`). Added as a declaration; no runtime change.
