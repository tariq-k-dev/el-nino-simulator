/**
 * The runtime half of the insets registry — observation only.
 *
 * `insets.ts` owns the arithmetic and is pure. This module owns the plumbing: find the elements
 * marked `[data-occluder]`, watch them for size/position changes, recompute, and publish.
 *
 * ## Why an external store rather than context
 *
 * The result is read through `useSyncExternalStore`, which requires a stable snapshot between
 * changes. That rules out computing the insets during render (a fresh object every render is an
 * infinite loop) and it rules out context state that updates on every layout pass. The store holds
 * one object and replaces it only when a value actually moved.
 *
 * ## What triggers a recompute
 *
 * - `ResizeObserver` on every occluder — catches a panel changing size or being shown/hidden.
 * - `MutationObserver` on the document subtree — catches occluders being added or removed, which is
 *   the case `ResizeObserver` cannot see. Attribute flips on `[data-occluder]` are watched too, so a
 *   panel that gains or loses the marker is picked up.
 * - `window resize` — the viewport itself changing.
 * - `transitionend` — the drawer is a 500 ms `transform` transition with no mount/unmount, and a
 *   transform does not fire `ResizeObserver`. Without this the insets would stay stale for the whole
 *   animation and, worse, forever if nothing else changed. The same handler is bound for
 *   `animationend`, because either can be what finishes a panel's move.
 *
 * Everything is coalesced to ONE recompute per animation frame: dragging a window edge fires dozens
 * of resize events, and recomputing per event would be pure waste.
 *
 * ## What this module deliberately does NOT do
 *
 * It never writes to the camera, the scene, or any three.js object. It publishes numbers. The step
 * that consumes them (FrameOffset / fit distance) is a separate change, which is what keeps this one
 * verifiable on its own — C.5 proves the layout did not move, and that proof is only meaningful if
 * nothing here touches rendering.
 */
import { useSyncExternalStore } from 'react';
import {
  computeInsets,
  type Insets,
  type InsetsOptions,
  type OccluderRect,
  type Viewport,
} from './insets';

/** Selector attribute. One string, so the registry and the markup cannot disagree. */
export const OCCLUDER_ATTR = 'data-occluder';

/** The result before anything has been measured. */
export const ZERO_INSETS: Insets = {
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  free: { x: 0, y: 0, w: 0, h: 0 },
  degenerate: false,
  ignored: [],
};

let current: Insets = ZERO_INSETS;
const listeners = new Set<() => void>();

/** Replace the snapshot and notify ONLY when a number moved. */
function publish(next: Insets): void {
  const same =
    next.left === current.left &&
    next.right === current.right &&
    next.top === current.top &&
    next.bottom === current.bottom &&
    next.free.x === current.free.x &&
    next.free.y === current.free.y &&
    next.free.w === current.free.w &&
    next.free.h === current.free.h &&
    next.degenerate === current.degenerate &&
    next.ignored.length === current.ignored.length;
  if (same) return;
  current = next;
  for (const l of listeners) l();
}

export function getInsets(): Insets {
  return current;
}

export function subscribeInsets(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Read every marked element's rect.
 *
 * Pure enough to unit-test: takes a document-like object, returns plain rectangles. Exported so the
 * observation layer can be tested without a browser.
 */
export function readOccluderRects(doc: Document): OccluderRect[] {
  const out: OccluderRect[] = [];
  for (const el of Array.from(doc.querySelectorAll(`[${OCCLUDER_ATTR}]`))) {
    const id = el.getAttribute(OCCLUDER_ATTR) ?? '';
    const b = el.getBoundingClientRect();
    out.push({ id, left: b.left, top: b.top, right: b.right, bottom: b.bottom });
  }
  return out;
}

/** Read the viewport size. */
export function readViewport(win: Window): Viewport {
  return { w: win.innerWidth, h: win.innerHeight };
}

/**
 * Recompute from the live DOM and publish.
 *
 * Exported for the probe and for tests; the hook below calls it on each trigger.
 */
export function measureNow(doc: Document, win: Window, options: InsetsOptions = {}): Insets {
  const next = computeInsets(readViewport(win), readOccluderRects(doc), options);
  publish(next);
  return next;
}

/**
 * Observe the registry. Returns a cleanup that disconnects everything.
 *
 * `options` is intentionally NOT watched for changes: the caller passes a constant object, and
 * comparing it would add a dependency for no behaviour anyone needs yet.
 */
export function startInsetsObserver(
  doc: Document,
  win: Window,
  options: InsetsOptions = {},
): () => void {
  let frame: number | null = null;

  /** One recompute per frame, however many events fired. */
  const schedule = () => {
    if (frame !== null) return;
    frame = win.requestAnimationFrame(() => {
      frame = null;
      measureNow(doc, win, options);
    });
  };

  // Occluders already present, plus any that appear later (the MutationObserver re-registers).
  const observed = new Map<Element, ResizeObserver>();
  const resize = new ResizeObserver(schedule);

  const register = () => {
    for (const el of Array.from(doc.querySelectorAll(`[${OCCLUDER_ATTR}]`))) {
      if (observed.has(el)) continue;
      resize.observe(el);
      observed.set(el, resize);
    }
  };

  const mutations = new MutationObserver(() => {
    register();
    schedule();
  });
  mutations.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [OCCLUDER_ATTR],
  });

  // A transform transition (the drawer) fires transitionend, never ResizeObserver.
  win.addEventListener('transitionend', schedule, true);
  win.addEventListener('animationend', schedule, true);
  win.addEventListener('resize', schedule);

  register();
  measureNow(doc, win, options);

  return () => {
    if (frame !== null) win.cancelAnimationFrame(frame);
    resize.disconnect();
    mutations.disconnect();
    observed.clear();
    win.removeEventListener('transitionend', schedule, true);
    win.removeEventListener('animationend', schedule, true);
    win.removeEventListener('resize', schedule);
  };
}

/**
 * Subscribe a component to the insets.
 *
 * Nothing consumes this yet — by design. Adding a consumer is the next step's job, and keeping this
 * one unread is what lets C.5 assert "the layout did not move" and mean it.
 *
 * No options parameter: the store is computed with `DEFAULT_OPTIONS` by `startInsetsObserver`, and a
 * per-caller options object here would silently do nothing while looking like it did. When a consumer
 * needs different options it should pass them to the observer, once, at startup.
 */
export function useInsets(): Insets {
  return useSyncExternalStore(subscribeInsets, getInsets, getInsets);
}
