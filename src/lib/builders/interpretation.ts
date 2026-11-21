/**
 * Feature + interpretation builders.
 *
 * RESQML identity is created *once* and shared across every representation of
 * the same artefact (datadef interpretation §2). These builders emit the
 * Feature (the "what exists") and Interpretation (the "how it is understood")
 * stubs; geometry/property builders then reference the interpretation.
 *
 * Covers the interpretation domain generically — structural, seismic, fluid
 * and geobody boundaries all share the BoundaryFeature → *Interpretation
 * chain:
 *
 *   Horizon        → GeneticBoundaryFeature   → HorizonInterpretation
 *   Fault          → TectonicBoundaryFeature  → FaultInterpretation
 *   Geobody bnd    → BoundaryFeature          → GeobodyBoundaryInterpretation
 *   Fluid contact  → GeneticBoundaryFeature   → BoundaryFeatureInterpretation
 *   Generic        → (any feature)            → GenericFeatureInterpretation
 *
 * ## OSDU round-trip
 *
 * `toOsduFaultInterpretation` projects a FaultInterpretation deterministically
 * and reversibly (the OSDU record carries `x-resqml-type` + `ResqmlSchemaVersion`
 * so the RESQML ← OSDU reconstruction is exact). No released RESQML 2.x line
 * carries a fault seal state, so OSDU `IsSealed` is left unset.
 */

import type { DataObject } from "./types";
import { Domain, ResqmlVersion, citation, newUuid, ref, resolveIdentity, rtype, schemaVersion } from "./core";

export type BoundaryKind = "horizon" | "fault" | "geobody" | "fluid" | "generic";

/** Bare RESQML type names per boundary kind (namespace applied per version). */
const FEATURE_TYPE: Record<BoundaryKind, string> = {
    horizon: "obj_GeneticBoundaryFeature",
    fault: "obj_TectonicBoundaryFeature",
    geobody: "obj_BoundaryFeature",
    fluid: "obj_GeneticBoundaryFeature",
    generic: "obj_BoundaryFeature",
};

const INTERP_TYPE: Record<BoundaryKind, string> = {
    horizon: "obj_HorizonInterpretation",
    fault: "obj_FaultInterpretation",
    geobody: "obj_GeobodyBoundaryInterpretation",
    fluid: "obj_BoundaryFeatureInterpretation",
    generic: "obj_GenericFeatureInterpretation",
};

export interface FeatureSpec {
    uuid?: string;
    title: string;
    kind: BoundaryKind;
    version?: ResqmlVersion;
    originator?: string;
    creation?: string;
}

/** Build the geologic Feature object (identity of the natural-world thing). */
export function buildFeature(spec: FeatureSpec): { uuid: string; object: DataObject } {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const object = {
        $type: rtype(FEATURE_TYPE[spec.kind], v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator, creation: spec.creation }),
        ...(spec.kind === "horizon" || spec.kind === "fluid"
            ? { GeneticBoundaryKind: spec.kind === "fluid" ? "fluid contact" : "horizon" }
            : {}),
        ...(spec.kind === "fault" ? { TectonicBoundaryKind: "fault" } : {}),
    } as unknown as DataObject;
    return { uuid, object };
}

export interface InterpretationSpec {
    uuid?: string;
    title: string;
    kind: BoundaryKind;
    domain: Domain;
    /** The Feature this interpretation interprets. */
    featureUuid: string;
    featureTitle?: string;
    version?: ResqmlVersion;
    originator?: string;
    creation?: string;
}

/** Build the Interpretation object referencing its Feature. */
export function buildInterpretation(spec: InterpretationSpec): { uuid: string; object: DataObject } {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const object = {
        $type: rtype(INTERP_TYPE[spec.kind], v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator, creation: spec.creation }),
        Domain: spec.domain,
        InterpretedFeature: ref(FEATURE_TYPE[spec.kind], spec.featureUuid, spec.featureTitle ?? spec.title, v),
    } as unknown as DataObject;
    return { uuid, object };
}

/**
 * Convenience: build a Feature + Interpretation pair in one call, wiring the
 * DOR between them. Returns both objects and their uuids.
 */
export function buildInterpretedFeature(spec: {
    title: string;
    kind: BoundaryKind;
    domain: Domain;
    version?: ResqmlVersion;
    featureUuid?: string;
    /** Feature citation title (defaults to `title`). */
    featureTitle?: string;
    interpretationUuid?: string;
    originator?: string;
}): {
    featureUuid: string;
    interpretationUuid: string;
    objects: DataObject[];
} {
    const feature = buildFeature({
        uuid: spec.featureUuid,
        title: spec.featureTitle ?? spec.title,
        kind: spec.kind,
        version: spec.version,
        originator: spec.originator,
    });
    const interp = buildInterpretation({
        uuid: spec.interpretationUuid,
        title: spec.title,
        kind: spec.kind,
        domain: spec.domain,
        version: spec.version,
        featureUuid: feature.uuid,
        featureTitle: spec.featureTitle ?? spec.title,
        originator: spec.originator,
    });
    return {
        featureUuid: feature.uuid,
        interpretationUuid: interp.uuid,
        objects: [feature.object, interp.object],
    };
}

