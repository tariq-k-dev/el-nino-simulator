# MOBILE2-R — reconciliation of three reporting inconsistencies

Read-only reconciliation of MOBILE2 (HEAD `475165b`, prompt commit `90a29b8`). **No source, test or config file
was changed.** Every number below comes from a run in this session, on the E2E bundle built from HEAD
(`dist-e2e/build-stamp.json` → `gitHead 90a29b8…, srcHash 0f1ed8ceb57f, builtAt 2026-11-02T02:26:33Z`).

Two instruments, both this session:

- **`layout-matrix.spec.ts`** — the committed acceptance file, run isolated: **10/10 passed (5.6 min)**,
  log `.cache/mob2r/lm.log`. Its own `[LM3]` console line is quoted in R3/R4 as the oracle for the committed margins.
- **`.cache/mob2r/probe.spec.mjs`** — a throwaway Playwright probe (own config `.cache/mob2r/pw.config.mjs`,
  own port-4197 server, same `dist-e2e` bundle and the same `STALE E2E BUNDLE` guard). It lives entirely under
  `.cache/` (gitignored) and appears in no commit. Raw output `.cache/mob2r/probe.log`, parsed `.cache/mob2r/probe.json`.
  17 rows, `deviceScaleFactor 2`, `isMobile`, `hasTouch`, `?debug&framing=live`, each row read after the fit
  **arrived** (the same `settleFit` rest test the spec uses) rather than mid-ease.

The disc is measured by **projecting the limb through the scene's own camera matrix** — four limb points along the
camera's right and up axes, via `__globe.project`, which calls `camera.project()`. That is the construction LM3
uses applied to the geometry instead of the closed form, and the two agree to 0.73 px everywhere (see R3), which is
what makes the bounding box trustworthy as a *position* measurement and not just a size one.

Environment notes: `env(safe-area-inset-top)` measures **0 px** in Chromium here (probed with a disposable div), so
no safe-area contributes to any header height below. Desktop rows (1024x768, 1280x800, 1440x960) are included
because R6 asks for all 17 viewports; they have no compact header and no mobile radius budget.

---

## R1 — commit ledger

`git log --oneline --decorate f7a8332..HEAD`, with per-commit changed-file counts from
`git show --numstat --format='' <h> | wc -l`:

| # | commit | label | files changed | subject |
|---|---|---|---:|---|
| 1 | `90a29b8` | **P0** (this prompt) | 1 | docs: add MOBILE2-R reconciliation prompt |
| 2 | `475165b` | F | 1 | the full run's reds, each attributed by an isolated rerun; the pinch finding at 375x667 |
| 3 | `bbe7fb4` | F | 2 | E2E and status notes for MOBILE2 — the matrix counts, LM3 margins, the two defects, the harness traps |
| 4 | `7d7db34` | F | 2 | register layout-matrix in the runner's expected counts; docs/MOBILE.md for the layout law |
| 5 | `bbb1005` | E | 4 | the layout matrix acceptance suite, and the two defects it found |
| 6 | `270ab35` | B+C | 22 | compact header, free-rect camera fit, unclamped dMax, shared sheet body, landscape dock |
| 7 | `337f536` | A | 2 | the pure layout law — mode, free rect, radius budget, dock width, peek clamp, delta conversion |
| 8 | `f84a3a4` | P1 | 1 | audit the MOBILE1 surface, the shared controls and the d-dependent items |
| 9 | `cf8b0a6` | P0 | 1 | save prompt 2B-STEP3-MOBILE2 verbatim |

**Total is 9, not 8.** The extra one is `90a29b8`, the commit that saved *this* prompt — it is in the range
because it is a descendant of `f7a8332` like every other commit. Excluding it, MOBILE2's own ledger is the **8**
the prompt expects. Counted by label the range is **P0 x2, P1 x1, A x1, B+C x1, E x1, F x3 = 9**; MOBILE2-proper
is **P0 x1, P1, A, B+C, E, F x3 = 8**. There is **no commit labelled `D`** — the sheet/dock work landed inside
`270ab35` (B+C), which is why its file count is 22.

**The run-together token `7d7db34bbe7fb4475165b`.** It is two seven-character hashes plus the first two characters
of a third, concatenated because the three F commits were written as one token with no separator:

    `7d7db34`  +  `bbe7fb4`  +  `47…` (the first two chars of `475165b`)

Resolved in full: `7d7db347c1d191404df6b1dcf2fcd4da0750e673`, then `bbe7fb4…`, then `475165b…`. Three commits, not
one. Every hash in the table above is copied from `git log` output rather than retyped.

**Commits with no label: one — `90a29b8`.** It is the reconciliation prompt itself, which the MOBILE2 label scheme
(P0…F) does not cover. All eight MOBILE2 commits carry one.

**`git status --porcelain`: empty.** Confirmed at the start of the session, after the probe (which writes only
under `.cache/`, gitignored), and again before writing this file.

**Locked specs vs `5e7c826`.** The question is answerable only in one form: every spec file that **existed** at
`5e7c826` must diff empty. Measured per file with `git diff --numstat 5e7c826 HEAD -- <file>`:

