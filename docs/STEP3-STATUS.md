# STEP 3 status

Session log for the Step 3 framing work. One row per step; the prompt for each step lives
in `docs/prompts/`.

| step | state | commit | notes |
|---|---|---|---|
| 2B-STEP3-A | **PARTIAL — stopped at B, red gate** | see below | preflight + A done; B blocked, C not started |

## 2B-STEP3-A

### P0 preflight — done

- `git log -1` at start: `1f3b300 docs(close): E2E runner invariants and verified runs; SPEC LOCK CLOSED`.
- Tree clean apart from the incoming prompt; prompt committed alone as
  `docs(step3): add prompt 2B-STEP3-A (framing foundations part 1)` (`8f9e1aa`).
- Orphan sweep: no `node.exe`, no Playwright chromium, no leftover Brotli listener. The
  `chrome.exe` / `msedgewebview2.exe` entries present are the user's own browser and the
  Hermes desktop shell, not this repo's.

### A audit — done

`docs/STEP3-AUDIT.md`, committed alone.

### B reference frame — **BLOCKED, red gate, not committed**

The gate is `max residual === 0` between two captures of the same pinned pose. It is not
zero. **No tolerance was invented and no PNG was committed.**

Measured with `tests/e2e/ref.spec.ts` (`pnpm e2e:raw -- tests/e2e/ref.spec.ts`):

| run | max \|Δluma\| | at | pixels > 1/255 |
|---|---:|---|---:|
| run 1 (inside the spec) | 2.0722 | (941, 276) | 7144 |
| run 2 (inside the spec) | 2.0000 | (959, 337) | 2820 |

The residual is **not** deterministic frame noise in the sense of "the same two frames
again": it accumulates monotonically over a sequence of captures, so it is a time-varying
uniform, not a random dither.

#### Bisection (scripts/tmp-refdiag2.mjs, 4 captures per configuration)

| layers | max \|Δ\| vs capture 0 (captures 1, 2, 3) |
|---|---|
| all on | 1.0 → 3.0 → 4.0 |
| stars off | 2.0 → 3.07 → 3.0 |
| bloom off | 1.79 → 2.07 → 2.79 |
| clouds off | 2.0 → 3.0 → 3.0 |
| atmosphere off + pins off | 1.0 → 1.0 → 1.0 |
| **all layers off** | **0 → 0 → 0** |
| atmosphere + pins off (repeat) | 1.0 → 1.0 → 1.0, **gt1 pixels: 0**, at (654, 411) |

So the camera is clean: with every layer off the frame is bit-identical. Removing the
atmosphere and the pins drops the count of pixels differing by more than 1/255 to **zero**
— the only remaining difference is a single pixel at (654, 411) whose luma differs by
exactly 1.0, i.e. 8-bit rounding.

#### Root cause

`src/scene/shaders.ts:114` — the atmosphere fragment shader breathes on the **scene clock**:

```glsl
float breathe = 1.0 - uBreatheAmp + uBreatheAmp * sin(uTime * 0.6);
```

and `src/scene/Globe.tsx:224` writes `u.uTime.value = t` where `t = state.clock.elapsedTime`,
**unconditionally** — unlike `Starfield.tsx:109`, which gates the same uniform on
`look.animate ? state.clock.elapsedTime : 0`. `look.animate` is false in the reference pose
(`__look.setAzimuth` sets it), so every other time-driven effect — planet spin, cloud drift,
star twinkle, star rotation — is frozen and the atmosphere is not.

Amplitude is `GLOBE_LOOK.atmosphere.breatheAmplitude = 0.015` (`globeLook.ts:71`), which is
why the swing is ~1–4/255 on the rim and zero in open sky.

`src/scene/Hotspot.tsx:58` has the same unconditional write
(`uniforms.uTime.value = state.clock.elapsedTime`) for the pin ring shader. It is invisible
while rings are OFF (the reference pose) but it is the same defect, and it would make the
pin ring pulse during any later framing capture that wants rings on.

#### Why this blocks B and why it is not mine to fix in this step

The prompt for this step is explicit: this session changes **no look behaviour**, and every
look threshold and window must stay untouched. Gating the atmosphere breathe on
`look.animate` is a two-line, look-flag-respecting change of exactly the kind
`Starfield.tsx` already does — but it changes the rendered pixels of a live scene over time,
and it is a product decision for the step that owns the look, not a side effect of adding a
reference frame.

The alternative — freezing `uTime` only inside the capture path — is worse: it would make
the reference PNG a picture of a scene the product never renders, which is precisely the
class of mistake `tests/e2e/look/shippedLook.ts` was written to prevent.

### C insets registry — NOT STARTED

Blocked behind B by the prompt's own ordering (`B` before `C`, and C's layout assertion is
supposed to be made against a trustworthy reference frame).

## Exact resumption point

1. Decide the atmosphere/pin-shader clock gating question (above), in whichever step owns
   look behaviour, then re-run `tests/e2e/ref.spec.ts`. Expected after the fix:
   `residual maxAbs=0`, `differingPixels=0`.
2. Resolve the PNG size question (see below) — it is independent and will bite immediately.
3. Re-run B, commit the reference PNG alone, then proceed to C.

## Second, independent problem in B: the 300 KB budget is unreachable as a PNG

Reported at the same time because it is a prompt-level constraint, not a bug:

- The default look at 1280x800 is a **256.7 KB** PNG for the whole canvas
  (`docs/globe-look/look2-default.png`).
- The required crop is the disc **plus 40 px** = 732x732, and cropping to it *raises* the
  encoded size to **680 KB** (default settings, `colorType 2`, `deflateLevel 9`,
  `filterType 4`), because the crop throws away the cheap-to-compress sky that dominated the
  full frame.
- Post-processed frames are noisy by nature, so no PNG setting reaches 300 KB at that size.

Options, none of which I took unilaterally:

| option | size | trade-off |
|---|---|---|
| keep the 732x732 crop as PNG, budget raised to 800 KB | ~680 KB | deviates from the prompt's 300 KB |
| whole canvas, no crop | 257 KB | fits the budget, but the file then changes when unrelated chrome does |
| crop at half resolution (366x366, nearest) | ~190 KB | fits, but the reference stops being pixel-exact |

## Deviation log

- B is **not committed**. The prompt says "commit alone" only on a green capture; the
  capture is red, so there is nothing to commit but a file that records a jittering scene.
- Everything else in A is committed and the audit contains no look/spec/threshold change.
