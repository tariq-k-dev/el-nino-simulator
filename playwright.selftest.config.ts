/**
 * SELF-TEST Playwright config — the real one, pointed at the two synthetic specs.
 *
 * Step 3B2-FIX1 A5 needs the kill path exercised over real Playwright processes: a file that hangs past a
 * tiny per-file timeout, then a trivial file that must run green after the kill. Playwright refuses to run
 * a spec outside its `testDir`, so the synthetic specs live in `tests/e2e-selftest/` — a SIBLING of
 * `tests/e2e/`, which is what keeps them out of `pnpm e2e` (the runner lists `tests/e2e`), out of
 * `pnpm test` (the vitest glob is `tests/e2e/**`) and out of every inventory guard.
 *
 * Everything else is inherited deliberately: the same serial single-worker settings, the same
 * `globalSetup` stamp check, the same Brotli server contract (`E2E_EXTERNAL_SERVER=1` — the runner owns
 * the server), and the same launch flags. A self-test that ran under different settings would prove
 * nothing about the real runner.
 */
import { defineConfig } from '@playwright/test';
import realConfig from './playwright.config';

export default defineConfig({
  ...realConfig,
  testDir: './tests/e2e-selftest',
  /*
   * A private artifacts directory. The real one is `.cache/e2e-results`, and a self-test must not clear
   * the directory a real run's report lives in — Playwright deletes `outputDir` on start.
   */
  outputDir: '.cache/e2e-selftest-results',
});
