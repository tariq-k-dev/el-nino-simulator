/**
 * Browser-side capture helpers for the look specs.
 *
 * The pure maths lives in `src/lib/look/helpers.ts` (and is unit-tested there).
 * This module is the part that needs a page: hiding chrome, taking a
 * deterministic canvas capture, and reading `__globe` / `__look`.
 *
 * ## Why hiding chrome is not optional
 *
 * `locator.screenshot()` on the canvas does NOT capture the canvas alone — it is a
 * viewport screenshot clipped to the element's box, so DOM positioned over the
 * canvas is composited in. The EngineBadge sits at the top right with `bottom: 68`
 * and its text changes as DuckDB boots, which put a 10 px band of differences at
 * y 41-50 into a star-field comparison and looked exactly like a non-deterministic
 * sky. Measured: 368 of 1240 differing pixels were inside that band.
 */
import { expect, type Page } from '@playwright/test';
// Relative on purpose: tsconfig.node.json (which owns tests/e2e) has no `@/*`
// path mapping, so an alias here fails to resolve while the app tsconfig compiles.
import { decodePng, edgeCrossing, fitCircle, type Bitmap, type DiscGeometry } from '../../../src/lib/look/helpers';

export const VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * Hide everything that is not on the canvas' ancestor chain.
 *
 * Version-proof against new panels: anything between `body` and the canvas stays,
 * everything else is hidden for the duration of the capture. Idempotent.
 */
export async function hideChrome(page: Page): Promise<void> {
  await page.evaluate(() => {
    const canvas = document.querySelector('#globe-canvas canvas');
    if (!canvas) return;
    const chain = new Set<Node>();
    let n: Node | null = canvas;
    while (n) {
      chain.add(n);
      n = n.parentElement;
    }
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      if (chain.has(el)) continue;
      el.style.visibility = 'hidden';
    }
    // Suppress the cursor-following halo and the boot veil's transition, both of
    // which can repaint between two captures.
    document.documentElement.style.cursor = 'none';
  });
}

/** Wait two animation frames, so a state change has certainly been drawn. */
export async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

/**
 * Capture the canvas with chrome hidden.
 *
 * Returns a decoded RGBA bitmap at CSS-pixel resolution (viewport DPR is 1 in the
 * desktop context), so a screenshot pixel is one CSS pixel and can be compared
 * directly against `__globe.project()` output.
 */
export async function capture(page: Page): Promise<Bitmap> {
  await hideChrome(page);
  await twoFrames(page);
  const buf = await page.locator('#globe-canvas canvas').screenshot({ type: 'png' });
  return decodePng(buf);
}

/** Disc geometry in CSS pixels, with the probe read as the authority. */
export async function disc(page: Page): Promise<DiscGeometry> {
  const [c, r] = await Promise.all([
    page.evaluate(() => window.__globe!.project()),
    page.evaluate(() => window.__globe!.discRadiusPx()),
  ]);
  return { cx: c.x, cy: c.y, r };
}

/**
 * Park the scene at a fixed azimuth with the clock and spin pinned, then wait for
 * the frame.
 *
 * `__look.setAzimuth` also freezes the planet at longitude 0 and stops the scene
 * clock, which is what makes a capture the same scene on every load. Doing that
 * here rather than in each spec means a spec cannot forget.
 */
export async function settleAt(page: Page, azimuthDeg: number): Promise<void> {
  await page.evaluate((d) => window.__look!.setAzimuth(d), azimuthDeg);
  await twoFrames(page);
}

export interface LayerState {
  stars: boolean;
  rings: boolean;
  atmosphere: boolean;
  clouds: boolean;
  pins: boolean;
  bloom: boolean;
}

/** Set layer flags and wait for the change to be drawn. */
export async function setLayers(page: Page, patch: Partial<LayerState>): Promise<void> {
  await page.evaluate((p) => window.__look!.set(p), patch);
  await twoFrames(page);
}

/** All layers on — the approved look. */
export const ALL_LAYERS: LayerState = {
  stars: true,
  rings: true,
  atmosphere: true,
  clouds: true,
  pins: true,
  bloom: true,
};

/** Load `/?debug`, wait for the probes, set the viewport. */
export async function openGlobe(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await page.goto('/?debug');
  await expect
    .poll(() => page.evaluate(() => !!window.__globe && !!window.__look), { timeout: 90_000 })
    .toBe(true);
  await hideChrome(page);
}

/**
 * Frame-to-frame noise: two captures of an unchanged scene.
 *
 * Every noise-sensitive check reports this, because "the value changed" is
 * meaningless without knowing how much an unchanged scene moves. A pulse
 * somewhere in the scene can produce a 66-unit swing at a ring radius, which is
 * larger than several real signals.
 */
export async function frameNoise(
  page: Page,
): Promise<{ meanAbs: number; maxAbs: number; a: Bitmap; b: Bitmap }> {
  const a = await capture(page);
  await twoFrames(page);
  const b = await capture(page);
  let sum = 0;
  let maxAbs = 0;
  const n = Math.min(a.width * a.height, b.width * b.height);
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    const la = 0.2126 * a.data[o] + 0.7152 * a.data[o + 1] + 0.0722 * a.data[o + 2];
    const lb = 0.2126 * b.data[o] + 0.7152 * b.data[o + 1] + 0.0722 * b.data[o + 2];
    const d = Math.abs(la - lb);
    sum += d;
    if (d > maxAbs) maxAbs = d;
  }
  return { meanAbs: n ? sum / n : NaN, maxAbs, a, b };
}

