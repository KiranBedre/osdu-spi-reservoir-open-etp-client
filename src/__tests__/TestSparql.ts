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
// Unit, engine and regression tests for the read-only SPARQL endpoint
// (POST /sparql). Covers:
//   1. Parser  - query forms, prefixes, property paths, modifiers, and rejection
//      of updates / unsupported constructs with descriptive errors + positions.
//   2. Engine  - SELECT/ASK/CONSTRUCT/DESCRIBE over the same RDF the /rdf/*
//      endpoints publish: BGP joins, FILTER, property paths, DISTINCT, LIMIT/
//      OFFSET and safety caps.
//   3. Regression - canonical RESQML questions (grids by type, properties
//      supporting a grid, variable-length reachability, lineage description)
//      evaluated against a synthetic reservoir graph.
// ============================================================================

import "jest";

import { Resource } from "../lib/common/EtpTypes";
import { ResourceGraph, Edge } from "../lib/common/ResponseHandlers";
import {
    parseSparql,
    SparqlSyntaxError
} from "../lib/restApi/sparql.module/SparqlParser";
import {
    SparqlEngine,
    SparqlSelectResult,
    SparqlAskResult,
    SparqlGraphResult,
    MAX_SPARQL_HOPS
} from "../lib/restApi/sparql.module/SparqlEngine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DS = "eml:///dataspace('demo')";

/** Build a RESQML object URI with a real UUID so the RDF projector types it. */
const uri = (type: string, uuid: string): string =>
    `${DS}/resqml20.obj_${type}(${uuid})`;

const U = {
    grid: "0c8a1e2f-3b7d-4e56-9a81-2f6c4b0d9e73",
    poro: "11111111-1111-4111-8111-111111111111",
    perm: "22222222-2222-4222-8222-222222222222",
    interp: "33333333-3333-4333-8333-333333333333",
    feature: "44444444-4444-4444-8444-444444444444"
};

const node = (type: string, uuid: string, name: string): Resource =>
    ({
        uri: uri(type, uuid),
        name,
        sourceCount: 0,
        targetCount: 0
    } as unknown as Resource);

/** Edge with an explicit DOR `path`, so a role-specific predicate is emitted. */
const edge = (source: string, target: string, path: string): Edge =>
    ({ sourceUri: source, targetUri: target, path } as Edge);

const GRID = uri("IjkGridRepresentation", U.grid);
const PORO = uri("ContinuousProperty", U.poro);
const PERM = uri("ContinuousProperty", U.perm);
const INTERP = uri("HorizonInterpretation", U.interp);
const FEATURE = uri("BoundaryFeature", U.feature);

/**
 * Synthetic reservoir RDF graph:
 *
 *   Porosity     --SupportingRepresentation--> Grid
 *   Permeability --SupportingRepresentation--> Grid
 *   Grid         --RepresentedInterpretation-> Interpretation
 *   Interpretation --InterpretedFeature------> Feature
 */
function reservoirGraph(): ResourceGraph {
    const nodes: Resource[] = [
        node("IjkGridRepresentation", U.grid, "Drogon Depth Ijk Grid"),
        node("ContinuousProperty", U.poro, "Porosity"),
        node("ContinuousProperty", U.perm, "Permeability"),
        node("HorizonInterpretation", U.interp, "Top Volon"),
        node("BoundaryFeature", U.feature, "Volon Boundary")
    ];
    const edges: Edge[] = [
        edge(PORO, GRID, "SupportingRepresentation"),
        edge(PERM, GRID, "SupportingRepresentation"),
        edge(GRID, INTERP, "RepresentedInterpretation"),
        edge(INTERP, FEATURE, "InterpretedFeature")
    ];
    return new ResourceGraph(nodes, edges);
}

type AnyResult = SparqlSelectResult | SparqlAskResult | SparqlGraphResult;

