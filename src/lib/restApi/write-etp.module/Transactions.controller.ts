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
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Put,
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
  ApiPreconditionFailedResponse,
  ApiProperty,
  ApiTags,
  ApiTooManyRequestsResponse
} from "@nestjs/swagger";

import {
  IsUUID,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsString,
  IsNotEmpty
} from "class-validator";

import express from "express";

import { EtpUri } from "../../client/ResqmlClient";

import {
  FindInDataSpaceParams,
  HasBearerGuard,
  HasDataPartitionGuard,
  commitTransaction,
  createTransaction,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  getSchemasForType,
  httpErrorFromEtpError,
  partitionPattern,
  patternString,
  rollbackTransaction,
  swaggerServers,
  uuidPattern,
  validateTransactionDataspace,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";
import logging from "../../common/Logging";

const logger = logging.getLogger("EtpClient");

/**
 * Add parameters to identify transaction in the data space
 *
 * @export
 * @class TransactionParams
 */
export class TransactionParams extends FindInDataSpaceParams {
  @ApiProperty({
    name: "transactionId",
    description: "Unique Id of the object",
    example: "1615d8d2-2a2d-482c-885e-14225b89e90c",
    maxLength: 2048,
    pattern: patternString(uuidPattern)
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  transactionId!: string;
}

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

export class CreateTransactionDto {
  @ApiProperty({
    name: "TimeoutPeriod",
    description:
      "Time in seconds before transaction is automatically rolled back (default 300)",
    type: "number",
    example: 1200,
    required: false
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86400)
  TimeoutPeriod?: number;

  @ApiProperty({
    name: "Retries",
    description:
      "If dataspace busy, attempt to create transaction this number of times (default 6)",
    type: "number",
    example: 6,
    required: false
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  Retries?: number;
}

/**
 * Creation, edition and deletion of resources
 *
 * @export
 * @class MutationsAPI
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
@ApiTags("Transactions")
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("dataspaces/:dataspaceId/transactions")
export default class TransactionsAPI {
  /**
   * Create a new transaction
   *
   * @memberof MutationsAPI
   */
  @Post()
  @ApiOkResponse({
    description: "Success",
    schema: {
      type: "string",
      maxLength: 256,
      pattern: patternString(uuidPattern)
    }
  })
  @ApiPreconditionFailedResponse(errorMessageSchema("Precondition failed", 412))
  @ApiBody({
    description: "JSON array of resqml objects",
    schema: getSchemasForType(CreateTransactionDto),
    required: false
  })
  @ApiOperation({
    summary: "Start a new transaction",
    description: `Start a new transaction for atomic write operations in this dataspace.

Returns a \`transactionId\` UUID. Pass it to write/array endpoints as a query parameter.

**Lifecycle**: commit with \`PUT …/transactions/{txId}\`, rollback with \`DELETE …/transactions/{txId}\`.

**Timeout**: Auto-rollback after \`TimeoutPeriod\` seconds (default 300) if no new transaction messages occur.

**Constraint**: Only one transaction can be active per dataspace at a time.

**Typical write workflow**:
\`\`\`
POST  /dataspaces/{ds}/transactions              → transactionId
PUT   /dataspaces/{ds}/resources?transactionId=…  → put objects (JSON array)
PUT   /dataspaces/{ds}/resources/arrays?transactionId=… → put arrays (one per channel)
PUT   /dataspaces/{ds}/transactions/{txId}        → commit
\`\`\``,
    servers: swaggerServers
  })
  public async PostTransaction(
    @Param() params: FindInDataSpaceParams,
    @Body() requestBody?: CreateTransactionDto,
    @Req() request?: express.Request
  ): Promise<string> {
    const uri = EtpUri.createDataSpaceUri(params.dataspaceId).uri;
    logger.info("Creating transaction...");
    // Snyk is reporting this as an XSS issue, but as we ensure token as the right format it can be ignored.
    return createTransaction(
      extractToken(request),
      uri,
      undefined,
      extractDataPartitionId(request),
      requestBody?.TimeoutPeriod ?? 300,
      requestBody?.Retries ?? 6
    )
      .then(transactionId => {
        logger.info(`Transaction created: ${transactionId}`);
        return transactionId;
      })
      .catch(err => {
        logger.error(`Error while creating transaction: ${err}`);
        throw httpErrorFromEtpError(err);
      });
  }

  /**
   * Commit an existing transaction
   *
   * @memberof MutationsAPI
   */
  @Put(":transactionId")
  @ApiOkResponse({
    description: "Success",
    schema: {
      type: "boolean"
    }
  })
  @ApiPreconditionFailedResponse(errorMessageSchema("Precondition failed", 412))
  @ApiOperation({
    summary: "Commit transaction",
    description: `Commit a transaction, making all writes within it permanent. Returns \`true\` on success. The \`transactionId\` is no longer valid after commit.`,
    servers: swaggerServers
  })
  public async CommitTransaction(
    @Param() params: TransactionParams
  ): Promise<boolean> {
    logger.info(`Committing transaction ${params.transactionId}...`);
    try {
      validateTransactionDataspace(params.transactionId, params.dataspaceId);
    } catch (err) {
      throw httpErrorFromEtpError(err);
    }
    return commitTransaction(params.transactionId)
      .then(result => {
        if (result) {
          logger.info(
            `Transaction committed successfully: ${params.transactionId}`
          );
        } else {
          logger.warning(
            `Transaction commit returned false: ${params.transactionId}`
          );
        }
        return result;
      })
      .catch(err => {
        logger.error(
          `Error committing transaction ${params.transactionId}: ${err}`
        );
        throw httpErrorFromEtpError(err);
      });
  }

  /**
   * Rollback an existing transaction
   *
   * @memberof MutationsAPI
   */
  @Delete(":transactionId")
  @ApiOkResponse({
    description: "Success",
    schema: {
      type: "boolean"
    }
  })
  @ApiOperation({
    summary: "Rollback transaction",
    description: `Rollback a transaction, discarding all writes within it. Returns \`true\` on success. Use this to cleanly abort a failed write sequence.`,
    servers: swaggerServers
  })
  public async RollbackTransaction(
    @Param() params: TransactionParams
  ): Promise<boolean> {
    logger.info(`Rolling back transaction ${params.transactionId}...`);
    try {
      validateTransactionDataspace(params.transactionId, params.dataspaceId);
    } catch (err) {
      throw httpErrorFromEtpError(err);
    }
    return rollbackTransaction(params.transactionId)
      .then(result => {
        if (result) {
          logger.info(
            `Transaction rolled back successfully: ${params.transactionId}`
          );
        } else {
          logger.warning(
            `Transaction rollback was not successful: ${params.transactionId}`
          );
        }
        return result;
      })
      .catch(err => {
        logger.error(
          `Error rolling back transaction ${params.transactionId}: ${err}`
        );
        throw httpErrorFromEtpError(err);
      });
  }
}
