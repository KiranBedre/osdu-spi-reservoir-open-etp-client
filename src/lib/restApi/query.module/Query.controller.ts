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
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  ApiBearerAuth,
  ApiBody,
  ApiDefaultResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotAcceptableResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse
} from "@nestjs/swagger";

import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsArray
} from "class-validator";

import express from "express";

import {
  Energistics,
  EtpUri,
  Resource
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
  toDate,
  toJSonCustomData
} from "../ControllerUtils";

import Logging from "../../common/Logging";

const logger = Logging.getLogger("EtpClient");

// ── DTOs ─────────────────────────────────────────────────────────────────────

class FindResourcesDto {
  @ApiProperty({
    description: "URI of the dataspace or object to search from",
    example: "eml:///dataspace('demo/drogon')"
  })
  @IsNotEmpty()
  @IsString()
  uri!: string;

  @ApiPropertyOptional({
    description: "Search scope: self, sources, targets, sourcesOrSelf, targetsOrSelf",
    enum: ["self", "sources", "targets", "sourcesOrSelf", "targetsOrSelf"],
    default: "targets"
  })
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional({
    description: "Data object types to filter (e.g., resqml22.TriangulatedSetRepresentation)",
    type: [String]
  })
  @IsOptional()
  dataObjectTypes?: string[];

  @ApiPropertyOptional({
    description: "Graph traversal depth (0 = unlimited)",
    default: 1
  })
  @IsOptional()
  @IsNumber()
  depth?: number;

  @ApiPropertyOptional({
    description: "Only return resources modified after this ISO timestamp"
  })
  @IsOptional()
  @IsString()
  modifiedSince?: string;
}

class FindDataObjectsDto extends FindResourcesDto {
  @ApiPropertyOptional({
    description: "Return format: xml or json",
    default: "xml"
  })
  @IsOptional()
  @IsString()
  format?: string;
}

class GrowingObjectPartsDto {
  @ApiProperty({
    description: "URI of the growing object (WellLog, MudLog, etc.)",
    example: "eml:///dataspace('maap/witsml')/witsml21.WellboreGeology(uuid)"
  })
  @IsNotEmpty()
  @IsString()
  uri!: string;
}

class GetPartsByRangeDto {
  @ApiProperty({
    description: "URI of the growing object"
  })
  @IsNotEmpty()
  @IsString()
  uri!: string;

  @ApiProperty({
    description: "Start index value (depth in meters or time in microseconds)"
  })
  @IsNotEmpty()
  @IsNumber()
  startIndex!: number;

  @ApiProperty({
    description: "End index value"
  })
  @IsNotEmpty()
  @IsNumber()
  endIndex!: number;

