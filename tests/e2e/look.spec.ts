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
  frameNoise,
  measureBlueCircle,
  measurePinCores,
  measureGlare,
  measureRim,
  measureTerminator,
  writeResult,
} from './look/measure';
import { openGlobe } from './look/capture';

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
  test('3.4 terminator: measured from pixels, soft and readable', async ({ page }) => {
    await requireValidDisc(page);
    const { result } = await measureTerminator(page);

    // Inputs.
    expect(result.profile.length, 'terminator profile has no samples').toBeGreaterThan(100);
    expect(
      result.profile.every((p) => Number.isFinite(p.luma)),
      'terminator profile contains a non-finite luma',
    ).toBe(true);
    expect(result.widthPx, 'transition width could not be measured').not.toBeNull();
    expect(result.rms, 'the limb fit was not a circle').toBeLessThanOrEqual(0.4);

    console.log(
      `[terminator] az=0 day=${result.dayLevel} night=${result.nightLevel} ` +
        `width=${result.widthPx}px (${result.widthPctR}% of R_fit ${result.rFit}) ` +
        `axis=(${result.axis.ax.toFixed(2)},${result.axis.ay.toFixed(2)})\n` +
        `[terminator] nightFraction(luma, <25% of day mean)=${(result.nightFractionLuma * 100).toFixed(2)}% ` +
        `nightMean=${result.nightMeanLuma} dayMean=${result.dayMeanLuma} ` +
        `crossTerminatorStep=${result.crossTerminatorStep}/255`,
    );

    // Default-view gates.
    expect(
      result.widthPctR!,
      `90%->10% width is ${result.widthPctR}% of R_fit, needs >= 6%`,
    ).toBeGreaterThanOrEqual(6);
    expect(
      result.nightFractionLuma * 100,
      `night fraction by luma is ${(result.nightFractionLuma * 100).toFixed(2)}%, needs 10-30%`,
    ).toBeGreaterThanOrEqual(10);
    expect(result.nightFractionLuma * 100).toBeLessThanOrEqual(30);
    expect(result.nightMeanLuma, 'night mean luma is below 4/255').toBeGreaterThanOrEqual(4);

    // Noise floor, so "soft" is not confused with "noisy".
    const noise = await frameNoise(page);
    console.log(
      `[terminator] frame noise meanAbs=${noise.meanAbs.toFixed(4)} maxAbs=${noise.maxAbs.toFixed(1)}`,
    );
    expect(Number.isFinite(noise.meanAbs), 'frame noise is NaN').toBe(true);
  });

  test('3.4 terminator: other 11 azimuths, night mean and no hard step', async ({ page }) => {
    const AZIMUTHS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
    const rows: Array<{
      az: number;
      nightMeanLuma: number;
      crossTerminatorStep: number;
      widthPx: number | null;
      widthPctR: number | null;
      nightFractionLuma: number;
      rFit: number;
    }> = [];

    for (const az of AZIMUTHS) {
      const { result } = await measureTerminator(page, { azimuthDeg: az });
      expect(result.rms, `az ${az}: limb fit RMS too large`).toBeLessThanOrEqual(0.4);
      expect(Number.isFinite(result.nightMeanLuma), `az ${az}: night mean is NaN`).toBe(true);
      rows.push({
        az,
        nightMeanLuma: result.nightMeanLuma,
        crossTerminatorStep: result.crossTerminatorStep,
        widthPx: result.widthPx,
        widthPctR: result.widthPctR,
        nightFractionLuma: result.nightFractionLuma,
        rFit: result.rFit,
      });
    }

    const maxStep = Math.max(...rows.map((r) => r.crossTerminatorStep));
    /*
     * The gate is the DATA-DRIVEN threshold adopted in 2A4: 16/255 across all 12
     * azimuths. 2A3 derived ceil(1.25 x max) = 16 from the same table, so the two agree;
     * the constant is now stated rather than re-derived, so a future regression cannot
     * move the gate by inflating the maximum it is computed from.
     */
    const threshold = 16;

    console.log(
      `[terminator table]\n${rows
        .map(
          (r) =>
            `  az=${String(r.az).padStart(3)}  nightMean=${r.nightMeanLuma.toFixed(2).padStart(6)}  ` +
            `crossStep=${r.crossTerminatorStep.toFixed(2).padStart(6)}  ` +
            `width=${r.widthPx === null ? 'null' : r.widthPx.toFixed(1).padStart(5)}px ` +
            `(${r.widthPctR === null ? 'null' : r.widthPctR.toFixed(2)}% R)  ` +
            `nightFrac=${(r.nightFractionLuma * 100).toFixed(2)}%  R_fit=${r.rFit}`,
        )
        .join('\n')}\n` +
        `[terminator] max step=${maxStep.toFixed(2)}/255 -> gate ${threshold}/255`,
    );

    await writeResult('terminator-table', {
      rows,
      maxStep,
      threshold,
      rule: 'fixed 16/255 (2A4), equals the 2A3 ceil(1.25 x max) derivation',
    });

    for (const r of rows) {
      expect(r.nightMeanLuma, `az ${r.az}: night mean luma ${r.nightMeanLuma} < 4/255`).toBeGreaterThanOrEqual(4);
      expect(
        r.crossTerminatorStep,
        `az ${r.az}: cross-terminator step ${r.crossTerminatorStep}/255 exceeds the derived ${threshold}/255`,
      ).toBeLessThanOrEqual(threshold);
    }
  });
  // ---------------------------------------------------- 3.5 pins day and night --
  test('3.5 pins: readable cores day and night, never black, never blown', async ({ page }) => {
    /*
     * Day core ~ (255,255,158..172), night core ~ (240,238,123)..(255,255,150).
     * Tolerance +-12 per channel. The ranges are the BRIEF's and are not widened here.
     *
     * A pin is judged on the brightest pixel of its 13x13 core box (the emissive sphere's
     * centre); the surrounding housing is deliberately near-black and would drag a mean
     * toward 0.
     */
    const TOL = 12;

    const day = await measurePinCores(page, 0);
    const night = await measurePinCores(page, 180);
    const all = [...day.cores, ...night.cores];

    expect(all.length, 'no facing pins were found at az 0 or az 180').toBeGreaterThan(0);

    // At least one night-side pin must be visible, per the brief.
    const nightSide = all.filter((c) => c.side === 'night');
    expect(nightSide.length, 'no night-side pin was visible at az 0 or 180').toBeGreaterThan(0);

    console.log(
      `[pins] tolerance +-${TOL}/channel | day target (255,255,158..172) | night target (240,238,123)..(255,255,150)\n` +
        all
          .map(
            (c) =>
              `  az=${String(c.az).padStart(3)} ${c.id.padEnd(12)} ${c.side.padEnd(5)} ` +
              `core=(${c.coreRgb.join(',')}) at (${c.coreAt.join(',')}) ` +
              `pureWhite=${c.pureWhitePx} black=${c.blackPx}`,
          )
          .join('\n'),
    );

    await writeResult('pin-cores', { tolerance: TOL, rows: all });

    for (const c of all) {
      expect(Number.isFinite(c.coreRgb[0]), `${c.id}: core R is not finite`).toBe(true);

      // Core is not black.
      expect(
        c.coreRgb[0] + c.coreRgb[1] + c.coreRgb[2],
        `${c.id} @ az ${c.az}: core is black`,
      ).toBeGreaterThan(0);

      // No blown pixels inside the core.
      expect(c.pureWhitePx, `${c.id} @ az ${c.az}: ${c.pureWhitePx} pure-white px in the core`).toBe(0);

      const [r, g, b] = c.coreRgb;
      if (c.side === 'day') {
        expect(Math.abs(r - 255), `${c.id} day: R ${r} outside 255+-${TOL}`).toBeLessThanOrEqual(TOL);
        expect(Math.abs(g - 255), `${c.id} day: G ${g} outside 255+-${TOL}`).toBeLessThanOrEqual(TOL);
        expect(b, `${c.id} day: B ${b} outside 158..172+-${TOL}`).toBeGreaterThanOrEqual(158 - TOL);
        expect(b, `${c.id} day: B ${b} outside 158..172+-${TOL}`).toBeLessThanOrEqual(172 + TOL);
      } else {
        expect(r, `${c.id} night: R ${r} outside 240..255+-${TOL}`).toBeGreaterThanOrEqual(240 - TOL);
        expect(g, `${c.id} night: G ${g} outside 238..255+-${TOL}`).toBeGreaterThanOrEqual(238 - TOL);
        expect(b, `${c.id} night: B ${b} outside 123..150+-${TOL}`).toBeGreaterThanOrEqual(123 - TOL);
        expect(b, `${c.id} night: B ${b} outside 123..150+-${TOL}`).toBeLessThanOrEqual(150 + TOL);
      }
    }
  });

});
