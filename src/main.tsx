import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import '@/index.css';

// With ?debug, install an early error collector BEFORE React mounts.
//
// Why here: the R3F frame loop starts on the first render, so any throw during
// mount has already happened by the time a devtools console hook can be attached
// from outside. Catching it at module-evaluation time is the only way to see the
// real message. Costs nothing when the param is absent.
if (new URLSearchParams(window.location.search).has('debug')) {
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
}

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
