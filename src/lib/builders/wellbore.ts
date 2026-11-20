/**
 * Wellbore-frame builders — the physical bridge between the well and
 * seismic-interpretation domains (short-term plan #8, closes G6).
 *
 * Two builders:
 *   - `buildWellboreFrame` — a `WellboreFrameRepresentation`: MD nodes along a
 *     wellbore trajectory. The generic support for anything sampled down a
 *     wellbore (checkshots, T-Z curves, extracted logs).
 *   - `buildCheckshot` — a checkshot / time-depth (TZ) curve. On the EML-2.3
 *     lines (2.2.0 / 2.3.0) this is the dedicated
 *     `SeismicWellboreFrameRepresentation` (NodeMd + NodeTimeValues +
 *     SeismicReferenceDatum + LocalTime3dCrs). On the 2.0.x lines that object
 *     does not exist, so it decomposes into a `WellboreFrameRepresentation`
 *     plus a two-way/one-way-time `ContinuousProperty` on its nodes — the same
 *     call targets any RESQML line.
 *
 * Source of truth: energistics `resqml/2.3.0` seismic/wells reference
 * (`SeismicWellboreFrameRepresentation`); datadef `Checkshots.md` / `VSP.md`
 * (TZ curves derive from checkshot/VSP; carry datum, one-/two-way time).
 */

import type { DataObject, DataArrayInput } from "./types";
import { BuiltObject, Domain, ResqmlVersion, arrayNode, citation, etype, newUuid, ref, resolveIdentity, rtype, schemaVersion, versionInfo } from "./core";
import { buildContinuousProperty } from "./property";
import { BoundaryKind, InterpretedFeatureRef, SealState, resolveInterpretedFeature } from "./interpretation";

export interface WellboreFrameSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    version?: ResqmlVersion;
    /** Wellbore trajectory the frame is sampled along. */
    trajectoryUuid: string;
    trajectoryType?: string;
    /** Wellbore interpretation this frame represents (optional but recommended). */
    interpretationUuid?: string;
    interpretationType?: string;
    /** Measured-depth of each node, monotonically increasing. */
    nodeMd: number[];
    originator?: string;
}

/** Build a WellboreFrameRepresentation (MD nodes along a trajectory). */
export function buildWellboreFrame(spec: WellboreFrameSpec): BuiltObject {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const mdPath = `/RESQML/${uuid}/nodeMd`;
    const count = spec.nodeMd.length;

    const object = {
        $type: rtype("obj_WellboreFrameRepresentation", v),
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
        Trajectory: ref(spec.trajectoryType ?? "obj_WellboreTrajectoryRepresentation", spec.trajectoryUuid, spec.title, v),
        NodeCount: count,
        NodeMd: arrayNode("double", { hdfUuid: spec.hdfUuid, path: mdPath, dims: [count], version: v }),
    } as unknown as DataObject;

    const arrays: DataArrayInput[] = [
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: mdPath,
            Dimensions: [count],
            Data: spec.nodeMd,
            ArrayType: "Float64Array",
        },
    ];
    return { object, arrays };
}

/** RESQML `GeologicBoundaryKind` a wellbore marker can pick. */
export type MarkerBoundaryKind = "horizon" | "fault" | "geobody";

/**
 * A single marker pick along the frame. Extends {@link InterpretedFeatureRef}
 * so each marker can honour the stratigraphy/FIRP data model: attach to an
 * existing boundary interpretation (`interpretationUuid`), link to OSDU
 * masterdata by SRN (`interpretationSrn`/`featureSrn`, deterministic UUID), or
 * have the Feature + Interpretation auto-created when only a title is given.
 */
export interface WellboreMarkerSpec extends InterpretedFeatureRef {
    /** Measured depth of the pick (defines the frame node MD). */
    md: number;
    /** Marker name / citation title. */
    title: string;
    /** Geologic boundary the marker picks (also selects the auto-created interpretation kind). */
    boundaryKind?: MarkerBoundaryKind;
    /** Vertical domain of the auto-created interpretation (default depth). */
    domain?: Domain;
    /** Explicit marker element Uuid (generated when omitted). */
    uuid?: string;
    /** Fault seal state forwarded to an auto-created FaultInterpretation (2.0.2 / 2.3.0). */
    sealState?: SealState;
    /** Fault transmissibility multiplier forwarded to an auto-created FaultInterpretation. */
    transmissibilityMultiplier?: number;
    /** Fault seal mechanism forwarded to an auto-created FaultInterpretation. */
    sealMechanism?: string;
}

