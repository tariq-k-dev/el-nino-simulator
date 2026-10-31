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
/**
 * The port this process serves on.
 *
 * `scripts/e2e-batched.mjs` runs ONE Playwright process per spec file and gives each a distinct
 * port, so a server that fails to release between files cannot answering the next one's requests.
 * That is how ERR_CONNECTION_REFUSED appeared mid-run in an earlier attempt: two brokers, one
 * port, one of them dead. A plain `pnpm e2e:raw` gets 4197 as before.
 *
 * Read from the environment rather than hardcoded so the config stays the single place a port is
 * decided, and every spawned process derives its baseURL from the same value.
 */
const PORT = Number(process.env.E2E_PORT || 4197);

export default defineConfig({
  testDir: './tests/e2e',
  /**
   * Fails the whole run with "STALE E2E BUNDLE" when dist-e2e/build-stamp.json's
   * srcHash does not match src/ on disk. The server below serves `dist-e2e/`, which
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
    baseURL: `http://localhost:${PORT}`,
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

  /*
   * C1: when the batched runner owns the server, do NOT start another one.
   *
   * `scripts/e2e-batched.mjs` spawns the Brotli server itself, directly, so it is a SIBLING of the
   * Playwright process rather than a descendant — that is what keeps `taskkill /T` on Playwright's pid
   * from taking the server down mid-file. Playwright is told here to stand down.
   */
  webServer: process.env.E2E_EXTERNAL_SERVER === '1' ? undefined : {
    /*
     * Serves the INSTRUMENTED bundle with Brotli + ETag/304, mocking Cloudflare Pages.
     *
     * `dist-e2e`, not `dist`. The two used to be the same directory, so the gate's own
     * `pnpm build` overwrote the E2E bundle with a production one and every later spec
     * run was refused by the stamp guard ("dist/ was replaced since the build"). Keeping
     * the outputs apart means `pnpm build && pnpm e2e:look` cannot invalidate a bundle
     * that `pnpm build:e2e` just produced.
     */
    command: `node tests/e2e/brotli-server.mjs dist-e2e ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
