/**
 * The LAYOUT lane in `viewStore` — one resize/orientation listener, a synchronous first read, and a
 * non-reactive read for the frame loop.
 *
 * MOBILE1's version of this file drove a `matchMedia` stub, because the mode WAS a media query. The mode is now a
 * total function of two integers (`mobile/layoutMath.ts`), so the listener contract this file tests is the
 * resize one: does it start once, coalesce, fire on a change, and clean up — plus the two properties the frame
 * loop depends on (a synchronous first read, and a value that never depends on unmount order).
 *
 * `requestAnimationFrame` is stubbed rather than faked with jsdom's, because the point is to prove the
 * COALESCING: twenty `resize` events must produce exactly one measurement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    HEADER_BOTTOM_EPSILON_PX,
    __resetLayoutStore,
    __setLayoutForTest,
    getFreeRect,
    getLayoutMode,
    getLayoutMode2,
    getLayoutSignal,
    publishHeaderBottom,
    startLayoutObserver,
    subscribeLayout,
    subscribeLayoutKey,
} from "./viewStore";

/** A stand-in `Window` with the three things the store touches, and a way to drive them. */
function fakeWin(w: number, h: number) {
    const listeners = new Map<string, Set<() => void>>();
    const frames: Array<() => void> = [];
    const win = {
        innerWidth: w,
        innerHeight: h,
        addEventListener: vi.fn((type: string, fn: () => void) => {
            let set = listeners.get(type);
            if (!set) listeners.set(type, (set = new Set()));
            set.add(fn);
        }),
        removeEventListener: vi.fn((type: string, fn: () => void) => {
            listeners.get(type)?.delete(fn);
        }),
        requestAnimationFrame: vi.fn((fn: () => void) => {
            frames.push(fn);
            return frames.length;
        }),
        cancelAnimationFrame: vi.fn((id: number) => {
            void id;
        }),
    };
    return {
        win: win as unknown as Window,
        /** Change the size and fire `resize`. */
        resize(nextW: number, nextH: number) {
            (win as { innerWidth: number }).innerWidth = nextW;
            (win as { innerHeight: number }).innerHeight = nextH;
            for (const fn of listeners.get("resize") ?? []) fn();
        },
        /** Run every queued rAF callback. */
        flush() {
            const queued = frames.splice(0, frames.length);
            for (const fn of queued) fn();
        },
        /** How many callbacks are queued but not run. */
        pending: () => frames.length,
        listeners,
    };
}

beforeEach(() => {
    __resetLayoutStore();
});

afterEach(() => {
    __resetLayoutStore();
});

describe("the default", () => {
    it("is desktop with no observer, so a document with no window behaves as it did before", () => {
        expect(getLayoutMode2()).toBe("desktop");
        expect(getLayoutMode()).toBe("desktop");
        expect(getLayoutSignal()).toEqual({
            mode: "desktop",
            width: 0,
            height: 0,
            headerBottom: 0,
        });
    });

    it("starting with no window is a no-op that returns a cleanup", () => {
        const cleanup = startLayoutObserver(undefined);
        expect(getLayoutMode2()).toBe("desktop");
        expect(() => cleanup()).not.toThrow();
    });
});

