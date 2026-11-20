// ============================================================================
// Copyright 2024-2026 Equinor ASA. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ============================================================================
//
// Unit, engine and regression tests for the read-only openCypher endpoint
// (POST /cypher). Covers:
//   1. Parser  - grammar, parameters, aliases, and rejection of writes/unsupported
//      clauses with descriptive errors.
//   2. Engine  - label/role matching, direction, variable-length paths, WHERE
//      predicates, projections, DISTINCT, SKIP/LIMIT and safety caps.
//   3. Regression - the canonical RESQML connectivity queries from the design
//      discussion (grid properties, 5-hop neighbourhood, wells-intersecting-grid,
//      reserve-estimate lineage) evaluated against a synthetic reservoir graph.
// ============================================================================

import "jest";

import { Resource } from "../lib/common/EtpTypes";
import { ResourceGraph, Edge } from "../lib/common/ResponseHandlers";
import {
    parseCypher,
    CypherSyntaxError
} from "../lib/restApi/cypher.module/CypherParser";
import {
    CypherEngine,
    MAX_CYPHER_HOPS
} from "../lib/restApi/cypher.module/CypherEngine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DS = "eml:///dataspace('demo')";

/** Build a RESQML-style resource URI. */
const uri = (type: string, id: string): string => `${DS}/${type}(${id})`;

const node = (type: string, id: string, name: string): Resource =>
    ({
        uri: uri(type, id),
        name,
        sourceCount: 0,
        targetCount: 0
    } as unknown as Resource);

/** Edge with an explicit DOR `path` so the inferred role is deterministic. */
const edge = (source: string, target: string, path: string): Edge =>
    ({ sourceUri: source, targetUri: target, path } as Edge);

/**
 * Synthetic reservoir graph mirroring the design-discussion example:
 *
 *   Grid --HAS_PROPERTY--> Porosity, Permeability
 *   Grid --CONTAINS------> Cell
 *   Grid --INTERPRETED_BY-> Horizon --PART_OF--> StructuralModel
 *   WellboreTrajectory --INTERSECTS--> Grid
 *   Realization --INPUT_TO--> ReserveEstimate   (lineage chain)
 *   SimulationCase --INPUT_TO--> Realization
 */
function reservoirGraph(): ResourceGraph {
    const nodes: Resource[] = [
        node("test.Grid", "g1", "Drogon Grid"),
        node("test.Cell", "c1", "Cell 1"),
        node("test.Porosity", "p1", "Porosity"),
        node("test.Permeability", "p2", "Permeability"),
        node("test.Horizon", "h1", "Top Volon"),
        node("test.StructuralModel", "m1", "Drogon Model"),
        node("test.WellboreTrajectory", "w1", "A-1 Trajectory"),
        node("test.WellboreTrajectory", "w2", "A-2 Trajectory"),
        node("test.ReserveEstimate", "r1", "STOIIP 2026"),
        node("test.Realization", "z1", "Realization 42"),
        node("test.SimulationCase", "s1", "Sim Case X")
    ];
    const g = uri("test.Grid", "g1");
    const edges: Edge[] = [
        edge(g, uri("test.Porosity", "p1"), "HasProperty"),
        edge(g, uri("test.Permeability", "p2"), "HasProperty"),
        edge(g, uri("test.Cell", "c1"), "Contains"),
        edge(g, uri("test.Horizon", "h1"), "InterpretedBy"),
        edge(uri("test.Horizon", "h1"), uri("test.StructuralModel", "m1"), "PartOf"),
        edge(uri("test.WellboreTrajectory", "w1"), g, "Intersects"),
        edge(uri("test.WellboreTrajectory", "w2"), g, "Intersects"),
        edge(uri("test.Realization", "z1"), uri("test.ReserveEstimate", "r1"), "InputTo"),
        edge(uri("test.SimulationCase", "s1"), uri("test.Realization", "z1"), "InputTo")
    ];
    return new ResourceGraph(nodes, edges);
}

/** Run a query against the reservoir graph and return the raw result. */
function run(query: string, params: Record<string, string | number> = {}) {
    const engine = new CypherEngine(reservoirGraph());
    return engine.run(parseCypher(query, params));
}

