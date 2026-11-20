// ============================================================================
// Tests for the reverse seismic builders: OSDU P6/98 SeismicBinGrid → RESQML
// (`buildSeismicBinGrid`) and horizon control points → RESQML PointSet
// (`buildHorizonControlPoints`), plus the domain-typed SDK lanes that wire them
// into transaction-aware puts. I/O-free — object-graph correctness + a
// reverse-math round-trip against the forward converter's own formulas.
// ============================================================================

import "jest";

import { RddmsClient, buildSeismicBinGrid, buildHorizonControlPoints } from "../../sdk";

/** A Drogon-like right-handed orthogonal bin grid P6 definition. */
const P6 = {
    title: "Drogon 3D",
    crsUuid: "crs-1",
    originEasting: 456000,
    originNorthing: 5930000,
    binWidthOnIaxis: 25,
    binWidthOnJaxis: 12.5,
    bearingJaxisDeg: 30,
    firstInlineIndex: 100,
    inlineIndexIncrement: 1,
    firstCrosslineIndex: 200,
    crosslineIndexIncrement: 1,
    inlineBinCount: 4,
    crosslineBinCount: 6,
} as const;

const DEG = 180 / Math.PI;

describe("buildSeismicBinGrid — 2.0.1 (production baseline)", () => {
    const built = buildSeismicBinGrid({ ...P6, version: "2.0.1" });

    it("emits feature → interpretation → grid in dependency order, no bulk arrays", () => {
        expect(built.parts).toHaveLength(3);
        expect(built.parts.every((p) => p.arrays.length === 0)).toBe(true);
        expect((built.parts[0].object as any).$type).toBe("resqml20.obj_SeismicLatticeFeature");
        expect((built.parts[1].object as any).$type).toBe("resqml20.obj_GenericFeatureInterpretation");
        expect((built.parts[2].object as any).$type).toBe("resqml20.obj_Grid2dRepresentation");
    });

    it("SeismicLatticeFeature carries scalar index space (node counts = bins + 1)", () => {
        const f = built.parts[0].object as any;
        expect(f.FirstInlineIndex).toBe(P6.firstInlineIndex);
        expect(f.InlineIndexIncrement).toBe(P6.inlineIndexIncrement);
        expect(f.FirstCrosslineIndex).toBe(P6.firstCrosslineIndex);
        expect(f.CrosslineIndexIncrement).toBe(P6.crosslineIndexIncrement);
        expect(f.InlineCount).toBe(P6.inlineBinCount + 1);
        expect(f.CrosslineCount).toBe(P6.crosslineBinCount + 1);
    });

    it("interpretation interprets the lattice feature (EML 2.0 ContentType+UUID DOR)", () => {
        const i = built.parts[1].object as any;
        expect(i.Domain).toBe("depth");
        expect(i.InterpretedFeature.UUID).toBe(built.featureUuid);
        expect(i.InterpretedFeature.ContentType).toContain("SeismicLatticeFeature");
    });

    it("Grid2dRepresentation wraps a regular lattice in a Grid2dPatch", () => {
        const g = built.parts[2].object as any;
        expect(g.SurfaceRole).toBe("map");
        expect(g.RepresentedInterpretation.UUID).toBe(built.interpretationUuid);
        expect(g.RepresentedObject).toBeUndefined();
        expect(g.Grid2dPatch.PatchIndex).toBe(0);
        expect(g.Grid2dPatch.FastestAxisCount).toBe(P6.inlineBinCount + 1);
        expect(g.Grid2dPatch.SlowestAxisCount).toBe(P6.crosslineBinCount + 1);
        const pts = g.Grid2dPatch.Geometry.Points;
        expect(pts.$type).toBe("resqml20.Point3dLatticeArray");
        expect(pts.Offset).toHaveLength(2);
        expect(pts.Offset[0].$type).toBe("resqml20.Point3dOffset");
        expect(pts.Offset[0].Spacing.$type).toBe("resqml20.DoubleConstantArray");
        expect(pts.Offset[0].Spacing.Value).toBe(P6.binWidthOnIaxis);
        expect(pts.Offset[0].Spacing.Count).toBe(P6.inlineBinCount);
        expect(pts.Offset[1].Spacing.Value).toBe(P6.binWidthOnJaxis);
        expect(pts.Offset[1].Spacing.Count).toBe(P6.crosslineBinCount);
    });

    it("re-projects to the SAME P6 record (reversible round-trip)", () => {
        const g = built.parts[2].object as any;
        const pts = g.Grid2dPatch.Geometry.Points;
        // Origin survives verbatim.
        expect(pts.Origin.Coordinate1).toBe(P6.originEasting);
        expect(pts.Origin.Coordinate2).toBe(P6.originNorthing);
        // Forward converter recovers the J-axis bearing from the crossline
        // (Offset[1]) direction: atan2(east, north).
        const jOff = pts.Offset[1].Offset;
        const bearingJ = Math.atan2(jOff.Coordinate1, jOff.Coordinate2) * DEG;
        expect(bearingJ).toBeCloseTo(P6.bearingJaxisDeg, 9);
        // I-axis defaults to J − 90° (right-handed orthogonal).
        const iOff = pts.Offset[0].Offset;
        const bearingI = Math.atan2(iOff.Coordinate1, iOff.Coordinate2) * DEG;
        expect(bearingI).toBeCloseTo(P6.bearingJaxisDeg - 90, 9);
    });
});

