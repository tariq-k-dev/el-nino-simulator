import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The manifest module reads two compile-time defines. Vitest does not run vite's
 * `define` substitution the same way, so each test installs the globals it needs
 * on globalThis and clears the module's memo between cases.
 */
const DEFINED_VERSION = '1.32.0';

async function loadWith(opts: { version?: string | null; sizes?: { eh: number; mvp: number } | null }) {
  const mod = await import('@/lib/engine/manifest');
  mod.__resetManifestCache();

  const g = globalThis as Record<string, unknown>;
  if (opts.version === null) delete g.__DUCKDB_VERSION__;
  else g.__DUCKDB_VERSION__ = opts.version ?? DEFINED_VERSION;

  if (opts.sizes === null) delete g.__DUCKDB_DECODED_BYTES__;
  else g.__DUCKDB_DECODED_BYTES__ = opts.sizes ?? { eh: 34242586, mvp: 39362651 };

  return mod;
}

describe('getDecodedBytes', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    const g = globalThis as Record<string, unknown>;
    delete g.__DUCKDB_VERSION__;
    delete g.__DUCKDB_DECODED_BYTES__;
  });

  it('returns the measured decoded size when the version matches', async () => {
    const mod = await loadWith({});
    const eh = mod.getDecodedBytes('eh');
    expect(eh.decodedBytes).toBe(34242586);
    expect(eh.usable).toBe(true);
    expect(eh.manifestVersion).toBe(DEFINED_VERSION);

    const mvp = mod.getDecodedBytes('mvp');
    // Memoised, but the same object is fine — the size is per-call, not per-kind.
    expect(mvp.decodedBytes).toBe(34242586);
    expect(mvp.usable).toBe(true);
  });

  it('warns and degrades to indeterminate when the version is stale', async () => {
    const mod = await loadWith({ version: '1.28.0' });
    const m = mod.getDecodedBytes('eh');
    expect(m.usable).toBe(false);
    expect(m.decodedBytes).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale'));
  });

  it('never throws when the version is stale — it degrades', async () => {
    const mod = await loadWith({ version: '0.0.0-other' });
    expect(() => mod.getDecodedBytes('eh')).not.toThrow();
    expect(mod.getDecodedBytes('eh').usable).toBe(false);
  });

  it('degrades when the sizes are absent entirely', async () => {
    const mod = await loadWith({ sizes: null });
    const m = mod.getDecodedBytes('eh');
    expect(m.decodedBytes).toBeNull();
    expect(m.usable).toBe(false);
  });

  it('degrades for a bundle kind with no recorded size', async () => {
    const mod = await loadWith({ sizes: { eh: 0, mvp: 39362651 } });
    const m = mod.getDecodedBytes('eh');
    expect(m.decodedBytes).toBeNull();
    expect(m.usable).toBe(false);
  });
});
