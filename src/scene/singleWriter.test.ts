/**
 * The single-writer guard — Step 3B's structural rule, enforced by scanning `src/`.
 *
 * ## What it asserts
 *
 * After mount, `CameraDirector` is the ONLY module that assigns the camera or its controls. This test
 * reads every `.ts`/`.tsx` file under `src/` and fails if a camera write appears outside the allowlist
 * written in `docs/STEP3B-DESIGN.md` §4:
 *
 *   - `src/scene/CameraDirector.tsx` — the director itself
 *   - `src/scene/cameraIntents.ts` — the intent channel (must contain no write; asserted)
 *   - `src/scene/GlobeScene.tsx` — the initial `<Canvas camera>` prop and the `<OrbitControls>`
 *     bounds, both declarative and applied at mount
 *
 * Everything else submits an intent.
 *
 * ## Why a source scan and not a runtime spy
 *
 * A runtime assertion only covers the paths a test happens to drive. The failure this guards against
 * is a FUTURE writer being added somewhere nobody wrote a test for — precisely the shape of the six
 * writers that existed before 3B. A source scan fails at review time, on the commit that adds the
 * seventh writer, which is the only moment the rule can be enforced cheaply.
 *
 * ## Following the existing pattern
 *
 * `tests/e2e/source-guards.test.ts` is the precedent: comments are stripped before matching, so prose
 * describing a rule does not trip it, and the file walks the tree rather than holding a hand-written
 * list. Two details carried over deliberately:
 *
 *   1. `stripComments` replaces comment characters with SPACES rather than deleting them, so line
 *      numbers in a failure still point at the right line.
 *   2. The `Math.min/max` spread rule is NOT re-implemented here — it already lives in
 *      `source-guards.test.ts` and applies to `src/` too. Re-asserting it would be a second copy of a
 *      rule that can drift; this file's comments use a fold for the same reason.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(__dirname, '..', '..');
const SRC = path.join(REPO, 'src');

/** Files allowed to contain a camera write, with the reason each is on the list. */
const ALLOWLIST: Record<string, string> = {
  'src/scene/CameraDirector.tsx': 'the director — the one module that writes the camera',
  'src/scene/GlobeScene.tsx':
    'the <Canvas camera> prop and the <OrbitControls minDistance/maxDistance> props, applied at mount',
};

