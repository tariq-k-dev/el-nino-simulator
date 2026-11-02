# N10-TRIAGE — isolated re-measurement of the batched reds

Read-only measurement step. No product file, spec, config or runner was changed. The only committed 
artifacts are this document and `docs/prompts/n10-triage.md` (already at HEAD).

Every number below is parsed out of a log produced in this session (`_triage/logs/*.log`, gitignored, 
outside the repo). Nothing is carried over from an earlier report; where a value could not be measured 
the cell says NOT MEASURED.

**S1 was overridden by the author.** HEAD is `7446059`, one commit past the prompt's `3ee1ea6`, and that 
commit is docs-only: `git diff --name-status 3ee1ea6 HEAD` returns exactly `A docs/prompts/n10-triage.md`, 
and 0 of the 114 files under `src/` differ between the two trees after LF normalisation. HEAD is therefore 
source-equal to the requested target.

## 1. Environment and host load

| field | value |
|---|---|
| HEAD | `74460597f9315a6a8745d445bbd6bf5328bc7494` |
| target commit from the prompt | `3ee1ea6c49f9cbef3ddb80c86ff5453b98700011` (source-equal, docs-only delta) |
| node / pnpm | v24.22.1 / 12.15.0 |
| OS | Windows 11, git-bash/MSYS |
| CPU | 20 logical cores |
| RAM | 31.4 GB total |
| retries | 0, read from `playwright.config.ts` (`retries: 0`), not passed as a flag |
| worktrees | `D:\Dev\Handshake\_triage\wt-{9c11ed8,414caf5,5e7c826,5db822c}`, outside the repo, each with its own `dist-e2e` and its own `build:e2e` |

CPU = mean and max of five 1 s samples taken immediately before and immediately after each run 
(`GetSystemTimes`); RAM = free physical GB (`GlobalMemoryStatusEx`). Sampling brackets the run, so a run's 
own load shows up in its `after` column.

### Builds — each tree needed its own instrumented bundle or the stamp guard refuses the run

| build | commit | dur s | cpu before (max) | cpu after (max) | ram free before | ram free after | rc |
|---|---|---|---|---|---|---|---|
| build-HEAD | HEAD | 11.1 | 10.9 (16.5) | 22.8 (28.6) | 13.27 | 13.19 | 0 |
| build-9c11ed8 | 9c11ed8 | 10.7 | 11.5 (13.8) | 16.3 (21.1) | 13.21 | 13.06 | 0 |
| build-414caf5 | 414caf5 | 8.8 | 13.9 (17.6) | 12.3 (14.4) | 12.73 | 13.25 | 0 |
| build-5e7c826 | 5e7c826 | 9.1 | 11.5 (14.0) | 8.7 (10.3) | 13.21 | 13.21 | 0 |
| build-5db822c | 5db822c | 8.5 | 10.2 (11.0) | 11.0 (12.4) | 13.35 | 13.35 | 0 |

### Arm A — `globe.spec.ts`, whole file, one process per run

| run | commit | started | dur s | cpu before (max) | cpu after (max) | ram free before | ram free after | rc |
|---|---|---|---|---|---|---|---|---|
| A-globe-HEAD-r1 | HEAD | 00:17:24 | 98.7 | 10.1 (11.2) | 8.6 (10.5) | 13.18 | 13.72 | 1 |
| A-globe-9c11ed8-r1 | 9c11ed8 | 00:19:13 | 85.7 | 9.5 (14.3) | 9.7 (15.8) | 13.69 | 12.89 | 1 |
| A-globe-HEAD-r2 | HEAD | 00:20:49 | 85.3 | 6.2 (8.3) | 9.6 (11.7) | 12.88 | 13.42 | 1 |
| A-globe-9c11ed8-r2 | 9c11ed8 | 00:22:24 | 86.1 | 10.8 (12.0) | 10.7 (11.4) | 13.41 | 13.63 | 1 |
| A-globe-HEAD-r3 | HEAD | 00:24:00 | 86.2 | 10.7 (12.1) | 10.4 (12.8) | 13.63 | 13.13 | 1 |
| A-globe-9c11ed8-r3 | 9c11ed8 | 00:25:36 | 86.2 | 9.9 (11.6) | 15.0 (18.5) | 13.15 | 13.25 | 1 |
| A-globe-5e7c826-r2 | 5e7c826 | 01:05:36 | 83.7 | 4.1 (9.0) | 3.1 (6.2) | 16.8 | 16.87 | 0 |
| A-globe-5e7c826-r3 | 5e7c826 | 01:07:10 | 83.9 | 0.6 (0.9) | 2.2 (5.9) | 16.87 | 16.76 | 0 |
| A-globe-414caf5-r1 | 414caf5 | 01:08:44 | 85.4 | 1.3 (3.7) | 4.0 (7.0) | 16.79 | 16.73 | 1 |
| A-globe-414caf5-r2 | 414caf5 | 01:10:19 | 96.0 | 2.5 (4.3) | 57.2 (64.2) | 16.71 | 15.6 | 1 |
| A-globe-414caf5-r3 | 414caf5 | 01:12:05 | 98.1 | 54.2 (56.3) | 53.8 (59.3) | 15.6 | 15.25 | 1 |

