# MOBILE2-FIX-V — read-only verification of the MOBILE2-FIX reporting

Sentinel: `END OF PROMPT 2B-STEP3-MOBILE2-FIX-V`

Repo: `D:\Dev\Handshake\Build-an-Interactive-Data-Visualization`
Branch: `main`

| item | value |
|---|---|
| HEAD on arrival | `6fd9ce9 docs: add MOBILE2-FIX-V verification prompt` |
| Prompt's stated close | `414caf5` |
| Source delta `414caf5..HEAD` | `A docs/prompts/step3-mobile2-fix-v.md` — the P0 prompt only, **no source, test or config change** |
| P0 | Already present at HEAD. Not re-committed — a duplicate P0 moves HEAD and inflates the ledger this document counts. Blob-vs-attachment diff is wrapper-only (the attachment lacks the trailing newline; the guardrail block and CRLF were transport). |
| `git add -A` used | never — this document is committed alone by explicit path |

Every number below was produced by a run in this session. Anything not measured is labelled NOT MEASURED with the reason.

---

## V1 — Count reconciliation

Source of truth: `.cache/e2e-archive/2026-11-02T05-09-41-895Z-batched-summary.json` (archived, untouched by later runs) and its run log `.cache/mob2f/full.log`. `totalMs = 2 791 847` → **46.5 min**. `exitCode: 1`.

| # | file | listed | expected | passed | failed | skipped | flaky | runner verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | boot.spec.ts | 10 | 10 | 10 | 0 | 0 | 0 | passed |
| 2 | camera-golden.spec.ts | 9 | 9 | 9 | 0 | 0 | 0 | passed |
| 3 | determinism.spec.ts | 2 | 2 | 2 | 0 | 0 | 0 | passed |
| 4 | focus-ux.spec.ts | 22 | 22 | 22 | 0 | 0 | 0 | passed |
| 5 | frame-director.spec.ts | 5 | 5 | 5 | 0 | 0 | 0 | passed |
| 6 | frame.spec.ts | 20 | 20 | 20 | 0 | 0 | 0 | passed |
| 7 | gate-clock.spec.ts | 1 | 1 | 1 | 0 | 0 | 0 | passed |
| 8 | globe.spec.ts | 5 | 5 | 3 | **2** | 0 | 0 | **failed** |
| 9 | harden.spec.ts | 8 | 8 | 8 | 0 | 0 | 0 | passed |
| 10 | history-gate.spec.ts | 1 | 1 | 1 | 0 | 0 | 0 | passed |
| 11 | layout-matrix.spec.ts | 11 | 11 | 11 | 0 | 0 | 0 | passed |
| 12 | limb.spec.ts | 2 | 2 | 2 | 0 | 0 | 0 | passed |
| 13 | look.spec.ts | 9 | 9 | 9 | 0 | 0 | 0 | passed |
| 14 | mobile-sheet.spec.ts | 15 | 15 | 15 | 0 | 0 | 0 | passed |
| 15 | negative.spec.ts | 14 | 14 | 13 | **1** | 0 | 0 | **failed** |
| 16 | pin-click.spec.ts | 7 | 7 | 6 | **1** | 0 | 0 | **failed** |
| 17 | ref.spec.ts | 2 | 2 | 2 | 0 | 0 | 0 | passed |
| 18 | reset-ux.spec.ts | 11 | 11 | 11 | 0 | 0 | 0 | passed |
| 19 | scene-gate.spec.ts | 2 | 2 | 2 | 0 | 0 | 0 | passed |
| 20 | switcher-ux.spec.ts | 8 | 8 | 6 | **2** | 0 | 0 | **failed** |
| | **totals** | **164** | **164** | **158** | **6** | **0** | **0** | **16/20 files, exit 1** |

