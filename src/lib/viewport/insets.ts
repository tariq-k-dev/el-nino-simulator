/**
 * Occluder insets — how much of the canvas is covered on each side.
 *
 * STEP 3 replaces the measurement below. The shape (`Insets` + a
 * `useSyncExternalStore` subscription) is defined here in STEP 1 because the
 * `window.__globe` probe exposes `insets()` as part of its contract, and the
 * e2e specs must compile against a stable signature.
 *
 * For now every inset is zero, which is the honest answer while no occluder is
 * registered — and it makes `<FrameOffset>` a no-op until STEP 3 lands.
 */

export type OccluderSide = "top" | "right" | "bottom" | "left";

/** CSS pixels of canvas covered on each side. */
export interface Insets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export const ZERO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

let current: Insets = ZERO_INSETS;
const listeners = new Set<() => void>();

/** Current insets. Stable reference between changes, as `useSyncExternalStore` requires. */
export function getInsets(): Insets {
    return current;
}

export function subscribeInsets(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Test/STEP-3 seam: replace the measured insets and notify subscribers. */
export function __setInsets(next: Insets): void {
    if (
        next.top === current.top &&
        next.right === current.right &&
        next.bottom === current.bottom &&
        next.left === current.left
    ) {
        return;
    }
    current = next;
    for (const l of listeners) l();
}

/** Test seam: reset to zero. */
export function __resetInsets(): void {
    current = ZERO_INSETS;
    listeners.clear();
}
