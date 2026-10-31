# Step 3B2 — focus UX in LIVE mode: design memo

Baseline: `f1d659c` (Step 3B closed; 848 unit tests / 38 files; 90 e2e expected). Every line number
below is from that commit. Numbers marked *(measured)* come from
`.cache/tmp-probes/insets-live.json` / `rects-before.json` (3A step C, same DOM); numbers marked
*(computed)* come from `src/layout/frame.ts` with the measured insets as input.

## 1. Layout at the three spec viewports, and where Reset goes

Rects *(measured, `getBoundingClientRect` at 1440x900 / 1280x720 / 1920x1080; 1280x800 shares the
1280 px column with 1280x720 — only `h` changes)*:

| element | source | 1440x900 | 1280x720 | data-occluder |
|---|---|---|---|---|
| canvas | `App.tsx:90-103` | 0,0 → 1440,900 | 0,0 → 1280,720 | — |
| header | `Header.tsx:22-24` | x 0–1440, y 0–118.25 | x 0–1280, y 0–118.25 | **`top-panel`** |
| left deck | `App.tsx:139-160` | x 0–360.844, y 311.5–900 | x 0–360.844, y 131.5–720 | **`left-panel`** |
| Impact Zones | `App.tsx:163-168` | x 1124–1440, y 295.875–604.125 | x 964–1280, y 205.875–514.125 | **`right-panel`** |
| region drawer (closed) | `RegionDrawer.tsx:150-165` | x 1481.8–1899.8 (off-canvas) | x 1321.8–1739.8 (off-canvas) | **`right-drawer`** |

Insets are max-per-edge (`src/layout/insets.ts` header): left 360.84375, right 316, top 118.25,
bottom 0 on all three. Free rects *(computed)*: 1440x900 → x 360.84, y 118.25, **763.16 x 781.75**;
1280x720 → **603.16 x 601.75**; 1280x800 → **603.16 x 681.75**. Free-rect centres: (742.42, 509.125),
(662.42, 419.125), (662.42, 459.125).

**Reset view location: the header's right-hand control cluster** (`Header.tsx:95-117`), appended
after the Snapshot button. Reasons, in order:

1. The header's height is set by its LEFT column (36 px icon row + 10 px gap + ~22 px badge +
   `p-6` = 118.25). The right cluster is a single ~22-31 px row, so a further 22 px button cannot
   change the measured 118.25 px height — the one rect S7 would catch. (Proved by measurement in
   step D against the 15 rects of 3A step C, not assumed.)
2. It overlaps **no** existing occluder (it is inside the header, which already owns that band) and
   **no pin**: the disc's top edge at the tightest viewport is 419.125 − 276.875 = **142.2 px** at
   1280x720 *(computed)*, i.e. 24 px below the header band at every spec viewport.
3. It does not block orbit drag: the header band is above the disc, so a drag started there was
   never a globe drag; the button itself is a `pointer-events-auto` child of a
   `pointer-events-none` header (`Header.tsx:22`), the same construction the existing buttons use.
4. The header is `z-40` and the drawer `z-30` (`Header.tsx:20-22`, `RegionDrawer.tsx:159`), so Reset
   stays reachable and clickable while the drawer is open — the state U6 needs it most.

The control is a real `<button type="button">` with `aria-label="Reset view"`, `aria-disabled="true"`
+ `disabled` when `viewIsDefault`, and no `tabIndex` games — it is in the natural tab order after
Snapshot.

## 2. Regions, orbit limits, and which pins the polar limits clamp

`REGIONS` (`src/lib/regions.ts:8-57`), directions from `latLonToVector3` (`:68-76`) at spin 0:

| region | lat, lon | zoom (legacy aim-at-pin only) | unit pin normal (x, y, z) | polar from +Y | clamped? |
|---|---|---|---|---|---|
| `pacific` | −2, −150 | 2.9 | (−0.865498, −0.034899, 0.499695) | 92.000° | no |
| `us-west` | 37, −120 | 2.6 | (−0.399318, 0.601815, 0.691639) | 53.000° | no |
| `se-asia` | −3, 112 | 2.7 | (−0.374093, −0.052336, −0.925913) | 93.000° | no |
| `horn-africa` | 8, 42 | 2.7 | (0.735913, 0.139173, −0.662619) | 82.000° | no |

