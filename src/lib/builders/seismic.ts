/**
 * Seismic bin-grid builder — the *reverse* of the RESQML → OSDU SeismicBinGrid
 * converter (`jsonTypes/SeismicBinGrid2Representation{,22}.ts`).
 *
 * The forward path *extracts* an OSDU P6/98 SeismicBinGrid work-product-component
 * from a RESQML `Grid2dRepresentation` whose interpreted feature is a
 * `SeismicLatticeFeature` with constant (regular) lattice spacing. This builder
 * runs that math **forward** (P6 → RESQML): given a fully-populated P6 bin-grid
 * definition (origin, bin widths, J-axis bearing, first inline/crossline +
 * increments, extents) it synthesises the RESQML object graph that lands in
 * Reservoir DDMS:
 *
 *   SeismicLatticeFeature  (the survey lattice: inline/crossline index space)
 *        ▲ InterpretedFeature
 *   GenericFeatureInterpretation
 *        ▲ RepresentedInterpretation / RepresentedObject
 *   Grid2dRepresentation   (regular Point3dLatticeArray: origin + I/J offsets)
 *
 * so a caller can feed a P6 load sheet straight into RDDMS and get back a bin
 * grid that the forward converter re-projects to the *same* P6 record — an
 * exact, reversible round-trip.
 *
 * ## Version fidelity (2.0.1 first, 2.2 / 2.3 built alongside)
 * - **2.0.1** (`resqml20`, production baseline): `Grid2dPatch` wrapper,
 *   `Point3dLatticeArray.Offset[]` (`Point3dOffset` + `DoubleConstantArray`),
 *   scalar `FirstInlineIndex` / `InlineIndexIncrement` … on the lattice feature,
 *   `RepresentedInterpretation` DOR (EML 2.0 `ContentType` + `UUID`).
 * - **2.2 / 2.3** (`resqml22` / `eml23`): no `Grid2dPatch` — `Geometry` sits
 *   directly on the representation; `Point3dLatticeArray.Dimension[]`
 *   (`Point3dLatticeDimension.Direction` + `FloatingPointConstantArray`); the
 *   lattice feature carries `InlineLabels` / `CrosslineLabels`
 *   (`IntegerLatticeArray`); `RepresentedObject` DOR (EML 2.3 `QualifiedType`
 *   + `Uuid`). This matches the exact shapes the 2.2 forward converter reads.
 *
 * The math (bearing → unit offset vectors, bin width → spacing, extent → count)
 * is identical to the inverse of `SeismicBinGridOSDU.initData`, so nothing is
 * lost on the way in that the forward path cannot recover on the way out.
 */

import type { DataObject } from "./types";
import {
    BuiltObject,
    Domain,
    ResqmlVersion,
    citation,
    etype,
    newUuid,
    ref,
    resolveIdentity,
    rtype,
    schemaVersion,
    versionInfo,
} from "./core";
import { resolveInterpretedFeature } from "./interpretation";
import { Grid2dSpec, PointSetSpec, buildGrid2d, buildPointSet, buildPolylineSet } from "./geometry";

/**
 * OSDU P6/98 SeismicBinGrid definition + the RESQML index metadata needed to
 * synthesise a `SeismicLatticeFeature` + regular `Grid2dRepresentation`.
 *
 * Field names mirror the OSDU `SeismicBinGrid` work-product-component (P6*) and
 * the RESQML `SeismicLatticeFeature` index space, so a P6 load sheet maps onto
 * this spec one-to-one.
 */
export interface SeismicBinGridSpec {
    /** Uuid for the Grid2dRepresentation (generated when omitted). */
    uuid?: string;
    title: string;
    version?: ResqmlVersion;
    /** CRS the origin/offsets are expressed in (a LocalDepth3dCrs / LocalTime3dCrs). */
    crsUuid: string;
    /** CRS object type; defaults from `domain` (time → LocalTime3dCrs, else LocalDepth3dCrs). */
    crsType?: string;
    /** Vertical domain the bin grid lives in. Default "depth". */
    domain?: Domain;
    originator?: string;

