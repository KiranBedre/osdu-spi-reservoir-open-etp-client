// ============================================================================
// Unit tests for the multi-array masked predicate (WHEREN) client parse, plus
// a regression guard that the single-array WHERE parse is unchanged.
//
// The store evaluates one `[lo, hi]` predicate per property, ANDs the per-array
// masks over the shared grid, and stamps the surviving cells' count, inclusive
// ijk bounding box and ijk centroid into DataArrayMetadata.customData under the
// SAME `where.*` keys as single-array where, with an extra `where.arrays` count.
// No ETP/live-server round-trip is needed; we feed a hand-built customData map
// straight through the parsers.
// ============================================================================

import "jest";

import {
    multiWhereCid,
    parseArrayMultiWhere,
    parseArrayWhere
} from "../lib/protocols/ArrayCustomer";

/** Minimal DataValue-shaped scalar builders matching the ETP union. */
const dvBool = (v: boolean): any => ({ item: { _boolean: v } });
const dvLong = (v: number): any => ({ item: { _long: BigInt(v) } });
const dvDouble = (v: number): any => ({ item: { _double: v } });

/**
 * customData for a valid two-array AND: 840 surviving cells, bbox i[12,54]
 * j[8,61] k[3,7], centroid (33.4, 34.1, 5.2).
 */
function multiWhereValid(): Map<string, any> {
    const cd = new Map<string, any>();
    cd.set("where.valid", dvBool(true));
    cd.set("where.arrays", dvLong(2));
    cd.set("where.count", dvLong(840));
    cd.set("where.iMin", dvLong(12));
    cd.set("where.iMax", dvLong(54));
    cd.set("where.jMin", dvLong(8));
    cd.set("where.jMax", dvLong(61));
    cd.set("where.kMin", dvLong(3));
    cd.set("where.kMax", dvLong(7));
    cd.set("where.ci", dvDouble(33.4));
    cd.set("where.cj", dvDouble(34.1));
    cd.set("where.ck", dvDouble(5.2));
    // Largest connected body: 512 of the 840 cells form one contiguous volume,
    // the passing set splits into 3 bodies, body centroid (31.0, 33.0, 5.0).
    cd.set("where.components", dvLong(3));
    cd.set("where.bodyCount", dvLong(512));
    cd.set("where.biMin", dvLong(20));
    cd.set("where.biMax", dvLong(51));
    cd.set("where.bjMin", dvLong(10));
    cd.set("where.bjMax", dvLong(57));
    cd.set("where.bkMin", dvLong(4));
    cd.set("where.bkMax", dvLong(6));
    cd.set("where.bci", dvDouble(31.0));
    cd.set("where.bcj", dvDouble(33.0));
    cd.set("where.bck", dvDouble(5.0));
    return cd;
}

describe("parseArrayMultiWhere", () => {
    it("parses a valid AND result: count, arrays, ijk bbox and centroid", () => {
        const r = parseArrayMultiWhere({ customData: multiWhereValid() } as any);
        expect(r).not.toBeNull();
        expect(r!.valid).toBe(true);
        expect(r!.arrays).toBe(2);
        expect(r!.count).toBe(840);
        expect(r!.iMin).toBe(12);
        expect(r!.iMax).toBe(54);
        expect(r!.jMin).toBe(8);
        expect(r!.jMax).toBe(61);
        expect(r!.kMin).toBe(3);
        expect(r!.kMax).toBe(7);
        expect(r!.ci).toBeCloseTo(33.4, 9);
        expect(r!.cj).toBeCloseTo(34.1, 9);
        expect(r!.ck).toBeCloseTo(5.2, 9);
    });

    it("parses the largest connected body: components, bodyCount, body bbox and aim point", () => {
        const r = parseArrayMultiWhere({ customData: multiWhereValid() } as any);
        expect(r).not.toBeNull();
        expect(r!.components).toBe(3);
        expect(r!.bodyCount).toBe(512);
        // the drillable body is a strict subset of the fragmented passing set
        expect(r!.bodyCount!).toBeLessThan(r!.count);
        expect(r!.biMin).toBe(20);
        expect(r!.biMax).toBe(51);
        expect(r!.bkMin).toBe(4);
        expect(r!.bkMax).toBe(6);
        expect(r!.bci).toBeCloseTo(31.0, 9);
        expect(r!.bcj).toBeCloseTo(33.0, 9);
        expect(r!.bck).toBeCloseTo(5.0, 9);
    });

    it("treats an empty AND (no cell satisfied every predicate) as invalid with no bbox", () => {
        const cd = new Map<string, any>();
        cd.set("where.valid", dvBool(false));
        cd.set("where.arrays", dvLong(3));
        cd.set("where.count", dvLong(0));
        // The store omits bbox/centroid keys when nothing matched.
        const r = parseArrayMultiWhere({ customData: cd } as any);
        expect(r).not.toBeNull();
        expect(r!.valid).toBe(false);
        expect(r!.arrays).toBe(3);
        expect(r!.count).toBe(0);
        expect(r!.iMin).toBeUndefined();
        expect(r!.iMax).toBeUndefined();
        expect(r!.kMax).toBeUndefined();
        expect(r!.ci).toBeUndefined();
        expect(r!.ck).toBeUndefined();
        expect(r!.components).toBeUndefined();
        expect(r!.bodyCount).toBeUndefined();
        expect(r!.bck).toBeUndefined();
    });

    it("defaults arrays to 0 when the store omits where.arrays (single predicate echo)", () => {
        const cd = new Map<string, any>();
        cd.set("where.valid", dvBool(true));
        cd.set("where.count", dvLong(4));
        cd.set("where.iMin", dvLong(0));
        cd.set("where.iMax", dvLong(1));
        cd.set("where.jMin", dvLong(0));
        cd.set("where.jMax", dvLong(1));
        cd.set("where.kMin", dvLong(2));
        cd.set("where.kMax", dvLong(2));
        cd.set("where.ci", dvDouble(0.5));
        cd.set("where.cj", dvDouble(0.5));
        cd.set("where.ck", dvDouble(2));
        const r = parseArrayMultiWhere({ customData: cd } as any);
        expect(r).not.toBeNull();
        expect(r!.valid).toBe(true);
        expect(r!.arrays).toBe(0);
        expect(r!.count).toBe(4);
        expect(r!.ck).toBe(2);
    });

    it("returns null when the store never produced a where result (older server)", () => {
        expect(parseArrayMultiWhere({ customData: new Map() } as any)).toBeNull();
        expect(parseArrayMultiWhere({} as any)).toBeNull();
        expect(parseArrayMultiWhere(null)).toBeNull();
        expect(parseArrayMultiWhere(undefined)).toBeNull();
    });

    it("coerces int64 ijk bbox values from bigint", () => {
        const cd = new Map<string, any>();
        cd.set("where.valid", dvBool(true));
        cd.set("where.arrays", dvLong(2));
        cd.set("where.count", dvLong(1));
        cd.set("where.iMin", dvLong(7));
        cd.set("where.iMax", dvLong(7));
        cd.set("where.jMin", dvLong(3));
        cd.set("where.jMax", dvLong(3));
        cd.set("where.kMin", dvLong(5));
        cd.set("where.kMax", dvLong(5));
        cd.set("where.ci", dvDouble(7));
        cd.set("where.cj", dvDouble(3));
        cd.set("where.ck", dvDouble(5));
        const r = parseArrayMultiWhere({ customData: cd } as any)!;
        expect(typeof r.iMin).toBe("number");
        expect(r.iMin).toBe(7);
        expect(r.kMin).toBe(5);
    });
});

