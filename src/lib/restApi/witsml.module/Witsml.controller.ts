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
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse
} from "@nestjs/swagger";

import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength
} from "class-validator";

import express from "express";

import {
  Energistics,
  EtpUri,
  ResqmlClient,
  byteToString
} from "../../client/ResqmlClient";

import {
  HasBearerGuard,
  HasDataPartitionGuard,
  createSession,
  dataspaceNamePattern,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  httpErrorFromEtpError,
  patternString,
  swaggerServers,
  partitionPattern
} from "../ControllerUtils";

import logging from "../../common/Logging";
const logger = logging.getLogger("EtpClient");

// ─── DTOs ────────────────────────────────────────────────────────────────────

class WitsmlQueryDto {
  @ApiProperty({
    description: "Target dataspace path (e.g., 'maap/witsml', 'demo/drogon'). Must be an existing dataspace on the ETP server.",
    example: "maap/witsml"
  })
  @IsString()
  @IsNotEmpty()
  @Matches(dataspaceNamePattern)
  @MaxLength(256)
  dataspace!: string;

  @ApiProperty({
    description: "Filter by ETP object type name (case-insensitive). Omit to return all objects. Common values: Well, Wellbore, WellLog, Trajectory, ChannelSet, WellboreGeology",
    required: false,
    example: "Well"
  })
  @IsOptional()
  @IsString()
  objectType?: string;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags("WITSML")
@Controller("witsml")
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
export default class WitsmlController {
  /**
   * Query WITSML objects from a dataspace, optionally filtered by type.
   */
  @Post("query")
  @HttpCode(200)
  @ApiOperation({
    summary: "Query WITSML objects with full XML content",
    description:
      "Retrieves all WITSML 2.1 / EnergyML objects from a dataspace, returning the full XML body for each. " +
      "Optionally filter by object type (Well, Wellbore, WellLog, Trajectory, etc.).\n\n" +
      "**Use case**: Fetch raw WITSML XML for external processing, validation, or conversion.\n\n" +
      "**Note**: For large dataspaces this may return significant data. " +
      "Use `objectType` filter to limit results. For metadata-only listing, use `GET /witsml/{dataspaceId}/objects` instead.",
    servers: swaggerServers
  })
  @ApiBody({ type: WitsmlQueryDto })
  @ApiOkResponse({ description: "Object array with full XML content and metadata (uri, objectType, uuid, name, xml, lastChanged)" })
  @ApiNotFoundResponse({ description: "Dataspace not found or not accessible" })
  async queryWitsmlObjects(
    @Body() body: WitsmlQueryDto,
    @Req() request: express.Request
  ) {
    const { dataspace, objectType } = body;
    let c: ResqmlClient | undefined;

    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );

      const dataspaceUri = `eml:///dataspace('${dataspace}')`;

      // Get the table of contents for the dataspace
      const resources = await c.getResources(
        dataspaceUri,
        Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.targets
      );

      // Filter by object type if specified
      let filtered = resources;
      if (objectType) {
        const typeLC = objectType.toLowerCase();
        filtered = resources.filter(r => {
          const etpUri = new EtpUri(r.uri);
          return etpUri.objectType?.toLowerCase() === typeLC;
        });
      }

      // Fetch full data objects
      if (filtered.length === 0) {
        await c.closeSession();
        return { objects: [], count: 0 };
      }

      const uris = filtered.map(r => r.uri);
      const dataObjects = await c.getDataObjects(uris);
      await c.closeSession();

      const results = dataObjects
        .filter(obj => obj !== null)
        .map(obj => {
          const etpUri = new EtpUri(obj!.resource.uri);
          return {
            uri: obj!.resource.uri,
            objectType: etpUri.objectType,
            uuid: etpUri.uuid,
            name: obj!.resource.name,
            xml: byteToString(obj!.data),
            lastChanged: obj!.resource.lastChanged
              ? new Date(
                Number(BigInt(obj!.resource.lastChanged) / BigInt(1000))
              ).toISOString()
              : null
          };
        });

      return { objects: results, count: results.length };
    } catch (err) {
      await c?.closeSession();
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Get WITSML objects by type from a dataspace (convenience GET endpoint).
   */
  @Get(":dataspaceId/objects")
  @ApiOperation({
    summary: "List WITSML objects in a dataspace (metadata only)",
    description:
      "Returns a lightweight listing of all objects in a dataspace without fetching XML content. " +
      "Use `type` query parameter to filter by WITSML object type.\n\n" +
      "**dataspaceId format**: URL-encoded dataspace path, e.g., `maap%2Fwitsml` for `maap/witsml`.\n\n" +
      "**Difference from POST /witsml/query**: This endpoint returns only metadata (uri, name, type, timestamp) " +
      "and is much faster for large dataspaces. Use POST /witsml/query when you need the full XML body.",
    servers: swaggerServers
  })
  @ApiQuery({
    name: "type",
    required: false,
    description: "Filter by ETP object type name (case-insensitive). Examples: Well, Wellbore, WellLog, Trajectory, ChannelSet",
    schema: { type: "string" },
    example: "Well"
  })
  @ApiOkResponse({ description: "Object metadata array (uri, objectType, uuid, name, lastChanged) with count" })
  async listWitsmlObjects(
    @Param("dataspaceId") dataspaceId: string,
    @Query("type") objectType: string | undefined,
    @Req() request: express.Request
  ) {
    let c: ResqmlClient | undefined;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );

      const dataspaceUri = `eml:///dataspace('${dataspaceId}')`;
      const resources = await c.getResources(
        dataspaceUri,
        Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.targets
      );

      let filtered = resources;
      if (objectType) {
        const typeLC = objectType.toLowerCase();
        filtered = resources.filter(r => {
          const etpUri = new EtpUri(r.uri);
          return etpUri.objectType?.toLowerCase() === typeLC;
        });
      }

      await c.closeSession();

      return {
        objects: filtered.map(r => {
          const etpUri = new EtpUri(r.uri);
          return {
            uri: r.uri,
            objectType: etpUri.objectType,
            uuid: etpUri.uuid,
            name: r.name,
            lastChanged: r.lastChanged
              ? new Date(
                Number(BigInt(r.lastChanged) / BigInt(1000))
              ).toISOString()
              : null
          };
        }),
        count: filtered.length
      };
    } catch (err) {
      await c?.closeSession();
      throw httpErrorFromEtpError(err);
    }
  }
}