    // ── P6 georeferencing (map-grid geometry) ────────────────────────────────
    /** `P6BinGridOriginEasting` — easting of bin (originI, originJ). */
    originEasting: number;
    /** `P6BinGridOriginNorthing` — northing of the origin bin. */
    originNorthing: number;
    /** Vertical coordinate of the lattice origin. Default 0. */
    originZ?: number;
    /** `P6BinWidthOnIaxis` — inline (I-axis) bin width, in CRS projected units. */
    binWidthOnIaxis: number;
    /** `P6BinWidthOnJaxis` — crossline (J-axis) bin width, in CRS projected units. */
    binWidthOnJaxis: number;
    /** `P6MapGridBearingOfBinGridJaxis` — bearing of the J (crossline) axis, degrees. */
    bearingJaxisDeg: number;
    /**
     * Bearing of the I (inline) axis, degrees. Optional — defaults to
     * `bearingJaxisDeg - 90` (right-handed orthogonal bin grid, the Drogon
     * convention). Provide it for a skewed / affine bin grid.
     */
    bearingIaxisDeg?: number;

    // ── Index space (P6 + RESQML SeismicLatticeFeature) ──────────────────────
    /** `P6BinGridOriginI` → `FirstInlineIndex`. */
    firstInlineIndex: number;
    /** `P6BinNodeIncrementOnIaxis` → `InlineIndexIncrement`. */
    inlineIndexIncrement: number;
    /** `P6BinGridOriginJ` → `FirstCrosslineIndex`. */
    firstCrosslineIndex: number;
    /** `P6BinNodeIncrementOnJaxis` → `CrosslineIndexIncrement`. */
    crosslineIndexIncrement: number;

    // ── Extents (number of bins/intervals; nodes = bins + 1) ─────────────────
    /** Number of inline (I-axis) bins. Lattice node count on I is this + 1. */
    inlineBinCount: number;
    /** Number of crossline (J-axis) bins. Lattice node count on J is this + 1. */
    crosslineBinCount: number;

    // ── Optional identity carry-through (reuse existing feature / interp) ─────
    featureUuid?: string;
    interpretationUuid?: string;
    /** External OSDU SRN for the feature (deterministic UUID when no `featureUuid`). */
    featureSrn?: string;
    /** External OSDU SRN for the interpretation (deterministic UUID when no `interpretationUuid`). */
    interpretationSrn?: string;
    featureTitle?: string;
    interpretationTitle?: string;
}

/** The built RESQML graph for a bin grid: the parts to write plus their uuids. */
export interface SeismicBinGridBuild {
    /**
     * Ordered `{ object, arrays }` parts to write (feature → interpretation →
     * grid). No bulk arrays: a regular bin grid is a pure lattice.
     */
    parts: BuiltObject[];
    /** Uuid of the primary Grid2dRepresentation (the bin grid). */
    binGridUuid: string;
    /** Uuid of the GenericFeatureInterpretation. */
    interpretationUuid: string;
    /** Uuid of the SeismicLatticeFeature. */
    featureUuid: string;
}

const DEG2RAD = Math.PI / 180;

/** Unit offset vector for an axis bearing (bearing = atan2(east, north)). */
function bearingToUnit(bearingDeg: number): { x: number; y: number } {
    const r = bearingDeg * DEG2RAD;
    return { x: Math.sin(r), y: Math.cos(r) };
}

/**
 * Build a RESQML SeismicLatticeFeature + GenericFeatureInterpretation +
 * regular Grid2dRepresentation from an OSDU P6 SeismicBinGrid definition.
 *
 * This is the exact inverse of the forward `SeismicBinGrid` converter: the
 * J-axis bearing becomes the crossline offset unit vector, the I-axis bearing
 * (defaulting to J − 90°) becomes the inline offset unit vector, bin widths
 * become constant lattice spacings and bin counts become the spacing counts.
 */
