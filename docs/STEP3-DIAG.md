# STEP 3 — N10 diagnosis (2B-STEP3-A-FIX2)

Read-only diagnosis. **No code change is committed in this document's session except this file.**
No test, threshold, window, gate or defect definition was touched, and no choice among the three
decision branches is made here.

Context: HEAD `37785bc`. Prompt committed alone as `33d2855`.

Every row below is labelled by the **sha1 of the file that was actually built**, and every build's
`dist-e2e` stamp `srcHash` is recorded, because the previous session's conclusions were drawn from
bundles whose provenance I did not establish. That is the root cause of the inconsistency this
document exists to settle.

---

## D1 — unambiguous variant table

`P` = file contents from `01d0f83` (unconditional uTime). `F` = from `70ca2b5`
(`lookTime(animate, elapsed)`). Files written with `git show REV:path`, verified by sha1, then
`build-e2e.mjs` + `write-build-stamp.mjs`. N10 run alone via the Playwright CLI with an argv list.

| variant | Globe.tsx sha1 | Hotspot.tsx sha1 | bundle srcHash | run | ctl max | ctl area6 | ctl argmax | **def max** | def maxAbs | def area6 | def argmax | N10 |
|---|---|---|---:|---:|---:|---|---:|---:|---:|---|---|
| P/P | `fa36767182ca` | `7c034adb725f` | `1f9e1677a195` | 1 | 88.5204 | 9594 | [782,374] | **201.7204** | 201.7204 | 10677 | [327,488] | pass |
| P/P | `fa36767182ca` | `7c034adb725f` | `1f9e1677a195` | 2 | 88.5204 | 9594 | [782,374] | **185.0802** | 185.0802 | 10801 | [321,461] | pass |
| F/F | `91e74615886e` | `fe0711e69734` | `220cbbcf28e8` | 1 | 88.5204 | 9594 | [782,374] | **87.5204** | 87.5204 | 9401 | [781,374] | **fail** |
| F/F | `91e74615886e` | `fe0711e69734` | `220cbbcf28e8` | 2 | 88.5204 | 9594 | [782,374] | **87.5204** | 87.5204 | 9401 | [781,374] | **fail** |
| P/F | `fa36767182ca` | `fe0711e69734` | `05d3fac1f081` | 1 | 88.5204 | 9594 | [782,374] | **87.5204** | 87.5204 | 9401 | [781,374] | **fail** |
| P/F | `fa36767182ca` | `fe0711e69734` | `05d3fac1f081` | 2 | 88.5204 | 9594 | [782,374] | **87.5204** | 87.5204 | 9401 | [781,374] | **fail** |
| F/P | `91e74615886e` | `7c034adb725f` | `4684f86dea46` | 1 | 88.5204 | 9594 | [782,374] | **165.6814** | 192.0682 | 10256 | [455,265] | pass |
| F/P | `91e74615886e` | `7c034adb725f` | `4684f86dea46` | 2 | 88.5204 | 9594 | [782,374] | **87.5204** | 90.6324 | 10332 | [781,374] | **fail** |

**Culprit: `Hotspot.tsx`, not `Globe.tsx`.** The two rows that fail on *both* runs are exactly the
two whose Hotspot is `F` (F/F and P/F), and both return the identical value 87.5204 with the identical
argmax. Both rows whose Hotspot is `P` vary run to run and pass at least once (P/P twice, F/P once).
Swapping Globe alone does not flip the result: it changes only whether the varying variant lands
above or below the gate.

**Which of my earlier claims was right: the earlier TABLE.** The earlier narrative — "it is the
atmosphere gate in `Globe.tsx`" — is **wrong and withdrawn**. It came from a single run of F/P
(122.74, pass) that I treated as a stable result when that configuration is variable; the same
configuration here gives 165.68 and 87.52. The Globe gate is *not* the cause of N10's collapse; it
is the cause of a different, real instability (D5).

