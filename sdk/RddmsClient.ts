/**
 * @osdu/rddms-client - Typed REST SDK for the Reservoir DDMS.
 *
 * Thin typed wrapper over the open-etp-client REST API.
 * Auto-handles auth tokens, partition headers, transaction lifecycle,
 * and JSON serialization.
 *
 * Unlike the low-level ResqmlClient (WebSocket/Avro, ETP protocol knowledge
 * required), this SDK talks plain HTTP/JSON to the already-running REST
 * gateway - no binary protocols, no XML, no HDF5 linking.
 *
 * @example
 *   import { RddmsClient } from '@osdu/rddms-client';
 *   const rddms = new RddmsClient({ baseUrl: 'http://localhost:8080/api/reservoir-ddms/v2' });
 *   const dataspaces = await rddms.dataspaces.list();
 */

import * as builders from "../src/lib/builders";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RddmsClientOptions {
    /** Full base URL including root path, e.g. http://localhost:8080/api/reservoir-ddms/v2 */
    baseUrl: string;
    /** data-partition-id header value (default: 'opendes') */
    partitionId?: string;
    /** Static bearer token. If omitted, fetches from GET /auth/token (local dev). */
    token?: string;
    /** Extra headers merged into every request */
    headers?: Record<string, string>;
}

// Canonical wire-shape types live in src/lib/builders/types.ts (shared by the
// server REST controllers and this SDK facade). Imported for local use and
// re-exported so existing `import { DataObject } from "sdk"` consumers keep
// working unchanged.
import type { Citation, DataObject, DataArrayInput } from "../src/lib/builders/types";
export type { Citation, DataObject, DataArrayInput };

export interface ResourceSummary {
    uri: string;
    name: string;
    contentType?: string;
    storeLastWrite?: string;
    sourceCount?: number;
    targetCount?: number;
}

export interface TypeCount {
    name: string;
    count: number;
}

export interface GraphResult {
    resources: ResourceSummary[];
    links: Array<{ sourceUri: string; targetUri: string; label?: string }>;
}

/** One projected node value in a Cypher result row. */
export interface CypherNode {
    uri: string;
    id: string | null;
    name: string | null;
    type: string | null;
    sourceCount: number | null;
    targetCount: number | null;
}

/** A matched path value (`RETURN p`) in a Cypher result row. */
export interface CypherPath {
    /** Number of hops (nodes - 1). */
    length: number;
    nodes: CypherNode[];
}

/**
 * Tabular result of a {@link RddmsClient.cypher} query. Each entry in `data`
 * is one matched row keyed by the RETURN alias; node variables expand to
 * {@link CypherNode}, path variables to {@link CypherPath}, scalar
 * projections (`var.prop`) to primitives.
 */
export interface CypherResult {
    columns: string[];
    data: Array<Record<string, CypherNode | CypherPath | string | number | boolean | null>>;
    stats: {
        nodesScanned: number;
        edges: number;
        rowsBeforeLimit: number;
        graphDepth: number;
    };
}

/** SPARQL query form returned by {@link RddmsClient.sparql}. */
export type SparqlForm = "SELECT" | "ASK" | "CONSTRUCT" | "DESCRIBE";

/** Serialization requested for CONSTRUCT/DESCRIBE results. */
export type SparqlFormat = "json" | "turtle" | "jsonld";

/** A W3C SPARQL 1.1 JSON result term (RDF term binding). */
export interface SparqlTerm {
    type: "uri" | "literal";
    value: string;
    datatype?: string;
    "xml:lang"?: string;
}

export interface SparqlStats {
    triplesScanned: number;
    solutions: number;
    form: string;
}

/** `SELECT` result in W3C SPARQL 1.1 Query Results JSON shape. */
export interface SparqlSelectResult {
    form: "SELECT";
    head: { vars: string[] };
    results: { bindings: Array<Record<string, SparqlTerm>> };
    stats: SparqlStats;
}

/** `ASK` result (boolean). */
export interface SparqlAskResult {
    form: "ASK";
    boolean: boolean;
    stats: SparqlStats;
}

/** `CONSTRUCT` / `DESCRIBE` result (an RDF graph as triples, plus optional serialization). */
export interface SparqlGraphResult {
    form: "CONSTRUCT" | "DESCRIBE";
    triples: Array<{ subject: string; predicate: string; object: SparqlTerm }>;
    /** Present when a non-JSON `format` (turtle/jsonld) was requested. */
    rdf?: string;
    stats: SparqlStats;
}

export type SparqlResult =
    | SparqlSelectResult
    | SparqlAskResult
    | SparqlGraphResult;

export interface ArrayResult {
    uid: { uri: string; pathInResource: string };
    data: { data: number[]; dimensions: number[] };
}

/** A reference to one numeric array inside a RESQML object. */
export interface ArrayRef {
    dataObjectType: string;
    guid: string;
    version?: string;
    pathInResource: string;
}

/** One curve to co-index against the shared index axis. */
export interface AlignCurve extends ArrayRef {
    /** Column label (defaults to the array path). */
    name?: string;
    /** Supply the four `index*` fields only when the curve lives on a
     *  different frame than the shared index (triggers resampling). */
    indexObjectType?: string;
    indexGuid?: string;
    indexVersion?: string;
    indexPathInResource?: string;
}

export interface AlignRequest {
    /** Shared index axis (typically a WellboreFrame `NodeMd`). */
    index: ArrayRef;
    curves: AlignCurve[];
}

export interface AlignResult {
    rows: number;
    /** true when every curve shared the index frame (no resampling needed). */
    aligned: boolean;
    index: number[];
    curves: Array<{ name: string; resampled: boolean; data: number[] }>;
}

export interface DataspaceInput {
    DataspaceId: string;
    Path?: string;
    CustomData?: Record<string, unknown>;
}

/** Governance metadata patch for {@link RddmsClient.dataspaces.updateAcl}. */
export interface AclInput {
    Viewers?: string[];
    Owners?: string[];
    LegalTags?: string[];
    OtherRelevantDataCountries?: string[];
    CustomData?: Record<string, unknown>;
}

export interface ManifestInput {
    dataspaceId: string;
    uris?: string[];
    typePatterns?: string[];
    propertyFilter?: "canonical" | "none" | "all";
    /** Type patterns or friendly kind aliases (e.g. "wells", "logs") to hard-exclude. */
    excludePatterns?: string[];
    /** Emit the full transitive dependency closure of the listed `uris` as records. */
    followReferences?: boolean;
    createMissingReferences?: boolean;
}

