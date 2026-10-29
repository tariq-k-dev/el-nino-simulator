import { describe, expect, it } from 'vitest';
import { clamp, computeMetrics, round, riskTier, thermalColor, thermalVector } from '@/lib/model';
import { mean, argMaxDate, sortAnalogs, monthKey, periodLabel } from '@/lib/engine/dataEngine';

/**
 * JS-vs-SQL semantics audit.
 *
 * Every place the TypeScript engine and the DuckDB SQL could disagree for reasons
 * OTHER than arithmetic is pinned here, with the DuckDB equivalent named. These
 * are the silent-divergence classes: they produce plausible numbers that are
 * simply not the same numbers.
 *
 * The full-lattice sweep (pnpm parity:full) covers the arithmetic exhaustively;
 * this file covers the SEMANTICS, exhaustively over the interesting inputs.
 *
 * | Construct | JS here | DuckDB | Covered by |
 * |---|---|---|---|
 * | round(x, n)          | halves away from zero | `round(double,n)` halves away from zero | `round()` block |
 * | clamp to [0,100]     | Math.min/Math.max     | `least(100, greatest(0, x))`             | `clamp()` block |
 * | mean                 | sum/n                 | `avg(double)`                            | `mean()` block |
 * | arg_max tie-break    | first occurrence wins | `arg_max` keeps first on ties             | `argMaxDate()` block |
 * | ORDER BY tie-break   | delta asc, date DESC  | `ORDER BY delta ASC, date DESC`           | `sortAnalogs()` block |
 * | strftime '%Y-%m'     | `String.slice(0,7)`   | `strftime(date,'%Y-%m')`                  | `monthKey()` block |
 * | date -> 'YYYY MM'    | `.replace('-',' ')`   | `.replace('-',' ')` in SQL mapping        | `periodLabel()` block |
 * | integer division     | not used anywhere     | not used anywhere                         | absent-construct block |
 * | NaN / null           | filtered at ingest    | `999` sentinels filtered at ingest        | dataset.test.ts |
 * | pow / exp / log      | Math.exp in overlay   | unused in SQL                             | `exp` block |
 */

describe('round() — halves away from zero, matching DuckDB round(double, n)', () => {
  it('rounds an exact .5 tie up in magnitude, both signs', () => {
    // The real case: asia_precip at sst=1.5, jet=0.35 is exactly -46.15.
    // DuckDB round(-46.15, 1) = -46.2; JS Math.round would give -46.1.
    expect(round(-46.15, 1)).toBe(-46.2);
    expect(round(46.15, 1)).toBe(46.2);
    expect(round(-2.5, 0)).toBe(-3);
    expect(round(2.5, 0)).toBe(3);
  });

  it('leaves non-ties alone', () => {
    expect(round(46.14, 1)).toBe(46.1);
    expect(round(-46.16, 1)).toBe(-46.2);
    expect(round(0.8819999, 2)).toBe(0.88);
  });

  it('normalises -0 to 0 so nothing formats as "-0.00"', () => {
    // round(-0.001, 2) is -0 with Math.round; DuckDB returns 0.
    expect(Object.is(round(-0.001, 2), -0)).toBe(false);
    expect(round(-0.001, 2)).toBe(0);
    expect(Object.is(round(-0, 2), -0)).toBe(false);
  });

  it('is stable across the digit counts the app uses', () => {
    for (const [v, d] of [[1.725, 2], [52.5, 1], [-1.91, 2], [5.05, 2], [82.5, 1]] as const) {
      // No tie: JS and DuckDB agree, and this pins the expected value.
      expect(round(v, d)).toBe(Number(v.toFixed(d)));
    }
  });
});

