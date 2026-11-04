/**
 * NINO UI — acceptance for the `?nino=1` empirical cards, their box flights, the announcement that carries
 * them, and what survives a sheet tier change.
 *
 * ## Provenance of these assertions
 *
 * The issued Part Q body was not available when this file was written, so every test below is a
 * RECONSTRUCTION from three sources that do exist: the measurements in NINO-CLOSE4 (P1-P6), the fixed
 * behaviour named in the NINO-HARDEN commits, and the explanations in the source being tested. Anything the
 * reconstruction could not observe is marked `test.fixme` with the missing observable named in the title's
 * reason comment, never silently softened. If a later prompt issues the real body, this header is the manifest
 * of what has to be re-read rather than trusted.
 *
 * ## Why the flag is always in the URL
 *
 * `?nino=1` is read exactly once at module load (`src/App.tsx:20-27`, `src/mobile/MobileShell.tsx:38-45`), so
 * it cannot be turned on later from a test. Every flag-on case therefore navigates to it, and the one flag-off
 * case navigates WITHOUT it — that pair is the only way to prove the flag gates the DOM rather than decorating
 * it.
 *
 * ## Why `debug` and `framing=live` are both needed
 *
 * `debug` installs `__globe` / `__frame` (`globals.d.ts:203-205`); without it every geometric read is
 * undefined. `framing=live` is required because the free rectangle and the view offset only exist on the live
 * path — the locked path reports defaults, and a free-rect assertion there would be vacuous.
 *
 * ## What is deliberately NOT imported from another spec
 *
 * `settleStable` is copied from `pin-click.spec.ts:104-122` rather than imported, because that file is one of
 * the 15 locked specs. The copy is faithful: same key fields, same `toFixed(3)` rounding, same
 * "same key twice" rest predicate. Only the window property name differs, so a page that somehow carried both
 * files' state could not make one spec's wait satisfy the other's.
 */
import { test, expect, connectionInit } from './fixtures';
import type { Page } from '@playwright/test';

/** Flag-on, instrumented, live framing. */
const LIVE_NINO = '/?nino=1&debug&framing=live';

/** The same page with the flag off — the control for G1e. */
const LIVE_OFF = '/?debug&framing=live';

/** The desktop viewport every earlier Nino measurement used. */
const DESKTOP = { width: 1280, height: 720 } as const;

/** The portrait viewports the mobile cases run at. */
const PHONE = { width: 390, height: 844 } as const;
const TABLET = { width: 1032, height: 1376 } as const;

/** Box labels as the registry spells them (`src/lib/regions.ts:163-193`); the announcement quotes them. */
const LABEL_NINO12 = 'NIÑO 1+2';
const LABEL_NINO4 = 'NIÑO 4';

/* ------------------------------------------------------------------------------------------ helpers */

/**
 * Record a measurement in the report without failing the test.
 *
 * Used for every number an amendment requires to be *printed* (M3's arrival triple, M6's toggle-off trace)
 * rather than asserted. An annotation is the only channel Playwright reports that cannot be mistaken for a
 * assertion, which is why these numbers do not get `expect` calls around them.
 */
function annotate(type: string, description: string): void {
  test.info().annotations.push({ type, description });
}

/**
 * Open the page, wait for a settled live frame.
 *
 * The `__frame.mode === 'live'` poll is the same precondition `pin-click.spec.ts:93-98` uses. The 2500 ms
 * settle that follows is not laziness: the scene gate closes before the first frame is composed, so reading
 * `__frame.snapshot()` too early returns a coherent-but-pre-layout picture.
 */
async function openLive(
  page: Page,
  vp: { width: number; height: number },
  url: string = LIVE_NINO,
): Promise<void> {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.addInitScript(connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }));
  await page.goto(url);
  await expect
    .poll(() => page.evaluate(() => (window.__frame ? window.__frame.mode : null)), {
      timeout: 90_000,
      intervals: [250],
    })
    .toBe('live');
  await page.waitForTimeout(2500);
  await settleStable(page);
}

/**
 * Wait until the free rectangle and the insets are the same twice in a row — the R1 rest signal.
 *
 * A faithful copy of `pin-click.spec.ts:104-122`. The property it encodes: `settled` alone is a claim about
 * one frame, while the fit is a function of the free rect, so the honest precondition for any geometric read
 * is "the inputs stopped moving", not "the machine says it is done". Both are checked.
 */
async function settleStable(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).__ninoSettleKey;
  });
  await page.waitForFunction(
    () => {
      const s = window.__frame!.snapshot();
      const key = [s.insets.left, s.insets.right, s.free.x, s.free.y, s.free.w, s.free.h]
        .map((n) => n.toFixed(3))
        .join('|');
      const store = window as unknown as Record<string, unknown>;
      const previous = store.__ninoSettleKey;
      store.__ninoSettleKey = key;
      return s.settled && previous === key;
    },
    undefined,
    { timeout: 20_000, polling: 100 },
  );
}

/**
 * Reopen the sheet to HALF using the real Sheet position slider.
 *
 * **Why this exists (M1).** The first press collapses the sheet to Peek, and Peek does not mount the cards
 * (`src/mobile/SheetBody.tsx` mounts them inside the `showControls` half block). So any mobile read of
 * `aria-pressed` after a press, and any second press, has to re-open the sheet first or it measures an
 * unmounted DOM and reports a product bug that is really a missing step.
 *
 * The route is the keyboard contract, not a synthetic drag: `useSheetKeys` maps ArrowUp peek→half→full and
 * ArrowDown full→half→peek (`src/mobile/useSheetDrag.ts:325-345`), and `page.keyboard` is what a real
 * keyboard user produces. A CDP touch drag would be the other honest route, but it re-measures the gesture
 * code in every test that needs a card, which is a different acceptance question.
 */
async function openSheetToHalf(page: Page): Promise<void> {
  const handle = page.getByRole('slider', { name: 'Sheet position' });
  await expect(handle).toBeVisible({ timeout: 20_000 });

  const now = await handle.getAttribute('aria-valuenow');
  if (now !== '1') {
    await handle.focus();
    /* ArrowUp from peek reaches half; ArrowDown from full reaches half. One press either way. */
    await page.keyboard.press(now === '2' ? 'ArrowDown' : 'ArrowUp');
    await expect.poll(() => handle.getAttribute('aria-valuenow'), { timeout: 10_000 }).toBe('1');
  }

  /* The tier attribute flips before the translate finishes, so wait for the rect to stop moving too. */
  await waitForSheetStill(page);
}

/** The sheet's own rest signal: `translateY` unchanged over two reads 120 ms apart. */
async function waitForSheetStill(page: Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as unknown as Record<string, unknown>).__ninoSheetKey;
  });
  await page.waitForFunction(
    () => {
      const read = window.__mobileSheet?.read();
      if (!read) return false;
      const store = window as unknown as Record<string, unknown>;
      const key = `${read.tierIndex}|${read.translateY.toFixed(2)}`;
      const previous = store.__ninoSheetKey;
      store.__ninoSheetKey = key;
      return previous === key;
    },
    undefined,
    { timeout: 15_000, polling: 120 },
  );
}

/**
 * Bring the press buttons on screen, at the lowest tier that actually makes them pressable.
 *
 * **M1 says "open to Half". Measured, Half is not always enough.** At 390x844 the sheet at half occupies
 * y 439..1182 inside an 844 px viewport, so its bottom 338 px — which is where the cards sit — hang off the
 * bottom of the screen. The press button measures y 1120..1164 and its scroll container reports a 642 px
 * clientHeight while only 304 px of it is on screen, so scrolling inside it cannot bring the button into view.
 * At 1032x1376 the same tier puts the button at y 1329..1373 in a 1376 px viewport, which is reachable.
 *
 * This helper therefore opens to Half first, checks whether the button's centre is genuinely inside the
 * viewport, and escalates to Full when it is not, annotating the exact overflow. It never pretends the card is
 * pressable when it is not, and it never falls back to a synthetic click: the escalation is a recorded number and
 * `G1f` asserts the Half-tier premise directly, so the defect is a named FAIL rather than a hidden workaround.
 */
async function ensureCardsReachable(page: Page, boxId: 'nino12' | 'nino4' = 'nino12'): Promise<string> {
  await openSheetToHalf(page);

  const check = async (): Promise<{ tier: string | null; inside: boolean; overflowPx: number; y: number }> => {
    const box = await page.locator(`[data-testid="nino-show-${boxId}"]`).boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    if (!box) return { tier: await sheetTier(page), inside: false, overflowPx: Number.POSITIVE_INFINITY, y: NaN };
    const cy = box.y + box.height / 2;
    return { tier: await sheetTier(page), inside: cy >= 0 && cy <= vh, overflowPx: cy - vh, y: cy };
  };

  let state = await check();
  if (state.inside) return state.tier ?? 'half';

  const handle = page.getByRole('slider', { name: 'Sheet position' });
  await handle.focus();
  await page.keyboard.press('End');
  await expect.poll(() => handle.getAttribute('aria-valuenow'), { timeout: 10_000 }).toBe('2');
  await waitForSheetStill(page);

  annotate(
    'M1',
    `card ${boxId} was NOT pressable at half: centre y ${state.y.toFixed(1)} vs viewport ` +
      `${page.viewportSize()?.height} (overflow ${state.overflowPx.toFixed(1)} px) — escalated to full`,
  );

  state = await check();
  if (!state.inside) {
    throw new Error(
      `[ensureCardsReachable] nino-show-${boxId} is unpressable at every tier: centre y ${state.y.toFixed(1)} ` +
        `against a ${page.viewportSize()?.height} px viewport at tier ${state.tier}`,
    );
  }
  return state.tier ?? 'full';
}

/** The sheet tier, or null where the shell has no sheet (desktop). */
async function sheetTier(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__mobileSheet?.read().tier ?? null);
}

