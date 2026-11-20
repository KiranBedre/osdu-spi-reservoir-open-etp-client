// ============================================================================
// Copyright 2019-2026 Open ETP Client contributors. All rights reserved.
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

/**
 * Column-based table write façade.
 *
 * A thin, domain-shaped REST lane over the shared RESQML object-graph builders
 * (`src/lib/builders`). Accepts a column-based table spec, builds a spec-correct
 * EML 2.3 `ColumnBasedTable` (KrPc / PVT / facies tables) with the *same*
 * builder the SDK uses, and writes the object + per-column external arrays
 * through the existing ETP session write path. ColumnBasedTable is an EML 2.3
 * object, so this lane targets the 2.2.0 line.
 */

import {
    BadRequestException,
    Body,
    Controller,
    Param,
    Put,
    Query,
    Req,
    UseGuards
} from "@nestjs/common";

import {
    ApiBearerAuth,
    ApiBody,
    ApiForbiddenResponse,
    ApiHeader,
    ApiInternalServerErrorResponse,
    ApiNotFoundResponse,
    ApiOperation,
    ApiQuery,
    ApiTags
} from "@nestjs/swagger";

import express from "express";

import {
    DataObject as EtpDataObject,
    Energistics,
    EtpUri,
    IArrayId,
    ResqmlClient
} from "../../client/ResqmlClient";

import {
    FindInDataSpaceParams,
    HasBearerGuard,
    HasDataPartitionGuard,
    createSession,
    errorMessageSchema,
    extractDataPartitionId,
    extractToken,
    extractUserInfo,
    httpErrorFromEtpError,
    partitionPattern,
    patternString,
    swaggerServers,
    transactionIdQueryParam
} from "../ControllerUtils";
import { ensureHdfProxies } from "../HdfProxyUtils";

import { XMLBuilder } from "../../mlTypes/Json2Xml";
import { bigIntToString } from "../../mlTypes/XmlJsonUtil";
import { qualifiedTypeRegex } from "../../common/EtpQualifiedType";

import logging from "../../common/Logging";

import {
    BuiltObject,
    ColumnBasedTableSpec,
    buildColumnBasedTable
} from "../../builders";

const logger = logging.getLogger("EtpClient");

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

/** Summary of a table write (objects + bulk arrays committed). */
interface WriteSummary {
    objects: number;
    arrays: number;
}

