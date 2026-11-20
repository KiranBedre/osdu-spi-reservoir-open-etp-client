/**
 * SDMS↔RDDMS cross-store bridge resolver (ToDoEtpClient §10.3 #5 / §10.6 #5).
 *
 * Interpretation results (surfaces, picks, fault sticks, properties, velocity)
 * live in **RDDMS**; the trace cubes/gathers they were picked on live in the
 * **Seismic DDMS (SDMS)**; the discovery/metadata **catalog WPC** lives in
 * Elastic and carries the cross-store edges
 * (`SeismicTraceDataID(s)` / `SeismicBinGridID`). Acquisition + survey geometry
 * live in the catalog WPC + SDMS, *not* in RDDMS arrays
 * (datadef/interpretation/README §1) — this module respects that split.
 *
 * ```
 * Elastic (Catalog WPC)  ──DDMSDatasets──►  RDDMS (surfaces/picks/faults/props)
 *         │                                        │
 *         └──SeismicTraceDataIDs / BinGrid─────────┴──►  SDMS (trace cubes)
 * ```
 *
 * The resolver is pure and I/O-free: it normalises the cross-store references
 * carried on a WPC into canonical SDMS **cube handles** (forward), stamps them
 * back onto a WPC (`withCubeRefs`), and builds the reverse
 * "all interpretations referencing cube X" index over a supplied set of WPCs
 * (`indexInterpretationsByCube`) — a single traversal without moving bulk data.
 * The `RddmsClient.seismic.bridge.*` lane layers the actual store reads on top.
 */

/** Which side of the cross-store edge a reference points at. */
export type SeismicCubeRefKind = "trace-data" | "bin-grid" | "survey";

/** Canonical, store-agnostic handle for an SDMS cube / bin-grid / survey. */
export interface SeismicCubeRef {
    /** Original reference string exactly as carried on the WPC. */
    id: string;
    /** What the reference points at (trace cube, bin grid, or acquisition survey). */
    kind: SeismicCubeRefKind;
    /** OSDU entity type parsed from the SRN (e.g. `SeismicTraceData`), if any. */
    entity?: string;
    /** Bare object identifier (guid/id segment) parsed from the SRN, if any. */
    guid?: string;
    /** SDMS/OpenVDS locator when the reference is a store URI (`sd://…`, `openvds://…`). */
    sdmsUri?: string;
}

/** OSDU entity short-name → canonical cube-ref kind (drives auto-classification). */
const ENTITY_KIND: Record<string, SeismicCubeRefKind> = {
    seismictracedata: "trace-data",
    seismicbingrid: "bin-grid",
    seismicbingridrepresentation: "bin-grid",
    seismicacquisitionsurvey: "survey",
    seismic3dinterpretationset: "trace-data",
};

const SDMS_URI = /^(sd|openvds|sdms):\/\//i;

/**
 * Normalise a single cross-store reference (an OSDU SRN, an SDMS/OpenVDS URI,
 * or a bare id) into a canonical {@link SeismicCubeRef}.
 *
 * OSDU SRN shape: `authority:work-product-component--SeismicTraceData:guid:version`
 * — the `--Entity` segment gives the entity type, the next segment the guid.
 * When the kind cannot be inferred from the entity, `fallbackKind` is used.
 */
export function parseSdmsRef(id: string, fallbackKind: SeismicCubeRefKind = "trace-data"): SeismicCubeRef {
    const raw = id.trim();
    if (SDMS_URI.test(raw)) {
        return { id: raw, kind: fallbackKind, sdmsUri: raw };
    }

    // OSDU id: <authority>:<group>--<Entity>:<guid>[:<version>]
    const entityMatch = raw.match(/--([A-Za-z0-9]+)\s*:/);
    const entity = entityMatch?.[1];
    const kind = entity ? (ENTITY_KIND[entity.toLowerCase()] ?? fallbackKind) : fallbackKind;

    // The guid is the segment immediately after the `--Entity:` token.
    let guid: string | undefined;
    if (entityMatch) {
        const afterEntity = raw.slice(raw.indexOf(entityMatch[0]) + entityMatch[0].length);
        const seg = afterEntity.split(":")[0]?.trim();
        if (seg) guid = seg;
    }

    return { id: raw, kind, ...(entity ? { entity } : {}), ...(guid ? { guid } : {}) };
}

/** Reads a WPC record whether it is passed as `{ kind, data }` or the bare `data`. */
function wpcData(wpc: unknown): Record<string, unknown> {
    const w = (wpc ?? {}) as Record<string, unknown>;
    return (w.data ?? w) as Record<string, unknown>;
}

/** Coerce a scalar-or-array reference field into a de-duplicated string list. */
function refList(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    const arr = Array.isArray(value) ? value : [value];
    const out: string[] = [];
    for (const v of arr) {
        if (typeof v === "string" && v.trim()) out.push(v.trim());
        else if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string")
            out.push((v as { id: string }).id.trim());
    }
    return [...new Set(out)];
}

