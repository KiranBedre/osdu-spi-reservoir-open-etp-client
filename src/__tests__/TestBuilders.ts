// ============================================================================
// Tests for the pure RESQML object-graph builders (sdk/builders).
// These are I/O-free: no server, no transport — just object-graph correctness.
// ============================================================================

import "jest";
import {
    buildLocalCrs,
    crsCompleteness,
    toOsduCompoundCrs,
    toOsduCrsLocalFrame,
    buildHdfProxy,
    buildGrid2d,
    buildPointSet,
    buildPolylineSet,
    buildContinuousProperty,
    buildDiscreteProperty,
    buildFeature,
    buildInterpretation,
    buildInterpretedFeature,
    toOsduFaultInterpretation,
    buildVelocityModel,
    toOsduGenericProperty,
    buildWellboreFrame,
    buildCheckshot,
    buildWellboreMarkerFrame,
    buildColumnBasedTable,
    buildBlockedWellbore,
    buildGridConnectionSet,
    buildFaultTransmissibilityMultiplier,
    buildStratigraphicColumn,
    buildRegionSet,
    buildRockFluidModel,
    buildIntervalStratigraphicUnits,
    buildCellFluidPhaseUnits,
    buildCategoricalProperty,
    buildStringTableLookup,
    toOsduWellLog,
    versionInfo,
    isResqmlVersion,
    RESQML_VERSIONS,
    resolvePropertyKind,
    resolveSeismicKind,
    uomCompatible,
    isCanonicalKind,
    isSeismicKind,
    SEISMIC_PROPERTY_KINDS,
    classifySeismicObject,
    buildSeismicWpc,
    spatialAreaFromPoints,
    parseSdmsRef,
    resolveCubeRefs,
    withCubeRefs,
    indexInterpretationsByCube,
    interpretationsForCube,
    parseGrdecl,
    serializeGrdecl,
    serializeEgrid,
    serializeInit,
    lookupByKeyword,
    lookupByOsdu,
    lookupByTitle,
    resqmlKindForKeyword,
    toKeyword,
    registerGridProperty,
    resetGridPropertyRegistry,
    gridPropertyMappings,
    convertUnitValue,
    canConvertUnit,
    zcornIndex,
    cornerPointToCoordinateLines,
    ijkGridToCornerPoint,
    buildIjkGrid,
} from "../../sdk";
import type { CornerPointGrid } from "../../sdk";

describe("CRS builder", () => {
    const spec = {
        title: "UTM31N/MSL",
        domain: "depth" as const,
        xOffset: 420000,
        yOffset: 6470000,
        epsgProjected: 23031,
        epsgVertical: 5714,
    };

    it("builds a LocalDepth3dCrs for depth domain", () => {
        const { object, uuid } = buildLocalCrs(spec);
        expect(object.$type).toBe("resqml20.obj_LocalDepth3dCrs");
        expect(uuid).toMatch(/[0-9a-f-]{36}/);
        expect((object as any).VerticalUom).toBe("m");
        expect((object as any).ProjectedCrs.EpsgCode).toBe(23031);
    });

    it("builds a LocalTime3dCrs with TimeUom for time domain", () => {
        const { object } = buildLocalCrs({ ...spec, domain: "time", timeUom: "ms" });
        expect(object.$type).toBe("resqml20.obj_LocalTime3dCrs");
        expect((object as any).TimeUom).toBe("ms");
    });

    it("flags an incomplete CRS (hollow OSDU LocalModelCompoundCrs, O1)", () => {
        const report = crsCompleteness({ ...spec, epsgProjected: undefined });
        expect(report.complete).toBe(false);
        expect(report.missing).toContain("epsgProjected");
    });

    it("passes completeness when fully specified", () => {
        expect(crsCompleteness(spec).complete).toBe(true);
    });

    it("projects to OSDU LocalModelCompoundCrs:1.3.0 geodetic ids (BoundProjected for legacy datum)", () => {
        const osdu = toOsduCompoundCrs({ ...spec, boundCtEpsg: 1612, projectedCrsName: "ED50 / UTM zone 31N" });
        expect(osdu.CoordinateReferenceSystemID).toBe(
            "namespace:reference-data--CoordinateReferenceSystem:BoundProjected:EPSG::23031_EPSG::1612:"
        );
        expect(osdu.VerticalCoordinateReferenceSystemID).toBe(
            "namespace:reference-data--CoordinateReferenceSystem:Vertical:EPSG::5714:"
        );
        expect(osdu.ProjectedCrsName).toBe("ED50 / UTM zone 31N");
        expect(JSON.parse(osdu.PersistableReferenceProjectedCrs!).authCode.code).toBe("23031");
    });

    it("emits a plain Projected id when no datum transform is needed", () => {
        const osdu = toOsduCompoundCrs({ ...spec, epsgProjected: 25832 });
        expect(osdu.CoordinateReferenceSystemID).toBe(
            "namespace:reference-data--CoordinateReferenceSystem:Projected:EPSG::25832:"
        );
    });

    it("keeps the local frame out of the CRS record and on dataset metadata", () => {
        const frame = toOsduCrsLocalFrame(spec);
        expect(frame.XOffset).toBe(420000);
        expect(frame.Domain).toBe("depth");
        expect((toOsduCompoundCrs(spec) as any).XOffset).toBeUndefined();
    });
});

describe("property-kind vocabulary", () => {
    it("recognises canonical seismic kinds", () => {
        expect(isSeismicKind("acoustic impedance")).toBe(true);
        expect(isCanonicalKind("RMS velocity")).toBe(true);
        expect(SEISMIC_PROPERTY_KINDS).toContain("two-way time");
    });

    it("remaps abstract kinds to concrete (P02)", () => {
        const r = resolvePropertyKind("volume per volume");
        expect(r.remapped).toBe(true);
        expect(r.kind).toBe("porosity");
        expect(r.canonical).toBe(true);
    });

    it("remaps a discrete 'length' kind to 'index' (P03)", () => {
        const r = resolvePropertyKind("length", { discrete: true });
        expect(r.remapped).toBe(true);
        expect(r.kind).toBe("index");
    });

    it("warns on an unknown free-text kind", () => {
        const r = resolvePropertyKind("wibble");
        expect(r.canonical).toBe(false);
        expect(r.warnings.length).toBeGreaterThan(0);
    });
});

describe("seismic-kind canonicalisation (/seismic/validate)", () => {
    it("resolves common aliases to a canonical seismic kind", () => {
        const ai = resolveSeismicKind("AI");
        expect(ai.matchedAlias).toBe(true);
        expect(ai.kind).toBe("acoustic impedance");
        expect(ai.canonical).toBe(true);
        expect(ai.seismic).toBe(true);

        expect(resolveSeismicKind("RMS").kind).toBe("RMS velocity");
        expect(resolveSeismicKind("twt").kind).toBe("two-way time");
        expect(resolveSeismicKind("vp/vs").kind).toBe("Vp/Vs");
    });

    it("passes an already-canonical kind through untouched", () => {
        const r = resolveSeismicKind("interval velocity");
        expect(r.matchedAlias).toBe(false);
        expect(r.canonical).toBe(true);
        expect(r.kind).toBe("interval velocity");
    });

    it("flags a non-canonical kind with a warning", () => {
        const r = resolveSeismicKind("made-up attribute");
        expect(r.canonical).toBe(false);
        expect(r.warnings.length).toBeGreaterThan(0);
    });

    it("warns on a UOM that disagrees with the expected unit", () => {
        const bad = resolveSeismicKind("RMS velocity", { uom: "ft" });
        expect(bad.expectedUom).toBe("m/s");
        expect(bad.warnings.some(w => w.includes("UOM"))).toBe(true);

        const ok = resolveSeismicKind("RMS velocity", { uom: "m/s" });
        expect(ok.warnings.some(w => w.includes("UOM"))).toBe(false);
    });

    it("treats velocity UOM synonyms as compatible", () => {
        expect(uomCompatible("m.s-1", "m/s")).toBe(true);
        expect(uomCompatible("m/s", "m/s")).toBe(true);
        expect(uomCompatible("ft", "m/s")).toBe(false);
    });

    it("reports an empty kind as non-canonical", () => {
        const r = resolveSeismicKind("   ");
        expect(r.canonical).toBe(false);
        expect(r.warnings[0]).toMatch(/empty/);
    });
});

describe("interpretation builders", () => {
    it("wires interpretation → feature via a DOR", () => {
        const feat = buildFeature({ title: "Top Draupne", kind: "horizon" });
        const interp = buildInterpretation({
            title: "Top Draupne",
            kind: "horizon",
            domain: "depth",
            featureUuid: feat.uuid,
        });
        expect(interp.object.$type).toBe("resqml20.obj_HorizonInterpretation");
        expect((interp.object as any).InterpretedFeature.UUID).toBe(feat.uuid);
        expect((interp.object as any).Domain).toBe("depth");
    });

    it("builds a fault feature/interpretation pair", () => {
        const { objects, featureUuid, interpretationUuid } = buildInterpretedFeature({
            title: "Main Fault F1",
            kind: "fault",
            domain: "depth",
        });
        expect(objects).toHaveLength(2);
        expect(objects[0].$type).toBe("resqml20.obj_TectonicBoundaryFeature");
        expect(objects[1].$type).toBe("resqml20.obj_FaultInterpretation");
        expect((objects[1] as any).InterpretedFeature.UUID).toBe(featureUuid);
        expect(interpretationUuid).toMatch(/[0-9a-f-]{36}/);
    });
});