Orbit limits: `<OrbitControls minDistance={1.25} maxDistance={5} enablePan={false} enableDamping
dampingFactor={0.06} autoRotate={false} touches={{ONE:ROTATE,TWO:DOLLY_PAN}}>`
(`GlobeScene.tsx:705-717`). **`minPolarAngle` / `maxPolarAngle` are not set**, so OrbitControls'
defaults apply: `0` and `π`. `three-stdlib`'s `OrbitControls` clamps internally with
`EPS = 1e-6` rad, so the effective range is [1e-6, π−1e-6].

**Consequence: no region is clamped.** All four polar angles (53°–93°) sit far inside
[0°, 180°], so `clamped` is false and the expected pin offset after clamping is **0.000 px** for
every region at every viewport. The clamp logic is still implemented and unit-tested (a synthetic
`polarMin = 70°` for `us-west` leaves a 17° residual), because the region table is data and the next
pin added near a pole must not be silently mis-framed. Residual conversion: a residual of
`r` degrees moves the pin `f · tan(r) / cos(r)` px near the free-rect centre, i.e. **16.4 px/degree**
at 1440x900 (`focalPx` 1172.29) and 13.1 px/degree at 1280x720 (937.83) — the memo records the
form so step E can assert against an analytic expectation instead of a measured guess.

## 3. Close paths, spin, default pose

Every path that clears the selection, and how it reaches the director:

| # | path | source | chain |
|---|---|---|---|
| 1 | drawer close button | `RegionDrawer.tsx:194-201` | `onClose` → `App.tsx:175` `selectRegion(null)` → `activeRegion` prop → `CameraDirector.tsx:254-269` → `dispatch({type:'SELECT',regionId:null})` → `returning` |
| 2 | `Escape` keydown | `RegionDrawer.tsx:135-142` | same `onClose` → same chain |
| 3 | click empty space | `GlobeScene.tsx:609` `onPointerMissed` | `onSelect(null)` → `App.tsx:30-36` → same prop chain |
| 4 | Impact-Zones card switch | `RegionCards.tsx:40-43` | `onSelect(otherId)` → prop change → `dispatch SELECT(other)` (retarget, not a close) |
| 5 | **new** Reset view | step D button | new intent → `dispatch({type:'RESET'})` → `returning` with `userZoomed:false` |

`selectRegion(null)` when nothing is selected is a no-op for the machine (`closeOrStay`,
`focusMachine.ts:237-243`) but still takes the `else` branch and unpauses the spin.

Spin (`spin.current.paused`, `EarthSystem.tsx:16-17,52`): **paused** in the `activeRegion` effect
when `activeRegion` is truthy (`CameraDirector.tsx:255-258`, immediately on selection — before the
fly-to starts); **resumed** when the same effect runs with `activeRegion === null`
(`:259-263`), i.e. on any of paths 1-3, at the moment of the state update rather than at `idle`.
Path 4 never pauses twice and never resumes. The probe can also force it (`setSpinPaused`,
`GlobeScene.tsx:318-320`). Step 3B2 does not touch any of this: RESET is reachable only when no
region is selected, so spin state is already "running" and nothing changes.

Default pose: `DEFAULT_POSITION = (0, 1.15, 3.15)` (`CameraDirector.tsx:86`), `DEFAULT_TARGET =
(0,0,0)` (`:87`). Direction **(0, 0.342940, 0.939357)**, distance `d0 = 3.353356527421443`
(`framing.ts:70-73`). The framed default distance `d_fit` is `frame.dTarget` *(computed)*:
**3.7786** at 1440x900, **3.8935** at 1280x720, **4.2828** at 1280x800 (and 5.0 at 1024x768, where
`dContain` 7.4548 exceeds the clamp). At 1440x900 and 1280x800 the *distance* binding is the
containment fit, which is why CLOSE must restore `d_fit` and not `d0`.

