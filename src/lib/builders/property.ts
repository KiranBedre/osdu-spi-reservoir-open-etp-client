/**
 * Property builders — ContinuousProperty and DiscreteProperty on any
 * supporting representation (Grid2d, PointSet, IjkGrid, …).
 *
 * Property kind is canonicalised through the vocabulary module so builders
 * never emit an abstract kind that the strict validator (P02–P04) would
 * reject. UOM is carried explicitly (attacks the ToDo O3 "units lost" gap).
 * For well-log curves, the client composes this with `/pwls/resolve` — the
 * server stays the authority for mnemonic semantics.
 */

import type { DataObject, DataArrayInput } from "./types";
import { BuiltObject, ResqmlVersion, arrayNode, citation, etype, newUuid, ref, rtype, schemaVersion } from "./core";
import { resolvePropertyKind } from "./vocabulary";

export type IndexableElement = "nodes" | "cells" | "columns" | "faces" | "contacts";

/**
 * Single-pass min/max over an array of values.
 *
 * IMPORTANT: never use `Math.min(...values)` / `Math.max(...values)` here — the
 * spread pushes every element onto the call stack as an argument and throws
 * `RangeError: Maximum call stack size exceeded` for grid-scale arrays (V8 caps
 * arguments at ~65k–120k). This loop is O(n), allocation-free, and works on both
 * `number[]` and typed arrays (`Float64Array` / `Int32Array`).
 */
function minMax(values: ArrayLike<number>): { min: number; max: number } {
    const n = values.length;
    if (n === 0) return { min: 0, max: 0 };
    let min = values[0];
    let max = values[0];
    for (let i = 1; i < n; i++) {
        const x = values[i];
        if (x < min) min = x;
        else if (x > max) max = x;
    }
    return { min, max };
}

export interface ContinuousPropertySpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    version?: ResqmlVersion;
    /** Representation the property is attached to. */
    supportingRepUuid: string;
    supportingRepType: string;
    /** Property kind — canonicalised via the vocabulary before emit. */
    kind: string;
    /** Unit of measure (e.g. "m", "m/s", "ms", "euc"). */
    uom: string;
    values: number[];
    dimensions?: number[];
    indexable?: IndexableElement;
    originator?: string;
    /**
     * Array-backed bridge (§6.4.3): point PatchOfValues at an EXISTING external
     * array path (e.g. `/WITSML/{uuid}/{mnemonic}`) instead of emitting a new
     * array, so a stored WITSML/ProdML curve can be promoted to a RESQML
     * ContinuousProperty with no data copy. When set, `values` may be empty and
     * `min`/`max` are taken from `minValue`/`maxValue` (or omitted).
     */
    externalArrayPath?: string;
    /** HDF proxy UUID that owns `externalArrayPath` (defaults to `hdfUuid`). */
    externalArrayHdfUuid?: string;
    /** Precomputed minimum (used only with `externalArrayPath`). */
    minValue?: number;
    /** Precomputed maximum (used only with `externalArrayPath`). */
    maxValue?: number;
}

/** Build a ContinuousProperty with a canonical kind + explicit UOM. */
export function buildContinuousProperty(spec: ContinuousPropertySpec): BuiltObject & { kindResolution: ReturnType<typeof resolvePropertyKind> } {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const kindRes = resolvePropertyKind(spec.kind);
    const arrayBacked = typeof spec.externalArrayPath === "string" && spec.externalArrayPath.length > 0;
    const path = arrayBacked ? spec.externalArrayPath! : `/RESQML/${uuid}/values_patch0`;
    const arrayHdfUuid = arrayBacked ? (spec.externalArrayHdfUuid ?? spec.hdfUuid) : spec.hdfUuid;
    const dims = spec.dimensions ?? [spec.values.length];
    const { min, max } = arrayBacked
        ? { min: spec.minValue, max: spec.maxValue }
        : minMax(spec.values);

    const object = {
        $type: rtype("obj_ContinuousProperty", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        Count: 1,
        IndexableElement: spec.indexable ?? "nodes",
        PropertyKind: { $type: rtype("StandardPropertyKind", v), Kind: kindRes.kind },
        SupportingRepresentation: ref(spec.supportingRepType, spec.supportingRepUuid, spec.title, v),
        PatchOfValues: [
            {
                RepresentationPatchIndex: 0,
                Values: arrayNode("double", { hdfUuid: arrayHdfUuid, path, dims, version: v }),
            },
        ],
        ...(min != null ? { MinimumValue: [min] } : {}),
        ...(max != null ? { MaximumValue: [max] } : {}),
        UOM: spec.uom,
    } as unknown as DataObject;

    // Array-backed bridge references an existing array → emit NO new array.
    const arrays: DataArrayInput[] = arrayBacked
        ? []
        : [
            {
                ContainerType: etype("obj_EpcExternalPartReference", v),
                ContainerUuid: arrayHdfUuid,
                PathInResource: path,
                Dimensions: dims,
                Data: spec.values,
                ArrayType: "Float64Array",
            },
        ];
    return { object, arrays, kindResolution: kindRes };
}

export interface DiscretePropertySpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    supportingRepUuid: string;
    supportingRepType: string;
    /** Property kind — discrete-aware canonicalisation (P03). */
    kind: string;
    values: number[];
    dimensions?: number[];
    indexable?: IndexableElement;
    nullValue?: number;
    version?: ResqmlVersion;
    originator?: string;
}

