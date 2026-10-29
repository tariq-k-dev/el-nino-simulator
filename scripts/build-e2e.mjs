/**
 * `VITE_E2E=1 vite build`, portably.
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
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

/** Any flags after the script name are forwarded to `vite build`. */
const forwarded = process.argv.slice(2);

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
