PROMPT 2B-C2B-P4: e2e batched runner fix, count and drift reconciliation, spec-lock verification close

CONTEXT

Repo: D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (the only repo). Expected HEAD at start: b5ba389, tree clean except this prompt. Gate: pnpm tsc -b, then pnpm lint, then pnpm test, then pnpm build (never tsc -p). Each gate step runs in its own cell.

P3 delivered the albedo-neutral probe (H1 accepted), the two-curve 3.4 gate and the five N6 negatives. The spec lock is NOT closed, because no complete e2e run exists. The batched runner scripts/e2e-batched.mjs failed in the one run that actually executed: 1 of 3 files passed, with ERR_CONNECTION_REFUSED on every test after the first two in look.spec.ts. Raw Playwright is healthy. Full batched e2e was 10/10 files, 0 retries, 16.1 min at 832fb70 and at the P2FIX close, so the runner worked before. Your P3 statement that this is an F6 regression is NOT established and must be tested.

Tariq has accepted the second post-measurement definition change (F5b: VISIBLE on the real render, SOFT S at most 0.25 on the albedo-neutral render, real S below 0.6 as a catastrophe bound). Do not reopen it. Do not change any threshold anywhere.

HARD RULES

No git commit --amend, no rebase, no reset of commits. If a commit needs a fix, make a new commit.
Run pnpm lint in its own cell and confirm exit 0 BEFORE the commit cell. Never chain lint and commit.
Do not edit anything under src/ unless a test defect forces it. Report it first if so. No test.skip, no loosened assertion, no threshold changes.
Long runs: launch with subprocess.Popen(argv_list, stdout=file_handle, stderr=subprocess.STDOUT). No shell redirects, no > in the tracked-background wrapper, no DETACHED_PROCESS. Poll in cells that last at most 240 seconds each (sleep at most 200 s plus a short read). Never let any cell exceed 300 s. After each poll cell, confirm the runner pid is still alive and that the log or summary JSON grew.
Tool-iteration budget is limited. Poll sparingly (once per 200 s of sleep, not more often). Keep a progress file at C:\Users\takcs\AppData\Local\hermes\cache\scratch\P4-progress.txt, updated after every step with: step id, status, key numbers, runner pids and log paths. If you are about to run out of iterations, update it and write a RESUME section instead of claiming results you did not read.
Report only what you measured. If a run is unread, say NOT VERIFIED.
Reports and notes are plain text. At the start of your final report, quote the last line of this prompt verbatim.
P0: PREFLIGHT

git status, git rev-parse HEAD, git log --oneline f7fa54b..HEAD. Print them.
Run git reflog and state whether any commit since f7fa54b was amended or rewritten (look for amend entries). Report honestly. If yes, list which.
Check for orphan node, chrome or chromium processes (ignore your own inspection shells). Report PIDs and command lines. Kill only confirmed orphans from earlier runs.
Save this prompt as docs/prompts/speclock-2b-c2b-p4.md and commit it alone.
A: RECONCILE TWO DISCREPANCIES (read-only first; fix only what is named)

A1. Test count: 28 versus 29 versus 25.
The P3 reports gave inconsistent numbers. The first said "25 tests: 10 look + 14 negative + 5 globe", but 10+14+5 is 29. The raw runs later showed look 9, negative 14, globe 5, which is 28. The pre-P3 e2e:look count was 23, and P3 added exactly five N6 tests (N6, N6r, N6b, N6c, N6d), so the expected count is 28. Also explain what "25 green through harden" counted.
Do the following:
a. Run raw playwright test --list for each of the 10 spec files at HEAD (listing only, no execution). Print the exact test titles per file and the per-file and total counts.
b. State the arithmetic explicitly: where 25, 10 and 29 came from, and whether 28 is right. Say which of your P3 statements were wrong.
c. Show the pre-P3 inventory by listing titles at f7fa54b (use git show or a temporary worktree outside the repo, not by touching the working tree) and show the delta. It must be exactly the five N6 tests, and the two 3.4 tests rewritten in place.
d. Report what the inventory guard (from P2FIX P1, commit de9d541) currently expects: the count and titles for e2e:look and for the full suite. If it still expects 23 or otherwise does not match 28, fix it, and demonstrate that it bites (a removed or renamed test makes it fail, then revert that probe). Commit separately.
e. Explain what "25 green through harden" counted (order of files in the full run and number of tests before harden).