/** Build a DiscreteProperty (integer categories/indices) with a discrete-safe kind. */
export function buildDiscreteProperty(spec: DiscretePropertySpec): BuiltObject & { kindResolution: ReturnType<typeof resolvePropertyKind> } {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const kindRes = resolvePropertyKind(spec.kind, { discrete: true });
    const path = `/RESQML/${uuid}/values_patch0`;
    const { min, max } = minMax(spec.values);

    const object = {
        $type: rtype("obj_DiscreteProperty", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        Count: 1,
        IndexableElement: spec.indexable ?? "cells",
        PropertyKind: { $type: rtype("StandardPropertyKind", v), Kind: kindRes.kind },
        SupportingRepresentation: ref(spec.supportingRepType, spec.supportingRepUuid, spec.title, v),
        PatchOfValues: [
            {
                RepresentationPatchIndex: 0,
                Values: arrayNode("integer", {
                    hdfUuid: spec.hdfUuid,
                    path,
                    dims: spec.dimensions ?? [spec.values.length],
                    nullValue: spec.nullValue ?? -1,
                    version: v,
                }),
            },
        ],
        MinimumValue: [min],
        MaximumValue: [max],
    } as unknown as DataObject;

    const arrays: DataArrayInput[] = [
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: path,
            Dimensions: spec.dimensions ?? [spec.values.length],
            Data: spec.values,
            ArrayType: "Int32Array",
        },
    ];
    return { object, arrays, kindResolution: kindRes };
}

export interface CategoricalPropertySpec extends DiscretePropertySpec {
    /** DOR of the StringTableLookup (or DoubleTableLookup) that decodes the integer codes. */
    lookupUuid: string;
    /** Qualified type of the lookup (default obj_StringTableLookup). */
    lookupType?: string;
}

/**
 * Build a CategoricalProperty — a discrete property whose integer codes are
 * decoded by a lookup table (index → region/zone name). This is the
 * RESQML-native form for named regions (SATNUM/FIPNUM/…) and zones, richer
 * than a bare DiscreteProperty because the code legend travels with the data.
 */
export function buildCategoricalProperty(spec: CategoricalPropertySpec): BuiltObject & { kindResolution: ReturnType<typeof resolvePropertyKind> } {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const kindRes = resolvePropertyKind(spec.kind, { discrete: true });
    const path = `/RESQML/${uuid}/values_patch0`;

    const object = {
        $type: rtype("obj_CategoricalProperty", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        Count: 1,
        IndexableElement: spec.indexable ?? "cells",
        PropertyKind: { $type: rtype("StandardPropertyKind", v), Kind: kindRes.kind },
        Lookup: ref(spec.lookupType ?? "obj_StringTableLookup", spec.lookupUuid, spec.title, v),
        SupportingRepresentation: ref(spec.supportingRepType, spec.supportingRepUuid, spec.title, v),
        PatchOfValues: [
            {
                RepresentationPatchIndex: 0,
                Values: arrayNode("integer", {
                    hdfUuid: spec.hdfUuid,
                    path,
                    dims: spec.dimensions ?? [spec.values.length],
                    nullValue: spec.nullValue ?? -1,
                    version: v,
                }),
            },
        ],
    } as unknown as DataObject;

    const arrays: DataArrayInput[] = [
        {
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: path,
            Dimensions: spec.dimensions ?? [spec.values.length],
            Data: spec.values,
            ArrayType: "Int32Array",
        },
    ];
    return { object, arrays, kindResolution: kindRes };
}

/**
 * Velocity-model kinds. Short aliases map onto the canonical seismic velocity
 * kinds carried in the vocabulary (`SEISMIC_PROPERTY_KINDS`).
 * Source: datadef `seismic-interpretation` companion; Checkshots.md / VSP.md.
 */
export type VelocityKind = "interval" | "average" | "rms" | "Vp" | "Vs" | "Vp/Vs";

const VELOCITY_KIND_MAP: Record<VelocityKind, string> = {
    interval: "interval velocity",
    average: "average velocity",
    rms: "RMS velocity",
    Vp: "Vp",
    Vs: "Vs",
    "Vp/Vs": "Vp/Vs",
};

export interface VelocityModelSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    version?: ResqmlVersion;
    /** Supporting representation (Grid2d for a layer velocity, IjkGrid for a volume). */
    supportingRepUuid: string;
    supportingRepType: string;
    /** Velocity kind — interval/average/rms/Vp/Vs/Vp/Vs. */
    velocityKind: VelocityKind;
    /** Velocity values, aligned to the supporting representation's indexable element. */
    values: number[];
    /** UOM — defaults to "m/s" (ratios like Vp/Vs default to "euc"). */
    uom?: string;
    dimensions?: number[];
    indexable?: IndexableElement;
    originator?: string;
}

