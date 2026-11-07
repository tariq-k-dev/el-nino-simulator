/**
 * PROBE — not an acceptance test. Delete once the G3(a) cause is known.
 *
 * G3(a) fails with `aria-pressed` still true, `regionId` null and `|target|` 0. That combination is only
 * reachable if the click never reached the canvas wrapper: `GlobeScene`'s `onPointerMissed` runs
 * `onSelect(null)` for any click that reaches R3F with no intersection, and `lastPinSelectTime` is still 0
 * because the only prior interaction is a card press. So a press on empty globe, or on a proxy the gate
 * refused, would have CLEARED the box. It did not. Therefore an HTML element outside `#globe-canvas` took
 * the press.
 *
 * The existing diagnostic cannot name that element, for two reasons:
 *
 *   1. `clickPinLeading` records `hit` at the SAMPLE point but presses at the EXTRAPOLATED point, which is
 *      `leadPx` away — tens of px early in the flight. `hit: CANVAS` at the sample is compatible with an
 *      overlay at the press.
 *   2. `__pinAtDown` is installed on the canvas, so it only fires when the target IS the canvas. An overlay
 *      yields `atDown: null`, which is indistinguishable from "the listener was never installed".
 *
 * This file closes both: it hit-tests the press point itself, and it listens on `document` in the capture
 * phase so the pointerdown is recorded whatever it lands on, together with every pin's projected position
 * at that instant (so aim error is a number, not an inference).
 *
 * It asserts only that the press happened. Everything else is an annotation, because the point is to
 * report where the press went, not to rule on it.
 */
import { test, expect, connectionInit } from "./fixtures";
import type { Page } from "@playwright/test";

const URL_LIVE = "/?nino=1&debug&framing=live";
const DESKTOP = { width: 1280, height: 720 } as const;

/** Open the page and wait for a settled live frame — the same precondition the acceptance specs use. */
async function openLive(page: Page): Promise<void> {
  await page.setViewportSize({ width: DESKTOP.width, height: DESKTOP.height });
  await page.addInitScript(
    connectionInit({ saveData: false, effectiveType: "4g", downlink: 10 }),
  );
  await page.goto(URL_LIVE);
  await expect
    .poll(
      () => page.evaluate(() => (window.__frame ? window.__frame.mode : null)),
      {
        timeout: 90_000,
        intervals: [250],
      },
    )
    .toBe("live");
  await page.waitForTimeout(2500);
}

/**
 * Everything needed to name the element at a point.
 *
 * `inCanvasHost` is the decisive field: an element inside `#globe-canvas` still bubbles to R3F's handlers,
 * so it can clear the box; an element outside it cannot, which is the only way `aria-pressed` survives.
 */
