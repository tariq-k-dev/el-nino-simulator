# GLINT ATTENUATED (V2) - needs Tariq's decision

**Verdict, applied mechanically in 2B-C1-FIX: V2 — the glint is ATTENUATED, not removed.**
V1 does not pass (peak retention `max(Do)/max(Dt)` = 0.5395 against a 0.60 floor), but the
area criterion does (`area6(Do)/area6(Dt)` = 0.6202 against 0.50). The earlier heading said
"GLINT REMOVED", which overstated it: the material's lobe is gone, the additive overlay
still draws 62% of the approved lobe's area. Numbers: `FACTS-2B.md` §d.

The material's own sun glint was zeroed in SPECLOCK Step 1 and **has not been
restored**. Measured as a difference image (B1, 2A2), the current build keeps only
**53.95%** of the approved look's glint peak (88.52/255 vs 164.07/255), which is below
the 60% retention the task set. Two candidates were built and measured on the real
render — both still clip — so nothing was adopted and `specularIntensity` stays **0**.

Look at `glint-before-after.png`: left is the approved look (si 0.18), right is the
current build. The bright lobe above and right of centre is the missing piece.

| candidate | default-view max | vs Dt | area6 | clipped (worst of 12 az) | largest blob | mean luma | verdict |
|---|---|---|---|---|---|---|---|
| si 0.18 (pre-fix) | 164.07 | 1.000x | 15469 | **49** | 49 | +3.10% | reject: clips |
| si 0.12 | 130.00 | 0.792x | 14400 | **23** | 24 | +2.74% | reject: clips |
| **si 0 (current)** | 88.52 | **0.540x** | 9594 | **0** | 0 | baseline | keeps 0 clipped px, loses the lobe |

Neither candidate survived `0 clipped px at all 12 azimuths`, so per the task rule the
thresholds were not relaxed and no grazing-falloff shader was shipped. The falloff
patch was written and **never reached the GPU** — `onBeforeCompile` measured zero
invocations because R3F only renders on invalidation, so the patch compiled nothing and
the si=0.18 frame came back pixel-identical to the unpatched reference (max 164.07,
area6 15469, clipped 49). Fixing that is the open work, and it is the prerequisite for
reinstating the glint at all.

---

# CLIPPED-FACTS — the 13 / 52 / 38 pixels at azimuths 150 / 210 / 240

Investigated before fixing, per the task. Ablation harness:
`tests/e2e/look/clipped-probe.mjs` (output `.cache/clipped/report.json`).

Fixed viewport 1280×800, DPR 1, DOM chrome hidden, stars/pins/rings OFF (the glare
rule excludes them). Clipped = **min(R,G,B) ≥ 250** inside the disc.

---

## A. Per-azimuth inventory (before the fix)

| az | clipped px | largest luma blob | blob geometry | position (r/R) |
|---:|---:|---:|---|---|
| 0 | 0 | 0 | — | — |
| 30 | 0 | 0 | — | — |
| 60 | 0 | 0 | — | — |
| 90 | 0 | 0 | — | — |
| 120 | 0 | 0 | — | — |
| **150** | **49** | **49** | 9×11 px compact | **0.731** @ 221° |
| 180 | 0 | 0 | — | — |
| **210** | **24** | **11** | 8×6 + 4×2 + 2×1 | **0.953** @ 252° |
| **240** | **38** | **36** | 24×6 elongated | **0.998** @ 279° |
| 270 | 0 | 0 | — | — |
| 300 | 0 | 0 | — | — |
| 330 | 0 | 0 | — | — |

(The earlier note said 13 / 52 / 38. Re-measured now at 49 / 24 / 38 — the numbers
move because the star field is now seeded and the scene clock is pinned, so this is
a stable measurement rather than one sample of a different sky. Azimuths and the
limb-hugging character are unchanged.)

Sample coordinates:

| az | first offending pixels | reading |
|---|---|---|
| 150 | (460,243) (461,243) (456,244) … | `rgb 255,255,255`, r/R 0.729–0.741 |
| 210 | (551,100) (539,101) (549,101) … | `rgb 255,255,255`, r/R 0.955–0.969 |
| 240 | (686,78) (687,78) (691,79) … | `rgb 255,255,255`, r/R 0.997–1.000 |