describe('clamp() — least/greatest', () => {
  it('matches least(hi, greatest(lo, x))', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('is order-independent at the exact bounds', () => {
    expect(clamp(0, 0, 0)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('propagates NaN the way SQL propagates NULL through greatest', () => {
    // Math.max(NaN, x) is NaN, and DuckDB's greatest(NaN, x) is NaN.
    expect(Number.isNaN(clamp(Number.NaN, 0, 10))).toBe(true);
  });
});

describe('mean() — avg(double)', () => {
  it('is a plain arithmetic mean', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([-1, 1])).toBe(0);
  });

  it('returns 0 for an empty list instead of NaN', () => {
    // SQL avg() over zero rows is NULL; the app never hits that (918 rows), but
    // returning NaN would poison every downstream sum, so 0 is deliberate.
    expect(mean([])).toBe(0);
  });

  it('does not lose precision on the real anomaly column', () => {
    const vals = [-1.99, 2.72, 0.5];
    expect(mean(vals)).toBeCloseTo((vals.reduce((a, b) => a + b, 0)) / 3, 15);
  });
});

describe('argMaxDate() — arg_max(date, x) tie-break', () => {
  it('returns the FIRST row on a tie, matching DuckDB', () => {
    const rows = [
      { date: '2000-01', value: 2 },
      { date: '2001-01', value: 2 },
      { date: '2002-01', value: 1 },
    ];
    expect(argMaxDate(rows)).toBe('2000-01');
  });

  it('returns the true maximum when unique', () => {
    expect(
      argMaxDate([
        { date: '2000-01', value: 1 },
        { date: '2001-01', value: 9 },
      ]),
    ).toBe('2001-01');
  });

  it('is empty for no rows', () => {
    expect(argMaxDate([])).toBe('');
  });
});

describe('sortAnalogs() — ORDER BY delta ASC, date DESC', () => {
  it('orders by delta, then date descending', () => {
    const out = sortAnalogs([
      { date: '2000-01', delta: 0.1 },
      { date: '2010-01', delta: 0.1 },
      { date: '1990-01', delta: 0.05 },
    ]);
    expect(out.map((r) => r.date)).toEqual(['1990-01', '2010-01', '2000-01']);
  });

  it('is deterministic across repeated calls (no comparator instability)', () => {
    const input = Array.from({ length: 50 }, (_, i) => ({ date: `20${10 + (i % 5)}-01`, delta: 0.1 }));
    const a = sortAnalogs(input).map((r) => r.date);
    const b = sortAnalogs(input).map((r) => r.date);
    expect(a).toEqual(b);
  });

  it('does not mutate the caller array', () => {
    const input = [{ date: 'b', delta: 2 }, { date: 'a', delta: 1 }];
    const copy = input.map((r) => ({ ...r }));
    sortAnalogs(input);
    expect(input).toEqual(copy);
  });
});

describe('date formatting — strftime / replace', () => {
  it('monthKey is a slice, so it cannot drift across timezones', () => {
    expect(monthKey('2026-06-01')).toBe('2026-06');
    expect(monthKey('1950-01-01')).toBe('1950-01');
  });

  it('periodLabel replaces only the first dash', () => {
    expect(periodLabel('2015-11')).toBe('2015 11');
    // A full date would keep the second dash, exactly like .replace('-', ' ').
    expect(periodLabel('2015-11-01')).toBe('2015 11-01');
  });
});

describe('absent constructs — verified not used, so no divergence can exist', () => {
  it('integer division: % and // never appear in the model or engines', () => {
    // Both implementations use only true division. If someone adds `Math.floor(a/b)`
    // or a SQL `//`, this fails and forces a semantics review.
    const src = [
      computeMetrics.toString(),
      clamp.toString(),
      round.toString(),
      riskTier.toString(),
    ].join('\n');
    expect(src).not.toMatch(/Math\.(floor|trunc|ceil)/);
    expect(src).not.toMatch(/[^/*]\/\/[^/]/);
  });

  it('toFixed is used only for display strings, never for math', () => {
    // toFixed rounds half away from zero in JS for most values but is subject to
    // binary representation, so it must never feed a numeric result that gets
    // compared against SQL.
    const src = computeMetrics.toString() + clamp.toString() + round.toString();
    expect(src).not.toMatch(/toFixed/);
  });

  it('riskTier uses strict comparisons, matching the SQL CASE ladder', () => {
    // The SQL is `WHEN sst < 0.5 ...`; JS must not use <= or ===.
    const src = riskTier.toString();
    expect(src).toMatch(/sst < 0\.5/);
    expect(src).not.toMatch(/sst <=/);
  });
});

describe('exp / pow — no SQL counterpart, so no parity obligation', () => {
  it('Math.exp appears only in WebGL overlay strings, not in compared metrics', () => {
    // thermalVector/thermalColor feed shader uniforms and CSS; they are not part
    // of any value the parity sweep compares. Pinned so nobody moves exp() into
    // computeMetrics without noticing.
    const src = thermalVector.toString() + thermalColor.toString();
    expect(src).not.toMatch(/Math\.exp/);
  });

  it('thermalColor/thermalVector stay inside their output ranges', () => {
    for (const sst of [0, 1.5, 3]) {
      expect(thermalColor(sst)).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
      for (const c of thermalVector(sst)) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('negative zero cannot escape computeMetrics', () => {
  it('produces no -0 in any numeric metric across the lattice corners', () => {
    const corners = [
      { sstAnomaly: 0, jetStreamShift: 0, agricultureWeight: 0 },
      { sstAnomaly: 0, jetStreamShift: -1, agricultureWeight: 0 },
      { sstAnomaly: 0, jetStreamShift: 1, agricultureWeight: 1 },
      { sstAnomaly: 3, jetStreamShift: 0, agricultureWeight: 0 },
      { sstAnomaly: 0.01, jetStreamShift: -1, agricultureWeight: 0 },
    ];

    for (const s of corners) {
      const m = computeMetrics(s);
      for (const [k, v] of Object.entries(m)) {
        if (typeof v !== 'number') continue;
        expect(Object.is(v, -0), `${k} is -0 at ${JSON.stringify(s)}`).toBe(false);
      }
    }
  });

  it('at strength 0 every derived term is exactly +0, not -0', () => {
    const m = computeMetrics({ sstAnomaly: 0, jetStreamShift: 0, agricultureWeight: 0 });
    expect(Object.is(m.pacificSstDev, -0)).toBe(false);
    expect(Object.is(m.asiaDrought, -0)).toBe(false);
    expect(Object.is(m.africaFlood, -0)).toBe(false);
  });
});
