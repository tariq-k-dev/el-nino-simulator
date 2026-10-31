/**
 * REPRODUCTION PROBE for the recorded glint numbers — run BEFORE any gate is written.
 *
 * G3 of 2B-C2B-F3FIX requires the recorded values to reproduce within 3 % first, and a STOP with
 * exact conditions if they do not. That ordering matters: a gate written before the reproduction
 * is a gate fitted to whatever this machine happens to render.
 *
 * Not a committed spec — it lives under `look/` and is driven by hand:
 *
 *     pnpm build:e2e
 *     npx cross-env PLAYWRIGHT_HTML_OPEN=never playwright test \
 *       tests/e2e/look/glintRepro.spec.ts
 *
 * It is kept (rather than deleted after use) because it is the artefact that proves the numbers
 * the 3.9 gate asserts were MEASURED here rather than copied from a document.
 */
import { test, expect } from '../fixtures';
import { openGlobe } from './capture';
import { acquireGlintFrames } from './glintAcquire';
import { measureGlint } from './glint';
import { GLINT_RECORDED } from './glintConstants';
import { writeResult } from './measure';

test.setTimeout(240_000);

test('glint reproduction: the recorded Do numbers, as shipped', async ({ page }) => {
  await openGlobe(page);
  const frames = await acquireGlintFrames(page);
  const stats = measureGlint(frames.current, frames.off, frames.geometry);

  console.log(`[glint-repro] conditions ${JSON.stringify(frames.conditions)}`);
  console.log(`[glint-repro] stats ${JSON.stringify(stats)}`);

  expect(stats.valid, `the frames cannot support a comparison: ${stats.invalidReason}`).toBe(true);

  const rel = (a: number, b: number) => Math.abs(a - b) / b;
  const maxRel = rel(stats.max, GLINT_RECORDED.max);
  const areaRel = rel(stats.area6, GLINT_RECORDED.area6);

  console.log(
    `[glint-repro] max ${stats.max.toFixed(2)} vs recorded ${GLINT_RECORDED.max} (rel ${(maxRel * 100).toFixed(2)}%) | ` +
      `area6 ${stats.area6} vs ${GLINT_RECORDED.area6} (rel ${(areaRel * 100).toFixed(2)}%) | ` +
      `centroid ${JSON.stringify(stats.centroid)} r/R ${stats.centroidROverR?.toFixed(4)} | maxAt ${JSON.stringify(stats.maxAt)}`,
  );

  await writeResult('glint-repro', { conditions: frames.conditions, stats, maxRel, areaRel });

  // Report, do not gate: this probe exists to be READ. The 3 % rule is applied by the caller.
  console.log(
    `[glint-repro] within 3%: max ${maxRel <= 0.03 ? 'YES' : 'NO'} | area6 ${areaRel <= 0.03 ? 'YES' : 'NO'}`,
  );
});
