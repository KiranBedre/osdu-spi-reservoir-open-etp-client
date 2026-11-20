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
 * Well-log import from the OSDU Wellbore DDMS.
 *
 * `POST /dataspaces/{dataspaceId}/wells/logs/import` copies one
 * `work-product-component--WellLog` (record + bulk) into the dataspace as a
 * WITSML 2.1 `ChannelSet` with channel arrays, anchored on `Wellbore` / `Well`
 * objects that carry the OSDU master-data ids as `osdu` aliases. The record
 * mapping is pure (`src/lib/wellbore/wdms.ts`); this controller only fetches
 * (`OSDUContext.fetchOSDU`) and stores (`WitsmlController.putWitsmlObjects`)
 * inside one transaction.
 */

import {
    BadRequestException,
    Body,
    Controller,
    NotFoundException,
    Param,
    Post,
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
import { decode, JwtPayload } from "jsonwebtoken";

import {
    FindInDataSpaceParams,
    HasBearerGuard,
    HasDataPartitionGuard,
    commitTransaction,
    createTransaction,
    errorMessageSchema,
    extractDataPartitionId,
    extractToken,
    extractUserInfo,
    httpErrorFromEtpError,
    partitionPattern,
    patternString,
    rollbackTransaction,
    swaggerServers,
    transactionIdQueryParam
} from "../ControllerUtils";
import WitsmlController from "../witsml.module/Witsml.controller";
import { OSDUContext } from "../../jsonTypes/OsduContext";
import { wdmsPath } from "../../common/config";
import { buildChannelSet } from "../../builders/channelSet";
import { uuidV5 } from "../../builders/core";
import {
    OsduRecord,
    WdmsSplitData,
    WdmsWellData,
    WdmsWellLogData,
    WdmsWellboreData,
    wdmsWellLogToChannelSetSpec,
    wdmsWellToWitsml,
    wdmsWellboreToWitsml
} from "../../wellbore/wdms";
import logging from "../../common/Logging";

const logger = logging.getLogger("EtpClient");
const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

export interface WellLogImportDto {
    /** `osdu:work-product-component--WellLog:...` record id. */
    id: string;
    /** Record version (latest when omitted). */
    version?: number;
    /** Existing `witsml21.Wellbore` to attach to; otherwise derived from the WDMS `WellboreID`. */
    wellboreUuid?: string;
    /** Existing `witsml21.Well` (only read when the Wellbore is created here). */
    wellUuid?: string;
    /** Citation originator (defaults to the token's `unique_name`). */
    originator?: string;
}

/**
 * Wellbore DDMS well-log import exposed over REST.
 *
 * @export
 * @class WellLogImportAPI
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
@Controller("dataspaces/:dataspaceId/wells/logs")
export default class WellLogImportAPI {
    private readonly witsml = new WitsmlController();

    @Post("import")
    @ApiQuery(transactionIdQueryParam)
    @ApiBody({
        description:
            "Wellbore DDMS WellLog to copy. The record and its bulk are read from " +
            "`{RDMS_OSDU_URL}{RDMS_WDMS_PATH}` with the caller's bearer and partition.",
        schema: {
            type: "object",
            required: ["id"],
            properties: {
                id: { type: "string", description: "WellLog record id." },
                version: { type: "number", description: "Record version (latest when omitted)." },
                wellboreUuid: { type: "string", description: "Existing witsml21.Wellbore UUID to attach to; otherwise derived from the WDMS WellboreID (uuidV5 of the master-data id) and written with an osdu alias." },
                wellUuid: { type: "string", description: "Existing witsml21.Well UUID (used only when the Wellbore is created here)." },
                originator: { type: "string" }
            },
            example: {
                id: "osdu:work-product-component--WellLog:8b1c2d3e-4f50-4a61-b728-9c0d1e2f3a4b",
                wellboreUuid: "f8158c5d-1265-429b-89ce-ea60bee1274c"
            }
        }
    })
    @ApiOperation({
        summary: "Import a Wellbore DDMS well log",
        description:
            "Copy one OSDU Wellbore DDMS WellLog (record + bulk) into the dataspace as a WITSML 2.1 " +
            "ChannelSet with channel arrays. The ChannelSet carries the WellLog id as an osdu alias and " +
            "source provenance (id, version, legal tags, ACL) as ExtraMetadata; Wellbore/Well anchors carry " +
            "the master-data ids as osdu aliases, so the catalog identity stays the master-data record.",
        servers: swaggerServers
    })
    public async importWellLog(
        @Body() body: WellLogImportDto,
        @Param() params: FindInDataSpaceParams,
        @Query("transactionId") transactionId?: string,
        @Req() request?: express.Request
    ): Promise<Record<string, unknown>> {
        if (!body?.id || typeof body.id !== "string") {
            throw new BadRequestException({ description: "Body requires the WellLog record 'id'" });
        }
        const bearer = extractToken(request);
        const callerUserInfo = extractUserInfo(request);
        const partition = extractDataPartitionId(request);
        const jwt = bearer ? (decode(bearer) as JwtPayload | null) : null;
        const originator = body.originator ?? (jwt && typeof jwt === "object" ? jwt.unique_name : undefined);

        const osdu = new OSDUContext(partition ?? "osdu", originator ?? "etpclient");
        osdu.bearer = bearer;

        // 1. WellLog record + bulk
        const recordPath = `${wdmsPath}/welllogs/${encodeURIComponent(body.id)}`;
        const record = await osdu.fetchOSDU<OsduRecord<WdmsWellLogData>>(
            body.version !== undefined ? `${recordPath}/versions/${body.version}` : recordPath
        );
        if (!record?.data) {
            throw new NotFoundException({ description: `WellLog ${body.id} not found in the Wellbore DDMS` });
        }
        const bulk = await osdu.fetchOSDU<WdmsSplitData>(`${recordPath}/data?orient=split`, {
            headers: { Accept: "application/json" }
        });
        if (!bulk?.columns) {
            throw new BadRequestException({ description: `WellLog ${body.id} has no bulk data` });
        }

        // 2. Master-data anchors
        const wellboreId = record.data.WellboreID;
        let wellbore: OsduRecord<WdmsWellboreData> | undefined;
        let well: OsduRecord<WdmsWellData> | undefined;
        if (!body.wellboreUuid) {
            if (!wellboreId) {
                throw new BadRequestException({
                    description: `WellLog ${body.id} has no WellboreID; pass wellboreUuid to attach it to a stored Wellbore`
                });
            }
            wellbore = await osdu.fetchOSDU<OsduRecord<WdmsWellboreData>>(
                `${wdmsPath}/wellbores/${encodeURIComponent(wellboreId)}`
            );
            const wellId = wellbore?.data?.WellID;
            if (wellId && !body.wellUuid) {
                well = await osdu.fetchOSDU<OsduRecord<WdmsWellData>>(`${wdmsPath}/wells/${encodeURIComponent(wellId)}`);
            }
        }
        const wellId = wellbore?.data?.WellID;
        const wellUuid = body.wellUuid ?? (wellId ? uuidV5(wellId) : undefined);
        const wellboreUuid = body.wellboreUuid ?? uuidV5(wellboreId as string);
        if (!body.wellboreUuid && !wellUuid) {
            throw new BadRequestException({
                description: `Wellbore ${wellboreId} has no WellID; pass wellUuid (or wellboreUuid) to anchor the log`
            });
        }
        const wellTitle = well?.data?.FacilityName ?? wellId ?? "";
        const wellboreTitle = wellbore?.data?.FacilityName ?? wellboreId;

        // 3. ChannelSet
        let spec;
        try {
            spec = wdmsWellLogToChannelSetSpec(record, bulk, {
                originator,
                wellbore: { uuid: wellboreUuid, title: wellboreTitle }
            });
        } catch (err) {
            throw new BadRequestException({ description: String((err as Error).message ?? err) });
        }
        const built = buildChannelSet(spec);

        // 4. Store (one transaction)
        const anchors: Record<string, unknown>[] = [];
        if (!body.wellboreUuid) {
            if (!body.wellUuid && wellId) {
                anchors.push(wdmsWellToWitsml(wellId, well?.data, wellUuid, { originator }));
            }
            anchors.push(
                wdmsWellboreToWitsml(
                    wellboreId as string,
                    wellbore?.data,
                    { uuid: wellUuid as string, title: wellTitle },
                    wellboreUuid,
                    { originator }
                )
            );
        }

        const ownTransaction = !transactionId;
        const txId =
            transactionId ?? (await createTransaction(bearer, params.dataspaceId, undefined, partition, 300, 6, callerUserInfo).catch(err => {
                throw httpErrorFromEtpError(err);
            }));
        let objectsStored = 0;
        let arraysStored = 0;
        try {
            logger.info(
                `WDMS import: WellLog ${body.id} -> ChannelSet ${built.uuid} (${built.arrays.length} arrays) into ${params.dataspaceId}`
            );
            if (anchors.length > 0) {
                const r = await this.witsml.putWitsmlObjects(
                    { dataspace: params.dataspaceId, json: anchors },
                    request as express.Request,
                    txId
                );
                objectsStored += r.stored.length;
            }
            const r = await this.witsml.putWitsmlObjects(
                {
                    dataspace: params.dataspaceId,
                    xml: built.xml,
                    arrays: built.arrays.map(a => ({ mnemonic: a.mnemonic, dimensions: a.dimensions, data: a.data }))
                },
                request as express.Request,
                txId
            );
            objectsStored += r.stored.length;
            arraysStored = r.arraysStored;
            if (ownTransaction) {await commitTransaction(txId, bearer, partition, callerUserInfo);}
        } catch (err) {
            if (ownTransaction) {await rollbackTransaction(txId, bearer, partition, callerUserInfo).catch(() => undefined);}
            throw err;
        }

        // 5. Result
        return {
            channelSetUuid: built.uuid,
            wellboreUuid,
            wellUuid,
            mnemonics: spec.channels.map(c => c.mnemonic),
            resolution: built.resolution,
            source: { id: record.id, version: record.version, kind: record.kind, wellboreId, wellId },
            objectsStored,
            arraysStored
        };
    }
}