describe("geometry builders", () => {
    const hdf = buildHdfProxy();
    const crs = buildLocalCrs({ title: "crs", domain: "depth", xOffset: 0, yOffset: 0, epsgProjected: 23031, epsgVertical: 5714 });

    it("builds a Grid2d with a Z array of the right dimensions", () => {
        const grid = buildGrid2d({
            title: "Horizon Alpha",
            hdfUuid: hdf.uuid,
            crsUuid: crs.uuid,
            ni: 4,
            nj: 3,
            origin: { x: 0, y: 0 },
            iSpacing: 25,
            jSpacing: 25,
            zValues: [1000, 1020, 1040, 1050, 1010, 1030, 1060, 1080, 1050, 1070, 1090, 1110],
        });
        expect(grid.object.$type).toBe("resqml20.obj_Grid2dRepresentation");
        expect(grid.arrays).toHaveLength(1);
        expect(grid.arrays[0].Dimensions).toEqual([3, 4]);
    });

    it("builds a PointSet from flat XYZ triples", () => {
        const ps = buildPointSet({
            title: "Picks",
            hdfUuid: hdf.uuid,
            crsUuid: crs.uuid,
            points: [0, 0, 100, 1, 1, 110],
        });
        expect(ps.object.$type).toBe("resqml20.obj_PointSetRepresentation");
        expect(ps.arrays[0].Dimensions).toEqual([2, 3]);
    });

    it("builds a PolylineSet (fault sticks) with node-count array", () => {
        const pl = buildPolylineSet({
            title: "Fault sticks",
            hdfUuid: hdf.uuid,
            crsUuid: crs.uuid,
            polylines: [
                [0, 0, 100, 0, 0, 200],
                [10, 10, 100, 10, 10, 220, 10, 10, 300],
            ],
        });
        expect(pl.object.$type).toBe("resqml20.obj_PolylineSetRepresentation");
        expect(pl.arrays).toHaveLength(2);
        expect(pl.arrays[0].Dimensions).toEqual([5, 3]); // 2 + 3 nodes
        expect(pl.arrays[1].Data).toEqual([2, 3]);
    });
});

describe("property builders", () => {
    const hdf = buildHdfProxy();

    it("builds a ContinuousProperty with canonical kind + UOM", () => {
        const p = buildContinuousProperty({
            title: "Interval velocity",
            hdfUuid: hdf.uuid,
            supportingRepUuid: "rep-uuid",
            supportingRepType: "resqml20.obj_Grid2dRepresentation",
            kind: "interval velocity",
            uom: "m/s",
            values: [2400, 2500, 2600],
        });
        expect(p.object.$type).toBe("resqml20.obj_ContinuousProperty");
        expect((p.object as any).UOM).toBe("m/s");
        expect((p.object as any).PropertyKind.Kind).toBe("interval velocity");
        expect(p.kindResolution.canonical).toBe(true);
        expect(p.arrays[0].Dimensions).toEqual([3]);
    });

    it("builds a DiscreteProperty and remaps abstract kind", () => {
        const p = buildDiscreteProperty({
            title: "SATNUM",
            hdfUuid: hdf.uuid,
            supportingRepUuid: "grid-uuid",
            supportingRepType: "resqml20.obj_IjkGridRepresentation",
            kind: "length",
            values: [1, 2, 1, 3],
        });
        expect(p.object.$type).toBe("resqml20.obj_DiscreteProperty");
        expect((p.object as any).PropertyKind.Kind).toBe("index");
        expect(p.arrays[0].ArrayType).toBe("Int32Array");
    });
});

describe("version awareness (2.0.1 / 2.0.2 / 2.2.0)", () => {
    it("defaults to the 2.0.1 baseline", () => {
        const info = versionInfo();
        expect(info.resqml).toBe("resqml20");
        expect(info.schema).toBe("2.0.0.20140822");
        expect(info.arrays).toBe("hdf5");
    });

    it("emits 2.0.2 as a binary-compatible patch (same namespaces, new schema stamp)", () => {
        const { object } = buildLocalCrs({ title: "crs", domain: "depth", version: "2.0.2", xOffset: 0, yOffset: 0 });
        expect(object.$type).toBe("resqml20.obj_LocalDepth3dCrs");
        expect((object as any).SchemaVersion).toBe("2.0.2");
    });

    it("emits 2.2.0 with resqml22 prefixes and eml23 ExternalDataArray geometry", () => {
        const hdf = buildHdfProxy({ version: "2.2.0" });
        expect(hdf.object.$type).toBe("eml23.EpcExternalPartReference");
        const g = buildGrid2d({
            title: "map",
            hdfUuid: hdf.uuid,
            crsUuid: "crs",
            version: "2.2.0",
            ni: 2,
            nj: 2,
            origin: { x: 0, y: 0 },
            iSpacing: 1,
            jSpacing: 1,
            zValues: [1, 2, 3, 4],
        });
        expect(g.object.$type).toBe("resqml22.Grid2dRepresentation");
        const zv = (g.object as any).Grid2dPatch.Geometry.Points.ZValues;
        expect(zv.$type).toBe("eml23.FloatingPointExternalArray");
        expect(zv.Values.$type).toBe("eml23.ExternalDataArray");
        expect(zv.Values.ExternalDataArrayPart[0].Count).toEqual([2, 2]);
    });

    it("emits 2.2.0 riding the resqml22 namespace with eml23 arrays", () => {
        const ps = buildPointSet({
            title: "picks",
            hdfUuid: "hdf",
            crsUuid: "crs",
            version: "2.2.0",
            points: [0, 0, 0, 1, 1, 1],
        });
        expect(ps.object.$type).toBe("resqml22.PointSetRepresentation");
        const pts = (ps.object as any).NodePatch[0].Geometry.Points;
        expect(pts.$type).toBe("resqml22.Point3dExternalArray");
        expect(pts.Coordinates.$type).toBe("eml23.ExternalDataArray");
    });
});

describe("fault seal (2.0.2+) and OSDU projection", () => {
    it("omits seal fields on a 2.0.1 fault interpretation", () => {
        const { object } = buildInterpretation({
            title: "F1",
            kind: "fault",
            domain: "depth",
            featureUuid: "feat",
            sealState: "sealed",
        });
        expect((object as any).SealState).toBeUndefined();
    });

    it("carries SealState + TransmissibilityMultiplier on 2.0.2", () => {
        const { object } = buildInterpretation({
            title: "F1",
            kind: "fault",
            domain: "depth",
            version: "2.0.2",
            featureUuid: "feat",
            sealState: "partially_sealed",
            transmissibilityMultiplier: 0.25,
            sealMechanism: "clay smear",
        });
        // RESQML on-object value uses the space form validated by resqml_rules.
        expect((object as any).SealState).toBe("partially sealed");
        expect((object as any).TransmissibilityMultiplier).toBe(0.25);
        expect((object as any).SealMechanism).toBe("clay smear");
    });

    it("projects a sealed fault to OSDU IsSealed=true with reversibility discriminators", () => {
        const { object } = buildInterpretation({
            title: "F2",
            kind: "fault",
            domain: "depth",
            version: "2.0.2",
            featureUuid: "feat",
            sealState: "sealed",
            transmissibilityMultiplier: 0,
        });
        const osdu = toOsduFaultInterpretation(object, { interpretedFeatureId: "osdu:...:feat:" });
        expect(osdu.data.IsSealed).toBe(true);
        expect(osdu.data.ExtensionProperties.SealState).toBe("sealed");
        expect(osdu.data.ExtensionProperties.DefaultTransmissibilityMultiplier).toBe(0);
        expect(osdu.data.ExtensionProperties["x-resqml-type"]).toBe("FaultInterpretation");
        expect(osdu.data.ExtensionProperties.ResqmlSchemaVersion).toBe("2.0.2");
        expect(osdu.data.InterpretedFeatureID).toBe("osdu:...:feat:");
    });

    it("round-trips partially_sealed code through RESQML value and back to OSDU code", () => {
        const { object } = buildInterpretation({
            title: "F4",
            kind: "fault",
            domain: "depth",
            version: "2.0.2",
            featureUuid: "feat",
            sealState: "partially_sealed",
        });
        expect((object as any).SealState).toBe("partially sealed");
        const osdu = toOsduFaultInterpretation(object);
        expect(osdu.data.ExtensionProperties.SealState).toBe("partially_sealed");
        expect(osdu.data.IsSealed).toBe(false);
    });

    it("derives IsSealed=false for a leaking fault", () => {
        const { object } = buildInterpretation({
            title: "F3",
            kind: "fault",
            domain: "depth",
            version: "2.0.2",
            featureUuid: "feat",
            sealState: "leaking",
        });
        expect(toOsduFaultInterpretation(object).data.IsSealed).toBe(false);
    });
});

describe("velocity model (RESQML 2.0.2 / 2.2.0) + OSDU round-trip", () => {
    const hdf = buildHdfProxy();

    it("builds an interval-velocity model with canonical kind + m/s UOM", () => {
        const vm = buildVelocityModel({
            title: "Vint",
            hdfUuid: hdf.uuid,
            supportingRepUuid: "grid",
            supportingRepType: "resqml20.obj_Grid2dRepresentation",
            velocityKind: "interval",
            values: [2400, 2500, 2600],
        });
        expect(vm.object.$type).toBe("resqml20.obj_ContinuousProperty");
        expect((vm.object as any).PropertyKind.Kind).toBe("interval velocity");
        expect((vm.object as any).UOM).toBe("m/s");
        expect(vm.kindResolution.canonical).toBe(true);
    });

    it("defaults Vp/Vs to a dimensionless (euc) UOM", () => {
        const vm = buildVelocityModel({
            title: "VpVs",
            hdfUuid: hdf.uuid,
            supportingRepUuid: "grid",
            supportingRepType: "resqml20.obj_Grid2dRepresentation",
            velocityKind: "Vp/Vs",
            values: [1.8, 1.9],
        });
        expect((vm.object as any).PropertyKind.Kind).toBe("Vp/Vs");
        expect((vm.object as any).UOM).toBe("euc");
    });

    it("emits 2.2.0 riding the resqml22 namespace", () => {
        const vm = buildVelocityModel({
            title: "Vrms",
            hdfUuid: "hdf",
            version: "2.2.0",
            supportingRepUuid: "grid",
            supportingRepType: "resqml22.obj_Grid2dRepresentation",
            velocityKind: "rms",
            values: [1500, 1600, 1700],
        });
        expect(vm.object.$type).toBe("resqml22.ContinuousProperty");
        expect((vm.object as any).PropertyKind.Kind).toBe("RMS velocity");
    });

    it("projects a velocity model to OSDU GenericProperty:1.0.0 and back (reversible)", () => {
        const vm = buildVelocityModel({
            title: "Vint",
            hdfUuid: hdf.uuid,
            version: "2.0.2",
            supportingRepUuid: "grid",
            supportingRepType: "resqml20.obj_Grid2dRepresentation",
            velocityKind: "interval",
            values: [2400, 2600],
        });
        const osdu = toOsduGenericProperty(vm.object, { version: "2.0.2" });
        expect(osdu.kind).toBe("osdu:wks:work-product-component--GenericProperty:1.0.0");
        expect(osdu.data.ValueType).toBe("continuous");
        expect(osdu.data.PropertyType).toBe("interval velocity");
        expect(osdu.data.UnitOfMeasure).toBe("m/s");
        expect(osdu.data.MinValue).toBe(2400);
        expect(osdu.data.MaxValue).toBe(2600);
        // Reversibility discriminators.
        expect(osdu.data.ExtensionProperties.VelocityKind).toBe("interval velocity");
        expect(osdu.data.ExtensionProperties["x-resqml-type"]).toBe("ContinuousProperty");
        expect(osdu.data.ExtensionProperties.ResqmlObjectUUID).toBe((vm.object as any).Uuid);
        expect(osdu.data.ExtensionProperties.ResqmlSchemaVersion).toBe("2.0.2");
    });
});

