TASK 3B-1a-SPECLOCK-2B-C2B-PART2 v2 (terminator audit and redefinition, batched runner, close). Repo: cd D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (ONLY repo).
FIRST confirm you can see the last line "END OF PROMPT 2B-C2B-PART2"; if not, STOP and say so. Prerequisite: Part 1 checkpoint accepted (HEAD 4d710fd, tree clean, e2e:look 23 passed, 0 skipped). This prompt replaces F4-F7 of the C2B v1 prompt.
Rules: gate = pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p); one commit per step; STOP on real failures and report numbers; never tune a threshold to pass; no test.skip / test.fixme anywhere; at most 12 tool calls per step (a long e2e run counts as ONE call; if the tool times out, run it in the background with output to a git-ignored log file and poll sparingly); if low on turns commit what is green, update docs/3B-1-STATUS.md, STOP. Do NOT amend or rewrite existing commits. Defects are injected at test time and NEVER committed. Report raw tables.

FACTS YOU MUST USE

The shipped look is specularIntensity 0 plus the overlay glint (Tariq ACCEPTED). assertShippedLook exists. A forced 0.18 may appear ONLY inside the defect engine (N2, N4, N10).
Known flaws of the CURRENT 3.4 (still live): width >= 6 % R used the endpoints of a locally monotonic segment (124.02 -> 69.43, 31 px) while the night mean luma is 11.04; the 16/255 step gate is inherited from a retired metric (13.69 at az 60, where the terminator is almost out of view); the whole-disc width gave 188 % R because Lambert shading has no day plateau.
Geometry hint (orthographic, for unit tests and sanity ONLY; real values come from the exact perspective ray-sphere intersection): let theta = angle between the sun direction and the view axis (default view 47.2 deg). Along the projected-sun axis, x = R sin(phi) and n.L = cos(phi - theta). The terminator crossing is at r/R = |cos(theta)|; the n.L = +0.25 and -0.25 points are at phi = theta - 90 deg -/+ 14.48 deg. Default: crossing about 0.68 R.
P0 PREFLIGHT

git status, git log --oneline -3 (expect HEAD 4d710fd). Kill orphan processes (ONLY command lines containing ms-playwright or stale runners of this repo; never the user's own Chrome).
Save this prompt as docs/prompts/speclock-2b-c2b-part2.md and commit docs-only ("docs: prompts (part 2)"). Nothing else in that commit.
F4 TERMINATOR AUDIT (read-only; the only output is docs/globe-look/TERMINATOR-AUDIT.md plus a generator script if needed). COMMIT.
a) Read the Earth material / shader source and state in the doc the luminance function of n.L that is ACTUALLY implemented (plain Lambert? a smoothstep mix of day and night textures? list the edge values) with file:line.
b) Default view, same flags as the current 3.4 (state them). Along the projected-sun axis through the disc centre, from -R to +R in 4 px steps: median of 5 parallel lines at perpendicular offsets -0.2R, -0.1R, 0, +0.1R, +0.2R: luma, and the analytic n.L at that point (axis line). Mark the span the CURRENT 3.4 metric used (124.02 -> 69.43) and where n.L = 0 falls relative to it.
c) Report: day level = median luma where n.L in [0.30, 0.50]; night level = median luma where n.L in [-0.50, -0.15]; whether the current segment contains the n.L = 0 crossing; where luma falls from 69 to the night level.
d) All 12 azimuths (0..330 step 30): theta, terminator crossing r/R, the r/R of the n.L = +0.25 and -0.25 points, and whether all three are at r/R <= 0.95. Explain the 188 % R whole-disc width and the 13.69 step at az 60.
e) If the audit shows the F5 definition below CANNOT be applied at the default view (for example the +/-0.25 points are outside r/R <= 0.95), STOP and report; do not redefine.

F5 REDEFINE 3.4 (definitions fixed here BEFORE measuring; thresholds not tuned). COMMIT.
Profile P(t): integer positions t (1 px spacing, nearest pixel) along the projected-sun axis; value = MEDIAN across the 5 parallel lines of F4(b). Never the mean (a mean smears a hard edge by up to about 4 px and could let it pass). n.L(t) = analytic value on the axis line.
Points: t+ where n.L = +0.25, t- where n.L = -0.25 (linear interpolation; assert n.L is strictly monotonic between them, else INVALID).
Ld = median of P over t+ -1 .. t+ +1 (3 px); Ln = same around t-; A = Ld - Ln. Band B = integer positions between t- and t+.

