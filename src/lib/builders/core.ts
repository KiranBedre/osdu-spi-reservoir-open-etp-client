/**
 * Shared primitives for the RESQML object-graph builders.
 *
 * These are pure, I/O-free helpers used by every domain builder (CRS,
 * geometry, property, interpretation). Keeping them here means every tool
 * that emits RESQML through the SDK produces byte-identical DORs, citations
 * and content-types — the single most common source of "same data, different
 * graph" drift when objects are hand-assembled.
 *
 * ## Version awareness (2.0.1 / 2.0.2 / 2.2.0)
 *
 * The etpclient + server support 2.0.1 and 2.2.0 today. This module makes the
 * builders **version-parameterised** so the same call can emit any of the three
 * released lines the reservoir programme targets:
 *
 *   - **2.0.1** — production baseline (resqml20/eml20, HDF5 arrays).
 *   - **2.0.2** — additive, *binary-compatible* patch (same namespaces/types
 *     as 2.0.1; only `schemaVersion` + optional new elements differ — SealState,
 *     depth stats, SpatialArea bbox, typed Activity). 2.0.1 tools read it fine.
 *   - **2.2.0** — EML 2.3 external-data arrays (resqml22/eml, ExternalDataArray).
 *
 * The version descriptor switches namespace prefix, content-type version,
 * schema-version stamp and the array-referencing model. Default is 2.0.1 so
 * existing behaviour is unchanged.
 *
 * Source of truth for the version model: `energistics/resqml/2.0.2` in
 * the rddmsmg package (Changelog, Migration Guide, kind-map).
 */

import { createHash } from "crypto";

import type { DataObject, DataArrayInput } from "./types";

/** RESQML interpretation/coordinate domain. Drives CRS type + WPC classification. */
export type Domain = "depth" | "time";

/** Supported RESQML schema lines. */
export type ResqmlVersion = "2.0.1" | "2.0.2" | "2.2.0";

/** Runtime list of the supported lines (for query validation / Swagger enums). */
export const RESQML_VERSIONS: readonly ResqmlVersion[] = ["2.0.1", "2.0.2", "2.2.0"];

/** Type guard for a user-supplied version string. */
export function isResqmlVersion(v: unknown): v is ResqmlVersion {
    return typeof v === "string" && (RESQML_VERSIONS as readonly string[]).includes(v);
}

/** Default emit version — the production baseline. */
export const DEFAULT_VERSION: ResqmlVersion = "2.0.1";

interface VersionDescriptor {
    /** RESQML namespace alias for `$type` (resqml20 | resqml22). */
    resqml: string;
    /** EML/common namespace alias for `$type` (eml20 | eml23). */
    eml: string;
    /** Content-type `version=` token. */
    ct: string;
    /** `SchemaVersion` stamped on objects. */
    schema: string;
    /** `SchemaVersion` stamped on EML/common-rooted objects (ColumnBasedTable...). */
    emlSchema: string;
    /** Array-referencing model. */
    arrays: "hdf5" | "external";
}

const VERSIONS: Record<ResqmlVersion, VersionDescriptor> = {
    "2.0.1": { resqml: "resqml20", eml: "eml20", ct: "2.0", schema: "2.0.0.20140822", emlSchema: "2.0", arrays: "hdf5" },
    "2.0.2": { resqml: "resqml20", eml: "eml20", ct: "2.0", schema: "2.0.2", emlSchema: "2.0", arrays: "hdf5" },
    "2.2.0": { resqml: "resqml22", eml: "eml23", ct: "2.2", schema: "2.2", emlSchema: "2.3", arrays: "external" },
};

/** Resolve a version descriptor (defaults to 2.0.1). */
export function versionInfo(v: ResqmlVersion = DEFAULT_VERSION): VersionDescriptor {
    const d = VERSIONS[v];
    if (!d) {
        throw new Error(
            `unsupported RESQML version "${String(v)}" (supported: ${RESQML_VERSIONS.join(", ")}; RESQML 2.2 is the line that uses EML 2.3)`
        );
    }
    return d;
}

