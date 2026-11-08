/**
 * The display model for a Niño 1+2 or Niño 4 card, driven by the scenario slider.
 *
 * **This module is deliberately INERT.** Nothing in `src/` imports it. It exists so a
 * later step can render one of these cards without re-deriving the arithmetic, and so
 * the arithmetic can be reviewed and tested in isolation before it reaches a component.
 * Until then its only consumer is `src/lib/ninoCard.test.ts`.
 *
 * ## What it does, in one line
 *
 * Takes the slider's Niño 3.4 anomaly (always in °C), looks up the warm-subset
 * empirical relation from `src/lib/ninoRelation.ts`, and returns every string a card
 * needs — the value, its one-residual-SD band, a badge stating the fit's provenance,
 * and copy that says plainly that the number is a historical co-variation and not a
 * forecast.
 *
 * ## Why the regression is honest but weak, and why the card says so
 *
 * Both warm fits are below `WEAK_R2` (0.3): Niño 1+2 at r² 0.2886, Niño 4 at r² 0.2092.
 * That is not a defect to hide — it is the finding. Niño 4 saturates while Niño 3.4
 * climbs (1983: Niño 3.4 +2.35 against Niño 4 +0.39), and Niño 1+2 overshoots badly
 * (1997: +4.47 observed against +2.53 fitted). The mitigation is to publish the band
 * (`lo`/`hi`) and the badge (`R2`, `N`) next to the point estimate, so the card cannot be
 * read as precision it does not have. A one-decimal value with no band would imply the
 * fit is good; it is not, and the API makes the band impossible to forget.
 *
 * ## Units: a DELTA conversion, never an absolute one
 *
 * Every number here is an anomaly. °F conversion is therefore ×1.8 with **no +32
 * offset** — the trap `src/lib/regions.ts:85-89` documents at length ("Using
 * celsiusToFahrenheit() here turns a -1.91 °F anomaly into -18.8 °C, which is a
 * nonsense number on a dashboard"). This module reuses `celsiusDeltaToFahrenheit`
 * rather than `celsiusToFahrenheit` so there is exactly one delta law in the codebase.
 * `lo` and `hi` are deltas too and convert identically.
 *
 * ## Sign and glyph
 *
 * The desktop region cards format their headline through `signed` from `src/lib/format.ts`
 * (`src/lib/model.ts:22,181`), which emits an ASCII `-`. This module uses the same
 * helper, so the glyph matches the cards it will sit beside. (The *drawer* uses
 * `formatDelta` from `regions.ts:78`, which emits U+2212 MINUS SIGN — a second,
 * pre-existing convention. Following the cards here is deliberate; see
 * `docs/NINO-UI-RECON.md` A4.)
 */

import { fixed, signed } from "@/lib/format";
import { celsiusDeltaToFahrenheit } from "@/lib/regions";
import {
    pickRelation,
    projectAnomaly,
    type NinoRelationRegion,
} from "@/lib/ninoRelation";

/**
 * The r² below which a relation is reported as WEAK.
 *
 * 0.3 is the threshold step 2.2 pre-registered, applied here so the card's badge and
 * the recon report cannot disagree about which fits are weak. Both regions are below
 * it today; the constant exists so a future refit that clears the line stops saying
 * "EMPIRICAL" without anyone editing a string.
 */
export const WEAK_R2 = 0.3;

/** Display label per region. Display only — never a URL slug or a DOM id. */
const REGION_LABELS: Record<NinoRelationRegion, string> = {
    nino12: "NIÑO 1+2",
    nino4: "NIÑO 4",
};

/** Unit system the caller wants the numbers rendered in. */
export type NinoCardUnit = "C" | "F";

