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

import {
    computeFreeRect,
    isMobileMode,
    resolveLayoutMode,
    type LayoutMode2,
    type MobileFreeRect,
} from "@/mobile/layoutMath";

/** What the director publishes about the view. */
export interface ViewState {
    /** Nothing selected, no user zoom, direction within 0.5 deg of the default, distance at d_fit. */
    viewIsDefault: boolean;
    /** Is the planet's spin running? */
    spinning: boolean;
    /**
     * Is a region card / drawer open? Published by `GlobeScene` from the `activeRegion` prop.
     *
     * Step 3B2-FIX1 B: `viewIsDefault` is a question about the POSE, and an open region is a reason to be
     * able to Reset even when the pose happens to be the default — so the Reset control is disabled only
     * when BOTH are false. Kept in this store rather than threaded through the header as a prop because the
     * store is already the one thing React reads from the scene each frame.
     */
    hasRegion: boolean;
}

const INITIAL: ViewState = {
    viewIsDefault: true,
    spinning: true,
    hasRegion: false,
};

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
    if (
        next.viewIsDefault === current.viewIsDefault &&
        next.spinning === current.spinning &&
        next.hasRegion === current.hasRegion
    ) {
        return;
    }
    current = {
        viewIsDefault: next.viewIsDefault,
        spinning: next.spinning,
        hasRegion: next.hasRegion,
    };
    for (const listener of listeners) listener();
}

/**
 * Publish just the selection flag.
 *
 * Called from two places that already know the answer without a frame: `GlobeScene`'s selection effect
 * (React's `activeRegion` prop) and `ResetViewButton` right after it clears the selection. The director's
 * per-frame publish carries the same value from the machine, and `publishViewState` drops the duplicate.
 */
