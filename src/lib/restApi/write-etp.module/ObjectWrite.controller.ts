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
  Param,
  Put,
  Query,
  Req,
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
  ApiProperty,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse
} from "@nestjs/swagger";

import {
  IsUUID,
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  IsInt,
  ArrayNotEmpty,
  IsIn,
  Min
} from "class-validator";

import express from "express";

import {
  DataObject,
  Energistics,
  EtpUri,
  IArrayId,
  ResqmlClient
} from "../../client/ResqmlClient";

import {
  FindInDataSpaceParams,
  FindInObjectParams,
  HasBearerGuard,
  HasDataPartitionGuard,
  createSession,
  dataObjectTypePattern,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  getSchemasForType,
  httpErrorFromEtpError,
  partitionPattern,
  patternString,
  swaggerServers,
  transactionIdQueryParam,
  uuidPattern,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import { AvroString, Integer32 } from "../../common/Etp12";

import { XMLBuilder } from "../../mlTypes/Json2Xml";
import { bigIntToString } from "../../mlTypes/XmlJsonUtil";

import { ValidatorClient } from "../../client/ValidatorClient";
import type { ValidationReport } from "../../client/ValidatorClient";

import { AnyTypedArray } from "../../protocols/ArrayCustomer";
import { EmlObjectDto } from "../read-etp.module/Object.controller";
import {
  AnyTypedArrayString,
  arrayPathPattern,
  arrayTypeString
} from "../read-etp.module/Array.controller";
import { versionQueryParam } from "../read-etp.module/Resource.controller";

import { qualifiedTypeRegex } from "../../common/EtpQualifiedType";

import logging from "../../common/Logging";
import { ErrorCode, EtpDataValue, EtpError } from "../../common/EtpTypes";
const logger = logging.getLogger("EtpClient");

const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class DataArrayDto {
  @ApiProperty({
    name: "ContainerType",
    description: "Type of the array container",
    pattern: patternString(dataObjectTypePattern),
    example: `eml20.obj_EpcExternalPartReference`,
    maxLength: 256
  })
  @IsString()
  @IsNotEmpty()
  ContainerType!: string;

  @ApiProperty({
    name: "ContainerUuid",
    description: "Type of the array container",
    pattern: patternString(uuidPattern),
    maxLength: 256
  })
  @IsUUID()
  ContainerUuid!: string;

  @ApiProperty({
    name: "PathInResource",
    description: "Path of the data array in the container",
    pattern: patternString(arrayPathPattern),
    maxLength: 256
  })
  @IsString()
  @IsNotEmpty()
  PathInResource!: string;

  @ApiProperty({
    name: "Dimensions",
    description: "Overall size of the entire array (One value per dimension)",
    required: true,
    isArray: true,
    maxItems: 256,
    type: "integer",
    format: "int32",
    minimum: 1,
    maximum: 1000000
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(1, { each: true })
  Dimensions!: Integer32[];

  @ApiProperty({
    name: "PreferredSubarrayDimensions",
    description: "Preferred size of an array size(One value per dimension)",
    required: false,
    isArray: true,
    maxItems: 256,
    type: "integer",
    format: "int32",
    minimum: 1,
    maximum: 1000000
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  PreferredSubarrayDimensions?: Integer32[];

  @ApiProperty({
    name: "Data",
    description:
      "Numerical values (as a JSON array of number or a base64 encoded string) or the subarray if starts and counts are present",
    required: false,
    oneOf: [
      {
        type: "array",
        maxItems: 1000,
        additionalProperties: false,
        items: {
          type: "number",
          format: "integer",
          minimum: 0,
          maximum: 1000000
        }
      },
      {
        type: "string",
        format: "base64",
        maxLength: 10000000,
        pattern: patternString(base64Pattern)
      }
    ]
  })
  @IsOptional()
  Data?: number[] | string;

  @ApiProperty({
    name: "Starts",
    description: "First index of a subarray (One value per dimension)",
    required: false,
    isArray: true,
    maxItems: 256,
    type: "number",
    format: "integer",
    minimum: 0,
    maximum: 1000000,
    additionalProperties: false
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  Starts?: Integer32[];

  @ApiProperty({
    name: "Counts",
    description: "Number of index in a subarray (One value per dimension)",
    required: false,
    isArray: true,
    maxItems: 256,
    type: "number",
    format: "integer",
    minimum: 0,
    maximum: 1000000,
    additionalProperties: false
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  Counts?: Integer32[];

  @ApiProperty({
    name: "ArrayType",
    description: "Type of arrays",
    enum: arrayTypeString,
    example: "Int32Array"
  })
  @IsNotEmpty()
  @IsIn(arrayTypeString)
  ArrayType!: AnyTypedArrayString;
}

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

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
@ApiTags("Write")
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("dataspaces/:dataspaceId/resources")
export default class MutationsAPI {
  /**
   * Put a new data object or replace existing object formatted as json
   *
   * @memberof MutationsAPI
   */
  @Put()
  @ApiBody({
    description: "JSON array of resqml objects",
    schema: {
      type: "array",
      maxItems: 10000,
      items: getSchemasForType(EmlObjectDto)
    },
    examples: {
      "PointSet And Associates": {
        value: [
          {
            Citation: {
              Title: "CustomTestCrs",
              Originator: "dalsaab",
              Creation: "2021-09-02T07:57:28.000Z",
              Format:
                "RESQML Modeling Application v1.0 for Linux_x64",
              Editor: "dalsaab",
              LastUpdate: "2021-09-06T13:30:24.000Z"
            },
            YOffset: 6470000,
            ZOffset: 0,
            ArealRotation: {
              _: 0,
              $type: "eml20.PlaneAngleMeasure",
              Uom: "rad"
            },
            ProjectedAxisOrder: "easting northing",
            ProjectedUom: "m",
            VerticalUom: "m",
            XOffset: 420000,
            ZIncreasingDownward: true,
            VerticalCrs: {
              EpsgCode: 6230,
              $type: "eml20.VerticalCrsEpsgCode"
            },
            ProjectedCrs: {
              EpsgCode: 23031,
              $type: "eml20.ProjectedCrsEpsgCode"
            },
            $type: "resqml20.obj_LocalDepth3dCrs",
            SchemaVersion: "2.0",
            Uuid: "7c7d7987-b7b9-4215-9014-cb7d6fb62173"
          },
          {
            Citation: {
              $type: "eml20.Citation",
              Title: "Hdf Proxy",
              Originator: "Mathieu",
              Creation: "2014-09-09T15:33:25Z",
              Format: "[F2I-CONSULTING:resqml2CppApi]"
            },
            MimeType: "application/x-hdf5",
            $type: "eml20.obj_EpcExternalPartReference",
            SchemaVersion: "2.0.0.20140822",
            Uuid: `68f2a7d4-f7c1-4a75-95e9-3c6a7029fb23`
          },
          {
            Citation: {
              Title: "Pointset 1",
              Originator: "user1",
              Creation: "2019-01-08T13:41:25.000Z",
              Format:
                "RESQML Modeling Application v1.0 for Linux_x64",
              $type: "eml20.Citation"
            },
            ExtraMetadata: [
              {
                Name: "app/resqml/creatorGroup",
                Value: "Interpreters",
                $type: "resqml20.NameValuePair"
              }
            ],
            NodePatch: [
              {
                PatchIndex: 0,
                Count: 6,
                Geometry: {
                  $type: "resqml20.PointGeometry",
                  LocalCrs: {
                    $type: "eml20.DataObjectReference",
                    ContentType:
                      "application/x-resqml+xml;version=2.0;type=obj_LocalDepth3dCrs",
                    Title: "CustomTestCrs",
                    UUID: "7c7d7987-b7b9-4215-9014-cb7d6fb62173"
                  },
                  Points: {
                    $type: "resqml20.Point3dHdf5Array",
                    Coordinates: {
                      $type: "eml20.Hdf5Dataset",
                      PathInHdfFile:
                        "/RESQML/5d27775e-5c7f-4786-a048-9a303fa1165a/points_patch0",
                      HdfProxy: {
                        $type: "eml20.DataObjectReference",
                        ContentType:
                          "application/x-resqml+xml;version=2.0;type=obj_EpcExternalPartReference",
                        UUID: "68f2a7d4-f7c1-4a75-95e9-3c6a7029fb23",
                        DescriptionString: "Hdf Proxy",
                        VersionString: "1410276805"
                      }
                    }
                  }
                }
              }
            ],
            $type: "resqml20.obj_PointSetRepresentation",
            SchemaVersion: "2.0.0.20140822",
            Uuid: "5d27775e-5c7f-4786-a048-9a303fa1165a"
          }
        ]
      }
    }
  })
  @ApiQuery(transactionIdQueryParam)
  @ApiQuery({
    name: "validate",
    required: false,
    description:
      "When 'true', runs RESQML validation (XSD, DOR integrity, business rules) on the objects before writing. " +
      "The write still proceeds but the response includes a `validation` report. " +
      "Set to 'strict' to reject the write on validation errors (returns 400).",
    schema: {
      type: "string",
      enum: ["false", "true", "strict"],
      default: "false"
    }
  })
  @ApiOkResponse({
    description: "Success",
    schema: {
      oneOf: [
        { type: "boolean" },
        {
          type: "object",
          properties: {
            success: { type: "boolean" },
            validation: {
              type: "object",
              properties: {
                is_valid: { type: "boolean" },
                version: { type: "string", nullable: true },
                object_count: { type: "integer" },
                validated_count: { type: "integer" },
                error_count: { type: "integer" },
                warning_count: { type: "integer" },
                errors: { type: "array", items: { type: "object" } }
              }
            }
          }
        }
      ]
    }
  })
  @ApiOperation({
    summary: "Create or update data objects",
    description: `Create new objects or replace existing ones by providing their content as a JSON array.

Each object must conform to the Energistics JSON schema for its type and include:
- \`$type\` - Energistics qualified type (e.g., \`resqml20.obj_IjkGridRepresentation\`)
- \`Uuid\` - unique identifier
- \`Citation\` - with at least \`Title\`, \`Originator\`, and \`Creation\`

**Transaction**: Pass \`transactionId\` to write within a transaction (recommended). Without it, operates in auto-commit mode.

**Custom metadata**: Include a \`_ResourceCustomData\` field (JSON key-value object) to attach extra metadata to the ETP resource.

**Batch size**: Objects are sent to the ETP server in batches. For very large payloads (>100 objects), consider splitting across multiple calls within the same transaction.`,
    servers: swaggerServers
  })
  public async PutDataObject(
    @Body() requestBody: EmlObjectDto[],
    @Param() params: FindInDataSpaceParams,
    @Query("transactionId") transactionId?: string,
    @Query("validate") validate?: string,
    @Req() request?: express.Request
  ): Promise<boolean | Record<string, unknown>> {
    logger.info(
      `Received request to put data objects in dataspace: ${params.dataspaceId}`
    );
    if (!Array.isArray(requestBody)) {
      throw new BadRequestException({
        description: "Invalid request body: expected an array of data objects"
      });
    }
    if (requestBody.some(b => !b.Uuid || typeof b.Uuid !== "string")) {
      throw new BadRequestException({
        description: "Each object must have a non-empty Uuid string"
      });
    }
    if (
      requestBody.some(
        b =>
          !b.Citation ||
          typeof b.Citation !== "object" ||
          Array.isArray(b.Citation)
      )
    ) {
      throw new BadRequestException({
        description: "Each object must have a Citation object"
      });
    }
    let c: ResqmlClient | undefined = undefined;
    try {
      // Snyk is reporting this as an XSS issue, but as we ensure token as the right format it can be ignored.
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      logger.info("Session created successfully.");

      const builder = new XMLBuilder();
      const dataObjects = requestBody.map(b => {
        if (!b.$type) {
          logger.error(
            `Validation Failed: Invalid Object: Missing $type field in ${b.Uuid}`
          );
          throw new BadRequestException({
            description: `Validation Failed: Invalid Object: Missing $type field in ${b.Uuid}`
          });
        }
        const m: RegExpMatchArray | null = b.$type.match(qualifiedTypeRegex);
        if (!m?.groups) {
          logger.error(
            `Validation Failed: Invalid Object: Invalid $type ${b.$type} in ${b.Uuid}`
          );
          throw new BadRequestException({
            description: `Validation Failed: Invalid Object: Invalid $type ${b.$type} in ${b.Uuid}`
          });
        }
        const uri = EtpUri.createObjectUri(
          params.dataspaceId,
          m?.groups?.domainFamily ?? "",
          m?.groups?.domainVersion ?? "",
          m?.groups?.dataType ?? "",
          b.Uuid
        ).uri;
        const customData = new Map<
          AvroString,
          Energistics.Etp.v12.Datatypes.DataValue
        >();

        if ("_ResourceCustomData" in b) {
          // Check if _ResourceCustomData of the right type exists

          const resourceCustomData = b._ResourceCustomData;
          if (
            typeof resourceCustomData === "object" &&
            resourceCustomData !== null &&
            !Array.isArray(resourceCustomData) &&
            Object.keys(resourceCustomData).every(
              key => typeof key === "string"
            )
          ) {
            const cData = resourceCustomData as Record<string, unknown>;
            for (const k of Object.keys(cData)) {
              customData.set(k, EtpDataValue.fromUnknown(cData[k]));
            }
            delete b._ResourceCustomData;
          }
        }

        const xml = builder.JSONtoEnergistics(
          JSON.stringify(b, bigIntToString)
        );
        return {
          resource: {
            uri,
            name: b.Citation.Title,
            alternateUris: [],
            sourceCount: null,
            targetCount: null,
            lastChanged: BigInt(0),
            storeCreated: BigInt(0),
            storeLastWrite: BigInt(0),
            activeStatus:
              Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind.Active,
            customData
          },
          data: Buffer.from(xml),
          format: "xml",
          blobId: null
        };
      });

      // ── Optional RESQML validation ──
      let validationReport: ValidationReport | undefined;
      const doValidate = validate === "true" || validate === "strict";

      if (doValidate) {
        logger.info("Running RESQML validation on objects...");
        const validator = new ValidatorClient();
        const xmlPayloads = dataObjects.map(d => {
          // Extract content_type from URI: eml:///dataspace('...')/resqml20.obj_Foo(uuid)
          const uriMatch = d.resource.uri.match(
            /\/(?<qt>(?:resqml|eml|witsml|prodml)\d+\.(?:obj_)?\w+)\(/
          );
          const qt = uriMatch?.groups?.qt ?? "unknown";
          const ctMatch = qt.match(
            /^(?<domain>resqml|eml|witsml|prodml)(?<ver>\d+)\.(?<type>\w+)$/
          );
          const domain = ctMatch?.groups?.domain ?? "resqml";
          const ver = ctMatch?.groups?.ver ?? "20";
          const type = ctMatch?.groups?.type ?? "Unknown";
          const version = ver === "20" ? "2.0" : ver === "22" ? "2.2" : ver;
          const contentType =
            `application/x-${domain}+xml;version=${version};type=${type}`;
          // Extract UUID from URI
          const uuidMatch = d.resource.uri.match(
            /\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/
          );
          return {
            content_type: contentType,
            uuid: uuidMatch?.[1] ?? "",
            xml: Buffer.from(d.data as Buffer).toString("utf-8")
          };
        });
        validationReport = await validator.validateObjects(xmlPayloads);
        logger.info(
          `Validation: ${validationReport.is_valid ? "VALID" : "INVALID"} ` +
          `(${validationReport.error_count} errors, ${validationReport.warning_count} warnings)`
        );

        if (validate === "strict" && !validationReport.is_valid) {
          if (!transactionId) await c.closeSession();
          throw new BadRequestException({
            statusCode: 400,
            message: `RESQML validation failed: ${validationReport.error_count} error(s)`,
            error: "Validation Failed",
            validation: validationReport
          });
        }
      }

      logger.info("Sending data objects...");
      const r = await c.putDataObjects(dataObjects as DataObject[]);
      logger.info("Data objects sent successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
      if (validationReport) {
        return { success: r, validation: validationReport };
      }
      return r;
    } catch (err) {
      logger.error(`Error occurred while putting data objects: ${err}`);
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Delete a data object
   *
   * @memberof MutationsAPI
   */
  @Delete(":dataObjectType/:guid")
  @ApiQuery(versionQueryParam)
  @ApiQuery(transactionIdQueryParam)
  @HttpCode(204)
  @ApiOperation({
    summary: "Delete a data object",
    description: `Delete a data object by type and UUID. Requires an active transaction (pass \`transactionId\`) or operates in auto-commit mode.\n\n**Note**: Deleting an object does not cascade-delete its arrays or referenced objects. Clean up related resources explicitly if needed.`,
    servers: swaggerServers
  })
  public async DeleteDataObject(
    @Param() params: FindInObjectParams,
    @Query("version") version?: string,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<void> {
    logger.info(
      `Received request to delete data object in dataspace: ${params.dataspaceId}, type: ${params.dataObjectType}, guid: ${params.guid}`
    );
    const m = qualifiedTypeRegex.exec(params.dataObjectType);
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
    let c: ResqmlClient | undefined = undefined;
    try {
      // Snyk is reporting this as an XSS issue, but as we ensure token as the right format it can be ignored.
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      logger.info("Session created successfully.");
      logger.info("Deleting data object...");
      await c.deleteObjects(uris);
      logger.info("Data object deleted successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c.closeSession();
        logger.info("Session closed successfully.");
      }
    } catch (err) {
      logger.error(`Error occurred while deleting data object: ${err}`);
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Convert from array of number or base64 string to javascript typed array
   *
   * For float arrays (Float32Array, Float64Array), JSON `null` values are converted
   * to IEEE 754 NaN, which is the standard representation for "missing value" in
   * floating-point data. This matches the behavior of FETPAPI and other ETP clients
   * that use native C++ quiet_NaN() for missing data points.
   *
   * @private
   * @memberof MutationsAPI
   */
  private toTypeArray(
    data: number[] | bigint | string,
    arrayType: string
  ): AnyTypedArray {
    if (typeof data === "string") {
      // Convert from base64 string to array
      const buf = Buffer.from(data, "base64");
      const int8 = new Int8Array(buf);
      if (arrayType === "Int8Array") {
        return int8;
      } else if (arrayType === "Uint8Array") {
        return new Uint8Array(int8.buffer);
      } else if (arrayType === "Uint8ClampedArray") {
        return new Uint8ClampedArray(int8.buffer);
      } else if (arrayType === "Uint16Array") {
        return new Uint16Array(int8.buffer);
      } else if (arrayType === "Int16Array") {
        return new Int16Array(int8.buffer);
      } else if (arrayType === "Uint32Array") {
        return new Uint32Array(int8.buffer);
      } else if (arrayType === "Int32Array") {
        return new Int32Array(int8.buffer);
      } else if (arrayType === "Float32Array") {
        return new Float32Array(int8.buffer);
      } else if (arrayType === "Float64Array") {
        return new Float64Array(int8.buffer);
      } else if (arrayType === "BigInt64Array") {
        return new BigInt64Array(int8.buffer);
      } else if (arrayType === "BigUint64Array") {
        return new BigUint64Array(int8.buffer);
      } else {
        return data;
      }
    } else if (Array.isArray(data)) {
      const len = data.length;
      const isFloatType =
        arrayType === "Float32Array" || arrayType === "Float64Array";
      const isBigIntType =
        arrayType === "BigInt64Array" || arrayType === "BigUint64Array";

      if (isFloatType) {
        const result =
          arrayType === "Float32Array"
            ? new Float32Array(len)
            : new Float64Array(len);
        for (let i = 0; i < len; i++) {
          const v = data[i];
          if (typeof v === "number") {
            result[i] = v;
          } else if (v === null) {
            result[i] = NaN;
          } else {
            throw new BadRequestException({
              description: `Invalid value at index ${i}: expected number or null for ${arrayType}, got ${typeof v === "object" ? JSON.stringify(v) : String(v)
                }`
            });
          }
        }
        return result;
      }

      // Handle bigint arrays
      if (isBigIntType) {
        const result =
          arrayType === "BigInt64Array"
            ? new BigInt64Array(len)
            : new BigUint64Array(len);
        for (let i = 0; i < len; i++) {
          const v = data[i];
          if (typeof v !== "bigint") {
            throw new BadRequestException({
              description: `Invalid value at index ${i}: expected bigint for ${arrayType}, got ${typeof v === "object" ? JSON.stringify(v) : String(v)
                }`
            });
          }
          result[i] = v;
        }
        return result;
      }

      // Handle integer arrays: only numbers allowed
      const intArrayConstructors: Record<
        string,
        | typeof Int8Array
        | typeof Uint8Array
        | typeof Uint8ClampedArray
        | typeof Int16Array
        | typeof Uint16Array
        | typeof Int32Array
        | typeof Uint32Array
      > = {
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array
      };

      const IntArrayClass = intArrayConstructors[arrayType];
      if (IntArrayClass) {
        const result = new IntArrayClass(len);
        for (let i = 0; i < len; i++) {
          const v = data[i];
          if (!Number.isInteger(v)) {
            throw new BadRequestException({
              description: `Invalid value at index ${i}: expected integer for ${arrayType}, got ${typeof v === "object" ? JSON.stringify(v) : String(v)
                }`
            });
          }
          result[i] = v;
        }
        return result;
      }
    }
    return data as unknown as string;
  }

  /**
   * Put a new data array or replace existing array or part of the array formatted as json
   *
   * @memberof MutationsAPI
   */
  @Put("arrays")
  @ApiQuery(transactionIdQueryParam)
  @ApiBody({
    description: "JSON array of array information",
    schema: {
      type: "array",
      maxItems: 10000,
      items: getSchemasForType(DataArrayDto)
    },
    examples: {
      externalPartReference: {
        value: [
          {
            ContainerType: "eml20.obj_EpcExternalPartReference",
            ContainerUuid: "68f2a7d4-f7c1-4a75-95e9-3c6a7029fb23",
            PathInResource:
              "/RESQML/5d27775e-5c7f-4786-a048-9a303fa1165a/points_patch0",
            Dimensions: [3, 3],
            PreferredSubarrayDimensions: [3, 1],
            Data: [0, 0, 0, 1, 1, 1, 2, 2, 2],
            ArrayType: "Float32Array"
          }
        ]
      }
    }
  })
  @ApiOkResponse({
    description: "Success",
    schema: {
      type: "boolean"
    }
  })
  @ApiBadRequestResponse(
    errorMessageSchema(
      `Validation Failed: Invalid Range: Starts + Counts exceed Dimensions`
    )
  )
  @ApiOperation({
    summary: "Create or update a data array",
    description: `Create or update a data array attached to an existing object (well log curves, grid properties, seismic traces, etc.).\n\n**Data formats**: Provide \`Data\` as a JSON number array or a base64-encoded string. For float arrays, JSON \`null\` values are converted to IEEE 754 NaN (standard missing-value representation).\n\n**Subarrays**: Include \`Starts\` and \`Counts\` to write a slice of an existing array. Both must be present together and match the \`Dimensions\` length.\n\n**Empty arrays**: Omit \`Data\` to create an empty array with the specified dimensions and type.\n\n**Chunking**: Large arrays (> ~10 MB) are automatically chunked by the ETP layer into multiple WebSocket messages.\n\n**Transaction**: Should be done within a transaction - pass \`transactionId\` from \`POST /dataspaces/{ds}/transactions\`.`,
    servers: swaggerServers
  })
  public async PutDataArray(
    @Body() requestBody: DataArrayDto[],
    @Param() params: FindInDataSpaceParams,
    @Query("transactionId") transactionId?: string,
    @Req() request?: express.Request
  ): Promise<boolean[]> | never {
    logger.info(
      `Received request to put data arrays in dataspace: ${params.dataspaceId}`
    );
    if (!Array.isArray(requestBody)) {
      throw new BadRequestException({
        description: "Invalid request body: expected an array of data arrays"
      });
    }
    if (
      requestBody.some(
        a =>
          !a.ContainerType ||
          typeof a.ContainerType !== "string" ||
          !a.PathInResource ||
          typeof a.PathInResource !== "string" ||
          !Array.isArray(a.Dimensions) ||
          a.Dimensions.length === 0 ||
          !a.Dimensions.every(d => Number.isInteger(d) && d >= 1) ||
          !a.ContainerUuid ||
          typeof a.ContainerUuid !== "string" ||
          !a.ArrayType ||
          typeof a.ArrayType !== "string"
      )
    ) {
      throw new BadRequestException({
        description:
          "Each array entry must have a ContainerType string, PathInResource string, non-empty Dimensions array, ContainerUuid string, and ArrayType string"
      });
    }
    let c: ResqmlClient | undefined = undefined;
    try {
      // Snyk is reporting this as an XSS issue, but as we ensure token as the right format it can be ignored.
      logger.info("Creating session...");
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId
      );
      if (!c) {
        throw new InternalServerErrorException({
          description: "Failed to create session"
        });
      }
      logger.info("Session created successfully.");
      const r = await Promise.all(
        requestBody.map(async a => {
          const m = qualifiedTypeRegex.exec(a.ContainerType);
          const uri = EtpUri.createObjectUri(
            params.dataspaceId,
            m?.groups?.domainFamily ?? "",
            m?.groups?.domainVersion ?? "",
            m?.groups?.dataType ?? "",
            a.ContainerUuid
          ).uri;
          const dataArray: IArrayId = {
            uri,
            pathInResource: a.PathInResource
          };

          if (!a.Data) {
            logger.info("Creating empty data array...");
            return c!.putEmptyDataArray(
              dataArray,
              this.toTypeArray("", a.ArrayType),
              a.Dimensions,
              a.PreferredSubarrayDimensions
            );
          }

          const dataArr = this.toTypeArray(a.Data, a.ArrayType);

          if (a.Starts || a.Counts) {
            logger.info("Creating subarray...");
            if (!a.Starts || !a.Counts) {
              logger.error("Validation Failed: Starts or Counts required.");
              throw new EtpError(
                `Validation Failed: Invalid Range: Starts or Counts required`,
                ErrorCode.EINVALID_ARGUMENT
              );
            }
            if (
              a.Starts.length !== a.Counts.length ||
              a.Starts.length !== a.Dimensions.length
            ) {
              logger.error(
                "Validation Failed: Starts and Counts must match Dimensions."
              );
              throw new EtpError(
                `Validation Failed: Invalid Range: Starts and Counts must have the same size than Dimensions`,
                ErrorCode.EINVALID_ARGUMENT
              );
            }
            let fullArray = true;
            for (let d = 0; d < a.Dimensions.length; d++) {
              if (a.Starts[d] !== 0 || a.Counts[d] !== a.Dimensions[d]) {
                fullArray = false;
                break;
              }
              if (a.Starts[d] + a.Counts[d] > a.Dimensions[d]) {
                logger.error(
                  "Validation Failed: Starts + Counts exceed Dimensions."
                );
                throw new EtpError(
                  `Validation Failed: Invalid Range: Starts + Counts exceed Dimensions`,
                  ErrorCode.EINVALID_ARGUMENT
                );
              }
            }
            if (
              a.Counts.reduce((prev, cur) => prev * cur, 1) !== dataArr.length
            ) {
              logger.error("Validation Failed: Data length must match Counts.");
              throw new EtpError(
                `Validation Failed: Invalid Range: Data length must be the product of Counts`,
                ErrorCode.EINVALID_ARGUMENT
              );
            }
            try {
              return fullArray
                ? c!.putDataArray(dataArray, a.Dimensions, dataArr)
                : c!.putDataSubArray(dataArray, a.Starts, a.Counts, dataArr);
            } catch (err) {
              logger.error(`Error occurred while creating subarray: ${err}`);
              throw err;
            }
          }
          if (
            a.Data &&
            typeof a.Data !== "string" &&
            a.Dimensions.reduce((prev, cur) => prev * cur, 1) !== a.Data.length
          ) {
            logger.error(
              "Validation Failed: Data length must match Dimensions."
            );
            throw new EtpError(
              `Validation Failed: Invalid Range: Data length must be the product of Dimensions`,
              ErrorCode.EINVALID_ARGUMENT
            );
          }
          logger.info("Creating full data array...");
          return c!.putDataArray(dataArray, a.Dimensions, dataArr);
        })
      );
      logger.info("Data arrays processed successfully.");
      if (!transactionId) {
        logger.info("Closing session...");
        await c?.closeSession();
        logger.info("Session closed successfully.");
      }
      return r;
    } catch (err) {
      logger.error(`Error occurred while putting data arrays: ${err}`);
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }
}