describe("buildSeismicBinGrid — 2.2 (external arrays, eml23)", () => {
    for (const version of ["2.2.0"] as const) {
        describe(version, () => {
            const built = buildSeismicBinGrid({ ...P6, version });

            it("SeismicLatticeFeature carries Inline/Crossline label lattices", () => {
                const f = built.parts[0].object as any;
                expect(f.$type).toBe("resqml22.SeismicLatticeFeature");
                expect(f.InlineLabels.$type).toBe("eml23.IntegerLatticeArray");
                expect(f.InlineLabels.StartValue).toBe(P6.firstInlineIndex);
                expect(f.InlineLabels.Offset[0].$type).toBe("eml23.IntegerConstantArray");
                expect(f.InlineLabels.Offset[0].Count).toBe(P6.inlineBinCount);
                expect(f.InlineLabels.Offset[0].Value).toBe(P6.inlineIndexIncrement);
                expect(f.CrosslineLabels.StartValue).toBe(P6.firstCrosslineIndex);
            });

            it("Grid2dRepresentation puts Geometry directly (no Grid2dPatch) + RepresentedObject", () => {
                const g = built.parts[2].object as any;
                expect(g.$type).toBe("resqml22.Grid2dRepresentation");
                expect(g.Grid2dPatch).toBeUndefined();
                expect(g.RepresentedInterpretation).toBeUndefined();
                expect(g.RepresentedObject.Uuid).toBe(built.interpretationUuid);
                expect(g.FastestAxisCount).toBe(P6.inlineBinCount + 1);
                expect(g.SlowestAxisCount).toBe(P6.crosslineBinCount + 1);
            });

            it("lattice uses Dimension[] / Direction / FloatingPointConstantArray", () => {
                const pts = (built.parts[2].object as any).Geometry.Points;
                expect(pts.$type).toBe("resqml22.Point3dLatticeArray");
                expect(pts.AllDimensionsAreOrthogonal).toBe(true);
                expect(pts.Dimension).toHaveLength(2);
                expect(pts.Dimension[0].$type).toBe("resqml22.Point3dLatticeDimension");
                expect(pts.Dimension[0].Direction.$type).toBe("resqml22.Point3d");
                expect(pts.Dimension[0].Spacing.$type).toBe("eml23.FloatingPointConstantArray");
                expect(pts.Dimension[0].Spacing.Value).toBe(P6.binWidthOnIaxis);
                expect(pts.Dimension[1].Spacing.Value).toBe(P6.binWidthOnJaxis);
            });

            it("re-projects the J-axis bearing (reversible round-trip)", () => {
                const pts = (built.parts[2].object as any).Geometry.Points;
                const jDir = pts.Dimension[1].Direction;
                const bearingJ = Math.atan2(jDir.Coordinate1, jDir.Coordinate2) * DEG;
                expect(bearingJ).toBeCloseTo(P6.bearingJaxisDeg, 9);
            });
        });
    }

    it("flags a skewed (affine) bin grid as not all-orthogonal", () => {
        const built = buildSeismicBinGrid({ ...P6, version: "2.2.0", bearingIaxisDeg: -45 });
        const pts = (built.parts[2].object as any).Geometry.Points;
        expect(pts.AllDimensionsAreOrthogonal).toBe(false);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Grounding against the OFFICIAL OSDU SeismicBinGrid.1.3.0 definition
// (osdu-data-data-definitions, E-R/work-product-component/SeismicBinGrid.1.3.0).
//
// NB: the OSDU repo *does* ship an Example Record, but it is explicitly
// "auto-generated and not intended to be meaningful from a domain perspective"
// — every P6 value in it is the placeholder 12345.6 (bearing 12345.6°, equal bin
// widths), so it cannot drive a numeric round-trip. What IS authoritative from
// the spec and asserted here:
//   1. DDMS Coverage: RESQML 2.0.1 → resqml20.obj_Grid2dRepresentation,
//      RESQML 2.2 → resqml22.Grid2dRepresentation.
//   2. P6MapGridBearingOfBinGridJaxis = clockwise-from-north bearing of the
//      A→B vector = direction of increasing crossline (constant inline).
//   3. The P6* field names carried by the record map 1:1 onto our spec; the
//      lattice extents (node counts) come from the RESQML SeismicLatticeFeature,
//      NOT from the P6 record (which has no explicit extent).
// ────────────────────────────────────────────────────────────────────────────
describe("official OSDU SeismicBinGrid.1.3.0 contract", () => {
    // A domain-meaningful P6/11 record using the OFFICIAL OSDU field names
    // (data.AbstractBinGrid.1.1.0), with Drogon-like values (unlike the
    // placeholder 12345.6 example record).
    const official = {
        P6BinGridOriginEasting: 456000,
        P6BinGridOriginNorthing: 5930000,
        P6BinWidthOnIaxis: 25,
        P6BinWidthOnJaxis: 12.5,
        P6MapGridBearingOfBinGridJaxis: 30,
        P6BinGridOriginI: 100,
        P6BinGridOriginJ: 200,
        P6BinNodeIncrementOnIaxis: 1,
        P6BinNodeIncrementOnJaxis: 1,
    };
    // Extents are NOT part of the P6 record — they come from the lattice feature.
    const inlineBinCount = 4;
    const crosslineBinCount = 6;

    /** Map the official P6* record 1:1 onto our builder spec. */
    const specFrom = (version: "2.0.1" | "2.2.0") => ({
        title: "Drogon 3D bin grid",
        crsUuid: "crs-1",
        version,
        originEasting: official.P6BinGridOriginEasting,
        originNorthing: official.P6BinGridOriginNorthing,
        binWidthOnIaxis: official.P6BinWidthOnIaxis,
        binWidthOnJaxis: official.P6BinWidthOnJaxis,
        bearingJaxisDeg: official.P6MapGridBearingOfBinGridJaxis,
        firstInlineIndex: official.P6BinGridOriginI,
        firstCrosslineIndex: official.P6BinGridOriginJ,
        inlineIndexIncrement: official.P6BinNodeIncrementOnIaxis,
        crosslineIndexIncrement: official.P6BinNodeIncrementOnJaxis,
        inlineBinCount,
        crosslineBinCount,
    });

    /**
     * Reproduce the forward RESQML→OSDU converter's P6 projection from a built
     * graph (both version shapes) — the exact math in
     * `SeismicBinGrid2Representation.initData`.
     */
    const forwardProject = (parts: any[], version: "2.0.1" | "2.2.0") => {
        const feat = parts[0].object;
        const grid = parts[2].object;
        const pts = version === "2.0.1" ? grid.Grid2dPatch.Geometry.Points : grid.Geometry.Points;
        const uOff = version === "2.0.1" ? pts.Offset[0].Offset : pts.Dimension[0].Direction;
        const vOff = version === "2.0.1" ? pts.Offset[1].Offset : pts.Dimension[1].Direction;
        const uSp = version === "2.0.1" ? pts.Offset[0].Spacing : pts.Dimension[0].Spacing;
        const vSp = version === "2.0.1" ? pts.Offset[1].Spacing : pts.Dimension[1].Spacing;
        const idx =
            version === "2.0.1"
                ? {
                    i0: feat.FirstInlineIndex,
                    di: feat.InlineIndexIncrement,
                    j0: feat.FirstCrosslineIndex,
                    dj: feat.CrosslineIndexIncrement,
                }
                : {
                    i0: feat.InlineLabels.StartValue,
                    di: feat.InlineLabels.Offset[0].Value,
                    j0: feat.CrosslineLabels.StartValue,
                    dj: feat.CrosslineLabels.Offset[0].Value,
                };
        return {
            P6BinGridOriginEasting: pts.Origin.Coordinate1,
            P6BinGridOriginNorthing: pts.Origin.Coordinate2,
            P6BinWidthOnIaxis: uSp.Value,
            P6BinWidthOnJaxis: vSp.Value,
            // Bearing of increasing crossline = A→B vector = Offset[1] (J) direction.
            P6MapGridBearingOfBinGridJaxis:
                (Math.atan2(vOff.Coordinate1, vOff.Coordinate2) * 180) / Math.PI,
            P6BinGridOriginI: idx.i0,
            P6BinGridOriginJ: idx.j0,
            P6BinNodeIncrementOnIaxis: idx.di,
            P6BinNodeIncrementOnJaxis: idx.dj,
            // Inline (I) unit direction, used only to check A→C orthogonality below.
            _iDir: uOff,
        };
    };

    for (const version of ["2.0.1", "2.2.0"] as const) {
        it(`round-trips the official P6* record through RESQML ${version}`, () => {
            const built = buildSeismicBinGrid(specFrom(version));
            const p6 = forwardProject(built.parts, version);
            const { _iDir, P6MapGridBearingOfBinGridJaxis, ...recovered } = p6;
            // Bearing recovers to within floating-point tolerance…
            expect(P6MapGridBearingOfBinGridJaxis).toBeCloseTo(
                official.P6MapGridBearingOfBinGridJaxis,
                9,
            );
            // …every other P6* field round-trips exactly.
            const { P6MapGridBearingOfBinGridJaxis: _b, ...officialRest } = official;
            expect(recovered).toEqual(officialRest);
            // A→B (crossline, Offset[1]) ⟂ A→C (inline, Offset[0]) for an
            // orthogonal bin grid — dot product of the two directions is ~0.
            const jDir = version === "2.0.1"
                ? (built.parts[2].object as any).Grid2dPatch.Geometry.Points.Offset[1].Offset
                : (built.parts[2].object as any).Geometry.Points.Dimension[1].Direction;
            const dot = _iDir.Coordinate1 * jDir.Coordinate1 + _iDir.Coordinate2 * jDir.Coordinate2;
            expect(dot).toBeCloseTo(0, 9);
        });
    }

    it("honours the DDMS Coverage $type contract (2.0.1 vs 2.2)", () => {
        // RESQML 2.0.1: resqml20.obj_Grid2dRepresentation
        expect((buildSeismicBinGrid(specFrom("2.0.1")).parts[2].object as any).$type).toBe(
            "resqml20.obj_Grid2dRepresentation",
        );
        // RESQML 2.2: resqml22.Grid2dRepresentation
        expect((buildSeismicBinGrid(specFrom("2.2.0")).parts[2].object as any).$type).toBe(
            "resqml22.Grid2dRepresentation",
        );
    });
});

describe("buildHorizonControlPoints", () => {
    const points = [0, 0, 100, 25, 0, 101, 0, 25, 102];

    it("auto-creates GeneticBoundaryFeature + HorizonInterpretation + PointSet", () => {
        const built = buildHorizonControlPoints({
            title: "Top Volantis picks",
            hdfUuid: "hdf",
            crsUuid: "crs-1",
            points,
        });
        expect(built.parts).toHaveLength(3);
        expect((built.parts[0].object as any).$type).toBe("resqml20.obj_GeneticBoundaryFeature");
        expect((built.parts[1].object as any).$type).toBe("resqml20.obj_HorizonInterpretation");
        expect((built.parts[2].object as any).$type).toBe("resqml20.obj_PointSetRepresentation");
        expect(built.featureUuid).toBe((built.parts[0].object as any).Uuid);
        expect(built.interpretationUuid).toBe((built.parts[1].object as any).Uuid);
        expect(built.pointSetUuid).toBe((built.parts[2].object as any).Uuid);

        const ps = built.parts[2].object as any;
        expect(ps.RepresentedInterpretation.UUID).toBe(built.interpretationUuid);
        expect(ps.RepresentedInterpretation.ContentType).toContain("HorizonInterpretation");
        expect(ps.NodePatch[0].Count).toBe(points.length / 3);
        // Default vertical domain for seismic interpretation is time.
        expect((built.parts[1].object as any).Domain).toBe("time");
        // The picked XYZ ride on the point set as a bulk Float64 array.
        expect(built.parts[2].arrays[0].Data).toEqual(points);
    });

    it("reuses an existing interpretation (PointSet only, no feature)", () => {
        const built = buildHorizonControlPoints({
            title: "Top Volantis picks",
            hdfUuid: "hdf",
            crsUuid: "crs-1",
            points,
            interpretationUuid: "existing-interp",
        });
        expect(built.parts).toHaveLength(1);
        expect((built.parts[0].object as any).$type).toBe("resqml20.obj_PointSetRepresentation");
        expect(built.featureUuid).toBeUndefined();
        expect(built.interpretationUuid).toBe("existing-interp");
        expect((built.parts[0].object as any).RepresentedInterpretation.UUID).toBe("existing-interp");
    });
});

describe("seismic SDK lanes — bingrid + horizon control points", () => {
    const client = new RddmsClient({ baseUrl: "http://localhost/api" });
    const putSpy = jest.spyOn(client.model, "put").mockResolvedValue({ transactionId: "tx-1", success: true });

    afterEach(() => putSpy.mockClear());

    it("seismic.bingrid.put composes buildSeismicBinGrid and writes all parts atomically", async () => {
        const res = await client.seismic.bingrid.put("ds", { ...P6, version: "2.0.1" });
        expect(putSpy).toHaveBeenCalledTimes(1);
        const [ds, input] = putSpy.mock.calls[0];
        expect(ds).toBe("ds");
        expect(input.parts).toHaveLength(3);
        expect(res.binGridUuid).toBe((input.parts![2].object as any).Uuid);
        expect(res.uuid).toBe(res.binGridUuid);
        expect(res.interpretationUuid).toBe((input.parts![1].object as any).Uuid);
        expect(res.featureUuid).toBe((input.parts![0].object as any).Uuid);
    });

    it("seismic.horizons.putControlPoints composes buildHorizonControlPoints and writes it", async () => {
        const res = await client.seismic.horizons.putControlPoints("ds", {
            title: "Top Volantis picks",
            hdfUuid: "hdf",
            crsUuid: "crs-1",
            points: [0, 0, 100, 25, 0, 101],
        });
        const [, input] = putSpy.mock.calls[0];
        expect(input.parts).toHaveLength(3);
        expect(res.pointSetUuid).toBe((input.parts![2].object as any).Uuid);
        expect(res.uuid).toBe(res.pointSetUuid);
        expect(res.interpretationUuid).toBeDefined();
        expect(res.featureUuid).toBeDefined();
    });
});