export interface FindResourcesInput {
    /** One context URI, or several (batch). */
    uri: string | string[];
    scope?: "self" | "targets" | "sources" | "targetsOrSelf" | "sourcesOrSelf";
    depth?: number;
    dataObjectTypes?: string[];
    /** Only resources changed since this ISO timestamp. */
    modifiedSince?: string;
    /** Inline each object's content (`format` selects xml or json). */
    includeContent?: boolean;
    format?: "xml" | "json";
    /** Also return the relationship edges (`links`) between the resources. */
    includeEdges?: boolean;
    countObjects?: boolean;
    includeSecondaryTargets?: boolean;
    includeSecondarySources?: boolean;
}

export interface FoundResource extends ResourceSummary {
    lastChanged?: string;
    activeStatus?: string;
    customData?: Record<string, unknown>;
    /** Present when `includeContent` is set. */
    format?: "xml" | "json";
    data?: unknown;
}

export interface FindResourcesResult {
    resources: FoundResource[];
    /** Present when `includeEdges` is set. */
    links?: Array<{ source: string; target: string; path: string }>;
}

export interface GrowingObjectInput {
    uri: string;
    /** With `endIndex`: return the parts in the window instead of the metadata. */
    startIndex?: number;
    endIndex?: number;
    includeOverlapping?: boolean;
    /** Also return the channel metadata (ETP protocol 21). */
    includeChannels?: boolean;
}

export interface GrowingObjectResult {
    metadata?: unknown[];
    parts?: Array<{ uid: string; data: string }>;
    channels?: unknown[];
}

export type ArrayComputeOp = "stats" | "reduce" | "where" | "where-multi" | "arith";

export interface ArrayComputeTarget {
    dataObjectType: string;
    guid: string;
    version?: string;
    pathInResource: string;
}

/** Body of `POST /dataspaces/{ds}/arrays/compute`; the fields used depend on `op`. */
export interface ArrayComputeRequest {
    op: ArrayComputeOp;
    target?: ArrayComputeTarget;
    rangeLo?: number;
    rangeHi?: number;
    bins?: number;
    reducer?: "sum" | "mean" | "min" | "max" | "count" | "net";
    k0?: number;
    k1?: number;
    cellDz?: number;
    predicates?: unknown[];
    batches?: unknown[];
    arith?: unknown;
    /** Queue the job and return 202 + a job view (poll `compute.job`). */
    async?: boolean;
}

export interface TransactionResult {
    transactionId: string;
}

/** Result of a domain-typed seismic `put`: the write outcome + built graph. */
export interface SeismicPutResult {
    transactionId: string;
    success: boolean;
    /** Uuid of the primary object (the frame, grid, point-set or property). */
    uuid: string;
    /** The built parts (`{ object, arrays }`) that were written. */
    parts: builders.BuiltObject[];
}

/** Result of a domain-typed seismic `get`: the RESQML object + optional OSDU projection. */
export interface SeismicGetResult<TOsdu = unknown> {
    object: DataObject;
    /** Present only when `{ osdu: true }` was requested. */
    osdu?: TOsdu;
}

export type RdfFormat = "turtle" | "jsonld" | "ntriples";

export interface PwlsStatus {
    propertiesLoaded?: number;
    mnemonicsLoaded?: number;
    vendors?: string[];
    [key: string]: unknown;
}

export interface ResolvedMnemonic {
    mnemonic: string;
    property?: string;
    quantityClass?: string;
    propertyTypeId?: string;
    resolved: boolean;
    /** Present with `include=hierarchy`. */
    hierarchy?: Array<{ name: string; quantityClass?: string; propertyTypeId?: string; depth: number }>;
    depth?: number;
}

export interface CurveValidationInput {
    curves: Array<{ mnemonic: string; uom?: string }>;
}

export interface CurveValidationResult {
    total: number;
    resolved: number;
    unresolved: number;
    withWarnings: number;
    results: Array<{
        mnemonic: string;
        knownProperty: boolean;
        mnemonicResolved: boolean;
        property?: string;
        quantityClass?: string;
        propertyTypeId?: string;
        warnings?: string[];
    }>;
}

export interface DeletedResource {
    uri: string;
    deletedTime?: string;
    customData?: Record<string, unknown>;
}

export interface WitsmlStoreInput {
    dataspace: string;
    xml?: string;
    json?: DataObject[];
}

export interface WitsmlQueryInput {
    dataspace: string;
    objectType?: string;
    objectTypes?: string[];
    titleContains?: string;
    uuids?: string[];
    modifiedSince?: string;
    relatedTo?: string;
    scope?: "self" | "sources" | "targets" | "both";
    skip?: number;
    top?: number;
    format?: "xml" | "json";
}

export interface WellChild {
    uuid: string;
    name: string;
    typeName: string;
    dataspace: string;
}

