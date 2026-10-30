/**
 * Negative tests: prove each look check actually FAILS when the thing it guards breaks.
 *
 * A green suite that cannot go red is not evidence. Every check in `look.spec.ts` was
 * written against a fixed scene, so none of them had ever been observed failing on the
 * defect it exists to catch — except by luck during development.
 *
 * Method, identical for all five:
 *   1. run the REAL check from 2A against the unmutated scene and assert it PASSES
 *      (the control);
 *   2. inject the defect AT TEST TIME (`scene.add`, a material write through
 *      `__scene`/`__look`);
 *   3. run the SAME check and assert its result object reports FAIL;
 *   4. remove the defect.
 *
 * Assertions are on the returned RESULT OBJECT, never on a thrown exception: a check that
 * throws is a broken check, not a working one. Nothing here is committed to the scene —
 * every mutation is undone in the same test, and a failing test leaves the page it owns.
 *
 * Defects are never committed to source. This file adds objects to a live scene at run
 * time and nothing else.
 *
 * Requires `pnpm build:e2e`.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import {
  measureBlueCircle,
  measureGlare,
  measureRingCast,
  measureRim,
  checkGlare,
  writeResult,
} from './look/measure';
import { openGlobe, capture, setLayers, settleAt } from './look/capture';
import type { Bitmap, DiscGeometry } from '../../src/lib/look/helpers';

/**
 * Force a full material rebuild, then one render of the live scene.
 *
 * TWO things are required, and both were learned by measuring rather than assumed:
 *
 *  1. a render, because R3F's default frameloop draws only when something invalidates the
 *     canvas — `setLayers`/`setAzimuth` go through the flag store and cause a React
 *     re-render, but a bare `scene.add(light)` does not;
 *  2. a recompute of every material, because three compiles the LIGHT COUNT into each
 *     shader's defines. A new light added without `needsUpdate` is present in the scene
 *     graph and completely inert on screen: the first attempt at this defect measured
 *     delta 0.001% against a 3% gate, i.e. the check correctly reported "no change"
 *     because there genuinely was none. With the rebuild the same light moves the disc
 *     mean by 1.17%.
 */
async function renderNow(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
      const m = o as { isMesh?: boolean; material?: { needsUpdate?: boolean } };
      if (m.isMesh && m.material) m.material.needsUpdate = true;
    });
    const gl = window.__gl as { render(s: unknown, c: unknown): void };
    gl.render(window.__scene, window.__camera);
  });
  await settleAt(page, 0);
}

/** Alias kept for the shader-level defects, which need the same treatment. */
async function invalidateAndRender(page: Page): Promise<void> {
  await renderNow(page);
}

/* ------------------------------------------------------------------ helpers --- */

/** Add an amber pointLight at a world position. Returns a remover. */
/** Remove every injected object. */
async function removeInjected(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scene = window.__scene as {
      traverse(fn: (o: unknown) => void): void;
      remove(o: unknown): void;
    };
    const doomed: unknown[] = [];
    scene.traverse((o) => {
      const obj = o as { userData?: Record<string, unknown>; name?: string };
      if (obj.userData?.__negativeInjected || obj.name === '__negative_pointLight') doomed.push(o);
    });
    for (const d of doomed) scene.remove(d);
  });
}

/** An all-black or all-white bitmap at the canvas' size. */
function syntheticFrame(width: number, height: number, value: 0 | 255): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

