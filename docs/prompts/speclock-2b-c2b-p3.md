TASK 3B-1a-SPECLOCK-2B-C2B-P3 v1 (diagnose the F5 STOP, albedo-neutral SOFT gate, N6 negatives, final close). Repo: cd D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (ONLY repo).

FIRST confirm you can see the last line "END OF PROMPT 2B-C2B-P3"; if not, STOP and say so. Prerequisite: P2FIX report reviewed; expected HEAD f7fa54b, tree clean.

Rules: gate = pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p); one commit per step; STOP on real failures and report numbers; never tune a threshold to pass; no test.skip / test.fixme anywhere; at most 12 tool calls per step (a long e2e run counts as ONE call; launch long runs with the Popen(argv) method that worked, poll in short cells); if low on turns commit what is green, update docs/3B-1-STATUS.md, STOP. Do NOT amend or rewrite ANY commit, including your own fresh ones. Run lint and commit in SEPARATE cells and check the exit code of lint before git add (in P2FIX a commit landed after a lint failure). Defects are injected at test time and NEVER committed to production code. Report raw tables, and when you state a test count, print the list it was summed from.

DECISIONS (final)

E1. Your STOP was correct. Nothing is tuned. A >= 25, Ld / max(Ln, 1) >= 3, S <= 0.25, the 0.95 bound, D95, 20 bins of 0.02, and the evaluated-set rule stay exactly as in P2FIX.

E2. Two competing explanations of the failures. H1 (geography): with the clock frozen the terminator is a FIXED great circle on the globe; a bin of width 0.02 in n.L is a thin geographic strip, and its median luma is whatever land, ocean or ice that strip crosses. Evidence: the worst bin is the same bin 7 (n.L 0.04 to 0.06) at az 120, 150 and 180 (steps 20.99, 19.18, 16.60 against A about 70), i.e. the same strip seen from adjacent azimuths, while the other four azimuths have worst steps of 5 to 7 in other bins. The Lambert ramp alone predicts about 3.6 luma per bin (A about 71 over about 0.4 of n.L), i.e. S about 0.05. H2 (shading): a real discontinuity in the Earth material near n.L = 0.05. We do NOT decide by argument; step D measures it.

E3. Pre-registered decision rule (fixed now, before measuring): if the albedo-neutral render passes S <= 0.25 at all evaluated azimuths and all three albedo levels, H1 is accepted and F5b is executed. If any albedo-neutral S exceeds 0.25, H2 holds: STOP and report; do not touch the material, definitions or thresholds.

P0 PREFLIGHT

