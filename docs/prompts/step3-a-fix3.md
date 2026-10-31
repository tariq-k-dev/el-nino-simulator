TASK 2B-STEP3-A-FIX3: re-specify N10, verify the legacy suite, finish the reference frame. Read the whole prompt first. The last line is END OF PROMPT 2B-STEP3-A-FIX3. Quote it in your first message.

CONTEXT: HEAD dec1745 or later. Both uTime gates (Globe.tsx and Hotspot.tsx, frozen at 0 through src/scene/lookTime.ts) stay applied; do not revert them. Facts from your diagnostic: with the Hotspot gate applied N10's defect reads max 87.5204 / area6 9401 every run, at the control glint pixel [781,374], where the defect frame equals the control frame; the defect does land (si 1, roughness 0, material version bumped) and adds up to 249.9 luma at [344,390], but the 3.9 metric does not see it; the Hotspot-ungated variants give erratic values (201.72, 185.08, 165.68, 87.52) at scattered pixels while uTime moved only 0.06 s. Conclusion: in a deterministic frame the 3.9 amplitude metric is blind to this defect, so the old N10 pass was an intermittent artifact. Masking pins cannot help (a mask can only lower a maximum), so it is NOT to be done. Decision (Tariq and advisor): N10 gets a frame-identity detector. This is the THIRD post-measurement definition change and must be disclosed. No look threshold or window changes anywhere (the 3.9 windows 70.8-110.7 / 6716-12472, sentinel 88.52 / 9594, A >= 25, Ld/Ln >= 3, S <= 0.25, S_real < 0.6, the 0.95 bound, rim and pin windows).

RULES: Repo D:\Dev\Handshake\Build-an-Interactive-Data-Visualization only. One commit per step. Never amend, never rewrite history. Lint and commit in separate cells. Gate exactly: pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p), one gate per cell. E2E only through the batched runner or Playwright launched with Popen and an argv list as in docs/E2E.md; poll cells under 240 s. Before every e2e run print the top CPU processes; if jetbrains-toolbox, python jobs or other heavy processes are running, say so in the report. Verify the stamp (srcHash) of dist-e2e against the source tree before reading any result; never hand-replace files in a served bundle without rebuilding and checking the stamp. Progress goes in docs/STEP3-STATUS.md after each step. At most 15 tool calls per step. On any failure STOP and report instead of guessing. If running low: commit what is green, update the status file, stop.

P0 PREFLIGHT: git log -1 is dec1745 or a descendant; git status shows only the known untracked files; orphan sweep; commit this prompt alone as docs/prompts/step3-a-fix3.md.

D7 CONFIRMATION (read-only, no commit until the doc at the end of E1). In the real N10 harness (not your repro):

Print how measureGlint defines its region of interest and mask for D, and whether the point [344,390] and the limb pixels near [327,488] are inside it.
​2. Unfrozen variant (Hotspot parent, Globe fixed or parent, whichever you can rebuild with a verified stamp): six N10 runs. For each run with defect max > 110.7 print the argmax, the distance in px to each projected pin centre (all four pins, valid and invalid, from \_\_globe.project), the nearest pin name, and the defect-minus-control difference at that pixel. Also print the defect max with a mask of radius 45 px around every projected pin. Classify without prejudice: pin-carried (every passing run has its argmax within 45 px of a pin and its pin-masked max is at or below 110.7) or unexplained intermittent. This classification only changes the wording of the disclosure, not the plan.

Restore HEAD exactly, rebuild, verify the stamp.

E1 N10 RE-SPEC (one commit, tests only; keep the N10 title unchanged so the inventory guard holds).

In the frozen state (look.animate false, both uTime gates), capture the control (shipped) frame twice in one page and once after a fresh page load. Required: control-vs-control residual exactly 0 for all pairs (max |dLuma| 0, 0 pixels differing). If not exactly 0: STOP and report the residual.
​2. Apply the defect (existing N10 defect engine, unchanged) and capture the defect frame. Compute the residual image defect-vs-control over the globe disc (fitLimb radius). Pre-registered assertions, fixed now before you look at the data: control-vs-control max |dLuma| equals 0; defect-vs-control max |dLuma| greater than 8 AND the number of pixels differing by more than 6 is at least 100. Print the measured values next to the thresholds (expected about 195 luma / 5000 px).

Print the effect precondition in the test output (specularIntensity, roughness floor, material version before and after) and assert it: if the defect did not land, fail with a precondition message, not an effect message.

The 3.9 reading under the defect (max, maxAbs, area6) is printed as an information line but NOT asserted in N10, with a code comment explaining why (3.9 measures overlay amplitude and is blind to si 1.0 in a deterministic frame). N9 and the 3.9 sentinel test are not touched.

Show the new N10 bites and does not false-fire: run it with the defect NOT applied (must fail with "defect not detected", expected defect-vs-control 0), then with the defect applied (must pass). Do not commit the no-defect variant.

Gate, commit.

B2 LEGACY VERIFICATION. Run pnpm e2e:look through the batched runner. Required: 28/28, zero retries, git diff of tests/e2e shows no change to any threshold or window other than the N10 acquisition in E1. Print the raw numbers that moved because the frozen phase changed: the 3.1 rim table, the 3.5 pin core RGBs day and night, the 3.6 ring luminance values, the 3.9 sentinel (expect 88.52 / 9594), N9 and N10. If any asserted window is violated or any spec fails: STOP and report; do not touch a threshold. Add a disclosure section to docs/SPEC.md: (a) the frozen-state phase of the breathe and pin pulse is now the fixed constant 0 (live product unchanged because look.animate is true there); (b) the third definition change: N10 now detects by frame identity, with the reason and the pre-registered thresholds; (c) the D7 classification of the old N10 pass; (d) the list of raw numbers that moved and by how much. Write docs/STEP3-DIAG.md addendum with the D7 tables. Commit the docs.

B3 REFERENCE FRAME.

Finish tests/e2e/ref.spec.ts: it only ASSERTS by default and fails if the PNG is missing. The PNG is written only when UPDATE_REF=1 is set, never on mismatch. Rule (already registered): the residual must be exactly 0, since the F/F matrix gave 15 of 15 exact zeros.
​2. Generate the PNG (732x732 crop, globe disc plus 40 px; budget 800 KB, raised by Tariq because cropping removes the cheap sky; state the reason in the file header comment and docs). Then verify it in a SEPARATE later Playwright process; residual must be exactly 0.

Show the guard bites: through the existing hooks perturb the camera distance by 0.5 percent and show the spec fails with the residual printed. Revert, do not commit the perturbation.

Register ref.spec.ts in the batched runner (expected test count, FILE_TIMEOUTS_MS at 2x its measured duration; also raise any file whose measured duration under load exceeded 1.5x and say which), the inventory guard, and docs/E2E.md, including the regeneration command and that the PNG is SwiftShader-specific. ref.spec belongs to the full e2e only; e2e:look stays 28 tests. Gate. Two commits: helper, spec and PNG; then the registration and docs.

NOT IN THIS SESSION: the insets registry (step C), the full e2e, FrameOffset, fit distance. They come in the next prompt.

REPORT: quote the sentinel; list every commit hash; the D7 tables and the classification; the E1 measured values against the pre-registered thresholds, the bite output (defect absent fails, defect applied passes) and the precondition print; the e2e:look result with the moved raw numbers table; the reference PNG size and cross-process residual; the 0.5 percent bite output; unit test count; the CPU-load note; the list of throwaway scripts; anything that deviates from this prompt. STOP after B3.

END OF PROMPT 2B-STEP3-A-FIX3