export interface WellboreMarkerFrameSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    version?: ResqmlVersion;
    /** Wellbore trajectory the markers are picked along. */
    trajectoryUuid: string;
    trajectoryType?: string;
    /** Wellbore interpretation this frame represents (optional but recommended). */
    interpretationUuid?: string;
    interpretationType?: string;
    /** OSDU SRN of the WellboreInterpretation (deterministic UUID when no uuid). */
    interpretationSrn?: string;
    /** The marker picks, one frame node per marker (ordered by MD). */
    markers: WellboreMarkerSpec[];
    originator?: string;
}

/** A marker-frame build: the FIRP objects to write first plus the frame itself. */
export interface WellboreMarkerFrameBuild {
    /** Feature/Interpretation objects (deduped) then the marker-frame representation. */
    parts: BuiltObject[];
    /** The WellboreMarkerFrameRepresentation Uuid. */
    representationUuid: string;
    /** Boundary interpretation UUIDs referenced/created by the markers (deduped). */
    interpretationUuids: string[];
}

/**
 * Build a `WellboreMarkerFrameRepresentation`: MD picks along a wellbore
 * trajectory, each carrying a `WellboreMarker` that references a boundary
 * interpretation. Honours the stratigraphy/FIRP model per marker via
 * {@link resolveInterpretedFeature} — the Feature + Interpretation are reused,
 * linked to OSDU masterdata by SRN, or auto-created, and returned as `parts`
 * to write ahead of the frame. Objects are deduped by Uuid so markers sharing
 * an SRN (same interpretation) are written once.
 */
export function buildWellboreMarkerFrame(spec: WellboreMarkerFrameSpec): WellboreMarkerFrameBuild {
    if (spec.markers.length === 0) {
        throw new Error("wellbore marker frame requires at least one marker");
    }
    const v = spec.version;
    const uuid = spec.uuid ?? newUuid();

    const parts: BuiltObject[] = [];
    const seen = new Set<string>();
    const interpretationUuids: string[] = [];

    // Frame-level WellboreInterpretation identity (masterdata SRN support).
    const frameInterpretationUuid =
        spec.interpretationUuid !== undefined || spec.interpretationSrn !== undefined
            ? resolveIdentity({ uuid: spec.interpretationUuid, srn: spec.interpretationSrn }).uuid
            : undefined;

    const markerElements = spec.markers.map((m) => {
        const hasLinkage =
            m.interpretationUuid !== undefined ||
            m.interpretationSrn !== undefined ||
            m.featureSrn !== undefined ||
            m.interpretationTitle !== undefined;

        let interpretationDor: DataObject | undefined;
        if (hasLinkage) {
            const kind: BoundaryKind = m.boundaryKind ?? "horizon";
            const resolved = resolveInterpretedFeature(m, {
                kind,
                domain: m.domain ?? "depth",
                title: m.interpretationTitle ?? m.title,
                version: v,
                originator: spec.originator,
                sealState: m.sealState,
                transmissibilityMultiplier: m.transmissibilityMultiplier,
                sealMechanism: m.sealMechanism,
            });
            for (const obj of resolved.objects) {
                const oid = obj.Uuid as string | undefined;
                if (oid && !seen.has(oid)) {
                    seen.add(oid);
                    parts.push({ object: obj, arrays: [] });
                }
            }
            if (!interpretationUuids.includes(resolved.interpretationUuid)) {
                interpretationUuids.push(resolved.interpretationUuid);
            }
            interpretationDor = ref(
                resolved.interpretationType,
                resolved.interpretationUuid,
                m.interpretationTitle ?? m.title,
                v,
            );
        }

        return {
            $type: rtype("WellboreMarker", v),
            Uuid: m.uuid ?? newUuid(),
            Citation: citation(m.title, { originator: spec.originator }),
            ...(m.boundaryKind ? { GeologicBoundaryKind: m.boundaryKind } : {}),
            ...(interpretationDor ? { Interpretation: interpretationDor } : {}),
        };
    });

    const mdPath = `/RESQML/${uuid}/nodeMd`;
    const count = spec.markers.length;

    const object = {
        $type: rtype("obj_WellboreMarkerFrameRepresentation", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        ...(frameInterpretationUuid
            ? {
                RepresentedInterpretation: ref(
                    spec.interpretationType ?? "obj_WellboreInterpretation",
                    frameInterpretationUuid,
                    spec.title,
                    v,
                ),
            }
            : {}),
        Trajectory: ref(spec.trajectoryType ?? "obj_WellboreTrajectoryRepresentation", spec.trajectoryUuid, spec.title, v),
        NodeCount: count,
        NodeMd: arrayNode("double", { hdfUuid: spec.hdfUuid, path: mdPath, dims: [count], version: v }),
        WellboreMarker: markerElements,
    } as unknown as DataObject;

    const arrays: DataArrayInput[] = [
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: mdPath,
            Dimensions: [count],
            Data: spec.markers.map((m) => m.md),
            ArrayType: "Float64Array",
        },
    ];

    parts.push({ object, arrays });
    return { parts, representationUuid: uuid, interpretationUuids };
}