All three clusters sit on a **circle 0.73–1.00 R from the disc centre**, and
azimuths 150/210/240 are the ones where the sun's reflection region rotates toward
the limb.

---

## B. Ablation — one contributor at a time

| Toggle | az 150 | az 210 | az 240 |
|---|---:|---:|---:|
| baseline | 49 | 24 | 38 |
| (shader) glint overlay OFF | 49 | 23 | 36 |
| bloom OFF | 44 | 22 | 31 |
| clouds OFF | 49 | 33 | 38 |
| atmosphere OFF | 49 | 24 | 38 |
| pins ON | 49 | 24 | 38 |
| rings ON | 49 | 24 | 38 |
| stars ON | 49 | 24 | 38 |
| **(material) specularIntensity = 0** | **0** | **0** | **0** |

**Cause: grazing-angle sun glint from the surface material's own GGX specular**
(`meshPhysicalMaterial.specularIntensity`), not bloom, not clouds, not the glint
overlay, not the atmosphere, and not any pin/ring/star.

The evidence is not just "one toggle zeroes it":

- The glint **overlay** shader moves it by 0–2 px. The **material**'s specular
  zeroes it outright. Two different specular paths, and only one is responsible.
- Bloom reduces it (49→44, 38→31) but does not clear it, consistent with bloom
  *amplifying* a bright pixel that already exists rather than creating it.
- Clouds *increase* it at az 210 (24→33) — removing clouds exposes more ocean,
  which is more specular surface. That is corroboration, not noise.
- The offenders hug the limb (r/R up to 1.000). A GGX lobe tightens as the view
  angle grazes the surface, which is exactly why the defect appears only at the
  azimuths that put the reflection region near the limb.

---

## C. The fix

`GLOBE_LOOK.surface.specularIntensity: 0.18 → 0`.

The ocean glint in the approved look comes from the additive overlay shader
(`GLOBE_LOOK.specular`), which is ocean-masked and capped. The material's own
specular had no remaining job except to clip, so it is removed rather than merely
reduced.

### Budget check at the default view

| Measure | si = 0.18 | si = 0 | Delta | Budget | Verdict |
|---|---:|---:|---:|---:|---|
| clipped px | 0 | 0 | 0 | — | — |
| mean luma (disc) | 72.096 | 71.209 | **−1.23%** | ≤ 2% | **PASS** |
| day side proxy | 121.34 | 119.86 | −1.22% | — | — |
| night side proxy | 24.46 | 24.37 | −0.35% | — | — |
| night/day ratio | 0.202 | 0.203 | **+0.0018** | ≤ 0.02 | **PASS** |

The day side loses a faint sheen and nothing else. The terminator and the night
side are effectively untouched, which is what you would expect from deleting a
specular term that only existed where the sun's reflection caught a glossy ocean.

### Acceptance — all 12 azimuths, after the fix

| az | clipped px | largest luma blob |
|---:|---:|---:|
| 0 | 0 | 0 |
| 30 | 0 | 0 |
| 60 | 0 | 0 |
| 90 | 0 | 0 |
| 120 | 0 | 0 |
| 150 | **0** | **0** |
| 180 | 0 | 0 |
| 210 | **0** | **0** |
| 240 | **0** | **0** |
| 270 | 0 | 0 |
| 300 | 0 | 0 |
| 330 | 0 | 0 |

**0 clipped px and largest blob 0 px at every azimuth** (rule: 0 px and ≤ 12 px).

---

## D. Note on the earlier LOOK2 numbers

LOOK2 recorded 13 / 52 / 38 for az 150 / 210 / 240 and called them "isolated 1–2 px
cloud highlights at the limb ... not a glare patch". Two things were wrong there:

1. The counts were inflated/unstable across runs because the sky and the planet's
   longitude were not pinned. Re-measured deterministically: 49 / 24 / 38.
2. "Cloud highlights" was a guess and it is **falsified** by the table above —
   switching clouds off does not reduce the count at az 150 or 240, and *raises* it
   at az 210. The cause is ocean specular.

That is the same failure mode as the `(53,123,204)` mis-attribution corrected in
`STEP2-FACTS.md`: a plausible mechanism asserted instead of ablated. The ablation
table exists so the next one is read off data.
