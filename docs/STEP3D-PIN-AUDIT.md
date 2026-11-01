# Step D (pin click) — D1/D2 measurement, hypothesis verdicts, and where the fix stops

Step 3B2-FIX1 v1. Commits before this: `2a76c2e` (P0), `9d6bbaf` (A), `aad1338` (B), `dcf2214` (C stop).
**D1 and D2 are measured and committed. D3/D4 are NOT implemented** — see "Why the fix is not in this
commit" at the bottom, which is a budget statement, not a technical blocker.

Instrument: `tests/e2e/pin-click.spec.ts` (5 cases: D1 sweep, D1 spin-on, D2 hypotheses, D4 assertions).
Raw output: `.cache/pinclick-run2.log` (sweep) and `.cache/pinclick-d2.log` (stacks).

## D1 — before the fix, measured at HEAD `dcf2214`

Spin pinned per angle with `__globe.setSpin(true, deg)`, a real `page.mouse.click` at the pin's projected
point, classification `dot(pin normal, direction to camera)` with the prompt's bands (front `>= 0.15`,
grazing `0..0.15`, back `< 0`). 12 azimuths x 4 regions = **48 clicks**.

| band | attempts | selected | rate |
|---|---:|---:|---:|
| **front** (`>= 0.15`) | 23 | **9** | **39.1 %** |
| grazing (`0..0.15`) | 1 | 0 | 0 % |
| **back** (`< 0`) | 24 | **13** | **54.2 %** |

The full 48-row table is in `.cache/pinclick-run2.log`. The two facts that matter:

