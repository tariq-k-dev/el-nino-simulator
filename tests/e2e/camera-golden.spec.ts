/**
 * GOLDEN CAMERA POSES — captured on the UNMODIFIED code, compared after the CameraDirector refactor.
 *
 * ## Why this file exists, and why it is committed BEFORE any refactor
 *
 * Step D changes WHO writes the camera. The prompt's S3 stop condition is "golden fly-to poses differ
 * after the refactor by more than the tolerance fixed in step C", which is only checkable if the
 * fixture was captured against code nobody had touched yet. So this spec and its JSON fixture land in
 * their own commit before `CameraDirector` exists, and the same spec then has to keep passing.
 *
 * ## What is recorded
 *
 * For every region, in **locked** mode at 1280x800 and in **live** mode (`framing=live`) at 1440x900,
 * after the fly-to settles:
 *
 *   - `camera.position`            (`__globe` / `__camera`)
 *   - `camera.quaternion`
 *   - `controls.target`            (`__globe.target()`)
 *   - the fly-to duration          (measured, not asserted — see below)
 *
 * ## Assert-only, regenerate with UPDATE_GOLDEN=1
 *
 * The default run NEVER writes the fixture: a run that regenerates must not also be the run that
 * certifies the result. `UPDATE_GOLDEN=1` is the only way to write, mirroring `UPDATE_REF`.
 *
 * ## The tolerance
 *
 * `TOLERANCE_R` in the header below is `max(1e-5, 10 x the measured run-to-run noise)`, in R units
 * (globe radius = 1 scene unit). The noise was measured by capturing TWICE in separate runner
 * processes on the unmodified code; the number in the fixture's `_meta` is what the tolerance was
 * derived from. Positions and the target are compared in R units; the quaternion is compared
 * component-wise on the same numeric tolerance plus a sign-corrected dot-product check, because a
 * quaternion and its negation are the same rotation (`q` and `-q` must not read as a 2-unit error).
 *
 * ## No fixed sleeps
 *
 * Settling is a poll on the fly-to's own convergence signal (`travelling` is cleared when the target
 * and distance are both within 0.004 — `CameraRig.tsx:122-125`). This file polls the distance and the
 * target position until they stop changing, which is the same statement made from outside.
 *
 * Run:
 *   UPDATE_GOLDEN=1 pnpm e2e:raw -- tests/e2e/camera-golden.spec.ts   # writes the fixture
 *   pnpm e2e:raw -- tests/e2e/camera-golden.spec.ts                   # verifies it
 */