function run(query: string, format: "json" | "turtle" | "jsonld" = "json"): AnyResult {
    const engine = new SparqlEngine(reservoirGraph());
    return engine.run(parseSparql(query), format) as AnyResult;
}

function select(query: string): SparqlSelectResult {
    const r = run(query);
    expect(r.form).toBe("SELECT");
    return r as SparqlSelectResult;
}

/** Collect one SELECT column's string values, sorted. */
function col(query: string, v: string): string[] {
    return select(query)
        .results.bindings.map(b => b[v]?.value ?? "")
        .sort();
}

// ===========================================================================
// 1. Parser
// ===========================================================================

describe("SparqlParser", () => {
    it("parses a SELECT with default prefixes and a BGP", () => {
        const q = parseSparql(
            "SELECT ?g ?n WHERE { ?g a rddmst:resqml20.IjkGridRepresentation ; rdfs:label ?n }"
        );
        expect(q.form).toBe("SELECT");
        expect(q.vars).toEqual(["g", "n"]);
        expect(q.patterns).toHaveLength(2);
        // `a` expands to rdf:type
        expect(q.patterns[0].p.term).toEqual({
            type: "iri",
            value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
        });
    });

    it("parses SELECT DISTINCT * with LIMIT and OFFSET", () => {
        const q = parseSparql("SELECT DISTINCT * WHERE { ?s ?p ?o } LIMIT 10 OFFSET 5");
        expect(q.distinct).toBe(true);
        expect(q.selectStar).toBe(true);
        expect(q.limit).toBe(10);
        expect(q.offset).toBe(5);
    });

    it("parses ASK, CONSTRUCT and DESCRIBE forms", () => {
        expect(parseSparql("ASK { ?s ?p ?o }").form).toBe("ASK");
        expect(
            parseSparql("CONSTRUCT { ?s rddms:references ?o } WHERE { ?s rddms:references ?o }").form
        ).toBe("CONSTRUCT");
        expect(parseSparql("DESCRIBE <urn:x>").form).toBe("DESCRIBE");
    });

    it("honours a user PREFIX declaration", () => {
        const q = parseSparql("PREFIX ex: <http://example.com/> SELECT ?s WHERE { ?s a ex:Thing }");
        expect(q.patterns[0].o).toEqual({ type: "iri", value: "http://example.com/Thing" });
    });

    it("parses a fixed-predicate property path (references+)", () => {
        const q = parseSparql("SELECT ?x WHERE { ?g rddms:references+ ?x }");
        expect(q.patterns[0].p.path).toBe("+");
    });

    it("parses FILTER with comparisons and functions", () => {
        const q = parseSparql(
            "SELECT ?n WHERE { ?s rdfs:label ?n FILTER(CONTAINS(?n, \"Poro\") && ?n != \"x\") }"
        );
        expect(q.filters).toHaveLength(1);
    });

    it.each([
        "INSERT DATA { <a> <b> <c> }",
        "DELETE WHERE { ?s ?p ?o }",
        "SELECT ?s WHERE { ?s ?p ?o SERVICE <x> { ?s ?p ?o } }",
        "SELECT ?s WHERE { ?s ?p ?o OPTIONAL { ?s ?p ?o } }",
        "SELECT ?s WHERE { { ?s ?p ?o } UNION { ?s ?p ?o } }",
        "SELECT ?s WHERE { ?s ?p ?o BIND(1 AS ?x) }"
    ])("rejects unsupported construct: %s", (query) => {
        expect(() => parseSparql(query)).toThrow(SparqlSyntaxError);
    });

    it("reports a character position on syntax error", () => {
        try {
            parseSparql("SELECT ?s WHERE { ?s ?p");
            fail("expected a syntax error");
        } catch (e) {
            expect(e).toBeInstanceOf(SparqlSyntaxError);
            expect((e as SparqlSyntaxError).position).toBeGreaterThan(0);
        }
    });

    it("rejects an empty query", () => {
        expect(() => parseSparql("   ")).toThrow(SparqlSyntaxError);
        expect(() => parseSparql("")).toThrow(SparqlSyntaxError);
    });

    it("rejects an unknown prefix", () => {
        expect(() => parseSparql("SELECT ?s WHERE { ?s a nope:Thing }")).toThrow(
            /Unknown prefix/
        );
    });
});

