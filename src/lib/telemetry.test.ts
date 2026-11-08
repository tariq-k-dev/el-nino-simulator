import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelemetryBundle } from "@/types/enso";

const MOCK_BUNDLE: TelemetryBundle = {
    timestamp: "2026-11-07T00:00:00Z",
    tao: {
        timestamp: "2026-11-07T00:00:00Z",
        nino34_sst: 28.42,
        anomaly: 1.82,
        status: "active",
    },
    precip: {
        timestamp: "2026-11-07T00:00:00Z",
        regions: {},
        status: "active",
    },
    ar: {
        timestamp: "2026-11-07T00:00:00Z",
        category: 4,
        categoryName: "Extreme",
        maxIvt: 1045,
        coastalRiskTier: "Severe",
        status: "active",
    },
};

describe("fetchTelemetryBundle", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("fetches, parses, and returns the telemetry bundle successfully", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => MOCK_BUNDLE,
        });
        vi.stubGlobal("fetch", fetchMock);

        const { fetchTelemetryBundle } = await import("./telemetry");
        const bundle = await fetchTelemetryBundle();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(bundle).toEqual(MOCK_BUNDLE);
    });

    it("returns cached bundle on consecutive calls without refetching", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => MOCK_BUNDLE,
        });
        vi.stubGlobal("fetch", fetchMock);

        const { fetchTelemetryBundle } = await import("./telemetry");
        const bundle1 = await fetchTelemetryBundle();
        const bundle2 = await fetchTelemetryBundle();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(bundle1).toBe(bundle2);
    });

    it("deduplicates simultaneous in-flight requests", async () => {
        let resolveFetch: (value: unknown) => void;
        const fetchPromise = new Promise((resolve) => {
            resolveFetch = resolve;
        });

        const fetchMock = vi.fn().mockReturnValue(fetchPromise);
        vi.stubGlobal("fetch", fetchMock);

        const { fetchTelemetryBundle } = await import("./telemetry");

        const req1 = fetchTelemetryBundle();
        const req2 = fetchTelemetryBundle();

        expect(fetchMock).toHaveBeenCalledTimes(1);

        resolveFetch!({
            ok: true,
            json: async () => MOCK_BUNDLE,
        });

        const [bundle1, bundle2] = await Promise.all([req1, req2]);
        expect(bundle1).toEqual(MOCK_BUNDLE);
        expect(bundle2).toEqual(MOCK_BUNDLE);
    });

    it("bypasses cache when forceRefresh is true", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => MOCK_BUNDLE,
        });
        vi.stubGlobal("fetch", fetchMock);

        const { fetchTelemetryBundle } = await import("./telemetry");
        await fetchTelemetryBundle();
        await fetchTelemetryBundle(true);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toContain("?refresh=true");
    });

    it("returns null gracefully when the worker returns a non-200 status", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 503,
            }),
        );

        const { fetchTelemetryBundle } = await import("./telemetry");
        const bundle = await fetchTelemetryBundle();

        expect(bundle).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("[telemetry] Worker returned status: 503"),
        );
    });

    it("returns null gracefully when network fetch rejects", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.stubGlobal(
            "fetch",
            vi.fn().mockRejectedValue(new Error("Connection refused")),
        );

        const { fetchTelemetryBundle } = await import("./telemetry");
        const bundle = await fetchTelemetryBundle();

        expect(bundle).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining(
                "Live telemetry worker offline or unreachable",
            ),
            expect.any(Error),
        );
    });

    it("immediately returns null without calling fetch in E2E mode", async () => {
        vi.stubEnv("VITE_E2E", "1");
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const { fetchTelemetryBundle } = await import("./telemetry");
        const bundle = await fetchTelemetryBundle();

        expect(bundle).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
