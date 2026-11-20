/**
 * Request-scoped ETP context for GraphQL resolvers.
 *
 * A single ETP WebSocket session is opened per GraphQL request and shared
 * across all resolvers. DataLoaders batch/deduplicate calls within the same
 * request tick, preventing N+1 problems on nested graph queries.
 *
 * PERFORMANCE:
 *  - One WebSocket session per request (not per field).
 *  - DataLoader coalesces all keys requested in the same microtask tick.
 *  - getResources/getGraph results passed by reference (no deep copy).
 *  - Object content fetched only when the `content` field is selected.
 *  - Array metadata fetched only when `arrays` field is selected.
 */
import DataLoader from "dataloader";
import {
    ResqmlClient,
    URI,
    IResqmlDataObject,
    IArrayStatsSummary,
    IArrayReduceResult,
    IArrayWhereResult,
    IArrayMultiWhereResult
} from "../../client/ResqmlClient";
import { Resource, IDataArrayMetadata, Dataspace } from "../../common/EtpTypes";
import { ResourceGraph } from "../../common/ResponseHandlers";
import { Energistics } from "../../common/Etp12";
import { acquirePooledClient } from "../ControllerUtils";

const ContextScopeKind = Energistics.Etp.v12.Datatypes.Object.ContextScopeKind;

import logging from "../../common/Logging";
const logger = logging.getLogger("EtpClient");

export interface GqlContext {
    req: any;
    loaders: EtpLoaders;
}

/**
 * Per-request set of DataLoaders backed by a single ResqmlClient session.
 * Created once per GraphQL request (in the context factory), disposed after.
 */
export class EtpLoaders {
    private client: ResqmlClient;
    private connected = false;
    private connectPromise: Promise<void> | null = null;
    private jwt: string;
    private dataPartitionId?: string;

    /** Shared object cache - avoids re-fetching the same URI twice in a request */
    readonly objectCache = new Map<URI, IResqmlDataObject>();

    /** Graph cache - stores pre-fetched ResourceGraph per dataspace URI */
    private graphCache = new Map<string, ResourceGraph>();

    constructor(jwt: string, dataPartitionId?: string) {
        this.jwt = jwt;
        this.dataPartitionId = dataPartitionId;
        this.client = new ResqmlClient();
    }

    /** Lazily open the ETP session on first use */
    private async ensureConnected(): Promise<ResqmlClient> {
        if (this.connected) return this.client;
        if (!this.connectPromise) {
            // Borrow a warm session from the shared pool (keyed by this
            // request's identity); closeSession() in dispose() releases it.
            this.connectPromise = acquirePooledClient(
                this.jwt,
                this.dataPartitionId
            ).then(c => {
                this.client = c;
                this.connected = true;
            });
        }
        await this.connectPromise;
        return this.client;
    }

    /** Release the underlying ETP session back to the pool */
    async dispose(): Promise<void> {
        if (this.connected) {
            try { await this.client.closeSession(); } catch { /* best effort */ }
            this.connected = false;
        }
    }

    // -------------------------------------------------------------------------
    // DataLoader: resource metadata by URI (Discovery protocol)
    // Batches all URI lookups in the same tick into one getResources call.
    // -------------------------------------------------------------------------
    readonly resourceLoader = new DataLoader<string, Resource | null>(
        async (uris) => {
            const c = await this.ensureConnected();
            // getResources accepts a ContextInfo with a URI; for batch we call getGraph
            // on the common dataspace root and filter. But more efficient: direct call
            // per URI using getResources with scope=self.
            const results = new Map<string, Resource>();
            // Group by dataspace for efficiency
            for (const uri of uris) {
                try {
                    const resources = await c.getResources(uri, ContextScopeKind.self);
                    if (resources.length > 0) {
                        results.set(uri, resources[0]);
                    }
                } catch (e) {
                    logger.warn(`resourceLoader: failed for ${uri}`, e);
                }
            }
            return uris.map(uri => results.get(uri) ?? null);
        },
        { cache: true }
    );

    // -------------------------------------------------------------------------
    // DataLoader: object content (Store protocol - heavy, only when selected)
    // Returns parsed JS object by reference - no serialization overhead.
    // -------------------------------------------------------------------------
    readonly contentLoader = new DataLoader<string, IResqmlDataObject | null>(
        async (uris) => {
            const c = await this.ensureConnected();
            const results = await c.getObjects(
                uris as string[],
                false
            );
            // Populate cache for cross-resolver sharing
            for (let i = 0; i < uris.length; i++) {
                if (results[i]) {
                    this.objectCache.set(uris[i], results[i]!);
                }
            }
            return results;
        },
        { cache: true, maxBatchSize: 50 }
    );

    // -------------------------------------------------------------------------
    // DataLoader: graph traversal (targets/sources) by URI
    // Returns ResourceGraph which has lazy-computed target/source maps.
    // -------------------------------------------------------------------------
    readonly graphLoader = new DataLoader<
        string,
        ResourceGraph
    >(
        async (uris) => {
            const c = await this.ensureConnected();
            const results: ResourceGraph[] = [];
            for (const uri of uris) {
                const cached = this.graphCache.get(uri);
                if (cached) {
                    results.push(cached);
                    continue;
                }
                try {
                    const graph = await c.getGraph(
                        uri,
                        ContextScopeKind.targetsOrSelf,
                        true // countObjects
                    );
                    this.graphCache.set(uri, graph);
                    results.push(graph);
                } catch (e) {
                    logger.warn(`graphLoader: failed for ${uri}`, e);
                    results.push(new ResourceGraph([], []));
                }
            }
            return results;
        },
        { cache: true }
    );

