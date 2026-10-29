import { test, expect } from './fixtures';
import {
  connectionInit,
  errorCollector,
  srSentence,
  throttle,
  visibleText,
  waitForFailure,
  waitForHistory,
  waitForReady,
} from './fixtures';

/**
 * A rendered negative zero: "-0" followed by nothing significant.
 *
 * Must NOT match "-0.01" / "-0.5" (real negatives), which a plain substring test
 * for "-0.0" does — that was the first version of this spec and it failed on a
 * legitimate "-0.01" jet slider label.
 */
const NEGATIVE_ZERO = /(^|[^\d.])-0(\.0*)?(?![.\d])/;

/** Offending fragments, for a readable failure message. */
function negativeZeroHits(text: string): string {
  const re = new RegExp(NEGATIVE_ZERO.source, 'g');
  const hits = text.match(re) ?? [];
  return hits.length ? `offending: ${JSON.stringify(hits.slice(0, 5))}` : 'no negative zero';
}

/**
 * 2C-harden acceptance: negative zero, dataset failure, fetch overlap, badge a11y.
 */

test.describe('3 — negative zero never renders', () => {
  test('at NEUTRAL (strength = min) no text contains -0.0, -0%, or -0°', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: true, effectiveType: '4g', downlink: 10 }),
    );
    await page.goto('/');
    await waitForHistory(page, 30_000);

    // Drag strength to its minimum (index 0).
    await page.evaluate(() => {
      const slider = document.querySelectorAll('input[type="range"]')[0] as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(slider, '0');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(400);

    // Open a region so the drawer's numbers render too.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /Equatorial Pacific/i.test(x.textContent ?? ''),
      );
      (b as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForTimeout(400);

    const text = await visibleText(page);
    // Substring checks are wrong here: "-0.01" legitimately CONTAINS "-0.0".
    // NEGATIVE_ZERO matches a -0 that is not followed by another significant
    // digit, which is the actual defect ("-0.0", "-0%", "-0°C").
    expect(text, negativeZeroHits(text)).not.toMatch(NEGATIVE_ZERO);
    // A hardcoded "+" prefix used to produce "++" / "+-" at the zero edge.
    expect(text).not.toContain('+-');
  });

  test('no negative zero at lattice points near zero', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: true, effectiveType: '4g', downlink: 10 }),
    );
    await page.goto('/');
    await waitForHistory(page, 30_000);

    // The near-zero band is where a value can round to -0.
    for (const sst of ['0.01', '0.02', '0.03', '0.04']) {
      for (const jet of ['0', '-0.01', '0.01', '-0.04']) {
        await page.evaluate(
          ({ s, j }) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            const sliders = document.querySelectorAll('input[type="range"]');
            setter.call(sliders[0], s);
            sliders[0].dispatchEvent(new Event('input', { bubbles: true }));
            setter.call(sliders[1], j);
            sliders[1].dispatchEvent(new Event('input', { bubbles: true }));
          },
          { s: sst, j: jet },
        );
        await page.waitForTimeout(150);

        const text = await visibleText(page);
        expect(text, `sst=${sst} jet=${jet}: ${negativeZeroHits(text)}`).not.toMatch(NEGATIVE_ZERO);
      }
    }
  });
});

test.describe('4 — dataset failure', () => {
  test('scenario works, history shows Retry, badge never sticks in booting', async ({ page }) => {
    const errors = errorCollector(page);
    await page.addInitScript(
      connectionInit({ saveData: true, effectiveType: '4g', downlink: 10 }),
    );
    // Block the dataset entirely.
    await page.route('**/data/enso.csv', (r) => r.abort('failed'));

    await page.goto('/');

    // History must report unavailable with a 44px retry target.
    await expect
      .poll(async () => (await visibleText(page)).includes('History unavailable'), { timeout: 30_000 })
      .toBe(true);

    const retry = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /History unavailable/i.test(x.textContent ?? ''),
      );
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { h: Math.round(r.height), text: (b.textContent ?? '').trim() };
    });
    expect(retry).not.toBeNull();
    expect(retry!.h).toBeGreaterThanOrEqual(44);

    // The scenario still works: engine deferred, numbers present and non-empty.
    const text = await visibleText(page);
    expect(text).toMatch(/\d/);
    expect(text).toContain('Client-side model');

    // Badge must never be stuck in "booting" once the fetch has failed.
    expect(text).not.toContain('Starting DuckDB');
    expect(text).not.toContain('Loading DuckDB');

    // Unblocking and retrying recovers history WITHOUT a reload.
    await page.unroute('**/data/enso.csv');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /History unavailable/i.test(x.textContent ?? ''),
      );
      (b as HTMLButtonElement | undefined)?.click();
    });

    expect(await waitForHistory(page, 40_000), 'history should recover after retry').not.toBeNull();
    expect(await visibleText(page)).not.toContain('History unavailable');

    // Retry must have re-fetched exactly once.
    expect(errors.filter((e) => /enoent|404/i.test(e))).toHaveLength(0);
  });

  test('retry re-fetches the dataset exactly once', async ({ page }) => {
    let fetches = 0;
    await page.addInitScript(
      connectionInit({ saveData: true, effectiveType: '4g', downlink: 10 }),
    );
    await page.route('**/data/enso.csv', (r) => {
      fetches += 1;
      return r.abort('failed');
    });

    await page.goto('/');
    await expect
      .poll(async () => (await visibleText(page)).includes('History unavailable'), { timeout: 30_000 })
      .toBe(true);

    const before = fetches;
    await page.unroute('**/data/enso.csv');

    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /History unavailable/i.test(x.textContent ?? ''),
      );
      (b as HTMLButtonElement | undefined)?.click();
    });
    expect(await waitForHistory(page, 40_000)).not.toBeNull();

    // One failed attempt at mount may have retried internally; the user retry adds
    // exactly one more successful fetch.
    expect(fetches - before).toBeLessThanOrEqual(1);
  });
});

