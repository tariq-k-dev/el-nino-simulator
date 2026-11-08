/**
 * ninoRelation — fit mechanics and the drift guard.
 *
 * Two jobs:
 *
 *  1. **Pin the arithmetic.** `fitLinear` is a two-pass OLS and the constants in
 *     `NINO_RELATIONS` are pasted from a script that lives OUTSIDE this repo
 *     (`_triage/nino-relations.mjs`). A pasted table is a claim, and a claim about
 *     data has to be re-checkable — which is what the drift guard at the bottom of
 *     this file does: it re-reads the shipped CSV, re-parses it with the app's own
 *     parser, re-fits all four relations, and compares field by field.
 *  2. **Pin the thresholds.** Zero-variance, too-few-pairs and extrapolation are
 *     the three conditions where a projection is a lie told in a number's clothing.
 *     Each has a case that fails if the guard is removed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDataset } from "@/lib/data/parse";
import {
    MIN_FIT_PAIRS,
    NINO_RELATIONS,
    WARM_THRESHOLD,
    fitLinear,
    pickRelation,
    projectAnomaly,
    type NinoRelation,
} from "@/lib/ninoRelation";

/** Build a synthetic relation for projection cases, so the shipped table is not implicated. */
const synthetic = (overrides: Partial<NinoRelation> = {}): NinoRelation => ({
    regionId: "nino12",
    subset: "warm",
    n: 100,
    slope: 1,
    intercept: 0,
    r2: 1,
    residSd: 0.5,
    xMin: 0.5,
    xMax: 2.5,
    ...overrides,
});

describe("fitLinear — exact line", () => {
    it("recovers the slope and intercept of y = 3x - 2 with r2 = 1 and residSd = 0", () => {
        const xs = Array.from({ length: 40 }, (_, i) => -2 + i * 0.1);
        const ys = xs.map((x) => 3 * x - 2);
        const fit = fitLinear(xs, ys);

        expect(fit.n).toBe(40);
        expect(fit.slope).toBeCloseTo(3, 12);
        expect(fit.intercept).toBeCloseTo(-2, 12);
        expect(fit.r2).toBeCloseTo(1, 12);
        expect(fit.residSd).toBeCloseTo(0, 12);
        expect(Math.abs(fit.slope - 3)).toBeLessThan(1e-12);
        expect(Math.abs(fit.intercept + 2)).toBeLessThan(1e-12);
        expect(Math.abs(fit.r2 - 1)).toBeLessThan(1e-12);
        expect(Math.abs(fit.residSd)).toBeLessThan(1e-12);
    });

    it("reports the sample extremes, not the population ones", () => {
        const xs = [
            0.1,
            0.4,
            0.9,
            1.7,
            2.2,
            ...Array.from({ length: 30 }, () => 1),
        ];
        const ys = xs.map((x) => 2 * x + 1);
        const fit = fitLinear(xs, ys);
        expect(fit.xMin).toBeCloseTo(0.1, 12);
        expect(fit.xMax).toBeCloseTo(2.2, 12);
        expect(fit.yMin).toBeCloseTo(1.2, 12);
        expect(fit.yMax).toBeCloseTo(5.4, 12);
    });
});

