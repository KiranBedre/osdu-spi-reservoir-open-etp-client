/**
 * GraphQL resolvers for Reservoir DMS.
 *
 * Performance design:
 *  - ETP Resource objects are passed by reference as parent - no copying.
 *  - BigInt timestamps are converted to ISO strings only at serialization.
 *  - DataLoader batches all same-tick requests into single ETP sessions.
 *  - `content` and `arrays` fields are lazy - no ETP Store/DataArray calls
 *    unless the client explicitly selects those fields.
 *  - Graph traversals use cached ResourceGraph with lazy target/source maps.
 */
import {
    Resolver,
    Query,
    ResolveField,
    Parent,
    Args,
    Context,
    Int,
    Float
} from "@nestjs/graphql";
import { UsePipes } from "@nestjs/common";

import { GqlDataspace, GqlResource, GqlEdge, GqlGraph, GqlArrayMeta, GqlObjectContent, GqlArrayStats, GqlArrayReduce, GqlArrayWhere, GqlWherePredicate, GqlScreenFilter } from "./types";
import { GqlContext, EtpLoaders } from "./context";
import { Resource, Dataspace, IDataArrayMetadata } from "../../common/EtpTypes";
import { EtpUri } from "../../common/EtpUri";
import {
    GraphIndex,
    bfsReachable,
    edgeRole,
    typeFromUri,
    typeTier,
    MAX_GRAPH_HOPS
} from "../../common/GraphCore";

// Re-exported for backward compatibility (consumers and tests import these from
// the resolver). The single implementation now lives in GraphCore.
export { edgeRole, typeFromUri, typeTier };
/** @deprecated Use `MAX_GRAPH_HOPS` from `common/GraphCore`. */
export const MAX_TRAVERSAL_DEPTH = MAX_GRAPH_HOPS;

// ---------------------------------------------------------------------------
// Helpers - zero-copy conversions (return references, not new objects)
// ---------------------------------------------------------------------------

/** Convert ETP BigInt timestamp (microseconds since epoch) to ISO string */
const bigintToIso = (v: bigint | undefined | null): string | undefined => {
    if (v === undefined || v === null || v === BigInt(0)) return undefined;
    // ETP timestamps are in microseconds
    return new Date(Number(v / BigInt(1000))).toISOString();
};

/** Minimal edge shape consumed by {@link traverseGraph}. */
export interface TraversableEdge {
    sourceUri: string;
    targetUri: string;
    path?: string;
}

/**
 * Breadth-first traversal of the resource graph from `startUri`, following edges
 * in the given direction, up to `depth` hops. Thin adapter over the shared
 * {@link bfsReachable} / {@link GraphIndex} core so GraphQL and Cypher share one
 * traversal implementation. `direction` maps target→out (source→target) and
 * source→in. Cycle-guarded; returns reachable URIs in BFS order excluding the
 * origin.
 */
export const traverseGraph = (
    edges: readonly TraversableEdge[],
    startUri: string,
    direction: "target" | "source",
    depth: number
): string[] => {
    const index = GraphIndex.fromEdges(edges);
    return bfsReachable(index, startUri, direction === "target" ? "out" : "in", depth);
};

/** Map an ETP Resource to our GqlResource shape - by reference where possible */
const mapResource = (r: Resource): GqlResource => ({
    uri: r.uri,
    name: r.name,
    dataObjectType: typeFromUri(r.uri),
    sourceCount: r.sourceCount ?? undefined,
    targetCount: r.targetCount ?? undefined,
    lastChanged: bigintToIso(r.lastChanged),
    storeLastWrite: bigintToIso(r.storeLastWrite),
    activeStatus: r.activeStatus !== undefined ? String(r.activeStatus) : undefined
});

// ---------------------------------------------------------------------------
// Root Query resolver
// ---------------------------------------------------------------------------

@Resolver()
@UsePipes()
export class RootQueryResolver {
    @Query(() => [GqlDataspace], { description: "List all dataspaces" })
    async dataspaces(@Context() ctx: GqlContext): Promise<GqlDataspace[]> {
        const dataspaces = await ctx.loaders.getDataspaces();
        if (!dataspaces) return [];
        return dataspaces.map((d: Dataspace) => ({
            uri: d.uri,
            name: d.path || d.uri,
            storeLastWrite: bigintToIso(d.storeLastWrite),
            storeCreated: bigintToIso(d.storeCreated)
        }));
    }