Why a `Hotspot.tsx` change can move a glint measurement at all, when the glint view has
`pins: false, rings: false`: the pin ring shader's `uTime` is not the only thing `useFrame` in
`Hotspot` writes, and the glint acquisition captures two frames of a scene whose material/program
state is rebuilt by `fitLimb` between them. The measurement in D3 shows the defect contribution is
present (195.77 at [807,294] in P/P) but lands *away from* the glint peak, so which of the two
contributions is the max decides pass/fail. **I did not establish the causal chain from the
`Hotspot` uniform to the fill-light contribution.** It is measured, not explained, and I am not
going to invent the mechanism.

---

## D2 — where does the max live

Top local maxima of the signed difference D above 70.8 (greedy ≥12 px apart), with distance to the
nearest projected pin (all four, valid and invalid), distance to the control argument max, and the
r/R band. From `tmp-d234.mjs`, variant P/P and F/F; the control scenes are identical across the two.

### Control (shipped look vs overlay-off)

| # | x,y | D | nearest pin | pin dist px | dist to ctl argmax | r/R | band |
|---|---|---:|---|---:|---:|---:|---|
| 1 | 782,374 | 87.31 | horn-africa | 104.1 | 0 | 0.443 | disc |
| 2 | 791,382 | 77.24 | horn-africa | 104.7 | 12.0 | 0.467 | disc |
| 3 | 776,385 | 76.45 | horn-africa | 116.4 | 12.5 | 0.420 | disc |
| 4 | 783,361 | 73.96 | horn-africa | 94.2 | 13.0 | 0.455 | disc |
| 5 | 793,369 | 73.82 | horn-africa | 93.2 | 12.1 | 0.480 | disc |

area6 within 30 px of any pin: **0 of 8479**.

### Defect (si 1.0, roughness floor removed, fill light restored vs overlay-off)

| # | x,y | D | nearest pin | pin dist px | dist to ctl argmax | r/R | band |
|---|---|---:|---|---:|---:|---:|---|
| 1 | 781,374 | 87.52 | horn-africa | 104.8 | 1.0 | 0.440 | disc |
| 2 | 793,370 | 79.38 | horn-africa | 93.9 | 11.7 | 0.479 | disc |
| 3 | 790,382 | 78.66 | horn-africa | 105.3 | 11.3 | 0.464 | disc |
| 4 | 776,385 | 76.45 | horn-africa | 116.4 | 12.5 | 0.420 | disc |
| 5 | 783,362 | 74.82 | horn-africa | 94.9 | 12.0 | 0.454 | disc |

area6 within 30 px of any pin: **0 of 9399**.

**Verdict: neither pins nor the atmosphere band carry the max — the glint does.** Every maximum is
on the disc (r/R 0.42–0.48), 93–116 px from the nearest pin, i.e. none of them is a pin core or
bloom skirt, and none is in the atmosphere annulus. The whole `area6` set is pin-free in both frames.
This also rules out the pin-ring hypothesis as the *carrier* of the number: the rings are off and
pins contribute nothing to area6.

The defect state's top maxima are the **same cluster** as the control's (same neighbourhood, same
pixel at 781/374 vs 782/374). The place where the defect actually *adds* light is elsewhere:
defect-vs-control peaks at **249.9 at [344,390]** with area6 8470 — the retired fill light's blue
circle, the `(344, 392)` regression point the look spec still guards (`helpers.ts:798`).

---

## D3 — precondition and the 1.962

State read inside the page at capture time, variant F/F, three runs (`tmp-d234.mjs`):

| quantity | value |
|---|---|
| `specularIntensity` in effect | **1** |
| `roughness` in effect | **0** |
| `roughnessMap` bound | **false** (detached, as the defect intends) |
| material `version` after the defect | 9 / 10 / 10 across runs (incremented ⇒ the write landed) |
| `material.program` | `null` at read time (three assigns it lazily on first render) |
| `look.animate` | **false** |
| Globe atmosphere `uTime` at the two compared frames | **0** and **0** |
| Hotspot `uTime` | not present — no `uPhase`-bearing material exists with `pins:false` |

