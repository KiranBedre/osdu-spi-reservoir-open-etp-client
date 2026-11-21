/**
 * WITSML trajectory → RESQML `WellboreTrajectoryRepresentation`.
 *
 * The first of the two genuine WITSML→RESQML transforms (see
 * `rddmsmg/rddms/WellboreDdmsReplacement.md` §3): survey stations
 * (MD / inclination / azimuth) are turned into an XYZ parametric line in the
 * model's local CRS via the **minimum-curvature** method, so a RESQML-only
 * consumer (fesapi, geomodeller) reads a native trajectory representation
 * instead of a `witsml21.Trajectory`.
 *
 * Pure and I/O-free, mirroring `src/lib/builders/`.
 */

import type { DataObject, DataArrayInput } from "../builders/types";
import {
    BuiltObject,
    arrayNode,
    citation,
    etype,
    newUuid,
    ref,
    rtype,
    schemaVersion,
    type ResqmlVersion,
} from "../builders/core";

const DEG2RAD = Math.PI / 180;

/** A single directional survey station. */
export interface TrajectoryStation {
    /** Measured depth. */
    md: number;
    /** Inclination in degrees (0 = vertical). */
    inclination: number;
    /** Azimuth in degrees (0 = grid north, clockwise). */
    azimuth: number;
}

/** A trajectory node in local model coordinates. */
export interface TrajectoryPoint {
    md: number;
    /** Easting offset from origin. */
    x: number;
    /** Northing offset from origin. */
    y: number;
    /** True vertical depth from origin (positive down). */
    z: number;
}

/**
 * Minimum-curvature survey computation. Returns one XYZ node per input station
 * (positions relative to `origin`, default the wellhead at 0,0,0). Stations
 * must be sorted by increasing MD.
 */
export function minimumCurvature(
    stations: TrajectoryStation[],
    origin: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): TrajectoryPoint[] {
    const out: TrajectoryPoint[] = [];
    let x = origin.x;
    let y = origin.y;
    let z = origin.z;

    for (let i = 0; i < stations.length; i++) {
        const s = stations[i];
        if (i === 0) {
            out.push({ md: s.md, x, y, z });
            continue;
        }
        const p = stations[i - 1];
        const i1 = p.inclination * DEG2RAD;
        const i2 = s.inclination * DEG2RAD;
        const a1 = p.azimuth * DEG2RAD;
        const a2 = s.azimuth * DEG2RAD;
        const dMd = s.md - p.md;

        // Dogleg angle between the two station vectors.
        const cosBeta = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
        const beta = Math.acos(Math.min(1, Math.max(-1, cosBeta)));
        // Ratio factor; the limit as beta→0 is 1.
        const rf = beta < 1e-9 ? 1 : (2 / beta) * Math.tan(beta / 2);

        const half = (dMd / 2) * rf;
        const dNorth = half * (Math.sin(i1) * Math.cos(a1) + Math.sin(i2) * Math.cos(a2));
        const dEast = half * (Math.sin(i1) * Math.sin(a1) + Math.sin(i2) * Math.sin(a2));
        const dTvd = half * (Math.cos(i1) + Math.cos(i2));

        x += dEast;
        y += dNorth;
        z += dTvd;
        out.push({ md: s.md, x, y, z });
    }
    return out;
}

export interface TrajectorySpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    version?: ResqmlVersion;
    /** Directional survey stations (sorted by MD). */
    stations: TrajectoryStation[];
    /** Wellhead / MD-datum origin in local model coordinates. */
    origin?: { x: number; y: number; z: number };
    /** MD unit of measure (default "m"). */
    mdUom?: string;
    /** Wellbore interpretation this trajectory represents. */
    interpretationUuid?: string;
    interpretationType?: string;
    /** MD-datum object the trajectory hangs from. */
    mdDatumUuid?: string;
    originator?: string;
}

/**
 * Build a `WellboreTrajectoryRepresentation` from WITSML survey stations.
 *
 * NOTE: the geometry field set is a spec-plausible minimum
 * (`ParametricLineGeometry` with control points + MD parameters). Reconcile
 * against the RESQML XSD for the target schema line before production use.
 */
export function buildWellboreTrajectory(spec: TrajectorySpec): BuiltObject {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const pts = minimumCurvature(spec.stations, spec.origin);
    const n = pts.length;

    const mdPath = `/RESQML/${uuid}/controlPointParameters`;
    const xyzPath = `/RESQML/${uuid}/controlPoints`;
    const mds = pts.map((p) => p.md);
    const xyz: number[] = [];
    for (const p of pts) {
        xyz.push(p.x, p.y, p.z);
    }

    const object = {
        $type: rtype("obj_WellboreTrajectoryRepresentation", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        ...(spec.interpretationUuid
            ? {
                RepresentedInterpretation: ref(
                    spec.interpretationType ?? "obj_WellboreInterpretation",
                    spec.interpretationUuid,
                    spec.title,
                    v,
                ),
            }
            : {}),
        MdUom: spec.mdUom ?? "m",
        StartMd: n > 0 ? mds[0] : 0,
        FinishMd: n > 0 ? mds[n - 1] : 0,
        ...(spec.mdDatumUuid ? { MdDatum: ref("obj_MdDatum", spec.mdDatumUuid, spec.title, v) } : {}),
        Geometry: {
            $type: rtype("ParametricLineGeometry", v),
            KnotCount: n,
            LineKindIndex: 5, // 5 = minimum-curvature spline (RESQML LineKind enum)
            ControlPointParameters: arrayNode("double", { hdfUuid: spec.hdfUuid, path: mdPath, dims: [n], version: v }),
            ControlPoints: arrayNode("point3d", { hdfUuid: spec.hdfUuid, path: xyzPath, dims: [n, 3], version: v }),
        },
    } as unknown as DataObject;

    const arrays: DataArrayInput[] = [
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: mdPath,
            Dimensions: [n],
            Data: mds,
            ArrayType: "Float64Array",
        },
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: xyzPath,
            Dimensions: [n, 3],
            Data: xyz,
            ArrayType: "Float64Array",
        },
    ];

    return { object, arrays };
}
