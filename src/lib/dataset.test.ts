import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parquetMetadata, parquetReadObjects } from "hyparquet";

/**
 * Data-integrity tests for the shipped NOAA parquet.
 *
 * The app trusts this file completely — every historical number the HUD shows
 * comes from it. If the ingest script silently breaks (source format change,
 * a bad filter, an off-by-one on the baseline period), the UI would keep
 * rendering plausible-looking nonsense. These assertions pin the file to
 * publicly known values so that can't happen quietly.
 *
 * Read with hyparquet rather than a Polars/pyarrow round-trip so the test runs
 * in the same Node process as the rest of the suite.
 */

// Repo-only source of truth. Moved out of public/ in 2C so it can never be
// served or copied into dist/; the browser only ever loads enso.csv.
const PARQUET = path.resolve(__dirname, "../../data/enso_historical.parquet");

interface Row {
    date: Date;
    year: number;
    month: number;
    nino_34_anomaly: number;
    nino34_sst: number;
    sst_deviation: number;
    risk_tier_pacific: string;
    source: string;
    model_basis: string;
    [key: string]: unknown;
}

let rows: Row[] = [];

const load = async (): Promise<Row[]> => {
    if (rows.length > 0) return rows;
    const buffer = readFileSync(PARQUET);
    const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const objects = await parquetReadObjects({ file: arrayBuffer });
    rows = objects as unknown as Row[];
    return rows;
};

const asMonth = (date: Date): string => {
    const iso = date instanceof Date ? date.toISOString() : String(date);
    return iso.slice(0, 7);
};

const findMonth = (list: Row[], month: string): Row | undefined =>
    list.find((r) => asMonth(r.date) === month);

describe("shipped parquet — structure", () => {
    it("exists and is a readable parquet file", async () => {
        const buffer = readFileSync(PARQUET);
        expect(buffer.byteLength).toBeGreaterThan(10_000);
        const meta = parquetMetadata(
            buffer.buffer.slice(
                buffer.byteOffset,
                buffer.byteOffset + buffer.byteLength,
            ) as ArrayBuffer,
        );
        expect(meta.num_rows).toBeGreaterThan(900);
    });

    it("covers 1950 to the present era, one row per month", async () => {
        const list = await load();
        expect(list.length).toBeGreaterThan(900);
        const months = list.map((r) => asMonth(r.date));
        expect(months[0]).toBe("1950-01");
        // The source is updated monthly; anything before 2024 would mean a stale build.
        expect(months[months.length - 1] >= "2024-01").toBe(true);
    });

    it("has no duplicate months and no null anomalies", async () => {
        const list = await load();
        const months = list.map((r) => asMonth(r.date));
        expect(new Set(months).size).toBe(months.length);
        const nulls = list.filter(
            (r) =>
                r.nino_34_anomaly === null || Number.isNaN(r.nino_34_anomaly),
        );
        expect(nulls).toHaveLength(0);
    });

    it("has integer year/month columns that agree with the date column", async () => {
        const list = await load();
        for (const row of list.slice(0, 40)) {
            const [y, m] = asMonth(row.date).split("-").map(Number);
            expect(row.year).toBe(y);
            expect(row.month).toBe(m);
            expect(Number.isInteger(row.year)).toBe(true);
        }
    });

    it("records its provenance on every row", async () => {
        const list = await load();
        const sources = new Set(list.map((r) => r.source));
        expect(sources.size).toBe(1);
        const only = [...sources][0];
        expect(only).toMatch(/NOAA/i);
        expect(only).toMatch(/ERSSTv5/i);
        for (const row of list.slice(0, 10)) {
            expect(row.model_basis).toMatch(/observed/i);
            expect(row.model_basis).toMatch(/modelled|modeled/i);
        }
    });
});

describe("shipped parquet — matches published NOAA values", () => {
    it("reproduces the 2015-16 super El Niño peak", async () => {
        const list = await load();
        const peak = findMonth(list, "2015-11");
        expect(peak).toBeDefined();
        // ERSSTv5 (1991-2020 base): Nov 2015 Niño 3.4 anomaly = +2.72 °C.
        expect(peak!.nino_34_anomaly).toBeCloseTo(2.72, 2);
    });

    it("reproduces the 1997-98 super El Niño peak", async () => {
        const list = await load();
        const peak = findMonth(list, "1997-11");
        expect(peak).toBeDefined();
        expect(peak!.nino_34_anomaly).toBeCloseTo(2.41, 2);
    });

    it("reproduces a strong La Niña trough", async () => {
        const list = await load();
        // Nov 2010 is one of the strongest La Niña months in the record.
        const trough = findMonth(list, "2010-11");
        expect(trough).toBeDefined();
        expect(trough!.nino_34_anomaly).toBeLessThan(-1.0);
    });

    it("keeps absolute SST physically plausible", async () => {
        const list = await load();
        for (const row of list) {
            expect(row.nino34_sst).toBeGreaterThan(20);
            expect(row.nino34_sst).toBeLessThan(32);
        }
    });

    it("has an anomaly range consistent with the historical record", async () => {
        const list = await load();
        const anomalies = list.map((r) => r.nino_34_anomaly);
        const min = Math.min(...anomalies);
        const max = Math.max(...anomalies);
        // The instrument-era record runs roughly -2.5 to +2.8 °C on this baseline.
        expect(max).toBeGreaterThan(2.5);
        expect(max).toBeLessThan(3.5);
        expect(min).toBeLessThan(-2.0);
        expect(min).toBeGreaterThan(-3.5);
    });
});

describe("shipped parquet — modelled columns follow the brief", () => {
    it("applies SST deviation = anomaly × 1.15", async () => {
        const list = await load();
        for (const row of list.slice(0, 60)) {
            expect(row.sst_deviation).toBeCloseTo(
                row.nino_34_anomaly * 1.15,
                6,
            );
        }
    });

    it("assigns the tier ladder consistently with the anomaly", async () => {
        const list = await load();
        for (const row of list) {
            const a = row.nino_34_anomaly;
            const tier = row.risk_tier_pacific;
            if (a >= 2.6) expect(tier).toMatch(/Mega/);
            else if (a >= 2.0) expect(tier).toMatch(/Super/);
            else if (a >= 1.5) expect(tier).toMatch(/Strong/);
            else if (a >= 1.0) expect(tier).toMatch(/Moderate/);
            else if (a >= 0.5) expect(tier).toMatch(/Weak/);
            else if (a >= -0.5) expect(tier).toMatch(/Neutral/);
            else expect(tier).toMatch(/La Niña/);
        }
    });

    it("has tiers using the correct Spanish spelling", async () => {
        const list = await load();
        const withTilde = list.filter((r) =>
            r.risk_tier_pacific.includes("Niño"),
        ).length;
        // Anything above +1.0 °C should be a warm tier with an ñ.
        const warm = list.filter((r) => r.nino_34_anomaly >= 1.0).length;
        expect(withTilde).toBe(warm);
    });
});
