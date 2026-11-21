// ============================================================================
// Multi-patch statistics fold regression tests.
//
// Locks the exact bug that was fixed in GenericProperty / GenericProperty22:
// the per-patch min/max/mean accumulators must be *folded across every patch*,
// not reset per patch. A reset keeps only the last patch's min/max/mean while
// ValueCount sums all patches -> wrong mean/stddev.
//
// The fold is exercised end-to-end through `computeStats` (via `initData`)
// using INLINE array patches (DoubleConstantArray for 2.0, FloatingPointXmlArray
// for 2.2) so no ETP/live-server round-trip is needed. Property-based cases
// assert that the folded result equals a single-pass reduction over the
// concatenation of all patches.
// ============================================================================

import "jest";

import { OSDUContext } from "../lib/jsonTypes/OsduContext";

// Load the full converter registry.
require("../lib/jsonTypes/ResqmlOsdu");

const { GenericPropertyOSDU } = require("../lib/jsonTypes/GenericProperty");
const { GenericProperty22OSDU } = require("../lib/jsonTypes/GenericProperty22");

// A client stub with NO getDataArrayStats, so the server fast-path is skipped
// and the client-side JS fold is exercised. Inline arrays never call it.
const mockClient = {
    getDataArrayValues: async () => [],
    getResolvedObjects: async () => ({}),
    getObjects: async () => []
} as any;

/** Deterministic LCG so property-based cases are reproducible. */
function makeRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0xffffffff;
    };
}

/** Reference single-pass population reduction over a flat value array. */
function reduceRef(values: number[]) {
    const v = values.filter(x => !Number.isNaN(x));
    const count = v.length;
    if (!count) {
        return { count: 0, min: undefined, max: undefined, mean: undefined, std: undefined };
    }
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    let sqr = 0;
    for (const x of v) {
        min = Math.min(min, x);
        max = Math.max(max, x);
        sum += x;
        sqr += x * x;
    }
    const mean = sum / count;
    return { count, min, max, mean, std: Math.sqrt(sqr / count - mean * mean) };
}

function ctx(): OSDUContext {
    const c = new OSDUContext("test-partition", "test-rddms");
    // 2.0 computeStats only runs under this flag; harmless for 2.2.
    c.useDataArrayForManifest = true;
    return c;
}

/** RESQML 2.0 ContinuousProperty whose patches are inline constant arrays. */
function buildXml20(patches: { value: number; count: number }[]): any {
    return {
        $type: "resqml20.obj_ContinuousProperty",
        SchemaVersion: "2.0",
        Uuid: "aaaaaaaa-0000-0000-0000-000000000001",
        Citation: { Title: "FoldProp20", Originator: "test", Creation: new Date() },
        IndexableElement: "cells",
        Count: patches.reduce((a, p) => a + p.count, 0),
        PropertyKind: { Kind: "porosity" },
        UOM: "m3/m3",
        PatchOfValues: patches.map(p => ({
            Values: { $type: "resqml20.DoubleConstantArray", Value: p.value, Count: p.count }
        }))
    };
}

/** RESQML 2.2 ContinuousProperty whose patches are inline XML arrays. */
function buildXml22(patchArrays: number[][]): any {
    return {
        $type: "resqml22.ContinuousProperty",
        SchemaVersion: "2.2",
        Uuid: "bbbbbbbb-0000-0000-0000-000000000001",
        Citation: { Title: "FoldProp22", Originator: "test", Creation: new Date() },
        IndexableElement: "cells",
        Count: patchArrays.reduce((a, arr) => a + arr.length, 0),
        PropertyKind: {
            Uuid: "bbbbbbbb-0000-0000-0000-000000000002",
            Title: "porosity",
            QualifiedType: "resqml22.PropertyKind"
        },
        UOM: "m3/m3",
        ValuesForPatch: patchArrays.map(arr => ({
            $type: "eml23.FloatingPointXmlArray",
            Values: arr,
            CountPerValue: arr.length
        })),
        PatchOfValues: []
    };
}

async function stats20(patches: { value: number; count: number }[]) {
    const xml = buildXml20(patches);
    const osdu = new GenericPropertyOSDU(xml, ctx());
    await osdu.initData("eml:///dataspace('test')", xml, mockClient);
    return osdu.data;
}

async function stats22(patchArrays: number[][]) {
    const xml = buildXml22(patchArrays);
    const osdu = new GenericProperty22OSDU(xml, ctx());
    await osdu.initData("eml:///dataspace('test22')", xml, mockClient);
    return osdu.data;
}

const PREC = 6;