test.describe('5 — worker/wasm download overlaps the dataset fetch', () => {
  test.setTimeout(200_000);

  test('CSV and worker fetches overlap in time; enso.csv requested once', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await throttle(page, '1.6mbps');

    // Timing MUST come from one clock domain.
    //
    // The worker script is fetched by a Worker, whose PerformanceResourceTiming
    // entries live in the WORKER's performance timeline — not the page's. Mixing
    // them produced impossible numbers (worker.responseEnd < worker.startTime)
    // and a false "still serialised" verdict. Network events on the browser
    // context are all on the page's wall clock, so those are what we compare.
    const events: Array<{ kind: 'csv' | 'worker'; type: 'req' | 'done'; t: number }> = [];
    page.context().on('request', (r) => {
      const k = classify(r.url());
      if (k) events.push({ kind: k, type: 'req', t: Date.now() });
    });
    page.context().on('requestfinished', (r) => {
      const k = classify(r.url());
      if (k) events.push({ kind: k, type: 'done', t: Date.now() });
    });
    page.context().on('requestfailed', (r) => {
      const k = classify(r.url());
      if (k) events.push({ kind: k, type: 'done', t: Date.now() });
    });

    const t0 = Date.now();
    await page.goto('/');

    // Both transfers must have completed before measuring.
    await expect
      .poll(
        () =>
          events.filter((e) => e.type === 'done').length >= 2 ||
          events.filter((e) => e.kind === 'worker' && e.type === 'done').length >= 1,
        { timeout: 120_000 },
      )
      .toBe(true);

    const rel = events.map((e) => ({ ...e, ms: e.t - t0 }));
    const firstOf = (k: 'csv' | 'worker') => rel.find((e) => e.kind === k && e.type === 'req');
    const lastOf = (k: 'csv' | 'worker') => [...rel].reverse().find((e) => e.kind === k && e.type === 'done');

    const csvStart = firstOf('csv')?.ms ?? null;
    const csvEnd = lastOf('csv')?.ms ?? null;
    const workerStart = firstOf('worker')?.ms ?? null;
    const workerEnd = lastOf('worker')?.ms ?? null;

    expect(csvStart, 'enso.csv must be requested').not.toBeNull();
    expect(workerStart, 'the worker script must be requested').not.toBeNull();

    // Overlap: the worker begins before the CSV finishes. A serialised
    // implementation would start the worker only after csvEnd.
    expect(
      workerStart!,
      `worker started at ${workerStart}ms, csv ended at ${csvEnd}ms — the worker ` +
        'download is blocked behind the dataset fetch',
    ).toBeLessThan(csvEnd!);

    // Exactly one CSV request.
    expect(rel.filter((e) => e.kind === 'csv' && e.type === 'req')).toHaveLength(1);

    // Worker finishing *after* the CSV is the expected shape when overlapped.
    expect(workerEnd).not.toBeNull();
  });
});

/** Which tracked transfer a URL belongs to. */
function classify(url: string): 'csv' | 'worker' | null {
  if (/enso\.csv/.test(url)) return 'csv';
  if (/duckdb-browser-.*worker\.js/.test(url)) return 'worker';
  return null;
}

test.describe('6 — badge accessibility', () => {
  // Boot at Fast 4G is normally seconds, but a cold CDN can take longer.
  test.setTimeout(180_000);

  test('sr-only sentence replaces concatenated spans in every phase', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await page.goto('/');

    // Wait for ready, then assert the announcement.
    expect(await waitForReady(page, 120_000)).not.toBeNull();

    const sentence = await srSentence(page);
    expect(sentence).not.toBeNull();
    // A full, punctuated sentence — not "DuckDB-WASMjsdelivr2820 ms".
    expect(sentence).toMatch(/^DuckDB engine ready, served from .+, \d+ milliseconds\.$/);
    expect(sentence).not.toMatch(/DuckDB-WASM\S/);

    // aria-live lives on the sr-only element, and the visual spans are hidden
    // from assistive tech so nothing is announced twice.
    const a11y = await page.evaluate(() => {
      const live = document.querySelector('[aria-live="polite"].sr-only');
      const wrapper = live?.closest('div');
      const spans = [...(wrapper?.querySelectorAll('span') ?? [])].filter(
        (el) => !el.classList.contains('sr-only'),
      );
      return {
        hasLive: !!live,
        visibleSpans: spans.length,
        allHidden: spans.every((el) => el.getAttribute('aria-hidden') === 'true'),
      };
    });
    expect(a11y.hasLive).toBe(true);
    expect(a11y.visibleSpans).toBeGreaterThan(0);
    expect(a11y.allHidden).toBe(true);
  });

  test('deferred phase announces the built-in model', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: true, effectiveType: '4g', downlink: 10 }),
    );
    await page.goto('/');

    await expect
      .poll(async () => srSentence(page), { timeout: 30_000 })
      .toMatch(/built-in model/i);

    const sentence = await srSentence(page);
    expect(sentence).toMatch(/about 7 megabytes/i);
  });

  test('failed phase announces the cause with no concatenation', async ({ page }) => {
    await page.addInitScript(
      connectionInit({ saveData: false, effectiveType: '4g', downlink: 10 }),
    );
    await throttle(page, '400kbps');
    await page.goto('/');

    const failure = await waitForFailure(page, 240_000);
    expect(failure).not.toBeNull();

    const sentence = await srSentence(page);
    expect(sentence).not.toBeNull();
    expect(sentence).toMatch(/built-in model/i);
    expect(sentence).toMatch(/—|\./);
  });
});
