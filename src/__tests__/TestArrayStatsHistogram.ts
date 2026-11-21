// ============================================================================
// Unit tests for parseArrayStats histogram + percentile folding.
//
// Locks the client-side parse of the server's STATS|lo|hi|bins extension:
// the store stamps `stats.histogram` as a native ArrayOfLong plus
// `stats.histBins/histLo/histHi/histUnderflow/histOverflow` and p10/p50/p90
// into DataArrayMetadata.customData. No ETP/live-server round-trip is needed;
// we feed a hand-built customData map straight through parseArrayStats.
// ============================================================================

import "jest";

import { parseArrayStats } from "../lib/protocols/ArrayCustomer";

/** Minimal DataValue-shaped scalar/array builders matching the ETP union. */
const dvBool = (v: boolean): any => ({ item: { _boolean: v } });
const dvLong = (v: number): any => ({ item: { _long: BigInt(v) } });
const dvDouble = (v: number): any => ({ item: { _double: v } });
const dvLongArray = (vs: number[]): any => ({
    item: { _ArrayOfLong: { values: vs.map(v => BigInt(v)) } }
});

/** Build a customData map mirroring what the store emits for a histogram reply. */
function histCustomData(): Map<string, any> {
    const cd = new Map<string, any>();
    // Summary (sample {2,4,4,4,5,5,7,9}: n=8, min2 max9 mean5 stddev2 sum40).
    cd.set("stats.valid", dvBool(true));
    cd.set("stats.count", dvLong(8));
    cd.set("stats.nullCount", dvLong(0));
    cd.set("stats.min", dvDouble(2));
    cd.set("stats.max", dvDouble(9));
    cd.set("stats.mean", dvDouble(5));
    cd.set("stats.stddev", dvDouble(2));
    cd.set("stats.sum", dvDouble(40));
    // In-range + histogram domain [0,10], 10 unit-width bins.
    cd.set("stats.inRangeCount", dvLong(8));
    cd.set("stats.rangeLo", dvDouble(0));
    cd.set("stats.rangeHi", dvDouble(10));
    cd.set("stats.histogram", dvLongArray([0, 0, 1, 0, 3, 2, 0, 1, 0, 1]));
    cd.set("stats.histBins", dvLong(10));
    cd.set("stats.histLo", dvDouble(0));
    cd.set("stats.histHi", dvDouble(10));
    cd.set("stats.histUnderflow", dvLong(0));
    cd.set("stats.histOverflow", dvLong(0));
    cd.set("stats.p10", dvDouble(2.5));
    cd.set("stats.p50", dvDouble(5));
    cd.set("stats.p90", dvDouble(9));
    cd.set("compute.schema", dvLong(1));
    return cd;
}

describe("parseArrayStats histogram + percentiles", () => {
    it("parses the histogram as a number[] and the percentiles", () => {
        const s = parseArrayStats({ customData: histCustomData() } as any);
        expect(s).not.toBeNull();
        expect(s!.valid).toBe(true);
        expect(s!.count).toBe(8);
        // Histogram bins coerced from int64 -> number[].
        expect(s!.histogram).toEqual([0, 0, 1, 0, 3, 2, 0, 1, 0, 1]);
        expect(s!.histBins).toBe(10);
        expect(s!.histLo).toBe(0);
        expect(s!.histHi).toBe(10);
        expect(s!.histUnderflow).toBe(0);
        expect(s!.histOverflow).toBe(0);
        expect(s!.p10).toBe(2.5);
        expect(s!.p50).toBe(5);
        expect(s!.p90).toBe(9);
        // The bin counts sum to the finite value count.
        expect(s!.histogram!.reduce((a, b) => a + b, 0)).toBe(8);
        // Compute wire-contract version is surfaced to callers.
        expect(s!.schema).toBe(1);
    });

    it("reports under/overflow tails when the domain is narrower than the data", () => {
        const cd = new Map<string, any>();
        cd.set("stats.valid", dvBool(true));
        cd.set("stats.count", dvLong(8));
        cd.set("stats.nullCount", dvLong(0));
        cd.set("stats.min", dvDouble(2));
        cd.set("stats.max", dvDouble(9));
        cd.set("stats.histogram", dvLongArray([3, 2])); // domain [4,6]
        cd.set("stats.histLo", dvDouble(4));
        cd.set("stats.histHi", dvDouble(6));
        cd.set("stats.histUnderflow", dvLong(1)); // {2}
        cd.set("stats.histOverflow", dvLong(2)); // {7,9}
        const s = parseArrayStats({ customData: cd } as any);
        expect(s!.histogram).toEqual([3, 2]);
        expect(s!.histUnderflow).toBe(1);
        expect(s!.histOverflow).toBe(2);
        // bins + tails == finite count.
        const total =
            s!.histogram!.reduce((a, b) => a + b, 0) +
            (s!.histUnderflow ?? 0) +
            (s!.histOverflow ?? 0);
        expect(total).toBe(8);
    });

    it("omits histogram fields when the server returned a plain summary", () => {
        const cd = new Map<string, any>();
        cd.set("stats.valid", dvBool(true));
        cd.set("stats.count", dvLong(8));
        cd.set("stats.nullCount", dvLong(0));
        cd.set("stats.min", dvDouble(2));
        cd.set("stats.max", dvDouble(9));
        const s = parseArrayStats({ customData: cd } as any);
        expect(s!.histogram).toBeUndefined();
        expect(s!.p50).toBeUndefined();
        // An older server that predates versioning leaves schema undefined.
        expect(s!.schema).toBeUndefined();
    });

    it("returns null when the store produced no stats at all", () => {
        expect(parseArrayStats({ customData: new Map() } as any)).toBeNull();
        expect(parseArrayStats(null)).toBeNull();
    });
});
