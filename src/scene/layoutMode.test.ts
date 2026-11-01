/**
 * The layout-mode lane in `viewStore` — one matchMedia listener, and a non-reactive read for the frame loop.
 *
 * `matchMedia` is stubbed rather than mocked with jsdom's implementation, because the point of these cases is
 * the LISTENER CONTRACT (does it start once, fire on change, and clean up) and jsdom's `matchMedia` is not
 * implemented at all. The stub is deliberately hand-written: a mock that "just works" would hide the legacy
 * `addListener` branch, which is the one that matters on the browsers this repo still supports.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetLayoutMode,
  __setLayoutModeForTest,
  getLayoutMode,
  startLayoutModeObserver,
  subscribeLayoutMode,
} from './viewStore';
import { MOBILE_QUERY } from '@/mobile/snapMath';

/** A MediaQueryList stand-in with both the modern and the legacy listener APIs recorded. */
function fakeMql(matches: boolean, opts: { legacy?: boolean } = {}) {
  const changeListeners = new Set<(e: MediaQueryListEvent) => void>();
  const legacyListeners = new Set<(e: MediaQueryListEvent) => void>();
  const state = {
    matches,
    addEventListener: vi.fn((type: string, fn: (e: MediaQueryListEvent) => void) => {
      if (type === 'change') changeListeners.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: (e: MediaQueryListEvent) => void) => {
      if (type === 'change') changeListeners.delete(fn);
    }),
    addListener: vi.fn((fn: (e: MediaQueryListEvent) => void) => legacyListeners.add(fn)),
    removeListener: vi.fn((fn: (e: MediaQueryListEvent) => void) => legacyListeners.delete(fn)),
  };
  /* A MediaQueryList without `addEventListener` is what the legacy branch exists for. */
  const mql = opts.legacy
    ? ({ matches, addListener: state.addListener, removeListener: state.removeListener } as unknown as MediaQueryList)
    : (state as unknown as MediaQueryList & typeof state);

  const fire = (next: boolean) => {
    (mql as { matches: boolean }).matches = next;
    for (const fn of changeListeners) fn({ matches: next } as MediaQueryListEvent);
    for (const fn of legacyListeners) fn({ matches: next } as MediaQueryListEvent);
  };
  return { mql, fire, state };
}

function fakeWin(mql: MediaQueryList) {
  return { matchMedia: vi.fn(() => mql) } as unknown as Window;
}

afterEach(() => {
  __resetLayoutMode();
  vi.restoreAllMocks();
});

describe('the default', () => {
  it('is desktop, so a document with no matchMedia behaves as it did before the step', () => {
    expect(getLayoutMode()).toBe('desktop');
  });

  it('stays desktop when the environment has no matchMedia at all', () => {
    const cleanup = startLayoutModeObserver(MOBILE_QUERY, undefined);
    expect(getLayoutMode()).toBe('desktop');
    cleanup();
  });
});

describe('startLayoutModeObserver', () => {
  it('reads the query once on start and publishes what it found', () => {
    const { mql } = fakeMql(true);
    const win = fakeWin(mql);
    const cleanup = startLayoutModeObserver(MOBILE_QUERY, win);
    expect(win.matchMedia).toHaveBeenCalledWith(MOBILE_QUERY);
    expect(getLayoutMode()).toBe('mobile');
    cleanup();
    expect(getLayoutMode()).toBe('desktop');
  });

  it('follows changes across the breakpoint in both directions', () => {
    const { mql, fire } = fakeMql(false);
    const cleanup = startLayoutModeObserver(MOBILE_QUERY, fakeWin(mql));

    fire(true);
    expect(getLayoutMode()).toBe('mobile');
    fire(false);
    expect(getLayoutMode()).toBe('desktop');
    cleanup();
  });

  it('notifies subscribers only on an actual CHANGE, so a double fire costs no render', () => {
    const { mql, fire } = fakeMql(true);
    const listener = vi.fn();
    const unsub = subscribeLayoutMode(listener);
    const cleanup = startLayoutModeObserver(MOBILE_QUERY, fakeWin(mql));

    /* The initial read moved it to mobile: one notification. */
    expect(listener).toHaveBeenCalledTimes(1);
    /* A second `mobile` event is a no-op. */
    fire(true);
    expect(listener).toHaveBeenCalledTimes(1);
    fire(false);
    expect(listener).toHaveBeenCalledTimes(2);

    cleanup();
    unsub();
    fire(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('is idempotent, so React 18 development double-mount cannot install two listeners', () => {
    const { mql } = fakeMql(true);
    const win = fakeWin(mql);
    const first = startLayoutModeObserver(MOBILE_QUERY, win);
    const second = startLayoutModeObserver(MOBILE_QUERY, win);
    /* One `matchMedia` call: the second start saw a live observer and re-read instead of re-subscribing. */
    expect(win.matchMedia).toHaveBeenCalledTimes(1);
    expect(getLayoutMode()).toBe('mobile');
    second();
    /* The second cleanup is a no-op, so the FIRST one still owns the teardown. */
    expect(getLayoutMode()).toBe('mobile');
    first();
    expect(getLayoutMode()).toBe('desktop');
  });

  it('uses the legacy addListener API when addEventListener is missing', () => {
    const { mql, fire, state } = fakeMql(false, { legacy: true });
    const cleanup = startLayoutModeObserver(MOBILE_QUERY, fakeWin(mql));
    expect(state.addListener).toHaveBeenCalledTimes(1);
    fire(true);
    expect(getLayoutMode()).toBe('mobile');
    cleanup();
    expect(state.removeListener).toHaveBeenCalledTimes(1);
    expect(getLayoutMode()).toBe('desktop');
  });

  it('removes its listener on cleanup, so a closed page stops reacting', () => {
    const { mql, fire, state } = fakeMql(false);
    const cleanup = startLayoutModeObserver(MOBILE_QUERY, fakeWin(mql));
    cleanup();
    expect(state.removeEventListener).toHaveBeenCalledTimes(1);
    fire(true);
    expect(getLayoutMode()).toBe('desktop');
  });
});

describe('the read the frame loop makes', () => {
  it('is a plain function, not a hook, so useFrame can call it', () => {
    /* The assertion is the shape: `getLayoutMode` returns a value synchronously with no subscription. */
    __setLayoutModeForTest('mobile');
    expect(getLayoutMode()).toBe('mobile');
    __setLayoutModeForTest('desktop');
    expect(getLayoutMode()).toBe('desktop');
  });
});
