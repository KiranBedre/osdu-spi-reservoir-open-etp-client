/**
 * SDK Example 1: Hello World - PointSet with coordinate arrays.
 *
 * Creates a dataspace, writes a RESQML 2.0.1 PointSet (3 points in 3D)
 * with its CRS and HDF proxy, uploads the coordinate array, then reads
 * everything back and prints the result.
 *
 * This is the simplest possible "write + read" round-trip.
 *
 * Usage:
 *   npx ts-node src/examples/sdk/01-hello-pointset.ts
 */

import { RddmsClient, DataObject, DataArrayInput } from "../../../sdk";

const BASE = process.env.RDDMS_URL || "http://localhost:8080/api/reservoir-ddms/v2";
const PARTITION = process.env.RDDMS_PARTITION || "dev";

async function main() {
    const rddms = new RddmsClient({ baseUrl: BASE, partitionId: PARTITION });
    const DS = "sdk-examples/pointset";

    console.log("1. Create dataspace");
    await rddms.dataspaces.create([{ DataspaceId: DS, Path: DS }]).catch(() => { });

    console.log("2. Write PointSet + CRS + HdfProxy + Array (atomic)");

    const CRS_UUID = "7c7d7987-b7b9-4215-9014-cb7d6fb62173";
    const HDF_UUID = "68f2a7d4-f7c1-4a75-95e9-3c6a7029fb23";
    const PTS_UUID = "5d27775e-5c7f-4786-a048-9a303fa1165a";

    const crs: DataObject = {
        $type: "resqml20.obj_LocalDepth3dCrs",
        Uuid: CRS_UUID,
        SchemaVersion: "2.0",
        Citation: { Title: "UTM Zone 31N + MSL", Originator: "sdk-example", Creation: new Date().toISOString() },
        YOffset: 6470000, ZOffset: 0, XOffset: 420000,
        ArealRotation: { _: 0, $type: "eml20.PlaneAngleMeasure", Uom: "rad" },
        ProjectedAxisOrder: "easting northing",
        ProjectedUom: "m", VerticalUom: "m",
        ZIncreasingDownward: true,
        VerticalCrs: { EpsgCode: 5714, $type: "eml20.VerticalCrsEpsgCode" },
        ProjectedCrs: { EpsgCode: 23031, $type: "eml20.ProjectedCrsEpsgCode" },
    };

    const hdfProxy: DataObject = {
        $type: "eml20.obj_EpcExternalPartReference",
        Uuid: HDF_UUID,
        SchemaVersion: "2.0.0.20140822",
        Citation: { Title: "Hdf Proxy", Originator: "sdk-example", Creation: new Date().toISOString(), Format: "[RDDMS:SDK]" },
        MimeType: "application/x-hdf5",
    };

    const pointSet: DataObject = {
        $type: "resqml20.obj_PointSetRepresentation",
        Uuid: PTS_UUID,
        SchemaVersion: "2.0.0.20140822",
        Citation: { Title: "Three Points", Originator: "sdk-example", Creation: new Date().toISOString() },
        NodePatch: [{
            PatchIndex: 0, Count: 3,
            Geometry: {
                $type: "resqml20.PointGeometry",
                LocalCrs: { $type: "eml20.DataObjectReference", ContentType: "application/x-resqml+xml;version=2.0;type=obj_LocalDepth3dCrs", Title: "UTM Zone 31N + MSL", UUID: CRS_UUID },
                Points: {
                    $type: "resqml20.Point3dHdf5Array",
                    Coordinates: {
                        $type: "eml20.Hdf5Dataset",
                        PathInHdfFile: `/RESQML/${PTS_UUID}/points_patch0`,
                        HdfProxy: { $type: "eml20.DataObjectReference", ContentType: "application/x-resqml+xml;version=2.0;type=obj_EpcExternalPartReference", UUID: HDF_UUID },
                    },
                },
            },
        }],
    };

    const pointArray: DataArrayInput = {
        ContainerType: "eml20.obj_EpcExternalPartReference",
        ContainerUuid: HDF_UUID,
        PathInResource: `/RESQML/${PTS_UUID}/points_patch0`,
        Dimensions: [3, 3],
        // Three 3D points: (0,0,0), (100,200,50), (300,400,100)
        Data: [0, 0, 0, 100, 200, 50, 300, 400, 100],
        ArrayType: "Float64Array",
    };

    await rddms.atomicWrite(DS, [crs, hdfProxy, pointSet], [pointArray]);

    console.log("3. Read back");
    const types = await rddms.resources.types(DS);
    console.log("   Types:", types.map(t => `${t.name}: ${t.count}`).join(", "));

    const content = await rddms.resources.get(DS, "resqml20.obj_PointSetRepresentation", PTS_UUID);
    console.log("   PointSet:", JSON.stringify(content, null, 2).slice(0, 200) + "...");

    const arr = await rddms.arrays.get(DS, "eml20.obj_EpcExternalPartReference", HDF_UUID, `RESQML/${PTS_UUID}/points_patch0`);
    console.log("   Array data:", arr.data.data);
    console.log("   Dimensions:", arr.data.dimensions);

    console.log("4. Graph traversal - PointSet targets");
    const graph = await rddms.graph.targets(DS, "resqml20.obj_PointSetRepresentation", PTS_UUID, { depth: 2 });
    console.log("   Nodes:", graph.resources.length, "Links:", graph.links.length);
    for (const r of graph.resources) console.log(`     → ${r.name}`);

    console.log("5. Cleanup");
    await rddms.dataspaces.delete(DS);
    console.log("   Done!");
}

main().catch(err => { console.error(err); process.exit(1); });
