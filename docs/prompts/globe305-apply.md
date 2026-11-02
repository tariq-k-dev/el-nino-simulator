GLOBE305-APPLY (Step 1.3). Apply waiver WAIVER-GLOBE305 to tests/e2e/globe.spec.ts. Repo: D:\Dev\Handshake\Build-an-Interactive-Data-Visualization at HEAD 46cd7c4. Follow the harness rules: one simple command per tool call, never chain commands, and use node .mjs drivers under D:\Dev\Handshake\_triage for sequences. Record CPU and free RAM before and after each e2e run, or write NOT MEASURED. Do NOT commit, do NOT git add, and do NOT stop early for budget.

CONTEXT. GLOBE305-TRIAGE classified the flake at globe.spec.ts:456 ("wheel was ignored after a region fly-to") as C5 (a C2 settle drift plus a C4 fight), 10/10 on both. The spec reads its baseline and applies its wheels while the fly-to lerp tail is still running. The tail takes 1.84 to 1.90 s (tau about 0.16 s) and the spec waits only about 900 ms. During the tail the fit's distance write at CameraDirector.tsx:941 fights the wheel. Polling __frame.settled is WITHDRAWN as unsafe. It reports true with a 0.24 gap (CameraDirector.tsx:822-826) and gives false passes. The validated fix (v2, 10/10) polls __globe.distance() until it has been quiet for 200 ms, and requires the baseline to be within 0.005 of __frame.target.d before the wheel is sent. Your validated drivers are globe305-fixcheck.json and globe305-fixcheck2.json, with their drivers, in _triage. Reuse the v2 logic from those.

STEP A. Run git rev-parse HEAD (expect 46cd7c45e5ba6849aa70f827502239ad6600c7b4). Then run git status --porcelain (expect empty). If either differs, STOP and report.

STEP B. Write docs/WAIVER-GLOBE305.md. Include:
- the locked spec and the exact test title
- the classification and the measured evidence: tau 0.1586 s against 0.18, tail 1.84 to 1.90 s, E1 giving back 0.1515 after its peak, and v2 delta +0.80699 to +0.80700 with 0 drift
- the withdrawn v1 and why (the baseline was 0.78 BELOW dTarget, so it passed for the wrong reason)
- the exact scope: ONLY the one test at globe.spec.ts:456 changes, and no other test, helper, or constant in the file
- the statement that no source file changes and that the assertion's threshold and sign are unchanged

STEP C. Edit ONLY the test "wheel was ignored after a region fly-to" in tests/e2e/globe.spec.ts, as follows.
1. Replace the fixed post-Escape wait with a poll on __globe.distance(). The poll must sample at about 50 ms. It is done when the value has changed by no more than 0.0005 across a continuous 200 ms window. It has a 6000 ms timeout, and on timeout it FAILS with a message containing the last 5 samples.
2. After the poll, assert at-rest. Read __frame.target.d and require abs(distance - target.d) <= 0.005. The failure message must name both values and the gap.
3. Read the baseline only after steps 1 and 2 pass.
4. Send the wheel input exactly as the test does now (same coordinates, deltas and count).
5. Read the result with the same existing wait logic where possible. If the existing wait is a fixed sleep, keep it, because the validated v2 delta needs about 1.4 s of wheel input.
6. Keep the original assertion's threshold and direction exactly unchanged.
7. Do NOT use __frame.settled anywhere. Do NOT loosen any tolerance. Do NOT touch other tests, shared helpers, imports used by other tests, or any file other than globe.spec.ts and the new waiver doc. If a new local helper is needed, define it inside the test or directly above it and name it with the prefix settleDistance.

STEP D. Print the FULL output of git diff -- tests/e2e/globe.spec.ts in the chat as PLAIN TEXT. Do not summarise it. Also print git diff --stat and git status --porcelain. The diff must show only the 456 test changed. If anything outside it changed, revert that part and say so.

STEP E. Verification, run in this order.
1. Run pnpm tsc -b, then pnpm lint, then pnpm test, then pnpm build, as FOUR SEPARATE calls. Report each exit code and the test count.
2. Run the test in isolation 10 times with the repo's e2e runner, the same way the GLOBE175 acceptance did it. Report baseline, final, delta, and the at-rest gap for every run. All 10 must pass.
3. Run the same test 10 times under CPU burner load, using your 12-burner setup that reached about 80% CPU. Record CPU and free RAM. All 10 must pass.
4. Mutation. Temporarily make the wheel ineffective by the smallest change that disables zoom input on the globe, in a scratch copy or by a reversible edit. Run the test 3 times. It must be RED 3/3 on the signed delta assertion, not on the settle poll or the at-rest assertion. Then restore. Run git diff and confirm that only the Step C change remains.
5. Run all 15 locked specs in one batch, twice. Report per spec pass and fail counts for each batch, and name every red test with its file and line. Do not edit any other spec to make a red go away.

STEP F. Report in this format: HEAD and status before and after; the full Step D diff; the gate exit codes; the isolated 10 results; the loaded 10 results; the mutation 3 results; the two batch tables; CPU and RAM per run; and UNMEASURED items. State plainly whether globe.spec.ts is fully green in both batches. If other known flakes turn red (N10, look.spec flatAlbedo, S2 or D4 NON-locked), list them as pre-existing open flags with the evidence and do NOT try to fix them in this task. The edits stay uncommitted in the working tree for review.