Prompt Step 3B2 FIX1 v1 — runner hardening, Reset semantics, card clicks, pin raycasting, D10 diagnostic

You are continuing the Super El Niño Simulator repo (D:\Dev\Handshake\Build-an-Interactive-Data-Visualization, the ONLY repo). Start HEAD must be 5e7c826 with a clean tree. Read first: docs/E2E.md, docs/STEP3-STATUS.md, docs/STEP3B2-DESIGN.md, docs/prompts/step3-b2.md and step3-b2-cont2.md (they stay in force except where this prompt says otherwise). Gate: pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p). Never git add -A: explicit paths, git status --short before every commit, one commit per step. Report counts as separate passed / failed / skipped / expected. Follow docs/E2E.md for launching the runner (subprocess.Popen with argv, stdin DEVNULL, no shell redirect, poll in cells under 300 s) and archive every summary file immediately, outside the Playwright outputDir.

Close other heavy apps assumption: run e2e only when CPU is quiet; kill any leftover node server of your own before each run.

P0. Verify docs/prompts/step3-b2-fix1.md exists with this text; commit it alone ("P0: step3-b2-fix1 prompt").

GLOBAL RULES

No spec file may be edited except under waiver W3 (below). New tests go in NEW spec files, registered in the runner table.
Locked-mode behaviour, locked goldens, ref.spec (residual 0, sha 934ecd132ee474247136fd429f6442e1d52f1115d46cf1ce50da77b8f4d29a44), globe.spec 5/5 isolated, camera-golden 9, frame 20, frame-director 5, scene-gate 2, limb 2 must stay green and unedited. Rendered pixels must not change (S1 stays residual 0).
The single-writer guard test allowlist (CameraDirector.tsx, cameraIntents.ts, GlobeScene.tsx) must not grow. No new camera writers.
The two markers keep their rules (0 in dist, present in dist-e2e).
No thresholds are changed anywhere (including N10).
STOP and report (do not improvise) if: a locked/legacy spec turns red; S1 moves; a fix would need a rendered-pixel change; a fix would change any of the 15 layout rects of S7; any spec other than focus-ux.spec U5/U6 conflicts with the new Reset behaviour.
STEP A — runner hardening (infrastructure only, no product files)
Problem: in run 1 a boot.spec timeout kill left the server dead, so 38 later tests failed with ERR_CONNECTION_REFUSED (all green in isolation). boot.spec takes about 402 s in batch against a 600 s backstop. A summary file was lost to the isolation runs' outputDir cleanup.
A1. Read scripts/e2e-batched.mjs and report how it starts/stops the server, how the backstop kills, and where it writes the summary.
A2. Fix: on any per-file timeout, kill the WHOLE process tree (Windows: taskkill /T /F) of the file's Playwright process and of its server; confirm the port is free; start a fresh server if the next file needs one. Before every file, run a liveness check (HTTP GET on the server). If the server cannot be restored, mark the remaining files "not-run (infra)" instead of running them into false reds. Never retry tests.
A3. Per-file timeout table: previous wall (from .cache/full3b2/batched-summary-run3.json) times 2, minimum 120 s; boot gets 900 s.
A4. Write each summary to .cache/e2e-archive/<UTC timestamp>-summary.json (outside outputDir, never deleted by any runner or isolation run), and print its path at the end.
A5. Self-test: a flag (for example --self-test) that runs two synthetic specs kept under tests/e2e-selftest/ (NOT in the regular table): one that hangs past a tiny timeout, then a trivial passing one. Prove the second runs green after the kill, the port was free in between, and the summary landed in the archive. Run it twice.
A6. Update docs/E2E.md. Gate must be unchanged (885). Commit: "A: runner hardening".

