// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultLoadingManager } from "three";
import {
    __resetTextureTimeline,
    allTexturesSettled,
    describeTextureTimeline,
    installTextureTracking,
    setTextureProgressState,
    snapshotTextures,
    texturesFailed,
} from "@/lib/engine/textureTimeline";

/**
 * The gate's texture condition used to be drei's `useProgress` aggregate alone,
 * and the aggregate can report 100% while a texture is still in flight:
 *
 *     progress = (loaded - saveLastTotalLoaded) / (total - saveLastTotalLoaded) * 100 || 100
 *
 * `saveLastTotalLoaded` is pinned to `total` after the first `onLoad`, so a new
 * item started afterwards divides by zero → `NaN` → `|| 100` → "100%".
 *
 * These cases pin the per-item condition that replaces it: an item is settled
 * only when it loaded or errored, so `pending === 0` is a statement about every
 * texture rather than about an average.
 */

/** Drive three's loading manager exactly as a loader would. */
const start = (url: string) => DefaultLoadingManager.itemStart(url);
const end = (url: string) => DefaultLoadingManager.itemEnd(url);
const fail = (url: string) => DefaultLoadingManager.itemError(url);

describe("textureTimeline — per-item settle condition", () => {
    beforeEach(() => {
        __resetTextureTimeline();
        installTextureTracking();
    });
    afterEach(() => __resetTextureTimeline());

    it("is NOT settled before anything has started", () => {
        // `pending === 0` is trivially true here, and treating that as "done" would
        // open the gate on the first frame — the bug this module exists to avoid.
        expect(allTexturesSettled()).toBe(false);
        expect(snapshotTextures().started).toBe(0);
    });

    it("is not settled while one item of five is still in flight", () => {
        for (const f of ["a.jpg", "b.jpg", "c.jpg", "d.jpg"])
            start(`/textures/${f}`);
        start("/textures/e.jpg");
        for (const f of ["a.jpg", "b.jpg", "c.jpg", "d.jpg"])
            end(`/textures/${f}`);

        const snap = snapshotTextures();
        expect(snap.started).toBe(5);
        expect(snap.loaded).toBe(4);
        expect(snap.pending).toBe(1);
        expect(allTexturesSettled()).toBe(false);

        end("/textures/e.jpg");
        expect(allTexturesSettled()).toBe(true);
    });

    it("settles on a LATE wave that starts after an earlier wave finished", () => {
        // This is the exact shape that fools the aggregate: wave 1 completes (the
        // counter pins `saveLastTotalLoaded` to total), then wave 2 begins.
        start("/textures/day.jpg");
        end("/textures/day.jpg");
        expect(allTexturesSettled()).toBe(true);

        start("/textures/clouds.jpg");
        expect(
            allTexturesSettled(),
            "a new in-flight item must close the gate again",
        ).toBe(false);

        end("/textures/clouds.jpg");
        expect(allTexturesSettled()).toBe(true);
    });

    it("records start and onLoad as separate timestamps", () => {
        start("/textures/day.jpg");
        end("/textures/day.jpg");
        const s = snapshotTextures().samples[0];
        expect(s.startedAt).not.toBeNull();
        expect(s.loadedAt).not.toBeNull();
        // onLoad fires after the transfer, so it can never precede it.
        expect(s.loadedAt as number).toBeGreaterThanOrEqual(
            s.startedAt as number,
        );
        expect(s.status).toBe("loaded");
    });

    it("an errored item counts as settled, not pending", () => {
        // itemEnd is never called for a failed load. Without recording the error the
        // item would stay pending forever and park the gate until its 120 s timeout.
        start("/textures/missing.jpg");
        fail("/textures/missing.jpg");

        expect(texturesFailed()).toBe(1);
        expect(snapshotTextures().pending).toBe(0);
        expect(allTexturesSettled()).toBe(true);
    });

    it("tracks every texture by default, so nothing is invisible to the gate", () => {
        const urls = [
            "/textures/earth_day.jpg",
            "/textures/earth_night.jpg",
            "/textures/earth_specular.jpg",
            "/textures/earth_normal.jpg",
            "/textures/earth_clouds.jpg",
        ];
        for (const u of urls) start(u);
        for (const u of urls) end(u);

        const snap = snapshotTextures();
        expect(snap.samples.map((s) => s.url.split("/").pop()).sort()).toEqual(
            urls.map((u) => u.split("/").pop()).sort(),
        );
        expect(snap.samples.every((s) => s.viaLoadingManager)).toBe(true);
        expect(snap.progressCoversAll).toBeNull(); // no useProgress mirror yet
    });

    it("stamps a monotonically increasing version per transition", () => {
        start("/textures/a.jpg");
        const v1 = snapshotTextures();
        end("/textures/a.jpg");
        const v2 = snapshotTextures();
        expect(v2.loaded).toBe(v1.loaded + 1);
        expect(v2.at).toBeGreaterThanOrEqual(v1.at);
    });
});

describe("textureTimeline — progress mirror", () => {
    beforeEach(() => {
        __resetTextureTimeline();
        installTextureTracking();
    });
    afterEach(() => __resetTextureTimeline());

    it("detects an aggregate that under-counts the items the manager saw", () => {
        for (const f of ["a.jpg", "b.jpg", "c.jpg"]) start(`/textures/${f}`);
        for (const f of ["a.jpg", "b.jpg", "c.jpg"]) end(`/textures/${f}`);

        // A counter claiming 2 of 3 items while 3 were registered: the aggregate
        // cannot be reconciled with reality, and the gate must not trust it.
        setTextureProgressState({
            active: false,
            progress: 100,
            loaded: 2,
            total: 2,
        });
        expect(snapshotTextures().progressCoversAll).toBe(false);

        setTextureProgressState({
            active: false,
            progress: 100,
            loaded: 3,
            total: 3,
        });
        expect(snapshotTextures().progressCoversAll).toBe(true);
    });
});

describe("describeTextureTimeline — gate-open reconciliation", () => {
    beforeEach(() => {
        __resetTextureTimeline();
        installTextureTracking();
    });
    afterEach(() => __resetTextureTimeline());

    it("reports the gate delay against the last onLoad, on one clock", () => {
        start("/textures/day.jpg");
        end("/textures/day.jpg");

        const snap = snapshotTextures();
        const lastLoad = snap.samples[0].loadedAt as number;

        // Gate opened 250 ms after the last texture's onLoad.
        const report = describeTextureTimeline(lastLoad + 250);
        expect(report.rows).toHaveLength(1);
        expect(report.rows[0].file).toBe("day.jpg");
        expect(report.rows[0].trackedByProgress).toBe(true);
        expect(report.gateMinusLastLoad).toBe(250);
    });

    it("is null rather than NaN when nothing has loaded", () => {
        const report = describeTextureTimeline(1_000);
        expect(report.lastResponseEnd).toBeNull();
        expect(report.lastLoadedAt).toBeNull();
        expect(report.gateMinusLastLoad).toBeNull();
        expect(report.rows).toEqual([]);
    });
});
