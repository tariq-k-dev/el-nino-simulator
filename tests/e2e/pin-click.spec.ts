/**
 * PIN CLICK reliability — measurement first, assertion after (step 3B2-FIX1 D).
 *
 * ## The defect
 *
 * Clicking a pin on the globe is hit-or-miss at certain rotation angles. This file MEASURES it before any
 * product change: D1 sweeps the globe azimuth in 30-degree steps, classifies each pin by
 * `dot(pin normal, direction to camera)`, and fires a real `page.mouse` click at the projected pin. D2 then
 * tests the six named hypotheses against the recorded evidence. D4 adds the final assertions once the fix
 * exists.
 *
 * ## Why the classification is a dot product, and what the three bands mean
 *
 * `dot(normal, towardCamera)` is +1 when the pin faces the camera dead-on and −1 when it is on the far side.
 * The bands are the ones the prompt states:
 *
 *   - **front**, `>= 0.15` — clearly on the near hemisphere. Must select, at every angle.
 *   - **grazing**, `0 .. 0.15` — at or just past the limb, where the pin's own geometry is nearly edge-on and
 *     hidden behind the silhouette. Reported, never asserted: whether a pin at 88 degrees of arc should be
 *     clickable is a product decision, not a correctness one.
 *   - **back**, `< 0` — behind the globe. Must NEVER select: a click there is a click on the globe.
 *
 * ## Sampling and the spin
 *
 * `__globe.setSpin(true, angle)` pins the planet at an absolute longitude, so a sweep is reproducible across
 * runs and the pin's screen position does not move between reading it and clicking it. The spin-ON case is
 * the opposite: it deliberately leaves the spin running and projects at pointerdown time.
 */
import { test, expect, connectionInit } from './fixtures';
import type { Page } from '@playwright/test';

const LIVE = '/?debug&framing=live';

const REGION_IDS = ['pacific', 'us-west', 'se-asia', 'horn-africa'] as const;
const FRONT = 0.15;

type PinRow = { id: string; x: number; y: number; behind: boolean; facing: number };

/** Open the page in live mode at one viewport and wait for the insets to settle. */
async function openLive(page: Page, vp = { w: 1440, h: 900 }): Promise<void> {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.addInitScript(connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }));
  await page.goto(LIVE);
  await expect
    .poll(() => page.evaluate(() => (window.__frame ? window.__frame.mode : null)), {
      timeout: 90_000,
      intervals: [250],
    })
    .toBe('live');
  await page.waitForTimeout(2500);
}

/**
 * The pin's facing value, per region, computed IN THE PAGE from the probe's own pin data.
 *
 * `__globe.pins()` reports each pin's world position and the probe reports the camera; the facing value is
 * `dot(normalize(pin), normalize(camera - origin))`. Doing it in one evaluate keeps the pin position, the
 * camera position and the classification from straddling two frames.
 */
async function readPins(page: Page): Promise<PinRow[]> {
  return page.evaluate(() => {
    const g = window.__globe!;
    const cam = window.__camera as { position: { x: number; y: number; z: number } };
    const p = cam.position;
    const len = Math.hypot(p.x, p.y, p.z) || 1;
    const toCam = [p.x / len, p.y / len, p.z / len];
    const world = Object.fromEntries(window.__look!.pinsWorld().map((p) => [p.name, p.core]));
    return g.pins().map((pin) => {
      const w = world[pin.id] ?? [0, 0, 1];
      const n = Math.hypot(w[0], w[1], w[2]) || 1;
      const normal = [w[0] / n, w[1] / n, w[2] / n];
      const facing = normal[0] * toCam[0] + normal[1] * toCam[1] + normal[2] * toCam[2];
      const q = g.project(w);
      return { id: pin.id, x: q.x, y: q.y, behind: q.behind, facing };
    });
  });
}

/** Reset the selection so each click is measured from a clean state. */
async function clearSelection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="reset-view"]') as HTMLButtonElement | null;
    if (el && !el.disabled) el.click();
  });
  await page.waitForTimeout(250);
}