**The defect does land**: si 1, roughness floor 0, map detached, and the frame brightens by
249.9 luma at [344,390] versus the control. There is no precondition failure.

### Where 1.962 came from — and why it was wrong

`1.962` was reported by `scripts/tmp-n10-phase.mjs` in the previous session. It is **not
reproducible on a build whose provenance is checked**. In this session the same probe reads
`globe uTime = 0` on every one of three loads of the D5 `F/F` build
(`.cache/d5-FF.json`: `uTime per load [{globe:0},{globe:0},{globe:0}]`), and 0 in all three D3 runs
above. `lookTime(false, elapsed)` returns `FROZEN_LOOK_TIME = 0` by construction, and it is unit-
tested.

The previous session's 1.962 was measured during the bisection sequence, on a `dist-e2e` built from
files I had been swapping by hand, **without a stamp check binding the served bundle to the source
tree**. The served bundle was therefore not the bundle I believed I was measuring. That number, and
the narrative built on it, are **withdrawn**. This is exactly the failure the stamp guard exists to
prevent, and I bypassed the guard by rebuilding without verifying what was on disk.

### The "defect max = control max − 1.0" coincidence

`88.5204 − 87.5204 = 1.0000` exactly: **one 8-bit luma step**, which is the smallest change the
measurement can express.

At the control's argmax pixel, in the reproduction:

| frame | luma at [782,374] |
|---|---:|
| control | 149.5254 |
| defect | 149.5254 |
| overlay-off | 62.2176 |
| control − off | 87.3078 |
| defect − off | 87.3078 |
| defect − control | **0** |

So at that pixel the defect frame is **identical to the control frame** — the defect does not touch
it, because the fill light and the mirror lobe land elsewhere ([807,294] / [344,390], D2). The
signed difference there is carried entirely by the *off* frame. The 1.0 discrepancy in N10 is
therefore **not** the defect removing specular; it is the off frame — a separate capture — differing
by a single 8-bit step at that pixel between the control pass and the defect pass.

The defect-vs-control difference of **195.77 at [807,294]** (previous session, P/P) and **249.9 at
[344,390]** (this session, both variants) is the fill light's own contribution, plus area6 5217–8470
pixels of it. That is a real, large, correctly-delivered defect — which simply does not coincide with
the glint peak, so it cannot lift the *max* above 110.7 unless it exceeds the glint's 87.5.

---

## D4 — variance

N10 alone, three runs per variant, printing the signed defect max and the uTime held by the Globe and
Hotspot materials at the two compared frames.

| variant | run | Globe uTime ctl | Globe uTime defect | Hotspot uTime | def signed max | stable? |
|---|---|---:|---:|---|---:|---|
| P/P | 1 | 3.587 | 3.587 | absent | 201.7204 (D1) | **no** |
| P/P | 2 | 3.570 | 3.570 | absent | 185.0802 (D1) | **no** |
| P/P | 3 | 3.530 | 3.530 | absent | 87.5204 (repro) | **no** |
| F/F | 1 | 0 | 0 | absent | 87.5204 | **yes** |
| F/F | 2 | 0 | 0 | absent | 87.5204 | **yes** |
| F/F | 3 | 0 | 0 | absent | 87.5204 | **yes** |

**F/F is bit-stable**: the same 87.5204 on every run, from a clean rebuild each time, and the same
value in the repro. It is the most reproducible number in this document.

**The P/P spread does not correlate with the uTime phase in the runs where both were recorded.**
Within a run the phase is a single number (the comparison is two frames of one frozen scene), and
across runs it moved by only 0.06 s (3.530–3.587) while the metric moved by 114 luma
(87.5–201.7) — including five distinct values across sessions (136.96, 156, 166, 182, 190, 201.72),
which is a spread far too large for a 0.06 s phase change in a breathe term whose full amplitude is
1.5 % of the halo.

**The earlier "P4 = SwiftShader recompile variance" attribution is therefore NOT withdrawn**, and it
is also not proven: the uTime phase is excluded as the driver of the P/P spread, leaving the
recompile/lazy-program seam as the outstanding candidate, consistent with `material.program` reading
`null` at capture time and with `material.version` differing across runs (9, 10, 10).