"listed" is the per-test count derivable from the log's `ok N` / `x N` lines; the archive does not carry a separate `testsListed` field, so for the 16 green files the listed count equals `testsPassed`. `skipped` came back `null` in every row — written as 0. `flaky` is 0 everywhere: `retries: 0` on all rows and `retriedFiles: []`, so no test was retried and no pass was a retry.

### What `164/164` means

It is **tests accounted for**, not tests passed. `buildSummary` (`scripts/lib/e2e-batch-core.mjs:327`) computes

```
actualTotal = Σ (testsPassed + testsFailed + testsSkipped) = 158 + 6 + 0 = 164
```

and compares it to `expectedTotal = 164`, giving `mismatch: false`. The line printed at the end of the run is

```
16/20 files passed, no retries — 164/164 tests — total 46.5 min
```

so the two figures on that one line are a **file** count (16 of 20) and a **test-inventory** count (164 accounted for of 164 expected). Neither is a pass count.

### Why the previous message said "164 passed and 0 failed"

That message read the first figure of each pair — `16/20 files passed` and `164/164 tests` — and reported the tests as passing. The archive contradicts it on its own face: `"failed": 4` at file level, `"exitCode": 1`, and four files carrying non-zero `testsFailed`. A run cannot exit 1 with zero failures; the arithmetic in the same object sums 158 + 6 = 164.

**True counts: 158 passed, 6 failed, 0 skipped, 0 flaky, 0 retried.**

### The six failing tests

| # | id | first error line |
|---|---|---|
| 1 | `globe.spec.ts:175` — globe zoom › pinch at 375x667 changes the distance | `pinch did not change the distance (3.3534 -> 3.3534). touch-action on the canvas must be none, or the browser eats the gesture.` |
| 2 | `globe.spec.ts:305` — globe zoom › zoom still works after a region fly-to | `wheel was ignored after a region fly-to (3.3668 -> 3.3701). The fly-to must not leave a per-frame distance writer running.` |
| 3 | `negative.spec.ts:579` — N10: the glint sentinel FAILS when si 1.0 and the roughness floor are restored | `the in-page control pair has too many differing pixels: 457 (allowed <= 50)` |
| 4 | `pin-click.spec.ts:963` — D4 (i) a front pin clicked with the drawer open retargets and keeps it open | `Expected: "focused" / Received: "focusing"` (`after.focus`) |
| 5 | `switcher-ux.spec.ts:364` — S2 active chip is a no-op: no new flight at **1440x900** | `positive control: the sampler must SEE a real retarget, or the no-op case below proves nothing` — `maxDirMove` 0, expected > 1 |
| 6 | `switcher-ux.spec.ts:364` — S2 active chip is a no-op: no new flight at **1280x720** | same as #5 |

---

## V2 — Runner change

`git diff 9c11ed8 HEAD -- scripts/e2e-batched.mjs` (complete; one hunk, three lines, introduced by `b70f5f3`):

```diff
diff --git a/scripts/e2e-batched.mjs b/scripts/e2e-batched.mjs
index 100ad65..e3ba8f1 100644
--- a/scripts/e2e-batched.mjs
+++ b/scripts/e2e-batched.mjs
@@ -699,7 +699,8 @@ function expectedCounts() {
     // M6, M7, M8, M9 x2, M10 = 15. Counted from `playwright --list`, not by hand.
     'mobile-sheet.spec.ts': 15,
     // Step MOBILE2 E: LM1-LM9 plus the sheet-typography case = 10. Counted from `playwright --list`.
-    'layout-matrix.spec.ts': 10,
+    // Step MOBILE2-FIX: + LM10, the F5 three-moment stability case = 11.
+    'layout-matrix.spec.ts': 11,
   };
```

What each changed line does:

- `-  'layout-matrix.spec.ts': 10,` — removes the pre-FIX inventory figure, which was correct when the file had ten cases.
- `+  // Step MOBILE2-FIX: + LM10, the F5 three-moment stability case = 11.` — records where 11 comes from, so the next reader can recompute it rather than trust it.
- `+  'layout-matrix.spec.ts': 11,` — raises that file's expected count by one, so the per-file guard in `buildSummary` (`scripts/lib/e2e-batch-core.mjs:338-345`) compares `testsPassed` against 11 instead of 10. Without it, a correct 11/11 run reports a spurious `count mismatch in: layout-matrix.spec.ts` and forces `exitCode: 1`.

