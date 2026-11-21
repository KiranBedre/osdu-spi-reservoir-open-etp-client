import "jest";

import { buildChannelSet } from "../lib/builders/channelSet";
import { uuidV5 } from "../lib/builders/core";
import {
    OsduRecord,
    WdmsSplitData,
    WdmsWellLogData,
    indexKind,
    splitDataToColumns,
    unitSymbol,
    wdmsWellLogToChannelSetSpec,
    wdmsWellToWitsml,
    wdmsWellboreToWitsml
} from "../lib/wellbore/wdms";

/**
 * Pure mapping tests for the Wellbore DDMS import
 * (`POST /dataspaces/{id}/wells/logs/import`). No network: the WDMS record and
 * `orient=split` bulk are fixtures shaped like the real API responses.
 */

const WELLLOG_ID = "osdu:work-product-component--WellLog:drogon-55-33-1-gr";
const WELLBORE_ID = "osdu:master-data--Wellbore:55-33-1";
const WELL_ID = "osdu:master-data--Well:55-33";

const record: OsduRecord<WdmsWellLogData> = {
    id: WELLLOG_ID,
    kind: "osdu:wks:work-product-component--WellLog:1.3.0",
    version: 1700000000001,
    acl: { owners: ["data.default.owners@osdu.example.com"], viewers: ["data.default.viewers@osdu.example.com"] },
    legal: { legaltags: ["osdu-public-usa-dataset"] },
    data: {
        Name: "55/33-1 GR run 1",
        WellboreID: WELLBORE_ID,
        ReferenceCurveID: "MD",
        SamplingDomainTypeID: "osdu:reference-data--WellLogSamplingDomainType:MeasuredDepth:",
        Curves: [
            { CurveID: "MD", Mnemonic: "DEPTH", CurveUnit: "osdu:reference-data--UnitOfMeasure:m:" },
            { CurveID: "GR", Mnemonic: "GR", CurveUnit: "osdu:reference-data--UnitOfMeasure:gAPI:" },
            { CurveID: "RHOB", Mnemonic: "RHOB", CurveUnit: "osdu:reference-data--UnitOfMeasure:g/cm3:" },
            { CurveID: "WF", Mnemonic: "WF", NumberOfColumns: 2 },
            { CurveID: "MISSING", Mnemonic: "MISSING" }
        ]
    }
};

const bulk: WdmsSplitData = {
    columns: ["MD", "GR", "RHOB", "WF[0]", "WF[1]"],
    index: [0, 1, 2],
    data: [
        [1000.0, 45.2, 2.31, 1, 2],
        [1000.5, null, 2.33, 3, 4],
        [1001.0, 50.1, "2.35", 5, 6]
    ]
};

describe("WDMS unit / index kind helpers", () => {
    it("takes the last segment of a UnitOfMeasure reference and defaults to Euc", () => {
        expect(unitSymbol("osdu:reference-data--UnitOfMeasure:gAPI:")).toBe("gAPI");
        expect(unitSymbol("osdu:reference-data--UnitOfMeasure:g/cm3:")).toBe("g/cm3");
        expect(unitSymbol(undefined)).toBe("Euc");
        expect(unitSymbol("")).toBe("Euc");
    });

    it("maps SamplingDomainType to WITSML ChannelIndexType", () => {
        expect(indexKind("osdu:reference-data--WellLogSamplingDomainType:MeasuredDepth:", "m")).toBe("measured depth");
        expect(indexKind("osdu:reference-data--WellLogSamplingDomainType:TrueVerticalDepth:", "m")).toBe("vertical depth");
        expect(indexKind("osdu:reference-data--WellLogSamplingDomainType:DateTime:", "s")).toBe("date time");
        expect(indexKind("osdu:reference-data--WellLogSamplingDomainType:ElapsedTime:", "s")).toBe("elapsed time");
        expect(indexKind(undefined, "s")).toBe("date time");
        expect(indexKind(undefined, "ft")).toBe("measured depth");
    });
});

describe("splitDataToColumns", () => {
    it("flattens single and multi-column curves row-major with null/strings normalised", () => {
        const cols = splitDataToColumns(bulk);
        expect([...cols.keys()]).toEqual(["MD", "GR", "RHOB", "WF"]);
        expect(cols.get("MD")).toEqual({ values: [1000.0, 1000.5, 1001.0], dimensions: [3] });
        const gr = cols.get("GR")!;
        expect(gr.dimensions).toEqual([3]);
        expect(gr.values[0]).toBe(45.2);
        expect(Number.isNaN(gr.values[1])).toBe(true);
        expect(cols.get("RHOB")!.values[2]).toBe(2.35);
        expect(cols.get("WF")).toEqual({ values: [1, 2, 3, 4, 5, 6], dimensions: [3, 2] });
    });
});

