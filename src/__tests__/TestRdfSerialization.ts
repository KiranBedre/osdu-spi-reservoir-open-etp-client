import "jest";

import {
  dataObjectClassToken,
  graphToJsonLd,
  graphToTurtle,
  negotiateRdf,
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
});

describe("serializeGraph", () => {
  it("returns the correct content type per format", () => {
    expect(serializeGraph(graph, "turtle").contentType).toBe("text/turtle");
    expect(serializeGraph(graph, "jsonld").contentType).toBe(
      "application/ld+json"
    );
  });
});
