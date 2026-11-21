/**
 * Reservoir-model organisation builders — zones (stratigraphy) and regions
 * (rock-fluid / SATNUM-style tags).
 *
 * These emit the RESQML *interpretation* object graphs that give reservoir
 * groupings a first-class identity, rather than leaving them as anonymous
 * integer arrays. Everything here is RESQML 2.0.1-native and round-trips
 * through fesapi and resqpy:
 *
 *   Zone   = StratigraphicOrganizationFeature
 *          + StratigraphicUnitFeature[]            (one per zone)
 *          + StratigraphicUnitInterpretation[]     (one per zone)
 *          + StratigraphicColumnRankInterpretation (orders the units)
 *          + StratigraphicColumn                   (optional global hierarchy)
 *
 *   Region = StringTableLookup                     (index → region name legend)
 *          + CategoricalProperty                   (per-cell region code on a grid)
 *
 *   Fluid  = Model                                 (organisation feature, 2.2)
 *          + RockVolumeFeature[]                    (one per fluid unit)
 *          + RockFluidUnitInterpretation[]          (one per unit, phase-tagged)
 *          + BoundaryFeature[] / FluidBoundaryInterpretation[]  (GOC/WOC/FWL…)
 *          + RockFluidOrganizationInterpretation    (unbounded unit list)
 *
 * Grounding (OPM/GRDECL → RESQML):
 *   - Zones  ↔ geological layering; the per-K-interval zonation additionally
 *     maps onto the grid child `IntervalStratigraphicUnits` (grid-authoring).
 *   - Regions ↔ SATNUM / PVTNUM / EQLNUM / FIPNUM keywords. The lightweight,
 *     universally-correct 2.0.1 representation is a CategoricalProperty with a
 *     lookup legend. The *structured* multi-phase `RockFluidOrganization` graph
 *     (a real fluid-in-place model with several units and contacts) is built by
 *     `buildRockFluidModel` on the **RESQML 2.2** line: 2.0.1 caps the
 *     organisation at a single `RockFluidUnitIndex` and forces mandatory
 *     top/bottom contacts on every unit, whereas 2.2 makes the unit list
 *     unbounded. On this stack 2.3 rides the same resqml22/eml23 namespaces, so
 *     2.2 is the concrete foundation for the 2.3 track.
 *   - The cell↔unit hydrostatic column and interval↔zone maps live on the grid
 *     itself (`CellFluidPhaseUnits`, `IntervalStratigraphicUnits`) and are
 *     emitted by the grid-authoring helpers below, which patch an existing grid.
 *
 * Pure and I/O-free, like every builder in this folder.
 */

import type { DataObject, DataArrayInput } from "./types";
import { Domain, ResqmlVersion, arrayNode, citation, etype, newUuid, ref, rtype, schemaVersion } from "./core";
import { buildCategoricalProperty, buildDiscreteProperty } from "./property";
import type { IndexableElement } from "./property";

/** How a stratigraphic column's units are ordered (RESQML `OrderingCriteria`). */
export type OrderingCriteria = "age" | "apparent depth" | "measured depth";

/** RESQML `DepositionMode` for a stratigraphic unit. */
export type DepositionMode =
    | "proportional between top and bottom"
    | "parallel to bottom"
    | "parallel to top"
    | "parallel to another boundary";

/** One stratigraphic zone (a K-layer grouping). */
export interface ZoneSpec {
    name: string;
    depositionMode?: DepositionMode;
}

export interface StratigraphicColumnSpec {
    uuid?: string;
    title: string;
    version?: ResqmlVersion;
    domain?: Domain;
    /** Zones, ordered top → bottom by default (index 0 is the shallowest). */
    zones: ZoneSpec[];
    /** Ordering criteria for the column rank (default "age"). */
    orderingCriteria?: OrderingCriteria;
    /** Rank index within the stratigraphic column (default 0). */
    rankIndex?: number;
    /** Also emit the top-level StratigraphicColumn hierarchy object (default true). */
    includeColumn?: boolean;
    originator?: string;
}

