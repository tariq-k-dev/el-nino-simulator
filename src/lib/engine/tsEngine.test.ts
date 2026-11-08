import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseDataset } from "@/lib/data/parse";
import { createTsEngine } from "@/lib/engine/tsEngine";
import {
    ANALOG_LIMIT,
    monthKey,
    periodLabel,
    sortAnalogs,
} from "@/lib/engine/dataEngine";
import { computeMetrics } from "@/lib/model";
import type { ScenarioState } from "@/types/enso";

const rows = parseDataset(
    readFileSync(
        path.resolve(__dirname, "../../../public/data/enso.csv"),
        "utf8",
    ),
);
const engine = createTsEngine({ rows });

const state = (
    sstAnomaly: number,
    jetStreamShift = 0,
    agricultureWeight = 0.6,
): ScenarioState => ({
    sstAnomaly,
    jetStreamShift,
    agricultureWeight,
});

describe("TsEngine — scenario matches model.ts exactly", () => {
    it("agrees with computeMetrics across the slider grid", async () => {
        for (const sst of [0, 0.75, 1.5, 2.25, 3]) {
            for (const jet of [-1, 0, 1]) {
                for (const agri of [0, 0.6, 1]) {
                    const viaEngine = await engine.scenario(
                        state(sst, jet, agri),
                    );
                    const viaModel = computeMetrics(state(sst, jet, agri));
                    expect(viaEngine).toEqual(viaModel);
                }
            }
        }
    });

    it("riskTier matches model.ts riskTier for every tier boundary", async () => {
        for (const sst of [
            0, 0.49, 0.5, 0.99, 1.0, 1.49, 1.5, 1.99, 2.0, 2.59, 2.6, 3,
        ]) {
            expect(await engine.riskTier(sst)).toBe(
                computeMetrics(state(sst)).riskTier,
            );
        }
    });
});

describe("TsEngine — timeline", () => {
    it("returns every row, ascending, as %Y-%m keys", async () => {
        const tl = await engine.timeline();
        expect(tl).toHaveLength(918);
        expect(tl[0].date).toBe("1950-01");
        expect(tl[0].label).toBe("1950 01");
        expect(tl[917].date).toBe("2026-06");
        for (let i = 1; i < tl.length; i += 1) {
            expect(tl[i].date > tl[i - 1].date).toBe(true);
        }
    });

    it("formats the label with a space, like strftime + replace", async () => {
        const tl = await engine.timeline();
        for (const p of tl.slice(0, 5))
            expect(p.label).toBe(p.date.replace("-", " "));
    });
});

describe("TsEngine — summary", () => {
    it("reports the dataset shape", async () => {
        const s = await engine.summary(1.5);
        expect(s.rowCount).toBe(918);
        expect(s.firstDate).toBe("1950-01");
        expect(s.lastDate).toBe("2026-06");
    });

    it("pins the known peak and its date", async () => {
        const s = await engine.summary(1.5);
        expect(s.maxAnomaly).toBeCloseTo(2.72, 3);
        expect(s.maxAnomalyDate).toBe("2015-11");
    });

    it("counts analog months within the ±0.35 window inclusively", async () => {
        const s = await engine.summary(1.5);
        const expected = rows.filter(
            (r) => Math.abs(r.nino_34_anomaly - 1.5) <= 0.35,
        ).length;
        expect(s.analogCount).toBe(expected);
    });

    it("counts warm and cold extremes with the SQL thresholds", async () => {
        const s = await engine.summary(1.5);
        expect(s.extremeMonths).toBe(
            rows.filter((r) => r.nino_34_anomaly >= 2.0).length,
        );
        expect(s.laninaMonths).toBe(
            rows.filter((r) => r.nino_34_anomaly <= -0.5).length,
        );
    });

    it("carries the provenance string", async () => {
        const s = await engine.summary(1.5);
        expect(s.source).toMatch(/NOAA/);
    });

    it("rounds mean and max to 3 dp, like round(..., 3)", async () => {
        const s = await engine.summary(1.5);
        expect(Number(s.meanAnomaly.toFixed(3))).toBe(s.meanAnomaly);
        expect(Number(s.maxAnomaly.toFixed(3))).toBe(s.maxAnomaly);
    });
});

