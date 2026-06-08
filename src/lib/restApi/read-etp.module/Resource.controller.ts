/* eslint-disable no-useless-escape */
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
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";

import { Type } from "class-transformer";

import {
  ApiBearerAuth,
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
  ApiQuery,
  ApiQueryOptions,
  ApiResponseOptions,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse
} from "@nestjs/swagger";

import {
  Energistics,
  EtpUri,
  Integer32,
  Resource
} from "../../client/ResqmlClient";

import type { SupportedType } from "../../client/ResqmlClient";

import {
  FindInDataSpaceParams,
  FindInObjectParams,
  FindInTypeParams,
  HasBearerGuard,
  HasDataPartitionGuard,
  OptionalParseBoolPipe,
  OptionalParseDatePipe,
  OptionalParseIntPipe,
  alphaSpaceSchema,
  createSession,
  dataObjectTypePattern,
  dataObjectTypeRegexp,
  dataObjectTypesPattern,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  findResources,
  getSchemasForType,
  graphResources,
  httpErrorFromEtpError,
  partitionPattern,
  patternString,
  sliceArray,
  swaggerServers,
  toDate,
  toJSonCustomData,
  transactionIdQueryParam,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import express from "express";
import {
  IsDate,
  IsDateString,
  IsInt,
  Matches,
  MaxLength
} from "class-validator";

import { ResourceGraph } from "../../common/ResponseHandlers";
import { ErrorCode, EtpError } from "../../common/EtpTypes";
import logging from "../../common/Logging";

const logger = logging.getLogger("EtpClient");

export const uriPattern =
  /^(?<protocol>(?:[^:]+)s?)?:\/\/(?:(?<user>[^:\n\r]+):(?<pass>[^@\n\r]+)@)?(?<host>(?:www\.)?(?:[^:\/\n\r]+))(?::(?<port>\d+))?\/?(?<request>[^?#\n\r]+)?\??(?<query>[^#\n\r]*)?\#?(?<anchor>[^\n\r]*)?$/;

export const emlUriPattern =
  /^(?:eml:\/\/\/|^eml:\/\/\/dataspace\('[^'"]*?(?:''[^'"]*?)*'\)\/?)(witsml|resqml|prodml|eml)[1-9]\d\.\w+(?:\((?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|uuid=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12},version='[^']*?(?:''[^']*?)*')\))?$/;

export const dataspaceUriPattern =
  /^(?:eml:\/\/\/|^eml:\/\/\/dataspace\('[^'"]*?(?:''[^'"]*?)*'\))$/;

export const dataspacePathPattern = /^[^\r\n'"]+$/;

export const validNamePattern = /^[^\r\n]+$/;

export const versionPattern = /^[^\r\n]+$/;

export const datePattern =
  /^((?:(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:.\d+)?))(Z|[+-]\d{2}:\d{2})?)$/;

export const filterPattern = /^(?:(_data)|[0-9a-zA-Z /(),.]+|'.*')+$/;

export const pathPattern = /^[\w:\/]*$/;

/**
 * Data Transfer Object for Dataspace
 *
 * @export
 * @class DataspaceDto
 */
export class DataspaceDto {
  @ApiProperty({
    name: "uri",
    maxLength: 2048,
    pattern: patternString(dataspaceUriPattern),
    example: "eml:///dataspace('demo/Volve')"
  })
  @Matches(dataspaceUriPattern)
  uri!: string;
  @ApiProperty({
    name: "path",
    maxLength: 2048,
    pattern: patternString(dataspacePathPattern),
    example: "demo/Volve"
  })
  path!: string;
  @ApiProperty({
    name: "storeCreated",
    maxLength: 2048,
    pattern: patternString(datePattern),
    example: "2021-07-14T10:22:07.228Z"
  })
  @IsDateString()
  storeCreated!: Date;

  @ApiProperty({
    name: "storeLastWrite",
    maxLength: 2048,
    pattern: patternString(datePattern),
    example: "2021-09-06T16:06:31.000Z"
  })
  @IsDateString()
  storeLastWrite!: Date;

  @ApiProperty({
    name: "customData",
    type: "object",
    additionalProperties: alphaSpaceSchema,
    description: "Extra meta data associated to dataspace"
  })
  customData!: Record<string, any>;
}

/**
 * Data Transfer Object for Resource
 *
 * @class ResourceDto
 */
class ResourceDto {
  @ApiProperty({
    name: "uri",
    description: "Unique Resource Identifier of the resource",
    example: `eml:///dataspace('demo/Volve')/resqml20.obj_TriangulatedSetRepresentation(a3f31b20-c93a-4682-8f6c-71be087202a4)`,
    maxLength: 2048,
    pattern: patternString(emlUriPattern)
  })
  @Matches(emlUriPattern)
  @MaxLength(2048)
  uri!: string;

  @ApiProperty({
    name: "alternateUris",
    description: "Alternate uris of the resource",
    maxItems: 100000,
    maxLength: 2048,
    pattern: patternString(uriPattern)
  })
  @Matches(uriPattern)
  alternateUris?: string[];

  @ApiProperty({
    name: "name",
    description: "Resource title",
    example: "Depth_Hugin_Fm_Top_t",
    maxLength: 2048,
    pattern: patternString(validNamePattern)
  })
  @Matches(validNamePattern)
  name!: string;

  @ApiPropertyOptional({
    name: "sourceCount",
    description: "Number of objects referencing the resource",
    format: "integer",
    minimum: 0,
    maximum: 1000000
  })
  @IsInt()
  sourceCount?: Integer32;

  @ApiPropertyOptional({
    name: "targetCount",
    description: "Number of objects referenced by the resource",
    format: "integer",
    minimum: 0,
    maximum: 1000000
  })
  @IsInt()
  targetCount?: Integer32;

  @ApiPropertyOptional({
    name: "activeStatus",
    description: "Indicates if resource is active",
    example: "Active",
    enum: ["Active", "Inactive"]
  })
  activeStatus?: "Active" | "Inactive";

  @ApiProperty({
    name: "lastChanged",
    description: "Date of last modification",
    example: "2021-09-06T16:06:31.000Z",
    maxLength: 2048
  })
  @Type(() => Date)
  @IsDate()
  lastChanged!: Date;

  @ApiProperty({
    name: "storeCreated",
    description: "Date of first entry in data store",
    example: "2021-09-14T20:25:17.128Z",
    maxLength: 2048
  })
  @Type(() => Date)
  @IsDate()
  storeCreated!: Date;

  @ApiProperty({
    name: "storeLastWrite",
    description: "Date of last entry in data store",
    example: "2021-09-14T20:26:16.128Z",
    maxLength: 2048
  })
  @Type(() => Date)
  @IsDate()
  storeLastWrite!: Date;

  @ApiProperty({
    name: "customData",
    description: "Extra meta data associated to resource",
    additionalProperties: alphaSpaceSchema
  })
  customData!: Record<string, string | Date>;
}

// DTO for ResourceGraph edges
class EdgeDto {
  @ApiProperty({
    name: "source",
    description: "Source resource uri",
    example:
      "eml:///dataspace('demo/Volve')/resqml20.obj_TriangulatedSetRepresentation(a3f31b20-c93a-4682-8f6c-71be087202a4)",
    maxLength: 2048,
    pattern: patternString(emlUriPattern)
  })
  @Matches(emlUriPattern)
  @MaxLength(2048)
  source!: string;

  @ApiProperty({
    name: "target",
    description: "Target resource uri",
    example:
      "eml:///dataspace('demo/Volve')/resqml20.obj_TriangulatedSetRepresentation(a3f31b20-c93a-4682-8f6c-71be087202a4)",
    maxLength: 2048,
    pattern: patternString(pathPattern)
  })
  @Matches(emlUriPattern)
  @MaxLength(2048)
  target!: string;

  @ApiProperty({
    name: "path",
    description: "Path inside the source referencing the target",
    example:
      "rsq22:Geometry/rsq22:Points/rsq22:SupportingGeometry/rsq22:SupportingRepresentation",
    maxLength: 2048,
    pattern: patternString(emlUriPattern)
  })
  @Matches(emlUriPattern)
  @MaxLength(2048)
  path?: string;
}

// DTO for ResourceGraph
class ResourceGraphDto {
  @ApiProperty({
    name: "resources",
    description: "List of resources",
    type: [ResourceDto],
    maxItems: 256,
    additionalProperties: false
  })
  resources!: ResourceDto[];

  @ApiProperty({
    name: "links",
    description: "List of links",
    type: [EdgeDto],
    maxItems: 256,
    additionalProperties: false
  })
  links!: EdgeDto[];
}

// Schema for response returning resources successfully
const resourceResponse: ApiResponseOptions = {
  description: "Success",
  schema: {
    type: "array",
    maxItems: 256,
    additionalProperties: false,
    items: getSchemasForType(ResourceDto)
  }
};

/**
 * Convert from Avro type to JSON presentation type
 *
 * @param {Energistics.Etp.v12.Datatypes.Object.Dataspace} d
 * @returns {DataspaceDto}
 */
const toJSonDataspace = (
  d: Energistics.Etp.v12.Datatypes.Object.Dataspace
): DataspaceDto => {
  return {
    ...d,
    storeCreated: toDate(d.storeCreated),
    storeLastWrite: toDate(d.storeLastWrite),
    customData: toJSonCustomData(d.customData) ?? {}
  };
};

/**
 * Convert from Avro type to JSON presentation type
 *
 * @param {Energistics.Etp.v12.Datatypes.Object.Resource} d
 * @returns {ResourceDto}
 */
const toJSonResource = (
  d: Energistics.Etp.v12.Datatypes.Object.Resource
): ResourceDto => {
  return {
    ...d,
    sourceCount: d.sourceCount === null ? undefined : d.sourceCount,
    targetCount: d.targetCount === null ? undefined : d.targetCount,
    activeStatus:
      d.activeStatus ===
      Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind.Inactive
        ? "Inactive"
        : "Active",
    lastChanged: toDate(d.lastChanged),
    storeCreated: toDate(d.storeCreated),
    storeLastWrite: toDate(d.storeLastWrite),
    customData: toJSonCustomData(d.customData) ?? {}
  };
};

/**
 * Send the resource content.
 * Also do client side pagination since server does not support it yet.
 *
 * @param {number | undefined} start Index of the first element to send
 * @param {number | undefined} count Number element to send
 * @param {Resource[]} resources
 */
const sendResources = (
  start: number | undefined,
  count: number | undefined,
  resources: Resource[]
): ResourceDto[] =>
  sliceArray<Resource>(start, count, resources).map(r => toJSonResource(r));

/**
 * Extract a window of resources from the graph and send them as a DTO
 * also send links between resources when the links source is in the resource window
 * @param {number | undefined} start first element to send
 * @param {number | undefined} count number of elements to send
 * @param {ResourceGraph} graph full graph
 * @returns {ResourceGraphDto} part of graph to send as a DTO
 */
const sendGraph = (
  start: number | undefined,
  count: number | undefined,
  graph: ResourceGraph
): ResourceGraphDto => {
  // convert resource.values into an array
  const resources = sliceArray<Resource>(start, count, [...graph.values()]);
  const uris = resources.map(r => r.uri);

  const edges = graph.edges.filter(e => uris.includes(e.sourceUri));
  return {
    resources: resources.map(r => toJSonResource(r)),
    links: edges.map(e => ({
      source: e.sourceUri,
      target: e.targetUri,
      path: e.path
    }))
  };
};

/**
 * Data Object Transfer for Type Count
 *
 * @export
 * @class TypeCount
 */
export class TypeCountDto {
  @ApiProperty({
    name: "name",
    example: "resqml20.obj_TriangulatedSetRepresentation",
    maxLength: 2048,
    pattern: patternString(dataObjectTypePattern)
  })
  name!: string;

  @ApiProperty({
    name: "count",
    type: "number",
    format: "integer",
    minimum: 1,
    maximum: 1000000,
    example: 2
  })
  @IsInt()
  count!: number;
}

export const skipQueryParam: ApiQueryOptions = {
  name: "$skip",
  required: false,
  description: "ODATA Pagination: Index of first item returned. [0..100000]",
  example: 0,
  schema: {
    type: "number",
    format: "integer",
    minimum: 0,
    maximum: 100000
  }
};

export const topQueryParam: ApiQueryOptions = {
  name: "$top",
  required: false,
  description: "ODATA Pagination: Maximum number of items returned. [1..10000]",
  example: 10,
  schema: {
    type: "number",
    format: "integer",
    minimum: 1,
    maximum: 10000
  }
};

export const filterQueryParam: ApiQueryOptions = {
  name: "$filter",
  required: false,
  description: "ODATA filter using XPath syntax",
  example:
    "SupportingRepresentation/_data/RepresentedInterpretation/_data/InterpretedFeature/_data/Citation/Title eq 'Hugin_Fm_Top' and PropertyKind/LocalPropertyKind/Title eq 'Horizontal_Length'",
  schema: {
    type: "string",
    maxLength: 2048,
    pattern: patternString(filterPattern)
  }
};

export const storeLastWriteFilterQueryParam: ApiQueryOptions = {
  name: "storeLastWriteFilter",
  required: false,
  description:
    "If present, only the object modified after given date will be listed.",
  schema: {
    type: "string",
    format: "date-time",
    maxLength: 2048,
    pattern: patternString(datePattern)
  }
};

export const dataObjectTypesQueryParam: ApiQueryOptions = {
  name: "dataObjectTypes",
  required: false,
  description:
    "If present, only objects with given types will be listed. Provided as comma separated list.",
  example:
    "resqml20.obj_TriangulatedSetRepresentation,resqml20.obj_ContinuousProperty",
  schema: {
    type: "string",
    pattern: patternString(dataObjectTypesPattern),
    maxLength: 8192
  }
};

export const countObjectsQueryParam: ApiQueryOptions = {
  name: "countObjects",
  required: false,
  description:
    "If true, the source and target count will be computed for each resource.",
  schema: {
    type: "boolean",
    default: false
  }
};

export const versionQueryParam: ApiQueryOptions = {
  name: "version",
  required: false,
  description: "Optional version of the object",
  schema: {
    type: "string",
    pattern: "^[^']*?(?:''[^']*?)*$",
    maxLength: 2048
  }
};

export const depthQueryParam: ApiQueryOptions = {
  name: "depth",
  required: false,
  description:
    "If present, indicate the number of recursive levels when looking for relations",
  example: 10,
  schema: {
    type: "number",
    format: "integer",
    minimum: 1,
    maximum: 1000
  }
};

/**
 * Query parameter to indicate if secondary targets should be included in the response
 * @export
 * @class IncludeSecondaryTargetsQueryParam
 * @extends {ApiQueryOptions}
 */
export const includeSecondaryTargetsQueryParam: ApiQueryOptions = {
  name: "includeSecondaryTargets",
  required: false,
  description:
    "If present, indicate that secondary targets should be included in the response",
  type: "boolean",
  example: false
};

/**
 * Query parameter to indicate if secondary sources should be included in the response
 * @export
 * @class IncludeSecondarySourcesQueryParam
 * @extends {ApiQueryOptions}
 */
export const includeSecondarySourcesQueryParam: ApiQueryOptions = {
  name: "includeSecondarySources",
  required: false,
  description:
    "If present, indicate that secondary sources should be included in the response",
  type: "boolean",
  example: false
};

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

/**
 * Api for resources access
 *
 * @export
 * @class ResourcesReadAPI
 */
@ApiBearerAuth("access-token")
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
@ApiTags("Resources")
@ApiUnauthorizedResponse(errorMessageSchema("Unauthorized", 401))
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many requests", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("dataspaces")
export default class ResourcesReadAPI {
  /**
   * Get the list of dataspaces in the server
   *
   * @memberof ResourcesReadAPI
   */
  @Get("")
  @ApiOkResponse({
    description: "Success",
    schema: {
      type: "array",
      maxItems: 256,
      additionalProperties: false,
      items: getSchemasForType(DataspaceDto)
    }
  })
  @ApiQuery(skipQueryParam)
  @ApiQuery(topQueryParam)
  @ApiQuery(storeLastWriteFilterQueryParam)
  @ApiOperation({
    summary: "List dataspaces.",
    description: `List the dataspaces available in a server. Output can be paginated.`,
    servers: swaggerServers
  })
  public async ListDataspaces(
    @Query("$skip", OptionalParseIntPipe) skip?: number,
    @Query("$top", OptionalParseIntPipe) top?: number,
    @Query("storeLastWriteFilter", OptionalParseDatePipe)
    storeLastWriteFilter?: Date,
    @Req() request?: express.Request
  ): Promise<Array<DataspaceDto>> {
    logger.info("Received request to list dataspaces.");
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      logger.info("Session created successfully.");

      logger.info("Fetching dataspaces...");
      const projects = await c.getDataspaces(
        storeLastWriteFilter
          ? BigInt(storeLastWriteFilter.getTime()) * BigInt(1000)
          : undefined
      );
      logger.info("Dataspaces fetched successfully.");

      const pros = projects
        ? sliceArray<Energistics.Etp.v12.Datatypes.Object.Dataspace>(
            skip,
            top,
            projects
          ).map(p => toJSonDataspace(p))
        : [];
      logger.info("Dataspaces processed");

      logger.info("Closing session...");
      await c.closeSession();
      c = undefined;
      logger.info("Session closed successfully.");
      return pros;
    } catch (err) {
      logger.error(`Error occurred while listing dataspaces: ${err}`);
      await c?.closeSession();
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Get Info about a dataset
   *
   * @memberof ResourcesReadAPI
   */
  @Get(":dataspaceId/info")
  @ApiOkResponse({
    description: "Success",
    type: DataspaceDto
  })
  @ApiOperation({
    summary: "Get info on a dataspace.",
    description: `Get all information bout explicit dataspace.`,
    servers: swaggerServers
  })
  public async GetDataspaceInfo(
    @Param() params: FindInDataSpaceParams,
    @Req() request?: express.Request
  ): Promise<DataspaceDto> {
    logger.info(
      `Received request to get info for dataspace: ${params.dataspaceId}`
    );
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      logger.info("Session created successfully.");
      const uri = EtpUri.createDataSpaceUri(params.dataspaceId);
      logger.debug(`Generated URI for dataspace: ${uri.uri}`);
      logger.info("Fetching dataspace info...");
      const info = await c.getDataspaceInfo([uri.uri]);
      logger.info("Dataspace info fetched successfully.");
      logger.info("Closing session...");
      await c.closeSession();
      c = undefined;
      logger.info("Session closed successfully.");

      if (info.length !== 1 || info[0] === null) {
        logger.warning(`Dataspace ${params.dataspaceId} not found.`);
        throw new EtpError(
          `Dataspace ${params.dataspaceId} not found`,
          ErrorCode.ENOT_FOUND
        );
      }

      return toJSonDataspace(info[0]);
    } catch (err) {
      logger.error(
        `Error occurred while fetching info for dataspace ${params.dataspaceId}: ${err}`
      );
      await c?.closeSession();
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Lock a dataspace
   *
   * @memberof ResourcesReadAPI
   */
  @Post(":dataspaceId/lock")
  @ApiOkResponse({
    description: "Success",
    type: Boolean
  })
  @ApiOperation({
    summary: "Lock a dataspace.",
    description: `Set a dataspace read-only.`,
    servers: swaggerServers
  })
  public async LockDataspace(
    @Param() params: FindInDataSpaceParams,
    @Req() request?: express.Request
  ): Promise<boolean> {
    logger.info(`Received request to lock dataspace: ${params.dataspaceId}`);
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      logger.info("Session created successfully.");
      const uri = EtpUri.createDataSpaceUri(params.dataspaceId);
      logger.info("Locking dataspace...");
      const success = await c.lockDataspaces([uri.uri]);
      logger.info("Dataspace locked successfully.");
      logger.info("Closing session...");
      await c.closeSession();
      c = undefined;
      logger.info("Session closed successfully.");

      if (!success) {
        logger.warning(`Dataspace ${params.dataspaceId} not found.`);
        throw new EtpError(
          `Dataspace ${params.dataspaceId} not found`,
          ErrorCode.ENOT_FOUND
        );
      }

      return success;
    } catch (err) {
      logger.error(
        `Error occurred while locking dataspace ${params.dataspaceId}: ${err}`
      );
      await c?.closeSession();
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Unlock a dataspace
   *
   * @memberof ResourcesReadAPI
   */
  @Delete(":dataspaceId/lock")
  @ApiOkResponse({
    description: "Success",
    type: Boolean
  })
  @ApiOperation({
    summary: "Unlock a dataspace.",
    description: `Set a dataspace read-write.`,
    servers: swaggerServers
  })
  public async UnlockDataspace(
    @Param() params: FindInDataSpaceParams,
    @Req() request?: express.Request
  ): Promise<boolean> {
    logger.info(`Received request to unlock dataspace: ${params.dataspaceId}`);
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      logger.info("Session created successfully.");
      const uri = EtpUri.createDataSpaceUri(params.dataspaceId);
      logger.debug(`Generated URI for dataspace: ${uri.uri}`);
      logger.info("Unlocking dataspace...");
      const success = await c.unlockDataspaces([uri.uri]);
      logger.info("Dataspace unlocked successfully.");
      logger.info("Closing session...");
      await c.closeSession();
      c = undefined;
      logger.info("Session closed successfully.");

      if (!success) {
        logger.warning(`Dataspace ${params.dataspaceId} not found.`);
        throw new EtpError(
          `Dataspace ${params.dataspaceId} not found`,
          ErrorCode.ENOT_FOUND
        );
      }

      return success;
    } catch (err) {
      logger.error(
        `Error occurred while unlocking dataspace ${params.dataspaceId}: ${err}`
      );
      await c?.closeSession();
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * List of types available in a dataset
   *
   * @memberof ResourcesReadAPI
   */
  @Get(":dataspaceId/resources")
  @ApiQuery(skipQueryParam)
  @ApiQuery(topQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiOkResponse({
    description: "Success",
    schema: {
      type: "array",
      maxItems: 256,
      additionalProperties: false,
      items: getSchemasForType(TypeCountDto)
    }
  })
  @ApiOperation({
    summary: "List types inside a dataspace.",
    description: `List the types present in the dataspace, and the number of items for each type.`,
    servers: swaggerServers
  })
  public async ListTypes(
    @Param() params: FindInDataSpaceParams,
    @Query("$skip", OptionalParseIntPipe) skip?: number,
    @Query("$top", OptionalParseIntPipe) top?: number,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<TypeCountDto[] | null> {
    logger.info(
      `Received request to list types for dataspace: ${params.dataspaceId}`
    );
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      logger.info("Session created successfully.");
      logger.info("Fetching dataspace types...");
      const types = await c.getDataspaceTypes(
        EtpUri.createDataSpaceUri(params.dataspaceId).uri
      );
      logger.info("Dataspace types fetched successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
      c = undefined;
      const result = sliceArray<SupportedType>(skip, top, types).map(r => {
        return {
          name: r.dataObjectType,
          count: r.objectCount ?? 0
        };
      });
      logger.info("Result generated successfully.");
      return result;
    } catch (err) {
      logger.error(
        `Error occurred while listing types for dataspace ${params.dataspaceId}: ${err}`
      );
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * List of resources (data objects) available in a dataset
   *
   * @memberof ResourcesReadAPI
   */
  @Get(":dataspaceId/resources/all")
  @ApiQuery(skipQueryParam)
  @ApiQuery(topQueryParam)
  @ApiQuery(filterQueryParam)
  @ApiQuery(storeLastWriteFilterQueryParam)
  @ApiQuery(dataObjectTypesQueryParam)
  @ApiQuery(countObjectsQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiOkResponse(resourceResponse)
  @ApiOperation({
    summary: "List all resources.",
    description: `List all resources in a dataspaces.
    Output can be paginated and filtered by types, content, last update time.`,
    servers: swaggerServers
  })
  public async ListResources(
    @Param() params: FindInDataSpaceParams,
    @Query("$skip", OptionalParseIntPipe) skip?: number,
    @Query("$top", OptionalParseIntPipe) top?: number,
    @Query("$filter") filter?: string,
    @Query("storeLastWriteFilter", OptionalParseDatePipe)
    storeLastWriteFilter?: Date,
    @Query("dataObjectTypes") dataObjectTypes?: string,
    @Query("countObjects", OptionalParseBoolPipe) countObjects = false,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<ResourceDto[] | null> {
    logger.info(
      `Received request to list resources for dataspace: ${params.dataspaceId}`
    );
    const query = {
      top,
      skip,
      filter
    };
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      logger.info("Session created successfully.");
      logger.info("Fetching resources...");
      const resources = await findResources(
        c,
        {
          uri: EtpUri.createDataSpaceUri(params.dataspaceId).uri,
          depth: 1,
          dataObjectTypes: dataObjectTypes ? dataObjectTypes.split(",") : [],
          navigableEdges: "Both"
        },
        query,
        "self",
        countObjects,
        storeLastWriteFilter
      );
      logger.info("Resources fetched successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
      c = undefined;
      const result = sendResources(skip, top, resources);
      logger.info("Processed resources successfully.");
      return result;
    } catch (err) {
      logger.error(
        `Error occurred while listing resources for dataspace ${params.dataspaceId}: ${err}`
      );
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Graph resources (data objects) available in a dataset
   * @param params - The parameters to find resources
   * @param skip - The number of items to skip
   * @param top - The number of items to return
   * @param filter - The filter to apply
   * @param storeLastWriteFilter - The last write time filter to apply
   * @param dataObjectTypes - The data object types to filter
   * @param countObjects - If true, the source and target count will be computed for each resource
   * @param request - The express request
   * @returns The resources graph (resources and links)
   * @memberof ResourcesReadAPI
   */
  @Get(":dataspaceId/graph/all")
  @ApiQuery(skipQueryParam)
  @ApiQuery(topQueryParam)
  @ApiQuery(filterQueryParam)
  @ApiQuery(storeLastWriteFilterQueryParam)
  @ApiQuery(dataObjectTypesQueryParam)
  @ApiQuery(countObjectsQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiOkResponse(resourceResponse)
  @ApiOperation({
    summary: "Graph all resources.",
    description: `Create a graph for all resources in a dataspaces.
    Output can be paginated and filtered by types, content, last update time.`,
    servers: swaggerServers
  })
  public async GraphResources(
    @Param() params: FindInDataSpaceParams,
    @Query("$skip", OptionalParseIntPipe) skip?: number,
    @Query("$top", OptionalParseIntPipe) top?: number,
    @Query("$filter") filter?: string,
    @Query("storeLastWriteFilter", OptionalParseDatePipe)
    storeLastWriteFilter?: Date,
    @Query("dataObjectTypes") dataObjectTypes?: string,
    @Query("countObjects", OptionalParseBoolPipe) countObjects?: boolean,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<ResourceGraphDto | null> {
    logger.info(
      `Received request to graph resources for dataspace: ${params.dataspaceId}`
    );
    logger.debug(
      `Query parameters: skip=${skip}, top=${top}, filter=${filter}, storeLastWriteFilter=${storeLastWriteFilter}, dataObjectTypes=${dataObjectTypes}, countObjects=${countObjects}, transactionId=${transactionId}`
    );
    const query = {
      top,
      skip,
      filter
    };
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      logger.info("Session created successfully.");
      logger.info("Fetching resource graph...");
      const graph = await graphResources(
        c,
        {
          uri: EtpUri.createDataSpaceUri(params.dataspaceId).uri,
          depth: 1,
          dataObjectTypes: dataObjectTypes ? dataObjectTypes.split(",") : [],
          navigableEdges: "Both"
        },
        query,
        "self",
        countObjects,
        storeLastWriteFilter
      );
      logger.info("Resource graph fetched successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
      c = undefined;
      const result = sendGraph(skip, top, graph);
      logger.info("Processed resource graph successfully.");
      return result;
    } catch (err) {
      logger.error(
        `Error occurred while graphing resources for dataspace ${params.dataspaceId}: ${err}`
      );
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * List of resources of a given type available in a dataset
   *
   * @memberof ResourcesReadAPI
   */
  @Get(":dataspaceId/resources/:dataObjectType")
  @ApiQuery(skipQueryParam)
  @ApiQuery(topQueryParam)
  @ApiQuery(filterQueryParam)
  @ApiQuery(storeLastWriteFilterQueryParam)
  @ApiQuery(countObjectsQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiOkResponse(resourceResponse)
  @ApiOperation({
    summary: "Get the resources of a given type.",
    description: `List all resources of a given type inside a dataspace.
    Output can be paginated and filtered by content, last update time.`,
    servers: swaggerServers
  })
  public async ListResourcesByTypes(
    @Param() params: FindInTypeParams,
    @Query("$skip", OptionalParseIntPipe) skip?: number,
    @Query("$top", OptionalParseIntPipe) top?: number,
    @Query("$filter") filter?: string,
    @Query("storeLastWriteFilter", OptionalParseDatePipe)
    storeLastWriteFilter?: Date,
    @Query("countObjects", OptionalParseBoolPipe) countObjects = false,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<ResourceDto[] | null> {
    logger.info(
      `Received request to list resources by type for dataspace: ${params.dataspaceId}, type: ${params.dataObjectType}`
    );
    const query = {
      top,
      skip,
      filter
    };
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      logger.info("Session created successfully.");
      logger.info("Fetching resources by type...");
      const resources = await findResources(
        c,
        {
          uri: EtpUri.createDataSpaceUri(params.dataspaceId).uri,
          depth: 1,
          dataObjectTypes: [params.dataObjectType],
          navigableEdges: "Both"
        },
        query,
        "self",
        countObjects,
        storeLastWriteFilter
      );
      logger.info("Resources by type fetched successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
      c = undefined;
      const result = sendResources(skip, top, resources);
      logger.info("Processed resources by type successfully.");
      return result;
    } catch (err) {
      logger.error(
        `Error occurred while listing resources by type for dataspace ${params.dataspaceId}: ${err}`
      );
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * List data objects referenced by given object
   *
   * @memberof ResourcesReadAPI
   */
  @Get(":dataspaceId/resources/:dataObjectType/:guid/targets")
  @ApiQuery(versionQueryParam)
  @ApiQuery(skipQueryParam)
  @ApiQuery(topQueryParam)
  @ApiQuery(filterQueryParam)
  @ApiQuery(storeLastWriteFilterQueryParam)
  @ApiQuery(dataObjectTypesQueryParam)
  @ApiQuery(depthQueryParam)
  @ApiQuery(includeSecondarySourcesQueryParam)
  @ApiQuery(countObjectsQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiOkResponse(resourceResponse)
  @ApiOperation({
    summary: "Get the resources referenced by current one.",
    description: `List all resources referenced by a given resource.
    Referencing can be recursive with a depth greater than 1.
    Output can be paginated and filtered by content, types and last update time.`,
    servers: swaggerServers
  })
  public async ListTargets(
    @Param() params: FindInObjectParams,
    @Query("version") version?: string,
    @Query("$skip", OptionalParseIntPipe) skip?: number,
    @Query("$top", OptionalParseIntPipe) top?: number,
    @Query("$filter") filter?: string,
    @Query("storeLastWriteFilter", OptionalParseDatePipe)
    storeLastWriteFilter?: Date,
    @Query("dataObjectTypes") dataObjectTypes?: string,
    @Query("depth", OptionalParseIntPipe) depth?: number,
    @Query("includeSecondarySources", OptionalParseBoolPipe)
    includeSecondarySources?: boolean,
    @Query("countObjects", OptionalParseBoolPipe) countObjects = false,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<ResourceDto[] | null> {
    logger.info(
      `Received request to list targets for dataspace: ${params.dataspaceId}, type: ${params.dataObjectType}, guid: ${params.guid}`
    );
    const query = {
      top,
      skip,
      filter
    };
    const m = dataObjectTypeRegexp.exec(params.dataObjectType);
    const uri = EtpUri.createObjectUri(
      params.dataspaceId,
      m?.groups?.domainFamily ?? "",
      m?.groups?.domainVersion ?? "",
      m?.groups?.dataType ?? "",
      params.guid,
      version
    ).uri;
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      logger.info("Session created successfully.");
      logger.info("Fetching targets...");
      const resources = await findResources(
        c,
        {
          uri,
          depth,
          dataObjectTypes: dataObjectTypes ? dataObjectTypes.split(",") : [],
          navigableEdges: "Both",
          includeSecondarySources
        },
        query,
        "targets",
        countObjects,
        storeLastWriteFilter
      );
      logger.info("Targets fetched successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
      c = undefined;
      const result = sendResources(skip, top, resources);
      logger.info(`Processed targets successfully.`);
      return result;
    } catch (err) {
      logger.error(
        `Error occurred while listing targets for dataspace ${params.dataspaceId}: ${err}`
      );
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Graph data objects referenced by given object
   * @param params - The parameters to find the object
   * @param skip - The number of items to skip
   * @param top - The number of items to return
   * @param filter - The filter to apply
   * @param storeLastWriteFilter - The last write time filter
   * @param dataObjectTypes - The data object types to filter
   * @param version - The version to filter
   * @param depth - The depth of the graph
   * @param includeSecondarySources - Include secondary sources
   * @param countObjects - If true, the source and target count will be computed for each resource
   * @param transactionId - The id of the current transaction when in a transaction
   * @param request - The express request
   * @returns The resources graph of the targets(nodes and links)
   *
   * @memberof ResourcesReadAPI
   */
  @Get(":dataspaceId/graph/:dataObjectType/:guid/targets")
  @ApiQuery(versionQueryParam)
  @ApiQuery(skipQueryParam)
  @ApiQuery(topQueryParam)
  @ApiQuery(filterQueryParam)
  @ApiQuery(storeLastWriteFilterQueryParam)
  @ApiQuery(dataObjectTypesQueryParam)
  @ApiQuery(depthQueryParam)
  @ApiQuery(includeSecondarySourcesQueryParam)
  @ApiQuery(countObjectsQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiOkResponse(resourceResponse)
  @ApiOperation({
    summary: "Graph the resources referenced by current one.",
    description: `Graph all resources referenced by a given resource.
    Referencing can be recursive with a depth greater than 1.
    Includes the relationships between the resources.
    Output can be paginated and filtered by content, types and last update time.`,
    servers: swaggerServers
  })
  public async GraphTargets(
    @Param() params: FindInObjectParams,
    @Query("version") version?: string,
    @Query("$skip", OptionalParseIntPipe) skip?: number,
    @Query("$top", OptionalParseIntPipe) top?: number,
    @Query("$filter") filter?: string,
    @Query("storeLastWriteFilter", OptionalParseDatePipe)
    storeLastWriteFilter?: Date,
    @Query("dataObjectTypes") dataObjectTypes?: string,
    @Query("depth", OptionalParseIntPipe) depth?: number,
    @Query("includeSecondarySources", OptionalParseBoolPipe)
    includeSecondarySources?: boolean,
    @Query("countObjects", OptionalParseBoolPipe) countObjects = false,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<ResourceGraphDto | null> {
    logger.info(
      `Received request to graph targets for dataspace: ${params.dataspaceId}, type: ${params.dataObjectType}, guid: ${params.guid}`
    );
    const query = {
      top,
      skip,
      filter
    };
    const m = dataObjectTypeRegexp.exec(params.dataObjectType);
    const uri = EtpUri.createObjectUri(
      params.dataspaceId,
      m?.groups?.domainFamily ?? "",
      m?.groups?.domainVersion ?? "",
      m?.groups?.dataType ?? "",
      params.guid,
      version
    ).uri;
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      logger.info("Session created successfully.");
      logger.info("Fetching target graph...");
      const graph = await graphResources(
        c,
        {
          uri,
          depth,
          dataObjectTypes: dataObjectTypes ? dataObjectTypes.split(",") : [],
          navigableEdges: "Both",
          includeSecondarySources
        },
        query,
        "targets",
        countObjects,
        storeLastWriteFilter
      );
      logger.info("Target graph fetched successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
      c = undefined;
      const result = sendGraph(skip, top, graph);
      logger.info("Processed target graph successfully.");
      return result;
    } catch (err) {
      logger.error(
        `Error occurred while graphing targets for dataspace ${params.dataspaceId}: ${err}`
      );
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * List data objects referencing the given object
   *
   * @memberof ResourcesReadAPI
   */
  @Get(":dataspaceId/resources/:dataObjectType/:guid/sources")
  @ApiQuery(versionQueryParam)
  @ApiQuery(skipQueryParam)
  @ApiQuery(topQueryParam)
  @ApiQuery(filterQueryParam)
  @ApiQuery(storeLastWriteFilterQueryParam)
  @ApiQuery(dataObjectTypesQueryParam)
  @ApiQuery(depthQueryParam)
  @ApiQuery(includeSecondaryTargetsQueryParam)
  @ApiQuery(countObjectsQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiOkResponse(resourceResponse)
  @ApiOperation({
    summary: "Get the resources referencing current one.",
    description: `List all resources referencing a given resource.
    Referencing can be recursive with a depth greater than 1.
    Output can be paginated and filtered by content, types and last update time.`,
    servers: swaggerServers
  })
  public async ListSources(
    @Param() params: FindInObjectParams,
    @Query("version") version?: string,
    @Query("$skip", OptionalParseIntPipe) skip?: number,
    @Query("$top", OptionalParseIntPipe) top?: number,
    @Query("$filter") filter?: string,
    @Query("storeLastWriteFilter", OptionalParseDatePipe)
    storeLastWriteFilter?: Date,
    @Query("dataObjectTypes") dataObjectTypes?: string,
    @Query("depth", OptionalParseIntPipe) depth?: number,
    @Query("includeSecondaryTargets", OptionalParseBoolPipe)
    includeSecondaryTargets?: boolean,
    @Query("countObjects", OptionalParseBoolPipe) countObjects = false,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<ResourceDto[] | null> {
    logger.info(
      `Received request to list sources for dataspace: ${params.dataspaceId}, type: ${params.dataObjectType}, guid: ${params.guid}`
    );
    const query = {
      top,
      skip,
      filter
    };
    const m = dataObjectTypeRegexp.exec(params.dataObjectType);
    const uri = EtpUri.createObjectUri(
      params.dataspaceId,
      m?.groups?.domainFamily ?? "",
      m?.groups?.domainVersion ?? "",
      m?.groups?.dataType ?? "",
      params.guid,
      version
    ).uri;
    logger.debug(`Generated URI succesfully`);
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      logger.info("Session created successfully.");
      logger.info("Fetching sources...");
      const resources = await findResources(
        c,
        {
          uri,
          depth,
          dataObjectTypes: dataObjectTypes ? dataObjectTypes.split(",") : [],
          navigableEdges: "Both",
          includeSecondaryTargets
        },
        query,
        "sources",
        countObjects,
        storeLastWriteFilter
      );
      logger.info("Sources fetched successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
      c = undefined;
      const result = sendResources(skip, top, resources);
      logger.info("Processed sources successfully.");
      return result;
    } catch (err) {
      logger.error(
        `Error occurred while listing sources for dataspace ${params.dataspaceId}: ${err}`
      );
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Graph data objects referencing the given object
   * @param params - The parameters to find the object
   * @param skip - The number of items to skip
   * @param top - The number of items to return
   * @param filter - The filter to apply
   * @param storeLastWriteFilter - The last write time filter
   * @param dataObjectTypes - The data object types to filter
   * @param depth - The depth of the graph
   * @param includeSecondaryTargets - Include secondary targets
   * @param countObjects - If true, the source and target count will be computed for each resource
   * @param request - The express request
   *
   * @memberof ResourcesReadAPI
   */
  @Get(":dataspaceId/graph/:dataObjectType/:guid/sources")
  @ApiQuery(versionQueryParam)
  @ApiQuery(skipQueryParam)
  @ApiQuery(topQueryParam)
  @ApiQuery(filterQueryParam)
  @ApiQuery(storeLastWriteFilterQueryParam)
  @ApiQuery(dataObjectTypesQueryParam)
  @ApiQuery(depthQueryParam)
  @ApiQuery(includeSecondaryTargetsQueryParam)
  @ApiQuery(countObjectsQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiOkResponse(resourceResponse)
  @ApiOperation({
    summary: "Graph the resources referencing current one.",
    description: `Graph all resources referencing a given resource.
    Referencing can be recursive with a depth greater than 1.
    Includes the relationships between the resources.
    Output can be paginated and filtered by content, types and last update time.`,
    servers: swaggerServers
  })
  public async GraphSources(
    @Param() params: FindInObjectParams,
    @Query("version") version?: string,
    @Query("$skip", OptionalParseIntPipe) skip?: number,
    @Query("$top", OptionalParseIntPipe) top?: number,
    @Query("$filter") filter?: string,
    @Query("storeLastWriteFilter", OptionalParseDatePipe)
    storeLastWriteFilter?: Date,
    @Query("dataObjectTypes") dataObjectTypes?: string,
    @Query("depth", OptionalParseIntPipe) depth?: number,
    @Query("includeSecondaryTargets", OptionalParseBoolPipe)
    includeSecondaryTargets?: boolean,
    @Query("countObjects", OptionalParseBoolPipe) countObjects = false,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<ResourceGraphDto | null> {
    logger.info(
      `Received request to graph sources for dataspace: ${params.dataspaceId}, type: ${params.dataObjectType}, guid: ${params.guid}`
    );
    const query = {
      top,
      skip,
      filter
    };
    const m = dataObjectTypeRegexp.exec(params.dataObjectType);
    const uri = EtpUri.createObjectUri(
      params.dataspaceId,
      m?.groups?.domainFamily ?? "",
      m?.groups?.domainVersion ?? "",
      m?.groups?.dataType ?? "",
      params.guid,
      version
    ).uri;
    logger.debug(`Generated URI for graph sources successfully`);
    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      logger.info("Session created successfully.");
      logger.info("Fetching source graph...");
      const graph = await graphResources(
        c,
        {
          uri,
          depth,
          dataObjectTypes: dataObjectTypes ? dataObjectTypes.split(",") : [],
          navigableEdges: "Both",
          includeSecondaryTargets
        },
        query,
        "sources",
        countObjects,
        storeLastWriteFilter
      );
      logger.info("Source graph fetched successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
      c = undefined;
      const result = sendGraph(skip, top, graph);
      logger.info("Processed source graph successfully.");
      return result;
    } catch (err) {
      logger.error(
        `Error occurred while graphing sources for dataspace ${params.dataspaceId}: ${err}`
      );
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }
}
