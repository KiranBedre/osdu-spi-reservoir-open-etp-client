// ============================================================================
// Minimal, dependency-free RDF document writer.
//
// The graph serializer (RdfSerialization.ts) is specialised for the ETP
// relationship graph. This module provides a small, general triple model plus
// Turtle / N-Triples / JSON-LD writers so that *vocabulary* documents — the
// served ontology, the RESQML→OSDU OWL alignment, and the PWLS SKOS concept
// scheme — can be emitted from the same negotiation machinery.
// ============================================================================

/** An RDF object term: either an IRI reference or a literal. */
export type RdfObject =
    | { iri: string }
    | { literal: string; datatype?: string; lang?: string };

/** Convenience constructors. */
export const iri = (value: string): RdfObject => ({ iri: value });
export const lit = (
    literal: string | number,
    datatype?: string,
    lang?: string
): RdfObject => ({ literal: String(literal), datatype, lang });

export interface RdfSubjectDoc {
    /** Full IRI of the subject. */
    iri: string;
    /** Predicate → objects, predicate given as a full IRI. */
    predicates: Array<{ predicate: string; objects: RdfObject[] }>;
}

export interface RdfDocumentModel {
    /** prefix → namespace IRI (e.g. `rddms` → `https://…#`). */
    prefixes: Record<string, string>;
    subjects: RdfSubjectDoc[];
}

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

// --- shared escaping --------------------------------------------------------

const escapeLiteral = (s: string): string =>
    s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");

const escapeIri = (iriValue: string): string =>
    // eslint-disable-next-line no-control-regex
    iriValue.replace(/[\u0000-\u0020<>"{}|^`\\]/g, c => {
        const code = c.codePointAt(0) ?? 0;
        return `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
    });

/** Compact a full IRI to `prefix:local` when a known namespace matches. */
const compactIri = (
    iriValue: string,
    prefixes: Record<string, string>
): string | undefined => {
    for (const [prefix, ns] of Object.entries(prefixes)) {
        if (iriValue.startsWith(ns)) {
            const local = iriValue.slice(ns.length);
            // Only compact when the local part is a valid Turtle PN_LOCAL-ish token.
            if (/^[A-Za-z_][\w.-]*$/.test(local)) return `${prefix}:${local}`;
        }
    }
    return undefined;
};

// --- Turtle -----------------------------------------------------------------

const turtleTerm = (
    o: RdfObject,
    prefixes: Record<string, string>
): string => {
    if ("iri" in o)
        return compactIri(o.iri, prefixes) ?? `<${escapeIri(o.iri)}>`;
    if (o.lang) return `"${escapeLiteral(o.literal)}"@${o.lang}`;
    if (o.datatype) {
        const dt = compactIri(o.datatype, prefixes) ?? `<${escapeIri(o.datatype)}>`;
        return `"${escapeLiteral(o.literal)}"^^${dt}`;
    }
    return `"${escapeLiteral(o.literal)}"`;
};

const turtlePredicate = (
    predicate: string,
    prefixes: Record<string, string>
): string =>
    predicate === RDF_TYPE
        ? "a"
        : (compactIri(predicate, prefixes) ?? `<${escapeIri(predicate)}>`);

/** Serialize a document model to Turtle. */
export const documentToTurtle = (doc: RdfDocumentModel): string => {
    const lines: string[] = [];
    for (const [prefix, ns] of Object.entries(doc.prefixes))
        lines.push(`@prefix ${prefix}: <${ns}> .`);
    lines.push("");

    for (const s of doc.subjects) {
        const subject =
            compactIri(s.iri, doc.prefixes) ?? `<${escapeIri(s.iri)}>`;
        const preds = s.predicates
            .filter(p => p.objects.length > 0)
            .map(
                p =>
                    `${turtlePredicate(p.predicate, doc.prefixes)} ${p.objects
                        .map(o => turtleTerm(o, doc.prefixes))
                        .join(", ")}`
            );
        if (preds.length === 0) continue;
        lines.push(`${subject}\n    ${preds.join(" ;\n    ")} .`, "");
    }
    return lines.join("\n");
};

// --- N-Triples --------------------------------------------------------------

const ntTerm = (o: RdfObject): string => {
    if ("iri" in o) return `<${escapeIri(o.iri)}>`;
    if (o.lang) return `"${escapeLiteral(o.literal)}"@${o.lang}`;
    if (o.datatype) return `"${escapeLiteral(o.literal)}"^^<${escapeIri(o.datatype)}>`;
    return `"${escapeLiteral(o.literal)}"`;
};

/** Serialize a document model to N-Triples. */
export const documentToNTriples = (doc: RdfDocumentModel): string => {
    const lines: string[] = [];
    for (const s of doc.subjects) {
        const subject = `<${escapeIri(s.iri)}>`;
        for (const p of s.predicates)
            for (const o of p.objects)
                lines.push(`${subject} <${escapeIri(p.predicate)}> ${ntTerm(o)} .`);
    }
    return lines.length > 0 ? `${lines.join("\n")}\n` : "";
};

// --- JSON-LD ----------------------------------------------------------------

const jsonLdValue = (
    o: RdfObject,
    prefixes: Record<string, string>
): unknown => {
    if ("iri" in o)
        return { "@id": compactIri(o.iri, prefixes) ?? o.iri };
    if (o.lang) return { "@value": o.literal, "@language": o.lang };
    if (o.datatype)
        return {
            "@value": o.literal,
            "@type": compactIri(o.datatype, prefixes) ?? o.datatype
        };
    return o.literal;
};

/** Serialize a document model to a JSON-LD document. */
export const documentToJsonLd = (
    doc: RdfDocumentModel
): Record<string, unknown> => {
    const graph = doc.subjects.map(s => {
        const node: Record<string, unknown> = {
            "@id": compactIri(s.iri, doc.prefixes) ?? s.iri
        };
        for (const p of s.predicates) {
            if (p.objects.length === 0) continue;
            if (p.predicate === RDF_TYPE) {
                node["@type"] = p.objects.map(o =>
                    "iri" in o
                        ? (compactIri(o.iri, doc.prefixes) ?? o.iri)
                        : o.literal
                );
                continue;
            }
            const key = compactIri(p.predicate, doc.prefixes) ?? p.predicate;
            node[key] = p.objects.map(o => jsonLdValue(o, doc.prefixes));
        }
        return node;
    });
    return { "@context": doc.prefixes, "@graph": graph };
};

/** RDF formats the document writer supports (mirrors RdfSerialization.RdfFormat). */
export type DocumentRdfFormat = "turtle" | "ntriples" | "jsonld";

/** Serialize a document model to the requested RDF format. */
export const serializeDocument = (
    doc: RdfDocumentModel,
    format: DocumentRdfFormat
): { body: string | Record<string, unknown>; contentType: string } => {
    switch (format) {
        case "turtle":
            return {
                body: documentToTurtle(doc),
                contentType: "text/turtle"
            };
        case "ntriples":
            return {
                body: documentToNTriples(doc),
                contentType: "application/n-triples"
            };
        case "jsonld":
        default:
            return {
                body: documentToJsonLd(doc),
                contentType: "application/ld+json"
            };
    }
};
