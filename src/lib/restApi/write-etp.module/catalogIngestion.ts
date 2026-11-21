// ============================================================================
// Copyright 2019-2022 Emerson Paradigm Holding LLC. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ============================================================================

/**
 * Shared OSDU catalog-ingestion engine.
 *
 * This module owns the "build a manifest for a dataspace and push it to the OSDU
 * catalog" pipeline. It was extracted verbatim from the EPC upload controller so
 * that multiple routes (EPC auto-ingest, dataspace ACL re-ingest, ...) can reuse
 * the exact same, schema-guarded ingestion logic without duplicating it and
 * without adding extra API routes.
 *
 * It is intentionally framework-agnostic: callers pass the resolved
 * bearer/partition/collaboration values rather than an Express request.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { decode, JwtPayload } from "jsonwebtoken";

import { createSession } from "../ControllerUtils";
import {
    createManifest,
    DEFAULT_DATASPACE_TYPE_PATTERNS,
    DEFAULT_INGEST_EXCLUDE_PATTERNS,
    PropertyFilter
} from "../../jsonTypes/Manifest";
import { OSDUContext } from "../../jsonTypes/OsduContext";
import { osduUrl } from "../../common/config";
import { bigIntToString } from "../../mlTypes/XmlJsonUtil";
import {
    ensureSchemaVersions,
    isSchemaRegistered,
    setSchemaRegistered,
    parseKindIdentity,
    listRegisteredVersions
} from "../../jsonTypes/MilestoneKinds";

import logging from "../../common/Logging";
const logger = logging.getLogger("EtpClient");

/** Batch size for pushing records to OSDU Storage Service */
const STORAGE_BATCH_SIZE = 500;

/** Valid values for the autoIngest / reingest query parameter */
export type IngestMode = "records" | "workflow";

/** Optional directory holding OSDU schema JSON files for auto-registration. */
const SCHEMA_DIR = process.env.RDMS_SCHEMA_DIR;

/**
 * When a kind is not registered at any version, remap it to a registered generic
 * work-product-component sibling (GenericRepresentation / GenericInterpretation /
 * GenericFeature / GenericProperty) instead of dropping the record. Lossy but
 * keeps the object; the original type is preserved in `data.Type`.
 * Opt out with RDMS_INGEST_GENERIC_FALLBACK=false. Default on.
 */
const GENERIC_FALLBACK = (process.env.RDMS_INGEST_GENERIC_FALLBACK ?? "true") !== "false";

/**
 * Map a work-product-component entityType to an ordered list of candidate
 * generic sibling entityTypes, classified by role and (for representations)
 * geometry. Mirrors the converter's routing preference in the RESQML→OSDU guide:
 * grid-derived representations prefer GenericBinGrid (preserves grid geometry:
 * origin, bin widths, node counts) and fall back to GenericRepresentation.
 * Returns [] for non-WPC groups or kinds that are already generic.
 */
function genericSiblingsFor(entityType: string): string[] {
    const m = entityType.match(/^work-product-component--(.+)$/);
    if (!m) return [];                   // only WPCs have generic siblings
    const name = m[1];
    if (name.startsWith("Generic")) return [];
    if (name.endsWith("Interpretation")) return ["work-product-component--GenericInterpretation"];
    if (name.endsWith("Feature")) return ["work-product-component--GenericFeature"];
    if (name.endsWith("Property")) return ["work-product-component--GenericProperty"];
    // Representation family. Grid-derived types keep grid geometry in GenericBinGrid.
    if (/BinGrid|Grid2d|StructureMap|SeismicHorizon/i.test(name)) {
        return [
            "work-product-component--GenericBinGrid",
            "work-product-component--GenericRepresentation"
        ];
    }
    return ["work-product-component--GenericRepresentation"];
}

