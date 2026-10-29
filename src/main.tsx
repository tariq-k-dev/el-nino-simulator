import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import '@/index.css';
import { initEngine } from '@/lib/engine/init';
import { engineStore } from '@/lib/engine/store';

// Diagnostic hooks are E2E/dev-build only.
//
// VITE_E2E is a string at compile time ('1' or undefined), so this is a literal
// boolean after Vite's substitution and Rollup drops the whole block from a
// production bundle. Verified by scripts/check-assets.mjs, which fails the build
// if any hook name reappears in dist/.
const E2E_HOOKS = import.meta.env.VITE_E2E === '1';

// With ?debug, install an early error collector BEFORE React mounts.
//
// Why here: the R3F frame loop starts on the first render, so any throw during
// mount has already happened by the time a devtools console hook can be attached
// from outside. Catching it at module-evaluation time is the only way to see the
// real message.
if (E2E_HOOKS && new URLSearchParams(window.location.search).has('debug')) {
  const log: Array<{ kind: string; message: string; stack: string }> = [];
  Object.assign(window, { __bootErrors: log });

  const record = (kind: string) => (event: Event) => {
    const e = event as ErrorEvent & PromiseRejectionEvent;
    const err = (e as ErrorEvent).error ?? (e as PromiseRejectionEvent).reason;
    if (log.length < 20) {
      log.push({
        kind,
        message: String(err?.message ?? err ?? e.type),
        stack: String(err?.stack ?? '').split('\n').slice(0, 8).join(' >> '),
      });
    }
  };

  window.addEventListener('error', record('error'));
  window.addEventListener('unhandledrejection', record('rejection'));

  // Expose the engine store so a diagnostic can read the exact numbers behind a
  // boot (loaded bytes, first-event timestamp, decoded size) instead of inferring
  // them from the rendered percentage. Read-only use; nothing writes here.
  Object.assign(window, { __engineStore: engineStore });
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

// Bootstrap the DuckDB engine once, according to device policy (eager / idle /
// on-demand). Deliberately outside React so it runs exactly once regardless of
// StrictMode's double-invoked effects, and so an `idle` policy can wait for
// `load` + visibility without a component having to stay mounted.
initEngine();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
