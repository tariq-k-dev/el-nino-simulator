Working Directory: /d/Dev/Handshake/Build-an-Interactive-Data-Visualization

PROMPT 2B-STEP3-MOBILE2 - Responsive layout refinement: compact Header everywhere, free-rect camera framing, dMax unclamping, landscape dock, tablet portrait, sheet typography

You are Hermes working in the Super El Nino simulator repo (the current working directory, the ONLY repo). Baseline: HEAD f7a8332 (MOBILE1 closed, mobile-sheet.spec 15/15, unit 1020). Save this prompt verbatim as docs/prompts/step3-mobile2.md and commit it ALONE as P0 (git add that path only).

GLOBAL RULES

Gate before every commit: pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p).
Never git add -A. Stage explicit paths. One commit per step.
Running out of budget is NOT a STOP. Commit what is done and continue. Only the STOP conditions below stop you.
Never commit an intentionally red test. Each commit updates, in the SAME commit, every mobile-sheet.spec assertion it invalidates, and runs mobile-sheet.spec isolated before committing. Run the full batched run once, at the end.
Locked specs (the 7 locked, including globe.spec): diff against 5e7c826 must stay empty. N10 stays the documented known-red.
Desktop (width 1024 or more AND height 600 or more) must be bit-for-bit unchanged: S1 ref.spec residual 0 with sha 934ecd13...d29a44 in 2 processes, the 15 S7 layout rects, header 118.25 px, goldens at 1024x768, 1280x800, 1440x960, camera.view null, dMax 5, the desktop Header file untouched.
Single writer: ONLY CameraDirector.tsx writes camera state, setViewOffset, clearViewOffset, updateProjectionMatrix, controls.maxDistance and controls.minDistance. Layout code only publishes values to the store. Extend the singleWriter.test.ts guard to cover controls.maxDistance and controls.minDistance if it does not already, with a negative fixture.
Zero new runtime dependencies. No hiding of the Header with CSS: the Header is mode-gated in React, not display none.
Keep replies and the final report short.
TARGET DESIGN (what the user sees)
A. Layout mode is a total function resolveLayoutMode(w, h) on the layout viewport, evaluated in this order:

phoneLandscape if w < 1024 AND h < 600 AND w > h
portrait if w < 768 OR (w < 1024 AND h > w)
desktop otherwise
Expected: 390x844, 412x924, 360x640, 375x667, 430x932, 320x568, 768x1024, 820x1180, 960x1440 are portrait. 667x375, 844x390, 924x412, 932x430 are phoneLandscape. 1024x768, 1280x800, 1440x960, 1024x1366 and 1280x500 are desktop. Accepted gaps (document, do not fix): 768..1023 wide landscape with h >= 600, square 768x768 and 900x900 (desktop), 1024x1366 (desktop). 600x600 is portrait. Compute the mode from innerWidth and innerHeight on resize and orientationchange, coalesced to a requestAnimationFrame, and also synchronously at store init so there is no first-paint flash. Expose it as the data-layout-mode attribute on the app root.
B. Header: the compact Header (HeaderCompact) renders in portrait and phoneLandscape and shows the h1 (always fully visible, wraps up to 2 lines, never ellipsised or clipped), the unit toggle, Snapshot, Reset View, and the ENSO status chip. The subtitle is sr-only on compact. Exactly ONE Reset View, ONE unit toggle and ONE Snapshot in the DOM per mode (this removes the ghost duplicate icon). All controls are at least 44 px touch targets and do not overlap each other or the h1. Padding-top is env(safe-area-inset-top). Portrait is two rows (h1 plus controls, then the chip); phoneLandscape is a single row. The floating island (TopIsland) is DELETED, with its tests and imports.
The ENSO chip shows the formatIsland text and fits on one line down to 320 px. Tapping it opens a scrubber popover just below the header. The popover floats above the canvas and never changes layout or the free rect. The anomaly shown honours the unit toggle with a DELTA conversion (multiply by 1.8, no +32); the category always uses degrees C. While the popover is open a capture-phase Escape closes ONLY the popover (not the region). A pointerdown outside closes it.
C. Free rect and framing (published to the store, consumed only by CameraDirector):
headerBottom: measured with a ResizeObserver on the compact header (getBoundingClientRect().bottom), published when it changes by 0.5 px or more.
portrait: left 0, right W, top headerBottom, bottom peekTop = H - peekVisible, with peekVisible = max(0.18 H, 112 px + safe-area-inset-bottom). cx = W/2. mid = (top + bottom)/2. halfTop = 0.52 H. cy = min(mid, halfTop - 28), so a face-pinned pin stays visible in Half.
phoneLandscape: dockW = min(clamp(320px, 38vw, 400px), 0.5 W), docked RIGHT. Rect left 0, right W - dockW, top headerBottom, bottom H. cx = right/2, cy = (top + bottom)/2.
radius budget Rb = min(cx - left, right - cx, cy - top, bottom - cy) - 12 px, with a floor of 40 px. The envelope is max(pin envelope re 1.10242, the atmosphere limb outer radius). dContain is computed with the EXISTING d_contain function from Rb and the envelope (do not re-derive the law). dFit equals dContain in non-desktop modes (no clamp).
view offset generalised: setViewOffset(W, H, ox, oy, W, H) with ox = W/2 - cx and oy = H/2 - cy. The sub-window keeps the full W x H, so the zoom is unchanged and the disc stays a circle (lens shift). The signs must be proven by measurement. Project the controls target and require its screen position to equal (cx, cy) within 1 px in every mode, flipping a sign if needed.
dMax is unclamped ONLY in non-desktop modes: dMaxMode = max(5, 1.25 * dContain). controls.maxDistance is set only by the director. Desktop dMax stays 5 (the 1024x768 clamp flag stays open and untouched). The globe at the default view fits inside the free rect with at least 8 px margin on all four sides (so no clipping horizontally or vertically), and the user can zoom out to at least 1.2 * dFit.
Audit and fix every distance-dependent assumption for distances up to about 1.25 * dContain: camera far (it must exceed maxDistance + 2), near, fog, atmosphere and limb shader, sun distance, label scale, pin proxy clamp (14 px, or 22 px for pointer: coarse), spin or autorotate speed, minDistance.
Mode change at runtime (rotation, resize): the director re-fits with no animation, keeps the camera DIRECTION and the selected region, and sets the distance to the new dFit if the view was default; clamps otherwise. The sheet tier resets to peek on every portrait entry.
D. Sheet and dock:
Portrait sheet: tiers unchanged (half 0.48, full 0.88), peek as in C. The header zone WRAPS instead of truncating, so GLOBAL ENSO STATE reads in full at 412x924 in Peek and Half. The sparkline is fixed 72 px and flex-none. The region pill and anomaly badge wrap onto a second line. No text-overflow ellipsis on the title. On tablet portrait (width 640 or more) the sheet is max-width 640 px and centred, and canvas touches outside it still reach OrbitControls.
Extract SheetBody (the Half and Full content, including the in-drawer region switcher from FIX2 and the same selectRegion path) so the sheet and the dock share it. Do not change the desktop drawer rendering.
phoneLandscape: LandscapeDock docked right, full remaining height below the header, no tiers and no drag, scrollable (touch-action pan-y, overscroll-behavior contain, overflow-y auto), showing the SheetBody. Both the sheet and the dock are outside the R3F event source, exactly as before, so taps on them never trigger onPointerMissed.
Z-order: the popover is above the header, which is above the sheet and dock, which are above the hotspot labels, which are above the canvas.
E. Desktop never renders HeaderCompact, SheetBody wrappers, the dock or the sheet.
STEP P1 (read-only audit, docs only): write docs/MOBILE2-AUDIT.md with file and line references:

HEAD hash, current file names for the MOBILE1 pieces (layout store fields, SnapSheet, TopIsland, ensoHud, the CameraDirector offset code).
The desktop Header structure: where the unit toggle, Snapshot and Reset View live, how state flows, and whether they can be shared by a second header without changing the desktop DOM, rects or pixels.
Where the ghost duplicate Reset comes from (read only).
Whether the anomaly display has a unit conversion today and how it converts.
The d_contain, d_fit and dMax code, every d-dependent item from C, and the camera near and far values.
Where the atmosphere outer radius is defined.
The globe.spec 375x667 pinch-origin heuristic (read only, do NOT edit).
How Snapshot renders (does it include the view offset?). Measure only and report, do not fix.
Any text inputs in the app (keyboard-driven resize risk), the viewport meta (viewport-fit cover), and the DPR cap.
Baseline measurements at 390x844, 412x924, 360x640, 320x568, 768x1024, 960x1440, 924x412 and 667x375: disc radius in px, centre, free rect, d, dMax, header height.
STOP conditions (report and stop, no code): (a) sharing the controls would change a desktop rect or pixel; (b) the director's fit cannot take a generic free rect without changing the desktop S1 residual or goldens. Otherwise continue.
STEP A (pure logic plus unit tests, no UI): resolveLayoutMode, computeFreeRect (portrait and phoneLandscape, as in C), radiusBudget, dockWidth, peekVisible, anomalyDeltaUnit (x1.8), with these constants in one module. Unit tests: the full viewport table above plus boundaries (767x1024, 768x1024, 1023x1024, 1024x768, 1023x599, 1023x600, 1024x599, 600x600, 768x768); the free rect and Rb at 390x844, 320x568, 960x1440, 924x412 and 568x320; the peek clamp; the dock cap; the delta conversion (+1.5 C gives +2.7 F, -0.5 C gives -0.9 F).

STEP B (header and chip): store fields (mode, headerBottom), HeaderCompact, EnsoChip, scrubber popover, ResizeObserver publisher, TopIsland deletion; update mobile-sheet.spec M1 and M9 in the same commit. The desktop Header file is not touched.

