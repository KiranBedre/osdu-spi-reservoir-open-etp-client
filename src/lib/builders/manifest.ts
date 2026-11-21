/**
 * WPC classification + manifest mapping for the seismic-interp types
 * (ToDoEtpClient §10.6 #6; grounded in datadef/interpretation/README §2 + §5).
 *
 * Every interpretation artefact is a RESQML Feature → Interpretation →
 * Representation → Property chain that projects to an OSDU work-product-component
 * (WPC). **Classification is driven by the CRS domain** (`LocalTime3d` → time,
 * `LocalDepth3d` → depth) exactly as `SeismicInterpretation.md §7` specifies:
 *
 * | RESQML representation            | Domain | OSDU WPC          |
 * |----------------------------------|--------|-------------------|
 * | `Grid2dRepresentation`           | time   | `SeismicHorizon`  |
 * | `Grid2dRepresentation`           | depth  | `StructureMap`    |
 * | `PolylineSetRepresentation`      | either | `SeismicFault`    |
 * | `PointSetRepresentation`         | either | `GenericProperty` (control points) |
 * | `ContinuousProperty` (velocity)  | either | `GenericProperty` (velocity model) |
 * | `ContinuousProperty`             | either | `GenericProperty` |
 * | `IjkGridRepresentation` (volume) | either | `GenericProperty` (velocity / geologic volume) |
 * | `WellboreFrameRepresentation`    | either | `WellLog` (checkshot / T-Z / VSP) |
 * | `SeismicLattice`/`BinGrid`       | \u2014      | **none** \u2014 SDMS/VDS trace data, relate only |
 *
 * **Trace data is out of scope for projection.** Seismic trace cubes, lattices
 * and bin grids live in the **SDMS/VDS** domain; this module never emits a WPC
 * for them (`classifySeismicObject` flags `sdmsDomain`, `buildSeismicWpc`\n * refuses). They are only *related* to, via the cross-store bridge\n * (`SeismicTraceDataID` / `SeismicBinGridID`, see `./bridge`).\n *
 * The manifest builders are pure and reversible: the RESQML type + UUID +
 * schema version are stamped under `ExtensionProperties` so the reverse
 * (RESQML ← OSDU) reconstruction is exact, matching the `toOsdu*` projections
 * already shipped for FaultInterpretation / GenericProperty / WellLog. The
 * `SeismicHorizon`/`StructureMap`/`SeismicFault` records carry only the fields
 * populatable from RESQML (Name, domain, interpretation link, spatial area,
 * cross-store cube context); the ~10 seismic-native fields the OSDU schema also
 * defines stay null (datadef §5.2 "Unfulfillable Field Remediation").
 */

import type { DataObject } from "./types";
import { Domain, ResqmlVersion, schemaVersion } from "./core";
import { SeismicCubeRef, withCubeRefs } from "./bridge";
import { OsduGenericProperty, toOsduGenericProperty } from "./property";
import { OsduWellLog, toOsduWellLog } from "./wellbore";

/** OSDU WPC a seismic-interp representation classifies into. */
export type SeismicWpcKind = "SeismicHorizon" | "StructureMap" | "SeismicFault" | "GenericProperty" | "WellLog";

/**
 * RESQML geometry family of the source object. `seismicCube` marks a
 * trace/bin-grid artefact that lives in the **SDMS/VDS** domain — it is *not* an
 * interpretation artefact and is only ever related to (never projected).
 */
export type SeismicGeometry =
    | "grid2d"
    | "grid3d"
    | "polylineSet"
    | "pointSet"
    | "property"
    | "wellboreFrame"
    | "seismicCube"
    | "unknown";