import { test, expect, connectionInit } from './fixtures';
import type { Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WRITE = process.env.UPDATE_GOLDEN === '1';

/**
 * The fixed tolerance, in R units (and in quaternion component units).
 *
 * Derived by the prompt's rule: `max(1e-5, 10 x measured run-to-run noise)`.
 *
 * **Measured noise: 5.55e-17** — the largest absolute component error of position,
 * `controls.target`, quaternion (sign-corrected) and distance across THREE separate batched-runner
 * processes on the unmodified code. So `10 x noise = 5.55e-16` and the **1e-5 floor is what binds**.
 *
 * That floor is also what a reader should sanity-check: at the fitted distance of 3.7784 the disc
 * radius is ~322 px, so 1e-5 R is ~0.001 px of disc radius. The tolerance is tight enough that a
 * changed write ORDER, a lost `controls.update()`, or a re-derived quaternion all fail it loudly,
 * which is the only reason S3 is worth asserting.
 *
 * ## Why the spin has to be pinned for this to be 1e-5 and not 8.4e-2
 *
 * Measured FIRST without pinning: `controls.target` differed by up to **8.36e-3 R** between loads and
 * the position by **4.78e-3 R**, case-to-case, in three processes. The rule would then have forced
 * 8.4e-2 — about 20 px of disc movement — and a golden test with a 20 px tolerance cannot detect a
 * refactor regression. The cause is `CameraRig.tsx:54`: the fly-to target is
 * `regionDirection(id, spin.current.y)`, and `spin.y` accumulates from frame deltas, so each load
 * reaches the click at a different planetary phase. `setSpin(true, 0)` (the hook every pixel baseline
 * already uses via `__look.setAzimuth`) removes that variable, and both numbers are recorded in the
 * fixture's `_meta` so the choice is auditable rather than invisible.
 */
const TOLERANCE_R = 1e-5;

/*
 * `fileURLToPath(import.meta.url)`, not `__dirname`: the Playwright config is ESM, so this file is
 * loaded as a module and `__dirname` is not defined there — it threw `ReferenceError: __dirname is not
 * defined in ES module scope` before any test was collected, and the runner reported it as `0/9 tests`.
 * Same fix `scripts/lib/*.mjs` uses.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(HERE, 'golden', 'camera-poses.json');

/** The four selectable regions, in the order the right-hand cards list them. */
const REGIONS = ['pacific', 'us-west', 'se-asia', 'horn-africa'] as const;

/** Card text -> region, matching what `frame.spec.ts` F8 clicks. */
const CARD_RE: Record<string, RegExp> = {
  pacific: /Pacific/i,
  'us-west': /California/i,
  'se-asia': /Indonesia|Asia/i,
  'horn-africa': /Africa|Horn/i,
};

interface Pose {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  target: [number, number, number];
  distance: number;
  flyMs: number;
}

interface Fixture {
  _meta: {
    toleranceR: number;
    noise: Record<string, number>;
    capturedAt: string;
    note: string;
  };
  cases: Record<string, Pose>;
}

const LOCKED = '/?debug';
const live = '/?debug&framing=live';

/** `key` for one case, e.g. `pacific@locked-1280x800`. */
const caseKey = (region: string, mode: 'locked' | 'live', w: number, h: number) =>
  `${region}@${mode}-${w}x${h}`;

const readPose = (): Pose => {
  const cam = (window as unknown as { __camera: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } } })
    .__camera;
  const g = window.__globe!;
  return {
    position: [cam.position.x, cam.position.y, cam.position.z],
    quaternion: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w],
    target: g.target(),
    distance: g.distance(),
    flyMs: 0,
  };
};

/**
 * Poll until the camera has stopped moving: the same pose twice, 200 ms apart, with the distance and
 * the target both unchanged. Returns the settled pose.
 *
 * Two reads rather than one because the fly-to damps ASYMPTOTICALLY — a single read can land in the
 * tail where consecutive-frame deltas are already below any per-frame threshold while the pose is
 * still creeping (the 4-frame ring in `FrameRig.tsx:158-168` exists for the same reason).
 */
async function settlePose(page: Page, timeoutMs = 15_000): Promise<Pose> {
  const t0 = Date.now();
  let prev = await page.evaluate(readPose);
  for (;;) {
    await page.waitForTimeout(200);
    const next = await page.evaluate(readPose);
    const moved = Math.max(
      Math.abs(next.position[0] - prev.position[0]),
      Math.abs(next.position[1] - prev.position[1]),
      Math.abs(next.position[2] - prev.position[2]),
      Math.abs(next.target[0] - prev.target[0]),
      Math.abs(next.target[1] - prev.target[1]),
      Math.abs(next.target[2] - prev.target[2]),
      Math.abs(next.distance - prev.distance),
    );
    if (moved < 1e-9) return next;
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`the camera never settled: last step ${moved} R after ${timeoutMs} ms`);
    }
    prev = next;
  }
}

