/**
 * Display formatting.
 *
 * This is the ONLY place negative zero is normalised, and deliberately so:
 * parity with DuckDB must be preserved at the numeric layer (Object.is
 * distinguishes -0 from 0, and the parity sweep compares with it), while the UI
 * must never show "-0.0", "-0%", "-0°C".
 *
 * Where -0 comes from: `(-10 - 0 * 22) - 1 * 9` is -9, but `Math.sign(-0) *
 * Math.round(0)` and `-0.4 * 0` both yield -0, and `(-0).toFixed(1)` prints
 * "-0.0". At strength 0 several terms are exactly zero, so this is reachable
 * simply by dragging the ENSO slider to its minimum.
 *
 * Nothing here changes a value that feeds a comparison or a query — only the
 * string the user reads.
 */

/**
 * `value.toFixed(digits)` with -0 normalised to 0 first.
 *
 * Use this instead of `toFixed` anywhere the result is rendered. Every call site
 * in components/ and report.ts goes through it.
 */
export function fixed(value: number, digits: number): string {
    // Two distinct cases, and the second is the subtle one:
    //
    //  1. `value` IS -0            -> `value === 0` is true, so normalise first.
    //  2. `value` is a small negative that ROUNDS to -0 at `digits`
    //     (e.g. -0.001 at 2dp)     -> toFixed produces "-0.00" because the sign is
    //                                 decided before rounding.
    //
    // Checking `value === 0` alone misses case 2, which is exactly what the UI hits
    // when a metric is a hair below zero.
    if (value === 0) return (0).toFixed(digits);

    const out = value.toFixed(digits);
    // If the formatted string is a negative zero, re-render it as positive zero.
    return /^-0(\.0+)?$/.test(out) ? (0).toFixed(digits) : out;
}

/**
 * Signed percentage/point formatting: "+1.5" / "-1.5" / "0.0".
 *
 * Zero prints without a sign. The previous pattern `v >= 0 ? '+' + v : v` printed
 * "+0.0" for +0 and then "-0.0" for -0, so both edges were wrong.
 */
export function signed(value: number, digits: number, unit = ""): string {
    // Round FIRST, at the target precision, then decide the sign.
    //
    // Order matters: taking Math.abs() before rounding turns -0.001 into 0.001,
    // which formats as "0.0" and then gets a "-" prefixed -> "-0.0". Checking the
    // rounded magnitude for zero instead means a value that disappears at this
    // precision prints as a plain zero.
    if (value === 0) return `${fixed(0, digits)}${unit}`;

    const body = fixed(Math.abs(value), digits);
    const isZeroAtPrecision = /^0(\.0*)?$/.test(body);
    if (isZeroAtPrecision) return `${body}${unit}`;

    return `${value > 0 ? "+" : "-"}${body}${unit}`;
}

/**
 * A magnitude that is always positive, with a forced trailing sign only when
 * non-zero. Used for "Monsoon Deficit" style labels where the direction is
 * carried by the label text.
 */
export function magnitude(value: number, digits: number, unit = ""): string {
    return `${fixed(Math.abs(value), digits)}${unit}`;
}

/** Percent from a 0..1 ratio, rounded to `digits`. */
export function percent(ratio: number, digits = 0): string {
    return `${fixed(ratio * 100, digits)}%`;
}

/** True when a rendered string would show a negative zero. Used by tests. */
export function hasNegativeZero(text: string): boolean {
    // A negative zero is "-0" followed by nothing, a decimal point and only zeros,
    // or a non-digit. "-0.01" is a real negative and must NOT match, so the
    // decimal branch requires the fractional part to be all zeros.
    // "-0" followed by a fractional part containing ONLY zeros, or by a non-digit.
    // The lookahead is what makes "-0.01" (a real negative) not match: after the
    // optional `.0*` the next character must not be a digit or a dot.
    return /(^|[^\d.])-0(\.0*)?(?![.\d])/.test(text);
}
