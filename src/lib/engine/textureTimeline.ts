/**
 * Per-texture load timeline on the page's `performance.now()` clock.
 *
 * Why this exists
 * ---------------
 * The scene gate's texture half used to come from drei's `useProgress` store
 * alone (`active === false && progress === 100`). That is an aggregate with no
 * per-item detail, and it is derived from `DefaultLoadingManager` counters whose
 * formula can report 100% while a later wave of items is still in flight:
 *
 *     progress = (loaded - saveLastTotalLoaded) / (total - saveLastTotalLoaded) * 100 || 100
 *
 * `saveLastTotalLoaded` is set to `total` when `loaded === total`, so a NEW
 * `itemStart` afterwards makes the denominator zero → `NaN || 100` → "100%"
 * before the new item has loaded a single byte. A gate reading only that number
 * can therefore open while a texture is still in flight, which is exactly the
 * situation it exists to prevent.
 *
 * So the gate now also waits on this module's own in-flight count, and this
 * module records enough detail to *prove* what happened: for every texture,
 * when three started it, when three's `onLoad` fired, and where the last byte
 * landed according to resource timing.
 *
 * One clock
 * ---------
 * Everything here is stamped with `performance.now()` — the same time origin as
 * `PerformanceResourceTiming.responseEnd`. Earlier measurement compared the
 * gate's settle time (a `Date.now()` delta from *gate creation*) against
 * texture `responseEnd` values (milliseconds from *navigation start*), which is
 * two clock origins apart and produced a nonsensical "the gate opened 1 s before
 * the last texture finished".
 *
 * What `responseEnd` is not
 * -------------------------
 * `responseEnd` is the last byte of the network transfer. three's `onLoad` (and
 * therefore drei's progress counter) fires later, after the image decodes. The
 * gap between them is real work, not measurement noise, so both are recorded.
 */

import { DefaultLoadingManager } from "three";

/** Status of one item the loading manager saw. */
export type TextureStatus = "pending" | "loaded" | "error";

export interface TextureSample {
    /** The URL three was asked to load, resolved against the document. */
    url: string;
    /** `performance.now()` when the manager registered the item (three's onStart). */
    startedAt: number | null;
    /** `performance.now()` when three's onLoad fired — AFTER decode. */
    loadedAt: number | null;
    status: TextureStatus;
    /** Resource-timing `startTime` for the same request, or null when unmatched. */
    requestStart: number | null;
    /** Resource-timing `responseEnd` — last byte, BEFORE decode. */
    responseEnd: number | null;
    transferSize: number | null;
    /**
     * Whether this item travelled the channel drei's `useProgress` counts
     * (`DefaultLoadingManager.itemStart/itemEnd`). It always does by
     * construction — that is the point of hooking the manager — but it is
     * recorded so a report can distinguish "the gate never saw it" from "the
     * progress counter miscounted it", which are different bugs.
     */
    viaLoadingManager: boolean;
}

export interface TextureTimelineSnapshot {
    /** `performance.now()` when the snapshot was taken. */
    at: number;
    samples: TextureSample[];
    /** Items the manager registered. */
    started: number;
    /** Items registered but not yet resolved or errored. */
    pending: number;
    /** Items that errored (they will never resolve). */
    failed: number;
    /** Items that resolved. */
    loaded: number;
    /** drei `useProgress` aggregate, as last reported by the scene. */
    progress: {
        active: boolean;
        progress: number;
        loaded: number;
        total: number;
    } | null;
    /**
     * Whether `useProgress.total` accounts for every item the manager saw.
     * `null` before the scene has reported its progress state.
     */
    progressCoversAll: boolean | null;
}

/** Item kinds worth reporting as "textures" (an `.hdr` or a model is the same concern). */
const ASSET_URL = /\.(jpg|jpeg|png|webp|avif|ktx2|hdr|glb|gltf)$/i;

interface Record_ {
    url: string;
    startedAt: number | null;
    loadedAt: number | null;
    status: TextureStatus;
}

const now = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

const records = new Map<string, Record_>();
const listeners = new Set<() => void>();

