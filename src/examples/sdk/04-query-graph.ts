/**
 * SDK Example 4: Query and graph traversal.
 *
 * Uses the teapot.h5 demo data (if loaded) or creates its own objects
 * to demonstrate:
 * - FindResources with scope and depth
 * - Batch graph search
 * - Graph traversal (sources/targets)
 *
 * Usage:
 *   npx ts-node src/examples/sdk/04-query-graph.ts
 */

import { RddmsClient, DataObject, DataArrayInput } from "../../../sdk";

const BASE = process.env.RDDMS_URL || "http://localhost:8080/api/reservoir-ddms/v2";
const PARTITION = process.env.RDDMS_PARTITION || "dev";

async function main() {
    const rddms = new RddmsClient({ baseUrl: BASE, partitionId: PARTITION });
    const DS = "sdk-examples/query2";

    console.log("1. Create dataspace with linked objects");
    await rddms.dataspaces.create([{ DataspaceId: DS, Path: DS }]).catch(() => { });

    const CRS_UUID = "b1000000-4a00-4b00-b000-000000000001";
    const HDF_UUID = "b1000000-4a00-4b00-b000-000000000002";
    const REP_UUID = "b1000000-4a00-4b00-b000-000000000003";
    const now = new Date().toISOString();

    const pointArray: DataArrayInput = {
        ContainerType: "eml20.obj_EpcExternalPartReference", ContainerUuid: HDF_UUID,
        PathInResource: `/RESQML/${REP_UUID}/points_patch0`,
        Dimensions: [1, 3],
        Data: [100, 200, 50],
        ArrayType: "Float64Array",
    };

    await rddms.atomicWrite(DS, [
        {
            $type: "resqml20.obj_LocalDepth3dCrs", Uuid: CRS_UUID, SchemaVersion: "2.0",
            Citation: { Title: "CRS", Originator: "sdk", Creation: now },
            XOffset: 0, YOffset: 0, ZOffset: 0,
            ArealRotation: { _: 0, $type: "eml20.PlaneAngleMeasure", Uom: "rad" },
            ProjectedAxisOrder: "easting northing", ProjectedUom: "m", VerticalUom: "m",
            ZIncreasingDownward: true,
            VerticalCrs: { EpsgCode: 5714, $type: "eml20.VerticalCrsEpsgCode" },
            ProjectedCrs: { EpsgCode: 4326, $type: "eml20.ProjectedCrsEpsgCode" },
        },
        {
            $type: "eml20.obj_EpcExternalPartReference", Uuid: HDF_UUID, SchemaVersion: "2.0.0.20140822",
            Citation: { Title: "HDF", Originator: "sdk", Creation: now },
            MimeType: "application/x-hdf5",
        },
        {
            $type: "resqml20.obj_PointSetRepresentation", Uuid: REP_UUID, SchemaVersion: "2.0.0.20140822",
            Citation: { Title: "Query Demo Points", Originator: "sdk", Creation: now },
            NodePatch: [{
                PatchIndex: 0, Count: 1,
                Geometry: {
                    $type: "resqml20.PointGeometry",
                    LocalCrs: { $type: "eml20.DataObjectReference", ContentType: "application/x-resqml+xml;version=2.0;type=obj_LocalDepth3dCrs", UUID: CRS_UUID },
                    Points: {
                        $type: "resqml20.Point3dHdf5Array",
                        Coordinates: {
                            $type: "eml20.Hdf5Dataset",
                            PathInHdfFile: `/RESQML/${REP_UUID}/points_patch0`,
                            HdfProxy: { $type: "eml20.DataObjectReference", ContentType: "application/x-resqml+xml;version=2.0;type=obj_EpcExternalPartReference", UUID: HDF_UUID },
                        },
                    },
                },
            }],
        },
    ], [pointArray]);

    console.log("\n2. FindResources — all in dataspace");
    try {
        const found = await rddms.query.findResources({
            uri: `eml:///dataspace('${DS}')`,
            depth: 0,
        });
        console.log("   Found:", (found as any[]).length, "resources");
    } catch (e: any) {
        console.log("   Skipped (server 501):", e.message.slice(0, 80));
    }

    console.log("\n3. Batch graph search — targets of PointSet");
    try {
        const graphResult = await rddms.query.graphSearch({
            uris: [`eml:///dataspace('${DS}')/resqml20.obj_PointSetRepresentation(${REP_UUID})`],
            scope: "targets",
            depth: 2,
        });
        console.log("   Graph nodes:", graphResult.resources.length);
        for (const r of graphResult.resources) console.log(`     ${r.name}`);
    } catch (e: any) {
        console.log("   Skipped (server 501):", e.message.slice(0, 80));
    }

    console.log("\n4. Graph via Discovery API — targets of PointSet");
    const graph = await rddms.graph.targets(DS, "resqml20.obj_PointSetRepresentation", REP_UUID, { depth: 2 });
    console.log("   Nodes:", graph.resources.length);
    for (const r of graph.resources) console.log(`     → ${r.name}`);

    console.log("\n5. List all resources");
    const all = await rddms.resources.list(DS);
    for (const r of all) console.log(`   ${r.name} — ${r.uri}`);

    console.log("\n6. Cleanup");
    await rddms.dataspaces.delete(DS);
    console.log("   Done!");
}

main().catch(err => { console.error(err); process.exit(1); });