describe("startLayoutObserver", () => {
    it("reads SYNCHRONOUSLY, so the first paint is already in the right mode", () => {
        const f = fakeWin(390, 844);
        const cleanup = startLayoutObserver(f.win);
        /* No flush: the value is correct before any frame has run. This is the no-flash guarantee. */
        expect(f.pending()).toBe(0);
        expect(getLayoutMode2()).toBe("portrait");
        expect(getLayoutSignal().width).toBe(390);
        expect(getLayoutSignal().height).toBe(844);
        cleanup();
    });

    it("resolves all three modes from the two integers", () => {
        const f = fakeWin(390, 844);
        const cleanup = startLayoutObserver(f.win);
        expect(getLayoutMode2()).toBe("portrait");

        f.resize(844, 390);
        f.flush();
        expect(getLayoutMode2()).toBe("phoneLandscape");

        f.resize(1280, 800);
        f.flush();
        expect(getLayoutMode2()).toBe("desktop");

        cleanup();
    });

    it("COALESCES a storm of resize events into one measurement", () => {
        const f = fakeWin(390, 844);
        const cleanup = startLayoutObserver(f.win);
        const listener = vi.fn();
        const unsub = subscribeLayout(listener);

        for (let i = 0; i < 20; i += 1) f.resize(390 + i, 844);
        /* Twenty events, one queued frame. */
        expect(f.pending()).toBe(1);
        f.flush();
        /* And one notification for the whole storm. */
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getLayoutSignal().width).toBe(409);

        unsub();
        cleanup();
    });

    it("a resize that does not change the mode still publishes the size", () => {
        const f = fakeWin(390, 844);
        const cleanup = startLayoutObserver(f.win);
        f.resize(412, 924);
        f.flush();
        expect(getLayoutMode2()).toBe("portrait");
        expect(getLayoutSignal().width).toBe(412);
        expect(getLayoutSignal().height).toBe(924);
        cleanup();
    });

    it("orientationchange measures on the NEXT frame, because the metrics are not settled yet", () => {
        const f = fakeWin(390, 844);
        const cleanup = startLayoutObserver(f.win);
        /* Fire orientationchange without touching innerWidth: nothing is queued until the event handler asks. */
        for (const fn of f.listeners.get("orientationchange") ?? []) fn();
        expect(f.pending()).toBe(1);
        (f.win as unknown as { innerWidth: number }).innerWidth = 844;
        (f.win as unknown as { innerHeight: number }).innerHeight = 390;
        f.flush();
        expect(getLayoutMode2()).toBe("phoneLandscape");
        cleanup();
    });

    it("notifies React subscribers only when something changed", () => {
        const f = fakeWin(390, 844);
        const cleanup = startLayoutObserver(f.win);
        const listener = vi.fn();
        const unsub = subscribeLayout(listener);
        f.resize(390, 844);
        f.flush();
        expect(listener).not.toHaveBeenCalled();
        unsub();
        cleanup();
    });

    it("a keyed subscription only fires for its own field", () => {
        const f = fakeWin(390, 844);
        const cleanup = startLayoutObserver(f.win);
        const onMode = vi.fn();
        const onHeader = vi.fn();
        const onSize = vi.fn();
        const unsubs = [
            subscribeLayoutKey("mode", onMode),
            subscribeLayoutKey("headerBottom", onHeader),
            subscribeLayoutKey("size", onSize),
        ];

        publishHeaderBottom(104);
        expect(onHeader).toHaveBeenCalledTimes(1);
        expect(onMode).not.toHaveBeenCalled();
        expect(onSize).not.toHaveBeenCalled();

        /* Counted from here, so the assertions below are about the RESIZE rather than about the publish above. */
        onHeader.mockClear();

        f.resize(844, 390);
        f.flush();
        expect(onMode).toHaveBeenCalledTimes(1);
        expect(onSize).toHaveBeenCalledTimes(1);
        expect(onHeader).not.toHaveBeenCalled();

        for (const unsub of unsubs) unsub();
        cleanup();
    });

    it("is ref-counted, so two consumers share one listener and the last one out tears it down", () => {
        const f = fakeWin(390, 844);
        const first = startLayoutObserver(f.win);
        const second = startLayoutObserver(f.win);
        expect(f.win.addEventListener).toHaveBeenCalledTimes(2); // resize + orientationchange, once

        expect(getLayoutMode2()).toBe("portrait");
        first();
        /* Still running: the second consumer has not unmounted. */
        expect(getLayoutMode2()).toBe("portrait");
        f.resize(1280, 800);
        f.flush();
        expect(getLayoutMode2()).toBe("desktop");

        second();
        expect(getLayoutMode2()).toBe("desktop");
    });

    it("tearing down returns to the desktop default and removes both listeners", () => {
        const f = fakeWin(390, 844);
        const cleanup = startLayoutObserver(f.win);
        expect(getLayoutMode2()).toBe("portrait");
        cleanup();
        expect(getLayoutMode2()).toBe("desktop");
        expect(getLayoutSignal()).toEqual({
            mode: "desktop",
            width: 0,
            height: 0,
            headerBottom: 0,
        });
        expect(f.win.removeEventListener).toHaveBeenCalledWith(
            "resize",
            expect.any(Function),
        );
        expect(f.win.removeEventListener).toHaveBeenCalledWith(
            "orientationchange",
            expect.any(Function),
        );
    });

    it('the two-way read answers "is this a phone layout" for both mobile modes', () => {
        __setLayoutForTest({ mode: "portrait" });
        expect(getLayoutMode()).toBe("mobile");
        __setLayoutForTest({ mode: "phoneLandscape" });
        expect(getLayoutMode()).toBe("mobile");
        __setLayoutForTest({ mode: "desktop" });
        expect(getLayoutMode()).toBe("desktop");
    });
});