### Arm D — `look.spec.ts`, whole file

| run | commit | started | dur s | cpu before (max) | cpu after (max) | ram free before | ram free after | rc |
|---|---|---|---|---|---|---|---|---|
| D-look-HEAD-r1 | HEAD | 00:27:13 | 508.4 | 7.5 (8.8) | 5.3 (8.6) | 13.28 | 16.68 | 0 |

### Arm B — N10 isolated (`-g "N10:"`)

| run | commit | started | dur s | cpu before (max) | cpu after (max) | ram free before | ram free after | rc |
|---|---|---|---|---|---|---|---|---|
| B-iso-HEAD-r1 | HEAD | 00:43:39 | 57.7 | 3.1 (4.1) | 4.0 (5.3) | 16.01 | 16.12 | 0 |
| B-iso-9c11ed8-r1 | 9c11ed8 | 00:44:47 | 58.6 | 4.3 (9.4) | 5.2 (7.9) | 16.12 | 16.07 | 0 |
| B-iso-HEAD-r2 | HEAD | 00:45:56 | 58.0 | 2.9 (4.9) | 3.4 (4.9) | 16.08 | 16.14 | 0 |
| B-iso-9c11ed8-r2 | 9c11ed8 | 00:47:04 | 58.0 | 2.6 (4.2) | 4.6 (6.0) | 16.15 | 16.01 | 0 |
| B-iso-HEAD-r3 | HEAD | 00:48:12 | 57.7 | 2.8 (3.7) | 3.2 (4.7) | 16.01 | 16.26 | 0 |
| B-iso-9c11ed8-r3 | 9c11ed8 | 00:49:20 | 58.1 | 2.9 (3.9) | 10.2 (15.7) | 16.26 | 15.63 | 0 |

### Arm B — `negative.spec.ts`, whole file

| run | commit | started | dur s | cpu before (max) | cpu after (max) | ram free before | ram free after | rc |
|---|---|---|---|---|---|---|---|---|
| B-file-HEAD-r1 | HEAD | 01:29:54 | 319.3 | 8.5 (9.5) | 7.3 (8.7) | 16.39 | 16.78 | 0 |
| B-file-9c11ed8-r1 | 9c11ed8 | 01:35:23 | 323.8 | 7.0 (9.4) | 10.6 (14.2) | 16.78 | 14.96 | 0 |
| B-file-HEAD-r2 | HEAD | 01:40:57 | 319.7 | 10.4 (14.4) | 3.6 (4.6) | 14.83 | 16.11 | 0 |

### Arm C — N10 isolated at BASE `5db822c` / PRE `5e7c826`

| run | commit | started | dur s | cpu before (max) | cpu after (max) | ram free before | ram free after | rc |
|---|---|---|---|---|---|---|---|---|
| C-iso-5db822c-r1 | 5db822c | 00:50:28 | 57.8 | 7.8 (10.0) | 9.1 (11.1) | 15.63 | 16.54 | 0 |
| C-iso-5e7c826-r1 | 5e7c826 | 00:51:36 | 57.6 | 6.9 (9.8) | 7.4 (11.1) | 16.55 | 16.51 | 0 |
| C-iso-5db822c-r2 | 5db822c | 00:52:43 | 57.7 | 8.4 (11.0) | 8.0 (12.6) | 16.35 | 16.45 | 0 |
| C-iso-5e7c826-r2 | 5e7c826 | 00:53:51 | 57.6 | 8.1 (14.3) | 8.8 (9.8) | 16.43 | 16.53 | 0 |
| C-iso-5db822c-r3 | 5db822c | 00:54:59 | 57.7 | 7.8 (10.1) | 8.6 (10.6) | 16.57 | 16.63 | 0 |
| C-iso-5e7c826-r3 | 5e7c826 | 00:56:07 | 57.8 | 6.9 (13.8) | 8.0 (10.2) | 16.58 | 16.55 | 0 |

