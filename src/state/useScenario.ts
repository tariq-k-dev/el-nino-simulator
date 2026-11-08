import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    AnalyticsPayload,
    ScenarioState,
    TelemetryBundle,
    UnitSystem,
} from "@/types/enso";
import {
    useEngineStatus,
    type EngineStatus as StoreStatus,
} from "@/lib/engine/store";
import { useEngine, type HistoryState } from "@/state/useEngine";
import { AGRI_DEFAULT, JET_DEFAULT, SST_DEFAULT } from "@/lib/model";
import { fetchTelemetryBundle } from "@/lib/telemetry";
import { registerTelemetry } from "@/lib/duckdb";

/**
 * Derive the legacy status vocabulary from the engine store.
 *
 * The Header's status dot was written against a four-value union while the store
 * has a richer phase model. Mapping here keeps one source of truth — the store.
 * `deferred` and `failed` share the fallback colour because, from the user's
 * point of view, both mean "the numbers are coming from the TS model".
 */
export type EngineStatus = "booting" | "ready" | "fallback" | "running";

export interface ScenarioHandle {
    scenario: ScenarioState;
    setScenario: (patch: Partial<ScenarioState>) => void;
    reset: () => void;
    /** Sets the scenario sliders directly to the live NOAA telemetry readings. */
    applyLiveTelemetry: () => void;
    analytics: AnalyticsPayload;
    status: EngineStatus;
    /** History availability, independent of the engine state. */
    history: HistoryState;
    /** Re-fetch the dataset after a failure. */
    retryHistory: () => void;
    units: UnitSystem;
    toggleUnits: () => void;
    /** The latest live NOAA observation bundle, or null if offline/pending. */
    telemetry: TelemetryBundle | null;
}

const INITIAL: ScenarioState = {
    sstAnomaly: SST_DEFAULT,
    jetStreamShift: JET_DEFAULT,
    agricultureWeight: AGRI_DEFAULT,
};

/** Empty payload used before the dataset has parsed. */
const EMPTY: AnalyticsPayload = {
    metrics: {
        sst: SST_DEFAULT,
        jet: JET_DEFAULT,
        agri: AGRI_DEFAULT,
        pacificSstDev: 0,
        pacificConvection: 0,
        usPrecip: 0,
        usPrecipBase: 0,
        usTempDevF: 0,
        asiaPrecip: 0,
        asiaDrought: 0,
        africaPrecip: 0,
        africaFlood: 0,
        amazonPrecip: 0,
        amazonDrought: 0,
        gulfPrecip: 0,
        globalImpactIndex: 0,
        agricultureExposure: 0,
        riskTier: "pending",
    },
    analogs: [],
    summary: {
        rowCount: 0,
        firstDate: "—",
        lastDate: "—",
        meanAnomaly: 0,
        maxAnomaly: 0,
        maxAnomalyDate: "—",
        analogCount: 0,
        extremeMonths: 0,
        laninaMonths: 0,
        source: "—",
    },
    timeline: [],
    queryMs: 0,
};

/** Map the engine store's phase onto the UI's status vocabulary. */
function toLegacyStatus(engine: StoreStatus, querying: boolean): EngineStatus {
    switch (engine.phase) {
        case "ready":
            return querying ? "running" : "ready";
        case "booting":
            return "booting";
        case "failed":
        case "deferred":
            return "fallback";
    }
}

