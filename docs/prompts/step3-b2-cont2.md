TASK 2B-STEP3-B2-CONT2: second continuation of 2B-STEP3-B2 after the C3 audit stop. Read docs/prompts/step3-b2.md and docs/prompts/step3-b2-cont.md first. The last line of this prompt is END OF PROMPT 2B-STEP3-B2-CONT2. Quote it in your first message.

STATE: HEAD 4787efb. Done: P0, A, B, P0', A2. Your grep found that camera-golden.spec.ts relies on |target()| > 0.02 to detect a flight start, which times out in Live mode under the new Face-Pin logic. You recommended a second waiver (W2) to make the start signal and target assertion mode-aware. I accept Option 1.

AMENDMENT 6: WAIVER W2 (camera-golden.spec.ts).

You are granted a strict waiver to edit tests/e2e/camera-golden.spec.ts.

Make the flyTo() start signal mode-aware: in locked mode, keep polling |target()| > 0.02. In live mode, poll for a change in the camera's direction/quaternion or the \_\_frame.focus state.
Make the target assertion mode-aware: in locked mode, assert against the fixture as before. In live mode, assert the target is exactly [0, 0, 0] within 1e-6, and exclude target from the fixture comparison.
Do not change the locked mode logic. This counts as the ONLY other permitted existing-spec edit alongside W1.
RULES AND STOPS UNCHANGED: All rules, STOP conditions (S1, S3, S4, S5, S6, S7, S9), and formatting constraints from step3-b2.md and step3-b2-cont.md remain in force. No git add -A.

STEPS

P0'': git log -1 must be 4787efb. Clean tree, orphan sweep. Commit this prompt alone as docs/prompts/step3-b2-cont2.md.

C: Resume step C. Apply the director policy (locked legacy branch moved verbatim, live uses facingPose; fit in all states; RETURNED; viewIsDefault). Apply W1 (frame.spec.ts F8 edit) and W2 (camera-golden.spec.ts edits) in a single commit or two clearly marked commits. Regenerate ONLY the live golden entries with UPDATE_GOLDEN=1 (locked entries byte-identical). Prove S1 (2 processes), S3, S4, scene-gate, limb, frame.spec (only W1 changed), frame-director unedited, markers (new legacy marker 0 in dist, >= 1 in dist-e2e). Gate, commit.

D: Reset control (header right cluster, aria-disabled when viewIsDefault, rects identical, unit test). Gate, commit.

E: tests/e2e/focus-ux.spec.ts with U1-U10 (using revised AM2-AM4 rules). Register with count. 2 separate runner processes. Gate, commit.

F: docs (E2E.md, STEP3-STATUS.md, STEP3B2-DESIGN.md as-built with C3/W2 noted). One commit.

G: full gate, one full batched e2e, copy the summary JSON immediately, per-file table, isolated rerun of every red test, N10 by the known-red rule.

REPORT AT END: quote the sentinel; commits; W1 and W2 diff stats; S1, S3, S4 proof lines; markers; per-region U1 table (angle error, px error); U2 numbers (radius vs rMax, centre error, margin to free rect, CLAMPED case); U3; distance traces for S8(a) and S8(b); U5-U9 results; unit test count; the full-run table with correct arithmetic; deviations. STOP after G.

END OF PROMPT 2B-STEP3-B2-CONT2