/** Collect a single-column result as an array of node names. */
function names(query: string, col: string, params = {}): string[] {
    const r = run(query, params);
    const i = r.columns.indexOf(col);
    return r.rows
        .map(row => row[i] as { name?: string } | null)
        .map(v => (v && v.name) || "")
        .sort();
}

// ===========================================================================
// 1. Parser
// ===========================================================================

describe("CypherParser", () => {
    it("parses a simple labelled match with inline properties", () => {
        const q = parseCypher("MATCH (g:Grid {id: $gid}) RETURN g", { gid: "x" });
        expect(q.pattern.nodes).toHaveLength(1);
        expect(q.pattern.nodes[0].label).toBe("Grid");
        expect(q.pattern.nodes[0].variable).toBe("g");
        expect(q.pattern.nodes[0].properties).toEqual({ id: "x" });
        expect(q.returnItems[0].alias).toBe("g");
    });

    it("parses relationship direction and types", () => {
        const q = parseCypher("MATCH (a)-[:R1|R2]->(b) RETURN b");
        expect(q.pattern.rels[0].direction).toBe("out");
        expect(q.pattern.rels[0].types).toEqual(["R1", "R2"]);
    });

    it("parses left-directed relationships", () => {
        const q = parseCypher("MATCH (a)<-[:X]-(b) RETURN a");
        expect(q.pattern.rels[0].direction).toBe("in");
    });

    it("parses undirected relationships", () => {
        const q = parseCypher("MATCH (a)-[:X]-(b) RETURN a");
        expect(q.pattern.rels[0].direction).toBe("both");
    });

    it("parses variable-length bounds", () => {
        const q = parseCypher("MATCH (a)-[*2..7]-(b) RETURN b");
        const r = q.pattern.rels[0];
        expect(r.varLength).toBe(true);
        expect(r.minHops).toBe(2);
        expect(r.maxHops).toBe(7);
    });

    it("treats open-ended * as 1..Infinity", () => {
        const q = parseCypher("MATCH (a)-[*]-(b) RETURN b");
        expect(q.pattern.rels[0].minHops).toBe(1);
        expect(q.pattern.rels[0].maxHops).toBe(Infinity);
    });

    it("parses a path variable", () => {
        const q = parseCypher("MATCH p = (a)-[*1..3]-(b) RETURN p");
        expect(q.pattern.pathVariable).toBe("p");
    });

    it("parses RETURN aliases and property projections", () => {
        const q = parseCypher("MATCH (g) RETURN g.name AS title, g.uri");
        expect(q.returnItems[0]).toMatchObject({ variable: "g", property: "name", alias: "title" });
        expect(q.returnItems[1]).toMatchObject({ variable: "g", property: "uri", alias: "g.uri" });
    });

    it("parses DISTINCT, SKIP and LIMIT", () => {
        const q = parseCypher("MATCH (g) RETURN DISTINCT g SKIP 2 LIMIT 5");
        expect(q.distinct).toBe(true);
        expect(q.skip).toBe(2);
        expect(q.limit).toBe(5);
    });

    it("parses a boolean WHERE with string predicates", () => {
        const q = parseCypher(
            'MATCH (g) WHERE g.name CONTAINS "Drogon" AND g.type STARTS WITH "test" RETURN g'
        );
        expect(q.where?.kind).toBe("and");
    });

    it("substitutes $-parameters", () => {
        const q = parseCypher("MATCH (g {id: $id}) RETURN g", { id: 42 });
        expect(q.pattern.nodes[0].properties.id).toBe(42);
    });

    it("throws on a missing parameter", () => {
        expect(() => parseCypher("MATCH (g {id: $missing}) RETURN g")).toThrow(
            CypherSyntaxError
        );
    });

    it.each([
        "CREATE (n) RETURN n",
        "MATCH (n) SET n.x = 1 RETURN n",
        "MATCH (n) DELETE n",
        "MERGE (n) RETURN n",
        "MATCH (a) WITH a RETURN a",
        "UNWIND [1,2] AS x RETURN x",
        "CALL db.labels() YIELD label RETURN label"
    ])("rejects unsupported/write clause: %s", q => {
        expect(() => parseCypher(q)).toThrow(CypherSyntaxError);
    });

    it("rejects OPTIONAL MATCH", () => {
        expect(() => parseCypher("OPTIONAL MATCH (n) RETURN n")).toThrow(CypherSyntaxError);
    });

    it("requires a RETURN clause", () => {
        expect(() => parseCypher("MATCH (n)")).toThrow(/RETURN/);
    });

    it("reports a character position on syntax error", () => {
        try {
            parseCypher("MATCH (n RETURN n");
            fail("expected throw");
        } catch (e) {
            expect(e).toBeInstanceOf(CypherSyntaxError);
            expect(typeof (e as CypherSyntaxError).position).toBe("number");
        }
    });

    it("does not confuse STARTS WITH / ENDS WITH with the WITH clause", () => {
        expect(() =>
            parseCypher('MATCH (g) WHERE g.name ENDS WITH "x" RETURN g')
        ).not.toThrow();
    });
});