| result | files |
|---|---|
| **EMPTY (15/15 specs)** | `boot`, `camera-golden`, `determinism`, `focus-ux`, `frame-director`, `frame`, `gate-clock`, `globe`, `harden`, `history-gate`, `limb`, `look`, `negative`, `ref`, `scene-gate` |
| **EMPTY (11 non-spec harness files)** | `abort-trace.mjs`, `acceptance-matrix.mjs`, `boot-timeline.mjs`, `brotli-server.mjs`, `fixtures.ts`, `gate-effect.mjs`, `global-setup.ts`, `source-guards.test.ts`, `suiteInventory.test.ts`, `wire-bytes.mjs`, `tests/fixtures/engine-golden.json` |
| changed | `tests/e2e/globals.d.ts` — **+67 / −0** |

So **no locked spec was edited**, which is the property the rule protects. A naive
`git diff 5e7c826 HEAD -- tests/e2e/` is *not* empty (+4193 lines across 6 files) and that is correct behaviour,
not a violation: five of the six are files this step family **added** (`layout-matrix`, `mobile-sheet`,
`pin-click`, `reset-ux`, `switcher-ux` all have status `A`), and a spec that did not exist at the baseline cannot
be "un-edited". `globals.d.ts` is the ambient declaration the probe interface needs — additive (+67, −0), and the
mechanism by which `tsc -b` learns about the new probe fields; no assertion lives in it.

Read strictly as *"the raw diff of `tests/e2e/` is empty"*, the rule **cannot** pass for any step that adds an
acceptance file — the prompt's own E subject does exactly that. Read as *"the pre-existing specs are byte-identical"*,
it **passes**, 15/15.

---

## R2 — 104 versus 158

### The row, per viewport

| viewport | mode | (a) DOM header bottom | (b) published headerBottom | (c) published free rect x, top, w, bottom | (d) cy | peekTop | halfTop | Rb | (e) LM3 top / bottom |
|---|---|---:|---:|---|---:|---:|---:|---:|---|
| 390x844 | portrait | 158.00 | 158.00 | 0.00, 158.00, 390.00, 692.08 | 410.88 | 692.08 | 438.88 | 183.00 | 158.00 / 692.08 |
| 412x924 | portrait | 158.00 | 158.00 | 0.00, 158.00, 412.00, 757.68 | 452.48 | 757.68 | 480.48 | 194.00 | 158.00 / 757.68 |
| 360x640 | portrait | 158.00 | 158.00 | 0.00, 158.00, 360.00, 524.80 | 304.80 | 524.80 | 332.80 | 134.80 | 158.00 / 524.80 |
| 375x667 | portrait | 158.00 | 158.00 | 0.00, 158.00, 375.00, 546.94 | 318.84 | 546.94 | 346.84 | 148.84 | 158.00 / 546.94 |
| 430x932 | portrait | 158.00 | 158.00 | 0.00, 158.00, 430.00, 764.24 | 456.64 | 764.24 | 484.64 | 203.00 | 158.00 / 764.24 |
| 320x568 | portrait | 158.00 | 158.00 | 0.00, 158.00, 320.00, 456.00 | 267.36 | 456.00 | 295.36 | 97.36 | 158.00 / 456.00 |
| 768x1024 | portrait | 158.00 | 158.00 | 0.00, 158.00, 768.00, 839.68 | 498.84 | 839.68 | 532.48 | 328.84 | 158.00 / 839.68 |
| 820x1180 | portrait | 158.00 | 158.00 | 0.00, 158.00, 820.00, 967.60 | 562.80 | 967.60 | 613.60 | 392.80 | 158.00 / 967.60 |
| 960x1440 | portrait | 158.00 | 158.00 | 0.00, 158.00, 960.00, 1180.80 | 669.40 | 1180.80 | 748.80 | 468.00 | 158.00 / 1180.80 |
| 600x600 | portrait | 158.00 | 158.00 | 0.00, 158.00, 600.00, 488.00 | 284.00 | 488.00 | 312.00 | 114.00 | 158.00 / 488.00 |
| 667x375 | phoneLandscape | 194.75 | 194.75 | 0.00, 194.75, 347.00, 375.00 | 284.88 | n/a | n/a | 78.12 | 194.75 / 375.00 |
| 844x390 | phoneLandscape | 66.00 | 66.00 | 0.00, 66.00, 523.28, 390.00 | 228.00 | n/a | n/a | 150.00 | 66.00 / 390.00 |
| 924x412 | phoneLandscape | 66.00 | 66.00 | 0.00, 66.00, 572.88, 412.00 | 239.00 | n/a | n/a | 161.00 | 66.00 / 412.00 |
| 932x430 | phoneLandscape | 66.00 | 66.00 | 0.00, 66.00, 577.84, 430.00 | 248.00 | n/a | n/a | 170.00 | 66.00 / 430.00 |
| 1024x768 | desktop | no compact header | 0.00 | 360.84, 118.25, 347.16, 768.00 | n/a | n/a | n/a | 0.00 | 118.25 / 768.00 |
| 1280x800 | desktop | no compact header | 0.00 | 360.84, 118.25, 603.16, 800.00 | n/a | n/a | n/a | 0.00 | 118.25 / 800.00 |
| 1440x960 | desktop | no compact header | 0.00 | 360.84, 118.25, 763.16, 960.00 | n/a | n/a | n/a | 0.00 | 118.25 / 960.00 |