export function publishHasRegion(hasRegion: boolean): void {
    publishViewState({ ...current, hasRegion });
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

/**
 * Ask the director to run the RESET rule (back to the framed default pose, `userZoomed` cleared).
 *
 * Step 3B2-FIX1 B: this is ONE of the two channels `scene/resetView.ts` drives. It is exported for the
 * unit tests and for `ResetViewButton`'s caller; nothing should call it directly from a component —
 * `resetView()` is the rule, and calling half of it is what left the drawer open.
 */
export function requestReset(): void {
    resetCount += 1;
    for (const listener of resetListeners) listener();
}

/** Test-only reset of both channels, so a unit test starts from a known state. */
export function __resetViewStore(): void {
    current = INITIAL;
    resetCount = 0;
}

/* ------------------------------------------------------------------ the LAYOUT lane */

/**
 * Which layout the page is running, and the two numbers the free rectangle needs besides it.
 *
 * ## Why the mode lives in a store and not in a React context or a `useMediaQuery`
 *
 * `CameraDirector` needs it INSIDE `useFrame`, and a frame callback cannot call a hook: a `useState`
 * subscription would re-render the whole scene subtree on an orientation change (fine, once) but would also mean
 * the director's frame closure held a STALE value between the change and the re-render — one frame of the desktop
 * frustum on a phone, which is a visibly wrong picture rather than a no-op. Reading a module-scope value
 * non-reactively inside the loop has neither problem, and it is the same pattern this file already uses for the
 * RESET channel.
 *
 * ## Why a resize listener and not a media query (this replaces MOBILE1's `matchMedia`)
 *
 * MOBILE1's mode was `matchMedia('(max-width: 767.98px)')`: one boolean, evaluated by the engine at exactly the
 * crossing. That was the right instrument for a width-only question and it is the wrong one now, because the mode
 * is a function of BOTH dimensions (`mobile/layoutMath.ts`). A media query per branch would be three queries whose
 * mutual exclusion is an argument in a comment; a resize listener over `innerWidth`/`innerHeight` is one call to
 * one total function, and the DOM, the shell and the frame loop all read its result.
 *
 * The cost of that choice is coalescing, which is why every source goes through one `requestAnimationFrame`: a
 * window drag fires `resize` per pixel, and `orientationchange` fires BEFORE the new metrics are settled, so the
 * measurement has to happen on the frame after.
 *
 * ## Why the initial read is synchronous
 *
 * `startLayoutObserver` computes the mode from `innerWidth`/`innerHeight` in its own body, not on the first rAF.
 * A page that loaded at 390x844 would otherwise paint one frame of the desktop overlays over a phone viewport,
 * which is the flash this exists to prevent — and the M1 case would see `data-layout-mode="desktop"` on its
 * first read.
 *
 * ## The default with no window (jsdom, SSR, a unit test)
 *
 * `desktop`, deliberately: a document with no `innerWidth` must behave exactly as it did before this step.
 * Failing to a mobile mode would put a sheet over every screenshot in the existing suite.
 */

export interface LayoutSignal {
    /** The three-way mode. `portrait` and `phoneLandscape` are both mobile layouts. */
    mode: LayoutMode2;
    /** Layout-viewport width, CSS px. */
    width: number;
    /** Layout-viewport height, CSS px. */
    height: number;
    /**
     * The compact header's measured bottom edge, CSS px. `0` until the header publishes one (and on desktop, where
     * no compact header is mounted and the insets registry measures the desktop one instead).
     */
    headerBottom: number;
}

const INITIAL_LAYOUT: LayoutSignal = {
    mode: "desktop",
    width: 0,
    height: 0,
    headerBottom: 0,
};

let layout: LayoutSignal = INITIAL_LAYOUT;

/** The React side: one listener set, notified only when a field actually changed. */
const layoutListeners = new Set<() => void>();

/**
 * The frame-loop side: keys a consumer can subscribe to individually.
 *
 * A second set rather than reusing `layoutListeners` because the two subscribers want different things: React
 * re-renders on any change, while the director only has to re-fit when the RECT moves. Kept as one map of key →
 * listeners so a future third consumer costs one entry rather than one more module.
 */
type LayoutKey = "mode" | "size" | "headerBottom" | "all";
const layoutKeyListeners = new Map<LayoutKey, Set<() => void>>();

/** The current signal. Stable reference until something changes. */
export function getLayoutSignal(): LayoutSignal {
    return layout;
}

/** The three-way mode as of right now. Read non-reactively by the frame loop. */
export function getLayoutMode2(): LayoutMode2 {
    return layout.mode;
}

/**
 * The MOBILE1-shaped read: `'mobile'` for both mobile modes.
 *
 * Kept because the acceptance suite, `__frame.layoutMode` and `GlobeScene`'s branches all ask the two-way
 * question ("is this a phone layout or the desktop overlays?"), and answering it from the three-way field is one
 * comparison. Nothing new should use it — `getLayoutMode2` is the honest value.
 */
export function getLayoutMode(): "mobile" | "desktop" {
    return isMobileMode(layout.mode) ? "mobile" : "desktop";
}

export function subscribeLayout(listener: () => void): () => void {
    layoutListeners.add(listener);
    return () => {
        layoutListeners.delete(listener);
    };
}

export function subscribeLayoutKey(
    key: LayoutKey,
    listener: () => void,
): () => void {
    let set = layoutKeyListeners.get(key);
    if (!set) {
        set = new Set();
        layoutKeyListeners.set(key, set);
    }
    set.add(listener);
    return () => {
        set?.delete(listener);
    };
}

/** Apply a patch, notify only the listeners whose field moved, and keep the snapshot reference stable. */
function applyLayout(patch: Partial<LayoutSignal>): void {
    const next: LayoutSignal = { ...layout, ...patch };
    if (
        next.mode === layout.mode &&
        next.width === layout.width &&
        next.height === layout.height &&
        next.headerBottom === layout.headerBottom
    ) {
        return;
    }
    const modeChanged = next.mode !== layout.mode;
    const sizeChanged =
        next.width !== layout.width || next.height !== layout.height;
    const headerChanged = next.headerBottom !== layout.headerBottom;
    layout = next;

    for (const listener of layoutListeners) listener();
    const notify = (key: LayoutKey): void => {
        for (const listener of layoutKeyListeners.get(key) ?? []) listener();
    };
    if (modeChanged) notify("mode");
    if (sizeChanged) notify("size");
    if (headerChanged) notify("headerBottom");
    notify("all");
}

/**
 * The free rectangle for the current signal, as the director consumes it.
 *
 * Recomputed on every read rather than cached: it is four comparisons and a `Math.min`, and a cache is one more
 * thing that can be stale by exactly the frame that matters.
 */
export function getFreeRect(): MobileFreeRect {
    return computeFreeRect(
        layout.mode,
        layout.width,
        layout.height,
        layout.headerBottom,
    );
}

/** The smallest change in the header's bottom edge worth a publish, CSS px. */
export const HEADER_BOTTOM_EPSILON_PX = 0.5;

/**
 * Publish the compact header's measured bottom edge.
 *
 * Dropped below `HEADER_BOTTOM_EPSILON_PX` because the source is a `ResizeObserver`, which reports fractional
 * heights: a font settling or a scrollbar appearing moves it by 0.02 px, and every one of those would re-fit the
 * globe. `0.5` is the threshold the step names, and it is comfortably below one CSS pixel — the smallest change
 * the acceptance case's 1 px comparison could ever see.
 *
 * `null` publishes 0, which is what an UNMOUNTED header reports: leaving a phone's 104 px behind after a resize
 * to desktop would push the desktop free rect down by a header that is not on screen.
 */
export function publishHeaderBottom(px: number | null): void {
    const wanted = px === null || !Number.isFinite(px) || px <= 0 ? 0 : px;
    if (Math.abs(wanted - layout.headerBottom) < HEADER_BOTTOM_EPSILON_PX)
        return;
    applyLayout({ headerBottom: wanted });
}

/** Read the layout viewport. `innerWidth`/`innerHeight`, NOT `visualViewport` — see `layoutMath`. */
function readViewport(win: Window): { width: number; height: number } {
    const w = Number.isFinite(win.innerWidth) ? win.innerWidth : 0;
    const h = Number.isFinite(win.innerHeight) ? win.innerHeight : 0;
    return { width: w, height: h };
}

let layoutWindow: Window | null = null;
let layoutRefs = 0;
let layoutFrame: number | null = null;
let layoutCleanup: (() => void) | null = null;

/**
 * Start the ONE resize/orientation observer. Idempotent (ref-counted), and reads synchronously on the first call.
 *
 * Ref-counted rather than "started by the director only" because two components legitimately need it: the shell
 * (so `data-layout-mode` is right on the first paint) and the director (so its frame loop has a value). Whichever
 * mounts first starts it, and the last unmount stops it.
 */
export function startLayoutObserver(
    win: Window | undefined = typeof window === "undefined"
        ? undefined
        : window,
): () => void {
    if (!win) return () => undefined;

    /* The synchronous first read: no first-paint flash, and a spec's first read is already correct. */
    const initial = readViewport(win);
    applyLayout({
        ...initial,
        mode: resolveLayoutMode(initial.width, initial.height),
    });

    if (layoutWindow === win) {
        layoutRefs += 1;
        return () => {
            layoutRefs -= 1;
            if (layoutRefs <= 0) stopLayoutObserver();
        };
    }
    if (layoutWindow !== null) stopLayoutObserver();

    layoutWindow = win;
    layoutRefs = 1;

    const measure = (): void => {
        if (layoutFrame !== null) return;
        layoutFrame = win.requestAnimationFrame(() => {
            layoutFrame = null;
            const next = readViewport(win);
            applyLayout({
                ...next,
                mode: resolveLayoutMode(next.width, next.height),
            });
        });
    };

    win.addEventListener("resize", measure);
    win.addEventListener("orientationchange", measure);

    layoutCleanup = () => {
        if (layoutFrame !== null) {
            win.cancelAnimationFrame(layoutFrame);
            layoutFrame = null;
        }
        win.removeEventListener("resize", measure);
        win.removeEventListener("orientationchange", measure);
    };

    return () => {
        layoutRefs -= 1;
        if (layoutRefs <= 0) stopLayoutObserver();
    };
}

/**
 * Tear the observer down and return to the desktop default.
 *
 * Back to the default with the observer gone, not left at whatever it last read. The invariant is "no observer
 * means desktop": that is what a document with no `window` gets, and leaving the last value behind would make the
 * mode depend on WHEN the unmount happened — a page torn down on a phone would keep reporting a mobile mode to
 * anything that reads the store afterwards.
 */
function stopLayoutObserver(): void {
    layoutCleanup?.();
    layoutCleanup = null;
    layoutWindow = null;
    layoutRefs = 0;
    layoutFrame = null;
    applyLayout({ ...INITIAL_LAYOUT });
}

/** Test-only: force the whole signal, so a unit test can exercise every mode without a browser. */
export function __setLayoutForTest(next: Partial<LayoutSignal>): void {
    applyLayout(next);
}

/** Test-only: drop every listener and go back to the desktop default. */
export function __resetLayoutStore(): void {
    layoutCleanup?.();
    layoutCleanup = null;
    layoutWindow = null;
    layoutRefs = 0;
    layoutFrame = null;
    layout = INITIAL_LAYOUT;
    layoutListeners.clear();
    layoutKeyListeners.clear();
}