export interface StratigraphicColumnResult {
    objects: DataObject[];
    featureUuid: string;
    rankUuid: string;
    columnUuid?: string;
    unitFeatureUuids: string[];
    unitInterpretationUuids: string[];
}

/**
 * Build the full stratigraphic zonation graph. Returns the flat list of
 * objects (no bulk arrays) plus the key UUIDs so callers can reference the rank
 * from a grid's `IntervalStratigraphicUnits` or from a membership property.
 */
export function buildStratigraphicColumn(spec: StratigraphicColumnSpec): StratigraphicColumnResult {
    if (!spec.zones || spec.zones.length === 0) {
        throw new Error("A stratigraphic column requires at least one zone");
    }
    const v = spec.version;
    const domain: Domain = spec.domain ?? "depth";
    const objects: DataObject[] = [];

    // The organisation feature the rank interprets.
    const featureUuid = newUuid();
    objects.push({
        $type: rtype("obj_OrganizationFeature", v),
        Uuid: featureUuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        OrganizationKind: "stratigraphic",
    } as unknown as DataObject);

    const unitFeatureUuids: string[] = [];
    const unitInterpretationUuids: string[] = [];
    const stratigraphicUnits: { $type: string; Index: number; Unit: DataObject }[] = [];

    spec.zones.forEach((zone, i) => {
        // Feature: the natural-world stratigraphic unit.
        const featUuid = newUuid();
        unitFeatureUuids.push(featUuid);
        objects.push({
            $type: rtype("obj_StratigraphicUnitFeature", v),
            Uuid: featUuid,
            SchemaVersion: schemaVersion(v),
            Citation: citation(zone.name, { originator: spec.originator }),
        } as unknown as DataObject);

        // Interpretation of that unit.
        const interpUuid = newUuid();
        unitInterpretationUuids.push(interpUuid);
        objects.push({
            $type: rtype("obj_StratigraphicUnitInterpretation", v),
            Uuid: interpUuid,
            SchemaVersion: schemaVersion(v),
            Citation: citation(zone.name, { originator: spec.originator }),
            Domain: domain,
            InterpretedFeature: ref("obj_StratigraphicUnitFeature", featUuid, zone.name, v),
            ...(zone.depositionMode ? { DepositionMode: zone.depositionMode } : {}),
        } as unknown as DataObject);

        stratigraphicUnits.push({
            $type: rtype("StratigraphicUnitInterpretationIndex", v),
            Index: i,
            Unit: ref("obj_StratigraphicUnitInterpretation", interpUuid, zone.name, v),
        });
    });

    // The column rank interpretation orders the units.
    const rankUuid = spec.uuid ?? newUuid();
    objects.push({
        $type: rtype("obj_StratigraphicColumnRankInterpretation", v),
        Uuid: rankUuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        Domain: domain,
        InterpretedFeature: ref("obj_OrganizationFeature", featureUuid, spec.title, v),
        OrderingCriteria: spec.orderingCriteria ?? "age",
        Index: spec.rankIndex ?? 0,
        StratigraphicUnits: stratigraphicUnits,
    } as unknown as DataObject);

    let columnUuid: string | undefined;
    if (spec.includeColumn ?? true) {
        columnUuid = newUuid();
        objects.push({
            $type: rtype("obj_StratigraphicColumn", v),
            Uuid: columnUuid,
            SchemaVersion: schemaVersion(v),
            Citation: citation(spec.title, { originator: spec.originator }),
            Ranks: [ref("obj_StratigraphicColumnRankInterpretation", rankUuid, spec.title, v)],
        } as unknown as DataObject);
    }

    return { objects, featureUuid, rankUuid, columnUuid, unitFeatureUuids, unitInterpretationUuids };
}

/** One entry of a region legend: an integer code and its human name. */
export interface RegionLegendEntry {
    code: number;
    name: string;
}

