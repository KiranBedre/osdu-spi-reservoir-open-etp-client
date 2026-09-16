import "jest";

import {
    dataObjectClassToken,
    edgePredicateName,
    graphToJsonLd,
    graphToNTriples,
    graphToTurtle,
    negotiateRdf,
    parseEtpUri,
    rdfFormatFromParam,
    resolveRdfFormat,
    serializeGraph,
    type RdfGraph
} from "../lib/restApi/read-etp.module/RdfSerialization";

// Verifies the RDF (Turtle / JSON-LD) serialization of the ETP relationship
// graph exposed by GET /dataspaces/{id}/resources/all?edges=true and the
// deprecated /graph/all route. See src/lib/restApi/read-etp.module/RdfSerialization.ts.

const uriA =
    "eml:///dataspace('demo/Volve')/resqml20.obj_TriangulatedSetRepresentation(a3f31b20-c93a-4682-8f6c-71be087202a4)";
const uriB =
    "eml:///dataspace('demo/Volve')/resqml20.obj_LocalDepth3dCrs(b1111111-2222-3333-4444-555555555555)";

const graph: RdfGraph = {
    resources: [
        {
            uri: uriA,
            name: "Depth_Hugin_Fm_Top_t",
            activeStatus: "Active",
            sourceCount: 0,
            targetCount: 1,
            storeCreated: new Date("2021-09-14T20:25:17.128Z"),
            storeLastWrite: new Date("2021-09-14T20:26:16.128Z"),
            lastChanged: new Date("2021-09-06T16:06:31.000Z")
        },
        {
            uri: uriB,
            name: "LocalDepth3dCrs",
            activeStatus: "Active"
        }
    ],
    links: [{ source: uriA, target: uriB, path: "rsq22:LocalCrs" }]
};

describe("negotiateRdf", () => {
    it("returns undefined for missing or JSON Accept headers", () => {
        expect(negotiateRdf(undefined)).toBeUndefined();
        expect(negotiateRdf("application/json")).toBeUndefined();
        expect(negotiateRdf("*/*")).toBeUndefined();
    });

    it("detects Turtle and JSON-LD", () => {
        expect(negotiateRdf("text/turtle")).toBe("turtle");
        expect(negotiateRdf("application/ld+json")).toBe("jsonld");
    });

    it("prefers JSON-LD when both are offered", () => {
        expect(negotiateRdf("text/turtle, application/ld+json")).toBe("jsonld");
    });

    it("detects N-Triples", () => {
        expect(negotiateRdf("application/n-triples")).toBe("ntriples");
    });
});

describe("rdfFormatFromParam / resolveRdfFormat", () => {
    it("maps explicit format values and aliases", () => {
        expect(rdfFormatFromParam("turtle")).toBe("turtle");
        expect(rdfFormatFromParam("ttl")).toBe("turtle");
        expect(rdfFormatFromParam("json-ld")).toBe("jsonld");
        expect(rdfFormatFromParam("nt")).toBe("ntriples");
        expect(rdfFormatFromParam("xml")).toBeUndefined();
        expect(rdfFormatFromParam(undefined)).toBeUndefined();
    });

    it("lets an explicit ?format override the Accept header", () => {
        expect(resolveRdfFormat("application/json", "turtle")).toBe("turtle");
        expect(resolveRdfFormat("text/turtle", undefined)).toBe("turtle");
        expect(resolveRdfFormat("application/json", undefined)).toBeUndefined();
    });
});

describe("parseEtpUri", () => {
    it("extracts the dataspace path and object uuid", () => {
        expect(parseEtpUri(uriA)).toEqual({
            dataspace: "demo/Volve",
            uuid: "a3f31b20-c93a-4682-8f6c-71be087202a4",
            version: undefined
        });
    });

    it("returns an empty object for a non-ETP string", () => {
        expect(parseEtpUri("not-a-uri")).toEqual({});
    });
});

describe("edgePredicateName", () => {
    it("derives a camelCase predicate from the last path segment", () => {
        expect(
            edgePredicateName("rsq22:Geometry/rsq22:SupportingRepresentation")
        ).toBe("supportingRepresentation");
        expect(edgePredicateName("rsq22:LocalCrs")).toBe("localCrs");
    });

    it("returns undefined when no usable name can be derived", () => {
        expect(edgePredicateName(undefined)).toBeUndefined();
        expect(edgePredicateName("")).toBeUndefined();
        expect(edgePredicateName("123")).toBeUndefined();
    });
});

describe("dataObjectClassToken", () => {
    it("extracts family+version.Type and strips obj_", () => {
        expect(dataObjectClassToken(uriA)).toBe(
            "resqml20.TriangulatedSetRepresentation"
        );
    });

    it("returns undefined for a non-object (dataspace) URI", () => {
        expect(
            dataObjectClassToken("eml:///dataspace('demo/Volve')")
        ).toBeUndefined();
    });
});

