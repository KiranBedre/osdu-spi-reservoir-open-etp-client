/**
 * CRS builders — RESQML LocalDepth3dCrs / LocalTime3dCrs.
 *
 * CRS is the single biggest source of hollow OSDU records (ToDo O1
 * `LocalModelCompoundCrs` — the converter produces empty records because the
 * source identity is under-specified). This module makes the CRS identity
 * *complete by construction*:
 *
 *   - captures the full projected + vertical EPSG identity, local offsets,
 *     areal rotation, axis order, UOM and Z direction;
 *   - `crsCompleteness()` flags any field that would produce a hollow OSDU
 *     LocalModelCompoundCrs before the object is ever written;
 *   - `toOsduCompoundCrs()` projects the RESQML CRS onto the OSDU field set,
 *     so the manifest converter has a populated source rather than nulls.
 *
 * Domain drives the concrete type: `depth` → LocalDepth3dCrs (VerticalUom),
 * `time` → LocalTime3dCrs (TimeUom). This is the same classification the WPC
 * mapping uses (LocalDepth3d → StructureMap, LocalTime3d → SeismicHorizon).
 */

import type { DataObject } from "./types";
import { Domain, ResqmlVersion, citation, newUuid, rtype, schemaVersion } from "./core";

export interface LocalCrsSpec {
    uuid?: string;
    title: string;
    domain: Domain;
    /** RESQML schema line to emit (default 2.0.1). */
    version?: ResqmlVersion;
    /** Projected easting offset of the local origin (in ProjectedUom). */
    xOffset: number;
    /** Projected northing offset of the local origin (in ProjectedUom). */
    yOffset: number;
    /** Vertical offset of the local origin (depth CRS only). Default 0. */
    zOffset?: number;
    /** Areal rotation of the local frame, radians. Default 0. */
    arealRotationRad?: number;
    /** Horizontal (projected) unit of measure. Default "m". */
    projectedUom?: string;
    /** Vertical unit for a depth CRS. Default "m". */
    verticalUom?: string;
    /** Time unit for a time CRS. Default "ms". */
    timeUom?: string;
    /** EPSG code of the projected CRS (e.g. 23031 ED50/UTM31N, 32631 WGS84/UTM31N). */
    epsgProjected?: number;
    /** EPSG code of the vertical CRS (e.g. 5714 MSL). */
    epsgVertical?: number;
    /**
     * EPSG code of the datum-transformation (CT) to WGS84. When present the OSDU
     * projected CRS id is emitted as `BoundProjected:EPSG::<code>_EPSG::<ct>`
     * (legacy datums like ED50); when absent, plain `Projected:EPSG::<code>`.
     */
    boundCtEpsg?: number;
    /** Human-readable projected CRS name (e.g. "ED50 / UTM zone 31N"). */
    projectedCrsName?: string;
    /** Human-readable vertical CRS name (e.g. "MSL depth"). */
    verticalCrsName?: string;
    /** OSDU namespace/data-partition prefix for reference ids. Default "namespace". */
    osduNamespace?: string;
    /** Projected axis order. Default "easting northing". */
    projectedAxisOrder?: string;
    /** Whether Z increases downward (depth). Default true. */
    zIncreasingDownward?: boolean;
    originator?: string;
    creation?: string;
}

/**
 * Build a RESQML LocalDepth3dCrs or LocalTime3dCrs with a fully-specified
 * identity. Returns `{ uuid, object }` so the caller can reference it.
 */
export function buildLocalCrs(spec: LocalCrsSpec): { uuid: string; object: DataObject } {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const projectedUom = spec.projectedUom ?? "m";
    const zDown = spec.zIncreasingDownward ?? true;

    const common = {
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator, creation: spec.creation }),
        XOffset: spec.xOffset,
        YOffset: spec.yOffset,
        ZOffset: spec.zOffset ?? 0,
        ArealRotation: { _: spec.arealRotationRad ?? 0, $type: "eml20.PlaneAngleMeasure", Uom: "rad" },
        ProjectedAxisOrder: spec.projectedAxisOrder ?? "easting northing",
        ProjectedUom: projectedUom,
        ZIncreasingDownward: zDown,
        ...(spec.epsgProjected !== undefined
            ? { ProjectedCrs: { EpsgCode: spec.epsgProjected, $type: "eml20.ProjectedCrsEpsgCode" } }
            : {}),
        ...(spec.epsgVertical !== undefined
            ? { VerticalCrs: { EpsgCode: spec.epsgVertical, $type: "eml20.VerticalCrsEpsgCode" } }
            : {}),
    };

    const object: DataObject =
        spec.domain === "time"
            ? ({
                $type: rtype("obj_LocalTime3dCrs", v),
                ...common,
                TimeUom: spec.timeUom ?? "ms",
                VerticalUom: spec.verticalUom ?? "m",
            } as unknown as DataObject)
            : ({
                $type: rtype("obj_LocalDepth3dCrs", v),
                ...common,
                VerticalUom: spec.verticalUom ?? "m",
            } as unknown as DataObject);

    return { uuid, object };
}

export interface CrsCompletenessReport {
    complete: boolean;
    /** Fields whose absence would yield a hollow OSDU LocalModelCompoundCrs. */
    missing: string[];
    warnings: string[];
}