/** Result of classifying a RESQML seismic-interp object against the WPC table. */
export interface SeismicClassification {
    /** Target OSDU WPC. */
    wpc: SeismicWpcKind;
    /** Fully-qualified OSDU kind string (`osdu:wks:work-product-component--…`). */
    kind: string;
    /** Interpretation/coordinate domain, resolved from the object's CRS (if present). */
    domain?: Domain;
    /** RESQML geometry family the classification was derived from. */
    geometry: SeismicGeometry;
    /**
     * True when the object is seismic **trace/bin-grid data** living in the
     * SDMS/VDS domain. Such objects are never projected to an RDDMS
     * interpretation WPC — relate to them via the cross-store bridge
     * (`SeismicTraceDataID` / `SeismicBinGridID`, `resolveCubeRefs` /
     * `withCubeRefs`) instead.
     */
    sdmsDomain?: boolean;
    /** Canonical velocity kind (`interval velocity`, `Vp`, …) when this is a velocity model. */
    velocityKind?: string;
    /** Human-readable justification (which rule fired). */
    reason: string;
}

/** OSDU schema versions used by the seismic-interp WPC records. */
const WPC_VERSION: Record<SeismicWpcKind, string> = {
    SeismicHorizon: "1.0.0",
    StructureMap: "1.0.0",
    SeismicFault: "1.0.0",
    GenericProperty: "1.0.0",
    WellLog: "1.3.0",
};

/** Build the fully-qualified OSDU kind string for a WPC. */
function osduKind(wpc: SeismicWpcKind): string {
    return `osdu:wks:work-product-component--${wpc}:${WPC_VERSION[wpc]}`;
}

/** Local-name of a RESQML `$type` (strip namespace prefix + `obj_`). */
function localName(type?: string): string {
    if (!type) return "";
    const bare = type.includes(".") ? type.split(".").pop()! : type;
    return bare.replace(/^obj_/, "");
}

/** Recursively scan an object for a `ContentType`/`$type` matching a CRS domain token. */
function scanCrsDomain(node: unknown, depth = 0): Domain | undefined {
    if (!node || typeof node !== "object" || depth > 8) return undefined;
    for (const value of Object.values(node as Record<string, unknown>)) {
        if (typeof value === "string") {
            if (/LocalTime3dCrs/i.test(value)) return "time";
            if (/LocalDepth3dCrs/i.test(value)) return "depth";
        } else if (value && typeof value === "object") {
            const found = scanCrsDomain(value, depth + 1);
            if (found) return found;
        }
    }
    return undefined;
}

/**
 * Resolve the interpretation/coordinate domain of a RESQML object from the CRS
 * referenced by its geometry (`LocalTime3dCrs` → time, `LocalDepth3dCrs` →
 * depth). Falls back to `undefined` when no CRS reference is present.
 */
export function crsDomainOf(object: DataObject): Domain | undefined {
    const o = object as Record<string, any>;
    // Explicit RESQML interpretation `Domain` field wins when present.
    if (o.Domain === "time" || o.Domain === "depth") return o.Domain;
    return scanCrsDomain(object);
}

const GEOMETRY_OF: Record<string, SeismicGeometry> = {
    // Extracted 2D grids: horizons (time) / structure maps (depth).
    Grid2dRepresentation: "grid2d",
    // Fault sticks / polyline picks.
    PolylineSetRepresentation: "polylineSet",
    // Seed picks / control points.
    PointSetRepresentation: "pointSet",
    // Amplitude / coherence / velocity / impedance samples.
    ContinuousProperty: "property",
    DiscreteProperty: "property",
    // 3D interpretation volumes — velocity volumes, geologic/structural models.
    IjkGridRepresentation: "grid3d",
    UnstructuredGridRepresentation: "grid3d",
    // Well ↔ seismic tie: checkshots / T-Z (TZ) curves / VSP frames.
    WellboreFrameRepresentation: "wellboreFrame",
    SeismicWellboreFrameRepresentation: "wellboreFrame",
    // SDMS/VDS trace-data domain — relate only, never an interpretation WPC.
    SeismicLatticeRepresentation: "seismicCube",
    SeismicLineRepresentation: "seismicCube",
    SeismicLatticeFeature: "seismicCube",
    SeismicLineFeature: "seismicCube",
    BinGridRepresentation: "seismicCube",
    SeismicBinGridRepresentation: "seismicCube",
};

/** Property kinds that mark a velocity model (interval/avg/RMS grids, Vp/Vs volumes). */
const VELOCITY_KIND_RE = /interval velocity|average velocity|rms velocity|\bVp\/Vs\b|\bVp\b|\bVs\b|velocity/i;