export interface BlockedWellboreSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    version?: ResqmlVersion;
    /** Wellbore trajectory the blocked wellbore is sampled along. */
    trajectoryUuid: string;
    trajectoryType?: string;
    /** Wellbore interpretation this representation represents (optional but recommended). */
    interpretationUuid?: string;
    interpretationType?: string;
    /**
     * Measured-depth of each frame node, monotonically increasing. There are
     * `nodeMd.length` nodes and `nodeMd.length - 1` intervals between them.
     */
    nodeMd: number[];
    /**
     * Grids the wellbore intersects. `gridIndices` values index into this list.
     * Type defaults to `obj_IjkGridRepresentation`.
     */
    gridUuids: string[];
    gridType?: string;
    gridTitles?: string[];
    /**
     * For each interval (length `nodeMd.length - 1`), the index into `gridUuids`
     * of the grid that interval falls inside, or `-1` when the interval is not
     * within any grid cell.
     */
    gridIndices: number[];
    /**
     * For each blocked interval (those with a non-null `gridIndices` entry), the
     * flat cell index within the referenced grid. Length must equal the number
     * of non-null `gridIndices` entries (`CellCount`).
     */
    cellIndices: number[];
    /**
     * Optional entry/exit local face-per-cell index pair for each blocked cell
     * (length `2 · CellCount`). Use `-1` for an unknown face (e.g. at TD).
     * Defaults to all `-1` when omitted.
     */
    localFacePairPerCellIndices?: number[];
    originator?: string;
}

/**
 * Build a `BlockedWellboreRepresentation` — the intersection of a wellbore
 * trajectory with the cells (and entry/exit faces) of one or more grids.
 *
 * It extends `WellboreFrameRepresentation` (`Trajectory` + `NodeMd` frame) with
 * the RESQML blocked-well topology per `Wells.xsd`:
 *   - `GridIndices` (length = interval count = `NodeCount - 1`): per-interval
 *     grid index into `Grid[]`, `-1` = interval not in a grid.
 *   - `CellCount`: number of non-null `GridIndices` entries.
 *   - `CellIndices` (length = `CellCount`): flat cell index per blocked interval.
 *   - `LocalFacePairPerCellIndices` (length = `2 · CellCount`): entry/exit faces.
 *   - `Grid[]`: the referenced grids the indices resolve against.
 */