  @ApiPropertyOptional({
    description: "Include parts overlapping the range boundary",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  includeOverlapping?: boolean;
}

class ChannelMetadataDto {
  @ApiProperty({
    description: "URI of the object containing channels (e.g., WellLog)",
    example: "eml:///dataspace('maap/drogon')/witsml21.WellLog(uuid)"
  })
  @IsNotEmpty()
  @IsString()
  uri!: string;
}

class GraphSearchDto {
  @ApiProperty({
    description: "URIs of resources to build a subgraph for",
    example: [
      "eml:///dataspace('maap/drogon')/resqml20.obj_IjkGridRepresentation(uuid1)",
      "eml:///dataspace('maap/drogon')/resqml20.obj_TriangulatedSetRepresentation(uuid2)"
    ],
    type: [String]
  })
  @IsArray()
  @IsNotEmpty()
  uris!: string[];

  @ApiPropertyOptional({
    description:
      "Search scope: sources, targets, or self. Applied to each URI.",
    enum: ["self", "sources", "targets", "sourcesOrSelf", "targetsOrSelf"],
    default: "targets"
  })
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional({
    description: "Graph traversal depth from each URI (1 = immediate neighbours)",
    default: 1
  })
  @IsOptional()
  @IsNumber()
  depth?: number;

  @ApiPropertyOptional({
    description:
      "Data object types to include (e.g., resqml20.obj_ContinuousProperty)",
    type: [String]
  })
  @IsOptional()
  dataObjectTypes?: string[];

  @ApiPropertyOptional({
    description: "Include source/target counts on each resource",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  countObjects?: boolean;

  @ApiPropertyOptional({
    description: "Include secondary targets in graph traversal",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  includeSecondaryTargets?: boolean;

  @ApiPropertyOptional({
    description: "Include secondary sources in graph traversal",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  includeSecondarySources?: boolean;
}

// ── Helper ───────────────────────────────────────────────────────────────────

function scopeFromString(
  s?: string
): Energistics.Etp.v12.Datatypes.Object.ContextScopeKind {
  const Kind = Energistics.Etp.v12.Datatypes.Object.ContextScopeKind;
  switch (s) {
    case "self":
      return Kind.self;
    case "sources":
      return Kind.sources;
    case "sourcesOrSelf":
      return Kind.sourcesOrSelf;
    case "targetsOrSelf":
      return Kind.targetsOrSelf;
    case "targets":
    default:
      return Kind.targets;
  }
}

const swaggerServers = [{ url: "" }];

// ── Controller ───────────────────────────────────────────────────────────────

@Controller("query")
@ApiTags("Query & Growing Objects")
@ApiBearerAuth("access-token")
@UseGuards(HasBearerGuard("jwt"))
@ApiHeader({
  name: "data-partition-id",
  required: true,
  schema: { type: "string", pattern: patternString(partitionPattern) }
})
@UseGuards(HasDataPartitionGuard())
@ApiUnauthorizedResponse(errorMessageSchema("Unauthorized", 401))
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many requests", 429))
@ApiInternalServerErrorResponse(errorMessageSchema("Unknown Error", 500))
@ApiDefaultResponse(errorMessageSchema("Unknown Error", 500))
export default class QueryController {
  /**
   * Find resources matching search criteria using DiscoveryQuery protocol.
   * Returns resource metadata (URI, name, type, timestamps) without object body.
   */
  @Post("resources/find")
  @HttpCode(200)
  @ApiOperation({
    summary: "Find resources by context and scope (DiscoveryQuery Protocol 13)",
    description: `Search for resources within a dataspace or below a specific 
    object URI. Returns resource metadata without loading full XML content.
    Useful for OSDU search integration and resource enumeration.`,
    servers: swaggerServers
  })
  @ApiOkResponse({
    description: "Matching resources",
    schema: {
      type: "array",
      items: {
        type: "object",
        properties: {
          uri: { type: "string" },
          name: { type: "string" },
          sourceCount: { type: "number" },
          targetCount: { type: "number" },
          lastChanged: { type: "string" },
          storeLastWrite: { type: "string" },
          activeStatus: { type: "string" }
        }
      }
    }
  })
  @ApiBody({ type: FindResourcesDto })
  public async findResources(
    @Body() body: FindResourcesDto,
    @Req() request?: express.Request
  ) {
    let c;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );

      const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
        uri: body.uri,
        depth: body.depth ?? 1,
        dataObjectTypes: body.dataObjectTypes || [],
        navigableEdges:
          Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Primary,
        includeSecondaryTargets: false,
        includeSecondarySources: false
      };

      const storeLastWriteFilter = body.modifiedSince
        ? BigInt(new Date(body.modifiedSince).getTime() * 1000)
        : null;

      const resources = await c.discoveryQuery.findResources(
        context,
        scopeFromString(body.scope),
        storeLastWriteFilter
      );

      return resources.map(r => ({
        uri: r.uri,
        name: r.name,
        sourceCount: r.sourceCount,
        targetCount: r.targetCount,
        lastChanged: r.lastChanged
          ? new Date(Number(r.lastChanged) / 1000).toISOString()
          : null,
        storeLastWrite: r.storeLastWrite
          ? new Date(Number(r.storeLastWrite) / 1000).toISOString()
          : null,
        activeStatus: r.activeStatus
      }));
    } catch (err) {
      throw httpErrorFromEtpError(err);
    } finally {
      await c?.closeSession();
    }
  }

  /**
   * Find data objects with full XML/JSON content using StoreQuery protocol.
   */
  @Post("objects/find")
  @HttpCode(200)
  @ApiOperation({
    summary: "Find data objects with content (StoreQuery Protocol 14)",
    description: `Search for data objects and retrieve their full content (XML or JSON).
    More expensive than resource discovery but provides the complete object body.
    Use for bulk data synchronization with OSDU Storage service.`,
    servers: swaggerServers
  })
  @ApiOkResponse({
    description: "Matching data objects with content"
  })
  @ApiBody({ type: FindDataObjectsDto })
  public async findDataObjects(
    @Body() body: FindDataObjectsDto,
    @Req() request?: express.Request
  ) {
    let c;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );

      const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
        uri: body.uri,
        depth: body.depth ?? 1,
        dataObjectTypes: body.dataObjectTypes || [],
        navigableEdges:
          Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Primary,
        includeSecondaryTargets: false,
        includeSecondarySources: false
      };

      const storeLastWriteFilter = body.modifiedSince
        ? BigInt(new Date(body.modifiedSince).getTime() * 1000)
        : null;

      // Use Discovery + GetDataObjects for the query
      const resources = await c.discovery.getResources(
        context,
        scopeFromString(body.scope),
        false,
        storeLastWriteFilter
      );

      if (resources.length === 0) {
        return [];
      }

      // Batch get objects
      const uris = resources.map(r => r.uri);
      const objects = await c.getDataObjects(uris);

      return objects
        .filter(o => o !== null)
        .map(o => ({
          uri: o!.resource.uri,
          name: o!.resource.name,
          format: o!.format || "xml",
          data: o!.data ? Buffer.from(o!.data).toString("utf-8") : null,
          lastChanged: o!.resource.lastChanged
            ? new Date(Number(o!.resource.lastChanged) / 1000).toISOString()
            : null
        }));
    } catch (err) {
      throw httpErrorFromEtpError(err);
    } finally {
      await c?.closeSession();
    }
  }

  /**
   * Batch graph search: build a merged subgraph for multiple URIs in a single call.
   * Each URI is traversed with the given scope and depth, and results are merged
   * into a single deduplicated graph. Essential for efficient deep search from
   * external consumers like GraphQL resolvers.
   */
  @Post("graph/search")
  @HttpCode(200)
  @ApiOperation({
    summary: "Batch graph search across multiple URIs (Discovery Protocol 3)",
    description: `Build a merged subgraph for multiple resource URIs in a single session.
    For each URI, traverses the relationship graph with the given scope and depth,
    then merges all discovered nodes and edges into a deduplicated result.

    This is significantly more efficient than calling GET /graph/{type}/{guid}/targets
    for each URI individually, as it reuses a single ETP session.

    Designed for deep search scenarios where a consumer (e.g., GraphQL) needs
    to discover properties, representations, and interpretations for many objects at once.`,
    servers: swaggerServers
  })
  @ApiOkResponse({
    description: "Merged graph containing all discovered resources and edges",
    schema: {
      type: "object",
      properties: {
        resources: {
          type: "array",
          items: {
            type: "object",
            properties: {
              uri: { type: "string" },
              name: { type: "string" },
              sourceCount: { type: "number" },
              targetCount: { type: "number" },
              lastChanged: { type: "string" },
              storeLastWrite: { type: "string" },
              activeStatus: { type: "string" }
            }
          }
        },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source: { type: "string" },
              target: { type: "string" },
              path: { type: "string" }
            }
          }
        }
      }
    }
  })
  @ApiBody({ type: GraphSearchDto })
  public async graphSearch(
    @Body() body: GraphSearchDto,
    @Req() request?: express.Request
  ) {
    let c;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );

      const scope = scopeFromString(body.scope);
      const depth = body.depth ?? 1;
      const dataObjectTypes = body.dataObjectTypes || [];
      const countObjects = body.countObjects ?? false;

      // Merged graph: deduplicate across all URI results
      const allNodes = new Map<string, Resource>();
      const allEdges: Array<{ sourceUri: string; targetUri: string; path?: string }> = [];
      const seenEdges = new Set<string>();

      // Process all URIs in sequence within the same ETP session
      for (const uri of body.uris) {
        const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
          uri,
          depth,
          dataObjectTypes,
          navigableEdges:
            Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both,
          includeSecondaryTargets: body.includeSecondaryTargets ?? false,
          includeSecondarySources: body.includeSecondarySources ?? false
        };

        try {
          const graph: ResourceGraph = await c.getGraph(
            context,
            scope,
            countObjects,
            dataObjectTypes
          );

          // Merge nodes
          for (const [nodeUri, resource] of graph.entries()) {
            if (!allNodes.has(nodeUri)) {
              allNodes.set(nodeUri, resource);
            }
          }

          // Merge edges (deduplicate by source+target)
          for (const edge of graph.edges) {
            const edgeKey = `${edge.sourceUri}→${edge.targetUri}`;
            if (!seenEdges.has(edgeKey)) {
              seenEdges.add(edgeKey);
              allEdges.push(edge);
            }
          }
        } catch (err) {
          logger.warn(
            `Graph search failed for URI ${uri}: ${err}`
          );
          // Continue with remaining URIs — best effort
        }
      }

      return {
        resources: [...allNodes.values()].map(r => ({
          uri: r.uri,
          name: r.name,
          sourceCount: r.sourceCount,
          targetCount: r.targetCount,
          lastChanged: toDate(r.lastChanged),
          storeLastWrite: toDate(r.storeLastWrite),
          activeStatus: r.activeStatus,
          customData: toJSonCustomData(r.customData) ?? {}
        })),
        links: allEdges.map(e => ({
          source: e.sourceUri,
          target: e.targetUri,
          path: e.path
        }))
      };
    } catch (err) {
      throw httpErrorFromEtpError(err);
    } finally {
      await c?.closeSession();
    }
  }

  /**
   * Get metadata about parts of a growing object.
   */
  @Post("growing/metadata")
  @HttpCode(200)
  @ApiOperation({
    summary: "Get parts metadata for a growing object (GrowingObject Protocol 6)",
    description: `Retrieve metadata about the parts/segments of a growing object
    (e.g., available depth ranges in a WellLog, curve mnemonics).
    Use before GetPartsByRange to discover what data is available.`,
    servers: swaggerServers
  })
  @ApiBody({ type: GrowingObjectPartsDto })
  public async getPartsMetadata(
    @Body() body: GrowingObjectPartsDto,
    @Req() request?: express.Request
  ) {
    let c;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      const metadata = await c.growingObject.getPartsMetadata(body.uri);
      return metadata;
    } catch (err) {
      throw httpErrorFromEtpError(err);
    } finally {
      await c?.closeSession();
    }
  }

  /**
   * Get parts of a growing object within an index range.
   */
  @Post("growing/range")
  @HttpCode(200)
  @ApiOperation({
    summary: "Get parts by index range (GrowingObject Protocol 6)",
    description: `Retrieve data from a growing object (WellLog, MudLog) within
    a specified depth or time range. Essential for fetching well log curves
    for a specific interval without loading the entire dataset.`,
    servers: swaggerServers
  })
  @ApiBody({ type: GetPartsByRangeDto })
  public async getPartsByRange(
    @Body() body: GetPartsByRangeDto,
    @Req() request?: express.Request
  ) {
    let c;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );

      const startIndex = new Energistics.Etp.v12.Datatypes.IndexValue();
      startIndex.item = { _double: body.startIndex, __keyName: "_double" };
      const endIndex = new Energistics.Etp.v12.Datatypes.IndexValue();
      endIndex.item = { _double: body.endIndex, __keyName: "_double" };
      const indexInterval: Energistics.Etp.v12.Datatypes.Object.IndexInterval = {
        startIndex,
        endIndex,
        uom: "m",
        depthDatum: ""
      };

      const parts = await c.growingObject.getPartsByRange(
        body.uri,
        indexInterval,
        body.includeOverlapping ?? false
      );

      return parts.map(p => ({
        uid: p.uid,
        data: p.data ? Buffer.from(p.data).toString("utf-8") : null
      }));
    } catch (err) {
      throw httpErrorFromEtpError(err);
    } finally {
      await c?.closeSession();
    }
  }

  /**
   * Get channel (curve) metadata for a data object.
   */
  @Post("channels/metadata")
  @HttpCode(200)
  @ApiOperation({
    summary: "Get channel metadata (ChannelSubscribe Protocol 21)",
    description: `Discover available channels (curves) for a WellLog or similar object.
    Returns channel names, units of measure, data types, and index information.
    Use to understand what measurements are available before subscribing or querying.`,
    servers: swaggerServers
  })
  @ApiBody({ type: ChannelMetadataDto })
  public async getChannelMetadata(
    @Body() body: ChannelMetadataDto,
    @Req() request?: express.Request
  ) {
    let c;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      const metadata = await c.channelSubscribe.getChannelMetadata(body.uri);
      return metadata.map(ch => ({
        channelId: ch.id,
        channelName: ch.channelName,
        uom: ch.uom,
        dataKind: ch.dataKind,
        channelClassUri: ch.channelClassUri,
        status: ch.status,
        source: ch.source,
        indexes: ch.indexes
      }));
    } catch (err) {
      throw httpErrorFromEtpError(err);
    } finally {
      await c?.closeSession();
    }
  }
}