## 4. The legacy aim-at-pin code, and how it moves

`CameraDirector.tsx:279-340` — the `isTravelling(state)` block. Specifically:

- `:287-296` chooses `desiredTarget = regionDirection(region, spin.y)` and `desiredDistance =
  want.zoom` (the pin's own zoom), else the default pose.
- `:298-321` the two eases: `targetEase = 1 - Math.pow(0.0001, stepDt)`,
  `distanceEase = 1 - Math.pow(0.0006, stepDt)`, `controls.target.lerp(...)`, then the
  distance-from-target ease that presumes `controls.target` is on the pin.
- `:323-333` the `lastFit` invalidation (`USER_ZOOM` when a non-fit writer moved the distance) and
  the `ARRIVED`/`RETURNED` convergence test (`< 0.004` in both target distance and distance error).

**How it moves:** this whole block is lifted, character for character, into `focusPolicy('locked')`
in the same file, guarded by a top-level
`if (import.meta.env.VITE_E2E === '1' && IS_LOCKED)` so the production fold removes it (the
`IS_LOCKED` expression already folds to `false` in production — `framing.ts:113-115`). It gains ONE
new observable marker string (distinct from `LOCKED_BRANCH_MARKER = 'frame-locked-branch-7f3a'`) with
the same "function with a side effect" shape as `noteLocked()` (`:100-102`), so `grep` on the built
bundles is evidence about emitted code. Nothing inside the branch is edited: same constants, same
order, same `withOwnWrite` guard, same `lastFit` latch, same convergence epsilon. The live branch is
new code beside it, and the shared easing constants are read from a tiny module both import (values
exported, not retyped) — numerically identical expressions, so the locked arithmetic is bit-identical
and S3 is a real check rather than a tautology.

## 5. The pure facing function

`src/camera/facing.ts`, no THREE dependency beyond plain tuples/`number[]` (so it unit-tests without
a browser):

```
facingPose({ pinDir, distance, up = [0,1,0], polarMin, polarMax })
  -> { direction, clamped, residualDeg }
```

- `direction = normalize(pinDir)` — the camera sits ON the pin normal side of the origin, so
  `controls.target` stays `(0,0,0)` and the pin projects onto the free-rect centre by construction.
- Polar clamp: `polar = acos(dot(direction, up))`; if `polar < polarMin` or `> polarMax`, rotate
  `direction` in the plane spanned by `direction` and `up` (about `normalize(cross(up,direction))`,
  falling back to a fixed axis when that cross product is degenerate) to the bound. `residualDeg` is
  the angle between the requested and the clamped direction, in degrees; `0` when not clamped.
- Antipodal: when `direction ≈ −up` the cross product vanishes; the rotation axis is then the
  deterministic tie-break `normalize(cross([1,0,0], up))` when that is non-degenerate, else
  `[0,0,1]` — the same axis is chosen on every call and on every machine.

Interpolation (a second pure export, `arcStep`):

- **On the sphere, never on the chord.** `a = acos(clamp(dot(from,to)))`; `k = 1 - 0.0001^dt`
  (the fly-to's own target ease base, imported from the shared constants module — *not* retyped);
  `from` is rotated about `normalize(cross(from,to))` by `a * k`. The radius is therefore exactly
  constant: the result is a unit vector multiplied by the caller's `distance`, so the distance cannot
  drift by even 1e-9 and can never dip below the start distance (S8).
- Antipodal `from`/`to` (`a ≈ π`): the axis is the deterministic tie-break above, so the path is
  pinned rather than NaN.
- Convergence: the legacy test is `|<Δ>| < 0.004` in scene units at unit length, i.e. an angular
  error below **0.004 rad (0.229°)** — reused verbatim as `remainingRad < ARRIVE_EPSILON_RAD`.
- **Retarget starts from the current direction.** `arcStep` takes `from` as the camera's direction
  THIS frame, so a retarget mid-flight continues from where the camera is (no jump) and only the
  angular delta changes; the machine's retarget rule already preserves `poseRef`
  (`focusMachine.ts:169-175`).

## 6. Machine and director changes

- **`userZoomed` is set ONLY by user input**: OrbitControls `start`/`change` with a distance change
  > 0.002 outside this module's writes (`CameraDirector.tsx:215-250`, unchanged). This **reverses
  deviation 2 of step 3B** (`CameraDirector.tsx:30-53`, `:323-327`, `:205-207`). That latch existed
  only because the LIVE fly-to wrote the distance and `lastFit` had to go stale; the face-pin fly-to
  writes no distance at all, so nothing but the user can invalidate the fit in live mode. In LOCKED
  mode the latch is kept inside the locked branch, because the legacy aim-at-pin fly-to still moves
  the distance and `globe.spec.ts`'s "zoom still works after a region fly-to" depends on the same
  `lastFit` behaviour.
- **Fit distance channel** writes only while `state` is `idle` or `returning` **and**
  `userZoomed === false`. Today it runs in every non-travelling state; the change is that a
  `focusing`/`focused` frame can never be overwritten by the fit.
- **CLOSE / RESET return to the framed default pose**: direction → default direction
  (0, 0.342940, 0.939357), distance → `d_fit`, except that **CLOSE keeps a user-zoomed distance**
  (`userZoomed` stays true, distance untouched) and **RESET clears `userZoomed`** and returns to
  `d_fit` (`focusMachine.ts:154-159` already resets the flag).
- **RETURNED** fires on the same convergence test as today (angular < 0.004 rad **and** distance
  within 0.004 of the target).
- **`viewIsDefault`** = `state === 'idle'` ∧ `!userZoomed` ∧ direction within 0.5° of the default
  ∧ |distance − d_fit| < 0.002. Published to a small module-level store
  (`src/scene/viewStore.ts`, same shape as `scene/globeLook.ts`) **only when it changes**, read by
  React through `useSyncExternalStore` — no per-frame renders.
- `window.__frame` gains `viewIsDefault`, `spinning` and `focusPolicy` behind the same gate as today
  (`VITE_E2E === '1' && ?debug`, `frameProbe.ts:17`), so step E can poll a state.

## 7. Test plan U1-U10 and the oracle for each

| id | oracle |
|---|---|
| U1 | per region: `controls.target` = origin (1e-6), camera direction vs pin normal ≤ 0.1°, projected pin core ≤ 0.75 px from the free-rect centre (analytic expectation where clamped) — all from `__globe.project()` + `__frame.free`, printing angle and px error |
| U2 | silhouette overflow beyond the free rect ≤ 1 px per side, measured with the 3B audit probe's silhouette arithmetic (`globeProbe.ts:171-190` limb radius at the current distance) |
| U3 | `__globe.distance()` unchanged within 0.001 across a select; with a prior wheel, distance and `userZoomed` unchanged |
| U4 | per-frame sampling during a fly-to between the two angularly farthest regions (`se-asia` → `us-west` is 31.1° apart at spin 0; the farthest pair is measured live): min distance ≥ start − 1e-6 |
| U5 | every close path of §3: `focus === 'idle'`, direction ≤ 0.1° of default, distance = `d_fit` (or unchanged when zoomed), spin resumed, `userZoomed` per rule, `viewIsDefault === true` |
| U6 | before interaction `aria-disabled` true; a wheel enables it; wheel → drag → select → Reset gives idle, default direction, `d_fit`, `userZoomed false`, `aria-disabled` true |
| U7 | retarget: first sampled pose within 2° of the pre-click pose; final state faces B (U1's assertions) |
| U8 | drag during `focusing` → `focused`, pose stable over 500 ms apart from user input |
| U9 | drawer opened during the fly-to → final pin at the NEW free-rect centre ≤ 0.75 px |
| U10 | the 15 rects of 3A step C unchanged; only the Reset control adds a rect |

## 8. Contradiction check — TWO CONTRADICTIONS FOUND. STOPPED HERE.

The polar limits are the OrbitControls defaults and therefore clamp nothing (§2) — that is a
non-contradiction and every analytic expectation in step E would reduce to the unclamped case.
But the audit found **two contradictions between items 5/6 and the rest of the prompt**. Per the
prompt's own rule ("If the audit contradicts items 5 or 6, write the contradiction and STOP") the
step stopped at the end of B. Nothing in C-G was attempted.

### C1 — constant distance vs U2's 1 px containment (unimplementable, quantified)

Item 6 says the live fly-to "writes direction only (never the distance)" and S8 forbids the distance
dipping at all. The distance at select time is `d_fit` for the rect as it was BEFORE the drawer
opened. The drawer widens the right inset 316 → 418, which narrows the free rect and raises the
containment distance. With the distance frozen, the silhouette radius cannot shrink to the new
`rMax`:

| viewport | free (cards) | free (drawer) | d_fit closed | d_contain open | disc px at frozen d | new rMax | **overflow, per side** |
|---|---|---|---|---|---|---:|---:|
| 1440x900 | 763.16 x 781.75 | 661.16 x 781.75 | 3.7786 | 4.3572 | 357.58 | 306.58 | **51.00 px** |
| 1280x720 | 603.16 x 601.75 | 501.16 x 601.75 | 3.8935 | 4.6943 | 276.88 | 226.58 | **50.30 px** |
| 1280x800 | 603.16 x 681.75 | 501.16 x 681.75 | 4.2828 | 5.1885 → clamped 5.0 | 277.58 | 226.58 | **51.00 px** |

U2 requires that overflow to be **≤ 1 px**. It is 50-51 px, i.e. 50x the bound, at every spec
viewport. The only ways to satisfy U2 are to let the live fly-to increase the distance to the new
`d_contain` — which U3 (`select without zoom leaves the distance unchanged within 0.001`) forbids —
or to shrink the disc by changing `re`/`dMax`, which changes the shipped look. So U2 and
U3+item 6 cannot both hold. Note that U9 (drawer opened during the fly-to, pin at the NEW free-rect
centre within 0.75 px) is satisfiable and independent: the *pin* can be centred while the *globe*
overflows the rect. U2 as written is about the silhouette, not the pin.

### C2 — `frame.spec.ts:606` asserts the exact behaviour item 5 removes (S2 blocks the fix)

`frame.spec.ts` F8 opens the drawer through the California card, which selects the region and starts
the fly-to, then asserts:

- `frame.spec.ts:136-140` — `aim` is `project(__globe.target())`, i.e. the projection of
  `controls.target`;
- `frame.spec.ts:604-606` — `expect(aimMoved, …)` where `aimMoved = |controls.target|`, asserted
  `> 0.1` R, with the comment "the aim really did leave the origin, so switching the oracle was
  necessary rather than a convenient way to pass".

Item 5 requires `controls.target` to **stay at the origin** in live mode. Under the face-pin policy
`|controls.target|` is exactly `0.000`, so that assertion is a hard red in `frame.spec.ts` — an
existing spec file, which S2 forbids editing and which step C's brief requires to stay "green and
unedited". The same case's other two assertions (`errX`/`errY` < 0.75 px) would still pass, because
the globe centre stays on the free centre; and `frame-director.spec.ts:203` (`|target| < 0.05` after a
close) would still pass. So it is exactly one assertion — but it is an assertion whose stated purpose
is to certify the aim-at-pin behaviour that 3B2 replaces.

Resolution requires a decision the prompt does not supply: either F8's `aimMoved` assertion is
retired/relaxed under a named waiver (an edit to an existing spec, S2), or live mode keeps
`controls.target` on the pin (which reinstates the +462 px overflow item 5 exists to remove).

### What was done before stopping

Committed and green: P0 (prompt + `scripts/tmp-contain.mjs` removal, 2 commits), A (this memo),
B (`src/camera/facing.ts`, `src/camera/easing.ts`, 32 new unit tests, gate green at **880 unit tests /
39 files**, `pnpm build` clean). The pure core is independent of both contradictions: `facingPose`
and `arcStep` are correct geometry whatever the director policy turns out to be, and C2 concerns the
director, not this module.