/**
 * Narrowly read a nested string field off a RESQML DataObject's dynamic part
 * (the `[key: string]: unknown` index signature). Returns `undefined` when any
 * link in the path is missing or not a string, so a version-variant object
 * (2.0.1 vs 2.2 vs 2.3) that lacks the field fails explicitly instead of
 * silently degrading through an `as any` chain.
 */
function readNestedString(object: unknown, ...path: string[]): string | undefined {
    let cur: unknown = object;
    for (const key of path) {
        if (cur === null || typeof cur !== "object") return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    return typeof cur === "string" ? cur : undefined;
}

/** Read the canonical velocity kind off a RESQML property, if it carries one. */
function velocityKindOf(object: DataObject): string | undefined {
    const kind = readNestedString(object, "PropertyKind", "Kind");
    if (kind && VELOCITY_KIND_RE.test(kind)) return kind;
    return undefined;
}

/**
 * Classify a RESQML seismic-interp object onto its OSDU WPC using the geometry
 * family + CRS domain (datadef §2). Covers the full interpretation-artefact set
 * — extracted 2D grids (maps), 3D volumes, point sets, fault sticks, velocity
 * models, and well-tie frames (checkshots / T-Z / VSP) — and flags seismic
 * **trace/bin-grid** data (SDMS/VDS domain) as `sdmsDomain` so it is only ever
 * related to, never projected. `opts.domain` overrides the CRS-derived domain
 * when the object carries no CRS; `opts.velocityKind` forces velocity handling.
 */
export function classifySeismicObject(
    object: DataObject,
    opts?: { domain?: Domain; velocityKind?: string },
): SeismicClassification {
    const geometry = GEOMETRY_OF[localName(object.$type)] ?? "unknown";
    const domain = opts?.domain ?? crsDomainOf(object);

    // Seismic trace/bin-grid data lives in SDMS/VDS — never an interpretation WPC.
    if (geometry === "seismicCube") {
        return {
            wpc: "GenericProperty",
            kind: osduKind("GenericProperty"),
            domain,
            geometry,
            sdmsDomain: true,
            reason: `${localName(object.$type)} is seismic trace/bin-grid data (SDMS/VDS domain) → relate via SeismicTraceDataID / SeismicBinGridID, do not project`,
        };
    }

    const velocityKind = opts?.velocityKind ?? velocityKindOf(object);

    let wpc: SeismicWpcKind;
    let reason: string;
    switch (geometry) {
        case "grid2d":
            wpc = domain === "time" ? "SeismicHorizon" : "StructureMap";
            reason =
                domain === "time"
                    ? "Grid2dRepresentation in time → SeismicHorizon"
                    : `Grid2dRepresentation in ${domain ?? "depth (assumed)"} → StructureMap`;
            break;
        case "grid3d":
            wpc = "GenericProperty";
            reason = velocityKind
                ? `3D velocity volume (${velocityKind}) → GenericProperty`
                : "3D interpretation volume (velocity / geologic model) → GenericProperty";
            break;
        case "polylineSet":
            wpc = "SeismicFault";
            reason = "PolylineSetRepresentation (fault sticks) → SeismicFault";
            break;
        case "pointSet":
            wpc = "GenericProperty";
            reason = "PointSetRepresentation (picks/control points) → GenericProperty";
            break;
        case "wellboreFrame":
            wpc = "WellLog";
            reason = "Wellbore/Seismic-wellbore frame (checkshot / T-Z / VSP) → WellLog";
            break;
        case "property":
            wpc = "GenericProperty";
            reason = velocityKind
                ? `Velocity property (${velocityKind}) → GenericProperty`
                : "Continuous/DiscreteProperty → GenericProperty";
            break;
        default:
            wpc = "GenericProperty";
            reason = "Unrecognised representation → GenericProperty (fallback)";
    }
    return { wpc, kind: osduKind(wpc), domain, geometry, ...(velocityKind ? { velocityKind } : {}), reason };
}

/** Local XY spatial extent of a representation (from a supplied flat XYZ array). */
export interface SpatialArea {
    /** As-ingested local-CRS bounding box. */
    XMin: number;
    XMax: number;
    YMin: number;
    YMax: number;
}

/** Compute the XY bounding box from a flat `[x0,y0,z0, x1,y1,z1, …]` array. */
export function spatialAreaFromPoints(points: number[]): SpatialArea | undefined {
    if (!points || points.length < 3) return undefined;
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i + 2 < points.length; i += 3) {
        const x = points[i];
        const y = points[i + 1];
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
    }
    if (!isFinite(xMin)) return undefined;
    return { XMin: xMin, XMax: xMax, YMin: yMin, YMax: yMax };
}

