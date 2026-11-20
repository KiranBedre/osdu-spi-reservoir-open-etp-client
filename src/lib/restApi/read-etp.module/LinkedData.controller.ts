import { Controller, Get, NotFoundException, Param, Query, Req, Res } from "@nestjs/common";
import {
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
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
@ApiTags("Query")
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
     * One route for the three vocabulary artifacts. `context` is always
     * JSON-LD; `ontology` and `alignment` are content-negotiated.
     */
    @Get(":artifact")
    @ApiParam({
        name: "artifact",
        enum: ["context", "ontology", "alignment"],
        description:
            "`context`: the JSON-LD `@context` used by the compacted JSON-LD of the graph endpoints. " +
            "`ontology`: the rddms: vocabulary (classes and properties) used by the RDF graph serializations. " +
            "`alignment`: owl:equivalentClass links from Reservoir DDMS data-object-type classes to the OSDU kinds the Manifest Builder converts them to."
    })
    @ApiProduces(RDF_MIME_JSONLD, RDF_MIME_TURTLE, RDF_MIME_NTRIPLES)
    @ApiQuery(rdfFormatQuery)
    @ApiOkResponse({
        description:
            "Vocabulary document. `context` is JSON-LD; `ontology` and `alignment` are Turtle (default), JSON-LD or N-Triples"
    })
    @ApiNotFoundResponse({ description: "Unknown artifact" })
    @ApiOperation({
        summary: "Get a linked-data vocabulary artifact (context, ontology or alignment)",
        description:
            "Returns the static vocabulary that describes the RDF emitted by the resource graph endpoints. `ontology` and `alignment` are content-negotiated via the Accept header or the `format` query parameter; `context` is always JSON-LD.",
        security: [],
        servers: swaggerServers
    })
    public artifact(
        @Param("artifact") artifact: string,
        @Query("format") format?: string,
        @Req() request?: express.Request,
        @Res({ passthrough: true }) response?: express.Response
    ): string | Record<string, unknown> {
        switch (artifact) {
            case "context":
                response?.type(RDF_MIME_JSONLD);
                return jsonLdContextDocument();
            case "ontology":
                return this.serialize(buildOntologyDocument(), request, response, format);
            case "alignment":
                return this.serialize(buildAlignmentDocument(), request, response, format);
            default:
                throw new NotFoundException(
                    `Unknown rdf artifact '${artifact}'; expected context, ontology or alignment`
                );
        }
    }
}
