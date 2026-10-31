TASK 3B-1a-SPECLOCK-2B-C2B-P2FIX v1 (terminator redefinition on the real perspective geometry, N6 negatives, inventory check, final close). Repo: cd D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (ONLY repo).
FIRST confirm you can see the last line "END OF PROMPT 2B-C2B-P2FIX"; if not, STOP and say so. Prerequisite: Part 2 report reviewed; F4 audit (5f23b50) and F6 runner accepted; expected HEAD 832fb70, tree clean.
Rules: gate = pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p); one commit per step; STOP on real failures and report numbers; never tune a threshold to pass; no test.skip / test.fixme anywhere; at most 12 tool calls per step (a long e2e run counts as ONE call; launch long runs with the Popen(argv) method that worked, poll in short cells); if low on turns commit what is green, update docs/3B-1-STATUS.md, STOP. Do NOT amend or rewrite existing commits. Defects are injected at test time and NEVER committed. Report raw tables.

DECISIONS (final; the advisor owns the first error)
D1. The 0.95 bound is NOT widened to 0.97. A 4 px margin to a bound is fragile, and widening would not remove the second blocker (D3).
D2. My orthographic hint (crossing 0.68, the -0.25 point at 0.84) was wrong for this camera. The real oracle is perspective: with R = 1, camera distance d = 3.3534, alpha = central angle of the surface point from the view axis: r/R = sin(alpha) \* sqrt(d^2 - 1) / (d - cos(alpha)). Default view (theta 47.2 deg): crossing alpha = 42.8 deg -> 0.830; n.L = +0.25 at alpha = 28.32 deg -> 0.614; n.L = -0.25 at alpha = 57.28 deg -> 0.957 (your audit measured 0.829 / 0.613 / 0.957: confirmed). Use this closed form as the unit-test oracle and remove the orthographic hint from tests and docs.
D3. VISIBLE as first written (A taken between the n.L = -0.25 and +0.25 points) would FAIL the real default view for a physical reason shown by your own audit: the night side is an emissive floor (Globe.tsx:298-317, emissiveMap night, 0.18) independent of n.L, and at n.L = +0.25 the Lambert term has barely started (luma 18.6 vs night 5.2, so A is about 13 < 25). Also the single sun axis depends on the albedo under one line (axis luma 26.6 at n.L 0.31 versus 62.3 whole-disc for the same n.L band). Therefore the SAMPLING changes and the THRESHOLDS DO NOT: A >= 25, Ld / max(Ln, 1) >= 3, S <= 0.25 stay exactly as before. Ld, Ln and the step curve use WHOLE-DISC n.L bands (thousands of pixels). The 1D axis profile stays only for the audit document; it is no longer a gate.

P0 PREFLIGHT