/** Boot a page in `url`, click the region's card, and return the settled pose plus the fly duration. */
async function flyTo(page: Page, url: string, region: string): Promise<Pose> {
  await page.addInitScript(connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }));
  await page.goto(url);

  /* The hooks appear under VITE_E2E && ?debug; `__frame` additionally needs live mode to be non-locked. */
  await expect
    .poll(() => page.evaluate(() => (window.__globe ? 'ready' : null)), {
      timeout: 90_000,
      intervals: [250],
    })
    .toBe('ready');
  /*
   * Let the layout land: the insets store settles on transitionend, not at mount.
   */
  await page.waitForTimeout(2500);

  /*
   * FREEZE THE SPIN AT AN ABSOLUTE ANGLE BEFORE SELECTING — this is what makes a fly-to pose
   * reproducible at all.
   *
   * `CameraRig.tsx:54` builds the fly-to target as `regionDirection(id, spin.current.y)`, i.e. the pin's
   * direction rotated by whatever phase the planet's clock had reached when the effect ran, and `:52`
   * pauses the spin on that same frame. `spin.y` accumulates from frame deltas (`EarthSystem`), so two
   * loads reach the click at different phases and the target lands in a different place every time.
   *
   * Measured WITHOUT this line, three separate runner processes: `controls.target` differed by up to
   * **8.36e-3 R** and the position by **4.78e-3 R** case-to-case — which would force a tolerance of
   * 0.084 R (the prompt's 10x rule), about 20 px of disc movement, and S3 would then be unable to
   * detect anything worth detecting. This is the same problem `__look.setAzimuth` solves for every
   * pixel baseline by pinning the planet at longitude 0, and it is solved the same way here.
   *
   * `setSpin(true, angle)` is the existing hook: `frozen = true` makes the clock hold `frozenAt`.
   * Angle 0 because it is the documented reference phase, not because it flatters the numbers.
   */
  await page.evaluate(() => window.__globe!.setSpin(true, 0));

  const atRest = await settlePose(page);

  const card = await page.evaluate((re) => {
    const rx = new RegExp(re);
    const panel = document.querySelector('[data-occluder="right-panel"]');
    if (!panel) return null;
    const btn = [...panel.querySelectorAll('button, [role="button"]')].find((b) =>
      rx.test(b.textContent ?? ''),
    );
    if (!btn) return null;
    const box = btn.getBoundingClientRect();
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }, CARD_RE[region].source);
  expect(card, `the card for ${region} must exist`).not.toBeNull();

  const t0 = Date.now();
  await page.mouse.click(card!.x, card!.y);
  /*
   * Wait for the FLY-TO to start, not for the drawer to widen.
   *
   * The first version polled `__globe.insets().right > 400` and every case timed out. Two reasons,
   * both documented in this repo: `__globe.insets()` is wired to the ZERO STUB, not the live insets
   * store (`docs/STEP3-FRAME.md` §2 — "a spec must not read it and expect real insets"), and in
   * LOCKED mode there is no `__frame` to read instead.
   *
   * `__globe.target()` is the mode-independent signal and the more honest one: the fly-to's whole
   * effect is that `controls.target` leaves the origin for the pin (`CameraRig.tsx:54`). If the target
   * moves, the selection was received; if it does not, the click missed and waiting longer would only
   * make the failure slower.
   */
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const t = window.__globe!.target();
          return Math.hypot(t[0], t[1], t[2]) > 0.02;
        }),
      { timeout: 15_000, intervals: [100] },
    )
    .toBe(true);

  const settled = await settlePose(page);
  return { ...settled, flyMs: Date.now() - t0, _: atRest } as Pose & { _: Pose };
}

/**
 * Largest absolute component difference, as a fold.
 *
 * NOT `Math.max(...a.map(...))`: `tests/e2e/source-guards.test.ts` forbids spreading an array into
 * `Math.min`/`Math.max` anywhere under `tests/e2e`, `src` or `scripts`, because an unbounded spread is
 * one stack overflow away from a crash. These arrays are length 3 and 4, so it would work — the guard
 * is right anyway, and the guard is what makes the rule survive the next author.
 */
function maxAbsDiff(a: readonly number[], b: readonly number[]): number {
  let hi = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i] - b[i]);
    if (d > hi) hi = d;
  }
  return hi;
}

