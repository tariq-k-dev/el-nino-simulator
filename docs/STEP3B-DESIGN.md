# STEP 3B — audit and design (2B-STEP3-B, step A)

Read, not assumed. Line references are to `f440814` unless stated otherwise. Report only: nothing in
`src/` changed in this step, and the two items this memo answers (2 and 3) are measurements.

Companions: `docs/prompts/step3-b.md` (the prompt), `docs/STEP3-FRAME.md` (3A2 design),
`docs/STEP3-STATUS.md` (3A2 close), `docs/globe-look/SPEC.md` §5.5 (the N10 addendum).

---

## 1. Fly-to, exactly

`src/scene/CameraRig.tsx:50-133`.

| property | today |
|---|---|
| **duration** | **none — it is not a timed animation.** It is an exponential damp that stops when it has converged: `travelling` is cleared when `target.distanceTo(desired) < 0.004` **and** `|distance - wanted| < 0.004` (`:122-125`). Measured settle is ~0.8-1.2 s at 60 fps and longer under load. |
| **easing** | two frame-rate-independent exponentials, both `1 - pow(base, dt)` with `dt = min(delta, 1/30)` (`:91`): target `base = 0.0001` (`:94`), distance `base = 0.0006` (`:95`). Position is NOT interpolated directly — see "what it writes". |
| **writes** | `controls.target.lerp(desiredTarget, targetEase)` (`:99`); then, preserving the viewing direction, `camera.position.copy(controls.target).add(offset.setLength(nextDistance))` (`:115`); then `controls.update()` (`:120`), which is what derives `camera.quaternion` and clamps the polar angle. It never assigns `camera.quaternion` itself. |
| **`controls.target` leaves the origin** | **yes.** On `SELECT` the target becomes the pin's direction after the earth's Y rotation: `regionDirection(id, spin.current.y)` (`:21-25, :54`). On close it returns to `DEFAULT_TARGET = (0,0,0)` (`:18, :58`). |
| **end pose depends on the spin angle** | **yes, and only through the target.** `desiredTarget` is `latLonToVector3(region.lat, region.lon, 1)` rotated by `spin.current.y` at the moment the effect runs (`:54`). The spin is PAUSED on the same effect (`:52`), so the pose is frozen at whatever phase the clock had reached — that is why a fly-to pose is not reproducible across loads unless the probe froze the spin first. `desiredDistance` is `region.zoom`, a per-region constant. |
| **what happens on drawer close today** | `activeRegion` becomes `null` → `spin.paused = false` (`:57`), `desiredTarget` back to the origin (`:58`), `desiredDistance` back to `DEFAULT_POSITION.length()` (`:59`), `travelling = true` (`:61`). So close **is a fly-to back to the default pose**, not a jump and not a no-op. |
| **auto-rotate pauses and resumes** | `autoRotate={false}` on `<OrbitControls>` (`GlobeScene.tsx:711`), so auto-rotate is permanently off. The *spin* is the animation, and it pauses on select (`:52`) and resumes on close (`:57`). It does **not** resume on any other event. |
| **anything else moves the camera on close** | `FrameRig`'s distance channel. Closing narrows the right inset 418 → 316, so `dTarget` changes and the fit re-eases — but only while it owns the distance (see §2, `lastFit`). Measured in `.cache/containment-probe.json`: closing from `pacific` lands at d 3.3571 with the offset at (21.378, 59.125), i.e. the fly-to's 3.3534 is still in flight when the fit takes over the distance on later frames. |

**Consequence for step D:** `returning` must reproduce exactly this — target back to the origin, distance back to `D0`, spin resumed, same two exponentials. It is not "do nothing".

## 2. Writer inventory after 3A2