I could not record per-frame uTime *inside the real N10* (its frame capture is internal to
`acquireGlintFrames`); the uTime columns above for P/P come from my reproduction of the same pose,
which reproduced the defect frame exactly but not N10's control baseline (87.31 vs 88.52). That
difference is itself unexplained and is stated rather than hidden.

---

## D5 — reference residual by gate

Reference pose: rings OFF, az 0, seeded stars, 1280x800. Two captures inside one page, plus three
fresh page loads, per variant. `max |dLuma|` and count of pixels differing by >1/255.

### F/P — Globe fixed, Hotspot parent (`uTime` 0 in all three loads)

| scope | pair | max | \|d\| > 1 px |
|---|---|---:|---:|
| in-page | A#0~#1, A#1~#2, A#0~#2 | 0 | 0 |
| in-page | B#0~#1, B#1~#2, B#0~#2 | 0 | 0 |
| in-page | C#0~#1, C#1~#2, C#0~#2 | 0 | 0 |
| cross-load | A~B#0, A~B#2 | 0 | 0 |
| cross-load | **A~C#0, A~C#2** | **45.9318** | **15** |
| cross-load | **B~C#0, B~C#2** | **45.9318** | **15** |

### P/F — Globe parent, Hotspot fixed (`uTime` 5.915 / 5.892 / 5.861)

| scope | pair | max | \|d\| > 1 px |
|---|---|---:|---:|
| in-page | A#0~#1 / #1~#2 / #0~#2 | 1 / 2 / 3 | 314 / 5057 / 12271 |
| in-page | B#0~#1 / #1~#2 / #0~#2 | 1 / 2 / 3 | 259 / 5072 / 12018 |
| in-page | C#0~#1 / #1~#2 / #0~#2 | 1 / 2 / 3 | 257 / 4810 / 11740 |
| cross-load | all six pairs | 0.7152–1.0 | 0 |

### F/F — both fixed (measured for completeness)

| scope | pairs | max | \|d\| > 1 px |
|---|---|---:|---:|
| in-page | 9 | **0** | **0** |
| cross-load | 6 | **0** | **0** |

**Verdict: the Globe gate is necessary for a zero residual with pin rings OFF; the Hotspot gate is
not sufficient to explain anything on its own.** With both gates (F/F) all 15 pairs are exactly 0 —
which is the whole requirement for the reference frame and, by itself, resolves B3's pre-registered
rule toward "require exactly 0". With only the Globe gate (F/P) the in-page pairs are clean but two
cross-load pairs show 45.93 / 15 px, so the parent `Hotspot` still lets something differ between
loads. With only the Hotspot gate (P/F) the in-page residual is 1–3 luma over 314–12271 px, which is
the breathing halo.

I did not identify the 15-pixel cross-load artefact in F/P. It is a tight count at a fixed value,
not accumulating noise, and the same three load labels reproduce it exactly — so it is a genuine
per-load state, not frame jitter. **Stated as unexplained.**

### Working tree restored

`git checkout HEAD -- src/scene/Globe.tsx src/scene/Hotspot.tsx`; `git diff --stat` empty;
`git status` shows only the known untracked files (the four from P0 plus this session's throwaway
scripts). `dist-e2e` rebuilt from HEAD, stamp `srcHash f1f1923d89db`, `gitHead 33d2855`.

---

## D6 — the degraded first legacy run

The saved batched summary JSON for that run is **gone** (superseded by later runs); the log
`.cache/e2elook-fix.log` survives and is the source for this section.

- **Two tests failed with `ERR_CONNECTION_REFUSED`, both in `look.spec.ts`**: `3.9 glint: the
  accepted attenuated look, as shipped` and `3.7 console: zero warnings or errors through the look
  suite`. Six occurrences of the string in the log = the two failures' call logs plus their retry
  echoes. Both died at `page.goto('/?debug')` → `capture.ts:121` on port **4301**, i.e. the file's
  own Brotli server had already been torn down. Cause: the runner killed that file's process tree
  after the file's earlier tests had slowed, and the last two tests ran against a dead port. This is
  the runner's `killTree` race documented in `docs/E2E.md`, not a product failure — both tests pass
  when the file is re-run.
