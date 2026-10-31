TASK 2B-STEP3-A: Step 3 framing foundations, part 1 (audit, reference frame, insets registry). Read the whole prompt first. The last line is END OF PROMPT 2B-STEP3-A. Quote it in your first message.

CONTEXT: The spec lock is closed (54/54 e2e, HEAD 1f3b300 or later). Step 3 adds framing (free-rect centering, fit distance) and focus UX over several sessions. This session changes NO look behavior. Look, negative, limb and globe specs, and all their thresholds and windows, must not change in any way (A >= 25, Ld/Ln >= 3, S <= 0.25, S_real < 0.6, the 0.95 bound, the glint window 70.8-110.7 / 6716-12472, sentinel 88.52 / 9594 all untouched).

RULES: Repo D:\Dev\Handshake\Build-an-Interactive-Data-Visualization only. One commit per step. Never amend, never rewrite history. Lint and commit in separate cells. Gate exactly: pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p), one gate per cell. E2E only through the batched runner as described in docs/E2E.md (Popen with an argv list, poll cells under 240 s, no shell redirects). Keep progress in docs/STEP3-STATUS.md, updated after each step. At most 15 tool calls per step. On any failure STOP and report instead of guessing. If running low: commit what is green, update the status file, stop.

P0 PREFLIGHT: confirm git log -1 and a clean tree, run the orphan sweep (no node, chrome or playwright leftovers of yours), commit this prompt alone as docs/prompts/step3-a.md.

A AUDIT (read-only, then commit docs/STEP3-AUDIT.md). Report facts with file and line references:

1. Every writer of camera position, target, zoom, distance or min/maxDistance (CameraRig, OrbitControls props and handlers, auto-rotate, **look.setAzimuth, **globe, any fly-to). State where the initial distance 3.3534 and the distance bounds come from, and in which units (EARTH_RADIUS).
2. The layout at 1280x800, 1024x768 and 1440x900: bounding rect of the canvas, header, left control deck, right Impact Zones, region drawer (closed and open), and which of them are overlays on a full-viewport canvas versus siblings. One table.
3. What src/lib/viewport/insets.ts and window.\_\_globe (project, discRadiusPx, distance, insets) do today, and who calls them.
4. For each legacy spec (look, negative, limb, globe, harden, boot, scene-gate): how it navigates, how it sets the camera, and whether it depends on the exact camera distance, on the canvas size, or on absolute pixel positions. List which ones would change if the camera distance or a view offset changed. Be explicit about the (344,392) probe.
5. Pin geometry: the radius at which pins float (expected core 1.10242 R) and the projected r/R of each pin at the default view.
6. Is there a user-zoom flag today? Is there a Reset view control? How does the drawer open and close (CSS transition, duration, mount/unmount)?

B REFERENCE FRAME (before any code change; commit alone). Add a helper that, in the look-spec default state (seeded stars, rings OFF, 1280x800, az 0), captures the globe region as a PNG. Capture twice and compare with the existing diff machinery. Required: max residual 0. Save as tests/e2e/ref/default-1280x800.png (<= 300 KB; crop to the globe disc plus 40 px if needed). If the two captures differ, STOP and report the measured residual. Do not invent a tolerance.

C INSETS REGISTRY (one commit). Implement or extend src/lib/viewport/insets.ts. Elements marked data-occluder="left|right|top|bottom" register through a single module. A pure function computeInsets(rects, viewport) returns {L,R,T,B}, counting only the overlap with the canvas and ignoring display:none and zero-size elements. A store is updated by ResizeObserver, transitionend/animationend, and a 500 ms mutation window after any transition start; it updates only when a value changes by more than 0.5 px. Mark the control deck, Impact Zones and region drawer (the header only if it overlays the canvas). Layout must be pixel-identical: assert that the rects from audit item 2 are unchanged after marking. Unit tests for the pure function (overlap, hidden, zero-size, overlapping occluders, viewport smaller than the occluders). Gate, commit.

REPORT AT END: quote the sentinel; list commits; the audit tables; the legacy-spec dependency list; the reference residual; the unit test count (expect 754 plus new); gate results; anything that deviates from this prompt. Do NOT start FrameOffset or fit distance. STOP after C.

END OF PROMPT 2B-STEP3-A
