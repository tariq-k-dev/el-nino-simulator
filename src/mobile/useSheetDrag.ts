/**
 * The sheet's pointer engine — native events, no gesture library.
 *
 * ## Why native events rather than React's synthetic ones
 *
 * Three of the requirements are impossible or fragile with React's handlers:
 *
 *   1. **`setPointerCapture` must be called on the element that received `pointerdown`**, synchronously inside
 *      the handler, and the ID must be remembered so a `pointermove` from a DIFFERENT pointer can be ignored.
 *      React's synthetic event is pooled-free in 18 but its `currentTarget` is still the listener's element,
 *      which is the handle — that part works. What does not is `pointercancel` and
 *      `lostpointercapture`: both fire on the ELEMENT, not through React's delegation root in the order this
 *      code needs (capture is released before the browser dispatches the cancel to the document).
 *   2. **Zero React state during a drag.** The transform is written to `ref.current.style` directly; a
 *      `setState` per `pointermove` would re-render the whole sheet subtree 60+ times a second, and the M5 case
 *      asserts the render counter does NOT change between `touchStart` and the last `touchMove`.
 *   3. **`touch-action: none` on the handle plus `pointercancel` on a pan** is a browser contract, and it is
 *      easiest to honour by listening to the platform directly on the element the platform is talking about.
 *
 * ## The three end paths, and why they share one `finish()`
 *
 * `pointerup`, `pointercancel` and `lostpointercapture` can ALL end a drag, and on a real device more than one
 * of them fires for the same gesture: a tap that the browser decides is a pan fires `pointercancel` and then
 * `lostpointercapture` when the capture is torn down. Three handlers each doing the snap would snap twice, and
 * the second snap would use a velocity of 0 from an already-finished gesture — so the sheet would land on the
 * tier NEAREST rather than on the tier the flick chose. `finish()` is idempotent through the `active` flag and
 * all three call it.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  FLICK_PROJECTION_MS,
  SNAP_DURATION_MS,
  SNAP_EASING,
  VELOCITY_SAMPLES,
  VELOCITY_WINDOW_MS,
  clampDrag,
  computeSnapPoints,
  isTap,
  resolveSnap,
  sampleVelocity,
  sheetHeight,
  suppressesClick,
  cycleTier,
  type SnapPoints,
  type Tier,
} from '@/mobile/snapMath';

/** One velocity sample. */
interface Sample {
  y: number;
  t: number;
}

/**
 * What the hook needs from the component, and what it hands back.
 *
 * The geometry (`viewportH`) is passed IN rather than measured here: `SnapSheet` already owns the resize and
 * `visualViewport` plumbing for the element's height, and measuring the same thing twice in two places is how
 * the element's height and its snap points end up agreeing on one frame in three.
 */
export interface UseSheetDragOptions {
  tier: Tier;
  onTierChange: (tier: Tier) => void;
  viewportH: number;
}

export interface SheetDrag {
  /** Attach to the SHEET ROOT. Its transform is written directly during a drag. */
  sheetRef: React.RefObject<HTMLElement | null>;
  /** Attach to the HANDLE ZONE. This is the only pointer-event surface for dragging. */
  handleRef: React.RefObject<HTMLElement | null>;
  /** The snap points for the current viewport, for a caller that wants to read them. */
  points: SnapPoints;
  /** True while a drag is in progress. Not used for rendering — exposed for the probe. */
  isDragging: () => boolean;
  /** Drags seen so far. The M5 case reads the render counter beside this. */
  dragCount: () => number;
}