export function buildBlockedWellbore(spec: BlockedWellboreSpec): BuiltObject {
    const v = spec.version;
    const uuid = spec.uuid ?? newUuid();
    const nodeCount = spec.nodeMd.length;
    if (nodeCount < 2) {
        throw new Error(`blocked wellbore "${spec.title}": needs at least 2 nodeMd nodes (got ${nodeCount})`);
    }
    const intervalCount = nodeCount - 1;
    if (spec.gridIndices.length !== intervalCount) {
        throw new Error(
            `blocked wellbore "${spec.title}": gridIndices length (${spec.gridIndices.length}) must equal the interval count NodeCount-1 (${intervalCount})`,
        );
    }
    if (!spec.gridUuids.length) {
        throw new Error(`blocked wellbore "${spec.title}": at least one grid UUID is required`);
    }
    for (const g of spec.gridIndices) {
        if (g >= spec.gridUuids.length) {
            throw new Error(`blocked wellbore "${spec.title}": gridIndices value ${g} is out of range for ${spec.gridUuids.length} grid(s)`);
        }
    }
    const cellCount = spec.gridIndices.filter((g) => g >= 0).length;
    if (spec.cellIndices.length !== cellCount) {
        throw new Error(
            `blocked wellbore "${spec.title}": cellIndices length (${spec.cellIndices.length}) must equal CellCount = non-null gridIndices entries (${cellCount})`,
        );
    }
    const facePair = spec.localFacePairPerCellIndices ?? new Array(2 * cellCount).fill(-1);
    if (facePair.length !== 2 * cellCount) {
        throw new Error(
            `blocked wellbore "${spec.title}": localFacePairPerCellIndices length (${facePair.length}) must equal 2·CellCount (${2 * cellCount})`,
        );
    }

    const gridType = spec.gridType ?? "obj_IjkGridRepresentation";
    const mdPath = `/RESQML/${uuid}/nodeMd`;
    const cellPath = `/RESQML/${uuid}/cellIndices`;
    const gridPath = `/RESQML/${uuid}/gridIndices`;
    const facePath = `/RESQML/${uuid}/localFacePairPerCellIndices`;

    const object = {
        $type: rtype("obj_BlockedWellboreRepresentation", v),
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
        Trajectory: ref(spec.trajectoryType ?? "obj_WellboreTrajectoryRepresentation", spec.trajectoryUuid, spec.title, v),
        NodeCount: nodeCount,
        NodeMd: arrayNode("double", { hdfUuid: spec.hdfUuid, path: mdPath, dims: [nodeCount], version: v }),
        CellCount: cellCount,
        CellIndices: arrayNode("integer", { hdfUuid: spec.hdfUuid, path: cellPath, dims: [cellCount], version: v }),
        GridIndices: arrayNode("integer", { hdfUuid: spec.hdfUuid, path: gridPath, dims: [intervalCount], nullValue: -1, version: v }),
        LocalFacePairPerCellIndices: arrayNode("integer", { hdfUuid: spec.hdfUuid, path: facePath, dims: [2 * cellCount], nullValue: -1, version: v }),
        Grid: spec.gridUuids.map((g, i) => ref(gridType, g, spec.gridTitles?.[i] ?? spec.title, v)),
    } as unknown as DataObject;

    const arrays: DataArrayInput[] = [
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: mdPath,
            Dimensions: [nodeCount],
            Data: spec.nodeMd,
            ArrayType: "Float64Array",
        },
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: cellPath,
            Dimensions: [cellCount],
            Data: spec.cellIndices,
            ArrayType: "Int32Array",
        },
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: gridPath,
            Dimensions: [intervalCount],
            Data: spec.gridIndices,
            ArrayType: "Int32Array",
        },
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: facePath,
            Dimensions: [2 * cellCount],
            Data: facePair,
            ArrayType: "Int32Array",
        },
    ];
    return { object, arrays };
}

export interface CheckshotSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    version?: ResqmlVersion;
    /** Wellbore trajectory the checkshot is tied to. */
    trajectoryUuid: string;
    trajectoryType?: string;
    /** Wellbore interpretation (optional but recommended). */
    interpretationUuid?: string;
    interpretationType?: string;
    /** Measured-depth of each pick. */
    mds: number[];
    /** Time at each pick (same order/length as `mds`). */
    times: number[];
    /** Z where seismic time = 0 for this survey (SeismicReferenceDatum). */
    seismicReferenceDatum?: number;
    /** Seismic replacement / weathering velocity. */
    weatheringVelocity?: number;
    /** LocalTime3dCrs the time axis is expressed in (2.2/2.3). */
    timeCrsUuid?: string;
    timeCrsType?: string;
    /** Time convention for the decomposed 2.0.x property. Default two-way time. */
    timeKind?: "two-way time" | "one-way time";
    /** Time UOM for the decomposed 2.0.x property. Default "ms". */
    timeUom?: string;
    originator?: string;
}

/**
 * Build a checkshot / time-depth (TZ) curve.
 *
 * - **2.2.0 / 2.3.0** — one `SeismicWellboreFrameRepresentation` carrying
 *   `NodeMd` + `NodeTimeValues` + `SeismicReferenceDatum` + `LocalTime3dCrs`.
 *   This is the **full-fidelity** path: everything reconstructs exactly.
 * - **2.0.1 / 2.0.2** — a `WellboreFrameRepresentation` plus a two-way/one-way
 *   time `ContinuousProperty` on its nodes (that dedicated object does not
 *   exist pre-EML-2.3). This is a **best-effort / lossy** path: RESQML 2.0.x
 *   has no home for `SeismicReferenceDatum` / `WeatheringVelocity` /
 *   `LocalTime3dCrs`, so those are not persisted on the RESQML side (the OSDU
 *   projection flags this via `ExtensionProperties.RoundTripFidelity`).
 *
 * Returns the parts as an array so it composes directly with
 * `RddmsClient.model.put({ parts })`.
 */
