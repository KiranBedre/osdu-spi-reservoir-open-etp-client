/**
 * SDK Example 2: Grid2D with property array.
 *
 * Creates a 4×3 Grid2D representation with a continuous property
 * (e.g., depth values) and reads it back. Demonstrates how arrays
 * attach to objects via HdfProxy references.
 *
 * Usage:
 *   npx ts-node src/examples/sdk/02-grid2d-property.ts
 */

import { RddmsClient, DataObject, DataArrayInput } from "../../../sdk";

const BASE = process.env.RDDMS_URL || "http://localhost:8080/api/reservoir-ddms/v2";
const PARTITION = process.env.RDDMS_PARTITION || "dev";

async function main() {
    const rddms = new RddmsClient({ baseUrl: BASE, partitionId: PARTITION });
    const DS = "sdk-examples/grid2d";

    console.log("1. Create dataspace");
    await rddms.dataspaces.create([{ DataspaceId: DS, Path: DS }]).catch(() => { });

    const CRS_UUID = "a1b2c3d4-e5f6-4a00-b000-000000000001";
    const HDF_UUID = "a1b2c3d4-e5f6-4a00-b000-000000000002";
    const GRID_UUID = "a1b2c3d4-e5f6-4a00-b000-000000000003";
    const PROP_UUID = "a1b2c3d4-e5f6-4a00-b000-000000000004";
    const INTERP_UUID = "a1b2c3d4-e5f6-4a00-b000-000000000005";
    const now = new Date().toISOString();

    const crs: DataObject = {
        $type: "resqml20.obj_LocalDepth3dCrs",
        Uuid: CRS_UUID, SchemaVersion: "2.0",
        Citation: { Title: "UTM31N", Originator: "sdk", Creation: now },
        XOffset: 420000, YOffset: 6470000, ZOffset: 0,
        ArealRotation: { _: 0, $type: "eml20.PlaneAngleMeasure", Uom: "rad" },
        ProjectedAxisOrder: "easting northing",
        ProjectedUom: "m", VerticalUom: "m", ZIncreasingDownward: true,
        VerticalCrs: { EpsgCode: 5714, $type: "eml20.VerticalCrsEpsgCode" },
        ProjectedCrs: { EpsgCode: 23031, $type: "eml20.ProjectedCrsEpsgCode" },
    };

    const hdf: DataObject = {
        $type: "eml20.obj_EpcExternalPartReference",
        Uuid: HDF_UUID, SchemaVersion: "2.0.0.20140822",
        Citation: { Title: "Hdf Proxy", Originator: "sdk", Creation: now },
        MimeType: "application/x-hdf5",
    };

    // Interpretation (the "what") — generic feature interpretation
    const interp: DataObject = {
        $type: "resqml20.obj_GenericFeatureInterpretation",
        Uuid: INTERP_UUID, SchemaVersion: "2.0.0.20140822",
        Citation: { Title: "Horizon Alpha", Originator: "sdk", Creation: now },
        Domain: "depth",
    };

    // Grid2D (the "where") — 4 columns × 3 rows, regular spacing
    const grid: DataObject = {
        $type: "resqml20.obj_Grid2dRepresentation",
        Uuid: GRID_UUID, SchemaVersion: "2.0.0.20140822",
        Citation: { Title: "Horizon Alpha Grid", Originator: "sdk", Creation: now },
        RepresentedInterpretation: {
            $type: "eml20.DataObjectReference",
            ContentType: "application/x-resqml+xml;version=2.0;type=obj_GenericFeatureInterpretation",
            Title: "Horizon Alpha", UUID: INTERP_UUID,
        },
        Grid2dPatch: {
            PatchIndex: 0,
            FastestAxisCount: 4, SlowestAxisCount: 3,
            Geometry: {
                $type: "resqml20.PointGeometry",
                LocalCrs: { $type: "eml20.DataObjectReference", ContentType: "application/x-resqml+xml;version=2.0;type=obj_LocalDepth3dCrs", UUID: CRS_UUID },
                Points: {
                    $type: "resqml20.Point3dZValueArray",
                    SupportingGeometry: {
                        $type: "resqml20.Point3dLatticeArray",
                        Origin: { $type: "resqml20.Point3d", Coordinate1: 0, Coordinate2: 0, Coordinate3: 0 },
                        Offset: [
                            { $type: "resqml20.Point3dOffset", Offset: { $type: "resqml20.Point3d", Coordinate1: 25, Coordinate2: 0, Coordinate3: 0 }, Spacing: { $type: "resqml20.DoubleConstantArray", Value: 1, Count: 3 } },
                            { $type: "resqml20.Point3dOffset", Offset: { $type: "resqml20.Point3d", Coordinate1: 0, Coordinate2: 25, Coordinate3: 0 }, Spacing: { $type: "resqml20.DoubleConstantArray", Value: 1, Count: 2 } },
                        ],
                    },
                    ZValues: {
                        $type: "resqml20.DoubleHdf5Array",
                        Values: {
                            $type: "eml20.Hdf5Dataset",
                            PathInHdfFile: `/RESQML/${GRID_UUID}/zvalues`,
                            HdfProxy: { $type: "eml20.DataObjectReference", ContentType: "application/x-resqml+xml;version=2.0;type=obj_EpcExternalPartReference", UUID: HDF_UUID },
                        },
                    },
                },
            },
        },
    };

    // Continuous property — depth values on the grid
    const prop: DataObject = {
        $type: "resqml20.obj_ContinuousProperty",
        Uuid: PROP_UUID, SchemaVersion: "2.0.0.20140822",
        Citation: { Title: "Depth", Originator: "sdk", Creation: now },
        Count: 1,
        IndexableElement: "nodes",
        RealizationIndex: 0,
        PropertyKind: {
            $type: "resqml20.StandardPropertyKind",
            Kind: "depth",
        },
        SupportingRepresentation: {
            $type: "eml20.DataObjectReference",
            ContentType: "application/x-resqml+xml;version=2.0;type=obj_Grid2dRepresentation",
            Title: "Horizon Alpha Grid", UUID: GRID_UUID,
        },
        PatchOfValues: [{
            RepresentationPatchIndex: 0,
            Values: {
                $type: "resqml20.DoubleHdf5Array",
                Values: {
                    $type: "eml20.Hdf5Dataset",
                    PathInHdfFile: `/RESQML/${PROP_UUID}/values_patch0`,
                    HdfProxy: { $type: "eml20.DataObjectReference", ContentType: "application/x-resqml+xml;version=2.0;type=obj_EpcExternalPartReference", UUID: HDF_UUID },
                },
            },
        }],
        MinimumValue: [1000],
        MaximumValue: [1110],
        UOM: "m",
    };

    // Z-values for the 4×3 grid (12 values, meters depth)
    const zArray: DataArrayInput = {
        ContainerType: "eml20.obj_EpcExternalPartReference", ContainerUuid: HDF_UUID,
        PathInResource: `/RESQML/${GRID_UUID}/zvalues`,
        Dimensions: [3, 4],
        Data: [1000, 1020, 1040, 1050, 1010, 1030, 1060, 1080, 1050, 1070, 1090, 1110],
        ArrayType: "Float64Array",
    };

    // Property values (same 12 cells)
    const propArray: DataArrayInput = {
        ContainerType: "eml20.obj_EpcExternalPartReference", ContainerUuid: HDF_UUID,
        PathInResource: `/RESQML/${PROP_UUID}/values_patch0`,
        Dimensions: [12],
        Data: [1000, 1020, 1040, 1050, 1010, 1030, 1060, 1080, 1050, 1070, 1090, 1110],
        ArrayType: "Float64Array",
    };

    console.log("2. Write Grid2D + Property (atomic)");
    await rddms.atomicWrite(DS, [crs, hdf, interp, grid, prop], [zArray, propArray]);

    console.log("3. Read back types");
    const types = await rddms.resources.types(DS);
    for (const t of types) console.log(`   ${t.name}: ${t.count}`);

    console.log("4. Read Z-values array");
    const z = await rddms.arrays.get(DS, "eml20.obj_EpcExternalPartReference", HDF_UUID, `RESQML/${GRID_UUID}/zvalues`);
    console.log("   Z-values:", z.data.data);
    console.log("   Dims:", z.data.dimensions);

    console.log("5. Graph — what references the grid?");
    const src = await rddms.graph.sources(DS, "resqml20.obj_Grid2dRepresentation", GRID_UUID, { depth: 1 });
    console.log("   Sources:", src.resources.map(r => `${r.name} (${r.contentType})`));

    console.log("6. Cleanup");
    await rddms.dataspaces.delete(DS);
    console.log("   Done!");
}

main().catch(err => { console.error(err); process.exit(1); });
