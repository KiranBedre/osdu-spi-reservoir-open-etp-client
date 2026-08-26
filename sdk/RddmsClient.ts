/**
 * @osdu/rddms-client — Typed REST SDK for the Reservoir DDMS.
 *
 * Thin typed wrapper over the open-etp-client REST API.
 * Auto-handles auth tokens, partition headers, transaction lifecycle,
 * and JSON serialization.
 *
 * Unlike the low-level ResqmlClient (WebSocket/Avro, ETP protocol knowledge
 * required), this SDK talks plain HTTP/JSON to the already-running REST
 * gateway — no binary protocols, no XML, no HDF5 linking.
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
    dataspaceId: string;
    typePatterns?: string[];
    createMissingReferences?: boolean;
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
    private del<T>(path: string) { return this.request<T>("DELETE", path); }

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
        clone: (ds: string, body: { targetDataspaceId: string }) =>
            this.post<string>(`/dataspaces/${enc(ds)}/clone`, body),
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
        /** Find resources by URI context and scope */
        findResources: (input: FindResourcesInput) =>
            this.post<ResourceSummary[]>("/query/resources/find", input),

        /** Find data objects with full content */
        findObjects: (input: FindResourcesInput & { modifiedSince?: string }) =>
            this.post<unknown[]>("/query/objects/find", input),

        /** Batch graph search across multiple URIs */
        graphSearch: (input: { uris: string[]; scope?: string; depth?: number }) =>
            this.post<GraphResult>("/query/graph/search", input),

        /** Growing object parts metadata */
        growingMetadata: (input: { uri: string }) =>
            this.post<unknown>("/query/growing/metadata", input),

        /** Growing object parts by range */
        growingRange: (input: { uri: string; startIndex: number; endIndex: number; includeOverlapping?: boolean }) =>
            this.post<unknown>("/query/growing/range", input),

        /** Channel metadata */
        channelMetadata: (input: { uri: string }) =>
            this.post<unknown>("/query/channels/metadata", input),
    };

    // ── Manifest ────────────────────────────────────────────────────────────

    readonly manifest = {
        /** Build OSDU manifest from a dataspace */
        build: (input: ManifestInput) =>
            this.post<unknown>("/manifests/build", input),
    };

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