export interface WellSummary {
    name: string;
    uuid: string;
    dataspace: string;
    typeName: string;
    wellbores?: WellChild[];
    logs?: WellChild[];
    trajectories?: WellChild[];
    channelSets?: WellChild[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enc(segment: string): string {
    return encodeURIComponent(segment);
}

function qs(params: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) parts.push(`${enc(k)}=${enc(String(v))}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
}

// ---------------------------------------------------------------------------
// SDK Client
// ---------------------------------------------------------------------------

export class RddmsClient {
    private readonly base: string;
    private readonly partitionId: string;
    private token?: string;
    private readonly extraHeaders: Record<string, string>;

    constructor(opts: RddmsClientOptions) {
        this.base = opts.baseUrl.replace(/\/+$/, "");
        // SSRF guard (CWE-918): the base URL flows into every fetch() below, so
        // reject malformed URLs and any non-http(s) scheme (file:, ftp:, ...).
        let parsedBase: URL;
        try {
            parsedBase = new URL(this.base);
        } catch {
            throw new Error(`RddmsClient: invalid baseUrl '${opts.baseUrl}'`);
        }
        if (parsedBase.protocol !== "http:" && parsedBase.protocol !== "https:") {
            throw new Error(
                `RddmsClient: unsupported baseUrl scheme '${parsedBase.protocol}' (only http/https allowed)`
            );
        }
        this.partitionId = opts.partitionId ?? "opendes";
        this.token = opts.token;
        this.extraHeaders = opts.headers ?? {};
    }

    // ── Internal fetch ─────────────────────────────────────────────────────

    private async headers(): Promise<Record<string, string>> {
        if (!this.token) {
            // Auto-fetch dev token
            const res = await fetch(`${this.base}/auth/token`, {
                headers: { "data-partition-id": this.partitionId },
            });
            if (res.ok) {
                const body = await res.json();
                this.token = body.token;
            }
        }
        return {
            "data-partition-id": this.partitionId,
            ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
            ...this.extraHeaders,
        };
    }

    private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const h = await this.headers();
        if (body !== undefined) h["Content-Type"] = "application/json";
        const res = await fetch(`${this.base}${path}`, {
            method,
            headers: h,
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`RDDMS ${method} ${path} → ${res.status}: ${text}`);
        }
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("json")) return res.json() as Promise<T>;
        return res.text() as unknown as T;
    }

    private get<T>(path: string) { return this.request<T>("GET", path); }
    private post<T>(path: string, body?: unknown) { return this.request<T>("POST", path, body); }
    private put<T>(path: string, body?: unknown) { return this.request<T>("PUT", path, body); }
    private patch<T>(path: string, body?: unknown) { return this.request<T>("PATCH", path, body); }
    private del<T>(path: string) { return this.request<T>("DELETE", path); }

    /** Multipart POST (e.g. EPC upload). Lets fetch set the boundary. */
    private async upload<T>(path: string, form: FormData): Promise<T> {
        const h = await this.headers();
        const res = await fetch(`${this.base}${path}`, { method: "POST", headers: h, body: form });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`RDDMS POST ${path} \u2192 ${res.status}: ${text}`);
        }
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("json")) return res.json() as Promise<T>;
        return res.text() as unknown as T;
    }

    /** GET returning raw bytes (e.g. EPC download). */
    private async getBinary(path: string): Promise<ArrayBuffer> {
        const h = await this.headers();
        const res = await fetch(`${this.base}${path}`, { method: "GET", headers: h });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`RDDMS GET ${path} \u2192 ${res.status}: ${text}`);
        }
        return res.arrayBuffer();
    }

    // ── Health ──────────────────────────────────────────────────────────────

    readonly health = {
        readiness: () => this.get<boolean>("/health/readiness"),
        liveness: () => this.get<boolean>("/health/liveness"),
        info: () => this.get<Record<string, unknown>>("/info"),
        converters: () => this.get<unknown[]>("/health/converters"),
    };

    // ── Dataspaces ──────────────────────────────────────────────────────────

    readonly dataspaces = {
        list: () => this.get<unknown[]>("/dataspaces"),
        create: (input: DataspaceInput[]) => this.post<string[]>("/dataspaces", input),
        info: (ds: string) => this.get<unknown>(`/dataspaces/${enc(ds)}/info`),
        delete: (ds: string) => this.del<unknown>(`/dataspaces/${enc(ds)}`),
        /** Duplicate a dataspace, or with `intoExisting` copy its content into an existing one. */
        clone: (ds: string, body: { targetDataspaceId: string }, opts?: { reidentify?: boolean; intoExisting?: boolean }) =>
            this.post<string | { status: string; sourceDataspace: string; targetDataspace: string; recordCount: number }>(
                `/dataspaces/${enc(ds)}/clone${qs(opts ?? {})}`, body),
        /**
         * Update the ACL / legal governance metadata of an existing dataspace.
         * Pass `reingest: "records" | "workflow"` to also propagate the new
         * ACL/legal tags to the OSDU catalog records (rolled back on failure).
         */
        updateAcl: (ds: string, body: AclInput, opts?: { reingest?: "records" | "workflow" }) =>
            this.patch<Record<string, unknown>>(`/dataspaces/${enc(ds)}/acl${qs(opts ?? {})}`, body),
        lock: (ds: string) => this.post<boolean>(`/dataspaces/${enc(ds)}/lock`),
        unlock: (ds: string) => this.del<boolean>(`/dataspaces/${enc(ds)}/lock`),
    };

    // ── Resources ───────────────────────────────────────────────────────────

    readonly resources = {
        /** List Energistics types with counts */
        types: (ds: string) =>
            this.get<TypeCount[]>(`/dataspaces/${enc(ds)}/resources`),

        /** List all resources in a dataspace */
        list: (ds: string, opts?: { skip?: number; top?: number }) =>
            this.get<ResourceSummary[]>(`/dataspaces/${enc(ds)}/resources/all${qs(opts ?? {})}`),

        /** List resources of a specific type */
        listByType: (ds: string, type: string, opts?: { skip?: number; top?: number }) =>
            this.get<ResourceSummary[]>(`/dataspaces/${enc(ds)}/resources/${enc(type)}${qs(opts ?? {})}`),

        /** Get full object content as JSON */
        get: (ds: string, type: string, guid: string, opts?: { format?: "json" | "xml"; arrayMetadata?: boolean }) =>
            this.get<unknown[]>(`/dataspaces/${enc(ds)}/resources/${enc(type)}/${enc(guid)}${qs({ $format: "json", ...opts })}`),

        /** Get content of multiple objects by URI */
        getMultiple: (uris: string[], opts?: { format?: "json" | "xml" }) =>
            this.post<unknown[]>(`/dataspaces/multi-resources/get-content${qs({ $format: "json", ...opts })}`, uris),

        /** Write data objects (within a transaction) */
        put: (ds: string, objects: DataObject[], opts?: { transactionId?: string; validate?: "false" | "true" | "strict" }) =>
            this.put<boolean>(`/dataspaces/${enc(ds)}/resources${qs(opts ?? {})}`, objects),

        /** Delete an object */
        delete: (ds: string, type: string, guid: string, opts?: { transactionId?: string }) =>
            this.del<void>(`/dataspaces/${enc(ds)}/resources/${enc(type)}/${enc(guid)}${qs(opts ?? {})}`),

        /** List targets (forward references) */
        targets: (ds: string, type: string, guid: string, opts?: { depth?: number }) =>
            this.get<ResourceSummary[]>(`/dataspaces/${enc(ds)}/resources/${enc(type)}/${enc(guid)}/targets${qs(opts ?? {})}`),

        /** List sources (back references) */
        sources: (ds: string, type: string, guid: string, opts?: { depth?: number }) =>
            this.get<ResourceSummary[]>(`/dataspaces/${enc(ds)}/resources/${enc(type)}/${enc(guid)}/sources${qs(opts ?? {})}`),

        /** Validate all objects in a dataspace */
        validate: (ds: string) =>
            this.post<unknown>(`/dataspaces/${enc(ds)}/validate`),

        /** List deleted resources with deletion timestamps */
        deleted: (ds: string, opts?: { storeLastWriteFilter?: string; dataObjectTypes?: string; transactionId?: string }) =>
            this.get<DeletedResource[]>(`/dataspaces/${enc(ds)}/deleted${qs(opts ?? {})}`),

        /** RDF/linked-data projection of a single object (Turtle by default) */
        rdf: (ds: string, type: string, guid: string, opts?: { format?: RdfFormat | "csv" | "graphml"; depth?: number; version?: string; transactionId?: string }) =>
            this.get<string | Record<string, unknown>>(`/dataspaces/${enc(ds)}/resources/${enc(type)}/${enc(guid)}/rdf${qs(opts ?? {})}`),
    };

    // ── Graph ───────────────────────────────────────────────────────────────

    readonly graph = {
        /** Full relationship graph for a dataspace */
        all: (ds: string, opts?: { depth?: number }) =>
            this.get<GraphResult>(`/dataspaces/${enc(ds)}/graph/all${qs(opts ?? {})}`),

        /** Graph targets (with edges) */
        targets: (ds: string, type: string, guid: string, opts?: { depth?: number }) =>
            this.get<GraphResult>(`/dataspaces/${enc(ds)}/graph/${enc(type)}/${enc(guid)}/targets${qs(opts ?? {})}`),

        /** Graph sources (with edges) */
        sources: (ds: string, type: string, guid: string, opts?: { depth?: number }) =>
            this.get<GraphResult>(`/dataspaces/${enc(ds)}/graph/${enc(type)}/${enc(guid)}/sources${qs(opts ?? {})}`),
    };

    // ── Arrays ──────────────────────────────────────────────────────────────

    readonly arrays = {
        /** List arrays for an object */
        list: (ds: string, type: string, guid: string) =>
            this.get<unknown[]>(`/dataspaces/${enc(ds)}/resources/${enc(type)}/${enc(guid)}/arrays`),

        /** Get array metadata (type, dimensions) */
        metadata: (ds: string, type: string, guid: string, path: string) =>
            this.get<unknown>(`/dataspaces/${enc(ds)}/resources/${enc(type)}/${enc(guid)}/arrays/${enc(path)}/metadata`),

        /** Get array content */
        get: (ds: string, type: string, guid: string, path: string, opts?: { format?: "json" | "base64"; starts?: string; counts?: string }) =>
            this.get<ArrayResult>(`/dataspaces/${enc(ds)}/resources/${enc(type)}/${enc(guid)}/arrays/${enc(path)}${qs(opts ?? {})}`),

        /** Write array data (within a transaction) */
        put: (ds: string, arrays: DataArrayInput[], opts?: { transactionId?: string }) =>
            this.put<boolean[]>(`/dataspaces/${enc(ds)}/resources/arrays${qs(opts ?? {})}`, arrays),

        /**
         * Server-side array compute (stats, reduce, where, where-multi, arith)
         * on the ETP compute lane. `async: true` queues the work (202) and
         * returns a job view to poll with `compute.job(id)`.
         */
        compute: (ds: string, body: ArrayComputeRequest, opts?: { transactionId?: string }) =>
            this.post<unknown>(`/dataspaces/${enc(ds)}/arrays/compute${qs(opts ?? {})}`, body),
    };

    // ── Compute jobs ─────────────────────────────────────────────────────────

    readonly compute = {
        jobs: () => this.get<unknown[]>("/compute/jobs"),
        job: (id: string) => this.get<unknown>(`/compute/jobs/${enc(id)}`),
        cancel: (id: string) => this.del<unknown>(`/compute/jobs/${enc(id)}`),
    };

    // ── Log structure (petrophysics co-index) ───────────────────────────────

    readonly logStructure = {
        /**
         * Co-index several well-log curves onto one shared index axis (the
         * align-without-resample primitive). Curves on the same frame are
         * column-bound node-for-node; curves carrying their own `index*`
         * reference are linearly interpolated onto the shared index and
         * flagged `resampled`.
         */
        align: (ds: string, body: AlignRequest, opts?: { transactionId?: string }) =>
            this.post<AlignResult>(`/dataspaces/${enc(ds)}/log-structure/align${qs(opts ?? {})}`, body),
    };

    // ── Transactions ────────────────────────────────────────────────────────

    readonly transactions = {
        /** Start a new transaction */
        start: (ds: string, opts?: { TimeoutPeriod?: number }) =>
            this.post<string>(`/dataspaces/${enc(ds)}/transactions`, opts ?? {}),

        /** Commit a transaction */
        commit: (ds: string, txId: string) =>
            this.put<boolean>(`/dataspaces/${enc(ds)}/transactions/${enc(txId)}`),

        /** Rollback a transaction */
        rollback: (ds: string, txId: string) =>
            this.del<boolean>(`/dataspaces/${enc(ds)}/transactions/${enc(txId)}`),
    };

    // ── Query ───────────────────────────────────────────────────────────────

    readonly query = {
        /**
         * Find resources by URI context(s) and scope. Options select the
         * variant: `includeContent` inlines the objects, `includeEdges` adds
         * the graph links, an array `uri` runs a batch search.
         */
        findResources: (input: FindResourcesInput) =>
            this.post<FindResourcesResult>("/query/resources/find", input),

        /**
         * Growing object (ETP 6/21): parts metadata by default, the parts in
         * [startIndex, endIndex] when a range is given, plus channel metadata
         * with `includeChannels`.
         */
        growing: (input: GrowingObjectInput) =>
            this.post<GrowingObjectResult>("/query/growing", input),
    };

    // ── Cypher (graph pattern matching) ──────────────────────────────────────

    readonly cypher = {
        /**
         * Run a read-only openCypher query over a dataspace's RESQML graph.
         *
         * The relationship-centric companion to `graphql` / `query.graphSearch`:
         * use Cypher for connectivity, lineage, provenance and topology
         * ("what is connected to what?"), and GraphQL for record/field retrieval.
         * Nodes are RESQML resources; relationships are DataObjectReferences
         * whose role is inferred from the RESQML tier chain. Labels match the
         * data-object type by substring (`Grid`, `Interpretation`, or a
         * fully-qualified `resqml20.obj_IjkGridRepresentation`).
         *
         * Supported subset: `MATCH … [WHERE …] RETURN … [ORDER BY] [SKIP n]
         * [LIMIT n]`, directed/undirected and variable-length `*min..max`
         * paths (capped at 10 hops), `AND/OR/NOT`, string predicates, `DISTINCT`
         * and `AS` aliases. Writes (`CREATE/MERGE/SET/DELETE`), `WITH`,
         * `UNWIND`, `CALL` and `OPTIONAL MATCH` are rejected (HTTP 400).
         *
         * @example
         *   // Everything within 5 hops of a grid
         *   await rddms.cypher.run(
         *     "demo/drogon",
         *     "MATCH p = (g {id: $gridId})-[*1..5]-(x) RETURN p",
         *     { gridId: "0c8a1e2f-3b7d-4e56-9a81-2f6c4b0d9e73" }
         *   );
         */
        run: (
            dataspace: string,
            query: string,
            parameters?: Record<string, string | number | boolean | null>
        ) =>
            this.post<CypherResult>("/cypher", {
                dataspaceUri: dataspace.startsWith("eml:")
                    ? dataspace
                    : `eml:///dataspace('${dataspace}')`,
                query,
                parameters,
            }),
    };

    // ── SPARQL (RDF / linked-data querying) ──────────────────────────────────

    readonly sparql = {
        /**
         * Run a read-only SPARQL 1.1 query over a dataspace's RESQML graph.
         *
         * The RDF/linked-data companion to `cypher` (traversal) and `graphql`
         * (record retrieval): SPARQL queries the *same* triples the `/rdf/*`
         * endpoints publish, so it is the query verb over the RDF the service
         * already serves. Subjects are ETP URIs; `rdf:type` is the RESQML class
         * (`rddmst:resqml20.IjkGridRepresentation`), `rdfs:label` the name, and
         * references appear as the generic `rddms:references` edge plus a
         * role-specific predicate (e.g. `rddms:representedInterpretation`).
         *
         * Supported subset: `SELECT` / `ASK` / `CONSTRUCT` / `DESCRIBE`, basic
         * graph patterns with `;`/`,` lists and `a`, fixed-predicate property
         * paths (`pred*` / `pred+`, capped at 10 hops), `FILTER` with
         * comparisons and `regex`/`contains`/`strstarts`/`strends`/`bound`/
         * `isiri`/`isliteral`, `DISTINCT`, `ORDER BY`, `LIMIT` and `OFFSET`.
         * Updates (`INSERT/DELETE/LOAD/…`), `OPTIONAL`, `UNION`, `MINUS`,
         * `BIND`, `VALUES`, `GROUP BY`, `SERVICE` and named graphs are rejected
         * (HTTP 400).
         *
         * `SELECT`/`ASK` always return W3C SPARQL JSON. For `CONSTRUCT` /
         * `DESCRIBE`, pass `format: "turtle" | "jsonld"` to also get a
         * serialized `rdf` string alongside the structured `triples`.
         *
         * @example
         *   // Which properties support the grid?
         *   await rddms.sparql.run(
         *     "demo/drogon",
         *     `SELECT ?name WHERE {
         *        ?p rddms:supportingRepresentation ?g .
         *        ?g a rddmst:resqml20.IjkGridRepresentation .
         *        ?p rdfs:label ?name
         *      }`
         *   );
         */
        run: (
            dataspace: string,
            query: string,
            format: SparqlFormat = "json"
        ) =>
            this.post<SparqlResult>("/sparql", {
                dataspaceUri: dataspace.startsWith("eml:")
                    ? dataspace
                    : `eml:///dataspace('${dataspace}')`,
                query,
                format,
            }),
    };

    // ── Manifest ────────────────────────────────────────────────────────────

    readonly manifest = {
        /** Build OSDU manifest from a dataspace */
        build: (input: ManifestInput) =>
            this.post<unknown>("/manifests/build", input),
    };

    // ── PWLS (curve / property catalogue) ────────────────────────────────

    readonly pwls = {
        /** Catalog status: loaded properties, mnemonics, vendors */
        status: () => this.get<PwlsStatus>("/pwls/status"),

        /**
         * Resolve a vendor mnemonic (or a PWLS `property` name) to its PWLS
         * property, QuantityClass and PropertyType UUID. `include: "hierarchy"`
         * adds the property parent chain.
         */
        resolve: (mnemonic: string, opts?: { property?: string; include?: "hierarchy" }) =>
            this.get<ResolvedMnemonic>(`/pwls/resolve${qs({ mnemonic, ...(opts ?? {}) })}`),

        /** Validate a set of curve mnemonics against the PWLS catalog */
        validate: (input: CurveValidationInput) =>
            this.post<CurveValidationResult>("/pwls/validate", input),

        /** Get the PWLS catalogue (JSON summary, or SKOS via format=turtle|jsonld|ntriples) */
        catalog: (opts?: { format?: RdfFormat; mnemonics?: boolean }) =>
            this.get<Record<string, unknown> | string>(`/pwls/catalog${qs(opts ?? {})}`),

        /** Load an additional vendor curve catalog (PWLS v4 JSON) */
        loadCatalog: (body: unknown) =>
            this.post<{ added: number; totalMnemonics: number; vendors: string[] }>("/pwls/catalog", body),
    };

    // ── RDF / linked-data ─────────────────────────────────────────

    readonly rdf = {
        /** JSON-LD @context for the compacted JSON-LD returned by the graph endpoints */
        context: () => this.get<Record<string, unknown>>("/rdf/context"),

        /** The Reservoir DDMS graph ontology (Turtle by default) */
        ontology: (opts?: { format?: RdfFormat }) =>
            this.get<string | Record<string, unknown>>(`/rdf/ontology${qs(opts ?? {})}`),

        /** RESQML/WITSML → OSDU OWL alignment (Turtle by default) */
        alignment: (opts?: { format?: RdfFormat }) =>
            this.get<string | Record<string, unknown>>(`/rdf/alignment${qs(opts ?? {})}`),
    };

    // ── EPC upload (multipart) ────────────────────────────────────

    readonly epc = {
        /**
         * Upload an EPC (+ optional H5) file pair and ingest into a dataspace.
         * Pass `ds='auto'` to derive the dataspace from `{user}/{epc filename}`.
         */
        upload: (
            ds: string,
            files: { epc: Blob; h5?: Blob; epcName?: string; h5Name?: string },
            opts?: {
                transactionId?: string;
                dataspace?: string;
                autoIngest?: "false" | "true" | "records" | "workflow";
                registerMissingSchemas?: boolean;
                validate?: "false" | "true" | "strict";
                typePatterns?: string;
                propertyFilter?: string;
                excludePatterns?: string;
            },
        ) => {
            const form = new FormData();
            form.append("epc", files.epc, files.epcName ?? "data.epc");
            if (files.h5) form.append("h5", files.h5, files.h5Name ?? "data.h5");
            return this.upload<unknown>(`/dataspaces/${enc(ds)}/epc/upload${qs(opts ?? {})}`, form);
        },

        /**
         * Download a dependency-closed EPC (OPC zip with an embedded HDF5 file)
         * for a whole dataspace or an explicit `uuids` subset. The gather step
         * follows every DOR reference (CRS, HDF proxy, interpretations,
         * features, …) so the returned `.epc` is self-contained and can be
         * re-uploaded via `epc.upload`. Returns the raw package bytes.
         */
        download: (
            ds: string,
            opts?: { uuids?: string; includeReferences?: boolean },
        ) => this.getBinary(`/dataspaces/${enc(ds)}/epc${qs(opts ?? {})}`),
    };

    // ── WITSML ──────────────────────────────────────────────

    readonly witsml = {
        /** Store WITSML 2.1 objects (XML or JSON); auto-transaction unless transactionId given */
        store: (input: WitsmlStoreInput, opts?: { transactionId?: string }) =>
            this.put<{ success: boolean; stored: Array<{ objectType: string; uuid: string; title: string }>; arraysStored: number }>(
                `/witsml/store${qs(opts ?? {})}`, input),

        /** Query WITSML objects with filters (xml or json output) */
        query: (input: WitsmlQueryInput, opts?: { format?: "xml" | "json" }) =>
            this.post<{ objects: unknown[]; count: number; total: number }>(`/witsml/query${qs(opts ?? {})}`, input),
    };

    // ── Wells ───────────────────────────────────────────────

    readonly wells = {
        /** Search wells across dataspaces with hierarchy resolution */
        find: (opts?: { name?: string; dataspace?: string; include?: string }) =>
            this.get<WellSummary[]>(`/wells${qs(opts ?? {})}`),
    };

    // ── Builders (pure) + model composition ─────────────────

    /**
     * Pure RESQML object-graph builders (CRS, HDF proxy, features/
     * interpretations, Grid2d/PointSet/PolylineSet, continuous/discrete
     * property, property-kind vocabulary). I/O-free — compose with
     * `atomicWrite` or the `model` helpers below.
     */
    readonly build = builders;

    /**
     * Higher-level model helpers that layer the existing server components
     * (strict `validate`, `pwls` curve resolution, CRS completeness) over the
     * pure builders. This is where the seismic-interpretation lane lands its
     * artefacts with one call while staying domain-generic.
     */
    readonly model = {
        /**
         * Flatten built parts (`{ object, arrays }`) plus any bare objects,
         * then atomic-write with strict validation by default.
         */
        put: async (
            ds: string,
            input: { objects?: DataObject[]; parts?: builders.BuiltObject[]; arrays?: DataArrayInput[] },
            opts?: { validate?: "false" | "true" | "strict" },
        ): Promise<{ transactionId: string; success: boolean }> => {
            const objects: DataObject[] = [
                ...(input.objects ?? []),
                ...(input.parts ?? []).map((p) => p.object),
            ];
            const arrays: DataArrayInput[] = [
                ...(input.arrays ?? []),
                ...(input.parts ?? []).flatMap((p) => p.arrays),
            ];
            const validate = opts?.validate ?? "strict";
            const txId = await this.transactions.start(ds);
            try {
                await this.resources.put(ds, objects, { transactionId: txId, validate });
                if (arrays.length) await this.arrays.put(ds, arrays, { transactionId: txId });
                await this.transactions.commit(ds, txId);
                return { transactionId: txId, success: true };
            } catch (err) {
                await this.transactions.rollback(ds, txId).catch(() => { });
                throw err;
            }
        },

        /** CRS completeness check — flags fields that would yield a hollow OSDU LocalModelCompoundCrs (O1). */
        crsCompleteness: builders.crsCompleteness,

        /** Project a RESQML CRS spec onto the OSDU compound-CRS field set. */
        toOsduCrs: builders.toOsduCompoundCrs,

        /**
         * Resolve a property kind: canonicalise via the local vocabulary, and
         * (optionally) cross-check well-log mnemonics against the server PWLS
         * catalogue for the authoritative property/QuantityClass/UUID.
         */
        resolveKind: async (
            kind: string,
            opts?: { discrete?: boolean; pwlsMnemonic?: string },
        ): Promise<{
            resolution: ReturnType<typeof builders.resolvePropertyKind>;
            pwls?: ResolvedMnemonic;
        }> => {
            const resolution = builders.resolvePropertyKind(kind, { discrete: opts?.discrete });
            if (opts?.pwlsMnemonic) {
                const pwls = await this.pwls.resolve(opts.pwlsMnemonic).catch(() => undefined);
                return { resolution, pwls };
            }
            return { resolution };
        },
    };

    // ── Seismic-interpretation domain lane (§10.6 #2) ────────────────────────

    /**
     * Domain-typed seismic-interpretation methods: one call maps a spec to the
     * correct RESQML object graph (via the pure `build.*` layer) and writes it
     * transaction-atomically (via `model.put`, strict-validated by default).
     * The `get` helpers read the object back and optionally project it onto its
     * OSDU work-product-component (reversible round-trip, per §10.6 #8):
     *   - velocity / properties → `GenericProperty:1.0.0`
     *   - checkshots / frames   → `WellLog:1.3.0`
     */
    readonly seismic = {
        /** Velocity models (interval/avg/RMS/Vp/Vs) — `ContinuousProperty` ↔ OSDU GenericProperty:1.0.0. */
        velocity: {
            put: async (
                ds: string,
                spec: builders.VelocityModelSpec,
                opts?: { validate?: "false" | "true" | "strict" },
            ): Promise<SeismicPutResult> => {
                const built = builders.buildVelocityModel(spec);
                const res = await this.model.put(ds, { parts: [built] }, opts);
                return { ...res, uuid: built.object.Uuid, parts: [built] };
            },
            get: async (
                ds: string,
                guid: string,
                opts?: { version?: builders.ResqmlVersion; osdu?: boolean },
            ): Promise<SeismicGetResult<builders.OsduGenericProperty>> => {
                const type = builders.rtype("obj_ContinuousProperty", opts?.version);
                const rows = await this.resources.get(ds, type, guid);
                const object = (Array.isArray(rows) ? rows[0] : rows) as DataObject;
                return {
                    object,
                    ...(opts?.osdu ? { osdu: builders.toOsduGenericProperty(object, { version: opts?.version }) } : {}),
                };
            },
        },

        /** Checkshots / TZ curves — `SeismicWellboreFrame` (2.2/2.3) or `WellboreFrame`+time-prop (2.0.x) ↔ OSDU WellLog:1.3.0. */
        checkshots: {
            put: async (
                ds: string,
                spec: builders.CheckshotSpec,
                opts?: { validate?: "false" | "true" | "strict" },
            ): Promise<SeismicPutResult> => {
                const parts = builders.buildCheckshot(spec);
                const res = await this.model.put(ds, { parts }, opts);
                return { ...res, uuid: parts[0].object.Uuid, parts };
            },
            get: async (
                ds: string,
                guid: string,
                opts?: { version?: builders.ResqmlVersion; osdu?: boolean },
            ): Promise<SeismicGetResult<builders.OsduWellLog>> => {
                const external = builders.versionInfo(opts?.version).arrays === "external";
                const type = builders.rtype(
                    external ? "obj_SeismicWellboreFrameRepresentation" : "obj_WellboreFrameRepresentation",
                    opts?.version,
                );
                const rows = await this.resources.get(ds, type, guid);
                const object = (Array.isArray(rows) ? rows[0] : rows) as DataObject;
                if (!opts?.osdu) return { object };
                // Best-effort: read the NodeMd array for the flattened MinMd/MaxMd/SamplingInterval summary.
                let mds: number[] | undefined;
                try {
                    const list = (await this.arrays.list(ds, type, guid)) as Array<Record<string, unknown>>;
                    const mdPath = list
                        .map((a) => String(a.pathInResource ?? a.PathInResource ?? ""))
                        .find((p) => /nodeMd$/i.test(p));
                    if (mdPath) {
                        const arr = await this.arrays.get(ds, type, guid, mdPath);
                        mds = arr?.data?.data;
                    }
                } catch {
                    /* depth summary is optional; the projection still round-trips via ExtensionProperties */
                }
                return { object, osdu: builders.toOsduWellLog(object, { version: opts?.version, mds }) };
            },
        },

        /** Gridded / picked horizons — `Grid2dRepresentation` / `PointSetRepresentation`. */
        horizons: {
            putGridded: async (
                ds: string,
                spec: builders.Grid2dSpec,
                opts?: { validate?: "false" | "true" | "strict" },
            ): Promise<SeismicPutResult> => {
                const built = builders.buildGrid2d(spec);
                const res = await this.model.put(ds, { parts: [built] }, opts);
                return { ...res, uuid: built.object.Uuid, parts: [built] };
            },
            putPicks: async (
                ds: string,
                spec: builders.PointSetSpec,
                opts?: { validate?: "false" | "true" | "strict" },
            ): Promise<SeismicPutResult> => {
                const built = builders.buildPointSet(spec);
                const res = await this.model.put(ds, { parts: [built] }, opts);
                return { ...res, uuid: built.object.Uuid, parts: [built] };
            },
            /**
             * Horizon control points — a `PointSetRepresentation` of picked XYZ
             * control points tied to a `HorizonInterpretation` + `GeneticBoundaryFeature`.
             * When `interpretationUuid` is omitted the feature + interpretation are
             * created too (convenient one-call ingestion from a control-point JSON).
             */
            putControlPoints: async (
                ds: string,
                spec: builders.HorizonControlPointsSpec,
                opts?: { validate?: "false" | "true" | "strict" },
            ): Promise<SeismicPutResult & { pointSetUuid: string; interpretationUuid: string; featureUuid?: string }> => {
                const built = builders.buildHorizonControlPoints(spec);
                const res = await this.model.put(ds, { parts: built.parts }, opts);
                return {
                    ...res,
                    uuid: built.pointSetUuid,
                    parts: built.parts,
                    pointSetUuid: built.pointSetUuid,
                    interpretationUuid: built.interpretationUuid,
                    featureUuid: built.featureUuid,
                };
            },
        },

        /**
         * Seismic bin grid (survey lattice) — the *reverse* of the RESQML → OSDU
         * `SeismicBinGrid` converter. Synthesises `SeismicLatticeFeature` →
         * `GenericFeatureInterpretation` → regular `Grid2dRepresentation` from an
         * OSDU P6/98 bin-grid definition (reversible round-trip).
         */
        bingrid: {
            put: async (
                ds: string,
                spec: builders.SeismicBinGridSpec,
                opts?: { validate?: "false" | "true" | "strict" },
            ): Promise<SeismicPutResult & { binGridUuid: string; interpretationUuid: string; featureUuid: string }> => {
                const built = builders.buildSeismicBinGrid(spec);
                const res = await this.model.put(ds, { parts: built.parts }, opts);
                return {
                    ...res,
                    uuid: built.binGridUuid,
                    parts: built.parts,
                    binGridUuid: built.binGridUuid,
                    interpretationUuid: built.interpretationUuid,
                    featureUuid: built.featureUuid,
                };
            },
        },

        /** Fault sticks — `PolylineSetRepresentation` (carries survey / bin-grid context). */
        faults: {
            putSticks: async (
                ds: string,
                spec: builders.PolylineSetSpec,
                opts?: { validate?: "false" | "true" | "strict" },
            ): Promise<SeismicPutResult> => {
                const built = builders.buildPolylineSet(spec);
                const res = await this.model.put(ds, { parts: [built] }, opts);
                return { ...res, uuid: built.object.Uuid, parts: [built] };
            },
        },

        /** Interpretation properties (amplitude / coherence / impedance / …) — `ContinuousProperty` ↔ OSDU GenericProperty:1.0.0. */
        properties: {
            put: async (
                ds: string,
                spec: builders.ContinuousPropertySpec,
                opts?: { validate?: "false" | "true" | "strict" },
            ): Promise<SeismicPutResult> => {
                const built = builders.buildContinuousProperty(spec);
                const res = await this.model.put(ds, { parts: [built] }, opts);
                return { ...res, uuid: built.object.Uuid, parts: [built] };
            },
            get: async (
                ds: string,
                guid: string,
                opts?: { version?: builders.ResqmlVersion; osdu?: boolean },
            ): Promise<SeismicGetResult<builders.OsduGenericProperty>> => {
                const type = builders.rtype("obj_ContinuousProperty", opts?.version);
                const rows = await this.resources.get(ds, type, guid);
                const object = (Array.isArray(rows) ? rows[0] : rows) as DataObject;
                return {
                    object,
                    ...(opts?.osdu ? { osdu: builders.toOsduGenericProperty(object, { version: opts?.version }) } : {}),
                };
            },
        },

        /**
         * WPC classification + manifest mapping (§10.6 #6). Classify a RESQML
         * seismic-interp object onto its OSDU WPC (CRS-domain driven), or project
         * it onto the manifest record (`SeismicHorizon` / `StructureMap` /
         * `SeismicFault` / `GenericProperty`) — reversible via `ExtensionProperties`.
         */
        classify: builders.classifySeismicObject,
        toWpc: builders.buildSeismicWpc,

        /**
         * SDMS↔RDDMS cross-store bridge resolver (§10.6 #5). Pure traversal over
         * caller-supplied catalog WPCs (e.g. from an Elastic/`graphSearch` fan-out):
         *   - `cubesFor(wpc)` — forward: a seismic-interp's cube handles.
         *   - `interpretationsForCube(items, cubeId)` — reverse: interps on cube X.
         *   - `indexByCube(items)` — the full cube ↔ interpretation index.
         */
        bridge: {
            cubesFor: builders.resolveCubeRefs,
            withCubeRefs: builders.withCubeRefs,
            interpretationsForCube: builders.interpretationsForCube,
            indexByCube: builders.indexInterpretationsByCube,
        },
    };

    // ── Reservoir grid domain lane (RESQML IjkGrid ⇄ OPM/Eclipse GRDECL) ──────

    /**
     * Corner-point grid interop for reservoir simulation (OPM Flow, Eclipse):
     * write a RESQML `IjkGridRepresentation` from a neutral corner-point grid
     * (or a GRDECL deck), and export any RESQML IJK grid back to GRDECL so a
     * non-TS simulator can pull it over HTTP. Faults are carried faithfully via
     * RESQML split coordinate lines ⇄ Eclipse per-corner ZCORN (see
     * `builders/ijkgrid.ts`). Geometry is exported today; cell properties can be
     * supplied to `toGrdecl` and are a first-class follow-up.
     */
    readonly grid = {
        /** Write a RESQML IJK grid from a neutral corner-point grid (caller manages the HDF proxy). */
        put: async (
            ds: string,
            spec: builders.IjkGridSpec,
            opts?: { validate?: "false" | "true" | "strict" },
        ): Promise<SeismicPutResult> => {
            const built = builders.buildIjkGrid(spec);
            const res = await this.model.put(ds, { parts: [built] }, opts);
            return { ...res, uuid: built.object.Uuid, parts: [built] };
        },

        /**
         * Write a RESQML BlockedWellboreRepresentation (wellbore trajectory ⇄
         * grid-cell intersection). Creates a fresh HDF proxy and writes it with
         * the blocked-well object + its index arrays atomically.
         */
        blockedWellbore: async (
            ds: string,
            spec: Omit<builders.BlockedWellboreSpec, "hdfUuid">,
            opts?: { validate?: "false" | "true" | "strict" },
        ): Promise<SeismicPutResult> => {
            const proxy = builders.buildHdfProxy({ version: spec.version });
            const built = builders.buildBlockedWellbore({ ...spec, hdfUuid: proxy.uuid });
            const res = await this.model.put(ds, { objects: [proxy.object], parts: [built] }, opts);
            return { ...res, uuid: built.object.Uuid, parts: [built] };
        },

        /**
         * Import an Eclipse/OPM GRDECL deck as a RESQML IJK grid. Parses the
         * deck, synthesises split coordinate lines for faults, creates a fresh
         * HDF proxy and writes both atomically (strict-validated by default).
         */
        putGrdecl: async (
            ds: string,
            input: {
                text: string;
                title: string;
                crsUuid: string;
                version?: builders.ResqmlVersion;
                splitTolerance?: number;
                interpretationUuid?: string;
                interpretationType?: string;
            },
            opts?: { validate?: "false" | "true" | "strict" },
        ): Promise<SeismicPutResult & { grid: builders.CornerPointGrid }> => {
            const grid = builders.parseGrdecl(input.text);
            const proxy = builders.buildHdfProxy({ version: input.version });
            const built = builders.buildIjkGrid({
                title: input.title,
                hdfUuid: proxy.uuid,
                crsUuid: input.crsUuid,
                version: input.version,
                splitTolerance: input.splitTolerance,
                interpretationUuid: input.interpretationUuid,
                interpretationType: input.interpretationType,
                grid,
            });
            const res = await this.model.put(ds, { objects: [proxy.object], parts: [built] }, opts);
            return { ...res, uuid: built.object.Uuid, parts: [built], grid };
        },

        /** Read a RESQML IJK grid object. */
        get: async (ds: string, guid: string, opts?: { version?: builders.ResqmlVersion }): Promise<{ object: DataObject }> => {
            const type = builders.rtype("obj_IjkGridRepresentation", opts?.version);
            const rows = await this.resources.get(ds, type, guid);
            const object = (Array.isArray(rows) ? rows[0] : rows) as DataObject;
            return { object };
        },

        /**
         * Export a RESQML IJK grid to Eclipse/OPM GRDECL text. Reads the
         * coordinate-line node array (+ split-line indexing when faulted),
         * decodes to a neutral corner-point grid and serialises it. Optional
         * `properties` (cell-major, i-fastest arrays) are appended as keywords.
         */
        toGrdecl: async (
            ds: string,
            guid: string,
            opts?: { version?: builders.ResqmlVersion; properties?: Record<string, number[]> },
        ): Promise<{ grdecl: string; grid: builders.CornerPointGrid }> => {
            const type = builders.rtype("obj_IjkGridRepresentation", opts?.version);
            const rows = await this.resources.get(ds, type, guid);
            const object = (Array.isArray(rows) ? rows[0] : rows) as Record<string, unknown>;
            const ni = Number(object.Ni);
            const nj = Number(object.Nj);
            const nk = Number(object.Nk);
            if (!ni || !nj || !nk) throw new Error("grid.toGrdecl: object is missing Ni/Nj/Nk");
            const geom = (object.Geometry ?? {}) as Record<string, unknown>;
            const splitBlock = geom.SplitCoordinateLines as Record<string, unknown> | undefined;
            const splitCount = Number(splitBlock?.Count ?? 0);

            const list = (await this.arrays.list(ds, type, guid)) as Array<Record<string, unknown>>;
            const pathOf = (re: RegExp): string | undefined =>
                list.map((a) => String(a.pathInResource ?? a.PathInResource ?? "")).find((p) => re.test(p));
            const readArr = async (p: string): Promise<number[]> => {
                const r = await this.arrays.get(ds, type, guid, p);
                return r?.data?.data ?? [];
            };

            const pointsPath = pathOf(/points$/i);
            if (!pointsPath) throw new Error("grid.toGrdecl: coordinate-line points array not found");
            const nodes = Float64Array.from(await readArr(pointsPath));

            let split: builders.IjkDecodeInput["split"];
            if (splitCount > 0) {
                const pi = pathOf(/pillarIndices$/i);
                const el = pathOf(/elements$/i);
                const cl = pathOf(/cumulativeLength$/i);
                if (pi && el && cl) {
                    split = {
                        count: splitCount,
                        pillarIndices: Int32Array.from(await readArr(pi)),
                        columnsElements: Int32Array.from(await readArr(el)),
                        columnsCumulative: Int32Array.from(await readArr(cl)),
                    };
                }
            }

            const properties = opts?.properties
                ? Object.fromEntries(Object.entries(opts.properties).map(([k, v]) => [k, Float64Array.from(v)]))
                : undefined;

            const grid = builders.ijkGridToCornerPoint({ ni, nj, nk, nodes, split, properties });
            return { grdecl: builders.serializeGrdecl(grid), grid };
        },
    };

    // ── Metrics ────────────────────────────────────────────



    /** Prometheus metrics (text exposition format) */
    readonly metrics = () => this.get<string>("/metrics");

    // ── High-level helpers ──────────────────────────────────────────────────

    /**
     * Atomic write: start transaction → put objects → put arrays → commit.
     * Rolls back on any error.
     */
    async atomicWrite(
        ds: string,
        objects: DataObject[],
        arrays?: DataArrayInput[],
    ): Promise<{ transactionId: string; success: boolean }> {
        const txId = await this.transactions.start(ds);
        try {
            await this.resources.put(ds, objects, { transactionId: txId });
            if (arrays?.length) {
                await this.arrays.put(ds, arrays, { transactionId: txId });
            }
            await this.transactions.commit(ds, txId);
            return { transactionId: txId, success: true };
        } catch (err) {
            await this.transactions.rollback(ds, txId).catch(() => { });
            throw err;
        }
    }
}