- **`negative.spec.ts` hit its 480 s cap** (`[batched] negative.spec.ts exceeded 480s — killing its
  tree`, `TIME … tests 12/14 (killed)`) although it normally takes ~192 s. Measured per-test times in
  that same log are inflated across the board versus the second run: N1 28.9 s (16.3 s), N2 24.5 s
  (12.7 s), N4 41.9 s, N7 34.0 s (18.7 s). The three files ran back-to-back in one session on a
  machine that was simultaneously loaded — sampled during the run, the top CPU consumers were
  `jetbrains-toolbox` (3049 CPU-s), `python` (2174), `chrome` (1667) and `Gemini` (1176), none of
  them mine. So the cap was hit by **wall-clock inflation from external load**, not by a slower
  test: the same 14 tests fit in 480 s when the machine is quiet.

---

## Verdicts

| question | verdict | evidence |
|---|---|---|
| Which file is the culprit for N10? | **`Hotspot.tsx`** (F). The Globe gate is not the cause. My earlier narrative was wrong; my earlier table was right. | D1: F/F and P/F fail identically at 87.5204 twice each; P/P and F/P vary and pass at least once. |
| What carries the N10 max? | **The glint**, not the pins and not the atmosphere. Every maximum is on the disc at r/R 0.42–0.48, 93–116 px from the nearest pin; area6 contains **0** pixels within 30 px of any pin. | D2. |
| Did the old N10 pass depend on the clock phase? | **No.** The phase moved 0.06 s while the metric moved 114 luma; and with the phase pinned at 0 (F/F) the metric is bit-stable at 87.5204. The phase is excluded as the driver. | D4. |
| Does the defect actually land? | **Yes** — si 1, roughness 0, roughnessMap detached, material version incremented, and it adds 249.9 luma over 8470 px at [344,390]. It simply lands away from the glint peak, so it cannot lift the max past 110.7 unless it exceeds the glint's 87.5. | D3. |
| Is each gate needed for the reference? | **Globe gate: necessary.** Both gates: **sufficient** — 15/15 pairs exactly 0. Hotspot gate alone leaves in-page residual 1–3 luma over up to 12271 px. | D5. |
| Which branch do the numbers support? | Neither a threshold change nor a defect re-definition is supported by this evidence: the defect delivers 249.9 luma and the gate bound is untouched. The numbers are consistent with the glint sentinel's *max* being carried by the glint while N10's *pass criterion* depends on the fill light's contribution exceeding it. Stated as an observation, not a recommendation — the choice remains Tariq's. | D1, D2, D3. |

---

## Note: `GlobeScene.tsx:234` vs `main.tsx:14` (describe, do not fix)

`GlobeScene.tsx:234` installs the probe hooks behind **two** conditions —
`import.meta.env.VITE_E2E === '1' && new URLSearchParams(window.location.search).has('debug')` — so an
instrumented bundle served *without* `?debug` exposes no `__globe` / `__look`. `main.tsx:14` sets
`const E2E_HOOKS = import.meta.env.VITE_E2E === '1'` and gates on that flag **alone**, no `?debug`.
The two gates therefore disagree about which instrumented pages are instrumented: a page reached
without `?debug` has whatever `main.tsx` enables switched on while every hook in `GlobeScene` is
absent, so any code path that assumes "if the flag is set then the probe exists" is wrong on exactly
that URL shape. Every spec in `tests/e2e` happens to navigate to `/?debug`, which is why the
divergence has not surfaced as a failure. Recorded here as an observation; not changed.

---

## Throwaway scripts (not committed)

