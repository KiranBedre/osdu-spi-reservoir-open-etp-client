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

/* eslint-disable no-console */

import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  ApiBadRequestResponse,
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
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse
} from "@nestjs/swagger";

import {
  ArrayFormat,
  ArrayOutput,
  Energistics,
  IArrayId,
  IDataArray,
  IDataArrayMetadata,
  ResqmlClient
} from "../../client/ResqmlClient";

import { Integer32 } from "../../common/Etp12";

import { Type } from "class-transformer";

import {
  IsDate,
  IsUUID,
  Matches,
  MaxLength,
  IsString,
  IsNotEmpty
} from "class-validator";

import {
  FindInDataSpaceParams,
  FindInObjectParams,
  HasBearerGuard,
  HasDataPartitionGuard,
  OptionalParseIntArrayPipe,
  alphaSpaceSchema,
  createSession,
  dataObjectTypePattern,
  dataObjectTypeRegexp,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  getSchemasForType,
  httpErrorFromEtpError,
  partitionPattern,
  patternString,
  swaggerServers,
  toJSonCustomData,
  transactionIdQueryParam,
  uuidPattern,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import { uriPattern, versionQueryParam } from "./Resource.controller";

import { EtpUri } from "../../common/EtpUri";

import express from "express";
import { ErrorCode, EtpError } from "../../common/EtpTypes";

/**
 * @description Component of an URI
 * @pattern ^(\/?[\w\-]+)+$
 * @maxLength 2048
 */
export type ArrayPath = string;

export const arrayPathPattern = /^(\/?[\w-]+)+$/;

/**
 * @example 1
 * @isInt
 * @format int32
 * @minimum 0
 * @maximum 10000000
 */
export type Index32 = number;

export type AnyTypedArrayString =
  | "string"
  | "Uint8Array"
  | "Int8Array"
  | "Int16Array"
  | "Uint16Array"
  | "Int32Array"
  | "Uint32Array"
  | "Uint8ClampedArray"
  | "Float32Array"
  | "Float64Array"
  | "BigInt64Array"
  | "BigUint64Array";

export const arrayTypeString: AnyTypedArrayString[] = [
  "Int8Array",
  "Uint8Array",
  "Int16Array",
  "Int32Array",
  "BigInt64Array",
  "Uint16Array",
  "Uint32Array",
  "BigUint64Array",
  "Float32Array",
  "Float64Array"
];

const toArrayTypeString = (
  arrayType?: Energistics.Etp.v12.Datatypes.AnyLogicalArrayType
): AnyTypedArrayString | undefined => {
  if (arrayType === undefined) {
    return undefined;
  }

  return arrayType < arrayTypeString.length
    ? arrayTypeString[arrayType]
    : "string";
};

export class ArrayIdDto {
  @ApiProperty({
    name: "uri",
    pattern: patternString(uriPattern),
    example:
      "eml:///dataspace('demo%2FVolve')/eml20.obj_EpcExternalPartReference('53395ada-6f93-4bac-b506-d45997ded2a2')",
    description: "Uri of the array container.",
    maxLength: 2048
  })
  uri!: string;

  @ApiProperty({
    name: "pathInResource",
    pattern: patternString(arrayPathPattern),
    example: "/RESQML/a3f31b20-c93a-4682-8f6c-71be087202a4/points_patch0",
    description: "Identifier of the array inside the container.",
    maxLength: 2048
  })
  pathInResource!: string;
}

export class DataArrayMetadataDto {
  @ApiProperty({
    ...getSchemasForType(ArrayIdDto),
    required: true,
    name: "uid",
    description: "Array identifiers"
  })
  uid!: IArrayId;

  @ApiPropertyOptional({
    name: "dimensions",
    description: "Number of items in each dimension",
    type: "integer",
    format: "int32",
    isArray: true,
    maxItems: 1000,
    minimum: 1,
    maximum: 1000000,
    example: [100, 120, 130]
  })
  dimensions?: Integer32[];

  @ApiPropertyOptional({
    name: "preferredSubarrayDimensions",
    description: "Recommended slice dimensions when accessing data",
    type: "integer",
    format: "int32",
    isArray: true,
    maxItems: 1000,
    minimum: 1,
    maximum: 1000000,
    example: [100, 10, 1]
  })
  preferredSubarrayDimensions?: Integer32[];

  @ApiPropertyOptional({
    name: "arrayType",
    enum: arrayTypeString
  })
  arrayType?: AnyTypedArrayString;

  @ApiPropertyOptional({
    name: "storeLastWrite",
    description: "Date of last write in store",
    example: "2021-09-06T16:06:31.000Z",
    maxLength: 2048
  })
  @Type(() => Date)
  @IsDate()
  storeLastWrite?: Date;

  @ApiPropertyOptional({
    name: "storeLastWrite",
    description: "Date of first write in store",
    example: "2021-09-06T16:06:31.000Z",
    maxLength: 2048
  })
  @Type(() => Date)
  @IsDate()
  storeCreated?: Date;

  @ApiProperty({
    name: "customData",
    type: "object",
    additionalProperties: alphaSpaceSchema
  })
  customData?: Record<string, string | Date>;
}

export class DataArrayDataDto {
  @ApiPropertyOptional({
    name: "data",
    description: "Array content (as an array or its base64 representation).",
    additionalProperties: true,
    oneOf: [
      {
        type: "string",
        maxLength: 100000000,
        pattern:
          "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
        description: "Base64 string."
      },
      {
        type: "array",
        maxItems: 100000000,
        items: {
          type: "number",
          maximum: 1000000000,
          minimum: -1000000000
        }
      },
      {
        type: "array",
        maxItems: 100000000,
        items: {
          type: "boolean"
        }
      },
      {
        type: "array",
        maxItems: 100000000,
        items: {
          type: "string",
          maxLength: 100000000,
          pattern: "^.*$"
        }
      }
    ]
  })
  data?: ArrayOutput;

  @ApiPropertyOptional({
    name: "dimensions",
    description: "Number of items in each dimension",
    type: "integer",
    format: "int32",
    isArray: true,
    maxItems: 1000,
    minimum: 1,
    maximum: 1000000
  })
  dimensions?: Integer32[];
}

export class DataArrayDto {
  @ApiProperty({
    ...getSchemasForType(ArrayIdDto),
    required: true,
    name: "uid",
    description: "Array identifiers"
  })
  uid!: IArrayId;

  @ApiPropertyOptional({
    ...getSchemasForType(DataArrayDataDto),
    required: true,
    name: "data",
    description: "Array content"
  })
  data?: DataArrayDataDto;
}

export interface DataArrayRest {
  uid: IArrayId;
  data: {
    /**
     * @description array content (as an array or its base64 representation)
     */
    data?: ArrayOutput;
    /**
     * @description number of items in each dimension
     * @maxItems 10
     */
    dimensions?: Integer32[];
  };
}

/**
 * @maxItems 10000
 */
type GetObjectDataArraysOutput = (DataArrayMetadataDto | null)[];

process.on("unhandledRejection", (error: Error) => {
  console.log("=== UNHANDLED REJECTION ===");
  console.dir(error.stack);
});

/**
 *
 * @param uri Get the metadata of all arrays contained by object
 * @param jwt token
 * @returns Promise<GetObjectDataArraysOutput>
 */

const getObjectDataArrays = async (
  uri: string,
  jwt: string,
  dataPartitionId?: string
): Promise<GetObjectDataArraysOutput> => {
  const c = await createSession(jwt, dataPartitionId);
  const dataArrays = new Map<string, IDataArray>();
  try {
    await c.getObjectDataArrays(uri, dataArrays);

    const arrays: (IDataArrayMetadata | null)[] = [];
    const arrayList = Array.from(dataArrays.values());
    let message = "";

    const concatMessage = (err: string) => (message += `${err} `);
    const depth = c.messageQueueDepth();
    for (let i = 0; i < arrayList.length; i += depth) {
      // Limit concurrent requests to what server can handle
      const sp = arrayList.slice(i, i + depth);
      await Promise.all(
        sp.map(v => c.getDataArrayMetadata(v.uid.uri, v.uid.pathInResource))
      )
        .then(a => { for (const item of a) arrays.push(item); })
        .catch(concatMessage);
    }
    if (message !== "") {
      throw new EtpError(message, ErrorCode.EINVALID_STATE);
    }
    const filteredArrays = arrays.filter(m => m != null);
    return filteredArrays.map(a =>
      a
        ? {
          uid: a.uid,
          dimensions: a.dimensions,
          arrayType: toArrayTypeString(a.logicalArrayType),
          preferredSubarrayDimensions: a.preferredSubarrayDimensions,
          storeLastWrite: a.storeLastWrite,
          storeCreated: a.storeCreated,
          customData: toJSonCustomData(a.customData)
        }
        : null
    );
  } finally {
    c.closeSession();
  }
};

/**
 * Describe to parameters to look inside a given object
 *
 * @export
 * @class DataArrayParams
 * @extends {FindInObjectParams}
 */
export class DataArrayParams extends FindInDataSpaceParams {
  @ApiProperty({
    name: "dataObjectType",
    description: "Energistics type of the object",
    example: "eml20.obj_EpcExternalPartReference",
    maxLength: 2048,
    pattern: patternString(dataObjectTypePattern)
  })
  @IsString()
  @IsNotEmpty()
  @Matches(dataObjectTypePattern)
  @MaxLength(256)
  dataObjectType!: string;

  @ApiProperty({
    name: "guid",
    description: "Unique Id of the object",
    example: "53395ada-6f93-4bac-b506-d45997ded2a2",
    maxLength: 2048,
    pattern: patternString(uuidPattern)
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  guid!: string;

  @ApiProperty({
    name: "pathInResource",
    pattern: patternString(arrayPathPattern),
    example: "/RESQML/a3f31b20-c93a-4682-8f6c-71be087202a4/points_patch0",
    description: "Identifier of the array inside the container.",
    maxLength: 2048
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  pathInResource!: string;
}

export const startsQueryParam: ApiQueryOptions = {
  name: "starts",
  required: false,
  description:
    "When selecting a subarray, start of the slice in each dimension",
  example: [10, 2],
  isArray: true,
  type: "integer",
  schema: {
    type: "array",
    maxItems: 1000,
    items: {
      type: "integer",
      format: "int32",
      minimum: 0,
      maximum: 1000000
    }
  }
};

export const countsQueryParam: ApiQueryOptions = {
  name: "counts",
  required: false,
  description: "When selecting a subarray, number of items in each dimension",
  example: [4, 1],
  isArray: true,
  type: "integer",
  schema: {
    type: "array",
    maxItems: 1000,
    items: {
      type: "integer",
      format: "int32",
      minimum: 1,
      maximum: 1000000
    }
  }
};

export const formatQueryParam: ApiQueryOptions = {
  name: "format",
  required: false,
  description: "Representation of the array: JSON(default) or base64",
  example: "json",
  schema: {
    type: "string",
    enum: ["json", "base64"]
  }
};

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

/**
 * API to Discover and Read data arrays
 *
 * @export
 * @class DataArrayReadAPI
 */
@ApiBearerAuth("HTTPBearer")
@UseGuards(HasBearerGuard("jwt"))
@ApiHeader({
  name: "data-partition-id",
  description: "Data partition id",
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
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("/dataspaces/:dataspaceId/resources/:dataObjectType/:guid")
export default class DataArrayReadAPI {
  @ApiOperation({
    summary: "List all arrays for an object",
    description: `List all data arrays (type, dimensions, path) referenced by a data object. Use this to discover what numeric data is attached before fetching content.\n\n**Common array types**: Well log curves, grid cell properties (porosity, permeability), seismic traces, point coordinates.`,
    servers: swaggerServers
  })
  @Get("arrays")
  @ApiQuery(versionQueryParam)
  @ApiOkResponse({
    description: "Success",
    schema: {
      type: "array",
      maxItems: 256,
      items: getSchemasForType(DataArrayMetadataDto)
    }
  })
  public async GetObjectArrays(
    @Param() params: FindInObjectParams,
    @Query("version") version?: string,
    @Req() request?: express.Request
  ): Promise<GetObjectDataArraysOutput> {
    try {
      const m = dataObjectTypeRegexp.exec(params.dataObjectType);
      const uri = EtpUri.createObjectUri(
        params.dataspaceId,
        m?.groups?.domainFamily ?? "",
        m?.groups?.domainVersion ?? "",
        m?.groups?.dataType ?? "",
        params.guid,
        version
      ).uri;

      const arr = await getObjectDataArrays(
        uri,
        extractToken(request),
        extractDataPartitionId(request)
      );
      return arr;
    } catch (err: unknown) {
      throw httpErrorFromEtpError(err);
    }
  }

  @Get("arrays/:pathInResource/metadata")
  @ApiOperation({
    summary: "Get array metadata (type, dimensions)",
    description: `Returns data type (Float64Array, Int32Array, etc.) and dimensions for a specific array. Use to check size before fetching content.`,
    servers: swaggerServers
  })
  @ApiQuery(versionQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiOkResponse({
    description: "Success",
    schema: getSchemasForType(DataArrayMetadataDto)
  })
  public async GetArrayMetaData(
    @Param() params: DataArrayParams,
    @Query("version") version?: string,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<DataArrayMetadataDto | null> {
    const m = dataObjectTypeRegexp.exec(params.dataObjectType);
    const uri = EtpUri.createObjectUri(
      params.dataspaceId,
      m?.groups?.domainFamily ?? "",
      m?.groups?.domainVersion ?? "",
      m?.groups?.dataType ?? "",
      params.guid,
      version
    ).uri;
    let c: ResqmlClient | undefined = undefined;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      const d = await c.getDataArrayMetadata(uri, params.pathInResource);
      if (!transactionId) {
        await c.closeSession();
      }
      c = undefined;
      return d
        ? {
          ...d,
          customData: toJSonCustomData(d.customData)
        }
        : null;
    } catch (err) {
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Get the content of a single array.
   * For large arrays, it is recommended to use starts and counts and get array by slices.
   * Note that starts and counts need to be used together or not at all.
   *
   * @memberof ResourceBasedDataArrayAPI
   */
  @Get("arrays/:pathInResource")
  @ApiOperation({
    summary: "Get array content",
    description: `Retrieve the numeric data of an array. For large arrays, use \`starts\` and \`counts\` to fetch slices (subarrays) instead of the full dataset.\n\n**starts/counts**: Must be used together. Each is a comma-separated list matching the array dimensions (e.g., \`starts=0,0&counts=100,3\` for first 100 rows × 3 columns).\n\n**format**: \`json\` (default) returns a number array; \`base64\` returns a base64-encoded binary string (more efficient for large transfers).\n\n**Chunking**: The ETP layer automatically chunks large arrays (~10 MB per WebSocket message) and reassembles on the server side.`,
    servers: swaggerServers
  })
  @ApiQuery(versionQueryParam)
  @ApiQuery(startsQueryParam)
  @ApiQuery(countsQueryParam)
  @ApiQuery(formatQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiBadRequestResponse(
    errorMessageSchema(
      `starts and counts dimensions not compatible with array dimensions`
    )
  )
  @ApiOkResponse({
    description: "Success",
    schema: getSchemasForType(DataArrayDto)
  })
  @ApiOperation({ servers: swaggerServers })
  public async GetArray(
    @Param() params: DataArrayParams,
    @Query("version") version?: string,
    @Query("starts", OptionalParseIntArrayPipe) starts?: Index32[],
    @Query("counts", OptionalParseIntArrayPipe) counts?: Integer32[],
    @Query("format") format?: ArrayFormat,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<DataArrayDto> {
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
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      const metadata = await c.getDataArrayMetadata(uri, params.pathInResource);
      if (!metadata) {
        throw new InternalServerErrorException({
          description: `Cannot get subarray metadata`
        });
      }
      if (starts && counts) {
        if (
          metadata.dimensions?.length !== starts.length ||
          starts.length !== counts.length
        ) {
          throw new BadRequestException({
            description: `starts and counts dimensions not compatible with array dimensions`
          });
        }
        metadata.dimensions.forEach((d: number, i: number) => {
          if (starts[i] < 0 || counts[i] < 0 || starts[i] + counts[i] > d) {
            throw new BadRequestException({
              description: `starts and counts dimensions not compatible with array dimensions`
            });
          }
        });
        const subArray = await c.getDataSubarray(
          uri,
          params.pathInResource,
          starts,
          counts
        );

        if (
          !subArray ||
          !subArray.data ||
          subArray.data instanceof Energistics.Etp.v12.Datatypes.ErrorInfo
        ) {
          throw new InternalServerErrorException({
            description: "Cannot fetch subarray"
          });
        }
        const res = {
          uid: subArray.uid,
          data: {
            data: c.formatArrayData(subArray.data.data, format || "json"),
            dimensions: subArray.data.dimensions.map(Number)
          }
        };
        if (!transactionId) {
          await c.closeSession();
        }
        c = undefined;
        return res;
      }
      const a = await c.getDataArray(uri, params.pathInResource, metadata);
      if (
        !a ||
        !a.data ||
        a.data instanceof Energistics.Etp.v12.Datatypes.ErrorInfo
      ) {
        throw new InternalServerErrorException({
          description: "Cannot fetch array"
        });
      }
      const res = {
        uid: a.uid,
        data: {
          data: c.formatArrayData(a.data.data, format || "json"),
          dimensions: a.data.dimensions.map(Number)
        }
      };
      if (!transactionId) {
        await c.closeSession();
      }
      c = undefined;
      return res;
    } catch (err) {
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }
}
