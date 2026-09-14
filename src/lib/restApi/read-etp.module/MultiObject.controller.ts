import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";

import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiDefaultResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiInternalServerErrorResponse,
  ApiNotAcceptableResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse
} from "@nestjs/swagger";

import express from "express";

import { ArrayNotEmpty, IsArray, IsNotEmpty, IsString } from "class-validator";

import {
  EmlObjectDto,
  arrayMetadataQueryParam,
  arrayValuesQueryParam,
  formatQueryParam,
  referencedContentQueryParam,
  sendObjects
} from "./Object.controller";

import {
  HasBearerGuard,
  HasDataPartitionGuard,
  OptionalParseBoolPipe,
  createSession,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  getSchemasForType,
  httpErrorFromEtpError,
  patternString,
  swaggerServers,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import { uriPattern } from "./Resource.controller";
import logging from "../../common/Logging";

const logger = logging.getLogger("EtpClient");

const xmlDocPattern = /^<\?xml.+$/;

export class UrisDto {
  @ApiProperty({
    name: "uris",
    type: [String],
    maxItems: 99999,
    maxLength: 2048,
    example: [
      "eml:///dataspace('demo/Volve')/resqml20.obj_TriangulatedSetRepresentation(a3f31b20-c93a-4682-8f6c-71be087202a4)",

      "eml:///dataspace('demo/Volve')/resqml20.obj_ContinuousProperty(1615d8d2-2a2d-482c-885e-14225b89e90c)"
    ],
    pattern: patternString(uriPattern)
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  uris!: string[];
}

@ApiBearerAuth("HTTPBearer")
@UseGuards(HasBearerGuard("jwt"))
@UseGuards(HasDataPartitionGuard())
@ApiTags("Resources")
@ApiBadRequestResponse(errorMessageSchema("Bad Request", 400))
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("dataspaces/multi-resources")
export default class MultiObjectsReadAPI {
  @Post("get-content")
  @ApiOperation({
    summary: "Batch-fetch content of multiple objects.",
    description: `Retrieve the full content of multiple data objects by URI in a single call. More efficient than individual GET requests when fetching several objects.\n\nReturns results in the same format as single-object GET (\`$format=json\` or \`$format=xml\`). Pass an array of ETP URIs in the request body.`,
    servers: swaggerServers
  })
  @ApiBody({
    schema: getSchemasForType(UrisDto)
  })
  @ApiQuery(formatQueryParam)
  @ApiQuery(referencedContentQueryParam)
  @ApiQuery(arrayValuesQueryParam)
  @ApiQuery(arrayMetadataQueryParam)
  @ApiOkResponse({
    description: "Success",
    content: {
      "application/x-resqml+xml": {
        schema: {
          type: "string",
          maxLength: 200000,
          pattern: patternString(xmlDocPattern)
        }
      },
      "application/json": {
        schema: {
          type: "array",
          maxItems: 256,
          additionalProperties: false,
          items: getSchemasForType(EmlObjectDto, true)
        }
      }
    }
  })
  public async GetDataObjects(
    @Body() body: UrisDto,
    @Req() request: express.Request,
    @Res() res: express.Response,
    @Query("$format") format: "xml" | "json" = "json",
    @Query("referencedContent", OptionalParseBoolPipe) referencedContent = true,
    @Query("arrayValues", OptionalParseBoolPipe) arrayValues = false,
    @Query("arrayMetadata", OptionalParseBoolPipe) arrayMetadata = false
  ): Promise<void> {
    logger.info("Received request to fetch data objects.");

    const uris = body.uris;
    if (!uris) {
      logger.warning("No URIs provided in the request body.");
      throw new BadRequestException({
        description: `Invalid request body: 'uris' must be a non-empty array`
      });
    }

    if (!format || format === "xml") {
      res.set("Content-Type", "application/x-resqml+xml");
      logger.debug("Response format set to XML.");
    } else {
      res.set("Content-Type", "application/json");
      logger.debug("Response format set to JSON.");
    }

    let c = undefined;
    try {
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );
      logger.info("Session created successfully.");

      logger.info("Sending objects...");
      const b = await sendObjects(
        {},
        c,
        uris,
        format,
        referencedContent,
        arrayValues,
        arrayMetadata
      );
      logger.info("Objects sent successfully.");
      res.send(b);

      logger.info("Closing session...");
      await c.closeSession();
      c = undefined;
      logger.info("Session closed successfully.");
    } catch (err) {
      // httpErrorFromEtpError logs the error server-side with the
      // operation context; no need to duplicate the log here.
      await c?.closeSession();
      throw httpErrorFromEtpError(err, "MultiObject get-content");
    }
  }
}
