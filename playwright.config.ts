import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end acceptance config. Run with `pnpm e2e`.
 *
 * NOT part of `pnpm test`: these specs need a built `dist/`, a browser, and the
 * DuckDB wasm from a CDN, so they are a separate, slower, network-dependent gate.
 *
 * The web server is the committed Brotli server rather than `vite preview`,
 * because production (Cloudflare Pages) serves compressed responses and the
 * timing assertions in cases c/d are only meaningful on a realistic transfer.
 */
export default defineConfig({
  testDir: './tests/e2e',
  /**
   * Fails the whole run with "STALE E2E BUNDLE" when dist-e2e/build-stamp.json's
   * srcHash does not match src/ on disk. The server below serves `dist/`, which
   * keeps its previous contents when a build link fails, so a spec run can
   * otherwise measure a bundle built from a different source tree.
   */
  globalSetup: './tests/e2e/global-setup.ts',
  // The 1.6 Mbps and 400 kbps cases legitimately take minutes.
  timeout: 400_000,
  expect: { timeout: 15_000 },
  // Serial: the cases measure wall-clock timing and byte counts, which
  // parallel workers would contend for on the same CPU/network emulation.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: '.cache/e2e-report' }]],
  outputDir: '.cache/e2e-results',

  use: {
    baseURL: 'http://localhost:4197',
    trace: 'retain-on-failure',
    // Screenshots are written under .cache/ (gitignored) and never committed.
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],

  webServer: {
    // Serves dist/ with Brotli + ETag/304, mocking Cloudflare Pages.
    command: 'node tests/e2e/brotli-server.mjs dist 4197',
    url: 'http://localhost:4197',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
