import "jest";

// Registers the RESQML→OSDU mappings as a side-effect (needed for the
// alignment document).
import "../lib/jsonTypes/ResqmlOsdu";

import {
    EXPORT_MIME_CSV,
    EXPORT_MIME_GRAPHML,
    graphExportFromParam,
    graphToCsv,
    graphToGraphML,
    negotiateGraphExport,
    resolveGraphExportFormat,
    serializeGraphExport
} from "../lib/restApi/read-etp.module/GraphExport";
import type { RdfGraph } from "../lib/restApi/read-etp.module/RdfSerialization";
import {
    documentToJsonLd,
    documentToNTriples,
    documentToTurtle,
    iri,
    lit,
    serializeDocument,
    type RdfDocumentModel
} from "../lib/restApi/read-etp.module/RdfDocument";
import {
    buildAlignmentDocument,
    buildOntologyDocument,
    buildPwlsSkosDocument
} from "../lib/restApi/read-etp.module/RdfVocabulary";

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
            storeLastWrite: new Date("2021-09-14T20:26:16.128Z")
        },
        {
            uri: uriB,
            name: 'Local, "Depth" CRS',
            activeStatus: "Active"
        }
    ],
    links: [{ source: uriA, target: uriB, path: "rsq22:LocalCrs" }]
};

// ============================================================================
// Graph export format negotiation
// ============================================================================
describe("graph export format negotiation", () => {
    it("maps ?format= aliases", () => {
        expect(graphExportFromParam("csv")).toBe("csv");
        expect(graphExportFromParam("graphml")).toBe("graphml");
        expect(graphExportFromParam("graph-ml")).toBe("graphml");
        expect(graphExportFromParam("turtle")).toBeUndefined();
        expect(graphExportFromParam(undefined)).toBeUndefined();
    });

    it("negotiates the Accept header", () => {
        expect(negotiateGraphExport("text/csv")).toBe("csv");
        expect(negotiateGraphExport("application/graphml+xml")).toBe("graphml");
        expect(negotiateGraphExport("application/json")).toBeUndefined();
    });

    it("lets ?format= override the Accept header", () => {
        expect(resolveGraphExportFormat("text/csv", "graphml")).toBe("graphml");
        expect(resolveGraphExportFormat("application/json", "csv")).toBe("csv");
    });
});

// ============================================================================
// CSV export
// ============================================================================
describe("graphToCsv", () => {
    const csv = graphToCsv(graph);

    it("emits a header row and one row per resource with CRLF line endings", () => {
        const lines = csv.split("\r\n").filter(l => l.length > 0);
        expect(lines.length).toBe(3); // header + 2 nodes
        expect(lines[0]).toContain("uri");
        expect(lines[0]).toContain("sourceCount");
        expect(lines[0]).toContain("targetCount");
    });

    it("RFC-4180 escapes fields containing commas and quotes", () => {
        expect(csv).toContain('"Local, ""Depth"" CRS"');
    });

    it("includes the ETP URIs verbatim", () => {
        expect(csv).toContain(uriA);
        expect(csv).toContain(uriB);
    });
});

// ============================================================================
// GraphML export
// ============================================================================
describe("graphToGraphML", () => {
    const xml = graphToGraphML(graph);

    it("produces a graphml document with nodes and an edge", () => {
        expect(xml).toContain("<graphml");
        expect(xml).toContain("<node id=");
        expect(xml).toContain(
            "resqml20.obj_TriangulatedSetRepresentation(a3f31b20-c93a-4682-8f6c-71be087202a4)"
        );
        expect(xml).toContain("<edge");
    });

    it("xml-escapes attribute values", () => {
        expect(xml).toContain("&quot;");
        expect(xml).not.toContain('"Depth"'); // raw quotes must be escaped
    });

    it("serializeGraphExport sets the correct content types", () => {
        expect(serializeGraphExport(graph, "csv").contentType).toBe(EXPORT_MIME_CSV);
        expect(serializeGraphExport(graph, "graphml").contentType).toBe(
            EXPORT_MIME_GRAPHML
        );
    });
});