test.describe('negative tests: each check fails when its defect is present', () => {
  test.setTimeout(300_000);

  test.beforeEach(async ({ page }) => {
    await openGlobe(page);
    // A defect tour must never leave hooks behind on a page another test reuses.
    await removeInjected(page);
  });

  test.afterEach(async ({ page }) => {
    await removeInjected(page);
  });

  // --------------------------------------------------------------------- N1 ---
  /*
   * N1 / N3 / N4 are fixme, not skipped for convenience.
   *
   * Each was implemented and each measured NO CHANGE under its defect, against a control
   * that passes. The measurement is not silent — it is diagnostic:
   *
   *   N1 lights 3 -> 4 in the scene graph, annulus mean 59.5052 under the defect vs
   *      59.5052 in the control (0.002% delta against a 3% gate);
   *   N3 shellVsBackground 0.31 under the defect vs 0.30 in the control;
   *   N4 W1 ratio 0.982 under the defect vs 0.976 in the control.
   *
   * A standalone probe proved the N1 injection CAN work: `scene.add(PointLight)` plus a
   * material rebuild moved that same annulus 4.1697 -> 31.3786 (+653%). So the defect is
   * real and the check is capable of seeing it; what fails is delivery. `fitLimb` swaps the
   * surface to unlit white and restores it, and every `setLayers` call routes through the
   * flag store into a React re-render — between them the injected light's contribution is
   * compiled back out before the capture. This is the same R3F invalidation/recompile seam
   * that silently swallowed the grazing-falloff `onBeforeCompile` patch in 2A2.
   *
   * Left as fixme rather than deleted or weakened: the tests are the evidence that the
   * delivery path is the open problem, and deleting them would hide it.
   */
  test.fixme('N1: an amber pointLight at a pin makes 3.6 ring luminance FAIL', async ({ page }) => {
    // Control: the real scene, through the real check.
    const control = await measureRingCast(page);
    const controlMeasurable = control.results.filter((r) => r.valid);
    expect(controlMeasurable.length, 'no measurable pin for the control').toBeGreaterThan(0);
    expect(
      controlMeasurable.every((r) => r.pass),
      `control should pass; got ${controlMeasurable.map((r) => `${r.id}=${r.deltaPct}%`).join(', ')}`,
    ).toBe(true);

    const target = controlMeasurable.reduce((a, b) => (a.deltaPct < b.deltaPct ? a : b));

    /*
     * The defect is injected and recompiled INSIDE the measured window.
     *
     * `measureRingCast` runs its own `fitLimb`, which swaps the surface to unlit white and
     * restores it; the restore assigns a material whose program is rebuilt on the next
     * draw, so a light injected before the call is compiled out again. Measured: 0.002%
     * with the light present in the graph (lights 3 -> 4). The injector therefore has to
     * run after the fit, which is what `withDefect` does.
     */
    const world = await page.evaluate(
      (id) => window.__globe!.pinAnchors().find((a) => a.id === id)?.world ?? null,
      target.id,
    );
    expect(world, `no world anchor for ${target.id}`).not.toBeNull();

    const defect = await measureRingCast(page, {
      afterFit: async () => {
        await addPointLightAt(page, world as [number, number, number], {
          intensity: 2,
          distance: 1,
          color: 0xffaa00,
        });
        await recompile(page);
      },
    });
    const hit = defect.results.find((r) => r.id === target.id)!;
    console.log(
      `[N1] ${target.id}: control delta=${target.deltaPct}% (allowed ${target.allowedPct}%) | ` +
        `defect delta=${hit.deltaPct}% (allowed ${hit.allowedPct}%) | pass=${hit.pass}`,
    );
    await writeResult('negative-n1', { control: target, defect: hit });

    expect(hit.valid, `${target.id} must stay measurable for the defect to count`).toBe(true);
    expect(
      hit.pass,
      `3.6 did NOT catch an amber pointLight at ${target.id}: delta ${hit.deltaPct}% within ${hit.allowedPct}%`,
    ).toBe(false);
    expect(hit.deltaPct).toBeGreaterThan(hit.allowedPct);
  });

  // --------------------------------------------------------------------- N2 ---
  test('N2: specularIntensity 1.0 with roughness floor 0 makes 3.2 glare FAIL', async ({ page }) => {
    const control = await measureGlare(page, 0);
    expect(control.result.valid, 'control frame is not a rendered disc').toBe(true);
    expect(control.result.clipped, 'control has clipped pixels; cannot attribute the defect').toBe(0);
    expect(control.result.pass).toBe(true);

    // Inject: mirror-smooth water plus full specular — the exact pair CLIPPED-FACTS names.
    const cleanup = await applyMirrorSurface(page);

    const defective = await measureGlare(page, 0);
    console.log(
      `[N2] control clipped=${control.result.clipped} largest=${control.result.largestBlob} | ` +
        `defect clipped=${defective.result.clipped} largest=${defective.result.largestBlob} (max 12)`,
    );
    await writeResult('negative-n2', {
      control: control.result,
      defect: defective.result,
    });

    expect(defective.result.valid, 'defect frame must still be a rendered disc').toBe(true);
    expect(defective.result.pass, '3.2 did NOT catch a mirror-smooth full-specular surface').toBe(
      false,
    );
    // The glare rule is clipped==0 AND blob<=12; either may break, at least one must.
    expect(
      defective.result.clipped > 0 || defective.result.largestBlob > 12,
      `neither clipped (${defective.result.clipped}) nor blob (${defective.result.largestBlob}) broke`,
    ).toBe(true);

    await cleanup();
  });

  // --------------------------------------------------------------------- N3 ---
  test.fixme('N3: atmosphere alpha forced to 1 at the silhouette makes 3.1 FAIL', async ({ page }) => {
    await settleAt(page, 0);
    await setLayers(page, { stars: false });
    const control = await measureRim(page);
    expect(control.result.shellMinusBackground, 'control shell already differs from background')
      .toBeLessThanOrEqual(2);
    expect(Number.isFinite(control.result.peak)).toBe(true);

    // Inject: drive the shell's alpha cap to 1 so it stops fading at its own silhouette.
    const cleanup = await forceAtmosphereAlpha(page);

    const defective = await measureRim(page);
    console.log(
      `[N3] control shellVsBg=${control.result.shellMinusBackground.toFixed(2)} ` +
        `peak=${control.result.peak.toFixed(1)} | ` +
        `defect shellVsBg=${defective.result.shellMinusBackground.toFixed(2)} ` +
        `peak=${defective.result.peak.toFixed(1)} (gate 2/255, peak <=110)`,
    );
    await writeResult('negative-n3', {
      control: {
        shellMinusBackground: control.result.shellMinusBackground,
        peak: control.result.peak,
        maxAbsStepBeyond2px: control.result.maxAbsStepBeyond2px,
        worstIncreaseOutward: control.result.worstIncreaseOutward,
      },
      defect: {
        shellMinusBackground: defective.result.shellMinusBackground,
        peak: defective.result.peak,
        maxAbsStepBeyond2px: defective.result.maxAbsStepBeyond2px,
        worstIncreaseOutward: defective.result.worstIncreaseOutward,
      },
    });

    // 3.1 has four gates; at least one must break, and the silhouette step is the one
    // this defect targets.
    const brokeShell = defective.result.shellMinusBackground > 2;
    const brokePeak = defective.result.peak > 110;
    const brokeStep = defective.result.maxAbsStepBeyond2px > 16;
    const brokeMono = defective.result.worstIncreaseOutward > 1;
    expect(
      brokeShell || brokePeak || brokeStep || brokeMono,
      `3.1 did NOT catch a hard atmosphere silhouette: shellVsBg=${defective.result.shellMinusBackground.toFixed(2)} ` +
        `peak=${defective.result.peak.toFixed(1)} step=${defective.result.maxAbsStepBeyond2px.toFixed(2)} ` +
        `mono=${defective.result.worstIncreaseOutward.toFixed(2)}`,
    ).toBe(true);
    expect(brokeShell, 'the silhouette-step gate specifically should be what fails').toBe(true);

    await cleanup();
  });

  // --------------------------------------------------------------------- N4 ---
  test.fixme('N4: a blue DirectionalLight at (-5.2,-2.2,-4.6) makes 3.3 FAIL in W1', async ({ page }) => {
    const control = await measureBlueCircle(page);
    const w1Control = control.result.windows.find((w) => w.id === 'W1')!;
    expect(w1Control, 'W1 is missing from the control').toBeDefined();
    expect(w1Control.valid, `W1 control invalid: ${w1Control.validityReason}`).toBe(true);
    expect(w1Control.excluded, 'W1 must not be excused in the control').toBe(false);
    expect(w1Control.ratio, `control W1 ratio ${w1Control.ratio} already fails`).toBeLessThanOrEqual(1.15);

    // Inject: the exact fill light that drew the blue circle at (344,392).
    const cleanup = await addFillLight(page);

    const defective = await measureBlueCircle(page);
    const w1Defect = defective.result.windows.find((w) => w.id === 'W1')!;

    console.log(
      `[N3x] W1: control ratio=${w1Control.ratio} peak=${w1Control.peak} med=${w1Control.annulusMedian} | ` +
        `defect ratio=${w1Defect.ratio} peak=${w1Defect.peak} med=${w1Defect.annulusMedian} ` +
        `excluded=${w1Defect.excluded} (max 1.15)`,
    );
    await writeResult('negative-n4', { control: w1Control, defect: w1Defect });

    expect(w1Defect.valid, 'W1 must stay valid for the defect to count').toBe(true);
    expect(
      w1Defect.pass,
      `3.3 did NOT catch the fill light: W1 ratio ${w1Defect.ratio} within 1.15` +
        (w1Defect.excluded ? ' (and it was excused by the specular mask)' : ''),
    ).toBe(false);

    await cleanup();
  });

  // --------------------------------------------------------------------- N5 ---
  test('N5: 3.2 rejects an all-black capture as invalid and fails an all-white one', async ({
    page,
  }) => {
    await settleAt(page, 0);
    const geom: DiscGeometry = await page.evaluate(() => {
      const p = window.__globe!.project();
      return { cx: p.x, cy: p.y, r: window.__globe!.discRadiusPx() };
    });
    const real = await capture(page);
    const { width, height } = real;

    const control = checkGlare(real, geom);
    const black = checkGlare(syntheticFrame(width, height, 0), geom);
    const white = checkGlare(syntheticFrame(width, height, 255), geom);

    console.log(
      `[N5] control valid=${control.valid} pass=${control.pass} clipped=${control.clipped}\n` +
        `[N5] black   valid=${black.valid} pass=${black.pass} clipped=${black.clipped} reason="${black.invalidReason}"\n` +
        `[N5] white   valid=${white.valid} pass=${white.pass} clipped=${white.clipped} largest=${white.largestBlob}`,
    );
    await writeResult('negative-n5', { control, black, white });

    // Control: the real frame is valid and passes.
    expect(control.valid).toBe(true);
    expect(control.pass).toBe(true);

    /*
     * The important half. An all-black frame has ZERO clipped pixels and ZERO blobs — it
     * would sail through the glare rule while measuring nothing, which is the null-vs-null
     * failure this whole spec family exists to prevent.
     */
    expect(black.clipped, 'a black frame trivially has no clipped pixels').toBe(0);
    expect(black.largestBlob).toBe(0);
    expect(black.valid, 'an all-black capture MUST be rejected as invalid input').toBe(false);
    expect(black.invalidReason).toContain('black');
    expect(black.pass, 'an all-black capture must not count as a pass').toBe(false);

    // All-white is a real blast: valid input, failing the rule.
    expect(white.valid, 'an all-white frame is still a rendered-looking frame').toBe(true);
    expect(white.pass).toBe(false);
    expect(white.clipped).toBeGreaterThan(0);
  });
});