describe("fitLinear — known closed-form fixture", () => {
    /*
     * A 30-point fixture whose closed form is exact, not re-derived.
     *
     * x = 1..30. The residual pattern e is SYMMETRIC across the centre pair
     * (i, 29-i): e[29-i] = e[i], and its 15-value half sums to zero. Those two
     * properties are what make the closed form exact, and they do different jobs:
     *
     *   sum(e)      = 2 * sum(E_HALF)          = 0    (orthogonal to the intercept)
     *   sum(e * dx) = sum over pairs of e_i*dx_i + e_i*(-dx_i) = 0  (orthogonal to x)
     *   sum(e^2)    = 2 * sum(E_HALF^2)         = 60
     *
     * (An ANTIsymmetric e would also give sum(e) = 0, but NOT sum(e*dx) = 0 — that
     * pairing doubles the product instead of cancelling it, which is why this fixture
     * is symmetric and not antisymmetric. The first case below asserts both
     * orthogonality identities, so this mistake cannot come back silently.)
     *
     * Then with y = 2x + 1 + e:
     *
     *   Sxx = n(n^2 - 1)/12            = 30 * 899 / 12 = 2247.5     (exact)
     *   Sxy = 2 * Sxx                   = 4495                       (exact, since <e,x> = 0)
     *   slope = 2                       (exact by construction)
     *   intercept = 1                   (exact by construction)
     *   Syy = 4 * Sxx + sum(e^2)        = 8990 + 60 = 9050           (exact, since <e,1> = 0)
     *   ssRes = sum(e^2)                = 60                         (the residuals ARE e)
     *   r2 = 1 - 60/9050
     *   residSd = sqrt(60 / 28)
     *
     * Every expected value below follows from those identities, so an implementation
     * that used n or n-1 as the denominator, or that mis-centred the sums, fails here
     * without this test repeating the implementation's own arithmetic.
     *
     * (The fixture is 30 points rather than the textbook 10 because `MIN_FIT_PAIRS` is
     * 30 and `fitLinear` rightly refuses a smaller sample — the floor is part of the
     * contract, so the fixture has to clear it.)
     */
    const N = 30;
    const E_HALF = [-2, 1, -1, 2, 0, -2, 1, 2, -1, 0, 2, -1, 1, -2, 0];

    const residual = (i: number): number => E_HALF[i < N / 2 ? i : N - 1 - i];
    const xs = Array.from({ length: N }, (_, i) => i + 1);
    const ys = xs.map((x, i) => 2 * x + 1 + residual(i));

    const SXX = (N * (N * N - 1)) / 12; // 2247.5
    const SS_RES = 2 * E_HALF.reduce((s, v) => s + v * v, 0); // 60
    const SYY = 4 * SXX + SS_RES; // 9050

    it("has the structure the closed form assumes", () => {
        // If these two identities fail, the algebra below is invalid and the test would
        // be checking nothing. Assert them first.
        expect(xs.length).toBe(N);
        const e = xs.map((_, i) => residual(i));
        expect(e.reduce((s, v) => s + v, 0)).toBe(0);
        expect(e.reduce((s, v, i) => s + v * (xs[i] - 15.5), 0)).toBe(0);
        expect(SXX).toBe(2247.5);
        expect(SS_RES).toBe(60);
        expect(SYY).toBe(9050);
    });

    it("matches the closed-form slope, intercept, r2 and residSd", () => {
        const fit = fitLinear(xs, ys);
        expect(fit.n).toBe(N);
        expect(fit.meanX).toBeCloseTo(15.5, 12);
        expect(fit.meanY).toBeCloseTo(32, 12);
        expect(fit.slope).toBeCloseTo(2, 12);
        expect(fit.intercept).toBeCloseTo(1, 12);
        expect(fit.r2).toBeCloseTo(1 - SS_RES / SYY, 12);
        expect(fit.residSd).toBeCloseTo(Math.sqrt(SS_RES / (N - 2)), 12);
    });

    it("uses n - 2 as the residual denominator, not n and not n - 1", () => {
        const fit = fitLinear(xs, ys);
        expect(fit.residSd).toBeCloseTo(Math.sqrt(SS_RES / 28), 12);
        expect(fit.residSd).not.toBeCloseTo(Math.sqrt(SS_RES / 30), 6);
        expect(fit.residSd).not.toBeCloseTo(Math.sqrt(SS_RES / 29), 6);
    });
});

describe("fitLinear — non-finite handling and refusals", () => {
    it("drops non-finite pairs and reports the reduced n", () => {
        const xs = Array.from({ length: 40 }, (_, i) => i * 0.1);
        const ys = xs.map((x) => 2 * x + 1);
        xs[3] = Number.NaN;
        ys[7] = Number.POSITIVE_INFINITY;
        xs[11] = Number.NEGATIVE_INFINITY;

        const fit = fitLinear(xs, ys);
        expect(fit.n).toBe(37);
        // The surviving pairs are still exact, so the line is unchanged.
        expect(fit.slope).toBeCloseTo(2, 12);
        expect(fit.intercept).toBeCloseTo(1, 12);
        expect(fit.residSd).toBeCloseTo(0, 12);
    });

    it("drops a pair when only ONE side is non-finite, the pair-count way round", () => {
        const good = Array.from({ length: 32 }, (_, i) => i * 0.1);
        const xs = [...good, Number.NaN];
        const ys = [...good.map((x) => x), 500];
        // The bad value is on the x side only; the y value at that index is finite but
        // must NOT be used, because a fit needs both.
        expect(fitLinear(xs, ys).n).toBe(32);
    });

    it("throws when there are fewer than MIN_FIT_PAIRS valid pairs", () => {
        const xs = Array.from({ length: MIN_FIT_PAIRS - 1 }, (_, i) => i);
        const ys = xs.map((x) => x);
        expect(() => fitLinear(xs, ys)).toThrow(/at least 30 are required/);
        expect(() => fitLinear(xs, ys)).toThrow(Error);
    });

    it("accepts exactly MIN_FIT_PAIRS pairs", () => {
        const xs = Array.from({ length: MIN_FIT_PAIRS }, (_, i) => i);
        const fit = fitLinear(
            xs,
            xs.map((x) => 2 * x),
        );
        expect(fit.n).toBe(MIN_FIT_PAIRS);
        expect(fit.slope).toBeCloseTo(2, 12);
    });

    it("throws when x has zero variance, and says so", () => {
        const xs = Array.from({ length: 40 }, () => 1.5);
        const ys = Array.from({ length: 40 }, (_, i) => i);
        expect(() => fitLinear(xs, ys)).toThrow(/zero variance/);
    });

    it("throws when the two arrays differ in length", () => {
        expect(() => fitLinear([1, 2, 3], [1, 2])).toThrow(/same length/);
    });
});