| script | what it does |
|---|---|
| `scripts/tmp-d1.py` | D1: four variants from `git show`, sha1 + bundle stamp per row, N10 ×2 per variant |
| `scripts/tmp-d234.mjs` | D2/D3/D4: instrumented N10 reproduction — top maxima with pin distances, material/uniform state at capture, per-run uTime |
| `scripts/tmp-d5.mjs` | D5: per-variant reference residual matrix (9 in-page + 6 cross-load pairs) |
| `scripts/tmp-n10-phase.mjs` | previous session's probe (kept for the record; its 1.962 is withdrawn) |
| `scripts/tmp-refmatrix.mjs` | previous session's residual matrix probe |

Saved data: `.cache/d1-table.json`, `.cache/d234-{PP,FF}.json`, `.cache/d5-{FF,FP,PF}.json`.

## Step E

**Not done.** The D-phase used the session's tool budget on measurement; the insets registry (C of
`step3-a-fix.md`) is an implementation step with its own unit tests, layout assertion and gate, and
was not started rather than half-landed. Nothing in Step E was committed.

---

# Addendum — D7 confirmation, D8 path matrix, and the ROI correction

Written during 2B-STEP3-A-FIX3 / -V2 / -V3. Commits: `8c1fceb` (prompt), `0aa0352` (v2 prompt),
`24c76ab` (v3 prompt), `a8f9ea2` (E1).

## ROI correction: (327,488) IS inside the disc

The first pass of this document placed (327,488) outside the ROI at "342 px from the centre". That
was arithmetic error, not a finding. Recomputed against the actual `fitLimb` geometry
(cx 640.0, cy 399.5, r 325.66):

| from | distance | r/R | inside the disc? |
|---|---:|---:|---|
| (640.0, 400.0), r 325.56 | **325.135 px** | 0.9987 | **yes** |
| (640.0, 399.5), r 325.66 | **325.271 px** | 0.9988 | **yes** |

So it sits on the disc, just under one pixel inside the limb. `measureGlint`'s region of interest is
the fitted disc and nothing else — `diffStats` skips every pixel with
`(x-cx)² + (y-cy)² > r²` — so (327,488) is **inside** both the ROI and the `area6` count.
[344,390], the fill light's blue circle, is well inside it too (r/R 0.139).

## D7 — the defect lands, but 3.9 does not see it

Faithful reproduction of N10's own acquisition (control 88.5204 / 9594, defect 87.5204 / 9399 — the
same numbers N10 prints):

| quantity | value |
|---|---|
| defect-vs-control at the defect's argmax [781,374] | **+1.00 luma** |
| nearest projected pin to that pixel | **horn-africa, 104.9 px** |
| distances to pacific / us-west / se-asia / horn-africa | 501.8 / 356.1 / 244.4 / **104.9** px |
| r/R of that pixel | 0.44 (disc, not the atmosphere band) |
| **defect max with 45 px masked around every pin** | **87.5204 — unchanged** |
| defect-vs-control elsewhere | **249.9 luma at [344,390]**, 8470 px |

**Classification: unexplained and NOT pin-carried.** The mask changes nothing because the max sits
104.9 px from the nearest pin, well outside a 45 px radius. The 249.9-luma contribution is real and
correctly delivered; it simply does not coincide with the glint's maximum.

### Limits of this evidence

