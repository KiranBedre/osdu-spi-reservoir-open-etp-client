/**
 * OSDU Wellbore DDMS (WDMS) record mapping, pure and I/O-free.
 *
 * Maps a `work-product-component--WellLog` record plus its bulk
 * (`GET /welllogs/{id}/data?orient=split`) onto the {@link ChannelSetSpec}
 * consumed by `buildChannelSet`, and derives the WITSML `Well` / `Wellbore`
 * anchor objects from the `master-data--Well` / `master-data--Wellbore`
 * records. Every emitted object carries the OSDU record id as an
 * `Aliases/authority="osdu"` entry, so the catalog identity stays the
 * master-data record (read back by `OSDUContext.osduAlias`).
 *
 * The REST route (`POST /dataspaces/{id}/wells/logs/import`) does the fetching
 * and storing; everything testable without a network lives here.
 */

import type { ChannelSetSpec, ChannelSpec, AliasSpec } from "../builders/channelSet";
import { uuidV5 } from "../builders/core";

/** Minimal OSDU storage record shape (only the members this module reads). */
export interface OsduRecord<TData = Record<string, unknown>> {
    id: string;
    kind?: string;
    version?: number;
    acl?: { viewers?: string[]; owners?: string[] };
    legal?: { legaltags?: string[] };
    data: TData;
}

export interface WdmsCurve {
    CurveID: string;
    Mnemonic?: string;
    CurveUnit?: string;
    NumberOfColumns?: number;
    CurveDescription?: string;
}

export interface WdmsWellLogData {
    Name?: string;
    WellboreID?: string;
    ReferenceCurveID?: string;
    SamplingDomainTypeID?: string;
    Curves?: WdmsCurve[];
    [k: string]: unknown;
}

export interface WdmsWellboreData {
    WellID?: string;
    FacilityName?: string;
    [k: string]: unknown;
}

export interface WdmsWellData {
    FacilityName?: string;
    [k: string]: unknown;
}

/** `orient=split` bulk payload. Multi-column curves appear as `CurveID[0]`, `CurveID[1]`, ... */
export interface WdmsSplitData {
    columns: string[];
    index?: unknown[];
    data: (number | string | null)[][];
}

/** `osdu:reference-data--UnitOfMeasure:gAPI:` -> `gAPI`; missing -> `Euc` (dimensionless). */
export function unitSymbol(ref: string | undefined): string {
    if (!ref) {return "Euc";}
    const parts = ref.split(":").filter(p => p.length > 0);
    return parts.length > 0 ? parts[parts.length - 1] : ref;
}

/** OSDU `SamplingDomainType` reference -> WITSML 2.1 `ChannelIndexType`. */
export function indexKind(samplingDomainTypeId: string | undefined, indexUom: string): string {
    const name = unitSymbol(samplingDomainTypeId).toLowerCase();
    if (/truevertical|tvd/.test(name)) {return "vertical depth";}
    if (/elapsed/.test(name)) {return "elapsed time";}
    if (/datetime|date|time/.test(name)) {return "date time";}
    if (/measureddepth|depth|md/.test(name)) {return "measured depth";}
    return /^(s|sec|ms|min|h|hr|d)$/i.test(indexUom) ? "date time" : "measured depth";
}

/** Strip the `[n]` suffix WDMS puts on multi-column curve columns. */
function baseColumn(column: string): string {
    return column.replace(/\[\d+\]$/, "");
}

function toNumber(v: number | string | null | undefined): number {
    if (v === null || v === undefined || v === "") {return NaN;}
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : NaN;
}

/**
 * Group the split-orient columns per curve and flatten them row-major into
 * one `number[]` per curve (nulls -> NaN). Returns curves in column order.
 */
export function splitDataToColumns(data: WdmsSplitData): Map<string, { values: number[]; dimensions: number[] }> {
    const groups = new Map<string, number[]>();
    data.columns.forEach((c, i) => {
        const base = baseColumn(c);
        const list = groups.get(base) ?? [];
        list.push(i);
        groups.set(base, list);
    });
    const out = new Map<string, { values: number[]; dimensions: number[] }>();
    const rows = data.data.length;
    for (const [base, cols] of groups) {
        const values = new Array<number>(rows * cols.length);
        for (let r = 0; r < rows; r++) {
            const row = data.data[r] ?? [];
            for (let k = 0; k < cols.length; k++) {
                values[r * cols.length + k] = toNumber(row[cols[k]]);
            }
        }
        out.set(base, { values, dimensions: cols.length > 1 ? [rows, cols.length] : [rows] });
    }
    return out;
}

export interface WellLogMappingOptions {
    uuid?: string;
    originator?: string;
    wellbore?: { uuid: string; title?: string };
}

/**
 * Map a WDMS WellLog record + bulk to a `ChannelSetSpec`. The reference curve
 * becomes the `Index` and is also emitted as the first `Channel` so its values
 * are stored; every other curve present in the bulk becomes a `Channel`.
 */
