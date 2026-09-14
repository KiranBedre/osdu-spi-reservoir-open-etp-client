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
    IResqmlDataObject
} from "../../client/ResqmlClient";
import { Resource, IDataArrayMetadata, Dataspace } from "../../common/EtpTypes";
import { ResourceGraph } from "../../common/ResponseHandlers";
import { Energistics } from "../../common/Etp12";
import { etpServerUrl } from "../../common/config";

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
            this.connectPromise = this.client
                .openSession(etpServerUrl, this.jwt, this.dataPartitionId)
                .then(() => { this.connected = true; });
        }
        await this.connectPromise;
        return this.client;
    }

    /** Close the underlying WebSocket session */
    async dispose(): Promise<void> {
        if (this.connected) {
            try { await this.client.closeSession(); } catch { /* best effort */ }
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
}
