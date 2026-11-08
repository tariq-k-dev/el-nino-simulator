import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    DatasetParseError,
    EXPECTED_COLUMNS,
    parseDataset,
} from "@/lib/data/parse";

/**
 * The parser is the only thing standing between a pipeline change and a UI that
 * renders plausible-looking nonsense, so these cases target the failure modes
 * that would otherwise be silent: a renamed column, a reordered column, a
 * non-numeric value quietly becoming NaN.
 */

const CSV_PATH = path.resolve(__dirname, "../../../public/data/enso.csv");

describe("parseDataset — the real committed file", () => {
    const text = readFileSync(CSV_PATH, "utf8");
    const rows = parseDataset(text);

    it("parses all 918 rows", () => {
        expect(rows).toHaveLength(918);
    });

    it("produces the documented first and last month", () => {
        expect(rows[0].date).toBe("1950-01-01");
        expect(rows[0].year).toBe(1950);
        expect(rows[0].month).toBe(1);
        expect(rows[rows.length - 1].date).toBe("2026-06-01");
    });

    it("types every column correctly", () => {
        const r = rows[0];
        expect(typeof r.date).toBe("string");
        expect(typeof r.year).toBe("number");
        expect(typeof r.nino_34_anomaly).toBe("number");
        expect(typeof r.risk_tier_pacific).toBe("string");
        expect(typeof r.source).toBe("string");
        expect(typeof r.model_basis).toBe("string");
    });

    it("preserves full float precision (no rounding during parse)", () => {
        // Row 1 carries a long-tailed float in temp_deviation_us_f; if string->number
        // lost precision the DuckDB and TS engines would disagree beyond 1e-9.
        expect(rows[0].temp_deviation_us_f).toBe(0.8820000000000001);
    });

    it("matches known NOAA values", () => {
        const peak = rows.find((r) => r.date === "2015-11-01");
        expect(peak?.nino_34_anomaly).toBeCloseTo(2.72, 2);
    });

    it("keeps rows in ascending date order", () => {
        for (let i = 1; i < rows.length; i += 1) {
            expect(rows[i].date > rows[i - 1].date).toBe(true);
        }
    });

    it("has no NaN or non-finite numeric cells", () => {
        const numericCols = EXPECTED_COLUMNS.filter(
            (c) =>
                c !== "date" &&
                c !== "risk_tier_pacific" &&
                c !== "source" &&
                c !== "model_basis",
        );
        for (const row of rows) {
            for (const col of numericCols) {
                const v = (row as unknown as Record<string, unknown>)[
                    col
                ] as number;
                expect(Number.isFinite(v)).toBe(true);
            }
        }
    });

    it("tolerates CRLF line endings", () => {
        const crlf = text.replace(/\n/g, "\r\n");
        expect(parseDataset(crlf)).toHaveLength(918);
    });
});

describe("parseDataset — rejects malformed input loudly", () => {
    const header = EXPECTED_COLUMNS.join(",");
    const goodRow = readFileSync(CSV_PATH, "utf8").split("\n")[1].split(",");

    const withRow = (mutate: (cells: string[]) => string[]) => {
        const cells = mutate([...goodRow]);
        return `${header}\n${cells.join(",")}\n`;
    };

    it("rejects an empty file", () => {
        expect(() => parseDataset("")).toThrow(DatasetParseError);
    });

    it("rejects a header-only file", () => {
        expect(() => parseDataset(`${header}\n`)).toThrow(/no data rows/);
    });

    it("rejects a header with the wrong column count", () => {
        expect(() => parseDataset("date,year\n2020-01-01,2020\n")).toThrow(
            /has 2 columns; expected 28/,
        );
    });

    it("rejects a RENAMED column (the dangerous silent case)", () => {
        // If the pipeline renamed nino_34_anomaly, a naive parser would still read a
        // number — just the wrong one.
        const badHeader = EXPECTED_COLUMNS.map((c) =>
            c === "nino_34_anomaly" ? "nino3_anomaly2" : c,
        ).join(",");
        expect(() =>
            parseDataset(`${badHeader}\n${goodRow.join(",")}\n`),
        ).toThrow(/expected "nino_34_anomaly"/);
    });

    it("rejects a REORDERED header", () => {
        const swapped = [...EXPECTED_COLUMNS];
        [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
        expect(() =>
            parseDataset(`${swapped.join(",")}\n${goodRow.join(",")}\n`),
        ).toThrow(/expected/);
    });

    it("rejects a non-numeric value in a numeric column", () => {
        expect(() =>
            parseDataset(withRow((c) => ((c[3] = "not-a-number"), c))),
        ).toThrow(/not a finite number/);
    });

    it("rejects an empty numeric cell", () => {
        expect(() => parseDataset(withRow((c) => ((c[3] = ""), c)))).toThrow(
            /not a finite number/,
        );
    });

    it("rejects a malformed date", () => {
        expect(() =>
            parseDataset(withRow((c) => ((c[0] = "1950/01/01"), c))),
        ).toThrow(/invalid date/);
    });

    it("rejects a short row", () => {
        expect(() => parseDataset(withRow((c) => c.slice(0, 24)))).toThrow(
            /has 24 cells/,
        );
    });

    it("rejects an interior blank line", () => {
        const twoRows = `${header}\n${goodRow.join(",")}\n\n${goodRow.join(",")}\n`;
        expect(() => parseDataset(twoRows)).toThrow(/blank line/);
    });

    it("names the offending row number in the message", () => {
        // Corrupt a NUMERIC column (index 3 = nino12_sst); the trailing string
        // columns legitimately accept any text, so index 23 would not throw here.
        const bad = [...goodRow];
        bad[3] = "x";
        const twoRows = `${header}\n${goodRow.join(",")}\n${bad.join(",")}\n`;
        expect(() => parseDataset(twoRows)).toThrow(/row 2/);
    });
});