/** Read the represented-interpretation DOR uuid off a representation, if present. */
function interpretationId(object: DataObject): string | undefined {
    return (
        readNestedString(object, "RepresentedInterpretation", "UUID") ??
        readNestedString(object, "RepresentedInterpretation", "Uuid") ??
        readNestedString(object, "InterpretedFeature", "UUID") ??
        readNestedString(object, "InterpretedFeature", "Uuid")
    );
}

/** Reversibility + non-native metadata stamped on every seismic-interp WPC. */
interface WpcExtensionProperties {
    "x-resqml-type": string;
    ResqmlObjectUUID: string;
    ResqmlSchemaVersion: string;
    /** Canonical SDMS cube handles carried across the store boundary (§5). */
    CubeRefs?: SeismicCubeRef[];
}

/** OSDU `SeismicHorizon:1.0.0` — gridded horizon in two-way time. */
export interface OsduSeismicHorizon {
    kind: "osdu:wks:work-product-component--SeismicHorizon:1.0.0";
    data: {
        Name: string;
        SeismicDomainType: "time";
        IsInterpreted: true;
        HorizonInterpretationID?: string;
        SpatialArea?: SpatialArea;
        SeismicTraceDataID?: string | string[];
        SeismicBinGridID?: string | string[];
        ExtensionProperties: WpcExtensionProperties;
    };
}

/** OSDU `StructureMap:1.0.0` — depth-converted horizon. */
export interface OsduStructureMap {
    kind: "osdu:wks:work-product-component--StructureMap:1.0.0";
    data: {
        Name: string;
        SeismicDomainType: "depth";
        HorizonInterpretationID?: string;
        SpatialArea?: SpatialArea;
        ExtensionProperties: WpcExtensionProperties;
    };
}

/** OSDU `SeismicFault:1.0.0` — fault sticks; carries survey/bin-grid context. */
export interface OsduSeismicFault {
    kind: "osdu:wks:work-product-component--SeismicFault:1.0.0";
    data: {
        Name: string;
        SeismicDomainType?: Domain;
        FaultInterpretationID?: string;
        SpatialArea?: SpatialArea;
        SeismicTraceDataID?: string | string[];
        SeismicBinGridID?: string | string[];
        SeismicAcquisitionSurveyID?: string | string[];
        ExtensionProperties: WpcExtensionProperties;
    };
}

/** Discriminated union of every seismic-interp WPC record this module emits. */
export type SeismicWpc = OsduSeismicHorizon | OsduStructureMap | OsduSeismicFault | OsduGenericProperty | OsduWellLog;

/** Options shared by the seismic-interp WPC/manifest builders. */
export interface SeismicWpcOptions {
    version?: ResqmlVersion;
    /** Override the CRS-derived domain (used when the object carries no CRS). */
    domain?: Domain;
    /** Force velocity handling / stamp a canonical velocity kind on the property. */
    velocityKind?: string;
    /** Flat `[x,y,z,…]` array to derive the `SpatialArea` bbox from. */
    points?: number[];
    /** Pre-computed spatial extent (wins over `points`). */
    spatialArea?: SpatialArea;
    /** Measured depths for the well-tie (`WellLog`) depth summary. */
    mds?: number[];
    /** Cross-store cube handles to carry (survey / bin-grid / trace context, §5). */
    cubeRefs?: SeismicCubeRef[];
}