VISIBLE: A >= 25 luma units AND Ld / max(Ln, 1) >= 3.
SOFT: S = (max over adjacent pairs in B of |P(t+1) - P(t)|) / A, require S <= 0.25 (a hard step gives about 1.0). If A <= 0 both FAIL (never divide by zero).
Applicability: evaluate an azimuth only if the crossing, the t+ point and the t- point are all at r/R <= 0.95; otherwise report "terminator not in view". Compute the evaluated set FIRST as a pure function of sun and camera (unit-tested against the geometry hint), print it, THEN measure. The default view MUST be in the set (assert). Require at least 3 evaluated azimuths including the default; if fewer, STOP and report (do not lower the bar).
Unchanged: night fraction by the SAME luma definition as before, 10-30 % at the default view; night mean luma >= 4/255 at all 12 azimuths.
RETIRED, with the reason written in SPEC.md: the width >= 6 % R gate (plateaus were segment endpoints) and the 16/255 step gate (inherited). Keep both measured values as INFORMATIONAL columns in the report. No test may assert them (add a source guard).
Replace the existing 3.4 tests (default and 12-az) by the new definition. The pure function takes (profile, geometry) and never touches the scene.
Unit tests (synthetic profiles, the same function): 31 px smoothstep PASSES; 6 px linear ramp PASSES (S about 0.17); 3 px ramp FAILS (S about 0.33); hard step FAILS (S about 1); flat (A < 25) FAILS VISIBLE; night lifted so Ld/Ln < 3 FAILS VISIBLE; A <= 0 FAILS without NaN; non-monotonic n.L is INVALID.
Real render: if the default view fails VISIBLE or SOFT, or any evaluated azimuth fails, STOP and report the full profile (1 px table) and the numbers; do not change definitions or thresholds.
Negatives (control passes in the same test; assert the SIGNAL, not only the failure):
N6 hard step: offline mutation of the REAL default capture: every disc pixel with |n.L| <= 0.25 (analytic per pixel from the same geometry) is set to grey Ld if n.L > 0 else grey Ln. Expect S >= 0.6 and SOFT FAILS while VISIBLE still passes.
N6b flat: every disc pixel with n.L > -0.25 set to grey Ln. Expect A < 25 and VISIBLE FAILS.
N6c real render defect through acquire(): a white AmbientLight, intensity 3.0, added at the scene root (needsUpdate once). Expect Ln up versus control and VISIBLE FAILS. If it does not fail, STOP and report the numbers; do NOT tune the intensity.
The synthetic 31 px smoothstep passes the same function in the same test.
F6 BATCHED E2E RUNNER. COMMIT.

scripts/e2e-batched.mjs: ONE Playwright process per spec file, sequential. Each process starts its own preview server on a distinct free port (playwright.config reads an env var for the port). After each file the runner kills the process TREE it started (taskkill /T /F on Windows) and then cleans orphans (ms-playwright only); cleanup happens only between files, so it can never kill the current run's server.
Retry a file ONCE, only on a worker crash (exit 3221225794 or "Target crashed"), never on assertion failures; report every retry; aggregate counts and exit non-zero on any failure.
Keep the decision logic in a pure module (scripts/lib/e2e-batch-core.mjs: shouldRetry(exitCode, output), pickPort, aggregate) with unit tests: crash code retries once, assertion failure never retries, second crash fails. If tsc -b complains about missing types for the .mjs import, add a sibling .d.mts.
pnpm e2e calls the runner; keep pnpm e2e:raw. If cheap (<= 2 calls), pnpm e2e:look also goes through the runner restricted to the look specs; otherwise leave it.
If ERR_CONNECTION_REFUSED reappears anywhere, report the cause (port clash, server killed, bundle replaced mid-run). Also confirm the stale-bundle guard runs in every spawned process.
F7 CLOSE. COMMIT.

docs/globe-look/SPEC.md: one table (check -> definition -> threshold -> measured -> negative test) covering 3.1-3.9 and N1-N10 plus N6/N6b/N6c. Then a list of EVERY redefinition and decision: rim origin = fitted limb; strict-monotonic start at +3 px (cloud shell); 3.3 covers W1 only (reason); the 3.3 mask is defined as shipped (G2: 105,313 -> 71,869 px); 3.5 semantic gate; shared pin validity; pins float by design (core radius 1.10242 R); terminator redefinition (F5, with the retired gates and why); glint V2 ACCEPTED by Tariq with the Dt / Dm / Do numbers and the shipped si 0 (assertShippedLook); N4 faithful defect and why a per-channel blue gate was rejected; the N10 note that it fails on max(D) while area6 stays inside its window.
Update docs/E2E.md (commands, batched runner, durations). Update docs/3B-1-STATUS.md: mark 3.4 and the runner DONE, list anything NOT met.
Run: kill orphans; full gate; pnpm e2e:look; the full pnpm e2e (batched) once; all green. Tree clean; paste git log --oneline -14 and git status --short.
FINAL REPORT (then STOP): per step commit and gate result; F4 audit tables (profile, day/night levels, 12-az table, the explanations); F5 evaluated set, then per evaluated azimuth: crossing r/R, A, Ld, Ln, Ld/Ln, S, headroom 0.25/S, plus the informational old width and step; N6 / N6b / N6c numbers (defect vs threshold vs control); runner results per spec file including retries; e2e:look and full e2e counts and durations; anything NOT met.
END OF PROMPT 2B-C2B-PART2
