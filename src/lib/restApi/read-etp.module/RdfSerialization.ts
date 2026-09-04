// ============================================================================
// RDF serialization for the ETP relationship graph.
//
// Turns the nodes-and-edges graph returned by the resource endpoints
// (ResourceGraphDto) into linked data (Turtle or JSON-LD) via HTTP content
// negotiation. ETP resource identifiers are already URIs
// (eml:///dataspace('x/y')/resqml20.obj_Type(uuid)), so they are used verbatim
// as RDF subjects — no identifier minting required.
// ============================================================================

/** Vocabulary (predicates and classes) minted by this service. */
export const RDDMS_NS = "https://rddms.opengroup.org/ontology#";
/** Namespace under which data-object-type classes are placed. */
export const RDDMS_TYPE_NS = "https://rddms.opengroup.org/type#";

const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

/** RDF media types this module can emit. */
export const RDF_MIME_TURTLE = "text/turtle";
export const RDF_MIME_JSONLD = "application/ld+json";

export type RdfFormat = "turtle" | "jsonld";

/** Minimal shape consumed from ResourceGraphDto (avoids a controller import cycle). */
export interface RdfResource {
  uri: string;
  name?: string;
  activeStatus?: "Active" | "Inactive";
  sourceCount?: number;
  targetCount?: number;
  lastChanged?: Date | string;
  storeCreated?: Date | string;
  storeLastWrite?: Date | string;
}

export interface RdfEdge {
  source: string;
  target: string;
  path?: string;
}

export interface RdfGraph {
  resources: RdfResource[];
  links: RdfEdge[];
}

/**
 * Inspect an HTTP `Accept` header and decide whether the caller wants RDF.
 * Returns the negotiated format, or `undefined` for the default JSON response.
 */
export const negotiateRdf = (accept?: string): RdfFormat | undefined => {
  if (!accept) return undefined;
  const value = accept.toLowerCase();
  if (value.includes(RDF_MIME_JSONLD)) return "jsonld";
  if (value.includes(RDF_MIME_TURTLE)) return "turtle";
  return undefined;
};

