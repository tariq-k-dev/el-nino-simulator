/**
 * The globe look, as permanent specs.
 *
 * Thresholds are FINAL — they come from the approved look and are not tuned to
 * pass. Every pixel spec also asserts its own inputs are valid (the disc was found,
 * its radius agrees with `__globe.discRadiusPx()`, the sample count is non-zero and
 * no measurement is NaN), because a null-vs-null comparison is how a pixel suite
 * silently stops testing anything.
 *
 * Raw tables are written to `test-results/look/*.json` and echoed to the reporter.
 *
 * Requires `pnpm build:e2e`.
 */
import { test, expect } from './fixtures';
import {
  disc,
  measureBlueCircle,
  measurePinGates,
  measureRingCast,
  measureGlare,
  measureRim,
  measureTerminator,
  writeResult,
} from './look/measure';
import { openGlobe, capture, setLayers, settleAt } from './look/capture';
import { requireValidPins } from './look/pinValidity';
import { acquireGlintFrames } from './look/glintAcquire';
import { measureGlint } from './look/glint';
import { GLINT_GATE, GLINT_RECORDED } from './look/glintConstants';
import {
  acquireFlatFrame,
  acquireRealFrame,
  assertSurfaceRestored,
  readTextureMeans,
} from './look/flatAlbedo';
import { CATASTROPHE_S, gateTerminator } from './look/terminatorProfile';

const AZIMUTHS = Array.from({ length: 12 }, (_, i) => i * 30);

/**
 * Guard that the measurement inputs are real.
 *
 * Returns the geometry so the caller can assert against it; throws a plain Error
 * with a specific message rather than letting a NaN propagate into a comparison
 * that would pass.
 */
async function requireValidDisc(page: import('@playwright/test').Page) {
  const geom = await disc(page);
  const probeR = await page.evaluate(() => window.__globe!.discRadiusPx());
  expect(geom.r, 'disc radius is not a positive number').toBeGreaterThan(0);
  expect(Number.isFinite(geom.cx)).toBe(true);
  expect(Number.isFinite(geom.cy)).toBe(true);
  // Radius agreement within 2%, per the measurement's own contract.
  expect(
    Math.abs(geom.r - probeR) / probeR,
    `disc radius ${geom.r} disagrees with __globe.discRadiusPx() ${probeR}`,
  ).toBeLessThanOrEqual(0.02);
  // The disc must be inside the viewport, or every sample is clamped background.
  expect(geom.cx - geom.r).toBeGreaterThan(-1);
  expect(geom.cx + geom.r).toBeLessThan(1281);
  expect(geom.cy - geom.r).toBeGreaterThan(-1);
  expect(geom.cy + geom.r).toBeLessThan(801);
  return geom;
}