/**
 * Check whether a CRS spec carries enough identity to project to a non-hollow
 * OSDU LocalModelCompoundCrs (ToDo O1). Use before writing to catch the
 * "empty CRS record" problem at build time rather than in the manifest.
 */
export function crsCompleteness(spec: LocalCrsSpec): CrsCompletenessReport {
    const missing: string[] = [];
    const warnings: string[] = [];
    if (spec.epsgProjected === undefined) missing.push("epsgProjected");
    if (spec.epsgVertical === undefined) missing.push("epsgVertical");
    if (spec.xOffset === undefined) missing.push("xOffset");
    if (spec.yOffset === undefined) missing.push("yOffset");
    if (spec.domain === "time" && spec.timeUom === undefined) {
        warnings.push("timeUom defaulted to 'ms'");
    }
    if (!spec.projectedUom) warnings.push("projectedUom defaulted to 'm'");
    return { complete: missing.length === 0, missing, warnings };
}

/**
 * OSDU `work-product-component--LocalModelCompoundCrs:1.3.0` data fields — the
 * **pure geodetic** identification (datadef/crs O1). Local-frame parameters
 * (offsets, rotation, axis, Z direction) do NOT live here; the schema keeps
 * this record pure and puts the frame on dataset metadata — see
 * `OsduCrsLocalFrame` / `toOsduCrsLocalFrame`.
 */
export interface OsduCompoundCrs {
    /** Projected CRS id: `Projected:EPSG::<code>` or `BoundProjected:EPSG::<code>_EPSG::<ct>`. */
    CoordinateReferenceSystemID?: string;
    /** Vertical CRS id: `Vertical:EPSG::<code>`. */
    VerticalCoordinateReferenceSystemID?: string;
    /** EPSG authority JSON for the projected CRS (self-contained fallback). */
    PersistableReferenceProjectedCrs?: string;
    /** EPSG authority JSON for the vertical CRS. */
    PersistableReferenceVerticalCrs?: string;
    ProjectedCrsName?: string;
    VerticalCrsName?: string;
}

/** Local-frame parameters — belong on the dataset's `FrameOfReferenceCRS`, not the CRS WPC. */
export interface OsduCrsLocalFrame {
    XOffset: number;
    YOffset: number;
    ZOffset: number;
    ArealRotation: number;
    ProjectedUnit: string;
    VerticalUnit: string;
    Domain: Domain;
    ZIncreasingDownward: boolean;
}

/**
 * Project a RESQML CRS spec onto the OSDU LocalModelCompoundCrs:1.3.0 data
 * fields (pure geodetic identity). Legacy datums (a `boundCtEpsg` is given)
 * emit a `BoundProjected` id with the datum-transform CT; otherwise `Projected`.
 * EPSG authority JSON is emitted as the persistable-reference fallback.
 */
export function toOsduCompoundCrs(spec: LocalCrsSpec): OsduCompoundCrs {
    const ns = spec.osduNamespace ?? "namespace";
    const crsRef = (id?: string) =>
        id === undefined ? undefined : `${ns}:reference-data--CoordinateReferenceSystem:${id}:`;
    const projectedId =
        spec.epsgProjected === undefined
            ? undefined
            : spec.boundCtEpsg !== undefined
                ? `BoundProjected:EPSG::${spec.epsgProjected}_EPSG::${spec.boundCtEpsg}`
                : `Projected:EPSG::${spec.epsgProjected}`;
    const verticalId = spec.epsgVertical === undefined ? undefined : `Vertical:EPSG::${spec.epsgVertical}`;
    const persistable = (code?: number, name?: string) =>
        code === undefined
            ? undefined
            : JSON.stringify({ authCode: { auth: "EPSG", code: String(code) }, ...(name ? { name } : {}), type: "LBC" });
    return {
        ...(projectedId ? { CoordinateReferenceSystemID: crsRef(projectedId) } : {}),
        ...(verticalId ? { VerticalCoordinateReferenceSystemID: crsRef(verticalId) } : {}),
        ...(spec.epsgProjected !== undefined
            ? { PersistableReferenceProjectedCrs: persistable(spec.epsgProjected, spec.projectedCrsName) }
            : {}),
        ...(spec.epsgVertical !== undefined
            ? { PersistableReferenceVerticalCrs: persistable(spec.epsgVertical, spec.verticalCrsName) }
            : {}),
        ...(spec.projectedCrsName ? { ProjectedCrsName: spec.projectedCrsName } : {}),
        ...(spec.verticalCrsName ? { VerticalCrsName: spec.verticalCrsName } : {}),
    };
}

/**
 * Project the RESQML CRS local frame onto OSDU dataset `FrameOfReferenceCRS`
 * metadata (offsets, rotation, units, Z direction) — kept separate from the
 * geodetic `LocalModelCompoundCrs` record per the v1.3.0 schema.
 */
export function toOsduCrsLocalFrame(spec: LocalCrsSpec): OsduCrsLocalFrame {
    return {
        XOffset: spec.xOffset,
        YOffset: spec.yOffset,
        ZOffset: spec.zOffset ?? 0,
        ArealRotation: spec.arealRotationRad ?? 0,
        ProjectedUnit: spec.projectedUom ?? "m",
        VerticalUnit: spec.verticalUom ?? "m",
        Domain: spec.domain,
        ZIncreasingDownward: spec.zIncreasingDownward ?? true,
    };
}