| writer | file:line | what it writes | when |
|---|---|---|---|
| **fly-to** (`CameraRig`) | `CameraRig.tsx:99,115,120` | `controls.target` (lerp), `camera.position` (via target + scaled offset), `controls.update()` → quaternion | every frame while `travelling`; `travelling` is set by the `activeRegion`/`focusNonce` effect |
| **OrbitControls wheel / pinch / drag** | `GlobeScene.tsx:701-713` (the component) | `camera.position` and the resulting quaternion through its own `update()`; owns `minDistance` 1.25 / `maxDistance` 5 as configuration | on user input; `update()` is also called by both rigs every frame, which is what applies its damping |
| **`__globe.setCamera`** | `src/lib/globeProbe.ts:211-218` | `camera.position.set(...)`, `camera.lookAt(0,0,0)` (i.e. quaternion), `updateMatrixWorld(true)`; also `setSpinPaused(true)` | on demand, from a spec |
| **`__look.setAzimuth`** | `src/scene/GlobeScene.tsx:437-449` → `globeProbe.ts:233-240` | **the camera, not the earth group**: it computes `(r sin a, y, r cos a)` from the camera's own default orbit and calls `setCamera`. It also freezes the spin at 0 and sets `animate: false` | on demand, from a spec |
| **FrameRig** | `src/scene/FrameRig.tsx:224-235` (view offset), `:252-266` (distance) | `camera.setViewOffset(w, h, -dx, -dy, w, h)` — the projection, not the pose; and `camera.position` when it owns the distance, followed by `controls.update()` | every frame in live mode, gated on a >0.01 px offset change / a >1e-6 distance error |
| **initial Canvas camera prop** | `GlobeScene.tsx:231` | `position [0, 1.15, 3.15], fov 42, near 0.1, far 400` | once, at mount |

There is **no other writer**: `grep` over `src/` for `camera.position|quaternion|up|zoom|fov|setViewOffset|clearViewOffset|updateProjectionMatrix|minDistance|maxDistance|controls.target` returns exactly the six rows above plus comments. `Hotspot.tsx:97` READS `camera.position`; it does not write.

## 3. Containment note (report only, no fix)

`d_contain` (`frame.ts:150-165`) is derived from a sphere on the **view axis**: `sqrt(Re² + (f·Re/r_max)²)` assumes the projection of the sphere centre is the free-rect centre. After a fly-to it is not — the aim point is on the free centre (aim-vs-free ≈ 0.0 px in every row below) but the **origin**, which is where the sphere actually is, is not.

Measured at **1440x900, live mode, drawer open** (`.cache/containment-probe.json`, `scripts/tmp-contain.mjs`; offset `dx,dy = (-28.578, 59.125)`, free `360.8,118.3 763.2x781.8` closed → `661.2` wide open). Overflow is `centre ± R` against each free-rect edge; positive = outside.

| region | d | silhouette R px | origin-vs-free px | **overflow L / R / T / B px** |
|---|---:|---:|---|---|
| *(no selection)* | 3.7784 | 321.7 | (−0.0, −0.0) | −59.8 / −59.9 / −69.1 / −69.1 — **contained** |
| pacific | 2.8965 | 431.2 | (331.6, −69.1) | −230.9 / **+432.3** / **+109.5** / −28.7 |
| us-west | 2.5961 | 489.3 | (91.6, 144.0) | **+67.1** / **+250.4** / −45.5 / **+242.4** |
| se-asia | 2.7036 | 466.7 | (326.1, 115.3) | −189.9 / **+462.2** / −39.5 / **+191.2** |
| horn-africa | 2.7039 | 466.6 | (−156.0, 230.2) | **+292.1** / −20.0 / −154.4 / **+306.0** |
| *(after close, each region)* | 3.34–3.36 | 365–368 | ≈(−1, 0) | ≈−13 to −26 on all four edges — **contained** |

**Answer: the assumption does not hold once a region is focused, and the overflow is large.** Every focused region overflows at least one edge, by **250–462 px horizontally** and up to **306 px vertically**; the maximum is `se-asia` at **+462.2 px right**. Closing returns the frame to containment on all four edges. This is the geometry 3A2 F8 already implied (origin 124 px off the free centre at 1280x720; 91.6–331.6 px here) — the fit is computing the distance for a sphere at the centre while the sphere is somewhere else, and the per-region `zoom` values (2.596–2.897) are smaller than `d0`, which is outside the fit's zoom-out-only domain entirely.

**No decision is taken here.** Whether the disc should stay in the free rect while a region is focused (a reframe-on-focus feature) or whether overflowing the rect is correct because the drawer is the subject is the next session's call, per the prompt. Recorded because a reader of `computeFrame` would otherwise assume `d_contain` bounds the picture in every mode.

## 4. Target design

