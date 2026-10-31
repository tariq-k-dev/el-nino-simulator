/**
 * D — THE ALBEDO-NEUTRAL PROBE. Diagnosis, not a gate.
 *
 * The F5 stop left two competing explanations for the SOFT failures at az 120 and az 150:
 *
 *   H1 (geography) — the terminator is a fixed great circle; a 0.02-wide n·L bin is a thin
 *        geographic strip, and its median luma is whatever land, ocean or ice it crosses.
 *   H2 (shading)   — a real discontinuity in the Earth material near n·L ≈ 0.05.
 *
 * Step D does not decide by argument. It removes the textures and re-measures: with a flat surface
 * the curve is a pure function of n·L, so a step that SURVIVES is shading and a step that VANISHES
 * was geography.
 *
 * The rule is pre-registered (E3): if the flat render passes S <= 0.25 at all seven azimuths and all
 * three levels, H1 is accepted. If any flat S exceeds 0.25, H2 holds and this STOPs.
 *
 * Run by hand:
 *     pnpm build:e2e
 *     npx cross-env PLAYWRIGHT_HTML_OPEN=never playwright test tests/e2e/look/flatAlbedoProbe.spec.ts
 */
import { test, expect } from '../fixtures';
import { openGlobe } from './capture';
import { writeResult } from './measure';
import {
  FLAT_LEVELS,
  FLAT_PROBE_AZIMUTHS,
  acquireFlatFrame,
  acquireRealFrame,
  assertSurfaceRestored,
  readTextureMeans,
} from './flatAlbedo';
import { TERMINATOR_GATE } from './terminatorProfile';

test.setTimeout(900_000);

test('D: albedo-neutral probe at the seven evaluated azimuths and three levels', async ({ page }) => {
  await openGlobe(page);

  // The set is geometry-only, so it is identical to P2FIX. Printed before measuring, as required.
  console.log(`[flat] azimuths (the P2FIX evaluated set, re-printed): [${FLAT_PROBE_AZIMUTHS.join(', ')}]`);
  console.log(`[flat] levels: ${FLAT_LEVELS.map((l) => `x${l}`).join(', ')}`);

  const means = await readTextureMeans(page);
  const fmt3 = (v: [number, number, number]) => `[${v.map((c) => c.toFixed(4)).join(', ')}]`;
  console.log(`[flat] day texture mean (LINEAR):   ${fmt3(means.day)}`);
  console.log(`[flat] night texture mean (LINEAR): ${fmt3(means.night)}`);

  const rows: Array<Record<string, unknown>> = [];
  /** How many times an in-place restore failed and a reload was needed. Reported. */
  let reloads = 0;

  for (const level of FLAT_LEVELS) {
    for (const az of FLAT_PROBE_AZIMUTHS) {
      const flat = await acquireFlatFrame(page, az, level, means);
      expect(flat.probeAlive, `az ${az} level ${level}: the flat-albedo defect was not live at capture`).toBe(true);

      const v = flat.verdict;
      const row = {
        level,
        az,
        evaluated: v.evaluated,
        notEvaluatedReason: v.notEvaluatedReason,
        pixelCount: v.pixelCount,
        Ld: v.Ld,
        Ln: v.Ln,
        A: v.A,
        ratio: v.ratio,
        S: v.S,
        worstStepBin: v.worstStepBin,
        worstStepLuma: v.worstStepLuma,
        curves: v.curve,
        curveCounts: v.curveCounts,
      };
      rows.push(row);

      if (!v.evaluated) {
        console.log(`[flat] x${level} az ${String(az).padStart(3)}  NOT EVALUATED — ${v.notEvaluatedReason}`);
        continue;
      }
      console.log(
        `[flat] x${level} az ${String(az).padStart(3)}  Ld=${v.Ld.toFixed(2).padStart(6)} ` +
          `Ln=${v.Ln.toFixed(2).padStart(6)} A=${v.A.toFixed(2).padStart(6)} ` +
          `ratio=${v.ratio.toFixed(2).padStart(6)} S=${v.S.toFixed(4).padStart(7)} ` +
          `(gate ${TERMINATOR_GATE.softMaxS}) worstBin=${v.worstStepBin} step=${v.worstStepLuma.toFixed(2)} ` +
          `${v.soft ? 'SOFT pass' : 'SOFT **FAIL**'}`,
      );

      // The mutation must not travel between captures. A reload is allowed and counted.
      const clean = await assertSurfaceRestored(page);
      if (!clean) reloads += 1;
    }
  }

  /*
   * The two curves that failed in P2FIX, flat next to real. The real ones are re-measured here rather
   * than trusted from the previous run, because a stored number cannot be re-checked.
   */
  const comparison: Array<Record<string, unknown>> = [];
  for (const az of [120, 150]) {
    const real = await acquireRealFrame(page, az);
    const flat = await acquireFlatFrame(page, az, 1.0, means);
    await assertSurfaceRestored(page);
    comparison.push({ az, real: real.verdict, flat: flat.verdict });
    console.log(
      `[flat] az ${az} REAL  S=${real.verdict.S.toFixed(4)} worstBin=${real.verdict.worstStepBin} step=${real.verdict.worstStepLuma.toFixed(2)}`,
    );
    console.log(
      `[flat] az ${az} FLAT  S=${flat.verdict.S.toFixed(4)} worstBin=${flat.verdict.worstStepBin} step=${flat.verdict.worstStepLuma.toFixed(2)}`,
    );
  }

  console.log(`[flat] in-place restores that needed a reload: ${reloads} of ${rows.length + 4}`);
  await writeResult('flat-albedo-probe', { means, rows, comparison, reloads });

  /*
   * E3, pre-registered: every evaluated flat S must be <= 0.25 at every level. This assertion IS the
   * decision rule, so it is not a threshold being applied after the fact — it is the rule as written.
   */
  const failures = rows.filter((r) => r.evaluated === true && (r.S as number) > TERMINATOR_GATE.softMaxS);
  console.log(
    `[flat] E3 verdict: ${failures.length === 0 ? 'H1 accepted — every flat S <= 0.25' : `H2 holds — ${failures.length} flat S > 0.25`}`,
  );
  expect(
    failures.map((r) => `x${r.level} az ${r.az} S=${(r.S as number).toFixed(4)}`),
    'the albedo-neutral render still has a step above 0.25 — H2 (shading), not geography',
  ).toEqual([]);
});
