/**
 * Empirical relation of the Niño 1+2 and Niño 4 SST anomalies to the Niño 3.4
 * anomaly, fitted from the shipped CPC record.
 *
 * **This module is deliberately INERT.** Nothing in `src/` imports it. It exists so
 * a later step can drive a Niño 1+2 or Niño 4 card value from the same scenario
 * slider that already drives the Equatorial Pacific card, without that step having
 * to re-derive the statistics. Until then the only consumer is
 * `src/lib/ninoRelation.test.ts`.
 *
 * Why a fitted relation at all: the dataset carries one observed index per region
 * per month (`nino12_anomaly`, `nino4_anomaly`, `nino_34_anomaly` — see
 * `src/lib/data/parse.ts` and `src/lib/duckdb.ts:85-111`), but the scenario slider
 * only produces a Niño 3.4-flavoured SST anomaly. To show what an independent
 * region index WOULD read at a hypothetical slider position, the honest move is a
 * least-squares line through the observed pairs — not a hand-picked coefficient —
 * and to publish the residual spread alongside it so a card can show a band rather
 * than a false-precision point.
 *
 * What this is NOT: a physical model. Niño 1+2 (coastal Peru/Ecuador) and Niño 4
 * (western equatorial Pacific) respond to Niño 3.4 through the Walker circulation
 * with different lags and different physics. A single contemporaneous linear fit
 * captures the co-variation and nothing more; the R² values in `NINO_RELATIONS`
 * say plainly how much of the variance it does not capture.
 *
 * Regenerate the constants by running `_triage/nino-relations.mjs` (in the Handshake
 * triage directory, outside this repo). `ninoRelation.test.ts` re-derives every
 * number from `public/data/enso.csv` on each test run and fails if they drift.
 */

/** The two regions this module covers. Niño 3.4 is the regressor, not a target. */
export type NinoRelationRegion = 'nino12' | 'nino4';

/** Which months a fit was computed over. */
export type NinoSubset = 'all' | 'warm';

/**
 * One fitted relation, as stored. Every field is a measured quantity from the
 * shipped record — none is tuned.
 */
export interface NinoRelation {
  regionId: NinoRelationRegion;
  subset: NinoSubset;
  /** Valid pairs used in the fit, after dropping non-finite values. */
  n: number;
  /** Degrees of anomaly per degree of Niño 3.4 anomaly. */
  slope: number;
  /** Fitted region anomaly at a Niño 3.4 anomaly of 0. */
  intercept: number;
  /** Coefficient of determination — the honest measure of how well a line fits. */
  r2: number;
  /** Residual standard deviation, denominator n - 2. The ± half-width of the band. */
  residSd: number;
  /** Smallest Niño 3.4 anomaly in the fitted sample. */
  xMin: number;
  /** Largest Niño 3.4 anomaly in the fitted sample. */
  xMax: number;
}

/** Raw output of `fitLinear`. */
export interface LinearFit {
  n: number;
  meanX: number;
  meanY: number;
  slope: number;
  intercept: number;
  r2: number;
  residSd: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** A region anomaly projected from a hypothetical Niño 3.4 anomaly. */
export interface NinoProjection {
  /** slope * x + intercept. */
  value: number;
  /** value - residSd. Never below -Infinity; the physical floor is not modelled. */
  lo: number;
  /** value + residSd. */
  hi: number;
  /**
   * True when the input lies outside the fitted sample's x range. A caller should
   * render a different treatment (or refuse) rather than implying observation:
   * the slider tops out ABOVE the warm sample's largest Niño 3.4 anomaly, so the
   * top of the slider is always an extrapolation.
   */
  extrapolated: boolean;
}

/**
 * Minimum pairs a fit will accept.
 *
 * Not arbitrary: below ~30 the standard error of a slope is so wide that a
 * projected value is a restatement of noise. The warm subset has 181 months and the
 * full record 918, so the shipped fits clear this comfortably — the floor exists to
 * stop a future caller fitting a handful of months and presenting it as a relation.
 */
export const MIN_FIT_PAIRS = 30;

/**
 * The warm-subset split: months with a Niño 3.4 anomaly of at least +0.5 °C.
 *
 * +0.5 is the conventional El Niño threshold and the same cutoff the app already
 * uses for its risk tiers (`src/lib/model.ts:105-112`, `src/lib/duckdb.ts:329-340`:
 * below 0.5 is "Neutral / La Niña Watch"). Using the app's own boundary rather than
 * a fresh one keeps the subset and the tier ladder describing the same population.
 */
export const WARM_THRESHOLD = 0.5;

/**
 * Two-pass ordinary least squares.
 *
 * Two passes, not one: the means are computed first, then the centred sums of
 * squares. The single-pass form (`sum(xy) - sum(x)sum(y)/n`) subtracts two large,
 * nearly equal quantities and loses precision exactly where it matters. Broad
 * recommendation with no exception: keep it two-pass.
 *
 * Pairs are dropped individually — a non-finite `x` OR a non-finite `y` removes the
 * pair, because a fit needs both. The count of dropped pairs is not reported here
 * (the caller can compare `xs.length` with the returned `n`); the shipped data has
 * none, since `parseDataset` already rejects a non-finite cell outright.
 *
 * Throws rather than returning a degenerate fit: fewer than `MIN_FIT_PAIRS` valid
 * pairs, or zero variance in `x` (a vertical line has no finite slope, and any
 * returned number would be a division artefact).
 */
export function fitLinear(xs: readonly number[], ys: readonly number[]): LinearFit {
  if (xs.length !== ys.length) {
    throw new Error(
      `fitLinear: xs and ys must be the same length (got ${xs.length} and ${ys.length}).`,
    );
  }

  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      px.push(xs[i]);
      py.push(ys[i]);
    }
  }

  const n = px.length;
  if (n < MIN_FIT_PAIRS) {
    throw new Error(
      `fitLinear: only ${n} finite pairs; at least ${MIN_FIT_PAIRS} are required for a fit ` +
        `whose slope and residual spread mean anything.`,
    );
  }

  // Pass 1 — means.
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += px[i];
    sumY += py[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  // Pass 2 — centred sums, the only ones that are numerically safe to subtract.
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = px[i] - meanX;
    const dy = py[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  if (sxx === 0) {
    throw new Error(
      `fitLinear: x has zero variance over ${n} pairs, so the slope is undefined ` +
        `(every x is ${meanX}).`,
    );
  }

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  // ssRes = syy - slope * sxy follows from the normal equations and needs no third
  // pass. Clamped at 0: with exact arithmetic it cannot be negative, but a
  // floating-point cancellation on a near-perfect fit can produce -1e-17, and
  // Math.sqrt of that is NaN.
  const ssRes = Math.max(0, syy - slope * sxy);
  const r2 = syy === 0 ? 1 : 1 - ssRes / syy;
  const residSd = Math.sqrt(ssRes / (n - 2));

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < n; i += 1) {
    if (px[i] < xMin) xMin = px[i];
    if (px[i] > xMax) xMax = px[i];
    if (py[i] < yMin) yMin = py[i];
    if (py[i] > yMax) yMax = py[i];
  }

  return { n, meanX, meanY, slope, intercept, r2, residSd, xMin, xMax, yMin, yMax };
}