    // -------------------------------------------------------------------------
    // DataLoader: source graph traversal
    // -------------------------------------------------------------------------
    readonly sourceGraphLoader = new DataLoader<
        string,
        ResourceGraph
    >(
        async (uris) => {
            const c = await this.ensureConnected();
            const results: ResourceGraph[] = [];
            for (const uri of uris) {
                try {
                    const graph = await c.getGraph(
                        uri,
                        ContextScopeKind.sourcesOrSelf,
                        true
                    );
                    results.push(graph);
                } catch (e) {
                    logger.warn(`sourceGraphLoader: failed for ${uri}`, e);
                    results.push(new ResourceGraph([], []));
                }
            }
            return results;
        },
        { cache: true }
    );

    // -------------------------------------------------------------------------
    // DataLoader: array metadata (DataArray protocol - lightweight)
    // -------------------------------------------------------------------------
    readonly arrayMetaLoader = new DataLoader<string, IDataArrayMetadata[]>(
        async (uris) => {
            const c = await this.ensureConnected();
            const results: IDataArrayMetadata[][] = [];
            for (const uri of uris) {
                try {
                    const descriptions = await c.getArrayDescription([
                        { uri, pathInResource: "" }
                    ]);
                    results.push(
                        descriptions.filter((d): d is IDataArrayMetadata => d !== null)
                    );
                } catch (e) {
                    logger.warn(`arrayMetaLoader: failed for ${uri}`, e);
                    results.push([]);
                }
            }
            return results;
        },
        { cache: true }
    );

    // -------------------------------------------------------------------------
    // Direct access for operations that don't fit the DataLoader pattern
    // -------------------------------------------------------------------------

    /** List all dataspaces */
    async getDataspaces() {
        const c = await this.ensureConnected();
        return c.getDataspaces();
    }

    /** List resources in a dataspace (by dataspace URI) */
    async getDataspaceResources(
        dataspaceUri: string,
        dataObjectTypes?: string[]
    ): Promise<Resource[]> {
        const c = await this.ensureConnected();
        return c.getResources(
            dataspaceUri,
            ContextScopeKind.targets,
            dataObjectTypes
        );
    }

    /**
     * Depth/scope-aware graph traversal for the `targets`/`sources` field
     * resolvers. Unlike the depth-1 `graphLoader`, this honours an explicit
     * `depth` (the server walks transitive edges) in the requested direction.
     * Not DataLoader-cached because the (uri, direction, depth) key space is
     * large; callers apply their own cycle-guard/dedup on the merged result.
     */
    async getGraphDeep(
        uri: string,
        direction: "target" | "source",
        depth: number,
        dataObjectTypes?: string[]
    ): Promise<ResourceGraph> {
        const c = await this.ensureConnected();
        const scope =
            direction === "target"
                ? ContextScopeKind.targetsOrSelf
                : ContextScopeKind.sourcesOrSelf;
        const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
            dataObjectTypes: dataObjectTypes ?? [],
            depth,
            includeSecondarySources: direction === "source",
            includeSecondaryTargets: direction === "target",
            navigableEdges:
                Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both,
            uri
        };
        try {
            return await c.getGraph(context, scope, true);
        } catch (e) {
            logger.warn(
                `getGraphDeep: failed for ${uri} dir=${direction} depth=${depth}`,
                e
            );
            return new ResourceGraph([], []);
        }
    }

    // -------------------------------------------------------------------------
    // Server-side array compute (open-etp-server M28 STATS/REDUCE/WHERE
    // extensions). The array bytes never leave the store; only the fixed-size
    // summary / column map / aim-point is shipped. Each returns null when the
    // connected store does not support the extension (older M27 / ADME).
    // -------------------------------------------------------------------------

    /** Server-side statistical summary of one array (count/min/max/mean/…, plus
     * optional in-range count and histogram percentiles). */
    async getArrayStats(
        uri: string,
        pathInResource: string,
        range?: { lo: number; hi: number },
        histogramBins?: number
    ): Promise<IArrayStatsSummary | null> {
        const c = await this.ensureConnected();
        return c.getDataArrayStats(uri, pathInResource, range, histogramBins);
    }

    /** Server-side K-axis column reduction of a 3-D property into a 2-D map
     * (net-pay / targeting maps). */
    async getArrayReduce(
        uri: string,
        pathInResource: string,
        op: "sum" | "mean" | "min" | "max" | "count" | "net",
        opts?: {
            kRange?: { k0: number; k1: number };
            range?: { lo: number; hi: number };
            cellDz?: number;
        }
    ): Promise<IArrayReduceResult | null> {
        const c = await this.ensureConnected();
        return c.getDataArrayReduce(uri, pathInResource, op, opts);
    }

    /** Server-side single-property masked predicate: count + ijk bbox + centroid
     * (aim point) of cells whose value is in `[lo, hi]`. */
    async getArrayWhere(
        uri: string,
        pathInResource: string,
        range: { lo: number; hi: number }
    ): Promise<IArrayWhereResult | null> {
        const c = await this.ensureConnected();
        return c.getDataArrayWhere(uri, pathInResource, range);
    }

    /** Server-side multi-criteria targeting: AND several per-property predicates
     * over the shared grid and return the passing count, its ijk bbox/centroid,
     * and the largest connected body (the drillable target). */
    async getArrayWhereMulti(
        predicates: {
            uri: string;
            pathInResource: string;
            range: { lo: number; hi: number };
        }[]
    ): Promise<IArrayMultiWhereResult | null> {
        const c = await this.ensureConnected();
        return c.getDataArrayWhereMulti(predicates);
    }
}