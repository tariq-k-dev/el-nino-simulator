PROMPT 2B-STEP3-MOBILE1 - Mobile Dynamic Snap-Sheet and Floating HUD (viewports narrower than 768 px)

You are Hermes working in the Super El Nino simulator repo (the current working directory, the ONLY repo). Save this prompt verbatim as docs/prompts/step3-mobile1.md and commit it ALONE as P0 (git add that path only).

GLOBAL RULES

Gate before every commit: pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p).
Never git add -A. Stage explicit paths. One commit per step below.
Running out of budget is NOT a STOP. Commit what is done and continue. Only the STOP conditions listed below stop you.
Never commit an intentionally red test. N10 (negative.spec) stays the documented known-red and is untouched.
Do not edit the 7 locked specs. Their diff against 5e7c826 must stay empty.
Desktop (width 768 px and above) must be unchanged: S1 ref.spec residual 0 with sha 934ecd13...d29a44 in 2 processes, the 15 layout rects of S7 identical, camera goldens unchanged, and camera.view must stay null on desktop so the projection matrix is bit-identical.
Zero new runtime dependencies. No Framer Motion, no gesture library.
All prose, comments and docs in plain text. Keep replies and the final report short.
STEP P1 (read-only audit, docs only): write docs/MOBILE-AUDIT.md answering, with file and line references:

The HEAD hash, and whether FIX2 is present (pin hit proxy with a 22 px radius on pointer: coarse, and the in-drawer region switcher). Name the component.
How the desktop free-rect centring and d_fit work today (CameraDirector.tsx, the free rect, the drawer inset). Does it already use setViewOffset or a target offset? How is a free rect expressed?
Every place that assumes the globe centre equals the canvas centre (silhouette and limb code, discRadiusPx and test helpers, pin proxy scaling, hotspot label positioning, the probe).
What singleWriter.test.ts scans and how it detects camera writes.
The R3F event source. Is the overlay area a DOM descendant of the element R3F listens on? Where does onPointerMissed fire?
The store library in use, how the drawer, region cards, ENSO value, category and the global anomaly scrubber are wired, and the exact selectRegion path.
The index.html viewport meta (is width=device-width and viewport-fit=cover present?), the DPR cap, and the e2e probe and marker convention (markers are 0 in dist and present in dist-e2e).
Where the batched runner lists spec files and how its timeouts are derived.
STOP conditions (report and stop, no code): (a) FIX2 is not merged; (b) the desktop centring cannot take a second free rect without changing desktop pixels; (c) no global anomaly scrubber or equivalent control exists on desktop. Otherwise continue straight to A.
STEP A (pure logic plus unit tests, no UI): create src/mobile/snapMath.ts and src/mobile/ensoHud.ts with tests.

Constants in one place: BREAKPOINT_MAX = 767.98 px (media query max-width 767.98px), TIERS peek 0.18, half 0.48, full 0.88 (visible fraction of the viewport height), VIEW_CENTER_FRACTION 0.275 (centre of the upper 55 percent).
computeSnapPoints(viewportH) returns the translateY in px for each tier for a sheet whose height is full _ viewportH. Full is 0, half is (full - half) _ H, peek is (full - peek) _ H.
rubberBand(over, H): monotone, bounded, 0 at 0.
resolveSnap(y, velocityPxPerMs, points): project y + v _ 120 ms, pick the nearest point, clamp to the valid range. A tap (movement under 6 px and under 300 ms) cycles peek to half, half to full, full to half.
ensoCategory(anomalyC): reuse the repo's existing classification if there is one. Otherwise use the NOAA ONI style bands: weak from 0.5, moderate from 1.0, strong from 1.5, very strong from 2.0, and the mirrored La Nina names for negative values. formatIsland(anomalyC) returns text like "ENSO: +1.5°C | STRONG" using a real minus sign for negatives.
Unit tests: snap points for heights 667, 844 and 926; flick and slow-drag resolution; the bounds; rubber-band properties; the category boundaries 0.49, 0.5, 1.49, 1.5, 1.99 and 2.0; formatting.
STEP B (camera, single writer): extend CameraDirector.tsx only.