/** The `SchemaVersion` stamp for a given line. */
export function schemaVersion(v: ResqmlVersion = DEFAULT_VERSION): string {
    return versionInfo(v).schema;
}

/**
 * The `SchemaVersion` stamp for EML/common-rooted objects of a given line.
 * The ETP store derives the qualified type from namespace + SchemaVersion, so an
 * eml23 object stamped "2.2" resolves to an unknown type (".ColumnBasedTable")
 * that can be stored but never deleted or re-identified.
 */
export function emlSchemaVersion(v: ResqmlVersion = DEFAULT_VERSION): string {
    return versionInfo(v).emlSchema;
}

/** A representation/property builder result: the object plus the bulk arrays it references. */
export interface BuiltObject {
    /** The RESQML data object (goes to `resources.put`). */
    object: DataObject;
    /** Bulk arrays referenced by the object (go to `arrays.put`). */
    arrays: DataArrayInput[];
}

/** Version-qualified RESQML `$type`, e.g. rtype("obj_Grid2dRepresentation","2.2.0"). */
export function rtype(bare: string, v: ResqmlVersion = DEFAULT_VERSION): string {
    return `${versionInfo(v).resqml}.${bareTypeName(bare, v)}`;
}

/**
 * Version-qualified EML/common `$type`, e.g. etype("obj_EpcExternalPartReference","2.2.0")
 * gives "eml23.EpcExternalPartReference": the 2.0 `obj_` prefix does not exist in
 * EML 2.3 / RESQML 2.2, so it is dropped for that line (a URI such as
 * `eml23.obj_EpcExternalPartReference(...)` is unknown to the store and the arrays
 * written under it can never be read back).
 */
export function etype(bare: string, v: ResqmlVersion = DEFAULT_VERSION): string {
    return `${versionInfo(v).eml}.${bareTypeName(bare, v)}`;
}

/** Strip the 2.0-only `obj_` prefix when targeting the 2.2 / EML 2.3 line. */
export function bareTypeName(bare: string, v: ResqmlVersion = DEFAULT_VERSION): string {
    return versionInfo(v).arrays === "external" && bare.startsWith("obj_") ? bare.slice(4) : bare;
}

/** Generate an RFC-4122 v4 UUID, preferring the platform crypto when present. */
export function newUuid(): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    if (g.crypto?.randomUUID) return g.crypto.randomUUID();
    // Fallback (non-crypto) — sufficient for object identity in tests.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const val = c === "x" ? r : (r & 0x3) | 0x8;
        return val.toString(16);
    });
}

/**
 * Fixed namespace for deriving deterministic RESQML UUIDs from external master
 * identifiers (OSDU SRNs, record ids). Generated once; it MUST stay constant so
 * that the same SRN always maps to the same RESQML `Uuid` across services, runs
 * and dataspaces — that stable convergence is what makes the RESQML object act
 * as masterdata for its OSDU record instead of a fresh, unlinked copy.
 */
export const SRN_UUID_NAMESPACE = "b4f0e6a2-9c3d-5e71-8a4b-2f6c1d0e7a53";

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

/**
 * RFC-4122 v5 (SHA-1, name-based) UUID. Deterministic: the same
 * `(namespace, name)` pair always yields the same UUID. Used to mint stable
 * RESQML UUIDs from OSDU SRNs so writes are idempotent (a re-PUT upserts the
 * same object) and independent services agree on one identity.
 */