- git status, git log --oneline -12 (paste it; confirm HEAD 832fb70 and the real order of the N9 fix 36155b0). Kill orphans (ms-playwright and stale runners of this repo only; never the user's Chrome).
- Save this prompt as docs/prompts/speclock-2b-c2b-p2fix.md and commit docs-only ("docs: prompts (p2fix)").

P1 TEST INVENTORY (a possible lost test). Part 1 reported e2e:look = 23 passed (3.1, 3.2, 3.3, 3.4 default, 3.4 12-az, 3.5, 3.6, 3.7, 3.9, N1, N2, N3, N4, N5, N7, N8, N9, N10, 5 globe). The Part 2 report says 22. Run playwright --list for the three look files, print the full title list, and diff it against that list. Explain the -1 (moved, merged, or dropped; note the report also says "look.spec.ts has 10 tests" and "look 8/8"). If a test was dropped, restore it. Then add a unit test (inventory guard) holding the expected title set as a constant and failing when a title disappears or is renamed without updating the constant (allowed: titles added). COMMIT.

P2 N9 ASSERTION AUDIT. N9 (overlay off) was fixed so INVALID with max NaN counts as a pass. That is too loose: any broken capture would also give INVALID and keep N9 green. Print the current assertion. Tighten it to exactly one of two explicit signals: (a) valid result with finite max(D) < 70.8, or (b) INVALID with reason "frames identical" (count of pixels with D != 0 equals 0), and in both cases the CONTROL in the same test must be valid and inside the window. Any other INVALID must fail the test. Unit-test the classification. COMMIT.

F5 REDEFINE 3.4 (definitions fixed here BEFORE measuring). COMMIT.
Geometry: per-pixel analytic n.L from the exact perspective ray-sphere intersection (the same function mutateTerminator uses). R = R_fit.
Pixel set D95 = disc pixels with r/R <= 0.95 (pins, stars, rings are off by the 3.4 flags; state them).
Levels: Ld = median luma over D95 pixels with n.L in [0.30, 0.50]; Ln = median luma over D95 pixels with n.L in [-0.50, -0.15]. A = Ld - Ln.

- VISIBLE: A >= 25 luma units AND Ld / max(Ln, 1) >= 3. (unchanged thresholds)
  Curve: 20 bins of width 0.02 in n.L from -0.10 to +0.30; C(k) = median luma of D95 pixels in bin k.
- SOFT: S = max over k of |C(k+1) - C(k)| / A, require S <= 0.25 (unchanged). A hard step gives about 1.0; a linear ramp over n.L width w gives S = 0.02 / w, so S <= 0.25 means a transition at least 0.08 wide in n.L (about 25 px at the default view). If A <= 0 both FAIL; never divide by zero.
  Applicability (a pure function of geometry only, unit-tested, computed and PRINTED before any measurement): an azimuth is evaluated iff (i) the n.L = 0 crossing on the projected-sun axis is at r/R <= 0.95, (ii) the Ld band and the Ln band each have >= 1000 pixels in D95, (iii) each of the 20 bins has >= 200 pixels in D95. Otherwise report "terminator not in view" (never pass, never silently skip). The default view MUST be evaluated (assert). At least 3 evaluated azimuths including the default; if fewer, STOP and report (do not lower the bar).
  Unchanged: night fraction by the same luma definition, 10-30 % at the default view; night mean luma >= 4/255 at all 12 azimuths. RETIRED (reason goes into SPEC.md): width >= 6 % R and the 16/255 step; keep their values as INFORMATIONAL columns; add a source guard so no test asserts them; remove them from the live gate code.
  Replace the existing 3.4 tests (default and 12-az) with the new definition. The pure function takes (image or capture, geometry) and never touches the scene.
  Unit tests (the same function, synthetic curves): hard step (J = A) FAILS SOFT (S about 1); linear ramp over n.L width 0.06 FAILS (S about 0.33); width 0.10 PASSES (S 0.2); smooth ramp over width 0.40 PASSES (S about 0.05); flat (A < 25) FAILS VISIBLE; night lifted so Ld/Ln < 3 FAILS VISIBLE; A <= 0 FAILS without NaN; a band with too few pixels gives NOT EVALUATED; the oracle of D2 reproduces 0.830 / 0.614 / 0.957 within 0.002.
  Real render: if the default view fails VISIBLE or SOFT, or any evaluated azimuth fails, STOP and report the full 20-bin curve, Ld, Ln, A, S and the counts; do NOT change definitions or thresholds. (From the audit expect about Ln 5.2, Ld 62.3, A 57; these are information, not gates.)

N6 NEGATIVES (control passes in the same test; assert the SIGNAL). COMMIT.

- N6 hard step: offline mutation of the REAL default capture: every disc pixel with n.L in [-0.10, +0.30] is set to grey Ld (if n.L > 0) or grey Ln (if n.L <= 0), using the control's Ld and Ln. Expect S >= 0.6, SOFT FAILS, VISIBLE still passes.
- N6b flat: every disc pixel with n.L > -0.15 set to grey Ln. Expect A < 25 and VISIBLE FAILS.
- N6c real render defect through acquire(): a white AmbientLight, intensity 3.0, added at the scene root (needsUpdate once). Expect Ln up versus the control and VISIBLE FAILS. If it does not fail, STOP and report the numbers; do NOT tune the intensity.
- A synthetic smooth ramp (width 0.40) passes the same function in the same test.

F7B CLOSE. COMMIT.

- docs/globe-look/SPEC.md: replace the 3.4 row (definition, thresholds unchanged, measured values, negatives N6 / N6b / N6c); state D1-D3 and the retirement of width >= 6 % R and 16/255; correct the "NOT met" section; remove the orthographic hint wherever it appears. Update docs/E2E.md (test counts, durations) and docs/3B-1-STATUS.md.
- Run: kill orphans; full gate; pnpm e2e:look; the full pnpm e2e (batched) once; all green, no skip, no fixme, 0 retries expected (report any). Tree clean; paste git log --oneline -16 and git status --short.

FINAL REPORT (then STOP): P0 git log; P1 inventory diff and the explanation; P2 old and new N9 assertion; F5 evaluated set (printed before measuring) and per evaluated azimuth: crossing r/R, pixel counts, Ld, Ln, A, Ld/Ln, S, headroom 0.25/S, the bin with the largest step, plus the old width and step as informational; N6 / N6b / N6c numbers (defect vs threshold vs control); e2e:look and full e2e counts per file and durations; anything NOT met.
END OF PROMPT 2B-C2B-P2FIX