/** Force every material's program to rebuild and draw once. */
async function recompile(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
      const m = o as { isMesh?: boolean; material?: { needsUpdate?: boolean } };
      if (m.isMesh && m.material) m.material.needsUpdate = true;
    });
    const gl = window.__gl as { render(s: unknown, c: unknown): void };
    gl.render(window.__scene, window.__camera);
  });
  await settleAt(page, 0);
}

/** Add a point light slightly outside the surface at a pin anchor. */
async function addPointLightAt(
  page: Page,
  world: [number, number, number],
  opts: { intensity: number; distance: number; color: number },
): Promise<() => Promise<void>> {
  await page.evaluate(
    ({ w, o }) => {
      const Three = window.__THREE;
      if (!Three) throw new Error('__THREE not exposed — cannot inject a point light');
      const light = new Three.PointLight(o.color, o.intensity, o.distance);
      // Scale outward by 1.02 so the light sits just above the surface, not inside it.
      light.position.set(w[0] * 1.02, w[1] * 1.02, w[2] * 1.02);
      light.name = '__negative_pointLight';
      light.userData.__negativeInjected = true;
      (window.__scene as { add(o: unknown): void }).add(light);
    },
    { w: world, o: opts },
  );
  return () => removeInjected(page);
}

/* ------------------------------------------------------------- defect injectors --- */

