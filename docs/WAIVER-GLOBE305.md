# WAIVER-GLOBE305 — settle the fly-to tail before measuring the wheel

## The locked spec

`tests/e2e/globe.spec.ts`, test title **`zoom still works after a region fly-to`** (line 456 at HEAD 46cd7c4).
`globe.spec.ts` is one of the fifteen locked specs, so this change requires a waiver and a diff review.

**`wheel was ignored after a region fly-to` is the ASSERTION MESSAGE, not the test title.** It is the failure
text emitted at `tests/e2e/globe.spec.ts:584`, which is what appears in Triager and in the batch logs, and it
is why earlier notes (and the triage prompt) referred to "the test at globe.spec.ts:456 titled wheel was
ignored...". The test title is the one above. Both names identify the same single test.

## The classification

GLOBE305-TRIAGE classified the intermittent red as **C5**, naming the combination **C2 SETTLE DRIFT plus
C4 FIGHT**. Both rules fired at **10 of 10** measured runs; C1 (occluded wheel point) and C3 (load latency)
were each falsified at 0 of 10.

The spec reads its baseline, and applies its six wheel notches, while the fly-to's distance lerp tail is still
running. The tail is longer than the spec's fixed waits assume, and during it the fit's distance write at
`src/scene/CameraDirector.tsx:941` is still active and competes with the wheel.

## The measured evidence

**Tail length and constant.** The residual decay fits a single exponential. Fitting tau per run from the
observed drop gives 0.1511, 0.1672, 0.1670, 0.1543, 0.1525, 0.1678, 0.1524, 0.1548, 0.1664, 0.1522 s —
**mean 0.1586 s** against the module's `FRAME_TIME_CONSTANT_S = 0.18` (`src/layout/framing.ts:76`). The
effective value running slightly under nominal is expected: the lerp applies `k = 1 - exp(-dt/0.18)` per
frame, and discrete stepping under a continuous constant gives a marginally faster tail. Predicting the whole
E2 curve as `dTarget + (d0 - dTarget)·exp(-t/tau)` with tau = 0.18 tracks every measured sample to within
0.0015 (residuals +0.00005, +0.00095, +0.00142, +0.00156, +0.00150, +0.00143).

**Tail duration.** Reaching a baseline genuinely at rest took **1841 to 1905 ms** after the drawer closes
(the validated v2 driver's settle wait, 10 runs). The spec waits 1800 ms, then presses Escape, then waits only
900 ms before reading — so the baseline is read inside the tail by roughly a factor of two.

**The fight, measured.** In the as-shipped configuration the wheel is received and does move the camera, and
then is taken back. E1 run 1: the series climbs to 3.50870 at 1357 ms, then **gives back 0.1515** over the next
932 ms to finish at 3.35716 — below where it started (3.37796). Ten of ten runs rose and returned past their
starting value. The failure message the suite produces is a *decrease* of about 0.021 to 0.026, which is the
same magnitude as the no-wheel control's drift (E2: 10 of 10 above 0.005, every one a decrease, all
converging on the same floor). That is why the assertion looks like noise rather than like an undone zoom.

**The validated fix.** The v2 driver, which polls `__globe.distance()` until quiet and requires the baseline to
be within 0.005 of `__frame.target.d`, passes **10 of 10** with delta **+0.80699 to +0.80700** — a spread of
one in the fifth decimal across ten runs — and **hold drift of exactly 0** over the following 1.2 s. The
post-wheel gap to `dTarget` is +0.81: the camera sits above the fit's target and the fit leaves it alone
because `userZoomed` latched on the first notch, which exceeds `LAST_FIT_EPSILON = 0.002`.

## The withdrawn v1, and why it was unsafe

The first version of the fix polled `__frame.settled` before reading the baseline. It passed 10 of 10 — and it
was **withdrawn**, because it passed for the wrong reason.

