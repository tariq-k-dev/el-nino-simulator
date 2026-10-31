/**
 * Source guards — assertions about the SHAPE of the e2e suite, not about pixels.
 *
 * These exist because each rule below was learned by being broken, and every one of them
 * fails silently if it regresses:
 *
 *  1. **No `test.fixme`/`test.skip`/`.only`/`test.slow` without a written reason.** A
 *     skipped test looks identical to a passing one in a green run. The one legitimate
 *     `fixme` (N4) carries its measurements and three options in the comment above it, and
 *     the escape hatch here is a literal `// allow-skip: <reason>` on the same line, so the
 *     permission is visible in the diff that takes it.
 *  2. **No `Math.min(...xs)` / `Math.max(...xs)` over a large array.** The spread form passes
 *     one argument per element; an all-white 1280x800 capture is ONE connected component of
 *     ~1 M points and throws "Maximum call stack size exceeded". `labelBlobs` was fixed for
 *     this and N5 is the regression test; this guard stops the pattern coming back anywhere.
 *  3. **The acquisition ordering contract** lives in `tests/e2e/look/acquire.test.ts` and is
 *     run by `pnpm test`; see that file. Keeping it out of here avoids re-asserting it.
 *
 * This file runs under vitest, so it is part of `pnpm tsc -b && pnpm lint && pnpm test`.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(__dirname, '..', '..');

/** Directories whose sources the guards apply to. */
const ROOTS = ['tests/e2e', 'src', 'scripts'];

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every source file the guards police, as repo-relative POSIX paths. */
async function sources(): Promise<Array<{ abs: string; rel: string }>> {
  const out: Array<{ abs: string; rel: string }> = [];
  for (const root of ROOTS) {
    for (const abs of await walk(path.join(REPO, root))) {
      out.push({ abs, rel: path.relative(REPO, abs).split(path.sep).join('/') });
    }
  }
  return out;
}