export function useScenario(): ScenarioHandle {
    const engineStatus = useEngineStatus();
    const { engine, history, retryDataset } = useEngine();

    const [scenario, setScenarioState] = useState<ScenarioState>(INITIAL);
    const [telemetry, setTelemetry] = useState<TelemetryBundle | null>(null);
    const [analytics, setAnalytics] = useState<AnalyticsPayload>(EMPTY);
    const [units, setUnits] = useState<UnitSystem>("metric");
    const [querying, setQuerying] = useState(false);

    /**
     * Monotonic request id. A query can outlive a faster slider move, so a stale
     * result must never overwrite a newer one. Every dispatch increments this; a
     * response is applied only if its id is still current.
     */
    const requestId = useRef(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /**
     * Bumped once when DuckDB becomes `ready`, so the current scenario is
     * recomputed exactly once against the new engine rather than once per state
     * change while booting.
     */
    const [epoch, setEpoch] = useState(0);
    const readySeen = useRef(false);

    const setScenario = useCallback((patch: Partial<ScenarioState>) => {
        setScenarioState((prev) => ({ ...prev, ...patch }));
    }, []);

    const reset = useCallback(() => setScenarioState(INITIAL), []);

    // 1. Fetch live NOAA telemetry bundle on mount
    useEffect(() => {
        let cancelled = false;
        void fetchTelemetryBundle().then((bundle) => {
            if (cancelled || !bundle) return;
            setTelemetry(bundle);

            // Hydrate initial SST slider to current live NOAA anomaly
            if (bundle.tao.status === "active") {
                setScenarioState((prev) => ({
                    ...prev,
                    sstAnomaly: bundle.tao.anomaly,
                }));
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    // 2. Register live telemetry table in DuckDB whenever DuckDB reaches ready state
    useEffect(() => {
        if (engineStatus.phase === "ready" && telemetry) {
            void registerTelemetry(telemetry);
        }
    }, [engineStatus.phase, telemetry]);

    // 3. Re-apply live telemetry to the sliders on demand
    const applyLiveTelemetry = useCallback(() => {
        if (!telemetry) return;
        setScenarioState((prev) => ({
            ...prev,
            sstAnomaly: telemetry.tao.anomaly,
        }));
    }, [telemetry]);

    // On the transition into `ready`, recompute once. Keyed on the phase so it
    // fires once per boot rather than on every render.
    useEffect(() => {
        if (engineStatus.phase === "ready" && !readySeen.current) {
            readySeen.current = true;
            setEpoch((e) => e + 1);
        }
        if (engineStatus.phase === "booting") {
            // A retry re-arms the one-shot recompute.
            readySeen.current = false;
        }
    }, [engineStatus.phase]);

    /**
     * The single query effect.
     *
     * It runs whenever the scenario, the engine, or the epoch changes — including
     * the moment the dataset finishes loading, which is what makes history appear
     * WITHOUT DuckDB. Previously this effect was gated on `phase === 'ready'`, so
     * history was unavailable until the wasm arrived.
     */
    useEffect(() => {
        if (!engine) {
            setQuerying(false);
            return;
        }

        let cancelled = false;
        if (debounceRef.current) clearTimeout(debounceRef.current);

        // DuckDB round-trips deserve a debounce; the TS engine answers synchronously
        // in microseconds, so it runs immediately and the slider stays live.
        const isDuck = engine.kind === "duckdb";
        setQuerying(isDuck);

        const run = async () => {
            const id = ++requestId.current;
            try {
                const payload = await engine.run(scenario);
                // Stale guard: a newer request (or an unmount) wins.
                if (cancelled || id !== requestId.current) return;
                setAnalytics(payload);
            } catch (error) {
                if (cancelled || id !== requestId.current) return;
                console.warn("[engine] query failed:", error);
            } finally {
                if (!cancelled && id === requestId.current) setQuerying(false);
            }
        };

        if (isDuck) {
            debounceRef.current = setTimeout(run, 40);
        } else {
            void run();
        }

        return () => {
            cancelled = true;
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
        // `epoch` is a dependency so the one-shot recompute on `ready` re-runs this
        // effect even though `scenario` itself did not change.
    }, [scenario, engine, epoch]);

    const status = useMemo(
        () => toLegacyStatus(engineStatus, querying),
        [engineStatus, querying],
    );

    return {
        scenario,
        setScenario,
        reset,
        applyLiveTelemetry,
        analytics,
        status,
        history,
        retryHistory: retryDataset,
        units,
        toggleUnits: () =>
            setUnits((u) => (u === "metric" ? "imperial" : "metric")),
        telemetry,
    };
}