/** `prefers-reduced-motion`, read per gesture rather than cached: a reader can change it mid-session. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useSheetDrag({ tier, onTierChange, viewportH }: UseSheetDragOptions): SheetDrag {
  const sheetRef = useRef<HTMLElement | null>(null);
  const handleRef = useRef<HTMLElement | null>(null);

  const points = useMemo(() => computeSnapPoints(viewportH), [viewportH]);

  /*
   * Every mutable piece of gesture state lives in ONE ref object.
   *
   * A ref per value would work, but they are read and written together (start, move, finish) and grouping them
   * makes "the drag is over" one comparison rather than a sequence of three resets that can half-happen if a
   * handler throws. It also keeps the hook's dependency list honest: the effect below reads `drag.current` and
   * nothing else.
   */
  const drag = useRef<{
    active: boolean;
    pointerId: number | null;
    startY: number;
    startTranslate: number;
    lastY: number;
    moved: number;
    startedAt: number;
    samples: Sample[];
    suppressClick: boolean;
  }>({
    active: false,
    pointerId: null,
    startY: 0,
    startTranslate: 0,
    lastY: 0,
    moved: 0,
    startedAt: 0,
    samples: [],
    suppressClick: false,
  });

  const dragCountRef = useRef(0);

  /** The tier the sheet is currently SNAPPED to — a ref so `finish()` reads the live value, not a stale prop. */
  const tierRef = useRef<Tier>(tier);
  tierRef.current = tier;

  /**
   * The current translate, kept here as well as in the style.
   *
   * `startTranslate` must be the sheet's position when the finger landed, which is the SNAP POINT of the
   * current tier plus any residual transform — and reading it back out of `getComputedStyle` mid-transition
   * returns the interpolated value, which is what makes a drag started during a snap feel glued to the finger
   * rather than jumping to the tier.
   */
  const translateRef = useRef<number>(points[tier]);

  /* Keep the resting position in step with the tier when the tier changes from OUTSIDE (a tap, a key). */
  useEffect(() => {
    const next = points[tier];
    translateRef.current = next;
    const el = sheetRef.current;
    if (!el || drag.current.active) return;
    el.style.transition = '';
    el.style.transform = `translate3d(0, ${next}px, 0)`;
  }, [tier, points]);

  /** One idempotent end-of-gesture. */
  const finish = useCallback(
    (velocity: number, durationMs: number) => {
      const d = drag.current;
      if (!d.active) return;
      d.active = false;

      const el = sheetRef.current;
      const handle = handleRef.current;
      const pointerId = d.pointerId;
      d.pointerId = null;

      /* Release capture, guarded: the pointer may already be gone (a cancel, or a lost capture). */
      if (handle && pointerId !== null) {
        try {
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
        } catch {
          /* A pointer that no longer exists throws on some engines; nothing to do. */
        }
      }

      /* The tap rule: a small move AND a short duration cycles rather than snapping. */
      const tapped = isTap(d.moved, durationMs);
      const target: Tier = tapped ? cycleTier(tierRef.current) : resolveSnap(d.lastY, velocity, points);
      const to = points[target];

      if (el) {
        const ms = prefersReducedMotion() ? 0 : SNAP_DURATION_MS;
        el.style.transition = `transform ${ms}ms ${SNAP_EASING}`;
        el.style.willChange = 'auto';
        el.style.transform = `translate3d(0, ${to}px, 0)`;
        translateRef.current = to;
      }

      /* `suppressClick` is read by the click handler, which may fire after this returns. */
      d.suppressClick = suppressesClick(d.moved);

      /* ONE state update per gesture, which is what the M5 render-counter assertion measures. */
      if (target !== tierRef.current) onTierChange(target);
    },
    [onTierChange, points],
  );

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return undefined;

    const onPointerDown = (event: PointerEvent): void => {
      /* Ignore a secondary pointer, and ignore a second finger during an active drag. */
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      if (drag.current.active) return;

      const d = drag.current;
      d.active = true;
      d.pointerId = event.pointerId;
      d.startY = event.clientY;
      d.lastY = translateRef.current;
      d.startTranslate = translateRef.current;
      d.moved = 0;
      d.startedAt = performance.now();
      d.samples = [{ y: translateRef.current, t: performance.now() }];
      d.suppressClick = false;
      dragCountRef.current += 1;

      /*
       * Capture on the HANDLE, with a try: `setPointerCapture` throws `InvalidPointerId` if the pointer has
       * already been cancelled by the time this runs, which happens on a fast tap on a busy page. Failing here
       * must not abort the drag — the listeners are on the element and still receive the moves without capture
       * as long as the pointer stays over it.
       */
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        /* Not fatal; the drag still works while the pointer is over the handle. */
      }

      const el = sheetRef.current;
      if (el) {
        /* No transition during the drag: the sheet follows the finger exactly. */
        el.style.transition = 'none';
        el.style.willChange = 'transform';
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      const d = drag.current;
      if (!d.active || event.pointerId !== d.pointerId) return;

      const raw = d.startTranslate + (event.clientY - d.startY);
      const y = clampDrag(raw, points, viewportH);

      d.moved = Math.max(d.moved, Math.abs(event.clientY - d.startY));
      d.lastY = y;

      /*
       * The velocity ring: five samples, and anything older than the window is dropped. Both bounds matter —
       * five alone keeps a stale sample at the head of a 2 s drag, and the window alone lets a 60 Hz drag put
       * sixty samples in the ring.
       */
      const now = performance.now();
      d.samples.push({ y, t: now });
      while (d.samples.length > VELOCITY_SAMPLES) d.samples.shift();
      while (d.samples.length > 1 && d.samples[0].t < now - VELOCITY_WINDOW_MS) d.samples.shift();

      /* DIRECT DOM WRITE. No setState, no React state, nothing that re-renders. */
      const el = sheetRef.current;
      if (el) el.style.transform = `translate3d(0, ${y}px, 0)`;
    };

    const onPointerUp = (event: PointerEvent): void => {
      const d = drag.current;
      if (!d.active || event.pointerId !== d.pointerId) return;
      const now = performance.now();
      const velocity = sampleVelocity(d.samples, now);
      finish(velocity, now - d.startedAt);
    };

    const onPointerCancel = (event: PointerEvent): void => {
      const d = drag.current;
      if (!d.active || event.pointerId !== d.pointerId) return;
      /*
       * A cancel has no meaningful velocity: the browser took the gesture away, so the honest choice is the
       * nearest point from where the finger actually was. Passing 0 rather than the trailing samples is what
       * stops a cancel mid-flick from flinging the sheet.
       */
      finish(0, performance.now() - d.startedAt);
    };

    const onLostCapture = (event: PointerEvent): void => {
      const d = drag.current;
      if (!d.active || event.pointerId !== d.pointerId) return;
      /* Same reasoning as a cancel: no velocity to speak of. */
      finish(0, performance.now() - d.startedAt);
    };

    /*
     * `click` in the CAPTURE phase on the handle, so the suppression lands before React's own onClick (which is
     * delegated at the root and therefore later in the bubble phase). A drag must not also look like a tap.
     */
    const onClick = (event: MouseEvent): void => {
      if (!drag.current.suppressClick) return;
      drag.current.suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    handle.addEventListener('pointerdown', onPointerDown);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerCancel);
    handle.addEventListener('lostpointercapture', onLostCapture);
    handle.addEventListener('click', onClick, true);

    return () => {
      handle.removeEventListener('pointerdown', onPointerDown);
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerCancel);
      handle.removeEventListener('lostpointercapture', onLostCapture);
      handle.removeEventListener('click', onClick, true);
    };
  }, [finish, points, viewportH]);

  const isDragging = useCallback(() => drag.current.active, []);
  const dragCount = useCallback(() => dragCountRef.current, []);

  return { sheetRef, handleRef, points, isDragging, dragCount };
}

/**
 * The drag handle's keyboard contract, kept apart from the pointer engine.
 *
 * Arrow keys move one tier, Home and End jump to the ends. Escape is deliberately NOT bound: the app already
 * uses Escape to close the region drawer (`RegionDrawer.tsx:150-157`), and a second meaning on the same key in
 * the same document would make the drawer impossible to close with a sheet open.
 */
export function useSheetKeys(tier: Tier, onTierChange: (tier: Tier) => void) {
  return useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const at = tier;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (at !== 'full') onTierChange(at === 'peek' ? 'half' : 'full');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (at !== 'peek') onTierChange(at === 'full' ? 'half' : 'peek');
      } else if (event.key === 'Home') {
        event.preventDefault();
        if (at !== 'peek') onTierChange('peek');
      } else if (event.key === 'End') {
        event.preventDefault();
        if (at !== 'full') onTierChange('full');
      }
    },
    [tier, onTierChange],
  );
}

/** Re-exported so the sheet can print the same easing it animates with. */
export { FLICK_PROJECTION_MS, SNAP_DURATION_MS, SNAP_EASING, sheetHeight };
