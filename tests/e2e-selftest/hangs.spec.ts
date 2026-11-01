/**
 * SELF-TEST SPEC 1 of 2 — hangs past a tiny per-file timeout, so the runner's kill path is exercised.
 *
 * Never part of the real suite: `tests/e2e-selftest/` is not `testDir` for `playwright.config.ts`
 * (`./tests/e2e`), and no glob in `vitest.config.ts` reaches it, so nothing here runs in `pnpm test` or
 * `pnpm e2e`. The only entry point is `node scripts/e2e-batched.mjs --self-test`, which drives this file
 * and `passes.spec.ts` through the SAME `runOnce` the real table uses.
 *
 * What it proves when it is killed:
 *
 *   1. the harness detects the port was released (the server is a sibling; `taskkill /T` on Playwright
 *      does not touch it, so the timeout handler now tears it down explicitly);
 *   2. the NEXT file starts a fresh server on a fresh port and its test actually runs — which is the
 *      whole of the run-1 defect: one killed file made 38 later tests fail on ERR_CONNECTION_REFUSED.
 *
 * The hang is a test that never resolves, not a `waitForTimeout`: a long sleep would finish on its own
 * and prove nothing about the kill. The playwright test timeout is raised above the runner's timeout so
 * the RUNNER is what fires.
 */
import { expect, test } from '@playwright/test';

test.setTimeout(10 * 60_000);

test('SELFTEST: hangs forever, so the runner must kill this file', async ({ page }) => {
  await page.goto('/');
  // Prove the page loaded, then hang: the runner's backstop — not this file — has to end it.
  await expect(page.locator('body')).toBeVisible({ timeout: 30_000 });
  await new Promise(() => {
    /* never resolves */
  });
});