    @Query(() => [GqlResource], { description: "List resources in a dataspace, optionally filtered by type" })
    async resources(
        @Args("dataspaceUri") dataspaceUri: string,
        @Args("dataObjectTypes", { type: () => [String], nullable: true }) dataObjectTypes: string[] | undefined,
        @Context() ctx: GqlContext
    ): Promise<GqlResource[]> {
        const resources = await ctx.loaders.getDataspaceResources(dataspaceUri, dataObjectTypes);
        return resources.map(mapResource);
    }

    @Query(() => GqlResource, { nullable: true, description: "Get a single resource by URI" })
    async resource(
        @Args("uri") uri: string,
        @Context() ctx: GqlContext
    ): Promise<GqlResource | null> {
        const r = await ctx.loaders.resourceLoader.load(uri);
        return r ? mapResource(r) : null;
    }

    @Query(() => GqlGraph, { description: "Batch graph search across multiple URIs" })
    async graphSearch(
        @Args("uris", { type: () => [String] }) uris: string[],
        @Args("depth", { type: () => Int, defaultValue: 1 }) depth: number,
        @Context() ctx: GqlContext
    ): Promise<GqlGraph> {
        // Load graphs for all URIs (DataLoader deduplicates)
        const graphs = await Promise.all(uris.map(uri => ctx.loaders.graphLoader.load(uri)));

        // Merge - deduplicate by URI key
        const allNodes = new Map<string, Resource>();
        const seenEdges = new Set<string>();
        const allEdges: GqlEdge[] = [];

        for (const graph of graphs) {
            for (const [nodeUri, resource] of graph.entries()) {
                if (!allNodes.has(nodeUri)) allNodes.set(nodeUri, resource);
            }
            for (const edge of graph.edges) {
                const key = `${edge.sourceUri}\0${edge.targetUri}`;
                if (!seenEdges.has(key)) {
                    seenEdges.add(key);
                    allEdges.push({
                        sourceUri: edge.sourceUri,
                        targetUri: edge.targetUri,
                        path: edge.path,
                        role: edgeRole(edge.path, typeFromUri(edge.sourceUri), typeFromUri(edge.targetUri))
                    });
                }
            }
        }

        return {
            resources: [...allNodes.values()].map(mapResource),
            edges: allEdges
        };
    }

    @Query(() => GqlArrayWhere, {
        nullable: true,
        description:
            "Multi-criteria targeting: AND several per-property `[lo, hi]` " +
            "predicates over the shared grid and return the passing count, its " +
            "ijk bbox/centroid, the number of connected bodies, and the largest " +
            "connected body (the drillable aim point: bci/bcj/bck). All arrays " +
            "must share the same [Nk, Nj, Ni] shape. Null when the store lacks " +
            "the WHEREN extension or no predicate was given."
    })
    async screenCells(
        @Args("predicates", { type: () => [GqlWherePredicate] }) predicates: GqlWherePredicate[],
        @Context() ctx: GqlContext
    ): Promise<GqlArrayWhere | null> {
        if (!predicates || predicates.length === 0) return null;
        return ctx.loaders.getArrayWhereMulti(
            predicates.map(p => ({
                uri: p.uri,
                pathInResource: p.pathInResource,
                range: { lo: p.lo, hi: p.hi }
            }))
        );
    }