/**
 * Column-based table builder exposed over REST.
 *
 * @export
 * @class TableWriteAPI
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
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("dataspaces/:dataspaceId/resources")
export default class TableWriteAPI {
    /**
     * Create/replace a column-based table (EML 2.3 ColumnBasedTable). Each
     * column binds a PropertyKind to an external value array; key columns hold
     * the independent variables. Returns the table UUID and the write summary.
     */
    @Put("tables/column-based")
    @ApiQuery(transactionIdQueryParam)
    @ApiBody({
        description:
            "Column-based table spec (KrPc / PVT / facies). ColumnBasedTable is an " +
            "EML 2.3 object — use RESQML 2.2.0. Each column references a " +
            "PropertyKind and stores its values in an external (HDF5) array.",
        schema: {
            type: "object",
            required: ["title", "hdfUuid", "columns"],
            properties: {
                title: { type: "string", description: "Citation title." },
                uuid: { type: "string", description: "ColumnBasedTable Uuid (generated when omitted)." },
                version: { type: "string", enum: ["2.2.0"], description: "RESQML version (default 2.2.0)." },
                hdfUuid: { type: "string", description: "EpcExternalPartReference the column arrays hang off. Written automatically when absent from the dataspace." },
                keyColumns: {
                    type: "array",
                    description: "Index / key columns (independent variables).",
                    items: {
                        type: "object",
                        required: ["propertyKind", "values"],
                        properties: {
                            propertyKind: { type: "string", description: "PropertyKind the column carries (kind name / DOR title)." },
                            propertyKindUuid: { type: "string", description: "UUID of the PropertyKind object the column references." },
                            propertyKindSrn: { type: "string", description: "OSDU SRN of the PropertyKind (deterministic UUID when no uuid)." },
                            title: { type: "string", description: "Column title (defaults to the property-kind name)." },
                            uom: { type: "string", description: "UOM override; defaults to the PropertyKind UOM." },
                            valueCountPerRow: { type: "integer", description: "Values per row (fastest array dimension when > 1). Default 1." },
                            values: { type: "array", items: { type: "number" }, description: "Column values, row-major." }
                        }
                    }
                },
                columns: {
                    type: "array",
                    description: "Data columns (dependent variables).",
                    items: {
                        type: "object",
                        required: ["propertyKind", "values"],
                        properties: {
                            propertyKind: { type: "string", description: "PropertyKind the column carries (kind name / DOR title)." },
                            propertyKindUuid: { type: "string", description: "UUID of the PropertyKind object the column references." },
                            propertyKindSrn: { type: "string", description: "OSDU SRN of the PropertyKind (deterministic UUID when no uuid)." },
                            title: { type: "string", description: "Column title (defaults to the property-kind name)." },
                            uom: { type: "string", description: "UOM override; defaults to the PropertyKind UOM." },
                            valueCountPerRow: { type: "integer", description: "Values per row (fastest array dimension when > 1). Default 1." },
                            values: { type: "array", items: { type: "number" }, description: "Column values, row-major." }
                        }
                    }
                },
                originator: { type: "string" }
            },
            example: {
                title: "Drogon KrPc — Volantis drainage",
                hdfUuid: "d3f1a5c8-9e42-4b70-8a16-5c2e7f0b9d31",
                version: "2.2.0",
                keyColumns: [
                    { propertyKind: "water saturation", uom: "euc", values: [0.15, 0.30, 0.45, 0.60, 0.75, 0.90] }
                ],
                columns: [
                    { propertyKind: "relative permeability to water", uom: "euc", values: [0.0, 0.02, 0.08, 0.20, 0.42, 0.80] },
                    { propertyKind: "relative permeability to oil", uom: "euc", values: [0.90, 0.55, 0.28, 0.10, 0.02, 0.0] },
                    { propertyKind: "capillary pressure", uom: "bar", values: [4.5, 1.8, 0.9, 0.4, 0.15, 0.05] }
                ],
                originator: "RDDMS Write API"
            }
        }
    })
    @ApiOperation({
        summary: "Put a column-based table",
        description:
            "Build and write an EML 2.3 ColumnBasedTable (relative-permeability / " +
            "capillary-pressure, PVT, facies). Each column binds a PropertyKind to an " +
            "external value array. Returns the table UUID and the write summary.",
        servers: swaggerServers
    })
    public async putColumnBasedTable(
        @Body() spec: ColumnBasedTableSpec,
        @Param() params: FindInDataSpaceParams,
        @Query("transactionId") transactionId?: string,
        @Req() request?: express.Request
    ): Promise<Record<string, unknown>> {
        const built = buildColumnBasedTable(spec);
        const written = await this.execute(
            request,
            params.dataspaceId,
            transactionId,
            [built]
        );
        return {
            uuid: built.object.Uuid,
            ...written
        };
    }

    /**
     * Open a session (joining `transactionId` when supplied, else auto-commit),
     * write the built parts, and close the session when auto-committing.
     */
    private async execute(
        request: express.Request | undefined,
        dataspaceId: string,
        transactionId: string | undefined,
        parts: BuiltObject[]
    ): Promise<WriteSummary> {
        let c: ResqmlClient | undefined = undefined;
        try {
            logger.info(
                `Table write: ${parts.length} object(s) into dataspace ${dataspaceId}` +
                (transactionId ? ` (tx ${transactionId})` : " (auto-commit)")
            );
            c = await createSession(
                extractToken(request),
                extractDataPartitionId(request),
                undefined,
                transactionId,
                extractUserInfo(request)
            );
            const written = await this.writeParts(c, dataspaceId, parts);
            if (!transactionId) {
                await c.closeSession();
            }
            return written;
        } catch (err) {
            logger.error(`Error during table write: ${err}`);
            if (!transactionId) {
                await c?.closeSession();
            }
            throw httpErrorFromEtpError(err);
        }
    }

    /** Write built RESQML objects (as XML) followed by their bulk arrays. */
    private async writeParts(
        c: ResqmlClient,
        dataspaceId: string,
        builtParts: BuiltObject[]
    ): Promise<WriteSummary> {
        const xmlBuilder = new XMLBuilder();
        // Prepend any EpcExternalPartReference the arrays point at that is in
        // neither the batch nor the store (else: `Missing array container(s)`).
        const parts = await ensureHdfProxies(c, dataspaceId, builtParts);

        const etpObjects = parts.map(p => {
            const obj = p.object;
            if (!obj.$type) {
                throw new BadRequestException({
                    description: `Built object is missing a $type (uuid ${obj.Uuid})`
                });
            }
            const m = obj.$type.match(qualifiedTypeRegex);
            if (!m?.groups) {
                throw new BadRequestException({
                    description: `Built object has an invalid $type '${obj.$type}'`
                });
            }
            const uri = EtpUri.createObjectUri(
                dataspaceId,
                m.groups.domainFamily ?? "",
                m.groups.domainVersion ?? "",
                m.groups.dataType ?? "",
                obj.Uuid
            ).uri;
            const xml = xmlBuilder.JSONtoEnergistics(JSON.stringify(obj, bigIntToString));
            return {
                resource: {
                    uri,
                    name: obj.Citation?.Title ?? "",
                    alternateUris: [],
                    sourceCount: null,
                    targetCount: null,
                    lastChanged: BigInt(0),
                    storeCreated: BigInt(0),
                    storeLastWrite: BigInt(0),
                    activeStatus:
                        Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind.Active,
                    customData: new Map()
                },
                data: Buffer.from(xml),
                format: "xml",
                blobId: null
            };
        });

        await c.putDataObjects(etpObjects as unknown as EtpDataObject[], { throwOnError: true });

        const arrays = parts.flatMap(p => p.arrays ?? []);
        const arrayInputs = arrays.flatMap(a => {
            if (a.Data === undefined) return [];
            const m = qualifiedTypeRegex.exec(a.ContainerType);
            const uri = EtpUri.createObjectUri(
                dataspaceId,
                m?.groups?.domainFamily ?? "",
                m?.groups?.domainVersion ?? "",
                m?.groups?.dataType ?? "",
                a.ContainerUuid
            ).uri;
            const dataArray: IArrayId = { uri, pathInResource: a.PathInResource };
            return [{ uid: dataArray, dimensions: a.Dimensions, data: this.toTypedArray(a.Data, a.ArrayType) }];
        });
        // Generic bounded-concurrency array write (ResqmlClient.putDataArrays).
        await c.putDataArrays(arrayInputs);

        return { objects: etpObjects.length, arrays: arrayInputs.length };
    }

    /**
     * Convert builder array data (a JSON number[]) to the typed array ETP
     * expects. The builders only emit Float64Array/Int32Array bulk data.
     */
    private toTypedArray(
        data: number[] | string,
        arrayType: string
    ): Float64Array | Int32Array {
        if (typeof data === "string") {
            throw new BadRequestException({
                description: "Base64 array data is not supported by the table lane"
            });
        }
        return arrayType === "Int32Array"
            ? Int32Array.from(data)
            : Float64Array.from(data);
    }
}
