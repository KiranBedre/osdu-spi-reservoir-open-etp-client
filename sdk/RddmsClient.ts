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

export interface Citation {
    Title: string;
    Originator: string;
    Creation: string;
    Format?: string;
}

export interface DataObject {
    $type: string;
    Uuid: string;
    SchemaVersion: string;
    Citation: Citation;
    [key: string]: unknown;
}

export interface DataArrayInput {
    ContainerType: string;
    ContainerUuid: string;
    PathInResource: string;
    Dimensions: number[];
    ArrayType: string;
    Data?: number[] | string;
    Starts?: number[];
    Counts?: number[];
}

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

export interface ArrayResult {
    uid: { uri: string; pathInResource: string };
    data: { data: number[]; dimensions: number[] };
}

export interface DataspaceInput {
    DataspaceId: string;
    Path?: string;
    CustomData?: Record<string, unknown>;
}

export interface ManifestInput {
    /** URIs of resources or dataspaces to generate a manifest for. */
    uris: string[];
    /** Optional filter restricting non-property types when indexing whole dataspaces (accepts * and ? wildcards). */
    typePatterns?: string[];
    /** Property inclusion, independent of typePatterns. "all" (default), "canonical", or "none". */
    propertyFilter?: "canonical" | "none" | "all";
    /** Type patterns (accepts * and ?) that hard-exclude matching types before inclusion rules (CRS always kept). */
    excludePatterns?: string[];
    /** If true (default), missing references are added as entries; else collected into an error list. */
    createMissingReferences?: boolean;
    /** When true, read bulk arrays to compute spatial bounding boxes / active cell counts. Default false. */
    includeArrayData?: boolean;
    /** OSDU tags to apply. */
    tags?: Record<string, string>;
    /** Technical Assurance information. */
    technicalAssurances?: unknown[];
    /**
     * When true, build asynchronously: returns `202` with a `jobId` immediately
     * (not bound by the ~60s ingress timeout). Poll `manifest.job(jobId)` for
     * status and the completed manifest. Default false (synchronous).
     */
    async?: boolean;
    /**
     * When true (default), run the schema-compatibility pass that remaps each
     * record's kind to one registered in the target OSDU schema service
     * (maximizes ingestibility). When false, skip it entirely for a faster,
     * M26-style build with no per-kind schema-service round-trips (records keep
     * their original kind, which the target OSDU may not have registered).
     */
    schemaCompat?: boolean;
}

/** `202 Accepted` payload returned by `manifest.build` when `async: true`. */
export interface ManifestJobAccepted {
    jobId: string;
    status: string;
    statusUrl: string;
}

/** Status payload returned by `manifest.job(jobId)`. */
export interface ManifestJobStatus {
    jobId: string;
    status: "running" | "completed" | "failed" | string;
    manifest?: unknown;
    diagnostics?: unknown;
    error?: string;
}

export interface FindResourcesInput {
    uri: string;
    scope?: "targets" | "sources";
    depth?: number;
    dataObjectTypes?: string[];
}

