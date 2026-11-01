/**
 * SELF-TEST SPEC 2 of 2 — trivial and fast, and it must run GREEN **after** `hangs.spec.ts` was killed.
 *
 * This is the assertion the whole of step 3B2-FIX1 A5 exists for. In run 1 a killed `boot.spec.ts` left
 * the shared server dead and every later file failed on `net::ERR_CONNECTION_REFUSED` — 38 tests that all
 * passed in isolation. So this file does not merely check that a page loads: it checks that the server
 * the runner started for THIS file answers over HTTP, which is the exact thing that was broken.
 *
 * Served from `dist-e2e/` on the runner's own port, same as every real spec.
 */
import { expect, test } from '@playwright/test';

test('SELFTEST: the server answers after the previous file was killed', async ({ page, baseURL }) => {
  const res = await page.request.get(baseURL ?? 'http://localhost:4197/');
  expect(res.status(), `the Brotli server must answer on its own port (${baseURL})`).toBeLessThan(400);

  await page.goto('/');
  await expect(page.locator('body')).toBeVisible({ timeout: 30_000 });

  // The app's own mount point, so this is a page that booted rather than an empty document.
  const roots = await page.locator('#root, #globe-canvas').count();
  expect(roots, 'the document must carry the app root').toBeGreaterThan(0);
});