export function buildSeismicBinGrid(spec: SeismicBinGridSpec): SeismicBinGridBuild {
    const v = spec.version;
    const external = versionInfo(v).arrays === "external";

    const featureUuid = resolveIdentity({ uuid: spec.featureUuid, srn: spec.featureSrn }).uuid;
    const interpretationUuid = resolveIdentity({ uuid: spec.interpretationUuid, srn: spec.interpretationSrn }).uuid;
    const binGridUuid = spec.uuid ?? newUuid();

    const featureTitle = spec.featureTitle ?? `${spec.title} lattice`;
    const interpretationTitle = spec.interpretationTitle ?? `${spec.title} interpretation`;

    const domain: Domain = spec.domain ?? "depth";
    const crsType = spec.crsType ?? (domain === "time" ? "obj_LocalTime3dCrs" : "obj_LocalDepth3dCrs");

    // Node counts (a lattice of N nodes has N-1 constant-spacing intervals).
    const iNodeCount = spec.inlineBinCount + 1;
    const jNodeCount = spec.crosslineBinCount + 1;

    // Offset unit vectors from the P6 bearings (I defaults to J − 90°: a
    // right-handed orthogonal bin grid, matching the forward corner math).
    const jDir = bearingToUnit(spec.bearingJaxisDeg);
    const iDir = bearingToUnit(spec.bearingIaxisDeg ?? spec.bearingJaxisDeg - 90);

    // ── SeismicLatticeFeature ────────────────────────────────────────────────
    const featureType = external ? "SeismicLatticeFeature" : "obj_SeismicLatticeFeature";
    const featureObject = external
        ? ({
            $type: rtype(featureType, v),
            Uuid: featureUuid,
            SchemaVersion: schemaVersion(v),
            Citation: citation(featureTitle, { originator: spec.originator }),
            InlineLabels: {
                $type: etype("IntegerLatticeArray", v),
                StartValue: spec.firstInlineIndex,
                Offset: [
                    {
                        $type: etype("IntegerConstantArray", v),
                        Count: spec.inlineBinCount,
                        Value: spec.inlineIndexIncrement,
                    },
                ],
            },
            CrosslineLabels: {
                $type: etype("IntegerLatticeArray", v),
                StartValue: spec.firstCrosslineIndex,
                Offset: [
                    {
                        $type: etype("IntegerConstantArray", v),
                        Count: spec.crosslineBinCount,
                        Value: spec.crosslineIndexIncrement,
                    },
                ],
            },
        } as unknown as DataObject)
        : ({
            $type: rtype(featureType, v),
            Uuid: featureUuid,
            SchemaVersion: schemaVersion(v),
            Citation: citation(featureTitle, { originator: spec.originator }),
            CrosslineCount: jNodeCount,
            CrosslineIndexIncrement: spec.crosslineIndexIncrement,
            FirstCrosslineIndex: spec.firstCrosslineIndex,
            InlineCount: iNodeCount,
            InlineIndexIncrement: spec.inlineIndexIncrement,
            FirstInlineIndex: spec.firstInlineIndex,
        } as unknown as DataObject);

    // ── GenericFeatureInterpretation (interprets the lattice feature) ─────────
    const interpretationObject = {
        $type: rtype("obj_GenericFeatureInterpretation", v),
        Uuid: interpretationUuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(interpretationTitle, { originator: spec.originator }),
        Domain: domain,
        InterpretedFeature: ref("obj_SeismicLatticeFeature", featureUuid, featureTitle, v),
    } as unknown as DataObject;

    // ── Grid2dRepresentation (regular lattice, no bulk Z) ─────────────────────
    const origin = {
        $type: rtype("Point3d", v),
        Coordinate1: spec.originEasting,
        Coordinate2: spec.originNorthing,
        Coordinate3: spec.originZ ?? 0,
    };
    const localCrs = ref(crsType, spec.crsUuid, undefined, v);
    const representedRef = ref(
        "obj_GenericFeatureInterpretation",
        interpretationUuid,
        interpretationTitle,
        v,
    );

    const points = external
        ? {
            $type: rtype("Point3dLatticeArray", v),
            AllDimensionsAreOrthogonal: spec.bearingIaxisDeg === undefined,
            Origin: origin,
            Dimension: [
                {
                    $type: rtype("Point3dLatticeDimension", v),
                    Direction: { $type: rtype("Point3d", v), Coordinate1: iDir.x, Coordinate2: iDir.y, Coordinate3: 0 },
                    Spacing: { $type: etype("FloatingPointConstantArray", v), Value: spec.binWidthOnIaxis, Count: spec.inlineBinCount },
                },
                {
                    $type: rtype("Point3dLatticeDimension", v),
                    Direction: { $type: rtype("Point3d", v), Coordinate1: jDir.x, Coordinate2: jDir.y, Coordinate3: 0 },
                    Spacing: { $type: etype("FloatingPointConstantArray", v), Value: spec.binWidthOnJaxis, Count: spec.crosslineBinCount },
                },
            ],
        }
        : {
            $type: rtype("Point3dLatticeArray", v),
            Origin: origin,
            Offset: [
                {
                    $type: rtype("Point3dOffset", v),
                    Offset: { $type: rtype("Point3d", v), Coordinate1: iDir.x, Coordinate2: iDir.y, Coordinate3: 0 },
                    Spacing: { $type: rtype("DoubleConstantArray", v), Value: spec.binWidthOnIaxis, Count: spec.inlineBinCount },
                },
                {
                    $type: rtype("Point3dOffset", v),
                    Offset: { $type: rtype("Point3d", v), Coordinate1: jDir.x, Coordinate2: jDir.y, Coordinate3: 0 },
                    Spacing: { $type: rtype("DoubleConstantArray", v), Value: spec.binWidthOnJaxis, Count: spec.crosslineBinCount },
                },
            ],
        };

    const geometry = {
        $type: rtype("PointGeometry", v),
        LocalCrs: localCrs,
        Points: points,
    };

    const gridObject = external
        ? ({
            $type: rtype("Grid2dRepresentation", v),
            Uuid: binGridUuid,
            SchemaVersion: schemaVersion(v),
            Citation: citation(spec.title, { originator: spec.originator }),
            SurfaceRole: "map",
            RepresentedObject: representedRef,
            FastestAxisCount: iNodeCount,
            SlowestAxisCount: jNodeCount,
            Geometry: geometry,
        } as unknown as DataObject)
        : ({
            $type: rtype("obj_Grid2dRepresentation", v),
            Uuid: binGridUuid,
            SchemaVersion: schemaVersion(v),
            Citation: citation(spec.title, { originator: spec.originator }),
            SurfaceRole: "map",
            RepresentedInterpretation: representedRef,
            Grid2dPatch: {
                PatchIndex: 0,
                FastestAxisCount: iNodeCount,
                SlowestAxisCount: jNodeCount,
                Geometry: geometry,
            },
        } as unknown as DataObject);

    return {
        parts: [
            { object: featureObject, arrays: [] },
            { object: interpretationObject, arrays: [] },
            { object: gridObject, arrays: [] },
        ],
        binGridUuid,
        interpretationUuid,
        featureUuid,
    };
}