Add a layout-mode value (mobile or desktop) in the existing store, set by one matchMedia listener. CameraDirector reads it non-reactively inside its frame loop.
In mobile mode the CameraDirector calls camera.setViewOffset(W, H, 0, (0.5 - 0.275) _ H, W, H) followed by updateProjectionMatrix. The sub-window keeps the full width and height, so the zoom is unchanged and only the principal point shifts up. Do NOT use a smaller sub-window.
It applies the offset idempotently, keyed on (mode, W, H), and re-applies after every R3F resize because R3F rewrites the aspect. It calls clearViewOffset when leaving mobile mode.
The sign must be proven by measurement. Project the controls target and require its screen y to equal 0.275 _ H within 1 px. If the sign is wrong, flip it. Do not guess.
The fit distance uses the mobile free rect (full width, top 55 percent of the height) through the existing d_fit law. Report whether dMax clamps at 390 x 844.
Extend the guard in singleWriter.test.ts so setViewOffset, clearViewOffset and updateProjectionMatrix are forbidden outside CameraDirector.tsx. Add a negative fixture to prove it fails when violated.
No other file may write camera state. The sheet and the HUD only publish layout state and never touch the camera.
Fix every place from the P1 audit item 3 that assumes the canvas centre (use the shared helper with the free-rect centre). Raycasting needs no change, since three.js uses projectionMatrixInverse. Prove it: project each front-facing pin, tap it, and require selection.
STEP C (SnapSheet shell and pointer engine): create src/mobile/SnapSheet.tsx and src/mobile/useSheetDrag.ts.

DOM placement: the sheet must NOT be a DOM descendant of the R3F event source. Otherwise, taps on the sheet bubble to R3F and trigger onPointerMissed, which clears the selection. Use a sibling overlay wrapper with pointer-events none, and give the sheet itself pointer-events auto. This keeps the top part of the screen interactive for OrbitControls at the peek tier.
Geometry: fixed, bottom 0, full width, height set from JS as full \* viewportH, where the viewport height is visualViewport.height or innerHeight. Update it on resize, orientation change and visualViewport resize (throttled to a requestAnimationFrame). When not dragging, re-snap without animation. Add padding-bottom env(safe-area-inset-bottom).
Tiers: Peek shows the region pill, anomaly badge and mini sparkline. Half adds the teleconnection sliders, the core metrics and the region switcher row from FIX2 (same selectRegion path). Full adds the deep-dive narrative, the DuckDB-backed sections and the impact breakdown. Reuse the existing section components. Do not change their desktop rendering. Mount the heavy full-tier sections lazily on first arrival at full and keep them mounted afterwards.
With no region selected (load state), peek shows the global anomaly summary and the sheet stays usable.
Visual: full tier uses backdrop-blur-xl bg-slate-950/80. Peek and half use bg-slate-950/85 with no blur, to protect WebGL frame time. Switch with a data-tier attribute on the sheet root. Do not animate backdrop-filter.
Drag handle zone (the grabber plus the header area, with a hit area of at least 44 px) gets touch-action none and select-none. The scrollable body gets touch-action pan-y, overscroll-behavior contain and overflow-y auto. Hidden tiers' content is made inert through a ref effect (React 18 has no inert prop), so it is unfocusable and not announced when out of view. Sheet drags start only from the handle zone. The body scrolls natively.
Pointer engine (native events, no library):
pointerdown on the handle: ignore if not primary or if a drag is already active. Call e.currentTarget.setPointerCapture(e.pointerId). Remember pointerId, startY and startTranslate. Set style.transition = none and will-change transform.
pointermove with a matching pointerId: y = clamp with rubberBand outside [full, peek]. Write ref.current.style.transform = translate3d(0, y px, 0) directly. No React state, no setState during the drag. Keep the last 5 samples within 100 ms for the velocity.
pointerup, pointercancel and lostpointercapture all call one idempotent finish(). It releases capture in a try block guarded by hasPointerCapture, computes resolveSnap, sets style.transition to transform 320ms cubic-bezier(0.22,1,0.36,1), writes the snap transform, and then calls setTier once. Under prefers-reduced-motion the transition duration is 0.
Suppress the click that follows a drag of more than 6 px.
Accessibility: the handle has role slider, aria-valuemin 0, aria-valuemax 2, aria-valuenow equal to the tier index, aria-valuetext Peek, Half or Full, and tabindex 0. ArrowUp and ArrowDown change tier, and Home and End jump to the ends. Do NOT bind Escape (the existing close semantics keep Escape).
Test hooks follow the existing marker convention: a data-tier attribute, a render counter exposed to the e2e build only, and a new marker such as mobile-snap-probe-3m1 that must be 0 in dist and present in dist-e2e.
STEP D (Floating HUD island): create src/mobile/TopIsland.tsx.

