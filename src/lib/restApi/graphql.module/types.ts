/**
 * GraphQL object types for the Reservoir DMS API.
 *
 * Design: types are thin wrappers that hold references to the underlying
 * ETP Resource / IResqmlDataObject data — no deep copies. Fields that
 * require additional ETP calls (content, arrays, targets, sources) are
 * resolved lazily by the resolver layer.
 */
import { Field, ObjectType, Int, ID } from "@nestjs/graphql";
import GraphQLJSON from "./scalars/json.scalar";

// ---------------------------------------------------------------------------
// Dataspace
// ---------------------------------------------------------------------------

@ObjectType({ description: "An ETP dataspace (namespace for resources)" })
export class GqlDataspace {
    @Field(() => ID)
    uri!: string;

    @Field()
    name!: string;

    @Field({ nullable: true })
    storeLastWrite?: string;

    @Field({ nullable: true })
    storeCreated?: string;
}

// ---------------------------------------------------------------------------
// Resource (lightweight metadata — no content fetch)
// ---------------------------------------------------------------------------

@ObjectType({ description: "A resource node in the ETP graph" })
export class GqlResource {
    @Field(() => ID)
    uri!: string;

    @Field()
    name!: string;

    @Field({ nullable: true })
    dataObjectType?: string;

    @Field(() => Int, { nullable: true })
    sourceCount?: number;

    @Field(() => Int, { nullable: true })
    targetCount?: number;

    @Field({ nullable: true })
    lastChanged?: string;

    @Field({ nullable: true })
    storeLastWrite?: string;

    @Field({ nullable: true })
    activeStatus?: string;

    // Resolved lazily by ResourceResolver
    // targets: GqlResource[]
    // sources: GqlResource[]
    // content: JSON
    // arrays: GqlArrayMeta[]
}

// ---------------------------------------------------------------------------
// Edge (link between two resources)
// ---------------------------------------------------------------------------

@ObjectType({ description: "A directed edge in the resource graph" })
export class GqlEdge {
    @Field()
    sourceUri!: string;

    @Field()
    targetUri!: string;

    @Field({ nullable: true })
    path?: string;
}

// ---------------------------------------------------------------------------
// Graph result (batch traversal)
// ---------------------------------------------------------------------------

@ObjectType({ description: "A merged subgraph from batch graph search" })
export class GqlGraph {
    @Field(() => [GqlResource])
    resources!: GqlResource[];

    @Field(() => [GqlEdge])
    edges!: GqlEdge[];
}

// ---------------------------------------------------------------------------
// Array metadata (no data payload)
// ---------------------------------------------------------------------------

@ObjectType({ description: "Metadata for a data array stored in ETP" })
export class GqlArrayMeta {
    @Field()
    uri!: string;

    @Field()
    pathInResource!: string;

    @Field(() => [Int], { nullable: true })
    dimensions?: number[];

    @Field({ nullable: true })
    logicalArrayType?: string;

    @Field({ nullable: true })
    transportArrayType?: string;

    @Field({ nullable: true })
    storeLastWrite?: string;
}

// ---------------------------------------------------------------------------
// Object content (resolved JSON — returned as opaque JSON scalar)
// ---------------------------------------------------------------------------

@ObjectType({ description: "Full resolved object content" })
export class GqlObjectContent {
    @Field(() => ID)
    uri!: string;

    @Field({ nullable: true })
    dataObjectType?: string;

    @Field(() => GraphQLJSON, { nullable: true, description: "Parsed EML/RESQML/WITSML object as JSON (no array data)" })
    data?: unknown;
}
