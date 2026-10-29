/**
 * Shared fixtures for the end-to-end acceptance suite.
 *
 * These specs encode the 2B acceptance criteria as executable checks. They are
 * deliberately NOT part of `pnpm test` (which stays fast, offline and
 * browser-free); run them with `pnpm e2e`.
 *
 * A local Brotli-capable static server stands in for Cloudflare Pages, because
 * `vite preview` serves identity and every byte/wall-clock figure measured
 * against it is pessimistic in a way production is not. See docs/E2E.md.
 */
import { test as base, expect, type Page } from '@playwright/test';

/** Per-response byte accounting keyed by request kind. */
export interface ByteLedger {
  worker: number;
  wasm: number;
  csv: number;
  js: number;
  other: number;
  /** Every wasm host contacted, in order. */
  hostsTouched: string[];
  /** Requests to extensions.duckdb.org (must always be zero). */
  extensionRequests: string[];
}

export const emptyLedger = (): ByteLedger => ({
  worker: 0,
  wasm: 0,
  csv: 0,
  js: 0,
  other: 0,
  hostsTouched: [],
  extensionRequests: [],
});

/**
 * Override `navigator.connection` before any app code runs.
 *
 * `null` means "delete the API entirely", which is how Safari behaves and is the
 * shape case d depends on.
 */
export function connectionInit(
  connection: { saveData?: boolean; effectiveType?: string; downlink?: number } | null,
): string {
  if (connection === null) {
    return `Object.defineProperty(Navigator.prototype, 'connection', { get: () => undefined, configurable: true });`;
  }
  return `Object.defineProperty(Navigator.prototype, 'connection', { get: () => (${JSON.stringify(
    connection,
  )}), configurable: true });`;
}

/** Force a coarse primary pointer, so the policy picks the `idle` path. */
export function pointerInit(coarse: boolean): string {
  return `(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) => q.includes('pointer: coarse')
      ? { matches: ${coarse}, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} }
      : orig(q);
  })();`;
}

/** Throttling profiles used across the suite. */
export const PROFILES = {
  unthrottled: { latency: 0, down: -1, up: -1 },
  fast4g: { latency: 40, down: (4 * 1024 * 1024) / 8, up: (1.5 * 1024 * 1024) / 8 },
  '1.6mbps': { latency: 150, down: (1.6 * 1024 * 1024) / 8, up: (750 * 1024) / 8 },
  '400kbps': { latency: 300, down: (400 * 1024) / 8, up: (400 * 1024) / 8 },
} as const;

/** Apply a CDP network profile. */
export async function throttle(page: Page, profile: keyof typeof PROFILES): Promise<void> {
  const p = PROFILES[profile];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: p.latency,
    downloadThroughput: p.down,
    uploadThroughput: p.up,
  });
}