**Could it alter how failures are counted or hidden? No.**

Reasoning: the constant feeds only `expected`, which is used in exactly two places — the per-file mismatch filter and `expectedTotal`. Failures are parsed independently by `parseCounts` (`scripts/e2e-batched.mjs:455-478`) from Playwright's own footer (`(\d+) passed`, `(\d+) failed`), and file status comes from the child's exit code (`:438`). A wrong `expected` can therefore only **add** a red (a false count mismatch), never remove one: `exitCode` is `failed === 0 && !totalMismatch && mismatches.length === 0`. The direction of this change is also the safe one — raising the number to match a test that really exists, verified twice: the batch ran `layout-matrix.spec.ts` at 11/11, and the count is asserted against `playwright --list` by `tests/e2e/suiteInventory.test.ts`.

No re-derivation of V1 without the change was needed, since the change cannot mask a failure. Had it been needed it would not have been possible after the fact, and would have been reported NOT MEASURED.

---

## V3 — switcher-ux S2

Isolated, whole file, `--retries=0`, one Playwright process per run, real console.

**At HEAD `6fd9ce9`** (bundle `srcHash 37a335a78903`, built from `414caf5`; stamp OK, so the served bundle is HEAD's source — the only delta since `414caf5` is a docs file):

| outcome | value |
|---|---|
| passed | **7** |
| failed | **1** |
| exit code | 1 |
| wall clock | 4.0 min |
| S2 @1440x900 | **FAILED** — `Error: the sampler must have collected a trace` |
| S2 @1280x720 | passed (19.3 s) |

Re-run, as the prompt requires ("If either fails, run it once more"): `--grep "S2 active chip"` at HEAD, twice.

| re-run | S2 @1440x900 | S2 @1280x720 | verdict |
|---|---|---|---|
| 1 | passed | passed | 2 passed, exit 0 |
| 2 | passed | passed | 2 passed, exit 0 |

**At `9c11ed8`**, clean worktree `.cache/wt-9c11ed8` (detached at `9c11ed8`, `node_modules` junctioned to the main tree, `pnpm build:e2e` run inside it, stamp `srcHash 647159cd20ab` built from `9c11ed8`), whole file, retries off:

| outcome | value |
|---|---|
| passed | **8** |
| failed | **0** |
| exit code | 0 |
| wall clock | 4.0 min |
| S2 @1440x900 | passed (22.9 s) |
| S2 @1280x720 | passed (19.9 s) |

**Verdict: the S2 failure is not reproducible.** It occurred once in two whole-file runs at HEAD and zero times in two targeted re-runs; the baseline is green 8/8. One occurrence in four attempts does not differ between commits in any measurable way — it is an intermittent instrument failure at HEAD and absent at the baseline on the evidence available, which is not the same as "appears only at HEAD". No commit difference is claimed.

Note the two error texts differ, which matters for attribution: the **batched** red was `positive control: ... maxDirMove 0` (a comparison against 1), while the **isolated** red was `the sampler must have collected a trace` (an empty trace). Both are the spec's positive-control instrumentation, but they are distinct failure modes of it, so the batch red and this one are not evidence of the same defect.

Artifacts: `.cache/v3v4/v3-head-switcher-1.log`, `v3-head-s2-rerun1.log`, `v3-head-s2-rerun2.log`, `v3-base-switcher-1.log`.

---

## V4 — pin-click

Isolated, whole file (7 tests), `--retries=0`, three runs per commit.

| commit | run | passed | failed | failing ids | wall clock |
|---|---|---|---|---|---|
| HEAD `6fd9ce9` | 1 | 7 | 0 | — | 9.3 min |
| HEAD `6fd9ce9` | 2 | 7 | 0 | — | — |
| HEAD `6fd9ce9` | 3 | 7 | 0 | — | — |
| `9c11ed8` (worktree) | 1 | 7 | 0 | — | 9.5 min |
| `9c11ed8` (worktree) | 2 | 7 | 0 | — | 9.7 min |
| `9c11ed8` (worktree) | 3 | 7 | 0 | — | — |

**Pass rate: 21/21 = 100 % at HEAD; 21/21 = 100 % at `9c11ed8`.**

No first-line error to quote: no run failed. The D4 red seen in the batch (`pin-click.spec.ts:963`, `after.focus` `"focusing"` vs `"focused"`) did not reproduce in six isolated runs across two commits.

**Classification.** Under the prompt's four labels, none applies strictly: it is not reproducible at both commits (0/6), not HEAD-only (0/3 at HEAD), not baseline-only (0/3 at baseline). The honest label is **not reproducible in isolation at either commit** — observed once, in the 46.5-minute batched run only, which is the batch-harness shape the project already documents (a file's reds in a long batch are frequently green in isolation). The nearest of the four categories is "intermittent at both", and it is named here rather than silently adopted.