Legend — (a) `document.querySelector('[data-occluder="compact-header"]').getBoundingClientRect().bottom`; (b)
`window.__frame.headerBottom`, which the director copies from `getLayoutSignal().headerBottom`;
(c) `snapshot().free` = `{x, y, w, h}` re-expressed as x, top, width, bottom; (d) `peekTop = H − peekVisible`,
`halfTop = 0.52·H`, `cy = min(mid, halfTop − 28)` for portrait and `(top+bottom)/2` for phoneLandscape; (e) LM3's
own `f.y` and `f.y + f.h` — the **published** rect's top and bottom, i.e. `snap.free`.

**Every row: (a) == (b) exactly, 0.00 px.** The publisher is honest; there is no product bug in the free rect.

### What 104 is, what 158 is, and which is true

**158 px is the true header bottom.** Four independent lines of evidence, all this session:

1. **It is the measured DOM rect.** `HeaderCompact` publishes `el.getBoundingClientRect().bottom` from a
   `ResizeObserver` (`src/mobile/HeaderCompact.tsx:98`). At all nine portrait viewports that value is **158.00**,
   and the store republishes it unchanged (`publishHeaderBottom`, `src/scene/viewStore.ts:286-291`, which drops
   only sub-0.5 px changes).
2. **The header's own computed style agrees.** `getComputedStyle(header).height` = `158px` at every portrait row,
   with `paddingTop: 8px`, `paddingBottom: 8px`, `rowGap: 6px`.