/**
 * Control points for a seismic horizon: a picked `PointSetRepresentation`
 * tied to a `HorizonInterpretation` + `GeneticBoundaryFeature`.
 *
 * Companion to the gridded-horizon (`Grid2dRepresentation`) input: where a
 * gridded horizon is a regular surface, this ingests the *scattered picks* a
 * horizon is interpreted from. When no `interpretationUuid` is supplied the
 * boundary feature + horizon interpretation are created in the same call, so a
 * plain control-point JSON (title, CRS, XYZ list) maps straight to RESQML.
 */
export interface HorizonControlPointsSpec {
    /** Uuid for the PointSetRepresentation (generated when omitted). */
    uuid?: string;
    title: string;
    version?: ResqmlVersion;
    /** HDF proxy the XYZ control-point array hangs off. */
    hdfUuid: string;
    crsUuid: string;
    crsType?: string;
    /** Vertical domain of the horizon. Default "time" (seismic interpretation). */
    domain?: Domain;
    originator?: string;
    /** Flat XYZ triples of the picked control points: [x0,y0,z0, x1,y1,z1, …]. */
    points: number[];

    /**
     * Existing HorizonInterpretation to attach to. When omitted a
     * GeneticBoundaryFeature + HorizonInterpretation are built and returned as
     * additional parts.
     */
    interpretationUuid?: string;
    /** Existing boundary feature (only used when `interpretationUuid` is set). */
    featureUuid?: string;
    /** External OSDU SRN for the interpretation (deterministic UUID + create when no `interpretationUuid`). */
    interpretationSrn?: string;
    /** External OSDU SRN for the boundary feature (deterministic UUID). */
    featureSrn?: string;
    interpretationTitle?: string;
    featureTitle?: string;
}

