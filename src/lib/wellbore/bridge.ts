/**
 * WITSML → RESQML wellbore bridge — the FIRP top two levels.
 *
 * Builds the thin RESQML geomodelling nodes that *reference* an authoritative
 * WITSML 2.1 `Wellbore` (see `rddmsmg/rddms/WellboreDdmsReplacement.md` §3):
 *
 *   WellboreFeature ──InterpretedFeature──► WellboreInterpretation
 *        │ WitsmlWellbore (DataObjectReference)
 *        └──────────────────────────────────► witsml21.Wellbore  (source of truth)
 *
 * No well/log data is copied: the WITSML object stays the single source of
 * truth and the RESQML side is a reference node onto which trajectory
 * geometry, marker frames and sampled log properties later hang. Pure and
 * I/O-free, mirroring `src/lib/builders/`.
 */

import type { DataObject } from "../builders/types";
import { citation, newUuid, rtype, schemaVersion, versionInfo, type ResqmlVersion } from "../builders/core";

/** Vertical domain of the wellbore interpretation. */
export type WellboreDomain = "depth" | "time" | "mixed";

/** Reference to the authoritative WITSML 2.1 wellbore this feature stands for. */
export interface WitsmlWellboreRef {
    uuid: string;
    title?: string;
    /** ETP qualified type of the WITSML object (default `witsml21.Wellbore`). */
    qualifiedType?: string;
}

export interface BridgeWellboreSpec {
    /** RESQML schema line for the emitted objects (default from core). */
    version?: ResqmlVersion;
    /**
     * The WITSML wellbore to reference. Omit for a *design-first* native RESQML
     * wellbore (a planned well authored in the geomodel before it is drilled):
     * the emitted `WellboreFeature` then carries no `WitsmlWellbore` DOR and can
     * be bound to a WITSML wellbore later, once it is sampled while drilling.
     */
    witsmlWellbore?: WitsmlWellboreRef;
    /** Feature title (defaults to the WITSML wellbore title). */
    title?: string;
    /** Explicit WellboreFeature UUID (generated when omitted). */
    featureUuid?: string;
    /** Explicit WellboreInterpretation UUID (generated when omitted). */
    interpretationUuid?: string;
    /** Interpretation vertical domain (default `depth`). */
    domain?: WellboreDomain;
    originator?: string;
}

export interface BridgeWellboreResult {
    feature: DataObject;
    interpretation: DataObject;
}

/**
 * Build a version-correct EML `DataObjectReference` to a WITSML object.
 *
 * The generic `ref()` in `builders/core` assumes the RESQML/EML namespaces, so
 * a WITSML target needs the envelope built explicitly here: EML 2.3 lines
 * (2.2 / 2.3) carry `QualifiedType` + `Uuid`; EML 2.0 lines carry `ContentType`
 * + `UUID`.
 */
function witsmlDor(target: WitsmlWellboreRef, v?: ResqmlVersion): DataObject {
    const qtype = target.qualifiedType ?? "witsml21.Wellbore";
    const bare = qtype.includes(".") ? qtype.split(".")[1] : qtype;
    const title = target.title && target.title.length > 0 ? target.title : bare;
    const info = versionInfo(v);
    if (info.arrays === "external") {
        return {
            $type: `${info.eml}.DataObjectReference`,
            QualifiedType: qtype,
            Title: title,
            Uuid: target.uuid,
        } as unknown as DataObject;
    }
    return {
        $type: `${info.eml}.DataObjectReference`,
        ContentType: `application/x-witsml+xml;version=2.1;type=${bare}`,
        Title: title,
        UUID: target.uuid,
    } as unknown as DataObject;
}

/** RESQML DOR to another RESQML object (feature ← interpretation link). */
function resqmlDor(bareType: string, uuid: string, title: string, v?: ResqmlVersion): DataObject {
    const info = versionInfo(v);
    if (info.arrays === "external") {
        return {
            $type: `${info.eml}.DataObjectReference`,
            QualifiedType: `${info.resqml}.${bareType.replace(/^obj_/, "")}`,
            Title: title,
            Uuid: uuid,
        } as unknown as DataObject;
    }
    return {
        $type: `${info.eml}.DataObjectReference`,
        ContentType: `application/x-resqml+xml;version=${info.ct};type=${bareType}`,
        Title: title,
        UUID: uuid,
    } as unknown as DataObject;
}

/**
 * Create the `WellboreFeature` + `WellboreInterpretation` that bridge a WITSML
 * wellbore into the RESQML geomodelling graph.
 */
export function bridgeWellbore(spec: BridgeWellboreSpec): BridgeWellboreResult {
    const v = spec.version;
    const title = spec.title ?? spec.witsmlWellbore?.title ?? "Wellbore";
    const featureUuid = spec.featureUuid ?? newUuid();
    const interpUuid = spec.interpretationUuid ?? newUuid();
    const domain = spec.domain ?? "depth";

    const feature = {
        $type: rtype("obj_WellboreFeature", v),
        Uuid: featureUuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(title, { originator: spec.originator }),
        // Design-first native wellbore: no WITSML source yet. The DOR is added
        // only when an authoritative WITSML wellbore is supplied.
        ...(spec.witsmlWellbore ? { WitsmlWellbore: witsmlDor(spec.witsmlWellbore, v) } : {}),
    } as unknown as DataObject;

    const interpretation = {
        $type: rtype("obj_WellboreInterpretation", v),
        Uuid: interpUuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(title, { originator: spec.originator }),
        Domain: domain,
        InterpretedFeature: resqmlDor("obj_WellboreFeature", featureUuid, title, v),
    } as unknown as DataObject;

    return { feature, interpretation };
}