/** Build a StringTableLookup (integer code → string name legend). */
export function buildStringTableLookup(spec: {
    uuid?: string;
    title: string;
    entries: RegionLegendEntry[];
    version?: ResqmlVersion;
    originator?: string;
}): { uuid: string; object: DataObject } {
    const v = spec.version;
    const uuid = spec.uuid ?? newUuid();
    const object = {
        $type: rtype("obj_StringTableLookup", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        Value: spec.entries.map((e) => ({ $type: rtype("StringLookup", v), Key: e.code, Value: e.name })),
    } as unknown as DataObject;
    return { uuid, object };
}

export interface RegionSetSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    version?: ResqmlVersion;
    /** Grid (or other representation) the region codes are attached to. */
    supportingRepUuid: string;
    supportingRepType?: string;
    /** Property kind for the region array (default "index"). */
    kind?: string;
    /** Per-cell (or per-element) integer region code. */
    regionCodes: number[];
    /** Indexable element (default "cells"). */
    indexable?: IndexableElement;
    /** Optional legend (code → name). When present a CategoricalProperty + StringTableLookup are emitted. */
    legend?: RegionLegendEntry[];
    dimensions?: number[];
    originator?: string;
}

export interface RegionSetResult {
    objects: DataObject[];
    arrays: DataArrayInput[];
    propertyUuid: string;
    lookupUuid?: string;
}

/**
 * Build a reservoir region assignment (SATNUM / PVTNUM / EQLNUM / FIPNUM …).
 *
 * With a `legend` the region is a CategoricalProperty backed by a
 * StringTableLookup (named regions, RESQML-native). Without one it falls back
 * to a plain DiscreteProperty (anonymous integer codes) — the lightweight path.
 */
export function buildRegionSet(spec: RegionSetSpec): RegionSetResult {
    const v = spec.version;
    const kind = spec.kind ?? "index";
    const supportingRepType = spec.supportingRepType ?? "obj_IjkGridRepresentation";

    if (spec.legend && spec.legend.length > 0) {
        const lookup = buildStringTableLookup({
            title: `${spec.title} legend`,
            entries: spec.legend,
            version: v,
            originator: spec.originator,
        });
        const prop = buildCategoricalProperty({
            uuid: spec.uuid,
            title: spec.title,
            hdfUuid: spec.hdfUuid,
            version: v,
            supportingRepUuid: spec.supportingRepUuid,
            supportingRepType,
            lookupUuid: lookup.uuid,
            kind,
            values: spec.regionCodes,
            indexable: spec.indexable ?? "cells",
            dimensions: spec.dimensions,
            originator: spec.originator,
        });
        return {
            objects: [lookup.object, prop.object],
            arrays: prop.arrays,
            propertyUuid: prop.object.Uuid as string,
            lookupUuid: lookup.uuid,
        };
    }

    const prop = buildDiscreteProperty({
        uuid: spec.uuid,
        title: spec.title,
        hdfUuid: spec.hdfUuid,
        version: v,
        supportingRepUuid: spec.supportingRepUuid,
        supportingRepType,
        kind,
        values: spec.regionCodes,
        indexable: spec.indexable ?? "cells",
        dimensions: spec.dimensions,
        originator: spec.originator,
    });
    return { objects: [prop.object], arrays: prop.arrays, propertyUuid: prop.object.Uuid as string };
}

// ----------------------------------------------------------------------------
// Rock-fluid organisation — the genuine multi-region fluid-in-place model.
//
// Unlike a region CategoricalProperty (anonymous integer codes), this emits a
// first-class organisation of named fluid *units* (aquifer / oil column / gas
// cap …) separated by fluid *contacts* (GOC / WOC / free-water level). RESQML
// 2.0.1 cannot express it (single `RockFluidUnitIndex`, mandatory top/bottom
// contact per unit); the unit list only becomes unbounded from RESQML 2.2, so
// this builder targets the 2.2 line (the physical foundation of the 2.3 track
// on this stack). Pure metadata — no bulk arrays.
// ----------------------------------------------------------------------------