A capsule at the top centre, offset by env(safe-area-inset-top), showing formatIsland(live anomaly) from the live store and never a literal. A tap toggles aria-expanded and reveals the existing global anomaly scrubber bound to the same store action as desktop (minimum 44 px target, touch-action pan-y for the container and touch-action none on the thumb track).
On mobile the desktop header collapses. Keep an sr-only h1, and keep the ResetViewButton component (same aria and same behaviour) beside the island with a 44 px target.
The z-order is HUD above sheet above hotspot labels above the canvas.
Mounting: SnapSheet and TopIsland render only in mobile mode. The desktop drawer, cards and header render only in desktop mode.
STEP E (e2e): create tests/e2e/mobile-sheet.spec.ts, register it in the batched runner (timeout rule: 2x its measured wall, floor 120 s), and run it isolated first.

Use test.use with viewport 390 x 844, hasTouch true, isMobile true and deviceScaleFactor 2. For touch drags use a helper over a CDP session (Input.dispatchTouchEvent: touchStart, touchMove, touchEnd and touchCancel). Do not rely on page.mouse for the touch cases.
M1 layout mode: at 390 x 844 the sheet and island exist and the desktop drawer and cards are absent. At 767 the sheet exists. At 768 and 1024 x 768 only the desktop layout exists.
M2 view offset: the projected globe or target centre y equals 0.275 \* 844 within 1.5 px. On a selected pin (face-pin law) the pin projects to the same centre within 1.5 px, with direction error at most 0.1 degrees. On desktop camera.view is null.
M3 raycast parity: tap every front-facing pin by its projected pixel and require 100 percent selection. Require 0 percent for back-facing pins. A tap on the sheet does NOT trigger pointer-miss and the region stays selected. A tap on empty canvas still closes or clears as today.
M4 tiers: the sheet top equals 692, 439 and 101 px (within 2 px) for peek, half and full. In peek, a canvas touch at y = 400 reaches OrbitControls. In every tier data-tier is correct.
M5 drag: a slow drag from peek upward past the midpoint lands on half. A drag under 30 percent of the gap returns to peek. A flick-length drag across both gaps lands on full. During the drag (between touchStart and the last touchMove) the render counter does not change and style.transform is set inline. After release exactly one render occurs.
M6 isolation: a touch drag on the handle leaves the camera pose (distance and direction) exactly unchanged. A touch drag on the canvas at y = 200 changes the pose (control) and does not move the sheet.
M7 body scroll: at full tier a touch scroll of the body increases scrollTop, the sheet transform and the camera pose are unchanged, and the computed overscroll-behavior is contain.
M8 pointer capture: move the pointer outside the handle and the window during a drag, and the drag still tracks. After touchEnd, hasPointerCapture is false. After touchCancel the sheet snaps to a tier with no stuck state.
M9 HUD: the island text matches formatIsland of the live store value. A tap expands it and shows the scrubber. Changing the scrubber updates the island text and the globe through the store. Reset still works from the mobile layout.
M10 inert and a11y: out-of-view controls are not focusable (Tab does not reach them), and keyboard tier changes work.
Also run, unchanged: all 15 specs that ran before, with the existing batched runner. Record counts.
STEP F (docs): add docs/MOBILE.md (constants, the state machine, the event flow, the single-writer rule, known limits such as the 667 x 375 landscape phone being cramped and the fixed offset not following the tier). Append short notes to docs/E2E.md and docs/STEP3-STATUS.md only. Do not rewrite them.

NOT IN SCOPE: animating the view offset by tier, DPR or renderer changes, desktop changes, N10, deploy or \_headers.

FINAL REPORT (short) must include:

The sentinel and the HEAD hash, with the commit list.
The FIX2 presence check result and the P1 audit answers in 8 lines.
The measured view-offset sign and the target screen y.
Pin tap rates (front, back) at 390 x 844, and the pointer-miss behaviour on sheet taps.
S1 residual 0 and the sha in 2 processes; the 15 rects identical; the camera goldens; camera.view null on desktop.
singleWriter negative fixture result; the marker counts (0 in dist, present in dist-e2e).
Unit and e2e counts as passed, failed, skipped and expected (N10 known-red only), file count, wall time, and the archive path.
Any deviation from this prompt, disclosed.
END OF PROMPT 2B-STEP3-MOBILE1
