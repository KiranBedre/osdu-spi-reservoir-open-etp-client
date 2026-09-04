import { Controller, Get, Header, Query, Req, Res } from "@nestjs/common";
import {
    ApiOkResponse,
    ApiOperation,
    ApiProduces,
    ApiQuery,
    ApiTags
} from "@nestjs/swagger";
import type express from "express";

import { swaggerServers } from "../ControllerUtils";
import {
    RDF_MIME_JSONLD,
    RDF_MIME_NTRIPLES,
    RDF_MIME_TURTLE,
    jsonLdContextDocument,
    resolveRdfFormat
} from "./RdfSerialization";
import {
    DocumentRdfFormat,
    RdfDocumentModel,
    serializeDocument
} from "./RdfDocument";
import {
    buildAlignmentDocument,
    buildOntologyDocument
} from "./RdfVocabulary";

const rdfFormatQuery = {
    name: "format",
    required: false,
    enum: ["turtle", "jsonld", "ntriples"],
    description:
        "RDF serialization to return. Overrides the Accept header. Defaults to Turtle."
};

/**
 * Linked-data metadata endpoints.
 *
 * Serves the static vocabulary that describes the RDF emitted by the resource
 * graph endpoints: the JSON-LD context, the ontology, and the RESQML→OSDU OWL
 * alignment. These are public, read-only documents and mint no data.
 */
@ApiTags("Linked Data")
@Controller("rdf")
export default class LinkedDataController {
    private serialize(
        doc: RdfDocumentModel,
        request: express.Request | undefined,
        response: express.Response | undefined,
        format?: string
    ): string | Record<string, unknown> {
        const rdfFormat: DocumentRdfFormat =
            resolveRdfFormat(request?.headers.accept, format) ?? "turtle";
        const { body, contentType } = serializeDocument(doc, rdfFormat);
        response?.type(contentType);
        return body;
    }

    /**
     * JSON-LD context document for the compacted JSON-LD emitted by the graph
     * endpoints.
     */
    @Get("context")
    @Header("Content-Type", RDF_MIME_JSONLD)
    @ApiOkResponse({ description: "JSON-LD context document" })
    @ApiOperation({
        summary: "Get the JSON-LD context",
        description:
            "Returns the `@context` document that clients can use to interpret the compacted JSON-LD returned by the resource graph endpoints.",
        security: [],
        servers: swaggerServers
    })
    public context(): Record<string, unknown> {
        return jsonLdContextDocument();
    }

    /**
     * The ontology (rddms: classes and properties).
     */
    @Get("ontology")
    @ApiProduces(RDF_MIME_TURTLE, RDF_MIME_JSONLD, RDF_MIME_NTRIPLES)
    @ApiQuery(rdfFormatQuery)
    @ApiOkResponse({ description: "Ontology document (Turtle, JSON-LD or N-Triples)" })
    @ApiOperation({
        summary: "Get the Reservoir DDMS graph ontology",
        description:
            "Returns the vocabulary (classes and properties) used by the RDF graph serializations. Content-negotiated via the Accept header or the `format` query parameter.",
        security: [],
        servers: swaggerServers
    })
    public ontology(
        @Query("format") format?: string,
        @Req() request?: express.Request,
        @Res({ passthrough: true }) response?: express.Response
    ): string | Record<string, unknown> {
        return this.serialize(buildOntologyDocument(), request, response, format);
    }

    /**
     * The RESQML/WITSML → OSDU OWL alignment.
     */
    @Get("alignment")
    @ApiProduces(RDF_MIME_TURTLE, RDF_MIME_JSONLD, RDF_MIME_NTRIPLES)
    @ApiQuery(rdfFormatQuery)
    @ApiOkResponse({ description: "OWL alignment document (Turtle, JSON-LD or N-Triples)" })
    @ApiOperation({
        summary: "Get the RESQML to OSDU class alignment",
        description:
            "Returns owl:equivalentClass links from Reservoir DDMS data-object-type classes to the OSDU kinds they are converted to by the Manifest Builder. Content-negotiated via the Accept header or the `format` query parameter.",
        security: [],
        servers: swaggerServers
    })
    public alignment(
        @Query("format") format?: string,
        @Req() request?: express.Request,
        @Res({ passthrough: true }) response?: express.Response
    ): string | Record<string, unknown> {
        return this.serialize(buildAlignmentDocument(), request, response, format);
    }
}
