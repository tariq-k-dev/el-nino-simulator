/**
 * The HUD island's text: an ENSO category and one short string. Pure.
 *
 * ## Why this does not reuse `lib/model.ts`'s `riskTier`
 *
 * The repo HAS a classification — `riskTier(sst)` at `src/lib/model.ts:105-112` — and it is deliberately not
 * the one used here. Read its bands: it is a SCENARIO-RISK label for the product's own warm-only lever, whose
 * domain is `SST_MIN = 0` to `SST_MAX = 3` with `SST_DEFAULT = 1.5` (`model.ts:24-26`). Two consequences make
 * it the wrong instrument for an island that must also describe a La Niña:
 *
 *   1. **It has no neutral band at zero and no negative branch at all.** Its lowest band is
 *      `< 0.5 -> 'Neutral / La Niña Watch'`, i.e. it folds a genuine La Niña and a dead calm into one label.
 *      The island's `formatIsland(-1.2)` has to say something true.
 *   2. **Its upper bands are El Niño marketing names**, `'Super El Niño'` from 2.0 and
 *      `'Extreme Mega-El Niño'` from 2.6. Those are the right words for the page's headline badge and the
 *      wrong words for an ENSO state readout, which the step's spec (M9) compares against this function.
 *
 * So the prompt's second branch applies: the NOAA ONI-style bands, weak from 0.5, moderate from 1.0, strong
 * from 1.5, very strong from 2.0, mirrored for negative. Changing `riskTier` instead would have changed the
 * desktop header's badge, which this step must not touch. The two functions coexist and the divergence is
 * stated here rather than left for a reader to trip over.
 */

/**
 * The band edges, in °C of anomaly, as absolute values.
 *
 * `weak` starts at 0.5 and not at 0.1 because the ONI convention requires a five-overlapping-season mean
 * and ±0.5 is the threshold below which the state is officially neutral rather than "very weak".
 */
export const WEAK_FROM = 0.5;
export const MODERATE_FROM = 1.0;
export const STRONG_FROM = 1.5;
export const VERY_STRONG_FROM = 2.0;

/** The six states, warm spelled out and cold mirrored. `neutral` is the shared middle. */
export type EnsoCategory =
  | 'neutral'
  | 'weak-el-nino'
  | 'moderate-el-nino'
  | 'strong-el-nino'
  | 'very-strong-el-nino'
  | 'weak-la-nina'
  | 'moderate-la-nina'
  | 'strong-la-nina'
  | 'very-strong-la-nina';

/** The label the island prints for each state. Uppercase, because it is a badge, not a sentence. */
const LABEL: Record<EnsoCategory, string> = {
  neutral: 'NEUTRAL',
  'weak-el-nino': 'WEAK EL NIÑO',
  'moderate-el-nino': 'MODERATE EL NIÑO',
  'strong-el-nino': 'STRONG EL NIÑO',
  'very-strong-el-nino': 'VERY STRONG EL NIÑO',
  'weak-la-nina': 'WEAK LA NIÑA',
  'moderate-la-nina': 'MODERATE LA NIÑA',
  'strong-la-nina': 'STRONG LA NIÑA',
  'very-strong-la-nina': 'VERY STRONG LA NIÑA',
};

/** The band, by magnitude, ignoring sign. */
type Band = 'neutral' | 'weak' | 'moderate' | 'strong' | 'very-strong';

/**
 * Band for an absolute anomaly.
 *
 * Written with `<` on the upper edge so each boundary belongs to the band that starts there: 0.5 is weak,
 * 1.0 is moderate, 1.5 is strong, 2.0 is very strong. A `<=` would put 0.5 in neutral and contradict the
 * word "from" in every band's definition.
 */
function bandOf(magnitude: number): Band {
  if (magnitude < WEAK_FROM) return 'neutral';
  if (magnitude < MODERATE_FROM) return 'weak';
  if (magnitude < STRONG_FROM) return 'moderate';
  if (magnitude < VERY_STRONG_FROM) return 'strong';
  return 'very-strong';
}

/**
 * The ENSO state for a signed anomaly in °C.
 *
 * `-0` is treated as `0`: `Math.sign(-0)` is `-0`, which is falsy, so the sign test catches it, but a
 * caller that has just computed `0 - 0` would otherwise be able to reach the La Niña branch with a zero
 * magnitude. The `magnitude < WEAK_FROM` early return makes that impossible regardless.
 */
export function ensoCategory(anomalyC: number): EnsoCategory {
  if (!Number.isFinite(anomalyC)) return 'neutral';
  const magnitude = Math.abs(anomalyC);
  const band = bandOf(magnitude);
  if (band === 'neutral') return 'neutral';
  const cold = anomalyC < 0;
  if (band === 'weak') return cold ? 'weak-la-nina' : 'weak-el-nino';
  if (band === 'moderate') return cold ? 'moderate-la-nina' : 'moderate-el-nino';
  if (band === 'strong') return cold ? 'strong-la-nina' : 'strong-el-nino';
  return cold ? 'very-strong-la-nina' : 'very-strong-el-nino';
}

/** The uppercase label for a state, for a badge. */
export function ensoLabel(category: EnsoCategory): string {
  return LABEL[category];
}

/**
 * The real minus sign, U+2212.
 *
 * Not a hyphen-minus: at 10-12 px in a monospace badge a hyphen is a dash, not a sign, and the string sits
 * next to a degree glyph where the difference is visible. This is the only place the character is chosen,
 * so a reader cannot get a hyphen from one call site and a minus from another.
 */
export const MINUS = '\u2212';

/**
 * One decimal place, with an explicit `+` for positive values and `MINUS` for negative ones.
 *
 * `toFixed` on `-0.04` yields `"-0.0"`, so a value that ROUNDS to zero is printed as `0.0` with no sign at
 * all — the same rule `lib/format.ts` documents for the rest of the UI, for the same reason. The test on
 * the ROUNDED magnitude rather than on the raw one is what makes `+0.0` unreachable from either side: a
 * `+0.0` badge would read as a small warming that is not there, and `+0.04` is below the precision the
 * island prints. Both directions therefore collapse to the same `0.0°C`.
 */
export function formatAnomaly(anomalyC: number): string {
  if (!Number.isFinite(anomalyC)) return `0.0°C`;
  const rounded = Math.round(Math.abs(anomalyC) * 10) / 10;
  if (rounded === 0) return '0.0°C';
  const sign = anomalyC < 0 ? MINUS : '+';
  return `${sign}${rounded.toFixed(1)}°C`;
}

/**
 * The island's whole text: `ENSO: +1.5°C | STRONG EL NIÑO`.
 *
 * Composed from `formatAnomaly` and `ensoCategory` rather than from any literal, which is what the step
 * requires: a spec compares the DOM against THIS function's output, so a hardcoded string in the component
 * would fail the moment the store moved.
 */
export function formatIsland(anomalyC: number): string {
  return `ENSO: ${formatAnomaly(anomalyC)} | ${ensoLabel(ensoCategory(anomalyC))}`;
}
