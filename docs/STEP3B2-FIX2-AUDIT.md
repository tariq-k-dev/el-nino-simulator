# Step 3B2-FIX2 — Step A audit: the pin hit proxy, and the one requirement that cannot be met

Prompt: `docs/prompts/step3-b2-fix2.md` (sentinel `END OF PROMPT 2B-STEP3-B2-FIX2`).
Baseline HEAD at the start of this session: `54a93f2` (clean tree; P0 added `7a143bc`).

**Step A STOPPED at A1.** A3's visibility-gated raycast and A4's "front pins selected 100 percent" are
contradictory requirements, and the size of the conflict is measured below. No product code was written for
step A; nothing is half-implemented. Step B (the in-drawer region switcher) is independent of this and is
reported separately.

---

## A1 — the audit's two candidate fixes vs the design in the prompt

`docs/STEP3D-PIN-AUDIT.md` ("Where the fix stops") proposes exactly two fixes:

| # | audit's fix | mechanism |
|---|---|---|
| 1 | **Occlusion (f)** | keep the ring as the target; in its `onClick`, compare the pin's intersection distance with the nearest planet-surface intersection and ignore the click when the planet is in front |
| 2 | **Oblique footprint** | replace the tangent-plane click target with a **camera-facing** hit proxy — a billboarded disc at the pin's screen position, `visible = false` but raycastable, or a `Raycaster.params` override |

The prompt's design is a third thing that supersedes both. Differences, each with what it changes:

1. **Distance test vs normal test.** The audit's (1) is a per-click distance comparison against the globe's
   own hit; the prompt replaces the target entirely and vetoes the hit from a normal dot product. The audit's
   test is physically exact (it asks what is actually in front along the ray); the prompt's is an
   approximation of it, and — measured below — a much stricter one.
2. **Disc vs sphere.** The audit's (2) needs a billboarded, camera-facing quad, i.e. a per-frame orientation.
   The prompt's proxy is a **sphere centred on the pin head inside the rotating group**: a sphere's silhouette
   is a circle from every direction, so a constant screen footprint needs only a per-frame *radius*, no
   billboarding. Strictly simpler, and it is what makes the radius a single scalar to clamp.
3. **Hover and cursor move too.** The audit says nothing about hover or the cursor; A3 moves
   `onClick`, `onPointerOver`, `onPointerOut` and the `document.body.style.cursor` write onto the proxy and
   requires the visible pin to stop being the event target at all.
4. **`Raycaster.params` is out.** The audit permits a global raycaster-parameter override; A3 forbids it in
   effect by requiring one proxy object per pin with its own override and by forbidding any change to the globe
   surface or the occluders.
5. **Behaviour, not filtering.** The audit's (1) filters a click after the ring has been hit. A3 requires the
   ring to receive nothing, so `stopPropagation` on the ring and any pointer-miss interaction on the globe
   stay exactly as they are today.
6. **New constants and a pure function.** A3 adds exported `HIT_PX` (14 / 22 on `pointer: coarse`), a
   neighbour-overlap clamp, and a unit-tested pure `pinFacesCamera` (front, back, exact horizon, tall pin).
   None of these exist in the audit.
7. **Which point the normal is taken at.** The audit's proxy is "at the pin's screen position"; A3 pins the
   proxy centre to *the same point the pin-click spec projects*, i.e. the head at
   `anchorRadius × idleLift + coreOffset = 1.10242 R`, and takes the outward normal at the pin **base**
   (`1.04742 R`).

Items 1-6 are refinements of the audit and are compatible with it. Item 7 — specifically the choice of *base*
for the normal in a `n · (rayOrigin − base) > 0` gate — is where the design fails under measurement.

## A2 — where the pin lives (file:line at `54a93f2`)