// ===========================================================================
// 2. Engine
// ===========================================================================

describe("CypherEngine", () => {
    it("matches all nodes of a label", () => {
        const got = names("MATCH (w:WellboreTrajectory) RETURN w", "w");
        expect(got).toEqual(["A-1 Trajectory", "A-2 Trajectory"]);
    });

    it("matches a fully-qualified label", () => {
        const got = names("MATCH (g:`test.Grid`) RETURN g", "g");
        expect(got).toEqual(["Drogon Grid"]);
    });

    it("filters by inline id property", () => {
        const got = names("MATCH (g:Grid {id: 'g1'}) RETURN g", "g");
        expect(got).toEqual(["Drogon Grid"]);
    });

    it("follows an outgoing typed relationship", () => {
        const got = names(
            "MATCH (g:Grid)-[:HAS_PROPERTY]->(p) RETURN p",
            "p"
        );
        expect(got).toEqual(["Permeability", "Porosity"]);
    });

    it("follows an incoming typed relationship", () => {
        const got = names(
            "MATCH (g:Grid)<-[:INTERSECTS]-(w) RETURN w",
            "w"
        );
        expect(got).toEqual(["A-1 Trajectory", "A-2 Trajectory"]);
    });

    it("treats undirected relationships symmetrically", () => {
        const got = names("MATCH (p:Porosity)-[:HAS_PROPERTY]-(g) RETURN g", "g");
        expect(got).toEqual(["Drogon Grid"]);
    });

    it("resolves relationship-type synonyms (INTERPRETED_BY)", () => {
        const got = names(
            "MATCH (g:Grid)-[:INTERPRETED_BY]->(h) RETURN h",
            "h"
        );
        expect(got).toEqual(["Top Volon"]);
    });

    it("evaluates WHERE comparisons and string predicates", () => {
        const got = names(
            'MATCH (n) WHERE n.name CONTAINS "Trajectory" RETURN n',
            "n"
        );
        expect(got).toEqual(["A-1 Trajectory", "A-2 Trajectory"]);
    });

    it("evaluates AND / OR / NOT", () => {
        const got = names(
            'MATCH (n) WHERE n.name STARTS WITH "A-1" OR n.name STARTS WITH "A-2" RETURN n',
            "n"
        );
        expect(got).toEqual(["A-1 Trajectory", "A-2 Trajectory"]);
    });

    it("projects scalar properties with aliases", () => {
        const r = run("MATCH (g:Grid)-[:HAS_PROPERTY]->(p) RETURN g.name AS grid, p.name AS prop");
        expect(r.columns).toEqual(["grid", "prop"]);
        const props = r.rows.map(row => row[1]).sort();
        expect(props).toEqual(["Permeability", "Porosity"]);
    });

    it("applies DISTINCT", () => {
        const r = run("MATCH (g:Grid)-[:HAS_PROPERTY]->(p) RETURN DISTINCT g.name AS grid");
        expect(r.rows).toHaveLength(1);
    });

    it("applies SKIP and LIMIT", () => {
        const r = run("MATCH (n) RETURN n.name AS name LIMIT 3");
        expect(r.rows).toHaveLength(3);
        expect(r.stats.rowsBeforeLimit).toBeGreaterThan(3);
    });

    it("returns a path variable with full node sequence", () => {
        const r = run("MATCH p = (w:WellboreTrajectory {id:'w1'})-[*1..3]-(m:StructuralModel) RETURN p");
        expect(r.rows).toHaveLength(1);
        const path = r.rows[0][0] as { length: number; nodes: Array<{ name: string }> };
        expect(path.length).toBe(3);
        expect(path.nodes.map(n => n.name)).toEqual([
            "A-1 Trajectory",
            "Drogon Grid",
            "Top Volon",
            "Drogon Model"
        ]);
    });

    it("reports scan statistics", () => {
        const r = run("MATCH (g:Grid) RETURN g");
        expect(r.stats.nodesScanned).toBe(11);
        expect(r.stats.edges).toBe(9);
    });

    it("caps variable-length traversal at MAX_CYPHER_HOPS", () => {
        const q = parseCypher("MATCH (a)-[*1..999]-(b) RETURN b");
        expect(CypherEngine.requiredDepth(q)).toBe(MAX_CYPHER_HOPS);
    });

    it("expands a node variable to a structured view", () => {
        const r = run("MATCH (g:Grid {id:'g1'}) RETURN g");
        const g = r.rows[0][0] as Record<string, unknown>;
        expect(g).toMatchObject({ id: "g1", name: "Drogon Grid", type: "test.Grid" });
        expect(String(g.uri)).toContain("test.Grid(g1)");
    });
});