A2. N10 drift: 190.28 versus 183.08 (and 102.55 during the leak).
Facts: the Part 1 record says N10 failed on max 190.28 (si 1.0), with area6 11261 inside its window. After the P3 fix, N10 measures max 183.08. During the N6d leak it measured 102.55. Something differs between 190.28 and 183.08, and it must be explained, not assumed.
Candidate causes to test, in order:

The metric changed. In P2FIX commit e3c6694, diffStats gained maxAbs and the signed max was retained. P3 changed measureGlint to maxAbs while it reports d.max. Establish exactly which field N10 asserts and which field produced 190.28 originally.
State or order dependence: material state, camera, clock, viewport, DPR, or test order (N10 now runs after N6d and N7).
Nondeterminism: run N10 alone at HEAD three times and report all three max values and the area6 values. Is the value bit-stable?
Method: in ONE instrumented run, print for N10 both the signed max and maxAbs, plus area6. Run N10 in isolation, and after N6d and N7 in suite order. Report which condition yields 190.28 and which yields 183.08.
Also re-run the sentinel 3.9 and report max(D) and area6 against the window (expected max(D) 88.52 within [70.8, 110.7] and area6 9594 within [6716, 12472]). Confirm whether the window bounds were computed from the signed max and whether the current metric field is consistent with them.
STOP RULE: if the drift is unexplained after these runs, report the numbers and stop that sub-task. Do NOT change thresholds, windows or the sentinel baseline. If the explanation is a metric-field mismatch (the test asserting the wrong field), fix the test to use the field the window was calibrated on, show the before and after numbers, and commit separately.
B: DIAGNOSE THE RUNNER (no fix yet)

B1. Read scripts/e2e-batched.mjs in full. Report:

every timeout constant (per file, per run, per test) and its value
the definition of killTree and every call site (what triggers each)
who starts the Brotli static server, on which port, and its parent process (is it a descendant of the Playwright process that killTree targets?)
the retry logic (crash code 3221225794) and whether it calls killTree
git diff 832fb70..HEAD for scripts/e2e-batched.mjs and for playwright config files, and git log --oneline for those files
B2. Add env-gated diagnostic logging (E2E_DEBUG_KILL=1): for every killTree call log timestamp, target pid, reason or caller, seconds since the file started, and a process-tree snapshot (PowerShell Get-CimInstance Win32_Process with ProcessId, ParentProcessId, Name, CommandLine) taken immediately before and after the kill. Keep it if small. Commit separately.
B3. Test hypotheses with evidence, in this order:
H-T: a per-file wall-clock timeout in the runner shorter than look.spec.ts real duration (10.0 min raw; the 12-az 3.4 test alone is 6.4 min).
H-S: killTree scope too wide (kills the server because it is a descendant of the target, or matches by name or port).
H-C: the crash-retry path invokes killTree.
H-H: harness artifact (poll cell or orphan cleanup killing the tree). Rule it out by launching with Popen and polling under 240 s.
Run batched e2e on look.spec.ts only (use the runner's file selection option, or add one if missing) with E2E_DEBUG_KILL=1. Record the FIRST kill event: reason, pid, seconds since file start, and the configured timeout. Compare against the observed behavior (2 tests passed, then ERR_CONNECTION_REFUSED). Say precisely which hypothesis the log supports. Note that the earlier failure came after only 2 tests, which may be sooner than a 10-minute timeout would fire, so check the timing honestly instead of assuming H-T.
STOP RULE: if no hypothesis is supported after two instrumented runs, report the logs and snapshots and stop. Do not guess a fix.
C: FIX (only after B3 names the cause)

Whatever the cause, the fixed runner must satisfy these invariants:
C1. The runner owns the server lifecycle. For each file it starts the Brotli server on that file's own port, waits for readiness, and tears it down in a finally block. The server is never a descendant of a process that gets killed mid-file. If this is already true, state it and show how.
C2. killTree targets ONLY the pid of the Playwright process the runner spawned for that file. Never by image name, never by port, never by wildcard, never pid 0 or the runner's own pid or the server pid. Add a guard that refuses such targets and logs it.
C3. Per-file timeouts are a backstop with budgets from measured durations with at least 1.5x margin: look.spec.ts 10.0 min measured, negative.spec.ts 4.7 min, globe.spec.ts 60.8 s, and for the remaining files use the durations from the 16.1 min full run in docs/globe-look/E2E.md. Put them in one table in the runner, overridable by env E2E_FILE_TIMEOUT_MS_OVERRIDE for testing. A timeout kills only that file's Playwright tree, marks the file TIMEOUT (not as many ECONNREFUSED test failures), tears down that file's server in finally, and the next file gets a fresh server on a fresh port.
C4. Write a summary JSON in the artifacts dir with, per file: name, port, status (passed, failed, TIMEOUT, crashed), tests passed, failed, skipped, expected count from the inventory guard, duration, retries and killReason; plus totals. Keep the printed ===== batched e2e summary ===== block. The exit code is nonzero on any non-passed file or any count mismatch against the inventory.
C5. Unit tests (vitest) for the runner logic. Extract pure functions (timeout table, kill-target validation, summary building) into a module under scripts/ if needed. Required tests: (1) kill-target validation refuses server pid, own pid, pid 0 and non-child pids; (2) a simulated timeout using a fake long-running child process and a fake server: the child tree is killed, the file is marked TIMEOUT, the server is torn down by finally and the next file's server is alive on a different port; (3) summary and exit code on count mismatch. Show that tests (1) and (2) bite by temporarily reverting the relevant guard (without committing) and showing them fail.
C6. Negative control for the real runner: run batched on globe.spec.ts plus one other short spec with E2E_FILE_TIMEOUT_MS_OVERRIDE set so globe times out (for example 20 s). Confirm globe is reported TIMEOUT, the other file passes with a live server, and the exit code is nonzero. Quote the summary block.
Commit the fix and its tests as one commit, the control as part of its message or a docs note. No amend.

D: VERIFICATION (the part P3 could not do)

D1. Full gate, one step per cell: pnpm tsc -b, pnpm lint, pnpm test, pnpm build. Report counts (previous: 736 tests in 30 files; say how many new tests).
D2. pnpm e2e:look through the BATCHED runner. Expected: 3/3 files, 28 tests (look 9, negative 14, globe 5), 0 retries, roughly 16 min. Launch with Popen, poll under 240 s per cell, report the summary JSON.
D3. Full pnpm e2e through the batched runner. Expected: all 10 files passed, 0 retries, total test count equal to the total from A1a, roughly 25 min. Same launch and poll method. If it cannot finish inside your iteration budget, do not claim results: leave the runner alive, write its pid, log and summary paths in the RESUME section of the progress file, and report NOT VERIFIED with what was read.
D4. If any file fails, report test names and error text verbatim. Do not retry silently. Do not skip.

E: CLOSE

Update docs/globe-look/E2E.md: the runner invariants (C1 to C3), the timeout table with measured durations, expected counts (look 9, negative 14, globe 5, plus the full total), the launch and poll method that works, and the known cost of the 12-az 3.4 test (6.4 min, 7 page reloads).
Update docs/globe-look/SPEC.md and STATUS: keep the P3 disclosure of the second definition change. Mark the spec lock as CLOSED only if D2 and D3 are both green. Otherwise write "spec lock OPEN: full e2e not verified" and say what is missing.
Final lint in its own cell, then commit docs separately. No amend.
FINAL REPORT FORMAT (plain text, no code blocks)

Start by quoting the last line of this prompt. Then list sections P0, A1, A2, B, C, D, E. Include:

the A1 arithmetic and the test title lists
the A2 table: condition versus signed max, maxAbs, area6, and the sentinel numbers
the B3 verdict with the first-kill evidence (timeout value, seconds since file start, reason)
a commit table (hash, message)
the D2 and D3 summary blocks (files passed, test counts, durations, retries), or NOT VERIFIED with reasons
a NOT MET section listing anything unfinished, and whether the spec lock is closed
answers to these questions: did any commit since f7fa54b get amended; did any threshold or window change (it must be no)
END OF PROMPT 2B-C2B-P4
