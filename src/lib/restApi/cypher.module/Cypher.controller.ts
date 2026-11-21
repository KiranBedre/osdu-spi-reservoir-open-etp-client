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
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse
} from "@nestjs/swagger";

import { IsNotEmpty, IsObject, IsOptional, IsString } from "class-validator";

import express from "express";

import {
  Energistics
} from "../../client/ResqmlClient";

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

import { parseCypher, CypherSyntaxError, ScalarValue } from "./CypherParser";
import { CypherEngine } from "./CypherEngine";

const logger = Logging.getLogger("EtpClient");

// ── DTOs ─────────────────────────────────────────────────────────────────────

class CypherQueryDto {
  @ApiProperty({
    description:
      "ETP URI of the dataspace to run the graph query against. The dataspace " +
      "subgraph is fetched once (Discovery protocol) and matched entirely " +
      "in-memory — no resolver-per-hop fan-out.",
    example: "eml:///dataspace('demo/drogon')"
  })
  @IsNotEmpty()
  @IsString()
  dataspaceUri!: string;

  @ApiProperty({
    description:
      "openCypher query (read-only subset: MATCH … [WHERE …] RETURN … " +
      "[ORDER BY …] [SKIP n] [LIMIT n]). Nodes are RESQML resources; " +
      "relationships are DataObjectReferences. Labels match the data-object " +
      "type by substring (e.g. `Grid`, `Interpretation`, or a fully-qualified " +
      "`resqml20.obj_IjkGridRepresentation`). Variable-length paths `*1..5` and " +
      "shortest-reachability traversals are native.",
    example:
      "MATCH (g:IjkGridRepresentation)-[*1..3]-(x) RETURN g, x LIMIT 50"
  })
  @IsNotEmpty()
  @IsString()
  query!: string;