/** Result of an auto-ingest attempt (returned in the upload / re-ingest response). */
export interface CatalogIngestionResult {
    status: string;
    mode?: string;
    recordCount?: number;
    workflowRunId?: string;
    error?: string;
    /** Kinds skipped because no schema is registered on the target instance (kind → record count). */
    unsupportedKinds?: Record<string, number>;
    /** Kinds whose schema was auto-registered during this ingest. */
    registeredSchemas?: string[];
    /** Kinds substituted with a fallback kind before ingest (original kind → substituted kind). */
    remappedKinds?: Record<string, string>;
    /** Number of records that failed the resilient per-record fallback. */
    failedCount?: number;
    /** Sample of per-record failures (capped). */
    failures?: Array<{ id?: string; kind?: string; status: number; error: string }>;
    /** Number of reference-data records skipped because they already exist in Storage (not overwritten). */
    skippedExisting?: number;
}

/** Resolved caller identity for an ingestion call (framework-agnostic). */
export interface IngestionAuth {
    bearer: string;
    partition?: string;
    collaboration?: string;
}

/** Optional manifest-shaping controls for an ingestion call. */
export interface ManifestFilter {
    typePatterns?: string[];
    propertyFilter?: PropertyFilter;
    excludePatterns?: string[];
}

/**
 * True when the gateway is running standalone (no OSDU services connected), in
 * which case catalog ingestion is a no-op that must be reported as "skipped"
 * rather than a failure.
 */
export function isOsduConnected(): boolean {
    return !!osduUrl && osduUrl !== "http://localhost";
}

/** Parse the autoIngest / reingest query value into an ingest mode. */
export function parseIngestMode(autoIngest?: string): IngestMode | undefined {
    if (!autoIngest || autoIngest === "false") return undefined;
    if (autoIngest === "true" || autoIngest === "records") return "records";
    if (autoIngest === "workflow") return "workflow";
    return undefined;
}

/**
 * Parse a comma-separated query value into a trimmed pattern list.
 * Returns undefined when the value is absent (caller applies its default);
 * returns [] when the value is present but empty (caller: no patterns).
 */
export function parseCsvPatterns(value?: string): string[] | undefined {
    if (value === undefined) return undefined;
    return value.split(",").map(s => s.trim()).filter(s => s.length > 0);
}

/** Parse the propertyFilter query value, defaulting to undefined when invalid/absent. */
export function parsePropertyFilter(value?: string): PropertyFilter | undefined {
    if (value === "canonical" || value === "none" || value === "all") return value;
    return undefined;
}

/**
 * Build an OSDU manifest for a dataspace and push it to the catalog via the
 * Storage Service (`records`) or the ingestion workflow (`workflow`).
 *
 * Returns a structured {@link CatalogIngestionResult}. Notable non-fatal
 * outcomes: `skipped` when no OSDU is connected (standalone RDDMS) or when no
 * record has a registered schema; `partial` when some records failed.
 */