**One module, `src/scene/CameraDirector.tsx`, is the only code that, after mount, assigns**
`camera.position`, `camera.quaternion`, `camera.up`, `camera.zoom`, `camera.fov`, `controls.target`,
or calls `camera.setViewOffset`, `camera.clearViewOffset`, `camera.updateProjectionMatrix`, or changes
`controls.minDistance` / `controls.maxDistance`.

**Allowed exceptions (the allowlist the step-D source guard enforces):**

| path | why |
|---|---|
| `src/scene/CameraDirector.tsx` | the director itself |
| `src/lib/globeProbe.ts` | `setCamera` / `setAzimuth` are the E2E hook's implementation; step D moves them onto the director's `setPose` intent, so this file is allowed to CONTAIN the intent but must not keep the direct assignment — it is listed so the guard can be written against a known set, and the assignment is removed |
| `src/scene/GlobeScene.tsx` | the initial `<Canvas camera={...}>` prop (mount only) and the `<OrbitControls minDistance maxDistance>` configuration props (declarative, applied by drei at mount) |
| OrbitControls internals (`node_modules`, never scanned) | the library stays the user INPUT device; the director calls `controls.update()` itself after its own writes and ignores `change` events raised during those writes |

Everything else submits **intents**: `flyTo(regionId)`, `setPose(pose)` (from the E2E hook) and
`frame(offset, dFit)` (from the frame rig). `FrameRig` becomes a **pure provider of `(offset, dFit)`** —
it stops writing the projection and the distance, and the director applies both.

**Flagged contradiction, resolved without stopping:** item 4 puts `setViewOffset` under the director while
item 5 lets `FrameRig` be "a pure provider of `(offset, dFit)`". Read strictly, `FrameRig` would stop
calling `setViewOffset` and hand the offset up; that is what step D does, and it is the only reading that
preserves item 1's two-channel behaviour (`lastFit` semantics become the `userZoomed` gate). The
contradiction is a wording one, not a behavioural one, so no STOP condition (S-items) is met.

**Second flagged contradiction:** item 5 says `userZoomed` replaces `lastFit`, and `lastFit` restricts
only the DISTANCE channel. The director therefore keeps the offset channel unconditional, exactly as
`FrameRig.tsx:224` does today. That is consistent, but it means `userZoomed` must NOT gate
`setViewOffset`, or a wheel event would un-centre the globe — the single most visible regression this step
could ship.

## 5. Focus state machine (pure reducer, total function)

States: `idle`, `focusing`, `focused`, `returning`. Context: `regionId`, `userZoomed`,
`orbitedDuringFocus`. Events: `SELECT(region)`, `ARRIVED`, `CLOSE`, `RETURNED`, `USER_ZOOM`,
`USER_ORBIT_START`, `RESET`, `FRAME_CHANGED`.

| rule | transition |
|---|---|
| `idle + SELECT` | → `focusing`, `regionId = region` |
| `focusing + ARRIVED` | → `focused` |
| `focusing` or `focused` + `SELECT(other)` | → `focusing`, retargeted **from the current pose** (no jump); the previous pose reference is kept |
| `focusing` or `focused` + `CLOSE` | → `returning` |
| `returning + RETURNED` | → `idle`, `regionId = null` |
| `focusing + USER_ORBIT_START` | → `focused`, fly cancelled, `orbitedDuringFocus = true` |
| `USER_ZOOM` in any state | `userZoomed = true`, state unchanged |
| `RESET` from any state | → `returning`, `userZoomed = false` |
| `FRAME_CHANGED` | never changes state |
| any other pair | same state, no throw |

**In this step the machine drives only what the code does today.** `returning` has exactly today's
close effect — target back to the origin, distance back to `D0`, spin resumed, same exponentials —
and completes on `RETURNED` when that fly-to converges, which is the same `:122-125` test.

`userZoomed` replaces `lastFit`: the fit distance channel writes only while `userZoomed` is false, and
the offset channel always follows the insets.

## 6. What step D must prove, and why each is achievable

The honest risk is in item 1's "no user-visible behaviour change" against a refactor that moves the
distance writer from `FrameRig.tsx:252` into a director running at a different `useFrame` priority.
Mitigation, in the order the prompt asks for it: golden poses (step C) captured **before** any refactor,
then compared after, then `ref.spec.ts` at strict 0 in two processes, then `frame.spec.ts` unedited.