// ===========================================================================
// 2. Engine - SELECT
// ===========================================================================

describe("SparqlEngine SELECT", () => {
    it("selects resources by rdf:type class", () => {
        const names = col(
            "SELECT ?n WHERE { ?g a rddmst:resqml20.IjkGridRepresentation ; rdfs:label ?n }",
            "n"
        );
        expect(names).toEqual(["Drogon Depth Ijk Grid"]);
    });

    it("returns W3C SPARQL JSON term shapes (uri vs literal)", () => {
        const r = select(
            "SELECT ?g ?n WHERE { ?g a rddmst:resqml20.IjkGridRepresentation ; rdfs:label ?n }"
        );
        const b = r.results.bindings[0];
        expect(b.g.type).toBe("uri");
        expect(b.g.value).toBe(GRID);
        expect(b.n.type).toBe("literal");
        expect(b.n.value).toBe("Drogon Depth Ijk Grid");
    });

    it("joins across an edge predicate (rddms:references)", () => {
        const names = col(
            "SELECT ?pn WHERE { ?p rddms:references ?g . ?g a rddmst:resqml20.IjkGridRepresentation . ?p rdfs:label ?pn }",
            "pn"
        );
        expect(names).toEqual(["Permeability", "Porosity"]);
    });

    it("matches a role-specific predicate derived from the DOR path", () => {
        const names = col(
            "SELECT ?pn WHERE { ?p rddms:supportingRepresentation ?g . ?p rdfs:label ?pn }",
            "pn"
        );
        expect(names).toEqual(["Permeability", "Porosity"]);
    });

    it("applies FILTER(CONTAINS) on a literal", () => {
        const names = col(
            "SELECT ?n WHERE { ?s rdfs:label ?n FILTER(CONTAINS(?n, \"Poro\")) }",
            "n"
        );
        expect(names).toEqual(["Porosity"]);
    });

    it("applies FILTER regex (case-insensitive)", () => {
        const names = col(
            "SELECT ?n WHERE { ?s rdfs:label ?n FILTER regex(?n, \"^perm\", \"i\") }",
            "n"
        );
        expect(names).toEqual(["Permeability"]);
    });

    it("supports a variable-length property path references+", () => {
        // From any property, references+ reaches Grid then Interpretation then Feature.
        const reached = col(
            "SELECT ?x WHERE { <" + PORO + "> rddms:references+ ?x }",
            "x"
        );
        expect(reached).toEqual([FEATURE, GRID, INTERP].sort());
    });

    it("DISTINCT de-duplicates solutions", () => {
        // Two properties both reference the grid; DISTINCT on the grid yields one.
        const r = select(
            "SELECT DISTINCT ?g WHERE { ?p rddms:references ?g . ?g a rddmst:resqml20.IjkGridRepresentation }"
        );
        expect(r.results.bindings).toHaveLength(1);
    });

    it("applies LIMIT and OFFSET", () => {
        const all = select("SELECT ?s WHERE { ?s a ?t }").results.bindings.length;
        expect(all).toBeGreaterThan(2);
        const limited = select("SELECT ?s WHERE { ?s a ?t } LIMIT 2");
        expect(limited.results.bindings).toHaveLength(2);
        const offset = select("SELECT ?s WHERE { ?s a ?t } OFFSET 2");
        expect(offset.results.bindings.length).toBe(all - 2);
    });

    it("reports stats (triplesScanned, solutions, form)", () => {
        const r = select("SELECT ?s WHERE { ?s a rddmst:resqml20.ContinuousProperty }");
        expect(r.stats.form).toBe("SELECT");
        expect(r.stats.triplesScanned).toBeGreaterThan(0);
        expect(r.stats.solutions).toBe(2);
    });

    it("returns an empty result set (not an error) for no matches", () => {
        const r = select("SELECT ?s WHERE { ?s a rddmst:resqml20.NoSuchType }");
        expect(r.results.bindings).toEqual([]);
    });

    it("caps property-path traversal at MAX_SPARQL_HOPS", () => {
        expect(MAX_SPARQL_HOPS).toBeGreaterThan(0);
        const reached = col("SELECT ?x WHERE { <" + PORO + "> rddms:references* ?x }", "x");
        // `*` includes the start node itself plus the reachable chain.
        expect(reached).toContain(PORO);
        expect(reached).toContain(FEATURE);
    });
});

