/**
 * The reference frame — ASSERT-ONLY by default.
 *
 * Two tests, and the **default run never writes the PNG**:
 *
 *  1. `in-page determinism` — two captures of the reference pose in one page must be exactly
 *     equal. This is the gate that has to be trusted before the file means anything.
 *  2. `matches the committed frame` — one capture compared to the committed PNG, exactly.
 *
 * The PNG is written ONLY when `UPDATE_REF=1` is set, and the write happens in its own test so a
 * run that regenerates cannot also be the run that certifies the result. Generation and verification
 * are deliberately different processes: B3.4 verifies in three separate runner processes.
 *
 * ## No tolerance anywhere
 *
 * Every assertion is `toBe(0)` / `toBe(true)` on exact values. `compareExact` takes no tolerance
 * argument and neither does anything it calls. If the reference starts drifting, the correct response
 * is to find out what moved, not to widen a number.
 *
 * ## Why the cross-load pair is not asserted here
 *
 * It was in an earlier draft of the N10 collector and it fired at 0.7152 luma / 221 px inside the
 * real `negative.spec` process. That number is **not explained** and is **not** covered by the D8
 * matrix (which found exact zeros on fresh contexts only). Rather than assert a strict-0 cross-load
 * rule here on evidence that contradicts it, this spec asserts what it can defend from the committed
 * file, and the three-process verification in B3.4 is what proves cross-process reproducibility.
 * See docs/globe-look/SPEC.md §5.5 and docs/STEP3-DIAG.md.
 *
 * Run (writes the committed file — never the default):
 *   UPDATE_REF=1 pnpm e2e:raw -- tests/e2e/ref.spec.ts
 * Verify only:
 *   pnpm e2e:raw -- tests/e2e/ref.spec.ts
 */
import { test, expect } from './fixtures';
import {
  MAX_REFERENCE_BYTES,
  REFERENCE_PATH,
  captureReference,
  compareExact,
  readReference,
  writeReference,
} from './look/reference';
import { settleReferencePose } from './look/reference';
import { capture } from './look/capture';

const WRITE = process.env.UPDATE_REF === '1';

test.describe('reference frame', () => {
  test.setTimeout(240_000);

  test('in-page determinism: two captures of the reference pose are exactly equal', async ({
    page,
  }) => {
    const t0 = Date.now();
    const first = await captureReference(page);
    const elapsedFirst = Date.now() - t0;

    // Second capture in the SAME page, through the same pose helper — the only variable is the frame.
    await settleReferencePose(page);
    const secondFull = await capture(page);

    const cmp = compareExact(first.full, secondFull);
    console.log(
      `[ref] in-page maxAbs=${cmp.maxAbs} differing=${cmp.differing} over1=${cmp.differingOver1} ` +
        `maxChannel=${cmp.maxChannelAbs} perChannelExact=${cmp.perChannelExact} ` +
        `at=${JSON.stringify(cmp.maxAbsAt)} | first acquisition ${elapsedFirst} ms`,
    );
    console.log(
      `[ref] crop ${first.rect.width}x${first.rect.height} at (${first.rect.x},${first.rect.y}) ` +
        `${(first.png.byteLength / 1024).toFixed(1)} KB (budget ${MAX_REFERENCE_BYTES / 1024} KB) ` +
        `sha256=${first.sha256}`,
    );

    expect(cmp.maxAbs, `the reference pose is not deterministic in-page: max |dLuma| ${cmp.maxAbs}`).toBe(0);
    expect(cmp.differing, `in-page differing pixels: ${cmp.differing}`).toBe(0);
    expect(cmp.perChannelExact, 'in-page frames differ at the channel level').toBe(true);
  });

  test('matches the committed frame pixel for pixel', async ({ page }) => {
    const ref = await captureReference(page);

    if (WRITE) {
      const file = await writeReference(ref.png);
      console.log(
        `[ref] WROTE ${file} — ${ref.png.byteLength} bytes, ${(ref.png.byteLength / 1024).toFixed(1)} KB, ` +
          `sha256=${ref.sha256}`,
      );
      // Generation is not verification: a write run records the file and stops.
      return;
    }

    const committed = await readReference();
    expect(
      [committed.width, committed.height],
      `the committed ${REFERENCE_PATH} is ${committed.width}x${committed.height} but this capture is ` +
        `${ref.crop.width}x${ref.crop.height} — the reference is recorded at 1280x800`,
    ).toEqual([ref.crop.width, ref.crop.height]);

    const cmp = compareExact(committed, ref.crop);
    console.log(
      `[ref] vs committed maxAbs=${cmp.maxAbs} differing=${cmp.differing} over1=${cmp.differingOver1} ` +
        `maxChannel=${cmp.maxChannelAbs} perChannelExact=${cmp.perChannelExact} ` +
        `at=${JSON.stringify(cmp.maxAbsAt)} capture sha256=${ref.sha256}`,
    );

    expect(cmp.maxAbs, `content differs from ${REFERENCE_PATH}: max |dLuma| ${cmp.maxAbs}`).toBe(0);
    expect(cmp.differing, `pixels differing from ${REFERENCE_PATH}: ${cmp.differing}`).toBe(0);
    expect(cmp.perChannelExact, `channel values differ from ${REFERENCE_PATH}`).toBe(true);
  });
});