| what | where |
|---|---|
| the additive ring — **the current click/hover/cursor target** | `src/scene/Hotspot.tsx:163-193`; `onClick` `:168-171`, `onPointerOver` `:172-176`, `onPointerOut` `:177-180`, `cursor` writes `:175` / `:179`, plane `:182` (0.22 world units across) |
| pin stem + housing + core (the visible pin) | `src/scene/Hotspot.tsx:211-265`; group `:212` (`position`, `quaternion`), collar `:217`, housing `:236`, core `:249` |
| per-frame lift of the pin group | `src/scene/Hotspot.tsx:75-79` — `activeLift` / `idleLift` along the normal |
| back-label fade (the pin's own facing test, already in the file) | `src/scene/Hotspot.tsx:89-107` |
| the group that rotates with the earth | `src/scene/EarthSystem.tsx:46-57` (`groupRef.rotation.y = spin.y`), `<Hotspot>` mounted `:62-71` |
| pin head position used by the projection | `src/scene/globeLook.ts:24-41` (`anchorRadius` 1.012, `idleLift` 1.035, `coreOffset` 0.055); `src/scene/GlobeScene.tsx:306-330` (`__globe.pins()`, "the CORE's position, not the surface anchor") |
| probe fields exposing pin screen positions | `src/scene/GlobeScene.tsx:306-330` (`pins`), `:584-609` (`pinsWorld`, core + surface + normal), declared in `tests/e2e/globals.d.ts:20-42`; screen projection `src/lib/globeProbe.ts` `project()` |
| pointer-miss close (must not change) | `src/scene/GlobeScene.tsx:622` (`onPointerMissed={() => onSelect(null)}`) |
| material/geometry constants | `src/scene/globeLook.ts:24-60` |

The point a click must land on is the **head**: `1.012 × 1.035 + 0.055 = 1.10242 R`. What the spec projects is
the same point (`globals.d.ts:37-42`, `__globe.pinsWorld()[].core`).

## The refutation, quantified

### The rule reduces to a fixed threshold on the same quantity the spec bands

With the camera at distance `D` along the unit vector `u` and the pin **base** at radius `rb` along the unit
normal `n`, the prompt's rule

```
n · (rayOrigin − pinBaseWorld) > 0     is     D (n·u) − rb > 0     is     n·u > rb / D
```

So the gate is not a hemisphere test at all — it is a **hard threshold on `n·u`**, the exact quantity A4 bands
front / grazing / back with. Whether it agrees with the spec's `0.15` band edge is therefore a single
comparison, and it does not:

| quantity | value | angle from the camera axis |
|---|---:|---:|
| spec FRONT band edge (A4) | **0.15000** | 81.37° |
| prompt gate, `rb = 1.04742`, `D = 3.77857` (`d_fit`, closed drawer, 1440x900) | **0.27720** | 73.91° |
| prompt gate at `dMax = 5` (widest legal camera) | 0.20948 | 77.91° |
| prompt gate at `dMin = 1.25` (closest legal camera) | 0.83794 | 33.09° |
| prompt gate if the normal were taken at the head (`rh = 1.10242`) | 0.29178 | 73.04° |

`rb / D ≤ 0.15` requires `D ≥ rb / 0.15 = **6.98 R**`, and `OrbitControls.maxDistance` is **5**
(`src/scene/GlobeScene.tsx:727`). **There is no camera distance in the product at which the prompt's gate
admits the spec's whole front band**, and no choice of "pin base" changes that: at `D = 5` the thresholds are
0.20240 (anchor 1.012), 0.20948 (group 1.04742) and 0.22048 (head 1.10242) — all above 0.15.

### What that costs on the spec's own sweep

The 48-pose sweep (12 azimuths × 4 regions, `setSpin(true, deg)`) is already committed with its facing values
(`.cache/pinclick-run2.log`, summarised in `docs/STEP3D-PIN-AUDIT.md` D1). Applying the gate to those rows:

| band (A4's definition) | rows | gate admits | A4 requires |
|---|---:|---:|---|
| front (`n·u ≥ 0.15`) | 23 | **20 = 87.0 %** | **100 %** |
| grazing (`0 ≤ n·u < 0.15`) | 1 | 0 | reported only |
| back (`n·u < 0`) | 24 | **0 = 0 %** | 0 % — satisfied |

The three front rows the gate refuses:

| az | region | facing (log) | facing (model) | gate value |
|---:|---|---:|---:|---:|
| 120 | us-west | 0.1791 | 0.1832 | −0.3553 |
| 300 | us-west | 0.2064 | 0.1832 | −0.3553 |
| 150 | horn-africa | 0.2411 | 0.2140 | −0.2388 |

(Computed with `D = d_fit = 3.77857`; with the shipped `D0 = 3.35336` the same three rows are 0.2064 /
0.2064 / 0.2411 and are refused identically. The disagreement between the logged facing and the model — up to
0.04 — is the live camera sitting at `d_fit` rather than `D0`, plus the 240 ms frame the sweep samples after
`setSpin`; it does not move any row across either threshold.)

So implementing A3 exactly as written would leave the reported defect **largely unfixed**: 39.1 % front
success would become 87.0 %, not 100 %, and D4 would fail on three named angles.

### The gate is also stricter than the truth, in the same direction

A pin head floats at 1.10242 R, i.e. 0.1 R above the surface, so it stays visible well past the sphere's own
horizon. Solving the exact occlusion test (distance from the origin to the camera-to-head segment against
`R = 1`) gives a visibility horizon of **n·u ≈ −0.131** for the head and **n·u ≈ +0.001** for the base — both
far below 0.15. Under the physically exact test the sweep admits **26 of 48** rows, which includes rows the
spec bands as **back** and requires to select 0 % of the time.

That closes the loop: **neither** the prompt's approximate gate **nor** the exact occlusion test can satisfy
A3 and A4 simultaneously. Only a gate keyed directly on the band the spec asserts — refuse when
`n·u < 0.15` — satisfies both, and choosing that is a product decision, not an implementation detail.

## What is *not* refuted — the parts of A3 that measure clean

The prompt asks for particular care on the hit radius, so it is stated separately: **the radius design is
sound and needs no change.**

| check | value |
|---|---|
| nearest pin pair (spin-invariant, all six pairs) | pacific↔us-west **0.89532 R** (next: se-asia↔horn-africa 1.27524 R) |
| neighbour-overlap cap (half the closest pair) | **0.44766 R** |
| `HIT_PX = 14` at `d_fit` 3.77857, focal 1172.29 px (h = 900) | world r = **0.04513 R** — 9.9× under the cap |
| `HIT_PX = 22` (coarse pointer) | world r = **0.07091 R** — 6.3× under the cap |
| worst case, `dMax = 5`: `HIT_PX = 22` | world r = 0.09383 R — 4.8× under the cap |
| the existing visible ring (0.22 across → 0.11 half-width) | 2.4× wider than the 22 px proxy, so a proxy can never swallow a neighbour's ring |

Also verified from source rather than assumed (A3 asks for this to be established empirically before relying
on it): in **this** repo's R3F `8.18.0` / three `0.169.0`, an object with `visible = false` **does** receive
pointer events. `three`'s `Raycaster.intersect()` tests `object.layers` and calls `object.raycast()`
unconditionally — it never reads `visible` (`node_modules/three/build/three.module.js:52030-52050`) — and R3F's
event `intersect()` calls `state.raycaster.intersectObject(obj, true)` through the same path
(`node_modules/@react-three/fiber/dist/events-*.esm.js:919`). `visible={false}` is therefore a valid
non-drawing route, and the "non-drawing material" fallback is not needed. (Still worth confirming on the running
page once a proxy exists; that confirmation belongs to the implementation.)

## Why this is a STOP and not a judgement call

`docs/prompts/step3-b2-fix2.md` A1: *"The design below is binding unless your measurements refute it; if they
do, STOP and report."* They do, and the size of the conflict is:

- **8.1° of arc** at `d_fit` (`73.91°` vs `81.37°`), **9.9°** at `dMax`;
- **3 of 23** front rows on the committed sweep, i.e. **87.0 % against a required 100 %**;
- **unreachable by any camera pose**: it needs `D ≥ 6.98 R` and the product allows at most `5 R`;
- and the exact alternative overshoots the other way, admitting **3 back rows** against a required 0.

Not implemented, not approximated, no threshold widened. The two candidate resolutions are the author's:

| option | what it means | consequence to weigh |
|---|---|---|
| **1. Gate on the facing band** — refuse the raycast when `n·u < 0.15`, the band A4 asserts | satisfies A3's intent (back pins produce no hit) and A4 exactly; `pinFacesCamera` keeps its shape with `0.15` replacing `0` | a pin at 0.15-0.28 is visible and unclickable, which is the same "clickable only in the middle of the disc" complaint at a smaller radius |
| **2. Exact occlusion test** — refuse when the segment camera→head is blocked by the unit sphere | physically exact, admits everything genuinely visible | **breaks A4's "back pins selected 0 percent"**: 3 sweep rows the spec bands as back become clickable, so A4's back assertion has to be redefined in terms of visibility rather than `n·u` |

Until one is chosen, the pin proxy is not written.

## State of the tree after this audit

- `docs/prompts/step3-b2-fix2.md` committed alone as P0 (`7a143bc`).
- This memo, docs only. **No product file, no spec, no threshold, no runner table touched.**
- `tests/e2e/pin-click.spec.ts` unedited, so D4 remains red exactly as it was at the baseline: it asserts
  post-fix behaviour and no fix exists. That is the commit's starting condition, not a regression.
- S1 (`ref.spec`) unaffected by construction — no rendering path was touched, so no pixel can move.