    @Query(() => GqlArrayWhere, {
        nullable: true,
        description:
            "High-level title-matched numeric screen (native equivalent of the " +
            "ORES Strawberry `screen`): resolves each filter's property object " +
            "by `titleContains` within the dataspace, finds its array, maps the " +
            "operator/threshold to an inclusive `[lo, hi]` range, then ANDs all " +
            "predicates server-side (WHEREN) returning the passing count, ijk " +
            "centroid and the largest connected body (drillable aim point). " +
            "`propertyType` defaults to resqml20.obj_ContinuousProperty. Null " +
            "when the store lacks the WHEREN extension, a filter matches no " +
            "object/array, or no filters were given."
    })
    async screen(
        @Args("dataspaceUri") dataspaceUri: string,
        @Args("filters", { type: () => [GqlScreenFilter] }) filters: GqlScreenFilter[],
        @Args("propertyType", { type: () => String, nullable: true }) propertyType: string | undefined,
        @Context() ctx: GqlContext
    ): Promise<GqlArrayWhere | null> {
        if (!filters || filters.length === 0) return null;
        const ptype = propertyType || "resqml20.obj_ContinuousProperty";
        const resources = await ctx.loaders.getDataspaceResources(dataspaceUri, [ptype]);
        const BIG = 1e30;
        const predicates: {
            uri: string;
            pathInResource: string;
            range: { lo: number; hi: number };
        }[] = [];
        for (const f of filters) {
            const needle = (f.titleContains || "").toLowerCase();
            const match = resources.find(r => (r.name || "").toLowerCase().includes(needle));
            if (!match) return null; // unmet AND predicate => empty result
            const metas = await ctx.loaders.arrayMetaLoader.load(match.uri);
            if (!metas || metas.length === 0) return null;
            const path = metas[0].uid.pathInResource;
            const op = (f.operator || "GT").toUpperCase();
            let lo = -BIG;
            let hi = BIG;
            if (op === "GT" || op === "GTE") lo = f.threshold;
            else if (op === "LT" || op === "LTE") hi = f.threshold;
            else if (op === "EQ") {
                lo = f.threshold;
                hi = f.threshold;
            }
            predicates.push({ uri: match.uri, pathInResource: path, range: { lo, hi } });
        }
        return ctx.loaders.getArrayWhereMulti(predicates);
    }
}

// ---------------------------------------------------------------------------
// Resource field resolvers (lazy - only called when client selects the field)
// ---------------------------------------------------------------------------

@Resolver(() => GqlResource)
@UsePipes()
export class ResourceFieldResolver {
    @ResolveField(() => [GqlResource], {
        description:
            "Target resources in the graph. `depth` (1..10) walks transitive " +
            "targets server-side; `scope` 'related' (default) excludes the " +
            "origin, 'withSelf' includes it. BFS is cycle-guarded."
    })
    async targets(
        @Parent() parent: GqlResource,
        @Args("depth", { type: () => Int, defaultValue: 1 }) depth: number,
        @Args("scope", { type: () => String, defaultValue: "related" }) scope: string,
        @Context() ctx: GqlContext
    ): Promise<GqlResource[]> {
        return this.traverse(parent, "target", depth, scope, ctx);
    }

    @ResolveField(() => [GqlResource], {
        description:
            "Source resources in the graph. `depth` (1..10) walks transitive " +
            "sources server-side; `scope` 'related' (default) excludes the " +
            "origin, 'withSelf' includes it. BFS is cycle-guarded."
    })
    async sources(
        @Parent() parent: GqlResource,
        @Args("depth", { type: () => Int, defaultValue: 1 }) depth: number,
        @Args("scope", { type: () => String, defaultValue: "related" }) scope: string,
        @Context() ctx: GqlContext
    ): Promise<GqlResource[]> {
        return this.traverse(parent, "source", depth, scope, ctx);
    }

    /**
     * Shared traversal for `targets`/`sources`. Depth 1 uses the cached depth-1
     * graph loader; deeper requests fetch a depth-N graph and BFS it with a
     * cycle-guard and a hard max-depth cap. `scope === "withSelf"` prepends the
     * origin resource.
     */
    private async traverse(
        parent: GqlResource,
        direction: "target" | "source",
        depth: number,
        scope: string,
        ctx: GqlContext
    ): Promise<GqlResource[]> {
        const effDepth = Math.max(1, Math.min(Math.floor(depth) || 1, MAX_TRAVERSAL_DEPTH));
        const graph =
            effDepth === 1
                ? await (direction === "target"
                    ? ctx.loaders.graphLoader.load(parent.uri)
                    : ctx.loaders.sourceGraphLoader.load(parent.uri))
                : await ctx.loaders.getGraphDeep(parent.uri, direction, effDepth);
        const reached = traverseGraph(graph.edges, parent.uri, direction, effDepth);
        const uris = scope === "withSelf" ? [parent.uri, ...reached] : reached;
        return uris
            .map(uri => graph.get(uri))
            .filter((r): r is Resource => r !== undefined)
            .map(mapResource);
    }

    @ResolveField(() => GqlObjectContent, { nullable: true, description: "Full object content (expensive - only fetched when selected)" })
    async content(
        @Parent() parent: GqlResource,
        @Context() ctx: GqlContext
    ): Promise<GqlObjectContent | null> {
        const obj = await ctx.loaders.contentLoader.load(parent.uri);
        if (!obj) return null;
        return {
            uri: parent.uri,
            dataObjectType: parent.dataObjectType,
            data: obj  // Pass by reference - no serialization
        };
    }

