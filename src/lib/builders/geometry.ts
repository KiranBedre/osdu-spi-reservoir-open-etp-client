/**
 * Geometry builders — HDF proxy + the representation types shared across all
 * RESQML domains: Grid2d (surfaces/maps), PointSet (picks/control points) and
 * PolylineSet (fault sticks/polygons).
 *
 * Each builder returns `{ object, arrays }`: the RESQML object plus the bulk
 * `DataArrayInput`s it references. Feed both to `RddmsClient.atomicWrite`.
 * Geometry is emitted as a lattice (Grid2d, regular) or explicit point arrays
 * (PointSet/PolylineSet). The array-referencing model follows the version:
 * HDF5 datasets for 2.0.x, EML 2.3 ExternalDataArray for 2.2/2.3 (via
 * `arrayNode`), so the same call targets any RESQML line.
 */

import type { DataObject, DataArrayInput } from "./types";
import { BuiltObject, ResqmlVersion, arrayNode, citation, etype, newUuid, ref, rtype, schemaVersion } from "./core";

/** Build an EPC external-part reference (HDF proxy) that arrays hang off. */
export function buildHdfProxy(opts?: { uuid?: string; title?: string; version?: ResqmlVersion }): {
    uuid: string;
    object: DataObject;
} {
    const uuid = opts?.uuid ?? newUuid();
    const v = opts?.version;
    const object = {
        $type: etype("obj_EpcExternalPartReference", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(opts?.title ?? "Hdf Proxy"),
        MimeType: "application/x-hdf5",
    } as unknown as DataObject;
    return { uuid, object };
}

export interface Grid2dSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    crsUuid: string;
    crsType?: string;
    version?: ResqmlVersion;
    /** Interpretation this grid represents (optional but recommended). */
    interpretationUuid?: string;
    interpretationType?: string;
    interpretationTitle?: string;
    /** Number of nodes along the fastest axis (I). */
    ni: number;
    /** Number of nodes along the slowest axis (J). */
    nj: number;
    origin: { x: number; y: number; z?: number };
    /** Node spacing along I (fastest). */
    iSpacing: number;
    /** Node spacing along J (slowest). */
    jSpacing: number;
    /** Z values, length ni*nj, row-major (J outer, I inner). */
    zValues: number[];
    originator?: string;
}

/** Build a regular Grid2dRepresentation (lattice XY + Z array). */
export function buildGrid2d(spec: Grid2dSpec): BuiltObject {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const crsType = spec.crsType ?? "obj_LocalDepth3dCrs";
    const zPath = `/RESQML/${uuid}/zvalues`;

    const object = {
        $type: rtype("obj_Grid2dRepresentation", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        ...(spec.interpretationUuid
            ? {
                RepresentedInterpretation: ref(
                    spec.interpretationType ?? "obj_HorizonInterpretation",
                    spec.interpretationUuid,
                    spec.interpretationTitle ?? spec.title,
                    v,
                ),
            }
            : {}),
        Grid2dPatch: {
            PatchIndex: 0,
            FastestAxisCount: spec.ni,
            SlowestAxisCount: spec.nj,
            Geometry: {
                $type: rtype("PointGeometry", v),
                LocalCrs: ref(crsType, spec.crsUuid, undefined, v),
                Points: {
                    $type: rtype("Point3dZValueArray", v),
                    SupportingGeometry: {
                        $type: rtype("Point3dLatticeArray", v),
                        Origin: {
                            $type: rtype("Point3d", v),
                            Coordinate1: spec.origin.x,
                            Coordinate2: spec.origin.y,
                            Coordinate3: spec.origin.z ?? 0,
                        },
                        Offset: [
                            {
                                $type: rtype("Point3dOffset", v),
                                Offset: { $type: rtype("Point3d", v), Coordinate1: spec.iSpacing, Coordinate2: 0, Coordinate3: 0 },
                                Spacing: { $type: rtype("DoubleConstantArray", v), Value: 1, Count: spec.nj },
                            },
                            {
                                $type: rtype("Point3dOffset", v),
                                Offset: { $type: rtype("Point3d", v), Coordinate1: 0, Coordinate2: spec.jSpacing, Coordinate3: 0 },
                                Spacing: { $type: rtype("DoubleConstantArray", v), Value: 1, Count: spec.ni },
                            },
                        ],
                    },
                    ZValues: arrayNode("double", { hdfUuid: spec.hdfUuid, path: zPath, dims: [spec.nj, spec.ni], version: v }),
                },
            },
        },
    } as unknown as DataObject;

    const arrays: DataArrayInput[] = [
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: zPath,
            Dimensions: [spec.nj, spec.ni],
            Data: spec.zValues,
            ArrayType: "Float64Array",
        },
    ];
    return { object, arrays };
}

