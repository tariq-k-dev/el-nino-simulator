# Prompt GLOBE175-WAIVER v1 (plain text; save as docs/prompts/globe175-waiver.md; sentinel END OF PROMPT GLOBE175-WAIVER)

ROLE AND SCOPE
You are Hermes in D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (the ONLY repo). This step is DESIGN AND SCRATCH VALIDATION ONLY. Do not edit any spec or source file in the repo. globe.spec stays locked. The only files you may create in the repo are docs/WAIVER-GLOBE175.md and docs/prompts/globe175-waiver.md. All spec and source edits for validation happen ONLY in a scratch worktree at D:\Dev\Handshake_triage\wt-waiver and are never committed. Stage by explicit path; never git add -A; never tsc -p. Running out of budget is NOT a STOP: mark the arm UNMEASURED and continue.

STOP CONDITIONS (only these)
S1. git status not clean at start, or HEAD not d5e4ea4.
S2. An e2e port is occupied and cannot be freed.
On STOP print the reason and the exact output of the failing command.

HARNESS RULES (carry over)
One simple command per tool call; never chain with && or ;. Use a node .mjs driver under D:\Dev\Handshake_triage for sequences. No npx cross-env; set env in the driver. If a launch is rejected, change the launch method once, then mark UNMEASURED; never retry the same rejected command. Record CPU and free RAM before and after every e2e run, or write NOT MEASURED. Repair a corrupt pnpm package only inside the scratch worktree and report it.

STEP 1: FACTS (read only, then two small measurements)
1a. Print verbatim the globe.spec pinch test (the one at line 175) and every helper it calls, including the manual fallback after synthesizePinchGesture yields no touchmove. Print the viewport, the literal or computed touch points, and the assertion with its threshold.
1b. Print the Step 1 excerpt and the proposed fix design from docs/GLOBE175-PIN.md.
1c. State how the fallback delivers touches (page.touchscreen, page.mouse, CDP Input.dispatchTouchEvent, or dispatchEvent on a node) and why that route went from GREEN at 90b7932 to RED at f5b9a48. Measure it: at 90b7932 and at f5b9a48 print document.elementFromPoint at each of the spec's actual touch points (tag, class, id, pointer-events, touch-action) and whether the element is the canvas or inside its wrapper. If the fallback dispatches directly on the canvas element so that layout cannot matter, say so and explain the discrepancy rather than guessing.
1d. At 90b7932 and at HEAD print the rect of the rendered globe disc (projected centre and radius in CSS px) and the starting distance d, minDistance, maxDistance.

STEP 2: WAIVER DESIGN (write docs/WAIVER-GLOBE175.md)
The amended pinch test MUST satisfy all of these invariants. List each with how the diff satisfies it:
I1. It still fails when pinch is broken (proved by mutation in Step 3).
I2. It still asserts a signed distance change in the gestured direction with a threshold equal to or stricter than today. No tolerance widening, no test.skip, no test.fixme, no retries, no try/catch that converts a failure to a pass.
I3. Touch points are derived at run time from the rendered globe (projected globe centre, or the canvas rect intersected with the free rect, using an existing validated test-hook channel only; do not add hooks to source). Before dispatching, assert that document.elementFromPoint at BOTH touch points is the canvas or inside its wrapper, with a descriptive failure message that names the occluding element. A failed hit-test must fail the test, never skip it.
I4. Clamp awareness: before pinching, assert d is strictly inside (minDistance, maxDistance) and, if the start is at or too near a clamp in the gestured direction, first move d to mid-range by wheel and assert it; zero motion at a clamp must be impossible to confuse with a broken gesture.
I5. Same test name, same file, same 375x667 viewport, so history stays comparable. Add 390x844 only as a second, separate test if cheap; otherwise leave it out.
I6. No source change. If the fix needs a source change, STOP the design there and write that finding instead.
Include in the doc: the exact proposed unified diff of globe.spec (text only, not applied to the repo), the pre-registered acceptance matrix of Step 3, and a note that Tariq's DevTools Shift+drag at 375x667 only rotated the globe, consistent with the observation that synthesizePinchGesture yields 0 touchmove (tooling limit, not a product verdict). Add a release-blocker line: a real-phone two-finger pinch check by Tariq is still required before deploy.

STEP 3: SCRATCH VALIDATION (worktree wt-waiver, spec diff applied there only)
Acceptance matrix, pre-registered; run the amended pinch test alone, 3 runs each:
a) HEAD: must be 3/3 green.
b) 90b7932: must be 3/3 green.
c) f5b9a48: must be 3/3 green (proves layout robustness across the commit that broke the old test).
d) Mutation MA at HEAD: make the controller ignore two-pointer gestures (scratch edit). Must be 3/3 RED with the zoom assertion.
e) Mutation MB at HEAD: set pointer-events none on the canvas wrapper. Must be 3/3 RED with the elementFromPoint assertion message, not the zoom assertion.
f) Whole amended globe.spec once at HEAD: report every test result; only globe:305 may differ from green and it must be recorded as before.
Any cell that misses its expectation is a FAIL of the design: do not patch the design silently; record the cell, the raw output, and a revised diff if one is obvious, then re-run only the affected cells and report both versions.

REPORT AND COMMIT
Commit only docs/WAIVER-GLOBE175.md and docs/prompts/globe175-waiver.md with explicit paths. Remove the scratch worktree (git worktree remove --force, then git worktree prune), confirm git status clean, then run the four gate commands as four separate calls and print the tails. STOP after the commit. Do NOT apply the spec diff to the repo; Tariq clears that in the next prompt.

FINAL REPLY FORMAT (short, plain text)
Commit hash; the answer to 1c in three lines; the 1d numbers; I1 to I6 each PASS or FAIL; the exact proposed diff; the acceptance matrix with k/n per cell and expected vs actual; UNMEASURED list; counts (expected/passed/failed/skipped) per arm; gate result.

END OF PROMPT GLOBE175-WAIVER