/** Apply a CDP CPU throttling rate (1 = off, 4 = 4x slowdown). */
export async function throttleCpu(page: Page, rate: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

/** Install a byte ledger that sees worker-scoped and page-scoped requests. */
export function ledger(page: Page): ByteLedger {
  const l = emptyLedger();
  page.context().on('request', (r) => {
    const u = r.url();
    if (/extensions\.duckdb\.org/.test(u)) l.extensionRequests.push(u);
    for (const host of ['cdn.jsdelivr.net', 'unpkg.com']) {
      if (u.includes(host) && !l.hostsTouched.includes(host)) l.hostsTouched.push(host);
    }
  });
  page.on('response', async (res) => {
    const u = res.url();
    const len = await res
      .allHeaders()
      .then((h) => Number(h['content-length'] ?? 0))
      .catch(() => 0);
    if (/duckdb-browser-.*\.worker\.js/.test(u)) l.worker += len;
    else if (/\.wasm/.test(u)) l.wasm += len;
    else if (/enso\.csv/.test(u)) l.csv += len;
    else if (/\.(js|mjs)$/.test(u)) l.js += len;
    else l.other += len;
  });
  return l;
}

/**
 * The badge text currently shown, or null.
 *
 * The ready state is three sibling <span>s inside one container
 * ("DuckDB-WASM" · host · ms), so reading a single span yields only the first
 * token. This walks up to the nearest ancestor that contains the whole label and
 * reads that, which works for every phase (buttons are single elements, so their
 * nearest container is themselves).
 */
export async function badgeLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    // The ready badge is three sibling <span>s with CSS `gap` between them, so
    // `textContent` runs them together: "DuckDB-WASMjsdelivr2820 ms". There are
    // no literal "·" separators in the DOM — those separators are visual only.
    //
    // So: read the deepest element whose text matches a badge shape, then
    // re-insert the separators for readability and for the specs' regexes.
    const SHAPES: Array<{ re: RegExp; fmt: (m: RegExpMatchArray) => string }> = [
      {
        re: /^DuckDB-WASM(\S+?)(\d+) ms$/,
        fmt: (m) => `DuckDB-WASM · ${m[1]} · ${m[2]} ms`,
      },
      { re: /^Client-side model · Load DuckDB \(~\d+ MB\)$/, fmt: (m) => m[0] },
      {
        re: /^Client-side model · Needs a faster connection · Load anyway \(~\d+ MB\)$/,
        fmt: (m) => m[0],
      },
      { re: /^Client-side model · DuckDB (?:unavailable|error) · Retry$/, fmt: (m) => m[0] },
      { re: /^Loading DuckDB(?: \d+%)?(?: · ~\d+ s left)?$/, fmt: (m) => m[0] },
      { re: /^Starting DuckDB…$/, fmt: (m) => m[0] },
    ];

    const els = [...document.querySelectorAll('span,button,div')]
      .map((el) => ({ el, text: (el.textContent ?? '').trim().replace(/\s+/g, ' ') }))
      .filter((c) => c.text.length > 0 && c.text.length < 120);

    for (const { re, fmt } of SHAPES) {
      // Deepest match wins, so a leaf beats the wrapper that also contains it.
      const hits = els.filter((c) => re.test(c.text));
      if (hits.length > 0) {
        const deepest = hits.reduce((best, cur) => {
          const depth = (e: Element) => {
            let d = 0;
            for (let n: Element | null = e; n; n = n.parentElement) d += 1;
            return d;
          };
          return depth(cur.el) > depth(best.el) ? cur : best;
        });
        return fmt(deepest.text.match(re) as RegExpMatchArray);
      }
    }

    return null;
  });
}

/** Wait until the badge reports a ready engine. Returns elapsed ms, or null. */
export async function waitForReady(page: Page, timeoutMs = 200_000): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lbl = await badgeLabel(page);
    if (lbl && /^DuckDB-WASM/.test(lbl)) return Date.now() - t0;
    await page.waitForTimeout(200);
  }
  return null;
}

/** Wait until the badge reports a terminal failure. Returns the label. */
export async function waitForFailure(page: Page, timeoutMs = 200_000): Promise<string | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lbl = await badgeLabel(page);
    if (lbl && /Needs a faster connection|DuckDB unavailable|DuckDB error|Retry/.test(lbl)) return lbl;
    await page.waitForTimeout(200);
  }
  return null;
}

/** True once the sparkline shows the full 918-month record. */
export async function waitForHistory(page: Page, timeoutMs = 60_000): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const mo = await page.evaluate(() => (document.body.innerText.match(/(\d+)\s*mo\b/) || [])[1] ?? null);
    if (mo === '918') return Date.now() - t0;
    await page.waitForTimeout(150);
  }
  return null;
}

/** Number of `svg path` elements: a proxy for "sparkline has data". */
export async function sparkPathCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('svg path').length);
}

/** Click the badge's opt-in button ("Load DuckDB" / "Load anyway" / "Retry"). */
export async function clickEnable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /Load DuckDB|Load anyway|Retry/.test(x.textContent ?? ''),
    );
    if (!b) return false;
    (b as HTMLButtonElement).click();
    return true;
  });
}

/** Collect uncaught errors and console errors for the zero-error assertion. */
export function errorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });
  return errors;
}

export const test = base;
export { expect };