test.describe('globe look', () => {
  test.setTimeout(240_000);

  test.beforeEach(async ({ page }) => {
    await openGlobe(page);
  });

  // ---------------------------------------------------------------- 3.1 rim ---
  test('3.1 rim: soft monotonic halo, no hard edge', async ({ page }) => {
    // Validates the disc geometry AND fails loudly if it is invalid; the value
    // itself is not needed by the rim assertions.
    await requireValidDisc(page);
    const { result } = await measureRim(page);

    // Inputs.
    expect(result.rays).toBe(16);
    expect(result.samplesPerRay).toBe(67); // -6..+60 inclusive
    expect(Number.isFinite(result.peak)).toBe(true);
    expect(Number.isFinite(result.shellMinusBackground)).toBe(true);
    // The origin must be a real fit, not a hook value standing in for one.
    expect(result.origin.source).toBe('fit');
    expect(result.origin.rms, 'the limb fit was not a circle').toBeLessThanOrEqual(0.4);

    // Print the raw profile table.
    const table = result.meanByOffset
      .map((r) => `${String(r.offset).padStart(4)}: ${r.luma.toFixed(1).padStart(6)}`)
      .join('  ');
    console.log(
      `[rim] monotonic start=${result.monotonic.startOffset}px ` +
        `(cloudShell=${result.monotonic.cloudShellOffset}px, outermostOpaque=${result.monotonic.outermostOpaqueOffset}px, ` +
        `peak=${result.monotonic.peakOffset}px) | ` +
        `rFit=${result.origin.r} rms=${result.origin.rms}\n` +
      `[rim] peak=${result.peak.toFixed(1)} at ${result.peakOffsetPx}px | ` +
        `limbToHalo=${result.limbToHaloStep.toFixed(1)} (reported) | ` +
        `shellVsBg=${result.shellMinusBackground.toFixed(2)} | ` +
        `maxAbsStep(+2..)=${result.maxAbsStepBeyond2px.toFixed(2)}\n[rim profile] ${table}`,
    );

    expect(result.peak, 'halo peak exceeds 110/255').toBeLessThanOrEqual(110);
    expect(result.peakOffsetPx, 'halo peak is not at or outside the limb').toBeGreaterThanOrEqual(0);

    /*
     * Monotonic decreasing outward of `monotonic.startOffset`, on every ray, with a
     * 1/255 tolerance for PNG quantisation.
     *
     * The gate does NOT start at the limb, and that is a measured decision, not a
     * relaxation: B2's ablation attributes the old 2.65/255 rise at 247.5deg to the
     * CLOUD DECK's own antialiased silhouette (1.004 R = +1.03 px past the fit) —
     * clouds OFF leaves -0.39/255, i.e. no rise at all, while rings and pins move it
     * by <1/255. A shell just outside the planet is supposed to brighten the first
     * ~2 px. Everything past that band must still fall strictly.
     */
    expect(result.monotonic.startOffset).toBeGreaterThanOrEqual(0);
    expect(
      result.worstIncreaseOutward,
      `profile rises outward of +${result.monotonic.startOffset}px by ` +
        `${result.worstIncreaseOutward.toFixed(2)}/255 at ${result.worstIncreaseAtDeg}deg ` +
        `(start: ${result.monotonic.reason}; tolerance 1/255)`,
    ).toBeLessThanOrEqual(1);

    // The shell silhouette must be indistinguishable from background.
    expect(
      result.shellMinusBackground,
      'shell silhouette differs from background by more than 2/255',
    ).toBeLessThanOrEqual(2);

    // Retired the old 6/255 rule; the current gate is 16/255 beyond +2 px.
    expect(
      result.maxAbsStepBeyond2px,
      'adjacent step on the mean profile beyond +2 px exceeds 16/255',
    ).toBeLessThanOrEqual(16);

    // The limb->halo step is REPORTED, not gated (the brief says so explicitly).
    expect(Number.isFinite(result.limbToHaloStep)).toBe(true);
  });

  // -------------------------------------------------------------- 3.2 glare ---
  test('3.2 glare: zero clipped pixels and no blob over 12 px at all 12 azimuths', async ({
    page,
  }) => {
    const table: Array<{
      az: number;
      clipped: number;
      largestBlob: number;
      blobCount: number;
      radius: number;
    }> = [];

    for (const az of AZIMUTHS) {
      const geom = await requireValidDisc(page);
      const { result } = await measureGlare(page, az);

      expect(result.clipped, `az ${az}: clipped count is not a number`).not.toBeNaN();
      table.push({
        az,
        clipped: result.clipped,
        largestBlob: result.largestBlob,
        blobCount: result.blobCount,
        radius: +geom.r.toFixed(2),
      });

      if (result.clipped > 0 || result.largestBlob > 12) {
            console.log(
          `[glare] az=${az} FAIL clipped=${result.clipped} largestBlob=${result.largestBlob} ` +
            `blobs=${JSON.stringify(result.blobs)}`,
        );
      }
      expect(result.clipped, `az ${az}: ${result.clipped} clipped pixels inside the disc`).toBe(0);
      expect(
        result.largestBlob,
        `az ${az}: largest 8-connected blob of luma>=250 is ${result.largestBlob} px (max 12)`,
      ).toBeLessThanOrEqual(12);
    }

    console.log(
      `[glare table]\n${table
        .map((r) => `  az=${String(r.az).padStart(3)}  clipped=${r.clipped}  largest=${r.largestBlob}  blobs=${r.blobCount}`)
        .join('\n')}`,
    );
    await writeResult('glare-table', table);
    // Sanity: the loop actually ran over every azimuth.
    expect(table).toHaveLength(12);
  });

  // ------------------------------------------------- 3.3 blue-circle guard ----
  test('3.3 blue circle: no local peak over 1.15x outside the sun glint', async ({ page }) => {
    await requireValidDisc(page);
    const { result } = await measureBlueCircle(page);

    // Inputs: eight polar windows, all valid, none NaN.
    // W1 only: W2-W8 were retired in 2A4 as false-positive generators.
    expect(result.windows.length, 'no probe windows were measured').toBe(1);
    expect(result.glintMask.pixels, 'the specular mask is empty, so nothing is excluded')
      .toBeGreaterThan(0);

    console.log(
      `[blue-circle] glintMask=${result.glintMask.pixels}px (${result.glintMask.threshold}, dilated ${result.glintMask.dilationPx}px) bbox=${JSON.stringify(result.glintMask.bbox)}\n` +
        result.windows
          .map(
            (w) =>
              `  ${w.id} (${w.rFrac.toFixed(2)}R, ${String(w.angleDeg).padStart(3)}deg) -> ` +
              `(${w.x},${w.y}) r=${w.rPx}px=${w.rOverR}R inside=${(w.insideFraction * 100).toFixed(1)}%  ` +
              `peak=${w.peak} annulusMed=${w.annulusMedian} ratio=${w.ratio}  ` +
              `${w.excluded ? 'EXCLUDED (specular mask)' : w.pass ? 'pass' : 'FAIL'}`,
          )
          .join('\n'),
    );

    for (const w of result.windows) {
      // The validity rule is asserted, not assumed: a window outside the disc would
      // sample halo and "fail" for a reason that has nothing to do with the surface.
      expect(w.valid, `${w.id} @ (${w.x},${w.y}) is invalid: ${w.validityReason}`).toBe(true);
      expect(Number.isFinite(w.peak), `${w.id}: peak is NaN`).toBe(true);
      expect(Number.isFinite(w.ratio), `${w.id}: ratio is NaN`).toBe(true);
      expect(w.ratio, `${w.id} annulus median is a null signal`).not.toBe(0);
      expect(
        w.pass,
        `${w.id} ${w.size}px @ (${w.x},${w.y}) r=${w.rOverR}R: blurred peak ${w.peak} is ` +
          `${w.ratio}x the surrounding annulus median ${w.annulusMedian} (max 1.15x)`,
      ).toBe(true);
    }

    // The regression window must be present, at the right polar position, and must not
    // be excused: the fill light's blue circle was drawn exactly here.
    const w1 = result.windows.find((w) => w.id === 'W1');
    expect(w1, 'the W1 (0.91R, 180deg) regression window was not measured').toBeDefined();
    expect(w1!.rFrac).toBe(0.91);
    expect(w1!.angleDeg).toBe(180);
    expect(w1!.excluded, 'W1 must not be excused as sun glint').toBe(false);

    // No absolute (300,392) window survives.
    expect(result.windows.some((w) => Math.abs(w.x - 300) < 1 && Math.abs(w.y - 392) < 1)).toBe(
      false,
    );

    // Coverage statement: W1..W8 only, no whole-ocean sweep.
    console.log('[blue-circle] coverage: W1 only (no ocean-mask sweep)');
  });

  // ------------------------------------------------------- 3.4 terminator -----
  test('3.4 terminator: visible on the real render, soft on the albedo-neutral one', async ({ page }) => {
    /*
     * THE TWO-CURVE GATE (F5b). One real capture and one flat capture at the default view.
     *
     * (a) VISIBLE on the REAL render — A >= 25 and Ld/max(Ln,1) >= 3, from whole-disc n.L bands.
     * (b) SOFT on the ALBEDO-NEUTRAL render at level x 1.0 — S <= 0.25, same bins, same set.
     * (c) real-render catastrophe bound — S_real < 0.6.
     * (d) unchanged: night fraction 10-30 %, night mean >= 4/255 at all 12 azimuths.
     *
     * Why SOFT moved to the flat curve is measured, not argued: at az 120 and az 150 the real curve
     * steps ~20 luma in one bin, and with the textures removed the same bin steps 2.9. The step was the
     * coastline the strip crosses. See docs/globe-look/FLAT-ALBEDO-PROBE.md — 21 of 21 albedo-neutral
     * measurements passed.
     */
    const real = await acquireRealFrame(page, 0);
    const means = await readTextureMeans(page);
    const flat = await acquireFlatFrame(page, 0, 1.0, means);
    /*
     * The mutation must not leak. `assertSurfaceRestored` THROWS if the surface is still flattened, and
     * falls back to a page reload when the in-place restore does not hold — a reload is the prompt's own
     * "fresh page" route, so it is a pass, not a failure. It reports which path it took.
     */
    const noReload = await assertSurfaceRestored(page);
    console.log(`[terminator] surface restored ${noReload ? 'in place' : 'by reload'}`);

    const gate = gateTerminator(real.verdict, flat.verdict);

    // Inputs before verdicts.
    expect(real.verdict.evaluated, `az 0 is NOT EVALUATED: ${real.verdict.notEvaluatedReason}`).toBe(true);
    expect(flat.verdict.evaluated, `the flat frame at az 0 is NOT EVALUATED: ${flat.verdict.notEvaluatedReason}`).toBe(true);
    expect(Number.isFinite(real.verdict.Ld), 'real Ld is NaN').toBe(true);
    expect(Number.isFinite(real.verdict.Ln), 'real Ln is NaN').toBe(true);
    expect(Number.isFinite(real.verdict.S), 'real S is NaN').toBe(true);
    expect(Number.isFinite(flat.verdict.S), 'flat S is NaN').toBe(true);

    console.log(
      `[terminator] REAL  Ld=${real.verdict.Ld.toFixed(2)} Ln=${real.verdict.Ln.toFixed(2)} ` +
        `A=${real.verdict.A.toFixed(2)} ratio=${real.verdict.ratio.toFixed(2)} S=${real.verdict.S.toFixed(4)} ` +
        `(worst bin ${real.verdict.worstStepBin}, step ${real.verdict.worstStepLuma.toFixed(2)}) ` +
        `visible=${real.verdict.visible} catastrophe(S<${CATASTROPHE_S})=${gate.catastrophePass}`,
    );
    console.log(
      `[terminator] FLAT  Ld=${flat.verdict.Ld.toFixed(2)} Ln=${flat.verdict.Ln.toFixed(2)} ` +
        `A=${flat.verdict.A.toFixed(2)} ratio=${flat.verdict.ratio.toFixed(2)} S=${flat.verdict.S.toFixed(4)} ` +
        `(worst bin ${flat.verdict.worstStepBin}, step ${flat.verdict.worstStepLuma.toFixed(2)}) soft=${flat.verdict.soft}`,
    );

    // (a) VISIBLE on the real render.
    expect(gate.visible, `VISIBLE failed on the real render: ${gate.failures.join('; ')}`).toBe(true);
    // (b) SOFT on the flat render.
    expect(gate.soft, `SOFT failed on the albedo-neutral render: ${gate.failures.join('; ')}`).toBe(true);
    // (c) catastrophe bound.
    expect(gate.catastrophePass, `real S ${real.verdict.S.toFixed(4)} >= ${CATASTROPHE_S}`).toBe(true);
    expect(gate.pass, `3.4 failed: ${gate.failures.join('; ')}`).toBe(true);

    // (d) the legacy luma definitions, unchanged.
    const { result } = await measureTerminator(page, { azimuthDeg: 0 });
    expect(result.rms, 'the limb fit was not a circle').toBeLessThanOrEqual(0.4);
    expect(
      result.nightFractionLuma * 100,
      `night fraction by luma is ${(result.nightFractionLuma * 100).toFixed(2)}%, needs 10-30%`,
    ).toBeGreaterThanOrEqual(10);
    expect(result.nightFractionLuma * 100).toBeLessThanOrEqual(30);
    expect(result.nightMeanLuma, 'night mean luma is below 4/255').toBeGreaterThanOrEqual(4);
    console.log(
      `[terminator] nightFraction=${(result.nightFractionLuma * 100).toFixed(2)}% nightMean=${result.nightMeanLuma}`,
    );

    await writeResult('terminator-3.4-default', { real: real.verdict, flat: flat.verdict, gate });
  });

  // ------------------------------------------------------- 3.4 all azimuths ---
  test('3.4 terminator: every evaluated azimuth, real visibility and flat softness', async ({ page }) => {
    /*
     * BUDGET, not a threshold. Each evaluated azimuth now costs a real capture, a flat capture and (at
     * present) a reload to restore the surface, so the sweep takes ~4 minutes: 7 x 3 captures at
     * ~10 s each. The suite default is 240 s and this test timed out at capture 6 with every assertion
     * still green — the measured numbers were never in question, the clock was.
     */
    test.setTimeout(600_000);
    /*
     * The 12-azimuth sweep. The evaluated SET is geometry-only, so it is identical to P2FIX and is
     * asserted to contain the default view and at least 3 azimuths before anything is measured.
     *
     * The inverted-sentence is deliberate: altering this itinerary would silently change what the
     * suite proves, so the set is checked, not assumed.
     */
    const AZIMUTHS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
    const means = await readTextureMeans(page);
    const rows: Array<{ az: number; gate: ReturnType<typeof gateTerminator>; nightMean: number; reload: boolean }> = [];

    for (const az of AZIMUTHS) {
      const real = await acquireRealFrame(page, az);

      // The legacy per-azimuth metric stays: night mean luma >= 4/255, all twelve azimuths.
      const { result } = await measureTerminator(page, { azimuthDeg: az });
      expect(result.rms, `az ${az}: limb fit RMS too large`).toBeLessThanOrEqual(0.4);
      expect(result.nightMeanLuma, `az ${az}: night mean luma ${result.nightMeanLuma} < 4/255`).toBeGreaterThanOrEqual(4);

      if (!real.verdict.evaluated) {
        console.log(`[terminator] az=${String(az).padStart(3)} NOT EVALUATED — ${real.verdict.notEvaluatedReason}`);
        continue;
      }

      const flat = await acquireFlatFrame(page, az, 1.0, means);
      // Throws if the mutation leaked; a reload is an acceptable clean-up path and is counted.
      const noReload = await assertSurfaceRestored(page);

      const gate = gateTerminator(real.verdict, flat.verdict);
      rows.push({ az, gate, nightMean: result.nightMeanLuma, reload: !noReload });
    }

    const evaluatedAz = rows.map((r) => r.az);
    expect(evaluatedAz, 'the default view is not in the evaluated set').toContain(0);
    expect(evaluatedAz.length, 'fewer than 3 evaluated azimuths').toBeGreaterThanOrEqual(3);
    const reloads = rows.filter((r) => r.reload).length;
    console.log(
      `[terminator] evaluated set: [${evaluatedAz.join(', ')}] (${evaluatedAz.length} of 12); ` +
        `in-place restores needing a reload: ${reloads}/${rows.length}`,
    );

    console.log(
      `[terminator table]\n${rows
        .map(
          (r) =>
            `  az=${String(r.az).padStart(3)}  real A=${r.gate.real.A.toFixed(1).padStart(6)} ` +
            `ratio=${r.gate.real.ratio.toFixed(2).padStart(6)} S_real=${r.gate.real.S.toFixed(4)}  ` +
            `S_flat=${r.gate.flat.S.toFixed(4)}  nightMean=${r.nightMean.toFixed(2).padStart(6)}  ` +
            `${r.gate.pass ? 'pass' : 'FAIL'}`,
        )
        .join('\n')}`,
    );

    for (const r of rows) {
      expect(r.gate.visible, `az ${r.az}: VISIBLE failed on the real render — ${r.gate.failures.join('; ')}`).toBe(true);
      expect(r.gate.soft, `az ${r.az}: SOFT failed on the albedo-neutral render — ${r.gate.failures.join('; ')}`).toBe(true);
      expect(
        r.gate.catastrophePass,
        `az ${r.az}: real S ${r.gate.real.S.toFixed(4)} >= ${CATASTROPHE_S}`,
      ).toBe(true);
    }

    await writeResult('terminator-3.4-12az', { rows });
  });

  // ---------------------------------------------------- 3.5 pins day and night --
  test('3.5 pins: readable, unblown and still amber — day and night', async ({ page }) => {
    /*
     * SEMANTIC gate. No RGB windows, old or new.
     *
     * The intent: the core must be not black, not blown out, and still amber-tinted.
     * Those are four predicates (P1-P4 below) that hold whatever the exact pixel values
     * drift to. The hardcoded windows are retired because B0 measured the render as
     * byte-identical across eleven commits while the windows moved twice — they described
     * a sampling, not the look.
     *
     * Measured medians are printed as INFORMATION, so drift stays visible without a
     * threshold having to be invented for it.
     */
    const AZ = [0, 90, 180, 270];
    const all: Array<Awaited<ReturnType<typeof measurePinGates>>['results'][number]> = [];
    for (const az of AZ) {
      const { results } = await measurePinGates(page, az);
      all.push(...results);
    }

    const valid = all.filter((r) => r.valid);
    const invalid = all.filter((r) => !r.valid);
    const dayPins = valid.filter((r) => r.side === 'day');
    const nightPins = valid.filter((r) => r.side === 'night');

    console.log(
      `[pins] semantic gate P1 luma>=180, P2 no min(RGB)>=250, P3 sat>=0.15, P4 R>=240 G>=200 B<=G\n` +
        all
          .map(
            (r) =>
              `  az=${String(r.az).padStart(3)} ${r.id.padEnd(12)} ${r.side.padEnd(10)} ` +
              `r/R=${r.rOverR.toFixed(3)} n·cam=${r.facingDot.toFixed(2)} n·sun=${r.sunDot.toFixed(2)} ` +
              (r.valid && r.sample && r.gates
                ? `n=${String(r.sample.count).padStart(3)} med=(${r.sample.median.join(',')}) ` +
                  `luma=${r.sample.medianLuma.toFixed(1)} sat=${r.sample.medianSaturation.toFixed(3)} ` +
                  `blown=${r.sample.blownPx} | ` +
                  `P1=${r.gates.P1 ? 'ok' : 'FAIL'} P2=${r.gates.P2 ? 'ok' : 'FAIL'} ` +
                  `P3=${r.gates.P3 ? 'ok' : 'FAIL'} P4=${r.gates.P4 ? 'ok' : 'FAIL'}`
                : `INVALID: ${r.validityReason}`),
          )
          .join('\n'),
    );

    await writeResult('pin-gates', { az: AZ, rows: all });

    /*
     * NON-VACUITY, from the shared helper and expressed as a FAILURE, never a skip.
     *
     * 3.5's claim is about day AND night pins, so a run in which only one side is
     * measurable supports only half of it. `requireValidPins` throws with the azimuth in the
     * message instead of letting the assertion pass over an empty list.
     *
     * 0 is added here on purpose: az 180 has no valid pin that is a day pin, and az 0 has
     * no valid night pin, so a per-azimuth requirement of "both" would be unsatisfiable.
     * The union across the four azimuths is what the look is judged on.
     */
    requireValidPins(
      valid.map((r) => ({ id: r.id, az: r.az, side: r.side })),
      'some-day-and-some-night',
      `3.5 over az ${AZ.join(',')}`,
    );
    expect(dayPins.length, 'no valid DAY pin in az {0,90,180,270} (needs n·sun > 0.2)').toBeGreaterThan(0);
    expect(nightPins.length, 'no valid NIGHT pin in az {0,90,180,270} (needs n·sun < -0.1)').toBeGreaterThan(0);
    expect(invalid.length, `all pins invalid: ${invalid.map((r) => `${r.id}@${r.az} ${r.validityReason}`).join('; ')}`)
      .toBeLessThan(all.length);

    for (const r of valid) {
      const s2 = r.sample!;
      const g = r.gates!;
      // Inputs before verdicts.
      expect(s2.count, `${r.id}@${r.az}: only ${s2.count} core samples`).toBeGreaterThanOrEqual(5);
      expect(Number.isFinite(s2.medianLuma), `${r.id}@${r.az}: median luma is NaN`).toBe(true);
      expect(Number.isFinite(s2.medianSaturation), `${r.id}@${r.az}: median saturation is NaN`).toBe(true);

      expect(g.P1, `${r.id}@${r.az} P1: median core luma ${s2.medianLuma.toFixed(1)} < 180`).toBe(true);
      expect(g.P2, `${r.id}@${r.az} P2: ${s2.blownPx} fully-blown core px`).toBe(true);
      expect(
        g.P3,
        `${r.id}@${r.az} P3: median saturation ${s2.medianSaturation.toFixed(3)} < 0.15 ` +
          `(core has lost its amber tint; med=(${s2.median.join(',')}))`,
      ).toBe(true);
      expect(
        g.P4,
        `${r.id}@${r.az} P4: median (${s2.median.join(',')}) breaks R>=240 / G>=200 / B<=G`,
      ).toBe(true);
    }
  });

  // -------------------------------------------------- 3.6 ring light cast -----
  test('3.6 rings: no light cast on the surface around a pin', async ({ page }) => {
    const { results } = await measureRingCast(page);

    expect(results.length, 'no pins were measured for ring cast').toBe(6);

    console.log(
      `[ring-cast] annulus r 30..60px, rings/atmosphere/stars/clouds OFF, clock frozen\n` +
        results
          .map(
            (r) =>
              `  ${r.id.padEnd(12)} (${r.x},${r.y}) n=${String(r.annulusPixels).padStart(5)}  ` +
              `on=${r.onMean.toFixed(2)} off=${r.offMean.toFixed(2)} off2=${r.offMean2.toFixed(2)}  ` +
              `delta=${r.deltaPct.toFixed(3)}%  noise=${r.noisePct.toFixed(3)}%  ` +
              `r/R=${r.rOverR.toFixed(3)} n·cam=${r.facingDot.toFixed(2)}  ` +
              `inside=${(r.annulusInsideFraction * 100).toFixed(1)}%  allowed=${r.allowedPct.toFixed(3)}%  ` +
              `${r.valid ? (r.pass ? 'pass' : 'FAIL') : 'INVALID: ' + r.validityReason}`,
          )
          .join('\n'),
    );

    // Inputs must be real before any comparison.
    for (const r of results) {
      expect(r.annulusPixels, `${r.id}: the annulus is empty`).toBeGreaterThan(0);
      expect(Number.isFinite(r.onMean), `${r.id}: pins-ON mean is NaN`).toBe(true);
      expect(Number.isFinite(r.offMean), `${r.id}: pins-OFF mean is NaN`).toBe(true);
      expect(r.offMean, `${r.id}: pins-OFF mean is a null signal`).toBeGreaterThan(0);
    }

    // The gate applies only to pins whose annulus is actually surface. A pin that projects
    // outside the disc cannot have cast light measured on it, and reporting the sky's own
    // variation as a pin's delta is exactly the (300,392) mistake in another costume.
    const measurable = results.filter((r) => r.valid);
    /*
     * 3.6 must have at least one valid pin at EVERY azimuth it evaluates. A green run over
     * zero measurable pins asserts "no cast light" about nothing, which is the vacuity this
     * helper exists to turn into a named failure.
     */
    requireValidPins(measurable.map((r) => r.id), 'at-least-one', '3.6 at the default view (az 0)');
    expect(measurable.length, 'no pin had a valid surface annulus').toBeGreaterThan(0);

    for (const r of measurable) {
      expect(
        r.pass,
        `${r.id}: |delta| ${r.deltaPct}% exceeds allowed ${r.allowedPct}% ` +
          `(max(3%, 1.5 x noise ${r.noisePct}%)) — the pin is casting light on the surface`,
      ).toBe(true);
    }
  });

  // ------------------------------------------------------- 3.9 glint -----
  test('3.9 glint: the accepted attenuated look, as shipped', async ({ page }) => {
    /*
     * REGRESSION SENTINEL for the approved glint. Every other look property has a negative test;
     * this one had a verdict and no guard, so a change to the overlay strength, the bloom or the
     * tone mapping could halve the glint with the whole suite green.
     *
     * The metric is a DIFFERENCE IMAGE — luma(as shipped) minus luma(all specular off) — because
     * peak-luma-in-a-window counts cloud tops (~210) and once reported "92% retained peak" for a
     * build that had lost half its specular.
     *
     * `acquireGlintFrames` calls `assertShippedLook` before capturing: the first attempt at this
     * measurement forced `specularIntensity(0.18)`, the PRE-FIX value, and reported 164.07/15469
     * against the recorded 88.52/9594. That guard is why the reproduction below is exact.
     */
    const frames = await acquireGlintFrames(page);
    const stats = measureGlint(frames.current, frames.off, frames.geometry);

    console.log(`[glint] conditions ${JSON.stringify(frames.conditions)}`);
    console.log(
      `[glint] max=${stats.max.toFixed(2)} (gate ${GLINT_GATE.maxMin}..${GLINT_GATE.maxMax}) ` +
        `area6=${stats.area6} (gate ${GLINT_GATE.area6Min}..${GLINT_GATE.area6Max}) ` +
        `centroid=${JSON.stringify(stats.centroid)} r/R=${stats.centroidROverR?.toFixed(4)} ` +
        `maxAt=${JSON.stringify(stats.maxAt)} (recorded ${GLINT_RECORDED.max}/${GLINT_RECORDED.area6})`,
    );
    await writeResult('glint', { conditions: frames.conditions, stats });

    // Inputs before verdicts: a null measurement must not read as a clean one.
    expect(stats.valid, `the frames cannot support a comparison: ${stats.invalidReason}`).toBe(true);
    expect(frames.geometry.r, 'no disc was found').toBeGreaterThan(0);
    expect(Number.isFinite(stats.max), 'max(D) is NaN').toBe(true);

    expect(
      stats.max,
      `glint peak ${stats.max.toFixed(2)} is outside [${GLINT_GATE.maxMin}, ${GLINT_GATE.maxMax}] — ` +
        `recorded ${GLINT_RECORDED.max}. A fall means the glint was lost; a rise means the clipped ` +
        `blowout the attenuation removed is back.`,
    ).toBeGreaterThanOrEqual(GLINT_GATE.maxMin);
    expect(stats.max).toBeLessThanOrEqual(GLINT_GATE.maxMax);

    expect(
      stats.area6,
      `glint area6 ${stats.area6} is outside [${GLINT_GATE.area6Min}, ${GLINT_GATE.area6Max}] — ` +
        `recorded ${GLINT_RECORDED.area6}`,
    ).toBeGreaterThanOrEqual(GLINT_GATE.area6Min);
    expect(stats.area6).toBeLessThanOrEqual(GLINT_GATE.area6Max);
  });

  // ------------------------------------------------------- 3.7 console -----
  test('3.7 console: zero warnings or errors through the look suite', async ({ page }) => {
    /*
     * Captured from the FIRST navigation, before any interaction, so a warning emitted
     * during boot is caught too — not just the ones the later assertions happen to be
     * watching for at the moment they run.
     *
     * WebGL driver chatter is filtered: SwiftShader emits "GPU stall due to ReadPixels"
     * performance notices on every screenshot, which is the harness's own capture path
     * and not the app. That filter is stated explicitly rather than implied.
     */
    const messages: Array<{ type: string; text: string }> = [];
    page.on('console', (m) => {
      const t = m.type();
      if (t === 'warning' || t === 'error') messages.push({ type: t, text: m.text() });
    });
    page.on('pageerror', (e) => messages.push({ type: 'error', text: `pageerror: ${e.message}` }));

    await openGlobe(page);

    // Exercise the code paths the rest of the suite uses, so the check covers them.
    for (const az of [0, 180]) {
      await settleAt(page, az);
      await setLayers(page, { stars: false, pins: false, rings: false });
      await setLayers(page, { stars: true, pins: true, rings: true });
    }
    await capture(page);

    const DRIVER_NOISE = /GL Driver Message|GPU stall due to ReadPixels|swiftshader/i;
    const real = messages.filter((m) => !DRIVER_NOISE.test(m.text));

    console.log(
      `[console] ${real.length} app message(s), ${messages.length - real.length} driver notice(s) filtered`,
    );
    for (const m of real.slice(0, 10)) console.log(`  ${m.type}: ${m.text}`);

    expect(
      real.length,
      `console is not clean:\n${real.map((m) => `  ${m.type}: ${m.text}`).join('\n')}`,
    ).toBe(0);
  });

});