1. **A front-facing pin selects only 39 % of the time.** The defect as reported ("hit-or-miss at certain
   rotation angles") is real and is worse than "occasional": it is the majority behaviour.
2. **A back-facing pin selects 54 % of the time.** A click on the far side of the planet, where there is
   nothing visible to click, changes the selection. That is not the reported defect — it is a second one,
   and it is the one with a clean structural cause (§ D2(f)).

Failure examples (front, not selected):

| az | region | facing | top raycast hit |
|---:|---|---:|---|
| 0 | pacific | 0.4574 | `Mesh@3.407` |
| 90 | se-asia | 0.3416 | **`(none)`** |
| 120 | pacific | 0.4005 | `Mesh@3.458` |
| 120 | se-asia | 0.7442 | `Mesh@3.250` |
| 180 | horn-africa | 0.6713 | `Mesh@3.451` |
| 240 | horn-africa | 0.9569 | `Mesh@2.846` |

And the two horn-africa "front" successes-with-a-miss at az 150 / 300 returned `Points@34.221` and
`Points@31.388` — the **starfield**, i.e. the ray passed through the whole scene and hit only stars. So at
those angles the projected pin point is not even over the globe.

## D2 — the six hypotheses, each with its evidence

| # | hypothesis | verdict | evidence |
|---|---|---|---|
| **a** | the pin hit target is too small | **NOT the cause** | The hit target is the additive ring `planeGeometry [0.22, 0.22]`, not the 0.011 core (the code says so and `MOBILE_AUDIT #2` measured the core at 6-12 px). A click that misses the ring still hits the globe. 0.22 world units at d 3.78 is ~45 px across for a front pin, far larger than a click. |
| **b** | an invisible/non-rendering mesh intercepts the ray | **NOT supported** | Every hit in every stack is an unnamed `Mesh` with no `visible: false` and no non-pin material in front; where a front pin failed, the top hit distance (2.8-3.5) is consistent with the globe's own front surface, not with an atmosphere/cloud/halo shell closer than the pin. No hit was reported as hidden. |
| **c** | spin moves the pin between pointerdown and pointerup so R3F drops the click | **NOT the cause of the sweep failures** | The sweep pins the spin (`setSpin(true, deg)`), so nothing moves between the projection and the click, and the failures persist. The spin-on case is the separate experiment and is measured below. |
| **d** | a click after a small drag is treated as a drag | **NOT the cause** | The failures use `page.mouse.click` at a single point with no movement between down and up; OrbitControls' drag threshold is never crossed. |
| **e** | pointer-miss fires for hits already handled | **NOT observed** | Every click that selected also left the drawer open; the close count is 0 in all 48 rows. (Caveat stated plainly: with nothing selected before the click, `closed` cannot become true by construction, so this row is evidence *against* a spurious close, not a positive measurement of the handler.) |
| **f** | back-facing pins respond to clicks THROUGH the globe | **CONFIRMED — root cause of the 13/24** | R3F fires an event on **every** intersected object from nearest to farthest unless `stopPropagation` is called. The globe's surface mesh carries no handler, so a click whose ray hits the planet in front of a hidden pin continues to the pin behind it, whose ring `onClick` calls `onSelect`. That is why a pin at `facing = -0.89` selects: the user clicked the ocean and got a region. |

### What the front failures are, given (a)-(e) are out

The sweep shows the two mechanisms that are left, and both are visible in the data:

- **`(none)` and `Points@34` rows**: the projected pin point is not over the globe at all. A front
  classification (`dot >= 0.15`) says the pin faces the camera, but near the limb the pin's own world radius
  (anchor × idleLift + offset, ~1.05 R) projects OUTSIDE the R = 1.0 silhouette, so the click lands in the
  sky. `dot` alone cannot express this — it measures the hemisphere, not whether the pin's screen point is
  inside the disc.
- **`Mesh@3.4` rows with a front pin**: the ray reaches the globe's front surface at a distance longer than
  the pin's own, which means the pin's ring plane is edge-on to the ray at that angle (the ring lies tangent
  to the surface, so as `facing → 0.15` it is ~81° from face-on and its screen footprint collapses to a
  sliver). A click at its projected CENTRE then falls between the sliver's pixels.

So the real defect is: **the hit target is a tangent plane whose footprint collapses at oblique angles, and
its screen position is allowed to leave the silhouette while the classification still calls it front** — plus
the independent occlusion bug (f). Neither is a threshold problem, and neither can be fixed by growing a
radius: at 0.22 units the ring is already ~45 px for a front pin.

## Where the fix stops, and why

D3 allows exactly the tools that would address this — a non-rendering hit proxy, raycast filtering, an
occlusion test — and the two fixes are now well specified:

1. **Occlusion (f)**: in `Hotspot.tsx`'s ring `onClick`, compare the pin's own intersection distance with the
   nearest planet-surface intersection and ignore the click when the planet is in front. No pixel change.
2. **Oblique footprint**: replace the tangent-plane click target with a **camera-facing** hit proxy (a
   billboarded disc at the pin's screen position, `visible = false` but raycastable, or a `Raycaster.params`
   override), which keeps a constant screen footprint at every angle. No pixel change.

Both are one-file product changes, and both then need D4 green at 12 angles x 4 regions x 2 spin states plus
the S1 residual-0 re-check — a spec-measure-fix-measure cycle that this session does not have the remaining
tool budget to run honestly. **No product file was touched for step D**, so nothing is half-fixed: the
measurement above is the next session's starting point, exactly as the prompt's D1 asks ("Measure BEFORE
changing anything").

## Reproduce

```bash
pnpm build:e2e
npx playwright test pin-click.spec.ts --reporter=list -g "D1 sweep"     # 48 clicks, the two tallies
npx playwright test pin-click.spec.ts --reporter=list -g "D2 hypotheses"
```

Measured wall: sweep 39.4 s, D2 6.3 s, both at 1440x900 against `dist-e2e` built from `dcf2214`.

---

# Resolved (step 3B2-FIX2-CONT) — the sweep, before and after, on the same 48 poses

The defect this memo measured is **fixed and asserted**. Same protocol throughout: spin pinned per angle with
`__globe.setSpin(true, deg)`, a real `page.mouse.click` at the pin's projected head, classification
`dot(pin normal, direction to camera)` with the prompt's bands (front `>= 0.15`, grazing `0..0.15`, back `< 0`).
12 azimuths x 4 regions = **48 clicks**.

| band | attempts | selected BEFORE (`dcf2214`) | rate | selected AFTER (`1a3b44f`) | rate |
|---|---:|---:|---:|---:|---:|
| **front** (`>= 0.15`) | 23 | 9 | **39.1 %** | **23** | **100.0 %** |
| grazing (`0..0.15`) | 1 | 0 | 0 % | 1 (reported, not asserted) | — |
| **back** (`< 0`) | 24 | 13 | **54.2 %** | **0** | **0.0 %** |

The one grazing row after the fix is az 240 `se-asia` at `f = 0.1126`; it selects, because the gate is at
0.075 (see `docs/STEP3B2-FIX2-AUDIT.md`, "RESOLUTION"). The single front row behind the limb — az 120
`us-west`, `f = 0.2064` — also selects, and that is the accepted side effect, now asserted by D6 rather than
tolerated.

**With the spin RUNNING** (20 attempts per region, 50 ms hold, projected at pointerdown): **front 22/22 = 100 %**
and **back 0** on the presses the harness can deliver cleanly (the proxy hit at both `pointerdown` and
`pointerup`, which is R3F's precondition for `onClick`). 22 of 74 attempts qualified: the measured press window
is 315-400 ms on this machine and a pin at 12-38 px/s leaves a 14 px radius inside it, so the dirty rows are a
statement about CDP latency, not about the gate. Full detail in `docs/E2E.md`.

## The evidence trail (gitignored, under `.cache/fix2/`)

Every number above came from a probe that is still on disk and still re-runnable. Nothing here is committed —
`.cache/` is gitignored — so these are named so a later session can rebuild each measurement instead of
trusting this prose.

| probe | what it answers | how to re-run |
|---|---|---|
| `probe-geometry.mjs` | the nearest pin pair (0.89532 R), the neighbour-overlap cap (0.44766 R), and that a 14 px proxy is 0.04513 R — 9.9x under it | `node .cache/fix2/probe-geometry.mjs` |
| `probe-gate.mjs`, `probe-gate2.mjs`, `probe-gate3.mjs` | the algebra: the old gate at `d_fit` (0.27720) and `dMax` (0.20948) against the 0.15 band edge; the `6.98 R` distance it would need; the true occlusion horizon (-0.171) that overshoots the back band | `node .cache/fix2/probe-gate.mjs` (2 and 3 add the per-row sweep and the head-radius variants) |
| `b1-probe.mjs` | the drawer-occlusion measurement behind the switcher's B1 audit: every card centre resolves to a drawer node | `node .cache/fix2/b1-probe.mjs` (needs the built bundle served on 4197) |
| `tab-probe.mjs` | the tab-order measurement behind S4's scoped assertion: the closed drawer's one live tab stop is the pre-existing close button, and the chips take 0 of 28 landings | `node .cache/fix2/tab-probe.mjs` |
| `pinclick-run2-d1.log`, `pinclick-run22-full.log` | the raw 48-row tables behind the before/after column, and the full 7-case run | `npx playwright test tests/e2e/pin-click.spec.ts` |

The probes are `.mjs` run by `node`, deliberately: a `.spec.ts` body copied into one fails to parse on its `as`
casts, so they are written cast-free.

## Reproduce (updated)

```bash
pnpm build:e2e
npx playwright test tests/e2e/pin-click.spec.ts --reporter=list   # 7 cases, ~10 min
```

The old instructions here (`-g "D1 sweep"` / `-g "D2 hypotheses"`) still work, but note that **D1 sweep now
asserts** rather than only measuring, and its `openLive`/`clearSelection` helpers wait for the camera to be
still — clicking a point read mid-flight was the cause of a false 82.6 % on the first run of this step.
