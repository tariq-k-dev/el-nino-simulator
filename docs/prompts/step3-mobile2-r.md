PROMPT 2B-STEP3-MOBILE2-R (READ-ONLY RECONCILIATION)

Context: Review of MOBILE2 (HEAD 475165b) found three reporting inconsistencies. This prompt changes NO source, test or config file. The only file you may create is docs/MOBILE2-RECON.md, committed alone by explicit path (never git add -A). Do not run the full e2e suite; run only layout-matrix.spec.ts plus throwaway probes kept untracked under .cache/. Repo: D:\Dev\Handshake\Build-an-Interactive-Data-Visualization. Save this prompt first as docs/prompts/step3-mobile2-r.md in its own commit (P0), then proceed.

Rules: measure, do not guess. Every number comes from a run in this session. If a number cannot be measured, say NOT MEASURED and why. No fixes, no proposals implemented; proposals only as text in section R7.

R1 Commit ledger. Run git log --oneline --decorate f7a8332..HEAD. Print every commit hash (7 chars), its label (P0, P1, A, B+C, D, E, F, other) and files changed count. Confirm whether the total is 8. Explain the run-together token 7d7db34bbe7fb4475165b from the previous report and list which commits had no label. Run git status --porcelain and confirm it is empty. Confirm the diff of the 7 locked specs vs 5e7c826 is empty.

R2 The 104 versus 158 question (most important). At each of 390x844, 412x924, 360x640, 375x667, 430x932, 320x568 (portrait) and 667x375, 844x390, 924x412, 932x430 (phoneLandscape), print on one row: (a) DOM header bounding rect bottom, (b) headerBottom as published in the layout store, (c) published free rect as x, top, width, bottom, (d) peekTop, halfTop, cy, radius budget Rb, (e) the exact top and bottom that layout-matrix.spec LM3 used when computing its T and B margins. Then answer in plain words: what is 104, what is 158, and which one is the true header bottom. Name the file and line that produces each value. Re-measure the header bottom at three times (immediately after load, after document.fonts.ready, after 1500 ms) to detect late wrapping. List the height contribution of each header row or element (h1 row, controls row, any wrapper padding, any safe-area inset, anything that is 54 px). State whether the previous table's free rect column was a reporting bug (wrong value printed) or a product bug (published rect differs from real header).

R3 Row 667x375. Using the same projection method as LM3, print the raw disc bounding box (left, right, top, bottom), its centre, the free rect, the dock width, Rb, dFit, the actual camera distance, and the radius in the horizontal and vertical directions separately. Decide whether the previous disc r of 70.7 was a typo, a measurement artefact, or the real rendered size. If the disc really renders at 70.7 px radius, say so plainly (that is a product defect to be fixed later; do not fix it now).

R4 Tablet and square rows. For 768x1024, 820x1180, 960x1440 and 600x600 print the full row: mode, disc r, free rect (x, top, width, bottom), Rb, dFit, dMax, maxDistance divided by dFit, margins L/R/T/B measured against the real rect. No approximate values. Confirm each has maxDistance at least 1.2 times dFit or state the actual ratio.

R5 Offset signs. For 390x844 portrait and 924x412 landscape print the formulas ox = W/2 - cx and oy = H/2 - cy with the numeric values, the exact setViewOffset arguments, and the measured screen position of the camera target versus (cx, cy) in pixels.

R6 Disc fill. For all 17 viewports print r divided by Rb and name the binding constraint (width, upper, lower, header, peek, half-pin rule). Flag any row below 0.75.

R7 Options, text only. If the true header bottom is 158 (not 104) at 375x667, state its share of the viewport height at 320x568, 360x640, 375x667, and list two or three concrete options to reduce it with the cost of each (for example single-row header, h1 plus chip on one row with controls in a menu, smaller type). Do not implement. If 158 is a late-wrapping artefact, say so with the three-time measurement as proof.

Output: write docs/MOBILE2-RECON.md with sections R1 to R7 (tables allowed), commit it alone by explicit path, then print a short final report: HEAD, the three verdict lines (104 vs 158: reporting bug or product bug; 667x375: typo, artefact or defect; all rows disc inside rect with at least 8 px real margins: yes or no with the minimum), git status result, locked-spec diff result.

End with the line: END OF PROMPT 2B-STEP3-MOBILE2-R