function extension(object: DataObject, version: ResqmlVersion | undefined, cubeRefs?: SeismicCubeRef[]): WpcExtensionProperties {
    const o = object as Record<string, any>;
    return {
        "x-resqml-type": localName(o.$type),
        ResqmlObjectUUID: o.Uuid ?? "",
        ResqmlSchemaVersion: o.SchemaVersion ?? schemaVersion(version),
        ...(cubeRefs && cubeRefs.length ? { CubeRefs: cubeRefs } : {}),
    };
}

function resolveSpatialArea(opts?: SeismicWpcOptions): SpatialArea | undefined {
    if (opts?.spatialArea) return opts.spatialArea;
    if (opts?.points) return spatialAreaFromPoints(opts.points);
    return undefined;
}

/**
 * Project a RESQML seismic-interp object onto its OSDU WPC manifest record,
 * dispatching on {@link classifySeismicObject}. Continuous/Discrete properties
 * and point sets delegate to the shipped `toOsduGenericProperty`; grids and
 * polyline sets emit `SeismicHorizon`/`StructureMap`/`SeismicFault`. Cross-store
 * cube handles (`opts.cubeRefs`) are stamped on the fault/horizon records so the
 * manifest "carries survey / bin-grid context" (datadef §2 / SHACL §10.4).
 */
export function buildSeismicWpc(object: DataObject, opts?: SeismicWpcOptions): SeismicWpc {
    const cls = classifySeismicObject(object, { domain: opts?.domain, velocityKind: opts?.velocityKind });

    // Seismic trace/bin-grid data lives in SDMS/VDS — relate only, never project.
    if (cls.sdmsDomain) {
        throw new Error(
            `buildSeismicWpc: '${localName(object.$type)}' is seismic trace/bin-grid data (SDMS/VDS domain), ` +
            `not an interpretation artefact. Relate to it via the cross-store bridge ` +
            `(resolveCubeRefs / withCubeRefs, SeismicTraceDataID / SeismicBinGridID) instead of projecting a WPC.`,
        );
    }

    const name = object.Citation?.Title ?? "";
    const ext = extension(object, opts?.version, opts?.cubeRefs);
    const spatialArea = resolveSpatialArea(opts);
    const interpId = interpretationId(object);

    switch (cls.wpc) {
        case "SeismicHorizon": {
            const record: OsduSeismicHorizon = {
                kind: "osdu:wks:work-product-component--SeismicHorizon:1.0.0",
                data: {
                    Name: name,
                    SeismicDomainType: "time",
                    IsInterpreted: true,
                    ...(interpId ? { HorizonInterpretationID: interpId } : {}),
                    ...(spatialArea ? { SpatialArea: spatialArea } : {}),
                    ExtensionProperties: ext,
                },
            };
            return opts?.cubeRefs?.length ? withCubeRefs(record, opts.cubeRefs) : record;
        }
        case "StructureMap": {
            return {
                kind: "osdu:wks:work-product-component--StructureMap:1.0.0",
                data: {
                    Name: name,
                    SeismicDomainType: "depth",
                    ...(interpId ? { HorizonInterpretationID: interpId } : {}),
                    ...(spatialArea ? { SpatialArea: spatialArea } : {}),
                    ExtensionProperties: ext,
                },
            };
        }
        case "SeismicFault": {
            const record: OsduSeismicFault = {
                kind: "osdu:wks:work-product-component--SeismicFault:1.0.0",
                data: {
                    Name: name,
                    ...(cls.domain ? { SeismicDomainType: cls.domain } : {}),
                    ...(interpId ? { FaultInterpretationID: interpId } : {}),
                    ...(spatialArea ? { SpatialArea: spatialArea } : {}),
                    ExtensionProperties: ext,
                },
            };
            return opts?.cubeRefs?.length ? withCubeRefs(record, opts.cubeRefs) : record;
        }
        case "WellLog":
            return toOsduWellLog(object, { version: opts?.version, mds: opts?.mds });
        case "GenericProperty":
        default:
            return toOsduGenericProperty(object, { version: opts?.version, velocityKind: cls.velocityKind });
    }
}
