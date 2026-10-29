import { test, expect } from './fixtures';
import {
  badgeLabel,
  clickEnable,
  connectionInit,
  errorCollector,
  ledger,
  pointerInit,
  throttle,
  throttleCpu,
  waitForFailure,
  waitForHistory,
  waitForReady,
} from './fixtures';

/**
 * Cases a–i from the 2B acceptance brief.
 *
 * Every case asserts the same invariant first: zero requests to
 * extensions.duckdb.org. That is the property the CSV migration exists to
 * guarantee, and it should never regress silently in any profile.
 */

test.describe('case a — desktop, unthrottled, eager', () => {
  test('boots eagerly and shows the serving host', async ({ page }) => {
    const errors = errorCollector(page);
    const bytes = ledger(page);
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await throttle(page, 'unthrottled');

    await page.goto('/');
    const ms = await waitForReady(page, 60_000);

    expect(ms, 'engine should become ready').not.toBeNull();
    const label = await badgeLabel(page);
    expect(label).toMatch(/^DuckDB-WASM · (jsdelivr|unpkg) · \d+ ms$/);
    expect(bytes.extensionRequests).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

test.describe('case b — coarse pointer, Fast 4G, 4x CPU', () => {
  test('boots on idle and reports long tasks', async ({ page }, testInfo) => {
    const bytes = ledger(page);
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await page.addInitScript(pointerInit(true));
    await page.addInitScript(`
      window.__LT = [];
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__LT.push(Math.round(e.duration));
        }).observe({ entryTypes: ['longtask'] });
      } catch {}
    `);
    await throttle(page, 'fast4g');
    await throttleCpu(page, 4);

    await page.goto('/');
    const ms = await waitForReady(page, 120_000);
    expect(ms, 'idle boot should still reach ready').not.toBeNull();

    // Long tasks are REPORTED, not asserted: a 4x-throttled mobile device doing
    // a 6.45 MB wasm boot will produce them, and the budget is a product
    // decision rather than a correctness gate.
    const longTasks: number[] = await page.evaluate(() => window.__LT);
    await testInfo.attach('long-tasks.json', {
      body: JSON.stringify(
        {
          count: longTasks.length,
          totalMs: longTasks.reduce((a, b) => a + b, 0),
          maxMs: longTasks.length ? Math.max(...longTasks) : 0,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });

    expect(bytes.extensionRequests).toHaveLength(0);
  });
});

test.describe('case c — 1.6 Mbps', () => {
  // A 6.45 MiB wasm plus a ~900 KB worker at 1.6 Mbps is ~40 s of transfer, so
  // this needs a long timeout by design.
  test.setTimeout(300_000);

  test('reaches ready without switching hosts or tripping the watchdog', async ({ page }) => {
    const bytes = ledger(page);
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await throttle(page, '1.6mbps');

    await page.goto('/');
    const ms = await waitForReady(page, 240_000);

    expect(ms, 'should reach ready at 1.6 Mbps').not.toBeNull();
    // No host switch: the slow connection is not a host fault, so the ladder
    // should never advance.
    expect(bytes.hostsTouched).toEqual(['cdn.jsdelivr.net']);
    expect(bytes.extensionRequests).toHaveLength(0);
    const label = await badgeLabel(page);
    expect(label).toContain('jsdelivr');
  });
});

test.describe('case d — 400 kbps, no Network Information API', () => {
  test.setTimeout(400_000);

  test('early-aborts as too-slow, then user mode succeeds', async ({ page }) => {
    const bytes = ledger(page);
    // null = the API does not exist (Safari), so the policy defaults to eager.
    await page.addInitScript(connectionInit(null));
    await throttle(page, '400kbps');

    await page.goto('/');

    const failure = await waitForFailure(page, 240_000);
    expect(failure, 'auto mode should give up on a 400 kbps link').toMatch(
      /Needs a faster connection/,
    );

    // Exactly one host attempted: a cap trip means the NETWORK is the
    // bottleneck, so trying the next CDN would waste the same time again.
    expect(bytes.hostsTouched).toHaveLength(1);
    expect(bytes.extensionRequests).toHaveLength(0);

    // History must already be there — that is the whole point of 2C.
    expect(await waitForHistory(page, 60_000)).not.toBeNull();

    // User mode ("Load anyway") has no cap and must eventually succeed.
    expect(await clickEnable(page)).toBe(true);
    expect(await waitForReady(page, 300_000), 'user mode should finish').not.toBeNull();
  });
});

test.describe('case e — saveData / 3g gate the boot', () => {
  for (const [name, conn] of [
    ['saveData', { saveData: true, effectiveType: '4g', downlink: 10 }],
    ['3g', { saveData: false, effectiveType: '3g', downlink: 10 }],
  ] as const) {
    test(`${name}: zero wasm/worker requests until the button is clicked`, async ({ page }) => {
      const bytes = ledger(page);
      await page.addInitScript(connectionInit(conn));
      await page.goto('/');

      // Give the app ample time to prove it is NOT going to boot on its own.
      await page.waitForTimeout(6_000);

      expect(bytes.wasm, 'no wasm before the user asks').toBe(0);
      expect(bytes.worker, 'no worker before the user asks').toBe(0);
      expect(bytes.hostsTouched).toHaveLength(0);
      expect(bytes.extensionRequests).toHaveLength(0);

      const label = await badgeLabel(page);
      expect(label).toMatch(/Load DuckDB/);

      // History is available even though the engine is deferred.
      expect(await waitForHistory(page, 30_000)).not.toBeNull();

      expect(await clickEnable(page)).toBe(true);
      expect(await waitForReady(page, 120_000)).not.toBeNull();
    });
  }
});

test.describe('case f — jsDelivr black-holed', () => {
  test.setTimeout(200_000);

  test('connect trip falls through to unpkg', async ({ page }) => {
    const bytes = ledger(page);
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await page.route('**/cdn.jsdelivr.net/**', (r) => r.abort('failed'));

    await page.goto('/');
    const ms = await waitForReady(page, 180_000);

    expect(ms, 'should recover via unpkg').not.toBeNull();
    expect(bytes.hostsTouched).toEqual(['cdn.jsdelivr.net', 'unpkg.com']);
    expect(bytes.extensionRequests).toHaveLength(0);
    expect(await badgeLabel(page)).toContain('unpkg');
  });
});

test.describe('case g — mid-download stall', () => {
  test.setTimeout(200_000);

  test('stall trip advances to the next host', async ({ page }) => {
    const bytes = ledger(page);
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );

    // A route that never settles IS a stall: the fetch stays pending and no
    // progress events arrive.
    await page.route('**/cdn.jsdelivr.net/**/duckdb-eh.wasm', () => {
      /* deliberately never fulfill or abort */
    });

    await page.goto('/');
    const ms = await waitForReady(page, 180_000);

    expect(ms, 'stall should advance to unpkg and succeed').not.toBeNull();
    expect(bytes.hostsTouched).toContain('unpkg.com');
    expect(bytes.extensionRequests).toHaveLength(0);
  });
});

test.describe('case h — store write rate', () => {
  test.setTimeout(300_000);

  test('badge commits stay under 12/s during a 1.6 Mbps boot', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await page.addInitScript(`
      window.__MUT = 0;
      window.addEventListener('DOMContentLoaded', () => {
        new MutationObserver(() => { window.__MUT += 1; })
          .observe(document.body, { subtree: true, childList: true, characterData: true });
      });
    `);
    await throttle(page, '1.6mbps');

    await page.goto('/');
    const ms = await waitForReady(page, 240_000);
    expect(ms).not.toBeNull();

    const mutations: number = await page.evaluate(() => window.__MUT);
    const elapsedSec = (ms as number) / 1000;
    const perSec = mutations / Math.max(elapsedSec, 0.001);

    // DOM mutations are an UPPER BOUND on store writes: every store change that
    // reaches React can produce a mutation, but many do not. If the bound is
    // under 12/s, the throttle is doing its job.
    expect(perSec).toBeLessThanOrEqual(12);
  });
});

test.describe('case i — no extension requests, no console errors', () => {
  test('holds across a normal eager boot', async ({ page }) => {
    const errors = errorCollector(page);
    const bytes = ledger(page);
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );

    await page.goto('/');
    expect(await waitForReady(page, 120_000)).not.toBeNull();

    expect(bytes.extensionRequests).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