/** The built graph for horizon control points: parts to write plus their uuids. */
export interface HorizonControlPointsBuild {
    /** Ordered parts to write (feature → interpretation → point set), each `{ object, arrays }`. */
    parts: BuiltObject[];
    /** Uuid of the primary PointSetRepresentation. */
    pointSetUuid: string;
    /** Uuid of the HorizonInterpretation the points represent. */
    interpretationUuid: string;
    /** Uuid of the GeneticBoundaryFeature (present only when auto-created). */
    featureUuid?: string;
}

/**
 * Build a horizon control-point `PointSetRepresentation`, optionally creating
 * the `GeneticBoundaryFeature` + `HorizonInterpretation` it represents.
 */
export function buildHorizonControlPoints(spec: HorizonControlPointsSpec): HorizonControlPointsBuild {
    const v = spec.version;
    const domain: Domain = spec.domain ?? "time";

    const parts: BuiltObject[] = [];

    // Reuse an existing HorizonInterpretation or auto-create the boundary
    // feature + interpretation, via the shared FIRP resolver.
    const resolved = resolveInterpretedFeature(spec, {
        kind: "horizon",
        domain,
        title: `${spec.title} horizon`,
        version: v,
        originator: spec.originator,
    });
    for (const object of resolved.objects) parts.push({ object, arrays: [] });

    const pointSetSpec: PointSetSpec = {
        uuid: spec.uuid,
        title: spec.title,
        hdfUuid: spec.hdfUuid,
        crsUuid: spec.crsUuid,
        crsType: spec.crsType,
        version: v,
        interpretationUuid: resolved.interpretationUuid,
        interpretationType: resolved.interpretationType,
        points: spec.points,
        originator: spec.originator,
    };
    const pointSet = buildPointSet(pointSetSpec);
    parts.push(pointSet);

    return {
        parts,
        pointSetUuid: pointSet.object.Uuid,
        interpretationUuid: resolved.interpretationUuid,
        featureUuid: resolved.featureUuid,
    };
}

/**
 * A gridded seismic horizon: a regular `Grid2dRepresentation` tied to a
 * `HorizonInterpretation` + `GeneticBoundaryFeature`.
 *
 * Companion to `buildHorizonControlPoints` (scattered picks): where control
 * points ingest the picks a horizon is interpreted from, this ingests the
 * *regular gridded surface*. It makes the gridded route FIRP-complete — the
 * bare `buildGrid2d` only emits a `Grid2dRepresentation`, so on its own it has
 * no interpretation/feature to project to the OSDU FIRP hierarchy
 * (Feature → Interpretation → Representation → Property). When no
 * `interpretationUuid` is supplied the boundary feature + horizon
 * interpretation are created in the same call, so a plain gridded-horizon JSON
 * (title, CRS, lattice, Z array) maps straight to a complete RESQML graph.
 */
