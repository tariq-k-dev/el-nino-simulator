import { describe, expect, it } from "vitest";
import {
    decideBootPolicy,
    LOW_MEMORY_GB,
    SLOW_DOWNLINK_MBPS,
} from "@/lib/engine/policy";

/**
 * Table-driven coverage of every branch in decideBootPolicy.
 *
 * The point of injecting the signals is that this table can be exhaustive and
 * read like the specification, with no global stubbing.
 */
describe("decideBootPolicy", () => {
    const cases: Array<{
        name: string;
        signals: Parameters<typeof decideBootPolicy>[0];
        expected: "eager" | "idle" | "on-demand";
    }> = [
        // --- data saver wins over everything -------------------------------------
        {
            name: "saveData on, fast everything else",
            signals: {
                connection: {
                    saveData: true,
                    effectiveType: "4g",
                    downlink: 10,
                },
                coarse: false,
            },
            expected: "on-demand",
        },
        {
            name: "saveData on even with a huge device",
            signals: { connection: { saveData: true }, deviceMemory: 16 },
            expected: "on-demand",
        },

        // --- effectiveType -------------------------------------------------------
        {
            name: "2g is on-demand",
            signals: { connection: { effectiveType: "2g", downlink: 10 } },
            expected: "on-demand",
        },
        {
            name: "3g is on-demand",
            signals: { connection: { effectiveType: "3g", downlink: 10 } },
            expected: "on-demand",
        },
        {
            name: "slow-2g is on-demand",
            signals: { connection: { effectiveType: "slow-2g" } },
            expected: "on-demand",
        },
        {
            name: "4g with fine pointer is eager",
            signals: {
                connection: { effectiveType: "4g", downlink: 10 },
                coarse: false,
            },
            expected: "eager",
        },

        // --- downlink ------------------------------------------------------------
        {
            name: "downlink 1.0 Mbps is on-demand",
            signals: { connection: { downlink: 1.0 } },
            expected: "on-demand",
        },
        {
            name: "downlink exactly at the threshold is not treated as slow",
            signals: { connection: { downlink: SLOW_DOWNLINK_MBPS } },
            expected: "eager",
        },
        {
            name: "downlink 0 means unknown, not slow",
            signals: { connection: { downlink: 0 } },
            expected: "eager",
        },

        // --- device memory -------------------------------------------------------
        {
            name: "deviceMemory 2 GB is on-demand",
            signals: { connection: { effectiveType: "4g" }, deviceMemory: 2 },
            expected: "on-demand",
        },
        {
            name: "deviceMemory just above the threshold stays eager",
            signals: { deviceMemory: LOW_MEMORY_GB + 1 },
            expected: "eager",
        },

        // --- pointer type --------------------------------------------------------
        {
            name: "coarse pointer on a fast connection is idle",
            signals: {
                connection: { effectiveType: "4g", downlink: 10 },
                coarse: true,
            },
            expected: "idle",
        },
        {
            name: "coarse pointer but slow network is still on-demand",
            signals: { connection: { effectiveType: "3g" }, coarse: true },
            expected: "on-demand",
        },

        // --- Safari / Firefox: no Network Information API ------------------------
        {
            name: "undefined connection (Safari) with fine pointer is eager",
            signals: { connection: undefined, coarse: false },
            expected: "eager",
        },
        {
            name: "undefined connection and undefined pointer is eager",
            signals: {},
            expected: "eager",
        },
        {
            name: "undefined connection with coarse pointer is idle",
            signals: { coarse: true },
            expected: "idle",
        },
        {
            name: "undefined connection but low memory is on-demand",
            signals: { deviceMemory: 2, coarse: false },
            expected: "on-demand",
        },

        // --- no-argument call ----------------------------------------------------
        {
            name: "no arguments at all",
            signals: undefined,
            expected: "eager",
        },
    ];

    for (const c of cases) {
        it(c.name, () => {
            expect(decideBootPolicy(c.signals)).toBe(c.expected);
        });
    }

    it("is a pure function — same input, same output", () => {
        const signals = {
            connection: { effectiveType: "4g", downlink: 5 },
            coarse: true,
        };
        expect(decideBootPolicy(signals)).toBe(decideBootPolicy(signals));
    });

    it("never returns a value outside the union", () => {
        const inputs: Parameters<typeof decideBootPolicy>[0][] = [
            {},
            { connection: { saveData: true } },
            { connection: { effectiveType: "2g" } },
            { connection: { downlink: 0.5 } },
            { deviceMemory: 1 },
            { coarse: true },
            { coarse: false },
        ];
        for (const input of inputs) {
            expect(["eager", "idle", "on-demand"]).toContain(
                decideBootPolicy(input),
            );
        }
    });
});