/**
 * Build a velocity model as a ContinuousProperty with a canonical velocity kind
 * and an explicit velocity UOM. Thin, domain-shaped wrapper over
 * `buildContinuousProperty` (short-term plan #8 — closes G6, ties the well and
 * seismic-interpretation domains). Interval/average/RMS velocity grids and
 * Vp/Vs/(Vp/Vs) volumes all route through here so tools emit identical graphs.
 */
export function buildVelocityModel(
    spec: VelocityModelSpec,
): BuiltObject & { kindResolution: ReturnType<typeof resolvePropertyKind> } {
    const kind = VELOCITY_KIND_MAP[spec.velocityKind];
    const uom = spec.uom ?? (spec.velocityKind === "Vp/Vs" ? "euc" : "m/s");
    return buildContinuousProperty({
        uuid: spec.uuid,
        title: spec.title,
        hdfUuid: spec.hdfUuid,
        version: spec.version,
        supportingRepUuid: spec.supportingRepUuid,
        supportingRepType: spec.supportingRepType,
        kind,
        uom,
        values: spec.values,
        dimensions: spec.dimensions,
        indexable: spec.indexable,
        originator: spec.originator,
    });
}

/**
 * OSDU GenericProperty:1.0.0 projection (reversible).
 *
 * Every RESQML property (Continuous/Discrete, incl. a velocity model) projects
 * to `work-product-component--GenericProperty:1.0.0` per the authoritative map
 * (`energistics/resqml/<version>/mapping/{osdu_projection.yaml,resqml_osdu_kindmap.yaml}`
 * — "all properties → GenericProperty; PropertyKind → PWLS PropertyType").
 * `ValueType` derives from the RESQML type (ContinuousProperty→continuous,
 * DiscreteProperty→discrete). The RESQML type + UUID + schema version are
 * stamped under `ExtensionProperties` so the reverse RESQML ← OSDU
 * reconstruction is exact.
 */
export interface OsduGenericProperty {
    kind: "osdu:wks:work-product-component--GenericProperty:1.0.0";
    data: {
        Name: string;
        /** RESQML PropertyKind (also the PWLS PropertyType lookup key). */
        PropertyType?: string;
        UnitOfMeasure?: string;
        ValueType?: "continuous" | "discrete";
        MinValue?: number;
        MaxValue?: number;
        ExtensionProperties: {
            /** Canonical velocity kind when this property is a velocity model. */
            VelocityKind?: string;
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

/** Project a RESQML Continuous/DiscreteProperty onto OSDU GenericProperty:1.0.0. */
export function toOsduGenericProperty(
    prop: DataObject,
    opts?: { version?: ResqmlVersion; velocityKind?: string },
): OsduGenericProperty {
    const p = prop as Record<string, any>;
    const local = resqmlLocalName(p.$type);
    const valueType = local === "DiscreteProperty" ? "discrete" : "continuous";
    const kind: string | undefined = p.PropertyKind?.Kind;
    const isVelocity = opts?.velocityKind ?? (typeof kind === "string" && /velocity|^Vp$|^Vs$|Vp\/Vs/.test(kind) ? kind : undefined);
    return {
        kind: "osdu:wks:work-product-component--GenericProperty:1.0.0",
        data: {
            Name: p.Citation?.Title ?? "",
            ...(kind !== undefined ? { PropertyType: kind } : {}),
            ...(p.UOM !== undefined ? { UnitOfMeasure: p.UOM } : {}),
            ValueType: valueType,
            ...(Array.isArray(p.MinimumValue) && p.MinimumValue.length ? { MinValue: p.MinimumValue[0] } : {}),
            ...(Array.isArray(p.MaximumValue) && p.MaximumValue.length ? { MaxValue: p.MaximumValue[0] } : {}),
            ExtensionProperties: {
                ...(isVelocity !== undefined ? { VelocityKind: isVelocity } : {}),
                "x-resqml-type": local,
                ResqmlObjectUUID: p.Uuid ?? "",
                ResqmlSchemaVersion: p.SchemaVersion ?? schemaVersion(opts?.version),
            },
        },
    };
}
