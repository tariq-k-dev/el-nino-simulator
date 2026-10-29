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
  // The ACCESSIBLE text, not the visual spans.
  //
  // The badge's visual spans are siblings with CSS `gap`, so their textContent
  // runs together with no separators ("DuckDB-WASMjsdelivr2820 ms"). Each phase
  // now also emits one sr-only sentence carrying the full meaning, and the visual
  // spans are aria-hidden. Reading the sr-only sentence gives a real sentence and
  // is what a screen reader announces.
  //
  // The sr-only sentence is normalised back to the compact badge shape so the
  // existing regexes in the specs keep working:
  //   "DuckDB engine ready, served from jsdelivr, 2820 milliseconds."
  //     -> "DuckDB-WASM · jsdelivr · 2820 ms"
  return page.evaluate(() => {
    const live = document.querySelector('[aria-live="polite"].sr-only');
    const sentence = live ? (live.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
    if (sentence) {
      const ready = sentence.match(/^DuckDB engine ready, served from (.+?), (\d+) milliseconds\.$/);
      if (ready) return `DuckDB-WASM · ${ready[1]} · ${ready[2]} ms`;
      return sentence;
    }

    // No sr-only sentence: fall back to the visual text. Should not happen for a
    // rendered badge, but keeps the helper honest if a future phase omits one.
    const badge = document.querySelector('[aria-busy], [aria-live]');
    return badge ? (badge.textContent ?? '').replace(/\s+/g, ' ').trim() || null : null;
  });
}

export async function waitForReady(page: Page, timeoutMs = 200_000): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lbl = await badgeLabel(page);
    if (lbl && /^DuckDB-WASM/.test(lbl)) return Date.now() - t0;
    await page.waitForTimeout(200);
  }
  return null;
}

/**
 * Wait until the badge reports a terminal failure. Returns the label.
 *
 * The pattern must match the ACCESSIBLE sentence, not the visual spans.
 * `badgeLabel()` reads `[aria-live="polite"].sr-only`, and for a too-slow boot
 * that sentence is
 *
 *   "Using the built-in model. The connection is too slow for the DuckDB
 *    analytics engine, about 7 megabytes. Activate to load it anyway."
 *
 * — it says "too slow", NOT the visual label's "Needs a faster connection". The
 * old pattern only contained the visual wording, so this helper returned null
 * after its full timeout while the badge on screen read correctly. Case d failed
 * on exactly that, with a screenshot showing "Needs a faster connection".
 */
const FAILURE_PATTERN =
  /too slow|Needs a faster connection|unavailable|could not be reached|DuckDB error|Retry/i;

export async function waitForFailure(page: Page, timeoutMs = 200_000): Promise<string | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const lbl = await badgeLabel(page);
    if (lbl && FAILURE_PATTERN.test(lbl)) return lbl;
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

/** Click the badge's opt-in button ("Load DuckDB" / "Load now" / "Load anyway" / "Retry"). */
export async function clickEnable(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /Load DuckDB|Load now|Load anyway|Retry/.test(x.textContent ?? ''),
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

/**
 * The badge's screen-reader sentence: a full, punctuated description of the
 * current phase. This is the accessible text and what assertions should read —
 * the visual spans are `aria-hidden` and their `textContent` concatenates with no
 * separators ("DuckDB-WASMjsdelivr2820 ms").
 */
export async function srSentence(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[aria-live="polite"].sr-only');
    return el ? (el.textContent ?? '').trim().replace(/\s+/g, ' ') : null;
  });
}

/**
 * Text a sighted user sees: every text node NOT inside an `.sr-only` element.
 *
 * Use this for assertions like "no -0.0 on screen" — the sr-only sentences
 * deliberately contain words a screen reader needs, so `innerText` on the whole
 * body would mix the two channels.
 */
export async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let out = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = (n as Text).parentElement;
      if (parent && parent.closest('.sr-only')) continue;
      out += n.textContent ?? '';
    }
    return out.replace(/\s+/g, ' ').trim();
  });
}