/**
 * Caller-supplied FIRP linkage on a representation spec: reuse an existing
 * interpretation (and optionally its feature), or leave both undefined to have
 * the Feature + Interpretation created for you.
 */
export interface InterpretedFeatureRef {
    /** Existing interpretation to attach to; when omitted one is created. */
    interpretationUuid?: string;
    /** Existing feature (only meaningful when `interpretationUuid` is set). */
    featureUuid?: string;
    /**
     * External OSDU SRN / record id for the interpretation. When no
     * `interpretationUuid` is given, the RESQML UUID is derived deterministically
     * from this SRN and the Feature + Interpretation are created (idempotent
     * upsert) — this is what links the RESQML object to its OSDU masterdata.
     */
    interpretationSrn?: string;
    /** External OSDU SRN / record id for the feature (deterministic UUID source). */
    featureSrn?: string;
    /** Title for the auto-created interpretation (defaults to the representation title). */
    interpretationTitle?: string;
    /** Title for the auto-created feature (defaults to `interpretationTitle`/title). */
    featureTitle?: string;
}

/** Resolved FIRP anchor: parts to write first (if any) plus the interpretation to reference. */
export interface ResolvedInterpretedFeature {
    /** Feature + interpretation objects to write first; empty when reusing an existing interpretation. */
    objects: DataObject[];
    /** Interpretation the representation should reference. */
    interpretationUuid: string;
    /** Feature uuid — present only when the feature was auto-created. */
    featureUuid?: string;
    /** RESQML interpretation object type for the DOR (`obj_HorizonInterpretation`, `obj_FaultInterpretation`, …). */
    interpretationType: string;
}

/**
 * Generic FIRP resolver shared by every representation builder (horizon grid,
 * horizon/fault control points, fault sticks, …). Either returns the
 * caller-supplied interpretation verbatim, or auto-creates the
 * Feature + Interpretation pair for the given boundary `kind` + `domain` and
 * returns them as `objects` to write ahead of the representation. This keeps
 * the "represent an existing interpretation, else make one" branch in a single
 * place instead of duplicated per builder.
 */
export function resolveInterpretedFeature(
    linkage: InterpretedFeatureRef,
    opts: {
        kind: BoundaryKind;
        domain: Domain;
        title: string;
        version?: ResqmlVersion;
        originator?: string;
    },
): ResolvedInterpretedFeature {
    const interpretationType = INTERP_TYPE[opts.kind];
    if (linkage.interpretationUuid !== undefined) {
        return {
            objects: [],
            interpretationUuid: linkage.interpretationUuid,
            featureUuid: linkage.featureUuid,
            interpretationType,
        };
    }
    // No explicit UUID: mint identities (deterministic from an SRN when given,
    // else random) and create the Feature + Interpretation pair.
    const interpId = resolveIdentity({ srn: linkage.interpretationSrn });
    const featId = resolveIdentity({ uuid: linkage.featureUuid, srn: linkage.featureSrn });
    const interpreted = buildInterpretedFeature({
        interpretationUuid: interpId.uuid,
        featureUuid: featId.uuid,
        title: linkage.interpretationTitle ?? opts.title,
        featureTitle: linkage.featureTitle ?? linkage.interpretationTitle,
        kind: opts.kind,
        domain: opts.domain,
        version: opts.version,
        originator: opts.originator,
    });
    return {
        objects: interpreted.objects,
        interpretationUuid: interpreted.interpretationUuid,
        featureUuid: interpreted.featureUuid,
        interpretationType,
    };
}

/** OSDU FaultInterpretation:1.1.0 projection (reversible). */
export interface OsduFaultInterpretation {
    kind: "osdu:wks:work-product-component--FaultInterpretation:1.1.0";
    data: {
        Name: string;
        Domain?: Domain;
        InterpretedFeatureID?: string;
        /**
         * Reversibility metadata: the RESQML type + UUID + schema version make
         * the reverse RESQML ← OSDU reconstruction exact.
         */
        ExtensionProperties: {
            "x-resqml-type": string;
            ResqmlObjectUUID: string;
            ResqmlSchemaVersion: string;
        };
    };
}

/**
 * Project a RESQML FaultInterpretation object onto the OSDU
 * FaultInterpretation:1.1.0 record. The RESQML type + schema version are
 * stamped for exact reverse reconstruction.
 */
export function toOsduFaultInterpretation(
    fault: DataObject,
    opts?: { version?: ResqmlVersion; interpretedFeatureId?: string },
): OsduFaultInterpretation {
    const f = fault as Record<string, any>;
    return {
        kind: "osdu:wks:work-product-component--FaultInterpretation:1.1.0",
        data: {
            Name: f.Citation?.Title ?? "",
            Domain: f.Domain,
            ...(opts?.interpretedFeatureId ? { InterpretedFeatureID: opts.interpretedFeatureId } : {}),
            ExtensionProperties: {
                "x-resqml-type": "FaultInterpretation",
                ResqmlObjectUUID: f.Uuid ?? "",
                ResqmlSchemaVersion: f.SchemaVersion ?? schemaVersion(opts?.version),
            },
        },
    };
}
