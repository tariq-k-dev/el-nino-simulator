# STEP 3 status

Session log for the Step 3 framing work. One row per step; each prompt lives in `docs/prompts/`.

| step | state | commit | notes |
|---|---|---|---|
| 2B-STEP3-A | PARTIAL — stopped at B, red gate | `8f9e1aa`, `01d0f83` | audit + status only; B was red |
| 2B-STEP3-A-FIX | **STOPPED at B2 — legacy verification red** | `4c7801d`, `01d0f83`, `70ca2b5` | uTime fix landed; N10 fails as a direct result |

---

## 2B-STEP3-A-FIX (current session)

### P0 preflight — done

- HEAD `8f9e1aa`; `git status` showed exactly the four expected untracked files plus the prompt.
- Orphan sweep clean: no `node.exe`, no `ms-playwright` chromium, no Brotli listener. The
  `chrome.exe` entries resolve to `C:\Program Files\Google\Chrome\Application\chrome.exe` —
  the user's own browser, not this repo's.
- Prompt committed alone as `4c7801d`.

### A audit commit — done (`01d0f83`)

`docs/STEP3-AUDIT.md` + `docs/STEP3-STATUS.md`, docs only, by explicit path.

### B1 the uTime fix — done, gate green (`70ca2b5`)

Helper `src/scene/lookTime.ts`:

```ts
export const FROZEN_LOOK_TIME = 0;
export function lookTime(animate: boolean, elapsed: number): number {
  return animate ? elapsed : FROZEN_LOOK_TIME;
}
```

- `animate` true returns `elapsed` unchanged, so the live product is byte-identical.
- `animate` false returns the constant **0** — the same value `Starfield.tsx:109` already froze at,
  chosen so the whole frozen scene shares one number. Not "the last clock value": that differs per
  load, which is the failure `Starfield.tsx:101-108` documents.
- Call sites: `Globe.tsx:224` (atmosphere breathe), `Hotspot.tsx:58` (pin ring pulse).

Formulas, for the record:

| term | formula | at `uTime = 0` |
|---|---|---|
| atmosphere breathe (`shaders.ts:114`) | `1 - uBreatheAmp + uBreatheAmp * sin(uTime * 0.6)` | `1 - 0.015 = 0.985` (the trough) |
| pin ring pulse (`shaders.ts:227`) | `fract(uTime * 0.45 + uPhase)` | `fract(uPhase)` |

Unit tests: 6 in `src/scene/lookTime.test.ts`. Gate (one cell): `tsc -b`, `lint`, `test`
(**760** = 754 + 6), `build` — all green, exit 0.

### B3 residual matrix — done, every pair exactly 0, no tolerance

Three fresh page loads x three captures each, plus cross-load pairs (`scripts/tmp-refmatrix.mjs`,
untracked):

| scope | loads | pairs | max \|dLuma\| | pixels > 1/255 |
|---|---|---|---:|---:|
| in-page | A, B, C | 9 (#0~#1, #1~#2, #0~#2 each) | **0** | **0** |
| cross-load | A~B, A~C, B~C | 6 (#0 and #2 each) | **0** | **0** |

Pre-registered rule applied: **every pair exactly 0 ⇒ the equivalence test requires exactly 0.**
No fallback tolerance was invoked and none is needed. The previous session's residual is gone,
which is the B1 fix working.

### B2 legacy verification — **RED. STOPPED HERE.**

`pnpm e2e:look` through the batched runner: **27/28, not 28/28**. `negative.spec.ts` N10 fails.

| test | control | defect | verdict |
|---|---|---|---|
| N9 (overlay off) | max 88.52, area6 9594 | identical frames, 0 differing px | ok |
| **N10 (si 1.0, no roughness floor)** | max 88.52, area6 9594 | **max 87.52, maxAbs 87.52, area6 9401** | **FAIL** |

N10 requires `defect.max > 110.7` (or `area6 > 12472`) and that the defect *adds* specular. It
measures 87.52 / 9401 — the defect now *lowers* the peak by 1.0.

**Caused by the B1 fix, and the bisection is unambiguous.** Same tree, same bundle pipeline, one
file reverted per build, N10 run in isolation each time:

| Globe.tsx | Hotspot.tsx | N10 defect | verdict |
|---|---|---|---|
| parent `01d0f83` | parent | max 136.96, maxAbs 218.66, area6 10523 | **pass** |
| fixed | fixed | max 87.52, maxAbs 87.52, area6 9401 | **fail** |
| parent | fixed | max 87.52, maxAbs 87.52, area6 9401 | **fail** |
| fixed | parent | max 122.74, maxAbs 196.83, area6 10754 | **pass** |

So it is the **atmosphere** gate specifically, not the hotspot gate. Both files were restored to
HEAD afterwards.

Why an atmosphere change moves a specular difference image: 3.9 is a difference of two frames
that differ only in the specular contribution, and the additive atmosphere shell is composited
over the disc. Freezing the breathe at 0 (its trough) makes the halo ~1.5 % dimmer than the phase
the baselines were recorded at, shifting every compared pixel — so the defect's difference is
taken against a slightly different base. Measured live (`scripts/tmp-n10-phase.mjs`, frozen
`uTime = 1.962` in this build): the control on-vs-off pair is still 88.52 / 9594, i.e. **the
sentinel itself is intact**, and the defect's absolute contribution against the control is still
large (max 195.77 at (807,294), area6 5217). What collapsed is N10's specific defect response
after differencing.

Honest reading: **the frozen phase moved a raw number that N10's defect is tuned against, without
touching any threshold.** Every bound, window and defect definition is untouched, and I changed
none of them.

Consequences:

- **No threshold, window, bound, gate or defect was modified.**
- **B2's disclosure commit has not been made** — there is no green run to disclose against.
- **B3's PNG and registration commits are blocked** behind B2's green run.
- **C (insets registry) and the final full e2e were not started.**

### Deviations / process notes

1. Two of the initial failures were infrastructure, not product: 3.9 and 3.7 died with
   `net::ERR_CONNECTION_REFUSED` after the runner killed a slow file's tree, and
   `negative.spec.ts` was killed at its 480 s `FILE_TIMEOUTS_MS` cap. Both were re-run; N9 passed,
   N10 failed in isolation too.
2. `terminal(notify=...)` is rejected by the tool schema on this host, so E2E runs were driven with
   `Popen` + argv lists from `execute_code`, polling under 240 s, per `docs/E2E.md`.
3. `scripts/tmp-refmatrix.mjs` and `scripts/tmp-n10-phase.mjs` are untracked probes and are **not
   committed**; they are the evidence for the tables above.

### Exact resumption point

One decision, then B2 can go green. I did not pick one:

| option | what it means |
|---|---|
| A. freeze the atmosphere at the phase the baselines were recorded at | keeps N10's defect response; needs that phase value justified from recorded evidence, not chosen to pass |
| B. exclude the atmosphere from the glint acquisition | changes what 3.9 measures — a look-owner decision, not mine |
| C. re-baseline N10's defect expectation | a threshold change, explicitly forbidden by this prompt |

---

## 2B-STEP3-A (previous session, kept for the record)

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
