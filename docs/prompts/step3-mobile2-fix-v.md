PROMPT 2B-STEP3-MOBILE2-FIX-V (READ-ONLY VERIFICATION)

Context: MOBILE2-FIX closed at HEAD 414caf5. Four test-hygiene questions remain. This prompt changes NO source, test, config or script file. The only file you may create is docs/MOBILE2-FIX-V.md, committed alone by explicit path (never git add -A), after saving this prompt as docs/prompts/step3-mobile2-fix-v.md in its own commit (P0). Repo: D:\Dev\Handshake\Build-an-Interactive-Data-Visualization. Measure, do not guess. Anything you cannot measure: NOT MEASURED with the reason. Do not use retries to hide failures; run with retries off.

V1 Count reconciliation. From the archived batched summary of the last full run (the 46.5 min run), print per file: file name, tests listed, passed, failed, skipped, flaky, and the runner verdict. Then print totals. Explain exactly what 164/164 means (tests run? tests accounted for?) and why the previous message said 164 passed and 0 failed while 6 tests failed. State the true passed count and the true failed count. Name the 6 failing tests by id.

V2 Runner change. Print the full git diff of scripts/e2e-batched.mjs between 9c11ed8 and HEAD, and say in one sentence what each changed line does and why it was needed. State whether the change could alter how failures are counted or hidden (yes or no, with reasoning). If yes, re-derive V1 without the change if possible, otherwise say NOT MEASURED.

V3 switcher-ux S2. Run tests/e2e/switcher-ux.spec.ts isolated at HEAD, whole file, retries off. Print passed, failed and per-test result for S2 at 1440x900 and 1280x720. If either fails, run it once more and print both results. Then check the same spec isolated at 9c11ed8 using a clean worktree (git worktree add under .cache, build there, remove the worktree after; no changes to the main working tree) and print the result. State whether S2 failures are reproducible, differ between commits, or neither.

V4 pin-click. Run tests/e2e/pin-click.spec.ts isolated, whole file, retries off, three times at HEAD and three times at 9c11ed8 (same clean worktree). Print per run: passed, failed, and the failing test ids with the first line of each error. Then classify each failure as: reproducible at both commits, appears only at HEAD, appears only at 9c11ed8, or intermittent at both. Report the overall pass rate per commit. If any failure appears only at HEAD, bisect over the 5 FIX commits (dc4a7ef, 133a9a7, b70f5f3, 0e754a5, 414caf5) using three runs per step, and name the first bad commit, or say it cannot be isolated.

V5 Desktop reachability. For any pin-click or switcher-ux failure, say whether the failing code path can execute any file changed in 9c11ed8..HEAD. Use the list from git diff --name-only 9c11ed8..HEAD and the module import graph (print the chain, or say no chain exists). Mobile-only gating must be shown, not asserted.

V6 Also report machine load. Say whether the full batched run overlapped with other heavy processes (docker, other browsers, builds) if the logs show it; otherwise NOT MEASURED.

Final report (short): sentinel, HEAD, V1 true counts and the six failing ids, V2 verdict, V3 verdict, V4 per-commit pass rates and classification, V5 reachability verdict, git status --porcelain (must be empty), and one line: RECOMMEND CLOSE or RECOMMEND REPAIR with the reason.

End with the line: END OF PROMPT 2B-STEP3-MOBILE2-FIX-V
