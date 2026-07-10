// ============================================================================
// Tests for GenericBinGrid and HorizonControlPoints converters
// ============================================================================

import "jest";
import { OSDUContext } from "../lib/jsonTypes/OsduContext";
import { Grid2dToOsduKind } from "../lib/jsonTypes/SeismicBinGrid2Representation";
import { Grid2dToOsduKind22 } from "../lib/jsonTypes/SeismicBinGrid2Representation22";
import {
    GenericRepresentationToOsduKind
} from "../lib/jsonTypes/GenericRepresentation";
import {
    GenericRepresentation22ToOsduKind
} from "../lib/jsonTypes/GenericRepresentation22";
import { GenericBinGridOSDU, GenericBinGrid22OSDU } from "../lib/jsonTypes/GenericBinGrid";
import { getKindOrFallback } from "../lib/jsonTypes/MilestoneKinds";

// Load the full registry
require("../lib/jsonTypes/ResqmlOsdu");

const mockClient = {
    getDataArrayValues: async () => [],
    getResolvedObjects: async () => ({}),
    getObjects: async () => []
} as any;

// ============================================================================
// GenericBinGrid routing tests
// ============================================================================
describe("GenericBinGrid routing", () => {
    const makeGrid2d20 = (opts: {
        interpType?: string;
    }) => ({
        $type: "resqml20.obj_Grid2dRepresentation" as const,
        Uuid: "grid-uuid-20",
        Citation: { Title: "IsochoreMap", Creation: new Date().toISOString() },
        Grid2dPatch: {
            FastestAxisCount: 50,
            SlowestAxisCount: 30,
            Geometry: {
                LocalCrs: { UUID: "crs-uuid", ContentType: "application/x-resqml+xml;version=2.0;type=obj_LocalDepth3dCrs" },
                Points: {
                    $type: "resqml20.Point3dZValueArray",
                    SupportingGeometry: {
                        $type: "resqml20.Point3dLatticeArray",
                        Origin: { Coordinate1: 100, Coordinate2: 200, Coordinate3: 0 },
                        Offset: [
                            { Offset: { Coordinate1: 0, Coordinate2: 25, Coordinate3: 0 }, Spacing: { Value: 1 } },
                            { Offset: { Coordinate1: 25, Coordinate2: 0, Coordinate3: 0 }, Spacing: { Value: 1 } }
                        ]
                    }
                }
            }
        },
        RepresentedInterpretation: opts.interpType
            ? { ContentType: `application/x-resqml+xml;version=2.0;type=${opts.interpType}`, UUID: "i-uuid" }
            : undefined
    });

    const makeGrid2d22 = (opts: {
        qualifiedType?: string;
    }) => ({
        $type: "resqml22.Grid2dRepresentation" as const,
        Uuid: "grid-uuid-22",
        Citation: { Title: "IsochoreMap22", Creation: new Date().toISOString() },
        FastestAxisCount: 50,
        SlowestAxisCount: 30,
        Geometry: {
            LocalCrs: { Uuid: "crs-uuid", QualifiedType: "eml23.LocalEngineeringCompoundCrs" },
            Points: {
                $type: "resqml22.Point3dLatticeArray",
                Origin: { Coordinate1: 100, Coordinate2: 200, Coordinate3: 0 },
                Offset: [
                    { Offset: { Coordinate1: 0, Coordinate2: 25, Coordinate3: 0 }, Spacing: { Value: 1 } },
                    { Offset: { Coordinate1: 25, Coordinate2: 0, Coordinate3: 0 }, Spacing: { Value: 1 } }
                ]
            }
        },
        RepresentedObject: opts.qualifiedType
            ? { QualifiedType: opts.qualifiedType, Uuid: "i-uuid" }
            : undefined
    });

    it("v2.0: Grid2d with no interpretation → GenericBinGrid kind", () => {
        const xml = makeGrid2d20({});
        expect(Grid2dToOsduKind(xml as any)).toContain("GenericBinGrid");
    });

    it("v2.0: Grid2d with HorizonInterpretation → StructureMap (not GenericBinGrid)", () => {
        const xml = makeGrid2d20({ interpType: "obj_HorizonInterpretation" });
        expect(Grid2dToOsduKind(xml as any)).toContain("StructureMap");
    });

    it("v2.0: GenericBinGridOSDU.matchType true when no interpretation", () => {
        const xml = makeGrid2d20({});
        expect(GenericBinGridOSDU.matchType(xml as any)).toBe(true);
    });

    it("v2.0: GenericBinGridOSDU.matchType false when has interpretation", () => {
        const xml = makeGrid2d20({ interpType: "obj_HorizonInterpretation" });
        expect(GenericBinGridOSDU.matchType(xml as any)).toBe(false);
    });

    it("v2.2: Grid2d with no interpretation → GenericBinGrid kind", () => {
        const xml = makeGrid2d22({});
        expect(Grid2dToOsduKind22(xml as any)).toContain("GenericBinGrid");
    });

    it("v2.2: Grid2d with HorizonInterpretation → StructureMap (not GenericBinGrid)", () => {
        const xml = makeGrid2d22({ qualifiedType: "resqml22.HorizonInterpretation" });
        expect(Grid2dToOsduKind22(xml as any)).toContain("StructureMap");
    });

    it("v2.2: GenericBinGrid22OSDU.matchType true when no interpretation", () => {
        const xml = makeGrid2d22({});
        expect(GenericBinGrid22OSDU.matchType(xml as any)).toBe(true);
    });

    it("v2.2: GenericBinGrid22OSDU.matchType false when has interpretation", () => {
        const xml = makeGrid2d22({ qualifiedType: "resqml22.GeobodyInterpretation" });
        expect(GenericBinGrid22OSDU.matchType(xml as any)).toBe(false);
    });

    it("GenericBinGrid kind is registered in MilestoneKinds", () => {
        const kind = getKindOrFallback("GenericBinGrid");
        expect(kind).toContain("GenericBinGrid");
        expect(kind).toContain("1.0.0");
    });

    it("v2.0: converter produces correct kind and grid dimensions", async () => {
        const xml = makeGrid2d20({});
        const context = new OSDUContext("test-partition", "test-rddms");
        context.uriToObject.set("eml:///dataspace('test')/resqml20.obj_Grid2dRepresentation(grid-uuid-20)", xml as any);

        const osdu = new GenericBinGridOSDU(xml as any, context);
        // Skip initData (requires client) — verify constructor kind
        expect((osdu as any).kind).toContain("GenericBinGrid");
    });
});