describe("GenericProperty 2.0 multi-patch stats fold", () => {
    it("folds min/max/mean/stddev across patches (does NOT reset per patch)", async () => {
        // [2,2] then [8,8] -> min 2, max 8, mean 5, std 3 over 4 values.
        const data = await stats20([
            { value: 2, count: 2 },
            { value: 8, count: 2 }
        ]);
        expect(data.ValueCount).toBe(4);
        expect(data.MinValue).toBe(2); // a per-patch reset would report 8 here
        expect(data.MaxValue).toBe(8);
        expect(data.MeanValue).toBeCloseTo(5, PREC);
        expect(data.StdDeviation).toBeCloseTo(3, PREC);
    });

    it("a later low patch still lowers the running minimum", async () => {
        const data = await stats20([
            { value: 100, count: 3 },
            { value: 1, count: 1 } // min must become 1, not stay 100
        ]);
        expect(data.MinValue).toBe(1);
        expect(data.MaxValue).toBe(100);
        expect(data.ValueCount).toBe(4);
    });

    it("folded result equals a single-pass reduction (property-based)", async () => {
        const rng = makeRng(0xc0ffee);
        for (let iter = 0; iter < 25; iter++) {
            const nPatches = 1 + Math.floor(rng() * 5);
            const patches: { value: number; count: number }[] = [];
            const flat: number[] = [];
            for (let p = 0; p < nPatches; p++) {
                const value = Math.round((rng() * 200 - 100) * 1000) / 1000;
                const count = 1 + Math.floor(rng() * 4);
                patches.push({ value, count });
                for (let k = 0; k < count; k++) flat.push(value);
            }
            const ref = reduceRef(flat);
            const data = await stats20(patches);
            expect(data.ValueCount).toBe(ref.count);
            expect(data.MinValue).toBeCloseTo(ref.min!, PREC);
            expect(data.MaxValue).toBeCloseTo(ref.max!, PREC);
            expect(data.MeanValue).toBeCloseTo(ref.mean!, PREC);
            expect(data.StdDeviation).toBeCloseTo(ref.std!, PREC);
        }
    });
});

describe("GenericProperty 2.2 multi-patch stats fold", () => {
    it("folds min/max/mean/stddev across inline patches", async () => {
        // [1,2,3] then [3,4,5] -> 6 values, min 1, max 5, mean 3, std sqrt(64/6-9).
        const data = await stats22([
            [1, 2, 3],
            [3, 4, 5]
        ]);
        const ref = reduceRef([1, 2, 3, 3, 4, 5]);
        expect(data.ValueCount).toBe(6);
        expect(data.MinValue).toBe(1); // per-patch reset would report 3
        expect(data.MaxValue).toBe(5);
        expect(data.MeanValue).toBeCloseTo(ref.mean!, PREC);
        expect(data.StdDeviation).toBeCloseTo(ref.std!, PREC);
    });

    it("skips NaN nulls while still folding across patches", async () => {
        const data = await stats22([
            [1, NaN, 3],
            [5, NaN]
        ]);
        const ref = reduceRef([1, 3, 5]);
        expect(data.ValueCount).toBe(3);
        expect(data.MinValue).toBe(1);
        expect(data.MaxValue).toBe(5);
        expect(data.MeanValue).toBeCloseTo(ref.mean!, PREC);
    });

    it("folded result equals a single-pass reduction (property-based)", async () => {
        const rng = makeRng(0x1234abcd);
        for (let iter = 0; iter < 25; iter++) {
            const nPatches = 1 + Math.floor(rng() * 5);
            const patchArrays: number[][] = [];
            const flat: number[] = [];
            for (let p = 0; p < nPatches; p++) {
                const len = 1 + Math.floor(rng() * 6);
                const arr: number[] = [];
                for (let k = 0; k < len; k++) {
                    const x = Math.round((rng() * 2000 - 1000) * 100) / 100;
                    arr.push(x);
                    flat.push(x);
                }
                patchArrays.push(arr);
            }
            const ref = reduceRef(flat);
            const data = await stats22(patchArrays);
            expect(data.ValueCount).toBe(ref.count);
            expect(data.MinValue).toBeCloseTo(ref.min!, PREC);
            expect(data.MaxValue).toBeCloseTo(ref.max!, PREC);
            expect(data.MeanValue).toBeCloseTo(ref.mean!, PREC);
            expect(data.StdDeviation).toBeCloseTo(ref.std!, PREC);
        }
    });

    it("single-patch equals the equivalent multi-patch split", async () => {
        const whole = await stats22([[10, 20, 30, 40]]);
        const split = await stats22([[10, 20], [30, 40]]);
        expect(split.MinValue).toBe(whole.MinValue);
        expect(split.MaxValue).toBe(whole.MaxValue);
        expect(split.MeanValue).toBeCloseTo(whole.MeanValue, PREC);
        expect(split.StdDeviation).toBeCloseTo(whole.StdDeviation, PREC);
        expect(split.ValueCount).toBe(whole.ValueCount);
    });
});