describe("projectAnomaly", () => {
    it("evaluates slope * x + intercept", () => {
        const r = synthetic({
            slope: 1.5,
            intercept: -0.25,
            residSd: 0.4,
            xMin: 0,
            xMax: 3,
        });
        expect(projectAnomaly(r, 2).value).toBeCloseTo(2.75, 12);
    });

    it("brackets the value one residSd either side", () => {
        const r = synthetic({
            slope: 1.5,
            intercept: -0.25,
            residSd: 0.4,
            xMin: 0,
            xMax: 3,
        });
        const p = projectAnomaly(r, 2);
        expect(p.lo).toBeCloseTo(p.value - 0.4, 12);
        expect(p.hi).toBeCloseTo(p.value + 0.4, 12);
        expect(p.lo).toBeLessThan(p.value);
        expect(p.value).toBeLessThan(p.hi);
    });

    it("collapses the band to a point when residSd is 0", () => {
        const r = synthetic({ residSd: 0, xMin: 0, xMax: 3 });
        const p = projectAnomaly(r, 1);
        expect(p.lo).toBe(p.value);
        expect(p.hi).toBe(p.value);
        // The requested strict ordering only holds while there IS a spread.
        expect(p.lo).toBeLessThanOrEqual(p.value);
        expect(p.value).toBeLessThanOrEqual(p.hi);
    });

    it("is not extrapolated inside the range, and is just past either end", () => {
        const r = synthetic({ xMin: 0.5, xMax: 2.5 });
        expect(projectAnomaly(r, 0.5).extrapolated).toBe(false);
        expect(projectAnomaly(r, 2.5).extrapolated).toBe(false);
        expect(projectAnomaly(r, 1.5).extrapolated).toBe(false);
        expect(projectAnomaly(r, 2.5 + 1e-9).extrapolated).toBe(true);
        expect(projectAnomaly(r, 0.5 - 1e-9).extrapolated).toBe(true);
    });

    it("refuses a non-finite input rather than returning NaN", () => {
        expect(() => projectAnomaly(synthetic(), Number.NaN)).toThrow(/finite/);
    });
});

describe("pickRelation", () => {
    it("returns the warm subset for both regions", () => {
        expect(pickRelation("nino12").subset).toBe("warm");
        expect(pickRelation("nino4").subset).toBe("warm");
        expect(pickRelation("nino12").regionId).toBe("nino12");
        expect(pickRelation("nino4").regionId).toBe("nino4");
    });

    it("returns the very object from NINO_RELATIONS, not a copy that could drift", () => {
        expect(pickRelation("nino12")).toBe(
            NINO_RELATIONS.find(
                (r) => r.regionId === "nino12" && r.subset === "warm",
            ),
        );
    });

    it("applies the warm threshold to the sample it returns", () => {
        for (const region of ["nino12", "nino4"] as const) {
            expect(pickRelation(region).xMin).toBe(WARM_THRESHOLD);
        }
    });
});

