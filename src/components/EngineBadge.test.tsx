// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EngineBadge } from '@/components/EngineBadge';
import { engineStore, type EngineStatus } from '@/lib/engine/store';

/**
 * The badge must distinguish "no progress information yet" from "progress we
 * cannot quantify".
 *
 * The zero-event window is real and not brief: the 755 KB worker script must
 * download and execute before DuckDB emits its first InstantiationProgress
 * event (2B measured 1.5–4.9 s). Rendering a percentage-shaped placeholder there
 * claims knowledge the app does not have, and an ETA would be a fabrication.
 */

/**
 * The text a sighted user actually sees: every text node NOT inside an sr-only
 * span. Assertions that care about "no percentage on screen" must use this, since
 * the sr-only sentence deliberately contains the numbers a screen reader needs.
 */
function visibleText(): string {
  const root = document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let out = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (parent && parent.closest('.sr-only')) continue;
    // Concatenate WITHOUT an inserted separator, then normalise runs of
    // whitespace. Inserting ' ' between nodes turned "DuckDB (~7 MB)" into
    // "DuckDB ( ~7 MB)" and broke exact-substring assertions.
    out += n.textContent ?? '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Drive the store into a specific status, then render the badge. */
function renderWith(status: EngineStatus, now?: number) {
  // The store is a singleton; each case resets it then applies the target state.
  engineStore.__reset();

  switch (status.phase) {
    case 'deferred':
      engineStore.markDeferred(status.reason);
      break;
    case 'booting':
      engineStore.startBooting({
        host: status.host,
        decoded: status.decoded,
        mode: status.mode,
      });
      // `firstEventAt` is stamped BY the store on the first reportProgress, so
      // having bytes is what distinguishes "events have arrived" from "still
      // downloading the worker script". Reporting loaded > 0 is the trigger.
      if (status.loaded > 0) {
        engineStore.reportProgress(status.loaded);
      }
      break;
    case 'ready':
      engineStore.startBooting({ host: status.host, decoded: 1000, mode: 'auto' });
      engineStore.markReady(status.host, status.bootMs);
      break;
    case 'failed':
      engineStore.markFailed(status.reason);
      break;
  }

  return render(<EngineBadge now={now ?? Date.now()} />);
}

const booting = (over: Partial<Extract<EngineStatus, { phase: 'booting' }>> = {}) => {
  const base: Extract<EngineStatus, { phase: 'booting' }> = {
    phase: 'booting',
    host: 'jsdelivr',
    loaded: 0,
    decoded: 34_242_586,
    mode: 'auto',
    startedAt: Date.now(),
    firstEventAt: null,
  };
  return { ...base, ...over } as EngineStatus;
};

describe('EngineBadge — zero progress events', () => {
  beforeEach(() => engineStore.__reset());
  afterEach(() => {
    cleanup();
    engineStore.__reset();
  });

  it('renders "Starting DuckDB…" with NO percentage and NO ETA', () => {
    renderWith(booting({ loaded: 0, firstEventAt: null }));

    // Read the VISIBLE text (the sr-only sentence is separate by design).
    const text = visibleText();
    expect(text).toContain('Starting DuckDB…');
    // The whole point: no number is invented during the worker download.
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/\d+\s*s left/);
    expect(text).not.toMatch(/Loading DuckDB/);
  });

  it('exposes an aria-live sr-only sentence, with the visual spans aria-hidden', () => {
    renderWith(booting({ loaded: 0, firstEventAt: null }));

    // The announcement lives on the sr-only sentence, not the wrapper, so a
    // screen reader reads the sentence rather than concatenated chrome.
    const live = document.querySelector('[aria-live="polite"].sr-only');
    expect(live).not.toBeNull();
    expect(live?.textContent).toMatch(/Loading the DuckDB analytics engine/);

    // The visible label must be hidden from assistive tech or it doubles up.
    const visual = [...document.querySelectorAll('span')].find(
      (el) => el.textContent?.trim() === 'Starting DuckDB…',
    );
    expect(visual?.getAttribute('aria-hidden')).toBe('true');

    // Busy state still marks the region.
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('the sr-only sentence carries no numbers during worker load', () => {
    renderWith(booting({ loaded: 0, firstEventAt: null }));
    const live = document.querySelector('[aria-live="polite"].sr-only');
    expect(live?.textContent ?? '').not.toMatch(/\d+\s*%/);
    expect(live?.textContent ?? '').not.toMatch(/\d+\s*second/);
  });

  it('shows an indeterminate bar (no width from progress)', () => {
    renderWith(booting({ loaded: 0, firstEventAt: null }));
    // The pulsing bar is the w-1/3 element; a determinate bar would carry an
    // inline width style derived from progressPercent().
    const bar = document.querySelector('.animate-pulse');
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.width).toBe('');
  });
});

describe('EngineBadge — determinate progress after the first event', () => {
  beforeEach(() => engineStore.__reset());
  afterEach(() => {
    cleanup();
    engineStore.__reset();
  });

  it('switches to "Loading DuckDB NN%" once bytes are reported', () => {
    renderWith(
      booting({ loaded: 17_121_293, decoded: 34_242_586, firstEventAt: Date.now() - 9_000 }),
    );

    const text = visibleText();
    expect(text).toMatch(/Loading DuckDB \d+%/);
    expect(text).not.toContain('Starting DuckDB');
    // ~50% of 34,242,586
    expect(text).toMatch(/Loading DuckDB 50%/);
  });

  it('shows an ETA only after 5 s of data time', () => {
    // The store stamps firstEventAt from Date.now() when the first progress
    // report lands, so elapsed "data time" is simulated through the badge's
    // `now` prop rather than by pre-setting the timestamp.

    // 2 s of data time: below the ETA threshold, so no estimate.
    const early = Date.now();
    renderWith(booting({ loaded: 5_000_000, decoded: 34_242_586 }), early + 2_000);
    expect(visibleText()).not.toMatch(/s left/);

    cleanup();
    engineStore.__reset();

    // 10 s of data time at ~2 MB/s: the remaining 14 MB projects to ~7 s,
    // comfortably inside the 1-hour sanity bound.
    const later = Date.now();
    renderWith(booting({ loaded: 20_000_000, decoded: 34_242_586 }), later + 10_000);
    expect(visibleText()).toMatch(/~\d+ s left/);
  });

  it('never renders an ETA when the decoded size is unknown', () => {
    const t = Date.now();
    renderWith(booting({ loaded: 5_000_000, decoded: null }), t + 30_000);
    const text = visibleText();
    expect(text).toContain('Loading DuckDB');
    expect(text).not.toMatch(/\d+\s*%/);
    expect(text).not.toMatch(/s left/);
  });
});

describe('EngineBadge — other phases unchanged', () => {
  afterEach(() => {
    cleanup();
    engineStore.__reset();
  });

  it('deferred offers the opt-in button with the wire size', () => {
    renderWith({ phase: 'deferred', reason: 'policy' });
    expect(screen.getByRole('button')).toBeTruthy();
    expect(visibleText()).toMatch(/Load DuckDB \(~7 MB\)/);
    expect(document.querySelector('[aria-live="polite"].sr-only')?.textContent).toMatch(
      /built-in model/,
    );
  });

  it('ready shows host and boot time visually', () => {
    renderWith({ phase: 'ready', host: 'jsdelivr', bootMs: 1234 });
    const text = visibleText();
    expect(text).toContain('DuckDB-WASM');
    expect(text).toContain('jsdelivr');
    expect(text).toContain('1234 ms');
  });

  it('ready announces one full sentence, not concatenated spans', () => {
    renderWith({ phase: 'ready', host: 'jsdelivr', bootMs: 28 });
    const live = document.querySelector('[aria-live="polite"].sr-only');
    expect(live?.textContent).toBe('DuckDB engine ready, served from jsdelivr, 28 milliseconds.');
    // The old failure mode: the VISIBLE text glued the spans together with no
    // separators. The sr-only sentence is what fixes the announcement, so this
    // asserts the accessible name, not the raw concatenation.
    expect(live?.textContent ?? '').not.toMatch(/DuckDB-WASMjsdelivr/);
  });

  it('every visible span in the ready badge is aria-hidden', () => {
    renderWith({ phase: 'ready', host: 'unpkg', bootMs: 99 });

    // Locate the badge by its sr-only sentence, then walk up to the wrapper.
    // Escaping Tailwind's `min-h-[44px]` inside a CSS selector is fragile, so the
    // structure is found by relationship instead.
    const live = document.querySelector('[aria-live="polite"].sr-only');
    expect(live, 'the sr-only sentence must exist in the ready phase').not.toBeNull();

    const wrapper = live?.closest('div');
    expect(wrapper, 'the sr-only sentence must sit inside the badge wrapper').not.toBeNull();

    const spans = [...(wrapper?.querySelectorAll('span') ?? [])].filter(
      (el) => !el.classList.contains('sr-only'),
    );
    expect(spans.length, 'the ready badge should have visible spans').toBeGreaterThan(0);
    for (const el of spans) expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('too-slow offers "Load anyway"', () => {
    renderWith({ phase: 'failed', reason: 'too-slow' });
    const t = visibleText();
    expect(t).toMatch(/Needs a faster connection/);
    expect(t).toMatch(/Load anyway/);
    expect(document.querySelector('[aria-live="polite"].sr-only')?.textContent).toMatch(
      /too slow/,
    );
  });

  it('unreachable offers Retry', () => {
    renderWith({ phase: 'failed', reason: 'unreachable' });
    expect(visibleText()).toMatch(/Retry/);
    expect(document.querySelector('[aria-live="polite"].sr-only')?.textContent).toMatch(
      /could not be reached/,
    );
  });
});