describe("checkshot / TZ curve (RESQML 2.0.2 vs 2.2.0) + OSDU round-trip", () => {
    const mds = [500, 1000, 1500, 2000];
    const times = [400, 780, 1150, 1510];

    it("rejects an unknown RESQML version with a clear error (2.3.0 is EML, not RESQML)", () => {
        expect(isResqmlVersion("2.2.0")).toBe(true);
        expect(isResqmlVersion("2.3.0")).toBe(false);
        expect(RESQML_VERSIONS).toEqual(["2.0.1", "2.0.2", "2.2.0"]);
        expect(() => versionInfo("2.3.0" as any)).toThrow(/unsupported RESQML version "2.3.0"/);
        expect(() =>
            buildCheckshot({
                title: "CS-bad",
                hdfUuid: "hdf",
                version: "2.3.0" as any,
                trajectoryUuid: "traj",
                mds,
                times,
            })
        ).toThrow(/unsupported RESQML version/);
    });

    it("2.0.2 decomposes into a WellboreFrame + two-way-time property", () => {
        const parts = buildCheckshot({
            title: "CS-1",
            hdfUuid: "hdf",
            version: "2.0.2",
            trajectoryUuid: "traj",
            interpretationUuid: "wbi",
            mds,
            times,
        });
        expect(parts).toHaveLength(2);
        expect(parts[0].object.$type).toBe("resqml20.obj_WellboreFrameRepresentation");
        expect((parts[0].object as any).NodeCount).toBe(4);
        expect(parts[1].object.$type).toBe("resqml20.obj_ContinuousProperty");
        expect((parts[1].object as any).PropertyKind.Kind).toBe("two-way time");
        expect((parts[1].object as any).UOM).toBe("ms");
        // property is attached to the frame
        expect((parts[1].object as any).SupportingRepresentation.UUID).toBe((parts[0].object as any).Uuid);
    });

    it("2.2.0 emits a single SeismicWellboreFrameRepresentation with NodeTimeValues", () => {
        const parts = buildCheckshot({
            title: "CS-2",
            hdfUuid: "hdf",
            version: "2.2.0",
            trajectoryUuid: "traj",
            timeCrsUuid: "tcrs",
            seismicReferenceDatum: 30,
            weatheringVelocity: 1800,
            mds,
            times,
        });
        expect(parts).toHaveLength(1);
        const o = parts[0].object as any;
        expect(o.$type).toBe("resqml22.SeismicWellboreFrameRepresentation");
        expect(o.NodeCount).toBe(4);
        expect(o.SeismicReferenceDatum).toBe(30);
        expect(o.WeatheringVelocity).toBe(1800);
        expect(o.LocalTime3dCrs.Uuid).toBe("tcrs");
        // both MD and time arrays are emitted
        expect(parts[0].arrays.map((a) => a.Data)).toEqual([mds, times]);
    });

    it("rejects mismatched md/time lengths", () => {
        expect(() =>
            buildCheckshot({ title: "bad", hdfUuid: "hdf", trajectoryUuid: "t", mds: [1, 2], times: [1] }),
        ).toThrow(/same length/);
    });

    it("projects a 2.2.0 checkshot to OSDU WellLog:1.3.0 and back (reversible)", () => {
        const [built] = buildCheckshot({
            title: "CS-3",
            hdfUuid: "hdf",
            version: "2.2.0",
            trajectoryUuid: "traj",
            timeCrsUuid: "tcrs",
            seismicReferenceDatum: 30,
            mds,
            times,
        });
        const osdu = toOsduWellLog(built.object, { version: "2.2.0", mds, surveyType: "checkshot", timeKind: "two-way time" });
        expect(osdu.kind).toBe("osdu:wks:work-product-component--WellLog:1.3.0");
        expect(osdu.data.SamplingDomain).toBe("time");
        expect(osdu.data.TopMeasuredDepth).toBe(500);
        expect(osdu.data.BottomMeasuredDepth).toBe(2000);
        expect(osdu.data.SamplingInterval).toBe(500);
        expect(osdu.data.SampleCount).toBe(4);
        expect(osdu.data.ExtensionProperties.SeismicReferenceDatum).toBe(30);
        expect(osdu.data.ExtensionProperties.SurveyType).toBe("checkshot");
        expect(osdu.data.ExtensionProperties["x-resqml-type"]).toBe("SeismicWellboreFrameRepresentation");
        expect(osdu.data.ExtensionProperties.ResqmlObjectUUID).toBe((built.object as any).Uuid);
        expect(osdu.data.ExtensionProperties.ResqmlSchemaVersion).toBe("2.2");
    });

    it("2.2.0 is FULL fidelity — datum + time CRS survive the round-trip", () => {
        const [built] = buildCheckshot({
            title: "CS-full",
            hdfUuid: "hdf",
            version: "2.2.0",
            trajectoryUuid: "traj",
            timeCrsUuid: "tcrs",
            seismicReferenceDatum: 30,
            weatheringVelocity: 1800,
            mds,
            times,
        });
        const osdu = toOsduWellLog(built.object, { version: "2.2.0", mds });
        expect(osdu.data.ExtensionProperties.RoundTripFidelity).toBe("full");
        expect(osdu.data.ExtensionProperties.SeismicReferenceDatum).toBe(30);
        expect(osdu.data.ExtensionProperties.WeatheringVelocity).toBe(1800);
        expect(osdu.data.ExtensionProperties.LocalTime3dCrsUUID).toBe("tcrs");
    });

    it("2.0.2 is LOSSY fidelity — seismic datum has no RESQML home, flagged as such", () => {
        // 2.0.x drops the seismic acquisition metadata: the frame object carries none of it.
        const [frame] = buildCheckshot({
            title: "CS-lossy",
            hdfUuid: "hdf",
            version: "2.0.2",
            trajectoryUuid: "traj",
            seismicReferenceDatum: 30,
            weatheringVelocity: 1800,
            timeCrsUuid: "tcrs",
            mds,
            times,
        });
        expect((frame.object as any).SeismicReferenceDatum).toBeUndefined();
        const osdu = toOsduWellLog(frame.object, { version: "2.0.2", mds });
        expect(osdu.data.SamplingDomain).toBe("depth");
        expect(osdu.data.ExtensionProperties.RoundTripFidelity).toBe("lossy");
        expect(osdu.data.ExtensionProperties.SeismicReferenceDatum).toBeUndefined();
        expect(osdu.data.ExtensionProperties.LocalTime3dCrsUUID).toBeUndefined();
        expect(osdu.data.ExtensionProperties["x-resqml-type"]).toBe("WellboreFrameRepresentation");
    });
});

// ── Blocked wellbore (trajectory ⇄ grid-cell intersection) ───────────────────
describe("blocked wellbore (BlockedWellboreRepresentation)", () => {
    const base = {
        title: "BW-1",
        hdfUuid: "hdf",
        trajectoryUuid: "traj",
        gridUuids: ["grid-a"],
        nodeMd: [1500, 1600, 1700, 1800],
        gridIndices: [-1, 0, 0],
        cellIndices: [100, 101],
    };

    it("builds a BlockedWellboreRepresentation with the RESQML topology + arrays", () => {
        const { object, arrays } = buildBlockedWellbore(base);
        const o = object as any;
        expect(o.$type).toBe("resqml20.obj_BlockedWellboreRepresentation");
        expect(o.NodeCount).toBe(4);
        // CellCount = number of non-null (>= 0) gridIndices entries.
        expect(o.CellCount).toBe(2);
        expect(o.Trajectory.UUID).toBe("traj");
        expect(o.Grid.map((g: any) => g.UUID)).toEqual(["grid-a"]);
        expect(o.GridIndices.$type).toBe("resqml20.IntegerHdf5Array");
        expect(o.GridIndices.NullValue).toBe(-1);
        // Four arrays: nodeMd (double) + cellIndices/gridIndices/localFacePair (int).
        const paths = arrays.map((a) => a.PathInResource.split("/").pop());
        expect(paths).toEqual(["nodeMd", "cellIndices", "gridIndices", "localFacePairPerCellIndices"]);
        expect(arrays.map((a) => a.Data)).toEqual([
            base.nodeMd,
            base.cellIndices,
            base.gridIndices,
            [-1, -1, -1, -1], // localFacePair defaults to all-null, length 2·CellCount
        ]);
    });

    it("rejects a gridIndices length that is not NodeCount-1", () => {
        expect(() => buildBlockedWellbore({ ...base, gridIndices: [0, 0] })).toThrow(/interval count/i);
    });

    it("rejects a cellIndices length that is not CellCount", () => {
        expect(() => buildBlockedWellbore({ ...base, cellIndices: [100] })).toThrow(/CellCount/i);
    });

    it("rejects a grid index out of range for the supplied grids", () => {
        expect(() => buildBlockedWellbore({ ...base, gridIndices: [-1, 0, 1] })).toThrow(/out of range/i);
    });

    it("carries a property that references the blocked wellbore as supporting representation", () => {
        const bw = buildBlockedWellbore(base);
        const perm = buildContinuousProperty({
            title: "Blocked PERMX",
            hdfUuid: "hdf",
            supportingRepUuid: bw.object.Uuid as string,
            supportingRepType: "obj_BlockedWellboreRepresentation",
            kind: "permeability rock",
            uom: "mD",
            indexable: "cells",
            values: [100, 250],
        });
        const p = perm.object as any;
        expect(p.SupportingRepresentation.UUID).toBe(bw.object.Uuid);
        expect(p.SupportingRepresentation.ContentType).toMatch(/obj_BlockedWellboreRepresentation/);
        expect(p.IndexableElement).toBe("cells");
    });
});