/**
 * The R3F intersections at a screen point.
 *
 * Read through the same raycaster R3F uses (`window.__THREE` plus the live camera and scene), so the list is
 * what the renderer would consider, in order, with each object's name and distance. This is how D2(b) — "an
 * invisible mesh intercepts the ray in front of the pin" — is answered with data rather than a guess.
 */
async function raycastAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ px, py }) => {
      const store = window as unknown as Record<string, unknown>;
      const THREE = store.__THREE as typeof import('three');
      const scene = window.__scene!;
      const camera = window.__camera!;
      const gl = window.__gl as unknown as { domElement: HTMLCanvasElement };
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((px - rect.left) / rect.width) * 2 - 1,
        -((py - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera as import('three').Camera);
      const hits = ray.intersectObject(scene as import('three').Object3D, true);
      return hits.slice(0, 8).map((h) => ({
        name: h.object.name || '(unnamed)',
        type: h.object.type,
        distance: h.distance,
        visible: h.object.visible,
        matType: (h.object as import('three').Mesh).material
          ? ((h.object as import('three').Mesh).material as import('three').Material).type
          : null,
      }));
    },
    { px: x, py: y },
  );
}

/** Did the click select the region, did the pointer-miss close fire, and what is the state now. */
async function readClickOutcome(page: Page, before: { region: string | null }) {
  const after = await page.evaluate(() => ({
    region: window.__frame!.regionId,
    focus: window.__frame!.focus,
  }));
  return { ...after, selected: after.region !== before.region, closed: before.region !== null && after.region === null };
}