STEP B — Reset semantics (product fix)
Defect: Reset View resets the camera and resumes spin but leaves the region card/drawer open. Required: Reset returns the app to the exact load state: activeRegion null, drawer closed, state idle, framed default pose at d_fit, userZoomed false, spin resumed.
B1. Grep ALL specs and unit tests for assertions about the state after Reset (regionId, drawer, viewIsDefault, activeRegion). List every hit in your report BEFORE editing. Only focus-ux.spec U5/U6 may need change (waiver W3: at most 10 changed lines, own commit "WAIVER W3: focus-ux Reset assertions"); any other hit is a STOP.
B2. Implement via the same path as the drawer X and Escape (selectRegion(null) in App.tsx) plus the existing reset-view intent when needed (user zoom or user orbit while idle), in one handler. The two must not produce competing returns: the final pose must be identical to the U5/U6 final pose, distance must not dip below the start distance during the return, and no new writer may appear. Reset must be enabled whenever activeRegion is non-null, even if the camera happens to look default (viewIsDefault must be false while a region is open). Keyboard focus must never be left on a removed element.
B3. Unit tests for the button/store/App wiring. New spec tests/e2e/reset-ux.spec.ts: for each of the 4 regions at 1440x900 and 1280x720: open region, click Reset, wait to rest, then assert: activeRegion null, drawer closed (use the selector the existing U5 uses), state idle, direction error against the pre-selection pose <= 0.1 deg, distance within 2e-3 of d_fit, |target| <= 1e-6, userZoomed false, spin true, viewIsDefault true, Reset aria-disabled true. Also: Reset while zoomed with no region; Reset in mid-flight (state focusing) ends in the same load state; compare against a baseline sampled right after a fresh load in the same test.
B4. Commit W3 (if needed) and the fix separately.

STEP C — Impact Zones cards blocked by the open drawer (product fix)
Defect confirmed by Tariq: with the drawer open, mouse clicks on the cards do not reach them (elementFromPoint returns a drawer node; keyboard works).
C1. Audit: for each card centre with the drawer open, record the full document.elementsFromPoint stack, the stacking contexts and z-index values (header z-40, drawer z-30), and pointer-events of the drawer wrapper and panel. Report whether the cards are visually covered by an opaque panel or only blocked by a transparent wrapper/overlay.
C2. If only a transparent or oversized wrapper or a z-order problem blocks them, fix with pointer-events (wrapper none, panel auto) or stacking, WITHOUT changing any layout rect (S7: the 15 rects must be identical). If the cards are visually covered by the drawer panel, or any fix would change a layout rect, STOP and report options (do not choose).
C3. New spec tests/e2e/cards-ux.spec.ts (real page.mouse clicks, after asserting elementFromPoint is the card or a descendant): with the drawer open, clicking each OTHER card retargets to that region and the drawer stays open; clicking the current region's card is a no-op (no close, no restart); keyboard activation still works; drawer X, Escape and pointer-miss still close. Run at 1440x900 and 1280x720 (1024x768 excluded, known layout debt).
C4. Commit.

STEP D — pin click reliability (product fix)
Defect: clicking pins on the globe is hit-or-miss at certain rotation angles.
D1. Measure BEFORE changing anything. New diagnostic spec tests/e2e/pin-click.spec.ts, first as a measurement: for each of 4 regions, sweep the globe azimuth over 0..330 deg in 30 deg steps (spin pinned with setSpin(true, 0)); project the pin to screen; classify the pin by dot(pin normal, direction to camera): front (>= 0.15), grazing (0..0.15), back (< 0). Real mouse click at the projected point; record: did the region select, did the pointer-miss handler fire, and the list of R3F intersections at that point (object name, distance). Also a spin-ON test: for each region, 20 attempts, projecting the pin at pointerdown time with a normal 50 ms down-to-up delay; record success rate. Report all failure counts BEFORE the fix.
D2. Test these hypotheses explicitly and report which are true: (a) the pin hit target is too small; (b) an invisible or non-rendering mesh (atmosphere, clouds, halo, hit proxy) intercepts the ray in front of the pin; (c) the globe auto-spin moves the pin between pointerdown and pointerup so R3F drops the click (R3F only fires onClick when the object was also hit at pointerdown); (d) a click after a small drag is treated as a drag by OrbitControls or R3F; (e) pointer-miss fires for hits that were already handled; (f) back-facing pins respond to clicks through the globe.
D3. Fix only what the evidence supports. Allowed tools: a non-rendering hit proxy (zero pixel impact; confirm S1 stays residual 0 and sha unchanged), pausing spin while the pointer is down or hovering a pin, a larger hit radius, raycast filtering or stopPropagation on the proper meshes, an occlusion test so back-facing pins cannot be clicked through the globe. Any rendered-pixel change is a STOP.
D4. Final assertions: front pins 100 percent selected at every sweep angle, with spin pinned AND with spin on; grazing pins reported separately (no assertion, but listed); back pins never select; a pin click never triggers the pointer-miss close.
D5. Commit.

