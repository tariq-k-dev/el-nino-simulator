/**
 * Unit tests for the E2E stale-bundle guard.
 *
 * Run under vitest (see vitest.config.ts `include`). The point of testing this at
 * all: the guard's failure mode is silence. A hash function that returns a
 * constant, or a `checkStamp` that treats "missing" as "fresh", would leave the
 * guard installed and useless while every spec run reports a confident "no
 * change" against a stale bundle — the exact false conclusion this whole task
 * exists to correct. So the tests assert both directions: same tree => same hash,
 * any change => different hash, and "cannot tell" => failure.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STALE_BUNDLE_MESSAGE,
  checkStamp,
  hashSrcTree,
  listFiles,
  makeStamp,
  readStamp,
} from './srcHash.mjs';

let root;

/** Lay down a fake repo with the given src/ files. */
async function makeRepo(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'srchash-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dir, 'src', rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
  return dir;
}

beforeEach(async () => {
  root = await makeRepo({
    'main.tsx': 'export const a = 1;\n',
    'lib/helpers.ts': 'export const b = 2;\n',
    'lib/nested/deep.ts': 'export const c = 3;\n',
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('listFiles', () => {
  it('returns sorted, forward-slash, src-relative paths', async () => {
    const files = await listFiles(path.join(root, 'src'), path.join(root, 'src'));
    expect(files).toEqual(['lib/helpers.ts', 'lib/nested/deep.ts', 'main.tsx']);
  });

  it('uses POSIX separators so the stamp reproduces on another platform', async () => {
    const files = await listFiles(path.join(root, 'src'), path.join(root, 'src'));
    for (const f of files) expect(f).not.toContain('\\');
  });
});

describe('hashSrcTree', () => {
  it('is deterministic for an unchanged tree', async () => {
    const first = await hashSrcTree(root);
    const second = await hashSrcTree(root);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when a file changes', async () => {
    const before = await hashSrcTree(root);
    await writeFile(path.join(root, 'src', 'lib', 'helpers.ts'), 'export const b = 99;\n', 'utf8');
    expect(await hashSrcTree(root)).not.toBe(before);
  });

  it('changes when a file is added', async () => {
    const before = await hashSrcTree(root);
    await writeFile(path.join(root, 'src', 'extra.ts'), 'export const d = 4;\n', 'utf8');
    expect(await hashSrcTree(root)).not.toBe(before);
  });

  it('changes when a file is renamed even if the bytes are identical', async () => {
    const before = await hashSrcTree(root);
    await writeFile(path.join(root, 'src', 'renamed.ts'), 'export const a = 1;\n', 'utf8');
    await rm(path.join(root, 'src', 'main.tsx'));
    expect(await hashSrcTree(root)).not.toBe(before);
  });

  it('does not depend on readdir order', async () => {
    const mirror = await makeRepo({
      'main.tsx': 'export const a = 1;\n',
      'lib/helpers.ts': 'export const b = 2;\n',
      'lib/nested/deep.ts': 'export const c = 3;\n',
    });
    try {
      expect(await hashSrcTree(mirror)).toBe(await hashSrcTree(root));
    } finally {
      await rm(mirror, { recursive: true, force: true });
    }
  });
});

describe('makeStamp / readStamp', () => {
  it('round-trips through dist-e2e/build-stamp.json', async () => {
    const stamp = await makeStamp(root, 'abc1234');
    expect(stamp.gitHead).toBe('abc1234');
    expect(stamp.srcHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isNaN(Date.parse(stamp.builtAt))).toBe(false);

    await mkdir(path.join(root, 'dist-e2e'), { recursive: true });
    await writeFile(
      path.join(root, 'dist-e2e', 'build-stamp.json'),
      `${JSON.stringify(stamp, null, 2)}\n`,
      'utf8',
    );
    expect(await readStamp(root)).toEqual(stamp);
  });

  it('returns null rather than throwing when the stamp is absent', async () => {
    expect(await readStamp(root)).toBeNull();
  });

  it('returns null rather than throwing when the stamp is malformed', async () => {
    await mkdir(path.join(root, 'dist-e2e'), { recursive: true });
    await writeFile(path.join(root, 'dist-e2e', 'build-stamp.json'), '{not json', 'utf8');
    expect(await readStamp(root)).toBeNull();
  });
});

describe('checkStamp', () => {
  it('passes on a matching srcHash', async () => {
    const stamp = await makeStamp(root, 'abc1234');
    expect(checkStamp(stamp, stamp.srcHash)).toEqual({ ok: true });
  });

  it('fails on a mismatched srcHash and names both prefixes', async () => {
    const stamp = await makeStamp(root, 'abc1234');
    const verdict = checkStamp(stamp, 'f'.repeat(64));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('srcHash');
    expect(verdict.reason).toContain(stamp.srcHash.slice(0, 12));
  });

  it('fails when the stamp is missing — "cannot tell" is not "fresh"', () => {
    const verdict = checkStamp(null, 'a'.repeat(64));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('pnpm build:e2e');
  });

  it('fails when srcHash is absent or empty', () => {
    expect(checkStamp({ gitHead: 'abc1234' }, 'a'.repeat(64)).ok).toBe(false);
    expect(checkStamp({ srcHash: '' }, 'a'.repeat(64)).ok).toBe(false);
    expect(checkStamp('a string', 'a'.repeat(64)).ok).toBe(false);
  });

  it('the guard message the global setup throws is a stable literal', () => {
    // The spec suite greps for this string; changing it silently disarms the guard.
    expect(STALE_BUNDLE_MESSAGE).toBe('STALE E2E BUNDLE');
  });
});