/** The fluid phase a rock-fluid unit carries (RESQML `Phase`). */
export type FluidPhase = "aquifer" | "gas cap" | "oil column" | "seal";

/** The kind of fluid contact a boundary represents (RESQML `FluidContact`). */
export type FluidContact =
    | "free water contact"
    | "gas oil contact"
    | "gas water contact"
    | "seal"
    | "water oil contact";

/** One fluid unit (a phase compartment) of the fluid-in-place model. */
export interface FluidUnitSpec {
    name: string;
    phase?: FluidPhase;
}

/** One fluid contact separating two units (e.g. an oil-water contact). */
export interface FluidBoundarySpec {
    name: string;
    contact: FluidContact;
}

export interface RockFluidModelSpec {
    uuid?: string;
    title: string;
    /** RESQML line — must be 2.2.0+ for a genuine multi-unit organisation (default 2.2.0). */
    version?: ResqmlVersion;
    domain?: Domain;
    /** Fluid units, ordered top → bottom (index 0 shallowest). At least one. */
    units: FluidUnitSpec[];
    /** Fluid contacts between the units (GOC / WOC / FWL …). Optional. */
    boundaries?: FluidBoundarySpec[];
    originator?: string;
}

export interface RockFluidModelResult {
    objects: DataObject[];
    /** The RockFluidOrganizationInterpretation UUID (reference this from a grid `CellFluidPhaseUnits`). */
    orgUuid: string;
    /** The organisation feature (2.2 `Model`) the organisation interprets. */
    orgFeatureUuid: string;
    unitFeatureUuids: string[];
    unitInterpretationUuids: string[];
    boundaryFeatureUuids: string[];
    boundaryInterpretationUuids: string[];
}

/** RESQML lines whose `RockFluidOrganizationInterpretation` allows an unbounded unit list. */
export const MULTI_REGION_FLUID_VERSIONS: ResqmlVersion[] = ["2.2.0"];

/**
 * Build a genuine multi-region rock-fluid organisation: a `Model` organisation
 * feature, a `RockVolumeFeature` + `RockFluidUnitInterpretation` per fluid unit,
 * an optional `BoundaryFeature` + `FluidBoundaryInterpretation` per contact, and
 * the `RockFluidOrganizationInterpretation` that lists all units.
 */