/**
 * Project a hypothetical Niño 3.4 anomaly onto a fitted region anomaly.
 *
 * `extrapolated` is a comparison against the FITTED SAMPLE, not against the whole
 * record: the warm subset starts at `WARM_THRESHOLD` by construction, so an x of
 * 0.4 is "extrapolated" for the warm relation even though months that cold exist in
 * the dataset. That is the correct meaning — the line was not fitted there.
 */
export function projectAnomaly(relation: NinoRelation, nino34Anomaly: number): NinoProjection {
  if (!Number.isFinite(nino34Anomaly)) {
    throw new Error(`projectAnomaly: nino34Anomaly must be finite, got ${nino34Anomaly}.`);
  }
  const value = relation.slope * nino34Anomaly + relation.intercept;
  return {
    value,
    lo: value - relation.residSd,
    hi: value + relation.residSd,
    extrapolated: nino34Anomaly < relation.xMin || nino34Anomaly > relation.xMax,
  };
}

/**
 * The shipped fits, pasted verbatim from `_triage/nino-relations.mjs` at full
 * double precision.
 *
 * Read the R² column before using any of these:
 *
 *   nino12 / all   0.4714   the whole record, both phases
 *   nino12 / warm  0.2886   warm months only — most of the variance is unexplained
 *   nino4  / all   0.7869   the strongest of the four
 *   nino4  / warm  0.2092   weak: Niño 4 saturates while Niño 3.4 keeps climbing
 *
 * Both warm fits are below the 0.3 threshold this step pre-registered as "weak", so
 * a card built on them should show the ±residSd band and should say the value is an
 * estimate. `residSd` for nino12/warm is 0.98 °C — as large as the signal at mild
 * slider positions.
 */
export const NINO_RELATIONS: readonly NinoRelation[] = [
  {
    regionId: 'nino12',
    subset: 'all',
    n: 918,
    slope: 0.8699175326090761,
    intercept: -0.08815224776137148,
    r2: 0.4713525385193774,
    residSd: 0.803653628693984,
    xMin: -2.45,
    xMax: 2.72,
  },
  {
    regionId: 'nino12',
    subset: 'warm',
    n: 181,
    slope: 1.155607599959169,
    intercept: -0.25204338136877236,
    r2: 0.2885724419372131,
    residSd: 0.9824540884715575,
    xMin: 0.5,
    xMax: 2.72,
  },
  {
    regionId: 'nino4',
    subset: 'all',
    n: 918,
    slope: 0.7021634581282746,
    intercept: -0.11978286363133442,
    r2: 0.7868732070014388,
    residSd: 0.3187759480922505,
    xMin: -2.45,
    xMax: 2.72,
  },
  {
    regionId: 'nino4',
    subset: 'warm',
    n: 181,
    slope: 0.32437059345513547,
    intercept: 0.20741137766178214,
    r2: 0.20922651873081777,
    residSd: 0.3414468569834548,
    xMin: 0.5,
    xMax: 2.72,
  },
];

/**
 * THE RULE: the scenario slider is warm-only, so always take the warm subset.
 *
 * `SST_MIN = 0` (`src/lib/model.ts:24`) means the slider cannot express a La Niña
 * month, and its range is 0..3 with a default of 1.5 (`SST_DEFAULT`,
 * `src/lib/model.ts:26`). Every position it can produce is at or above
 * `WARM_THRESHOLD`, so the warm-subset relation is the only one whose sample
 * overlaps the domain the slider actually visits — the `all` fits are kept for
 * reference and for a future cold-state feature, not for this card.
 *
 * Caveat a caller must handle: the slider's maximum (3.0) is ABOVE the warm sample's
 * `xMax` (2.72), so `projectAnomaly(...).extrapolated` is true over the top ~9 % of
 * the slider. That is a real extrapolation, not a rounding artefact.
 */
export function pickRelation(regionId: NinoRelationRegion): NinoRelation {
  const relation = NINO_RELATIONS.find((r) => r.regionId === regionId && r.subset === 'warm');
  if (!relation) {
    throw new Error(`pickRelation: no warm-subset relation for region "${regionId}".`);
  }
  return relation;
}
