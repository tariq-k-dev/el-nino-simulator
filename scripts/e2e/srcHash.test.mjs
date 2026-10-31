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
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  E2E_DIST,
  STALE_BUNDLE_MESSAGE,
  checkStamp,
  hashDistAssets,
  hashSrcTree,
  listFiles,
  makeStamp,
  readStamp,
} from './srcHash.mjs';

let root;

const SRC = {
  'main.tsx': 'export const a = 1;\n',
  'lib/helpers.ts': 'export const b = 2;\n',
  'lib/nested/deep.ts': 'export const c = 3;\n',
};

/**
 * Lay down a fake repo with the given src/ and instrumented-bundle files.
 *
 * The bundle lives in E2E_DIST, not `dist/`: the instrumented build and the production
 * build have separate output directories since E0, and a fixture that put the assets in
 * `dist/` would pass while the real guard read an empty directory.
 */
async function makeRepo(srcFiles = SRC, assetFiles = { 'index-abc.js': 'console.log("e2e");\n' }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'srchash-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await mkdir(path.join(dir, E2E_DIST, 'assets'), { recursive: true });
  for (const [rel, contents] of Object.entries(srcFiles)) {
    const full = path.join(dir, 'src', rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
  for (const [rel, contents] of Object.entries(assetFiles)) {
    const full = path.join(dir, E2E_DIST, 'assets', rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
  return dir;
}

beforeEach(async () => {
  root = await makeRepo();
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
    const mirror = await makeRepo();
    try {
      expect(await hashSrcTree(mirror)).toBe(await hashSrcTree(root));
    } finally {
      await rm(mirror, { recursive: true, force: true });
    }
  });

  it('ignores the bundle directories, so a rebuilt bundle does not change srcHash', async () => {
    const before = await hashSrcTree(root);
    await writeFile(path.join(root, E2E_DIST, 'assets', 'index-abc.js'), 'console.log("prod");\n', 'utf8');
    expect(await hashSrcTree(root)).toBe(before);
  });
});

describe('hashDistAssets', () => {
  it('is deterministic for an unchanged bundle', async () => {
    expect(await hashDistAssets(root)).toBe(await hashDistAssets(root));
  });

  it('changes when the served bundle is replaced by a production build', async () => {
    const e2e = await hashDistAssets(root);
    // What this still guards after E0: something emptied or rewrote dist-e2e/ while
    // the stamp claims a fresh build. srcHash still matches; distHash must not.
    await writeFile(path.join(root, E2E_DIST, 'assets', 'index-abc.js'), 'console.log("prod");\n', 'utf8');
    expect(await hashDistAssets(root)).not.toBe(e2e);
  });

  it('changes when the emitted filename changes (content-hashed assets)', async () => {
    const before = await hashDistAssets(root);
    await rm(path.join(root, E2E_DIST, 'assets', 'index-abc.js'));
    await writeFile(path.join(root, E2E_DIST, 'assets', 'index-xyz.js'), 'console.log("e2e");\n', 'utf8');
    expect(await hashDistAssets(root)).not.toBe(before);
  });

  it('ignores non-JS assets, so a texture swap is not a stale bundle', async () => {
    const before = await hashDistAssets(root);
    await writeFile(path.join(root, E2E_DIST, 'assets', 'earth_day.jpg'), 'not really a jpeg', 'utf8');
    expect(await hashDistAssets(root)).toBe(before);
  });

  it('returns empty string when the instrumented bundle is absent', async () => {
    await rm(path.join(root, E2E_DIST), { recursive: true, force: true });
    expect(await hashDistAssets(root)).toBe('');
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
  const currentOf = async () => ({ srcHash: await hashSrcTree(root), distHash: await hashDistAssets(root) });

  it('passes when both hashes match', async () => {
    const stamp = await makeStamp(root, 'abc1234');
    expect(checkStamp(stamp, await currentOf())).toEqual({ ok: true });
  });

  it('fails when src/ changed and names both prefixes', async () => {
    const stamp = await makeStamp(root, 'abc1234');
    await writeFile(path.join(root, 'src', 'lib', 'helpers.ts'), 'export const b = 5;\n', 'utf8');
    const verdict = checkStamp(stamp, await currentOf());
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('src/ changed');
    expect(verdict.reason).toContain(stamp.srcHash.slice(0, 12));
  });

  it('fails when dist/ was replaced even though src/ is untouched', async () => {
    const stamp = await makeStamp(root, 'abc1234');
    await writeFile(path.join(root, E2E_DIST, 'assets', 'index-abc.js'), 'console.log("prod");\n', 'utf8');
    const verdict = checkStamp(stamp, await currentOf());
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain(`${E2E_DIST}/ was replaced`);
    expect(verdict.reason).toContain('VITE_E2E');
  });

  it('reports the src/ cause first when both moved', async () => {
    const stamp = await makeStamp(root, 'abc1234');
    await writeFile(path.join(root, 'src', 'main.tsx'), 'export const a = 9;\n', 'utf8');
    await writeFile(path.join(root, E2E_DIST, 'assets', 'index-abc.js'), 'console.log("prod");\n', 'utf8');
    expect(checkStamp(stamp, await currentOf()).reason).toContain('src/ changed');
  });

  it('fails when the stamp is missing — "cannot tell" is not "fresh"', async () => {
    const verdict = checkStamp(null, await currentOf());
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('pnpm build:e2e');
  });

  it('fails when srcHash is absent or empty', async () => {
    const current = await currentOf();
    expect(checkStamp({ distHash: current.distHash }, current).ok).toBe(false);
    expect(checkStamp({ srcHash: '', distHash: current.distHash }, current).ok).toBe(false);
    expect(checkStamp('a string', current).ok).toBe(false);
  });

  it('fails when distHash is absent — a stamp written before a build', async () => {
    const current = await currentOf();
    const verdict = checkStamp({ srcHash: current.srcHash }, current);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('distHash');
  });

  it('E2E_DIST matches the directory the build writes and Playwright serves', async () => {
    /*
     * Three files have to agree on one directory name: the builder (`--outDir`), the
     * server (`webServer.command`), and this hasher. A rename in one place is silent —
     * the hasher would return '' for a bundle that exists and every run would read
     * "distHash is absent", or worse, hash an empty directory and pass.
     */
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');
    const buildScript = await readFile(path.join(repoRoot, 'scripts', 'build-e2e.mjs'), 'utf8');
    const pw = await readFile(path.join(repoRoot, 'playwright.config.ts'), 'utf8');
    expect(buildScript).toContain(`const E2E_OUT_DIR = '${E2E_DIST}'`);
    expect(pw).toContain(`brotli-server.mjs ${E2E_DIST} `);
  });

  it('the guard message the global setup throws is a stable literal', () => {
    // The suite's docs quote this string; changing it silently disarms the guard.
    expect(STALE_BUNDLE_MESSAGE).toBe('STALE E2E BUNDLE');
  });
});