describe("publishHeaderBottom", () => {
    it("publishes a real measurement", () => {
        publishHeaderBottom(104.25);
        expect(getLayoutSignal().headerBottom).toBe(104.25);
    });

    it("drops a change below 0.5 px, and takes one at or above it", () => {
        publishHeaderBottom(104);
        publishHeaderBottom(104 + HEADER_BOTTOM_EPSILON_PX / 2);
        expect(getLayoutSignal().headerBottom).toBe(104);
        publishHeaderBottom(104 + HEADER_BOTTOM_EPSILON_PX);
        expect(getLayoutSignal().headerBottom).toBe(104.5);
    });

    it('null means "no compact header", and publishes 0', () => {
        publishHeaderBottom(104);
        publishHeaderBottom(null);
        expect(getLayoutSignal().headerBottom).toBe(0);
    });

    it("nonsense is treated as absent rather than published as NaN", () => {
        publishHeaderBottom(104);
        publishHeaderBottom(Number.NaN);
        expect(getLayoutSignal().headerBottom).toBe(0);
    });
});

describe("getFreeRect", () => {
    it("is the portrait band for a portrait signal", () => {
        __setLayoutForTest({
            mode: "portrait",
            width: 390,
            height: 844,
            headerBottom: 104,
        });
        const r = getFreeRect();
        expect(r.left).toBe(0);
        expect(r.right).toBe(390);
        expect(r.top).toBe(104);
        expect(r.bottom).toBeLessThan(844);
    });

    it("is the left band for a phoneLandscape signal, with the dock on the right", () => {
        __setLayoutForTest({
            mode: "phoneLandscape",
            width: 924,
            height: 412,
            headerBottom: 60,
        });
        const r = getFreeRect();
        expect(r.right).toBeLessThan(924);
        expect(r.top).toBe(60);
        expect(r.bottom).toBe(412);
    });

    it("recomputes as the header moves, which is what re-fits the globe", () => {
        __setLayoutForTest({
            mode: "portrait",
            width: 390,
            height: 844,
            headerBottom: 104,
        });
        const before = getFreeRect();
        __setLayoutForTest({ headerBottom: 140 });
        const after = getFreeRect();
        expect(after.top).toBe(140);
        /*
         * The band shrank, and its centre moved DOWN — which is not a mistake: at a 104 px header the midpoint
         * (398.04) is below the Half-tier cap (410.88) so the midpoint binds, and at 140 the midpoint (416.04) crosses
         * the cap and the cap binds. What must hold either way is that the centre is the min of the two, and that the
         * band's top follows the header.
         */
        expect(after.cy).toBeCloseTo(
            Math.min((140 + 692.08) / 2, 0.52 * 844 - 28),
            9,
        );
        expect(before.cy).toBeCloseTo(
            Math.min((104 + 692.08) / 2, 0.52 * 844 - 28),
            9,
        );
        expect(after.bottom).toBeCloseTo(before.bottom, 9);
    });
});
