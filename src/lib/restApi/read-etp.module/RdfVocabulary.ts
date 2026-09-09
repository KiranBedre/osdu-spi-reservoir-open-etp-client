// ============================================================================
// Vocabulary / linked-data documents.
//
// Builds three static-ish RDF documents on top of the generic RdfDocument
// writer:
//   • the served ontology (rddms: classes and properties);
//   • the RESQML → OSDU OWL alignment (from the ResqmlOSDU registry);
//   • the PWLS v4 curve-property SKOS concept scheme.
//
// All are additive, read-only metadata - they mint no data and touch no store.
// ============================================================================

import { RDDMS_NS, RDDMS_TYPE_NS } from "./RdfSerialization";
import { iri, lit, RdfDocumentModel } from "./RdfDocument";
import { ResqmlOSDUMap } from "../../jsonTypes/OsduContext";
import {
    getMnemonicEntries,
    getPropertyEntries
} from "../../jsonTypes/PwlsCurveCatalog";

// --- namespaces -------------------------------------------------------------

const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS_NS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL_NS = "http://www.w3.org/2002/07/owl#";
const SKOS_NS = "http://www.w3.org/2004/02/skos/core#";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

/** Namespace under which OSDU kinds are minted as class IRIs. */
export const OSDU_KIND_NS = "https://schema.osdu.opengroup.org/ontology/kind/";
/** Namespace for the PWLS SKOS concept scheme. */
export const PWLS_NS = "https://rddms.opengroup.org/pwls#";

const rdf = (t: string): string => `${RDF_NS}${t}`;
const rdfs = (t: string): string => `${RDFS_NS}${t}`;
const owl = (t: string): string => `${OWL_NS}${t}`;
const skos = (t: string): string => `${SKOS_NS}${t}`;
const dcterms = (t: string): string => `${DCTERMS_NS}${t}`;
const rddms = (t: string): string => `${RDDMS_NS}${t}`;

const A = rdf("type");

// --- ontology ---------------------------------------------------------------

interface PropSpec {
    local: string;
    kind: "ObjectProperty" | "DatatypeProperty";
    label: string;
    comment: string;
    range?: string;
}

const ONTOLOGY_PROPERTIES: PropSpec[] = [
    {
        local: "references",
        kind: "ObjectProperty",
        label: "references",
        comment:
            "A directed relationship from a data object to one of its targets in the ETP store."
    },
    {
        local: "activeStatus",
        kind: "DatatypeProperty",
        label: "active status",
        comment: "Whether the resource is Active or Inactive in the store."
    },
    {
        local: "dataspace",
        kind: "DatatypeProperty",
        label: "dataspace",
        comment: "The dataspace path that contains the resource."
    },
    {
        local: "uuid",
        kind: "DatatypeProperty",
        label: "uuid",
        comment: "The UUID of the data object."
    },
    {
        local: "objectVersion",
        kind: "DatatypeProperty",
        label: "object version",
        comment: "The object version string of the data object."
    },
    {
        local: "sourceCount",
        kind: "DatatypeProperty",
        label: "source count",
        comment: "Number of resources that reference this resource.",
        range: `${XSD_NS}integer`
    },
    {
        local: "targetCount",
        kind: "DatatypeProperty",
        label: "target count",
        comment: "Number of resources this resource references.",
        range: `${XSD_NS}integer`
    }
];

/** Build the served ontology document (rddms: classes and properties). */
export const buildOntologyDocument = (): RdfDocumentModel => {
    const subjects: RdfDocumentModel["subjects"] = [
        {
            iri: RDDMS_NS,
            predicates: [
                { predicate: A, objects: [iri(owl("Ontology"))] },
                {
                    predicate: dcterms("title"),
                    objects: [lit("Reservoir DDMS Graph Ontology", undefined, "en")]
                },
                {
                    predicate: rdfs("comment"),
                    objects: [
                        lit(
                            "Vocabulary describing the ETP relationship graph exposed by the Reservoir DDMS.",
                            undefined,
                            "en"
                        )
                    ]
                }
            ]
        },
        {
            iri: rddms("Resource"),
            predicates: [
                { predicate: A, objects: [iri(owl("Class"))] },
                {
                    predicate: rdfs("label"),
                    objects: [lit("ETP Resource", undefined, "en")]
                },
                {
                    predicate: rdfs("comment"),
                    objects: [
                        lit(
                            "A data object held in the ETP store. Subclasses are minted per data-object type under the rddmst: namespace.",
                            undefined,
                            "en"
                        )
                    ]
                }
            ]
        }
    ];

    for (const p of ONTOLOGY_PROPERTIES) {
        const predicates: RdfDocumentModel["subjects"][number]["predicates"] = [
            { predicate: A, objects: [iri(owl(p.kind))] },
            { predicate: rdfs("label"), objects: [lit(p.label, undefined, "en")] },
            { predicate: rdfs("comment"), objects: [lit(p.comment, undefined, "en")] },
            { predicate: rdfs("domain"), objects: [iri(rddms("Resource"))] }
        ];
        if (p.local === "references")
            predicates.push({
                predicate: rdfs("range"),
                objects: [iri(rddms("Resource"))]
            });
        if (p.range)
            predicates.push({ predicate: rdfs("range"), objects: [iri(p.range)] });
        subjects.push({ iri: rddms(p.local), predicates });
    }

    return {
        prefixes: {
            rddms: RDDMS_NS,
            rddmst: RDDMS_TYPE_NS,
            owl: OWL_NS,
            rdfs: RDFS_NS,
            dcterms: DCTERMS_NS,
            xsd: XSD_NS
        },
        subjects
    };
};

