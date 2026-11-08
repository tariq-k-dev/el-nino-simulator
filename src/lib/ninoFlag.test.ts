/**
 * The `?nino=1` flag predicate.
 *
 * The table below is the whole contract: exactly `nino=1` is ON and every other spelling is
 * OFF. The negative cases are the ones that matter — `?nino=0` and `?nino=` are how a reader
 * would try to switch the cards off, and a presence-style `.has()` implementation would turn
 * both of those into ON.
 */
import { describe, expect, it } from "vitest";

import {
    NINO_FLAG_KEY,
    NINO_FLAG_VALUE,
    isNinoUiEnabled,
} from "@/lib/ninoFlag";

describe("isNinoUiEnabled", () => {
    it("is false for an empty search string", () => {
        expect(isNinoUiEnabled("")).toBe(false);
    });

    it("is true for ?nino=1", () => {
        expect(isNinoUiEnabled("?nino=1")).toBe(true);
    });

    it("is true without the leading question mark", () => {
        expect(isNinoUiEnabled("nino=1")).toBe(true);
    });

    it.each([
        ["?nino=0", "zero is the explicit off"],
        ["?nino=", "empty value"],
        ["?nino", "bare key, presence is not enough"],
        ["?nino=true", "a boolean word"],
        ["?nino=yes", "a yes"],
        ["?nino=11", "1 plus a digit is not 1"],
        ["?NINO=1", "keys are case sensitive"],
        ["?nino_=1", "a different key"],
        ["?nino=1x", "suffixed"],
    ])("is false for %s (%s)", (search) => {
        expect(isNinoUiEnabled(search)).toBe(false);
    });

    it("is true when nino=1 sits among other parameters", () => {
        expect(isNinoUiEnabled("?dbg=1&nino=1")).toBe(true);
    });

    it("is false when nino=1 is absent but other parameters are present", () => {
        expect(isNinoUiEnabled("?dbg=1&framing=live")).toBe(false);
    });

    it("ignores a nino parameter that carries the off value while another carries on", () => {
        // `URLSearchParams.get` returns the FIRST occurrence; `?nino=0&nino=1` is therefore OFF.
        // Documented rather than desired: the flag is a development affordance, not an API.
        expect(isNinoUiEnabled("?nino=0&nino=1")).toBe(false);
    });

    it("exposes the key and value the mount reads", () => {
        expect(NINO_FLAG_KEY).toBe("nino");
        expect(NINO_FLAG_VALUE).toBe("1");
    });

    it("agrees with URLSearchParams on a hand-built string", () => {
        const params = new URLSearchParams();
        params.set(NINO_FLAG_KEY, NINO_FLAG_VALUE);
        expect(isNinoUiEnabled(params.toString())).toBe(true);
    });
});
