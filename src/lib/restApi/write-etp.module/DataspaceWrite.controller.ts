// ============================================================================
// Copyright 2019-2022 Emerson Paradigm Holding LLC. All rights reserved.
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
  Delete,
  HttpCode,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiDefaultResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiInternalServerErrorResponse,
  ApiNoContentResponse,
  ApiNotAcceptableResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse
} from "@nestjs/swagger";

import {
  Matches,
  MaxLength,
  IsOptional,
  IsObject,
  IsString,
  IsNotEmpty
} from "class-validator";

import express from "express";

import {
  DataValue,
  Energistics,
  EtpUri,
  ResqmlClient
} from "../../client/ResqmlClient";

import Logging from "../../common/Logging";
const logger = Logging.getLogger("EtpClient");

import {
  FindInDataSpaceParams,
  HasDataPartitionGuard,
  HasBearerGuard,
  alphaSpaceSchema,
  createSession,
  dataspaceNamePattern,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  getSchemasForType,
  httpErrorFromEtpError,
  OptionalParseBoolPipe,
  patternString,
  swaggerServers,
  partitionPattern,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import {
  dataspacePathPattern,
  dataspaceUriPattern
} from "../read-etp.module/Resource.controller";

import { EtpDataValue } from "../../common/EtpTypes";

export class DataspaceDto {
  @ApiProperty({
    name: "DataspaceId",
    description: "Name of dataspace",
    type: "string",
    example: "demo/Volve",
    maxLength: 2048,
    pattern: patternString(dataspaceNamePattern)
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  @Matches(dataspaceNamePattern)
  DataspaceId!: string;

  @ApiProperty({
    name: "Path",
    description: "Path of dataspace",
    type: "string",
    example: "demo/Volve",
    maxLength: 2048,
    required: false,
    pattern: patternString(dataspacePathPattern)
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(dataspaceNamePattern)
  Path?: string;

  @ApiProperty({
    name: "CustomData",
    description: "Additional data",
    example: { key: "value" },
    type: "object",
    required: false,
    additionalProperties: alphaSpaceSchema
  } as any)
  @IsOptional()
  @IsObject()
  CustomData?: any;
}

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

/**
 * Creation and deletion of dataspaces
 *
 * @export
 * @class DataspaceMutationsAPI
 */
@ApiBearerAuth("HTTPBearer")
@UseGuards(HasBearerGuard("jwt"))
@ApiHeader({
  name: "data-partition-id",
  description: "Data partition id (ex. 'osdu')",
  schema: {
    type: "string",
    example: partitionId,
    maxLength: 1048,
    pattern: patternString(partitionPattern)
  }
})
@UseGuards(HasDataPartitionGuard())
@ApiTags("Write")
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("dataspaces")
export default class DataspaceMutationsAPI {
  /**
   * Create a new dataspace
   *
   * @memberof DataspaceMutationsAPI
   */
  @Post("")
  @HttpCode(200)
  @ApiOperation({
    summary: "Create new dataspaces",
    description: `Create one or more new dataspaces. Use path-style names (e.g., \`projectA/Scenario1\`) for organization.\n\n**CustomData**: Attach OSDU-relevant metadata (viewers, owners, legal tags) as key-value pairs. These are stored as ETP resource custom data and used during manifest generation.`,
    servers: swaggerServers
  })
  @ApiBody({
    description: "JSON array of Dataspace description",
    schema: {
      type: "array",
      maxItems: 10000,
      items: getSchemasForType(DataspaceDto)
    },
    examples: {
      "new scenario description": {
        value: [
          {
            DataspaceId: "projectA/Scenario1",
            Path: "projectA/Scenario1",
            CustomData: {
              viewers: ["data.default.viewers@osdu.example.com"],
              owners: ["data.default.owners@osdu.example.com"],
              legaltags: ["osdu-ReservoirDDMS-Legal-Tag"],
              otherRelevantDataCountries: ["US", "UK"],
              key: "value"
            }
          }
        ]
      }
    }
  })
  @ApiOkResponse({
    description: "Success",
    schema: {
      type: "array",
      maxItems: 1000,
      items: {
        type: "string",
        maxLength: 2048,
        pattern: patternString(dataspaceUriPattern)
      }
    }
  })
  public async PostDataspace(
    @Body() requestBody: DataspaceDto[],
    @Req() request?: express.Request
  ): Promise<string[]> {
    if (!Array.isArray(requestBody)) {
      throw new BadRequestException({
        description: "Invalid request body: expected an array of dataspaces"
      });
    }
    if (
      requestBody.some(
        item => typeof item !== "object" || item === null || Array.isArray(item)
      )
    ) {
      throw new BadRequestException({
        description: "Each element must be a valid dataspace object"
      });
    }
    if (
      requestBody.some(d => !d.DataspaceId || typeof d.DataspaceId !== "string")
    ) {
      throw new BadRequestException({
        description: "Each element must have a non-empty DataspaceId string"
      });
    }
    if (
      requestBody.some(
        d =>
          d.CustomData !== undefined &&
          (typeof d.CustomData !== "object" ||
            d.CustomData === null ||
            Array.isArray(d.CustomData))
      )
    ) {
      throw new BadRequestException({
        description: "Each element's CustomData must be a plain object"
      });
    }
    let c: ResqmlClient | undefined = undefined;
    try {
      const dataspaces: Energistics.Etp.v12.Datatypes.Object.Dataspace[] =
        requestBody.map(d => {
          const uri = EtpUri.createDataSpaceUri(d.DataspaceId).uri;
          const customData = new Map<string, DataValue>();
          if (d.CustomData) {
            for (const e in d.CustomData) {
              customData.set(e, EtpDataValue.fromUnknown(d.CustomData[e]));
            }
          }
          return {
            uri,
            path: d.Path ?? d.DataspaceId,
            customData,
            storeLastWrite: BigInt(Date.now()),
            storeCreated: BigInt(Date.now())
          };
        });
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      const projects = await c.createDataspaces(dataspaces);
      if (!projects) {
        throw new InternalServerErrorException("Unable to create Dataspaces");
      }
      await c.closeSession();
      logger.info("Dataspace(s) created successfully:", {
        dataspaces: dataspaces.map(d => d.uri)
      });
      return dataspaces.map(d => d.uri);
    } catch (err) {
      await c?.closeSession();
      logger.error("Error creating dataspaces:", err);
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Duplicate a dataspace
   *
   * @memberof DataspaceMutationsAPI
   */
  @Post(":dataspaceId/clone")
  @HttpCode(200)
  @ApiOperation({
    summary: "Clone (duplicate) a dataspace",
    description: `Create a copy of an existing dataspace with all its objects and arrays. Useful for creating scenario branches or snapshots.\n\n**Prerequisites**:\n- The source dataspace is automatically locked during the clone and unlocked afterwards.\n- The target dataspace (DataspaceId) must not already exist.\n\n**Object identity**: By default the clone is a server-side deep copy that **reuses the source object UUIDs**. The two dataspaces are independent stores, so editing the clone never affects the source — but the copied objects keep the *same identity* as the originals. That is fine for isolated sandbox/scenario work, but the shared UUIDs collide if the clone is later merged back or re-ingested into OSDU (the manifest builder derives each OSDU record id from the object UUID).\n\n**?reidentify** (default \`false\`): when set to \`true\`, after the copy every object in the clone is rewritten with brand new UUIDs, remapping the object's own identity, all of its Data Object References (DORs) and its array paths, and re-associating the arrays. Use \`reidentify=true\` when you need an independently publishable / re-ingestable copy. Leave it \`false\` (the default) for a fast snapshot that stays linked in identity to the source.\n\n**Note**: This is a server-side deep copy via ETP — no object or array data is transferred through the REST layer (re-identification streams array bytes through the gateway).`,
    servers: swaggerServers
  })
  @ApiBody({
    description: "New Dataspace description",
    schema: getSchemasForType(DataspaceDto),
    examples: {
      "New Scenario description": {
        value: {
          DataspaceId: "projectA/Scenario2",
          Path: "projectA/Scenario2",
          CustomData: {
            viewers: ["data.default.viewers@osdu.example.com"],
            owners: ["data.default.owners@osdu.example.com"],
            legaltags: ["osdu-ReservoirDDMS-Legal-Tag"],
            otherRelevantDataCountries: ["US", "UK"],
            key: "value"
          }
        }
      }
    }
  })
  @ApiOkResponse({
    description: "Success",
    schema: {
      type: "string",
      maxLength: 2048,
      pattern: patternString(dataspaceUriPattern)
    }
  })
  @ApiQuery({
    name: "reidentify",
    required: false,
    type: Boolean,
    description:
      "When true, mint new UUIDs for every object in the clone and remap all references/arrays so the copy is an independent, re-ingestable dataset. Defaults to false (the clone reuses the source object UUIDs)."
  })
  public async CloneDataspace(
    @Param() params: FindInDataSpaceParams,
    @Body() requestBody: DataspaceDto,
    @Query("reidentify", OptionalParseBoolPipe) reidentify = false,
    @Req() request?: express.Request
  ): Promise<string> {
    if (
      typeof requestBody !== "object" ||
      requestBody === null ||
      Array.isArray(requestBody)
    ) {
      throw new BadRequestException({
        description: "Request body must be a dataspace object"
      });
    }
    if (
      !requestBody.DataspaceId ||
      typeof requestBody.DataspaceId !== "string"
    ) {
      throw new BadRequestException({
        description: "DataspaceId is required"
      });
    }
    if (
      requestBody.CustomData !== undefined &&
      (typeof requestBody.CustomData !== "object" ||
        requestBody.CustomData === null ||
        Array.isArray(requestBody.CustomData))
    ) {
      throw new BadRequestException({
        description: "CustomData must be a plain object"
      });
    }
    let c: ResqmlClient | undefined = undefined;
    try {
      const customData = new Map<string, DataValue>();
      if (requestBody.CustomData) {
        for (const e in requestBody.CustomData) {
          customData.set(
            e,
            EtpDataValue.fromUnknown(requestBody.CustomData[e])
          );
        }
      }
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      const uri = EtpUri.createDataSpaceUri(params.dataspaceId).uri;

      // Lock the source dataspace before cloning (ETP requires it read-only)
      await c.lockDataspaces([uri]);
      try {
        const dataspaces = await c.cloneDataspace(
          requestBody.DataspaceId,
          requestBody.Path ?? requestBody.DataspaceId,
          uri,
          customData,
          reidentify
        );
        if (!dataspaces) {
          throw new NotFoundException({
            description: `Source dataspace ${params.dataspaceId} not found or not clonable`
          });
        }
        return EtpUri.createDataSpaceUri(requestBody.DataspaceId).uri;
      } finally {
        // Always unlock the source dataspace, even if clone fails
        try {
          await c.unlockDataspaces([uri]);
        } catch (unlockErr) {
          logger.error("Failed to unlock source dataspace after clone:", unlockErr);
        }
        try {
          await c.closeSession();
        } catch {
          // ignore close errors
        }
        c = undefined;
      }
    } catch (err) {
      try {
        await c?.closeSession();
      } catch (closeError) {
        logger.error("Could not successfully close connection.");
      }
      logger.error("Error cloning dataspace:", err);
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Delete dataspace
   *
   * @memberof MutationsAPI
   */
  @Delete(":dataspaceId")
  @ApiNoContentResponse()
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete a dataspace",
    description: `Delete a dataspace and all its contents. Returns 403 if the dataspace is locked - unlock it first.`,
    servers: swaggerServers
  })
  public async DeleteDataspace(
    @Param() params: FindInDataSpaceParams,
    @Req() request?: express.Request
  ): Promise<void> {
    let c: ResqmlClient | undefined = undefined;
    try {
      const uri = EtpUri.createDataSpaceUri(params.dataspaceId).uri;
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      await c.deleteDataspaces([uri]);
      await c.closeSession();
      logger.info("Dataspace deleted successfully:", { uri });
    } catch (err) {
      await c?.closeSession();
      logger.error("Error deleting dataspace:", err);
      throw httpErrorFromEtpError(err);
    }
  }
}
