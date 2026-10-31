TASK 3B-1a-SPECLOCK-2B-C2A v3 (negative tests that actually run). Repo: cd D:\Dev\Handshake\Build-an-Interactive-Data-Visualization (ONLY repo).
FIRST confirm you can see the last line "END OF PROMPT 2B-C2A"; if not, STOP. Prerequisite: C1-FIX accepted (commit b21d501).
Rules: gate = pnpm tsc -b && pnpm lint && pnpm test && pnpm build (never tsc -p); one commit per step; STOP on real failures and report numbers, never tune thresholds;
<= 12 tool calls per step; if low on turns commit what is green, update docs/3B-1-STATUS.md, STOP. Defects are injected at test time and NEVER committed.
SCOPE: ONLY E0, V0, D1, D2, D3 (N1-N5, N7, N8), D4. NOT in this part: terminator metric/N6, glint, batched runner, final docs, full e2e (part C2B).
FACTS YOU MUST USE: pins float by design: core radius 1.10242 R. A pin is VALID for pixel specs iff front-facing (n.cam >= 0.1) AND core r/R <= 0.97. Known: az 0 -> only us-west valid;
az 180 -> only se-asia valid. N1-N8 and 3.5/3.6 must never be vacuous.

E0 PROCESS HYGIENE

- Kill ONLY orphan processes whose command line contains 'ms-playwright' or a stale playwright/node runner of this repo (PowerShell Get-CimInstance Win32_Process | Where CommandLine -match 'ms-playwright' | Stop-Process). NEVER kill the user's own Chrome.
- STALE BUNDLE: earlier runs used a stale dist when lint failed and the build was skipped, so earlier 'no change' results are UNTRUSTED. Chain scripts with && (build:e2e && playwright); build:e2e writes dist-e2e/build-stamp.json
  {gitHead, srcHash of src/\*\*}; tests/e2e/global-setup.ts recomputes the hash and fails 'STALE E2E BUNDLE' on mismatch. Unit-test the hash function. COMMIT.

V0 READ-ONLY FACTS (<= 6 calls; print in the report; add to docs/globe-look/FACTS-2B.md only what is missing)
(a) the 3.5 semantic table: per valid (pin, azimuth in {0,90,180,270}, day|night): median RGB, luma, saturation, white-px count, P1-P4 results; is 3.5 green?
(b) pin render drift: core RGB under the same harness at commit 2e27939 vs HEAD (git worktree or clean detached checkout; leave the main tree clean on main) and the size of docs/globe-look/pins-day-night.png.
(c) which valid DAY pins and valid NIGHT pins exist at az {0,90,180,270}. If a day pin or a night pin is missing there, scan az in 30-degree steps and report the azimuths that give both; N7/N8 and 3.5 use those.
(d) why clouds hit W5/W8 although 3.3 specifies clouds OFF (was the flag really applied to the cloud mesh?).

D1 DIAGNOSE (fresh build; <= 10 calls; evidence BEFORE any fix). A standalone probe worked (ring annulus 4.17 -> 31.38 with clouds OFF); inside the spec it does not. For N1 and the N3 uniform record at 4 moments
(after inject; after fitLimb; after setLayers; at capture): is the injected light reachable from **scene (count lights), its parent's uuid (parent remounted?), the atmosphere material uuid and uniform value (replaced?),
renderer.info.programs.length, renderer.info.render.frame. Expose (VITE_E2E only) **look.pinsWorld() returning per pin {name, core:[x,y,z] WORLD, surface:[x,y,z] WORLD, normal}; the previous attempt put a light at SCREEN pixel coords.
State where and why the defect vanishes. (three.js recompiles programs when the light COUNT changes; that alone does not discard lights.)

D2 ARCHITECTURE: separate ACQUISITION from ANALYSIS.

- Pure analysis functions (measureRing, checkRim, checkGlare, checkLocalPeak, checkPins) take (capture, geometry) and NEVER call fitLimb, setLayers or touch the scene. Remove the patched 'afterFit' hook and dead seams from the last run.
- acquire(page, {flags, azimuth, defect?}) is the ONLY function touching the scene. Fixed order: (1) set flags/layers, settle; (2) fitLimb/geometry (cache keyed by viewport+camera+azimuth+flags; assert the camera is unchanged);
  (3) install defect; (4) wait 3 rAF; (5) SURVIVAL PROBE: the defect is active at capture time (light reachable with intensity as set / uniform value as set) AND renderer.info.render.frame advanced after install; otherwise fail loudly
  'defect lost before capture'; (6) capture; (7) uninstall; (8) re-measure the control and assert it returns to baseline within noise.
- Defect install = IDEMPOTENT apply() registered on \_\_scene.onBeforeRender (chain any previous handler; WebGLRenderer.render calls it before collecting lights, also under the bloom RenderPass). Lights go to the scene ROOT if missing;
  set material.needsUpdate = true once on all materials when a light is first added; uniforms/material props are re-written BY NAME every frame (no stale refs).
  N3: capping alpha was not enough: also defeat the shader's own silhouette fade (write the uniform that drives the fade, or replace the atmosphere fragment shader at runtime by one returning alpha 1 at the silhouette; re-apply each frame).
- FALLBACK only if D1 proves onBeforeRender is not invoked or the probe still shows loss: a React-owned <E2EDefects/> mounted ONLY under import.meta.env.VITE_E2E === '1' (state on window.\_\_look.defects);
  check-assets.mjs must fail a production build containing it, with a test proving the guard. Explain why it was needed.
  COMMIT.

D3 ENABLE THE NEGATIVES (no fixme). Each test: control passes; defect applied via acquire(); the REAL check function FAILS; the DEFECT-SPECIFIC signal moved in the expected direction (assert the signal, not only 'failed'); restored. Report defect vs threshold vs control.
N1 amber <pointLight> (intensity ~2, distance ~1) at the CORE world position of a VALID pin (us-west at az 0) -> 3.6 ring luminance FAILS (delta% positive and > threshold). Never use the Pacific pin at az 0 (core outside the disc).
N2 Earth specularIntensity = 1.0, roughness floor 0 -> 3.2 glare FAILS (clipped px > 0).
N3 atmosphere alpha forced to 1 at the silhouette -> 3.1 silhouette-step check FAILS (step > 2/255).
N4 DirectionalLight #2f6fb8, intensity 0.32, at (-5.2,-2.2,-4.6) -> 3.3 local-peak FAILS in W1 (ratio > 1.15).
N5 3.2 given an all-black capture -> INVALID INPUT; all-white -> FAIL (large-array reductions are loops, never Math.min(...xs)).
N7 pin blow-out: pin emissiveIntensity x4 (until core min(R,G,B) >= 250) on a valid DAY pin and a valid NIGHT pin -> 3.5 P2 or P3 FAILS for both.
N8 pins hidden / core material black -> 3.5 P1 FAILS.
COMMIT.

D4 GUARDS (in the gate): a unit test that FAILS on test.fixme / test.skip / .only( / test.slow in tests/e2e/\*\* unless the line has '// allow-skip: [reason]'; grep tests/e2e and src for Math.(min|max)(... spreads on large arrays and replace them with loops (list findings); a unit test for the acquire() ordering contract with a mocked page (defect install must come after fitLimb and setLayers). COMMIT.

CLOSE: full gate; pnpm e2e:look green with NO fixme/skip; git status --short clean; git log --oneline -8.

FINAL REPORT (then STOP): E0; V0 (a-d); D1 evidence table + cause; which mechanism worked; negative table (defect value / threshold / control) for N1-N5, N7, N8; guards; e2e:look result; anything NOT met.

END OF PROMPT 2B-C2A