describe("TsEngine — analogs", () => {
    it("returns at most the SQL LIMIT", async () => {
        const a = await engine.analogs(1.5);
        expect(a).toHaveLength(ANALOG_LIMIT);
    });

    it("is sorted by delta ascending", async () => {
        const a = await engine.analogs(2.0);
        for (let i = 1; i < a.length; i += 1) {
            expect(a[i].delta).toBeGreaterThanOrEqual(a[i - 1].delta);
        }
    });

    it("breaks equal deltas by date DESCENDING, matching ORDER BY date DESC", async () => {
        // Find an sst where the top rows share a delta.
        const a = await engine.analogs(1.5);
        for (let i = 1; i < a.length; i += 1) {
            if (a[i].delta === a[i - 1].delta) {
                expect(a[i].date < a[i - 1].date).toBe(true);
            }
        }
    });

    it("picks the true nearest months", async () => {
        const sst = 2.0;
        const a = await engine.analogs(sst);
        const truth = [...rows]
            .sort((x, y) => {
                const dx = Math.abs(x.nino_34_anomaly - sst);
                const dy = Math.abs(y.nino_34_anomaly - sst);
                if (dx !== dy) return dx - dy;
                return x.date < y.date ? 1 : -1;
            })
            .slice(0, ANALOG_LIMIT)
            .map((r) => monthKey(r.date));
        expect(a.map((x) => x.date)).toEqual(truth);
    });

    it("shape matches AnalogMonth exactly", async () => {
        const [a] = await engine.analogs(1.5);
        expect(Object.keys(a).sort()).toEqual(
            [
                "date",
                "label",
                "anomaly",
                "absoluteSst",
                "delta",
                "sstDeviation",
                "precipPacific",
                "precipUs",
                "precipSeAsia",
                "precipAfrica",
                "droughtIndex",
                "riskTier",
            ].sort(),
        );
    });

    it("carries the observed absolute SST", async () => {
        const [a] = await engine.analogs(1.5);
        expect(a.absoluteSst).toBeGreaterThan(20);
        expect(a.absoluteSst).toBeLessThan(32);
    });

    it("label uses a space separator", async () => {
        const [a] = await engine.analogs(1.5);
        expect(a.label).toBe(a.date.replace("-", " "));
    });
});

describe("TsEngine — run() assembles the payload", () => {
    it("produces metrics, analogs, summary and timeline together", async () => {
        const p = await engine.run(state(1.5));
        expect(p.metrics.riskTier).toBe("Strong El Niño");
        expect(p.analogs).toHaveLength(ANALOG_LIMIT);
        expect(p.summary.rowCount).toBe(918);
        expect(p.timeline).toHaveLength(918);
        expect(typeof p.queryMs).toBe("number");
    });

    it("metric values equal computeMetrics", async () => {
        const s = state(2.4, 0.5, 0.3);
        const p = await engine.run(s);
        expect(p.metrics).toEqual(computeMetrics(s));
    });
});

describe("helpers", () => {
    it("monthKey slices an ISO date without timezone drift", () => {
        expect(monthKey("2026-06-01")).toBe("2026-06");
        // A date constructed as UTC midnight would land in May in UTC-7; slicing cannot.
        expect(monthKey("2015-11-01")).toBe("2015-11");
    });

    it("periodLabel replaces the separator", () => {
        expect(periodLabel("2015-11")).toBe("2015 11");
    });

    it("sortAnalogs is stable and deterministic on equal deltas", () => {
        const input = [
            { date: "2000-01", delta: 0.1 },
            { date: "2010-01", delta: 0.1 },
            { date: "1990-01", delta: 0.05 },
        ];
        const out = sortAnalogs(input);
        expect(out.map((r) => r.date)).toEqual([
            "1990-01",
            "2010-01",
            "2000-01",
        ]);
        // Repeated calls agree.
        expect(sortAnalogs(input).map((r) => r.date)).toEqual(
            out.map((r) => r.date),
        );
    });

    it("sortAnalogs does not mutate its input", () => {
        const input = [
            { date: "2000-01", delta: 0.5 },
            { date: "1990-01", delta: 0.1 },
        ];
        const snapshot = input.map((r) => ({ ...r }));
        sortAnalogs(input);
        expect(input).toEqual(snapshot);
    });
});