describe("wdmsWellLogToChannelSetSpec", () => {
    const spec = wdmsWellLogToChannelSetSpec(record, bulk, {
        originator: "tester",
        wellbore: { uuid: "f8158c5d-1265-429b-89ce-ea60bee1274c", title: "55/33-1" }
    });

    it("derives a deterministic uuid, title and osdu alias from the record", () => {
        expect(spec.uuid).toBe(uuidV5(WELLLOG_ID));
        expect(spec.title).toBe("55/33-1 GR run 1");
        expect(spec.aliases).toEqual([{ authority: "osdu", identifier: WELLLOG_ID }]);
        expect(spec.wellbore).toEqual({ uuid: "f8158c5d-1265-429b-89ce-ea60bee1274c", title: "55/33-1" });
    });

    it("uses the reference curve as Index and as first Channel; skips curves absent from the bulk", () => {
        expect(spec.index).toEqual({ mnemonic: "DEPTH", uom: "m", kind: "measured depth", direction: "increasing" });
        expect(spec.channels.map(c => c.mnemonic)).toEqual(["DEPTH", "GR", "RHOB", "WF"]);
        expect(spec.channels.map(c => c.uom)).toEqual(["m", "gAPI", "g/cm3", "Euc"]);
        expect(spec.channels[3].dimensions).toEqual([3, 2]);
    });

    it("carries source provenance as ExtraMetadata", () => {
        expect(spec.extraMetadata).toEqual({
            "osdu:sourceId": WELLLOG_ID,
            "osdu:sourceVersion": 1700000000001,
            "osdu:sourceKind": "osdu:wks:work-product-component--WellLog:1.3.0",
            "osdu:legalTags": "osdu-public-usa-dataset",
            "osdu:aclOwners": "data.default.owners@osdu.example.com",
            "osdu:aclViewers": "data.default.viewers@osdu.example.com",
            "osdu:wellboreId": WELLBORE_ID
        });
    });

    it("detects a decreasing index", () => {
        const dec = wdmsWellLogToChannelSetSpec(record, {
            columns: ["MD", "GR"],
            data: [[1001, 1], [1000, 2]]
        });
        expect(dec.index.direction).toBe("decreasing");
    });

    it("rejects records without curves or bulk", () => {
        expect(() => wdmsWellLogToChannelSetSpec({ id: "x", data: {} }, bulk)).toThrow(/no Curves/);
        expect(() => wdmsWellLogToChannelSetSpec(record, { columns: [], data: [] })).toThrow(/no bulk data/);
        expect(() =>
            wdmsWellLogToChannelSetSpec(record, { columns: ["GR"], data: [[1]] })
        ).toThrow(/reference curve MD missing/);
    });
});

describe("buildChannelSet with WDMS spec", () => {
    const spec = wdmsWellLogToChannelSetSpec(record, bulk, {
        wellbore: { uuid: "f8158c5d-1265-429b-89ce-ea60bee1274c", title: "55/33-1" }
    });
    const built = buildChannelSet(spec);

    it("emits the osdu alias before Citation and the Wellbore reference after Index", () => {
        const alias = built.xml.indexOf(`<eml:Aliases authority="osdu">`);
        const citation = built.xml.indexOf("<eml:Citation>");
        const index = built.xml.indexOf("</Index>");
        const wellbore = built.xml.indexOf("<Wellbore>");
        expect(alias).toBeGreaterThan(-1);
        expect(alias).toBeLessThan(citation);
        expect(built.xml).toContain(`<eml:Identifier>${WELLLOG_ID}</eml:Identifier>`);
        expect(wellbore).toBeGreaterThan(index);
        expect(built.xml).toContain("<eml:Uuid>f8158c5d-1265-429b-89ce-ea60bee1274c</eml:Uuid>");
        expect(built.xml).toContain("<eml:QualifiedType>witsml21.Wellbore</eml:QualifiedType>");
        expect(built.xml).toContain(`<eml:Name>osdu:sourceId</eml:Name>`);
        expect(built.xml).toContain(`<eml:Value>${WELLLOG_ID}</eml:Value>`);
    });

    it("produces one external array per channel with the WDMS dimensions", () => {
        expect(built.uuid).toBe(uuidV5(WELLLOG_ID));
        expect(built.arrays.map(a => a.mnemonic)).toEqual(["DEPTH", "GR", "RHOB", "WF"]);
        expect(built.arrays[3].dimensions).toEqual([3, 2]);
        expect(built.arrays[0].data).toEqual([1000.0, 1000.5, 1001.0]);
    });
});

describe("master-data anchors", () => {
    it("builds a witsml21.Well with the osdu alias and a deterministic uuid", () => {
        const well = wdmsWellToWitsml(WELL_ID, { FacilityName: "55/33" }, undefined, { originator: "tester", creation: "2026-01-01T00:00:00Z" });
        expect(well.$type).toBe("witsml21.Well");
        expect(well.Uuid).toBe(uuidV5(WELL_ID));
        expect(well.Aliases).toEqual([{ $type: "eml23.ObjectAlias", Authority: "osdu", Identifier: WELL_ID }]);
        expect(well.Citation).toEqual({
            $type: "eml23.Citation",
            Title: "55/33",
            Originator: "tester",
            Creation: "2026-01-01T00:00:00Z",
            Format: "etpclient"
        });
    });

    it("builds a witsml21.Wellbore referencing its Well", () => {
        const wb = wdmsWellboreToWitsml(WELLBORE_ID, undefined, { uuid: uuidV5(WELL_ID), title: "55/33" });
        expect(wb.$type).toBe("witsml21.Wellbore");
        expect(wb.Uuid).toBe(uuidV5(WELLBORE_ID));
        expect((wb.Citation as { Title: string }).Title).toBe(WELLBORE_ID);
        expect(wb.Well).toEqual({
            $type: "eml23.DataObjectReference",
            Uuid: uuidV5(WELL_ID),
            QualifiedType: "witsml21.Well",
            Title: "55/33"
        });
    });
});
