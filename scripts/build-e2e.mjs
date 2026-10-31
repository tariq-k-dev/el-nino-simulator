/**
 * `VITE_E2E=1 vite build`, portably, into its OWN output directory.
 *
 * Why this exists: `"build:e2e": "... && VITE_E2E=1 vite build && ..."` is POSIX
 * shell syntax. npm/pnpm run scripts through `cmd.exe` on Windows, where that is
 * parsed as a command named `VITE_E2E` and fails with
 *
 *     'VITE_E2E' is not recognized as an internal or external command
 *
 * so the E2E build never happened on this machine and `pnpm e2e` silently ran the
 * specs against whatever `dist/` was last built — which, after `pnpm build`, is a
 * production bundle with every hook dead-code-eliminated. The specs then fail on
 * `window.__sceneGate` being undefined, which reads as a product bug.
 *
 * Setting the variable in `process.env` before spawning Vite is platform-neutral:
 * Vite reads `import.meta.env.VITE_*` from the environment and folds the literal
 * at build time, which is what makes the hook blocks dead-code-eliminable.
 *
 * Why the separate `outDir`: the E2E bundle and the production bundle used to share
 * `dist/`, so the gate's own `pnpm build` replaced the instrumented bundle with a
 * production one and the stamp guard rejected the next spec run with "dist/ was
 * replaced since the build". Two builds, one directory, is a race with no winner.
 * `dist-e2e/` is written only by this script and served only by Playwright.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

/** The directory the instrumented bundle is emitted into. Served by playwright.config.ts. */
export const E2E_OUT_DIR = 'dist-e2e';

/** Any flags after the script name are forwarded to `vite build`. */
const forwarded = process.argv.slice(2);

/*
 * The outDir is forced here rather than in package.json, because every caller of
 * `build:e2e` (the `e2e:look` chain, `e2e:batched`, a hand run) must land in the same
 * directory Playwright serves. Forgetting the flag in one place would silently put the
 * instrumented bundle back into `dist/` and return us to the stale-dist trap.
 */
if (!forwarded.includes('--outDir')) forwarded.push('--outDir', E2E_OUT_DIR);


const child = spawn(process.execPath, [viteBin, 'build', ...forwarded], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_E2E: '1',
    // A stale `dist/` from a previous production build must not contribute files
    // to the E2E bundle — check-assets would then audit a mixed output.
    NODE_ENV: 'production',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[build-e2e] vite terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