export function wdmsWellLogToChannelSetSpec(
    record: OsduRecord<WdmsWellLogData>,
    bulk: WdmsSplitData,
    opts: WellLogMappingOptions = {}
): ChannelSetSpec {
    const curves = record.data.Curves ?? [];
    if (curves.length === 0) {throw new Error(`WellLog ${record.id} has no Curves`);}
    if (!Array.isArray(bulk.columns) || bulk.columns.length === 0 || !Array.isArray(bulk.data)) {
        throw new Error(`WellLog ${record.id} has no bulk data`);
    }
    const columns = splitDataToColumns(bulk);
    const byId = new Map(curves.map(c => [c.CurveID, c] as const));

    const refId = record.data.ReferenceCurveID ?? baseColumn(bulk.columns[0]);
    const refCurve = byId.get(refId) ?? curves[0];
    const indexUom = unitSymbol(refCurve.CurveUnit);
    const indexValues = columns.get(refCurve.CurveID)?.values;
    if (!indexValues) {throw new Error(`WellLog ${record.id}: reference curve ${refCurve.CurveID} missing in bulk`);}
    const first = indexValues.find(v => !Number.isNaN(v));
    const last = [...indexValues].reverse().find(v => !Number.isNaN(v));
    const direction = first !== undefined && last !== undefined && last < first ? "decreasing" : "increasing";

    const channels: ChannelSpec[] = [];
    const ordered = [refCurve, ...curves.filter(c => c !== refCurve)];
    for (const c of ordered) {
        const col = columns.get(c.CurveID);
        if (!col) {continue;} // curve declared but absent from the bulk
        channels.push({
            mnemonic: c.Mnemonic ?? c.CurveID,
            uom: unitSymbol(c.CurveUnit),
            values: col.values,
            dimensions: col.dimensions
        });
    }
    if (channels.length === 0) {throw new Error(`WellLog ${record.id}: no curve present in bulk`);}

    const extraMetadata: Record<string, string | number> = { "osdu:sourceId": record.id };
    if (record.version !== undefined) {extraMetadata["osdu:sourceVersion"] = record.version;}
    if (record.kind) {extraMetadata["osdu:sourceKind"] = record.kind;}
    if (record.legal?.legaltags?.length) {extraMetadata["osdu:legalTags"] = record.legal.legaltags.join(",");}
    if (record.acl?.owners?.length) {extraMetadata["osdu:aclOwners"] = record.acl.owners.join(",");}
    if (record.acl?.viewers?.length) {extraMetadata["osdu:aclViewers"] = record.acl.viewers.join(",");}
    if (record.data.WellboreID) {extraMetadata["osdu:wellboreId"] = record.data.WellboreID;}

    return {
        uuid: opts.uuid ?? uuidV5(record.id),
        title: record.data.Name ?? record.id,
        originator: opts.originator,
        index: {
            mnemonic: refCurve.Mnemonic ?? refCurve.CurveID,
            uom: indexUom,
            kind: indexKind(record.data.SamplingDomainTypeID, indexUom),
            direction
        },
        channels,
        aliases: [osduAlias(record.id)],
        wellbore: opts.wellbore,
        extraMetadata
    };
}

export function osduAlias(id: string): AliasSpec {
    return { authority: "osdu", identifier: id };
}

function citation(title: string, originator: string, creation: string) {
    return {
        $type: "eml23.Citation",
        Title: title,
        Originator: originator,
        Creation: creation,
        Format: "etpclient"
    };
}

export interface AnchorOptions {
    originator?: string;
    creation?: string;
}

/**
 * `witsml21.Well` JSON (for `PUT /witsml/store` `json`) for a master-data Well.
 * The UUID is `uuidV5(osduId)` unless given, so re-imports are idempotent.
 */
export function wdmsWellToWitsml(
    osduId: string,
    well: WdmsWellData | undefined,
    uuid: string = uuidV5(osduId),
    opts: AnchorOptions = {}
): Record<string, unknown> {
    return {
        $type: "witsml21.Well",
        Uuid: uuid,
        SchemaVersion: "2.1",
        Aliases: [{ $type: "eml23.ObjectAlias", Authority: "osdu", Identifier: osduId }],
        Citation: citation(well?.FacilityName ?? osduId, opts.originator ?? "etpclient", opts.creation ?? now())
    };
}

/** `witsml21.Wellbore` JSON for a master-data Wellbore, referencing its Well. */
export function wdmsWellboreToWitsml(
    osduId: string,
    wellbore: WdmsWellboreData | undefined,
    well: { uuid: string; title: string },
    uuid: string = uuidV5(osduId),
    opts: AnchorOptions = {}
): Record<string, unknown> {
    return {
        $type: "witsml21.Wellbore",
        Uuid: uuid,
        SchemaVersion: "2.1",
        Aliases: [{ $type: "eml23.ObjectAlias", Authority: "osdu", Identifier: osduId }],
        Citation: citation(wellbore?.FacilityName ?? osduId, opts.originator ?? "etpclient", opts.creation ?? now()),
        Well: { $type: "eml23.DataObjectReference", Uuid: well.uuid, QualifiedType: "witsml21.Well", Title: well.title }
    };
}

function now(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
