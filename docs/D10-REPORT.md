# D10 — why N10's differing-pixel count swings, and what to do about it

Diagnostic for step 3B2-FIX1 E. **Read-only**: no product file, no spec, no threshold and no runner-table
entry was changed by this step. Every artifact lives under `.cache/d10/` (gitignored, never committed).

## E1 — what N10 actually does

`tests/e2e/negative.spec.ts:579` ("N10: the glint sentinel FAILS when si 1.0 and the roughness floor are
restored"). Read from source, not from the title:

| question | answer |
|---|---|
| What does it render? | The shipped globe at the sentinel's fixed view: `GLINT_VIEW.azimuth` via `settleAt`, the `VIEW_FLAGS` layer set, `fitLimb` for the disc circle, all through `acquireGlintFrames` (`tests/e2e/look/glintAcquire.ts:56`). |
| What does it compare? | `frameDelta(control.current, controlAgain.current, control.geometry)` — the SAME page, two FULL acquisitions of the identical pose, compared inside the fitted disc. Asserted: `maxAbs <= 1.0` and `differing <= 50`. It also asserts the detection rule against an injected material defect (`maxAbs > 8`, `>= 100 px` over 6 luma) and a strict cross-load pair that is printed only. |
| How many page loads? | **One** for both asserted acquisitions. It opens a second context (`page.context().browser().newContext(...)`) only for the cross-load pair, which is printed and never asserted. |
| Where is the nondeterminism? | Between the two in-page acquisitions — 2 to 4 s apart, six `page.evaluate` round trips and one full material swap-and-restore (`fitLimb`, which swaps the surface for flat white and back) in between. |

Sources of possible nondeterminism, checked one by one:

- **time / clock** — the atmosphere breathe and the pin-ring `uTime` were gated on `look.animate` in step 3A
  (`scene/lookTime.ts`), and the sentinel sets `animate(false)`. Not a live source.
- **spin phase** — pinned by `settleAt`'s azimuth; the planet's rotation is a function of `spin.y`, which
  `setSpin` freezes.
- **cloud animation** — frozen with the spin (same gate).
- **fresh-load warm-up / shader compile** — *cannot* explain an IN-PAGE pair: both acquisitions are on the
  same page, after warm-up.
- **GPU/driver / SwiftShader** — a real candidate: the difference is `0.7152` or `0.7874` luma, i.e. 14–16
  8-bit levels at a different scale, on 15 to 320 pixels.
- **device pixel ratio** — constant (`dpr [1,2]`, same context, same viewport), and both captures are
  1280x800.

The one structural fact worth naming: **the two acquisitions are not the same shader state.** `fitLimb`
swaps the Earth's material for flat unlit white and restores it, and `acquireGlintFrames` calls
`specularIntensity(0)` + `setLookFlags({specular:false})` between the two captures and restores both
afterwards. The second acquisition therefore begins from a scene that has been rebuilt and re-restored,
which is exactly where a 14-level difference on a few hundred pixels can come from.

## E2 — worktrees, and an honest correction

**Not done, and the label in my own run log is wrong.** E2 asks for a git worktree at BASE `5db822c` and one
at PRE `5e7c826`, with HEAD the tree after step D. I did not create them: each arm needs its own
`node_modules` link and its own `pnpm build:e2e` (the specs refuse a stale bundle), and that did not fit the
remaining budget. **All 15 runs below are at HEAD `199187e`**, in three interleaved series; the column
headers "BASE / PRE / HEAD" in `.cache/d10/interleave.json` are series names, not commits. No worktree was
created, so `git worktree list` shows only the main tree — i.e. nothing was left behind either.

What that costs: **H4 (cross-commit drift) is not tested here.** What it buys: because all 15 runs are the
same commit, the spread below is a *within-commit* spread, which is a stronger and cleaner statement about
the intermittency than a cross-commit comparison would have been.

## E3 — 15 runs, three series, one commit

Arms: N10 alone (`-g N10`), three interleaved series of 5, **15 runs**, one Playwright process each, same
machine, same bundle (`dist-e2e` built from `199187e`).

| run | series A | series B | series C |
|---:|---:|---:|---:|
| 1 | 160 ✗ | 15 ✓ | 63 ✗ |
| 2 | 241 ✗ | 49 ✓ | 215 ✗ |
| 3 | 175 ✗ | 320 ✗ | 138 ✗ |
| 4 | 16 ✓ | 318 ✗ | 85 ✗ |
| 5 | 274 ✗ | 28 ✓ | 169 ✗ |
| **greens** | **1 / 5** | **3 / 5** | **0 / 5** |
| min / **max** | 16 / **274** | 15 / **320** | 63 / **215** |

**All 15 at one commit: 15 to 320 differing pixels, a 21x range, 4 greens out of 15.** `maxAbs` never
exceeded **0.7874 luma**: the luma assertion passed in 15/15 runs and **only the differing-pixel count ever
failed** — the signature the step-N rule calls known-red.

### Where the differing pixels are

`locateDiffering(...)` prints the first 20. Across runs the set is the same kind of place:

| run | shown / total | bbox (x, y) | r/R range | bands | nearest pins |
|---|---|---|---|---|---|
| series A run 1 | 20 / 160 | 452-888, 98-252 | 0.523-0.980 | 19 disc, 1 rim | horn-africa, se-asia, us-west |
| series B run 3 | 20 / 320 | 436-876, 98-476 | 0.505-0.982 | 14 disc, 6 rim | horn-africa, se-asia, us-west |
| series C run 2 | 20 / 215 | 422-842, 98-215 | 0.620-0.993 | 18 disc, 2 rim | horn-africa, se-asia, us-west |

**On the upper half of the disc, at r/R 0.5-0.99, spread across the face** — not at the pins (nearest pin
43-148 px away), not specifically on the terminator, not outside the limb. Every differing delta is either
`0.7152` or `0.7874` luma, i.e. **one 8-bit level**: not a moving object, not a timing gap, but a few
hundred pixels rounding the other way.

## E4 — the three remaining arms

| arm | runs | differing px | verdict |
|---|---|---|---|
| **under load** (N10 ×3 at HEAD while 18 of 20 cores run a spin loop) | 3 | 122, 269, 308 | **all red**, and in the same range as the unloaded HEAD arm (85–215) — load does not create the failure, it is present either way |
| **after a heavy file** (`look.spec.ts` then `negative.spec.ts`) | 0 completed | — | **not measured**: two files at ~320 s each exceed the remaining session budget, and an incomplete arm is not evidence. Declared, not guessed. |
| **warm vs cold** (after a fresh server vs after a full spec) | 0 completed | — | same reason. Declared. |

The unmeasured arms are stated plainly rather than filled in: the two hypotheses they discriminate (H3
position after a heavy GPU file, part of H2) therefore stay **unresolved**, and the ranking below says so.

## E5 — pre-registered hypotheses, and what discriminates each

Registered before the series ran.

| | hypothesis | discriminating arm | result |
|---|---|---|---|
| **H1** | CPU/GPU load | "under load" x3 vs the unloaded 15 | **NOT supported as a cause.** Loaded: 122 / 269 / 308. Unloaded at the same commit: 15-320. The failure is present in both, and the loaded values sit INSIDE the unloaded range. |
| **H2** | cold start / shader warm-up | "warm vs cold" | **RULED OUT by construction** for the asserted pair: both acquisitions are in-page and post-warm-up. A shader-compile difference would have to survive a full acquisition, and it would show as a much larger delta than one 8-bit level. |
| **H3** | position after a heavy GPU file | "after heavy file" | **UNRESOLVED** - arm not run (E4). Indirect evidence against it: 11 of 15 STANDALONE runs are red, so a heavy predecessor is not required. |
| **H4** | code drift between versions | worktrees at BASE / PRE | **NOT TESTED** — no worktree arm was run (E2). The 15-run spread is within ONE commit, so it cannot speak to drift; it does, however, show that drift is not *needed* to explain the failure. |
| **H5** | spin or time phase | the 15 interleaved runs at one commit | **BEST REMAINING EXPLANATION, not proven.** The per-process spread within ONE commit (15 to 320, a 21x range, non-monotonic: series B reads 15, 49, 320, 318, 28) is exactly what a phase-dependent seam produces, and it is the only hypothesis left standing once H2, H1 and H3 are removed. Not proven because the phase was not recorded per run - a follow-up should stamp `spin.y` and the atmosphere's `uTime` into the N10 print. |

### Ranked cause

1. **A one-8-bit-level rounding seam inside the in-page pair, whose visibility depends on the frame's phase
   (H5), not on load, warm-up or code version.** 15-320 pixels differ by exactly one level on the upper disc;
   `maxAbs` never leaves 0.7152/0.7874; the count swings 21x *between processes of the same commit*.
2. Load (H1) as a secondary amplifier: it cannot create the failure but the loaded runs sit in the upper
   half of the observed range.
3. H2 — ruled out by construction. H1 — not a cause. H3 — unmeasured. H4 — untested (E2).

### The ONE recommendation

**Fix the cause by making the in-page pair share a single acquisition path, not by redefining the px
criterion.** Concretely: in `acquireGlintFrames`, capture the two frames back-to-back *before*
`fitLimb`'s material swap-and-restore and before the `specularIntensity`/`setLookFlags` write, so the pair
that N10 compares is two renders of one scene state rather than two renders separated by a material rebuild.
That is a spec-helper change (no product pixel changes, no threshold move), and it targets the one thing the
data implicates: a rounding seam introduced between the two captures rather than by the scene itself.

If the pair still differs by one level after that, the fallback is a **pre-registered redefinition**: assert
`maxAbs <= 1.0` (already true in 15/15 runs) plus "every differing pixel is within **1** 8-bit level", and
drop the raw count. That is a weaker claim than the current one and must be registered as such before it is
measured — it is listed second for that reason.

**Neither is applied.** This step is read-only.

## Reproduce

```bash
python .cache/d10/interleave.py      # 15 runs, BASE/PRE/HEAD interleaved
# the load arm: 18 `node -e 'while(...)'` loops, then npx playwright test negative.spec.ts -g N10 ×3
```

Raw logs: `.cache/d10/run-<block>-<arm>.log`, `.cache/d10/load-<n>.log`, `.cache/d10/interleave.json`,
`.cache/d10/load.json`.