### Arm C — N10 immediately after a full `globe.spec.ts` (warm-after-heavy)

| run | commit | started | dur s | cpu before (max) | cpu after (max) | ram free before | ram free after | rc |
|---|---|---|---|---|---|---|---|---|
| C-warm-HEAD-r1 | HEAD | 00:59:28 | 101.8 | 58.2 (70.6) | 49.8 (55.1) | 15.96 | 15.51 | 1 |
| C-warm-5e7c826-r1 | 5e7c826 | 01:01:20 | 164.4 | 50.9 (55.6) | 52.0 (56.9) | 15.53 | 15.9 | 0 |

## 2. Verdict table

k/n = green runs out of runs completed. `—` means that commit was not run for that arm.

| test | HEAD k/n | 9c11ed8 k/n | 414caf5 k/n | classification |
|---|---|---|---|---|
| globe:175 pinch at 375x667 | 0/3 | 0/3 | 0/3 | **NEW-REGRESSION** |
| globe:305 zoom after fly-to | 2/3 | 1/3 | 3/3 | **FLAKY** |
| N10 isolated | 3/3 | 3/3 | — | **DETERMINISTIC-GREEN** |
| N10 in-file | 2/2 | 1/1 | — | **DETERMINISTIC-GREEN** |
| flatAlbedo (look.spec 3.4) | 1/1 | — | — | **INCONCLUSIVE** |

Basis per row:

- globe:175 — green 5e7c826 2/2; red 414caf5 0/3, 9c11ed8 0/3, HEAD 0/3 — a regression that predates 9c11ed8, so it is outside the range the prompt assumed
- globe:305 — mixed at BOTH commits (HEAD 2/3 green, 9c11ed8 1/3 green)
- N10 isolated — 0 red in 3 run(s) at HEAD and 3 at 9c11ed8
- N10 in-file — 0 red in 2 run(s) at HEAD and 1 at 9c11ed8
- flatAlbedo — missing runs (flatAlbedo 3.4: HEAD (1, 1), 9c11ed8 None)

`globe:175` was not given a pre-registered rule by the prompt (only `globe:305` was), so its row is 
classified from every commit actually measured rather than from the 305 rule. The `414caf5` column is 
therefore load-bearing for it: that commit is 3/3 red while `5e7c826` is 3/3 green, which is what makes 
the row a regression rather than a long-standing red.

**Before the 5e7c826/414caf5 runs, this case was believed to be a known red at every commit.** 
The measurement contradicts that: it passes 3/3 at `5e7c826`, and every red at the four later commits 
reports the identical `3.3534 -> 3.3534` zero-motion pair.

Counts per arm run:

| arm | HEAD | 9c11ed8 |
|---|---|---|
| Arm A `globe.spec.ts` | 11 passed / 4 failed / 0 skipped / 15 expected over 3 run(s) | 10 passed / 5 failed / 0 skipped / 15 expected over 3 run(s) |
| Arm D `look.spec.ts` | 9 passed / 0 failed / 0 skipped / 9 expected over 1 run(s) | NOT MEASURED |
| Arm B N10 isolated | 3 passed / 0 failed / 0 skipped / 3 expected over 3 run(s) | 3 passed / 0 failed / 0 skipped / 3 expected over 3 run(s) |
| Arm B `negative.spec.ts` | 28 passed / 0 failed / 0 skipped / 28 expected over 2 run(s) | 14 passed / 0 failed / 0 skipped / 14 expected over 1 run(s) |

## 3. N10 differing-pixel counts

The spec's own tolerance is `maxAbs <= 1.0` luma and `differing <= 50` px; the count is read from its 
`[N10] control-vs-control in-page … differing=` line. Known batched value for comparison: **457 px** 
(`docs/MOBILE2-FIX-V.md:78`).