export async function performCatalogIngestion(
    mode: IngestMode,
    dataspaceId: string,
    auth: IngestionAuth,
    registerMissing = false,
    manifestFilter?: ManifestFilter
): Promise<CatalogIngestionResult> {
    const bearer = auth.bearer;
    const partition = auth.partition;
    const partitionStr = typeof partition === "string" ? partition : "osdu";

    if (!osduUrl || osduUrl === "http://localhost") {
        return {
            status: "skipped",
            mode,
            error: "RDMS_OSDU_URL not configured - cannot push to catalog"
        };
    }

    try {
        // Align stamped kind versions with the live instance using the request
        // token (the startup init runs unauthenticated and can silently no-op).
        await ensureSchemaVersions(osduUrl, bearer, partitionStr);

        logger.info(`[autoIngest] Building manifest for dataspace '${dataspaceId}' (mode=${mode})...`);

        // Create a fresh ETP session for manifest building
        const manifestClient = await createSession(bearer, partition);
        if (!manifestClient) {
            return { status: "failed", mode, error: "Failed to create ETP session for manifest" };
        }

        const jwt = bearer ? (decode(bearer) as JwtPayload) : {};
        const context = new OSDUContext(
            typeof partition === "string" ? partition : "osdu",
            jwt === null || typeof jwt === "string" ? undefined : jwt?.unique_name,
            undefined, // tags
            true,      // createMissingReferences
            false      // includeArrayData - skip for speed
        );
        context.bearer = bearer;

        const collaboration = auth.collaboration;
        if (collaboration) {
            context.collaboration = collaboration;
        }

        const dataspaceUri = `eml:///dataspace('${dataspaceId}')`;
        // Filter defaults preserve the lean auto-ingest preset, but now also
        // hard-exclude Activity/ActivityTemplate so canonical property filtering
        // cannot leave dangling references that fail the OSDU ingestion workflow.
        const manifest = await createManifest(
            manifestClient,
            [dataspaceUri],
            context,
            manifestFilter?.typePatterns ?? DEFAULT_DATASPACE_TYPE_PATTERNS,
            1000,
            manifestFilter?.propertyFilter ?? "canonical",
            manifestFilter?.excludePatterns ?? DEFAULT_INGEST_EXCLUDE_PATTERNS
        );
        await manifestClient.closeSession();

        // Collect all records from manifest
        const records = [
            ...(manifest.Data?.Datasets ?? []),
            ...(manifest.Data?.WorkProductComponents ?? []),
            ...(manifest.Data?.WorkProduct ? [manifest.Data.WorkProduct] : []),
            ...(manifest.MasterData ?? []),
            ...(manifest.ReferenceData ?? [])
        ];

        if (records.length === 0) {
            return { status: "completed", mode, recordCount: 0 };
        }

        // Guard: drop records whose kind has no schema on the target instance
        // (optionally auto-registering first) so one unsupported kind cannot
        // fail the entire atomic batch / workflow.
        const { pushable, unsupportedKinds, registeredSchemas, remappedKinds } =
            await partitionBySchema(records, bearer, partitionStr, registerMissing);

        const unsupportedCount = records.length - pushable.length;
        if (unsupportedCount > 0) {
            logger.warn(
                `[autoIngest] Skipping ${unsupportedCount} record(s) with unregistered kinds: `
                + `${Object.entries(unsupportedKinds).map(([k, n]) => `${k}×${n}`).join(", ")}`
            );
        }
        if (Object.keys(remappedKinds).length > 0) {
            logger.info(
                `[autoIngest] Remapped ${Object.keys(remappedKinds).length} unregistered kind(s) to fallbacks: `
                + `${Object.entries(remappedKinds).map(([k, v]) => `${k}→${v}`).join(", ")}`
            );
        }

        const extra: Partial<CatalogIngestionResult> = {};
        if (Object.keys(unsupportedKinds).length > 0) extra.unsupportedKinds = unsupportedKinds;
        if (registeredSchemas.length > 0) extra.registeredSchemas = registeredSchemas;
        if (Object.keys(remappedKinds).length > 0) extra.remappedKinds = remappedKinds;

        if (pushable.length === 0) {
            return {
                status: "skipped",
                mode,
                recordCount: 0,
                error: "No records with a registered schema to ingest",
                ...extra
            };
        }

        logger.info(`[autoIngest] Manifest built: ${pushable.length}/${records.length} record(s) pushable. Pushing via ${mode}...`);

        if (mode === "workflow") {
            const pruned = pruneManifest(manifest, new Set(pushable));
            const result = await pushViaWorkflow(pruned, bearer, partition);
            return { ...result, ...extra };
        } else {
            const result = await pushViaRecords(pushable, bearer, partition);
            return { ...result, ...extra };
        }
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[autoIngest] Failed: ${msg}`);
        return { status: "failed", mode, error: msg };
    }
}

/**
 * Partition manifest records into those whose OSDU `kind` can be ingested on
 * the target Schema Service (pushable) and those that cannot (unsupported).
 *
 * For each unregistered kind, before giving up, it is resolved via
 * {@link resolveKindFallback} (nearest registered version, then a registered
 * generic sibling). When `registerMissing` is set, an unregistered kind is
 * first offered to {@link tryRegisterSchema}. Records whose kind is remapped
 * have their `kind` rewritten in place (and `data.Type` stamped for generic
 * substitutions) so the object is ingested rather than skipped.
 */
async function partitionBySchema(
    records: unknown[],
    bearer: string | undefined,
    partition: string,
    registerMissing: boolean
): Promise<{
    pushable: unknown[];
    unsupportedKinds: Record<string, number>;
    registeredSchemas: string[];
    remappedKinds: Record<string, string>;
}> {
    const distinctKinds = [...new Set(
        records.map((r: any) => r?.kind).filter((k): k is string => typeof k === "string")
    )];

    type Resolution =
        | { action: "ok" }
        | { action: "remap"; newKind: string; genericType?: string }
        | { action: "unsupported" };
    const resolution = new Map<string, Resolution>();
    const registeredSchemas: string[] = [];
    const remappedKinds: Record<string, string> = {};

    for (const kind of distinctKinds) {
        // 1) exact schema already registered
        if (await isSchemaRegistered(kind, osduUrl, bearer, partition)) {
            resolution.set(kind, { action: "ok" });
            continue;
        }
        // 2) optionally auto-register the exact kind
        if (registerMissing && await tryRegisterSchema(kind, bearer, partition)) {
            setSchemaRegistered(kind, true);
            registeredSchemas.push(kind);
            resolution.set(kind, { action: "ok" });
            continue;
        }
        // 3) fall back to a registered kind (nearest version, then generic sibling)
        const fb = await resolveKindFallback(kind, bearer, partition);
        if (fb) {
            resolution.set(kind, { action: "remap", newKind: fb.newKind, genericType: fb.genericType });
            remappedKinds[kind] = fb.newKind;
            continue;
        }
        resolution.set(kind, { action: "unsupported" });
    }

    const pushable: unknown[] = [];
    const unsupportedKinds: Record<string, number> = {};
    for (const r of records as any[]) {
        const kind = r?.kind;
        if (typeof kind !== "string") continue;
        const res = resolution.get(kind);
        if (!res || res.action === "unsupported") {
            unsupportedKinds[kind] = (unsupportedKinds[kind] ?? 0) + 1;
            continue;
        }
        if (res.action === "remap") {
            r.kind = res.newKind;
            // Preserve the original type on the generic record so it stays identifiable.
            if (res.genericType && r.data && typeof r.data === "object" && r.data.Type == null) {
                r.data.Type = res.genericType;
            }
        }
        pushable.push(r);
    }
    return { pushable, unsupportedKinds, registeredSchemas, remappedKinds };
}

/**
 * Resolve an unregistered kind to a registered substitute so the record is
 * not dropped. Tries, in order:
 *   1. the nearest registered version of the SAME entityType (same major
 *      first, then highest available) - safe, backward-compatible;
 *   2. a registered generic sibling of the same WPC role (Representation /
 *      Interpretation / Feature / Property) - lossy but keeps the object,
 *      recording the original type in `data.Type` (only when generic fallback
 *      is enabled via RDMS_INGEST_GENERIC_FALLBACK, default on).
 * Returns the substitute kind (and generic short-type, if any), or undefined.
 */
async function resolveKindFallback(
    kind: string,
    bearer: string | undefined,
    partition: string
): Promise<{ newKind: string; genericType?: string } | undefined> {
    const id = parseKindIdentity(kind);
    if (!id) return undefined;

    // 1) nearest registered version of the same entityType
    const versions = await listRegisteredVersions(
        id.entityType, id.authority, id.source, osduUrl, bearer, partition
    );
    if (versions.length > 0) {
        const sameMajor = versions.find((v) => parseInt(v.split(".")[0], 10) === id.schemaVersionMajor);
        const target = sameMajor ?? versions[0];
        const newKind = `${id.authority}:${id.source}:${id.entityType}:${target}`;
        if (newKind !== kind) {
            logger.info(`[autoIngest] Version fallback: '${kind}' → '${newKind}'`);
            return { newKind };
        }
    }

    // 2) generic sibling (opt out via RDMS_INGEST_GENERIC_FALLBACK=false)
    if (!GENERIC_FALLBACK) return undefined;
    for (const genericEntity of genericSiblingsFor(id.entityType)) {
        const gVersions = await listRegisteredVersions(
            genericEntity, id.authority, id.source, osduUrl, bearer, partition
        );
        if (gVersions.length === 0) continue;
        const genericType = id.entityType.split("--").pop();
        const newKind = `${id.authority}:${id.source}:${genericEntity}:${gVersions[0]}`;
        logger.info(`[autoIngest] Generic fallback: '${kind}' → '${newKind}' (Type='${genericType}')`);
        return { newKind, genericType };
    }
    return undefined;
}

/**
 * Attempt to register a missing schema on the OSDU Schema Service from a JSON
 * file under `RDMS_SCHEMA_DIR` (named `<entityType>:<version>.json`).
 * Returns true if the schema is (now) registered, false if no source is
 * available or registration failed.
 */
async function tryRegisterSchema(
    kind: string,
    bearer: string | undefined,
    partition: string
): Promise<boolean> {
    const identity = parseKindIdentity(kind);
    if (!identity) return false;

    const schema = await loadSchemaJson(kind, identity.entityType,
        `${identity.schemaVersionMajor}.${identity.schemaVersionMinor}.${identity.schemaVersionPatch}`);
    if (!schema) {
        logger.warn(
            `[autoIngest] Cannot auto-register '${kind}': no schema JSON found `
            + `(set RDMS_SCHEMA_DIR and provide '${identity.entityType}:`
            + `${identity.schemaVersionMajor}.${identity.schemaVersionMinor}.${identity.schemaVersionPatch}.json'), `
            + "or register it in the OSDU Schema Service manually."
        );
        return false;
    }

    const body = JSON.stringify({
        schemaInfo: { schemaIdentity: identity, status: "PUBLISHED" },
        schema
    }, bigIntToString);

    try {
        const res = await fetch(`${osduUrl}/api/schema-service/v1/schema`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": `${Buffer.byteLength(body)}`,
                "Authorization": `Bearer ${bearer}`,
                "data-partition-id": partition
            },
            body
        });
        if (res.status === 200 || res.status === 201) {
            logger.info(`[autoIngest] Registered schema '${kind}'`);
            return true;
        }
        if (res.status === 409) {
            logger.info(`[autoIngest] Schema '${kind}' already registered`);
            return true;
        }
        const errText = await res.text().catch(() => "unknown");
        logger.warn(`[autoIngest] Schema registration failed for '${kind}' (${res.status}): ${errText}`);
        return false;
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`[autoIngest] Schema registration error for '${kind}': ${msg}`);
        return false;
    }
}

