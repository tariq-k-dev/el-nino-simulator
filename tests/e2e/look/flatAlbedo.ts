/**
 * FLAT-ALBEDO HELPERS — drive the albedo-neutral probe and evaluate it with the same pipeline.
 *
 * The probe exists to answer one question: are the F5 SOFT failures GEOGRAPHY or SHADING?
 *
 * With the clock frozen the terminator is a fixed great circle, so a bin of width 0.02 in n·L is a
 * thin geographic strip — its median luma is whatever land, ocean or ice the strip crosses. Remove
 * the textures and the surface becomes a pure function of n·L, so any step left in the curve is the
 * shader. That is the whole experiment, and it is run through the SAME defect handle N6c uses so
 * there is no second injection path to trust.
 */
import type { Page } from '@playwright/test';
import type { Bitmap } from '../../../src/lib/look/helpers';
import { acquire, installDefectEngine, type DefectSpec } from './acquire';
import { capture, openGlobe, setLayers } from './capture';
import { evaluateTerminator, type TerminatorVerdict } from './terminatorProfile';
import { acquireTerminatorFrame, TERMINATOR_FLAGS, type TerminatorFrame } from './terminatorAcquire';

/** The seven azimuths P2FIX evaluated. Re-printed before measuring, never re-derived. */
export const FLAT_PROBE_AZIMUTHS = [0, 120, 150, 180, 270, 300, 330] as const;

/** The three albedo levels: day colour x 0.5, x 1.0, x 1.5. */
export const FLAT_LEVELS = [0.5, 1.0, 1.5] as const;

export interface TextureMeans {
  /** Day and night texture means, per channel, in LINEAR space. */
  day: [number, number, number];
  night: [number, number, number];
}

/**
 * Read the texture means off the live page.
 *
 * The values come from the actual textures via a canvas draw, so the probe's flat colour is the mean
 * of the pixels the render uses — not a constant someone picked.
 */
export async function readTextureMeans(page: Page): Promise<TextureMeans> {
  await installDefectEngine(page);
  const raw = await page.evaluate(() => {
    const w = window as unknown as { __defects?: { textureMeans(): Record<string, number[]> } };
    if (!w.__defects) throw new Error('defect engine is not installed on this page');
    return w.__defects.textureMeans();
  });
  const day = raw.day ?? [1, 1, 1];
  const night = raw.night ?? [0, 0, 0];
  return {
    day: [day[0] ?? 1, day[1] ?? 1, day[2] ?? 1],
    night: [night[0] ?? 0, night[1] ?? 0, night[2] ?? 0],
  };
}

/**
 * Capture one azimuth with the surface flattened to `level`.
 *
 * `acquire()` is reused rather than hand-rolled so the ordering (flags → fit → baseline → install →
 * frames → probe → capture → uninstall → restore) is the committed one, and so the SURVIVAL PROBE
 * refuses to hand back a frame whose textures were silently restored by a React re-render.
 */
export async function acquireFlatFrame(
  page: Page,
  azimuthDeg: number,
  level: number,
  means: TextureMeans,
): Promise<{ img: Bitmap; frame: TerminatorFrame; verdict: TerminatorVerdict; probeAlive: boolean }> {
  // Geometry first, untouched surface: the fit must not measure a flattened sphere's edge.
  const frame = await acquireTerminatorFrame(page, azimuthDeg);
  const geometry = { cx: frame.geom.cx, cy: frame.geom.cy, r: frame.geom.r };

  const defect: DefectSpec = {
    name: 'flatAlbedo',
    params: { level, dayMean: means.day, nightMean: means.night },
  };

  const result = await acquire(page, {
    flags: TERMINATOR_FLAGS,
    azimuth: azimuthDeg,
    defect,
  });

  /*
   * The capture `acquire` returns is the one taken while the defect was live AND survived the probe.
   * The geometry from the pre-flatten frame is reused because flattening does not move the limb, and
   * `fitLimb` would swap in unlit white — destroying the very surface being measured.
   */
  void geometry;
  return {
    img: result.frame,
    frame,
    verdict: evaluateTerminator(result.frame, frame.sunCam),
    probeAlive: result.probe?.alive ?? false,
  };
}

/**
 * Restore the textured surface and PROVE it — reloading if the in-place restore did not take.
 *
 * Why a reload is in the contract rather than a nice-to-have. `fitLimb` swaps the surface material for
 * unlit white, `setLayers` re-renders React and R3F rebuilds materials, and a rebuild that happens
 * after the restore loop leaves a fresh material carrying whatever the last write put on it. Three
 * attempts at an in-place restore (per-instance snapshots, a live `saved` array, a pristine record)
 * each closed one ordering and left another open — measured as `map=false emissiveMap=false` after
 * uninstall.
 *
 * A navigation is the only state that cannot be half-restored, and the probe's integrity matters more
 * than its runtime: a leaked flatten would make every later 3.4 measurement describe a sphere the
 * product never renders. The reload is REPORTED, so a reader can see it was needed and how often.
 *
 * @returns true when the restore held without a reload
 */
export async function assertSurfaceRestored(page: Page): Promise<boolean> {
  await setLayers(page, TERMINATOR_FLAGS);
  const read = async () =>
    page.evaluate(() => {
      let out = { hasMap: false, hasEmissiveMap: false, type: null as string | null };
      (window.__scene as { traverse(fn: (o: unknown) => void): void }).traverse((o) => {
        const m = o as { isMesh?: boolean; material?: { type?: string; map?: unknown; emissiveMap?: unknown } };
        if (!m.isMesh || m.material?.type !== 'MeshPhysicalMaterial') return;
        out = {
          hasMap: m.material.map !== null && m.material.map !== undefined,
          hasEmissiveMap: m.material.emissiveMap !== null && m.material.emissiveMap !== undefined,
          type: m.material.type ?? null,
        };
      });
      return out;
    });

  const state = await read();
  if (state.hasMap && state.hasEmissiveMap) return true;

  // The in-place restore did not hold. Reload rather than measure a flattened globe.
  console.warn(
    `[flat] in-place restore did not hold (${state.type}: map=${state.hasMap} ` +
      `emissiveMap=${state.hasEmissiveMap}) — reloading to guarantee a clean surface`,
  );
  await openGlobe(page);
  // A navigation discards `window.__defects` (it is page state, not app state). Re-install it or
  // every subsequent acquire() fails with "defect engine is not installed on this page".
  await installDefectEngine(page);
  const after = await read();
  if (!after.hasMap || !after.hasEmissiveMap) {
    throw new Error(
      `the surface is still flattened AFTER a reload (${after.type}: map=${after.hasMap} ` +
        `emissiveMap=${after.hasEmissiveMap}) — the probe cannot continue safely`,
    );
  }
  return false;
}

/** One capture of the REAL surface at an azimuth, for the side-by-side curves. */
export async function acquireRealFrame(page: Page, azimuthDeg: number) {
  const frame = await acquireTerminatorFrame(page, azimuthDeg);
  return { img: frame.img, frame, verdict: evaluateTerminator(frame.img, frame.sunCam) };
}

/** Re-exported so a spec does not need to import from three modules for one capture. */
export { capture };
