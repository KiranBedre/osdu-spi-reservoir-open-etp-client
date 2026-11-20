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
 * Well marker-frame write façade.
 *
 * A thin, domain-shaped REST lane over the shared RESQML object-graph builders
 * (`src/lib/builders`). Accepts a wellbore marker-frame spec, builds the
 * spec-correct RESQML object graph (WellboreMarkerFrameRepresentation + per
 * marker Feature/Interpretation FIRP) with the *same* builders the SDK uses,
 * and writes them through the existing ETP session write path.
 *
 * Honours the stratigraphy/FIRP model: each marker can reuse an existing
 * boundary interpretation, link to OSDU masterdata by SRN, or have the
 * Feature + Interpretation auto-created — see `buildWellboreMarkerFrame`.
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
    WellboreMarkerFrameSpec,
    buildWellboreMarkerFrame
} from "../../builders";

const logger = logging.getLogger("EtpClient");

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

/** Summary of a well write (objects + bulk arrays committed). */
interface WriteSummary {
    objects: number;
    arrays: number;
}

/**
 * Wellbore marker-frame builder exposed over REST.
 *
 * @export
 * @class WellWriteAPI
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
@ApiTags("Well")
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("dataspaces/:dataspaceId/wells")
export default class WellWriteAPI {
    /**
     * Create/replace a wellbore marker frame: MD picks along a trajectory,
     * each carrying a WellboreMarker that references a boundary interpretation.
     * Honours the stratigraphy/FIRP model per marker (reuse / SRN masterdata /
     * auto-create). Returns the representation UUID and the referenced
     * interpretation UUIDs.
     */
    @Put("markers")
    @ApiQuery(transactionIdQueryParam)
    @ApiBody({
        description:
            "Wellbore marker-frame spec. Each marker's MD becomes a frame node; a " +
            "boundary interpretation is reused (interpretationUuid), linked to OSDU " +
            "masterdata (interpretationSrn/featureSrn), or auto-created from its title.",
        schema: {
            type: "object",
            required: ["title", "hdfUuid", "trajectoryUuid", "markers"],
            properties: {
                title: { type: "string", description: "Citation title." },
                uuid: { type: "string", description: "WellboreMarkerFrameRepresentation Uuid (generated when omitted)." },
                version: { type: "string", enum: ["2.0.1", "2.0.2", "2.2.0"], description: "RESQML version (default 2.0.1)." },
                hdfUuid: { type: "string", description: "HDF proxy the node-MD array hangs off. Written automatically when absent from the dataspace." },
                trajectoryUuid: { type: "string", description: "Wellbore trajectory the markers are picked along." },
                trajectoryType: { type: "string", description: "Trajectory object type (default obj_WellboreTrajectoryRepresentation)." },
                interpretationUuid: { type: "string", description: "WellboreInterpretation this frame represents (optional)." },
                interpretationType: { type: "string" },
                interpretationSrn: { type: "string", description: "OSDU SRN of the WellboreInterpretation (deterministic UUID when no uuid)." },
                markers: {
                    type: "array",
                    description: "Marker picks (ordered by MD).",
                    items: {
                        type: "object",
                        required: ["md", "title"],
                        properties: {
                            md: { type: "number", description: "Measured depth of the pick." },
                            title: { type: "string", description: "Marker name / citation title." },
                            boundaryKind: { type: "string", enum: ["horizon", "fault", "geobody"], description: "Geologic boundary the marker picks." },
                            domain: { type: "string", enum: ["depth", "time"], description: "Vertical domain of the auto-created interpretation (default depth)." },
                            uuid: { type: "string", description: "Marker element Uuid (generated when omitted)." },
                            interpretationUuid: { type: "string", description: "Existing boundary interpretation to attach to." },
                            featureUuid: { type: "string", description: "Existing feature (only with interpretationUuid)." },
                            interpretationSrn: { type: "string", description: "OSDU SRN of the boundary interpretation (deterministic UUID)." },
                            featureSrn: { type: "string", description: "OSDU SRN of the boundary feature (deterministic UUID)." },
                            interpretationTitle: { type: "string", description: "Title for the auto-created interpretation." },
                            featureTitle: { type: "string", description: "Title for the auto-created feature." },
                            sealState: { type: "string", enum: ["sealed", "leaking", "partially_sealed", "open", "unknown"], description: "Fault seal state (auto-created FaultInterpretation, 2.0.2)." },
                            transmissibilityMultiplier: { type: "number", description: "Fault transmissibility multiplier." },
                            sealMechanism: { type: "string", description: "Fault seal mechanism." }
                        }
                    }
                },
                originator: { type: "string" }
            },
            example: {
                title: "Drogon markers — 55/33-1",
                hdfUuid: "d3f1a5c8-9e42-4b70-8a16-5c2e7f0b9d31",
                version: "2.0.1",
                trajectoryUuid: "2c3d4e5f-6071-4b82-9ca3-b4d5e6f70819",
                interpretationUuid: "3d4e5f60-7182-4c93-8db4-c5e6f708192a",
                markers: [
                    { md: 1585.0, title: "Top Volantis", boundaryKind: "horizon", interpretationTitle: "Top Volantis" },
                    { md: 1622.5, title: "Top Therys", boundaryKind: "horizon", interpretationTitle: "Top Therys" },
                    { md: 1668.0, title: "Fault F1", boundaryKind: "fault", interpretationSrn: "osdu:work-product-component--FaultInterpretation:F1" }
                ],
                originator: "RDDMS Well API"
            }
        }
    })
    @ApiOperation({
        summary: "Put a wellbore marker frame",
        description:
            "Build and write a WellboreMarkerFrameRepresentation with per-marker " +
            "stratigraphy/FIRP linkage (reuse / OSDU-SRN masterdata / auto-create). " +
            "Returns the representation UUID and the referenced interpretation UUIDs.",
        servers: swaggerServers
    })
    public async putMarkers(
        @Body() spec: WellboreMarkerFrameSpec,
        @Param() params: FindInDataSpaceParams,
        @Query("transactionId") transactionId?: string,
        @Req() request?: express.Request
    ): Promise<Record<string, unknown>> {
        const built = buildWellboreMarkerFrame(spec);
        const written = await this.execute(
            request,
            params.dataspaceId,
            transactionId,
            built.parts
        );
        return {
            uuid: built.representationUuid,
            interpretationUuids: built.interpretationUuids,
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
                `Well write: ${parts.length} object(s) into dataspace ${dataspaceId}` +
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
            logger.error(`Error during well write: ${err}`);
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
                description: "Base64 array data is not supported by the well lane"
            });
        }
        return arrayType === "Int32Array"
            ? Int32Array.from(data)
            : Float64Array.from(data);
    }
}