async function describePoint(
  page: Page,
  x: number,
  y: number,
): Promise<{
  tag: string;
  cls: string;
  isCanvas: boolean;
  inCanvasHost: boolean;
  inOccluder: string | null;
  closestTestId: string | null;
}> {
  return page.evaluate(
    ({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      const host = document.querySelector("#globe-canvas");
      if (!el) {
        return {
          tag: "(none)",
          cls: "",
          isCanvas: false,
          inCanvasHost: false,
          inOccluder: null,
          closestTestId: null,
        };
      }
      return {
        tag: el.tagName,
        cls: (el.getAttribute("class") ?? "").slice(0, 120),
        isCanvas: el.tagName === "CANVAS",
        inCanvasHost: host ? host.contains(el) : false,
        inOccluder:
          el.closest("[data-occluder]")?.getAttribute("data-occluder") ?? null,
        closestTestId:
          el.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      };
    },
    { px: x, py: y },
  );
}

test.describe("PROBE where the G3(a) press actually lands", () => {
  test("probe: press-point hit test, pointerdown target, aim error and gate verdicts", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await openLive(page);

    /* Freeze the planet, so the camera is the only thing moving a pin. Same as G3(a). */
    await page.evaluate(() => window.__globe!.setSpin(true, 0));
    await page.waitForTimeout(600);

    /* Round-trip calibration, on an idle page, before the press. Largest of three, as G3(a) does. */
    const rtts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await page.evaluate(() => 0);
      rtts.push(Date.now() - t0);
    }
    let rtt = 0;
    for (const v of rtts) if (v > rtt) rtt = v;

    /* Press the Nino 4 card with a real mouse click, guarded by the topmost-node check. */
    const card = page.locator('[data-testid="nino-show-nino4"]');
    await card.scrollIntoViewIfNeeded();
    const cb = await card.boundingBox();
    expect(cb, "the nino4 press button must be mounted").not.toBeNull();
    const ccx = cb!.x + cb!.width / 2;
    const ccy = cb!.y + cb!.height / 2;
    const cardTop = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const t = document.querySelector('[data-testid="nino-show-nino4"]');
        return el && t && (el === t || t.contains(el))
          ? "button"
          : (el?.tagName ?? "(none)");
      },
      { x: ccx, y: ccy },
    );
    expect(cardTop, "the card press point must be the button").toBe("button");
    await page.mouse.click(ccx, ccy);

    await page.waitForTimeout(300);

    /*
     * DOCUMENT-level capture listener, not canvas-level.
     *
     * This is the whole point of the probe: it fires whatever the press lands on, and it snapshots every
     * pin's projected position at that instant, so the aim error at press time is measured rather than
     * extrapolated. It removes itself on the first pointerdown so it cannot leak.
     */
    await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      w.__probeDown = null;
      const onDown = (e: Event) => {
        const pe = e as PointerEvent;
        const el = document.elementFromPoint(pe.clientX, pe.clientY);
        const host = document.querySelector("#globe-canvas");
        w.__probeDown = {
          x: +pe.clientX.toFixed(1),
          y: +pe.clientY.toFixed(1),
          target: el === null ? "(none)" : el.tagName,
          cls: el ? (el.getAttribute("class") ?? "").slice(0, 120) : "",
          isCanvas: el?.tagName === "CANVAS",
          inCanvasHost: el && host ? host.contains(el) : false,
          inOccluder:
            el?.closest("[data-occluder]")?.getAttribute("data-occluder") ??
            null,
          closestTestId:
            el?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
          pins: window.__globe!.pins().map((p) => ({
            id: p.id,
            x: +p.x.toFixed(1),
            y: +p.y.toFixed(1),
            behind: p.behind,
            facing: p.facing,
          })),
          t: +(performance.timeOrigin + performance.now()).toFixed(1),
        };
        document.removeEventListener("pointerdown", onDown, true);
      };
      document.addEventListener("pointerdown", onDown, true);
    });

    /* Two samples on animation frames in ONE round trip, so a velocity can be derived. */
    const s = await page.evaluate(async () => {
      const sample = () =>
        new Promise<{
          t: number;
          pins: Array<{
            id: string;
            x: number;
            y: number;
            ok: boolean;
            hit: string;
          }>;
        }>((res) =>
          requestAnimationFrame(() =>
            res({
              t: performance.timeOrigin + performance.now(),
              pins: window.__globe!.pins().map((p) => {
                const el = document.elementFromPoint(p.x, p.y);
                const blocked =
                  el === null ||
                  !!el.closest(
                    '[data-occluder], aside, nav, header, [role="dialog"]',
                  );
                const hit =
                  el === null
                    ? "(none)"
                    : el.tagName === "CANVAS"
                      ? "CANVAS"
                      : `${el.tagName}.${(el.getAttribute("class") ?? "").slice(0, 60)}`;
                return {
                  id: p.id,
                  x: p.x,
                  y: p.y,
                  ok: !p.behind && !!p.facing && !blocked,
                  hit,
                };
              }),
            }),
          ),
        );
      const a = await sample();
      await new Promise((r) => setTimeout(r, 80));
      const b = await sample();
      return { a, b };
    });

    /* The page's own clock, read AFTER the sample — the same fix `clickPinLeading` carries. */
    const pageNow = await page.evaluate(
      () => performance.timeOrigin + performance.now(),
    );

    const pb = s.b.pins.find((p) => p.ok);
    expect(
      pb,
      "a front region pin must be geometrically in front 300 ms into the flight",
    ).toBeDefined();
    const pa = s.a.pins.find((p) => p.id === pb!.id)!;

    const dt = Math.max(1, s.b.t - s.a.t);
    const vx = (pb!.x - pa.x) / dt;
    const vy = (pb!.y - pa.y) / dt;
    const leadMs = Math.min(600, Math.max(0, pageNow - s.b.t) + 1.5 * rtt);
    const vp = page.viewportSize()!;
    const x = Math.min(vp.width - 1, Math.max(0, pb!.x + vx * leadMs));
    const y = Math.min(vp.height - 1, Math.max(0, pb!.y + vy * leadMs));

    /* The two hit tests that the acceptance spec conflates into one. */
    const atSample = await describePoint(page, pb!.x, pb!.y);
    const atPress = await describePoint(page, x, y);

    /* Aim error to every pin, in px, at the press point. */
    const aim = s.b.pins.map((p) => ({
      id: p.id,
      d: +Math.hypot(p.x - x, p.y - y).toFixed(1),
      ok: p.ok,
    }));

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();

    await page.waitForTimeout(4000);

    const after = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const t = window.__globe!.target();
      return {
        regionId: window.__frame!.snapshot().regionId,
        focus: window.__frame!.snapshot().focus,
        targetRadius: Math.hypot(t[0], t[1], t[2]),
        d: window.__globe!.distance(),
        pinDown: (w.__pinDown as number | undefined) ?? 0,
        pinRay: (w.__pinRay as unknown[] | undefined)?.slice(-8) ?? null,
        probeDown: w.__probeDown ?? null,
        pressed4:
          document
            .querySelector('[data-testid="nino-show-nino4"]')
            ?.getAttribute("aria-pressed") ?? null,
      };
    });

    const annotate = (description: string): void => {
      test.info().annotations.push({ type: "PROBE", description });
    };

    annotate(
      `rtt ${rtt} ms; picked pin ${pb!.id}; lead ${leadMs.toFixed(0)} ms = ` +
        `${Math.hypot(x - pb!.x, y - pb!.y).toFixed(1)} px; sample (${pb!.x.toFixed(1)}, ` +
        `${pb!.y.toFixed(1)}) press (${x.toFixed(1)}, ${y.toFixed(1)})`,
    );
    annotate(`hit at SAMPLE ${JSON.stringify(atSample)}`);
    annotate(`hit at PRESS  ${JSON.stringify(atPress)}`);
    annotate(`aim error to each pin ${JSON.stringify(aim)}`);
    annotate(`pointerdown ${JSON.stringify(after.probeDown)}`);
    annotate(
      `__pinDown ${after.pinDown}; region ${after.regionId}; focus ${after.focus}; ` +
        `aria-pressed nino4 ${after.pressed4}; d ${after.d.toFixed(5)}; ` +
        `|target| ${after.targetRadius.toFixed(4)}`,
    );
    annotate(`__pinRay tail ${JSON.stringify(after.pinRay)}`);
    annotate(
      `consoleErrors ${JSON.stringify(consoleErrors)}; pageErrors ${JSON.stringify(pageErrors)}`,
    );

    /* The only assertion: the press happened somewhere. Everything else is reported. */
    expect(
      after.probeDown,
      "the press must have produced a pointerdown somewhere",
    ).not.toBeNull();
  });
});
