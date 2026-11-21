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

import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiDefaultResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotAcceptableResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse
} from "@nestjs/swagger";

import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

import express from "express";

import { Energistics } from "../../client/ResqmlClient";

import { ResourceGraph } from "../../common/ResponseHandlers";

import {
  HasBearerGuard,
  HasDataPartitionGuard,
  createSession,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  httpErrorFromEtpError,
  partitionPattern,
  patternString,
  requireProtocol,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import Logging from "../../common/Logging";

import { parseSparql, SparqlSyntaxError } from "./SparqlParser";
import { SparqlEngine, SparqlRdfFormat } from "./SparqlEngine";

const logger = Logging.getLogger("EtpClient");

// ── DTOs ─────────────────────────────────────────────────────────────────────

class SparqlQueryDto {
  @ApiProperty({
    description:
      "ETP URI of the dataspace to query. Its subgraph is fetched once " +
      "(Discovery protocol), projected into the same RDF triples the `/rdf/*` " +
      "endpoints publish, and queried entirely in-memory.",
    example: "eml:///dataspace('demo/drogon')"
  })
  @IsNotEmpty()
  @IsString()
  dataspaceUri!: string;

  @ApiProperty({
    description:
      "SPARQL 1.1 query (read-only subset). `SELECT`/`ASK` return the W3C " +
      "SPARQL JSON results shape; `CONSTRUCT`/`DESCRIBE` return RDF triples. " +
      "The standard prefixes `rdf:`, `rdfs:`, `xsd:`, `dcterms:`, " +
      "`rddms:` (ontology) and `rddmst:` (data-object type classes) are " +
      "pre-declared, so most queries need no PREFIX header. Nodes are RESQML " +
      "resources; `rddms:references` (plus role-specific predicates such as " +
      "`rddms:representedInterpretation`) are the DataObjectReference edges.",
    example:
      "SELECT ?grid ?name WHERE { ?grid a rddmst:resqml20.IjkGridRepresentation ; rdfs:label ?name } LIMIT 50"
  })
  @IsNotEmpty()
  @IsString()
  query!: string;

  @ApiPropertyOptional({
    description:
      "Serialization for `CONSTRUCT`/`DESCRIBE` results: `json` (structured " +
      "triples, default), `turtle`, or `jsonld`. Ignored for `SELECT`/`ASK`, " +
      "which always return SPARQL JSON results. May also be supplied as the " +
      "`?format=` query parameter.",
    enum: ["json", "turtle", "jsonld"],
    default: "json",
    example: "turtle"
  })
  @IsOptional()
  @IsString()
  @IsIn(["json", "turtle", "jsonld"])
  format?: SparqlRdfFormat;
}

// Inherits the global relative-path server (mirrors QueryController/Cypher).
const swaggerServers: any = undefined;

// ── Controller ───────────────────────────────────────────────────────────────

@Controller("sparql")
@ApiTags("Query")
@ApiBearerAuth("HTTPBearer")
@UseGuards(HasBearerGuard("jwt"))
@ApiHeader({
  name: "data-partition-id",
  description: "Data partition id (ex. 'osdu')",
  required: true,
  schema: {
    type: "string",
    example: "osdu",
    pattern: patternString(partitionPattern)
  }
})
@UseGuards(HasDataPartitionGuard())
@ApiUnauthorizedResponse(errorMessageSchema("Unauthorized", 401))
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many requests", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema("Unknown Error", 500))
@ApiDefaultResponse(errorMessageSchema("Unknown Error", 500))
export default class SparqlController {
  /**
   * Execute a read-only SPARQL query over a dataspace's RESQML graph.
   *
   * The dataspace subgraph is fetched once via ETP Discovery, projected into
   * the same RDF the `/rdf/*` serializers emit, and queried in-memory — so
   * SPARQL is the query verb over the linked data this service already
   * publishes, with no further ETP round-trips during evaluation.
   */
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: "Run a read-only SPARQL query over a dataspace (SELECT/ASK/CONSTRUCT/DESCRIBE)",
    description: `Query the RESQML/ETP graph as **RDF**. This is the semantic-web companion to the \`/cypher\` (property-graph traversal) and \`/graphql\` (typed record retrieval) endpoints, and the **query** counterpart to the \`/rdf/*\` endpoints that *emit* the same triples. Use **SPARQL** when you want standards-based RDF queries, \`CONSTRUCT\` graph reshaping, or interop with existing semantic-web tooling.

**Data model (identical to the \`/rdf\` serializations)**
- Every resource is a subject IRI (its ETP URI) typed \`rddmst:<family><ver>.<Type>\` (e.g. \`rddmst:resqml20.IjkGridRepresentation\`).
- \`rdfs:label\` = object name; \`rddms:uuid\`, \`rddms:dataspace\`, \`rddms:activeStatus\`, \`rddms:sourceCount\`, \`rddms:targetCount\`, \`dcterms:created\`/\`modified\`.
- \`rddms:references\` is the generic DataObjectReference edge; role-specific predicates (e.g. \`rddms:representedInterpretation\`) are added when the DOR path is known.

**Pre-declared prefixes** (no PREFIX header needed): \`rdf:\`, \`rdfs:\`, \`xsd:\`, \`dcterms:\`, \`rddms:\` (\`${"https://rddms.opengroup.org/ontology#"}\`), \`rddmst:\` (\`${"https://rddms.opengroup.org/type#"}\`).

**Supported subset** (bounded, read-only)
\`\`\`
SELECT [DISTINCT] (?v … | *) WHERE { BGP [FILTER …] } [ORDER BY …(ignored)] [LIMIT n] [OFFSET n]
ASK       WHERE { BGP [FILTER …] }
CONSTRUCT { template } WHERE { BGP [FILTER …] } [LIMIT n] [OFFSET n]
DESCRIBE  (?v | <iri>) … [WHERE { BGP }]
\`\`\`
- Basic Graph Patterns with \`;\`/\`,\` lists and \`a\` for \`rdf:type\`.
- Fixed-predicate property paths \`rddms:references*\` / \`+\` for variable-length reachability (capped at 10 hops) — the SPARQL equivalent of Cypher \`*1..n\`.
- \`FILTER\` with \`=, !=, <, <=, >, >=, &&, ||, !\` and \`regex(), CONTAINS(), STRSTARTS(), STRENDS(), BOUND(), isIRI(), isLiteral()\`.

**Not supported** (rejected with HTTP 400): updates (\`INSERT/DELETE/LOAD/…\`), federation (\`SERVICE\`), \`OPTIONAL\`, \`UNION\`, \`MINUS\`, \`BIND\`, \`VALUES\`, named graphs (\`GRAPH\`), aggregation/\`GROUP BY\`, and subqueries.

**Examples**
\`\`\`sparql
# All grids and their names
SELECT ?grid ?name WHERE {
  ?grid a rddmst:resqml20.IjkGridRepresentation ; rdfs:label ?name
} ORDER BY ?name LIMIT 50

# Does any property reference this grid? (ASK)
ASK { ?p rddms:references <eml:///dataspace('demo/drogon')/resqml20.obj_IjkGridRepresentation(0c8a1e2f-…)> }

# Everything reachable from a grid (variable-length path → a reshaped graph)
CONSTRUCT { ?g rddms:references ?x }
WHERE { ?g a rddmst:resqml20.IjkGridRepresentation ; rddms:references+ ?x }

# Full RDF description of one object
DESCRIBE <eml:///dataspace('demo/drogon')/resqml20.obj_IjkGridRepresentation(0c8a1e2f-…)>
\`\`\``,
    servers: swaggerServers
  })
  @ApiBody({ type: SparqlQueryDto })
  @ApiQuery({
    name: "format",
    required: false,
    enum: ["json", "turtle", "jsonld"],
    description:
      "Serialization for CONSTRUCT/DESCRIBE results (overridden by the body `format`)."
  })
  @ApiOkResponse({
    description:
      "For `SELECT`/`ASK`: the W3C SPARQL 1.1 Query Results JSON shape " +
      "(`head.vars` + `results.bindings`, or `boolean`). For " +
      "`CONSTRUCT`/`DESCRIBE`: `triples` (subject/predicate/object), plus an " +
      "`rdf` string when `format` is `turtle`/`jsonld`. `stats` reports the " +
      "scanned triple count and solution count.",
    schema: {
      type: "object",
      properties: {
        form: { type: "string", example: "SELECT" },
        head: {
          type: "object",
          properties: {
            vars: { type: "array", items: { type: "string" }, example: ["grid", "name"] }
          }
        },
        results: {
          type: "object",
          properties: {
            bindings: {
              type: "array",
              items: { type: "object", additionalProperties: true },
              example: [
                {
                  grid: {
                    type: "uri",
                    value:
                      "eml:///dataspace('demo/drogon')/resqml20.obj_IjkGridRepresentation(0c8a1e2f-3b7d-4e56-9a81-2f6c4b0d9e73)"
                  },
                  name: { type: "literal", value: "Drogon Depth Ijk Grid" }
                }
              ]
            }
          }
        },
        boolean: { type: "boolean", example: true },
        triples: {
          type: "array",
          items: { type: "object", additionalProperties: true }
        },
        rdf: { type: "string" },
        stats: {
          type: "object",
          properties: {
            triplesScanned: { type: "number", example: 642 },
            solutions: { type: "number", example: 7 },
            form: { type: "string", example: "SELECT" }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse(
    errorMessageSchema("SPARQL syntax error or unsupported construct", 400)
  )
  public async runSparql(
    @Body() body: SparqlQueryDto,
    @Query("format") formatParam?: SparqlRdfFormat,
    @Req() request?: express.Request
  ) {
    // 1. Parse + validate up-front (no session on syntax errors).
    let parsed;
    try {
      parsed = parseSparql(body.query);
    } catch (err) {
      if (err instanceof SparqlSyntaxError) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: err.message,
            position: err.position
          },
          HttpStatus.BAD_REQUEST
        );
      }
      throw err;
    }

    const format: SparqlRdfFormat = body.format ?? formatParam ?? "json";

    // 2. Fetch the dataspace subgraph once, then query in-memory.
    let c;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      requireProtocol(c, Energistics.Etp.v12.Datatypes.Protocol.Discovery);

      const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
        uri: body.dataspaceUri,
        depth: 0,
        dataObjectTypes: [],
        navigableEdges:
          Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both,
        includeSecondaryTargets: true,
        includeSecondarySources: true
      };

      const graph: ResourceGraph = await c.getGraph(
        context,
        Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.targetsOrSelf,
        true
      );

      const engine = new SparqlEngine(graph);
      return engine.run(parsed, format);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      logger.warn(`SPARQL query failed: ${err}`);
      throw httpErrorFromEtpError(err);
    } finally {
      await c?.closeSession();
    }
  }
}