// ===========================================================================
// 3. Engine - ASK / CONSTRUCT / DESCRIBE
// ===========================================================================

describe("SparqlEngine ASK", () => {
    it("returns true when a pattern matches", () => {
        const r = run("ASK { ?p rddms:references <" + GRID + "> }") as SparqlAskResult;
        expect(r.form).toBe("ASK");
        expect(r.boolean).toBe(true);
    });

    it("returns false when nothing matches", () => {
        const r = run("ASK { ?p rddms:references <urn:absent> }") as SparqlAskResult;
        expect(r.boolean).toBe(false);
    });
});

describe("SparqlEngine CONSTRUCT / DESCRIBE", () => {
    it("CONSTRUCT instantiates the template per solution", () => {
        const r = run(
            "CONSTRUCT { ?g rddms:references ?x } WHERE { ?g a rddmst:resqml20.IjkGridRepresentation ; rddms:references+ ?x }"
        ) as SparqlGraphResult;
        expect(r.form).toBe("CONSTRUCT");
        const targets = r.triples.map(t => t.object.value).sort();
        expect(targets).toEqual([FEATURE, INTERP].sort());
    });

    it("CONSTRUCT can serialize to Turtle via format", () => {
        const r = run(
            "CONSTRUCT { ?g rddms:references ?x } WHERE { ?g a rddmst:resqml20.IjkGridRepresentation ; rddms:references ?x }",
            "turtle"
        ) as SparqlGraphResult;
        expect(typeof r.rdf).toBe("string");
        expect(r.rdf).toContain("rddms:references");
    });

    it("DESCRIBE returns every triple about the subject", () => {
        const r = run("DESCRIBE <" + PORO + ">") as SparqlGraphResult;
        expect(r.form).toBe("DESCRIBE");
        const preds = r.triples.map(t => t.predicate);
        expect(preds).toContain("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
        expect(preds).toContain("http://www.w3.org/2000/01/rdf-schema#label");
        // all triples are about PORO
        expect(r.triples.every(t => t.subject === PORO)).toBe(true);
    });
});

// ===========================================================================
// 4. Regression - canonical RESQML questions
// ===========================================================================

describe("SPARQL regression", () => {
    it("lists properties supporting a grid (by name)", () => {
        const names = col(
            "SELECT ?pn WHERE { ?p rddms:supportingRepresentation ?g . " +
            "?g a rddmst:resqml20.IjkGridRepresentation . ?p rdfs:label ?pn }",
            "pn"
        );
        expect(names).toEqual(["Permeability", "Porosity"]);
    });

    it("walks the interpretation→feature lineage from a grid", () => {
        const feats = col(
            "SELECT ?fn WHERE { ?g rddms:representedInterpretation ?i . " +
            "?i rddms:interpretedFeature ?f . ?f rdfs:label ?fn }",
            "fn"
        );
        expect(feats).toEqual(["Volon Boundary"]);
    });

    it("reaches the whole neighbourhood of a grid via references+", () => {
        const reached = col("SELECT ?x WHERE { <" + GRID + "> rddms:references+ ?x }", "x");
        expect(reached).toEqual([FEATURE, INTERP].sort());
    });
});