STEP E — D10 diagnostic (READ-ONLY: no product, spec, threshold, or runner-table change; the findings go in one new doc)
Why: N10 (negative.spec, the in-page differing-pixel assertion <= 50) has swung 11-528 px at the same commit: green isolated (24 px), red in every batched run (528 px in the last). maxAbs stays at or below 1.0 luma every time.
E1. Read N10 and report exactly what it renders, what it compares, how many page loads it uses, and every source of nondeterminism it could see (time, spin phase, cloud animation, fresh-load warm-up, GPU/driver, device pixel ratio).
E2. Work in .cache/d10/ only (git-ignored or untracked, never committed). Use a git worktree for BASE 5db822c and for PRE 5e7c826; HEAD is the tree after step D. Remove the worktrees at the end.
E3. Arms, N10 alone (negative.spec filtered to N10), interleaved in the order BASE, PRE, HEAD repeated 5 times (15 runs): record differing px, maxAbs, and the bounding boxes and rough screen locations (limb, terminator, pins, clouds, atmosphere) of the differing pixels; save the diff image of the worst run.
E4. Arm "after heavy file": run look.spec then negative.spec (whole file) at HEAD, twice; record N10. Arm "under load": N10 alone at HEAD x5 while a CPU busy loop occupies all but 2 cores. Arm "warm vs cold": N10 alone at HEAD x3 right after a fresh server start, versus x3 after the server has served a full spec.
E5. Pre-register before running: H1 CPU/GPU load, H2 cold start / shader warm-up, H3 position after a heavy GPU file, H4 code drift between BASE/PRE/HEAD, H5 spin or time phase. Then state which arm discriminates which hypothesis, and conclude with a ranked cause and ONE recommendation (fix the cause, or a pre-registered redefinition of the px criterion). Do not apply it.
E6. Write docs/D10-REPORT.md (tables, diffs described, conclusion) and commit it alone.

STEP F — docs and the full run
F1. Update docs/E2E.md, docs/STEP3-STATUS.md and docs/STEP3B2-DESIGN.md (Reset semantics, card fix, pin fix, as-built). Commit.
F2. Gate. Then ONE full batched run with the hardened runner (expected tests: 112 + the new ones). Archive the summary path. Classify N10 by the known-red rule (maxAbs <= 1.0 and only the differing-px assertion failed). Any other red: rerun that file in isolation first and report both results; do not hide the batch result.
F3. STOP after F. No 3C (sun Option A, reduced motion), no mobile layout, no \_headers work, no N10 threshold change.

REPORT FORMAT: quote the sentinel; commit table; the grep lists from B1 and the C1 stack dump; before/after numbers for D1 versus D4 and the hypothesis verdicts D2; S1 two-process proof; golden/locked/globe proofs; marker greps; 15-rect proof; unit test count (885 + new); counts per file as passed/failed/skipped/expected; N10 classification; the D10 conclusion; a list of every deviation from this prompt.

END OF PROMPT 2B-STEP3-B2-FIX1
