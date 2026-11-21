import "jest";

import {
    getMnemonicMatch,
    getQuantityClassForProperty
} from "../lib/jsonTypes/PwlsCurveCatalog";
import { normalizeUnit, toCanonicalValue } from "../lib/jsonTypes/PwlsUnits";
import { buildChannelSet } from "../lib/builders/channelSet";
import { buildContinuousProperty } from "../lib/builders/property";

/**
 * Tests for the PWLS §6.4 improvements:
 *   §6.4.6 — mnemonic alias coverage + match provenance
 *   §6.4.4 — canonical unit normalization
 *   §6.4.1/§6.4.2 — single-call ChannelSet builder + acquisition sidecar
 *   §6.4.3 — array-backed RESQML bridge (no-copy ContinuousProperty)
 *   §6.4.5 — this file (assembly/shape conformance)
 */

describe("§6.4.6 mnemonic alias coverage + provenance", () => {
    it("surfaces the alias key when matched via the intuitive-alias map", () => {
        const m = getMnemonicMatch("INC");
        expect(m.property).toBe("hole deviation");
        expect(m.matchedVia).toBe("alias");
        expect(m.alias).toBe("INC");
    });

    it("maps newly-added conservative vendor variants", () => {
        expect(getMnemonicMatch("DEVI").property).toBe("hole deviation");
        expect(getMnemonicMatch("HAZI").property).toBe("hole azimuth");
        expect(getMnemonicMatch("TVD").property).toBe("true vertical depth");
        // T2_DIST resolves (vendor catalog gives the richer "nmr t2 distribution").
        expect(getMnemonicMatch("T2_DIST").property).toBeDefined();
    });

    it("falls back to the intuitive alias when no vendor match exists", () => {
        // EASTING is not a vendor mnemonic → resolved only via the alias map.
        const m = getMnemonicMatch("EASTING");
        expect(m.property).toBe("x coordinate");
        expect(m.matchedVia).toBe("alias");
        expect(m.alias).toBe("EASTING");
    });

    it("lets the vendor catalog win over an intuitive alias", () => {
        // CALI is in the vendor catalog (borehole diameter); vendor tier precedes alias.
        const m = getMnemonicMatch("CALI");
        expect(m.matchedVia).toMatch(/^vendor/);
        expect(m.property).toBe("borehole diameter");
    });

    it("reports matchedVia 'none' for unknown mnemonics", () => {
        const m = getMnemonicMatch("ZZ_NOT_A_CURVE");
        expect(m.property).toBeUndefined();
        expect(m.matchedVia).toBe("none");
    });
});

describe("§6.4.4 canonical unit normalization", () => {
    it("recognizes a canonical unit as compatible", () => {
        const n = normalizeUnit("gAPI", "API gamma ray");
        expect(n.recognized).toBe(true);
        expect(n.canonicalUom).toBe("gAPI");
        expect(n.compatible).toBe(true);
        expect(n.isCanonical).toBe(true);
    });

    it("provides a linear factor for ft -> m length conversion", () => {
        const n = normalizeUnit("ft", "true vertical depth");
        expect(n.compatible).toBe(true);
        expect(n.canonicalUom).toBe("m");
        expect(n.factor).toBeCloseTo(0.3048, 6);
        expect(toCanonicalValue(100, n)).toBeCloseTo(30.48, 6);
    });

    it("applies an affine offset for degF -> degC", () => {
        const n = normalizeUnit("degF", "temperature");
        expect(n.compatible).toBe(true);
        expect(toCanonicalValue(32, n)).toBeCloseTo(0, 6);
        expect(toCanonicalValue(212, n)).toBeCloseTo(100, 6);
    });

    it("flags a dimensionally incompatible unit", () => {
        const n = normalizeUnit("gAPI", "true vertical depth");
        expect(n.compatible).toBe(false);
        expect(n.note).toMatch(/length/);
    });

    it("reports unrecognized units without guessing", () => {
        const n = normalizeUnit("widgets", "API gamma ray");
        expect(n.recognized).toBe(false);
        expect(n.compatible).toBeUndefined();
    });
});