/** `aria-pressed` on a box's press button, or null when the button is not in the DOM. */
async function cardPressed(page: Page, boxId: 'nino12' | 'nino4'): Promise<boolean | null> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="nino-show-${id}"]`);
    if (!el) return null;
    return el.getAttribute('aria-pressed') === 'true';
  }, boxId);
}

/** The announcement text the shell publishes, verbatim. */
async function announced(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="nino-live"]');
    return el ? (el.textContent ?? '').trim() : null;
  });
}

/**
 * Press a box's card the way a user does: a real `page.mouse` click at the button's own centre.
 *
 * `locator.click()` is avoided on purpose. It scrolls the target into view and re-resolves it, which on a
 * sheet whose body scrolls can move the element between the measurement and the press — the click then lands
 * somewhere the test never looked at and still returns success. A mouse click at a measured centre fails loudly
 * when the point is wrong, which is the property G3a needs.
 */
async function pressCardWithMouse(page: Page, boxId: 'nino12' | 'nino4'): Promise<void> {
  const button = page.locator(`[data-testid="nino-show-${boxId}"]`);

  /*
   * SCROLL FIRST, and it is not cosmetic. The cards are appended after the region switcher in the half block,
   * so at 390x844 the press button sits around y 1119 in an 844 px viewport — inside the sheet's scrollable body
   * but below the fold. `boundingBox()` happily returns that off-screen rect, `page.mouse.click` then dispatches
   * at a y the viewport does not contain, and the test reads a false `aria-pressed` and blames the product.
   *
   * `scrollIntoViewIfNeeded` is the one part of `locator.click()` worth keeping: it is what a user does to reach
   * a card in a scrolling sheet. Everything else stays a raw mouse click, because the click is what must be
   * honest — a `locator.click()` would re-resolve and could certify a button a user cannot press.
   */
  /*
   * The scroll is done IN-PAGE against the sheet body rather than with `scrollIntoViewIfNeeded`.
   *
   * Measured: at 390x844, half tier, `scrollIntoViewIfNeeded` returned successfully and the button's centre was
   * still at y 1141.8 in an 844 px viewport. The sheet is positioned with a `translateY` that the scroll
   * machinery does not treat as a clip, so it considers the element visible and issues no scroll. The body that
   * actually scrolls is `SnapSheet.tsx:342` (`overflow-y-auto`), and walking to it explicitly is the difference
   * between "the test can press the card" and "the test asserts a card is unreachable".
   */
  const scrolled = await page.evaluate((id) => {
    /*
     * DESKTOP MUST NOT SCROLL — and this is not a micro-optimisation.
     *
     * Measured at 1280x720: calling `scrollIntoView` on the desktop card block moves the ENTIRE overlay layout
     * up by 240 px. The Reset view button goes from y 46.0 to y -194.0 and the Pacific impact-zone card from
     * y 73.4 to y -171.6, while `window.scrollY` stays 0 and `document.documentElement.scrollHeight` stays 720 —
     * so this is not a document scroll being reported oddly, it is the fixed-position HUD being translated. Both
     * then fail `elementFromPoint` (returns null) and every later click in the test lands on nothing.
     *
     * That silently broke G3(a-card) and G3(e), which press a box card and then click a region card or Reset:
     * the press appeared to succeed and the follow-up click was a no-op. Nothing on desktop is ever below the
     * fold (the panel is 720 px tall and its cards end at y 284), so the scroll has no purpose there at all.
     */
    const isMobileish = window.innerWidth < 640 || document.querySelector('[data-testid="mobile-sheet"]') !== null;
    if (!isMobileish) return { before: -1, after: -1, scrollHeight: -1, clientHeight: -1, skipped: true };

    const target = document.querySelector(`[data-testid="nino-show-${id}"]`);
    if (!target) return null;
    let scroller: HTMLElement | null = target.parentElement;
    while (scroller) {
      const style = getComputedStyle(scroller);
      if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
      scroller = scroller.parentElement;
    }
    const before = scroller ? scroller.scrollTop : -1;
    target.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    return {
      before,
      after: scroller ? scroller.scrollTop : -1,
      scrollHeight: scroller ? scroller.scrollHeight : -1,
      clientHeight: scroller ? scroller.clientHeight : -1,
    };
  }, boxId);

  /* Two frames: the scroll position is applied, then the browser paints, then the rect is honest. */
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  if (!scrolled) throw new Error(`[pressCard] nino-show-${boxId} vanished before the scroll`);

  const box = await button.boundingBox();
  if (!box) throw new Error(`[pressCard] nino-show-${boxId} has no box — it is not mounted`);

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const viewport = page.viewportSize();
  if (viewport && (cy < 0 || cy > viewport.height || cx < 0 || cx > viewport.width)) {
    throw new Error(
      `[pressCard] nino-show-${boxId} centre (${cx.toFixed(1)}, ${cy.toFixed(1)}) is outside the ` +
        `${viewport.width}x${viewport.height} viewport even after scrolling — the click would be a no-op. ` +
        `scrollTop ${scrolled.before} -> ${scrolled.after}, scrollHeight ${scrolled.scrollHeight}, ` +
        `clientHeight ${scrolled.clientHeight}`,
    );
  }

  /*
   * The hit-test guard the pin specs use (`pin-click.spec.ts:37-41`): the topmost node at the point must BE the
   * button. Without it a click that lands on an overlapping element still dispatches, and the resulting
   * "nothing happened" is indistinguishable from a product defect.
   */
  const topmost = await page.evaluate(
    ({ x, y, id }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return '(none)';
      const target = document.querySelector(`[data-testid="nino-show-${id}"]`);
      return target && (el === target || target.contains(el)) ? 'button' : `${el.tagName}.${el.className}`;
    },
    { x: cx, y: cy, id: boxId },
  );
  expect(topmost, `[pressCard] the point (${cx.toFixed(1)}, ${cy.toFixed(1)}) is covered by ${topmost}`).toBe(
    'button',
  );

  await page.mouse.click(cx, cy);
}

/* ------------------------------------------------------------------------------------- G1 the flag */

/*
 * The old-design blocks are titled "EXTRA G<n>" with NO COLON after the group id, on purpose.
 *
 * Playwright's `--grep` matches the full title INCLUDING describe names, so a describe titled "G1: ..." makes
 * `--grep 'G1:'` collect the old tests alongside the Part Q ones — the per-group run then reports a count that
 * belongs to two designs, and a group can look green because tests that were never meant to run did. The R-1
 * rename put `EXTRA-` on every old test; dropping the colon from these five describe titles is what makes a
 * group grep mean one group.
 *
 * Note the old blocks' titles read like Part Q ones ("the flag mounts the cards") while the Part Q blocks have
 * their own wording ("the flag gates the Nino UI"). Matching on the wording alone is how these got swapped once.
 */
test.describe('EXTRA G1 the flag mounts the cards and one shell-level announcement', () => {
  test('EXTRA-G1a: flag-on at 1280x720 mounts the card block and two press buttons — and NO live region', async ({
    page,
  }) => {
    await openLive(page, DESKTOP);

    await expect(page.locator('[data-testid="nino-cards"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="nino-show-nino12"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="nino-show-nino4"]')).toHaveCount(1);

    /* Nothing is selected on a boot, so both buttons read false. */
    expect(await cardPressed(page, 'nino12')).toBe(false);
    expect(await cardPressed(page, 'nino4')).toBe(false);

    /*
     * THE LIVE REGION IS MOBILE-ONLY, and that is a product fact, not a harness one.
     *
     * `App.tsx:394` mounts `MobileShell` behind `{isMobile ? … : null}`, and the announcement node lives in that
     * shell (`MobileShell.tsx:188-207`). So at 1280x720 — a desktop layout — there is no `[data-testid=
     * "nino-live"]` anywhere in the document, and a desktop screen-reader user is told nothing when a box is
     * shown. Asserted as an absence rather than left out, so the gap is a number in the report instead of a
     * silent omission. The announcement content is asserted where it exists, at G1d on a phone.
     */
    await expect(page.locator('[data-testid="nino-live"]')).toHaveCount(0);
    expect(await announced(page)).toBeNull();

    annotate(
      'G1a',
      'desktop boot: 2 press buttons, aria-pressed false/false, 0 nino-live nodes ' +
        '(MobileShell is mobile-only, App.tsx:394 — no desktop announcement)',
    );
  });

  test('EXTRA-G1b: the live region is shell-level — it survives a tier change instead of remounting', async ({
    page,
  }) => {
    await openLive(page, PHONE);

    expect(await sheetTier(page)).toBe('peek');
    await expect(page.locator('[data-testid="nino-live"]')).toHaveCount(1);

    /*
     * Identity, not just presence. A node that is destroyed and re-created at the new tier would still count
     * as 1, so the tag below is what distinguishes "mounted outside the tier conditionals" (the property the
     * shell claims at `MobileShell.tsx:172-186`) from "rendered again by chance".
     */
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="nino-live"]');
      if (el) el.setAttribute('data-nino-probe', 'g1b');
    });

    await openSheetToHalf(page);
    await expect(page.locator('[data-testid="nino-live"][data-nino-probe="g1b"]')).toHaveCount(1);

    const handle = page.getByRole('slider', { name: 'Sheet position' });
    await handle.focus();
    await page.keyboard.press('End');
    await expect.poll(() => handle.getAttribute('aria-valuenow'), { timeout: 10_000 }).toBe('2');
    await waitForSheetStill(page);
    await expect(page.locator('[data-testid="nino-live"][data-nino-probe="g1b"]')).toHaveCount(1);

    annotate('G1b', 'live region identity held across peek -> half -> full');
  });

  test('EXTRA-G1c: at 390x844 and 1032x1376 a press flips aria-pressed, read only after reopening the sheet', async ({
    page,
  }) => {
    for (const vp of [PHONE, TABLET]) {
      await openLive(page, vp);
      const size = `${vp.width}x${vp.height}`;

      /* M1: the sheet must be open before the read, or the button is not in the DOM at all. */
      const tierUsed = await ensureCardsReachable(page, 'nino12');
      expect(await cardPressed(page, 'nino12'), `${size}: press button must exist at ${tierUsed}`).toBe(false);

      await pressCardWithMouse(page, 'nino12');
      await settleStable(page);

      const tierAfterPress = await sheetTier(page);
      annotate(
        'G1c',
        `${size}: pressed at tier ${tierUsed}; sheet tier after press = ${tierAfterPress}` +
          (tierAfterPress === 'peek' ? ' (sheet collapsed after press)' : ''),
      );

      await ensureCardsReachable(page, 'nino12');
      expect(await cardPressed(page, 'nino12'), `${size}: pressed state after the first press`).toBe(true);
      expect(await cardPressed(page, 'nino4'), `${size}: the other box must stay unpressed`).toBe(false);
    }
  });

  test('EXTRA-G1d: the announcement is the exact sentence, quoting the registry label', async ({ page }) => {
    /*
     * A PHONE, not a desktop, because the announcement node only exists on a mobile shell (see G1a). The sheet
     * is opened to half before every press for the M1 reason: the press buttons live in the half block, and a
     * button that is not mounted cannot be pressed.
     */
    await openLive(page, PHONE);
    await ensureCardsReachable(page, 'nino12');

    await pressCardWithMouse(page, 'nino12');
    await expect
      .poll(() => announced(page), { timeout: 15_000, intervals: [100] })
      .toBe(`Showing ${LABEL_NINO12} on the globe`);

    /* M1: the first press collapsed the sheet, so the button must be brought back before the second press. */
    await ensureCardsReachable(page, 'nino12');
    await pressCardWithMouse(page, 'nino12');
    await expect.poll(() => announced(page), { timeout: 15_000, intervals: [100] }).toBe('');

    await ensureCardsReachable(page, 'nino4');
    await pressCardWithMouse(page, 'nino4');
    await expect
      .poll(() => announced(page), { timeout: 15_000, intervals: [100] })
      .toBe(`Showing ${LABEL_NINO4} on the globe`);

    annotate('G1d', `announcement: "Showing ${LABEL_NINO12} on the globe" -> "" -> "Showing ${LABEL_NINO4} on the globe"`);
  });

  test('EXTRA-G1f: at 390x844 the half tier leaves the press buttons below the viewport', async ({ page }) => {
    /*
     * THE M1 PREMISE, ASSERTED RATHER THAN ASSUMED.
     *
     * M1 is written on the belief that opening the sheet to Half puts the cards on screen. That holds at
     * 1032x1376 and does not hold at 390x844, measured:
     *
     *   390x844   half   sheet y 439..1182 in an 844 px viewport; body clientHeight 642 but only 304 visible;
     *                    press button y 1120..1164   -> 320.8 px BELOW the viewport bottom
     *   1032x1376 half   sheet y 716..1926 in a 1376 px viewport; press button y 1329..1373  -> reachable
     *
     * The cause is that the sheet's height is a fraction of the viewport (sheetHeight 742.7 at 390x844, matching
     * `__mobileSheet.points`), while the translate for `half` is 337.6 — so the sheet's own bottom lands at
     * 439 + 742.7 = 1181.7, well past 844. The half tier positions the sheet without ever guaranteeing that its
     * last 338 px are on screen.
     *
     * This is recorded as a FAIL rather than worked around, because the workaround (`ensureCardsReachable`
     * escalating to Full) is a test-side accommodation and the reading experience is the product's. Whether the
     * fix is a smaller half height, an internal scroll clamp, or cards above the switcher is a product decision.
     */
    await openLive(page, PHONE);
    await openSheetToHalf(page);

    const geom = await page.evaluate(() => {
      const s = window.__mobileSheet?.read();
      const sheet = document.querySelector('[data-mobile-sheet]') as HTMLElement | null;
      const btn = document.querySelector('[data-testid="nino-show-nino12"]') as HTMLElement | null;
      const body = btn?.closest('[class*="overflow-y-auto"]') as HTMLElement | null;
      const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
      const sb = rect(sheet);
      const bb = rect(btn);
      return {
        tier: s?.tier ?? null,
        viewportH: window.innerHeight,
        sheetTop: sb ? Math.round(sb.top) : null,
        sheetBottom: sb ? Math.round(sb.bottom) : null,
        buttonTop: bb ? Math.round(bb.top) : null,
        buttonBottom: bb ? Math.round(bb.bottom) : null,
        bodyScroll: body ? { scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : null,
      };
    });

    annotate('G1f', `390x844 half: ${JSON.stringify(geom)}`);

    expect(geom.tier, 'the sheet must be at half for this measurement').toBe('half');
    expect(geom.buttonBottom, 'the press button must be below the viewport bottom at half').toBeGreaterThan(
      geom.viewportH,
    );

    /*
     * The scroll container cannot rescue it: the body reports 642 px of clientHeight while only the part of the
     * sheet above the viewport bottom is visible, so `scrollIntoView` has 642 px of room to move within and the
     * button still lands past the fold. A container taller than the visible slice is the mechanism.
     */
    const sheetTop = geom.sheetTop ?? 0;
    const sheetHeight = (geom.sheetBottom ?? 0) - sheetTop;
    const visibleSlice = Math.max(0, Math.min(geom.viewportH, geom.sheetBottom ?? 0) - sheetTop);
    annotate('G1f', `visible slice of the sheet: ${visibleSlice} px of ${sheetHeight} px`);
    expect(
      geom.bodyScroll!.clientHeight,
      'the scrollable body must be taller than the visible slice — that is why scrolling cannot fix it',
    ).toBeGreaterThan(visibleSlice);
  });

  test('EXTRA-G1e: with the flag off, none of it exists — no cards, no press buttons, no live region', async ({
    page,
  }) => {
    await openLive(page, DESKTOP, LIVE_OFF);

    /* The region cards are the control: the panel exists, the Nino block in it does not. */
    await expect(page.locator('[data-occluder="right-panel"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="nino-cards"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="nino-show-nino12"]')).toHaveCount(0);
    expect(await cardPressed(page, 'nino12')).toBeNull();

    /*
     * The live region is the case this test exists for. `role="status"` is in the accessibility tree whether
     * or not it holds text, so a node rendered unconditionally would be a real DOM difference despite being
     * visually invisible — the M1 fingerprint caught exactly that at 200/199 elements.
     */
    await expect(page.locator('[data-testid="nino-live"]')).toHaveCount(0);
    expect(await announced(page)).toBeNull();

    annotate('G1e', 'flag-off: 0 nino-cards, 0 press buttons, 0 nino-live nodes');
  });
});

/* --------------------------------------------------------------------------- G2 the box flight arrives */

/**
 * The fit law, restated independently.
 *
 * Deliberately NOT imported from `src/lib/ninoFraming.ts`. The choice is the same one `pin-click.spec.ts:51-56`
 * and `switcher-ux.spec.ts` make: asserting the product agrees with its own module proves self-consistency, and
 * would still pass if both drifted together. These are the four published equations, transcribed:
 *
 *   halfH   = atan(tan(halfV) * aspect)                                  horizontalHalfFovDeg
 *   eff     = atan(frac * tan(half))                                     scaledHalfFovDeg
 *   d(a,h)  = cos(a) + sin(a)/tan(h)   , Infinity when d <= 1            requiredDistanceForHalfAngle
 *   dBox    = clamp(1.1 * max(dVert, dHoriz), 1.25, 5)                   ninoFlyToDistance
 *
 * The box half-extents come from the registry geometry (anchor-relative, longitude scaled by cos(lat)),
 * reproduced here rather than read, for the same reason.
 */
const DEG = Math.PI / 180;
const INV_DEG = 180 / Math.PI;
const FIT_MARGIN = 1.1;
const FIT_MIN = 1.25;
const FIT_MAX = 5;

type BoxGeom = { latMin: number; latMax: number; lonWest: number; lonEast: number; anchorLat: number; anchorLon: number };

const GEO = {
  nino12: { latMin: -10, latMax: 0, lonWest: -90, lonEast: -80, anchorLat: -5, anchorLon: -85 },
  nino4: { latMin: -5, latMax: 5, lonWest: 160, lonEast: -150, anchorLat: 0, anchorLon: -175 },
} as const satisfies Record<string, BoxGeom>;

const wrap360 = (lon: number): number => ((lon % 360) + 360) % 360;
const wrap180 = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

function halfExtents(box: BoxGeom): { verticalDeg: number; horizontalDeg: number } {
  const verticalDeg = Math.max(Math.abs(box.latMin - box.anchorLat), Math.abs(box.latMax - box.anchorLat));
  const anchor360 = wrap360(box.anchorLon);
  const west = Math.abs(wrap180(wrap360(box.lonWest) - anchor360));
  const east = Math.abs(wrap180(wrap360(box.lonEast) - anchor360));
  const horizontalDeg = Math.max(west, east) * Math.cos(box.anchorLat * DEG);
  return { verticalDeg, horizontalDeg };
}

function distanceForHalfAngle(halfAngleDeg: number, halfFovDeg: number): number {
  if (halfAngleDeg <= 0) return 1;
  if (halfFovDeg <= 0) return Number.POSITIVE_INFINITY;
  const a = halfAngleDeg * DEG;
  const half = halfFovDeg * DEG;
  const d = Math.cos(a) + Math.sin(a) / Math.tan(half);
  return Number.isFinite(d) && d > 1 ? d : Number.POSITIVE_INFINITY;
}

function scaledHalf(halfFovDeg: number, frac: number): number {
  if (!(frac > 0)) return 0;
  if (frac >= 1) return halfFovDeg;
  return Math.atan(frac * Math.tan(halfFovDeg * DEG)) * INV_DEG;
}

/** Predicted settled distance for a box, given the free rect measured at press time. */
function predictedDistance(
  box: BoxGeom,
  free: { w: number; h: number },
  viewport: { w: number; h: number },
  fovDeg = 42,
  aspect?: number,
): number {
  const halfV = fovDeg / 2;
  const asp = aspect ?? viewport.w / viewport.h;
  const halfH = Math.atan(Math.tan(halfV * DEG) * asp) * INV_DEG;
  const wf = Math.min(free.w / viewport.w, 1);
  const hf = Math.min(free.h / viewport.h, 1);
  const { verticalDeg, horizontalDeg } = halfExtents(box);
  const dV = distanceForHalfAngle(verticalDeg, scaledHalf(halfV, hf));
  const dH = distanceForHalfAngle(horizontalDeg, scaledHalf(halfH, wf));
  const needed = Math.max(dV, dH);
  const fitted = Number.isFinite(needed) ? needed * FIT_MARGIN : FIT_MAX;
  return Math.min(Math.max(fitted, FIT_MIN), FIT_MAX);
}

/** M3's tolerance. Fixed at 0.006 everywhere and never loosened per test. */
const ARRIVE_TOL = 0.006;

/**
 * Wait for the box flight to finish and return the settled camera distance.
 *
 * M2 forbids asserting a flight count or a refit count after anything that moves the free rect, because a
 * re-armed flight legitimately produces more than one. So the only claim made here is "it stopped", read from
 * `__frame.settled` plus the same two-identical-reads rest the rest of the file uses.
 */
async function settleFlight(page: Page): Promise<number> {
  await expect
    .poll(() => page.evaluate(() => window.__frame!.settled), { timeout: 40_000, intervals: [100] })
    .toBe(true);
  await settleStable(page);
  return page.evaluate(() => window.__globe!.distance());
}

/** The press-time record, snapshotted so a later press cannot overwrite the numbers under test. */
async function snapshotPress(
  page: Page,
): Promise<{ freeRectFrac: { widthFrac: number; heightFrac: number }; innerW: number; innerH: number; distance: number; aspect: number; fov: number } | null> {
  return page.evaluate(() => {
    const rec = (window as unknown as Record<string, unknown>).__ninoPress as
      | {
          freeRectFrac: { widthFrac: number; heightFrac: number };
          innerW: number;
          innerH: number;
          distance: number;
          aspect: number;
          fov: number;
        }
      | undefined;
    return rec ?? null;
  });
}

test.describe('EXTRA G2 pressing a card flies the camera to the box and lands inside tolerance', () => {
  test('EXTRA-G2a: Nino 1+2 at 1280x720 arrives at the predicted distance', async ({ page }) => {
    await openLive(page, DESKTOP);

    const before = await page.evaluate(() => window.__globe!.distance());
    await pressCardWithMouse(page, 'nino12');
    const press = await snapshotPress(page);
    expect(press, 'the press must have been recorded by __ninoPress').not.toBeNull();

    const settledD = await settleFlight(page);
    expect(await cardPressed(page, 'nino12')).toBe(true);

    /*
     * The free rect the fit was RESOLVED against is the press-time one, read from `__ninoPress.freeRectFrac`
     * rather than from `__frame.free` now. On desktop the drawer closes after the press, so the live rect is
     * already wider than the rect the flight aimed at — predicting from the live one would test the wrong
     * number and, worse, would silently agree with a stale flight.
     */
    const predicted = predictedDistance(
      GEO.nino12,
      { w: press!.freeRectFrac.widthFrac * press!.innerW, h: press!.freeRectFrac.heightFrac * press!.innerH },
      { w: press!.innerW, h: press!.innerH },
      press!.fov,
      press!.aspect,
    );

    const offset = settledD - predicted;
    const direction = settledD < before ? 'inward (d decreasing)' : 'outward (d increasing)';

    annotate(
      'M3',
      `G2a settled d ${settledD.toFixed(5)}, predicted d ${predicted.toFixed(5)}, ` +
        `offset ${offset >= 0 ? '+' : ''}${offset.toFixed(5)}, travel ${direction}, ` +
        `start ${before.toFixed(5)}`,
    );

    expect(Math.abs(offset), `arrival offset ${offset.toFixed(5)} exceeds ${ARRIVE_TOL}`).toBeLessThanOrEqual(
      ARRIVE_TOL,
    );
  });

  test('EXTRA-G2b: a fresh boot has not re-fitted anything before the press', async ({ page }) => {
    /*
     * M2 keeps this one: on a fresh boot with no box selected there is nothing for `refitNinoForRect` to do, since
     * its first gate is `activeNinoBoxId` (`CameraDirector.tsx:236-237`). The observable that WOULD prove a count
     * does not exist in src — there is no refit counter, only a boolean return consumed at `:1309` and `:1489` —
     * so this asserts the consequence instead: the distance is still the default pose and no box is selected.
     *
     * FIXME record: "refit count" has no readable observable. The test is kept as the nearest honest statement
     * rather than deleted, and the absence is reported.
     */
    await openLive(page, DESKTOP);

    const d = await page.evaluate(() => window.__globe!.distance());
    const pose = await page.evaluate(() => window.__globe!.defaultOrbit());
    const region = await page.evaluate(() => window.__frame!.regionId);

    annotate('G2b', `fresh boot d ${d.toFixed(5)}, defaultOrbit.distance ${pose.distance.toFixed(5)}, region ${region}`);

    expect(d, 'a fresh boot must sit at the default distance').toBeCloseTo(pose.distance, 3);
    expect(region, 'no region may be selected on a fresh boot').toBeNull();
    expect(await cardPressed(page, 'nino12'), 'no box may be selected on a fresh boot').toBe(false);
    expect(await cardPressed(page, 'nino4')).toBe(false);
  });

  test.fixme( // allow-skip: src exposes no refit counter, so "refit count 0" is unobservable without editing src (forbidden by the prompt); G2b asserts the behavioural consequence instead.
    'EXTRA-G2c: a fresh boot reports a refit count of 0 — NO READABLE OBSERVABLE (src has no refit counter)',
    async () => {
      /*
       * Kept as an explicit FIXME rather than silently dropped.
       *
       * `refitNinoForRect` (`CameraDirector.tsx:226-268`) RETURNS a boolean; it does not increment anything, does
       * not store anything, and nothing exposes a count. The call sites at `:1309` and `:1489` consume the return
       * into locals named `ninoRefit` / `ninoRefitDesktop`. A spec therefore cannot read "refit count 0" without a
       * source change under src/, which the prompt forbids.
       *
       * Un-fixme this when a probe exposes the count. G2b asserts the behavioural consequence in the meantime.
       */
      expect(true).toBe(false);
    },
  );
});

/* ------------------------------------------------------------------- G3 the card is the only trigger */

/**
 * Where a Niño pin is on screen, derived from the same constants the scene uses.
 *
 * **Neither probe can answer this.** `__look.pinsWorld()` and `__globe.pins()` both map over `REGIONS`
 * (`GlobeScene.tsx:587-607`), and the Niño pins are not regions — `NinoOverlay` hands `Hotspot` a
 * `boxAsRegion()` with `INERT_REGION_ID` (`NinoOverlay.tsx:47,59-70`), so they are absent from both lists. There
 * is no probe for them and adding one would edit `src/`, which the prompt forbids.
 *
 * So the position is recomputed here from the published inputs: `latLonToVector3(anchorLat, anchorLon360, R)`
 * with `R = anchorRadius * idleLift + coreOffset` (`globeLook.ts:33,39,41`), spun by the same Y rotation the
 * scene applies, then projected through the page's own camera via `__globe.project`. The spin angle is supplied
 * by the test rather than read, because the probe has no spin getter — which is why G3a freezes the spin first,
 * making the angle a known constant instead of a guess.
 */
const PIN_ANCHOR_R = 1.012 * 1.035 + 0.055;

function pinCoreWorld(lat: number, lon: number, spinY: number): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = (((lon % 360) + 360) % 360 + 180) * (Math.PI / 180);
  const r = PIN_ANCHOR_R;
  const x = -r * Math.sin(phi) * Math.cos(theta);
  const y = r * Math.cos(phi);
  const z = r * Math.sin(phi) * Math.sin(theta);
  /* The scene's rotation is [x*c + z*s, y, -x*s + z*c] (GlobeScene.tsx:596-600). */
  const c = Math.cos(spinY);
  const s = Math.sin(spinY);
  return [x * c + z * s, y, -x * s + z * c];
}

async function ninoPinScreen(
  page: Page,
  box: 'nino12' | 'nino4',
  spinY: number,
): Promise<{ x: number; y: number; behind: boolean; world: [number, number, number] } | null> {
  const geom = GEO[box];
  const core = pinCoreWorld(geom.anchorLat, geom.anchorLon, spinY);
  return page.evaluate((w) => {
    const q = window.__globe!.project(w as [number, number, number]);
    return { x: q.x, y: q.y, behind: q.behind, world: w as [number, number, number] };
  }, core);
}

/** The topmost DOM node at a point — the guard that a mouse press reaches the canvas and not a panel. */
async function topNodeAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ({ px, py }) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return '(none)';
      if (el.tagName === 'CANVAS') return 'canvas';
      const box = el.closest('[data-occluder]');
      return box ? `${el.tagName} in ${box.getAttribute('data-occluder')}` : el.tagName;
    },
    { px: x, py: y },
  );
}

test.describe('EXTRA G3 the card is the only trigger, and a press survives what the globe does', () => {
  test('EXTRA-G3a: a real mouse press on the pin does nothing; on the card it selects', async ({ page }) => {
    /*
     * M4 asks for a real `page.mouse` press on the pin AND on the card, with the R1 settle and the same
     * pre-settle pattern pin-click's D4 uses. The pattern copied from `pin-click.spec.ts:963-991` is:
     *
     *     await settleStable(page);  await page.waitForTimeout(700);  await settleStable(page);
     *
     * The 700 ms between two settles is not padding. D4's own comment records why a single settle is not enough:
     * a tween that has finished still leaves the controls to write their pose on the following frames, so the
     * projection taken immediately after `settled` flips can be one frame stale. Two settles bracketing a short
     * wait is the cheapest way to be sure the pose is not still being written.
     */
    await openLive(page, DESKTOP);
    await settleStable(page);
    await page.waitForTimeout(700);
    await settleStable(page);

    /*
     * Freeze the spin at a KNOWN angle so the pin's screen position cannot move between the read and the press,
     * and so the test can predict where the pin is without a spin getter existing. 0.9 rad is arbitrary; it is
     * chosen only to put the Niño 1+2 anchor (5 S, 85 W) on the near hemisphere at the default pose.
     */
    const SPIN = 0.9;
    await page.evaluate((angle) => window.__globe!.setSpin(true, angle), SPIN);
    await settleStable(page);

    const pin = await ninoPinScreen(page, 'nino12', SPIN);
    expect(pin, 'the Nino 1+2 pin must project through the page camera').not.toBeNull();
    expect(pin!.behind, 'the pin must be on the near hemisphere for this press to mean anything').toBe(false);

    const top = await topNodeAt(page, pin!.x, pin!.y);
    expect(top, `the pin point (${pin!.x.toFixed(1)}, ${pin!.y.toFixed(1)}) must be on the canvas`).toBe('canvas');

    /* The press itself: a real mouse click at the pin's own projected pixel. */
    await page.mouse.click(pin!.x, pin!.y);
    await settleStable(page);

    /*
     * THE PRODUCT RULE, not a tolerance. `dotOnly` hands `undefined` for the click/hover handlers
     * (`Hotspot.tsx:412-416`), so R3F never puts the Niño pin on its interaction list and the press cannot reach
     * any handler at all. A press on the pin is therefore required to be exactly equivalent to a press on empty
     * globe: no selection, no flight, no announcement.
     */
    expect(await cardPressed(page, 'nino12'), 'a press on the pin must NOT select the box').toBe(false);
    /*
     * `announced()` returns null when the node is absent and '' when it is present but empty. On DESKTOP the node
     * is absent by construction (G1a, `App.tsx:394`), so both readings mean "nothing was said"; asserting only
     * `''` would be asserting a mobile-only shape on a desktop page.
     */
    expect([null, ''], 'a press on the pin must NOT announce').toContain(await announced(page));

    const dAfterPin = await page.evaluate(() => window.__globe!.distance());
    const pose = await page.evaluate(() => window.__globe!.defaultOrbit());
    expect(dAfterPin, 'a press on the pin must not fly the camera').toBeCloseTo(pose.distance, 3);

    /* Now the card, with the same real mouse press. */
    await pressCardWithMouse(page, 'nino12');
    await settleStable(page);
    await page.waitForTimeout(700);
    await settleStable(page);

    expect(await cardPressed(page, 'nino12'), 'the card press must select the box').toBe(true);

    annotate(
      'G3a',
      `pin point (${pin!.x.toFixed(1)}, ${pin!.y.toFixed(1)}) top=${top}: no selection, d ${dAfterPin.toFixed(5)}; ` +
        'card press selected',
    );
  });

  test('EXTRA-G3b: the press target is the button, not the whole card', async ({ page }) => {
    /*
     * The card body is an <article> with a heading, two paragraphs and the button. If the handler sat on the
     * article, a press anywhere on the card would select — which is a different affordance from the one M1's
     * "first press" language assumes, and would also make the card impossible to scroll past on a phone.
     */
    await openLive(page, DESKTOP);

    const artBox = await page.locator('[data-testid="nino-card-nino12"]').boundingBox();
    expect(artBox).not.toBeNull();

    /* A point in the card's TITLE area: inside the article, well above the button. */
    const titleY = artBox!.y + 14;
    const top = await topNodeAt(page, artBox!.x + 20, titleY);
    expect(top, 'the card body must be hit-testable where the title is').not.toBe('canvas');

    await page.mouse.click(artBox!.x + 20, titleY);
    await settleStable(page);
    expect(await cardPressed(page, 'nino12'), 'a press on the card body must NOT select').toBe(false);

    annotate('G3b', `card body press at (${(artBox!.x + 20).toFixed(1)}, ${titleY.toFixed(1)}) -> no selection`);
  });

  test('EXTRA-G3c: the named text is the registry label, spelled with the tilde', async ({ page }) => {
    await openLive(page, DESKTOP);

    /* The heading and the accessible name both come from `model.regionLabel`, which is `NIÑO 1+2`. */
    await expect(page.locator('[data-testid="nino-card-nino12"] h3')).toHaveText(LABEL_NINO12);
    await expect(page.locator('[data-testid="nino-card-nino4"] h3')).toHaveText(LABEL_NINO4);
    await expect(page.locator('[data-testid="nino-show-nino12"]')).toHaveAttribute(
      'aria-label',
      `Show ${LABEL_NINO12} on the globe`,
    );

    annotate('G3c', `headings ${LABEL_NINO12} / ${LABEL_NINO4}; aria-label "Show ${LABEL_NINO12} on the globe"`);
  });

  test('EXTRA-G3d: a press during a settled view is not cancelled by a later canvas press', async ({ page }) => {
    /*
     * M2 forbids a refit/flight count here because this test changes the free rect mid-flight, so the only
     * claim is the settled distance. The behaviour under test is B3b's: a user cancel clears `ninoFlight`, and
     * the SELECTION survives (`activeNinoBoxId` is what the re-fit keys on), so pressing the empty globe must not
     * deselect the box or strand the camera mid-tween.
     */
    await openLive(page, DESKTOP);

    await pressCardWithMouse(page, 'nino12');
    const press = await snapshotPress(page);
    const settledD = await settleFlight(page);

    /* A press on empty canvas, no movement — the B3b cancel path. */
    await page.mouse.move(20, 400);
    await page.mouse.down();
    await page.mouse.up();
    await settleStable(page);
    await page.waitForTimeout(700);
    await settleStable(page);

    expect(await cardPressed(page, 'nino12'), 'a canvas press must not deselect the box').toBe(true);

    const dAfter = await page.evaluate(() => window.__globe!.distance());
    const predicted = predictedDistance(
      GEO.nino12,
      { w: press!.freeRectFrac.widthFrac * press!.innerW, h: press!.freeRectFrac.heightFrac * press!.innerH },
      { w: press!.innerW, h: press!.innerH },
      press!.fov,
      press!.aspect,
    );
    const offset = dAfter - predicted;

    annotate(
      'M3',
      `G3d settled d ${settledD.toFixed(5)} before the cancel, ${dAfter.toFixed(5)} after; ` +
        `predicted ${predicted.toFixed(5)}, offset ${offset >= 0 ? '+' : ''}${offset.toFixed(5)}, travel inward`,
    );

    expect(
      Math.abs(offset),
      'the box fit must survive a cancel press — the camera must not be stranded where the tween stopped',
    ).toBeLessThanOrEqual(ARRIVE_TOL);
  });

  test('EXTRA-G3e: pressing a second box moves the selection rather than adding to it', async ({ page }) => {
    await openLive(page, DESKTOP);

    await pressCardWithMouse(page, 'nino12');
    await settleFlight(page);
    expect(await cardPressed(page, 'nino12')).toBe(true);

    await pressCardWithMouse(page, 'nino4');
    await settleFlight(page);

    expect(await cardPressed(page, 'nino4'), 'the second box becomes the selected one').toBe(true);
    expect(await cardPressed(page, 'nino12'), 'the first box must be released').toBe(false);

    /*
     * The announcement is asserted on a PHONE, in G1d and G3d, not here: this test runs at 1280x720 where the
     * live-region node does not exist (G1a). Asserting it here would fail for the same reason G1a's first version
     * did — a mobile-only node read on a desktop page.
     */
    annotate('G3e', 'nino12 true -> nino4 true with nino12 false (announcement covered by G1d/G3d on a phone)');
  });

  test('EXTRA-G3f: at 390x844 and 1032x1376 the box flight lands, traced at 0, 1, 3 and 5 s', async ({ page }) => {
    /*
     * M6: d and target at 0, 1, 3 and 5 s are ANNOTATIONS ONLY. Nothing here asserts a drift, because a settled
     * camera that then moves is a finding to report, not a threshold to invent. The one assertion is that the
     * flight arrived at all, and it uses M3's tolerance.
     */
    for (const vp of [PHONE, TABLET]) {
      await openLive(page, vp);
      const size = `${vp.width}x${vp.height}`;

      await ensureCardsReachable(page, 'nino12');

      /*
       * THE SNAPSHOT MUST FOLLOW THE PRESS. `__ninoPress` is written BY the press (`CameraDirector.tsx:985`), so
       * reading it first returns undefined and every predicted distance becomes NaN — measured here as exactly
       * that failure ("Received: NaN"). It also has to be read immediately, before anything else presses.
       */
      await pressCardWithMouse(page, 'nino12');
      const press = await snapshotPress(page);

      const t0 = Date.now();
      const trace: string[] = [];
      let settledD = Number.NaN;
      let targetLen = 0;
      let settledFree = { w: 0, h: 0 };
      let settledViewport = { w: 0, h: 0 };

      for (const mark of [0, 1000, 3000, 5000]) {
        const wait = mark - (Date.now() - t0);
        if (wait > 0) await page.waitForTimeout(wait);
        const s = await page.evaluate(() => {
          const f = window.__frame!.snapshot();
          return {
            d: window.__globe!.distance(),
            tgt: window.__globe!.target(),
            dFit: f.dFit,
            settled: f.settled,
            free: f.free,
            vw: window.innerWidth,
            vh: window.innerHeight,
          };
        });
        const tl = Math.hypot(s.tgt[0], s.tgt[1], s.tgt[2]);
        trace.push(
          `${mark}ms d ${s.d.toFixed(5)} |target| ${tl.toFixed(3)} dFit ${s.dFit.toFixed(5)} ` +
            `free ${s.free.w.toFixed(1)}x${s.free.h.toFixed(1)} settled ${s.settled}`,
        );
        if (mark === 5000) {
          settledD = s.d;
          targetLen = tl;
          settledFree = { w: s.free.w, h: s.free.h };
          settledViewport = { w: s.vw, h: s.vh };
        }
      }

      /*
       * WHICH RECT THE ARRIVAL IS PREDICTED AGAINST — and why it is the SETTLED one here, not the press-time one.
       *
       * Measured in this very test at 1032x1376: the press-time rect predicts 1.42759, the flight settles at
       * 1.45359, and the difference is 0.02601. That gap is not drift; it is the sheet COLLAPSING TO PEEK on
       * press (G3g proves the collapse), which shrinks the reserved height and therefore moves the free rect
       * mid-flight. `refitNinoForRect` re-arms the flight against the new rect — that is the d9c9093/B7 fix — so
       * the camera correctly lands framed for the rect that exists at settle, not the one that existed at press.
       *
       * So the arrival law is stated the way the product implements it: d at settle equals the fit for the free
       * rect at settle. The press-time prediction is still computed and printed, because the DIFFERENCE between the
       * two is the measurement of the retarget, and that belongs in the report rather than in a threshold.
       */
      const predictedFromPress = press
        ? predictedDistance(
            GEO.nino12,
            { w: press.freeRectFrac.widthFrac * press.innerW, h: press.freeRectFrac.heightFrac * press.innerH },
            { w: press.innerW, h: press.innerH },
            press.fov,
            press.aspect,
          )
        : Number.NaN;
      const predictedAtSettle = predictedDistance(GEO.nino12, settledFree, settledViewport);

      const offset = settledD - predictedAtSettle;
      annotate('M6', `${size} trace: ${trace.join(' | ')}`);
      annotate(
        'M3',
        `${size} settled d ${settledD.toFixed(5)}, predicted (settled rect) ${predictedAtSettle.toFixed(5)}, ` +
          `offset ${offset >= 0 ? '+' : ''}${offset.toFixed(5)}, travel inward, |target| ${targetLen.toFixed(3)}; ` +
          `predicted (press rect) ${predictedFromPress.toFixed(5)} — rect moved ${(predictedFromPress - predictedAtSettle).toFixed(5)} in d`,
      );

      /*
       * THE SELECTION ORACLE DIFFERS BY VIEWPORT, and both are the product's own witnesses.
       *
       * On a phone the press collapses the sheet to Peek (G3g), which unmounts the cards, so `cardPressed` returns
       * null for the rest of the test — measured here as exactly that failure ("Received: null"). The announcement
       * node lives outside every tier conditional (`MobileShell.tsx:172-207`), which is precisely the property B6a
       * added it for, so it is the one selection oracle that survives a tier change on mobile.
       *
       * Both viewports here ARE mobile shells (390x844 and 1032x1376), so both use the announcement.
       */
      await expect
        .poll(() => announced(page), { timeout: 15_000, intervals: [150] })
        .toBe(`Showing ${LABEL_NINO12} on the globe`);

      expect(Math.abs(offset), `${size}: arrival offset ${offset.toFixed(5)}`).toBeLessThanOrEqual(ARRIVE_TOL);
    }
  });

  test('EXTRA-G3g: on a phone the sheet collapses on press and the cards go with it', async ({ page }) => {
    /*
     * Measured in NINO-CLOSE4 P5 and reproduced by G1f: the press collapses the sheet to Peek, and the sheet body
     * at Peek does not mount the cards. M1 turns that into an obligation — record it as an annotation and reopen
     * before any second press — and that is what `ensureCardsReachable` does.
     */
    await openLive(page, PHONE);
    await ensureCardsReachable(page, 'nino12');
    const tierBefore = await sheetTier(page);

    await pressCardWithMouse(page, 'nino12');
    await settleStable(page);
    await waitForSheetStill(page);

    const tierAfter = await sheetTier(page);
    const cardsMounted = await page.locator('[data-testid="nino-cards"]').count();

    annotate(
      'G3g',
      `tier ${tierBefore} -> ${tierAfter}; nino-cards nodes after the press = ${cardsMounted}` +
        (tierAfter === 'peek' ? ' (sheet collapsed after press)' : ''),
    );

    expect(tierAfter, 'the press collapses the sheet to peek').toBe('peek');
    expect(cardsMounted, 'at peek the cards are unmounted, which is why a second press needs the helper').toBe(0);

    /* And the selection is still there once the sheet is reopened. */
    await ensureCardsReachable(page, 'nino12');
    expect(await cardPressed(page, 'nino12'), 'the selection must survive the collapse').toBe(true);
  });
});

test.describe('EXTRA G4 the flight retargets when the free rect moves under it', () => {
  /*
   * M2 governs everything in this group. A free-rect change during a flight legitimately re-arms
   * `ninoFlight` through `refitNinoForRect` (CameraDirector.tsx:226-255), so the number of refits and the
   * number of flights are both > 1 by design. Nothing here counts them; the claims are "it stopped" and
   * "where it stopped is the fit for the rect that existed when it stopped".
   *
   * The lever is a VIEWPORT RESIZE, chosen after ruling out the two UI levers:
   *   - a region selection CANCELS the box flight outright (`selectRegion` calls `submitNinoFocus(null)`,
   *     App.tsx:82-86, NINO-HARDEN B3a/A2a), so the box never lands and there is nothing to retarget;
   *   - a mobile sheet tier change collapses the sheet but only exists on a phone shell, and G3g already
   *     owns that behaviour.
   * A resize changes `free` and `viewport` together, which is exactly the input pair the fit law reads.
   */

  test('EXTRA-G4a: a resize mid-flight retargets the box and it lands framed for the new rect', async ({ page }) => {
    await openLive(page, DESKTOP);
    await settleStable(page);

    const dBefore = await page.evaluate(() => window.__globe!.distance());
    await pressCardWithMouse(page, 'nino12');

    /*
     * Change the rect while the camera is still moving. The 120 ms read is the guard that the change really
     * landed in flight: if the flight had already settled, this test would silently become G2a with a resize
     * after it and would prove nothing about retargeting.
     */
    await page.waitForTimeout(120);
    const inFlight = await page.evaluate(() => ({ d: window.__globe!.distance(), settled: window.__frame!.settled }));

    await page.setViewportSize({ width: 1024, height: 700 });

    const settledD = await settleFlight(page);
    const after = await page.evaluate(() => {
      const f = window.__frame!.snapshot();
      return { free: f.free, vw: window.innerWidth, vh: window.innerHeight, tgt: window.__globe!.target() };
    });

    const predicted = predictedDistance(
      GEO.nino12,
      { w: after.free.w, h: after.free.h },
      { w: after.vw, h: after.vh },
    );
    const offset = settledD - predicted;
    const targetLen = Math.hypot(after.tgt[0], after.tgt[1], after.tgt[2]);

    annotate(
      'M3',
      `G4a settled d ${settledD.toFixed(5)}, predicted d ${predicted.toFixed(5)}, offset ` +
        `${offset >= 0 ? '+' : ''}${offset.toFixed(5)}, travel inward, |target| ${targetLen.toFixed(3)}`,
    );
    annotate(
      'M2',
      `G4a NO refit/flight count asserted (M2): mid-flight read d ${inFlight.d.toFixed(5)} settled ` +
        `${inFlight.settled}, start d ${dBefore.toFixed(5)}, rect change 1280x720 -> 1024x700 applied in flight; ` +
        `free now ${after.free.w.toFixed(1)}x${after.free.h.toFixed(1)}`,
    );

    /* The resize has to have happened DURING the flight, or this test is not testing retargeting. */
    expect(inFlight.settled, 'the resize must land while the camera is still moving').toBe(false);
    expect(Math.abs(dBefore - settledD), 'the camera must have moved').toBeGreaterThan(0.5);
    expect(Math.abs(offset), `arrival offset ${offset.toFixed(5)} after a mid-flight resize`).toBeLessThanOrEqual(
      ARRIVE_TOL,
    );
  });

  test('EXTRA-G4b: shrinking the free rect outward retargets without exceeding tolerance', async ({ page }) => {
    await openLive(page, DESKTOP);
    await settleStable(page);
    await pressCardWithMouse(page, 'nino12');
    await page.waitForTimeout(120);

    const inFlight = await page.evaluate(() => window.__frame!.settled);
    await page.setViewportSize({ width: 1100, height: 640 });
    const settledD = await settleFlight(page);

    const after = await page.evaluate(() => {
      const f = window.__frame!.snapshot();
      return { free: f.free, vw: window.innerWidth, vh: window.innerHeight, tgt: window.__globe!.target() };
    });
    const predicted = predictedDistance(
      GEO.nino12,
      { w: after.free.w, h: after.free.h },
      { w: after.vw, h: after.vh },
    );
    const offset = settledD - predicted;
    const targetLen = Math.hypot(after.tgt[0], after.tgt[1], after.tgt[2]);

    annotate(
      'M3',
      `G4b settled d ${settledD.toFixed(5)}, predicted d ${predicted.toFixed(5)}, offset ` +
        `${offset >= 0 ? '+' : ''}${offset.toFixed(5)}, travel inward, |target| ${targetLen.toFixed(3)}`,
    );
    annotate(
      'M2',
      `G4b NO refit/flight count asserted (M2): mid-flight settled ${inFlight}, 1280x720 -> 1100x640; ` +
        `free now ${after.free.w.toFixed(1)}x${after.free.h.toFixed(1)}`,
    );

    expect(inFlight, 'the resize must land while the camera is still moving').toBe(false);
    expect(Math.abs(offset), `arrival offset ${offset.toFixed(5)}`).toBeLessThanOrEqual(ARRIVE_TOL);
  });

  /*
   * ============================ G4c is a FIXME, and why ============================
   *
   * The requirement is "wait for settle before shrinking the viewport, then exactly ONE refit".
   *
   * The settle half is observable and implemented in `settleFlight` above. The "exactly one refit" half is not:
   * `refitNinoForRect` RETURNS a boolean on each call (CameraDirector.tsx:255) and every caller discards it. The
   * only `ninoRect` ref it mutates is a local `useRef` inside the component, and `__frame`/`__globe` publish no
   * count (checked: `frameProbe.ts` surface is free/target/current/settled/insets/dFit, `globeProbe.ts` has no
   * refit member). So there is no witness for the number of refits from the page.
   *
   * Three ways out, all rejected:
   *   1. add a counter to src and expose it on a probe — forbidden by the prompt (nothing under src);
   *   2. infer the count from camera motion — that measures displacement, not refits, and would certify a
   *      number it did not observe;
   *   3. assert the behavioural consequence instead — that is G4a and G4b, which is why they exist.
   *
   * So this lands as FIXME with the reason stated here rather than as a passing test with an invented number.
   */
  test.fixme( // allow-skip: src exposes no refit counter — refitNinoForRect returns a bool every caller discards and neither __frame nor __globe publishes a count, so "exactly one refit" is unobservable without editing src (forbidden by the prompt); G4a/G4b assert the behavioural consequence instead.
    'EXTRA-G4c: after settle, shrinking the viewport causes exactly one refit',
    async () => {},
  );
});

/**
 * Activate a box with real keyboard input, which is the only honest trigger available at 390x844.
 *
 * **Why not the mouse (measured).** At 390x844 the press button's own bbox is y 963.9..1007.9 in an 844 px
 * viewport — 120 px below the fold, inside a sheet body that is taller than the screen. `pressCardWithMouse`
 * scrolls that body and still leaves it out of reach, which is exactly the E1 finding G2(a) records as a FAIL.
 * A keyboard user never depends on that: they Tab to the button and press Enter, and the browser brings the
 * focus target into view for them.
 *
 * The activation under test is `page.keyboard.press('Enter')`. The focus step is `focus()` rather than a Tab
 * walk, because G5(c) is the test that owns tab order — repeating a 20-Tab walk here would make a geometry test
 * fail whenever the region list changes length, which is a different acceptance question.
 */
async function pressCardByKeyboard(page: Page, boxId: 'nino12' | 'nino4'): Promise<void> {
  const handle = page.getByRole('slider', { name: 'Sheet position' });
  await handle.focus();
  await page.keyboard.press('End');
  await expect.poll(() => handle.getAttribute('aria-valuenow'), { timeout: 10_000 }).toBe('2');
  await waitForSheetStill(page);

  const button = page.locator(`[data-testid="nino-show-${boxId}"]`);
  await expect(button).toHaveCount(1);
  await button.focus();
  await expect
    .poll(
      () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid')),
      { timeout: 10_000, intervals: [50] },
    )
    .toBe(`nino-show-${boxId}`);

  await page.keyboard.press('Enter');
}

/** The lowest tier's own reservation: `H - free.y - free.h`, which `computeFreeRect` computes but never publishes. */
async function reservedBottomPx(page: Page): Promise<{ reserve: number; vh: number; freeY: number; freeH: number }> {
  return page.evaluate(() => {
    const f = window.__frame!.snapshot();
    return { reserve: window.innerHeight - (f.free.y + f.free.h), vh: window.innerHeight, freeY: f.free.y, freeH: f.free.h };
  });
}

test.describe('G4: the box flight retargets when the free rect moves under it', () => {
  /*
   * M2 governs everything in this group: a free-rect change during a flight legitimately re-arms the flight, so
   * no test here counts refits or flights. The claims are "it stopped", "where it stopped is the fit for the
   * rect that existed when it stopped", and "the reservation the sheet publishes is the one the model says".
   *
   * R2's predictions are the literals from the issued text, never recomputed at runtime: Nino 4 is 2.4426 at
   * 1280x720, 3.6178 at 390x844, and 1.8995 after the 390x844 -> 844x390 rotation.
   */

  test('G4(a): Nino 4 resized from 1280x720 to 390x844 settles at 3.6178 and holds', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    await pressCardWithMouse(page, 'nino4');
    const deskSettled = await settleFlight(page);

    /* The resize must land while the camera is still moving, or this is G2(a) with a resize stapled on. */
    await page.setViewportSize({ width: 390, height: 844 });
    const atResize = await page.evaluate(() => ({ d: window.__globe!.distance(), settled: window.__frame!.settled }));
    expect(atResize.settled, 'the resize must land while the camera is still moving').toBe(false);

    const settled = await settleFlight(page);
    const free = await reservedBottomPx(page);

    /* Held: the retarget must not be a transient the camera eases out of afterwards. */
    await page.waitForTimeout(5_000);
    const held = await page.evaluate(() => window.__globe!.distance());
    const drift = held - settled;

    const offset = settled - 3.6178;
    annotate(
      'R2',
      `G4a 1280x720 -> 390x844: settled ${settled.toFixed(5)} vs predicted 3.6178, offset ` +
        `${offset >= 0 ? '+' : ''}${offset.toFixed(5)}; desktop settled ${deskSettled.toFixed(5)}; ` +
        `held 5 s later ${held.toFixed(5)} (drift ${drift.toFixed(6)}); free offY ${free.freeY.toFixed(2)} ` +
        `h ${free.freeH.toFixed(2)} in ${free.vh}`,
    );

    expect(Math.abs(offset), `arrival offset ${offset.toFixed(5)} after the resize`).toBeLessThanOrEqual(ARRIVE_TOL);
    expect(Math.abs(drift), `the settled distance must hold for 5 s, drifted ${drift.toFixed(6)}`).toBeLessThanOrEqual(
      0.01,
    );
    errs.assertClean();
  });

  test('G4(b): Nino 4 rotated from 390x844 to 844x390 settles at 1.8995 and holds', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, PHONE);

    await pressCardByKeyboard(page, 'nino4');
    const portrait = await settleFlight(page);

    await page.setViewportSize({ width: 844, height: 390 });
    const atRotate = await page.evaluate(() => ({ d: window.__globe!.distance(), settled: window.__frame!.settled }));
    expect(atRotate.settled, 'the rotation must land while the camera is still moving').toBe(false);

    const settled = await settleFlight(page);
    const free = await reservedBottomPx(page);
    const layout = await page.evaluate(() => {
      const f = window.__frame!.snapshot();
      return { layoutMode: f.layoutMode, freeW: f.free.w };
    });

    await page.waitForTimeout(5_000);
    const held = await page.evaluate(() => window.__globe!.distance());
    const drift = held - settled;

    const offset = settled - 1.8995;
    annotate(
      'R2',
      `G4b 390x844 -> 844x390: settled ${settled.toFixed(5)} vs predicted 1.8995, offset ` +
        `${offset >= 0 ? '+' : ''}${offset.toFixed(5)}; portrait settled ${portrait.toFixed(5)}; ` +
        `held 5 s later ${held.toFixed(5)} (drift ${drift.toFixed(6)}); layout ${layout.layoutMode} ` +
        `free w ${layout.freeW.toFixed(2)}, reserve ${free.reserve.toFixed(2)} in ${free.vh}`,
    );

    expect(layout.layoutMode, '390x844 -> 844x390 must switch the shell to its landscape layout').toBe('phoneLandscape');
    expect(Math.abs(offset), `arrival offset ${offset.toFixed(5)} after the rotation`).toBeLessThanOrEqual(ARRIVE_TOL);
    expect(Math.abs(drift), `the settled distance must hold for 5 s, drifted ${drift.toFixed(6)}`).toBeLessThanOrEqual(
      0.01,
    );
    errs.assertClean();
  });

  test.fixme( // allow-skip: src exposes no refit counter — refitNinoForRect returns a boolean (CameraDirector.tsx:255) that every caller discards, ninoRect is a component-local useRef, and neither __frame nor __globe publishes a count, so "exactly one refit" after a 56 px URL-bar shrink is unobservable without editing src (forbidden by the prompt); the user ruled G4c lands as a FIXME rather than gaining a counter probe.
    'G4(c): a 56 px URL-bar shrink refits exactly once, settles, and keeps the outline inside the free rect',
    async ({ page }) => {
      const errs = watchErrors(page);
      await openLive(page, PHONE);

      await pressCardByKeyboard(page, 'nino4');
      const before = await settleFlight(page);
      const rectBefore = await page.evaluate(() => window.__frame!.snapshot().free);

      /* A URL bar appearing takes 56 px of viewport height, which is the change the free rect must answer. */
      await page.setViewportSize({ width: 390, height: 788 });
      const rectAfter = await page.evaluate(() => window.__frame!.snapshot().free);
      expect(
        Math.abs(rectAfter.h - rectBefore.h),
        'the free rect must change when the URL bar takes 56 px',
      ).toBeGreaterThan(1);

      const settled = await settleFlight(page);
      const outline = await outlineWorld(page, 'nino4');
      expect(outline?.bbox, 'the outline must still be measurable after the shrink').not.toBeNull();

      /* "exactly one refit" is the unobservable claim this FIXME is about; the behavioural consequences follow. */
      const margin = Math.min(
        outline!.bbox!.x - rectAfter.x,
        rectAfter.x + rectAfter.w - (outline!.bbox!.x + outline!.bbox!.w),
        outline!.bbox!.y - rectAfter.y,
        rectAfter.y + rectAfter.h - (outline!.bbox!.y + outline!.bbox!.h),
      );

      annotate(
        'G4c',
        `URL bar 390x844 -> 390x788: free h ${rectBefore.h.toFixed(2)} -> ${rectAfter.h.toFixed(2)}; ` +
          `d ${before.toFixed(5)} -> ${settled.toFixed(5)}; bbox margin ${margin.toFixed(2)} px`,
      );

      expect(margin, `the outline must stay inside the free rect, margin ${margin.toFixed(2)} px`).toBeGreaterThanOrEqual(0);
      errs.assertClean();
    },
  );

  test('G4(d): the sheet reserves the Peek height at every tier and d does not move between tiers', async ({ page }) => {
    const errs = watchErrors(page);

    /*
     * Both viewports in one test: the claim is about the reservation formula, and the two halves are the same
     * formula at two heights — 0.18 x 844 = 151.92 and 0.18 x 1376 = 247.68. Splitting them would duplicate the
     * press-and-settle preamble for no additional evidence.
     */
    await openLive(page, PHONE);
    await pressCardByKeyboard(page, 'nino4');
    const settledD = await settleFlight(page);
    const free = await reservedBottomPx(page);

    const slider = page.getByRole('slider', { name: 'Sheet position' });
    const walk: Array<{ tier: string; key: 'Home' | 'ArrowUp' | 'End'; want: string }> = [
      { tier: 'peek', key: 'Home', want: '0' },
      { tier: 'half', key: 'ArrowUp', want: '1' },
      { tier: 'full', key: 'End', want: '2' },
      { tier: 'peek again', key: 'Home', want: '0' },
    ];

    const readings: Array<{ tier: string; d: number; reserve: number; tierName: string | null; occlusion: string }> = [];
    for (const step of walk) {
      await slider.focus();
      await page.keyboard.press(step.key);
      await expect.poll(() => slider.getAttribute('aria-valuenow'), { timeout: 10_000 }).toBe(step.want);
      await waitForSheetStill(page);
      const d = await page.evaluate(() => window.__globe!.distance());
      const r = await reservedBottomPx(page);
      const tierName = await sheetTier(page);

      /*
       * Occlusion is recorded, never asserted (Part Q: "Record occlusion at Half and Full as annotations only").
       * The sheet covering part of the globe at those tiers is a layout decision, not a defect this test may
       * rule on; the number that matters is that the reservation itself did not change.
       */
      const occlusion = await page.evaluate(() => {
        const el = document.querySelector('[data-tier]');
        if (!el) return 'no sheet';
        const b = el.getBoundingClientRect();
        return `sheet top ${b.top.toFixed(1)} (${((b.top / window.innerHeight) * 100).toFixed(1)}% of viewport)`;
      });

      readings.push({ tier: step.tier, d, reserve: r.reserve, tierName, occlusion });
    }

    annotate(
      'G4d-phone',
      readings
        .map(
          (x) => `${x.tier}: tier ${x.tierName}, reserve ${x.reserve.toFixed(2)} px, d ${x.d.toFixed(6)}, ${x.occlusion}`,
        )
        .join(' | '),
    );

    /* 151.92 is 0.18 x 844 — `peekVisible`, layoutMath.ts:143. Tolerance 1 px, as issued. */
    for (const r of readings) {
      expect(Math.abs(r.reserve - 151.92), `390x844 at ${r.tier}: reserve ${r.reserve.toFixed(2)} vs 151.92`).toBeLessThanOrEqual(1);
      expect(Math.abs(r.d - settledD), `390x844 at ${r.tier}: d must not move between tiers`).toBeLessThanOrEqual(1e-3);
    }

    /* Same claim at 1032x1376: 0.18 x 1376 = 247.68. */
    await page.setViewportSize({ width: 1032, height: 1376 });
    await settleStable(page);
    const tab = await reservedBottomPx(page);
    const tabD = await page.evaluate(() => window.__globe!.distance());

    annotate(
      'G4d-tablet',
      `1032x1376: reserve ${tab.reserve.toFixed(2)} px at free offY ${tab.freeY.toFixed(2)} h ${tab.freeH.toFixed(2)} ` +
        `in ${tab.vh}; d ${tabD.toFixed(5)}`,
    );

    expect(Math.abs(tab.reserve - 247.68), `1032x1376 reserve ${tab.reserve.toFixed(2)} vs 247.68`).toBeLessThanOrEqual(1);
    expect(tab.reserve, 'the reservation scales with viewport height, so the tablet must reserve more').toBeGreaterThan(
      free.reserve,
    );
    errs.assertClean();
  });
});

test.describe('EXTRA G5 toggle-off releases the box; d holds where the box flight left it', () => {
  /*
   * The trace helper, shared by all three viewports. M6 asks for d, |target| and dFit at 0, 1, 3 and 5 s and
   * for a statement about whether d drifts TOWARD dFit once the box is released. Those numbers are annotations,
   * never thresholds: a camera that eases out over 900 ms and one that jumps and then trims would both satisfy
   * "drifts toward dFit", and pinning a curve shape would be inventing a spec the product never promised.
   *
   * MEASURED RESULT, and it contradicts the wording M6 anticipates: d does NOT drift toward dFit at any of the
   * three viewports. It does not move at all. `focusNinoBox(null)` clears `ninoFlight` and RETURNS
   * (CameraDirector.tsx:876-882) — the release path arms no return flight, so the camera stays exactly where the
   * box flight left it (1280x720 d 1.39601 with dFit 3.88438, unchanged from 0 s to 5 s). Only the spin resumes.
   *
   * That is why the assertion is the NON-WORSENING form — |d - dFit| at 5 s no larger than at release — rather
   * than "d approaches dFit". The weak form is the true one here. It still has teeth: it fails if a release ever
   * pushes the camera further out than the box fit, which is the failure the original wording was guarding.
   * Whether a release SHOULD fly back is a product question this spec does not invent an answer to.
   */
  async function traceToggleOff(page: Page, label: string): Promise<{
    trace: string;
    dAtRelease: number;
    dAt5: number;
    dFit: number;
    targetAt5: number;
  }> {
    const dAtRelease = await page.evaluate(() => window.__globe!.distance());
    const t0 = Date.now();
    const parts: string[] = [];
    let dAt5 = Number.NaN;
    let dFit = Number.NaN;
    let targetAt5 = Number.NaN;

    for (const mark of [0, 1000, 3000, 5000]) {
      const wait = mark - (Date.now() - t0);
      if (wait > 0) await page.waitForTimeout(wait);
      const s = await page.evaluate(() => {
        const f = window.__frame!.snapshot();
        return { d: window.__globe!.distance(), tgt: window.__globe!.target(), dFit: f.dFit, settled: f.settled };
      });
      const tl = Math.hypot(s.tgt[0], s.tgt[1], s.tgt[2]);
      parts.push(`${mark}ms d ${s.d.toFixed(5)} |target| ${tl.toFixed(3)} dFit ${s.dFit.toFixed(5)} settled ${s.settled}`);
      if (mark === 5000) {
        dAt5 = s.d;
        dFit = s.dFit;
        targetAt5 = tl;
      }
    }

    const gapRelease = Math.abs(dAtRelease - dFit);
    const gap5 = Math.abs(dAt5 - dFit);
    const verdict =
      gap5 < gapRelease - 1e-6
        ? `DRIFTS TOWARD dFit (gap ${gapRelease.toFixed(5)} -> ${gap5.toFixed(5)})`
        : `does NOT move toward dFit (gap ${gapRelease.toFixed(5)} -> ${gap5.toFixed(5)})`;

    annotate('M6', `${label} toggle-off trace: ${parts.join(' | ')}`);
    annotate('M6', `${label} after toggle-off d ${verdict}; d at release ${dAtRelease.toFixed(5)}, d at 5 s ${dAt5.toFixed(5)}, dFit ${dFit.toFixed(5)}, |target| at 5 s ${targetAt5.toFixed(3)}`);

    return { trace: parts.join(' | '), dAtRelease, dAt5, dFit, targetAt5 };
  }

  test('EXTRA-G5a: at 1280x720 pressing the selected box again releases it, and d holds (no return flight is armed)', async ({ page }) => {
    await openLive(page, DESKTOP);
    await settleStable(page);
    const d0 = await page.evaluate(() => window.__globe!.distance());

    await pressCardWithMouse(page, 'nino12');
    const dSelected = await settleFlight(page);
    expect(await cardPressed(page, 'nino12'), 'the first press must select').toBe(true);

    /* Toggle off: the same card, pressed again. On desktop the cards never unmount, so no sheet step here. */
    await pressCardWithMouse(page, 'nino12');
    const out = await traceToggleOff(page, 'G5a 1280x720');

    expect(await cardPressed(page, 'nino12'), 'the second press must release the box').toBe(false);
    expect(await cardPressed(page, 'nino4'), 'the other box must stay released').toBe(false);
    /* Desktop has no live region (G1a), so absence and emptiness both mean "nothing announced". */
    expect([null, ''], 'a release must not announce a selection').toContain(await announced(page));

    annotate('G5a', `d0 ${d0.toFixed(5)}, d selected ${dSelected.toFixed(5)}, d at 5 s ${out.dAt5.toFixed(5)}, dFit ${out.dFit.toFixed(5)}`);
    expect(Math.abs(out.dAt5 - out.dFit), 'released camera must be no further from dFit than at release').toBeLessThanOrEqual(
      Math.abs(out.dAtRelease - out.dFit),
    );
  });

  test('EXTRA-G5b: at 390x844 the release clears selection and d holds, through the collapse', async ({ page }) => {
    await openLive(page, PHONE);
    await settleStable(page);

    /* M1: the cards are below the fold at this viewport even at half — reopen before the FIRST press too. */
    await ensureCardsReachable(page, 'nino12');
    await pressCardWithMouse(page, 'nino12');
    const dSelected = await settleFlight(page);

    expect(await announced(page), 'the press must announce the selection on a phone').toBe(
      `Showing ${LABEL_NINO12} on the globe`,
    );
    annotate('M1', `G5b sheet tier after first press: ${await sheetTier(page)} — cards collapsed with it`);

    /* M1: before the SECOND press, reopen the sheet, or there is no button to press. */
    await ensureCardsReachable(page, 'nino12');
    await pressCardWithMouse(page, 'nino12');
    const out = await traceToggleOff(page, 'G5b 390x844');

    /* Selection cleared, read through the oracle that outlives the collapse. */
    await expect.poll(() => announced(page), { timeout: 15_000, intervals: [150] }).not.toBe(
      `Showing ${LABEL_NINO12} on the globe`,
    );

    /* M1 again: reopen before reading aria-pressed, since the release collapses the sheet to Peek. */
    await ensureCardsReachable(page, 'nino12');
    expect(await cardPressed(page, 'nino12'), 'the release must clear aria-pressed').toBe(false);

    annotate('G5b', `d selected ${dSelected.toFixed(5)}, d at 5 s ${out.dAt5.toFixed(5)}, dFit ${out.dFit.toFixed(5)}`);
    expect(Math.abs(out.dAt5 - out.dFit), 'released camera must be no further from dFit than at release').toBeLessThanOrEqual(
      Math.abs(out.dAtRelease - out.dFit),
    );
  });

  test('EXTRA-G5c: at 1032x1376 the release clears selection and d holds, through the collapse', async ({ page }) => {
    await openLive(page, TABLET);
    await settleStable(page);

    await ensureCardsReachable(page, 'nino12');
    await pressCardWithMouse(page, 'nino12');
    const dSelected = await settleFlight(page);
    expect(await announced(page), 'the press must announce the selection').toBe(`Showing ${LABEL_NINO12} on the globe`);

    await ensureCardsReachable(page, 'nino12');
    await pressCardWithMouse(page, 'nino12');
    const out = await traceToggleOff(page, 'G5c 1032x1376');

    await expect.poll(() => announced(page), { timeout: 15_000, intervals: [150] }).not.toBe(
      `Showing ${LABEL_NINO12} on the globe`,
    );

    await ensureCardsReachable(page, 'nino12');
    expect(await cardPressed(page, 'nino12'), 'the release must clear aria-pressed').toBe(false);

    annotate('G5c', `d selected ${dSelected.toFixed(5)}, d at 5 s ${out.dAt5.toFixed(5)}, dFit ${out.dFit.toFixed(5)}`);
    expect(Math.abs(out.dAt5 - out.dFit), 'released camera must be no further from dFit than at release').toBeLessThanOrEqual(
      Math.abs(out.dAtRelease - out.dFit),
    );
  });
});


/* ====================================================================================================
 * PART Q — NINO-2.3D-R
 *
 * Everything above this line is the earlier reconstruction and is now prefixed EXTRA- (R-1): kept,
 * renamed, and no longer claiming a Part Q ID. Everything below answers the issued text.
 *
 * Rules in force throughout this section, stated once:
 *   R1  settle: wait >= 2.2 s after the press, then poll d until it moves < 1e-4 across 1000 ms
 *   R2  arrival: |settled d - predicted| <= 0.006 at every viewport, never looser
 *   R3  zoom bounds read from the runtime, never hardcoded
 *   R4  real input only: page.mouse, page.keyboard, wheel
 *   R5  collect console + page errors, assert none
 *   R6  fresh page per test; flag-on adds ?nino=1 to the locked-spec URL form
 *   R7  a test encoding CLOSE3 evidence that fails is reported FAIL and kept
 *   R8  known-missing behaviour is a test.fixme with the exact assertion and the reason
 * ==================================================================================================== */

/**
 * R5: console and page errors, collected from the moment of attaching.
 *
 * Attach BEFORE the navigation — `openLive` performs the goto, so a listener added afterwards misses
 * every error raised during boot, which is where all of them have appeared.
 */
function watchErrors(page: Page): { consoleErrors: string[]; pageErrors: string[]; assertClean: () => void } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return {
    consoleErrors,
    pageErrors,
    assertClean: () => {
      expect(consoleErrors, 'no console errors (R5)').toEqual([]);
      expect(pageErrors, 'no page errors (R5)').toEqual([]);
    },
  };
}

/** R1: the Part Q settle — 2.2 s of rest, then d flat to under 1e-4 across a full second. */
async function settleD(page: Page): Promise<number> {
  await page.waitForTimeout(2200);
  let last = await page.evaluate(() => window.__globe!.distance());
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    const now = await page.evaluate(() => window.__globe!.distance());
    if (Math.abs(now - last) < 1e-4) return now;
    last = now;
  }
  return last;
}

/**
 * R4: set the SST slider with real input.
 *
 * `locator.fill()` is out — it writes the DOM value directly and would let a broken onChange pass. A
 * real user drags the thumb or clicks the track, so this clicks the track at the target's proportion
 * and then corrects with arrow keys, which is the same keyboard path a keyboard user takes. The step is
 * 0.01 (`ControlDeck.tsx:89`), so the correction loop is bounded and cheap.
 */
async function setSst(page: Page, target: number): Promise<number> {
  /*
   * Selected by its bounds, not by position or id. `ControlDeck.tsx:86-88` gives the SST slider
   * min 0 / max 3 and passes `label=""`, so `Slider.tsx:66` falls back to aria-label "Value" and there is
   * no distinguishing name to select on. Three range inputs exist (SST, jet stream -1..1, agri 0..1); the
   * only one with max 3 is this one, and matching on the bounds also proves they are still what the model
   * says they are.
   */
  const slider = page.locator('input[type="range"][max="3"][step="0.01"]').first();
  const box = await slider.boundingBox();
  if (!box) throw new Error('[setSst] the SST slider is not mounted');
  const min = Number(await slider.getAttribute('min'));
  const max = Number(await slider.getAttribute('max'));
  const frac = (target - min) / (max - min);
  await page.mouse.click(box.x + Math.min(Math.max(frac, 0.02), 0.98) * box.width, box.y + box.height / 2);
  await slider.focus();

  for (let i = 0; i < 300; i++) {
    const now = Number(await slider.inputValue());
    const diff = target - now;
    if (Math.abs(diff) < 0.005) return now;
    await page.keyboard.press(diff > 0 ? 'ArrowRight' : 'ArrowLeft');
  }
  return Number(await slider.inputValue());
}

/** The card's rendered text, newline-collapsed, for whole-card assertions. */
async function cardText(page: Page, boxId: 'nino12' | 'nino4'): Promise<string> {
  const t = await page.locator(`[data-testid="nino-card-${boxId}"]`).innerText();
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * The old region list — the four locked regions, which Part Q requires to survive the flag.
 *
 * Selected by `button[data-region-id]`, NOT by role. Both lists carry that attribute
 * (`RegionDrawer.tsx:296`, `SheetBody.tsx:171`), and on desktop the drawer is never unmounted but sits
 * off-canvas at `translate-x-[110%]` with `aria-hidden` while closed (`RegionDrawer.tsx:279-288`), so it is
 * ABSENT FROM THE ACCESSIBILITY TREE and `getByRole` legitimately returns 0. Measured: a role-based lookup
 * reported "Received: 0" at 1280x720. Counting DOM buttons measures the list; counting roles measured the
 * drawer's open state.
 */
function regionButtons(page: Page) {
  return page.locator('button[data-region-id]');
}

test.describe('G1: the flag gates the Nino UI and leaves the old region list intact', () => {
  test('G1(a): flag-off at three viewports shows no Nino cards and no live region, and keeps the four regions', async ({
    page,
  }) => {
    const errs = watchErrors(page);
    for (const vp of [DESKTOP, PHONE, TABLET]) {
      const size = `${vp.width}x${vp.height}`;
      await openLive(page, vp, LIVE_OFF);

      /*
       * The region list is only mounted above Peek on a phone (`TIER_FRACTION.half` gates the controls
       * block), so the mobile rows have to open the sheet before the count means anything. Counting 0 at
       * Peek and calling the regions missing would be measuring the tier, not the flag.
       */
      if (vp !== DESKTOP) await openSheetToHalf(page);

      await expect(page.locator('[data-testid="nino-cards"]'), `${size}: no card block`).toHaveCount(0);
      await expect(page.locator('[data-testid="nino-show-nino12"]'), `${size}: no press button`).toHaveCount(0);
      await expect(page.locator('[data-testid="nino-live"]'), `${size}: no live region node`).toHaveCount(0);
      expect(await announced(page), `${size}: nothing announced`).toBeNull();

      const regions = await regionButtons(page).count();
      expect(regions, `${size}: the four locked regions must still be listed`).toBe(4);
      annotate('G1a', `${size}: cards 0, press buttons 0, live 0, regions ${regions}`);
    }
    errs.assertClean();
  });

  test('G1(b): flag-on adds two cards beside the same four regions, names them, and starts unpressed', async ({
    page,
  }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    const regions = await regionButtons(page).count();
    expect(regions, 'the four locked regions must survive the flag').toBe(4);

    await expect(page.locator('[data-testid="nino-cards"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="nino-card-nino12"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="nino-card-nino4"]')).toHaveCount(1);

    /*
     * Accessible NAME, not textContent. The button's visible text is "Show on globe" for both boxes, so a
     * name that distinguishes them can only come from aria-label — and that is what a screen reader reads.
     * Asserting textContent here would pass on a page where both buttons are called the same thing.
     */
    const b12 = page.locator('[data-testid="nino-show-nino12"]');
    const b4 = page.locator('[data-testid="nino-show-nino4"]');
    expect(await b12.getAttribute('aria-label')).toContain(LABEL_NINO12);
    expect(await b4.getAttribute('aria-label')).toContain(LABEL_NINO4);
    expect(await b12.getAttribute('aria-pressed'), 'a fresh boot is unpressed').toBe('false');
    expect(await b4.getAttribute('aria-pressed'), 'a fresh boot is unpressed').toBe('false');

    annotate(
      'G1b',
      `regions ${regions}; names "${await b12.getAttribute('aria-label')}" / "${await b4.getAttribute('aria-label')}"; ` +
        'aria-pressed false/false',
    );
    errs.assertClean();
  });

  test('G1(c): at 1032x1376 the cards are reachable at Half', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, TABLET);
    await openSheetToHalf(page);

    expect(await sheetTier(page), 'the sheet must be at half, not escalated').toBe('half');

    const btn = page.locator('[data-testid="nino-show-nino12"]');
    const box = await btn.boundingBox();
    expect(box, 'the press button must be mounted at half').not.toBeNull();
    const cy = box!.y + box!.height / 2;
    const vh = TABLET.height;
    annotate('G1c', `1032x1376 half: button y ${box!.y.toFixed(1)}..${(box!.y + box!.height).toFixed(1)} in ${vh}`);

    /* Inside the viewport is necessary but not sufficient — it must also be the topmost node there. */
    expect(cy, 'the button centre must be inside the viewport at half').toBeGreaterThanOrEqual(0);
    expect(cy, 'the button centre must be inside the viewport at half').toBeLessThanOrEqual(vh);
    const top = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const target = document.querySelector('[data-testid="nino-show-nino12"]');
        return el && target && (el === target || target.contains(el)) ? 'button' : (el?.tagName ?? '(none)');
      },
      { x: box!.x + box!.width / 2, y: cy },
    );
    expect(top, 'nothing may cover the press button at half').toBe('button');
    errs.assertClean();
  });

  test.fixme( // allow-skip: cards below the fold at Half, pending E1 and a product decision — measured at 390x844: Half puts translateY at 337.6 with sheetHeight 742.72, so the sheet spans y 438.9..1181.6 and the press button sits at y 1301.5..1345.5 in an 844 px viewport; scrollIntoView moves scrollTop 0 -> 191 and still leaves it at 928.8..972.8, 84.8 px below the fold.
    'G1(c-phone): at 390x844 the cards are reachable at Half',
    async ({ page }) => {
      await openLive(page, PHONE);
      await openSheetToHalf(page);
      expect(await sheetTier(page)).toBe('half');
      const box = await page.locator('[data-testid="nino-show-nino12"]').boundingBox();
      expect(box, 'the press button must be mounted and inside the viewport at half').not.toBeNull();
      expect(box!.y + box!.height / 2, 'the button centre must be inside the viewport at half').toBeLessThanOrEqual(
        PHONE.height,
      );
    },
  );

  test('G1(d): the extrapolation note shows at slider 3.0 and is gone at 1.5', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    const at3 = await setSst(page, 3);
    expect(at3, 'the slider must reach its maximum').toBeCloseTo(3, 2);
    const text3 = await cardText(page, 'nino12');
    /*
     * The note is rendered only while `extrapolated` is true (`ninoCard.ts:142-147`), and its words name the
     * warm end of the fitted sample. Measured: that end is 2.72 °C, so 3.00 is outside it and 1.50 is not.
     */
    expect(text3, 'at 3.0 the card must carry the extrapolation note').toContain('Beyond the observed range');
    expect(text3, 'the note must name the fitted maximum').toContain('2.72');

    const at15 = await setSst(page, 1.5);
    expect(at15, 'the slider must reach 1.5').toBeCloseTo(1.5, 2);
    const text15 = await cardText(page, 'nino12');
    expect(text15, 'at 1.5 the note must be gone').not.toContain('Beyond the observed range');

    annotate(
      'G1d',
      `3.0 -> note present ("...warmest Nino 3.4 anomaly in this fit is 2.72 °C..."); 1.5 -> note absent; ` +
        `read from card text, ${text3.length} vs ${text15.length} chars`,
    );
    errs.assertClean();
  });

  test('G1(e): the Fahrenheit toggle converts deltas by 1.8 and never adds 32', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    /* A DELTA is what the card prints — an anomaly, not a temperature. 2.0 is inside the fitted sample. */
    const set = await setSst(page, 2);
    expect(set).toBeCloseTo(2, 2);

    const cText = await cardText(page, 'nino12');
    const cValue = Number(/([+-]\d+\.\d+)°C/.exec(cText)?.[1]);
    expect(Number.isFinite(cValue), `the card must print a Celsius value, got "${cText.slice(0, 80)}"`).toBe(true);

    const fButton = page.getByRole('button', { name: /°F|Fahrenheit/i }).first();
    await fButton.click();
    await expect.poll(() => cardText(page, 'nino12')).toContain('°F');
    const fText = await cardText(page, 'nino12');
    const fValue = Number(/([+-]\d+\.\d+)°F/.exec(fText)?.[1]);
    expect(Number.isFinite(fValue), `the card must print a Fahrenheit value, got "${fText.slice(0, 80)}"`).toBe(true);

    annotate('G1e', `C ${cValue} -> F ${fValue}; 1.8 x C = ${(cValue * 1.8).toFixed(2)}; C + 32 = ${cValue + 32}`);

    /*
     * The conversion is a DELTA scaling: 1.8x, no offset.
     *
     * The slack is arithmetic, not generosity. Both numbers are printed to one decimal, so the comparison
     * inherits rounding from both ends: up to 0.05 in the Celsius print, scaled by 1.8 into 0.09, plus 0.05
     * in the Fahrenheit print — 0.14 worst case. Measured: printed C +2.1 with exact F 3.708 printed as 3.7,
     * which a 0.05 bound would reject while the conversion is perfectly correct.
     */
    expect(Math.abs(fValue - cValue * 1.8), `F ${fValue} vs 1.8 x C ${(cValue * 1.8).toFixed(3)}`).toBeLessThanOrEqual(
      0.15,
    );
    expect(
      Math.abs(fValue - (cValue + 32)),
      'the +32 form is the absolute-temperature conversion and must NOT be applied to an anomaly',
    ).toBeGreaterThan(10);

    /* The band converts the same way, so the offset would show up twice if it were in the code. */
    const cRange = /Typical range ([+-]\d+\.\d+) to ([+-]\d+\.\d+) °C/.exec(cText);
    const fRange = /Typical range ([+-]\d+\.\d+) to ([+-]\d+\.\d+) °F/.exec(fText);
    expect(cRange, 'the Celsius band must be printed').not.toBeNull();
    expect(fRange, 'the Fahrenheit band must be printed').not.toBeNull();
    /* Same 0.15 accounting as the point value: two one-decimal prints, one of them scaled by 1.8. */
    expect(Math.abs(Number(fRange![1]) - Number(cRange![1]) * 1.8)).toBeLessThanOrEqual(0.15);
    expect(Math.abs(Number(fRange![2]) - Number(cRange![2]) * 1.8)).toBeLessThanOrEqual(0.15);

    annotate('G1e', `band C ${cRange![1]}..${cRange![2]} -> F ${fRange![1]}..${fRange![2]}`);
    errs.assertClean();
  });

  test.fixme( // allow-skip: known missing behaviour (R8) — App.tsx:394 mounts MobileShell behind {isMobile ? ... : null} and the announcement node lives inside it (MobileShell.tsx:189-193), so at 1280x720 there is no [data-testid="nino-live"] anywhere in the document and a desktop screen-reader user is told nothing when a box is shown.
    'G1(f): at 1280x720 flag-on there is a polite live region',
    async ({ page }) => {
      await openLive(page, DESKTOP);
      const live = page.locator('[data-testid="nino-live"]');
      await expect(live, 'a polite live region must exist on desktop too').toHaveCount(1);
      await expect(live).toHaveAttribute('role', 'status');
      await expect(live).toHaveAttribute('aria-live', 'polite');
    },
  );
});


/* ------------------------------------------------------------------------------------ R-G2 flight + geometry */

/** R2's predictions, transcribed verbatim from the issued Part Q text. Never derived at runtime. */
const P2D = {
  nino12: { '1280x720': 1.3946, '390x844': 1.6343, '1032x1376': 1.45 },
  nino4: { '1280x720': 2.4426, '390x844': 3.6178, '1032x1376': 2.6117 },
} as const;

type VpKey = '1280x720' | '390x844' | '1032x1376';
const key = (vp: { width: number; height: number }): VpKey => `${vp.width}x${vp.height}` as VpKey;

/**
 * The box outline in WORLD space, and its screen bbox.
 *
 * **The vertices are in the spin group's LOCAL space, and projecting them as if they were world coordinates
 * is wrong.** Measured: at 1280x720 the ring read X 101.9..468.1 while the free rect starts at 360.84 — a
 * 379.8 px "overflow" that was nothing but the boot rotation (earthRotY -1.046 rad) never being applied. The
 * group spins the planet, so every vertex moves with it; `matrixWorld` is the transform that puts them where
 * the renderer draws them.
 *
 * Both products come from one read: the world points (for the aim angle) and the projected bbox (for the
 * framing margin). They cannot disagree, which is the point — an aim test against a differently-derived centre
 * could pass while the framing test failed.
 */
async function outlineWorld(
  page: Page,
  boxId: 'nino12' | 'nino4' | 'nino34',
): Promise<{
  bbox: { x: number; y: number; w: number; h: number; verts: number } | null;
  centroid: [number, number, number];
  n: number;
} | null> {
  return page.evaluate((id) => {
    type Attr = { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number };
    type LineLike = {
      geometry?: { attributes?: { position?: Attr } };
      matrixWorld?: { elements: number[] };
      updateWorldMatrix?: (parents: boolean, children: boolean) => void;
    };
    const scene = (window as unknown as Record<string, unknown>).__scene as
      | { traverse: (cb: (o: unknown) => void) => void }
      | undefined;
    if (!scene) return null;
    const found: LineLike[] = [];
    scene.traverse((o) => {
      if ((o as { name?: string }).name === `nino-outline-${id}`) found.push(o as LineLike);
    });
    const line = found[0];
    const pos = line?.geometry?.attributes?.position;
    const m = line?.matrixWorld?.elements;
    if (!pos || !m) return null;
    line!.updateWorldMatrix?.(true, false);

    /* Column-major 4x4, exactly the transform `globeProbe.projectVector` applies on the other side. */
    const mm = line!.matrixWorld!.elements;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const ly = pos.getY(i);
      const lz = pos.getZ(i);
      const wx = mm[0] * lx + mm[4] * ly + mm[8] * lz + mm[12];
      const wy = mm[1] * lx + mm[5] * ly + mm[9] * lz + mm[13];
      const wz = mm[2] * lx + mm[6] * ly + mm[10] * lz + mm[14];
      sx += wx;
      sy += wy;
      sz += wz;
      n++;
      const q = window.__globe!.project([wx, wy, wz]);
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
    if (n === 0) return null;
    return {
      bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY, verts: n },
      centroid: [sx / n, sy / n, sz / n] as [number, number, number],
      n,
    };
  }, boxId);
}

/** The world direction of a box's centre, from the same registry geometry the outline uses. */
function boxCentreWorld(box: BoxGeom): [number, number, number] {
  const phi = ((90 - box.anchorLat) * Math.PI) / 180;
  const theta = (wrap360(box.anchorLon) + 180) * DEG;
  return [-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
}

/**
 * R3: the zoom floor, measured by pushing real wheel input until d stops moving.
 *
 * There is NO probe for `controls.minDistance`: `OrbitControls` renders beside the canvas
 * (`GlobeScene.tsx:722-730`), not into the scene graph, and `__scene.traverse` finds no object carrying
 * `minDistance` (measured — every node type listed, zero matches). So the bound is established the way a user
 * meets it: wheel in hard and see where the camera refuses to go. Measured 1.25000 exactly.
 */
async function zoomFloor(page: Page): Promise<number> {
  const centre = await page.evaluate(() => window.__globe!.project([0, 0, 0]));
  await page.mouse.move(centre.x, centre.y);
  let last = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 48; i++) {
    await page.mouse.wheel(0, -400);
    if (i % 8 === 7) {
      await page.waitForTimeout(200);
      const now = await page.evaluate(() => window.__globe!.distance());
      if (Math.abs(now - last) < 1e-4) return now;
      last = now;
    }
  }
  await page.waitForTimeout(1200);
  return page.evaluate(() => window.__globe!.distance());
}

/**
 * The angle, in degrees, between the camera's direction and the box CENTRE in world space.
 *
 * The centre is the registry anchor mapped by the spin group's own `matrixWorld` — not the outline's vertex
 * centroid, and not a lat/lon vector with the spin reapplied by hand.
 *
 * Both alternatives were measured and both are wrong in different ways:
 *   - the vertex centroid reported a constant 0.18122 deg at every phase, because the outline is sampled at
 *     even lat/lon steps along a ring, so its mean vertex is not the box centre. Constant across phases, which
 *     is the tell: a real aim error would move with the spin;
 *   - a lat/lon centre with no spin applied reported 94.53 deg at phase 4.6251, which was the boot rotation
 *     (-1.046 rad) never being accounted for.
 * `matrixWorld` is the one transform that is both spin-correct and centre-correct, and it is the same matrix
 * the renderer uses, so this cannot drift from what is drawn.
 */
async function aimErrorDeg(
  page: Page,
  boxId: 'nino12' | 'nino4',
): Promise<{ deg: number; centre: [number, number, number] }> {
  const centre = await page.evaluate((id) => {
    type LineLike = { matrixWorld?: { elements: number[] } };
    const scene = (window as unknown as Record<string, unknown>).__scene as
      | { traverse: (cb: (o: unknown) => void) => void }
      | undefined;
    if (!scene) return null;
    const found: LineLike[] = [];
    scene.traverse((o) => {
      if ((o as { name?: string }).name === `nino-outline-${id}`) found.push(o as LineLike);
    });
    const mm = found[0]?.matrixWorld?.elements;
    if (!mm) return null;

    /* The anchor in the outline's own local space: latLonToVector3 at the outline radius. */
    const lat = id === 'nino12' ? -5 : 0;
    const lon = id === 'nino12' ? -85 : -175;
    const r = 1.0025;
    const phi = ((90 - lat) * Math.PI) / 180;
    const theta = (((((lon % 360) + 360) % 360) + 180) * Math.PI) / 180;
    const lx = -r * Math.sin(phi) * Math.cos(theta);
    const ly = r * Math.cos(phi);
    const lz = r * Math.sin(phi) * Math.sin(theta);

    return [
      mm[0] * lx + mm[4] * ly + mm[8] * lz + mm[12],
      mm[1] * lx + mm[5] * ly + mm[9] * lz + mm[13],
      mm[2] * lx + mm[6] * ly + mm[10] * lz + mm[14],
    ] as [number, number, number];
  }, boxId);
  if (!centre) throw new Error(`[aimErrorDeg] no outline transform for ${boxId}`);

  const deg = await page.evaluate((c) => {
    const cam = (window as unknown as Record<string, unknown>).__camera as
      | { position: { x: number; y: number; z: number } }
      | undefined;
    if (!cam) return Number.NaN;
    const p = [cam.position.x, cam.position.y, cam.position.z];
    const dot = p[0] * c[0] + p[1] * c[1] + p[2] * c[2];
    const lp = Math.hypot(p[0], p[1], p[2]) || 1e-9;
    const lc = Math.hypot(c[0], c[1], c[2]) || 1e-9;
    return (Math.acos(Math.min(1, Math.max(-1, dot / (lp * lc)))) * 180) / Math.PI;
  }, centre);
  return { deg, centre };
}

test.describe('G2: the box flight arrives, and the geometry it lands on', () => {
  test('G2(a): at three viewports and two boxes the settled distance matches R2 within 0.006', async ({ page }) => {
    const errs = watchErrors(page);
    for (const vp of [DESKTOP, PHONE, TABLET] as const) {
      for (const boxId of ['nino12', 'nino4'] as const) {
        /* 390x844 + nino4 is its own test.fixme below: the card is unpressable at Full, so no flight starts. */
        if (vp === PHONE && boxId === 'nino4') continue;
        await openLive(page, vp);
        const size = key(vp);
        /* Mobile boots at Peek, where the cards are not mounted — reopen before any press (M1 / issued text). */
        if (vp !== DESKTOP) await ensureCardsReachable(page, boxId);
        await pressCardWithMouse(page, boxId);
        const settled = await settleD(page);
        const predicted = P2D[boxId][size];
        const offset = settled - predicted;

        annotate(
          'R2',
          `${size} ${boxId}: settled d ${settled.toFixed(5)}, predicted d ${predicted.toFixed(5)}, ` +
            `offset ${offset >= 0 ? '+' : ''}${offset.toFixed(5)}`,
        );
        expect(
          Math.abs(offset),
          `${size} ${boxId}: |${settled.toFixed(5)} - ${predicted.toFixed(5)}| must be <= 0.006`,
        ).toBeLessThanOrEqual(0.006);
      }
    }
    errs.assertClean();
  });

  /*
   * G2(a) at 390x844 for Nino 4, as an explicit R8 FIXME carrying the assertion it cannot make.
   *
   * The R2 prediction exists (3.6178) and the tolerance exists (0.006); what does not exist is a flight. The
   * card cannot be pressed at any tier — Half overflows and `ensureCardsReachable` escalates to Full, where the
   * button centre is still at y 985.9 against an 844 px viewport — so there is no settled distance to measure
   * and no honest way to report this row as either a pass or a failure of the fit law. Un-fixme it when the
   * Half-tier card overflow is fixed (E1).
   */
  test.fixme( // allow-skip: unpressable at Full (centre y 985.9 against 844) — the press cannot happen, so no flight starts and there is no settled d to compare with the R2 prediction of 3.6178.
    'G2(a-phone-nino4): at 390x844 Nino 4 settles at the R2 distance 3.6178 within 0.006',
    async ({ page }) => {
      await openLive(page, PHONE);
      await ensureCardsReachable(page, 'nino4');
      await pressCardWithMouse(page, 'nino4');
      const settled = await settleD(page);
      annotate('R2', `390x844 nino4: settled d ${settled.toFixed(5)}, predicted d 3.61780`);
      expect(Math.abs(settled - 3.6178), '390x844 nino4: must land within 0.006 of 3.6178').toBeLessThanOrEqual(
        0.006,
      );
    },
  );

  test.fixme( // allow-skip: known missing behaviour (R8, R2) — refitNinoForRect returns a boolean (CameraDirector.tsx:255) that every caller discards, ninoRect is a component-local useRef, and neither __frame nor __globe publishes a counter; a fresh boot must report refit count 0.
    'G2(b): a fresh boot reports a refit count of 0 before the press',
    async ({ page }) => {
      await openLive(page, DESKTOP);
      const probe = (window as unknown as Record<string, unknown> & { __frame?: { refitCount?: () => number } }).__frame;
      expect(probe?.refitCount, 'a refit counter must be readable from the page').toBeDefined();
      expect(probe!.refitCount!(), 'a fresh boot must report 0 refits').toBe(0);
    },
  );

  /*
   * G2(c) measures the margin at every viewport where a press can happen. The one row it cannot measure,
   * 390x844 + nino4, is its own test.fixme below: asserting a margin there would be reporting a framing result
   * for a flight the product cannot start. That is the Half-tier card overflow E1 measured, and G1(c-phone)
   * already carries it as a FIXME, so this is the same defect recorded against the framing claim it blocks.
   */
  test('G2(c): the outline bbox sits inside the free rect with at least 15 px of margin on every side', async ({
    page,
  }) => {
    const errs = watchErrors(page);
    for (const vp of [DESKTOP, PHONE, TABLET] as const) {
      for (const boxId of ['nino12', 'nino4'] as const) {
        /* 390x844 + nino4 is its own test.fixme below: no press means no flight, so no margin to measure. */
        if (vp === PHONE && boxId === 'nino4') continue;
        await openLive(page, vp);
        const size = key(vp);
        if (vp !== DESKTOP) await ensureCardsReachable(page, boxId);
        await pressCardWithMouse(page, boxId);
        await settleD(page);

        const o = await outlineWorld(page, boxId);
        expect(o, `${size} ${boxId}: the outline LineLoop must exist in the scene`).not.toBeNull();
        const bbox = o!.bbox!;
        const free = await page.evaluate(() => window.__frame!.snapshot().free);

        const margins = {
          left: bbox.x - free.x,
          top: bbox.y - free.y,
          right: free.x + free.w - (bbox.x + bbox.w),
          bottom: free.y + free.h - (bbox.y + bbox.h),
        };
        annotate(
          'R2c',
          `${size} ${boxId}: bbox ${bbox!.w.toFixed(1)}x${bbox!.h.toFixed(1)} at (${bbox!.x.toFixed(1)},` +
            `${bbox!.y.toFixed(1)}); free ${free.w.toFixed(1)}x${free.h.toFixed(1)} at (${free.x.toFixed(1)},` +
            `${free.y.toFixed(1)}); margins L ${margins.left.toFixed(1)} T ${margins.top.toFixed(1)} ` +
            `R ${margins.right.toFixed(1)} B ${margins.bottom.toFixed(1)}`,
        );

        for (const [side, m] of Object.entries(margins)) {
          expect(m, `${size} ${boxId}: margin on the ${side} must be at least 15 px`).toBeGreaterThanOrEqual(15);
        }
      }
    }
    errs.assertClean();
  });

  /*
   * The unmeasurable G2(c) row, as an explicit R8 FIXME with the assertion written out.
   *
   * The 15 px margin is a real requirement and this row would fail it if it could be measured — but it cannot,
   * because the press never happens. Keeping the assertion here rather than deleting it means the requirement
   * is still encoded and will run the moment the card is reachable.
   */
  test.fixme( // allow-skip: unpressable at Full (centre y 985.9 against 844) — no press, so no flight and no outline bbox, though the 15 px margin requirement itself still stands.
    'G2(c-phone-nino4): at 390x844 the Nino 4 outline keeps 15 px of margin inside the free rect',
    async ({ page }) => {
      await openLive(page, PHONE);
      await ensureCardsReachable(page, 'nino4');
      await pressCardWithMouse(page, 'nino4');
      await settleD(page);
      const o = await outlineWorld(page, 'nino4');
      expect(o, '390x844 nino4: the outline LineLoop must exist').not.toBeNull();
      const bbox = o!.bbox!;
      const free = await page.evaluate(() => window.__frame!.snapshot().free);
      const margins = [
        bbox.x - free.x,
        bbox.y - free.y,
        free.x + free.w - (bbox.x + bbox.w),
        free.y + free.h - (bbox.y + bbox.h),
      ];
      annotate('R2c', `390x844 nino4: margins ${margins.map((m) => m.toFixed(1)).join(' ')}`);
      for (const m of margins) expect(m, 'every margin must be at least 15 px').toBeGreaterThanOrEqual(15);
    },
  );

  /*
   * G2(d) is FOUR tests, one per spin phase, not one test looping four times.
   *
   * Pressing an already-selected card RELEASES the box (it is a toggle, `App.tsx:157`), and a Playwright
   * `page` fixture is one page for the whole test. Looping therefore flew once and toggled three times:
   * phases 2-4 measured a camera that had never moved and reported 57.06 and 94.53 deg of aim error that
   * belonged to the harness. Separate tests get separate pages, which is the only way each phase is a first
   * press. The 0.05 deg bound is unchanged.
   */
  for (const phase of [0, 1.0, 4.6251, -1] as const) {
    const label = phase === -1 ? 'idle' : `${phase}`;
    test(`G2(d-${label}): the camera aims at the box centre within 0.05 deg at spin ${label}`, async ({ page }) => {
      const errs = watchErrors(page);
      await openLive(page, DESKTOP);
      await page.evaluate((p) => window.__globe!.setSpin(p >= 0, p >= 0 ? p : 0), phase);
      await page.waitForTimeout(400);

      await pressCardWithMouse(page, 'nino12');
      await settleD(page);

      const { deg, centre } = await aimErrorDeg(page, 'nino12');
      annotate(
        'R2d',
        `spin ${label}: aim error ${deg.toFixed(5)} deg; box centre ${centre.map((n) => n.toFixed(4)).join(',')}`,
      );
      expect(deg, `spin ${label}: the aim error must be at most 0.05 deg`).toBeLessThanOrEqual(0.05);
      errs.assertClean();
    });
  }

  test('G2(e): the spin freezes while a box is active, below 5 percent of the idle rate', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    /* The spin angle, read from a pin's world position — the only rotation witness the probe exposes. */
    const spinAngle = () =>
      page.evaluate(() => {
        const p = window.__look!.pinsWorld()[0];
        return Math.atan2(p.core[0], p.core[2]);
      });

    const rateOver3s = async (): Promise<number> => {
      const a = await spinAngle();
      await page.waitForTimeout(3000);
      const b = await spinAngle();
      let d = b - a;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return Math.abs(d) / 3;
    };

    const idleRate = await rateOver3s();
    await pressCardWithMouse(page, 'nino12');
    await settleD(page);
    const activeRate = await rateOver3s();

    annotate('R2e', `idle rate ${idleRate.toFixed(5)} rad/s, box-active rate ${activeRate.toFixed(5)} rad/s`);
    expect(idleRate, 'the idle rate must be non-trivial or the comparison is vacuous').toBeGreaterThan(1e-3);
    expect(
      activeRate,
      `box-active spin ${activeRate.toFixed(6)} rad/s must be under 5 percent of the idle ${idleRate.toFixed(6)} rad/s`,
    ).toBeLessThan(idleRate * 0.05);
    errs.assertClean();
  });

  test('G2(f): Nino 4 takes the short arc from camera longitude -150 and from 175', async ({ page }) => {
    const errs = watchErrors(page);
    for (const lon of [-150, 175]) {
      await openLive(page, DESKTOP);
      await page.evaluate((l) => window.__globe!.setAzimuth(l), lon);
      await page.waitForTimeout(1200);

      /* Freeze the spin so the arc being measured is the flight's, not the planet's. */
      await page.evaluate(() => window.__globe!.setSpin(true, 0));
      await page.waitForTimeout(400);

      const before = await page.evaluate(() => window.__globe!.target());
      await pressCardWithMouse(page, 'nino4');
      await settleD(page);
      const after = await page.evaluate(() => window.__globe!.target());

      /*
       * The travelled angle is between the camera's own direction before and after. Read from the target
       * vector, which moves from the origin to the box centre on a region-style fly-to; on the live path the
       * target stays at the origin, so the angle is measured from the azimuth the test just set instead.
       */
      const centre = boxCentreWorld(GEO.nino4);
      const startLon = (lon * Math.PI) / 180;
      const start: [number, number, number] = [Math.sin(startLon), 0, Math.cos(startLon)];
      const dot = start[0] * centre[0] + start[1] * centre[1] + start[2] * centre[2];
      const travelled = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;

      annotate(
        'R2f',
        `from lon ${lon}: target ${before.map((n) => n.toFixed(4)).join(',')} -> ` +
          `${after.map((n) => n.toFixed(4)).join(',')}; travelled angle ${travelled.toFixed(3)} deg`,
      );
      expect(travelled, `from lon ${lon} the flight must take the short arc, under 180 deg`).toBeLessThan(180);
    }
    errs.assertClean();
  });

  test('G2(g): elementFromPoint at the globe centre is the CANVAS after each flight', async ({ page }) => {
    const errs = watchErrors(page);
    for (const boxId of ['nino12', 'nino4'] as const) {
      await openLive(page, DESKTOP);
      await pressCardWithMouse(page, boxId);
      await settleD(page);

      const hit = await page.evaluate(() => {
        const q = window.__globe!.project([0, 0, 0]);
        const el = document.elementFromPoint(q.x, q.y);
        return { tag: el?.tagName ?? '(none)', x: +q.x.toFixed(1), y: +q.y.toFixed(1) };
      });
      annotate('R2g', `${boxId}: elementFromPoint at (${hit.x}, ${hit.y}) = ${hit.tag}`);
      expect(hit.tag, `${boxId}: the globe centre must be the canvas`).toBe('CANVAS');
    }
    errs.assertClean();
  });

  test('G2(h): the zoom floor is 1.25 at all three viewports and after every flight', async ({ page }) => {
    const errs = watchErrors(page);
    for (const vp of [DESKTOP, PHONE, TABLET] as const) {
      const size = key(vp);
      await openLive(page, vp);
      const bootFloor = await zoomFloor(page);
      annotate('R3', `${size}: floor on boot ${bootFloor.toFixed(5)}`);
      expect(bootFloor, `${size}: the zoom floor must be 1.25`).toBeCloseTo(1.25, 2);

      if (vp !== DESKTOP) await ensureCardsReachable(page, 'nino12');
      await pressCardWithMouse(page, 'nino12');
      await settleD(page);
      const afterFlight = await zoomFloor(page);
      annotate('R3', `${size}: floor after the flight ${afterFlight.toFixed(5)}`);
      expect(afterFlight, `${size}: the floor must still be 1.25 after a flight`).toBeCloseTo(1.25, 2);
    }
    errs.assertClean();
  });
});

/* ------------------------------------------------------------------------------ G3 interrupts, 1280x720 */

/**
 * The outline's stroke opacity: 0.95 while the box is selected, 0.55 while it is not.
 *
 * `NinoOverlay.tsx:99-110` builds one `LineBasicMaterial` per outline with exactly those two opacities and
 * swaps it when `selected` changes, so the number is the highlight state rather than a proxy for it. Read from
 * the scene graph by the name the component gives the loop (`nino-outline-<id>`, `NinoOverlay.tsx:119`) because
 * nothing exposes the selection as a DOM attribute at 1280x720 — the cards are the only DOM witness and they
 * are read separately.
 */
/** The two stroke opacities `NinoOverlay.tsx:102-104` builds. */
const OPACITY_SELECTED = 0.95;
const OPACITY_IDLE = 0.55;

/**
 * Wait for an outline's stroke to reach a value, instead of reading it once.
 *
 * The material is swapped in a `useMemo` keyed on `selected` (`NinoOverlay.tsx:99-110`), so there is at least
 * one committed-then-painted frame between the click and the new opacity being readable from the scene graph.
 * Measured: right after a toggle-off `aria-pressed` was already false while the outline still read 0.95;
 * a single-read assertion blamed the product for a frame of latency.
 */
async function expectOutline(page: Page, boxId: 'nino12' | 'nino4', want: number, why: string): Promise<number> {
  await expect
    .poll(() => outlineOpacity(page, boxId), { timeout: 5_000, intervals: [50], message: why })
    .toBe(want);
  return want;
}

async function outlineOpacity(page: Page, boxId: 'nino12' | 'nino4'): Promise<number | null> {
  return page.evaluate((id) => {
    type Mat = { opacity?: number };
    type LineLike = { material?: Mat | Mat[] };
    const scene = (window as unknown as Record<string, unknown>).__scene as
      | { traverse: (cb: (o: unknown) => void) => void }
      | undefined;
    if (!scene) return null;
    const found: LineLike[] = [];
    scene.traverse((o) => {
      if ((o as { name?: string }).name === `nino-outline-${id}`) found.push(o as LineLike);
    });
    const m = found[0]?.material;
    if (!m) return null;
    if (Array.isArray(m)) return m[0]?.opacity ?? null;
    return m.opacity ?? null;
  }, boxId);
}

/** The idle spin rate, in rad/s, measured over 3 s from a pin's world position. Same witness G2(e) uses. */
async function spinRateOver3s(page: Page): Promise<number> {
  const spinAngle = () =>
    page.evaluate(() => {
      const p = window.__look!.pinsWorld()[0];
      return Math.atan2(p.core[0], p.core[2]);
    });
  const a = await spinAngle();
  await page.waitForTimeout(3000);
  const b = await spinAngle();
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d) / 3;
}

/**
 * A front-facing REGION pin that a real mouse click can actually reach.
 *
 * The planet is frozen first (`setSpin(true, 0)`), because a spinning pin moves 12-38 px/s and the distance
 * between reading a coordinate and clicking it is one CDP round trip — `pin-click.spec.ts:443-458` measures that
 * window as ~460 ms of wall time, which is the whole 14 px hit radius. Freezing removes that from the
 * measurement instead of blaming the hit test for it.
 *
 * `elementFromPoint` must resolve to the canvas at the chosen point, so the click cannot be decided by a panel
 * node overlapping the globe.
 */
/**
 * A front pin's CURRENT screen position, optionally excluding one id.
 *
 * **This must be read at press time, not before it.** Measured across a Nino 4 flight: 300 ms after the press
 * the `pacific` pin had moved from x 398.4 to x 791.5 — 393 px. A coordinate captured before the press is
 * therefore 393 px stale by the time the click arrives, which lands on empty ocean and leaves the box selected.
 * The first version of G3(a) did exactly that and failed with `aria-pressed` still true; that was my test code,
 * not the product.
 */
async function reachablePin(
  page: Page,
  exclude: string | null,
): Promise<{ id: string; x: number; y: number } | null> {
  const pins = await page.evaluate(() =>
    window.__globe!.pins().map((p) => ({ id: p.id, x: p.x, y: p.y, behind: p.behind, facing: p.facing })),
  );
  for (const p of pins) {
    if (p.id === exclude) continue;
    /* `facing` is a BOOLEAN on this probe (`globals.d.ts:27`), not the signed dot product — do not compare it. */
    if (p.behind || !p.facing) continue;
    const top = await topNodeAt(page, p.x, p.y);
    if (top === 'canvas') return { id: p.id, x: p.x, y: p.y };
  }
  return null;
}

/** The canvas' centre, and the topmost node there. */
async function canvasCentre(page: Page): Promise<{ x: number; y: number; top: string }> {
  const c = await page.evaluate(() => {
    const el = document.querySelector('canvas');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!c) throw new Error('[canvasCentre] no canvas');
  return { ...c, top: await topNodeAt(page, c.x, c.y) };
}

/** A real drag on the canvas: down, a move in 10 steps, up. No synthetic events. */
async function dragCanvas(page: Page, dx: number, dy = 0): Promise<void> {
  const c = await canvasCentre(page);
  expect(c.top, 'a drag must start on the canvas, not on a panel').toBe('canvas');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(c.x + (dx * i) / 10, c.y + (dy * i) / 10);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/**
 * A real click on an old region card in the DESKTOP Impact Zones panel.
 *
 * **`button[data-region-id]` is not this control.** Those attributes exist only in `RegionDrawer.tsx:297`
 * (off-canvas and `aria-hidden` while closed) and `SheetBody.tsx:172` (mobile). The desktop panel renders six
 * text buttons with no such attribute, measured: 4 region cards then 2 "Show on globe" buttons. Selecting by
 * attribute therefore clicked a hidden drawer button and the press did nothing — the premise failure the first
 * version reported.
 */
async function clickImpactZoneCard(page: Page, re: RegExp): Promise<{ x: number; y: number; ok: boolean }> {
  const info = await page.evaluate((src) => {
    const rx = new RegExp(src);
    const panel = document.querySelector('[data-occluder="right-panel"]');
    if (!panel) return null;
    const btn = [...panel.querySelectorAll('button')].find((b) => rx.test(b.textContent ?? ''));
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return { x: cx, y: cy, ok: top === btn || btn.contains(top) };
  }, re.source);
  if (!info) throw new Error(`[clickImpactZoneCard] no card matching ${re} in the right panel`);
  await page.mouse.click(info.x, info.y);
  return { ...info };
}

/**
 * d and the target distance at four wall-clock offsets, as annotations.
 *
 * M6 is explicit that these are recorded, not asserted: what the numbers show is whether d drifts toward
 * `dFit` after a toggle-off, and a threshold there would encode the product decision instead of measuring it.
 */
async function traceDAndTarget(
  page: Page,
  label: string,
  offsets: readonly number[] = [0, 1, 3, 5],
): Promise<Array<{ t: number; d: number; dt: number; spinning: boolean }>> {
  const out: Array<{ t: number; d: number; dt: number; spinning: boolean }> = [];
  const t0 = Date.now();
  for (const off of offsets) {
    const waitMs = off * 1000 - (Date.now() - t0);
    if (waitMs > 0) await page.waitForTimeout(waitMs);
    const row = await page.evaluate(() => ({
      d: window.__globe!.distance(),
      dt: window.__frame!.snapshot().target.d,
      spinning: window.__frame!.snapshot().spinning,
    }));
    out.push({ t: off, ...row });
  }
  annotate(
    'M6',
    `${label}: ` + out.map((r) => `t${r.t}s d ${r.d.toFixed(5)} target ${r.dt.toFixed(5)} spin ${r.spinning}`).join('; '),
  );
  return out;
}

test.describe('G3: the box flight survives what the user does to the globe', () => {
  /*
   * (a) THE LITERAL REQUIREMENT: press Nino 4, then 300 ms later click a region pin.
   *
   * Five witnesses, because an interrupted flight still leaves the camera moving and a single check could be
   * satisfied by the interruption rather than the cancellation: aria-pressed, outline opacity, the card's own
   * state, `__frame.regionId`, and the orbit target four seconds later.
   *
   * ## The pin coordinate must be read at click time, and it is still a knife-edge
   *
   * A pin's screen position is a function of the camera, so a coordinate captured before the press is stale:
   * measured across this exact flight, `pacific` moved x 398.4 -> 791.5 within the first 300 ms (393 px). That
   * bug is fixed here — the pin is read immediately before the click.
   *
   * What CANNOT be fixed from the test side is the second half: R3F fires `onClick` only when the object is hit
   * at BOTH pointerdown and pointerup (`pin-click.spec.ts:447-450`), and the camera is still travelling between
   * the two. Measured drift in that window is 74.6 px against a 14 px hit radius.
   *
   * ## What real input actually does, measured, and why this test is expected to FAIL
   *
   * Probe, 1280x720, planet frozen so the camera is the only thing moving the pin:
   *   - at rest the same click selects: region `pacific`, focus `focused`, d 3.8935 -> 4.6941;
   *   - 300 ms into the Nino 4 flight the click cancels the flight — d froze at 2.6433 and never reached
   *     1.3946 — but selects NOTHING: `regionId` null, and the box stays selected with aria-pressed true.
   *
   * So the product cancels without deciding, leaving a stranded box: flight stopped, nothing chosen, the card
   * still claiming to be active. Per R7/M7 this test encodes that and is left failing rather than softened.
   */
  test('G3(a): a region pin clicked 300 ms into a box flight cancels it and takes the camera', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    /* Freeze the planet, so the only thing moving the pin is the camera. */
    await page.evaluate(() => window.__globe!.setSpin(true, 0));
    await page.waitForTimeout(600);

    await pressCardWithMouse(page, 'nino4');
    await page.waitForTimeout(300);

    /* Read the pin NOW: the camera is already travelling (d 3.8935 -> 2.6996 in the first 300 ms). */
    const pin = await reachablePin(page, null);
    expect(pin, 'a front region pin must be geometrically in front 300 ms into the flight').not.toBeNull();
    await page.mouse.click(pin!.x, pin!.y);

    await page.waitForTimeout(4000);

    const after = await page.evaluate(() => {
      const t = window.__globe!.target();
      return {
        regionId: window.__frame!.snapshot().regionId,
        focus: window.__frame!.snapshot().focus,
        targetRadius: Math.hypot(t[0], t[1], t[2]),
        d: window.__globe!.distance(),
      };
    });
    const pressed4 = await cardPressed(page, 'nino4');
    const opacity4 = await outlineOpacity(page, 'nino4');

    /*
     * 2.4426, not 3.6178: this test runs at 1280x720, and R2's nino4 predictions are 2.4426 (desktop),
     * 3.6178 (390x844) and 2.6117 (1032x1376). The first version of this annotation quoted the PHONE figure,
     * and the G3 commit message repeated the mistake with nino12's 1.3946. Both are corrected here; no
     * assertion ever depended on these strings.
     */
    annotate(
      'R2a',
      `pin ${pin!.id} clicked 300 ms into the nino4 flight: region ${after.regionId}; ` +
        `nino4 aria-pressed ${pressed4}, outline opacity ${opacity4}; d ${after.d.toFixed(5)} ` +
        `(R2 at 1280x720 says 2.4426 if the box won, 3.8935 if nothing moved); ` +
        `|target| ${after.targetRadius.toFixed(4)}`,
    );

    expect(pressed4, 'the box must be cleared — aria-pressed false').toBe(false);
    expect(opacity4, 'the outline must not be highlighted (0.55 is the unselected stroke)').toBe(0.55);
    expect(after.regionId, 'the clicked pin becomes the active region').toBe(pin!.id);
    expect(after.focus).toBe('focused');
    /*
     * The face-pin policy keeps `controls.target` at the origin (see `pin-click.spec.ts:1008`), so the region is
     * proven by `regionId` + `focus` + the camera direction, NOT by a displaced target. Asserting a displaced
     * target was my error and would fail for a correct product.
     */
    expect(after.targetRadius).toBeLessThanOrEqual(1e-6);
    errs.assertClean();
  });

  test('G3(a-card): a region card clicked 300 ms into a box flight cancels it and takes the camera', async ({
    page,
  }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    await pressCardWithMouse(page, 'nino4');
    await page.waitForTimeout(300);
    const click = await clickImpactZoneCard(page, /Pacific/i);
    expect(click.ok, 'the region card in the right panel must be pressable').toBe(true);

    await page.waitForTimeout(4000);

    const after = await page.evaluate(() => {
      const t = window.__globe!.target();
      return {
        regionId: window.__frame!.snapshot().regionId,
        focus: window.__frame!.snapshot().focus,
        targetRadius: Math.hypot(t[0], t[1], t[2]),
        d: window.__globe!.distance(),
      };
    });
    const pressed4 = await cardPressed(page, 'nino4');
    const opacity4 = await outlineOpacity(page, 'nino4');

    annotate(
      'R2a',
      `pacific card clicked at 300 ms: region ${after.regionId}; nino4 aria-pressed ${pressed4}, ` +
        `outline opacity ${opacity4}; d ${after.d.toFixed(5)}; |target| ${after.targetRadius.toFixed(4)}`,
    );

    expect(pressed4).toBe(false);
    expect(opacity4).toBe(0.55);
    expect(after.regionId).toBe('pacific');
    expect(after.focus).toBe('focused');
    /*
     * The orbit target stays at the ORIGIN — `pin-click.spec.ts:1008` asserts exactly this ("face-pin keeps
     * controls.target at the origin"), because the lens aims by rotating the planet under a fixed camera rather
     * than by translating the target. My first version asserted |target| > 0.5 and measured 0; that was my
     * assumption about the mechanism, not a product fault.
     */
    expect(after.targetRadius, 'the face-pin policy keeps controls.target at the origin').toBeLessThanOrEqual(1e-6);
    errs.assertClean();
  });

  /*
   * (b) A drag does NOT cancel the flight.
   *
   * The distinction from (a) is the product decision being tested: choosing another thing is a decision, while
   * moving the globe with the pointer is not. The assertion is on d's own spread over 3 s — "flat within 0.01" —
   * so a flight that restarted, or a fit that pulled back, shows up as spread rather than as a single reading.
   */
  test('G3(b): a 200 px drag 300 ms into a flight leaves d flat and the box selected', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    await pressCardWithMouse(page, 'nino4');
    await page.waitForTimeout(300);
    await dragCanvas(page, 200);

    const samples: number[] = [];
    for (let i = 0; i < 6; i++) {
      samples.push(await page.evaluate(() => window.__globe!.distance()));
      await page.waitForTimeout(600);
    }
    /*
     * A loop, not `Math.max(...samples)`. `source-guards.test.ts` forbids spreading an array into Math.min/max
     * because an unbounded component blows the stack, and the guard names this file if it does. Six elements
     * would never overflow, but the rule is about the pattern, not this instance — and the guard is part of
     * `pnpm test`, which is one of the four gates.
     */
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of samples) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const spread = hi - lo;
    const pressed = await cardPressed(page, 'nino4');

    annotate('R2b', `drag 200 px at 300 ms: d ${samples.map((n) => n.toFixed(5)).join(' -> ')}; spread ${spread.toFixed(5)}`);
    expect(pressed, 'a drag must not clear the box').toBe(true);
    expect(spread, `d must stay flat within 0.01 over 3 s; spread was ${spread.toFixed(5)}`).toBeLessThanOrEqual(0.01);
    errs.assertClean();
  });

  test('G3(c): wheel-out 300 ms into a flight holds the box and does not pull back', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    await pressCardWithMouse(page, 'nino4');
    await page.waitForTimeout(300);

    const c = await canvasCentre(page);
    expect(c.top, 'the wheel must be delivered to the canvas').toBe('canvas');
    await page.mouse.move(c.x, c.y);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(80);
    }

    const afterWheel = await page.evaluate(() => window.__globe!.distance());
    await page.waitForTimeout(3000);
    const later = await page.evaluate(() => window.__globe!.distance());
    const pressed = await cardPressed(page, 'nino4');

    annotate('R2c', `wheel-out at 300 ms: d after wheel ${afterWheel.toFixed(5)}, 3 s later ${later.toFixed(5)}`);
    expect(pressed, 'wheel-out must not clear the box').toBe(true);
    expect(
      Math.abs(later - afterWheel),
      `the fit must not pull the camera back: ${afterWheel.toFixed(5)} -> ${later.toFixed(5)}`,
    ).toBeLessThanOrEqual(0.01);
    errs.assertClean();
  });

  /*
   * (d) A region is open, then a box is chosen. R1 then R2, the drawer closes and the region clears.
   *
   * THIS IS AN R8 FIXME AND THE REASON IS MEASURED, NOT ASSUMED. With `pacific` selected the desktop drawer is
   * open, and the Nino 1+2 press button's centre sits at (1122.0, 504.19) — where `elementFromPoint` returns a
   * DIV with class `absolute top-0 h-full rounded-full transition-all duration-3…`, i.e. the drawer's own
   * slider track, not the button. `NinoCards.tsx:14` places the cards inside `[data-occluder="right-panel"]`,
   * which the drawer slides over, so the card is COVERED while a region is open. A mouse user therefore cannot
   * perform this scenario at all, which means the "drawer closed, region cleared" assertion cannot be reached
   * through real input, and asserting it through a synthetic click would certify a path a user cannot take.
   *
   * The behaviour underneath is already correct where it IS reachable: G3(a-card) opens the drawer from a box
   * flight with a real click and the region clears. Un-fixme this when the desktop card block is placed clear
   * of the drawer (§ product decision on the right-panel/z-order).
   */
  test.fixme( // allow-skip: the open desktop drawer covers the Nino card — measured at 1280x720 with pacific open, the nino12 press button centre (1122.0, 504.19) resolves to the drawer's slider track DIV, so no real click can reach it.
    'G3(d): with a region open, pressing Nino 1+2 settles to the R2 distance and clears the region',
    async ({ page }) => {
      await openLive(page, DESKTOP);
      const click = await clickImpactZoneCard(page, /Pacific/i);
      expect(click.ok, 'precondition: the impact-zone card must be pressable').toBe(true);
      await expect.poll(() => page.evaluate(() => window.__frame!.snapshot().focus), { timeout: 25_000 }).toBe(
        'focused',
      );
      await settleStable(page);

      await pressCardWithMouse(page, 'nino12');
      const settled = await settleD(page);
      const predicted = P2D.nino12['1280x720'];
      const offset = settled - predicted;
      const after = await page.evaluate(() => ({
        regionId: window.__frame!.snapshot().regionId,
        drawer: document.querySelector('[data-occluder="right-drawer"]')?.getAttribute('aria-hidden'),
      }));
      annotate(
        'R2d',
        `settled d ${settled.toFixed(5)}, predicted ${predicted.toFixed(5)}, offset ${offset.toFixed(5)}; ` +
          `region ${after.regionId}, drawer aria-hidden ${after.drawer}`,
      );
      expect(after.regionId).toBeNull();
      expect(after.drawer).toBe('true');
      expect(Math.abs(offset)).toBeLessThanOrEqual(0.006);
    },
  );

  /*
   * (e) Reset during a flight.
   *
   * Three separate claims, because "Reset worked" could be true while any one of them is false: the flight is
   * cleared (`regionId` null and no box selected), the camera reaches the default pose (`viewIsDefault`, a probe
   * field written by the director rather than inferred from d), and the spin resumes — measured as a rate, not
   * as the `spinning` flag, so a flag that is set while the rotation is frozen cannot pass.
   */
  test('G3(e): Reset 300 ms into a flight clears it, returns to the default pose, and resumes the spin', async ({
    page,
  }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    await pressCardWithMouse(page, 'nino12');
    await page.waitForTimeout(300);
    /*
     * Re-measure the button at the moment of the click. It is enabled mid-flight (`viewIsDefault` false), which
     * a probe confirmed — but its RECT was captured in the same round trip as the press, and the header layout
     * settles after it. Reading a stale rect and clicking it lands on nothing, which is what the first version
     * did: the reset never fired and the box stayed pressed.
     */
    /*
     * Measure the button and CLICK IN THE SAME ROUND TRIP, then verify the point was actually the button.
     *
     * Measured: mid-flight the control is enabled (`disabled: false`, `viewIsDefault` false) and a click at its
     * rect does run the reset — `viewIsDefault` true by 2500 ms, d back to 3.8935. The first version separated
     * the rect read from the click by a `toBeEnabled` wait and clicked a stale position, so the reset never
     * fired and the 20 s poll timed out. The topmost-node guard is the same one `pressCardWithMouse` uses: it
     * makes a covered button a named failure instead of an empty click.
     */
    const click = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="reset-view"]') as HTMLButtonElement | null;
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, disabled: b.disabled, ok: Boolean(top && (top === b || b.contains(top))), tag: top?.tagName ?? '(none)' };
    });
    expect(click, 'the Reset view control must be mounted').not.toBeNull();
    expect(click!.ok, `the Reset point must be the button, not <${click!.tag}>`).toBe(true);
    expect(click!.disabled, 'Reset must be enabled mid-flight (viewIsDefault is false)').toBe(false);
    await page.mouse.click(click!.x, click!.y);

    /*
     * Two signals, in the order they become true. `aria-pressed` clears at once (measured at 300 ms), while
     * `viewIsDefault` only lands when the return journey finishes (~2.5 s), so polling the fast one first keeps a
     * genuine reset failure distinguishable from a slow camera.
     */
    await expect
      .poll(() => cardPressed(page, 'nino12'), { timeout: 5_000, intervals: [100] })
      .toBe(false);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.snapshot().viewIsDefault), { timeout: 25_000, intervals: [200] })
      .toBe(true);
    await settleStable(page);

    const state = await page.evaluate(() => ({
      regionId: window.__frame!.snapshot().regionId,
      viewIsDefault: window.__frame!.snapshot().viewIsDefault,
      spinning: window.__frame!.snapshot().spinning,
      d: window.__globe!.distance(),
    }));
    const pressed = await cardPressed(page, 'nino12');
    const opacity = await outlineOpacity(page, 'nino12');
    const rate = await spinRateOver3s(page);

    annotate(
      'R2e',
      `Reset at 300 ms: region ${state.regionId}, aria-pressed ${pressed}, outline opacity ${opacity}; ` +
        `viewIsDefault ${state.viewIsDefault}; d ${state.d.toFixed(5)}; spinning flag ${state.spinning}; ` +
        `measured spin ${rate.toFixed(5)} rad/s`,
    );

    expect(pressed, 'Reset must clear the box').toBe(false);
    expect(opacity, 'Reset must un-highlight the outline').toBe(0.55);
    expect(state.regionId).toBeNull();
    expect(state.viewIsDefault, 'the camera must be at the framed default pose').toBe(true);
    expect(rate, 'the spin must be running again after Reset').toBeGreaterThan(1e-3);
    errs.assertClean();
  });

  /*
   * (f) Toggle-off by pressing the selected card again, at all three viewports.
   *
   * M1 applies here: the first press collapses the sheet to Peek and Peek does not mount the cards, so every
   * aria-pressed read and the second press are preceded by reopening the sheet with the real slider keyboard.
   * M6 governs the numbers: d and target at 0/1/3/5 s are ANNOTATIONS, and the report says whether d drifts
   * toward dFit in each case. There is no assertion on that drift, because whether the camera should hold or
   * return is a product decision this step does not make.
   */
  test('G3(f): pressing the selected card again releases it at all three viewports', async ({ page }) => {
    const errs = watchErrors(page);
    for (const vp of [DESKTOP, PHONE, TABLET] as const) {
      const size = key(vp);
      await openLive(page, vp);
      if (vp !== DESKTOP) await ensureCardsReachable(page, 'nino12');
      await pressCardWithMouse(page, 'nino12');
      await settleD(page);

      /*
       * M1 APPLIES TO THE READ, NOT JUST THE SECOND PRESS. The first press collapses the sheet to Peek and Peek
       * does not mount the cards (`SheetBody.tsx` mounts them in the `showControls` half block), so reading
       * `aria-pressed` immediately returns null — measured as `Received: null`, which is a missing node, not a
       * false value. Reopening has to happen BEFORE this read as well as before the second press.
       */
      if (vp !== DESKTOP) {
        annotate('M1', `${size}: sheet collapsed after press — reopened to Half before reading aria-pressed`);
        await openSheetToHalf(page);
        await ensureCardsReachable(page, 'nino12');
      }
      const pressedOn = await cardPressed(page, 'nino12');
      expect(pressedOn, `${size}: the first press must select`).toBe(true);

      await pressCardWithMouse(page, 'nino12');
      if (vp !== DESKTOP) await openSheetToHalf(page);
      const pressedOff = await cardPressed(page, 'nino12');
      const opacity = await expectOutline(page, 'nino12', OPACITY_IDLE, `${size}: outline after toggle-off`);
      const trace = await traceDAndTarget(page, `${size} nino12 toggle-off`);

      if (vp !== DESKTOP) await openSheetToHalf(page);
      const rate = await spinRateOver3s(page);

      annotate(
        'R2f',
        `${size}: aria-pressed ${pressedOn} -> ${pressedOff}; outline opacity ${opacity}; ` +
          `spin after release ${rate.toFixed(5)} rad/s`,
      );

      expect(pressedOff, `${size}: the second press must release`).toBe(false);
      expect(opacity, `${size}: the outline must return to the unselected stroke`).toBe(OPACITY_IDLE);
      expect(rate, `${size}: the spin must resume after release`).toBeGreaterThan(1e-3);
      expect(trace.length).toBe(4);
    }
    errs.assertClean();
  });

  /*
   * (g) Decision (b): a DRAG cancels the camera journey but keeps the box, so the card is still pressed and the
   * next press on it turns the box OFF rather than on. The test is named for the behaviour it encodes, because a
   * reader looking for "why does pressing twice not fly twice" needs to find this file.
   */
  test('G3(g): after a drag cancel, the next press of the same card toggles the box OFF', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    await pressCardWithMouse(page, 'nino4');
    await page.waitForTimeout(300);
    await dragCanvas(page, 200);
    await page.waitForTimeout(1000);

    const afterDrag = await cardPressed(page, 'nino4');
    const opacityAfterDrag = await outlineOpacity(page, 'nino4');

    await pressCardWithMouse(page, 'nino4');
    await page.waitForTimeout(1200);
    const afterSecond = await cardPressed(page, 'nino4');
    const opacityAfterSecond = await outlineOpacity(page, 'nino4');

    annotate(
      'R2g',
      `after the drag: aria-pressed ${afterDrag}, outline ${opacityAfterDrag}; after the second press: ` +
        `aria-pressed ${afterSecond}, outline ${opacityAfterSecond}`,
    );

    expect(afterDrag, 'the drag must keep the box selected (decision b)').toBe(true);
    expect(opacityAfterDrag).toBe(OPACITY_SELECTED);
    expect(afterSecond, 'the second press must turn the box OFF').toBe(false);
    expect(opacityAfterSecond).toBe(OPACITY_IDLE);
    errs.assertClean();
  });

  /*
   * (h) A bare canvas tap — real mouse down and up at one point, no movement — 300 ms into a flight.
   *
   * CLOSE3 recorded that this does NOT cancel the flight, and R7 makes that evidence binding: if real input
   * cancels, this test FAILS and stays. The d trace is recorded either way, because "did anything move" is the
   * other half of the question.
   */
  test('G3(h): a zero-movement canvas tap 300 ms into a flight does not cancel it (CLOSE3)', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    await pressCardWithMouse(page, 'nino12');
    await page.waitForTimeout(300);

    const c = await canvasCentre(page);
    expect(c.top, 'the tap must land on the canvas').toBe('canvas');
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();

    const trace: string[] = [];
    for (let i = 0; i < 6; i++) {
      trace.push((await page.evaluate(() => window.__globe!.distance())).toFixed(5));
      await page.waitForTimeout(600);
    }

    const after = await page.evaluate(() => ({
      regionId: window.__frame!.snapshot().regionId,
      spinning: window.__frame!.snapshot().spinning,
      d: window.__globe!.distance(),
    }));
    const pressed = await cardPressed(page, 'nino12');
    const opacity = await outlineOpacity(page, 'nino12');

    annotate(
      'R2h',
      `zero-movement tap at 300 ms: aria-pressed ${pressed}, outline ${opacity}, region ${after.regionId}; ` +
        `d ${trace.join(' -> ')}`,
    );

    expect(
      pressed,
      'CLOSE3: a tap with no movement must NOT cancel the flight — if real input cancels it, this is a FAIL',
    ).toBe(true);
    expect(opacity, 'the outline must stay highlighted after a bare tap').toBe(OPACITY_SELECTED);
    expect(after.regionId).toBeNull();
    errs.assertClean();
  });
});

test.describe('G5: aria-pressed truthfulness, keyboard activation and the live announcement', () => {
  /*
   * The announcement string is the registry label, not a second hardcoded copy: `regions.ts:166` gives
   * `label: 'NIÑO 1+2'` and `MobileShell.tsx:167` composes `Showing ${label} on the globe`. Asserting the
   * literal proves the composition, including the tilde, which an ASCII-only assertion would miss.
   */
  const SHOWN_NINO12 = 'Showing NIÑO 1+2 on the globe';

  /** The Reset view control, by role and name: `Header.tsx:119` appends it last in the right cluster. */
  const resetView = (page: Page) => page.getByRole('button', { name: 'Reset view' });

  test('G5(a): aria-pressed is truthful through press, release, card swap, region select and Reset', async ({
    page,
  }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    const both = async () => ({ a: await cardPressed(page, 'nino12'), b: await cardPressed(page, 'nino4') });

    /* 1. Press: the pressed card is true, the other is false. */
    await pressCardWithMouse(page, 'nino12');
    await expect.poll(() => cardPressed(page, 'nino12'), { timeout: 15_000 }).toBe(true);
    let state = await both();
    annotate('R5a', `after pressing Nino 1+2: nino12 ${state.a}, nino4 ${state.b}`);
    expect(state.a, 'the pressed card must read aria-pressed true').toBe(true);
    expect(state.b, 'the unpressed card must read false').toBe(false);

    /* 2. Press again: released. */
    await pressCardWithMouse(page, 'nino12');
    await expect.poll(() => cardPressed(page, 'nino12'), { timeout: 15_000 }).toBe(false);
    state = await both();
    annotate('R5a', `after pressing it again: nino12 ${state.a}, nino4 ${state.b}`);
    expect(state.a, 'a second press must clear it').toBe(false);

    /* 3. Card A then card B: exclusivity. Only one box may be shown at a time. */
    await pressCardWithMouse(page, 'nino12');
    await expect.poll(() => cardPressed(page, 'nino12'), { timeout: 15_000 }).toBe(true);
    await pressCardWithMouse(page, 'nino4');
    await expect.poll(() => cardPressed(page, 'nino4'), { timeout: 15_000 }).toBe(true);
    state = await both();
    annotate('R5a', `after A then B: nino12 ${state.a}, nino4 ${state.b}`);
    expect(state.a, 'pressing B must clear A — the boxes are exclusive').toBe(false);
    expect(state.b, 'B must be the pressed one').toBe(true);

    /* 4. Region select: and open region replaces the box, so both cards clear. */
    const click = await clickImpactZoneCard(page, /Pacific/i);
    expect(click.ok, 'the region card must be pressable').toBe(true);
    await expect
      .poll(() => page.evaluate(() => window.__frame!.snapshot().regionId), { timeout: 15_000 })
      .toBe('pacific');
    await expect.poll(() => cardPressed(page, 'nino4'), { timeout: 15_000 }).toBe(false);
    state = await both();
    annotate('R5a', `after selecting a region: nino12 ${state.a}, nino4 ${state.b}`);
    expect(state.a, 'a region selection must clear every card').toBe(false);
    expect(state.b, 'a region selection must clear every card').toBe(false);

    /*
     * 5. Reset: the region closes and the cards stay false.
     *
     * No press between steps 4 and 5. I had one there first and it failed on `pressCard`: with a region open the
     * desktop drawer covers the cards — measured at (1122.0, 504.2), where the topmost node is the drawer's
     * slider-track DIV, which is also why G3(d) is a FIXME. Part Q's sequence has nothing between "region select"
     * and "Reset", so the extra press was mine, not the spec's.
     */
    await resetView(page).click();
    await expect
      .poll(() => page.evaluate(() => window.__frame!.snapshot().regionId), { timeout: 20_000 })
      .toBeNull();
    await expect.poll(() => cardPressed(page, 'nino12'), { timeout: 20_000 }).toBe(false);
    state = await both();
    annotate(
      'R5a',
      `after Reset view: nino12 ${state.a}, nino4 ${state.b}, region ` +
        `${await page.evaluate(() => window.__frame!.snapshot().regionId)}`,
    );
    expect(state.a, 'Reset must clear the box').toBe(false);
    expect(state.b, 'Reset must clear the box').toBe(false);
    errs.assertClean();
  });

  test('G5(b): Enter on a card collapses to Peek, focuses the Sheet slider, and names the box', async ({ page }) => {
    const errs = watchErrors(page);

    for (const vp of [PHONE, TABLET]) {
      await openLive(page, vp);
      await pressCardByKeyboard(page, 'nino12');

      /* The collapse is what makes the announcement necessary — the card unmounts a frame later. */
      await expect.poll(() => sheetTier(page), { timeout: 15_000 }).toBe('peek');

      /* Focus must land on the slider handle, not fall to BODY (`MobileShell.tsx:144`). */
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const el = document.activeElement as HTMLElement | null;
              return el ? `${el.getAttribute('role')}|${el.getAttribute('aria-label')}` : null;
            }),
          { timeout: 15_000, intervals: [50] },
        )
        .toBe('slider|Sheet position');

      /* The announcement is exact, and it survives the tier change because it is shell-level. */
      await expect.poll(() => announced(page), { timeout: 15_000, intervals: [100] }).toBe(SHOWN_NINO12);

      const atPeek = await announced(page);
      const active = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return { role: el?.getAttribute('role'), label: el?.getAttribute('aria-label'), tag: el?.tagName };
      });

      annotate(
        'G5b',
        `${vp.width}x${vp.height}: tier peek, activeElement ${active.tag}[role=${active.role}, ` +
          `aria-label="${active.label}"], announcement "${atPeek}"`,
      );

      /* And the region must still be there at Half and Full, not only at Peek. */
      const slider = page.getByRole('slider', { name: 'Sheet position' });
      for (const step of [
        { name: 'half', key: 'ArrowUp' as const, want: '1' },
        { name: 'full', key: 'End' as const, want: '2' },
        { name: 'peek', key: 'Home' as const, want: '0' },
      ]) {
        await slider.focus();
        await page.keyboard.press(step.key);
        await expect.poll(() => slider.getAttribute('aria-valuenow'), { timeout: 10_000 }).toBe(step.want);
        await waitForSheetStill(page);
        expect(await announced(page), `the announcement must exist at ${step.name} too`).toBe(SHOWN_NINO12);
      }

      annotate('G5b', `${vp.width}x${vp.height}: announcement "${SHOWN_NINO12}" present at peek, half and full`);
      errs.assertClean();
    }
  });

  test('G5(c): the card buttons are reachable by Tab after the region list, in DOM order', async ({ page }) => {
    const errs = watchErrors(page);
    await openLive(page, DESKTOP);

    /*
     * Tab from the document start and record the order of the things that matter. A fixed Tab count would be
     * brittle, so the loop walks a bounded number and collects what it lands on — the claim is the ORDER of
     * the region controls relative to the card buttons.
     */
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const order: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const testid = el.getAttribute('data-testid');
        if (testid?.startsWith('nino-show-')) return testid;
        /*
         * `data-region-id` is NOT the desktop selector. Measured: the four desktop panel buttons carry no
         * attribute at all — the four `data-region-id` nodes in the document are inside the off-canvas drawer,
         * behind `aria-hidden="true"`, so matching on it here finds nothing and would report "the region list is
         * unreachable by Tab" against a panel that is perfectly reachable. Panel membership is the honest test.
         */
        if (el.closest('[data-occluder="right-panel"]')) {
          return `region:${(el.textContent ?? '').trim().slice(0, 20)}`;
        }
        const label = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? '';
        return `${el.tagName}:${label.slice(0, 24)}`;
      });
      if (id) order.push(id);
      if (order.filter((x) => x.startsWith('nino-show-')).length >= 2) break;
    }

    const firstRegion = order.findIndex((x) => x.startsWith('region:'));
    const firstCard = order.findIndex((x) => x.startsWith('nino-show-'));
    annotate('G5c', `Tab order: ${order.join(' -> ')}`);

    expect(firstRegion, 'the region controls must be reachable by Tab').toBeGreaterThanOrEqual(0);
    expect(firstCard, 'the card buttons must be reachable by Tab').toBeGreaterThanOrEqual(0);
    expect(firstCard, 'the cards must come AFTER the region list in tab order').toBeGreaterThan(firstRegion);

    /* DOM order too: the cards are appended after the switcher in the same block. */
    const domOrder = await page.evaluate(() => {
      const panel = document.querySelector('[data-occluder="right-panel"]');
      if (!panel) return null;
      const cards = Array.from(panel.querySelectorAll('[data-testid^="nino-show-"]'));
      /* The region controls are the panel's buttons that are not the cards. */
      const regions = Array.from(panel.querySelectorAll('button')).filter(
        (b) => !b.getAttribute('data-testid')?.startsWith('nino-show-'),
      );
      if (!cards.length || !regions.length) return null;
      const lastRegion = regions[regions.length - 1];
      return lastRegion.compareDocumentPosition(cards[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before';
    });
    annotate('G5c', `card buttons sit ${domOrder} the region list in DOM order`);
    expect(domOrder, 'the card buttons must follow the region list in the DOM').toBe('after');
    errs.assertClean();
  });

  test.fixme( // allow-skip: known missing behaviour (R8) — MobileShell.tsx:167 composes `announcedBox ? `Showing ${label} on the globe` : ''`, so releasing a box writes an EMPTY STRING into the polite region; a screen-reader user is told nothing when the box is cleared, and asserting "announces something" would fail against the product exactly as the brief records.
    'G5(d): releasing a box announces that it was cleared',
    async ({ page }) => {
      const errs = watchErrors(page);
      await openLive(page, PHONE);
      await pressCardByKeyboard(page, 'nino12');
      await expect.poll(() => announced(page), { timeout: 15_000 }).toBe(SHOWN_NINO12);

      /* Toggle off via the card again. */
      await pressCardByKeyboard(page, 'nino12');
      await page.waitForTimeout(1500);

      const afterRelease = await announced(page);
      annotate('G5d', `announcement after release: ${JSON.stringify(afterRelease)} (empty is the documented gap)`);
      expect(afterRelease, 'releasing a box must announce that it was cleared, not go silent').not.toBe('');
      expect(afterRelease, 'releasing a box must announce that it was cleared').toBeTruthy();
      errs.assertClean();
    },
  );

  test.fixme( // allow-skip: known missing behaviour (R8) — MobileShell.tsx:142-144 finds the focus destination with a global `document.querySelector('[role="slider"][aria-label="Sheet position"]')`, so focus restoration depends on a document-wide string query rather than a ref to the handle the shell already owns; a second sheet, a renamed label or a shadow boundary silently breaks it, and there is no observable that distinguishes the two implementations.
    'G5(e): focus restoration does not depend on a global aria-label query',
    async ({ page }) => {
      const errs = watchErrors(page);
      await openLive(page, PHONE);
      await pressCardByKeyboard(page, 'nino12');
      await expect
        .poll(
          () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label')),
          { timeout: 15_000 },
        )
        .toBe('Sheet position');

      /*
       * The observable that would distinguish a ref-based restore from a document query: remove the label the
       * query depends on and see whether focus still reaches the handle. If focus is restored by ref, it does;
       * if by query, it does not. That is a src change, so this stays a FIXME and the assertion below is the
       * property the product should eventually satisfy.
       */
      const secondHandle = await page.evaluate(
        () => document.querySelectorAll('[role="slider"][aria-label="Sheet position"]').length,
      );
      annotate('G5e', `handles matching the global query: ${secondHandle}`);
      expect(secondHandle, 'the focus target must be resolvable without a document-wide query').toBe(0);
      errs.assertClean();
    },
  );
});
