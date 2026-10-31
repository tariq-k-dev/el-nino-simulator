# D1 DIAGNOSIS — the N1/N3 defects were never lost

Measured this session against the stamped E2E bundle (`srcHash cfcf483bed4b`, built from
`0b7f7b8`). This replaces the explanation recorded in `docs/HERMES-HANDOFF.md` §5.1 and in the
`test.fixme` comments of `tests/e2e/negative.spec.ts`.

## The claim being tested

> "Between them the injected light's contribution is compiled back out before the capture."

`fitLimb` swaps the surface to unlit white and restores it, and every `setLayers` call routes
through the flag store into a React re-render — the theory was that one of those two discards the
injected defect. If true, the defect would be absent or inert at capture time.

## Evidence — N1, four moments, recorded in order

Probe: `tests/e2e/_d1-probe.spec.ts` (scratch, deleted). Defect: amber `<pointLight>` intensity 2,
distance 1, placed at the **CORE world position** of `us-west` — the only pin VALID at az 0 per
V0(c) — via the new `__look.pinsWorld()` hook.

| moment | lights | injected parent uuid | programs | frame | light pos | intensity |
|---|---:|---|---:|---:|---|---:|
| after `setLayers` | 3 | — | 16 | 420 | — | — |
| after `fitLimb` | 3 | — | 17 | 1662 | — | — |
| after inject | **4** | `54aff42a…` = **scene root** | 20 | 1824 | (−0.4402, 0.6635, 0.7625) | 2 |
| after `setLayers` pins-on | **4** | unchanged | 20 | 2004 | unchanged | 2 |
| after recompile + render | **4** | unchanged | **35** | 2113 | unchanged | 2 |
| **at capture** | **4** | unchanged | 35 | 2689 | unchanged | 2 |

The scene root uuid is stable across every moment (`54aff42a`), so no parent was remounted. The
program count **rose 20 → 35** when the material rebuild ran, i.e. the new light count was
compiled in, not out. The frame counter advanced at every step, so the renderer actually drew.

## Evidence — N3, the atmosphere uniform

| moment | `uAlphaCap` | atmosphere material uuid | shader replaced |
|---|---:|---|---|
| after `setLayers` | 0.72 | `b54fbcae…` | no |
| after `fitLimb` | 0.72 | `b54fbcae…` (**same instance**) | no |
| after inject | **1.0** | `b54fbcae…` | — |
| after `setLayers` | **1.0** | `b54fbcae…` | — |
| **at capture** | **1.0** | `b54fbcae…` | — |

`fitLimb` did not even replace the atmosphere material — the uuid is identical before and after.

## Evidence — the defect reaches the pixels, at a magnitude nothing can miss

Probe: `tests/e2e/_d1b-probe.spec.ts` (scratch, deleted). Same light, same position; the annulus
is exactly the one `measureRingCast` uses (30–60 px around the pin, clipped to the disc):

| quantity | before inject | after inject | delta |
|---|---:|---:|---:|
| annulus mean luma (n = 8478 px) | 28.8244 | 123.6803 | **+329.08 %** |
| pixels moved by > 2/255 (whole frame) | — | 174,938 | — |
| max per-pixel delta | — | 247 | — |

Against a gate of `max(3, 1.5 × noise)` %, a +329 % change is two orders of magnitude past it.

## Cause — stated plainly

**The defect was never lost. The earlier measurement was not measuring the defect.**

Three separable faults, all now fixed by the D2 architecture:

1. **The light was placed at a screen pixel pair.** The previous N1 read
   `pinAnchors()` and then injected at `(291.04, 482.31)`-style coordinates, which are
   `project()` output in CSS pixels. Those are an (x, y) pair in a plane 291 units right and 482
   units down — nowhere near the globe. A light there is caught by `distance: 1` falloff long
   before the surface and contributes nothing **regardless of the program rebuild**. This alone
   explains a 0.002 % delta with the light correctly present in the scene graph, which is exactly
   the signature that was recorded.

2. **The injection was a one-shot write, sequenced by hand.** `measureRingCast`'s `afterFit`
   callback ran once. `measureRingCast` itself then calls `setLayers` three more times (before
   `on`, before `off`, before `off2`), and each is a React re-render. Nothing re-asserted the
   defect after those, so correctness depended on the reader tracing the call order by eye. The
   D2 design removes the ordering question: install happens once, `onBeforeRender` re-applies it
   idempotently every frame, and a survival probe refuses to capture if it is not live.

3. **No step ever asked whether the defect was still present at the shutter.** Without that, a
   zero result is ambiguous between "the check is blind" and "the defect never arrived", and the
   only honest response to an ambiguous zero is to stop — which is where N1/N3/N4 ended up. The
   survival probe makes the two distinguishable, so a negative test now reports which one it is.

The `fitLimb`-recompiles-it-out theory is **withdrawn**. It is not supported by any measurement
above: the light survives `fitLimb`, the `setLayers` re-renders, the program rebuild, and the
capture, and it moves pixels by 329 %.

## What this does not claim

- It does not claim the old numbers were invented. `annulus 59.5052 / 59.5052` is consistent with
  a light sitting far from the globe; that is what those numbers look like.
- It does not re-derive the 4.1697 → 31.3786 standalone result. That probe placed its light
  differently and is not in dispute.

---

# N4 — the one negative that still cannot run, and why it is NOT the same failure

After D2 fixed the delivery path, N1, N2, N3, N5, N7 and N8 all go red correctly under
their defects. **N4 does not**, and its reason is different in kind from the old N1/N3/N4
notes.

The fill light is real, correctly placed and provably live: lights 4, intensity 0.32,
position exactly (-5.2, -2.2, -4.6), parented to the scene root, survival probe clean,
`frameAtProbe` advancing.

What it does not do is reach the pixels anywhere near W1:

| quantity | measured |
|---|---:|
| disc pixels | 333,185 |
| pixels moved by more than 2/255 | **3** |
| mean signed luma delta inside the disc | +0.069 |
| max signed luma delta anywhere in the disc | **+2.51** (at r/R 0.977, −168°) |
| W1 raw RGB, before → after | (0,4,28) → (0,4,**31**) |
| W1 sigma-3 blurred peak, before → after | 4.95 → 6.02 |
| W1 ratio, control → defect | 0.976 → 0.982 (gate 1.15) |

The defect lifts W1's blue channel by 3/255 over a night ocean at ~5/255 luma, and moves
three pixels in the entire disc. That is a property of `intensity: 0.32` against a sun of
`intensity: 3.6`, not of the harness — no injection strategy changes it.

## Three ways forward, all needing a decision

1. **Raise the defect intensity** (e.g. 3.2, ten times the retired fill light). Rejected for
   this run: the prompt names 0.32, and altering a defect until a test passes is the same
   error class as tuning a threshold to a render.
2. **Move W1** to r/R 0.977 at −168°, where the light actually lands. This EDITS the 3.3
   gate to fit the defect, which is explicitly forbidden.
3. **Change 3.3's metric** from a blurred-luma ratio to a per-channel blue difference, so a
   3/255 blue lift in a dark window is detectable. This is the honest fix, and it changes
   the definition behind a committed threshold, so it needs sign-off before implementation.

N4 therefore stays `test.fixme` with these numbers in its own comment and here. It is not
parked because delivery is broken — delivery is measured working. It is parked because 3.3's
ratio gate is blind at this signal level.
