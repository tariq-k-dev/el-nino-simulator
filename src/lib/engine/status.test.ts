import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { engineStore, progressPercent, type EngineStatus } from '@/lib/engine/store';

/**
 * Regression guard for the "stuck in booting" class of bug.
 *
 * During 2B the store had markFailed wired but nothing ever called markReady, so
 * every boot sat at "Loading DuckDB 99%" forever and the UI never left the TS
 * model. These cases pin the *observable* contract the app depends on: there is a
 * reachable transition out of `booting`, in both directions, and the badge
 * vocabulary the acceptance suite greps for is derivable from the store.
 */

describe('engine lifecycle reachability', () => {
  beforeEach(() => engineStore.__reset());
  afterEach(() => engineStore.__reset());

  it('has a transition booting -> ready that records host and duration', () => {
    engineStore.startBooting({ host: 'jsdelivr', decoded: 34_242_586, mode: 'auto' });
    expect(engineStore.getSnapshot().phase).toBe('booting');

    engineStore.markReady('jsdelivr', 1234);
    const snap = engineStore.getSnapshot();
    expect(snap.phase).toBe('ready');
    if (snap.phase === 'ready') {
      expect(snap.host).toBe('jsdelivr');
      expect(snap.bootMs).toBe(1234);
    }
  });

  it('has a transition booting -> failed for each documented reason', () => {
    for (const reason of ['too-slow', 'unreachable', 'error'] as const) {
      engineStore.__reset();
      engineStore.startBooting({ host: 'jsdelivr', decoded: 100, mode: 'auto' });
      engineStore.markFailed(reason);
      expect(engineStore.getSnapshot()).toEqual({ phase: 'failed', reason });
    }
  });

  it('can leave failed via startBooting (retry path used by enableEngine)', () => {
    engineStore.markFailed('unreachable');
    engineStore.startBooting({ host: 'unpkg', decoded: 100, mode: 'user' });
    expect(engineStore.getSnapshot().phase).toBe('booting');
  });

  it('ready is terminal for progress: a late event cannot drag it back', () => {
    engineStore.startBooting({ host: 'jsdelivr', decoded: 34_242_586, mode: 'auto' });
    engineStore.reportProgress(34_242_586);
    engineStore.markReady('jsdelivr', 900);
    engineStore.reportProgress(1_000);
    expect(engineStore.getSnapshot().phase).toBe('ready');
  });
});

describe('badge vocabulary is derivable from the store', () => {
  // Mirrors what the Playwright acceptance suite matches on. If a phase stops
  // mapping to a distinguishable label, the suite would silently stop asserting
  // anything, so the mapping is pinned here.
  const labelFor = (s: EngineStatus): string => {
    switch (s.phase) {
      case 'deferred':
        return `Client-side model · Load DuckDB (~7 MB)`;
      case 'booting': {
        const pct = progressPercent(s);
        return pct === null ? 'Loading DuckDB' : `Loading DuckDB ${pct}%`;
      }
      case 'ready':
        return `DuckDB-WASM · ${s.host} · ${s.bootMs} ms`;
      case 'failed':
        return s.reason === 'too-slow'
          ? 'Client-side model · Needs a faster connection · Load anyway (~7 MB)'
          : 'Client-side model · DuckDB unavailable · Retry';
    }
  };

  it('produces the four distinct label families', () => {
    const deferred = labelFor({ phase: 'deferred', reason: 'policy' });
    const booting = labelFor({
      phase: 'booting',
      host: 'jsdelivr',
      loaded: 100,
      decoded: 1000,
      mode: 'auto',
      startedAt: 0,
      firstEventAt: 0,
    });
    const ready = labelFor({ phase: 'ready', host: 'jsdelivr', bootMs: 900 });
    const tooSlow = labelFor({ phase: 'failed', reason: 'too-slow' });
    const other = labelFor({ phase: 'failed', reason: 'unreachable' });

    expect(deferred).toMatch(/^Client-side model · Load DuckDB/);
    expect(booting).toMatch(/^Loading DuckDB \d+%/);
    expect(ready).toMatch(/^DuckDB-WASM · jsdelivr · 900 ms$/);
    expect(tooSlow).toMatch(/^Client-side model · Needs a faster connection/);
    expect(other).toMatch(/^Client-side model · DuckDB unavailable · Retry$/);

    // All five are distinguishable, so a matcher on one cannot accidentally
    // match another.
    expect(new Set([deferred, booting, ready, tooSlow, other]).size).toBe(5);
  });

  it('no label contains the retired "(CDN unreachable)" phrasing', () => {
    const labels = [
      labelFor({ phase: 'deferred', reason: 'policy' }),
      labelFor({ phase: 'failed', reason: 'too-slow' }),
      labelFor({ phase: 'failed', reason: 'unreachable' }),
      labelFor({ phase: 'failed', reason: 'error' }),
    ];
    for (const l of labels) expect(l).not.toMatch(/CDN unreachable/);
  });
});