export interface GriddedHorizonSpec extends Grid2dSpec {
    /** Vertical domain of the horizon. Default "time" (seismic interpretation). */
    domain?: Domain;
    /** Existing boundary feature (only used when `interpretationUuid` is set). */
    featureUuid?: string;
    /** Title for the auto-created GeneticBoundaryFeature. */
    featureTitle?: string;
    /** External OSDU SRN for the interpretation (deterministic UUID + create when no `interpretationUuid`). */
    interpretationSrn?: string;
    /** External OSDU SRN for the boundary feature (deterministic UUID). */
    featureSrn?: string;
}

/** The built graph for a gridded horizon: parts to write plus their uuids. */
export interface GriddedHorizonBuild {
    /** Ordered parts to write (feature → interpretation → grid), each `{ object, arrays }`. */
    parts: BuiltObject[];
    /** Uuid of the primary Grid2dRepresentation. */
    gridUuid: string;
    /** Uuid of the HorizonInterpretation the grid represents. */
    interpretationUuid: string;
    /** Uuid of the GeneticBoundaryFeature (present only when auto-created). */
    featureUuid?: string;
}

/**
 * Build a gridded-horizon `Grid2dRepresentation`, optionally creating the
 * `GeneticBoundaryFeature` + `HorizonInterpretation` it represents.
 */