// ── Grid connection set (fault cell-connections + MULTFLT) ───────────────────
describe("grid connection set (GridConnectionSetRepresentation)", () => {
    const base = {
        title: "GCS-1",
        hdfUuid: "hdf",
        gridUuids: ["grid-a"],
        cellIndexPairs: [0, 1, 1, 2],
    };

    it("builds a GridConnectionSetRepresentation with CellIndexPairs + Count + Grid", () => {
        const { object, arrays } = buildGridConnectionSet(base);
        const o = object as any;
        expect(o.$type).toBe("resqml20.obj_GridConnectionSetRepresentation");
        expect(o.Count).toBe(2);
        expect(o.Grid.map((g: any) => g.UUID)).toEqual(["grid-a"]);
        expect(o.Grid[0].ContentType).toMatch(/obj_IjkGridRepresentation/);
        expect(o.CellIndexPairs.$type).toBe("resqml20.IntegerHdf5Array");
        expect(o.GridIndexPairs).toBeUndefined();
        expect(o.ConnectionInterpretations).toBeUndefined();
        const cellArr = arrays.find((a) => a.PathInResource.endsWith("cellIndexPairs"));
        expect(cellArr?.Dimensions).toEqual([2, 2]);
        expect(cellArr?.Data).toEqual([0, 1, 1, 2]);
    });

    it("emits GridIndexPairs + LocalFacePerCellIndexPairs when supplied", () => {
        const { object, arrays } = buildGridConnectionSet({
            ...base,
            gridUuids: ["grid-a", "grid-b"],
            gridIndexPairs: [0, 1, 0, 1],
            localFacePerCellIndexPairs: [3, 1, 2, 4],
        });
        const o = object as any;
        expect(o.GridIndexPairs.$type).toBe("resqml20.IntegerHdf5Array");
        expect(o.LocalFacePerCellIndexPairs.NullValue).toBe(-1);
        expect(arrays.some((a) => a.PathInResource.endsWith("gridIndexPairs"))).toBe(true);
        expect(arrays.some((a) => a.PathInResource.endsWith("localFacePerCellIndexPairs"))).toBe(true);
    });

    it("emits ConnectionInterpretations as a jagged array (one fault per connection)", () => {
        const { object, arrays } = buildGridConnectionSet({
            ...base,
            interpretations: {
                featureInterpretationUuids: ["fault-x"],
                interpretationIndexPerConnection: [0, 0],
            },
        });
        const o = object as any;
        const ci = o.ConnectionInterpretations;
        expect(ci.FeatureInterpretation.map((f: any) => f.UUID)).toEqual(["fault-x"]);
        expect(ci.FeatureInterpretation[0].ContentType).toMatch(/obj_FaultInterpretation/);
        expect(ci.InterpretationIndices.$type).toBe("resqml20.ResqmlJaggedArray");
        const cum = arrays.find((a) => a.PathInResource.endsWith("cumulativeLength"));
        expect(cum?.Data).toEqual([1, 2]); // one interpretation per connection
    });

    it("requires gridIndexPairs when more than one grid is referenced", () => {
        expect(() => buildGridConnectionSet({ ...base, gridUuids: ["grid-a", "grid-b"] })).toThrow(/gridIndexPairs is required/i);
    });

    it("rejects an odd-length cellIndexPairs", () => {
        expect(() => buildGridConnectionSet({ ...base, cellIndexPairs: [0, 1, 2] })).toThrow(/multiple of 2/i);
    });

    it("rejects an interpretation index out of range", () => {
        expect(() =>
            buildGridConnectionSet({
                ...base,
                interpretations: { featureInterpretationUuids: ["fault-x"], interpretationIndexPerConnection: [0, 1] },
            }),
        ).toThrow(/out of range/i);
    });
});

// ── Fault transmissibility multiplier (MULTFLT ContinuousProperty) ───────────
describe("fault transmissibility multiplier (MULTFLT)", () => {
    it("builds a ContinuousProperty on the connection set, kind=property multiplier, contacts/Euc", () => {
        const { object } = buildFaultTransmissibilityMultiplier({
            hdfUuid: "hdf",
            connectionSetUuid: "gcs-1",
            multipliers: [0.25, 0.1],
        });
        const o = object as any;
        expect(o.$type).toBe("resqml20.obj_ContinuousProperty");
        expect(o.Citation.Title).toBe("MULTFLT");
        expect(o.SupportingRepresentation.UUID).toBe("gcs-1");
        expect(o.SupportingRepresentation.ContentType).toMatch(/obj_GridConnectionSetRepresentation/);
        expect(o.IndexableElement).toBe("contacts");
        expect(o.UOM).toBe("Euc");
        expect(o.PropertyKind.Kind).toBe("property multiplier");
    });

    it("rejects an empty multiplier list", () => {
        expect(() => buildFaultTransmissibilityMultiplier({ hdfUuid: "hdf", connectionSetUuid: "g", multipliers: [] })).toThrow(
            /at least one value/i,
        );
    });
});

// ── Reservoir zones (stratigraphic column) ───────────────────────────────────
describe("stratigraphic column (zones)", () => {
    it("emits an organisation feature + unit feature/interp per zone + a column rank", () => {
        const r = buildStratigraphicColumn({
            title: "Drogon zonation",
            zones: [{ name: "Valysar" }, { name: "Volon", depositionMode: "parallel to top" }],
        });
        const org = r.objects.find((o: any) => o.$type === "resqml20.obj_OrganizationFeature") as any;
        expect(org.OrganizationKind).toBe("stratigraphic");
        expect(r.objects.filter((o: any) => o.$type === "resqml20.obj_StratigraphicUnitFeature")).toHaveLength(2);
        expect(r.objects.filter((o: any) => o.$type === "resqml20.obj_StratigraphicUnitInterpretation")).toHaveLength(2);
        const rank = r.objects.find((o: any) => o.$type === "resqml20.obj_StratigraphicColumnRankInterpretation") as any;
        expect(rank.Uuid).toBe(r.rankUuid);
        expect(rank.OrderingCriteria).toBe("age");
        expect(rank.Index).toBe(0);
        expect(rank.Domain).toBe("depth");
        expect(rank.InterpretedFeature.UUID).toBe(r.featureUuid);
        expect(rank.StratigraphicUnits).toHaveLength(2);
        expect(rank.StratigraphicUnits[0].Index).toBe(0);
        expect(rank.StratigraphicUnits[1].Unit.UUID).toBe(r.unitInterpretationUuids[1]);
    });

    it("carries deposition mode onto the unit interpretation", () => {
        const r = buildStratigraphicColumn({ title: "z", zones: [{ name: "A", depositionMode: "parallel to bottom" }] });
        const interp = r.objects.find((o: any) => o.$type === "resqml20.obj_StratigraphicUnitInterpretation") as any;
        expect(interp.DepositionMode).toBe("parallel to bottom");
        expect(interp.InterpretedFeature.ContentType).toMatch(/obj_StratigraphicUnitFeature/);
    });

    it("includes a top-level StratigraphicColumn by default and can omit it", () => {
        const withCol = buildStratigraphicColumn({ title: "z", zones: [{ name: "A" }] });
        const col = withCol.objects.find((o: any) => o.$type === "resqml20.obj_StratigraphicColumn") as any;
        expect(col.Ranks[0].UUID).toBe(withCol.rankUuid);
        expect(withCol.columnUuid).toBe(col.Uuid);

        const noCol = buildStratigraphicColumn({ title: "z", zones: [{ name: "A" }], includeColumn: false });
        expect(noCol.objects.find((o: any) => o.$type === "resqml20.obj_StratigraphicColumn")).toBeUndefined();
        expect(noCol.columnUuid).toBeUndefined();
    });

    it("rejects an empty zone list", () => {
        expect(() => buildStratigraphicColumn({ title: "z", zones: [] })).toThrow(/at least one zone/i);
    });
});

// ── Reservoir regions (SATNUM/PVTNUM/… tags) ─────────────────────────────────
describe("region set (reservoir regions)", () => {
    it("with a legend, emits a StringTableLookup + a CategoricalProperty referencing it", () => {
        const r = buildRegionSet({
            title: "SATNUM",
            hdfUuid: "hdf",
            supportingRepUuid: "grid-1",
            regionCodes: [1, 1, 2, 2],
            legend: [
                { code: 1, name: "Aquifer" },
                { code: 2, name: "Oil" },
            ],
        });
        const lookup = r.objects.find((o: any) => o.$type === "resqml20.obj_StringTableLookup") as any;
        expect(lookup.Uuid).toBe(r.lookupUuid);
        expect(lookup.Value).toEqual([
            expect.objectContaining({ Key: 1, Value: "Aquifer" }),
            expect.objectContaining({ Key: 2, Value: "Oil" }),
        ]);
        const prop = r.objects.find((o: any) => o.$type === "resqml20.obj_CategoricalProperty") as any;
        expect(prop.Uuid).toBe(r.propertyUuid);
        expect(prop.Lookup.UUID).toBe(r.lookupUuid);
        expect(prop.SupportingRepresentation.UUID).toBe("grid-1");
        expect(prop.IndexableElement).toBe("cells");
        expect(r.arrays[0].Data).toEqual([1, 1, 2, 2]);
        expect(r.arrays[0].ArrayType).toBe("Int32Array");
    });

    it("without a legend, falls back to a plain DiscreteProperty", () => {
        const r = buildRegionSet({ title: "FIPNUM", hdfUuid: "hdf", supportingRepUuid: "grid-1", regionCodes: [3, 3, 3] });
        expect(r.objects).toHaveLength(1);
        expect((r.objects[0] as any).$type).toBe("resqml20.obj_DiscreteProperty");
        expect(r.lookupUuid).toBeUndefined();
    });

    it("buildCategoricalProperty carries the lookup DOR and integer array", () => {
        const { object, arrays } = buildCategoricalProperty({
            title: "SATNUM",
            hdfUuid: "hdf",
            supportingRepUuid: "grid-1",
            supportingRepType: "obj_IjkGridRepresentation",
            lookupUuid: "lookup-1",
            kind: "index",
            values: [0, 1, 2],
        });
        const o = object as any;
        expect(o.$type).toBe("resqml20.obj_CategoricalProperty");
        expect(o.Lookup.UUID).toBe("lookup-1");
        expect(o.Lookup.ContentType).toMatch(/obj_StringTableLookup/);
        expect(arrays[0].ArrayType).toBe("Int32Array");
    });

    it("buildStringTableLookup maps codes to names", () => {
        const { object } = buildStringTableLookup({ title: "legend", entries: [{ code: 5, name: "Gas" }] });
        const o = object as any;
        expect(o.$type).toBe("resqml20.obj_StringTableLookup");
        expect(o.Value[0]).toEqual(expect.objectContaining({ Key: 5, Value: "Gas" }));
    });
});