The baseline it produced sat **0.78 BELOW `dTarget`** (2.58 to 3.12 against a target of 3.35336). The "gain"
the assertion then measured was the fit pulling the camera *up* to its floor, not the wheel. `__frame.settled`
is true there because of `src/scene/CameraDirector.tsx:822-826`: `distanceSettled` requires `distanceArrived`
only when `rigOwnsDistance` is true, and quiet alone otherwise. During the tail `__frame.current.d` also
disagreed with `__globe.distance()` (3.595 versus 3.12), so the two readers were not describing the same
moment.

Trading a loud intermittent failure for a silent false pass is worse than leaving the flake in place. Nothing
in this waiver reads `__frame.settled`.

## Scope

**ONLY** the single test `zoom still works after a region fly-to` at `tests/e2e/globe.spec.ts:456` changes. No
other test changes, no shared helper changes, no import changes, no constant changes, and no other file
changes. The one new helper is local, defined directly above this test inside the same `describe`, and named
with the `settleDistance` prefix as required.

## What does not change

**No source file changes.** `src/` is untouched, so there is no product behaviour change and no rebuild of
behaviour — only of the bundle stamp.

**The assertion is unchanged.** Its threshold (0.02) and its direction (strictly greater than baseline plus
threshold, `toBeGreaterThan(before + 0.02)`) are exactly as shipped. No tolerance is loosened anywhere, and
nothing is retried, skipped, or marked fixme.

What changes is *when* the baseline is read and *when* the result is read: both move from a fixed sleep to a
poll on the quantity the assertion itself measures, so the measurement no longer straddles a moving tail.

## RISK — the at-rest limit has thin headroom

The at-rest limit (0.005) sits only about **1.4 times** above the **structural floor** of about **0.0035**. That
floor is not noise: the fit never closes the last **0.00356** to `dTarget`, because `LAST_FIT_EPSILON = 0.002`
(`src/layout/framing.ts:123`) stops the approach before the distance reaches the target exactly. Measured
at-rest gaps were 0.00345 to 0.00349 isolated, and 0.00342 to 0.00348 under load — consistent, but only just
inside the limit.

**A different viewport, or any change to the framing arithmetic, can raise that floor.** `D0`, the free
rectangle, `MAX_DISTANCE` and the easing epsilon all feed it. If the floor moves up past 0.005, this test fails.

That failure is **LOUD, never silent**, and that is the design intent: it fails on the at-rest assertion, which
names both values and the gap, rather than passing vaguely. The correct fix in that case is to **re-measure the
floor** on the new viewport and confirm the structural reason, then justify the new limit against the new
measurement. It is **not** to loosen the limit blindly — raising 0.005 toward 0.01 would let a genuinely
mid-tail baseline back in, which is the exact defect this waiver removes.

## What was NOT measured

- **Other viewports.** Every run here was the Playwright `Desktop Chrome` default, **1280x720**. No tablet or
  narrow viewport was exercised, and TABLET-PORTRAIT showed that shell mode and the free rect both change with
  viewport, so the 0.0035 floor is only known at this one size.
- **Other core counts.** The host has 20 logical cores. Load runs used twelve burners reaching 70.9 to 79.2
  per cent CPU. A 2-core or 4-core machine, where the browser gets a smaller slice mid-tail, is untested. The
  settle poll's 6000 ms timeout never fired (0 of 20 isolated/loaded, 0 of 3 mutation runs, observed settle
  about 1.9 s), but a host roughly three times slower is unmeasured and could conceivably reach it.
- **A real pointer at 60 Hz, by hand.** All wheel input was synthetic Playwright `mouse.wheel(0, 120)` events
  at 80 ms spacing. No physical trackpad, no real 60 Hz paint cadence, no human-timed input.
- **The two 15-spec batches** were not CPU/RAM bracketed per run; only wall time and per-file durations were
  recorded.
- **Why N10's differing-pixel count varies** (124 at HEAD versus 249 and 257 with the waiver applied) is not
  explained. N10 is a separate pre-existing flake in `negative.spec.ts:579` and is out of scope here.
