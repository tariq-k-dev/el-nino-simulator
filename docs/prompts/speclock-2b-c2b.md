TASK 3B-1a-SPECLOCK-2B-C2B v1. Repo: cd D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (ONLY repo).
FIRST confirm you can see the last line "END OF PROMPT 2B-C2B"; if not, STOP and say so. Prerequisite: C2A accepted (HEAD f66374b).
Rules: gate = pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p); one commit per step; STOP on real failures and report numbers; never tune a threshold to pass; no test.fixme / test.skip anywhere; at most 12 tool calls per step; if low on turns commit what is green, update docs/3B-1-STATUS.md, STOP. Defects are injected at test time and NEVER committed. Report raw tables.

FACTS YOU MUST USE

Pins float by design (core radius 1.10242 R). A pin is VALID for pixel specs iff front-facing (normal dot unit vector from the pin surface point to the camera >= 0.1) AND core r/R <= 0.97 (R = R_fit). Known from the F1b table: az 0 -> only us-west valid; az 180 -> only se-asia valid.
GLINT: Tariq ACCEPTED the attenuated glint (verdict V2). Recorded values from the difference method: overlay-only Do: max 88.52, area6 9594 (pixels with luma difference > 6), centroid (780.8, 376.0), r/R 0.4388. Approved look Dt: max 164.07, area6 15469. Material lobe Dm: max 162.93, area6 5991.
N4 FINDING (corrected): the original blue circle was the SPECULAR highlight of the cool fill DirectionalLight (#2f6fb8) on the ocean (ablation: probe mean luma 91.1 with the fill, 4.1 without). Since commit 38aa091 the globe material has specularIntensity 0, so a blue light only lifts blue by about 3/255 (invisible). The old N4 tested the wrong defect. The 3.3 metric is NOT changed: a per-channel blue gate would guard an invisible lift.
PART 1

P0 PREFLIGHT (read-only except one commit)

git status, git log --oneline -10. Commit the untracked docs/prompts files (message: docs: prompts).
Print, from the repo (do not invent): where the D1 evidence table was recorded and its conclusion; the V0 (a)-(d) answers (3.5 semantic table per valid pin; pin render drift 2e27939 vs HEAD; valid day and night pins per azimuth; why clouds hit W5/W8); which mechanism made the defects live (onBeforeRender or the React fallback). If something is missing, say MISSING.
E0 guard issue: the guard rejected a run because "dist/ was replaced since the build", so the e2e bundle shares dist/ with pnpm build. Fix: the e2e bundle builds into its own outDir (dist-e2e) so the gate cannot invalidate it, and pnpm e2e:look chains build:e2e itself. Verify: run the gate, then pnpm e2e:look with no manual rebuild. COMMIT if changed.
F1 SHARED PIN VALIDITY (fixes the checkRingCast flaw)

One function isValidPin(pin, geometry) in tests/e2e/look, used by 3.5, 3.6 and all negative tests (no copies). First write a failing unit test showing checkRingCast accepts a back-facing pin, then fix it.
Unit-test fixtures from the F1b table: back-facing -> INVALID; core r/R 1.10 or 1.0017 -> INVALID; front-facing and r/R <= 0.97 -> VALID; az 0 yields only us-west, az 180 only se-asia.
Non-vacuity: 3.5 needs at least one valid DAY pin and one valid NIGHT pin in its azimuth set; 3.6 needs at least one valid pin at every evaluated azimuth; otherwise the spec FAILS with "vacuous", never skips. Use the azimuths found in V0(c).
Remove the N1 workaround (hand-naming us-west) if the generic rule selects a valid pin. COMMIT.
F2 N4 FAITHFUL (3.3 metric unchanged)

Recover the original defect from git: the cool fill DirectionalLight (#2f6fb8) position and intensity as of 2e27939^ (the commit before the HemisphereLight change), and the Earth material specularIntensity and roughness floor as of 38aa091^ (before the clipped-pixel fix).
Defect N4 = that fill light plus the restored Earth specular settings, injected through acquire(). Expect the blurred-luma ratio at W1 (344,392) to be far above 1.15 (luma about 91 instead of about 4). Assert 3.3 FAILS and assert the signal (W1 ratio above 1.15 and W1 luma raised). The control passes in the same test.
Informational only, no gate: fill light alone with specularIntensity 0 -> report the W1 blue lift (about 3/255).
Remove the skipped N4. If the faithful defect still does not move W1, STOP and report the numbers; do not touch 3.3. COMMIT.
F3 GLINT SENTINEL (spec 3.9) + N9/N10

Method: default view, stars / pins / rings OFF, clock frozen, auto-rotate OFF. F_current = render as is. F_off = same with the specular overlay OFF and material specularIntensity 0. D = luma(F_current) - luma(F_off) per pixel. Metrics: max(D) and area6 = count(D > 6).
FIRST reproduce the recorded values (max 88.52, area6 9594). If either differs by more than 3%, STOP and report the exact conditions you used.
Constants in tests/e2e/look/glintConstants.ts with the comment "regression sentinel of the accepted look (Tariq ACCEPT, V2 attenuated)". Gate: max(D) within [70.8, 110.7] (0.8x to 1.25x of 88.52) and area6 within [6716, 12472] (0.7x to 1.3x of 9594). Assert valid inputs (disc found, no NaN).
N9: overlay OFF -> the sentinel FAILS (max near 0). N10: Earth specularIntensity 1.0 and roughness floor 0 -> the sentinel FAILS (max above 110.7 or area6 above 12472). Assert the signal direction; the control passes in the same test. COMMIT.
PART 1 CHECKPOINT: full gate; pnpm e2e:look green with NO skip/fixme; git status clean; update docs/3B-1-STATUS.md. If you are low on turns, STOP here and report; Part 2 will be re-sent.

PART 2

F4 TERMINATOR AUDIT (read-only first; write docs/globe-look/TERMINATOR-AUDIT.md)

Default view. Along the projected-sun axis through the disc centre, from -R to +R in 4 px steps: median of 5 parallel lines at offsets -0.2R..+0.2R: luma, and the analytic n.L at that point (normal from the exact perspective ray-sphere intersection). Mark: the span the CURRENT 3.4 metric used (124.02 down to 69.43, 31.0 px) and where n.L = 0 falls relative to it.
Report: true day level = median luma where n.L is in [0.30, 0.50]; true night level = median luma where n.L is in [-0.50, -0.15]. Does the current segment contain the n.L = 0 crossing? Where does luma fall from 69 to the night level (night mean is 11.04)?
For all 12 azimuths: terminator crossing r/R and whether the crossing and the n.L = +-0.25 points are inside the disc. Also explain the 188% R whole-disc width and the 13.69 step at az 60.
F5 REDEFINE 3.4 (definitions fixed BEFORE measuring; thresholds not tuned)

Band B = samples with |n.L| <= 0.25 on the median profile. Ld = median luma over 3 px around n.L = +0.25; Ln = same around n.L = -0.25; A = Ld - Ln.
VISIBLE: A >= 25 luma units AND Ld / max(Ln, 1) >= 3.
SOFT: S = (max adjacent 1 px luma step inside B) / A; S <= 0.25 (a hard step gives about 1.0).
Evaluate only at azimuths where the terminator crossing is at r/R <= 0.95 and both +-0.25 points are inside the disc; the others are reported as "terminator not in view". The default view MUST be in the evaluated set (assert).
Unchanged: night fraction by the SAME luma definition as before, 10-30% at the default view; night mean luma >= 4/255 at all 12 azimuths. RETIRED with the reason documented: the width >= 6% R gate (plateaus were segment endpoints) and the 16/255 step gate (inherited from a retired metric). Keep their measured values in the report for continuity.
If the default view fails VISIBLE or SOFT on the real render, STOP and report the profile.
N6 hard step: offline mutation of the real default capture replacing luma across B with a step between Ld and Ln -> S about 1 -> SOFT FAILS. N6b flat: mutate the lit side down to the night level -> VISIBLE FAILS. A synthetic 31 px smoothstep passes the same function. The control passes. COMMIT.
F6 BATCHED E2E RUNNER

scripts/e2e-batched.mjs: one Playwright process per spec file, sequential; each process starts its own preview server on a distinct free port; the orphan cleanup between files kills only ms-playwright processes and must NOT kill the current run's server; retry a file ONCE only on a worker crash (exit 3221225794 or "Target crashed"), never on assertion failures; report retries; aggregate. pnpm e2e calls it (keep pnpm e2e:raw). If ERR_CONNECTION_REFUSED reappears, report the cause (port clash, server killed, bundle replaced mid-run). COMMIT.
F7 CLOSE

docs/globe-look/SPEC.md: one table (check -> definition -> threshold -> measured -> negative test). List every redefinition: rim origin = fitted limb; strict-monotonic start at +3 px (cloud shell); 3.3 covers W1 only (reason); 3.5 semantic gate; shared pin validity; pins float by design; terminator redefinition (F5); glint V2 ACCEPTED by Tariq with Dt/Dm/Do numbers; N4 faithful defect and why per-channel blue was rejected.
Update docs/E2E.md. Run: full gate; pnpm e2e:look; full pnpm e2e (batched) once, all green. Tree clean; paste git log --oneline -12 and git status --short.
FINAL REPORT (then STOP): per step commit and gate result; P0 facts; F1 fixtures result; F2 N4 numbers (defect, threshold, control); F3 sentinel numbers (reproduced, gate, N9, N10); Part 2: audit tables, S / A / Ld / Ln per evaluated azimuth, N6/N6b; e2e per spec file including retries; anything NOT met.
END OF PROMPT 2B-C2B
