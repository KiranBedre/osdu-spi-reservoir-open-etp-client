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

// Single entry point for every server-side array computation
// (STATS / REDUCE / WHERE / WHEREN / ARITH). The operation is selected by the
// `op` field of the body; `async: true` turns the same request into a compute
// job (see ComputeJobs.controller.ts) instead of answering inline. Every op
// runs against the compute endpoint (`etpComputeUrl`) so heavy folds never sit
// on the store/transaction path.

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotImplementedException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiDefaultResponse,
  ApiExtraModels,
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
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  getSchemaPath
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested
} from "class-validator";
import express from "express";

import { ResqmlClient } from "../../client/ResqmlClient";
import { etpComputeUrl } from "../../common/config";
import { EtpUri } from "../../common/EtpUri";
import {
  FindInDataSpaceParams,
  HasBearerGuard,
  HasDataPartitionGuard,
  createSession,
  dataObjectTypePattern,
  dataObjectTypeRegexp,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  extractUserInfo,
  httpErrorFromEtpError,
  partitionPattern,
  patternString,
  swaggerServers,
  transactionIdQueryParam,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";
import {
  ComputeJobView,
  computeJobQueue
} from "../compute-jobs.module/ComputeJobQueue";
import {
  DataArrayArithDto,
  DataArrayArithRequestDto,
  DataArrayMultiWhereDto,
  DataArrayReduceDto,
  DataArrayStatsDto,
  DataArrayWhereDto,
  DataArrayWhereMultiRequestDto,
  MultiWherePredicateDto
} from "./Array.controller";

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

export const computeOps = ["stats", "reduce", "where", "where-multi", "arith"] as const;
export type ComputeOp = (typeof computeOps)[number];

export const reducers = ["sum", "mean", "min", "max", "count", "net"] as const;
export type Reducer = (typeof reducers)[number];

/** The array a single-array op (`stats`, `reduce`, `where`) is evaluated on. */
export class ArrayComputeTargetDto {
  @ApiProperty({
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
    description: "Unique id of the object owning the array.",
    example: "53395ada-6f93-4bac-b506-d45997ded2a2"
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  guid!: string;

  @ApiPropertyOptional({ description: "Object version; latest when omitted." })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiProperty({
    description: "Identifier of the array inside the container.",
    example: "/RESQML/a3f31b20-c93a-4682-8f6c-71be087202a4/values_patch0"
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  pathInResource!: string;
}

/**
 * One request shape for all compute ops. Which fields are read depends on
 * `op`:
 *
 * | op            | required                                   | optional                                  |
 * |---------------|--------------------------------------------|-------------------------------------------|
 * | `stats`       | `target`                                   | `rangeLo`+`rangeHi`, `bins` (needs range) |
 * | `reduce`      | `target`, `reducer`                        | `k0`+`k1`, `rangeLo`+`rangeHi` (required for `count`/`net`), `cellDz` |
 * | `where`       | `target`, `rangeLo`, `rangeHi`             |                                           |
 * | `where-multi` | `predicates` or `batches`                  |                                           |
 * | `arith`       | `arith`                                    |                                           |
 */
export class ArrayComputeRequestDto {
  @ApiProperty({
    description: "Which computation to run inside the store.",
    enum: computeOps,
    example: "stats"
  })
  @IsIn(computeOps)
  op!: ComputeOp;

  @ApiPropertyOptional({
    description: "Array operated on by `stats`, `reduce` and `where`.",
    type: ArrayComputeTargetDto
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ArrayComputeTargetDto)
  target?: ArrayComputeTargetDto;

  @ApiPropertyOptional({
    description:
      "Inclusive lower bound of the value window. `where` requires it; `stats` uses it for `inRangeCount` and the histogram; `reduce` needs it for `count`/`net`.",
    type: "number",
    example: 0.2
  })
  @IsOptional()
  @IsNumber()
  rangeLo?: number;

  @ApiPropertyOptional({
    description: "Inclusive upper bound of the value window (see `rangeLo`).",
    type: "number",
    example: 1
  })
  @IsOptional()
  @IsNumber()
  rangeHi?: number;

  @ApiPropertyOptional({
    description:
      "`stats` only: number of equal-width histogram bins over `[rangeLo, rangeHi]`; also yields p10/p50/p90.",
    type: "integer",
    example: 32
  })
  @IsOptional()
  @IsNumber()
  bins?: number;

  @ApiPropertyOptional({
    description:
      "`reduce` only: how to collapse the K axis. `count` and `net` count the cells inside `[rangeLo, rangeHi]`; `net` multiplies by `cellDz`.",
    enum: reducers,
    example: "mean"
  })
  @IsOptional()
  @IsIn(reducers)
  reducer?: Reducer;

  @ApiPropertyOptional({
    description: "`reduce` only: first K layer (inclusive) of the K-zone.",
    type: "integer",
    example: 0
  })
  @IsOptional()
  @IsNumber()
  k0?: number;

  @ApiPropertyOptional({
    description: "`reduce` only: last K layer (exclusive) of the K-zone.",
    type: "integer",
    example: 10
  })
  @IsOptional()
  @IsNumber()
  k1?: number;

  @ApiPropertyOptional({
    description: "`reduce` only (`net`): cell thickness multiplier.",
    type: "number",
    example: 2.5
  })
  @IsOptional()
  @IsNumber()
  cellDz?: number;

  @ApiPropertyOptional({
    description:
      "`where-multi` only: predicates to AND over the shared grid. All referenced arrays must share the same `[Nk, Nj, Ni]` shape.",
    type: [MultiWherePredicateDto],
    minItems: 1,
    maxItems: 64
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => MultiWherePredicateDto)
  predicates?: MultiWherePredicateDto[];

  @ApiPropertyOptional({
    description:
      "`where-multi` only: many predicate sets evaluated one after another (one result each). Mutually exclusive with `predicates`; typically combined with `async: true`.",
    type: [DataArrayWhereMultiRequestDto],
    minItems: 1,
    maxItems: 256
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(256)
  @ValidateNested({ each: true })
  @Type(() => DataArrayWhereMultiRequestDto)
  batches?: DataArrayWhereMultiRequestDto[];

  @ApiPropertyOptional({
    description: "`arith` only: the arithmetic expression `C = op(A[, B | scalar])`.",
    type: DataArrayArithRequestDto
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DataArrayArithRequestDto)
  arith?: DataArrayArithRequestDto;

  @ApiPropertyOptional({
    description:
      "When true the request is queued as a compute job and the call answers 202 with the job view; poll `GET /compute/jobs/{id}`. Use for long batches that would exceed the request deadline.",
    default: false
  })
  @IsOptional()
  @IsBoolean()
  async?: boolean;
}

type ComputeStep = (c: ResqmlClient) => Promise<unknown | null>;

interface ComputePlan {
  steps: ComputeStep[];
  /** 501 message when the store answers "not supported" (null result). */
  unsupported: string;
}

const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function parseRange(
  body: ArrayComputeRequestDto,
  required: boolean
): { lo: number; hi: number } | undefined {
  if (body.rangeLo === undefined && body.rangeHi === undefined) {
    if (required) {
      throw new BadRequestException({
        description: `op=${body.op} requires rangeLo and rangeHi`
      });
    }
    return undefined;
  }
  if (!finite(body.rangeLo) || !finite(body.rangeHi)) {
    throw new BadRequestException({
      description: `rangeLo and rangeHi must both be supplied as finite numbers`
    });
  }
  return { lo: body.rangeLo, hi: body.rangeHi };
}

function targetUri(
  dataspaceId: string,
  t: { dataObjectType: string; guid: string; version?: string }
): string {
  const m = dataObjectTypeRegexp.exec(t.dataObjectType);
  return EtpUri.createObjectUri(
    dataspaceId,
    m?.groups?.domainFamily ?? "",
    m?.groups?.domainVersion ?? "",
    m?.groups?.dataType ?? "",
    t.guid,
    t.version
  ).uri;
}

function requireTarget(body: ArrayComputeRequestDto): ArrayComputeTargetDto {
  const t = body.target;
  if (!t || !t.dataObjectType || !t.guid || !t.pathInResource) {
    throw new BadRequestException({
      description: `op=${body.op} requires target.{dataObjectType, guid, pathInResource}`
    });
  }
  return t;
}

function resolvePredicates(
  dataspaceId: string,
  predicates: MultiWherePredicateDto[] | undefined
): { uri: string; pathInResource: string; range: { lo: number; hi: number } }[] {
  if (!predicates || predicates.length === 0) {
    throw new BadRequestException({
      description: `At least one predicate must be supplied`
    });
  }
  return predicates.map(p => {
    if (!finite(Number(p.rangeLo)) || !finite(Number(p.rangeHi))) {
      throw new BadRequestException({
        description: `rangeLo and rangeHi must both be finite numbers for every predicate`
      });
    }
    return {
      uri: targetUri(dataspaceId, p),
      pathInResource: p.pathInResource,
      range: { lo: Number(p.rangeLo), hi: Number(p.rangeHi) }
    };
  });
}

/** Turn the validated body into the store calls it stands for. */
export function planCompute(
  dataspaceId: string,
  body: ArrayComputeRequestDto
): ComputePlan {
  switch (body.op) {
    case "stats": {
      const t = requireTarget(body);
      const range = parseRange(body, false);
      let bins: number | undefined;
      if (body.bins !== undefined) {
        if (!Number.isInteger(body.bins) || body.bins <= 0) {
          throw new BadRequestException({
            description: `bins must be a positive integer`
          });
        }
        if (!range) {
          throw new BadRequestException({
            description: `bins requires rangeLo and rangeHi (the histogram domain)`
          });
        }
        bins = body.bins;
      }
      const uri = targetUri(dataspaceId, t);
      return {
        steps: [c => c.getDataArrayStats(uri, t.pathInResource, range, bins)],
        unsupported: `The connected store does not support server-side array statistics`
      };
    }
    case "reduce": {
      const t = requireTarget(body);
      const reducer = body.reducer;
      if (!reducer || !(reducers as readonly string[]).includes(reducer)) {
        throw new BadRequestException({
          description: `reducer must be one of ${reducers.join(", ")}`
        });
      }
      let kRange: { k0: number; k1: number } | undefined;
      if (body.k0 !== undefined || body.k1 !== undefined) {
        const { k0, k1 } = body;
        if (
          !Number.isInteger(k0) ||
          !Number.isInteger(k1) ||
          (k0 as number) < 0 ||
          (k1 as number) <= (k0 as number)
        ) {
          throw new BadRequestException({
            description: `k0 and k1 must both be supplied as integers with 0 <= k0 < k1`
          });
        }
        kRange = { k0: k0 as number, k1: k1 as number };
      }
      const range = parseRange(body, reducer === "count" || reducer === "net");
      if (body.cellDz !== undefined && !finite(body.cellDz)) {
        throw new BadRequestException({
          description: `cellDz must be a finite number`
        });
      }
      const uri = targetUri(dataspaceId, t);
      return {
        steps: [
          c =>
            c.getDataArrayReduce(uri, t.pathInResource, reducer, {
              kRange,
              range,
              cellDz: body.cellDz
            })
        ],
        unsupported: `The connected store does not support server-side array reduction`
      };
    }
    case "where": {
      const t = requireTarget(body);
      const range = parseRange(body, true) as { lo: number; hi: number };
      const uri = targetUri(dataspaceId, t);
      return {
        steps: [c => c.getDataArrayWhere(uri, t.pathInResource, range)],
        unsupported: `The connected store does not support server-side array where queries`
      };
    }
    case "where-multi": {
      if (body.predicates && body.batches) {
        throw new BadRequestException({
          description: `Supply either predicates (one set) or batches (many sets), not both`
        });
      }
      const sets = body.batches
        ? body.batches.map(b => resolvePredicates(dataspaceId, b?.predicates))
        : [resolvePredicates(dataspaceId, body.predicates)];
      return {
        steps: sets.map(s => (c: ResqmlClient) => c.getDataArrayWhereMulti(s)),
        unsupported: `The connected store does not support server-side multi-array where queries`
      };
    }
    case "arith": {
      const a = body.arith;
      if (!a?.op) {
        throw new BadRequestException({ description: `arith.op must be supplied` });
      }
      if (a.kind !== "binary" && a.kind !== "scalar" && a.kind !== "unary") {
        throw new BadRequestException({
          description: `arith.kind must be one of 'binary', 'scalar' or 'unary'`
        });
      }
      if (a.kind === "binary" && !a.operandB) {
        throw new BadRequestException({
          description: `arith.operandB is required when kind='binary'`
        });
      }
      if (a.kind === "scalar" && !finite(Number(a.scalar))) {
        throw new BadRequestException({
          description: `arith.scalar must be a finite number when kind='scalar'`
        });
      }
      if (!a.result || !a.operandA) {
        throw new BadRequestException({
          description: `arith.result and arith.operandA are required`
        });
      }
      const resultUri = targetUri(dataspaceId, a.result);
      const aUri = targetUri(dataspaceId, a.operandA);
      const bUri = a.operandB ? targetUri(dataspaceId, a.operandB) : undefined;
      const kind = a.kind;
      return {
        steps: [
          c =>
            c.getDataArrayArith(
              resultUri,
              a.result.pathInResource,
              a.op,
              aUri,
              a.operandA.pathInResource,
              {
                operandB: bUri,
                operandBPathInResource: a.operandB?.pathInResource,
                scalar: a.scalar,
                scalar2: a.scalar2,
                kind
              }
            )
        ],
        unsupported: `The connected store does not support server-side array arithmetic`
      };
    }
    default:
      throw new BadRequestException({
        description: `op must be one of ${computeOps.join(", ")}`
      });
  }
}

/**
 * Server-side array compute: one route, five operations, sync or as a job.
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
@ApiTags("Query")
@ApiExtraModels(
  DataArrayStatsDto,
  DataArrayReduceDto,
  DataArrayWhereDto,
  DataArrayMultiWhereDto,
  DataArrayArithDto
)
@ApiUnauthorizedResponse(errorMessageSchema("Unauthorized", 401))
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("/dataspaces/:dataspaceId/arrays")
export default class ArrayComputeAPI {
  @Post("compute")
  @HttpCode(200)
  @ApiOperation({
    summary: "Run a server-side array computation (stats, reduce, where, where-multi, arith)",
    description: `Evaluates one computation **inside the store** without transferring array bytes. Pick the operation with \`op\`:

- \`stats\`: fixed-size summary (count, nulls, min/max/mean/stddev/sum) of \`target\`; add \`rangeLo\`/\`rangeHi\` for \`inRangeCount\` and \`bins\` for a histogram with p10/p50/p90.
- \`reduce\`: collapse a 3-D property \`[Nk, Nj, Ni]\` over K into a 2-D column map with \`reducer\` (\`sum\`, \`mean\`, \`min\`, \`max\`, \`count\`, \`net\`), optionally inside a \`[k0, k1)\` K-zone. \`count\`/\`net\` need a value range; \`net\` multiplies by \`cellDz\`.
- \`where\`: cells of \`target\` inside \`[rangeLo, rangeHi]\`: count, inclusive ijk bbox and ijk centroid.
- \`where-multi\`: AND one predicate per property (\`predicates\`), or many predicate sets (\`batches\`, one result each); all arrays must share the grid shape.
- \`arith\`: \`C = op(A[, B | scalar])\` written into the pre-declared writable array \`arith.result\` (see the \`arith\` schema for binary/scalar/unary forms).

**async**: with \`async: true\` the request is queued and answered with 202 and a job view; poll \`GET /compute/jobs/{id}\`, cancel with \`DELETE\`. Synchronous calls answer the result of the op directly (an array of results for \`batches\`).

Returns 501 when the connected store does not implement the requested extension. The curl-friendly \`GET .../resources/{type}/{guid}/arrays/{path}/compute?op=stats|where\` route (under Resources) is a shortcut for the \`stats\`/\`where\` ops.`,
    servers: swaggerServers
  })
  @ApiQuery(transactionIdQueryParam)
  @ApiBody({ type: ArrayComputeRequestDto })
  @ApiOkResponse({
    description: "Result of the operation (one object, or an array of objects for `batches`)",
    schema: {
      oneOf: [
        { $ref: getSchemaPath(DataArrayStatsDto) },
        { $ref: getSchemaPath(DataArrayReduceDto) },
        { $ref: getSchemaPath(DataArrayWhereDto) },
        { $ref: getSchemaPath(DataArrayMultiWhereDto) },
        { $ref: getSchemaPath(DataArrayArithDto) },
        {
          type: "array",
          items: { $ref: getSchemaPath(DataArrayMultiWhereDto) }
        }
      ]
    }
  })
  public async compute(
    @Param() params: FindInDataSpaceParams,
    @Body() body: ArrayComputeRequestDto,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request,
    @Res({ passthrough: true }) response?: express.Response
  ): Promise<unknown> {
    const plan = planCompute(params.dataspaceId, body);
    const jwt = extractToken(request);
    const dataPartitionId = extractDataPartitionId(request);

    if (body.async) {
      // Each step opens its own compute-routed session so a canceled job never
      // leaves a half-used session behind. The token lives only in this
      // process memory for the job's lifetime (same trust boundary as a pooled
      // session).
      const job: ComputeJobView = computeJobQueue.submit({
        type: body.op,
        total: plan.steps.length,
        run: async (signal, onProgress) => {
          const results: unknown[] = [];
          for (let i = 0; i < plan.steps.length; i++) {
            if (signal.aborted) {
              break;
            }
            let c: ResqmlClient | undefined;
            try {
              c = await createSession(
                jwt,
                dataPartitionId,
                undefined,
                undefined,
                undefined,
                etpComputeUrl
              );
              const r = await plan.steps[i](c);
              if (r === null) {
                throw new NotImplementedException({ description: plan.unsupported });
              }
              results.push(r);
            } catch (err) {
              throw httpErrorFromEtpError(err);
            } finally {
              await c?.closeSession();
            }
            onProgress(i + 1);
          }
          return plan.steps.length === 1 && !body.batches ? results[0] : results;
        }
      });
      response?.status(202);
      return job;
    }

    let c: ResqmlClient | undefined;
    try {
      c = await createSession(
        jwt,
        dataPartitionId,
        undefined,
        transactionId,
        extractUserInfo(request),
        etpComputeUrl
      );
      const results: unknown[] = [];
      for (const step of plan.steps) {
        const r = await step(c);
        if (r === null) {
          throw new NotImplementedException({ description: plan.unsupported });
        }
        results.push(r);
      }
      if (!transactionId) {
        await c.closeSession();
      }
      c = undefined;
      return body.batches ? results : results[0];
    } catch (err) {
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }
}
