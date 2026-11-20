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
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  ApiBearerAuth,
  ApiBody,
  ApiDefaultResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotAcceptableResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse
} from "@nestjs/swagger";

import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean
} from "class-validator";

import express from "express";

import {
  Energistics,
  EtpUri,
  Resource
} from "../../client/ResqmlClient";
import { xml2typescript } from "../../mlTypes/XmlJsonUtil";

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
  toDate,
  toJSonCustomData,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import Logging from "../../common/Logging";

const logger = Logging.getLogger("EtpClient");

// ── DTOs ─────────────────────────────────────────────────────────────────────

const scopeKinds = ["self", "sources", "targets", "sourcesOrSelf", "targetsOrSelf"] as const;

class FindResourcesDto {
  @ApiProperty({
    description:
      "ETP URI (or list of URIs) to search from. Use a dataspace root URI to enumerate all objects, or object URIs to traverse their relationships. Several URIs are traversed in one session and merged (deduplicated).",
    oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    example: "eml:///dataspace('demo/drogon')"
  })
  @IsNotEmpty()
  uri!: string | string[];

  @ApiPropertyOptional({
    description: "Search scope: self, sources, targets, sourcesOrSelf, targetsOrSelf",
    enum: scopeKinds,
    default: "targets"
  })
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional({
    description: "ETP data object type filter (qualified with domain prefix). Examples: resqml20.obj_IjkGridRepresentation, witsml21.Well, eml23.Activity",
    type: [String]
  })
  @IsOptional()
  dataObjectTypes?: string[];

  @ApiPropertyOptional({
    description: "Graph traversal depth (1 = immediate children, 2+ = recursive, 0 = unlimited - use with caution)",
    default: 1
  })
  @IsOptional()
  @IsNumber()
  depth?: number;

  @ApiPropertyOptional({
    description: "ISO 8601 timestamp - only return resources modified after this time. Useful for incremental sync."
  })
  @IsOptional()
  @IsString()
  modifiedSince?: string;

