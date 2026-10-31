/**
 * TERMINATOR ACQUISITION — one frozen capture per azimuth, with its analytic geometry.
 *
 * Kept in its own module for the same reason `acquire.ts` is separate from `analysis.ts`: this is the
 * only place that settles the scene, sets layers and captures, and the gate itself
 * (`evaluateTerminator`) never sees a page.
 *
 * THE FLAGS, stated because 3.4's definition depends on them: `stars false, pins false, rings false`,
 * clouds and atmosphere left at the approved look's values. That is the same set the retired metric
 * used, so the informational old width/step columns are comparable.
 *
 * The clock is frozen by `settleAt`, which pins the scene clock as well as the spin — without that two
 * captures of "the same" azimuth differ by a mean 17.4 luma inside the disc.
 */
import type { Page } from '@playwright/test';
import type { Bitmap, DiscGeometry, SunCameraGeometry } from '../../../src/lib/look/helpers';
import {
  cameraGeometry,
  capture,
  fitLimb,
  setLayers,
  settleAt,
  sunAndCamera,
} from './capture';
import { findAxisNDotL, sunScreenAxis, sunViewAngleDeg } from '../../../src/lib/look/helpers';

/** The layer flags 3.4 is measured under. Named, so a report can state them. */
export const TERMINATOR_FLAGS = {
  stars: false,
  pins: false,
  rings: false,
} as const;

export interface TerminatorFrame {
  az: number;
  img: Bitmap;
  geom: DiscGeometry;
  /** Everything the analytic n·L needs, in the shape the pure helpers take. */
  sunCam: SunCameraGeometry;
  thetaDeg: number;
  crossROverR: number | null;
  /** Limb-fit quality, reported so a bad fit is visible rather than assumed. */
  rms: number;
  rays: number;
  misses: number;
}

/**
 * Settle, fit, capture, and resolve the geometry for one azimuth.
 *
 * `fitLimb` swaps the surface to unlit white and restores it, so the layer flags are re-established
 * afterwards — the same ordering `measurePinGates` uses, for the same reason.
 */
export async function acquireTerminatorFrame(page: Page, azimuthDeg: number): Promise<TerminatorFrame> {
  await settleAt(page, azimuthDeg);
  await setLayers(page, TERMINATOR_FLAGS);

  const fit = await fitLimb(page);
  if (!Number.isFinite(fit.r) || fit.r <= 0) {
    throw new Error(`acquireTerminatorFrame: limb fit produced no circle at az ${azimuthDeg}`);
  }
  const geom: DiscGeometry = { cx: fit.cx, cy: fit.cy, r: fit.r };

  await setLayers(page, TERMINATOR_FLAGS);
  const img = await capture(page);

  const { sun, cam } = await sunAndCamera(page);
  const camGeom = await cameraGeometry(page);
  const sunCam: SunCameraGeometry = {
    cam,
    sun,
    fov: camGeom.fov,
    heightPx: camGeom.height,
    cx: geom.cx,
    cy: geom.cy,
    r: geom.r,
    radius: camGeom.radius,
  };

  const axis = sunScreenAxis(sun, cam);
  const cross = findAxisNDotL(sunCam, axis, 0);

  return {
    az: azimuthDeg,
    img,
    geom,
    sunCam,
    thetaDeg: sunViewAngleDeg(sunCam),
    crossROverR: cross?.rOverR ?? null,
    rms: fit.rms,
    rays: fit.rays,
    misses: fit.misses,
  };
}

/** The twelve azimuths the 3.4 sweep covers. */
export function terminatorAzimuths(): number[] {
  return Array.from({ length: 12 }, (_, i) => i * 30);
}