/** Matches the type/uuid tail of an ETP object URI. */
const TYPE_FROM_URI =
  /\/(?<family>resqml|eml|witsml|prodml)(?<version>\d+)\.(?:obj_)?(?<type>\w+)\(/i;

/**
 * Derive a `family+version.Type` class token from a resource URI
 * (e.g. `resqml20.TriangulatedSetRepresentation`). `obj_` prefixes are stripped
 * so 2.0 and 2.2 objects share a class. Returns `undefined` for non-object URIs.
 */
export const dataObjectClassToken = (uri: string): string | undefined => {
  const m = TYPE_FROM_URI.exec(uri);
  if (!m?.groups) return undefined;
  return `${m.groups.family.toLowerCase()}${m.groups.version}.${m.groups.type}`;
};

const toIsoString = (value?: Date | string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

// --- Turtle -----------------------------------------------------------------

/** Escape a string literal for Turtle (RFC-compliant subset). */
const escapeLiteral = (s: string): string =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");

/** Percent-encode characters not permitted inside a Turtle IRIREF `<...>`. */
const escapeIri = (iri: string): string =>
  // eslint-disable-next-line no-control-regex
  iri.replace(/[\u0000-\u0020<>"{}|^`\\]/g, c => {
    const code = c.codePointAt(0) ?? 0;
    return `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
  });

const iriRef = (iri: string): string => `<${escapeIri(iri)}>`;

const TURTLE_PREFIXES = [
  `@prefix rdf: <${RDF_NS}> .`,
  `@prefix rdfs: <${RDFS_NS}> .`,
  `@prefix dcterms: <${DCTERMS_NS}> .`,
  `@prefix xsd: <${XSD_NS}> .`,
  `@prefix rddms: <${RDDMS_NS}> .`,
  `@prefix rddmst: <${RDDMS_TYPE_NS}> .`
].join("\n");

/** Serialize a resource graph to Turtle. */
export const graphToTurtle = (graph: RdfGraph): string => {
  const lines: string[] = [TURTLE_PREFIXES, ""];

  // Outgoing edges grouped by source, so references sit next to their node.
  const outgoing = new Map<string, RdfEdge[]>();
  for (const e of graph.links) {
    const list = outgoing.get(e.source);
    if (list) list.push(e);
    else outgoing.set(e.source, [e]);
  }

  for (const r of graph.resources) {
    const subject = iriRef(r.uri);
    const preds: string[] = [];

    const cls = dataObjectClassToken(r.uri);
    preds.push(cls ? `a rddmst:${cls}` : "a rddms:Resource");

    if (r.name) preds.push(`rdfs:label "${escapeLiteral(r.name)}"`);
    const created = toIsoString(r.storeCreated);
    if (created) preds.push(`dcterms:created "${created}"^^xsd:dateTime`);
    const modified = toIsoString(r.storeLastWrite ?? r.lastChanged);
    if (modified) preds.push(`dcterms:modified "${modified}"^^xsd:dateTime`);
    if (r.activeStatus)
      preds.push(`rddms:activeStatus "${escapeLiteral(r.activeStatus)}"`);
    if (typeof r.sourceCount === "number")
      preds.push(`rddms:sourceCount "${r.sourceCount}"^^xsd:integer`);
    if (typeof r.targetCount === "number")
      preds.push(`rddms:targetCount "${r.targetCount}"^^xsd:integer`);

    for (const e of outgoing.get(r.uri) ?? [])
      preds.push(`rddms:references ${iriRef(e.target)}`);

    lines.push(`${subject}\n    ${preds.join(" ;\n    ")} .`, "");
  }

  return lines.join("\n");
};

// --- JSON-LD ----------------------------------------------------------------

/**
 * Reusable JSON-LD `@context`. Can also be attached to plain REST responses to
 * make the existing JSON payloads valid linked data with no shape change.
 */
export const jsonLdContext = {
  rddms: RDDMS_NS,
  rddmst: RDDMS_TYPE_NS,
  rdfs: RDFS_NS,
  dcterms: DCTERMS_NS,
  xsd: XSD_NS,
  name: "rdfs:label",
  activeStatus: "rddms:activeStatus",
  sourceCount: { "@id": "rddms:sourceCount", "@type": "xsd:integer" },
  targetCount: { "@id": "rddms:targetCount", "@type": "xsd:integer" },
  storeCreated: { "@id": "dcterms:created", "@type": "xsd:dateTime" },
  storeLastWrite: { "@id": "dcterms:modified", "@type": "xsd:dateTime" },
  references: { "@id": "rddms:references", "@type": "@id" }
} as const;

/** Serialize a resource graph to a JSON-LD document. */
export const graphToJsonLd = (graph: RdfGraph): Record<string, unknown> => {
  const outgoing = new Map<string, string[]>();
  for (const e of graph.links) {
    const list = outgoing.get(e.source);
    if (list) list.push(e.target);
    else outgoing.set(e.source, [e.target]);
  }

  const nodes = graph.resources.map(r => {
    const cls = dataObjectClassToken(r.uri);
    const node: Record<string, unknown> = {
      "@id": r.uri,
      "@type": cls ? `rddmst:${cls}` : "rddms:Resource"
    };
    if (r.name) node.name = r.name;
    const created = toIsoString(r.storeCreated);
    if (created) node.storeCreated = created;
    const modified = toIsoString(r.storeLastWrite ?? r.lastChanged);
    if (modified) node.storeLastWrite = modified;
    if (r.activeStatus) node.activeStatus = r.activeStatus;
    if (typeof r.sourceCount === "number") node.sourceCount = r.sourceCount;
    if (typeof r.targetCount === "number") node.targetCount = r.targetCount;
    const refs = outgoing.get(r.uri);
    if (refs && refs.length > 0) node.references = refs;
    return node;
  });

  return { "@context": jsonLdContext, "@graph": nodes };
};

/** Serialize a graph to the requested RDF format. */
export const serializeGraph = (
  graph: RdfGraph,
  format: RdfFormat
): { body: string | Record<string, unknown>; contentType: string } =>
  format === "turtle"
    ? { body: graphToTurtle(graph), contentType: RDF_MIME_TURTLE }
    : { body: graphToJsonLd(graph), contentType: RDF_MIME_JSONLD };