let version = 0;
let installed = false;
let progressState: TextureTimelineSnapshot["progress"] = null;

const emit = (): void => {
    version += 1;
    for (const l of listeners) l();
};

const absolute = (url: string): string => {
    if (typeof location === "undefined") return url;
    try {
        return new URL(url, location.href).href;
    } catch {
        return url;
    }
};

const record = (url: string): Record_ => {
    const key = absolute(url);
    let r = records.get(key);
    if (!r) {
        r = { url: key, startedAt: null, loadedAt: null, status: "pending" };
        records.set(key, r);
    }
    return r;
};

/**
 * Instrument the loading manager three hands to every loader.
 *
 * drei's `useProgress` assigns `onStart` / `onLoad` / `onProgress` on this same
 * manager, so the wrappers here must CHAIN to `itemStart` / `itemEnd` /
 * `itemError` rather than replace any handler — overwriting them would break the
 * progress store the rest of the UI reads.
 *
 * Idempotent. Call once, before the scene starts loading assets (Globe.tsx does
 * it at module scope, next to the `useTexture` call it instruments).
 */
export function installTextureTracking(): void {
    if (installed) return;
    installed = true;

    const start = DefaultLoadingManager.itemStart.bind(DefaultLoadingManager);
    const end = DefaultLoadingManager.itemEnd.bind(DefaultLoadingManager);
    const error = DefaultLoadingManager.itemError.bind(DefaultLoadingManager);

    DefaultLoadingManager.itemStart = (url: string) => {
        // Record BEFORE delegating: drei's onStart runs inside the original and
        // reads counters that must already include this item.
        const r = record(url);
        r.startedAt = now();
        r.status = "pending";
        emit();
        start(url);
    };

    DefaultLoadingManager.itemEnd = (url: string) => {
        const r = record(url);
        r.loadedAt = now();
        r.status = "loaded";
        emit();
        end(url);
    };

    DefaultLoadingManager.itemError = (url: string) => {
        // itemEnd is NOT called on a failed load, so without this the item would
        // stay pending forever and park the gate until its safety timeout.
        const r = record(url);
        r.status = "error";
        emit();
        error(url);
    };
}

/** The last `useProgress` aggregate the scene reported. */
export function setTextureProgressState(
    state: NonNullable<TextureTimelineSnapshot["progress"]>,
): void {
    progressState = state;
}

/** Look up the resource-timing entry for one URL, on the same clock. */
function resourceFor(url: string): PerformanceResourceTiming | null {
    if (
        typeof performance === "undefined" ||
        typeof performance.getEntriesByType !== "function"
    ) {
        return null;
    }
    const entries = performance.getEntriesByType(
        "resource",
    ) as PerformanceResourceTiming[];
    const exact = entries.find((e) => e.name === url);
    if (exact) return exact;
    // Fall back to a pathname match: a URL rewritten by a CDN or a base path would
    // break exact equality while still being the same request.
    let path: string;
    try {
        path = new URL(url).pathname;
    } catch {
        return null;
    }
    return entries.find((e) => e.name.endsWith(path)) ?? null;
}

/** Counts only — cheap enough to call from render. */
export function textureStatus(): {
    started: number;
    pending: number;
    failed: number;
    loaded: number;
} {
    let pending = 0;
    let failed = 0;
    let loaded = 0;
    for (const r of records.values()) {
        if (r.status === "pending") pending += 1;
        else if (r.status === "error") failed += 1;
        else loaded += 1;
    }
    return { started: records.size, pending, failed, loaded };
}

/**
 * True once every asset three asked for has resolved or errored.
 *
 * `started > 0` is required: `pending === 0` is also true before the scene has
 * mounted, and a gate that treats "nothing has started" as "everything is done"
 * opens on the first frame and defeats its own purpose.
 */
export function allTexturesSettled(): boolean {
    const s = textureStatus();
    return s.started > 0 && s.pending === 0;
}

/** Items that will never resolve. A scene with one is broken, not slow. */
export function texturesFailed(): number {
    return textureStatus().failed;
}

