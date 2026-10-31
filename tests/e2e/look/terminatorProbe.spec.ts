/**
 * F5 PROBE — print the evaluated set BEFORE any threshold is applied, then measure.
 *
 * The prompt's ordering requirement exists so the set cannot be chosen to fit the numbers. This spec
 * captures all twelve azimuths, prints the applicability table from geometry alone, and only then
 * evaluates the gate. Run by hand:
 *
 *     pnpm build:e2e
 *     npx cross-env PLAYWRIGHT_HTML_OPEN=never playwright test tests/e2e/look/terminatorProbe.spec.ts
 */
import { test, expect } from '../fixtures';
import { openGlobe } from './capture';
import { writeResult } from './measure';
import { acquireTerminatorFrame, terminatorAzimuths } from './terminatorAcquire';
import { decideApplicability } from './terminatorApplicability';
import { evaluateTerminator } from './terminatorProfile';
import { nightFractionByLuma } from './measure';

test.setTimeout(600_000);

test('F5: evaluated set printed first, then measured', async ({ page }) => {
  await openGlobe(page);

  const frames = [];
  for (const az of terminatorAzimuths()) {
    frames.push(await acquireTerminatorFrame(page, az));
  }

  // ---- STEP 1: the evaluated set, from geometry and coverage only. No luma, no thresholds. ----
  const applicability = decideApplicability(
    frames.map((f) => ({
      az: f.az,
      img: f.img,
      geom: f.sunCam,
      thetaDeg: f.thetaDeg,
      crossROverR: f.crossROverR,
    })),
  );

  console.log('[f5] EVALUATED SET, decided before measuring:');
  console.log(
    '  az  theta   cross r/R  dayPx  nightPx  minBin  evaluated  reason',
  );
  for (const r of applicability) {
    console.log(
      `  ${String(r.az).padStart(3)} ${r.thetaDeg.toFixed(1).padStart(6)} ` +
        `${(r.crossROverR ?? Number.NaN).toFixed(3).padStart(9)} ` +
        `${String(r.dayCount).padStart(6)} ${String(r.nightCount).padStart(8)} ` +
        `${String(r.minBinCount).padStart(7)}  ${r.evaluated ? 'yes' : 'no '}       ${r.reason ?? ''}`,
    );
  }

  const evaluatedAz = applicability.filter((r) => r.evaluated).map((r) => r.az);
  console.log(`[f5] evaluated azimuths: [${evaluatedAz.join(', ')}] (${evaluatedAz.length} of 12)`);

  // The default view MUST be evaluated, and at least 3 azimuths with it.
  expect(evaluatedAz, 'the default view (az 0) is not in the evaluated set').toContain(0);
  expect(evaluatedAz.length, 'fewer than 3 evaluated azimuths including the default').toBeGreaterThanOrEqual(3);

  // ---- STEP 2: measure. ----
  console.log('[f5] MEASURED:');
  console.log(
    '  az   Ld     Ln      A    Ld/Ln     S    headroom  worstBin  worstStep  visible soft pass',
  );
  for (const f of frames) {
    const v = evaluateTerminator(f.img, f.sunCam);
    if (!v.evaluated) {
      console.log(`  ${String(f.az).padStart(3)}  NOT EVALUATED — ${v.notEvaluatedReason}`);
      continue;
    }
    console.log(
      `  ${String(f.az).padStart(3)} ${v.Ld.toFixed(2).padStart(6)} ${v.Ln.toFixed(2).padStart(6)} ` +
        `${v.A.toFixed(2).padStart(7)} ${v.ratio.toFixed(2).padStart(7)} ` +
        `${v.S.toFixed(3).padStart(6)} ${v.softHeadroom.toFixed(2).padStart(9)} ` +
        `${String(v.worstStepBin).padStart(8)} ${v.worstStepLuma.toFixed(2).padStart(10)} ` +
        `  ${v.visible ? 'yes' : 'NO '}   ${v.soft ? 'yes' : 'NO '}  ${v.pass ? 'yes' : 'NO '}`,
    );
    // The full 20-bin curve for the default view, so a failure is diagnosable from the log alone.
    if (f.az === 0) {
      console.log(`  [f5] az 0 curve (n·L bin centre -> median luma, count):`);
      for (let k = 0; k < v.curve.length; k += 1) {
        const centre = -0.1 + 0.02 * k + 0.01;
        console.log(
          `        ${centre.toFixed(2).padStart(5)} -> ${Number.isFinite(v.curve[k]) ? v.curve[k].toFixed(2).padStart(6) : '   NaN'} (${v.curveCounts[k]})`,
        );
      }
    }
  }

  // Night fraction / night mean stay as they were — same luma definition, reported for continuity.
  console.log('[f5] unchanged legacy metrics:');
  for (const f of frames) {
    const nf = nightFractionByLuma(f.img, f.geom);
    console.log(
      `  az ${String(f.az).padStart(3)} nightFraction=${(nf.fraction * 100).toFixed(2)}% ` +
        `nightMean=${Number.isFinite(nf.nightMean) ? nf.nightMean.toFixed(2) : 'NaN'} ` +
        `dayMean=${nf.dayMean.toFixed(2)}`,
    );
  }

  await writeResult('terminator-f5', {
    applicability,
    measured: frames.map((f) => ({ az: f.az, verdict: evaluateTerminator(f.img, f.sunCam) })),
  });
});