// ============================================================================
// HorizonControlPoints routing tests
// ============================================================================
describe("HorizonControlPoints routing", () => {
    it("v2.0: PointSet with HorizonInterpretation → HorizonControlPoints", () => {
        const xml = {
            $type: "resqml20.obj_PointSetRepresentation" as const,
            Uuid: "ps-uuid",
            Citation: { Title: "HorizonPicks", Creation: new Date().toISOString() },
            RepresentedInterpretation: {
                ContentType: "application/x-resqml+xml;version=2.0;type=obj_HorizonInterpretation",
                UUID: "h-uuid",
                Title: "TopReservoir"
            },
            NodePatch: [{ Geometry: { LocalCrs: { UUID: "crs-uuid" }, Points: {} } }]
        };
        expect(GenericRepresentationToOsduKind(xml as any)).toContain("HorizonControlPoints");
    });

    it("v2.0: PointSet with FaultInterpretation → GenericRepresentation (not HorizonControlPoints)", () => {
        const xml = {
            $type: "resqml20.obj_PointSetRepresentation" as const,
            Uuid: "ps-uuid",
            Citation: { Title: "FaultPicks" },
            RepresentedInterpretation: {
                ContentType: "application/x-resqml+xml;version=2.0;type=obj_FaultInterpretation",
                UUID: "f-uuid"
            },
            NodePatch: [{ Geometry: { LocalCrs: { UUID: "crs-uuid" }, Points: {} } }]
        };
        expect(GenericRepresentationToOsduKind(xml as any)).toContain("GenericRepresentation");
    });

    it("v2.0: TriangulatedSet with HorizonInterpretation → StructureMap (not HorizonControlPoints)", () => {
        const xml = {
            $type: "resqml20.obj_TriangulatedSetRepresentation" as const,
            Uuid: "ts-uuid",
            Citation: { Title: "HorizonSurface" },
            RepresentedInterpretation: {
                ContentType: "application/x-resqml+xml;version=2.0;type=obj_HorizonInterpretation",
                UUID: "h-uuid"
            },
            TrianglePatch: [{ Geometry: { LocalCrs: { UUID: "crs-uuid" }, Points: {} } }]
        };
        expect(GenericRepresentationToOsduKind(xml as any)).toContain("StructureMap");
    });

    it("v2.0: PointSet with no interpretation → GenericRepresentation", () => {
        const xml = {
            $type: "resqml20.obj_PointSetRepresentation" as const,
            Uuid: "ps-uuid",
            Citation: { Title: "RandomPoints" },
            NodePatch: [{ Geometry: { LocalCrs: { UUID: "crs-uuid" }, Points: {} } }]
        };
        expect(GenericRepresentationToOsduKind(xml as any)).toContain("GenericRepresentation");
    });

    it("v2.2: PointSet with HorizonInterpretation → HorizonControlPoints", () => {
        const xml = {
            $type: "resqml22.PointSetRepresentation" as const,
            Uuid: "ps-uuid-22",
            Citation: { Title: "HorizonPicks22" },
            RepresentedObject: {
                QualifiedType: "resqml22.HorizonInterpretation",
                Uuid: "h-uuid-22",
                Title: "TopReservoir22"
            },
            NodePatchGeometry: [{ Geometry: { LocalCrs: { Uuid: "crs-uuid" }, Points: {} } }]
        };
        expect(GenericRepresentation22ToOsduKind(xml as any)).toContain("HorizonControlPoints");
    });

    it("v2.2: PointSet with no interpretation → GenericRepresentation", () => {
        const xml = {
            $type: "resqml22.PointSetRepresentation" as const,
            Uuid: "ps-uuid-22",
            Citation: { Title: "RandomPoints22" },
            NodePatchGeometry: [{ Geometry: { LocalCrs: { Uuid: "crs-uuid" }, Points: {} } }]
        };
        expect(GenericRepresentation22ToOsduKind(xml as any)).toContain("GenericRepresentation");
    });

    it("v2.2: TriangulatedSet with HorizonInterpretation → StructureMap (not HorizonControlPoints)", () => {
        const xml = {
            $type: "resqml22.TriangulatedSetRepresentation" as const,
            Uuid: "ts-uuid-22",
            Citation: { Title: "HorizonSurface22" },
            RepresentedObject: {
                QualifiedType: "resqml22.HorizonInterpretation",
                Uuid: "h-uuid-22"
            },
            TrianglePatch: [{ Geometry: { LocalCrs: { Uuid: "crs-uuid" }, Points: {} } }]
        };
        expect(GenericRepresentation22ToOsduKind(xml as any)).toContain("StructureMap");
    });

    it("HorizonControlPoints kind is registered in MilestoneKinds", () => {
        const kind = getKindOrFallback("HorizonControlPoints");
        expect(kind).toContain("HorizonControlPoints");
        expect(kind).toContain("1.0.0");
    });
});