export function buildGriddedHorizon(spec: GriddedHorizonSpec): GriddedHorizonBuild {
    const v = spec.version;
    const domain: Domain = spec.domain ?? "time";

    const parts: BuiltObject[] = [];

    // Reuse an existing HorizonInterpretation or auto-create the boundary
    // feature + interpretation, via the shared FIRP resolver.
    const resolved = resolveInterpretedFeature(spec, {
        kind: "horizon",
        domain,
        title: `${spec.title} horizon`,
        version: v,
        originator: spec.originator,
    });
    for (const object of resolved.objects) parts.push({ object, arrays: [] });

    const grid = buildGrid2d({
        ...spec,
        interpretationUuid: resolved.interpretationUuid,
        interpretationType: resolved.interpretationType,
    });
    parts.push(grid);

    return {
        parts,
        gridUuid: grid.object.Uuid,
        interpretationUuid: resolved.interpretationUuid,
        featureUuid: resolved.featureUuid,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fault interpretation geometry
//
//  Faults share the FIRP chain (TectonicBoundaryFeature → FaultInterpretation)
//  and the same masterdata identity resolver as horizons, so an SRN-only fault
//  interpretation mints a deterministic UUID and is created idempotently. Two
//  geometry carriers are offered: PolylineSet "sticks" (the standard fault-stick
//  set, optionally closed polygons) and a PointSet of picked control points.
// ─────────────────────────────────────────────────────────────────────────────

/** The built graph for a fault representation: parts to write plus their uuids. */
export interface FaultBuild {
    /** Ordered parts to write (feature → interpretation → representation), each `{ object, arrays }`. */
    parts: BuiltObject[];
    /** Uuid of the primary representation (PolylineSet or PointSet). */
    representationUuid: string;
    /** Uuid of the FaultInterpretation the geometry represents. */
    interpretationUuid: string;
    /** Uuid of the TectonicBoundaryFeature (present only when auto-created). */
    featureUuid?: string;
}

/** FIRP + seal linkage shared by the fault builders. */
interface FaultInterpretationLinkage {
    /** Existing FaultInterpretation to attach to. When omitted one is created. */
    interpretationUuid?: string;
    /** Existing tectonic boundary feature (only used when `interpretationUuid` is set). */
    featureUuid?: string;
    /** External OSDU SRN for the interpretation (deterministic UUID + create when no `interpretationUuid`). */
    interpretationSrn?: string;
    /** External OSDU SRN for the tectonic boundary feature (deterministic UUID). */
    featureSrn?: string;
    interpretationTitle?: string;
    featureTitle?: string;
}

export interface FaultSticksSpec extends FaultInterpretationLinkage {
    /** Uuid for the PolylineSetRepresentation (generated when omitted). */
    uuid?: string;
    title: string;
    version?: ResqmlVersion;
    /** HDF proxy the stick point + node-count arrays hang off. */
    hdfUuid: string;
    crsUuid: string;
    crsType?: string;
    /** Vertical domain of the fault. Default "depth". */
    domain?: Domain;
    originator?: string;
    /** One entry per fault stick (or polygon): flat XYZ triples [x0,y0,z0, …]. */
    sticks: number[][];
    /** True to emit closed polygons instead of open sticks. Default false. */
    closed?: boolean;
}

/**
 * Build a fault-stick `PolylineSetRepresentation`, optionally creating the
 * `TectonicBoundaryFeature` + `FaultInterpretation` it
 * represents. SRN-only interpretation identity is resolved deterministically.
 */
export function buildFaultSticks(spec: FaultSticksSpec): FaultBuild {
    const v = spec.version;
    const domain: Domain = spec.domain ?? "depth";

    const parts: BuiltObject[] = [];

    const resolved = resolveInterpretedFeature(spec, {
        kind: "fault",
        domain,
        title: `${spec.title} fault`,
        version: v,
        originator: spec.originator,
    });
    for (const object of resolved.objects) parts.push({ object, arrays: [] });

    const polylineSet = buildPolylineSet({
        uuid: spec.uuid,
        title: spec.title,
        hdfUuid: spec.hdfUuid,
        crsUuid: spec.crsUuid,
        crsType: spec.crsType,
        version: v,
        interpretationUuid: resolved.interpretationUuid,
        interpretationType: resolved.interpretationType,
        polylines: spec.sticks,
        closed: spec.closed,
        originator: spec.originator,
    });
    parts.push(polylineSet);

    return {
        parts,
        representationUuid: polylineSet.object.Uuid,
        interpretationUuid: resolved.interpretationUuid,
        featureUuid: resolved.featureUuid,
    };
}

export interface FaultControlPointsSpec extends FaultInterpretationLinkage {
    /** Uuid for the PointSetRepresentation (generated when omitted). */
    uuid?: string;
    title: string;
    version?: ResqmlVersion;
    /** HDF proxy the XYZ control-point array hangs off. */
    hdfUuid: string;
    crsUuid: string;
    crsType?: string;
    /** Vertical domain of the fault. Default "depth". */
    domain?: Domain;
    originator?: string;
    /** Flat XYZ triples of the picked fault control points: [x0,y0,z0, …]. */
    points: number[];
}

/**
 * Build a fault control-point `PointSetRepresentation`, optionally creating the
 * `TectonicBoundaryFeature` + `FaultInterpretation` it
 * represents. SRN-only interpretation identity is resolved deterministically.
 */
export function buildFaultControlPoints(spec: FaultControlPointsSpec): FaultBuild {
    const v = spec.version;
    const domain: Domain = spec.domain ?? "depth";

    const parts: BuiltObject[] = [];

    const resolved = resolveInterpretedFeature(spec, {
        kind: "fault",
        domain,
        title: `${spec.title} fault`,
        version: v,
        originator: spec.originator,
    });
    for (const object of resolved.objects) parts.push({ object, arrays: [] });

    const pointSet = buildPointSet({
        uuid: spec.uuid,
        title: spec.title,
        hdfUuid: spec.hdfUuid,
        crsUuid: spec.crsUuid,
        crsType: spec.crsType,
        version: v,
        interpretationUuid: resolved.interpretationUuid,
        interpretationType: resolved.interpretationType,
        points: spec.points,
        originator: spec.originator,
    });
    parts.push(pointSet);

    return {
        parts,
        representationUuid: pointSet.object.Uuid,
        interpretationUuid: resolved.interpretationUuid,
        featureUuid: resolved.featureUuid,
    };
}