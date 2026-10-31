TASK 3B-1a-SPECLOCK-2B-C1-FIX (documentation + read-only measurements). Repo: cd D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (ONLY repo).
FIRST confirm you can see the last line "END OF PROMPT 2B-C1-FIX"; if not, STOP. NO changes to code, tests or thresholds. One commit. <= 10 tool calls; never tune anything.
Gate before commit: pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p). For measurements run `pnpm build:e2e && <spec>` chained, and check `grep -rl "__look" dist/assets/` is non-empty first.

F1 CORRECT docs/globe-look/FACTS-2B.md (measure with the existing harness; report tables in the doc AND in your reply):
 (b) PACIFIC PIN. The sentence "Two points at one world radius cannot project to 1.1013 and 1.0017" is FALSE (projected radius depends on the angle from the view axis) and the heading
     "not a floating pin" contradicts the data. Replace the verdict with: the pin anchor floats BY DESIGN at |pos| = anchorRadius x idleLift + coreOffset = 1.10242 R
     (cite file:line of the three constants); __globe.project is correct. Show the manual check for Pacific at az 0: lateral = |p|*sqrt(1-ndotcam^2), depth = d - |p|*ndotcam,
     r/R = (lateral/depth) / (1/sqrt(d^2-1)), and compare with the harness value. Add a table for all 4 pins at az 0 AND az 180: projected (x,y), n.cam, r/R of the CORE,
     r/R of the SURFACE POINT (same direction at radius 1.0), and the px lift between them. State plainly: floating pin, not a harness error; valid-pin rule r/R <= 0.97 is a
     conservative proxy (a floating core can be visible outside the disc).
 (c) TERMINATOR. Print the full 12-azimuth table (az, max adjacent 1 px step, offset of the max). Correct "13.69 is inside (12, 12.8]": it is not; ceil(1.25 x 13.69) = 18, not 16.
     Find how 16 was derived (git log -S / the 3.4 spec commit message; compare the old vs the current measurement per azimuth if recoverable from test-results/look or git history;
     else write UNKNOWN). Keep 16; state the headroom 16/13.69. At the default view print day plateau, night plateau, the 90%/10% levels and the measured width.
     Also write explicitly: 3.3 covers W1 ONLY; W5/W8 are on the disc's own bright content (clouds were OFF).
 (d) GLINT. Apply the V1/V2 rule mechanically: peak ratio 0.5395 < 0.60 (V1 not met), area ratio 0.620 >= 0.5 (met) => verdict "V2: glint ATTENUATED, not removed" (retire the label
     "GLINT REMOVED"). Name the overlay: file, component/mesh name, uniform names, how it is enabled. Report max, p99.9, area6, area3, bbox, centroid, r/R for Dt, Dm and Do.
     Confirm docs/globe-look/glint-before-after.png exists, its size, and that the right panel is the CURRENT build. Do NOT try candidates, do NOT touch the shader.
F2 STALE DOCS. docs/globe-look/SPEC.md lines 21-22 and docs/3B-1-STATUS.md line 13 still describe the retired 3.5 RGB windows / a 3.5 FAIL. Rewrite them: 3.5 = semantic gate P1-P4
   (definitions, thresholds, measured table as INFORMATIONAL, the validity rule, the day/night coverage assertion), negative tests N7/N8 "pending C2"; STATUS: 3.5 PASS (semantic),
   N1/N3/N4 still fixme (C2 pending). Then `grep -rniE "185|182|±12|window" docs/ tests/e2e/look` and list every remaining stale mention (fix those in docs; list any in code, do NOT edit code).
F3 Add the untracked docs/prompts/speclock-2b-c1.md to the commit.
COMMIT: "docs(look): FACTS-2B corrections (pin floats by design, terminator table, glint attenuated); SPEC/STATUS 3.5 semantic".
FINAL REPORT (then STOP): commit hash, gate result, the three tables (pins at az 0/180 with surface r/R; 12-azimuth terminator; glint Dt/Dm/Do), the overlay's name and location,
the origin of 16/255 (or UNKNOWN), list of remaining stale mentions, git status --short.
END OF PROMPT 2B-C1-FIX