export interface PointSetSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    crsUuid: string;
    crsType?: string;
    version?: ResqmlVersion;
    interpretationUuid?: string;
    interpretationType?: string;
    /** Flat XYZ triples: [x0,y0,z0, x1,y1,z1, ...]. */
    points: number[];
    originator?: string;
}

/** Build a PointSetRepresentation (explicit XYZ points) — picks/control points. */
export function buildPointSet(spec: PointSetSpec): BuiltObject {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const crsType = spec.crsType ?? "obj_LocalDepth3dCrs";
    const path = `/RESQML/${uuid}/points`;
    const count = spec.points.length / 3;

    const object = {
        $type: rtype("obj_PointSetRepresentation", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        ...(spec.interpretationUuid
            ? {
                RepresentedInterpretation: ref(
                    spec.interpretationType ?? "obj_GenericFeatureInterpretation",
                    spec.interpretationUuid,
                    spec.title,
                    v,
                ),
            }
            : {}),
        NodePatch: [
            {
                PatchIndex: 0,
                Count: count,
                Geometry: {
                    $type: rtype("PointGeometry", v),
                    LocalCrs: ref(crsType, spec.crsUuid, undefined, v),
                    Points: arrayNode("point3d", { hdfUuid: spec.hdfUuid, path, dims: [count, 3], version: v }),
                },
            },
        ],
    } as unknown as DataObject;

    const arrays: DataArrayInput[] = [
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: path,
            Dimensions: [count, 3],
            Data: spec.points,
            ArrayType: "Float64Array",
        },
    ];
    return { object, arrays };
}

export interface PolylineSetSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    crsUuid: string;
    crsType?: string;
    version?: ResqmlVersion;
    interpretationUuid?: string;
    interpretationType?: string;
    /** One entry per polyline (fault stick): flat XYZ triples. */
    polylines: number[][];
    closed?: boolean;
    originator?: string;
}

/** Build a PolylineSetRepresentation (explicit points) — fault sticks/polygons. */
export function buildPolylineSet(spec: PolylineSetSpec): BuiltObject {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const crsType = spec.crsType ?? "obj_LocalDepth3dCrs";
    const pointsPath = `/RESQML/${uuid}/points`;
    const nodeCountPath = `/RESQML/${uuid}/nodeCountPerPolyline`;

    const nodeCounts = spec.polylines.map((p) => p.length / 3);
    const totalNodes = nodeCounts.reduce((a, b) => a + b, 0);
    const flatPoints = spec.polylines.flat();

    const object = {
        $type: rtype("obj_PolylineSetRepresentation", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        ...(spec.interpretationUuid
            ? {
                RepresentedInterpretation: ref(
                    spec.interpretationType ?? "obj_FaultInterpretation",
                    spec.interpretationUuid,
                    spec.title,
                    v,
                ),
            }
            : {}),
        LinePatch: [
            {
                PatchIndex: 0,
                Count: spec.polylines.length,
                ClosedPolylines: { $type: rtype("BooleanConstantArray", v), Value: spec.closed ?? false, Count: spec.polylines.length },
                NodeCountPerPolyline: arrayNode("integer", {
                    hdfUuid: spec.hdfUuid,
                    path: nodeCountPath,
                    dims: [nodeCounts.length],
                    nullValue: -1,
                    version: v,
                }),
                Geometry: {
                    $type: rtype("PointGeometry", v),
                    LocalCrs: ref(crsType, spec.crsUuid, undefined, v),
                    Points: arrayNode("point3d", { hdfUuid: spec.hdfUuid, path: pointsPath, dims: [totalNodes, 3], version: v }),
                },
            },
        ],
    } as unknown as DataObject;

    const arrays: DataArrayInput[] = [
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: pointsPath,
            Dimensions: [totalNodes, 3],
            Data: flatPoints,
            ArrayType: "Float64Array",
        },
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: nodeCountPath,
            Dimensions: [nodeCounts.length],
            Data: nodeCounts,
            ArrayType: "Int32Array",
        },
    ];
    return { object, arrays };
}