The earlier erratic passes (defect max 201.72, 185.08, 165.68 across D1's hash-labelled variants)
**were not reproduced** in later sessions: six runs of the unfrozen variant all gave 87.52, and the
D8 matrix below gave exact zeros in all 27 pairs. Those values exist only in the D1 runs, which are
labelled by the sha1 of both source files and the bundle's `srcHash`. The intermittent is recorded as
unexplained, not as solved.

## D8 — path × pairing matrix (27 pairs, all exact 0)

- **Path A** = reference-helper style: `settleAt` + `setLayers` + capture, no `fitLimb` material swap.
- **Path B** = N10 style: the same flags, preceded by `fitLimb`'s `surfaceWhite(true/false)` cycle.
- **Arm C** = path B with the swap skipped — which is path A with the same flags, so C is a repetition
  loop, not an independent arm. Recorded as such rather than presented as a third result.

Three fresh page loads per path, two acquisitions per load.

| path | in-page (3 pairs) | cross-load (6 pairs) | per-channel histograms |
|---|---|---|---|
| A | max\|dLuma\| **0**, 0 px | **0**, 0 px | empty (no differing pixels) |
| B | max\|dLuma\| **0**, 0 px | **0**, 0 px | empty |
| C | max\|dLuma\| **0**, 0 px | **0**, 0 px | empty |

Overlap of the differing-pixel sets between A's and B's in-page pairs: both empty (Jaccard undefined).

**Reading (3) applied: nothing flips in any arm.** No pixel had a channel delta of 2 LSB or more in
any arm (reading 4), and path A did not flip cross-load (reading 2). So: B2 proceeded, and **B3 was
skipped** because the prompt makes readings (2), (3) and (4) all stop before B3.

This is in tension with the v2 measurement of 0.7152 luma / 221 px on the cross-load pair, and the
tension is not resolved. The v2 number was taken inside the real `negative.spec.ts` process, after 13
other negative tests had run in the same browser; D8's numbers were taken on fresh contexts only.
A same-process-state effect would explain both, and nothing in D8's arms tested that.

## Jitter location (in-page control pair, from the N10 run)

17–43 pixels differ, every one by exactly **0.7152 luma = one green level**. Across four runs they
cluster at the same coordinates:

| x,y | d | r/R | band | to glint peak | nearest pin | to pin |
|---|---:|---:|---|---:|---|---:|
| 770,144 | 0.7152 | 0.8809 | disc | 230.3 px | horn-africa | 173.5 px |
| 768,171 | 0.7152 | 0.8049 | disc | 203.5 px | horn-africa | 151.3 px |
| 552,178 | 0.7152 | 0.7313 | disc | 302.2 px | us-west | 121.6 px |
| 748,194 | 0.7152 | 0.7135 | disc | 183.2 px | horn-africa | 146.3 px |

All on the disc at r/R 0.71–0.88 — **not** limb shimmer, **not** in the rim band, and nowhere near a
pin or the glint. Time between the two acquisitions: **10 164–10 228 ms**. Recorded, not fixed, and
not used to relax anything.
---

# D9 — the one-green-level flip, read-only diagnostic

Asked to explain why N10's cross-load control pair differs by **0.7152 luma** (exactly one green
level, `1/255 × 0.7152`) over 213–221 px, when the D8 standalone matrix showed exact zeros. **Nothing
was fixed and nothing under `src/` or `tests/` was changed.**

## D9.1 — source search for per-frame / wall-clock terms

| file:line | term | verdict |
|---|---|---|
| `src/scene/Hotspot.tsx:53` | `uPhase: { value: Math.random() }` | **CAN affect disc pixels.** A shader uniform seeded per load; `shaders.ts:227` computes `t = fract(uTime * 0.45 + uPhase)`, so the ring's phase is load-dependent. With the uTime gate it is a *still* image, but a *different still* per load. |
| `src/scene/Globe.tsx:224` | `uTime = lookTime(look.animate, t)` | cannot — gated, and unit-tested to return 0 when frozen |
| `src/scene/Hotspot.tsx:58` | `uTime = lookTime(...)` | cannot — gated |
| `src/scene/Starfield.tsx:109` | `uTime = look.animate ? elapsed : 0` | cannot — gated (and stars are OFF in the glint view) |
| `src/scene/shaders.ts` (whole file) | no `dither`, `noise`, `hash`, `rand`, `jitter`, `fract(sin` | cannot — no stochastic term in any fragment shader |
| `src/scene/starfieldData.ts` | `mulberry32(STAR_SEED)` | cannot — seeded and deterministic |
| `src/lib/engine/store.ts:121,145,162,164` | `Date.now()` | cannot — engine status bookkeeping, never reaches a uniform |
| `src/lib/engine/sceneGate.ts:155`, `textureTimeline.ts:102` | `performance.now()` | cannot — boot timing only |
| `src/lib/duckdb.ts:578,674,763` | `performance.now()` | cannot — query timing only |
| `src/lib/report.ts:53,87` | `new Date()` | cannot — export/HTML generation only |
| `src/components/EngineBadge.tsx:88` | `Date.now()` default prop | cannot — DOM text, not canvas |