// --- OWL alignment (RESQML → OSDU) ------------------------------------------

/** Normalize a registry key to the graph class token (strip `obj_`). */
const normalizeResqmlType = (key: string): string =>
    key.replace(/\.obj_/i, ".");

const osduKindIri = (kind: string): string =>
    `${OSDU_KIND_NS}${encodeURIComponent(kind)}`;

/**
 * Build the RESQML → OSDU OWL alignment document from the ResqmlOSDU registry.
 * Each registered data-object type is declared an owl:Class equivalent to the
 * OSDU kind it maps to.
 */
export const buildAlignmentDocument = (): RdfDocumentModel => {
    const subjects: RdfDocumentModel["subjects"] = [
        {
            iri: `${RDDMS_NS}alignment`,
            predicates: [
                { predicate: A, objects: [iri(owl("Ontology"))] },
                {
                    predicate: dcterms("title"),
                    objects: [
                        lit("RESQML/WITSML to OSDU class alignment", undefined, "en")
                    ]
                },
                {
                    predicate: rdfs("comment"),
                    objects: [
                        lit(
                            "owl:equivalentClass links from Reservoir DDMS data-object-type classes to the OSDU kinds they are converted to by the Manifest Builder.",
                            undefined,
                            "en"
                        )
                    ]
                }
            ]
        }
    ];

    const seenOsdu = new Set<string>();
    const registry = ResqmlOSDUMap.getInstance().getAll();
    for (const [key, entry] of registry) {
        const token = normalizeResqmlType(key);
        const classIri = `${RDDMS_TYPE_NS}${token}`;

        let kind: string | undefined;
        try {
            // Most osduKind resolvers ignore the object argument; guard the rest.
            kind = entry.osduKind({} as never);
        } catch {
            kind = undefined;
        }

        const predicates: RdfDocumentModel["subjects"][number]["predicates"] = [
            { predicate: A, objects: [iri(owl("Class"))] },
            { predicate: rdfs("label"), objects: [lit(token, undefined, "en")] }
        ];
        if (kind) {
            predicates.push({
                predicate: owl("equivalentClass"),
                objects: [iri(osduKindIri(kind))]
            });
            predicates.push({
                predicate: rddms("osduKind"),
                objects: [lit(kind)]
            });
        }
        subjects.push({ iri: classIri, predicates });

        if (kind && !seenOsdu.has(kind)) {
            seenOsdu.add(kind);
            subjects.push({
                iri: osduKindIri(kind),
                predicates: [
                    { predicate: A, objects: [iri(owl("Class"))] },
                    { predicate: rdfs("label"), objects: [lit(kind)] }
                ]
            });
        }
    }

    return {
        prefixes: {
            rddms: RDDMS_NS,
            rddmst: RDDMS_TYPE_NS,
            osdu: OSDU_KIND_NS,
            owl: OWL_NS,
            rdfs: RDFS_NS,
            dcterms: DCTERMS_NS
        },
        subjects
    };
};

// --- PWLS SKOS concept scheme -----------------------------------------------

const SCHEME_IRI = `${PWLS_NS}PwlsV4`;
const propertyConceptIri = (property: string): string =>
    `${PWLS_NS}property/${encodeURIComponent(property.toLowerCase())}`;

export interface SkosBuildOptions {
    /** Include vendor mnemonics as skos:altLabel on each property concept. */
    includeMnemonics?: boolean;
}

/** Build the PWLS v4 curve-property SKOS concept scheme. */
export const buildPwlsSkosDocument = (
    options: SkosBuildOptions = {}
): RdfDocumentModel => {
    const includeMnemonics = options.includeMnemonics !== false;

    // property (lowercase) -> alternate mnemonics
    const altLabels = new Map<string, string[]>();
    if (includeMnemonics) {
        for (const [mnemonic, property] of getMnemonicEntries()) {
            const key = property.toLowerCase();
            const list = altLabels.get(key);
            if (list) list.push(mnemonic);
            else altLabels.set(key, [mnemonic]);
        }
    }

    const subjects: RdfDocumentModel["subjects"] = [
        {
            iri: SCHEME_IRI,
            predicates: [
                { predicate: A, objects: [iri(skos("ConceptScheme"))] },
                {
                    predicate: dcterms("title"),
                    objects: [
                        lit("PWLS v4 Curve Property Catalogue", undefined, "en")
                    ]
                },
                {
                    predicate: rdfs("label"),
                    objects: [lit("PWLS v4", undefined, "en")]
                }
            ]
        }
    ];

    for (const { property, quantityClass } of getPropertyEntries()) {
        const conceptIri = propertyConceptIri(property);
        const predicates: RdfDocumentModel["subjects"][number]["predicates"] = [
            { predicate: A, objects: [iri(skos("Concept"))] },
            { predicate: skos("inScheme"), objects: [iri(SCHEME_IRI)] },
            {
                predicate: skos("prefLabel"),
                objects: [lit(property, undefined, "en")]
            }
        ];
        if (quantityClass)
            predicates.push({
                predicate: rddms("quantityClass"),
                objects: [lit(quantityClass)]
            });
        const alts = altLabels.get(property.toLowerCase());
        if (alts && alts.length > 0)
            predicates.push({
                predicate: skos("altLabel"),
                objects: alts.map(m => lit(m))
            });
        subjects.push({ iri: conceptIri, predicates });
    }

    return {
        prefixes: {
            skos: SKOS_NS,
            rddms: RDDMS_NS,
            pwls: PWLS_NS,
            rdfs: RDFS_NS,
            dcterms: DCTERMS_NS
        },
        subjects
    };
};
