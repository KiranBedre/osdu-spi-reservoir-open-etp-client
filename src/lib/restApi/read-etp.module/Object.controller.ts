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
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";

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
  ApiQuery,
  ApiQueryOptions,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse
} from "@nestjs/swagger";

import { IsDefined, IsNotEmpty, IsString, IsUUID } from "class-validator";

import {
  EtpUri,
  ODataUtils,
  ResqmlClient,
  URI,
  byteToString,
  notEmptyFilter
} from "../../client/ResqmlClient";

import express from "express";

import type { IResqmlDataObject } from "../../client/ResqmlClient";

import {
  FindInObjectParams,
  HasBearerGuard,
  HasDataPartitionGuard,
  OptionalParseBoolPipe,
  createSession,
  dataObjectTypePattern,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  getSchemasForType,
  httpErrorFromEtpError,
  partitionPattern,
  patternString,
  sliceArray,
  swaggerServers,
  transactionIdQueryParam,
  uuidPattern,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import {
  datePattern,
  validNamePattern,
  versionQueryParam
} from "./Resource.controller";

import type { QueryInput } from "../ControllerUtils";

import { bigIntToString } from "../../mlTypes/XmlJsonUtil";

import logging from "../../common/Logging";

const logger = logging.getLogger("EtpClient");

/**
 * Sort the response based on the orderBy criteria of the query
 *
 * @param {QueryInput} query query containing the orderby criteria
 * @param {IResqmlDataObject[]} objects lists of objects to send
 * @returns
 */
const sortResponse = (query: QueryInput, objects: IResqmlDataObject[]) => {
  const orderBy = query.orderby;
  const sorting = ODataUtils.createODataSorting(
    typeof orderBy === "string" ? orderBy : ""
  );
  if (sorting.length === 0) {
    return objects;
  }
  const comparator = new ODataUtils.OrderByComparator(sorting);
  return objects.sort(comparator.compareObjects.bind(comparator));
};

type ObjectResponse = Array<any> | string;

/**
 * Send the objects corresponding to provided uris in required format
 *
 * @param {QueryInput} query
 * @param {ResqmlClient} client
 * @param {URI[]} uris
 * @param {string} format
 * @param {boolean} referencedContent
 * @param {boolean} arrayValues
 * @param {boolean} arrayMetadata
 * @param {Map<URI, IResqmlDataObject>} [objects=new Map<URI, IResqmlDataObject>()]
 * @returns {(Promise<ObjectResponse>)}
 */
export const sendObjects = async (
  query: QueryInput,
  client: ResqmlClient,
  uris: URI[],
  format: string,
  referencedContent: boolean,
  arrayValues: boolean,
  arrayMetadata: boolean,
  objects: Map<URI, IResqmlDataObject> = new Map<URI, IResqmlDataObject>()
): Promise<ObjectResponse> => {
  if (!uris) {
    return Promise.resolve([]);
  }
  uris = sliceArray<string>(query.skip, query.top, uris);
  if (uris.length === 0) {
    return Promise.resolve([]);
  }
  if (!format || format === "xml") {
    const dataObjects = await client.getDataObjects(uris);
    const xml = dataObjects
      .map(o =>
        o && o.data.length > 0
          ? byteToString(o.data).replace(
            `<?xml version="1.0" encoding="UTF-8"?>`,
            ""
          )
          : ""
      )
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><DataObjects>${xml}</DataObjects>`;
  } else if (referencedContent || arrayValues || arrayMetadata) {
    const resolvedObjects = await client.getResolvedObjects(
      uris,
      objects,
      arrayValues,
      arrayMetadata,
      "base64",
      referencedContent
    );
    return JSON.stringify(
      sortResponse(query, resolvedObjects.filter(notEmptyFilter)),
      bigIntToString,
      2
    );
  } else {
    const objs = await client.getObjects(uris);
    return JSON.stringify(
      sortResponse(query, objs.filter(notEmptyFilter)),
      bigIntToString,
      2
    );
  }
};

export const formatQueryParam: ApiQueryOptions = {
  name: "$format",
  required: false,
  description: "Expected return format",
  example: "json",
  schema: {
    type: "string",
    enum: ["xml", "json"],
    default: "json"
  }
};

export const referencedContentQueryParam: ApiQueryOptions = {
  name: "referencedContent",
  required: false,
  description: "If true, includes the content of referenced objects",
  example: true,
  schema: {
    type: "boolean",
    default: true
  }
};

export const arrayValuesQueryParam: ApiQueryOptions = {
  name: "arrayValues",
  required: false,
  description:
    "If true, includes the content of referenced objects and the content of array values",
  example: false,
  schema: {
    type: "boolean",
    default: false
  }
};

export const arrayMetadataQueryParam: ApiQueryOptions = {
  name: "arrayMetadata",
  required: false,
  description:
    "If true, includes the content of referenced objects and includes the metadata of arrays such as size and type",
  example: false,
  schema: {
    type: "boolean",
    default: false
  }
};

export class EmlCitationDto {
  @ApiProperty({
    name: "Title",
    pattern: patternString(validNamePattern),
    example: `My Grid`,
    description: "User friendly name of the object.",
    maxLength: 2048
  })
  Title!: string;

  @ApiProperty({
    name: "Originator",
    pattern: patternString(validNamePattern),
    example: `me`,
    description: "Creator of the object.",
    maxLength: 2048
  })
  Originator!: string;

  @ApiProperty({
    name: "Creation",
    pattern: patternString(datePattern),
    example: `2022-01-12T07:22:00Z`,
    description: "Creation date of the object.",
    maxLength: 2048
  })
  Creation!: string;

  @ApiProperty({
    name: "Format",
    pattern: patternString(validNamePattern),
    example: `[Vendor:Software:version]`,
    description: "Identify the software that produces the object.",
    maxLength: 2048
  })
  Format!: string;
}

const schemaVersionPattern = /^"?[.0-9]+"?$/;

/**
 * Describe the Rest information of an eml object
 *
 * @export
 * @class EmlObjectDto
 */
export class EmlObjectDto {
  @ApiProperty({
    name: "Uuid",
    pattern: patternString(uuidPattern),
    example: `68f2a7d4-f7c1-4a75-95e9-3c6a7029fb23`,
    description: "Unique identifier of the object.",
    maxLength: 2048
  })
  @IsUUID()
  @IsNotEmpty()
  Uuid!: string;

  @ApiProperty({
    name: "$type",
    pattern: patternString(dataObjectTypePattern),
    example: `eml20.obj_EpcExternalPartReference`,
    description: "Eml data object type.",
    maxLength: 2048
  })
  @IsString()
  @IsNotEmpty()
  $type!: string;

  @ApiProperty({
    name: "SchemaVersion",
    pattern: patternString(schemaVersionPattern),
    example: `"2.0.0.20140822"`,
    description: "Eml schema version",
    maxLength: 2048
  })
  @IsString()
  @IsNotEmpty()
  SchemaVersion!: string;

  @ApiProperty({
    ...getSchemasForType(EmlCitationDto),
    required: true,
    name: "Citation"
  })
  @IsDefined()
  Citation!: EmlCitationDto;
}

const xmlDocPattern = /^<\?xml.+$/;

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

@ApiBearerAuth("access-token")
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
@Controller("dataspaces/:dataspaceId/resources")
export default class ObjectsReadAPI {
  @Get(":dataObjectType/:guid")
  @ApiOperation({
    summary: "Get object content.",
    description: `Retrieve the full content of a single data object by type and UUID. Returns Energistics XML by default, or JSON with \`$format=json\`.\n\n**JSON mode**: Adds \`$type\` annotations and converts XML attributes to JSON properties — useful for client-side processing without an XML parser.\n\n**arrayMetadata**: When \`true\`, includes inline metadata for all HDF5 arrays referenced by this object (dimensions, data type, path).`,
    servers: swaggerServers
  })
  @ApiQuery(versionQueryParam)
  @ApiQuery(formatQueryParam)
  @ApiQuery(referencedContentQueryParam)
  @ApiQuery(arrayValuesQueryParam)
  @ApiQuery(arrayMetadataQueryParam)
  @ApiQuery(transactionIdQueryParam)
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
  public async GetDataObject(
    @Param() params: FindInObjectParams,
    @Req() request: express.Request,
    @Res() res: express.Response,
    @Query("version") version?: string,
    @Query("$format") format: "xml" | "json" = "json",
    @Query("transactionId") transactionId?: string,
    @Query("referencedContent", OptionalParseBoolPipe) referencedContent = true,
    @Query("arrayValues", OptionalParseBoolPipe) arrayValues = false,
    @Query("arrayMetadata", OptionalParseBoolPipe) arrayMetadata = false
  ): Promise<void> {
    logger.info("Received request to fetch data object.");

    const m = params.dataObjectType.match(
      /^(?<domainFamily>resqml|eml|witsml|prodml)(?<domainVersion>[\d]+).(?<dataType>[\w]+)$/i
    );
    const uris = [
      EtpUri.createObjectUri(
        params.dataspaceId,
        m?.groups?.domainFamily ?? "",
        m?.groups?.domainVersion ?? "",
        m?.groups?.dataType ?? "",
        params.guid,
        version
      ).uri
    ];
    logger.info("URIs generated successfully.");

    if (request.headers["accept"]?.includes("application/x-resqml+json")) {
      format = "json";
      logger.info("Response format set to JSON based on 'accept' header.");
    }
    if (!format || format === "xml") {
      res.contentType("application/x-resqml+xml");
      logger.info("Response format set to XML.");
    } else {
      res.contentType("application/json");
      logger.info("Response format set to JSON.");
    }

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

      logger.info("Fetching data object...");
      const b = await sendObjects(
        {},
        c,
        uris,
        format,
        referencedContent,
        arrayValues,
        arrayMetadata
      );
      logger.info("Data object fetched successfully.");

      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
      c = undefined;

      res.send(b);
      logger.info("Response sent successfully.");
    } catch (err) {
      logger.error("Error occurred while processing data object.", err);
      if (!transactionId) {
        logger.info("Closing session due to error...");
        await c?.closeSession();
        logger.info("Session closed successfully.");
      }
      throw httpErrorFromEtpError(err);
    }
  }
}