    @ResolveField(() => [GqlArrayMeta], { description: "Array metadata for this resource (no array data)" })
    async arrays(
        @Parent() parent: GqlResource,
        @Context() ctx: GqlContext
    ): Promise<GqlArrayMeta[]> {
        const metas = await ctx.loaders.arrayMetaLoader.load(parent.uri);
        return metas.map((m: IDataArrayMetadata) => ({
            uri: m.uid.uri,
            pathInResource: m.uid.pathInResource,
            dimensions: m.dimensions ?? undefined,
            logicalArrayType: m.logicalArrayType !== undefined ? String(m.logicalArrayType) : undefined,
            transportArrayType: m.transportArrayType !== undefined ? String(m.transportArrayType) : undefined,
            storeLastWrite: m.storeLastWrite ? m.storeLastWrite.toISOString() : undefined
        }));
    }

    @ResolveField(() => GqlArrayStats, {
        nullable: true,
        description:
            "Server-side statistical summary of one array (count/min/max/mean/" +
            "stddev/sum). Pass `rangeLo`/`rangeHi` for an in-range count, and " +
            "`bins` for a histogram + p10/p50/p90. The array bytes never leave " +
            "the store. Null when the store lacks the STATS extension."
    })
    async stats(
        @Parent() parent: GqlResource,
        @Args("pathInResource") pathInResource: string,
        @Args("rangeLo", { type: () => Float, nullable: true }) rangeLo: number | undefined,
        @Args("rangeHi", { type: () => Float, nullable: true }) rangeHi: number | undefined,
        @Args("bins", { type: () => Int, nullable: true }) bins: number | undefined,
        @Context() ctx: GqlContext
    ): Promise<GqlArrayStats | null> {
        const range =
            rangeLo !== undefined && rangeHi !== undefined
                ? { lo: rangeLo, hi: rangeHi }
                : undefined;
        return ctx.loaders.getArrayStats(parent.uri, pathInResource, range, bins);
    }

    @ResolveField(() => GqlArrayReduce, {
        nullable: true,
        description:
            "Server-side K-axis column reduction of a 3-D property into a 2-D " +
            "[nj, ni] map (net-pay / targeting maps). `op` is sum/mean/min/max/" +
            "count/net; count/net require `rangeLo`/`rangeHi`; `k0`/`k1` limit " +
            "the K-zone; `cellDz` sets net-thickness per cell. Null when the " +
            "store lacks the REDUCE extension."
    })
    async reduce(
        @Parent() parent: GqlResource,
        @Args("pathInResource") pathInResource: string,
        @Args("op", { type: () => String }) op: string,
        @Args("k0", { type: () => Int, nullable: true }) k0: number | undefined,
        @Args("k1", { type: () => Int, nullable: true }) k1: number | undefined,
        @Args("rangeLo", { type: () => Float, nullable: true }) rangeLo: number | undefined,
        @Args("rangeHi", { type: () => Float, nullable: true }) rangeHi: number | undefined,
        @Args("cellDz", { type: () => Float, nullable: true }) cellDz: number | undefined,
        @Context() ctx: GqlContext
    ): Promise<GqlArrayReduce | null> {
        const kRange =
            k0 !== undefined && k1 !== undefined ? { k0, k1 } : undefined;
        const range =
            rangeLo !== undefined && rangeHi !== undefined
                ? { lo: rangeLo, hi: rangeHi }
                : undefined;
        return ctx.loaders.getArrayReduce(
            parent.uri,
            pathInResource,
            op as "sum" | "mean" | "min" | "max" | "count" | "net",
            { kRange, range, cellDz }
        );
    }

    @ResolveField(() => GqlArrayWhere, {
        nullable: true,
        description:
            "Server-side masked predicate over one array: count + ijk bbox + " +
            "centroid (aim point) of cells whose value is in `[rangeLo, rangeHi]`." +
            " Null when the store lacks the WHERE extension."
    })
    async where(
        @Parent() parent: GqlResource,
        @Args("pathInResource") pathInResource: string,
        @Args("rangeLo", { type: () => Float }) rangeLo: number,
        @Args("rangeHi", { type: () => Float }) rangeHi: number,
        @Context() ctx: GqlContext
    ): Promise<GqlArrayWhere | null> {
        return ctx.loaders.getArrayWhere(parent.uri, pathInResource, {
            lo: rangeLo,
            hi: rangeHi
        });
    }
}