/** Sun direction and camera position, for the analytic helpers. */
export async function sunAndCamera(
  page: Page,
): Promise<{ sun: [number, number, number]; cam: [number, number, number] }> {
  return page.evaluate(() => {
    // The sun's world direction is the key light's position, normalised.
    let pos: [number, number, number] = [0.72, 0.36, 0.59];
    const scene = window.__scene as { traverse?: (fn: (o: unknown) => void) => void } | undefined;
    scene?.traverse?.((o) => {
      const light = o as { isDirectionalLight?: boolean; intensity?: number; position?: { x: number; y: number; z: number } };
      if (light.isDirectionalLight && (light.intensity ?? 0) > 1 && light.position) {
        pos = [light.position.x, light.position.y, light.position.z];
      }
    });
    const n = Math.hypot(pos[0], pos[1], pos[2]) || 1;
    const cam = window.__camera as { position: { x: number; y: number; z: number } };
    return {
      sun: [pos[0] / n, pos[1] / n, pos[2] / n] as [number, number, number],
      cam: [cam.position.x, cam.position.y, cam.position.z] as [number, number, number],
    };
  });
}

/**
 * Scene numbers the limb arithmetic needs, read live from the camera.
 *
 * `fov` is three's VERTICAL fov and `height` is the canvas' CSS height, which is
 * exactly what `focalPxFromFov` expects. Read rather than hard-coded: the 1024x768
 * case moves both.
 */
export async function cameraGeometry(page: Page): Promise<{
  fov: number;
  height: number;
  width: number;
  distance: number;
  radius: number;
}> {
  return page.evaluate(() => {
    const cam = window.__camera as { fov: number };
    const canvas = document.querySelector('#globe-canvas canvas') as HTMLCanvasElement;
    return {
      fov: cam.fov,
      height: canvas.clientHeight,
      width: canvas.clientWidth,
      distance: window.__globe!.distance(),
      radius: 1, // EARTH_RADIUS in scene units
    };
  });
}

export interface LimbFit {
  cx: number;
  cy: number;
  r: number;
  /** RMS of |P-C| - r over the accepted rays, px. */
  rms: number;
  /** Rays that produced a usable crossing. */
  rays: number;
  /** Rays that produced none (reported, never silently dropped). */
  misses: number;
}

/**
 * Ground-truth limb: fit a circle to the rendered edge at 360 rays, sub-pixel.
 *
 * Why this exists: `__globe.discRadiusPx()` and the visible limb disagreed by ~3 px,
 * and every disc-relative rule (the rim origin, the probe windows, "keep expecting
 * deeper rise") inherits that error. Fitting the edge in the actual pixels is the
 * only way to settle which number is right.
 *
 * The scene is reduced to a single unlit white sphere before the capture:
 *
 *  - atmosphere, clouds, pins, rings and stars OFF, because the atmosphere shell is
 *    a 1.1 R additive annulus whose glow IS the thing that makes a "luma edge" fuzzy,
 *    and pins/rings/stars are bright objects on or beyond the limb;
 *  - the surface material swapped for flat unlit white via `__look.surfaceWhite`.
 *    A lit sphere has a terminator and a specular gradient, so its luma edge is only
 *    crisp on the day side — a 360-ray fit over a lit sphere measures TWO different
 *    edges and averages them.
 *
 * The material and the layer flags are restored before returning, so a failing fit
 * cannot leave the scene white for the next spec.
 */
export async function fitLimb(
  page: Page,
  { rays = 360, span = 14 }: { rays?: number; span?: number } = {},
): Promise<LimbFit> {
  await setLayers(page, { atmosphere: false, pins: false, clouds: false, stars: false, rings: false });
  /*
   * Wait for the surface mesh to exist before swapping it.
   *
   * `__look` and `__globe` are installed in `onCreated`, which runs before the
   * textured <Globe> finishes suspending — so at the moment `openGlobe()` returns,
   * `scene.traverse` finds ZERO meshes and the swap silently returns false. This
   * poll is the difference between "the fit works" and "the fit throws on a
   * half-constructed scene", which is a flake with an obvious cause.
   */
  await expect
    .poll(() => page.evaluate(() => window.__look!.surfaceReady()), { timeout: 60_000 })
    .toBe(true);
  const swapped = await page.evaluate(() => window.__look!.surfaceWhite(true));
  if (!swapped) throw new Error('fitLimb: surface exists but the white swap failed');
  await twoFrames(page);

  try {
    const img = await capture(page);
    const centre = await page.evaluate(() => window.__globe!.project());
    const rGuess = await page.evaluate(() => window.__globe!.discRadiusPx());

    const points: Array<[number, number]> = [];
    let misses = 0;
    for (let i = 0; i < rays; i += 1) {
      const th = (i / rays) * Math.PI * 2;
      const e = edgeCrossing(img, centre.x, centre.y, th, rGuess, span);
      if (!e) {
        misses += 1;
        continue;
      }
      points.push([centre.x + Math.cos(th) * e.radius, centre.y + Math.sin(th) * e.radius]);
    }

    const fit = fitCircle(points);
    if (!fit) {
      return { cx: NaN, cy: NaN, r: NaN, rms: NaN, rays: points.length, misses };
    }
    return { cx: fit.cx, cy: fit.cy, r: fit.r, rms: fit.rms, rays: fit.n, misses };
  } finally {
    await page.evaluate(() => window.__look!.surfaceWhite(false));
    await setLayers(page, ALL_LAYERS);
    await twoFrames(page);
  }
}