/** Load a schema JSON body from RDMS_SCHEMA_DIR, if configured and present. */
async function loadSchemaJson(
    kind: string,
    entityType: string,
    version: string
): Promise<unknown | undefined> {
    if (!SCHEMA_DIR) return undefined;
    const candidates = [
        `${entityType}:${version}.json`,
        `${entityType}.${version}.json`,
        `${kind}.json`
    ];
    for (const name of candidates) {
        try {
            const raw = await readFile(join(SCHEMA_DIR, name), "utf8");
            return JSON.parse(raw);
        } catch { /* try next candidate */ }
    }
    return undefined;
}

/** Return a shallow copy of the manifest keeping only the given records. */
function pruneManifest(manifest: any, keep: Set<unknown>): unknown {
    const pruned = { ...manifest, Data: { ...manifest.Data } };
    if (Array.isArray(pruned.Data?.Datasets)) {
        pruned.Data.Datasets = pruned.Data.Datasets.filter((r: unknown) => keep.has(r));
    }
    if (Array.isArray(pruned.Data?.WorkProductComponents)) {
        pruned.Data.WorkProductComponents = pruned.Data.WorkProductComponents.filter((r: unknown) => keep.has(r));
    }
    if (pruned.Data?.WorkProduct && !keep.has(pruned.Data.WorkProduct)) {
        delete pruned.Data.WorkProduct;
    }
    if (Array.isArray(pruned.MasterData)) {
        pruned.MasterData = pruned.MasterData.filter((r: unknown) => keep.has(r));
    }
    if (Array.isArray(pruned.ReferenceData)) {
        pruned.ReferenceData = pruned.ReferenceData.filter((r: unknown) => keep.has(r));
    }
    return pruned;
}