describe("NINO_RELATIONS — the shipped table is internally coherent", () => {
    it("holds exactly four relations: two regions x two subsets", () => {
        expect(NINO_RELATIONS).toHaveLength(4);
        expect(NINO_RELATIONS.map((r) => `${r.regionId}/${r.subset}`)).toEqual([
            "nino12/all",
            "nino12/warm",
            "nino4/all",
            "nino4/warm",
        ]);
    });

    it("every relation has a plausible shape", () => {
        for (const r of NINO_RELATIONS) {
            expect(r.n).toBeGreaterThanOrEqual(MIN_FIT_PAIRS);
            expect(r.xMin).toBeLessThan(r.xMax);
            expect(r.r2).toBeGreaterThanOrEqual(0);
            expect(r.r2).toBeLessThanOrEqual(1);
            expect(r.residSd).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(r.slope)).toBe(true);
            expect(Number.isFinite(r.intercept)).toBe(true);
        }
    });

    it("the warm subsets start exactly at WARM_THRESHOLD and cover fewer months", () => {
        for (const region of ["nino12", "nino4"] as const) {
            const all = NINO_RELATIONS.find(
                (r) => r.regionId === region && r.subset === "all",
            )!;
            const warm = pickRelation(region);
            expect(warm.xMin).toBe(WARM_THRESHOLD);
            expect(warm.n).toBeLessThan(all.n);
            // Same regressor, so the same x range end.
            expect(warm.xMax).toBeCloseTo(all.xMax, 12);
        }
    });
});

/**
 * DRIFT GUARD.
 *
 * `NINO_RELATIONS` is a pasted table. This re-derives all four relations from the
 * shipped CSV on every run, through the SAME parser the app uses (`parseDataset`,
 * `src/lib/data/parse.ts`), and compares field by field. If the dataset is rebuilt,
 * the source is revised, or the constants are edited by hand, this fails and names
 * the script to re-run.
 *
 * vitest's environment is `node` (vitest.config.ts) and `src/lib/dataset.test.ts`
 * already reads a binary file with `readFileSync`, so file access from a unit test
 * is established practice here. The path is `public/data/enso.csv` — the prompt says
 * `data/enso.csv`, but `data/` holds only the repo-only parquet; the CSV is the
 * browser-served artifact under `public/`.
 */
describe("DRIFT GUARD — NINO_RELATIONS matches the shipped CSV", () => {
    const CSV = path.resolve(__dirname, "../../public/data/enso.csv");

    const refit = () => {
        const rows = parseDataset(readFileSync(CSV, "utf8"));
        const out: Record<string, ReturnType<typeof fitLinear>> = {};
        for (const [key, col] of [
            ["nino12", "nino12_anomaly"],
            ["nino4", "nino4_anomaly"],
        ] as const) {
            const xs = rows.map((r) => r.nino_34_anomaly);
            const ys = rows.map((r) => r[col] as number);
            out[`${key}/all`] = fitLinear(xs, ys);
            const warm = rows.filter(
                (r) => r.nino_34_anomaly >= WARM_THRESHOLD,
            );
            out[`${key}/warm`] = fitLinear(
                warm.map((r) => r.nino_34_anomaly),
                warm.map((r) => r[col] as number),
            );
        }
        return out;
    };

    it("re-derives every field of all four relations from the CSV", () => {
        const measured = refit();
        for (const relation of NINO_RELATIONS) {
            const key = `${relation.regionId}/${relation.subset}`;
            const m = measured[key];
            expect(m, `missing measurement for ${key}`).toBeDefined();
            const why =
                `NINO_RELATIONS['${key}'] no longer matches public/data/enso.csv. ` +
                `Regenerate the table by running _triage/nino-relations.mjs (Handshake triage dir) ` +
                `and paste its "paste-ready table" block into src/lib/ninoRelation.ts.`;

            expect(m.slope, why).toBeCloseTo(relation.slope, 9);
            expect(m.intercept, why).toBeCloseTo(relation.intercept, 9);
            expect(m.r2, why).toBeCloseTo(relation.r2, 9);
            expect(m.residSd, why).toBeCloseTo(relation.residSd, 9);
            // Counts and ranges are exact by construction, so demand exactness.
            expect(m.n, why).toBe(relation.n);
            expect(m.xMin, why).toBeCloseTo(relation.xMin, 12);
            expect(m.xMax, why).toBeCloseTo(relation.xMax, 12);
        }
    });

    it("the CSV the guard reads is the one the app ships, with the columns it claims", () => {
        const rows = parseDataset(readFileSync(CSV, "utf8"));
        expect(rows.length).toBe(918);
        expect(rows[0].date).toBe("1950-01-01");
        expect(rows[rows.length - 1].date).toBe("2026-06-01");
        // Every value the fits consume is finite — no month is silently missing from a
        // region column, which is the failure mode that would bias a fit without erroring.
        const nonFinite = rows.filter(
            (r) =>
                !Number.isFinite(r.nino_34_anomaly) ||
                !Number.isFinite(r.nino12_anomaly) ||
                !Number.isFinite(r.nino4_anomaly),
        );
        expect(nonFinite).toHaveLength(0);
    });
});