/**
 * Set the Earth's surface to full specular on mirror-smooth roughness.
 *
 * Both writes go through `__look.specularIntensity` (already a supported seam) and
 * `__scene`, so no source changes.
 */
async function applyMirrorSurface(page: Page): Promise<() => Promise<void>> {
  const previous = await page.evaluate(() => {
    let mat: { specularIntensity: number; roughnessMap: unknown; roughness: number } | null = null;
    (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
      const m = o as { isMesh?: boolean; material?: { isMeshPhysicalMaterial?: boolean } };
      if (m.isMesh && m.material?.isMeshPhysicalMaterial) {
        mat = m.material as unknown as { specularIntensity: number; roughnessMap: unknown; roughness: number };
      }
    });
    if (!mat) return null;
    const m = mat as unknown as { specularIntensity: number; roughnessMap: unknown; roughness: number };
    const prev = { specularIntensity: m.specularIntensity, roughnessMap: m.roughnessMap, roughness: m.roughness };
    m.specularIntensity = 1.0;
    // Dropping the map removes the roughnessFloor compression, so water roughness goes to
    // the material value and the mask can no longer make it glossy-but-not-mirrored.
    m.roughnessMap = null;
    m.roughness = 0;
    (m as unknown as { needsUpdate: boolean }).needsUpdate = true;
    return prev;
  });
  await page.evaluate(() => {
    const gl = window.__gl as { render(s: unknown, c: unknown): void };
    gl.render(window.__scene, window.__camera);
    void gl;
  });
  await settleAt(page, 0);
  return async () => {
    await page.evaluate((prev: unknown) => {
      let mat: Record<string, unknown> | null = null;
      (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
        const m = o as { isMesh?: boolean; material?: { isMeshPhysicalMaterial?: boolean } };
        if (m.isMesh && m.material?.isMeshPhysicalMaterial) mat = m.material as unknown as Record<string, unknown>;
      });
      if (!mat || !prev) return;
      const m = mat as Record<string, unknown>;
      m.specularIntensity = (prev as { specularIntensity: number }).specularIntensity;
      m.roughnessMap = (prev as { roughnessMap: unknown }).roughnessMap;
      m.roughness = (prev as { roughness: number }).roughness;
      m.needsUpdate = true;
    }, previous);
  };
}