// ============================================================================
// Generic RDF document writer
// ============================================================================
describe("RdfDocument writer", () => {
    const model: RdfDocumentModel = {
        prefixes: {
            ex: "https://example.org/ns#",
            rdfs: "http://www.w3.org/2000/01/rdf-schema#"
        },
        subjects: [
            {
                iri: "https://example.org/ns#Thing",
                predicates: [
                    {
                        predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
                        objects: [iri("https://example.org/ns#Class")]
                    },
                    {
                        predicate: "http://www.w3.org/2000/01/rdf-schema#label",
                        objects: [lit('a "quoted" label', undefined, "en")]
                    }
                ]
            }
        ]
    };

    it("compacts IRIs and uses 'a' for rdf:type in Turtle", () => {
        const ttl = documentToTurtle(model);
        expect(ttl).toContain("@prefix ex: <https://example.org/ns#> .");
        expect(ttl).toContain("ex:Thing");
        expect(ttl).toContain("a ex:Class");
        expect(ttl).toContain('rdfs:label "a \\"quoted\\" label"@en');
    });

    it("expands to full IRIs in N-Triples", () => {
        const nt = documentToNTriples(model);
        expect(nt).toContain("<https://example.org/ns#Thing>");
        expect(nt).toContain(
            "<http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <https://example.org/ns#Class> ."
        );
    });

    it("produces a JSON-LD @graph with @context", () => {
        const jsonld = documentToJsonLd(model) as any;
        expect(jsonld["@context"].ex).toBe("https://example.org/ns#");
        expect(jsonld["@graph"][0]["@id"]).toBe("ex:Thing");
        expect(jsonld["@graph"][0]["@type"]).toEqual(["ex:Class"]);
    });

    it("serializeDocument sets content types", () => {
        expect(serializeDocument(model, "turtle").contentType).toBe("text/turtle");
        expect(serializeDocument(model, "jsonld").contentType).toBe(
            "application/ld+json"
        );
        expect(serializeDocument(model, "ntriples").contentType).toBe(
            "application/n-triples"
        );
    });
});

// ============================================================================
// Ontology vocabulary
// ============================================================================
describe("buildOntologyDocument", () => {
    const ttl = documentToTurtle(buildOntologyDocument());

    it("declares the ontology and the Resource class", () => {
        expect(ttl).toContain("a owl:Ontology");
        expect(ttl).toContain("rddms:Resource");
        expect(ttl).toContain("a owl:Class");
    });

    it("declares core properties", () => {
        expect(ttl).toContain("rddms:references");
        expect(ttl).toContain("rddms:sourceCount");
        expect(ttl).toContain("a owl:ObjectProperty");
        expect(ttl).toContain("a owl:DatatypeProperty");
    });
});

// ============================================================================
// OWL alignment
// ============================================================================
describe("buildAlignmentDocument", () => {
    const doc = buildAlignmentDocument();
    const ttl = documentToTurtle(doc);

    it("has an ontology header and at least one aligned class", () => {
        expect(ttl).toContain("a owl:Ontology");
        expect(doc.subjects.length).toBeGreaterThan(1);
    });

    it("emits owl:equivalentClass links to OSDU kinds", () => {
        expect(ttl).toContain("owl:equivalentClass");
        expect(ttl).toContain("rddms:osduKind");
        expect(ttl).toContain("osdu:wks:");
    });
});

// ============================================================================
// PWLS SKOS concept scheme
// ============================================================================
describe("buildPwlsSkosDocument", () => {
    it("emits a ConceptScheme and property concepts", () => {
        const ttl = documentToTurtle(buildPwlsSkosDocument({ includeMnemonics: false }));
        expect(ttl).toContain("a skos:ConceptScheme");
        expect(ttl).toContain("a skos:Concept");
        expect(ttl).toContain("skos:prefLabel");
        expect(ttl).not.toContain("skos:altLabel");
    });

    it("attaches vendor mnemonics as skos:altLabel when requested", () => {
        const ttl = documentToTurtle(buildPwlsSkosDocument({ includeMnemonics: true }));
        expect(ttl).toContain("skos:altLabel");
    });
});