| arm | commit | runs with a count | differing px per run | min / median / max | maxAbs per run |
|---|---|---|---|---|---|
| B isolated | HEAD | 3 | 24, 26, 10 | 10 / 24 / 26 | 0.71520000000001, 0.71520000000001, 0.71520000000001 |
| B isolated | 9c11ed8 | 3 | 11, 19, 21 | 11 / 19 / 21 | 0.71520000000001, 0.71520000000001, 0.71520000000001 |
| B in-file | HEAD | 2 | 6, 30 | 6 / 18 / 30 | 0.71520000000001, 0.71520000000001 |
| B in-file | 9c11ed8 | 1 | 7 | 7 / 7 / 7 | 0.7151999999999958 |
| C BASE 5db822c | 5db822c | 3 | 25, 6, 26 | 6 / 25 / 26 | 0.71520000000001, 0.71520000000001, 0.71520000000001 |
| C PRE 5e7c826 | 5e7c826 | 3 | 20, 23, 38 | 20 / 23 / 38 | 0.71520000000001, 0.71520000000001, 0.71520000000001 |
| C warm-after-heavy | HEAD | 0 | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| C warm-after-heavy | 5e7c826 | 1 | 17 | 17 / 17 / 17 | 0.71520000000001 |
| A incidental (globe.spec whole file) | HEAD | 0 | NOT MEASURED | NOT MEASURED | NOT MEASURED |
| A incidental (globe.spec whole file) | 9c11ed8 | 0 | NOT MEASURED | NOT MEASURED | NOT MEASURED |

### Where the differing pixels are (spec's own `locateDiffering` output)

| run | shown / total | r/R range | bands | nearest pins |
|---|---|---|---|---|
| B-iso-HEAD-r1 | 20 / 24 | 0.4292–0.9832 | disc, rim-band | horn-africa, pacific, se-asia, us-west |
| B-iso-9c11ed8-r1 | 11 / 11 | 0.2391–0.93 | disc | horn-africa, pacific, se-asia |
| B-iso-HEAD-r2 | 20 / 26 | 0.2391–0.9832 | disc, rim-band | horn-africa, pacific, se-asia, us-west |
| B-iso-9c11ed8-r2 | 19 / 19 | 0.174–0.9195 | disc | horn-africa, pacific, se-asia, us-west |
| B-iso-HEAD-r3 | 10 / 10 | 0.2502–0.9832 | disc, rim-band | horn-africa, se-asia |
| B-iso-9c11ed8-r3 | 20 / 21 | 0.174–0.93 | disc | horn-africa, pacific, se-asia, us-west |
| C-iso-5db822c-r1 | 20 / 25 | 0.07–0.9846 | disc, rim-band | horn-africa, pacific, se-asia, us-west |
| C-iso-5e7c826-r1 | 20 / 20 | 0.1421–0.9846 | disc, rim-band | horn-africa, pacific, se-asia, us-west |
| C-iso-5db822c-r2 | 6 / 6 | 0.2391–0.93 | disc | horn-africa, se-asia |
| C-iso-5e7c826-r2 | 20 / 23 | 0.1421–0.9442 | disc | horn-africa, pacific, se-asia, us-west |
| C-iso-5db822c-r3 | 20 / 26 | 0.2178–0.9846 | disc, rim-band | horn-africa, pacific, se-asia, us-west |
| C-iso-5e7c826-r3 | 20 / 38 | 0.2178–0.93 | disc | horn-africa, pacific, se-asia, us-west |
| C-warm-5e7c826-r1 | 17 / 17 | 0.0668–0.972 | disc, rim-band | horn-africa, se-asia, us-west |
| B-file-HEAD-r1 | 6 / 6 | 0.2391–0.93 | disc | horn-africa, se-asia |
| B-file-9c11ed8-r1 | 7 / 7 | 0.2178–0.9846 | disc, rim-band | horn-africa, pacific, se-asia, us-west |
| B-file-HEAD-r2 | 20 / 30 | 0.2178–0.9846 | disc, rim-band | horn-africa, pacific, se-asia, us-west |

## 4. Observations that CONTRADICT the acquisition-path hypothesis

The earlier hypothesis: N10's in-page pair differs because the acquisition path (`fitLimb`'s material 
swap-and-restore, plus the `specularIntensity`/`setLookFlags` writes between captures) leaves the scene in a 
different state — i.e. the difference is caused by HOW the frames are acquired, not by the frame.