/** Full timeline, reconciled against resource timing. */
export function snapshotTextures(): TextureTimelineSnapshot {
    const samples: TextureSample[] = [];
    for (const r of records.values()) {
        if (!ASSET_URL.test(r.url)) continue;
        const entry = resourceFor(r.url);
        samples.push({
            url: r.url,
            startedAt: r.startedAt === null ? null : Math.round(r.startedAt),
            loadedAt: r.loadedAt === null ? null : Math.round(r.loadedAt),
            status: r.status,
            requestStart: entry ? Math.round(entry.startTime) : null,
            responseEnd: entry ? Math.round(entry.responseEnd) : null,
            transferSize: entry ? entry.transferSize : null,
            viaLoadingManager: true,
        });
    }

    const s = textureStatus();
    return {
        at: Math.round(now()),
        samples,
        ...s,
        progress: progressState,
        progressCoversAll:
            progressState === null ? null : progressState.total >= s.started,
    };
}

/** Subscribe to item start/end/error (for `useSyncExternalStore`). */
export function subscribeTextures(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Monotonic version, so a component can re-render on any item transition. */
export function textureVersion(): number {
    return version;
}

/**
 * One-line-per-texture reconciliation report.
 *
 * Answers, for each texture: when was it requested (resource timing), when did
 * the last byte arrive (resource timing), when did three call onLoad (after
 * decode), and did drei's progress counter see it. `null` in the responseEnd
 * column means resource timing has no entry — which happens for a worker-issued
 * or already-completed request, not because the texture failed.
 */
export function describeTextureTimeline(gateOpenedAt: number | null = null): {
    gateOpenedAt: number | null;
    lastResponseEnd: number | null;
    lastLoadedAt: number | null;
    /** Positive = the gate opened AFTER the last texture's last byte. */
    gateMinusLastResponseEnd: number | null;
    /** Positive = the gate opened AFTER the last onLoad (decode included). */
    gateMinusLastLoad: number | null;
    decodeTailMs: number | null;
    progressCoversAll: boolean | null;
    rows: Array<{
        file: string;
        requestStart: number | null;
        responseEnd: number | null;
        threeOnLoad: number | null;
        /** transfer → three onLoad: decode + upload cost per texture. */
        decodeMs: number | null;
        trackedByProgress: boolean;
        status: TextureStatus;
    }>;
} {
    const snap = snapshotTextures();
    const rows = snap.samples.map((s) => ({
        file: s.url.split("/").pop() ?? s.url,
        requestStart: s.requestStart,
        responseEnd: s.responseEnd,
        threeOnLoad: s.loadedAt,
        decodeMs:
            s.responseEnd !== null && s.loadedAt !== null
                ? Math.round(s.loadedAt - s.responseEnd)
                : null,
        trackedByProgress: s.viaLoadingManager,
        status: s.status,
    }));

    const ends = snap.samples
        .map((s) => s.responseEnd)
        .filter((v): v is number => v !== null);
    const loads = snap.samples
        .map((s) => s.loadedAt)
        .filter((v): v is number => v !== null);

    const lastResponseEnd = ends.length ? Math.max(...ends) : null;
    const lastLoadedAt = loads.length ? Math.max(...loads) : null;

    return {
        gateOpenedAt,
        lastResponseEnd,
        lastLoadedAt,
        gateMinusLastResponseEnd:
            gateOpenedAt !== null && lastResponseEnd !== null
                ? Math.round(gateOpenedAt - lastResponseEnd)
                : null,
        gateMinusLastLoad:
            gateOpenedAt !== null && lastLoadedAt !== null
                ? Math.round(gateOpenedAt - lastLoadedAt)
                : null,
        decodeTailMs:
            lastResponseEnd !== null && lastLoadedAt !== null
                ? Math.round(lastLoadedAt - lastResponseEnd)
                : null,
        progressCoversAll: snap.progressCoversAll,
        rows,
    };
}

/** Test seam: drop every record and the progress mirror. */
export function __resetTextureTimeline(): void {
    records.clear();
    progressState = null;
    version = 0;
    listeners.clear();
}