describe("§6.4.1/§6.4.2 ChannelSet builder", () => {
    const built = buildChannelSet({
        title: "Demo Survey",
        index: { mnemonic: "DEPTH", uom: "m", kind: "measured depth" },
        channels: [
            { mnemonic: "INC", uom: "dega", values: [0, 1.2, 2.4] },
            { mnemonic: "AZM", uom: "dega", values: [10, 11, 12] }
        ],
        acquisitionMetadata: { tool: "GYRO", run: "1" },
        normalizeUnits: true,
        creation: "2026-10-07T00:00:00Z"
    });

    it("emits a metadata-only ChannelSet with Channels before Index", () => {
        expect(built.xml).toContain("<ChannelSet");
        expect(built.xml.indexOf("<Channel>")).toBeLessThan(built.xml.indexOf("<Index>"));
        expect(built.xml).toContain(`uuid="${built.uuid}"`);
    });

    it("resolves PWLS inline and surfaces it as ExtraMetadata", () => {
        expect(built.xml).toContain("<eml:Name>pwls:property</eml:Name>");
        expect(built.xml).toContain("<eml:Value>hole deviation</eml:Value>");
        const inc = built.resolution.find(r => r.mnemonic === "INC");
        expect(inc?.property).toBe("hole deviation");
        expect(inc?.matchedVia).toBe("alias");
        expect(inc?.quantityClass).toBe(getQuantityClassForProperty("hole deviation"));
    });

    it("writes acquisition metadata as a ChannelSet sidecar", () => {
        expect(built.xml).toContain("<eml:Name>acq:tool</eml:Name>");
        expect(built.xml).toContain("<eml:Value>GYRO</eml:Value>");
    });

    it("produces one array payload per channel", () => {
        expect(built.arrays).toHaveLength(2);
        expect(built.arrays[0]).toMatchObject({ mnemonic: "INC", dimensions: [3] });
        expect(built.arrays[0].data).toEqual([0, 1.2, 2.4]);
    });

    it("escapes XML special characters", () => {
        const b = buildChannelSet({
            title: "A & B <log>",
            index: { mnemonic: "DEPTH", uom: "m", kind: "measured depth" },
            channels: [{ mnemonic: "GR", uom: "gAPI", values: [1] }]
        });
        expect(b.xml).toContain("A &amp; B &lt;log&gt;");
        expect(b.xml).not.toContain("A & B <log>");
    });
});

describe("§6.4.3 array-backed RESQML bridge", () => {
    it("references an existing array path with no new array emitted", () => {
        const built = buildContinuousProperty({
            title: "GR promoted",
            hdfUuid: "hdf-uuid",
            supportingRepUuid: "frame-uuid",
            supportingRepType: "obj_WellboreFrameRepresentation",
            kind: "gamma ray",
            uom: "gAPI",
            values: [],
            dimensions: [1385],
            externalArrayPath: "/WITSML/cs-uuid/GR",
            minValue: 12,
            maxValue: 140
        });
        expect(built.arrays).toHaveLength(0);
        const patch = (built.object as any).PatchOfValues[0].Values;
        const pathInHdf = JSON.stringify(patch);
        expect(pathInHdf).toContain("/WITSML/cs-uuid/GR");
        expect((built.object as any).MinimumValue).toEqual([12]);
        expect((built.object as any).MaximumValue).toEqual([140]);
    });

    it("still emits a copied array when no external path is given", () => {
        const built = buildContinuousProperty({
            title: "GR copy",
            hdfUuid: "hdf-uuid",
            supportingRepUuid: "frame-uuid",
            supportingRepType: "obj_WellboreFrameRepresentation",
            kind: "gamma ray",
            uom: "gAPI",
            values: [1, 2, 3]
        });
        expect(built.arrays).toHaveLength(1);
        expect(built.arrays[0].Data).toEqual([1, 2, 3]);
    });
});