- git status, git log --oneline -8 (paste; confirm HEAD f7fa54b). Kill orphans (ms-playwright and stale runners of this repo only; never the user's Chrome).
- Save this prompt as docs/prompts/speclock-2b-c2b-p3.md and commit docs-only ("docs: prompts (p3)").
- Print the current assertions of the live 3.4 tests (default and 12-az). State exactly what 3.4 asserts today now that the old gates are retired and the new gate is dormant (I expect: night fraction and night mean luma only). Do not change anything yet.

D DIAGNOSTIC: ALBEDO-NEUTRAL PROBE (test-time only). COMMIT the probe and its result document.
Azimuths: exactly the 7 evaluated azimuths of P2FIX (0, 120, 150, 180, 270, 300, 330); print the set again before measuring. Same flags (stars, pins, rings off), same frozen clock, same R_fit, same camera, same lights, same overlay and glint.
Mutation: through the SAME injection handle that N6c will use (if no handle exists, STOP and report; do not add production code). On the Earth material: map = null, emissiveMap = null, color = flat day colour, emissive = #6fb8ff multiplied per channel by the flat night colour, needsUpdate = true. Flat day colour = per-channel mean of the day texture over all texels in LINEAR space (compute in the page by drawing the texture to a canvas; print the values). Flat night colour = same for the night texture. Three levels: day colour x 0.5, x 1.0, x 1.5 (clamp each channel to 1); night colour unchanged. Nothing else is touched.
For each az and level compute with the SAME pipeline as P2FIX (D95, n.L bands, 20 bins): Ld, Ln, A, Ld/Ln, S, worst bin, worst step, pixel counts. Also report the interquartile range of luma inside the Ld band (information on how flat the probe really is). Print the full 20-bin curves for az 120 and 150 at level x 1.0 next to the real-render curves of P2FIX (re-measure the real ones if the numbers are not stored).
Write docs/globe-look/FLAT-ALBEDO-PROBE.md with the tables and the verdict by rule E3. COMMIT. If rule E3 says STOP, report and STOP here.

F5b REDEFINE 3.4 (only if E3 accepted H1). COMMIT. Definition fixed here:
(a) VISIBLE on the REAL render, evaluated set, thresholds unchanged (A >= 25, Ld / max(Ln,1) >= 3).
(b) SOFT on the ALBEDO-NEUTRAL render at level x 1.0: S_flat <= 0.25, unchanged, same bins, same evaluated set (the set is geometry only, so it is identical). Rationale to be written in SPEC.md: SOFT is a property of the lighting function; at a fixed clock a thin n.L strip is confounded with geography.
(c) Real-render catastrophe bound: S_real < 0.6 at every evaluated azimuth (0.6 is the N6 separation level already fixed in P2FIX; measured maximum 0.294). It is NOT a SOFT replacement; S_real stays an informational column for all azimuths.
(d) Unchanged: night fraction 10 to 30 percent at the default view; night mean luma >= 4/255 at all 12 azimuths.
The default view MUST be in the evaluated set (assert); at least 3 evaluated azimuths. Wire (a) to (d) into look.spec.ts 3.4 default and 12-az (per evaluated azimuth: one real capture and one flat capture; the mutation must never leak: use a fresh page or assert the material is restored). Delete tests/e2e/look/terminatorProbe.spec.ts once its content lives in look.spec.ts and the doc (no duplicated 1.6 minutes). Keep the retirement source guard (no assertion of width >= 6 % R or 16/255). Update tests/e2e/suiteInventory.test.ts with every new title (additions are allowed). Unit tests: the existing 20 stay; add one that checks the catastrophe bound classification (S 0.59 passes, 0.60 fails) and one for "SOFT uses the flat curve, VISIBLE the real curve" at the pure-function level.
Disclosure: SPEC.md must record this as the SECOND post-measurement definition change, with the failing P2FIX numbers (az 120 S 0.294, az 150 S 0.268), the flat numbers, what the gate no longer proves (coastline contrast inside the terminator strip is out of scope), and why the thresholds did not move.

N6 NEGATIVES (control passes in the same test; assert the SIGNAL). COMMIT.

- N6 hard step on the FLAT default capture: offline mutation, every disc pixel with n.L in [-0.10, +0.30] set to grey Ld_flat (n.L > 0) or grey Ln_flat (n.L <= 0). Expect S >= 0.6 and SOFT FAILS; the unmutated flat control passes.
- N6r the same offline mutation on the REAL default capture (using the real Ld and Ln): expect S_real >= 0.6, the catastrophe bound FAILS, VISIBLE still passes.
- N6b flat disc: on the real capture every disc pixel with n.L > -0.15 set to grey Ln. Expect A < 25 and VISIBLE FAILS.
- N6c real render defect through acquire(): a white AmbientLight, intensity 3.0, added at the scene root (needsUpdate once). Expect Ln up versus the control and VISIBLE FAILS. If it does not fail, STOP and report the numbers; do NOT tune the intensity.
- N6d real render hard terminator: on the flat probe, replace the Earth material with a MeshToonMaterial using a two-texel NearestFilter gradientMap (dark, light) and the same flat colours. Expect S_flat >= 0.6 and SOFT FAILS. If the injection cannot do this in 12 calls, report it as NOT met (no skip in the suite).
- A synthetic smooth ramp (width 0.40) passes the same function in the same test.

F7C CLOSE. COMMIT.

- docs/globe-look/SPEC.md: 3.4 row (definition a to d, thresholds unchanged, measured values real and flat, negatives N6 N6r N6b N6c N6d), decisions E1 to E3, the retirement notes, "NOT met" corrected. docs/E2E.md (test counts, durations) and docs/3B-1-STATUS.md.
- Run: kill orphans; full gate; pnpm e2e:look; the full pnpm e2e (batched) once; all green, no skip, no fixme, 0 retries expected (report any). Tree clean; paste git log --oneline -16 and git status --short.

FINAL REPORT (then STOP): P0 log and what 3.4 asserted before; D flat-albedo table per azimuth and level, the two 20-bin curves (real versus flat) for az 120 and 150, verdict by E3; F5b per evaluated azimuth: crossing r/R, counts, Ld, Ln, A, Ld/Ln, S_real, S_flat, headroom 0.25/S_flat, worst bin and step; N6 N6r N6b N6c N6d numbers (defect vs threshold vs control); e2e:look and full e2e counts per file with the title list the count is summed from, and durations; anything NOT met.

END OF PROMPT 2B-C2B-P3