// ── Rock-fluid organisation (multi-region fluid model, RESQML 2.2) ───────────
describe("rock-fluid organisation (multi-region fluid model)", () => {
    it("emits a Model + feature/interpretation per unit + org listing every unit (2.2)", () => {
        const r = buildRockFluidModel({
            title: "Drogon fluids",
            units: [
                { name: "Gas cap", phase: "gas cap" },
                { name: "Oil column", phase: "oil column" },
                { name: "Aquifer", phase: "aquifer" },
            ],
        });
        // one Model organisation feature
        expect(r.objects.filter((o: any) => o.$type === "resqml22.Model")).toHaveLength(1);
        // a RockVolumeFeature + RockFluidUnitInterpretation per unit
        expect(r.objects.filter((o: any) => o.$type === "resqml22.RockVolumeFeature")).toHaveLength(3);
        const interps = r.objects.filter((o: any) => o.$type === "resqml22.RockFluidUnitInterpretation") as any[];
        expect(interps).toHaveLength(3);
        expect(interps.map(i => i.Phase)).toEqual(["gas cap", "oil column", "aquifer"]);
        // the organisation lists every unit (genuine multi-region: unbounded list)
        const org = r.objects.find((o: any) => o.$type === "resqml22.RockFluidOrganizationInterpretation") as any;
        expect(org.Uuid).toBe(r.orgUuid);
        expect(org.SchemaVersion).toBe("2.2");
        expect(org.InterpretedFeature.QualifiedType).toBe("resqml22.Model");
        expect(org.InterpretedFeature.Uuid).toBe(r.orgFeatureUuid);
        expect(org.RockFluidUnit).toHaveLength(3);
        expect(org.RockFluidUnit.map((u: any) => u.Uuid)).toEqual(r.unitInterpretationUuids);
        expect(org.RockFluidUnit[0].QualifiedType).toBe("resqml22.RockFluidUnitInterpretation");
    });

    it("emits a BoundaryFeature + FluidBoundaryInterpretation per fluid contact", () => {
        const r = buildRockFluidModel({
            title: "fluids",
            units: [{ name: "Oil" }, { name: "Water" }],
            boundaries: [
                { name: "OWC", contact: "water oil contact" },
                { name: "GOC", contact: "gas oil contact" },
            ],
        });
        expect(r.objects.filter((o: any) => o.$type === "resqml22.BoundaryFeature")).toHaveLength(2);
        const fbis = r.objects.filter((o: any) => o.$type === "resqml22.FluidBoundaryInterpretation") as any[];
        expect(fbis).toHaveLength(2);
        expect(fbis.map(f => f.FluidContact)).toEqual(["water oil contact", "gas oil contact"]);
        expect(fbis[0].InterpretedFeature.QualifiedType).toBe("resqml22.BoundaryFeature");
        expect(r.boundaryInterpretationUuids).toEqual(fbis.map(f => f.Uuid));
    });

    it("uses eml23 top-level QualifiedType DORs on the 2.2.0 line", () => {
        const r = buildRockFluidModel({ title: "f", version: "2.2.0", units: [{ name: "Oil" }] });
        const org = r.objects.find((o: any) => o.$type === "resqml22.RockFluidOrganizationInterpretation") as any;
        expect(org.SchemaVersion).toBe("2.2");
        expect(org.RockFluidUnit[0].$type).toBe("eml23.DataObjectReference");
    });

    it("rejects an empty unit list", () => {
        expect(() => buildRockFluidModel({ title: "f", units: [] })).toThrow(/at least one fluid unit/i);
    });

    it("rejects RESQML 2.0.1 (single-unit organisation cannot be multi-region)", () => {
        expect(() => buildRockFluidModel({ title: "f", version: "2.0.1", units: [{ name: "Oil" }] })).toThrow(
            /2\.2\.0\+/,
        );
    });
});

// ── Grid re-authoring children (interval→zone, cell→fluid-unit maps) ──────────
describe("grid-child mappings (re-authoring)", () => {
    it("buildIntervalStratigraphicUnits emits a StratigraphicOrganization DOR + interval index array", () => {
        const r = buildIntervalStratigraphicUnits({
            gridUuid: "grid-1",
            hdfUuid: "hdf-1",
            stratigraphicColumnRankUuid: "rank-1",
            unitIndices: [0, 0, 1, 2, -1],
        });
        expect(r.childKey).toBe("IntervalStratigraphicUnits");
        const child = r.child as any;
        expect(child.StratigraphicOrganization.UUID).toBe("rank-1");
        expect(child.StratigraphicOrganization.ContentType).toMatch(/obj_StratigraphicColumnRankInterpretation/);
        // 2.0.1 default → HDF5 integer array, null = -1
        expect(child.UnitIndices.$type).toBe("resqml20.IntegerHdf5Array");
        expect(child.UnitIndices.NullValue).toBe(-1);
        expect(r.array.Data).toEqual([0, 0, 1, 2, -1]);
        expect(r.array.ArrayType).toBe("Int32Array");
        expect(r.array.Dimensions).toEqual([5]);
        expect(r.array.PathInResource).toBe(r.path);
    });

    it("buildCellFluidPhaseUnits references a 2.2 fluid org from a 2.0.1 grid via a cross-version DOR", () => {
        const r = buildCellFluidPhaseUnits({
            gridUuid: "grid-1",
            hdfUuid: "hdf-1",
            fluidOrganizationUuid: "org-1",
            phaseUnitIndices: [0, 1, -1],
        });
        expect(r.childKey).toBe("CellFluidPhaseUnits");
        const child = r.child as any;
        // envelope shape follows the grid (2.0.1 → eml20 ContentType + UUID) …
        expect(child.FluidOrganization.$type).toBe("eml20.DataObjectReference");
        expect(child.FluidOrganization.UUID).toBe("org-1");
        // … but the content-type version token names the 2.2 target org
        expect(child.FluidOrganization.ContentType).toMatch(/version=2\.2;type=RockFluidOrganizationInterpretation/);
        expect(child.PhaseUnitIndices.$type).toBe("resqml20.IntegerHdf5Array");
        expect(r.array.Data).toEqual([0, 1, -1]);
        expect(r.array.ArrayType).toBe("Int32Array");
    });

    it("emits an external integer array for a 2.2 grid", () => {
        const r = buildIntervalStratigraphicUnits({
            gridUuid: "grid-2",
            hdfUuid: "hdf-2",
            stratigraphicColumnRankUuid: "rank-2",
            unitIndices: [0, 1],
            version: "2.2.0",
        });
        expect((r.child as any).UnitIndices.$type).toBe("eml23.IntegerExternalArray");
    });

    it("rejects empty index arrays", () => {
        expect(() =>
            buildIntervalStratigraphicUnits({
                gridUuid: "g",
                hdfUuid: "h",
                stratigraphicColumnRankUuid: "r",
                unitIndices: [],
            }),
        ).toThrow(/non-empty/i);
        expect(() =>
            buildCellFluidPhaseUnits({ gridUuid: "g", hdfUuid: "h", fluidOrganizationUuid: "o", phaseUnitIndices: [] }),
        ).toThrow(/non-empty/i);
    });
});