async function pushViaRecords(
    records: unknown[],
    bearer?: string,
    partition?: string | string[]
): Promise<CatalogIngestionResult> {
    const partitionStr = typeof partition === "string" ? partition : "osdu";
    let totalPushed = 0;
    const failures: Array<{ id?: string; kind?: string; status: number; error: string }> = [];

    // Deduplicate records by id - Storage API rejects batches with duplicate IDs
    const seenIds = new Set<string>();
    const uniqueRecords = records.filter((r: any) => {
        const id = r?.id;
        if (!id || seenIds.has(id)) return false;
        seenIds.add(id);
        return true;
    });
    if (uniqueRecords.length < records.length) {
        logger.info(`[autoIngest] Deduplicated ${records.length - uniqueRecords.length} duplicate record(s)`);
    }

    // Never overwrite shared reference-data catalog records (e.g. CoordinateReferenceSystem)
    // that already exist in Storage. The manifest builder synthesizes a low-fidelity
    // reference-data stub purely so downstream object references resolve; PUTting it over an
    // authoritative catalog record (loaded by the OSDU datafier from the IOGP manifests)
    // both clobbers the real content (nulling BaseCRS/PersistableReference/Wgs84Coordinates/…)
    // and churns the version history, stamping the ingesting user as the modifier. So we only
    // create reference-data records that are MISSING; existing ones are left untouched.
    // (Fail-open: if the existence check errors, we still PUT so genuine creates are not lost.)
    let skippedExisting = 0;
    const pushRecords: unknown[] = [];
    {
        const SKIP_CHECK_CONCURRENCY = 8;
        const checks = uniqueRecords.map(rec => ({ rec, skip: false }));
        for (let i = 0; i < checks.length; i += SKIP_CHECK_CONCURRENCY) {
            const slice = checks.slice(i, i + SKIP_CHECK_CONCURRENCY);
            await Promise.all(slice.map(async entry => {
                if (isReferenceDataRecord(entry.rec)) {
                    entry.skip = await referenceDataExists(entry.rec, bearer, partitionStr);
                }
            }));
        }
        for (const { rec, skip } of checks) {
            if (skip) {
                skippedExisting += 1;
            } else {
                pushRecords.push(rec);
            }
        }
    }
    if (skippedExisting > 0) {
        logger.info(`[autoIngest] Skipped ${skippedExisting} existing reference-data catalog record(s) (not overwriting authoritative content)`);
    }

    for (let i = 0; i < pushRecords.length; i += STORAGE_BATCH_SIZE) {
        const batch = pushRecords.slice(i, i + STORAGE_BATCH_SIZE);
        const res = await putRecords(batch, bearer, partitionStr);
        if (res.ok) {
            const result = await res.json() as { recordCount?: number };
            totalPushed += result?.recordCount ?? batch.length;
            continue;
        }

        // Storage validates a PUT batch atomically: one bad record fails the
        // whole batch. Retry each record individually so the valid ones still
        // land, and capture the offenders for the response.
        const errText = await res.text().catch(() => "unknown");
        logger.warn(
            `[autoIngest] Storage batch ${Math.floor(i / STORAGE_BATCH_SIZE) + 1} failed (${res.status}): `
            + `${errText.slice(0, 300)} - retrying ${batch.length} record(s) individually`
        );
        for (const rec of batch) {
            const single = await putRecords([rec], bearer, partitionStr);
            if (single.ok) {
                totalPushed += 1;
            } else {
                const et = await single.text().catch(() => "unknown");
                failures.push({
                    id: (rec as any)?.id,
                    kind: (rec as any)?.kind,
                    status: single.status,
                    error: et.slice(0, 300)
                });
            }
        }
    }

    if (failures.length > 0) {
        const byKind = failures.reduce<Record<string, number>>((acc, f) => {
            const k = f.kind ?? "unknown";
            acc[k] = (acc[k] ?? 0) + 1;
            return acc;
        }, {});
        logger.warn(
            `[autoIngest] ${failures.length} record(s) rejected by Storage: `
            + `${Object.entries(byKind).map(([k, n]) => `${k}×${n}`).join(", ")}`
        );
    }

    logger.info(`[autoIngest] Pushed ${totalPushed}/${pushRecords.length} records via Storage Service`);
    return {
        status: failures.length > 0 ? "partial" : "completed",
        mode: "records",
        recordCount: totalPushed,
        ...(skippedExisting > 0 ? { skippedExisting } : {}),
        ...(failures.length > 0 ? { failedCount: failures.length, failures: failures.slice(0, 20) } : {})
    };
}