export function buildCheckshot(spec: CheckshotSpec): BuiltObject[] {
    if (spec.mds.length !== spec.times.length) {
        throw new Error(`checkshot "${spec.title}": mds (${spec.mds.length}) and times (${spec.times.length}) must be the same length`);
    }
    const v = spec.version;
    const external = versionInfo(v).arrays === "external";

    // 2.2 / 2.3 — dedicated SeismicWellboreFrameRepresentation.
    if (external) {
        const uuid = spec.uuid ?? newUuid();
        const mdPath = `/RESQML/${uuid}/nodeMd`;
        const timePath = `/RESQML/${uuid}/nodeTimeValues`;
        const count = spec.mds.length;

        const object = {
            $type: rtype("obj_SeismicWellboreFrameRepresentation", v),
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
            Trajectory: ref(spec.trajectoryType ?? "obj_WellboreTrajectoryRepresentation", spec.trajectoryUuid, spec.title, v),
            NodeCount: count,
            NodeMd: arrayNode("double", { hdfUuid: spec.hdfUuid, path: mdPath, dims: [count], version: v }),
            NodeTimeValues: arrayNode("double", { hdfUuid: spec.hdfUuid, path: timePath, dims: [count], version: v }),
            ...(spec.seismicReferenceDatum !== undefined ? { SeismicReferenceDatum: spec.seismicReferenceDatum } : {}),
            ...(spec.weatheringVelocity !== undefined ? { WeatheringVelocity: spec.weatheringVelocity } : {}),
            ...(spec.timeCrsUuid ? { LocalTime3dCrs: ref(spec.timeCrsType ?? "obj_LocalTime3dCrs", spec.timeCrsUuid, spec.title, v) } : {}),
        } as unknown as DataObject;

        const arrays: DataArrayInput[] = [
            {
                ContainerType: etype("obj_EpcExternalPartReference", v),
                ContainerUuid: spec.hdfUuid,
                PathInResource: mdPath,
                Dimensions: [count],
                Data: spec.mds,
                ArrayType: "Float64Array",
            },
            {
                ContainerType: etype("obj_EpcExternalPartReference", v),
                ContainerUuid: spec.hdfUuid,
                PathInResource: timePath,
                Dimensions: [count],
                Data: spec.times,
                ArrayType: "Float64Array",
            },
        ];
        return [{ object, arrays }];
    }

    // 2.0.1 / 2.0.2 — WellboreFrameRepresentation + two-way-time ContinuousProperty.
    const frameUuid = spec.uuid ?? newUuid();
    const frame = buildWellboreFrame({
        uuid: frameUuid,
        title: spec.title,
        hdfUuid: spec.hdfUuid,
        version: v,
        trajectoryUuid: spec.trajectoryUuid,
        trajectoryType: spec.trajectoryType,
        interpretationUuid: spec.interpretationUuid,
        interpretationType: spec.interpretationType,
        nodeMd: spec.mds,
        originator: spec.originator,
    });
    const timeProp = buildContinuousProperty({
        title: `${spec.title} — ${spec.timeKind ?? "two-way time"}`,
        hdfUuid: spec.hdfUuid,
        version: v,
        supportingRepUuid: frameUuid,
        supportingRepType: "obj_WellboreFrameRepresentation",
        kind: spec.timeKind ?? "two-way time",
        uom: spec.timeUom ?? "ms",
        values: spec.times,
        indexable: "nodes",
        originator: spec.originator,
    });
    return [frame, { object: timeProp.object, arrays: timeProp.arrays }];
}

/**
 * OSDU WellLog:1.3.0 projection (reversible) for a wellbore frame / checkshot.
 *
 * `WellboreFrameRepresentation` (and its `SeismicWellboreFrameRepresentation`
 * subtype) projects to `work-product-component--WellLog:1.3.0` per the
 * authoritative kindmap (`energistics/resqml/2.3.0/mapping/resqml_osdu_kindmap.yaml`
 * — "flattened; depth summary MinMd/MaxMd/SamplingInterval"). Checkshot-specific
 * acquisition metadata (SeismicReferenceDatum, WeatheringVelocity, time kind,
 * survey type) and the RESQML type + UUID + schema version are carried under
 * `ExtensionProperties` for an exact 2.0.2/2.3.0 ← OSDU reconstruction.
 */
