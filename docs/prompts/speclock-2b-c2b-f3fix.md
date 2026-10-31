TASK 3B-1a-SPECLOCK-2B-C2B-F3FIX v1. Repo: cd D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (ONLY repo).
FIRST confirm you can see the last line "END OF PROMPT 2B-C2B-F3FIX"; if not, STOP and say so. Prerequisite: E0 (1fb4580), F1 (4d55d4d), F2 (eb7550d) accepted.
Rules as in C2B: gate = pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p); one commit per step; STOP on real failures and report numbers; never tune a threshold; no test.skip / test.fixme; at most 12 tool calls per step; if low on turns commit what is green, update docs/3B-1-STATUS.md, STOP. Do NOT amend or rewrite existing commits. Report raw tables.

DECISION (Tariq, final): the approved and shipped look is specularIntensity 0 (commit 38aa091). The only glint is the specular overlay shader. Tariq ACCEPTED this attenuated look. The value 0.18 belongs to the pre-fix state (the Dt column) and must not appear as a "current" state anywhere in code, comments or tests. The recorded Do numbers (max 88.52, area6 9594) were measured as F[si 0, overlay on] minus F[si 0, overlay off], so they describe exactly the shipped state and should reproduce as is.

G0 HYGIENE AND PROMPTS: kill orphan processes (only ms-playwright and stale runners of this repo; never the user's own Chrome). Then commit all of docs/prompts/\*.md as one docs-only commit "docs: prompts" (the C2B prompt told you to commit them; they are not meant to stay untracked).

G1 STALE COMMENTS AND DOCS

src/scene/globeLook.ts near line 126: replace the comment that says the term is "back at 0.18" with: specularIntensity is 0 BY DESIGN since 38aa091 (the GGX lobe clipped pixels at grazing angles; 0.18 gave 49 clipped px in the worst case); the visible glint comes only from the surface overlay shader (flag specular); Tariq accepted this attenuated look. Do NOT change any value.
grep -rn "0.18" and "back at" across src, tests and docs; list every hit; fix the ones that describe 0.18 as the current or shipped state; keep historical measurements but mark them (for example a header line in docs/globe-look/glint-diffs.md: Dt and Dm were measured with si 0.18 = pre-fix; the shipped state is si 0, so the current glint is Do).
COMMIT (comments, docs and test descriptions only; gate green).
G2 measureSpecularMask

Remove the hardcoded specularIntensity(0.18) override. New definition: mask = pixels where |luma(F_as_shipped) - luma(F_all_specular_off)| > 3, dilated 8 px. F_as_shipped = the render in the state found at acquisition (shipped: si 0, overlay on). F_all_specular_off = si 0 and overlay off. Compute it BEFORE any defect is installed, so negative tests never change the mask. Update the unit tests.
Report the mask pixel count: old (forced 0.18) vs new (as shipped). Then re-run spec 3.3 and N4 only and report: whether W1 is mask-excluded (it must not be), the N4 control ratio (was 0.998) and the defect ratio (was 3.426). If 3.3 or N4 changes verdict, STOP and report.
COMMIT.
G3 F3 REPRODUCTION AS SHIPPED

Add helper assertShippedLook(page): reads the live Earth specularIntensity and the overlay flag and compares them with the committed values in globeLook.ts; F3 calls it before measuring and fails loudly "not the shipped state" if they differ, so a forced override can never slip in again.
Conditions otherwise unchanged: azimuth 0; flags stars false, pins false, rings false, clouds true; clock frozen; 1280x800; R_fit from fitLimb. F_current = the render exactly as shipped (do NOT set specularIntensity anywhere). F_off = overlay off, specularIntensity 0. D = luma(F_current) - luma(F_off).
Report max(D), area6 (count of D > 6), centroid, centroid r/R, max location. Expected about 88.52 and 9594 (within 3%), centroid near (780.8, 376.0), r/R about 0.4388. If either differs by more than 3%, STOP and report the exact conditions; do not write a gate.
G4 F3 GATE + N9/N10 (only if G3 reproduced)

Constants in tests/e2e/look/glintConstants.ts with the comment "regression sentinel of the accepted look (Tariq ACCEPT, V2 attenuated, shipped si 0)". Gate windows from the RECORDED values: max(D) in [70.8, 110.7]; area6 in [6716, 12472]; assert valid inputs (disc found, no NaN).
N9: overlay OFF -> the sentinel FAILS (max near 0). N10: Earth specularIntensity 1.0 and roughness floor 0 -> the sentinel FAILS (max above 110.7 or area6 above 12472). Assert the signal direction; the control passes in the same test.
COMMIT.
PART 1 CHECKPOINT AGAIN: full gate; pnpm e2e:look green (no skip, no fixme); git status clean; update docs/3B-1-STATUS.md; STOP. Part 2 (terminator audit and redefinition, batched runner, close) will be re-sent.

FINAL REPORT: commits and gate results; G1 hit list; G2 mask counts and the 3.3 / N4 results; G3 reproduction table; G4 constants and N9 / N10 values (defect vs window vs control); e2e:look counts; anything NOT met.
END OF PROMPT 2B-C2B-F3FIX
