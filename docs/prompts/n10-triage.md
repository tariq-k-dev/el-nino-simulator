Prompt N10-TRIAGE v1 (plain text; save as docs/prompts/n10-triage.md; sentinel END OF PROMPT N10-TRIAGE)

ROLE AND SCOPE
You are Hermes working in D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (the ONLY repo). This is a READ-ONLY measurement step. You must not edit any source file, spec, config, or runner. The only files you may create in the repo are docs/N10-TRIAGE.md and docs/prompts/n10-triage.md. Never run git add -A; stage by explicit path. Never use tsc -p; the gate is pnpm tsc -b && pnpm lint && pnpm test && pnpm build (run it once at the end only to confirm the tree is still green; it is not the point of this step). Running out of budget is NOT a STOP: report what is unmeasured and continue with the next arm.

STOP CONDITIONS (only these)
S1. git status is not clean at start, or HEAD is not 3ee1ea6.
S2. A port used by the e2e runner is occupied and cannot be freed.
S3. A worktree cannot be created for a required commit.
On STOP, write nothing else; print the reason and the exact output of the failing command.

P0 PREFLIGHT

Record git rev-parse HEAD, git status --porcelain (must be empty), node -v, pnpm -v, OS, CPU count, total RAM.
Save this prompt to docs/prompts/n10-triage.md.
Create sibling worktrees OUTSIDE the repo at D:\Dev\Handshake_triage\wt-9c11ed8, wt-414caf5, wt-5e7c826, wt-5db822c, each with pnpm install --frozen-lockfile and the same build step the e2e runner needs. HEAD (3ee1ea6) runs in the main repo. Note: 6fd9ce9 is source-equal to 414caf5 and 3ee1ea6 only adds docs, so 414caf5 is the only distinct source state between 9c11ed8 and HEAD.
Host-load telemetry (missing until now): before and after EVERY run below, sample CPU utilisation (1 s samples over 5 s) and free RAM, and log them next to the run result. If you cannot measure, say NOT MEASURED, do not guess.
ARM A: globe.spec (isolated, whole file, one process per run)
Run 3 times at HEAD and 3 times at 9c11ed8. For every test record pass/fail per run. Specifically report:

globe:175 (pinch at 375x667, known red): failure message and measured values.
globe:305 (zoom after fly-to): the assertion text, the tolerance, and the measured pair (earlier batched value 3.3668 -> 3.3701). Quote the spec lines (read only).
Pre-registered rule for globe:305: it is NEW if it is 3/3 green at 9c11ed8 and at least 1 red at HEAD; PRE-EXISTING if red in at least 2 of 3 at both commits; FLAKY if mixed at both; otherwise INCONCLUSIVE (say so, do not force a verdict).
If NEW: run the same 3x at wt-414caf5, and if it is red there too, list git rev-list 9c11ed8..414caf5 and bisect by worktree (3 runs per bisect point) to the first red commit. Report the commit, the files it touched that the globe spec could reach (import chain, show the path), and nothing else.
ARM B: negative.spec N10 (isolated test, then in-file)
For each of HEAD and 9c11ed8: 3 runs of the N10 test alone (grep), and 3 runs of the whole negative.spec file. Record per run: differing pixel count (limit 50), maxAbs, and the r/R range of differing pixels and distance to the nearest pin if the spec already emits them (do not add instrumentation). Report min, median, max of the pixel counts per arm. The known batched value is 457 px; state whether isolated runs reproduce it.

ARM C: D10 arms never measured (Handoff 11, flag E)
Using wt-5db822c (BASE) and wt-5e7c826 (PRE), run the N10 test alone 3 times each, and run it once immediately AFTER a full globe.spec in the same process chain (warm-after-heavy-file) at HEAD and at 5e7c826. Report pixel counts per arm in one table. Do not interpret beyond: same-commit spread vs between-commit difference. If an arm cannot run at an old commit because the spec or runner does not exist there, say so and mark the arm UNRUNNABLE.

ARM D: look.spec flatAlbedo
3 runs at HEAD and 3 at 9c11ed8, whole file. Report which assertions fail, whether failures occur only after-reload, and the measured values. No fixes.

REPORT (docs/N10-TRIAGE.md, then commit ONLY docs/N10-TRIAGE.md and docs/prompts/n10-triage.md with an explicit git add of those two paths)
Required sections:

Environment and host-load table (per run: before/after CPU, free RAM, or NOT MEASURED).
One verdict table: rows = test (globe:175, globe:305, N10 isolated, N10 in-file, flatAlbedo), columns = HEAD k/n, 9c11ed8 k/n, 414caf5 k/n (if run), classification (DETERMINISTIC-RED, FLAKY, NEW-REGRESSION, PRE-EXISTING, INCONCLUSIVE).
N10 pixel-count table for all arms (A..C above) with min/median/max.
Observations that CONTRADICT the earlier hypothesis that N10 is an acquisition-path difference in the in-page pair (list them; if none, say none).
UNMEASURED list.
One recommended next action, max 3 lines, no implementation.
Then remove the worktrees (git worktree remove --force, then git worktree prune), confirm git status is clean and HEAD is the new docs commit, and run the full gate once; print its tail.
FINAL REPLY FORMAT (short, plain text)
Commit hash; the verdict table; N10 min/median/max per arm; globe:305 verdict by the pre-registered rule; UNMEASURED list; counts (passed/failed/skipped/expected per arm run); gate result.

END OF PROMPT N10-TRIAGE
