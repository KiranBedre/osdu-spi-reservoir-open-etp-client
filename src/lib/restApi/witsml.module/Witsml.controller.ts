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
    description: "Target dataspace path",
    example: "maap/witsml"
  })
  @IsString()
  @IsNotEmpty()
  @Matches(dataspaceNamePattern)
  @MaxLength(256)
  dataspace!: string;

  @ApiProperty({
    description: "Object type filter (e.g. Well, Wellbore, WellboreGeology)",
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
    summary: "Query WITSML objects",
    description:
      "Retrieve WITSML 2.1 objects from a dataspace. " +
      "Optionally filter by object type (Well, Wellbore, WellLog, etc.).",
    servers: swaggerServers
  })
  @ApiBody({ type: WitsmlQueryDto })
  @ApiOkResponse({ description: "WITSML objects returned" })
  @ApiNotFoundResponse({ description: "Dataspace not found" })
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
    summary: "List WITSML objects in a dataspace",
    description: "List all WITSML/EnergyML objects in a dataspace, optionally filtered by type.",
    servers: swaggerServers
  })
  @ApiQuery({
    name: "type",
    required: false,
    description: "Filter by object type (e.g. Well, Wellbore, WellLog)",
    schema: { type: "string" }
  })
  @ApiOkResponse({ description: "Object list" })
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