**Only one candidate survives: `Hotspot.tsx:53`.** It is the only per-load random value that reaches a
shader affecting the disc.

## D9.2 — N10 alone, two separate processes

| run | in-page (noise floor) | cross-load (print-only) |
|---|---|---|
| 1 | max 0.7152, **10 px** | (not reached in that capture) |
| 2 | max 0.7152, **25 px** | (not reached in that capture) |
| 3 (re-run, full output) | max 0.7152, **28 px** | **max 0.7152, 213 px** |

**The cross-load flip reproduces with N10 ALONE.** It does not need `negative.spec.ts` running
thirteen other tests first, which rules out sequence state as a necessary condition.

## D9.4 — Delta-t sweep (N10's own acquisition path)

| condition | max luma | differing px |
|---|---:|---:|
| in-page, Δt = 1 s | 0.7152 | 17 |
| in-page, Δt = 5 s | 0.7152 | 3 |
| in-page, Δt = 10 s | 0.7152 | 24 |
| in-page, Δt = 30 s | 0.7152 | 7 |
| **cross-load (fresh page)** | **0.7152** | **213** |

**The count does NOT grow with Δt** — 17 → 3 → 24 → 7 at 1/5/10/30 s is noise around a small
constant, not accumulation. So **reading (1) does NOT apply**: there is no wall-clock accumulator
still running.

## D9.5 — defect install/restore cycle

| | before | after |
|---|---|---|
| `specularIntensity` | 0 | 0 |
| `roughness` | 0.9 | 0.9 |
| `roughnessMap` | object | object (**same identity — true**) |
| material `version` | 2 | **4** (bumped twice) |
| enumerable keys | 114 | 114 |

Cycle diff: **max 0.7152, 18 px** — indistinguishable from the in-page noise floor (17/3/24/7 px).
The restore is **not bit-identical in `version`**, but `version` is a `needsUpdate` counter, not a
rendered value, and no property that affects shading differed.

## Which pre-registered reading applied

**Reading (5): nothing reproduces the *magnitude*.**

The 0.7152 luma value appears in *every* arm, including the in-page pairs that N10 already tolerates.
What no arm reproduced is the **213-pixel extent** on a cross-load pair except D9.4's own cross-load
arm — which did reproduce it (213 px). So the honest summary is narrower than any of the five
readings anticipated:

- 0.7152 luma is a **ubiquitous one-LSB quantisation** that appears whenever any two acquisitions are
  compared, in-page or cross-load. It is not cross-load-specific.
- The **213-px cross-load extent** reproduced in D9.4 (fresh context) and in D9.2 (N10 alone), so it
  is a property of `acquireGlintFrames` on a *fresh page load*, not of `negative.spec.ts`'s sequence.
- The in-page pairs differ in only 3–28 px, which is why N10's 50 px tolerance holds.

The candidate mechanism consistent with all of this is **`Hotspot.tsx:53`'s `uPhase`**: a per-load
random phase that makes each load's frozen ring a slightly different still image. That predicts
exactly what was observed — in-page pairs agree closely (same `uPhase`), cross-load pairs differ more
(different `uPhase`), and every difference is a rounding-level LSB because the ring is a low-amplitude
additive layer. **This is a hypothesis consistent with the data, not a proven cause** — proving it
needs a seeded `uPhase`, which is a `src/` change and therefore out of scope here.

## Consequences

| consumer | effect |
|---|---|
| **N10** | unaffected — its cross-load pair is *printed, not asserted*; the in-page tolerance (1.0 luma / 50 px) covers the 3–28 px it actually sees |
| **`ref.spec`** | **unaffected and still strict 0** — three separate runner processes each measured 0 on both pairs, because the reference pose has rings OFF, so `uPhase` never reaches a pixel |