  @ApiPropertyOptional({
    description:
      "Values for `$`-parameters referenced by the query " +
      "(e.g. `{ \"gridId\": \"0c8a1e2f-...\" }`).",
    type: "object",
    additionalProperties: true,
    example: { gridId: "0c8a1e2f-3b7d-4e56-9a81-2f6c4b0d9e73" }
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, ScalarValue>;
}

// Inherits the global relative-path server (mirrors QueryController).
const swaggerServers: any = undefined;

// ── Controller ───────────────────────────────────────────────────────────────

@Controller("cypher")
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
export default class CypherController {
  /**
   * Execute a read-only openCypher query over a dataspace's RESQML graph.
   *
   * The whole dataspace subgraph (resources + DataObjectReference edges) is
   * fetched once via the ETP Discovery protocol and matched in-memory, so deep
   * traversals, variable-length paths and lineage walks resolve without the
   * N+1 resolver fan-out that GraphQL incurs for the same questions.
   */
  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: "Run an openCypher graph query over a dataspace (read-only subset)",
    description: `Evaluate graph-pattern queries against the RESQML/ETP property graph. This is the relationship-centric companion to the field-selection \`/graphql\` endpoint: use **Cypher** for connectivity, lineage, provenance and topology ("what is connected to what?"), and **GraphQL** for record/field retrieval.

**Data model**
- **Nodes** = RESQML resources (Features, Interpretations, Representations, Grids, Properties, Wellbores…).
- **Relationships** = DataObjectReferences (DORs). The semantic role is inferred from the RESQML tier chain (\`InterpretedFeature\`, \`RepresentedInterpretation\`, \`SupportingRepresentation\`).
- **Labels** match the data-object type by substring, so \`(:Grid)\`, \`(:Interpretation)\`, \`(:Wellbore)\` and the fully-qualified \`(:resqml20.obj_IjkGridRepresentation)\` all work.
- **Relationship types** map onto inferred roles via synonyms (e.g. \`INTERPRETED_BY\` ⇄ \`RepresentedInterpretation\`); unknown roles match leniently.

**Supported grammar (bounded, Neptune/Spanner-style strict subset)**
\`\`\`
MATCH <pattern> [WHERE <expr>] RETURN <items> [ORDER BY …(ignored)] [SKIP n] [LIMIT n]
\`\`\`
- Node: \`(var:Label {prop: value})\` — property keys: \`uri\`, \`id\`/\`uuid\`, \`name\`, \`type\`.
- Relationship: \`-[:TYPE|OTHER *min..max]->\`, \`<-[...]-\`, or undirected \`-[...]-\`.
- Variable-length \`*1..10\` paths (capped at 10 hops).
- WHERE: \`=, <>, <, <=, >, >=, =~, CONTAINS, STARTS WITH, ENDS WITH, IS NULL\`, combined with \`AND\`/\`OR\`/\`NOT\`.
- RETURN: node variables, \`var.prop\`, path variables, \`AS\` aliases, \`DISTINCT\`.

**Not supported** (rejected with HTTP 400): writes (\`CREATE/MERGE/SET/DELETE\`), \`WITH\`, \`UNWIND\`, \`CALL\`, \`OPTIONAL MATCH\`, aggregations. Array-cell predicates (e.g. porosity > 0.3) are not expressible in a pattern — use the GraphQL \`stats\`/\`reduce\`/\`where\` fields for those.

**Examples**
\`\`\`cypher
// Everything within 5 hops of a grid
MATCH p = (g:IjkGridRepresentation {id: $gridId})-[*1..5]-(x)
RETURN p

// Lineage: objects feeding an interpretation chain
MATCH (f:Feature)<-[:InterpretedFeature]-(i:Interpretation)<-[:RepresentedInterpretation]-(r)
RETURN f, i, r

// Properties supported by a grid
MATCH (g:Grid)-[:SupportingRepresentation]-(p:Property)
RETURN g.name, p.name AS property
\`\`\``,
    servers: swaggerServers
  })
  @ApiBody({ type: CypherQueryDto })
  @ApiOkResponse({
    description:
      "Tabular result set. `columns` lists the RETURN aliases; `data` holds one " +
      "object per matched row keyed by alias (node values are expanded to " +
      "`{uri,id,name,type,...}`). `stats` reports the scanned subgraph size.",
    schema: {
      type: "object",
      properties: {
        columns: {
          type: "array",
          items: { type: "string" },
          example: ["g.name", "property"]
        },
        data: {
          type: "array",
          items: { type: "object", additionalProperties: true },
          example: [{ "g.name": "Drogon Depth Ijk Grid", property: "Porosity" }]
        },
        stats: {
          type: "object",
          properties: {
            nodesScanned: { type: "number", example: 128 },
            edges: { type: "number", example: 214 },
            rowsBeforeLimit: { type: "number", example: 7 },
            graphDepth: { type: "number", example: 5 }
          }
        }
      }
    }
  })
  @ApiBadRequestResponse(
    errorMessageSchema("Cypher syntax error or unsupported construct", 400)
  )
  public async runCypher(
    @Body() body: CypherQueryDto,
    @Req() request?: express.Request
  ) {
    // 1. Parse + validate the query up-front (no session on syntax errors).
    let parsed;
    try {
      parsed = parseCypher(body.query, body.parameters ?? {});
    } catch (err) {
      if (err instanceof CypherSyntaxError) {
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

    const depth = CypherEngine.requiredDepth(parsed);

    // 2. Fetch the dataspace subgraph once, then match in-memory.
    let c;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      requireProtocol(c, Energistics.Etp.v12.Datatypes.Protocol.Discovery);

      const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
        uri: body.dataspaceUri,
        depth,
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

      const engine = new CypherEngine(graph);
      const result = engine.run(parsed);

      return {
        columns: result.columns,
        data: result.rows.map(row => {
          const obj: Record<string, unknown> = {};
          result.columns.forEach((col, i) => {
            obj[col] = row[i];
          });
          return obj;
        }),
        stats: { ...result.stats, graphDepth: depth }
      };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      logger.warn(`Cypher query failed: ${err}`);
      throw httpErrorFromEtpError(err);
    } finally {
      await c?.closeSession();
    }
  }
}