export function buildRockFluidModel(spec: RockFluidModelSpec): RockFluidModelResult {
    if (!spec.units || spec.units.length === 0) {
        throw new Error("A rock-fluid model requires at least one fluid unit");
    }
    const v: ResqmlVersion = spec.version ?? "2.2.0";
    if (!MULTI_REGION_FLUID_VERSIONS.includes(v)) {
        throw new Error(
            `A genuine multi-region rock-fluid model needs RESQML 2.2.0+ (unbounded units); got ${v}. ` +
            "RESQML 2.0.1 caps the organisation at a single unit with mandatory top/bottom fluid contacts — " +
            "use buildRegionSet for a lightweight 2.0.1 region property instead.",
        );
    }
    const domain: Domain = spec.domain ?? "depth";
    const objects: DataObject[] = [];

    // Organisation feature (RESQML 2.2 successor to 2.0.1's OrganizationFeature).
    const orgFeatureUuid = newUuid();
    objects.push({
        $type: rtype("Model", v),
        Uuid: orgFeatureUuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
    } as unknown as DataObject);

    // Fluid contacts: a boundary feature + its fluid-contact interpretation.
    const boundaryFeatureUuids: string[] = [];
    const boundaryInterpretationUuids: string[] = [];
    (spec.boundaries ?? []).forEach((b) => {
        const bFeat = newUuid();
        boundaryFeatureUuids.push(bFeat);
        objects.push({
            $type: rtype("BoundaryFeature", v),
            Uuid: bFeat,
            SchemaVersion: schemaVersion(v),
            Citation: citation(b.name, { originator: spec.originator }),
        } as unknown as DataObject);

        const bInterp = newUuid();
        boundaryInterpretationUuids.push(bInterp);
        objects.push({
            $type: rtype("FluidBoundaryInterpretation", v),
            Uuid: bInterp,
            SchemaVersion: schemaVersion(v),
            Citation: citation(b.name, { originator: spec.originator }),
            Domain: domain,
            InterpretedFeature: ref("BoundaryFeature", bFeat, b.name, v),
            FluidContact: b.contact,
        } as unknown as DataObject);
    });

    // Fluid units: a rock-volume feature + its phase-tagged interpretation.
    const unitFeatureUuids: string[] = [];
    const unitInterpretationUuids: string[] = [];
    const unitRefs: DataObject[] = [];
    spec.units.forEach((u) => {
        const uFeat = newUuid();
        unitFeatureUuids.push(uFeat);
        objects.push({
            $type: rtype("RockVolumeFeature", v),
            Uuid: uFeat,
            SchemaVersion: schemaVersion(v),
            Citation: citation(u.name, { originator: spec.originator }),
        } as unknown as DataObject);

        const uInterp = newUuid();
        unitInterpretationUuids.push(uInterp);
        objects.push({
            $type: rtype("RockFluidUnitInterpretation", v),
            Uuid: uInterp,
            SchemaVersion: schemaVersion(v),
            Citation: citation(u.name, { originator: spec.originator }),
            Domain: domain,
            InterpretedFeature: ref("RockVolumeFeature", uFeat, u.name, v),
            ...(u.phase ? { Phase: u.phase } : {}),
        } as unknown as DataObject);

        unitRefs.push(ref("RockFluidUnitInterpretation", uInterp, u.name, v));
    });

    // The organisation interpretation — the multi-region graph itself.
    const orgUuid = spec.uuid ?? newUuid();
    objects.push({
        $type: rtype("RockFluidOrganizationInterpretation", v),
        Uuid: orgUuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        Domain: domain,
        InterpretedFeature: ref("Model", orgFeatureUuid, spec.title, v),
        RockFluidUnit: unitRefs,
    } as unknown as DataObject);

    return {
        objects,
        orgUuid,
        orgFeatureUuid,
        unitFeatureUuids,
        unitInterpretationUuids,
        boundaryFeatureUuids,
        boundaryInterpretationUuids,
    };
}

// ----------------------------------------------------------------------------
// Grid-child mappings — re-author an existing grid to carry the interval→zone
// and cell→fluid-unit maps. These are *child elements* of the grid object, so
// each builder is pure — it produces the child node + its integer array — and
// the caller merges the child into a freshly-fetched grid object and re-writes
// the grid (same UUID). The grid's geometry arrays are untouched (they stay in
// HDF, referenced by path); only the grid object XML gains one child element.
// ----------------------------------------------------------------------------

/** Which grid child element a `GridChildResult` targets. */
export type GridChildKey = "IntervalStratigraphicUnits" | "CellFluidPhaseUnits";

export interface GridChildResult {
    /** The grid this child must be merged into. */
    gridUuid: string;
    /** The child element key to set on the grid object. */
    childKey: GridChildKey;
    /** The child element node (goes straight onto `grid[childKey]`). */
    child: DataObject;
    /** The integer array the child references (written to the grid's HDF proxy). */
    array: DataArrayInput;
    /** HDF path the array lives at. */
    path: string;
}

export interface IntervalStratigraphicUnitsSpec {
    gridUuid: string;
    /** The grid's HDF external-part-reference UUID (where the array is written). */
    hdfUuid: string;
    /** The StratigraphicColumnRankInterpretation UUID (the `rankUuid` from buildStratigraphicColumn). */
    stratigraphicColumnRankUuid: string;
    /** Stratigraphic unit index per grid interval (layers + K gaps). Use -1 where none (e.g. salt). */
    unitIndices: number[];
    /** The grid's RESQML line (default 2.0.1). */
    version?: ResqmlVersion;
    rankTitle?: string;
}