// ── §10.6 #6 — WPC classification / manifest mapping ─────────────────────────
describe("seismic WPC classification + manifest mapping (§10.6 #6)", () => {
    it("Grid2d in time → SeismicHorizon; depth → StructureMap (CRS-domain driven)", () => {
        const timeGrid = buildGrid2d({
            title: "Top Draupne (TWT)",
            hdfUuid: "hdf",
            crsUuid: "crs-1",
            crsType: "obj_LocalTime3dCrs",
            interpretationUuid: "hz-1",
            ni: 2,
            nj: 2,
            origin: { x: 100, y: 200 },
            iSpacing: 25,
            jSpacing: 25,
            zValues: [1000, 1010, 1020, 1030],
        });
        const cTime = classifySeismicObject(timeGrid.object);
        expect(cTime.wpc).toBe("SeismicHorizon");
        expect(cTime.domain).toBe("time");

        const depthGrid = buildGrid2d({
            title: "Top Draupne (depth)",
            hdfUuid: "hdf",
            crsUuid: "crs-1",
            crsType: "obj_LocalDepth3dCrs",
            ni: 2,
            nj: 2,
            origin: { x: 0, y: 0 },
            iSpacing: 10,
            jSpacing: 10,
            zValues: [1, 2, 3, 4],
        });
        expect(classifySeismicObject(depthGrid.object).wpc).toBe("StructureMap");
    });

    it("PolylineSet → SeismicFault carrying survey/bin-grid context", () => {
        const sticks = buildPolylineSet({
            title: "Fault F1",
            hdfUuid: "hdf",
            crsUuid: "crs-1",
            crsType: "obj_LocalTime3dCrs",
            interpretationUuid: "flt-1",
            polylines: [[0, 0, 100, 10, 0, 120]],
        });
        expect(classifySeismicObject(sticks.object).wpc).toBe("SeismicFault");

        const wpc = buildSeismicWpc(sticks.object, {
            points: [0, 0, 100, 10, 0, 120],
            cubeRefs: [parseSdmsRef("osdu:work-product-component--SeismicBinGrid:bg9:", "bin-grid")],
        });
        expect(wpc.kind).toBe("osdu:wks:work-product-component--SeismicFault:1.0.0");
        const data = (wpc as any).data;
        expect(data.FaultInterpretationID).toBe("flt-1");
        expect(data.SeismicBinGridID).toContain("osdu:work-product-component--SeismicBinGrid:bg9:");
        expect(data.SpatialArea).toEqual({ XMin: 0, XMax: 10, YMin: 0, YMax: 0 });
        expect(data.ExtensionProperties["x-resqml-type"]).toBe("PolylineSetRepresentation");
    });

    it("SeismicHorizon manifest stamps interpretation link + reversibility metadata", () => {
        const grid = buildGrid2d({
            title: "H1",
            hdfUuid: "hdf",
            crsUuid: "crs-1",
            crsType: "obj_LocalTime3dCrs",
            interpretationUuid: "hz-9",
            ni: 2,
            nj: 2,
            origin: { x: 5, y: 5 },
            iSpacing: 1,
            jSpacing: 1,
            zValues: [1, 2, 3, 4],
        });
        const wpc = buildSeismicWpc(grid.object) as any;
        expect(wpc.kind).toBe("osdu:wks:work-product-component--SeismicHorizon:1.0.0");
        expect(wpc.data.SeismicDomainType).toBe("time");
        expect(wpc.data.IsInterpreted).toBe(true);
        expect(wpc.data.HorizonInterpretationID).toBe("hz-9");
        expect(wpc.data.ExtensionProperties.ResqmlObjectUUID).toBe(grid.object.Uuid);
        expect(wpc.data.ExtensionProperties.ResqmlSchemaVersion).toBe("2.0.0.20140822");
    });

    it("ContinuousProperty delegates to GenericProperty projection", () => {
        const prop = buildContinuousProperty({
            title: "RMS amplitude",
            hdfUuid: "hdf",
            supportingRepUuid: "grid-1",
            supportingRepType: "obj_Grid2dRepresentation",
            kind: "amplitude",
            uom: "Euc",
            values: [1, 2, 3],
        });
        const wpc = buildSeismicWpc(prop.object) as any;
        expect(wpc.kind).toBe("osdu:wks:work-product-component--GenericProperty:1.0.0");
        expect(wpc.data.Name).toBe("RMS amplitude");
    });

    it("spatialAreaFromPoints computes the XY bbox, ignoring Z", () => {
        expect(spatialAreaFromPoints([1, 2, 99, 5, -3, 0])).toEqual({ XMin: 1, XMax: 5, YMin: -3, YMax: 2 });
        expect(spatialAreaFromPoints([])).toBeUndefined();
    });

    it("velocity model classifies + projects as a velocity-aware GenericProperty", () => {
        const vel = buildVelocityModel({
            title: "Interval velocity",
            hdfUuid: "hdf",
            supportingRepUuid: "grid-1",
            supportingRepType: "obj_Grid2dRepresentation",
            velocityKind: "interval",
            values: [2500, 2600, 2700],
        });
        const cls = classifySeismicObject(vel.object);
        expect(cls.wpc).toBe("GenericProperty");
        expect(cls.velocityKind).toBe("interval velocity");

        const wpc = buildSeismicWpc(vel.object) as any;
        expect(wpc.kind).toBe("osdu:wks:work-product-component--GenericProperty:1.0.0");
        expect(wpc.data.PropertyType).toBe("interval velocity");
        expect(wpc.data.ExtensionProperties.VelocityKind).toBe("interval velocity");
    });

    it("3D velocity volume (IjkGrid property) → GenericProperty", () => {
        const volume = buildContinuousProperty({
            title: "Vp volume",
            hdfUuid: "hdf",
            supportingRepUuid: "ijk-1",
            supportingRepType: "obj_IjkGridRepresentation",
            kind: "Vp",
            uom: "m/s",
            values: [3000, 3100, 3200, 3300],
        });
        const cls = classifySeismicObject(volume.object);
        expect(cls.wpc).toBe("GenericProperty");
        expect(cls.velocityKind).toBe("Vp");
    });

    it("wellbore frame (checkshot / T-Z) → WellLog", () => {
        const frame = buildWellboreFrame({
            title: "Checkshot survey",
            hdfUuid: "hdf",
            trajectoryUuid: "traj-1",
            nodeMd: [0, 500, 1000],
            version: "2.2.0",
        });
        expect(classifySeismicObject(frame.object).wpc).toBe("WellLog");
        const wpc = buildSeismicWpc(frame.object, { version: "2.2.0", mds: [0, 500, 1000] }) as any;
        expect(wpc.kind).toBe("osdu:wks:work-product-component--WellLog:1.3.0");
    });

    it("seismic trace/bin-grid data is SDMS/VDS domain — relate only, never projected", () => {
        const lattice = { $type: "resqml22.obj_SeismicLatticeRepresentation", Uuid: "lat-1", Citation: { Title: "Cube A" } } as any;
        const cls = classifySeismicObject(lattice);
        expect(cls.geometry).toBe("seismicCube");
        expect(cls.sdmsDomain).toBe(true);
        expect(() => buildSeismicWpc(lattice)).toThrow(/SDMS\/VDS domain/);

        const binGrid = { $type: "resqml22.obj_SeismicBinGridRepresentation", Uuid: "bg-1", Citation: { Title: "BinGrid A" } } as any;
        expect(classifySeismicObject(binGrid).sdmsDomain).toBe(true);
        expect(() => buildSeismicWpc(binGrid)).toThrow(/relate/i);
    });
});

// ── §10.6 #5 — SDMS↔RDDMS cross-store bridge resolver ────────────────────────
describe("SDMS↔RDDMS bridge resolver (§10.6 #5)", () => {
    const horizonWpc = {
        kind: "osdu:wks:work-product-component--SeismicHorizon:1.0.0",
        data: {
            Name: "Top Draupne",
            SeismicTraceDataID: "osdu:work-product-component--SeismicTraceData:cubeA:",
            SeismicBinGridID: "osdu:work-product-component--SeismicBinGrid:bgA:",
        },
    };

    it("parseSdmsRef normalises OSDU SRNs and SDMS URIs", () => {
        const srn = parseSdmsRef("osdu:work-product-component--SeismicTraceData:cubeA:");
        expect(srn.kind).toBe("trace-data");
        expect(srn.entity).toBe("SeismicTraceData");
        expect(srn.guid).toBe("cubeA");

        const uri = parseSdmsRef("sd://tenant/subproject/cubeX", "trace-data");
        expect(uri.sdmsUri).toBe("sd://tenant/subproject/cubeX");
        expect(uri.kind).toBe("trace-data");
    });

    it("forward: resolveCubeRefs extracts trace + bin-grid handles", () => {
        const refs = resolveCubeRefs(horizonWpc);
        const kinds = refs.map((r) => r.kind).sort();
        expect(kinds).toEqual(["bin-grid", "trace-data"]);
        expect(refs.find((r) => r.kind === "trace-data")?.guid).toBe("cubeA");
    });

    it("withCubeRefs merges handles onto a WPC without mutating the input", () => {
        const base = { kind: "osdu:wks:work-product-component--SeismicFault:1.0.0", data: { Name: "F1" } };
        const stamped = withCubeRefs(base, [parseSdmsRef("osdu:x--SeismicTraceData:c1:", "trace-data")]) as any;
        expect(stamped.data.SeismicTraceDataID).toBe("osdu:x--SeismicTraceData:c1:");
        expect((base.data as any).SeismicTraceDataID).toBeUndefined();
    });

    it("reverse: index + interpretationsForCube answer 'which cube was this picked on'", () => {
        const items = [
            { id: "hz-1", wpc: horizonWpc },
            {
                id: "flt-1",
                wpc: { data: { SeismicTraceDataID: "osdu:work-product-component--SeismicTraceData:cubeA:" } },
            },
            {
                id: "hz-2",
                wpc: { data: { SeismicTraceDataID: "osdu:work-product-component--SeismicTraceData:cubeB:" } },
            },
        ];
        const onCubeA = interpretationsForCube(items, "cubeA");
        expect(onCubeA).toEqual(["flt-1", "hz-1"]);

        const index = indexInterpretationsByCube(items);
        const traceEntries = index.filter((e) => e.ref.kind === "trace-data");
        expect(traceEntries).toHaveLength(2);
        expect(traceEntries.find((e) => e.ref.guid === "cubeA")?.interpretations).toEqual(["flt-1", "hz-1"]);
    });
});

// ============================================================================
// RESQML IjkGrid ⇄ OPM/GRDECL corner-point round-trip (grid interop)
// ============================================================================

/** Build a regular box corner-point grid (vertical pillars, flat layers). */
function regularGrid(ni: number, nj: number, nk: number, dx = 100, dy = 100, dz = 50): CornerPointGrid {
    const coord = new Float64Array((ni + 1) * (nj + 1) * 6);
    for (let pj = 0; pj <= nj; pj++) {
        for (let pi = 0; pi <= ni; pi++) {
            const p = (pj * (ni + 1) + pi) * 6;
            coord[p] = pi * dx;
            coord[p + 1] = pj * dy;
            coord[p + 2] = 0;
            coord[p + 3] = pi * dx;
            coord[p + 4] = pj * dy;
            coord[p + 5] = nk * dz;
        }
    }
    const zcorn = new Float64Array(8 * ni * nj * nk);
    for (let k = 0; k < nk; k++)
        for (let j = 0; j < nj; j++)
            for (let i = 0; i < ni; i++)
                for (let kp = 0; kp < 2; kp++)
                    for (let jp = 0; jp < 2; jp++)
                        for (let ip = 0; ip < 2; ip++)
                            zcorn[zcornIndex({ ni, nj }, i, j, k, ip, jp, kp)] = (k + kp) * dz;
    return { ni, nj, nk, coord, zcorn };
}

/** Regular grid with a vertical fault throw applied to every cell with i >= faultI. */
function faultedGrid(ni: number, nj: number, nk: number, faultI: number, throwZ: number): CornerPointGrid {
    const g = regularGrid(ni, nj, nk);
    for (let k = 0; k < nk; k++)
        for (let j = 0; j < nj; j++)
            for (let i = faultI; i < ni; i++)
                for (let kp = 0; kp < 2; kp++)
                    for (let jp = 0; jp < 2; jp++)
                        for (let ip = 0; ip < 2; ip++)
                            g.zcorn[zcornIndex({ ni, nj }, i, j, k, ip, jp, kp)] += throwZ;
    return g;
}

function expectArraysClose(a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-6): void {
    expect(a.length).toBe(b.length);
    for (let idx = 0; idx < a.length; idx++) {
        if (Math.abs(a[idx] - b[idx]) > tol) {
            throw new Error(`arrays differ at ${idx}: ${a[idx]} != ${b[idx]}`);
        }
    }
}

