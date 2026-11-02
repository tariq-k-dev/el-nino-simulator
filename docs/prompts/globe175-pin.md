# Prompt GLOBE175-PIN v1 (plain text; save as docs/prompts/globe175-pin.md; sentinel END OF PROMPT GLOBE175-PIN)

ROLE AND SCOPE
You are Hermes in D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (the ONLY repo). This is a READ-ONLY measurement step. Do not edit any source file, spec, config or runner. globe.spec is a locked spec: do not touch it. The only files you may create in the repo are docs/GLOBE175-PIN.md and docs/prompts/globe175-pin.md. Stage by explicit path only; never git add -A; never tsc -p. Running out of budget is NOT a STOP: record the arm as UNMEASURED and continue with the next arm.

STOP CONDITIONS (only these)
S1. git status not clean at start, or HEAD is not 89cb5e8.
S2. An e2e port is occupied and cannot be freed.
S3. The 16-commit range cannot be listed.
On STOP print the reason and the exact output of the failing command.

HARNESS RULES (the last step lost 9 launches to these)
H1. Never chain commands with && or ; inside a single tool call. One simple command per call. If you need a sequence, write a .mjs driver script under D:\Dev\Handshake\_triage (outside the repo) and run it with node. The gate is run as four separate calls: pnpm tsc -b, then pnpm lint, then pnpm test, then pnpm build.
H2. Do not use npx cross-env; set environment variables inside the driver script via the child process env option.
H3. If the tool rejects a launch, change the launch method (driver script) once; if it still fails, mark the arm UNMEASURED with the exact error. Never retry the same rejected command.
H4. If a worktree install reports a corrupt package (the earlier @typescript-eslint/eslint-plugin missing dist/index.js case), repair only inside that worktree and report it.
H5. Before and after every e2e run record CPU utilisation (1 s samples over 5 s) and free RAM, or write NOT MEASURED.

STEP 1: READ ONLY, NO RUNS
1a. Print the globe.spec test at line 175 verbatim: how the pinch is synthesised (CDP Input.dispatchTouchEvent, pointer events, or other), the touch coordinates and their relation to the viewport, the pinch direction (spread or contract), the expected sign and threshold of the distance change.
1b. Print the camera controller code that handles pinch and zoom (file and function names, line numbers), the touch-action CSS applied to the canvas and to its ancestors, and the dMin, dMax and d_fit computation.
1c. List git log --oneline --stat for 5e7c826..270ab35 and mark which commits touch camera, controls, pointer or touch handling, layout, isMobileMode, or the canvas wrapper. Say whether MOBILE1 (f7a8332) is inside the range.

STEP 2: VERIFY THE BOUNDS BEFORE TRUSTING THEM
The bound ce85442..270ab35 came from a partial run. In worktrees outside the repo, run the single test (grep on the pinch test) 3 times at ce85442 and 3 times at 270ab35. Expected: ce85442 3/3 green, 270ab35 0/3 red with the zero-motion signature. If either expectation fails, widen to 5e7c826..414caf5 and say so.

STEP 3: BISECT
Pre-registered rule: GOOD = 3/3 green; BAD = 0/3 red with the zero-motion signature; anything else = MIXED. On MIXED stop the automatic bisect, report the commit and the three raw outcomes, and continue with Step 4 using the nearest GOOD and BAD. A commit that does not build or run is SKIP-UNBUILDABLE; test its neighbour instead. Use one driver script in _triage that checks out each candidate in a single detached worktree (reinstall only if pnpm-lock.yaml differs). Expect about 4 to 5 steps. Output a table: commit, subject, GOOD, BAD or MIXED, raw outcomes, load telemetry.

STEP 4: MECHANISM AT THE FIRST-BAD COMMIT AND ITS PARENT
Using a throwaway Playwright script outside the repo, at 375x667 with touch enabled, at both commits and at HEAD, print:

- d before and after the pinch, dMin, dMax, d_fit, and whether d sits at a clamp.
- document.elementFromPoint at each of the two touch start points (tag, class, pointer-events, touch-action).
- whether the controller received any pointer or touch events (count them via an injected listener in the page, not a repo edit).
  Then give a verdict by this pre-registered rule, choosing exactly one:
  M1 GESTURE NOT DELIVERED: events never reach the canvas or controller.
  M2 CLAMP: events delivered but d already at dMin or dMax in the pinch direction.
  M3 COORDINATES: the test touch points land on an element other than the canvas (header, sheet, overlay).
  M4 INTENDED CHANGE: a commit message or docs/prompts file states pinch was moved, disabled or replaced (quote it).
  M5 UNDETERMINED: say what is missing.
  Print the diff of only the files that explain the mechanism (import chain from the globe test target to the changed file; show the path).

STEP 5: PRODUCT REALITY CHECK (independent of the spec)
At HEAD, with hasTouch and isMobile true, at 375x667 and 390x844: dispatch a real two-finger spread and a real two-finger contract over the globe centre via CDP Input.dispatchTouchEvent, 3 times each, and print d before and after. Repeat at 5e7c826 as control. Also print wheel zoom at 1440x900 and at 375x667 at HEAD. Product verdict, exactly one: PINCH WORKS IN PRODUCT (spec issue only), PINCH BROKEN IN PRODUCT, PINCH BROKEN ONLY WITH THE SPEC DRIVER, or UNMEASURED.

STEP 6 (lower priority; do last): globe:305 link
Read only: do the pinch path and the zoom-after-fly-to path share a code path or clamp (name functions and lines)? Then run globe:305 alone 5 times at HEAD recording the signed distance delta each time. No conclusions beyond what is printed.

REPORT
Write docs/GLOBE175-PIN.md with: environment and load table, Step 1 excerpts, Step 2 bound check, Step 3 bisect table, Step 4 mechanism verdict and diff, Step 5 product verdict table, Step 6 results, UNMEASURED list, and a proposed fix design of at most 10 lines (NOT implemented). State explicitly whether the fix would require editing the locked globe.spec (which needs a pre-registered waiver) or only source. Commit only docs/GLOBE175-PIN.md and docs/prompts/globe175-pin.md with explicit paths. Remove all worktrees (git worktree remove --force, then git worktree prune), confirm git status is clean, then run the four gate commands as four separate calls and print the tails.

FINAL REPLY FORMAT (short, plain text)
Commit hash; first-bad commit and subject; mechanism verdict M1 to M5; product verdict; the Step 5 numbers; globe:305 link in one line; UNMEASURED list; passed/failed/skipped/expected counts per arm; gate result.

END OF PROMPT GLOBE175-PIN