describe("graphToTurtle", () => {
    const ttl = graphToTurtle(graph);

    it("emits prefixes", () => {
        expect(ttl).toContain("@prefix rddms: <https://rddms.opengroup.org/ontology#> .");
        expect(ttl).toContain("@prefix rddmst: <https://rddms.opengroup.org/type#> .");
    });

    it("uses the ETP URI verbatim as the subject", () => {
        expect(ttl).toContain(`<${uriA}>`);
    });

    it("types the node with its data-object class", () => {
        expect(ttl).toContain("a rddmst:resqml20.TriangulatedSetRepresentation");
    });

    it("emits the label and typed timestamps", () => {
        expect(ttl).toContain('rdfs:label "Depth_Hugin_Fm_Top_t"');
        expect(ttl).toContain(
            'dcterms:created "2021-09-14T20:25:17.128Z"^^xsd:dateTime'
        );
        expect(ttl).toContain(
            'dcterms:modified "2021-09-14T20:26:16.128Z"^^xsd:dateTime'
        );
    });

    it("emits the reference edge", () => {
        expect(ttl).toContain(`rddms:references <${uriB}>`);
    });

    it("emits richer node terms parsed from the URI", () => {
        expect(ttl).toContain('rddms:dataspace "demo/Volve"');
        expect(ttl).toContain(
            'rddms:uuid "a3f31b20-c93a-4682-8f6c-71be087202a4"'
        );
    });

    it("emits a typed predicate derived from the edge path", () => {
        expect(ttl).toContain(`rddms:localCrs <${uriB}>`);
    });
});

describe("graphToJsonLd", () => {
    const doc = graphToJsonLd(graph) as {
        "@context": Record<string, unknown>;
        "@graph": Array<Record<string, unknown>>;
    };

    it("includes the reusable @context", () => {
        expect(doc["@context"]).toMatchObject({
            rddms: "https://rddms.opengroup.org/ontology#",
            references: { "@id": "rddms:references", "@type": "@id" }
        });
    });

    it("emits one node per resource with @id and @type", () => {
        expect(doc["@graph"]).toHaveLength(2);
        expect(doc["@graph"][0]).toMatchObject({
            "@id": uriA,
            "@type": "rddmst:resqml20.TriangulatedSetRepresentation",
            name: "Depth_Hugin_Fm_Top_t",
            references: [uriB]
        });
    });

    it("omits references when a node has no outgoing edges", () => {
        expect(doc["@graph"][1]).not.toHaveProperty("references");
    });

    it("emits richer node terms and a typed predicate", () => {
        expect(doc["@graph"][0]).toMatchObject({
            dataspace: "demo/Volve",
            uuid: "a3f31b20-c93a-4682-8f6c-71be087202a4",
            "rddms:localCrs": [{ "@id": uriB }]
        });
    });
});

describe("graphToNTriples", () => {
    const nt = graphToNTriples(graph);

    it("emits full-IRI type and label triples terminated by ' .'", () => {
        expect(nt).toContain(
            `<${uriA}> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://rddms.opengroup.org/type#resqml20.TriangulatedSetRepresentation> .`
        );
        expect(nt).toContain(
            `<${uriA}> <http://www.w3.org/2000/01/rdf-schema#label> "Depth_Hugin_Fm_Top_t" .`
        );
    });

    it("emits the generic and typed reference triples", () => {
        expect(nt).toContain(
            `<${uriA}> <https://rddms.opengroup.org/ontology#references> <${uriB}> .`
        );
        expect(nt).toContain(
            `<${uriA}> <https://rddms.opengroup.org/ontology#localCrs> <${uriB}> .`
        );
    });

    it("ends every line with a full stop", () => {
        for (const line of nt.split("\n").filter(Boolean)) {
            expect(line.endsWith(" .")).toBe(true);
        }
    });
});

describe("serializeGraph", () => {
    it("returns the correct content type per format", () => {
        expect(serializeGraph(graph, "turtle").contentType).toBe("text/turtle");
        expect(serializeGraph(graph, "jsonld").contentType).toBe(
            "application/ld+json"
        );
        expect(serializeGraph(graph, "ntriples").contentType).toBe(
            "application/n-triples"
        );
    });

    it("returns a string body for text formats and an object for JSON-LD", () => {
        expect(typeof serializeGraph(graph, "turtle").body).toBe("string");
        expect(typeof serializeGraph(graph, "ntriples").body).toBe("string");
        expect(typeof serializeGraph(graph, "jsonld").body).toBe("object");
    });
});