export interface OsduWellLog {
    kind: "osdu:wks:work-product-component--WellLog:1.3.0";
    data: {
        Name: string;
        WellboreID?: string;
        SamplingDomain?: "time" | "depth";
        TopMeasuredDepth?: number;
        BottomMeasuredDepth?: number;
        SamplingInterval?: number;
        SampleCount?: number;
        ExtensionProperties: {
            SeismicReferenceDatum?: number;
            WeatheringVelocity?: number;
            /** LocalTime3dCrs the time axis is expressed in (2.2/2.3 only). */
            LocalTime3dCrsUUID?: string;
            TimeKind?: "two-way time" | "one-way time";
            SurveyType?: "checkshot" | "vsp";
            /**
             * `full` — the source is a native `SeismicWellboreFrameRepresentation`
             * (2.2/2.3): datum, weathering velocity and time CRS survive, so the
             * RESQML object reconstructs exactly. `lossy` — the source is a 2.0.x
             * `WellboreFrameRepresentation` + time property: that line has no home
             * for the seismic acquisition metadata, so the reverse rebuild is
             * best-effort (ad-hoc).
             */
            RoundTripFidelity: "full" | "lossy";
            "x-resqml-type": string;
            ResqmlObjectUUID: string;
            ResqmlSchemaVersion: string;
        };
    };
}

/** Local-name of a RESQML `$type` (strip `obj_` + namespace prefix). */
function resqmlLocalName(type?: string): string {
    if (!type) return "";
    const bare = type.includes(".") ? type.split(".").pop()! : type;
    return bare.replace(/^obj_/, "");
}

/**
 * Project a RESQML WellboreFrame / SeismicWellboreFrame onto OSDU
 * WellLog:1.3.0. Pass `mds` to populate the flattened depth summary
 * (Top/Bottom MeasuredDepth + SamplingInterval); `surveyType`/`timeKind`
 * capture the acquisition context that RESQML holds on the associated activity.
 */
export function toOsduWellLog(
    frame: DataObject,
    opts?: {
        version?: ResqmlVersion;
        mds?: number[];
        wellboreId?: string;
        surveyType?: "checkshot" | "vsp";
        timeKind?: "two-way time" | "one-way time";
    },
): OsduWellLog {
    const f = frame as Record<string, any>;
    const local = resqmlLocalName(f.$type);
    const isSeismic = local === "SeismicWellboreFrameRepresentation";
    // DOR uuid is `UUID` on 2.0.x (eml20) and `Uuid` on 2.2/2.3 (eml23).
    const timeCrsUuid = f.LocalTime3dCrs?.UUID ?? f.LocalTime3dCrs?.Uuid;
    const mds = opts?.mds;
    const top = mds && mds.length ? Math.min(...mds) : undefined;
    const bottom = mds && mds.length ? Math.max(...mds) : undefined;
    const interval = mds && mds.length > 1 ? (Math.max(...mds) - Math.min(...mds)) / (mds.length - 1) : undefined;
    return {
        kind: "osdu:wks:work-product-component--WellLog:1.3.0",
        data: {
            Name: f.Citation?.Title ?? "",
            ...(opts?.wellboreId ? { WellboreID: opts.wellboreId } : {}),
            SamplingDomain: isSeismic ? "time" : "depth",
            ...(top !== undefined ? { TopMeasuredDepth: top } : {}),
            ...(bottom !== undefined ? { BottomMeasuredDepth: bottom } : {}),
            ...(interval !== undefined ? { SamplingInterval: interval } : {}),
            ...(typeof f.NodeCount === "number" ? { SampleCount: f.NodeCount } : {}),
            ExtensionProperties: {
                ...(f.SeismicReferenceDatum !== undefined ? { SeismicReferenceDatum: f.SeismicReferenceDatum } : {}),
                ...(f.WeatheringVelocity !== undefined ? { WeatheringVelocity: f.WeatheringVelocity } : {}),
                ...(timeCrsUuid ? { LocalTime3dCrsUUID: timeCrsUuid } : {}),
                ...(opts?.timeKind ? { TimeKind: opts.timeKind } : {}),
                ...(opts?.surveyType ? { SurveyType: opts.surveyType } : {}),
                RoundTripFidelity: isSeismic ? "full" : "lossy",
                "x-resqml-type": local,
                ResqmlObjectUUID: f.Uuid ?? "",
                ResqmlSchemaVersion: f.SchemaVersion ?? schemaVersion(opts?.version),
            },
        },
    };
}