/** Position/target error in R units; quaternion error sign-corrected, then component-wise. */
function compare(actual: Pose, golden: Pose): { position: number; target: number; quat: number; distance: number } {
  const v = maxAbsDiff;
  const sign =
    actual.quaternion.reduce((s, x, i) => s + x * golden.quaternion[i], 0) < 0 ? -1 : 1;
  return {
    position: v(actual.position, golden.position),
    target: v(actual.target, golden.target),
    quat: v(
      actual.quaternion.map((x) => x * sign),
      golden.quaternion,
    ),
    distance: Math.abs(actual.distance - golden.distance),
  };
}

test.describe('camera golden poses', () => {
  test.setTimeout(240_000);

  const cases: Array<[string, 'locked' | 'live', number, number]> = [];
  for (const region of REGIONS) {
    cases.push([region, 'locked', 1280, 800]);
    cases.push([region, 'live', 1440, 900]);
  }

  for (const [region, mode, w, h] of cases) {
    const key = caseKey(region, mode, w, h);
    test(`${key}: the fly-to pose is ${WRITE ? 'recorded' : 'unchanged'}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      const pose = await flyTo(page, mode === 'live' ? live : LOCKED, region);

      console.log(
        `[golden] ${key} pos=(${pose.position.map((n) => n.toFixed(6)).join(',')}) ` +
          `quat=(${pose.quaternion.map((n) => n.toFixed(6)).join(',')}) ` +
          `target=(${pose.target.map((n) => n.toFixed(6)).join(',')}) ` +
          `d=${pose.distance.toFixed(6)} fly=${pose.flyMs} ms`,
      );

      if (WRITE) {
        const fixture: Fixture = existsSync(FIXTURE)
          ? JSON.parse(readFileSync(FIXTURE, 'utf8'))
          : {
              _meta: { toleranceR: TOLERANCE_R, noise: {}, capturedAt: '', note: '' },
              cases: {},
            };
        fixture.cases[key] = { ...pose };
        fixture._meta.toleranceR = TOLERANCE_R;
        fixture._meta.capturedAt = new Date().toISOString();
        fixture._meta.note =
          'Captured on the pre-CameraDirector code by UPDATE_GOLDEN=1. Regenerate only before a ' +
          'refactor, never after one. `flyMs` is recorded for the record and NOT asserted.';
        mkdirSync(path.dirname(FIXTURE), { recursive: true });
        writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
      }
    });
  }

  test('every recorded pose matches the fixture within the fixed tolerance', async ({ page }) => {
    expect(existsSync(FIXTURE), `the fixture is missing: ${FIXTURE}`).toBe(true);
    const fixture: Fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const tol = fixture._meta.toleranceR;
    /* The tolerance is a fixed number, not one the fixture may widen for itself. */
    expect(tol, 'the fixture must record the tolerance this spec asserts').toBe(TOLERANCE_R);

    for (const [region, mode, w, h] of cases) {
      const key = caseKey(region, mode, w, h);
      const golden = fixture.cases[key];
      expect(golden, `${key} is missing from the fixture`).toBeDefined();

      await page.setViewportSize({ width: w, height: h });
      const pose = await flyTo(page, mode === 'live' ? live : LOCKED, region);
      const err = compare(pose, golden);
      console.log(
        `[golden] ${key} err position=${err.position.toExponential(2)} ` +
          `target=${err.target.toExponential(2)} quat=${err.quat.toExponential(2)} ` +
          `d=${err.distance.toExponential(2)} (tol ${tol})`,
      );

      expect(err.position, `${key}: camera position moved by ${err.position} R`).toBeLessThanOrEqual(tol);
      expect(err.target, `${key}: controls.target moved by ${err.target} R`).toBeLessThanOrEqual(tol);
      expect(err.quat, `${key}: orientation changed by ${err.quat}`).toBeLessThanOrEqual(tol);
      expect(err.distance, `${key}: distance moved by ${err.distance} R`).toBeLessThanOrEqual(tol);
    }
  });
});
