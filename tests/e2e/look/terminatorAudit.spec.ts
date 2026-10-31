/**
 * F4 TERMINATOR AUDIT — read-only. Produces the numbers in docs/globe-look/TERMINATOR-AUDIT.md.
 *
 * Not a committed spec: it writes a JSON artefact and prints the tables a human reads. Run by hand:
 *
 *     pnpm build:e2e
 *     npx cross-env PLAYWRIGHT_HTML_OPEN=never playwright test tests/e2e/look/terminatorAudit.spec.ts
 *
 * What it answers, in the order the prompt asks:
 *   a) the luminance function of n·L that is actually implemented (source, not belief);
 *   b) the 1 px profile along the projected-sun axis at the default view, with the analytic
 *      n·L at each position, and the span the OLD metric used marked on it;
 *   c) the true day and night levels, whether that span contains n·L = 0, and where luma falls;
 *   d) theta, the terminator crossing r/R and the ±0.25 r/R values at all twelve azimuths.
 *
 * The profile is deliberately NOT smoothed. The old measurement smoothed by 9 px before taking
 * its width and step, which is part of how a 31 px "width" appeared; the audit reports the raw
 * median-of-5 profile so the reader can see the actual edge.
 */
import type { Page } from '@playwright/test';
import type { DiscGeometry } from '../../../src/lib/look/helpers';
import { sunScreenAxis } from '../../../src/lib/look/helpers';
import { test, expect } from '../fixtures';
import { openGlobe, capture, cameraGeometry, fitLimb, setLayers, settleAt, sunAndCamera } from './capture';
import { writeResult } from './measure';
import { serializeGeometry, buildProfile, auditedAzimuthSet } from './terminatorProfile';

test.setTimeout(600_000);

/** One capture at one azimuth, with the same layer flags the current 3.4 uses. */
async function snapshot(page: Page, azimuthDeg: number) {
  await settleAt(page, azimuthDeg);
  await setLayers(page, { stars: false, pins: false, rings: false });

  const fit = await fitLimb(page);
  if (!Number.isFinite(fit.r)) throw new Error(`terminatorAudit: limb fit failed at az ${azimuthDeg}`);
  const geom: DiscGeometry = { cx: fit.cx, cy: fit.cy, r: fit.r };

  await setLayers(page, { stars: false, pins: false, rings: false });
  const img = await capture(page);

  const { sun, cam } = await sunAndCamera(page);
  const camGeom = await cameraGeometry(page);
  const axis = sunScreenAxis(sun, cam);

  return { img, geom, sun, cam, camGeom, axis, fit };
}

test('F4: the terminator, audited against the analytic n·L', async ({ page }) => {
  await openGlobe(page);

  const rows: Array<Record<string, unknown>> = [];

  for (const az of auditedAzimuthSet()) {
    const s = await snapshot(page, az);
    const g = serializeGeometry({
      cam: s.cam,
      sun: s.sun,
      fov: s.camGeom.fov,
      heightPx: s.camGeom.height,
      cx: s.geom.cx,
      cy: s.geom.cy,
      r: s.geom.r,
      radius: s.camGeom.radius,
    });

    /*
     * Per-pixel analytic n·L across the whole disc, once, so every band below (day level, night
     * level, ±0.25 search) is answered from one consistent field rather than four separate scans.
     */
    const field = buildProfile(s.img, g);

    rows.push({
      az,
      ...field.summary,
      axis: { ax: +s.axis.ax.toFixed(5), ay: +s.axis.ay.toFixed(5) },
      rFit: +s.geom.r.toFixed(3),
      rms: +s.fit.rms.toFixed(3),
      misses: s.fit.misses,
      profile: field.profile,
    });

    await writeResult(`terminator-audit-az${az}`, {
      az,
      summary: field.summary,
      geometry: g,
      profile: field.profile,
    });
    console.log(
      `[audit] az=${String(az).padStart(3)} theta=${field.summary.thetaDeg.toFixed(1)} ` +
        `cross r/R=${fmt(field.summary.crossROverR)} +0.25 r/R=${fmt(field.summary.plus25ROverR)} ` +
        `-0.25 r/R=${fmt(field.summary.minus25ROverR)} day=${fmt(field.summary.dayLevel)} ` +
        `night=${fmt(field.summary.nightLevel)} allInView=${field.summary.allInView}`,
    );
  }

  await writeResult('terminator-audit', { rows });
  expect(rows.length, 'the audit produced no rows').toBe(12);
});

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(3);
}