**Bisect: not applicable.** Bisecting is conditional on a failure appearing only at HEAD; none did. It was not run, and the first bad commit cannot be named because there is no failure to attribute. For the record, the five FIX commits are `dc4a7ef`, `133a9a7`, `b70f5f3`, `0e754a5`, `414caf5` — all resolved to full hashes in the preflight.

Artifacts: `.cache/v3v4/v4-{head,base}-pin-{1,2,3}.log`.

---

## V5 — Desktop reachability

`git diff --name-only 9c11ed8..HEAD` (10 paths):

| path | kind | role |
|---|---|---|
| `src/mobile/HeaderCompact.tsx` | M | **source** — compact header |
| `src/mobile/MobileShell.tsx` | M | **source** — mobile shell |
| `src/mobile/headerMath.ts` | A | **source** — the landscape header law |
| `src/mobile/headerMath.test.ts` | A | unit test |
| `tests/e2e/layout-matrix.spec.ts` | M | spec |
| `scripts/e2e-batched.mjs` | M | runner (expected counts only, V2) |
| `docs/MOBILE2-AUDIT.md`, `docs/MOBILE2-RECON.md` | M | docs |
| `docs/prompts/step3-mobile2-fix.md`, `docs/prompts/step3-mobile2-fix-v.md` | A | prompts |

Import graph for the three source files:

```
src/App.tsx:3            import { MobileShell } from '@/mobile/MobileShell'
src/mobile/MobileShell.tsx:30    import { HeaderCompact } from '@/mobile/HeaderCompact'
src/mobile/HeaderCompact.tsx:52  import { … } from '@/mobile/headerMath'
```

A chain exists from `App.tsx` down to every changed source file. It is **not reached** in desktop mode:

- `src/App.tsx:42` — `const isMobile = isMobileMode(layout.mode);`
- `src/App.tsx:252` — `{isMobile ? (<MobileShell … />` — the shell is mounted only when that is true; it is a sibling of `#globe-canvas`, never a descendant.
- `src/mobile/layoutMath.ts:73-75` — `export function isMobileMode(mode: LayoutMode2): boolean { return mode !== 'desktop'; }`

So the mobile subtree renders only when `layout.mode !== 'desktop'`. The two specs whose cases failed run at 1440x900 and 1280x720, and in mobile mode the desktop drawer does not exist (`MobileShell.tsx` header: "The drawer, the cards and the control deck stay desktop-only; that gate is in `App.tsx`"). The same run's S5 case printed the open drawer's wrapper and panel rects at both viewports (`[S5:1440x900] open panel {"x":1038,"y":76,"width":386,"height":808}` and `[S5:1280x720] open panel {"x":878,"y":76,"width":386,"height":628}`), which is a desktop-only surface being rendered — so `mode === 'desktop'` at both.