/** Strip block and line comments, so a guard never fires on prose describing the rule. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');
}

// ---------------------------------------------------------------- skip guards ---

/** `test.fixme(`, `test.skip(`, `it.only(`, `describe.only(`, `test.slow(`. */
const SKIP_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'test.fixme', re: /\btest\.fixme\s*\(/ },
  { name: 'test.skip', re: /\btest\.skip\s*\(/ },
  { name: '.only(', re: /\b(?:test|it|describe)\.(?:only|concurrent\.only)\s*\(/ },
  { name: 'test.slow', re: /\btest\.slow\s*\(/ },
];

/** The escape hatch. Must be on the same line, with a non-empty reason. */
const ALLOW = /\/\/\s*allow-skip:\s*\S+/;

describe('no silently skipped tests', () => {
  it('every fixme/skip/only/slow carries a written // allow-skip reason', async () => {
    const violations: string[] = [];
    for (const { abs, rel } of await sources()) {
      // This file's own pattern literals are not skip calls.
      if (rel === 'tests/e2e/source-guards.test.ts') continue;
      const lines = (await readFile(abs, 'utf8')).split(/\r?\n/);
      lines.forEach((line, i) => {
        // A pattern inside a comment is documentation, not a skip.
        if (/^\s*(\*|\/\/)/.test(line)) return;
        for (const { name, re } of SKIP_PATTERNS) {
          if (!re.test(line)) continue;
          if (ALLOW.test(line)) continue;
          violations.push(`${rel}:${i + 1} uses ${name} without a '// allow-skip: <reason>'`);
        }
      });
    }
    expect(
      violations,
      `Skipped tests must state why, or they hide in a green run:\n  ${violations.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the one permitted fixme is N4 and it still carries its measurements', async () => {
    /*
     * N4 is allowed to stay fixme only while it explains itself. If someone "fixes" it by
     * deleting the numbers, this fails — because the numbers ARE the evidence that 3.3's
     * ratio gate is blind at low signal, and the next reader should not rediscover it.
     */
    const src = await readFile(path.join(REPO, 'tests/e2e/negative.spec.ts'), 'utf8');
    /*
     * Take the TITLE, which is the first quoted string AFTER the `// allow-skip:` marker
     * closes — not the first quote on the line, which is inside the marker's own reason.
     */
    const fixmes = [
      ...src.matchAll(/\btest\.fixme\s*\([^\n]*\n\s*'([^']+)'/g),
      ...src.matchAll(/\btest\.fixme\s*\(\s*'([^']+)'/g),
    ].map((m) => m[1]);
    expect(fixmes, `unexpected fixme set: ${fixmes.join(', ')}`).toHaveLength(1);
    expect(fixmes[0]).toContain('N4');

    const block = src.slice(
      src.indexOf('N4 IS `test.fixme` ON PURPOSE'),
      src.indexOf('test.fixme(', src.indexOf('N4 IS `test.fixme` ON PURPOSE')),
    );
    for (const required of ['333,185', '+0.069', '+2.51', '(0,4,31)', '0.976 -> 0.982', 'intensity: 0.32']) {
      expect(block, `N4's justification lost its measurement "${required}"`).toContain(required);
    }
    // And it must still name the three options rather than just giving up.
    for (const option of ['raise the defect intensity', 'move W1', "change 3.3's metric"]) {
      expect(block, `N4's justification no longer names the option "${option}"`).toContain(option);
    }
  });
});

// ------------------------------------------------------------- spread guards ---

/**
 * Array sizes that are safe to spread.
 *
 * The danger is argument count, and the cap is a few tens of thousands. Anything provably
 * bounded by scene geometry (4-5 window offsets, one RGB triple, a handful of lights) is
 * fine; anything iterating pixels or components is not.
 */
describe('no Math.min/max spread over an unbounded array', () => {
  /**
   * Known-safe call sites, each with the bound that makes it safe.
   *
   * An entry is a claim; if the code moves on without the claim holding, remove it and fix
   * the site rather than widening the list.
   */
  const SAFE: Record<string, string> = {
    'src/components/ui/Sparkline.tsx':
      'data is the chart series (one value per render point, tens not pixels); replace with a reduce if it ever grows',
    'src/lib/dataset.test.ts': 'test fixture of a handful of anomalies',
    'src/lib/engine/textureTimeline.ts': 'one timestamp per texture (5 textures)',
    'src/lib/look/helpers.test.ts': 'a synthetic profile of a few dozen points',
    'tests/e2e/look.spec.ts': 'one entry per azimuth (12)',
    'tests/e2e/globe.spec.ts': 'one entry per marker hit (a handful)',
    'tests/e2e/boot.spec.ts': 'one entry per long task (a handful)',
    'tests/e2e/acceptance-matrix.mjs': 'one entry per sample run (a handful)',
    'tests/e2e/wire-bytes.mjs': 'one entry per recorded response (a handful)',
    'tests/e2e/look/clipped-probe.mjs': 'one entry per blob (a handful)',
    'tests/e2e/look/edge-attribution.mjs': 'one entry per fitted ray (360 at most)',
  };

  it('every remaining spread is on a known-bounded array', async () => {
    const offenders: string[] = [];
    for (const { abs, rel } of await sources()) {
      const src = stripComments(await readFile(abs, 'utf8'));
      if (!/Math\.(?:min|max)\s*\(\s*\.\.\./.test(src)) continue;
      if (SAFE[rel]) continue;
      offenders.push(rel);
    }
    expect(
      offenders,
      `These files spread an array into Math.min/max without a recorded bound. ` +
        `An all-white 1280x800 frame is one ~1M-point component and blows the stack:\n  ` +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('labelBlobs bounds its component by loop, and survives a 1M-point component', async () => {
    /*
     * The functional half: not "does the code look right" but "does it actually run on the
     * case that broke it". A 1000x1000 all-connected block is ~1M points in one component —
     * the exact shape N5 feeds 3.2.
     */
    const { labelBlobs } = await import('../../src/lib/look/helpers');
    const points: Array<[number, number]> = [];
    for (let y = 0; y < 1000; y += 1) {
      for (let x = 0; x < 1000; x += 1) points.push([x, y]);
    }
    const blobs = labelBlobs(points);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].size).toBe(1_000_000);
    expect(blobs[0].x0).toBe(0);
    expect(blobs[0].x1).toBe(999);
    expect(blobs[0].width).toBe(1000);
    expect(blobs[0].height).toBe(1000);
  });

  it('labelBlobs bounds match a straightforward loop reference on random blobs', async () => {
    // Bounds are the only thing the loop rewrite changed; assert they agree with the
    // obvious definition on a case with several disjoint components.
    const { labelBlobs } = await import('../../src/lib/look/helpers');
    const points: Array<[number, number]> = [
      [0, 0], [1, 0], [0, 1],
      [50, 50], [51, 50],
      [10, 10],
    ];
    const blobs = labelBlobs(points);
    const sizes = blobs.map((b) => b.size).sort((a, b) => b - a);
    expect(sizes).toEqual([3, 2, 1]);
    const three = blobs.find((b) => b.size === 3)!;
    expect([three.x0, three.x1, three.y0, three.y1]).toEqual([0, 1, 0, 1]);
  });
});

// ------------------------------------------------------- app/bundle boundary ---

describe('the app must not import the test-side measurement library', () => {
  /**
   * `src/lib/look/helpers.ts` imports `pngjs`, which is Node-only. Anything under `src/`
   * that imports it drags pngjs into the browser bundle and the app stops booting — which
   * is exactly what happened when `tsEngine.ts` imported `maxOf` from there: no page error,
   * no build failure, every e2e spec timing out on `window.__globe` never appearing.
   *
   * The build cannot catch it (Rollup bundles pngjs happily) and the unit tests cannot
   * catch it (they run in Node, where pngjs works). Only this can.
   */
  it('no src/ module imports src/lib/look/helpers', async () => {
    const offenders: string[] = [];
    for (const { abs, rel } of await sources()) {
      if (!rel.startsWith('src/')) continue;
      // The helpers module itself, and its own test, are the only legitimate holders.
      if (rel === 'src/lib/look/helpers.ts' || rel === 'src/lib/look/helpers.test.ts') continue;
      const src = await readFile(abs, 'utf8');
      if (/from\s+['"][^'"]*lib\/look\/helpers['"]/.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      `These app modules import the test-side helpers (which pull pngjs into the bundle):\n  ` +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('the production bundle contains no pngjs', async () => {
    /*
     * The functional half of the same rule, asserted on the artefact rather than the source.
     * Skipped when dist/ has not been built, so the guard never fails for the wrong reason.
     */
    const assetsDir = path.join(REPO, 'dist', 'assets');
    let files: string[];
    try {
      files = (await readdir(assetsDir)).filter((f) => /\.js$/.test(f));
    } catch {
      return; // no dist/ — nothing to assert
    }
    const leaks: string[] = [];
    for (const f of files) {
      const src = await readFile(path.join(assetsDir, f), 'utf8');
      if (/PNG\.sync\.read|pngjs/.test(src)) leaks.push(f);
    }
    expect(
      leaks,
      `pngjs is in the browser bundle (the app will not boot):\n  ${leaks.join('\n  ')}`,
    ).toEqual([]);
  });
});