/**
 * **Forward resolve.** Extract every SDMS cube handle a catalog WPC references:
 * `SeismicTraceDataID(s)` → trace cubes, `SeismicBinGridID` → bin grid,
 * `SeismicAcquisitionSurveyID`/`SurveyID` → acquisition survey. Accepts either
 * the full `{ kind, data }` record or the bare `data` payload.
 */
export function resolveCubeRefs(wpc: unknown): SeismicCubeRef[] {
    const d = wpcData(wpc);
    const refs: SeismicCubeRef[] = [];

    const trace = refList(d.SeismicTraceDataIDs ?? d.SeismicTraceDataID);
    for (const id of trace) refs.push(parseSdmsRef(id, "trace-data"));

    const binGrid = refList(d.SeismicBinGridID ?? d.SeismicBinGridIDs ?? d.BinGridID);
    for (const id of binGrid) refs.push(parseSdmsRef(id, "bin-grid"));

    const survey = refList(d.SeismicAcquisitionSurveyID ?? d.SurveyID ?? d.SeismicAcquisitionSurveyIDs);
    for (const id of survey) refs.push(parseSdmsRef(id, "survey"));

    // De-duplicate on (kind,id).
    const seen = new Set<string>();
    return refs.filter((r) => {
        const key = `${r.kind}\u0000${r.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * **Attach.** Stamp canonical cube handles back onto a WPC's cross-store fields
 * (`SeismicTraceDataID(s)` / `SeismicBinGridID` / `SeismicAcquisitionSurveyID`),
 * merging with anything already present. Pure — returns a new record and never
 * mutates the input. This is how a `SeismicFault`/`SeismicHorizon` manifest
 * "carries survey / bin-grid context" (datadef §2 / SHACL §10.4).
 */
export function withCubeRefs<T extends Record<string, any>>(wpc: T, refs: SeismicCubeRef[]): T {
    if (!refs.length) return wpc;
    const isRecord = "data" in wpc && wpc.data && typeof wpc.data === "object";
    const target = (isRecord ? { ...(wpc as any).data } : { ...wpc }) as Record<string, any>;

    const merge = (field: string, add: string[]) => {
        if (!add.length) return;
        const existing = refList(target[field]);
        const merged = [...new Set([...existing, ...add])];
        target[field] = merged.length === 1 ? merged[0] : merged;
    };

    merge("SeismicTraceDataID", refs.filter((r) => r.kind === "trace-data").map((r) => r.id));
    merge("SeismicBinGridID", refs.filter((r) => r.kind === "bin-grid").map((r) => r.id));
    merge("SeismicAcquisitionSurveyID", refs.filter((r) => r.kind === "survey").map((r) => r.id));

    return (isRecord ? { ...(wpc as any), data: target } : target) as T;
}

/** An interpretation and the catalog WPC that carries its cross-store edges. */
export interface InterpretationWpc {
    /** Stable interpretation identity (RESQML UUID or OSDU record id). */
    id: string;
    /** The catalog WPC (`{ kind, data }` or bare data) referencing the cubes. */
    wpc: unknown;
}

/** Reverse index: canonical cube handle + the interpretations that reference it. */
export interface CubeReverseEntry {
    ref: SeismicCubeRef;
    interpretations: string[];
}

/**
 * **Reverse traversal.** Build the "all interpretations referencing cube X"
 * index from a supplied set of interpretation WPCs — one pass, keyed on the
 * canonical cube handle (`kind\u0000id`). Bulk data never moves; the caller
 * supplies the WPCs (e.g. from an Elastic/`graphSearch` fan-out).
 */
export function indexInterpretationsByCube(items: InterpretationWpc[]): CubeReverseEntry[] {
    const byKey = new Map<string, CubeReverseEntry>();
    for (const item of items) {
        for (const ref of resolveCubeRefs(item.wpc)) {
            const key = `${ref.kind}\u0000${ref.id}`;
            let entry = byKey.get(key);
            if (!entry) {
                entry = { ref, interpretations: [] };
                byKey.set(key, entry);
            }
            if (!entry.interpretations.includes(item.id)) entry.interpretations.push(item.id);
        }
    }
    return [...byKey.values()].map((e) => ({ ref: e.ref, interpretations: [...e.interpretations].sort() }));
}

/**
 * Convenience over {@link indexInterpretationsByCube}: return the interpretation
 * ids that reference a specific cube. `cubeId` is matched against the parsed
 * guid, the raw id, or the SDMS URI so callers can pass any of them.
 */
export function interpretationsForCube(items: InterpretationWpc[], cubeId: string): string[] {
    const needle = cubeId.trim();
    const hits = new Set<string>();
    for (const item of items) {
        for (const ref of resolveCubeRefs(item.wpc)) {
            if (ref.id === needle || ref.guid === needle || ref.sdmsUri === needle) {
                hits.add(item.id);
                break;
            }
        }
    }
    return [...hits].sort();
}
