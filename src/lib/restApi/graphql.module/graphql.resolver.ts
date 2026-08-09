/**
 * GraphQL resolvers for Reservoir DMS.
 *
 * Performance design:
 *  - ETP Resource objects are passed by reference as parent — no copying.
 *  - BigInt timestamps are converted to ISO strings only at serialization.
 *  - DataLoader batches all same-tick requests into single ETP sessions.
 *  - `content` and `arrays` fields are lazy — no ETP Store/DataArray calls
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
    Info,
    Int
} from "@nestjs/graphql";
import { GraphQLResolveInfo } from "graphql";

import { GqlDataspace, GqlResource, GqlEdge, GqlGraph, GqlArrayMeta, GqlObjectContent } from "./types";
import GraphQLJSON from "./scalars/json.scalar";
import { GqlContext, EtpLoaders } from "./context";
import { Resource, Dataspace, IDataArrayMetadata } from "../../common/EtpTypes";
import { EtpUri } from "../../common/EtpUri";

// ---------------------------------------------------------------------------
// Helpers — zero-copy conversions (return references, not new objects)
// ---------------------------------------------------------------------------

/** Convert ETP BigInt timestamp (microseconds since epoch) to ISO string */
const bigintToIso = (v: bigint | undefined | null): string | undefined => {
    if (v === undefined || v === null || v === BigInt(0)) return undefined;
    // ETP timestamps are in microseconds
    return new Date(Number(v / BigInt(1000))).toISOString();
};

/** Extract dataObjectType from an ETP URI without allocating a full EtpUri parse */
const typeFromUri = (uri: string): string | undefined => {
    // eml:///dataspace('...')/resqml20.IjkGridRepresentation(uuid)
    const slash = uri.lastIndexOf("/");
    if (slash < 0) return undefined;
    const afterSlash = uri.substring(slash + 1);
    const paren = afterSlash.indexOf("(");
    return paren > 0 ? afterSlash.substring(0, paren) : afterSlash;
};

/** Map an ETP Resource to our GqlResource shape — by reference where possible */
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
        @Args("depth", { type: () => Int, nullable: true, defaultValue: 1 }) depth: number,
        @Context() ctx: GqlContext
    ): Promise<GqlGraph> {
        // Load graphs for all URIs (DataLoader deduplicates)
        const graphs = await Promise.all(uris.map(uri => ctx.loaders.graphLoader.load(uri)));

        // Merge — deduplicate by URI key
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
                    allEdges.push({ sourceUri: edge.sourceUri, targetUri: edge.targetUri, path: edge.path });
                }
            }
        }

        return {
            resources: [...allNodes.values()].map(mapResource),
            edges: allEdges
        };
    }
}

// ---------------------------------------------------------------------------
// Resource field resolvers (lazy — only called when client selects the field)
// ---------------------------------------------------------------------------

@Resolver(() => GqlResource)
export class ResourceFieldResolver {
    @ResolveField(() => [GqlResource], { description: "Target resources in the graph (lazy)" })
    async targets(
        @Parent() parent: GqlResource,
        @Args("depth", { type: () => Int, nullable: true, defaultValue: 1 }) _depth: number,
        @Context() ctx: GqlContext
    ): Promise<GqlResource[]> {
        const graph = await ctx.loaders.graphLoader.load(parent.uri);
        const targetUris = graph.getTargetMap().get(parent.uri) ?? [];
        // Return resources already in the graph — no additional ETP calls
        return targetUris
            .map(uri => graph.get(uri))
            .filter((r): r is Resource => r !== undefined)
            .map(mapResource);
    }

    @ResolveField(() => [GqlResource], { description: "Source resources in the graph (lazy)" })
    async sources(
        @Parent() parent: GqlResource,
        @Context() ctx: GqlContext
    ): Promise<GqlResource[]> {
        const graph = await ctx.loaders.sourceGraphLoader.load(parent.uri);
        const sourceUris = graph.getSourceMap().get(parent.uri) ?? [];
        return sourceUris
            .map(uri => graph.get(uri))
            .filter((r): r is Resource => r !== undefined)
            .map(mapResource);
    }

    @ResolveField(() => GqlObjectContent, { nullable: true, description: "Full object content (expensive — only fetched when selected)" })
    async content(
        @Parent() parent: GqlResource,
        @Context() ctx: GqlContext
    ): Promise<GqlObjectContent | null> {
        const obj = await ctx.loaders.contentLoader.load(parent.uri);
        if (!obj) return null;
        return {
            uri: parent.uri,
            dataObjectType: parent.dataObjectType,
            data: obj  // Pass by reference — no serialization
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
}