export function uuidV5(name: string, namespace: string = SRN_UUID_NAMESPACE): string {
    const nsBytes = Buffer.from(namespace.replace(/[^0-9a-fA-F]/g, ""), "hex");
    const hash = createHash("sha1").update(nsBytes).update(Buffer.from(name, "utf8")).digest();
    const b = hash.subarray(0, 16);
    b[6] = (b[6] & 0x0f) | 0x50; // version 5
    b[8] = (b[8] & 0x3f) | 0x80; // RFC-4122 variant
    const h = b.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * A caller-supplied object identity: an explicit RESQML UUID, an external OSDU
 * SRN (or record id), or neither.
 */
export interface IdentityRef {
    /** Explicit RESQML UUID — taken verbatim when present. */
    uuid?: string;
    /**
     * External master identifier (OSDU SRN / record id). When no `uuid` is
     * given, the RESQML UUID is taken from a UUID already embedded in the SRN,
     * else derived deterministically via {@link uuidV5}.
     */
    srn?: string;
}

/**
 * Resolve an {@link IdentityRef} to a concrete RESQML UUID (plus the originating
 * SRN, when supplied). This is the single masterdata identity primitive shared
 * by every builder, so SRN-based identity behaves identically for horizons,
 * faults, grids and any future object type.
 *
 * Precedence:
 *   1. explicit `uuid`            → used verbatim (object already exists);
 *   2. UUID embedded in the `srn` → reuse it (the SRN already carries identity);
 *   3. deterministic `v5(srn)`    → derive a stable UUID from the SRN;
 *   4. neither                    → fresh random v4 (brand-new, unlinked object).
 *
 * Because step 3 is a pure function, the SRN→UUID mapping is always
 * recomputable — the linkage survives without having to persist the SRN.
 */
export function resolveIdentity(refId: IdentityRef): { uuid: string; srn?: string } {
    if (refId.uuid && refId.uuid.length > 0) return { uuid: refId.uuid, srn: refId.srn };
    if (refId.srn && refId.srn.length > 0) {
        const embedded = refId.srn.match(UUID_RE)?.[0];
        return { uuid: (embedded ?? uuidV5(refId.srn)).toLowerCase(), srn: refId.srn };
    }
    return { uuid: newUuid() };
}

/**
 * Build the content-type string for a DataObjectReference. Follows the proven
 * server-accepted convention (x-resqml namespace, version from the descriptor).
 */
export function contentType(type: string, v: ResqmlVersion = DEFAULT_VERSION): string {
    const bare = type.includes(".") ? type.split(".")[1] : type;
    return `application/x-resqml+xml;version=${versionInfo(v).ct};type=${bare}`;
}

/**
 * ETP qualified type for a data object, e.g. "resqml22.Model" — the form the
 * EML 2.3 common `DataObjectReference.QualifiedType` element carries (2.2 / 2.3).
 * Strips any leading `obj_` (a 2.0.x XML-tag artefact absent from the 2.2 tokens).
 */
export function qualifiedType(type: string, v: ResqmlVersion = DEFAULT_VERSION): string {
    const bare = (type.includes(".") ? type.split(".")[1] : type).replace(/^obj_/, "");
    // EML/common top-level types keep the eml namespace; everything else is RESQML.
    const isEml = /^(Epc|EpcExternalPartReference|Activity|ActivityTemplate|PropertyKind|GraphicalInformationSet|TimeSeries|PropertyKindDictionary)/.test(bare);
    return `${isEml ? versionInfo(v).eml : versionInfo(v).resqml}.${bare}`;
}

/** Standard EML DataObjectReference (version-aware content-type).
 *
 * `v` selects the DOR *envelope* shape (EML 2.0's `ContentType`+`UUID` vs EML
 * 2.3's `QualifiedType`+`Uuid`) — it must match the schema line of the object
 * the DOR is embedded in. `targetVersion` selects the version token stamped
 * into the content-type / qualified-type and defaults to `v`; pass it when a
 * reference crosses schema lines (e.g. a 2.0.1 grid pointing at a 2.2 fluid
 * organisation).
 */
export function ref(
    type: string,
    uuid: string,
    title?: string,
    v: ResqmlVersion = DEFAULT_VERSION,
    targetVersion: ResqmlVersion = v,
): DataObject {
    // The DOR Title maps to eml:DescriptionString (minLength=1), so an empty
    // string is a schema violation that strict RESQML consumers such as fesapi
    // reject ("content length violation in element 'eml20:Title'"). Fall back to
    // the bare object type when the caller has no better title to offer.
    const bare = type.includes(".") ? type.split(".")[1] : type;
    const safeTitle = title && title.length > 0 ? title : bare;
    // The EML 2.3 common DOR (2.2 / 2.3) is shaped differently from EML 2.0's:
    // it carries `QualifiedType` (ETP token) + `Uuid`, not `ContentType` + `UUID`.
    if (versionInfo(v).arrays === "external") {
        return {
            $type: etype("DataObjectReference", v),
            QualifiedType: qualifiedType(type, targetVersion),
            Title: safeTitle,
            Uuid: uuid,
        } as unknown as DataObject;
    }
    return {
        $type: etype("DataObjectReference", v),
        ContentType: contentType(type, targetVersion),
        Title: safeTitle,
        UUID: uuid,
    } as unknown as DataObject;
}

/** Standard citation block. `now` defaults to the current ISO timestamp. */
export function citation(
    title: string,
    opts?: { originator?: string; creation?: string; format?: string },
): DataObject["Citation"] {
    return {
        Title: title,
        Originator: opts?.originator ?? "rddms-sdk",
        Creation: opts?.creation ?? new Date().toISOString(),
        // Format is REQUIRED by the EML 2.0 Citation schema (minOccurs=1) and
        // must follow Creation; omitting it makes strict RESQML consumers such
        // as fesapi reject the whole object with an occurrence-constraint fault.
        Format: opts?.format ?? "rddms-sdk",
    };
}

/**
 * Build the in-object node that references a bulk array, in the correct model
 * for the schema line: `Hdf5Dataset`-wrapped for 2.0.x, `ExternalDataArray`
 * (EML 2.3, `PathInExternalFile` + `URI`) for 2.2/2.3.
 */
export function arrayNode(
    kind: "double" | "integer" | "point3d",
    opts: { hdfUuid: string; path: string; dims: number[]; nullValue?: number; version?: ResqmlVersion },
): DataObject {
    const v = opts.version ?? DEFAULT_VERSION;
    const info = versionInfo(v);

    if (info.arrays === "hdf5") {
        const dataset = {
            $type: etype("Hdf5Dataset", v),
            PathInHdfFile: opts.path,
            HdfProxy: ref("obj_EpcExternalPartReference", opts.hdfUuid, "Hdf Proxy", v),
        };
        if (kind === "point3d") {
            return { $type: rtype("Point3dHdf5Array", v), Coordinates: dataset } as unknown as DataObject;
        }
        if (kind === "integer") {
            return { $type: rtype("IntegerHdf5Array", v), NullValue: opts.nullValue ?? -1, Values: dataset } as unknown as DataObject;
        }
        return { $type: rtype("DoubleHdf5Array", v), Values: dataset } as unknown as DataObject;
    }

    // EML 2.3 external-data array (2.2 / 2.3).
    const external = {
        $type: etype("ExternalDataArray", v),
        ExternalDataArrayPart: [
            {
                $type: etype("ExternalDataArrayPart", v),
                Count: opts.dims,
                StartIndex: opts.dims.map(() => 0),
                PathInExternalFile: opts.path,
                URI: `eml:///${etype("obj_EpcExternalPartReference", v)}(${opts.hdfUuid})`,
            },
        ],
    };
    if (kind === "point3d") {
        return { $type: rtype("Point3dExternalArray", v), Coordinates: external } as unknown as DataObject;
    }
    if (kind === "integer") {
        return {
            $type: etype("IntegerExternalArray", v),
            ArrayIntegerType: "int32",
            CountPerValue: 1,
            NullValue: opts.nullValue ?? -1,
            Values: external,
        } as unknown as DataObject;
    }
    return {
        $type: etype("FloatingPointExternalArray", v),
        ArrayFloatingPointType: "double",
        CountPerValue: 1,
        Values: external,
    } as unknown as DataObject;
}