/**
 * Build the grid child that maps each K-interval to a stratigraphic unit. Merge
 * `result.child` onto the fetched grid at `result.childKey` and write the grid
 * with `result.array`.
 */
export function buildIntervalStratigraphicUnits(spec: IntervalStratigraphicUnitsSpec): GridChildResult {
    if (!spec.unitIndices || spec.unitIndices.length === 0) {
        throw new Error("IntervalStratigraphicUnits requires a non-empty unitIndices array");
    }
    const v = spec.version;
    const path = `/RESQML/${spec.gridUuid}/intervalStratigraphicUnits`;
    const child = {
        StratigraphicOrganization: ref(
            "obj_StratigraphicColumnRankInterpretation",
            spec.stratigraphicColumnRankUuid,
            spec.rankTitle ?? "Stratigraphic column rank",
            v,
        ),
        UnitIndices: arrayNode("integer", {
            hdfUuid: spec.hdfUuid,
            path,
            dims: [spec.unitIndices.length],
            nullValue: -1,
            version: v,
        }),
    } as unknown as DataObject;
    const array: DataArrayInput = {
        ContainerType: etype("obj_EpcExternalPartReference", v),
        ContainerUuid: spec.hdfUuid,
        PathInResource: path,
        Dimensions: [spec.unitIndices.length],
        Data: spec.unitIndices,
        ArrayType: "Int32Array",
    };
    return { gridUuid: spec.gridUuid, childKey: "IntervalStratigraphicUnits", child, array, path };
}

export interface CellFluidPhaseUnitsSpec {
    gridUuid: string;
    /** The grid's HDF external-part-reference UUID (where the array is written). */
    hdfUuid: string;
    /** The RockFluidOrganizationInterpretation UUID (the `orgUuid` from buildRockFluidModel). */
    fluidOrganizationUuid: string;
    /** Qualified type of the fluid organisation (default RockFluidOrganizationInterpretation). */
    fluidOrganizationType?: string;
    /** The RESQML line of the referenced fluid organisation (default 2.2.0). */
    fluidOrganizationVersion?: ResqmlVersion;
    /** Fluid-unit index per cell (indexing follows the organisation's unit order). -1 = none (seal). */
    phaseUnitIndices: number[];
    /** The grid's RESQML line (default 2.0.1). */
    version?: ResqmlVersion;
    orgTitle?: string;
}

/**
 * Build the grid child that maps each cell to a fluid-phase unit (the initial
 * hydrostatic fluid column). Merge `result.child` onto the fetched grid and
 * write the grid with `result.array`.
 */
export function buildCellFluidPhaseUnits(spec: CellFluidPhaseUnitsSpec): GridChildResult {
    if (!spec.phaseUnitIndices || spec.phaseUnitIndices.length === 0) {
        throw new Error("CellFluidPhaseUnits requires a non-empty phaseUnitIndices array");
    }
    const v = spec.version;
    const orgType = spec.fluidOrganizationType ?? "RockFluidOrganizationInterpretation";
    const orgV = spec.fluidOrganizationVersion ?? "2.2.0";
    const path = `/RESQML/${spec.gridUuid}/cellFluidPhaseUnits`;
    const child = {
        FluidOrganization: ref(orgType, spec.fluidOrganizationUuid, spec.orgTitle ?? "Rock-fluid organisation", v, orgV),
        PhaseUnitIndices: arrayNode("integer", {
            hdfUuid: spec.hdfUuid,
            path,
            dims: [spec.phaseUnitIndices.length],
            nullValue: -1,
            version: v,
        }),
    } as unknown as DataObject;
    const array: DataArrayInput = {
        ContainerType: etype("obj_EpcExternalPartReference", v),
        ContainerUuid: spec.hdfUuid,
        PathInResource: path,
        Dimensions: [spec.phaseUnitIndices.length],
        Data: spec.phaseUnitIndices,
        ArrayType: "Int32Array",
    };
    return { gridUuid: spec.gridUuid, childKey: "CellFluidPhaseUnits", child, array, path };
}