describe("parseArrayWhere regression (single-array WHERE unchanged)", () => {
    it("still parses a valid single-array where with rangeLo/rangeHi", () => {
        const cd = new Map<string, any>();
        cd.set("where.valid", dvBool(true));
        cd.set("where.count", dvLong(2));
        cd.set("where.rangeLo", dvDouble(199));
        cd.set("where.rangeHi", dvDouble(201));
        cd.set("where.iMin", dvLong(0));
        cd.set("where.iMax", dvLong(1));
        cd.set("where.jMin", dvLong(0));
        cd.set("where.jMax", dvLong(0));
        cd.set("where.kMin", dvLong(2));
        cd.set("where.kMax", dvLong(2));
        cd.set("where.ci", dvDouble(0.5));
        cd.set("where.cj", dvDouble(0));
        cd.set("where.ck", dvDouble(2));
        const r = parseArrayWhere({ customData: cd } as any);
        expect(r).not.toBeNull();
        expect(r!.valid).toBe(true);
        expect(r!.count).toBe(2);
        expect(r!.rangeLo).toBe(199);
        expect(r!.rangeHi).toBe(201);
        expect(r!.ci).toBeCloseTo(0.5, 9);
        expect(r!.ck).toBeCloseTo(2, 9);
    });

    it("returns null when the single-array where result is absent", () => {
        expect(parseArrayWhere({ customData: new Map() } as any)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// WHEREN correlation-id wire contract (one marker per predicate, evaluated in
// lockstep by the store; the AND result comes back under the FIRST cid).
// ---------------------------------------------------------------------------
describe("multiWhereCid (WHEREN marker encoding)", () => {
    it("encodes WHEREN|<idx 3-digit>|<lo>|<hi>", () => {
        expect(multiWhereCid(0, { lo: 0.1, hi: 0.3 })).toBe("WHEREN|000|0.1|0.3");
        expect(multiWhereCid(7, { lo: -5, hi: 12 })).toBe("WHEREN|007|-5|12");
    });

    it("keeps predicate order stable for up to 1000 predicates", () => {
        const cids = [0, 1, 9, 10, 99, 100, 999].map((i) => multiWhereCid(i, { lo: 0, hi: 1 }));
        expect([...cids].sort()).toEqual(cids);
        expect(new Set(cids).size).toBe(cids.length);
    });

    it("round-trips through a cid-keyed map (distinct keys per predicate)", () => {
        const m = new Map<string, number>();
        [{ lo: 0.1, hi: 0.3 }, { lo: 0.05, hi: 0.2 }].forEach((r, i) => m.set(multiWhereCid(i, r), i));
        expect(m.size).toBe(2);
        expect(m.get("WHEREN|000|0.1|0.3")).toBe(0);
        expect(m.get("WHEREN|001|0.05|0.2")).toBe(1);
    });
});