/** Everything a card renders. All numbers are in `unit`; the text fields are ready to print. */
export interface NinoCardModel {
    regionId: NinoRelationRegion;
    /** Human label for the region, e.g. `NIÑO 1+2`. Display only. */
    regionLabel: string;
    /** Fitted anomaly, in the requested unit. */
    value: number;
    /** Lower edge of the ±1 residual-SD band. */
    lo: number;
    /** Upper edge of the ±1 residual-SD band. */
    hi: number;
    /** `+1.5` / `-0.3` / `0.0` — one decimal, explicit plus, no unit. */
    valueText: string;
    /** `-0.7 to +1.3` — both ends signed, one decimal, no unit. */
    rangeText: string;
    /** `°C` or `°F`. */
    unitText: string;
    /** True when the slider position lies outside the warm sample's x range. */
    extrapolated: boolean;
    /** True when the relation's r² is below `WEAK_R2`. */
    weak: boolean;
    /** `EMPIRICAL · R2 0.29 · N 181` — the fit's provenance, for the card corner. */
    badgeText: string;
    /** The extrapolation warning, or `''` when the position is inside the fitted range. */
    noteText: string;
    /** One sentence: historical co-variation, not a forecast. Never empty. */
    captionText: string;
}

/** Convert an anomaly delta from °C to the requested unit. Never adds 32. */
function toUnit(celsiusDelta: number, unit: NinoCardUnit): number {
    return unit === "F" ? celsiusDeltaToFahrenheit(celsiusDelta) : celsiusDelta;
}

/**
 * Build the display model for one region at one slider position.
 *
 * `nino34Anomaly` is the slider's value in °C — the same number `ScenarioState.sstAnomaly`
 * holds (`src/lib/model.ts:24-26`: range 0..3, default 1.5). Only the OUTPUTS are
 * converted, so `extrapolated` is decided on the °C scale and cannot flip with a unit
 * toggle.
 *
 * Throws on a non-finite slider value via `projectAnomaly`, and on an unknown region via
 * `pickRelation` — both before any formatting, so a bad input can never produce a card
 * full of `NaN`.
 */
export function ninoCardModel(
    regionId: NinoRelationRegion,
    nino34Anomaly: number,
    unit: NinoCardUnit,
): NinoCardModel {
    const relation = pickRelation(regionId);
    const projection = projectAnomaly(relation, nino34Anomaly);

    const value = toUnit(projection.value, unit);
    const lo = toUnit(projection.lo, unit);
    const hi = toUnit(projection.hi, unit);

    const extrapolated = projection.extrapolated;
    const weak = relation.r2 < WEAK_R2;

    /*
     * The band is SIGNED on both ends, not absolute.
     *
     * A range like "0.7 to 1.3" would be prettier, but at the slider's low end the band
     * genuinely straddles zero (Niño 1+2 at 0.5 °C is -0.66 to +1.31), and an unsigned
     * pair there would read as "0.7 to 1.3" — a band entirely on the wrong side of zero.
     * Correctness over tidiness.
     */
    const rangeText = `${signed(lo, 1)} to ${signed(hi, 1)}`;

    const badgeText = `EMPIRICAL · R2 ${fixed(relation.r2, 2)} · N ${relation.n}`;

    const noteText = extrapolated
        ? `Beyond the observed range: the warmest Niño 3.4 anomaly in this fit is ${fixed(
              relation.xMax,
              2,
          )} °C, so a value at ${fixed(nino34Anomaly, 2)} °C is an extrapolation.`
        : "";

    const captionText =
        `Typical historical response of the ${REGION_LABELS[regionId]} index to a ` +
        `Niño 3.4 anomaly of ${fixed(nino34Anomaly, 1)} °C — a correlation from the ` +
        `observed record, not a forecast.`;

    return {
        regionId,
        regionLabel: REGION_LABELS[regionId],
        value,
        lo,
        hi,
        valueText: signed(value, 1),
        rangeText,
        unitText: unit === "F" ? "°F" : "°C",
        extrapolated,
        weak,
        badgeText,
        noteText,
        captionText,
    };
}