/** True when the record is an OSDU reference-data catalog record. */
function isReferenceDataRecord(rec: unknown): boolean {
    const kind = (rec as { kind?: unknown })?.kind;
    return typeof kind === "string" && kind.includes("reference-data--");
}

/**
 * Return true when the reference-data record already exists in Storage, so it must
 * NOT be overwritten by the manifest's synthesized stub. Returns false when the record
 * is missing (404) or the check cannot be made (fail-open so genuine creates still PUT).
 */
async function referenceDataExists(
    rec: unknown,
    bearer: string | undefined,
    partition: string
): Promise<boolean> {
    const id = (rec as { id?: unknown })?.id;
    if (typeof id !== "string" || id.length === 0) {
        return false;
    }
    try {
        const res = await fetch(
            `${osduUrl}/api/storage/v2/records/${encodeURIComponent(id)}`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${bearer}`,
                    "data-partition-id": partition
                }
            }
        );
        // 200 → exists (skip); 404 → missing (create); anything else → fail-open (PUT).
        return res.ok;
    } catch {
        return false;
    }
}

/** PUT a batch of records to the OSDU Storage Service. */
async function putRecords(
    batch: unknown[],
    bearer: string | undefined,
    partition: string
): Promise<Response> {
    const body = JSON.stringify(batch, bigIntToString);
    return fetch(`${osduUrl}/api/storage/v2/records`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": `${Buffer.byteLength(body)}`,
            "Authorization": `Bearer ${bearer}`,
            "data-partition-id": partition
        },
        body
    });
}

async function pushViaWorkflow(
    manifest: unknown,
    bearer?: string,
    partition?: string | string[]
): Promise<CatalogIngestionResult> {
    const partitionStr = typeof partition === "string" ? partition : "osdu";
    const workflowBody = JSON.stringify({
        executionContext: {
            manifest
        }
    }, bigIntToString);

    const res = await fetch(
        `${osduUrl}/api/workflow/v1/workflow/Osdu_ingest/workflowRun`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": `${Buffer.byteLength(workflowBody)}`,
                "Authorization": `Bearer ${bearer}`,
                "data-partition-id": partitionStr
            },
            body: workflowBody
        }
    );

    if (!res.ok) {
        const errText = await res.text().catch(() => "unknown");
        return {
            status: "failed",
            mode: "workflow",
            error: `Workflow service returned ${res.status}: ${errText}`
        };
    }

    const result = await res.json() as { runId?: string };
    logger.info(`[autoIngest] Workflow run submitted: ${result?.runId}`);
    return {
        status: "submitted",
        mode: "workflow",
        workflowRunId: result?.runId
    };
}