STEP C (camera, CameraDirector only): consume the free rect; the generalised offset; dContain and dFit; dMaxMode and controls.maxDistance; the d-dependent fixes; the re-fit on mode change; the guard extension with a negative fixture. Update M2 and M4 in the same commit.

STEP D (sheet and dock): the peek clamp; the header zone wrap; the sparkline; the tablet max-width; SheetBody extraction; LandscapeDock; the tier reset on portrait entry.

STEP E (e2e): update mobile-sheet.spec (M1 matrix with the 767, 768 and 1023 boundaries, M2 free-rect centre, M4 peek clamp, M9 header chip) and add tests/e2e/layout-matrix.spec.ts, registered in the batched runner (timeout rule 2x measured wall, floor 120 s). Use CDP touch for drags as in MOBILE1. Cases over the viewport table (390x844, 412x924, 360x640, 375x667, 430x932, 320x568, 768x1024, 820x1180, 960x1440, 667x375, 844x390, 924x412, 932x430), plus desktop controls:

LM1 mode table: data-layout-mode matches the expected mode for every viewport.
LM2 header: the h1 is fully visible (inside the viewport, scrollWidth not greater than clientWidth, computed text-overflow is not ellipsis), no pairwise rect overlap among the h1, controls and chip, exactly one Reset View, unit toggle and Snapshot in the DOM, header bottom equals the published headerBottom within 1 px, targets at least 44 px.
LM3 framing: the projected disc and the envelope lie inside the free rect with at least 8 px margin on all four sides, and the free rect lies inside [headerBottom, peekTop] (portrait) or left of the dock (phoneLandscape). Nothing is clipped at the canvas left and right edges.
LM4 zoom-out headroom: maxDistance is at least 1.2 * dFit, zooming out reaches maxDistance, camera far exceeds maxDistance + 2, the globe is not clipped by the far plane at the maximum, and zoom-in works.
LM5 portrait selection: with a region selected and the sheet in Half, the face-pinned pin projects at y at most halfTop - 20 and elementFromPoint there is the canvas or a label, not the sheet or header. Pointer-miss on a sheet tap does not clear the region.
LM6 phoneLandscape: the dock exists with its width inside the clamp and the 0.5 W cap, is right-aligned, scrolls by touch (scrollTop increases, camera pose unchanged), has no tier handle, the region switcher chip selects a region, and the desktop panels are absent from the DOM.
LM7 rotation: 390x844 to 844x390 to 390x844 at runtime: the mode follows, exactly one Reset each time, the selected region and camera direction survive (error at most 0.1 degrees), the offset is correct after each change, and the tier is peek after returning.
LM8 desktop controls: at 1024x768, 1280x800 and 1440x960, camera.view is null, dMax is 5, the header is 118.25 px, and no compact header, sheet or dock exists.
LM9 chip: the chip text equals the live store value, opening the popover leaves the disc centre and radius unchanged within 0.5 px, the unit toggle to F shows the delta (1.5 C is +2.7 F), Escape closes only the popover and leaves the region selected, and an outside pointerdown closes it.
Sheet typography: at 412x924 in Peek and Half the sheet title text is complete (no ellipsis, scrollWidth not greater than clientWidth, full text GLOBAL ENSO STATE present).
Also run, REPORT ONLY, without editing: globe.spec pinch at 375x667. Report whether the compact docked header turned it green, and if not, the measured origin and the blocking element.
Probe fields and marker follow the existing convention: new marker mobile-layout-probe-3m2 (0 in dist, present in dist-e2e).
Then run the full batched run once and record counts and the archive path.
STEP F (docs): update docs/MOBILE.md (modes, free rect formulas, dMaxMode, dock, the single-writer list, accepted gaps, the Snapshot finding). Append short notes to docs/E2E.md and docs/STEP3-STATUS.md only.

NOT IN SCOPE: desktop layout or dMax changes, N10, 1024x1366 portrait switching, renderer or DPR changes, tier-aware offsets, deploy or _headers, editing any locked spec.

FINAL REPORT (short) must include:

Sentinel, HEAD hash, commit list.
The mode matrix table (viewport, mode, header bottom, free rect, Rb, dFit, dMax, disc radius, margins).
The measured offset signs and target screen position per mode.
maxDistance divided by dFit per viewport, camera far, and the d-dependent audit result.
Single Reset per mode, h1 unclipped, pin visible in Half, and the sheet title unclipped at 412x924.
The globe.spec 375x667 result (without editing) and, if red, the measurement.
S1 residual 0 and sha in 2 processes, 15 rects identical, goldens, camera.view null on desktop.
singleWriter guard and negative fixture result, marker counts.
Unit and e2e counts (passed, failed, skipped, expected; N10 known-red only), file count, wall time, archive path. The unit count is above 1020.
The Snapshot finding and any deviation from this prompt, disclosed.
END OF PROMPT 2B-STEP3-MOBILE2