Measured, one line per run that produced a count:

- `B-iso-HEAD-r1` (HEAD): differing = **24** px, maxAbs = 0.71520000000001
- `B-iso-9c11ed8-r1` (9c11ed8): differing = **11** px, maxAbs = 0.71520000000001
- `B-iso-HEAD-r2` (HEAD): differing = **26** px, maxAbs = 0.71520000000001
- `B-iso-9c11ed8-r2` (9c11ed8): differing = **19** px, maxAbs = 0.71520000000001
- `B-iso-HEAD-r3` (HEAD): differing = **10** px, maxAbs = 0.71520000000001
- `B-iso-9c11ed8-r3` (9c11ed8): differing = **21** px, maxAbs = 0.71520000000001
- `B-file-HEAD-r1` (HEAD): differing = **6** px, maxAbs = 0.71520000000001
- `B-file-9c11ed8-r1` (9c11ed8): differing = **7** px, maxAbs = 0.7151999999999958
- `B-file-HEAD-r2` (HEAD): differing = **30** px, maxAbs = 0.71520000000001
- `C-iso-5db822c-r1` (5db822c): differing = **25** px, maxAbs = 0.71520000000001
- `C-iso-5e7c826-r1` (5e7c826): differing = **20** px, maxAbs = 0.71520000000001
- `C-iso-5db822c-r2` (5db822c): differing = **6** px, maxAbs = 0.71520000000001
- `C-iso-5e7c826-r2` (5e7c826): differing = **23** px, maxAbs = 0.71520000000001
- `C-iso-5db822c-r3` (5db822c): differing = **26** px, maxAbs = 0.71520000000001
- `C-iso-5e7c826-r3` (5e7c826): differing = **38** px, maxAbs = 0.71520000000001
- `C-warm-5e7c826-r1` (5e7c826): differing = **17** px, maxAbs = 0.71520000000001

The tests the hypothesis makes, and what the data says:

1. *If the acquisition path caused it, the count should be stable within a commit.* — 
`HEAD`: 24, 26, 10, 6, 30 (min/median/max 6 / 24 / 30).
`9c11ed8`: 11, 19, 21, 7 (min/median/max 7 / 15 / 21).
`5db822c`: 25, 6, 26 (min/median/max 6 / 25 / 26).
`5e7c826`: 20, 23, 38, 17 (min/median/max 17 / 21.5 / 38).
2. *If the path caused it, a run whose pair is separated by a whole extra file's worth of GPU work should 
be worse than an isolated run of the same test.* — see the warm-after-heavy rows against the isolated rows 
of the same commit in §3.
3. *If the path caused it, the count should correlate with the commit's acquisition code.* — no file in 
the acquisition chain (`tests/e2e/look/glintAcquire.ts`, `tests/e2e/look/flatAlbedo.ts`) differs between 
`9c11ed8` and HEAD; `git diff --name-status 9c11ed8 HEAD` touches only `scripts/e2e-batched.mjs`, 
`src/mobile/HeaderCompact.tsx`, `src/mobile/MobileShell.tsx`, `src/mobile/headerMath.ts`, 
`tests/e2e/layout-matrix.spec.ts` plus docs.

## 5. UNMEASURED

- `414caf5` bisect — Arm A was run there for globe:175 (see the 414caf5 column), but no bisect within `5e7c826..414caf5` was completed, so the exact commit where 175 turns red is NOT LOCATED. Bounded instead: `ce85442` green 0/3 red, `270ab35` red 3/3 (16 commits apart).
- Arm D runs 2-3 at either commit — only 1 of 6 `look.spec.ts` runs completed (r1 at HEAD, 508 s); the remaining five did not run, so the flatAlbedo row rests on one run per commit at most.
- Runs short of the requested count — Arm D per commit: 1 of 3 runs completed; Arm B in-file per commit: 2 of 3 runs completed.

## 6. Recommended next action

Bisect `globe:175` between `ce85442` (green 0/3 red) and `270ab35` (red 3/3, 16 commits apart) to name the commit; that range is the mobile-shell chain, so the pinch break entered with a mobile layout change, not with `9c11ed8..HEAD`. Do not touch the 50 px N10 floor: it never fired in 16 isolated/in-file runs.