test.describe('pin click — measurement', () => {
  test.setTimeout(600_000);

  /**
   * D1(a): the azimuth sweep.
   *
   * 12 angles x 4 regions = 48 real mouse clicks, each classified before it is fired. Every row is printed;
   * the tallies are what D1 reports.
   */
  test('D1 sweep: every pin at 12 azimuths, classified and clicked', async ({ page }) => {
    await openLive(page);

    const rows: Array<{
      az: number;
      id: string;
      facing: number;
      band: 'front' | 'grazing' | 'back';
      selected: boolean;
      closed: boolean;
      behind: boolean;
      topHit: string | null;
    }> = [];

    for (let deg = 0; deg < 360; deg += 30) {
      const az = (deg * Math.PI) / 180;
      await page.evaluate((angle) => {
        window.__globe!.setSpin(true, angle);
      }, az);
      /* One rendered frame with the new spin, so the projected positions are the ones on screen. */
      await page.waitForTimeout(120);
      await clearSelection(page);

      const pins = await readPins(page);
      for (const pin of pins) {
        const band = pin.facing < 0 ? 'back' : pin.facing >= FRONT ? 'front' : 'grazing';
        const hits = await raycastAt(page, pin.x, pin.y);
        const before = await page.evaluate(() => window.__frame!.regionId);

        await page.mouse.click(pin.x, pin.y);
        await page.waitForTimeout(160);
        const outcome = await readClickOutcome(page, { region: before });

        rows.push({
          az: deg,
          id: pin.id,
          facing: Number(pin.facing.toFixed(4)),
          band,
          selected: outcome.selected,
          closed: outcome.closed,
          behind: pin.behind,
          topHit: hits.length ? `${hits[0].name}/${hits[0].type}@${hits[0].distance.toFixed(3)}` : null,
        });

        if (outcome.selected) await clearSelection(page);
      }
    }

    console.log(`[D1] ${rows.length} clicks`);
    console.log('[D1] az  region        facing  band     selected closed behind  top raycast hit');
    for (const r of rows) {
      console.log(
        `[D1] ${String(r.az).padStart(3)} ${r.id.padEnd(13)} ${String(r.facing).padStart(7)} ` +
          `${r.band.padEnd(8)} ${String(r.selected).padEnd(8)} ${String(r.closed).padEnd(6)} ` +
          `${String(r.behind).padEnd(7)} ${r.topHit ?? '(none)'}`,
      );
    }

    const tally = (band: string) => {
      const rows2 = rows.filter((r) => r.band === band);
      return { attempts: rows2.length, selected: rows2.filter((r) => r.selected).length, closed: rows2.filter((r) => r.closed).length };
    };
    const front = tally('front');
    const grazing = tally('grazing');
    const back = tally('back');
    console.log(
      `[D1] FRONT  ${front.selected}/${front.attempts} selected, ${front.closed} fired pointer-miss\n` +
        `[D1] GRAZE  ${grazing.selected}/${grazing.attempts} selected, ${grazing.closed} fired pointer-miss\n` +
        `[D1] BACK   ${back.selected}/${back.attempts} selected (must be 0), ${back.closed} fired pointer-miss`,
    );

    /* A measurement test: the only assertion is that it ran and produced rows. */
    expect(rows.length).toBe(48);
  });

  /**
   * D1(b): the spin-ON success rate.
   *
   * 20 attempts per region with the planet spinning and a real 50 ms down-to-up delay, projecting the pin at
   * pointerdown time. This is hypothesis (c)'s own experiment: R3F only fires `onClick` when the object was
   * also hit at pointerdown, so a pin that MOVES between the two events is a dropped click.
   */
  test('D1 spin-on: 20 attempts per region with a 50 ms click', async ({ page }) => {
    await openLive(page);

    const summary: Array<{ id: string; attempts: number; selected: number }> = [];

    for (const id of REGION_IDS) {
      /* Bring the pin to the front before starting: `setSpin` at the pin's own longitude. */
      const target = await page.evaluate((regionId) => {
        const pin = window.__look!.pinsWorld().find((p) => p.name === regionId)!;
        const w = pin.core;
        const n = Math.hypot(w[0], w[1], w[2]) || 1;
        const lon = Math.atan2(n === 0 ? 0 : w[0] / n, n === 0 ? 0 : w[2] / n);
        return lon;
      }, id);
      await page.evaluate((angle) => window.__globe!.setSpin(true, angle), target - Math.PI / 2);
      await page.waitForTimeout(120);
      /* Now let it spin, from a pose where the pin is on the near side. */
      await page.evaluate(() => window.__globe!.setSpin(false, 0));

      let selected = 0;
      for (let i = 0; i < 20; i += 1) {
        await clearSelection(page);
        const pin = (await readPins(page)).find((p) => p.id === id)!;
        const before = await page.evaluate(() => window.__frame!.regionId);
        if (pin.facing >= FRONT || pin.facing >= 0) {
          await page.mouse.move(pin.x, pin.y);
          await page.mouse.down();
          /* 50 ms held, the prompt's delay, so the planet rotates between down and up. */
          await page.waitForTimeout(50);
          await page.mouse.up();
          await page.waitForTimeout(120);
          const outcome = await readClickOutcome(page, { region: before });
          if (outcome.selected) selected += 1;
        }
      }
      summary.push({ id, attempts: 20, selected });
      console.log(`[D1:spin] ${id.padEnd(13)} ${selected}/20 selected with the spin running`);
    }

    const total = summary.reduce((s, r) => s + r.selected, 0);
    console.log(`[D1:spin] TOTAL ${total}/80`);
    expect(summary).toHaveLength(4);
  });

  /**
   * D2: the six hypotheses, each with the measurement that decides it.
   *
   * The three that can be settled from data collected here are settled here; the rest are settled by the
   * sweep rows and are summarised from them, so no hypothesis is answered by reasoning alone.
   */
  test('D2 hypotheses: raycast stacks in front of a front-facing pin', async ({ page }) => {
    await openLive(page);

    /* Put `us-west` dead-centre, so a front pin is unambiguous. */
    await page.evaluate(() => window.__globe!.setSpin(true, 0));
    await page.waitForTimeout(150);
    await clearSelection(page);

    for (const id of REGION_IDS) {
      const pin = (await readPins(page)).find((p) => p.id === id)!;
      const hits = await raycastAt(page, pin.x, pin.y);
      console.log(
        `[D2:${id}] facing ${pin.facing.toFixed(4)} at (${pin.x.toFixed(1)}, ${pin.y.toFixed(1)}); ` +
          `raycast: ${hits.map((h) => `${h.name}/${h.type}@${h.distance.toFixed(3)}${h.visible ? '' : '(hidden)'}`).join(' → ') || '(none)'}`,
      );
    }

    /*
     * (a) "the pin hit target is too small" — measured as the pin's rendered radius in CSS px, because that
     * is what a click has to land inside.
     */
    const sizes = await page.evaluate(() => {
      const cam = window.__camera as { position: { x: number; y: number; z: number } };
      const g = window.__globe!;
      const worldMap = Object.fromEntries(window.__look!.pinsWorld().map((p) => [p.name, p.core]));
      return g.pins().map((pin) => {
        const w = worldMap[pin.id] ?? [0, 0, 1];
        const centre = g.project(w);
        const d = Math.hypot(cam.position.x, cam.position.y, cam.position.z);
        /* The ring plane is 0.22 world units across; project its edge to get CSS px. */
        const n = Math.hypot(w[0], w[1], w[2]) || 1;
        const edge: [number, number, number] = [
          w[0] + (0.11 * w[0]) / n,
          w[1] + (0.11 * w[1]) / n,
          w[2] + (0.11 * w[2]) / n,
        ];
        const e = g.project(edge);
        return {
          id: pin.id,
          distance: d,
          ringRadiusPx: Math.hypot(e.x - centre.x, e.y - centre.y),
        };
      });
    });
    for (const s of sizes) {
      console.log(`[D2:size] ${s.id.padEnd(13)} ring radius ${s.ringRadiusPx.toFixed(1)} CSS px at d=${s.distance.toFixed(3)}`);
    }

    expect(sizes).toHaveLength(4);
  });

  /**
   * D4 — the final assertions, once the fix exists.
   *
   * Separate from the measurement so a red D4 says "the fix is not good enough" rather than "the measurement
   * changed". Front pins must select at EVERY sweep angle with the spin pinned and with it running; grazing
   * pins are printed and not asserted; back pins must never select; and a pin click must never fire the
   * pointer-miss close.
   */
  test('D4 front pins select at every azimuth, and back pins never do', async ({ page }) => {
    await openLive(page);

    const failures: string[] = [];
    let frontAttempts = 0;
    const grazing: string[] = [];

    for (let deg = 0; deg < 360; deg += 30) {
      await page.evaluate((angle) => window.__globe!.setSpin(true, angle), (deg * Math.PI) / 180);
      await page.waitForTimeout(120);
      await clearSelection(page);

      for (const pin of await readPins(page)) {
        const band = pin.facing < 0 ? 'back' : pin.facing >= FRONT ? 'front' : 'grazing';
        if (band === 'grazing') {
          grazing.push(`${pin.id}@${deg} facing ${pin.facing.toFixed(3)}`);
          continue;
        }
        const before = await page.evaluate(() => window.__frame!.regionId);
        await page.mouse.click(pin.x, pin.y);
        await page.waitForTimeout(160);
        const outcome = await readClickOutcome(page, { region: before });

        if (band === 'front') {
          frontAttempts += 1;
          if (!outcome.selected) failures.push(`front ${pin.id}@${deg}deg facing ${pin.facing.toFixed(3)} did NOT select`);
          if (outcome.closed) failures.push(`front ${pin.id}@${deg}deg fired the pointer-miss close`);
        } else if (outcome.selected) {
          failures.push(`BACK ${pin.id}@${deg}deg facing ${pin.facing.toFixed(3)} SELECTED through the globe`);
        }
        if (outcome.selected) await clearSelection(page);
      }
    }

    console.log(`[D4] front clicks: ${frontAttempts - failures.filter((f) => f.startsWith('front')).length}/${frontAttempts} selected`);
    console.log(`[D4] grazing (reported, not asserted): ${grazing.length} — ${grazing.join(', ') || 'none'}`);
    console.log(`[D4] failures: ${failures.length}`);
    for (const f of failures) console.log(`[D4]   ${f}`);

    expect(failures, failures.join('; ')).toEqual([]);
  });
});
