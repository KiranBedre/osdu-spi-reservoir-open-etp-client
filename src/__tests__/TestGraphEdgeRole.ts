// ============================================================================
// Tests for GraphQL edge-role derivation (issue #172 - align GraphQL graph
// semantics with the REST graph endpoints by surfacing the semantic
// relationship role of each edge).
//
// The server reports a DOR `path` (the XML field name of the
// DataObjectReference on the source object) via ETP relationship customData.
// When present, that field name IS the role. When absent, the role is inferred
// from the source/target object tiers (feature/interpretation/representation).
// ============================================================================

import "jest";

import {
    edgeRole,
    traverseGraph,
    MAX_TRAVERSAL_DEPTH
} from "../lib/restApi/graphql.module/graphql.resolver";
describe("GraphQL edgeRole derivation", () => {
    describe("from server-reported DOR path", () => {
        it("returns the leaf field name verbatim", () => {
            expect(edgeRole("RepresentedInterpretation", undefined, undefined)).toBe(
                "RepresentedInterpretation"
            );
        });

        it("strips leading slashes and keeps the leaf", () => {
            expect(edgeRole("/InterpretedFeature", undefined, undefined)).toBe(
                "InterpretedFeature"
            );
        });

        it("strips XPath indices and namespace prefixes", () => {
            expect(
                edgeRole("obj_X/ns:SupportingRepresentation[2]", undefined, undefined)
            ).toBe("SupportingRepresentation");
        });

        it("prefers the path over the inferred role", () => {
            // Path says InterpretedFeature even though types would infer otherwise.
            expect(
                edgeRole(
                    "InterpretedFeature",
                    "resqml20.IjkGridRepresentation",
                    "resqml20.IjkGridRepresentation"
                )
            ).toBe("InterpretedFeature");
        });
    });

    describe("inferred from source/target tiers (no path)", () => {
        it("interpretation -> feature => InterpretedFeature", () => {
            expect(
                edgeRole(
                    undefined,
                    "resqml20.HorizonInterpretation",
                    "resqml20.BoundaryFeature"
                )
            ).toBe("InterpretedFeature");
        });

        it("representation -> interpretation => RepresentedInterpretation", () => {
            expect(
                edgeRole(
                    undefined,
                    "resqml20.obj_TriangulatedSetRepresentation",
                    "resqml20.HorizonInterpretation"
                )
            ).toBe("RepresentedInterpretation");
        });

        it("representation -> representation => SupportingRepresentation", () => {
            expect(
                edgeRole(
                    undefined,
                    "resqml20.IjkGridRepresentation",
                    "resqml20.obj_TriangulatedSetRepresentation"
                )
            ).toBe("SupportingRepresentation");
        });

        it("property -> representation => SupportingRepresentation", () => {
            expect(
                edgeRole(
                    undefined,
                    "resqml20.ContinuousProperty",
                    "resqml20.IjkGridRepresentation"
                )
            ).toBe("SupportingRepresentation");
        });

        it("returns undefined when either side is unclassifiable", () => {
            expect(edgeRole(undefined, "eml20.EpcExternalPartReference", undefined)).toBeUndefined();
        });
    });
});

describe("GraphQL traverseGraph (depth/scope field-resolver traversal)", () => {
    // a -> b -> c -> d  (linear chain of targets)
    const chain = [
        { sourceUri: "a", targetUri: "b" },
        { sourceUri: "b", targetUri: "c" },
        { sourceUri: "c", targetUri: "d" }
    ];

    it("depth 1 returns only direct targets", () => {
        expect(traverseGraph(chain, "a", "target", 1)).toEqual(["b"]);
    });

    it("depth 2 returns two hops of targets in BFS order", () => {
        expect(traverseGraph(chain, "a", "target", 2)).toEqual(["b", "c"]);
    });

    it("depth 3 reaches the whole chain", () => {
        expect(traverseGraph(chain, "a", "target", 3)).toEqual(["b", "c", "d"]);
    });

    it("traverses sources in the reverse direction", () => {
        expect(traverseGraph(chain, "d", "source", 3)).toEqual(["c", "b", "a"]);
    });

    it("is cycle-guarded (a->b->a does not loop or re-emit the origin)", () => {
        const cyclic = [
            { sourceUri: "a", targetUri: "b" },
            { sourceUri: "b", targetUri: "a" }
        ];
        expect(traverseGraph(cyclic, "a", "target", 10)).toEqual(["b"]);
    });

    it("deduplicates diamond fan-in (b and c both point to d)", () => {
        const diamond = [
            { sourceUri: "a", targetUri: "b" },
            { sourceUri: "a", targetUri: "c" },
            { sourceUri: "b", targetUri: "d" },
            { sourceUri: "c", targetUri: "d" }
        ];
        expect(traverseGraph(diamond, "a", "target", 3)).toEqual(["b", "c", "d"]);
    });

    it("clamps depth to MAX_TRAVERSAL_DEPTH and never exceeds the graph", () => {
        expect(traverseGraph(chain, "a", "target", 999)).toEqual(["b", "c", "d"]);
        expect(MAX_TRAVERSAL_DEPTH).toBe(10);
    });

    it("treats depth <= 0 or NaN as depth 1", () => {
        expect(traverseGraph(chain, "a", "target", 0)).toEqual(["b"]);
        expect(traverseGraph(chain, "a", "target", Number.NaN)).toEqual(["b"]);
    });

    it("returns empty when the start node has no outgoing edges", () => {
        expect(traverseGraph(chain, "d", "target", 5)).toEqual([]);
    });
});
