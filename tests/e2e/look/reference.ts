/**
 * The reference frame — one committed PNG of the shipped look, and the strict-0 comparison.
 *
 * ## Acquisition path (load-bearing)
 *
 * The pose is the shipped look with **both uTime gates applied** (`look.animate === false`, so the
 * atmosphere breathe and the pin ring pulse are frozen at `FROZEN_LOOK_TIME = 0`): 1280x800, az 0,
 * seeded starfield, hotspot rings OFF. This is the "ref arm" path — `settleAt` + `setLayers` +
 * `capture`, with **no `fitLimb` material swap**. The swap is what the N10 path adds, and it is the
 * remaining suspect for the 0.7152-luma jitter, so the baseline deliberately keeps the simpler path.
 *
 * ## Strict 0, no tolerance, and no parameter that could become one
 *
 * `compareExact` returns `maxAbs`, `differing` and a **per-channel** verdict. The spec asserts
 * `maxAbs === 0`, `differing === 0` and `perChannelExact === true`. There is no tolerance argument
 * anywhere in this file or in `ref.spec.ts`, on purpose: a tolerance on a determinism check hides
 * exactly the class of bug it exists to catch, and the first thing a future reader does with a
 * tolerance parameter is raise it.
 *
 * ## Size budget — 800 KB, not 300 KB, and why
 *
 * The original brief set 300 KB against a whole-canvas capture (~257 KB here). The required crop is
 * the disc plus 40 px = 732x732, and cropping to it *raises* the encoded size to ~680 KB: the crop
 * discards the large, near-black, cheap-to-compress sky that dominated the full frame, and a
 * post-processed frame is per-pixel noise that deflate cannot model. Measured at 732x732: default
 * settings 680.2 KB, colorType 2 680.2 KB, deflateLevel 9 680.2 KB, filterType 4 667.4 KB,
 * deflateStrategy 0 545.1 KB — no pngjs setting reaches 300 KB. Tariq approved raising the budget to
 * **800 KB** rather than lowering quality or shrinking the crop. Encoding stays **lossless PNG**: a
 * lossy baseline cannot support an exact-0 rule.
 */
import { expect, type Page } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PNG } from 'pngjs';
import { decodePng, type Bitmap } from '../../../src/lib/look/helpers';
import { capture, openGlobe, setLayers, settleAt, twoFrames } from './capture';

/** Where the committed reference lives. Relative to the repo root. */
export const REFERENCE_PATH = 'tests/e2e/ref/default-1280x800.png';

/** Padding around the fitted disc, in CSS px. */
export const CROP_MARGIN_PX = 40;

/** The committed reference must stay reviewable in a diff. Raised from 300 KB by Tariq — see header. */
export const MAX_REFERENCE_BYTES = 800 * 1024;

/** A crop rectangle in the source bitmap's CSS-pixel coordinates. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Exact comparison result.
 *
 * `perChannelExact` is computed rather than inferred from `maxAbs`: luma is a weighted sum, so two
 * frames can differ by 1/255 in one channel and still round to identical luma — the "303 differing
 * pixels, 0 luma difference" case already documented in `glint.ts`. A reference frame that claimed
 * exactness on luma alone would be claiming less than its name says.
 */
export interface ExactComparison {
  /** Largest per-pixel |LumaA - LumaB| over ALL pixels of the crop. */
  maxAbs: number;
  /** Largest per-pixel per-channel absolute difference. */
  maxChannelAbs: number;
  /** Pixels whose luma differs at all. */
  differing: number;
  /** Pixels whose luma differs by more than 1/255. */
  differingOver1: number;
  /** True iff every R, G and B sample is identical. */
  perChannelExact: boolean;
  /** Where the largest absolute luma difference sits. */
  maxAbsAt: [number, number] | null;
}

export interface ReferenceCapture {
  /** The uncropped canvas capture. */
  full: Bitmap;
  /** The cropped region written to disk. */
  crop: Bitmap;
  /** Where the crop came from, in the full capture's coordinates. */
  rect: CropRect;
  /** Encoded PNG bytes of `crop`. */
  png: Buffer;
  /** sha256 of `png`, printed so a run is identifiable in a report. */
  sha256: string;
}

