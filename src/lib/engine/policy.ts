/**
 * Boot policy — decides whether to load DuckDB on first paint, after idle, or
 * only when the user asks.
 *
 * Why gate at all: the wasm is 6.45 MiB on the wire (34 MB decoded). On a 2G/3G
 * link or a 2 GB device that transfer is minutes, and it competes with the
 * first paint of the globe itself. The app is fully usable on the pure-TS model
 * (src/lib/model.ts produces identical numbers), so paying that cost eagerly on
 * a constrained connection is a net loss for the user.
 *
 * Every input is injected rather than read from globals. That keeps this a pure
 * function of its arguments, so the decision table is directly testable without
 * stubbing `navigator`.
 */

export type BootPolicy = "eager" | "idle" | "on-demand";

/** The subset of `NetworkInformation` this decision needs. */
export interface ConnectionLike {
    saveData?: boolean;
    effectiveType?: string;
    downlink?: number;
}

export interface DeviceSignals {
    connection?: ConnectionLike;
    /** `navigator.deviceMemory` in GB. Undefined on Safari and Firefox. */
    deviceMemory?: number;
    /** True for a coarse pointer (touch-only device). */
    coarse?: boolean;
}

/** Network types where a 6.45 MiB fetch is not worth blocking first paint on. */
const SLOW_EFFECTIVE_TYPES = new Set(["slow-2g", "2g", "3g"]);

/** Below this downlink (Mbps) treat the connection as constrained. */
export const SLOW_DOWNLINK_MBPS = 1.5;

/** At or below this much RAM (GB) assume a low-end device. */
export const LOW_MEMORY_GB = 2;

/**
 * Choose how the engine should boot.
 *
 * Rules, in priority order:
 *   1. `saveData` on                      -> on-demand (the user asked to save data)
 *   2. slow-2g / 2g / 3g                  -> on-demand
 *   3. downlink < 1.5 Mbps                -> on-demand
 *   4. deviceMemory <= 2 GB               -> on-demand
 *   5. coarse pointer (touch)             -> idle  (boot once the page is quiet)
 *   6. otherwise                          -> eager
 *
 * `deviceMemory` and `downlink` being undefined is treated as "no evidence of a
 * constraint" rather than "constrained", because Safari/Firefox omit them. That
 * means those browsers boot eagerly unless saveData/effectiveType says otherwise
 * — which is the right default for the majority of users.
 */
export function decideBootPolicy({
    connection,
    deviceMemory,
    coarse,
}: DeviceSignals = {}): BootPolicy {
    if (connection?.saveData === true) return "on-demand";

    const effectiveType = connection?.effectiveType;
    if (effectiveType && SLOW_EFFECTIVE_TYPES.has(effectiveType))
        return "on-demand";

    // `downlink` is Mbps and 0 means "unknown" in some Chrome versions, so only a
    // positive value below the threshold is treated as a constraint.
    const downlink = connection?.downlink;
    if (
        typeof downlink === "number" &&
        downlink > 0 &&
        downlink < SLOW_DOWNLINK_MBPS
    ) {
        return "on-demand";
    }

    if (
        typeof deviceMemory === "number" &&
        deviceMemory > 0 &&
        deviceMemory <= LOW_MEMORY_GB
    ) {
        return "on-demand";
    }

    if (coarse === true) return "idle";

    return "eager";
}