/** The write patterns the rule is about, each with the reason it is a write. */
const WRITE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'camera.position =', re: /\.camera\.position\s*=(?!=)/ },
  /*
   * `camera.position.set/copy` and NOT a bare `\.position\.(set|copy)`: `Hotspot.tsx:78` sets
   * `pinRef.current.position`, which is a pin's local position and has nothing to do with the camera.
   * The first version of this guard flagged it, and the fix belongs in the pattern rather than in an
   * allowlist entry — an exemption for a file that does not write the camera makes the list lie.
   */
  { name: 'camera.position.set/copy', re: /\bcamera\.position\.(?:set|copy)\s*\(/ },
  { name: 'camera.quaternion', re: /\.quaternion\.(?:set|copy|slerp|fromBufferAttribute)\s*\(/ },
  { name: 'camera.up', re: /\.camera\.up\s*=(?!=)/ },
  { name: 'camera.zoom', re: /\.camera\.zoom\s*=(?!=)/ },
  { name: 'camera.fov', re: /\.camera\.fov\s*=(?!=)/ },
  { name: 'setViewOffset', re: /\.setViewOffset\s*\(/ },
  { name: 'clearViewOffset', re: /\.clearViewOffset\s*\(/ },
  { name: 'updateProjectionMatrix', re: /\.updateProjectionMatrix\s*\(/ },
  { name: 'controls.target =', re: /\.target\.(?:copy|set|lerp)\s*\(/ },
  { name: 'controls.minDistance', re: /\.minDistance\s*=(?!=)/ },
  { name: 'controls.maxDistance', re: /\.maxDistance\s*=(?!=)/ },
];

/** Every `.ts`/`.tsx` under `src/`, as repo-relative POSIX paths. */
async function sources(): Promise<Array<{ abs: string; rel: string }>> {
  const out: Array<{ abs: string; rel: string }> = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push({ abs: full, rel: path.relative(REPO, full).split(path.sep).join('/') });
      }
    }
  };
  await walk(SRC);
  return out;
}

/** Replace comments with spaces, so a rule described in prose never trips it. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

describe('single camera writer', () => {
  it('no camera write exists outside the allowlist', async () => {
    const offenders: string[] = [];
    for (const { abs, rel } of await sources()) {
      if (ALLOWLIST[rel]) continue;
      /* Tests are exempt: they build mock cameras and assert on them, and none of them run in the app. */
      if (/\.test\.(ts|tsx)$/.test(rel)) continue;
      const code = stripComments(await readFile(abs, 'utf8'));
      const lines = code.split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const { name, re } of WRITE_PATTERNS) {
          if (re.test(line)) offenders.push(`${rel}:${i + 1} — ${name}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      'these camera writes are outside the allowlist; submit an intent instead ' +
        '(see docs/STEP3B-DESIGN.md §4):\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('the intent channel contains no write — it must only forward', async () => {
    const code = stripComments(await readFile(path.join(SRC, 'scene', 'cameraIntents.ts'), 'utf8'));
    for (const { name, re } of WRITE_PATTERNS) {
      expect(re.test(code), `cameraIntents.ts must not write (${name})`).toBe(false);
    }
  });

  it('the director is the only file calling controls.update()', async () => {
    /*
     * `controls.update()` is how OrbitControls derives the quaternion from target+offset, so it is a
     * camera write in everything but name. It must be called by the director, once per frame, so the
     * "ignores change events raised during its own writes" rule has a single writer to reason about.
     */
    const calls: string[] = [];
    for (const { abs, rel } of await sources()) {
      if (rel === 'src/scene/CameraDirector.tsx') continue;
      if (/\.test\.(ts|tsx)$/.test(rel)) continue;
      const code = stripComments(await readFile(abs, 'utf8'));
      if (/\.update\s*\(\s*\)/.test(code) && /controls/i.test(code)) calls.push(rel);
    }
    expect(calls, `controls.update() outside the director: ${calls.join(', ')}`).toEqual([]);
  });

  it('every allowlisted path exists, and the director really does write', async () => {
    /*
     * Two directions, and they are deliberately not the same assertion.
     *
     *  - Every allowlisted path must EXIST: a guard that silently stops policing a renamed file is
     *    worse than no guard.
     *  - The director must contain WRITES: if the writes moved out of it, the exemption is stale and
     *    this file is no longer describing the system.
     *
     * `GlobeScene.tsx` cannot be checked the second way and is not pretended to be: its camera writes
     * are JSX PROPS (`camera={{ position: [...] }}`, `minDistance={...}`), which contain no assignment
     * or call syntax for the patterns to match. Asserting a match there would be asserting the regex
     * sees through JSX, which it does not; the comment states the exemption instead, and the first
     * test still fails on any NEW write in that file that is not a prop.
     */
    for (const [rel, reason] of Object.entries(ALLOWLIST)) {
      const code = stripComments(await readFile(path.join(REPO, rel), 'utf8'));
      expect(code.length, `${rel} is allowlisted for "${reason}" but is missing`).toBeGreaterThan(0);
    }
    const director = stripComments(
      await readFile(path.join(SRC, 'scene', 'CameraDirector.tsx'), 'utf8'),
    );
    const hits = WRITE_PATTERNS.filter(({ re }) => re.test(director)).map((p) => p.name);
    expect(hits, 'the director must contain the camera writes it is the allowlist for').toContain(
      'camera.position.set/copy',
    );
    expect(hits).toContain('setViewOffset');
  });

  it('the two old writer components are gone', async () => {
    /*
     * `CameraRig.tsx` and `FrameRig.tsx` were the two components whose bodies now live inside the
     * director. Leaving either file behind as dead code would put its writes back in scope of this
     * guard the moment someone imported it again.
     */
    const files = (await sources()).map((s) => s.rel);
    expect(files).not.toContain('src/scene/CameraRig.tsx');
    expect(files).not.toContain('src/scene/FrameRig.tsx');
  });
});