**Verdict: no execution path from the failing code to any file changed in `9c11ed8..HEAD`.** The failing cases exercise `src/scene/globe*` (globe zoom), the look pipeline (`negative`), the desktop drawer and camera director (`pin-click`, `switcher-ux`); none of those imports a `src/mobile/*` module, and the one changed spec (`layout-matrix.spec.ts`) is not among the failing files.

Residual uncertainty, stated rather than hidden: the `data-layout-mode` attribute that `App.tsx:96` publishes was not read back from the DOM in this session; the gate is shown from the source expressions above plus the drawer-rect evidence, not from a live attribute read.

---

## V6 — Machine load during the full batched run

**NOT MEASURED.** The batched runner records no host-load telemetry — no CPU, memory, or process inventory is written to the summary or the log — and the run completed 46.5 minutes before this session began, so its machine state cannot be reconstructed after the fact.

What the record does show, and what it does not prove: three archived runs immediately before it (`00-24-56`, `00-35-36`, `00-42-13`) recorded 26, 18 and 7 test failures respectively, falling to 6 in the run under audit — a sequence consistent with a machine freeing up, and equally consistent with source changes landing in the FIX commits. Nothing in any log names an overlapping process. No claim is made either way.

---

## Final report (short)

| | |
|---|---|
| **Sentinel** | `END OF PROMPT 2B-STEP3-MOBILE2-FIX-V` |
| **HEAD** | `6fd9ce9` (P0 prompt only; source-equal to `414caf5`) |
| **V1 true counts** | 158 passed / 6 failed / 0 skipped / 0 flaky — `164/164` is tests *accounted for*, not passed |
| **V1 six failing ids** | `globe:175` pinch@375x667 · `globe:305` zoom-after-fly-to · `negative:579` N10 glint sentinel · `pin-click:963` D4(i) focus `focusing` · `switcher-ux:364` S2@1440x900 · `switcher-ux:364` S2@1280x720 |
| **V2 verdict** | 3-line diff in `expectedCounts` (`layout-matrix` 10 → 11). **Cannot alter or hide failures** — it feeds only `expected`, which can add a spurious mismatch, never suppress one |
| **V3 verdict** | S2 **not reproducible**: 1 of 2 whole-file runs at HEAD (`sampler must have collected a trace`), 0 of 2 targeted re-runs, 0 of 1 at `9c11ed8` (8/8). No commit difference claimed |
| **V4 pass rates** | HEAD 21/21 (100 %), `9c11ed8` 21/21 (100 %). No isolation failure at either commit — D4 does not reproduce; **not HEAD-only**, so no bisect (cannot be isolated because there is nothing to attribute) |
| **V5 reachability** | **No chain.** Changed source is `src/mobile/{MobileShell,HeaderCompact,headerMath}.ts*`, mounted only when `isMobileMode(mode)` i.e. `mode !== 'desktop'` (`layoutMath.ts:73-75`, `App.tsx:42,252`); the failing cases run in desktop mode where the shell is not rendered |
| **V6** | NOT MEASURED — the runner logs no host-load data |
| `git status --porcelain` | **empty** — this document is the only artifact and it was committed alone by explicit path (`git add docs/MOBILE2-FIX-V.md`), so the tree is clean at the end |

**RECOMMEND CLOSE on the reporting question, REPAIR on the suite.** The reporting inconsistency V1 asked about is real and now explained: `164/164` is an inventory match, the true tally is 158 passed and 6 failed, and no test was ever hidden by the runner change. But the six reds are not fixed — four files fail in the batch while their failing cases pass isolated, which is the harness-vs-product question the next step must separate, and it is now narrowed to two candidates (S2's positive-control sampler and D4's arrival-state poll) plus three pre-existing look/globe reds outside this step's scope.

END OF PROMPT 2B-STEP3-MOBILE2-FIX-V