/** Crop `img` to `rect`, clamped to the image. Alpha forced opaque. */
export function cropBitmap(img: Bitmap, rect: CropRect): Bitmap {
  const x0 = Math.max(0, Math.min(img.width - 1, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(img.height - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(img.width - x0, Math.round(rect.width)));
  const h = Math.max(1, Math.min(img.height - y0, Math.round(rect.height)));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const s = ((y0 + y) * img.width + (x0 + x)) * 4;
      const d = (y * w + x) * 4;
      data[d] = img.data[s];
      data[d + 1] = img.data[s + 1];
      data[d + 2] = img.data[s + 2];
      data[d + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** The Rec.709 luma used everywhere else in the look suite. */
const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Exact comparison of two frames — whole crop, no exclusion, no tolerance.
 *
 * Whole-frame on purpose: the reference asks "is this the same picture", so a difference anywhere
 * in the crop — including the sky inside the 40 px margin — is a difference worth failing on.
 */
export function compareExact(a: Bitmap, b: Bitmap): ExactComparison {
  if (a.width !== b.width || a.height !== b.height) {
    // Never let a shape mismatch read as identical.
    return {
      maxAbs: Infinity,
      maxChannelAbs: Infinity,
      differing: Infinity,
      differingOver1: Infinity,
      perChannelExact: false,
      maxAbsAt: null,
    };
  }
  let maxAbs = 0;
  let maxChannelAbs = 0;
  let differing = 0;
  let differingOver1 = 0;
  let perChannelExact = true;
  let maxAbsAt: [number, number] | null = null;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const o = (y * a.width + x) * 4;
      const dR = Math.abs(a.data[o] - b.data[o]);
      const dG = Math.abs(a.data[o + 1] - b.data[o + 1]);
      const dB = Math.abs(a.data[o + 2] - b.data[o + 2]);
      if (dR || dG || dB) perChannelExact = false;
      const mc = Math.max(dR, Math.max(dG, dB));
      if (mc > maxChannelAbs) maxChannelAbs = mc;
      const d = Math.abs(
        luma(a.data[o], a.data[o + 1], a.data[o + 2]) - luma(b.data[o], b.data[o + 1], b.data[o + 2]),
      );
      if (d > maxAbs) {
        maxAbs = d;
        maxAbsAt = [x, y];
      }
      if (d > 0) differing += 1;
      if (d > 1) differingOver1 += 1;
    }
  }
  return { maxAbs, maxChannelAbs, differing, differingOver1, perChannelExact, maxAbsAt };
}

/** Encode a bitmap as a lossless PNG. */
export function encodePng(img: Bitmap): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  for (let i = 0; i < img.width * img.height; i += 1) {
    png.data[i * 4] = img.data[i * 4];
    png.data[i * 4 + 1] = img.data[i * 4 + 1];
    png.data[i * 4 + 2] = img.data[i * 4 + 2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png, { colorType: 6 });
}

/** sha256 of encoded bytes, so a generated baseline can be identified in a report. */
export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * The crop: the globe's projected disc plus `CROP_MARGIN_PX`.
 *
 * Read from `__globe.discRadiusPx()` rather than found by thresholding — the probe already owns
 * "where is the disc", and a second definition would drift from it.
 */
export async function referenceCropRect(page: Page): Promise<CropRect> {
  const [c, r] = await Promise.all([
    page.evaluate(() => window.__globe!.project()),
    page.evaluate(() => window.__globe!.discRadiusPx()),
  ]);
  const canvas = await page.evaluate(() => {
    const el = document.querySelector('#globe-canvas canvas') as HTMLCanvasElement | null;
    return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 };
  });
  const x = Math.max(0, Math.floor(c.x - r - CROP_MARGIN_PX));
  const y = Math.max(0, Math.floor(c.y - r - CROP_MARGIN_PX));
  const width = Math.min(canvas.width - x, Math.ceil(2 * (r + CROP_MARGIN_PX)));
  const height = Math.min(canvas.height - y, Math.ceil(2 * (r + CROP_MARGIN_PX)));
  return { x, y, width, height };
}

/**
 * Settle the reference pose: shipped look, clock frozen, az 0, rings OFF.
 *
 * `settleAt(0)` sets `animate: false`, which is what routes both shader `uTime` writes through
 * `lookTime` and freezes them at 0.
 */
export async function settleReferencePose(page: Page): Promise<void> {
  await setLayers(page, { rings: false });
  await settleAt(page, 0);
  await twoFrames(page);
}

/**
 * Capture the reference frame ONCE in the current page.
 *
 * One capture, not two: the determinism assertions live in the spec, where a failure can name which
 * pair failed. Returning a single frame keeps this function honest about what it did.
 */
export async function captureReference(page: Page): Promise<ReferenceCapture> {
  await openGlobe(page);
  await settleReferencePose(page);
  const rect = await referenceCropRect(page);
  const full = await capture(page);
  const crop = cropBitmap(full, rect);
  const png = encodePng(crop);
  return { full, crop, rect, png, sha256: sha256(png) };
}

/** Read the committed reference. Throws a named error when it is absent. */
export async function readReference(root = process.cwd()): Promise<Bitmap> {
  const file = path.join(root, REFERENCE_PATH);
  let buf: Buffer;
  try {
    buf = await readFile(file);
  } catch {
    throw new Error(
      `reference frame is missing: ${REFERENCE_PATH}. Generate it with ` +
        '`UPDATE_REF=1 pnpm e2e:raw -- tests/e2e/ref.spec.ts` and review the diff before committing.',
    );
  }
  return decodePng(buf);
}

/** Write the reference PNG, after asserting the size budget. Lossless only. */
export async function writeReference(png: Buffer, root = process.cwd()): Promise<string> {
  const file = path.join(root, REFERENCE_PATH);
  expect(
    png.byteLength,
    `reference PNG is ${(png.byteLength / 1024).toFixed(1)} KB, over the ${MAX_REFERENCE_BYTES / 1024} KB ` +
      'budget. Do not reach for a lossy encoder — raise the budget or the crop margin with Tariq.',
  ).toBeLessThanOrEqual(MAX_REFERENCE_BYTES);
  await writeFile(file, png);
  return file;
}