// ===========================================================================
// 3. Regression - canonical RESQML connectivity queries
// ===========================================================================

describe("Cypher regression (RESQML connectivity)", () => {
    it("finds all properties attached to a grid", () => {
        // MATCH (g:Grid {id:$gridid})-[:HAS_PROPERTY]->(p) RETURN p
        const got = names(
            "MATCH (g:Grid {id: $gridid})-[:HAS_PROPERTY]->(p) RETURN p",
            "p",
            { gridid: "g1" }
        );
        expect(got).toEqual(["Permeability", "Porosity"]);
    });

    it("finds every object within 5 hops of a grid", () => {
        // MATCH p=(g:Grid {id:$gridid})-[*1..5]-(x) RETURN x
        const r = run(
            "MATCH (g:Grid {id: $gridid})-[*1..5]-(x) RETURN DISTINCT x.name AS name",
            { gridid: "g1" }
        );
        const reached = r.rows.map(row => row[0]).sort();
        // Everything connected to the grid within 5 hops.
        expect(reached).toEqual(
            [
                "A-1 Trajectory",
                "A-2 Trajectory",
                "Cell 1",
                "Drogon Model",
                "Permeability",
                "Porosity",
                "Top Volon"
            ].sort()
        );
    });

    it("finds wells intersecting grids belonging to a structural model", () => {
        // MATCH (model:StructuralModel)<-[:PART_OF]-(h:Horizon)
        //       <-[:INTERPRETED_BY]-(g:Grid)<-[:INTERSECTS]-(w:WellboreTrajectory)
        // RETURN w, g
        const r = run(
            "MATCH (model:StructuralModel)<-[:PART_OF]-(h:Horizon)<-[:INTERPRETED_BY]-(g:Grid)<-[:INTERSECTS]-(w:WellboreTrajectory) RETURN w.name AS well, g.name AS grid"
        );
        const wells = r.rows.map(row => row[0]).sort();
        expect(wells).toEqual(["A-1 Trajectory", "A-2 Trajectory"]);
        expect(r.rows.every(row => row[1] === "Drogon Grid")).toBe(true);
    });

    it("walks deep lineage into a reserve estimate", () => {
        // MATCH (reserve:ReserveEstimate {id:$id})<-[:INPUT_TO*1..10]-(obj) RETURN obj
        const got = names(
            "MATCH (reserve:ReserveEstimate {id: $id})<-[:INPUT_TO*1..10]-(obj) RETURN obj",
            "obj",
            { id: "r1" }
        );
        // Both the direct realization and the upstream simulation case.
        expect(got).toEqual(["Realization 42", "Sim Case X"]);
    });

    it("returns an empty result set (not an error) when nothing matches", () => {
        const r = run("MATCH (g:Grid {id: 'nope'})-[:HAS_PROPERTY]->(p) RETURN p");
        expect(r.rows).toEqual([]);
        expect(r.columns).toEqual(["p"]);
    });
});
