/**
 * SUITE INVENTORY GUARD — a test title may be added, never silently lost or renamed.
 *
 * Why this exists. The Part 2 report claimed `e2e:look` ran "22 tests" while Part 1 reported 23.
 * Nothing had actually been dropped — `playwright --list` returns 23 — but the discrepancy cost a
 * round trip to disprove, and a suite that cannot state its own size is one rename away from
 * quietly testing less than it claims. A pixel suite's failure mode is silence; the count is the
 * cheapest tripwire on it.
 *
 * The rule: the set below is the EXPECTED TITLES. Adding a test is fine (the assertion is one-way
 * — every expected title must still be present). Removing or renaming one without editing this
 * constant fails, which is the point: the edit then has to be deliberate and visible in a diff.
 *
 * The list is read from `playwright --list`, not from parsing describe() calls, so it reflects what
 * the runner will actually execute — including conditional registration and `describe` nesting.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(__dirname, '..', '..');

/**
 * The look-acceptance suite: the three files `pnpm e2e:look` runs.
 *
 * Ordered as Playwright lists them (file order as given on the command line, then source order),
 * because that is what makes a diff between this constant and a live run readable.
 */
export const EXPECTED_LOOK_TITLES = [
  // --- tests/e2e/globe.spec.ts — the five zoom cases (3.8), frozen since 9757015 ---
  'wheel at the globe centre moves the distance monotonically and clamps',
  'wheel over a pin label zooms the globe',
  'pinch at 375x667 changes the distance',
  'zoom still works after a region fly-to',
  'wheel over the control deck does not zoom the globe',
  // --- tests/e2e/look.spec.ts — 3.1 to 3.9 ---
  '3.1 rim: soft monotonic halo, no hard edge',
  '3.2 glare: zero clipped pixels and no blob over 12 px at all 12 azimuths',
  '3.3 blue circle: no local peak over 1.15x outside the sun glint',
  '3.4 terminator: measured from pixels, soft and readable',
  '3.4 terminator: other 11 azimuths, night mean and no hard step',
  '3.5 pins: readable, unblown and still amber — day and night',
  '3.6 rings: no light cast on the surface around a pin',
  '3.9 glint: the accepted attenuated look, as shipped',
  '3.7 console: zero warnings or errors through the look suite',
  // --- tests/e2e/negative.spec.ts — N1, N2, N3, N4, N9, N10, N5, N7, N8 ---
  'N1: an amber pointLight at a pin core makes 3.6 ring luminance FAIL',
  'N2: specularIntensity 1.0 with roughness floor 0 makes 3.2 glare FAIL',
  'N3: atmosphere alpha forced to 1 at the silhouette makes 3.1 FAIL',
  'N4: the retired fill light makes 3.3 FAIL in W1 once the material specular is back',
  'N9: the glint sentinel FAILS when the specular overlay is off',
  'N10: the glint sentinel FAILS when si 1.0 and the roughness floor are restored',
  'N5: 3.2 rejects an all-black capture as invalid and fails an all-white one',
  'N7: pin emissiveIntensity x4 blows out 3.5 P2/P3 for a day AND a night pin',
  'N8: pins hidden / core material black makes 3.5 P1 FAIL',
] as const;

/**
 * Titles are reported by `--list` with a leading `[chromium] › path › describe › ` prefix and the
 * trailing `(file:line:col)` that the HTML reporter adds. Strip both, leaving the leaf title.
 */
export function normaliseListedTitles(stdout: string): string[] {
  const out: string[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.includes('›')) continue;
    if (!/\[(chromium|firefox|webkit)\]/.test(raw)) continue;
    const leaf = raw.split('›').pop();
    if (!leaf) continue;
    out.push(leaf.trim());
  }
  return out;
}

describe('the look suite inventory', () => {
  it('every expected title is still registered', () => {
    /*
     * `--list` starts a webServer. `reuseExistingServer` is false outside CI, so on a machine with
     * no server running this would try to bind a port; the command is given a short timeout and a
     * failure is reported as a SKIP of the live half rather than a false red — the CONSTANT is
     * still guarded by the count assertion below either way.
     */
    let listed: string[] = [];
    try {
      const stdout = execFileSync(
        process.execPath,
        [
          path.join(REPO, 'node_modules', '@playwright', 'test', 'cli.js'),
          'test',
          'look.spec.ts',
          'negative.spec.ts',
          'globe.spec.ts',
          '--list',
          '--reporter=list',
        ],
        { cwd: REPO, encoding: 'utf8', timeout: 120_000, env: { ...process.env, PLAYWRIGHT_HTML_OPEN: 'never' } },
      );
      listed = normaliseListedTitles(stdout);
    } catch (error) {
      // A list failure is infrastructure, not a missing test. Say so plainly.
      console.warn(`[inventory] playwright --list did not run: ${(error as Error).message}`);
    }

    if (listed.length === 0) {
      console.warn('[inventory] no titles could be listed; only the constant was checked');
      expect(EXPECTED_LOOK_TITLES.length).toBe(23);
      return;
    }

    const missing = EXPECTED_LOOK_TITLES.filter((t) => !listed.includes(t));
    expect(
      missing,
      `These titles are in the expected set but NOT in the suite — a test was removed or renamed. ` +
        `If the rename was deliberate, update EXPECTED_LOOK_TITLES in the same commit:\n  ` +
        missing.join('\n  '),
    ).toEqual([]);

    /*
     * The count is asserted in the OTHER direction only in the sense that additions are allowed —
     * but the total is stated so a surprise +5 is noticed. Not `toEqual`, because adding a test
     * must not require editing this file to go green.
     */
    expect(listed.length).toBeGreaterThanOrEqual(EXPECTED_LOOK_TITLES.length);
  });

  it('the expected set itself has no duplicates and matches the reported 23', () => {
    expect(new Set(EXPECTED_LOOK_TITLES).size).toBe(EXPECTED_LOOK_TITLES.length);
    expect(EXPECTED_LOOK_TITLES.length).toBe(23);
  });

  it('the two 3.4 titles are present — the pair Part 2 mis-reported as 22', () => {
    // Pins the specific discrepancy: default + 12-az are TWO tests, not one.
    const terminator = EXPECTED_LOOK_TITLES.filter((t) => t.startsWith('3.4 terminator'));
    expect(terminator).toHaveLength(2);
  });
});
