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
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotImplementedException,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards
} from "@nestjs/common";

import {
  ApiBadRequestResponse,
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
  ApiProduces,
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
  IArrayStatsSummary,
  IArrayReduceResult,
  IArrayWhereResult,
  IArrayMultiWhereResult,
  IArrayArithResult,
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
  IsNotEmpty,
  IsArray,
  IsNumber,
  IsOptional,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize
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
  extractUserInfo,
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

import { etpComputeUrl } from "../../common/config";

import { uriPattern, versionQueryParam } from "./Resource.controller";

import { EtpUri } from "../../common/EtpUri";

import express from "express";
import { ErrorCode, EtpError } from "../../common/EtpTypes";

export const arrayPathPattern = /^(\/?[\w-]+)+$/;

/**
 * @example 1
 * @isInt
 * @format int32
 * @minimum 0
 * @maximum 10000000
 */
export type Index32 = number;

/**
 * Normalise a subarray selection against the array's real dimensions.
 *
 * `starts` and `counts` must be present together with one entry per array
 * dimension. A `counts` entry of `-1` is a "whole dimension" sentinel: it is
 * expanded to the remaining extent of that axis (`dimensions[i] - starts[i]`),
 * so a K-only slab of an `[I, J, K]` grid property can be requested as
 * `starts=0,0,k&counts=-1,-1,1` without first computing the I/J sizes.
 *
 * @throws BadRequestException when the lengths disagree with the array rank or
 *   the resolved slice falls outside the array bounds.
 */
export function resolveSubarraySelection(
  dimensions: number[] | undefined,
  starts: number[],
  counts: number[]
): { starts: number[]; counts: number[] } {
  if (!dimensions || dimensions.length !== starts.length || starts.length !== counts.length) {
    throw new BadRequestException({
      description: `starts and counts dimensions not compatible with array dimensions`
    });
  }
  const resolvedCounts = counts.map((cnt, i) =>
    cnt === -1 ? dimensions[i] - starts[i] : cnt
  );
  dimensions.forEach((d: number, i: number) => {
    if (
      starts[i] < 0 ||
      resolvedCounts[i] < 0 ||
      starts[i] + resolvedCounts[i] > d
    ) {
      throw new BadRequestException({
        description: `starts and counts dimensions not compatible with array dimensions`
      });
    }
  });
  return { starts, counts: resolvedCounts };
}

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

export class DataArrayStatsDto {
  @ApiProperty({
    name: "valid",
    description:
      "false when the array held no finite value (all null/NaN or non-numeric).",
    example: true
  })
  valid!: boolean;

  @ApiProperty({
    name: "count",
    description: "Finite (non-null) values folded into the summary.",
    type: "integer",
    example: 187500
  })
  count!: number;

  @ApiProperty({
    name: "nullCount",
    description: "Explicit-null and NaN values that were skipped.",
    type: "integer",
    example: 12500
  })
  nullCount!: number;

  @ApiPropertyOptional({ name: "minimum", type: "number", example: 0.02 })
  minimum?: number;

  @ApiPropertyOptional({ name: "maximum", type: "number", example: 0.34 })
  maximum?: number;

  @ApiPropertyOptional({ name: "mean", type: "number", example: 0.187 })
  mean?: number;

  @ApiPropertyOptional({
    name: "stddev",
    description: "Population standard deviation.",
    type: "number",
    example: 0.041
  })
  stddev?: number;

  @ApiPropertyOptional({ name: "sum", type: "number", example: 35062.5 })
  sum?: number;

  @ApiPropertyOptional({
    name: "inRangeCount",
    description:
      "Finite values inside the requested inclusive [rangeLo, rangeHi] window (only when a range was asked).",
    type: "integer",
    example: 4200
  })
  inRangeCount?: number;

  @ApiPropertyOptional({ name: "rangeLo", type: "number", example: 0.1 })
  rangeLo?: number;

  @ApiPropertyOptional({ name: "rangeHi", type: "number", example: 0.25 })
  rangeHi?: number;

  @ApiPropertyOptional({
    name: "histogram",
    description:
      "Per-bin counts of a fixed-width histogram over [histLo, histHi], folded " +
      "in the same pass (only when `bins` was requested). Bin i covers " +
      "[histLo + i*w, histLo + (i+1)*w) with w = (histHi-histLo)/bins.",
    type: "array",
    items: { type: "integer" },
    example: [0, 12, 480, 1203, 640, 85]
  })
  histogram?: number[];

  @ApiPropertyOptional({
    name: "histBins",
    description: "Number of histogram bins (== histogram.length).",
    type: "integer",
    example: 6
  })
  histBins?: number;

  @ApiPropertyOptional({ name: "histLo", type: "number", example: 0.1 })
  histLo?: number;

  @ApiPropertyOptional({ name: "histHi", type: "number", example: 0.25 })
  histHi?: number;

  @ApiPropertyOptional({
    name: "histUnderflow",
    description: "Finite values below histLo (not counted in any bin).",
    type: "integer",
    example: 0
  })
  histUnderflow?: number;

  @ApiPropertyOptional({
    name: "histOverflow",
    description: "Finite values above histHi (not counted in any bin).",
    type: "integer",
    example: 0
  })
  histOverflow?: number;

  @ApiPropertyOptional({
    name: "p10",
    description:
      "Percentiles interpolated from the cumulative histogram (only when `bins` " +
      "was requested); approximate to within one bin width, clamped to [minimum, maximum].",
    type: "number",
    example: 0.12
  })
  p10?: number;

  @ApiPropertyOptional({ name: "p50", type: "number", example: 0.18 })
  p50?: number;

  @ApiPropertyOptional({ name: "p90", type: "number", example: 0.23 })
  p90?: number;
}

export class DataArrayReduceDto {
  @ApiProperty({
    name: "op",
    description:
      "Echoed reduction operator (`sum`/`mean`/`min`/`max`/`count`/`net`).",
    example: "mean"
  })
  op!: string;

  @ApiProperty({
    name: "ni",
    description: "Fastest grid axis of the returned column map.",
    type: "integer",
    example: 100
  })
  ni!: number;

  @ApiProperty({
    name: "nj",
    description: "Middle grid axis of the returned column map (map is row-major [nj, ni]).",
    type: "integer",
    example: 150
  })
  nj!: number;

  @ApiProperty({
    name: "columns",
    description: "Number of columns that folded at least one value.",
    type: "integer",
    example: 14800
  })
  columns!: number;

  @ApiProperty({
    name: "map",
    description:
      "Row-major [nj, ni] column map. Empty columns are NaN (min/max/mean) or 0 (sum/count/net).",
    type: "array",
    items: { type: "number" },
    example: [0.21, 0.19, 0.23]
  })
  map!: number[];
}

export class DataArrayWhereDto {
  @ApiProperty({
    name: "valid",
    description: "false when no cell matched the predicate.",
    example: true
  })
  valid!: boolean;

  @ApiProperty({
    name: "count",
    description: "Cells with value inside the inclusive [rangeLo, rangeHi] predicate.",
    type: "integer",
    example: 3120
  })
  count!: number;

  @ApiPropertyOptional({ name: "rangeLo", type: "number", example: 0.2 })
  rangeLo?: number;

  @ApiPropertyOptional({ name: "rangeHi", type: "number", example: 1 })
  rangeHi?: number;

  @ApiPropertyOptional({ name: "iMin", type: "integer", example: 12 })
  iMin?: number;

  @ApiPropertyOptional({ name: "iMax", type: "integer", example: 54 })
  iMax?: number;

  @ApiPropertyOptional({ name: "jMin", type: "integer", example: 8 })
  jMin?: number;

  @ApiPropertyOptional({ name: "jMax", type: "integer", example: 61 })
  jMax?: number;

  @ApiPropertyOptional({ name: "kMin", type: "integer", example: 3 })
  kMin?: number;

  @ApiPropertyOptional({ name: "kMax", type: "integer", example: 7 })
  kMax?: number;

  @ApiPropertyOptional({
    name: "ci",
    description: "I index of the ijk centroid (aim point) of the matching cells.",
    type: "number",
    example: 33.4
  })
  ci?: number;

  @ApiPropertyOptional({ name: "cj", type: "number", example: 34.1 })
  cj?: number;

  @ApiPropertyOptional({ name: "ck", type: "number", example: 5.2 })
  ck?: number;
}

/** One `[rangeLo, rangeHi]` predicate over a single property to AND together. */
export class MultiWherePredicateDto {
  @ApiProperty({
    name: "dataObjectType",
    description: "Energistics type of the object owning the array.",
    example: "resqml20.obj_ContinuousProperty",
    pattern: patternString(dataObjectTypePattern)
  })
  @IsString()
  @IsNotEmpty()
  @Matches(dataObjectTypePattern)
  @MaxLength(256)
  dataObjectType!: string;

  @ApiProperty({
    name: "guid",
    description: "Unique id of the object owning the array.",
    example: "53395ada-6f93-4bac-b506-d45997ded2a2"
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  guid!: string;

  @ApiPropertyOptional({
    name: "version",
    description: "Optional object version; latest when omitted."
  })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiProperty({
    name: "pathInResource",
    description: "Identifier of the array inside the container.",
    example: "/RESQML/a3f31b20-c93a-4682-8f6c-71be087202a4/values_patch0"
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  pathInResource!: string;

  @ApiProperty({ name: "rangeLo", type: "number", example: 0.2 })
  @IsNumber()
  rangeLo!: number;

  @ApiProperty({ name: "rangeHi", type: "number", example: 1 })
  @IsNumber()
  rangeHi!: number;
}

/** Body of the multi-array `where-multi` request: the predicates to AND. */
export class DataArrayWhereMultiRequestDto {
  @ApiProperty({
    name: "predicates",
    description:
      "One predicate per property to AND together. All referenced arrays must " +
      "share the same [Nk, Nj, Ni] grid shape.",
    type: [MultiWherePredicateDto],
    minItems: 1,
    maxItems: 64
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => MultiWherePredicateDto)
  predicates!: MultiWherePredicateDto[];
}

/** Result of a multi-array (`WHEREN`) masked predicate: the AND of all inputs. */
export class DataArrayMultiWhereDto {
  @ApiProperty({
    name: "valid",
    description: "false when no cell satisfied every predicate.",
    example: true
  })
  valid!: boolean;

  @ApiProperty({
    name: "arrays",
    description: "Number of property arrays that were ANDed together.",
    type: "integer",
    example: 2
  })
  arrays!: number;

  @ApiProperty({
    name: "count",
    description: "Cells satisfying EVERY predicate.",
    type: "integer",
    example: 840
  })
  count!: number;

  @ApiPropertyOptional({ name: "iMin", type: "integer", example: 12 })
  iMin?: number;

  @ApiPropertyOptional({ name: "iMax", type: "integer", example: 54 })
  iMax?: number;

  @ApiPropertyOptional({ name: "jMin", type: "integer", example: 8 })
  jMin?: number;

  @ApiPropertyOptional({ name: "jMax", type: "integer", example: 61 })
  jMax?: number;

  @ApiPropertyOptional({ name: "kMin", type: "integer", example: 3 })
  kMin?: number;

  @ApiPropertyOptional({ name: "kMax", type: "integer", example: 7 })
  kMax?: number;

  @ApiPropertyOptional({
    name: "ci",
    description: "I index of the ijk centroid (aim point) of the surviving cells.",
    type: "number",
    example: 33.4
  })
  ci?: number;

  @ApiPropertyOptional({ name: "cj", type: "number", example: 34.1 })
  cj?: number;

  @ApiPropertyOptional({ name: "ck", type: "number", example: 5.2 })
  ck?: number;
}


/** One operand (or result target) of an array-arithmetic request. */
export class ArithOperandDto {
  @ApiProperty({
    name: "dataObjectType",
    description: "Energistics type of the object owning the array.",
    example: "resqml20.obj_ContinuousProperty",
    pattern: patternString(dataObjectTypePattern)
  })
  @IsString()
  @IsNotEmpty()
  @Matches(dataObjectTypePattern)
  @MaxLength(256)
  dataObjectType!: string;

  @ApiProperty({
    name: "guid",
    description: "Unique id of the object owning the array.",
    example: "53395ada-6f93-4bac-b506-d45997ded2a2"
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  guid!: string;

  @ApiPropertyOptional({
    name: "version",
    description: "Optional object version; latest when omitted."
  })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiProperty({
    name: "pathInResource",
    description: "Identifier of the array inside the container.",
    example: "/RESQML/a3f31b20-c93a-4682-8f6c-71be087202a4/values_patch0"
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  pathInResource!: string;
}

/**
 * Body of the array-arithmetic request: evaluate `C = op(A[, B | scalar])`
 * inside the store and upsert the result into the pre-declared target `C`.
 */
export class DataArrayArithRequestDto {
  @ApiProperty({
    name: "op",
    description:
      "Operator token. Binary/scalar: add, sub, rsub, mul, div, rdiv, min, " +
      "max, pow, mod. Unary: neg, abs, sqrt, log, exp, recip, affine.",
    example: "mul"
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  op!: string;

  @ApiProperty({
    name: "kind",
    description:
      "Form of the operation: 'binary' (C = op(A, B)), 'scalar' (C = op(A, k)) " +
      "or 'unary' (C = op(A); 'affine' uses scalar & scalar2).",
    enum: ["binary", "scalar", "unary"],
    example: "scalar"
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(binary|scalar|unary)$/)
  kind!: "binary" | "scalar" | "unary";

  @ApiProperty({
    name: "result",
    description: "Pre-declared, writable target array C to receive the result.",
    type: ArithOperandDto
  })
  @ValidateNested()
  @Type(() => ArithOperandDto)
  result!: ArithOperandDto;

  @ApiProperty({
    name: "operandA",
    description: "Operand A (left-hand / sole input array).",
    type: ArithOperandDto
  })
  @ValidateNested()
  @Type(() => ArithOperandDto)
  operandA!: ArithOperandDto;

  @ApiPropertyOptional({
    name: "operandB",
    description:
      "Operand B (right-hand array); required when kind='binary', ignored otherwise. " +
      "Must share A's element type and element count.",
    type: ArithOperandDto
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ArithOperandDto)
  operandB?: ArithOperandDto;

  @ApiPropertyOptional({
    name: "scalar",
    description:
      "Scalar operand k for kind='scalar' ops, or the multiplier a for unary 'affine'.",
    type: "number",
    example: 2
  })
  @IsOptional()
  @IsNumber()
  scalar?: number;

  @ApiPropertyOptional({
    name: "scalar2",
    description: "Second scalar: the addend b for unary 'affine' (C = a*A + b).",
    type: "number",
    example: 100
  })
  @IsOptional()
  @IsNumber()
  scalar2?: number;
}

/** Result summary of an array-arithmetic (`ARITH`) write operation. */
export class DataArrayArithDto {
  @ApiProperty({
    name: "op",
    description: "Echoed operator token.",
    example: "mul"
  })
  op!: string;

  @ApiProperty({
    name: "kind",
    description: "Form of the operation that was applied.",
    enum: ["binary", "scalar", "unary"],
    example: "scalar"
  })
  kind!: string;

  @ApiProperty({
    name: "count",
    description: "Finite result elements written to C.",
    type: "integer",
    example: 445000
  })
  count!: number;

  @ApiProperty({
    name: "nullCount",
    description:
      "Elements written as null (null-propagation or domain error, e.g. log of a negative).",
    type: "integer",
    example: 0
  })
  nullCount!: number;

  @ApiProperty({
    name: "total",
    description: "Total elements of operand A (= count + nullCount).",
    type: "integer",
    example: 445000
  })
  total!: number;

  @ApiPropertyOptional({
    name: "schema",
    description: "Compute wire-contract schema version; omitted on older servers.",
    type: "integer"
  })
  schema?: number;
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

/**
 * @maxItems 10000
 */
type GetObjectDataArraysOutput = (DataArrayMetadataDto | null)[];

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
    await c.closeSession();
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
  description:
    "When selecting a subarray, number of items in each dimension. Use `-1` " +
    "as a whole-dimension sentinel to take the remaining extent of that axis " +
    "(e.g. `counts=-1,-1,1` for a single K-slab of an I×J×K grid property).",
  example: [4, 1],
  isArray: true,
  type: "integer",
  schema: {
    type: "array",
    maxItems: 1000,
    items: {
      type: "integer",
      format: "int32",
      minimum: -1,
      maximum: 1000000
    }
  }
};

export const rangeLoQueryParam: ApiQueryOptions = {
  name: "rangeLo",
  required: false,
  description:
    "Lower bound (inclusive) of an optional range predicate; when both " +
    "`rangeLo` and `rangeHi` are supplied the store also returns " +
    "`inRangeCount` (values within [rangeLo, rangeHi]) in the same pass.",
  example: 0.1,
  schema: { type: "number" }
};

export const rangeHiQueryParam: ApiQueryOptions = {
  name: "rangeHi",
  required: false,
  description:
    "Upper bound (inclusive) of an optional range predicate; must be " +
    "supplied together with `rangeLo`.",
  example: 0.25,
  schema: { type: "number" }
};

export const binsQueryParam: ApiQueryOptions = {
  name: "bins",
  required: false,
  description:
    "Number of fixed-width histogram bins over the `[rangeLo, rangeHi]` domain. " +
    "When supplied (and > 0, with a range) the store folds a histogram in the " +
    "same pass and returns `histogram`/`histBins`/`histLo`/`histHi`/`histUnderflow`/" +
    "`histOverflow` plus percentiles `p10`/`p50`/`p90` (interpolated from the " +
    "cumulative histogram). Requires both `rangeLo` and `rangeHi`.",
  example: 20,
  schema: { type: "integer", format: "int32", minimum: 1, maximum: 100000 }
};

export const reduceOpQueryParam: ApiQueryOptions = {
  name: "op",
  required: true,
  description:
    "Reduction operator applied down the K axis of a 3-D property [Nk, Nj, Ni]: " +
    "`sum`, `mean`, `min`, `max`, `count` (cells in [rangeLo, rangeHi]) or `net` " +
    "(net-thickness = in-range cell count * cellDz).",
  example: "mean",
  schema: { type: "string", enum: ["sum", "mean", "min", "max", "count", "net"] }
};

export const k0QueryParam: ApiQueryOptions = {
  name: "k0",
  required: false,
  description:
    "Lower K index (inclusive) of an optional K-zone restriction [k0, k1); " +
    "must be supplied together with `k1`.",
  example: 0,
  schema: { type: "integer", format: "int32", minimum: 0 }
};

export const k1QueryParam: ApiQueryOptions = {
  name: "k1",
  required: false,
  description:
    "Upper K index (exclusive) of an optional K-zone restriction [k0, k1); " +
    "must be supplied together with `k0`.",
  example: 20,
  schema: { type: "integer", format: "int32", minimum: 0 }
};

export const cellDzQueryParam: ApiQueryOptions = {
  name: "cellDz",
  required: false,
  description:
    "Per-cell thickness used by the `net` operator (net-thickness = in-range " +
    "cell count * cellDz). Ignored for other operators. Defaults to 1.",
  example: 0.5,
  schema: { type: "number" }
};

export const formatQueryParam: ApiQueryOptions = {
  name: "format",
  required: false,
  description:
    "Representation of the array: `json` (default) returns a number array; " +
    "`base64` returns a base64-encoded binary string; `binary` streams the raw " +
    "little-endian typed-array bytes as `application/octet-stream` (no base64 " +
    "33% overhead — let the client reshape via the `x-array-dimensions` / " +
    "`x-array-dtype` response headers).",
  example: "json",
  schema: {
    type: "string",
    enum: ["json", "base64", "binary"]
  }
};

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

/**
 * Map an ETP transport array type to the little-endian typed-array name the raw
 * `application/octet-stream` bytes are packed as, surfaced via the `x-array-dtype`
 * response header so a client can reshape without a separate metadata call.
 */
function binaryDtypeName(
  t?: Energistics.Etp.v12.Datatypes.AnyArrayType
): string | undefined {
  const A = Energistics.Etp.v12.Datatypes.AnyArrayType;
  switch (t) {
    case A.arrayOfDouble:
      return "Float64Array";
    case A.arrayOfFloat:
      return "Float32Array";
    case A.arrayOfInt:
      return "Int32Array";
    case A.arrayOfLong:
      return "BigInt64Array";
    case A.arrayOfBoolean:
      return "Int8Array";
    case A.bytes:
      return "Uint8Array";
    case A.arrayOfString:
      return "string";
    default:
      return undefined;
  }
}

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
        transactionId,
        extractUserInfo(request)
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
   * One GET shortcut for the two most common server-side array computations
   * (`op=stats`, `op=where`). The full envelope (reduce, where-multi, arith,
   * async jobs) is `POST /dataspaces/{dataspaceId}/arrays/compute`.
   */
  @Get("arrays/:pathInResource/compute")
  @ApiOperation({
    summary: "Server-side array statistics or predicate count (op=stats | where)",
    description: `GET shortcut for the two most common server-side array computations; the full envelope (\`reduce\`, \`where-multi\`, \`arith\`, async jobs) is \`POST /dataspaces/{dataspaceId}/arrays/compute\` under Query.\n\n**op=stats** folds the array into a fixed-size summary (count, null-count, min/max/mean/stddev/sum) **inside the store**, without transferring the array bytes. Optionally pass \`rangeLo\`&\`rangeHi\` to also get \`inRangeCount\` (values within the inclusive window) in the same pass; add \`bins\` (with a range) to also fold a histogram over \`[rangeLo, rangeHi]\` and derive \`p10\`/\`p50\`/\`p90\` (net-pay / saturation distributions without downloading the array).\n\n**op=where** evaluates the \`[rangeLo, rangeHi]\` predicate (both required) over the array **inside the store** and returns the count of matching cells, their inclusive ijk bounding box and their ijk centroid (aim point), the primitive behind targeting queries.\n\nReturns 501 when the connected store does not support the compute extensions.`,
    servers: swaggerServers
  })
  @ApiQuery({
    name: "op",
    required: true,
    enum: ["stats", "where"],
    description: "Computation to run: `stats` (summary, optional range + histogram) or `where` (range predicate count + ijk bbox/centroid; `rangeLo`/`rangeHi` required)."
  })
  @ApiQuery(versionQueryParam)
  @ApiQuery(rangeLoQueryParam)
  @ApiQuery(rangeHiQueryParam)
  @ApiQuery(binsQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiOkResponse({
    description: "Success. `op=stats` returns the statistics summary; `op=where` returns the predicate result.",
    schema: {
      oneOf: [
        { title: "stats", ...getSchemasForType(DataArrayStatsDto) },
        { title: "where", ...getSchemasForType(DataArrayWhereDto) }
      ]
    }
  })
  public async GetArrayCompute(
    @Param() params: DataArrayParams,
    @Query("op") op?: string,
    @Query("version") version?: string,
    @Query("rangeLo") rangeLo?: string,
    @Query("rangeHi") rangeHi?: string,
    @Query("bins") bins?: string,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<IArrayStatsSummary | IArrayWhereResult> {
    switch (op) {
      case "stats":
        return this.getArrayStats(params, version, rangeLo, rangeHi, bins, transactionId, request);
      case "where":
        if (bins !== undefined) {
          throw new BadRequestException({
            description: `bins is only valid with op=stats`
          });
        }
        return this.getArrayWhere(params, version, rangeLo, rangeHi, transactionId, request);
      default:
        throw new BadRequestException({
          description: `op must be one of stats, where`
        });
    }
  }

  /** `op=stats`: server-side statistical summary (optional range + histogram). */
  private async getArrayStats(
    params: DataArrayParams,
    version?: string,
    rangeLo?: string,
    rangeHi?: string,
    bins?: string,
    transactionId?: string,
    request?: express.Request
  ): Promise<IArrayStatsSummary> {
    const m = dataObjectTypeRegexp.exec(params.dataObjectType);
    const uri = EtpUri.createObjectUri(
      params.dataspaceId,
      m?.groups?.domainFamily ?? "",
      m?.groups?.domainVersion ?? "",
      m?.groups?.dataType ?? "",
      params.guid,
      version
    ).uri;

    let range: { lo: number; hi: number } | undefined = undefined;
    if (rangeLo !== undefined || rangeHi !== undefined) {
      const lo = Number(rangeLo);
      const hi = Number(rangeHi);
      if (rangeLo === undefined || rangeHi === undefined || Number.isNaN(lo) || Number.isNaN(hi)) {
        throw new BadRequestException({
          description: `rangeLo and rangeHi must both be supplied as finite numbers`
        });
      }
      range = { lo, hi };
    }

    let histogramBins: number | undefined = undefined;
    if (bins !== undefined) {
      const b = Number(bins);
      if (!Number.isInteger(b) || b <= 0) {
        throw new BadRequestException({
          description: `bins must be a positive integer`
        });
      }
      if (range === undefined) {
        throw new BadRequestException({
          description: `bins requires rangeLo and rangeHi (the histogram domain)`
        });
      }
      histogramBins = b;
    }

    let c: ResqmlClient | undefined = undefined;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId,
        extractUserInfo(request),
        etpComputeUrl
      );
      const stats = await c.getDataArrayStats(
        uri,
        params.pathInResource,
        range,
        histogramBins
      );
      if (!transactionId) {
        await c.closeSession();
      }
      c = undefined;
      if (!stats) {
        throw new NotImplementedException({
          description: `The connected store does not support server-side array statistics`
        });
      }
      return stats;
    } catch (err) {
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /** `op=where`: range-predicate count with ijk bbox + centroid. */
  private async getArrayWhere(
    params: DataArrayParams,
    version?: string,
    rangeLo?: string,
    rangeHi?: string,
    transactionId?: string,
    request?: express.Request
  ): Promise<IArrayWhereResult> {
    const lo = Number(rangeLo);
    const hi = Number(rangeHi);
    if (
      rangeLo === undefined ||
      rangeHi === undefined ||
      Number.isNaN(lo) ||
      Number.isNaN(hi)
    ) {
      throw new BadRequestException({
        description: `rangeLo and rangeHi must both be supplied as finite numbers`
      });
    }

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
        transactionId,
        extractUserInfo(request),
        etpComputeUrl
      );
      const result = await c.getDataArrayWhere(uri, params.pathInResource, {
        lo,
        hi
      });
      if (!transactionId) {
        await c.closeSession();
      }
      c = undefined;
      if (!result) {
        throw new NotImplementedException({
          description: `The connected store does not support server-side array where queries`
        });
      }
      return result;
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
    description: `Retrieve the numeric data of an array. For large arrays, use \`starts\` and \`counts\` to fetch slices (subarrays) instead of the full dataset.\n\n**starts/counts**: Must be used together. Each is a comma-separated list matching the array dimensions (e.g., \`starts=0,0&counts=100,3\` for first 100 rows × 3 columns). A \`counts\` entry of \`-1\` is a whole-dimension sentinel that expands to the remaining extent of that axis, so a single K-slab of an I×J×K grid property can be fetched as \`starts=0,0,5&counts=-1,-1,1\` without computing the I/J sizes.\n\n**format**: \`json\` (default) returns a number array; \`base64\` returns a base64-encoded binary string (more efficient for large transfers); \`binary\` streams the raw little-endian typed-array bytes as \`application/octet-stream\` (no base64 overhead). For \`binary\`, reshape on the client using the \`x-array-dimensions\` (comma-separated shape) and \`x-array-dtype\` (typed-array name, e.g. \`Float64Array\`) response headers.\n\n**Chunking**: The ETP layer automatically chunks large arrays (~10 MB per WebSocket message) and reassembles on the server side.`,
    servers: swaggerServers
  })
  @ApiQuery(versionQueryParam)
  @ApiQuery(startsQueryParam)
  @ApiQuery(countsQueryParam)
  @ApiQuery(formatQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @ApiProduces("application/json", "application/octet-stream")
  @ApiBadRequestResponse(
    errorMessageSchema(
      `starts and counts dimensions not compatible with array dimensions`
    )
  )
  @ApiOkResponse({
    description:
      "Success. With `format=json`/`base64` the body is a `DataArrayDto` " +
      "(`application/json`). With `format=binary` the body is the raw " +
      "little-endian typed-array bytes (`application/octet-stream`); reshape " +
      "using the `x-array-dimensions` and `x-array-dtype` response headers.",
    headers: {
      "x-array-dimensions": {
        description:
          "`format=binary` only: comma-separated array shape (e.g. `100,3`) " +
          "used to reshape the raw octet-stream bytes.",
        schema: { type: "string", example: "100,3" }
      },
      "x-array-dtype": {
        description:
          "`format=binary` only: typed-array name the octets are packed as " +
          "(`Float64Array`, `Float32Array`, `Int32Array`, `BigInt64Array`, " +
          "`Int8Array`, `Uint8Array`).",
        schema: { type: "string", example: "Float64Array" }
      }
    },
    content: {
      "application/json": {
        schema: getSchemasForType(DataArrayDto)
      },
      "application/octet-stream": {
        schema: { type: "string", format: "binary" }
      }
    }
  })
  @ApiOperation({ servers: swaggerServers })
  public async GetArray(
    @Param() params: DataArrayParams,
    @Res({ passthrough: true }) response: express.Response,
    @Query("version") version?: string,
    @Query("starts", OptionalParseIntArrayPipe) starts?: Index32[],
    @Query("counts", OptionalParseIntArrayPipe) counts?: Integer32[],
    @Query("format") format?: ArrayFormat | "binary",
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<DataArrayDto | StreamableFile> {
    // `format=binary` wins; without an explicit format, an `Accept` header
    // that prefers `application/octet-stream` over JSON also selects the raw
    // typed-array stream (content negotiation for SDK / curl callers).
    const binary =
      format === "binary" ||
      (!format &&
        request?.accepts(["application/json", "application/octet-stream"]) ===
          "application/octet-stream");
    // For binary transport we build the bytes via the base64 path (identical
    // typed-array packing) and decode back to raw octets — dropping base64's
    // 33% inflation on the wire. json/base64 flow through unchanged.
    const dataFormat: ArrayFormat = binary ? "base64" : (format as ArrayFormat) || "json";
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
        transactionId,
        extractUserInfo(request)
      );
      const metadata = await c.getDataArrayMetadata(uri, params.pathInResource);
      if (!metadata) {
        throw new InternalServerErrorException({
          description: `Cannot get subarray metadata`
        });
      }
      if (starts && counts) {
        // Validate the selection and expand any `-1` whole-dimension sentinels
        // in `counts` to the remaining extent of that axis.
        ({ starts, counts } = resolveSubarraySelection(
          metadata.dimensions,
          starts,
          counts
        ));
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
        const dims = subArray.data.dimensions.map(Number);
        const payload = c.formatArrayData(subArray.data.data, dataFormat);
        if (!transactionId) {
          await c.closeSession();
        }
        c = undefined;
        if (binary) {
          return this.sendBinaryArray(
            response,
            payload,
            dims,
            metadata.transportArrayType
          );
        }
        return {
          uid: subArray.uid,
          data: { data: payload, dimensions: dims }
        };
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
      const dims = a.data.dimensions.map(Number);
      const payload = c.formatArrayData(a.data.data, dataFormat);
      if (!transactionId) {
        await c.closeSession();
      }
      c = undefined;
      if (binary) {
        return this.sendBinaryArray(
          response,
          payload,
          dims,
          metadata.transportArrayType
        );
      }
      return {
        uid: a.uid,
        data: { data: payload, dimensions: dims }
      };
    } catch (err) {
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Stream a data array as raw `application/octet-stream` bytes.
   *
   * The values are packed by {@link ResqmlClient.formatArrayData} into a base64
   * string using the natural typed-array layout (Float64/Int32/…); here we decode
   * that back to the underlying octets so the wire carries no base64 overhead.
   * The array shape and element type are surfaced via response headers so the
   * client (resdata/xtgeo/numpy) can reshape without a second metadata call.
   */
  private sendBinaryArray(
    response: express.Response,
    payload: ArrayOutput | undefined,
    dimensions: number[],
    transportArrayType?: Energistics.Etp.v12.Datatypes.AnyArrayType
  ): StreamableFile {
    const buffer =
      typeof payload === "string"
        ? Buffer.from(payload, "base64")
        : Buffer.alloc(0);
    response.setHeader("x-array-dimensions", dimensions.join(","));
    const dtype = binaryDtypeName(transportArrayType);
    if (dtype) {
      response.setHeader("x-array-dtype", dtype);
    }
    return new StreamableFile(buffer, {
      type: "application/octet-stream",
      length: buffer.byteLength
    });
  }
}
