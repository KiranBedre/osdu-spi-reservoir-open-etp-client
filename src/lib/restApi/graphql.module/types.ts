/**
 * GraphQL object types for the Reservoir DMS API.
 *
 * Design: types are thin wrappers that hold references to the underlying
 * ETP Resource / IResqmlDataObject data - no deep copies. Fields that
 * require additional ETP calls (content, arrays, targets, sources) are
 * resolved lazily by the resolver layer.
 */
import { Field, ObjectType, InputType, Int, Float, ID } from "@nestjs/graphql";
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
// Resource (lightweight metadata - no content fetch)
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

    @Field({
        nullable: true,
        description:
            "Semantic relationship role of the edge (the DOR field name on the " +
            "source object, e.g. InterpretedFeature, RepresentedInterpretation, " +
            "SupportingRepresentation). Derived from `path` when the server " +
            "reports it, otherwise inferred from the source/target object types."
    })
    role?: string;
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
// Object content (resolved JSON - returned as opaque JSON scalar)
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

// ---------------------------------------------------------------------------
// Server-side array compute (open-etp-server M28 STATS / REDUCE / WHERE).
// The array bytes never leave the store; only these fixed-size summaries ship.
// ---------------------------------------------------------------------------

@ObjectType({ description: "Server-computed statistical summary of one array (no bytes transferred)" })
export class GqlArrayStats {
    @Field({ description: "false when the array held no finite value" })
    valid!: boolean;

    @Field(() => Int, { description: "finite (non-null) values folded" })
    count!: number;

    @Field(() => Int, { description: "explicit-null + NaN values skipped" })
    nullCount!: number;

    @Field(() => Float, { nullable: true })
    minimum?: number;

    @Field(() => Float, { nullable: true })
    maximum?: number;

    @Field(() => Float, { nullable: true })
    mean?: number;

    @Field(() => Float, { nullable: true, description: "population standard deviation" })
    stddev?: number;

    @Field(() => Float, { nullable: true })
    sum?: number;

    @Field(() => Int, { nullable: true, description: "finite values inside the requested [lo, hi] range" })
    inRangeCount?: number;

    @Field(() => Float, { nullable: true })
    rangeLo?: number;

    @Field(() => Float, { nullable: true })
    rangeHi?: number;

    @Field(() => [Int], { nullable: true, description: "per-bin counts over [histLo, histHi]" })
    histogram?: number[];

    @Field(() => Float, { nullable: true })
    p10?: number;

    @Field(() => Float, { nullable: true })
    p50?: number;

    @Field(() => Float, { nullable: true })
    p90?: number;
}

@ObjectType({ description: "Server-computed K-axis column reduction into a 2-D [nj, ni] map" })
export class GqlArrayReduce {
    @Field({ description: "echoed operator (sum/mean/min/max/count/net)" })
    op!: string;

    @Field(() => Int, { description: "fastest grid axis of the map" })
    ni!: number;

    @Field(() => Int, { description: "middle grid axis of the map" })
    nj!: number;

    @Field(() => Int, { description: "columns that folded at least one value" })
    columns!: number;

    @Field(() => [Float], { description: "row-major [nj, ni] column map" })
    map!: number[];
}

@ObjectType({ description: "Server-computed masked predicate: passing count, ijk bbox, centroid (aim point), and largest connected body" })
export class GqlArrayWhere {
    @Field({ description: "false when no cell satisfied the predicate(s)" })
    valid!: boolean;

    @Field(() => Int, { nullable: true, description: "property arrays ANDed together (multi-criteria only)" })
    arrays?: number;

    @Field(() => Int, { description: "cells satisfying every predicate" })
    count!: number;

    @Field(() => Int, { nullable: true })
    iMin?: number;
    @Field(() => Int, { nullable: true })
    iMax?: number;
    @Field(() => Int, { nullable: true })
    jMin?: number;
    @Field(() => Int, { nullable: true })
    jMax?: number;
    @Field(() => Int, { nullable: true })
    kMin?: number;
    @Field(() => Int, { nullable: true })
    kMax?: number;

    @Field(() => Float, { nullable: true, description: "ijk centroid i of the whole passing set" })
    ci?: number;
    @Field(() => Float, { nullable: true })
    cj?: number;
    @Field(() => Float, { nullable: true })
    ck?: number;

    @Field(() => Int, { nullable: true, description: "separate connected bodies in the passing set" })
    components?: number;
    @Field(() => Int, { nullable: true, description: "cell count of the largest connected body" })
    bodyCount?: number;
    @Field(() => Float, { nullable: true, description: "ijk centroid i of the largest body (drillable aim point)" })
    bci?: number;
    @Field(() => Float, { nullable: true })
    bcj?: number;
    @Field(() => Float, { nullable: true })
    bck?: number;
}

@InputType({ description: "One [lo, hi] predicate over a named array of a resource (multi-criteria targeting)" })
export class GqlWherePredicate {
    @Field(() => ID, { description: "URI of the object owning the array" })
    uri!: string;

    @Field({ description: "path of the array within the object (e.g. points or values path)" })
    pathInResource!: string;

    @Field(() => Float, { description: "inclusive lower bound" })
    lo!: number;

    @Field(() => Float, { description: "inclusive upper bound" })
    hi!: number;
}

@InputType({
    description:
        "A title-matched numeric screen filter. Mirrors the ORES Strawberry " +
        "screen filter (titleContains + operator + threshold); the operator/" +
        "threshold are mapped to an inclusive [lo, hi] range server-side."
})
export class GqlScreenFilter {
    @Field({ description: "case-insensitive substring matched against the property object name" })
    titleContains!: string;

    @Field({ description: "GT | GTE | LT | LTE | EQ (bounds are inclusive)" })
    operator!: string;

    @Field(() => Float)
    threshold!: number;
}
