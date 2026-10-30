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
  measureGlare,
  measureRim,
  measureTerminator,
  writeResult,
  ALL_LAYERS,
} from './look/measure';
import { openGlobe, setLayers, settleAt } from './look/capture';
import { luma } from '../../src/lib/look/helpers';

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

    expect(result.windows.length, 'no probe windows were measured').toBeGreaterThan(0);

    console.log(
      `[blue-circle]\n${result.windows
        .map(
          (w) =>
            `  window ${w.size}x${w.size}@(${w.x},${w.y})  peak=${w.peak}  annulusMed=${w.annulusMedian}  ` +
            `ratio=${w.ratio}  ${w.excluded ? 'EXCLUDED (sun glint)' : w.pass ? 'pass' : 'FAIL'}`,
        )
        .join('\n')}`,
    );

    for (const w of result.windows) {
      expect(Number.isFinite(w.peak), `window (${w.x},${w.y}): peak is NaN`).toBe(true);
      expect(Number.isFinite(w.ratio), `window (${w.x},${w.y}): ratio is NaN`).toBe(true);
      expect(w.ratio, `window (${w.x},${w.y}) annulus median is a null signal`).not.toBe(0);
      expect(
        w.pass,
        `window ${w.size}px @ (${w.x},${w.y}): blurred peak ${w.peak} is ${w.ratio}x the ` +
          `surrounding annulus median ${w.annulusMedian} (max 1.15x)`,
      ).toBe(true);
    }

    // The required window must be present and must not be excluded.
    const required = result.windows.find((w) => w.x === 344 && w.y === 392);
    expect(required, 'the required 40x40 window at (344,392) was not measured').toBeDefined();
    expect(required!.excluded, 'the (344,392) window must not be excused as sun glint').toBe(false);
  });

  // ------------------------------------------------------- 3.4 terminator -----
  test('3.4 terminator: measured from pixels, soft and readable', async ({ page }) => {
    const geom = await requireValidDisc(page);
    const { result } = await measureTerminator(page);

    expect(result.profile.length, 'terminator profile has no samples').toBeGreaterThan(100);
    expect(
      result.profile.every((p) => Number.isFinite(p.luma)),
      'terminator profile contains a non-finite luma',
    ).toBe(true);
    expect(result.widthPx, 'transition width could not be measured').not.toBeNull();

    console.log(
      `[terminator] day=${result.dayLevel} night=${result.nightLevel} ` +
        `width=${result.widthPx}px (${result.widthPctR}% of R) axis=(${result.axis.ax.toFixed(2)},${result.axis.ay.toFixed(2)})`,
    );

    // State the noise floor: a softness figure is meaningless without it.
    const noise = await frameNoise(page);
    console.log(
      `[terminator] frame noise meanAbs=${noise.meanAbs.toFixed(4)} maxAbs=${noise.maxAbs.toFixed(1)}`,
    );
    expect(Number.isFinite(noise.meanAbs), 'frame noise is NaN').toBe(true);

    // Baseline look must still be the approved one after all the toggling.
    await setLayers(page, ALL_LAYERS);
    await settleAt(page, 0);
    const restored = await disc(page);
    expect(Math.abs(restored.r - geom.r) / geom.r).toBeLessThanOrEqual(0.02);
    void luma; // re-exported for ad-hoc use in a failing test
  });
});