describe("IjkGrid ⇄ corner-point round-trip (grid interop)", () => {
    it("unfaulted grid: RESQML coordinate lines decode back with no split lines", () => {
        const g = regularGrid(3, 2, 2);
        const cl = cornerPointToCoordinateLines(g);
        expect(cl.splitCount).toBe(0);
        expect(cl.nCoordLines).toBe((3 + 1) * (2 + 1));
        expect(cl.nkl).toBe(3);

        const back = ijkGridToCornerPoint({ ni: g.ni, nj: g.nj, nk: g.nk, nodes: cl.nodes });
        expectArraysClose(back.zcorn, g.zcorn);
        expectArraysClose(back.coord, g.coord);
    });

    it("faulted grid: split coordinate lines are synthesised and preserve fault throw", () => {
        const g = faultedGrid(2, 2, 2, 1, 25);
        const cl = cornerPointToCoordinateLines(g);
        // The interior pillar column (pi=1) is split for every pj → nj+1 split lines.
        expect(cl.splitCount).toBe(g.nj + 1);
        expect(cl.pillarIndices.length).toBe(cl.splitCount);
        // ColumnsPerSplitCoordinateLine cumulative length ends at the element count.
        expect(cl.columnsCumulative[cl.columnsCumulative.length - 1]).toBe(cl.columnsElements.length);

        const back = ijkGridToCornerPoint({
            ni: g.ni,
            nj: g.nj,
            nk: g.nk,
            nodes: cl.nodes,
            split: {
                count: cl.splitCount,
                pillarIndices: cl.pillarIndices,
                columnsElements: cl.columnsElements,
                columnsCumulative: cl.columnsCumulative,
            },
        });
        // Fault throw is carried entirely by ZCORN and must round-trip exactly.
        expectArraysClose(back.zcorn, g.zcorn);
    });

    it("buildIjkGrid emits geometry + split arrays referencing the HDF proxy", () => {
        const g = faultedGrid(2, 2, 2, 1, 25);
        const built = buildIjkGrid({ title: "Faulted Test Grid", hdfUuid: "hdf-1", crsUuid: "crs-1", grid: g });
        const obj = built.object as any;
        expect(obj.$type).toBe("resqml20.obj_IjkGridRepresentation");
        expect(obj.Ni).toBe(2);
        expect(obj.Nj).toBe(2);
        expect(obj.Nk).toBe(2);
        expect(obj.Geometry.$type).toBe("resqml20.IjkGridGeometry");
        expect(obj.Geometry.KDirection).toBe("down");
        expect(obj.Geometry.SplitCoordinateLines.Count).toBe(3);
        // points + 3 split arrays (pillarIndices, elements, cumulativeLength).
        expect(built.arrays).toHaveLength(4);
        const paths = built.arrays.map((a) => a.PathInResource);
        expect(paths.some((p) => p.endsWith("/points"))).toBe(true);
        expect(paths.some((p) => p.endsWith("/pillarIndices"))).toBe(true);
    });

    it("GRDECL serialize → parse round-trips dims, COORD, ZCORN, ACTNUM and a property", () => {
        const g = regularGrid(2, 2, 2);
        const ncell = g.ni * g.nj * g.nk;
        g.actnum = Int32Array.from({ length: ncell }, (_, i) => (i === 0 ? 0 : 1));
        g.properties = { PORO: Float64Array.from({ length: ncell }, () => 0.25) };

        const text = serializeGrdecl(g);
        expect(text).toContain("SPECGRID");
        expect(text).toContain("ZCORN");

        const parsed = parseGrdecl(text);
        expect(parsed.ni).toBe(2);
        expect(parsed.nj).toBe(2);
        expect(parsed.nk).toBe(2);
        expectArraysClose(parsed.coord, g.coord);
        expectArraysClose(parsed.zcorn, g.zcorn);
        expectArraysClose(parsed.actnum!, g.actnum);
        expectArraysClose(parsed.properties!.PORO, g.properties.PORO);
    });

    it("full loop: corner-point → RESQML → corner-point → GRDECL → corner-point (faulted)", () => {
        const g = faultedGrid(3, 3, 2, 2, 15);
        const cl = cornerPointToCoordinateLines(g);
        const viaResqml = ijkGridToCornerPoint({
            ni: g.ni,
            nj: g.nj,
            nk: g.nk,
            nodes: cl.nodes,
            split: {
                count: cl.splitCount,
                pillarIndices: cl.pillarIndices,
                columnsElements: cl.columnsElements,
                columnsCumulative: cl.columnsCumulative,
            },
        });
        const viaGrdecl = parseGrdecl(serializeGrdecl(viaResqml));
        expectArraysClose(viaGrdecl.zcorn, g.zcorn);
    });
});