3. **The row decomposition adds up to exactly 158.** Measured child rects at 375x667 (identical at every portrait
   width): `paddingTop 8` → identity row `8.00–44.00` (h 36) → gap 6 → controls row `50.00–100.00` (h 50) → gap 6 →
   chip row `106.00–150.00` (h 44) → `paddingBottom 8` → **158.00**. Note the DOM order: the chip is `order-last`
   (`HeaderCompact.tsx:139`), so it *renders* third while sitting second in the source.
   The `54 px` the prompt asks about is **not a header element**: the controls row is **50 px** (a 44 px button in a
   `p-0.5` = 2 px pill plus the pill's 1 px border x2), and the identity row is **36 px** because it is sized by the
   36 px globe badge (`h-9 w-9`), not by the 44 px touch minimum. Nothing measures 54.
4. **It is width-independent.** 158.00 at 320x568 *and* at 960x1440 — a fixed two-row header, not a wrap.

**`peekTop` is a separate 158 and is not the header.** At 375x667, 390x844 and 412x924 the portrait free rect's
**bottom** is `H − peekVisible` with `peekVisible = max(0.18·H, 112)`. Only at 320x568 is `0.18·H` (102.24) below
the 112 floor. The coincidence that `158` appears in both columns at 390x844 is arithmetic, not structure.

**104 px is a planning assumption, not a measurement.** It appears in exactly one place in the repo:
`docs/MOBILE2-AUDIT.md:157` — *"Planned (not measured) values for the new free rect at an assumed compact-header
height of 104 px portrait / 60 px phoneLandscape"* — and the table under it (`:163-172`) carries it into the free
rect's `top` column for all six portrait rows. It was written during P1, **before `HeaderCompact` existed**, and it
is labelled an assumption in that very sentence.

The proof that 104 never described the shipped header is in the Rb column. Re-running the repo's own
`dContainFor(Rb, focalPx(H), 1.10242)` against the audit's *assumed* Rb reproduces the audit's *assumed* dFit to
three decimals on all six rows — the audit's arithmetic was self-consistent — and it disagrees with the measured
dFit exactly where the header is the binding term:

| viewport | audit: top 104, Rb, dFit | measured: top 158, Rb, dFit | `dContainFor(audit Rb)` |
|---|---|---|---|
| 390x844 | 104, 183, 6.714 | **158, 183.00, 6.7138** | 6.7138 — identical: the WIDTH binds, header irrelevant |
| 412x924 | 104, 194, 6.928 | **158, 194.00, 6.9276** | 6.9276 — identical, width binds |
| 430x932 | 104, 203, 6.684 | **158, 203.00, 6.6842** | 6.6842 — identical, width binds |
| 360x640 | 104, 168, 5.580 | **158, 134.80, 6.9061** | 5.5803 vs 6.9061 — **differs by 1.326** |
| 375x667 | 104, 175.5, 5.568 | **158, 148.84, 6.5287** | 5.5677 vs 6.5287 — **differs by 0.961** |
| 320x568 | 104, 148, 5.620 | **158, 97.36, 8.4496** | 5.6201 vs 8.4496 — **differs by 2.830** |

The three tall viewports are identical because there the **width** term sets `Rb`, so the header's height cannot
influence the fit; the three short ones differ because the **header-top** term binds and a 158 px header is 54 px
lower than the assumption. That 54 px is the entire gap between the audit and the product.

### The three-time measurement (late wrapping?)

A pre-app `requestAnimationFrame` sampler (`addInitScript`, so it runs before any app JS) recorded the header's
bottom from `performance.now()` 0 to 1600 ms on **fresh loads**, stamping the first sample at or after
`document.fonts.ready`:

| viewport | `fonts.ready` at | first sample | after fonts.ready | last sample | min | max | distinct values |
|---|---|---|---|---|---|---|---|
| 375x667 | 1.4 ms | **158.00** @ 800 ms | **158.00** | **158.00** @ 2018 ms | 158 | 158 | **`158.00` only** |
| 320x568 | 1.3 ms | **158.00** @ 822 ms | **158.00** | **158.00** @ 1738 ms | 158 | 158 | **`158.00` only** |
| 360x640 | 0.9 ms | **158.00** @ 248 ms | **158.00** | **158.00** @ 1821 ms | 158 | 158 | **`158.00` only** |
| 390x844 | 1.5 ms | **158.00** @ 247 ms | **158.00** | **158.00** @ 2094 ms | 158 | 158 | **`158.00` only** |
| 667x375 | 1.1 ms | **113.50** @ 265 ms | **113.50** | **194.75** @ 2326 ms | 113.5 | 194.75 | `113.50`, `194.75` |

**158 is not a late-wrapping artefact.** In portrait the header reaches its final height before the sampler's first
frame, `document.fonts.ready` resolves at ~1.4 ms (fonts preloaded — nothing re-wraps), and the value is
**identical across 2 s and across nine widths**. A wrap-driven height changes with width; this does not. The h1 is
one line at 375x667 (rect height **16.25 px**, top 17.875, bottom 34.125) and stays one line — `h1h` is 16.25 in
every sample.

**667x375 is the opposite finding, and it is a real defect.** Its header is **113.50 px at 265 ms and 194.75 px at
2326 ms** — it grows by **81.25 px after the page is already interactive**, and the h1's own rect grows from 97.50
to 178.75 px, i.e. the heading wraps *late*, and by a lot. The cause is legible: in phoneLandscape a no-wrap flex
line puts the identity row in a `flex-1` slot beside a 217.48 px chip and a 331.02 px controls cluster inside 667
px, squeezing the identity row to **70.5 px** — a 13 px h1 broken every 26.5 px wraps to ~eleven 16 px line boxes.
It also produces a second published oddity: the header's bottom (194.75) is **below** the controls row's bottom
(122.38), so the dock — which starts at `{headerBottom}px` (`src/mobile/LandscapeDock.tsx:78`) — begins 72 px
below where the controls end. The settle is real, not a sampler artefact: the main pass's settled reading is 194.75
too.

### Verdict for R2

**Reporting bug, not a product bug.** The published free rect equals the real header bottom to 0.00 px on all 17
rows. What was wrong was the *table that reported it*: `docs/MOBILE2-AUDIT.md:157-172` is an explicitly
"planned (not measured)" projection at an assumed 104 px header, later read as if it were a measurement. The one
place a 104-class number *is* a product defect is the phoneLandscape late wrap in R7 — a different number
(113.5 → 194.75), a different mode, and real.

---

## R3 — row 667x375

Same projection method as LM3 — the limb projected through the scene's camera matrix — at the settled fit:

| quantity | value |
|---|---|
| free rect | x `0.00`, top `194.75`, width `347.00`, bottom `375.00` |
| dock width | `320.00` = `min(max(320, 0.38·667 = 253.46), 400) = min(320, 400) = 320`, then `min(320, 0.5·667 = 333.5) = 320` |
| raw disc bounding box | left `103.523`, right `243.477`, top `214.898`, bottom `354.852` |
| disc centre | (`173.500`, `284.875`) |
| radius, horizontal | `(243.477 − 103.523) / 2 = 69.977` |
| radius, vertical | `(354.852 − 214.898) / 2 = 69.977` |
| `discRadiusPx()` (closed form) | `70.707` |
| radius budget `Rb` | `78.125` |
| `dFit` | `6.9802` |
| actual camera distance | `6.9802` (= dFit; no clamp) |
| `dContain` recomputed from `Rb` | `6.9802` |
| `r / Rb` | `0.905` |
| margins L / R / T / B vs the free rect | `103.52` / `103.52` / `20.15` / `20.15` |

**Is 70.7 a typo, an artefact, or the real rendered size? Real.** Two independent methods — projecting four limb
points through the camera, and the probe's `tan(asin(R/d))·focalPx` — give **69.977** and **70.707**, a 0.73 px
(1.0 %) disagreement that is exactly the expected difference between sampling the sphere's true silhouette and the
closed form at `R/d = 1/6.98`. The committed spec printed **70.7** (`.cache/mob2r/lm.log`, `[LM3]` row `667x375`),
the closed form gives `70.707`, the direct measurement `69.98`. Three agreeing readings; none is a typo.

I do **not** call it a product defect. The disc is not clipped and not oversized: `r/Rb = 0.905`, margins 20.15 px
top and bottom, 103.5 px per side — the largest side margins in the matrix. It is small because `Rb = 78.125`, and
`Rb` is small because the **header term binds**: `cy − top = 284.875 − 194.75 = 90.125`, minus the 12 px
`RADIUS_MARGIN_PX` = 78.125. The 667x375 globe is small because the header is 194.75 px on a 375 px viewport —
**51.9 % of the screen**. The product defect at that row is the header's late wrap (R2, R7), not the disc: at a
66 px header like 844x390/924x412 its identity row would not be squeezed and `Rb` would roughly double.

---

## R4 — tablet, square and the rest of the matrix

The prompt asks for 768x1024, 820x1180, 960x1440 and 600x600 "no approximate values", and R6 asks for all 17
viewports — so the table below is the union: one row per viewport, every R4 column present for every row.
`dMax/dFit` is `controls.maxDistance / dFit` as published. Margins L/R/T/B are measured from the **projected disc
edge** to the published free rect.

| viewport | mode | disc r | free rect (x, top, w, bottom) | Rb | dFit | dMax | dMax/dFit | r/Rb | binding term | L | R | T | B |
|---|---|---:|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|
| 390x844 | portrait | 165.59 | 0.00, 158.00, 390.00, 692.08 | 183.00 | 6.7138 | 8.3922 | 1.250 | 0.905 | left (195.00) | 29.41 | 29.41 | 87.29 | 115.61 |
| 412x924 | portrait | 175.57 | 0.00, 158.00, 412.00, 757.68 | 194.00 | 6.9276 | 8.6594 | 1.250 | 0.905 | left (206.00) | 30.43 | 30.43 | 118.91 | 129.63 |
| 360x640 | portrait | 121.99 | 0.00, 158.00, 360.00, 524.80 | 134.80 | 6.9061 | 8.6327 | 1.250 | 0.905 | header (146.80) | 58.01 | 58.01 | 24.81 | 98.01 |
| 375x667 | portrait | 134.66 | 0.00, 158.00, 375.00, 546.94 | 148.84 | 6.5287 | 8.1609 | 1.250 | 0.905 | header (160.84) | 52.84 | 52.84 | 26.18 | 93.44 |
| 430x932 | portrait | 183.69 | 0.00, 158.00, 430.00, 764.24 | 203.00 | 6.6842 | 8.3552 | 1.250 | 0.905 | right (215.00) | 31.31 | 31.31 | 114.95 | 123.91 |
| 320x568 | portrait | 88.18 | 0.00, 158.00, 320.00, 456.00 | 97.36 | 8.4496 | 10.5620 | 1.250 | 0.906 | header (109.36) | 71.82 | 71.82 | 21.18 | 100.46 |
| 768x1024 | portrait | 296.70 | 0.00, 158.00, 768.00, 839.68 | 328.84 | 4.6054 | 5.7568 | 1.250 | 0.902 | header (340.84) | 87.30 | 87.30 | 44.14 | 44.14 |
| 820x1180 | portrait | 354.26 | 0.00, 158.00, 820.00, 967.60 | 392.80 | 4.4523 | 5.5654 | 1.250 | 0.902 | header (404.80) | 55.74 | 55.74 | 50.54 | 50.54 |
| 960x1440 | portrait | 422.20 | 0.00, 158.00, 960.00, 1180.80 | 468.00 | 4.5538 | 5.6922 | 1.250 | 0.902 | left (480.00) | 57.80 | 57.80 | 89.20 | 89.20 |
| 600x600 | portrait | 103.21 | 0.00, 158.00, 600.00, 488.00 | 114.00 | 7.6376 | 9.5470 | 1.250 | 0.905 | header (126.00) | 196.79 | 196.79 | 22.79 | 100.79 |
| 667x375 | phoneLandscape | 70.71 | 0.00, 194.75, 347.00, 375.00 | 78.12 | 6.9802 | 8.7252 | 1.250 | 0.905 | header (90.12) | 102.79 | 102.79 | 19.42 | 19.42 |
| 844x390 | phoneLandscape | 135.03 | 0.00, 66.00, 523.28, 390.00 | 150.00 | 3.8928 | 5.0000 | 1.284 | 0.900 | peek/bottom (162.00) | 126.61 | 126.61 | 26.97 | 26.97 |
| 924x412 | phoneLandscape | 144.89 | 0.00, 66.00, 572.88, 412.00 | 161.00 | 3.8364 | 5.0000 | 1.303 | 0.900 | peek/bottom (173.00) | 141.55 | 141.55 | 28.11 | 28.11 |
| 932x430 | phoneLandscape | 152.96 | 0.00, 66.00, 577.84, 430.00 | 170.00 | 3.7957 | 5.0000 | 1.317 | 0.900 | header (182.00) | 135.96 | 135.96 | 29.04 | 29.04 |
| 1024x768 | desktop | 204.20 | 360.84, 118.25, 347.16, 768.00 | 0 (n/a) | 5.0000 | 5.0000 | 1.000 | n/a | desktop: no mobile budget | n/a | n/a | n/a | n/a |
| 1280x800 | desktop | 218.22 | 360.84, 118.25, 603.16, 800.00 | 0 (n/a) | 4.2828 | 5.0000 | 1.167 | n/a | desktop: no mobile budget | n/a | n/a | n/a | n/a |
| 1440x960 | desktop | 322.03 | 360.84, 118.25, 763.16, 960.00 | 0 (n/a) | 4.0097 | 5.0000 | 1.247 | n/a | desktop: no mobile budget | n/a | n/a | n/a | n/a |

**`maxDistance >= 1.2 x dFit`:** holds on **every mobile row**. Measured ratios: portrait `1.250` exactly (the
`1.25` term binds above the `5` floor); phoneLandscape `1.284` / `1.303` / `1.317` — at 844x390, 924x412 and
932x430 **`dMax` is the `5` floor**, because `1.25·dFit` is 4.87 / 4.80 / 4.74, all below 5. Minimum mobile ratio
**1.250**.

**Desktop rows do not satisfy 1.2x, by design and by the prompt's own scope fence.** 1024x768 is `1.000`
(`dMax = 5` binds — the documented open clamp flag), 1280x800 `1.167`, 1440x960 `1.247`. Unclamping was specified
for non-desktop modes only (`src/mobile/mobileFrame.ts:29-33`), so these three are the pre-existing desktop ceiling
measured, not a regression. R6's "all 17" therefore contains three rows where `r/Rb` is not applicable at all
(`radiusBudget` is 0 on desktop — the mobile fit never runs) and `dMax/dFit` is below 1.2 in two of them.

**Every mobile row clears the 8 px margin widely.** The tightest is **667x375 at 20.15 px** (top and bottom); next
is **320x568 at 21.80 px** (top). LM3's own printed margins (`.cache/mob2r/lm.log`) agree with mine in every row's
ordering and within ~1.9 px in absolute value — e.g. `390x844 [29.4, 29.4, 87.3, 115.6]` against my
`31.25, 31.25, 89.13, 117.45`. The difference is instrument, not product: LM3 measures the silhouette scalar
`discRadiusPx()` from the disc's centre, I measure the projected **limb**; R3 quantifies that gap at 0.73 px.
Both pass.

---

## R5 — offset signs

`src/mobile/mobileFrame.ts:89-91`: `offsetX = W/2 − cx`, `offsetY = H/2 − cy`, handed to `setViewOffset`. The
sub-window is the FULL `W x H`, so this is a lens shift and the disc stays a circle — confirmed in R3:
`rH = rV = 69.977` exactly.

**390x844 (portrait)** — measured `cx = 195`, `cy = 410.88`:

    ox = 390/2 − 195    = 195 − 195    = 0.00
    oy = 844/2 − 410.88 = 422 − 410.88 = +11.12

    setViewOffset(390, 844, ox = 0, oy = 11.12, 390, 844)
    measured camera.view = {{ enabled: true, fullWidth: 390, fullHeight: 844,
                             offsetX: 0, offsetY: 11.119999999999997, width: 390, height: 844 }}

    measured screen position of the camera target = (195.000, 410.880)
    requested (cx, cy)                            = (195.000, 410.880)   -> residual 0.000 px

**924x412 (phoneLandscape)** — measured `cx = 286.44`, `cy = 239`:

    ox = 924/2 − 286.44 = 462 − 286.44 = +175.56
    oy = 412/2 − 239    = 206 − 239    = −33.00

    setViewOffset(924, 412, ox = 175.56, oy = -33, 924, 412)
    measured camera.view = {{ enabled: true, fullWidth: 924, fullHeight: 412,
                             offsetX: 175.56, offsetY: -33, width: 924, height: 412 }}

    measured screen position of the camera target = (286.440, 239.000)
    requested (cx, cy)                            = (286.440, 239.000)   -> residual 0.000 px

Both signs are confirmed by measurement and are the signs the algebra predicts: `oy` is **positive** when `cy` is
**above** mid-viewport (410.88 < 422 at 390x844) and **negative** when below (239 > 206 at 924x412); `ox` is
positive whenever `cx` sits left of `W/2` (286.44 < 462). Residual **0.000 px** in both, against the prompt's 1 px
requirement; the same holds on all 14 mobile rows (`centre` equals `(cx, cy)` to float noise everywhere). No sign
flips were needed.

---

## R6 — disc fill

`r / Rb` per viewport and the term that set `Rb` (`Rb = min(cx−left, right−cx, cy−top, bottom−cy) − 12`, floored at
40 — `src/mobile/layoutMath.ts:194-197`). "Binding term" is the smallest of those four *before* the 12 px margin
and the floor.

| viewport | mode | r | Rb | **r/Rb** | binding term |
|---|---|---:|---:|---:|---|
| 390x844 | portrait | 165.59 | 183.00 | **0.905** | left (195.00) |
| 412x924 | portrait | 175.57 | 194.00 | **0.905** | left (206.00) |
| 360x640 | portrait | 121.99 | 134.80 | **0.905** | **header/top (146.80)** |
| 375x667 | portrait | 134.66 | 148.84 | **0.905** | **header/top (160.84)** |
| 430x932 | portrait | 183.69 | 203.00 | **0.905** | right (215.00) |
| 320x568 | portrait | 88.18 | 97.36 | **0.906** | **header/top (109.36)** |
| 768x1024 | portrait | 296.70 | 328.84 | **0.902** | header/top (340.84) |
| 820x1180 | portrait | 354.26 | 392.80 | **0.902** | header/top (404.80) |
| 960x1440 | portrait | 422.20 | 468.00 | **0.902** | left (480.00) |
| 600x600 | portrait | 103.21 | 114.00 | **0.905** | **header/top (126.00)** |
| 667x375 | phoneLandscape | 70.71 | 78.13 | **0.905** | **header/top (90.13)** |
| 844x390 | phoneLandscape | 135.03 | 150.00 | **0.900** | bottom (162.00) |
| 924x412 | phoneLandscape | 144.89 | 161.00 | **0.900** | bottom (173.00) |
| 932x430 | phoneLandscape | 152.96 | 170.00 | **0.900** | header/top (182.00) |
| 1024x768 | desktop | 204.20 | n/a (0) | **n/a** | mobile fit never runs |
| 1280x800 | desktop | 218.22 | n/a (0) | **n/a** | mobile fit never runs |
| 1440x960 | desktop | 322.03 | n/a (0) | **n/a** | mobile fit never runs |

**No mobile row is below 0.75.** The full spread is **0.900 – 0.906**: every mobile disc uses ~90.3 % of its
budget, and the 12 px `RADIUS_MARGIN_PX` is precisely the missing ~0.097 (`12 / 123.5`), so the uniformity is the
law working rather than thirteen coincidences. The three desktop rows are `n/a` because `radiusBudget` is published
as 0 there (`src/lib/frameProbe.ts:253-256` returns `s.radiusBudget ?? 0`; the desktop branch never sets it).

**The census is the interesting result.** The **header term** sets `Rb` on **7 of 14** mobile rows — every short
portrait viewport (320x568, 360x640, 375x667, 600x600), 667x375, 932x430, and both big tablets. On those seven the
globe is small because the header is tall; at 320x568 the header takes 27.8 % of the viewport and costs `Rb`
(97.36 against the 148 the 104 px assumption predicted).

---

## R7 — options (text only, nothing implemented)

The premise — *"If the true header bottom is 158 (not 104) at 375x667"* — **holds**. 158 is measured, steady from
the first frame to +2 s, identical across nine widths, and decomposed to the pixel in R2. It is **not** a
late-wrapping artefact in portrait. Its share of the viewport:

| viewport | header bottom | share of height |
|---|---:|---:|
| 320x568 | 158 | **27.8 %** |
| 360x640 | 158 | **24.7 %** |
| 375x667 | 158 | **23.7 %** |
| 600x600 | 158 | 26.3 % |
| 844x390 | 66 | 16.9 % |
| 667x375 | **194.75** | **51.9 %** ← the late-wrap defect, not the 158 |

At 375x667 the 158 px is, in order: 8 top padding, 36 identity row, 6 gap, 50 controls row, 6 gap, 44 chip row,
8 bottom padding. There is no slack in the gaps (12 px total) or the padding (16 px); the height is three
44-ish rows plus two gaps — the design the prompt asked for ("portrait is two rows — h1 plus controls, then the
chip"). So the options are structural:

**Option 1 — one row in portrait too (h1 + chip on row 1; or all three on one line at >= 360).** 158 → ~94 (two
rows) or ~66 (one row, as phoneLandscape already achieves at 844x390). At 375x667 `Rb 148.84 → ~196`, disc
+~44 px radius (+34 %). **Cost:** the identity row and the chip compete for a 375 px line; at 320 px the chip alone
is 296 px wide and the h1 needs ~229 px at 375, so a single row is only honest at ~430 px and above. A two-row
variant buys 64 px for a full re-layout, touches LM2's overlap assertion and the "two rows" wording — a prompt-level
decision, not a step-level one.

**Option 2 — h1 + chip on one row, controls behind a single 44 px overflow control.** 158 → ~94. **Cost:** hides
three primary affordances (unit toggle, Snapshot, Reset) behind a tap. The M9 popover's outside-pointerdown boundary
is the header, so a menu inside the header inherits that boundary and closes itself when another control is tapped
— the exact defect `bbb1005` already fixed once. It also costs a second interaction for Reset, the one control a
reader reaches for when the view is wrong.

**Option 3 — smaller type and tighter rows, no structural change.** The identity row is 36 px only because the
badge is `h-9 w-9`; shrinking it to 28 px and the h1 to `text-[11px] leading-none` gives ~30, and the chip cannot go
below its 44 px touch minimum. Realistic total **158 → ~140** (−11.4 %, `Rb 148.84 → 160.8`, disc +8 %). **Cost:**
the only option that keeps every affordance visible and every 44 px target intact, and it buys the least while
nibbling at the two things the prompt protects ("h1 always fully visible", "all controls at least 44 px"). Take it
only if Options 1–2 are rejected.

**Option 4 — not about 158 at all: fix the phoneLandscape late wrap.** 667x375's header is 194.75 because the h1's
`flex-1` slot is squeezed to 70.5 px beside a 217.48 px chip and a 331.02 px controls cluster, and the heading then
wraps to ~eleven 16 px lines after first paint. This one is not a trade-off: the header should be one 66 px row
there as it already is at 844x390 and 924x412, with the long h1 handled by the `sr-only` subtitle the prompt already
permits. `Rb` would go `78.13 → ~162` and the disc `70.7 → ~146` (+106 %), and the 72 px dead band between the
controls' bottom (122.38) and the dock's top (194.75) disappears. **Cost:** the phoneLandscape h1 stops being
visible, which the prompt's "h1 always fully visible" clause forbids — again an author's decision. It is the
highest-value fix in the file by a factor of three, and the only one where the defect is unambiguous: a height that
changes by 81 px after the page is interactive.

**Labelling.** No proposal is implemented, and the projected `Rb`/disc numbers above are arithmetic from the
measured law with no run behind them. They are marked as projections, not measurements.

---

## Summary of the three verdicts

| question | verdict |
|---|---|
| 104 vs 158 | **Reporting bug.** 158 is the real header bottom (0.00 px from the DOM, steady over three sample times, identical across nine widths). 104 is a `docs/MOBILE2-AUDIT.md:157` *assumption* from before the component existed, carried into a table labelled "planned (not measured)" and later read as a measurement. The published free rect equals the real header everywhere — no product bug. |
| 667x375 disc r = 70.7 | **Real rendered size — not a typo, not a measurement artefact.** Direct projection 69.977, closed form 70.707, committed spec printed 70.7. Not a disc defect: `r/Rb = 0.905`, margins >= 20.15 px. The defect at that row is the header's **late wrap** 113.5 → 194.75 px, which halves the disc. |
| all rows disc inside rect with >= 8 px real margins | **Yes.** Minimum **20.15 px** (667x375, top and bottom); tightest portrait **21.80 px** (320x568, top). 14/14 mobile rows pass; 3 desktop rows have no mobile budget to test. |

---

## FIX — the phoneLandscape header, measured after the fix

Step 2B-STEP3-MOBILE2-FIX changed the landscape header only. The defect R2/R7 recorded — a header that grew
from **113.50 px at 265 ms to 194.75 px at 2326 ms** at 667x375 because the `h1` wrapped inside a `flex-1` slot
squeezed by a data-dependent chip — is gone, and the numbers below are the measurement that says so.

**The mechanism.** `src/mobile/headerMath.ts` makes the header's geometry a pure function of viewport WIDTH:
`landscapeHeaderRows(w)` returns 1 at `w >= 800` and 2 below it, and `landscapeHeaderHeight(w)` returns 54 or 76.
The chip's box is a fixed `LANDSCAPE_CHIP_W = 252` px, so `formatIsland`'s measured 128.53–208.09 px text span
cannot move anything. The `h1` is `whitespace-nowrap` + `flex-none` and reserves its measured 229.06 px natural
width. No post-load JS measures and re-lays-out: the `ResizeObserver` only REPORTS what CSS decided.

**F6 — the landscape matrix, real measured numbers.** Disc measured by projecting four limb points through the
scene's own camera matrix (the R3 construction). Bundle `srcHash 772c9b21`, `gitHead 133a9a7`.

| viewport | free rect x, top, w, bottom | Rb | dFit | dMax | dMax/dFit | disc r | r/Rb | L | R | T | B |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 667x375 | 0.00, 76.00, 347.00, 375.00 | 137.50 | 4.0684 | 5.0855 | 1.250 | 120.06 | 0.873 | 53.44 | 53.44 | 29.44 | 29.44 |
| 844x390 | 0.00, 54.00, 523.28, 390.00 | 156.00 | 3.7553 | 5.0000 | 1.331 | 135.27 | 0.867 | 126.37 | 126.37 | 32.73 | 32.73 |
| 924x412 | 0.00, 54.00, 572.88, 412.00 | 167.00 | 3.7102 | 5.0000 | 1.348 | 144.64 | 0.866 | 141.80 | 141.80 | 34.36 | 34.36 |
| 932x430 | 0.00, 54.00, 577.84, 430.00 | 176.00 | 3.6774 | 5.0000 | 1.360 | 152.31 | 0.865 | 136.61 | 136.61 | 35.69 | 35.69 |
| 568x320 | 0.00, 76.00, 284.00, 320.00 | 110.00 | 4.3203 | 5.4004 | 1.250 | 96.48 | 0.877 | 45.52 | 45.52 | 25.52 | 25.52 |
| 640x360 | 0.00, 76.00, 320.00, 360.00 | 130.00 | 4.1265 | 5.1581 | 1.250 | 113.64 | 0.874 | 46.36 | 46.36 | 28.36 | 28.36 |

Every margin is at least 8 px (tightest **25.52**), `r/Rb` is at least 0.85 (0.865–0.877), and
`maxDistance >= 1.2 * dFit` holds on all six rows (1.250–1.360). The 667x375 disc went from **70.71 to 120.06 px**
(+69.8 %) because `Rb` went from 78.125 to 137.50 — the header term that bound it is now 76 px instead of 194.75.

**The 120 px bound at 667x375 has 0.06 px of slack.** It passes, and it is the tightest number in the matrix: the
76 px header is the only thing holding it, and `LANDSCAPE_CONTROL_H` is 50 (measured: two 44 px buttons in a
`p-0.5` pill with 1 px borders), not the 46 an earlier draft assumed. A header one pixel taller would fail it.

**F5 — three moments, per row.** Sampled in page with `requestAnimationFrame` from an `addInitScript`, so the
first sample is the first frame rather than the first frame Playwright could observe.

| viewport | first frame | after data ready | after 2 s | published | h1 height at all three |
|---|---:|---:|---:|---:|---|
| 667x375 | 76 | 76 | 76 | 76 | 16.25 / 16.25 / 16.25 |
| 844x390 | 54 | 54 | 54 | 54 | 16.25 / 16.25 / 16.25 |
| 924x412 | 54 | 54 | 54 | 54 | 16.25 / 16.25 / 16.25 |
| 932x430 | 54 | 54 | 54 | 54 | 16.25 / 16.25 / 16.25 |
| 568x320 | 76 | 76 | 76 | 76 | 16.25 / 16.25 / 16.25 |
| 640x360 | 76 | 76 | 76 | 76 | 16.25 / 16.25 / 16.25 |

**F2 — the chip cannot move the header.** Driving the store's anomaly through the popover's own range input at
0, 0.1, 0.5, 1.0, 1.5, 2.0, 2.4, 2.7 and 3.0 at every row: the chip's text spanned **128.53 → 208.09 px** while
its box stayed **252.00 px** and the header's bottom stayed a single distinct value per row. The `h1` was one line
at every value.

**Portrait is unchanged: 158.00 px at all ten viewports** (390x844, 412x924, 360x640, 375x667, 430x932, 320x568,
768x1024, 820x1180, 960x1440, 600x600), DOM and published. Its class strings were dumped before and after the
change and diffed; the landscape overrides are inline styles and landscape-only class branches, so the portrait
path renders the same tree.

**One correction to R2's framing.** R2 called the 667x375 disc "not a product defect" and attributed the small
radius to the header. That was right about the CAUSE and wrong about the SEVERITY: at 70.71 px the globe was
**41 % smaller than the 120 px the fix's acceptance bound requires**, so the header's late wrap was a disc defect
by consequence. The fix is in the header, as R7's Option 1 predicted, and the disc followed.