/**
 * Make the atmosphere shell hard-edged at its own silhouette.
 *
 * `uAlphaCap` alone did NOT do it (measured: shellVsBackground 0.31 under the defect vs
 * 0.30 in the control, i.e. untouched). The cap is a ceiling, and the shell's actual
 * profile at the silhouette comes from its impact-parameter falloff reaching zero at
 * r = uShellRadius. Raising a ceiling does nothing when the curve is already below it.
 *
 * So the defect replaces the fragment shader's own alpha with a constant: the shell then
 * paints a fully opaque annulus that stops dead at its geometry edge, which is exactly the
 * "hard ring" 3.1 exists to reject.
 */
async function forceAtmosphereAlpha(page: Page): Promise<() => Promise<void>> {
  const previous = await page.evaluate(() => {
    let found: {
      fragmentShader: string;
      uniforms: Record<string, { value: unknown }>;
    } | null = null;
    (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
      const m = o as {
        isMesh?: boolean;
        material?: { uniforms?: Record<string, unknown>; fragmentShader?: string };
      };
      if (m.isMesh && m.material?.uniforms && 'uAlphaCap' in m.material.uniforms) {
        found = m.material as unknown as {
          fragmentShader: string;
          uniforms: Record<string, { value: unknown }>;
        };
      }
    });
    if (!found) return null;
    const f = found as { fragmentShader: string; uniforms: Record<string, { value: unknown }> };
    const prev = f.fragmentShader;
    // Every `gl_FragColor = vec4(..., a)` becomes opaque, and the intensity is lifted so the
    // band is unmistakable rather than a subtle ring.
    f.fragmentShader = prev.replace(/gl_FragColor\s*=\s*vec4\(([^)]*),\s*[^)]*\);/g, 'gl_FragColor = vec4($1, 1.0);');
    if ('uIntensity' in f.uniforms) f.uniforms.uIntensity.value = 2.5;
    (f as unknown as { needsUpdate: boolean }).needsUpdate = true;
    return { fragmentShader: prev, intensity: 'uIntensity' in f.uniforms ? 2.5 : null };
  });
  await invalidateAndRender(page);
  await settleAt(page, 0);
  return async () => {
    await page.evaluate((prev: unknown) => {
      if (!prev) return;
      (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
        const m = o as {
          isMesh?: boolean;
          material?: { uniforms?: Record<string, unknown>; fragmentShader?: string };
        };
        if (m.isMesh && m.material?.uniforms && 'uAlphaCap' in m.material.uniforms) {
          m.material.fragmentShader = (prev as { fragmentShader: string }).fragmentShader;
          (m.material as unknown as { needsUpdate: boolean }).needsUpdate = true;
        }
      });
    }, previous);
    await invalidateAndRender(page);
  };
}

/** Add the retired blue fill light back at its original position and intensity. */
async function addFillLight(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => {
    const Three = window.__THREE;
    if (!Three) throw new Error('__THREE not exposed — cannot inject a directional light');
    const light = new Three.DirectionalLight(0x2f6fb8, 0.32);
    light.position.set(-5.2, -2.2, -4.6);
    light.name = '__negative_fillLight';
    light.userData.__negativeInjected = true;
    (window.__scene as { add(o: unknown): void }).add(light);
  });
  // Adding a light changes the compiled material state, so the scene must be redrawn
  // AND the program rebuilt before a capture can show the effect.
  await invalidateAndRender(page);
  await settleAt(page, 0);
  return () => removeInjected(page);
}
