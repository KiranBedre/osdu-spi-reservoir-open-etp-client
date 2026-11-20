// ============================================================================
// Copyright 2019-2026 Emerson Paradigm Holding LLC. All rights reserved.
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
  InternalServerErrorException,
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
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags
} from "@nestjs/swagger";

import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested
} from "class-validator";

import express from "express";

import { Energistics, ResqmlClient } from "../../client/ResqmlClient";
import { EtpUri } from "../../common/EtpUri";

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";
import {
  FindInDataSpaceParams,
  HasDataPartitionGuard,
  createSession,
  dataObjectTypePattern,
  dataObjectTypeRegexp,
  extractDataPartitionId,
  extractToken,
  extractUserInfo,
  getSchemasForType,
  httpErrorFromEtpError,
  partitionPattern,
  patternString,
  swaggerServers,
  transactionIdQueryParam
} from "../ControllerUtils";

// ── DTOs ─────────────────────────────────────────────────────────────────────

/** A reference to one numeric array inside a RESQML object. */
export class ArrayRefDto {
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
 * One curve to co-index against the shared index axis.
 *
 * A curve carries its own `index*` reference only when it was sampled on a
 * *different* `WellboreFrameRepresentation` than the request's shared index
 * (the cross-frame resample case). When omitted the curve is assumed to be
 * sampled on the shared frame and is aligned without resampling.
 */
export class AlignCurveDto extends ArrayRefDto {
  @ApiPropertyOptional({
    name: "name",
    description: "Label for the aligned column (defaults to the array path).",
    example: "GR"
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  name?: string;

  @ApiPropertyOptional({
    name: "indexObjectType",
    description:
      "Energistics type of the object owning this curve's own index array. " +
      "Supply the four `index*` fields only when the curve lives on a " +
      "different frame than the shared index (triggers resampling)."
  })
  @IsOptional()
  @IsString()
  @Matches(dataObjectTypePattern)
  @MaxLength(256)
  indexObjectType?: string;

  @ApiPropertyOptional({ name: "indexGuid" })
  @IsOptional()
  @IsString()
  @IsUUID()
  indexGuid?: string;

  @ApiPropertyOptional({ name: "indexVersion" })
  @IsOptional()
  @IsString()
  indexVersion?: string;

  @ApiPropertyOptional({ name: "indexPathInResource" })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  indexPathInResource?: string;
}

/** Body of the `log-structure/align` request. */
export class AlignRequestDto {
  @ApiProperty({
    ...getSchemasForType(ArrayRefDto),
    name: "index",
    description:
      "The shared index axis every curve is co-registered onto — typically " +
      "the `NodeMd` array of a WellboreFrameRepresentation."
  })
  @ValidateNested()
  @Type(() => ArrayRefDto)
  index!: ArrayRefDto;

  @ApiProperty({
    name: "curves",
    description: "The curves to align onto the shared index.",
    type: [AlignCurveDto],
    minItems: 1,
    maxItems: 128
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(128)
  @ValidateNested({ each: true })
  @Type(() => AlignCurveDto)
  curves!: AlignCurveDto[];
}

/** One aligned curve column in the response. */
export class AlignedCurveDto {
  @ApiProperty({ name: "name", example: "GR" })
  name!: string;

  @ApiProperty({
    name: "resampled",
    description:
      "true when the curve was linearly interpolated onto the shared index " +
      "(it was sampled on a different frame); false for a direct column-bind.",
    example: false
  })
  resampled!: boolean;

  @ApiProperty({
    name: "data",
    description: "The curve values at each shared-index sample.",
    type: "array",
    items: { type: "number" }
  })
  data!: number[];
}

/** Result of `log-structure/align`: the co-indexed sample matrix. */
export class AlignResultDto {
  @ApiProperty({
    name: "rows",
    description: "Number of samples on the shared index axis.",
    type: "integer",
    example: 1500
  })
  rows!: number;

  @ApiProperty({
    name: "aligned",
    description:
      "true when every curve shared the index frame (no resampling needed).",
    example: true
  })
  aligned!: boolean;

  @ApiProperty({
    name: "index",
    description: "The shared index values (one per row).",
    type: "array",
    items: { type: "number" }
  })
  index!: number[];

  @ApiProperty({
    name: "curves",
    type: [AlignedCurveDto]
  })
  curves!: AlignedCurveDto[];
}

/** Route params for the log-structure controller. */
export class LogStructureParams extends FindInDataSpaceParams {}

// ── helpers ───────────────────────────────────────────────────────────────────

function objectUri(
  dataspaceId: string,
  dataObjectType: string,
  guid: string,
  version?: string
): string {
  const m = dataObjectTypeRegexp.exec(dataObjectType);
  return EtpUri.createObjectUri(
    dataspaceId,
    m?.groups?.domainFamily ?? "",
    m?.groups?.domainVersion ?? "",
    m?.groups?.dataType ?? "",
    guid,
    version
  ).uri;
}

/** Fetch an array as a flat `number[]` via the JSON formatter. */
async function readNumbers(
  c: ResqmlClient,
  uri: string,
  pathInResource: string
): Promise<number[]> {
  const metadata = await c.getDataArrayMetadata(uri, pathInResource);
  if (!metadata) {
    throw new InternalServerErrorException({
      description: `Cannot get array metadata for ${pathInResource}`
    });
  }
  const a = await c.getDataArray(uri, pathInResource, metadata);
  if (
    !a ||
    !a.data ||
    a.data instanceof Energistics.Etp.v12.Datatypes.ErrorInfo
  ) {
    throw new InternalServerErrorException({
      description: `Cannot fetch array ${pathInResource}`
    });
  }
  const payload = c.formatArrayData(a.data.data, "json");
  if (!Array.isArray(payload)) {
    throw new InternalServerErrorException({
      description: `Array ${pathInResource} is not numeric`
    });
  }
  return (payload as unknown[]).map(Number);
}

/**
 * Linearly interpolate `y` sampled at `x` onto `xi` (NumPy `interp` semantics:
 * clamp to the endpoints outside the domain). `x` is assumed monotonically
 * non-decreasing. Runs in a single pass since `xi` (the shared index) is also
 * monotonic.
 */
export function interp(xi: number[], x: number[], y: number[]): number[] {
  const n = x.length;
  const out = new Array<number>(xi.length);
  if (n === 0) return out.fill(NaN);
  let j = 0;
  for (let i = 0; i < xi.length; i++) {
    const t = xi[i];
    if (t <= x[0]) {
      out[i] = y[0];
      continue;
    }
    if (t >= x[n - 1]) {
      out[i] = y[n - 1];
      continue;
    }
    while (j < n - 1 && x[j + 1] < t) j++;
    const x0 = x[j];
    const x1 = x[j + 1];
    const span = x1 - x0;
    const frac = span === 0 ? 0 : (t - x0) / span;
    out[i] = y[j] + frac * (y[j + 1] - y[j]);
  }
  return out;
}

function sameIndex(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    // frames are stored as the same float samples; tolerate fp noise.
    if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  }
  return true;
}

// ── controller ────────────────────────────────────────────────────────────────

@ApiBearerAuth()
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
@ApiTags("Well")
@Controller("/dataspaces/:dataspaceId/log-structure")
export default class LogStructureAPI {
  /**
   * Co-index several well-log curves onto one shared index axis.
   *
   * This is the align-without-resample primitive behind the petrophysics
   * log-structure overlay: curves sampled on the *same* WellboreFrame share
   * the shared index node-for-node and are column-bound directly (no
   * interpolation, so no values are invented). Curves that carry their own
   * `index*` reference (a different frame) are linearly interpolated onto the
   * shared index and flagged `resampled: true`.
   */
  @Post("align")
  @ApiOperation({
    summary: "Co-index curves onto a shared index axis",
    description:
      "Reads the shared index array (typically a WellboreFrame `NodeMd`) and " +
      "each curve, then joins them into one sample matrix. Curves on the same " +
      "frame are aligned without resampling (node-for-node column-bind); " +
      "curves on a different frame are linearly interpolated onto the shared " +
      "index and marked `resampled`. The `:dataspaceId` is the only route " +
      "anchor; all object references live in the body.",
    servers: swaggerServers
  })
  @ApiQuery(transactionIdQueryParam)
  @ApiBody({ type: AlignRequestDto })
  @ApiOkResponse({
    description: "Success",
    schema: getSchemasForType(AlignResultDto)
  })
  public async Align(
    @Param() params: LogStructureParams,
    @Body() body: AlignRequestDto,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<AlignResultDto> {
    const curves = body?.curves ?? [];
    if (curves.length === 0) {
      throw new BadRequestException({
        description: `At least one curve must be supplied`
      });
    }
    if (!body?.index) {
      throw new BadRequestException({ description: `index is required` });
    }

    let c: ResqmlClient | undefined = undefined;
    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId,
        extractUserInfo(request)
      );

      const indexUri = objectUri(
        params.dataspaceId,
        body.index.dataObjectType,
        body.index.guid,
        body.index.version
      );
      const sharedIndex = await readNumbers(
        c,
        indexUri,
        body.index.pathInResource
      );

      const aligned: AlignedCurveDto[] = [];
      let allDirect = true;

      for (const curve of curves) {
        const curveUri = objectUri(
          params.dataspaceId,
          curve.dataObjectType,
          curve.guid,
          curve.version
        );
        const values = await readNumbers(c, curveUri, curve.pathInResource);
        const name = curve.name ?? curve.pathInResource;

        const hasOwnIndex =
          curve.indexObjectType &&
          curve.indexGuid &&
          curve.indexPathInResource;

        if (hasOwnIndex) {
          const curveIndexUri = objectUri(
            params.dataspaceId,
            curve.indexObjectType!,
            curve.indexGuid!,
            curve.indexVersion
          );
          const curveIndex = await readNumbers(
            c,
            curveIndexUri,
            curve.indexPathInResource!
          );
          if (sameIndex(curveIndex, sharedIndex)) {
            if (values.length !== sharedIndex.length) {
              throw new BadRequestException({
                description: `Curve "${name}" length ${values.length} does not match its index length ${curveIndex.length}`
              });
            }
            aligned.push({ name, resampled: false, data: values });
          } else {
            if (values.length !== curveIndex.length) {
              throw new BadRequestException({
                description: `Curve "${name}" length ${values.length} does not match its index length ${curveIndex.length}`
              });
            }
            allDirect = false;
            aligned.push({
              name,
              resampled: true,
              data: interp(sharedIndex, curveIndex, values)
            });
          }
        } else {
          if (values.length !== sharedIndex.length) {
            throw new BadRequestException({
              description: `Curve "${name}" length ${values.length} does not match the shared index length ${sharedIndex.length}; supply this curve's own index* to resample`
            });
          }
          aligned.push({ name, resampled: false, data: values });
        }
      }

      if (!transactionId) {
        await c.closeSession();
      }
      c = undefined;

      return {
        rows: sharedIndex.length,
        aligned: allDirect,
        index: sharedIndex,
        curves: aligned
      };
    } catch (err) {
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }
}