export interface TransactionResult {
    transactionId: string;
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

/**
 * SSRF guard: validate that a fully-constructed request URL is a well-formed
 * http/https URL before it is handed to `fetch`. The base URL is supplied by
 * the SDK consumer, but validating here keeps user-controlled values from
 * reaching the HTTP client as, e.g., `file:` or `gopher:` scheme requests.
 */
function assertHttpUrl(url: string): string {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`RDDMS client: malformed request URL: ${url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(
            `RDDMS client: unsupported URL scheme '${parsed.protocol}' (only http/https allowed)`,
        );
    }
    return parsed.toString();
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
        // Fail fast on a malformed or non-http(s) base URL (SSRF guard).
        assertHttpUrl(`${this.base}/`);
        this.partitionId = opts.partitionId ?? "opendes";
        this.token = opts.token;
        this.extraHeaders = opts.headers ?? {};
    }

    // ── Internal fetch ─────────────────────────────────────────────────────

    private async headers(): Promise<Record<string, string>> {
        if (!this.token) {
            // Auto-fetch dev token
            const res = await fetch(assertHttpUrl(`${this.base}/auth/token`), {
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
        const res = await fetch(assertHttpUrl(`${this.base}${path}`), {
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
    private del<T>(path: string) { return this.request<T>("DELETE", path); }

    /** Multipart POST (e.g. EPC upload). Lets fetch set the boundary. */
    private async upload<T>(path: string, form: FormData): Promise<T> {
        const h = await this.headers();
        const res = await fetch(assertHttpUrl(`${this.base}${path}`), { method: "POST", headers: h, body: form });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`RDDMS POST ${path} \u2192 ${res.status}: ${text}`);
        }
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("json")) return res.json() as Promise<T>;
        return res.text() as unknown as T;
    }

    // ── Health ──────────────────────────────────────────────────────────────

    readonly health = {
        readiness: () => this.get<boolean>("/health/readiness"),
        liveness: () => this.get<boolean>("/health/liveness"),
        info: () => this.get<Record<string, unknown>>("/health/info"),
        converters: () => this.get<unknown[]>("/health/converters"),
    };

    // ── Dataspaces ──────────────────────────────────────────────────────────

    readonly dataspaces = {
        list: () => this.get<unknown[]>("/dataspaces"),
        create: (input: DataspaceInput[]) => this.post<string[]>("/dataspaces", input),
        info: (ds: string) => this.get<unknown>(`/dataspaces/${enc(ds)}/info`),
        delete: (ds: string) => this.del<unknown>(`/dataspaces/${enc(ds)}`),
        clone: (ds: string, body: { targetDataspaceId: string }, opts?: { reidentify?: boolean }) =>
            this.post<string>(`/dataspaces/${enc(ds)}/clone${qs(opts ?? {})}`, body),
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
        /** Find data objects with full content */
        findObjects: (input: FindResourcesInput & { modifiedSince?: string }) =>
            this.post<unknown[]>("/query/objects/find", input),

        /** Batch graph search across multiple URIs */
        graphSearch: (input: { uris: string[]; scope?: string; depth?: number }) =>
            this.post<GraphResult>("/query/graph/search", input),
    };

    // ── Manifest ────────────────────────────────────────────────────────────

    readonly manifest = {
        /**
         * Build an OSDU manifest from a dataspace / resource URIs.
         *
         * Synchronous (default): resolves to the manifest object.
         * Async (`input.async === true`): resolves to a {@link ManifestJobAccepted}
         * (`202`); poll {@link RddmsClient.manifest.job} until `completed`.
         */
        build: (input: ManifestInput) =>
            this.post<unknown>("/manifests/build", input),
        /** Poll the status/result of an async manifest build started with `async: true`. */
        job: (jobId: string) =>
            this.get<ManifestJobStatus>(`/manifests/jobs/${enc(jobId)}`),
    };

    // ── PWLS (curve / property catalogue) ────────────────────────────────

    readonly pwls = {
        /** Catalog status: loaded properties, mnemonics, vendors */
        status: () => this.get<PwlsStatus>("/pwls/status"),

        /** Resolve a vendor mnemonic to its PWLS property, QuantityClass and PropertyType UUID */
        resolve: (mnemonic: string) =>
            this.get<ResolvedMnemonic>(`/pwls/resolve${qs({ mnemonic })}`),

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
    };

    // ── WITSML ──────────────────────────────────────────────

    readonly witsml = {
        /** Store WITSML 2.1 objects (XML or JSON); auto-transaction unless transactionId given */
        store: (input: WitsmlStoreInput, opts?: { transactionId?: string }) =>
            this.put<{ success: boolean; stored: Array<{ objectType: string; uuid: string; title: string }>; arraysStored: number }>(
                `/witsml/store${qs(opts ?? {})}`, input),

        /** Query WITSML objects with filters (xml or json output) */
        query: (input: WitsmlQueryInput, opts?: { $format?: "xml" | "json" }) =>
            this.post<{ objects: unknown[]; count: number; total: number }>(`/witsml/query${qs(opts ?? {})}`, input),
    };

    // ── Wells ───────────────────────────────────────────────

    readonly wells = {
        /** Search wells across dataspaces with hierarchy resolution */
        find: (opts?: { name?: string; dataspace?: string; include?: string }) =>
            this.get<WellSummary[]>(`/wells${qs(opts ?? {})}`),
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
