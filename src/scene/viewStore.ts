/**
 * `viewStore` — the tiny store that lets React see what the camera is doing without per-frame renders.
 *
 * ## Two jobs, one file
 *
 * 1. **Publish** `viewIsDefault` and `spinning`, computed by `CameraDirector` from the live pose, so the
 *    Reset control can be `aria-disabled` exactly when the view is already the default. The director
 *    writes this on EVERY frame (it is the only thing that knows the pose); the store compares against
 *    the value it already holds and only notifies subscribers when something actually changed. That is
 *    the whole reason it exists as a store rather than as React state: a `setState` per frame would
 *    re-render the header 60 times a second to say nothing.
 *
 * 2. **Carry the RESET request** from a DOM button (outside `<Canvas>`) to the director (inside it).
 *    Same shape as `scene/cameraIntents.ts`: the button cannot hold a ref into the R3F tree, so it
 *    increments a counter and the director subscribes. A counter rather than a boolean so two clicks
 *    in a row are two events, not one already-true flag.
 *
 * `useSyncExternalStore` needs a STABLE snapshot reference between changes, which is why `current` is
 * replaced only when a field differs — the same contract `scene/globeLook.ts` documents.
 */

/** What the director publishes about the view. */
export interface ViewState {
  /** Nothing selected, no user zoom, direction within 0.5 deg of the default, distance at d_fit. */
  viewIsDefault: boolean;
  /** Is the planet's spin running? */
  spinning: boolean;
}

const INITIAL: ViewState = { viewIsDefault: true, spinning: true };

let current: ViewState = INITIAL;
const listeners = new Set<() => void>();

/** The current view state. Stable reference until something changes. */
export function getViewState(): ViewState {
  return current;
}

export function subscribeViewState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Publish one frame's view state. No-op (and no notification) when nothing changed, which is what
 * keeps a 60 Hz caller from producing 60 Hz renders.
 */
export function publishViewState(next: ViewState): void {
  if (next.viewIsDefault === current.viewIsDefault && next.spinning === current.spinning) return;
  current = { viewIsDefault: next.viewIsDefault, spinning: next.spinning };
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------------ the RESET channel */

const resetListeners = new Set<() => void>();
let resetCount = 0;

/** The number of RESET requests so far. Monotonic, so a subscriber can diff it. */
export function getResetRequest(): number {
  return resetCount;
}

export function subscribeResetRequest(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
}

/** Ask the director to run the RESET rule (back to the framed default pose, `userZoomed` cleared). */
export function requestReset(): void {
  resetCount += 1;
  for (const listener of resetListeners) listener();
}

/** Test-only reset of both channels, so a unit test starts from a known state. */
export function __resetViewStore(): void {
  current = INITIAL;
  resetCount = 0;
}