  @ApiPropertyOptional({
    description:
      "Also fetch each matched object's body (`data`, `format`). More expensive: prefer metadata-only discovery first for large result sets.",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  includeContent?: boolean;

  @ApiPropertyOptional({
    description: "Body format when `includeContent` is true: xml or json",
    enum: ["xml", "json"],
    default: "xml"
  })
  @IsOptional()
  @IsString()
  format?: string;

  @ApiPropertyOptional({
    description:
      "Also return the relationship edges (`links`) between the matched resources, i.e. a merged subgraph. Traversal then follows both edge directions.",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  includeEdges?: boolean;

  @ApiPropertyOptional({
    description: "Include source/target counts on each resource (graph mode)",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  countObjects?: boolean;

  @ApiPropertyOptional({
    description: "Include secondary targets in graph traversal (graph mode)",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  includeSecondaryTargets?: boolean;

  @ApiPropertyOptional({
    description: "Include secondary sources in graph traversal (graph mode)",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  includeSecondarySources?: boolean;
}

class GrowingObjectDto {
  @ApiProperty({
    description: "URI of the growing object (WellLog, MudLog, Trajectory, WellboreGeology, ...)",
    example: "eml:///dataspace('demo/drogon')/witsml21.WellboreGeology(7a4d2e91-6c05-4f38-9b12-8e0a1c3d5f60)"
  })
  @IsNotEmpty()
  @IsString()
  uri!: string;

  @ApiPropertyOptional({
    description:
      "Start index value. When given together with `endIndex` the matching parts are returned instead of the parts metadata. Depth-indexed objects: meters (e.g. 2500.0); time-indexed: microseconds since epoch."
  })
  @IsOptional()
  @IsNumber()
  startIndex?: number;

  @ApiPropertyOptional({
    description: "End index value. Same unit as startIndex (meters for depth, microseconds for time)."
  })
  @IsOptional()
  @IsNumber()
  endIndex?: number;

  @ApiPropertyOptional({
    description: "Include parts overlapping the range boundary (range mode)",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  includeOverlapping?: boolean;

  @ApiPropertyOptional({
    description:
      "Also return the channel (curve/mnemonic) metadata of the object: names, UOM, data kind, indexes, status. Requires ETP Protocol 21 on the store.",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  includeChannels?: boolean;
}

/**
 * Reject object URIs that do not identify a single data object (e.g. an
 * unresolved template `witsml21.WellLog({{guid}})` or `WellLog()`), so the
 * caller gets a 400 instead of an opaque ETP error from the store.
 */
export function requireObjectUri(uri: string): EtpUri {
  const parsed = new EtpUri(uri);
  const uuid = parsed.isValid ? parsed.uuid : "";
  if (!uuid || !new RegExp(EtpUri.uuidTokenPattern.source, "i").test(uuid)) {
    throw new BadRequestException(
      `uri must identify a data object with a UUID, got: ${uri}`
    );
  }
  return parsed;
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

const resourceSummarySchema = {
  type: "object",
  properties: {
    uri: { type: "string" },
    name: { type: "string" },
    sourceCount: { type: "number" },
    targetCount: { type: "number" },
    lastChanged: { type: "string", format: "date-time", nullable: true },
    storeLastWrite: { type: "string", format: "date-time", nullable: true },
    activeStatus: { type: "string" },
    customData: { type: "object", additionalProperties: true },
    format: {
      type: "string",
      enum: ["xml", "json"],
      description: "Only with includeContent"
    },
    data: {
      nullable: true,
      description:
        "Full object body: XML text, or the parsed object when format is json. Only with includeContent"
    }
  }
};

// Per-operation server override removed - inherits the global relative-path server.
const swaggerServers: any = undefined;

// ── Controller ───────────────────────────────────────────────────────────────

@Controller("query")
@ApiTags("Query")
@ApiBearerAuth("HTTPBearer")
@UseGuards(HasBearerGuard("jwt"))
@ApiHeader({
  name: "data-partition-id",
  description: "Data partition id (ex. 'osdu')",
  required: true,
  schema: { type: "string", example: "osdu", pattern: patternString(partitionPattern) }
})
@UseGuards(HasDataPartitionGuard())
@ApiUnauthorizedResponse(errorMessageSchema("Unauthorized", 401))
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many requests", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema("Unknown Error", 500))
@ApiDefaultResponse(errorMessageSchema("Unknown Error", 500))
export default class QueryController {
  /**
   * Discovery in one call: resource metadata, optionally with the object
   * bodies (`includeContent`) and/or the relationship edges (`includeEdges`).
   */
  @Post("resources/find")
  @HttpCode(200)
  @ApiOperation({
    summary: "Find resources (metadata, optionally content and graph edges)",
    description: `Search for resources below one or more URIs and return their metadata (URI, name, timestamps, relationship counts). Two switches extend the answer without a second round trip:

- **includeContent**: also fetch every matched object's body (\`data\` + \`format\`), i.e. Discovery + GetDataObjects. Use for bulk export or OSDU Storage ingestion; prefer metadata only for large result sets.
- **includeEdges**: also return the relationship \`links\` between the matched resources (a merged, deduplicated subgraph across all given \`uri\`s, traversed in both edge directions). Use for GraphQL-style deep search; split batches above ~100 URIs.

**uri**: \`eml:///dataspace('path/to/ds')\` for a dataspace root, or object URI(s) to search below specific objects. A list of URIs is processed sequentially in a single ETP session; a URI that fails to traverse is skipped (best effort).

**scope**: traversal direction - \`targets\` follows relationships forward (parent to child), \`sources\` backwards. **depth**: 1 = direct children, 2+ = recursive, 0 = unlimited (caution).

**modifiedSince**: ISO timestamp; only resources written after this time (incremental sync).

**Server support**: uses ETP DiscoveryQuery (Protocol 13) when the store negotiates it and falls back to Discovery (Protocol 3) otherwise, so it works against every store.`,
    servers: swaggerServers
  })
  @ApiOkResponse({
    description: "Matching resources; `links` only present when includeEdges is true",
    schema: {
      type: "object",
      properties: {
        resources: { type: "array", items: resourceSummarySchema },
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
  @ApiBody({ type: FindResourcesDto })
  public async findResources(
    @Body() body: FindResourcesDto,
    @Req() request?: express.Request
  ) {
    const uris = Array.isArray(body.uri) ? body.uri : [body.uri];
    if (uris.length === 0 || uris.some(u => typeof u !== "string" || !u)) {
      throw new BadRequestException({
        description: "uri must be a non-empty string or a list of non-empty strings"
      });
    }
    const scope = scopeFromString(body.scope);
    const depth = body.depth ?? 1;
    const dataObjectTypes = body.dataObjectTypes || [];
    const includeEdges = body.includeEdges ?? false;
    const storeLastWriteFilter = body.modifiedSince
      ? BigInt(new Date(body.modifiedSince).getTime() * 1000)
      : null;

    let c;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );

      const nodes = new Map<string, Resource>();
      const edges: Array<{ sourceUri: string; targetUri: string; path?: string }> = [];
      const seenEdges = new Set<string>();
      const useP13 =
        !includeEdges &&
        c.isProtocolSupported(Energistics.Etp.v12.Datatypes.Protocol.DiscoveryQuery);

      for (const uri of uris) {
        const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
          uri,
          depth,
          dataObjectTypes,
          navigableEdges: includeEdges
            ? Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both
            : Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Primary,
          includeSecondaryTargets: body.includeSecondaryTargets ?? false,
          includeSecondarySources: body.includeSecondarySources ?? false
        };
        try {
          if (includeEdges) {
            const graph: ResourceGraph = await c.getGraph(
              context,
              scope,
              body.countObjects ?? false,
              dataObjectTypes
            );
            for (const [nodeUri, resource] of graph.entries()) {
              if (!nodes.has(nodeUri)) {
                nodes.set(nodeUri, resource);
              }
            }
            for (const edge of graph.edges) {
              const key = `${edge.sourceUri}>${edge.targetUri}`;
              if (!seenEdges.has(key)) {
                seenEdges.add(key);
                edges.push(edge);
              }
            }
          } else {
            const found = useP13
              ? await c.discoveryQuery.findResources(context, scope, storeLastWriteFilter)
              : await c.discovery.getResources(
                  context,
                  scope,
                  body.countObjects ?? false,
                  storeLastWriteFilter
                );
            for (const r of found) {
              if (!nodes.has(r.uri)) {
                nodes.set(r.uri, r);
              }
            }
          }
        } catch (err) {
          if (uris.length === 1) {
            throw err;
          }
          logger.warn(`Resource search failed for URI ${uri}: ${err}`);
        }
      }

      const bodies = new Map<string, { format: string; data: unknown }>();
      if (body.includeContent && nodes.size > 0) {
        const asJson = body.format === "json";
        const objects = await c.getDataObjects([...nodes.keys()]);
        for (const o of objects) {
          if (!o) {
            continue;
          }
          const xml = o.data ? Buffer.from(o.data).toString("utf-8") : null;
          let data: unknown = xml;
          if (asJson && xml) {
            data = await xml2typescript(
              xml,
              new EtpUri(o.resource.uri).dataObjectType
            ).catch(err => {
              logger.warn(`xml2typescript failed for ${o.resource.uri}: ${err}`);
              return null;
            });
          }
          bodies.set(o.resource.uri, { format: asJson ? "json" : "xml", data });
        }
      }

      const resources = [...nodes.values()].map(r => ({
        uri: r.uri,
        name: r.name,
        sourceCount: r.sourceCount,
        targetCount: r.targetCount,
        lastChanged: toDate(r.lastChanged),
        storeLastWrite: toDate(r.storeLastWrite),
        activeStatus: r.activeStatus,
        customData: toJSonCustomData(r.customData) ?? {},
        ...(bodies.get(r.uri) ?? {})
      }));

      return includeEdges
        ? {
            resources,
            links: edges.map(e => ({
              source: e.sourceUri,
              target: e.targetUri,
              path: e.path
            }))
          }
        : { resources };
    } catch (err) {
      throw httpErrorFromEtpError(err);
    } finally {
      await c?.closeSession();
    }
  }

  /**
   * Growing object access: parts metadata, or the parts inside an index
   * range, optionally with the channel metadata.
   */
  @Post("growing")
  @HttpCode(200)
  @ApiOperation({
    summary: "Read a growing object: parts metadata or parts by index range, optionally with channel metadata (ETP Protocols 6 and 21)",
    description: `One call for growing objects (WellLog, MudLog, Trajectory, WellboreGeology):

- **no range**: returns the parts metadata (available index ranges, part UIDs) so you can discover which depth/time intervals exist.
- **startIndex + endIndex**: returns the parts inside that window (\`uid\` + decoded body). Depth indexes are meters, time indexes microseconds since epoch; the unit of measure is currently fixed to \`m\`. \`includeOverlapping\` also returns parts that straddle the boundaries.
- **includeChannels**: adds the channel (curve/mnemonic) metadata: names, UOM, data kind, indexes, status (ChannelSubscribe, Protocol 21).

**Typical workflow**: find the object URI via \`/query/resources/find\`, call this route without a range to see the intervals, then call it again with a range.

**Server support**: requires a store that negotiates ETP Protocol 6 (and 21 for \`includeChannels\`), e.g. open-etp-server; otherwise the gateway answers 501 Not Implemented.`,
    servers: swaggerServers
  })
  @ApiOkResponse({
    description: "`metadata` without a range, `parts` with a range; `channels` only with includeChannels",
    schema: {
      type: "object",
      properties: {
        metadata: { type: "array", items: { type: "object", additionalProperties: true } },
        parts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              uid: { type: "string" },
              data: { type: "string", nullable: true }
            }
          }
        },
        channels: {
          type: "array",
          items: {
            type: "object",
            properties: {
              channelId: { type: "string" },
              channelName: { type: "string" },
              uom: { type: "string" },
              dataKind: { type: "string" },
              channelClassUri: { type: "string" },
              status: { type: "string" },
              source: { type: "string" },
              indexes: { type: "array", items: { type: "object", additionalProperties: true } }
            }
          }
        }
      }
    }
  })
  @ApiBody({ type: GrowingObjectDto })
  public async growing(
    @Body() body: GrowingObjectDto,
    @Req() request?: express.Request
  ) {
    requireObjectUri(body.uri);
    const hasStart = body.startIndex !== undefined;
    const hasEnd = body.endIndex !== undefined;
    if (hasStart !== hasEnd) {
      throw new BadRequestException({
        description: "startIndex and endIndex must be supplied together"
      });
    }
    let c;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      requireProtocol(c, Energistics.Etp.v12.Datatypes.Protocol.GrowingObject);
      if (body.includeChannels) {
        requireProtocol(c, Energistics.Etp.v12.Datatypes.Protocol.ChannelSubscribe);
      }

      const out: Record<string, unknown> = {};
      if (hasStart) {
        const startIndex = new Energistics.Etp.v12.Datatypes.IndexValue();
        startIndex.item = { _double: body.startIndex as number, __keyName: "_double" };
        const endIndex = new Energistics.Etp.v12.Datatypes.IndexValue();
        endIndex.item = { _double: body.endIndex as number, __keyName: "_double" };
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
        out.parts = parts.map(p => ({
          uid: p.uid,
          data: p.data ? Buffer.from(p.data).toString("utf-8") : null
        }));
      } else {
        out.metadata = await c.growingObject.getPartsMetadata(body.uri);
      }

      if (body.includeChannels) {
        const metadata = await c.channelSubscribe.getChannelMetadata(body.uri);
        out.channels = metadata.map(ch => ({
          channelId: ch.id,
          channelName: ch.channelName,
          uom: ch.uom,
          dataKind: ch.dataKind,
          channelClassUri: ch.channelClassUri,
          status: ch.status,
          source: ch.source,
          indexes: ch.indexes
        }));
      }
      return out;
    } catch (err) {
      throw httpErrorFromEtpError(err);
    } finally {
      await c?.closeSession();
    }
  }
}