describe("Binary grid export (EGRID geometry + INIT static properties)", () => {
    // Minimal reader for Fortran-unformatted (big-endian, Fortran-record) files:
    // returns each keyword's name/type/count plus decoded numeric payload.
    function readEclKeywords(
        bytes: Uint8Array
    ): { name: string; type: string; count: number; data: number[] }[] {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const dec = new TextDecoder("latin1");
        const out: { name: string; type: string; count: number; data: number[] }[] = [];
        let o = 0;
        const str = (n: number): string => {
            const s = dec.decode(bytes.subarray(o, o + n));
            o += n;
            return s;
        };
        while (o + 4 <= bytes.byteLength) {
            const hdrMarker = dv.getInt32(o, false);
            o += 4;
            if (hdrMarker !== 16) break;
            const name = str(8).trim();
            const count = dv.getInt32(o, false);
            o += 4;
            const type = str(4).trim();
            o += 4; // closing header marker
            const es = type === "DOUB" ? 8 : type === "CHAR" ? 8 : 4;
            const blk = type === "CHAR" ? 105 : 1000;
            const data: number[] = [];
            for (let i = 0; i < count; i += blk) {
                const cnt = Math.min(blk, count - i);
                o += 4; // block marker
                for (let j = 0; j < cnt; j++) {
                    if (type === "REAL") data.push(dv.getFloat32(o, false));
                    else if (type === "DOUB") data.push(dv.getFloat64(o, false));
                    else if (type === "CHAR") {
                        /* skip */
                    } else data.push(dv.getInt32(o, false));
                    o += es;
                }
                o += 4; // trailing block marker
            }
            out.push({ name, type, count, data });
        }
        return out;
    }

    it("serializeEgrid emits FILEHEAD/GRIDHEAD/COORD/ZCORN/ACTNUM and honours ACTNUM", () => {
        const g = regularGrid(2, 2, 2);
        const ncell = g.ni * g.nj * g.nk;
        g.actnum = Int32Array.from({ length: ncell }, (_, i) => (i === 0 ? 0 : 1));

        const kws = readEclKeywords(serializeEgrid(g));
        const byName = Object.fromEntries(kws.map((k) => [k.name, k]));
        expect(Object.keys(byName)).toEqual(
            expect.arrayContaining(["FILEHEAD", "GRIDHEAD", "COORD", "ZCORN", "ACTNUM", "ENDGRID"])
        );
        // GRIDHEAD carries grid type (1 = corner-point) and dimensions.
        expect(byName.GRIDHEAD.data[0]).toBe(1);
        expect(byName.GRIDHEAD.data.slice(1, 4)).toEqual([2, 2, 2]);
        expect(byName.COORD.count).toBe((g.ni + 1) * (g.nj + 1) * 6);
        expect(byName.ZCORN.count).toBe(8 * ncell);
        expect(byName.ACTNUM.data).toEqual([0, 1, 1, 1, 1, 1, 1, 1]);
    });

    it("serializeInit writes headers, global PORV and active-cell properties", () => {
        const g = regularGrid(2, 2, 2);
        const ncell = g.ni * g.nj * g.nk;
        g.actnum = Int32Array.from({ length: ncell }, (_, i) => (i === 0 ? 0 : 1));
        const poro = Float64Array.from({ length: ncell }, (_, i) => 0.1 * i);

        const bytes = serializeInit(g, [{ name: "Porosity", values: poro }], { actnum: g.actnum });
        const kws = readEclKeywords(bytes);
        const byName = Object.fromEntries(kws.map((k) => [k.name, k]));

        expect(kws.map((k) => k.name).slice(0, 4)).toEqual([
            "INTEHEAD",
            "LOGIHEAD",
            "DOUBHEAD",
            "PORV",
        ]);
        // INTEHEAD: NX/NY/NZ at 8/9/10, NACTIVE at 11 (7 active), phases at 14.
        expect(byName.INTEHEAD.data.slice(8, 12)).toEqual([2, 2, 2, 7]);
        expect(byName.INTEHEAD.data[14]).toBe(7);
        // PORV is global (all cells), 0 on the inactive cell.
        expect(byName.PORV.count).toBe(ncell);
        expect(byName.PORV.data[0]).toBe(0);
        // The property keyword is the 8-char mnemonic and holds active cells only.
        expect(byName.POROSITY.count).toBe(7);
        expect(byName.POROSITY.data.map((v) => Math.round(v * 10))).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    it("serializeInit rejects a property whose length is not the cell count", () => {
        const g = regularGrid(2, 2, 2);
        expect(() =>
            serializeInit(g, [{ name: "PORO", values: new Float64Array(3) }])
        ).toThrow(/cell count/i);
    });
});

describe("canonical grid-property registry (OSDU ⇄ RESQML ⇄ GRDECL/INIT)", () => {
    afterEach(() => resetGridPropertyRegistry());

    it("resolves GRDECL/INIT keywords and aliases to RESQML kind + UOM (import direction)", () => {
        expect(resqmlKindForKeyword("PORO")).toEqual({ kind: "porosity", uom: "m3/m3" });
        expect(resqmlKindForKeyword("PERMX")).toEqual({ kind: "rock permeability", uom: "mD" });
        // Alias SW resolves to the same mapping as SWAT.
        expect(lookupByKeyword("SW")?.keyword).toBe("SWAT");
        // Unknown keyword falls back to a dimensionless continuous kind.
        expect(resqmlKindForKeyword("XYZZY")).toEqual({ kind: "continuous", uom: "Euc" });
    });

    it("recovers a canonical GRDECL/INIT keyword from a descriptive RESQML Title (export direction)", () => {
        expect(toKeyword("Water saturation")).toBe("SWAT");
        expect(toKeyword("Initial water saturation")).toBe("SWATINIT");
        expect(toKeyword("Porosity")).toBe("PORO");
        expect(toKeyword("Permeability in the X direction")).toBe("PERMX");
        expect(toKeyword("Net to gross")).toBe("NTG");
        // Unmapped titles fall back to a sanitised ≤ 8-char token.
        expect(toKeyword("Some vendor curve!")).toBe("SOMEVEND");
        expect(toKeyword("...")).toBe("PROP");
    });

    it("maps by OSDU canonical name (source of truth)", () => {
        expect(lookupByOsdu("WaterSaturation")?.keyword).toBe("SWAT");
        expect(lookupByOsdu("Porosity")?.pwls).toBe("PORO");
        expect(lookupByTitle("InitialWaterSaturation")?.keyword).toBe("SWATINIT");
    });

    it("round-trips keyword → RESQML kind → OSDU → keyword stably", () => {
        for (const kw of ["PORO", "PERMX", "PERMY", "PERMZ", "SWAT", "SGAS", "NTG", "ACTNUM"]) {
            const m = lookupByKeyword(kw)!;
            expect(m).toBeDefined();
            expect(toKeyword(m.osdu)).toBe(m.keyword);
        }
    });

    it("is runtime-extensible and overridable via registerGridProperty", () => {
        const before = gridPropertyMappings().length;
        registerGridProperty({
            keyword: "SOILINIT",
            resqmlKind: "saturation",
            osdu: "InitialOilSaturation",
            uom: "m3/m3",
            titleTokens: ["init", "oil", "satur"]
        });
        expect(gridPropertyMappings().length).toBe(before + 1);
        expect(toKeyword("Initial oil saturation")).toBe("SOILINIT");
        expect(lookupByOsdu("InitialOilSaturation")?.keyword).toBe("SOILINIT");
        // Override a shipped default: PORO now carries a custom UOM.
        registerGridProperty({ keyword: "PORO", resqmlKind: "porosity", osdu: "Porosity", uom: "fraction" });
        expect(resqmlKindForKeyword("PORO").uom).toBe("fraction");
    });

    it("converts units linearly where a known relation exists, identity otherwise", () => {
        expect(convertUnitValue(1, "bar", "Pa")).toBeCloseTo(1e5, 6);
        expect(convertUnitValue(1, "bar", "psi")).toBeCloseTo(14.503773773, 6);
        expect(convertUnitValue(0, "degC", "degK")).toBeCloseTo(273.15, 6);
        expect(convertUnitValue(100, "degC", "degF")).toBeCloseTo(212, 6);
        // Fractional units are interchangeable identities.
        expect(convertUnitValue(0.3, "m3/m3", "Euc")).toBe(0.3);
        expect(canConvertUnit("mD", "m2")).toBe(true);
        // Unknown pair → identity pass-through (never corrupts the value).
        expect(convertUnitValue(42, "widgets", "gadgets")).toBe(42);
        expect(canConvertUnit("widgets", "gadgets")).toBe(false);
    });
});

// ── Wellbore marker frame (WellboreMarkerFrameRepresentation + FIRP) ─────────
describe("wellbore marker frame (WellboreMarkerFrameRepresentation)", () => {
    const base = {
        title: "55/33-1 markers",
        hdfUuid: "hdf",
        trajectoryUuid: "traj",
    };

    it("builds a marker frame with NodeMd, NodeCount and one WellboreMarker per pick", () => {
        const { parts, representationUuid } = buildWellboreMarkerFrame({
            ...base,
            markers: [
                { md: 1585, title: "Top Volantis" },
                { md: 1622.5, title: "Top Therys" },
            ],
        });
        // No linkage → only the frame is written (no FIRP objects).
        expect(parts).toHaveLength(1);
        const o = parts[0].object as any;
        expect(o.$type).toBe("resqml20.obj_WellboreMarkerFrameRepresentation");
        expect(o.Uuid).toBe(representationUuid);
        expect(o.NodeCount).toBe(2);
        expect(o.Trajectory.UUID).toBe("traj");
        expect(o.WellboreMarker).toHaveLength(2);
        expect(o.WellboreMarker[0].$type).toBe("resqml20.WellboreMarker");
        expect(o.WellboreMarker[0].GeologicBoundaryKind).toBeUndefined();
        expect(o.WellboreMarker[0].Interpretation).toBeUndefined();
        // NodeMd array carries the pick MDs.
        const md = parts[0].arrays.find((a) => a.PathInResource.endsWith("nodeMd"));
        expect(md?.Data).toEqual([1585, 1622.5]);
        expect(md?.Dimensions).toEqual([2]);
    });

    it("stamps GeologicBoundaryKind and auto-creates a Feature+Interpretation from a title", () => {
        const { parts, interpretationUuids } = buildWellboreMarkerFrame({
            ...base,
            markers: [
                { md: 1585, title: "Top Volantis", boundaryKind: "horizon", interpretationTitle: "Top Volantis" },
            ],
        });
        // FIRP feature + interpretation written ahead of the frame.
        expect(parts).toHaveLength(3);
        const frame = parts[parts.length - 1].object as any;
        const marker = frame.WellboreMarker[0];
        expect(marker.GeologicBoundaryKind).toBe("horizon");
        expect(marker.Interpretation.$type).toBe("eml20.DataObjectReference");
        expect(marker.Interpretation.UUID).toBe(interpretationUuids[0]);
        // The horizon interpretation object precedes the frame.
        expect(parts.map((p) => (p.object as any).$type)).toContain("resqml20.obj_HorizonInterpretation");
    });

    it("derives a deterministic interpretation UUID from an SRN and dedupes shared picks", () => {
        const srn = "osdu:work-product-component--HorizonInterpretation:TopVolantis";
        const a = buildWellboreMarkerFrame({
            ...base,
            markers: [
                { md: 1585, title: "Top Volantis A", boundaryKind: "horizon", interpretationSrn: srn },
                { md: 1590, title: "Top Volantis B", boundaryKind: "horizon", interpretationSrn: srn },
            ],
        });
        // Two markers share one SRN → one interpretation UUID, deduped objects.
        expect(a.interpretationUuids).toHaveLength(1);
        const frame = a.parts[a.parts.length - 1].object as any;
        expect(frame.WellboreMarker[0].Interpretation.UUID).toBe(a.interpretationUuids[0]);
        expect(frame.WellboreMarker[1].Interpretation.UUID).toBe(a.interpretationUuids[0]);
        // Determinism: the same SRN yields the same UUID on a fresh build.
        const b = buildWellboreMarkerFrame({
            ...base,
            markers: [{ md: 1585, title: "x", boundaryKind: "horizon", interpretationSrn: srn }],
        });
        expect(b.interpretationUuids[0]).toBe(a.interpretationUuids[0]);
    });

    it("references an existing interpretation verbatim (no FIRP objects created)", () => {
        const { parts, interpretationUuids } = buildWellboreMarkerFrame({
            ...base,
            markers: [{ md: 1585, title: "Top Volantis", boundaryKind: "horizon", interpretationUuid: "existing-interp" }],
        });
        expect(parts).toHaveLength(1); // only the frame
        expect(interpretationUuids).toEqual(["existing-interp"]);
        const frame = parts[0].object as any;
        expect(frame.WellboreMarker[0].Interpretation.UUID).toBe("existing-interp");
    });

    it("emits the 2.2 external array model and RepresentedInterpretation when a wellbore interp is given", () => {
        const { parts } = buildWellboreMarkerFrame({
            ...base,
            version: "2.2.0",
            interpretationUuid: "wbi",
            markers: [{ md: 1585, title: "Top Volantis" }],
        });
        const o = parts[parts.length - 1].object as any;
        expect(o.$type).toBe("resqml22.WellboreMarkerFrameRepresentation");
        expect(o.RepresentedInterpretation.Uuid).toBe("wbi");
        expect(o.NodeMd.$type).toBe("eml23.FloatingPointExternalArray");
    });

    it("rejects an empty marker list", () => {
        expect(() => buildWellboreMarkerFrame({ ...base, markers: [] })).toThrow(/at least one marker/);
    });
});

// ── Column-based table (ColumnBasedTable, EML 2.3 / 2.2+) ────────────────────
describe("column-based table (ColumnBasedTable)", () => {
    const base = {
        title: "Volantis KrPc",
        hdfUuid: "hdf",
    };

    it("builds an eml23.ColumnBasedTable with a Column per data column + key columns", () => {
        const { object, arrays } = buildColumnBasedTable({
            ...base,
            keyColumns: [{ propertyKind: "water saturation", uom: "euc", values: [0.15, 0.3, 0.45] }],
            columns: [
                { propertyKind: "relative permeability to water", uom: "euc", values: [0.0, 0.08, 0.2] },
                { propertyKind: "capillary pressure", uom: "bar", values: [4.5, 1.8, 0.9] },
            ],
        });
        const o = object as any;
        expect(o.$type).toBe("eml23.ColumnBasedTable");
        // EML-rooted objects carry the EML schema version (2.3), not the RESQML
        // line version (2.2): the store resolves the qualified type from
        // namespace + SchemaVersion and "2.2" yields an undeletable ".ColumnBasedTable".
        expect(o.SchemaVersion).toBe("2.3");
        expect(o.Column).toHaveLength(2);
        expect(o.KeyColumn).toHaveLength(1);
        // Each column references a PropertyKind DOR and carries an external value array.
        expect(o.Column[0].$type).toBe("eml23.Column");
        expect(o.Column[0].PropertyKind.QualifiedType).toBe("eml23.PropertyKind");
        expect(o.Column[0].Uom).toBe("euc");
        expect(o.Column[0].ValueCountPerRow).toBe(1);
        expect(o.Column[0].Values.$type).toBe("eml23.FloatingPointExternalArray");
        // One bulk array per column (key columns first).
        expect(arrays).toHaveLength(3);
        expect(arrays[0].Data).toEqual([0.15, 0.3, 0.45]);
        expect(arrays[0].Dimensions).toEqual([3]);
    });

    it("derives a deterministic PropertyKind UUID from the kind name (idempotent)", () => {
        const a = buildColumnBasedTable({ ...base, columns: [{ propertyKind: "porosity", values: [0.2, 0.25] }] });
        const b = buildColumnBasedTable({ ...base, columns: [{ propertyKind: "porosity", values: [0.1] }] });
        const uuidA = (a.object as any).Column[0].PropertyKind.Uuid;
        const uuidB = (b.object as any).Column[0].PropertyKind.Uuid;
        expect(uuidA).toBe(uuidB);
    });

    it("honours valueCountPerRow with a [rows, vcr] array shape", () => {
        const { object, arrays } = buildColumnBasedTable({
            ...base,
            columns: [{ propertyKind: "permeability tensor", valueCountPerRow: 3, values: [1, 0, 0, 0, 1, 0] }],
        });
        expect((object as any).Column[0].ValueCountPerRow).toBe(3);
        expect(arrays[0].Dimensions).toEqual([2, 3]);
    });

    it("defaults to 2.2.0 and rejects the 2.0.x lines (EML 2.3 object)", () => {
        expect((buildColumnBasedTable({ ...base, columns: [{ propertyKind: "k", values: [1] }] }).object as any).SchemaVersion).toBe("2.3");
        expect(() =>
            buildColumnBasedTable({ ...base, version: "2.0.1", columns: [{ propertyKind: "k", values: [1] }] }),
        ).toThrow(/EML 2\.3/);
    });

    it("rejects a values length not divisible by valueCountPerRow, and an empty column set", () => {
        expect(() =>
            buildColumnBasedTable({ ...base, columns: [{ propertyKind: "k", valueCountPerRow: 2, values: [1, 2, 3] }] }),
        ).toThrow(/divisible/);
        expect(() => buildColumnBasedTable({ ...base, columns: [] })).toThrow(/at least one data column/);
    });
});



