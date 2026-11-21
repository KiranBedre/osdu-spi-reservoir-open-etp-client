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
 * Reservoir-grid interoperability lane (OPM/GRDECL ⇄ RESQML).
 *
 * A domain-shaped REST façade that bridges OPM/GRDECL corner-point decks
 * (GRDECL: `COORD` / `ZCORN` / `ACTNUM`) and RESQML `IjkGridRepresentation`
 * objects, using the *same* pure builders the SDK uses
 * (`src/lib/builders/grdecl`, `src/lib/builders/ijkgrid`) so REST and SDK emit
 * byte-identical graphs.
 *
 * - **PUT `grdecl`** — parse an ASCII GRDECL deck, synthesise split coordinate
 *   lines for faults (full pillar-grid fidelity, incl. split faults), create a
 *   fresh HDF proxy and write the grid + geometry arrays through the shared ETP
 *   session write path.
 * - **GET `{uuid}/grdecl`** — read a RESQML IJK grid's coordinate-line node
 *   array (+ split-line indexing when faulted), decode to a neutral
 *   corner-point grid and serialise it back to a GRDECL deck an OPM/xtgeo
 *   client can consume directly.
 *
 * The heavy geometry work (resqpy-style split-pillar detection, k-reduced node
 * packing, per-corner ZCORN reconstruction) lives in the pure builders and is
 * unit-tested for lossless round-trips; this controller is only the ETP
 * session + HTTP plumbing.
 */

import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    InternalServerErrorException,
    NotFoundException,
    Param,
    Post,
    Put,
    Query,
    Req,
    Res,
    UseGuards
} from "@nestjs/common";

import {
    ApiBearerAuth,
    ApiBody,
    ApiExtraModels,
    ApiForbiddenResponse,
    ApiHeader,
    ApiInternalServerErrorResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiProduces,
    ApiProperty,
    ApiPropertyOptional,
    ApiParam,
    ApiQuery,
    ApiResponse,
    getSchemaPath,
    ApiTags
} from "@nestjs/swagger";

import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, validate } from "class-validator";
import { ClassConstructor, plainToInstance } from "class-transformer";
import { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";

import express from "express";

import {
    DataObject as EtpDataObject,
    Energistics,
    EtpUri,
    IArrayId,
    ResqmlClient,
    byteToString
} from "../../client/ResqmlClient";

import {
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

import { XMLBuilder } from "../../mlTypes/Json2Xml";
import { bigIntToString } from "../../mlTypes/XmlJsonUtil";
import { qualifiedTypeRegex } from "../../common/EtpQualifiedType";

import logging from "../../common/Logging";

import {
    BuiltObject,
    CornerPointGrid,
    IjkDecodeInput,
    RESQML_VERSIONS,
    ResqmlVersion,
    isResqmlVersion,
    buildDiscreteProperty,
    buildContinuousProperty,
    buildHdfProxy,
    buildIjkGrid,
    buildStratigraphicColumn,
    buildRockFluidModel,
    etype,
    ijkGridToCornerPoint, parseGrdecl,
    rtype,
    schemaVersion,
    serializeEgrid,
    serializeGrdecl,
    serializeInit,
    type GridPropertyMapping,
    type IndexableElement,
    type Domain,
    type DepositionMode,
    type OrderingCriteria,
    type FluidPhase,
    type FluidContact,
    gridPropertyMappings,
    registerGridProperties,
    resqmlKindForKeyword,
    toKeyword
} from "../../builders";

const logger = logging.getLogger("EtpClient");

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

/** Parse a query-string flag (`true`/`1`/`yes`) into a boolean. */
function parseFlag(value: string | undefined): boolean {
    if (value === undefined) return false;
    const v = value.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes";
}

/**
 * Ensure an 8-char keyword is unique within an INIT file by appending a numeric
 * suffix (trimming the base so the total stays ≤ 8 chars) when it collides.
 */
function uniqueKeyword(base: string, used: Set<string>): string {
    if (!used.has(base)) {
        used.add(base);
        return base;
    }
    for (let n = 2; ; n++) {
        const suffix = String(n);
        const candidate = base.slice(0, 8 - suffix.length) + suffix;
        if (!used.has(candidate)) {
            used.add(candidate);
            return candidate;
        }
    }
}

/** Summary of a grid write (objects + bulk arrays committed). */
interface WriteSummary {
    objects: number;
    arrays: number;
}

/** Body of a GRDECL import request. */
export class GrdeclImportDto {
    @ApiProperty({
        description:
            "ASCII OPM/GRDECL deck. Recognised keywords: SPECGRID/DIMENS, " +
            "COORD, ZCORN, ACTNUM, and any cell-length numeric keyword (captured as a property).",
        example:
            "SPECGRID\n2 2 1 1 F /\nCOORD\n0 0 0 0 0 100 ... /\nZCORN\n... /\nACTNUM\n1 1 1 1 /\n"
    })
    @IsString()
    @IsNotEmpty()
    text!: string;

    @ApiProperty({ description: "Citation title for the RESQML grid", example: "Imported GRDECL grid" })
    @IsString()
    @IsNotEmpty()
    title!: string;

    @ApiProperty({ description: "UUID of the LocalDepth3dCrs the grid geometry is expressed in", format: "uuid" })
    @IsUUID()
    crsUuid!: string;

    @ApiPropertyOptional({ description: "RESQML version to emit (default 2.0.1)", example: "2.0.1" })
    @IsOptional()
    @IsIn(RESQML_VERSIONS)
    version?: ResqmlVersion;

    @ApiPropertyOptional({
        description:
            "Distance tolerance (CRS units) above which two column corners on a shared " +
            "pillar are treated as a split coordinate line (fault). Default 1e-3.",
        example: 0.001
    })
    @IsOptional()
    splitTolerance?: number;

    @ApiPropertyOptional({ description: "UUID of a grid interpretation this representation represents", format: "uuid" })
    @IsOptional()
    @IsUUID()
    interpretationUuid?: string;

    @ApiPropertyOptional({
        description:
            "OSDU masterdata SRN of the interpretation this grid represents. Resolved to a " +
            "deterministic UUID when `interpretationUuid` is omitted, linking the grid to an OSDU " +
            "FeatureInterpretation that exists only as an SRN.",
        example: "osdu:work-product-component--StratigraphicColumnRankInterpretation:Geogrid"
    })
    @IsOptional()
    @IsString()
    interpretationSrn?: string;

    @ApiPropertyOptional({ description: "Qualified type of the represented interpretation" })
    @IsOptional()
    @IsString()
    interpretationType?: string;
}


/** One stratigraphic zone (K-layer grouping) in a stratigraphic column. */
export class ZoneDto {
    @ApiProperty({ description: "Zone name", example: "Valysar" })
    @IsString()
    @IsNotEmpty()
    name!: string;

    @ApiPropertyOptional({
        description: "Deposition mode for the unit",
        enum: [
            "proportional between top and bottom",
            "parallel to bottom",
            "parallel to top",
            "parallel to another boundary"
        ]
    })
    @IsOptional()
    @IsString()
    depositionMode?: DepositionMode;
}

/**
 * Body for creating a stratigraphic zonation — a StratigraphicColumnRank
 * ordering N stratigraphic units (zones). Fully RESQML 2.0.1-native; the rank
 * UUID can drive a grid's `IntervalStratigraphicUnits` mapping.
 */
export class StratigraphicColumnDto {
    @ApiProperty({ description: "Citation title for the stratigraphic column / zonation", example: "Drogon zonation" })
    @IsString()
    @IsNotEmpty()
    title!: string;

    @ApiProperty({ description: "Zones, ordered top → bottom (index 0 is shallowest)", type: () => [ZoneDto] })
    @IsNotEmpty()
    zones!: ZoneDto[];

    @ApiPropertyOptional({
        description: "Ordering criteria for the column rank (default 'age')",
        enum: ["age", "apparent depth", "measured depth"]
    })
    @IsOptional()
    @IsString()
    orderingCriteria?: OrderingCriteria;

    @ApiPropertyOptional({ description: "Interpretation domain (default 'depth')", enum: ["depth", "time"] })
    @IsOptional()
    @IsString()
    domain?: Domain;

    @ApiPropertyOptional({ description: "Rank index within the stratigraphic column (default 0)", example: 0 })
    @IsOptional()
    rankIndex?: number;

    @ApiPropertyOptional({ description: "Also emit the top-level StratigraphicColumn hierarchy object (default true)" })
    @IsOptional()
    @IsBoolean()
    includeColumn?: boolean;

    @ApiPropertyOptional({ description: "RESQML version to emit (default 2.0.1)", example: "2.0.1" })
    @IsOptional()
    @IsIn(RESQML_VERSIONS)
    version?: ResqmlVersion;
}


/** One fluid unit (phase compartment) of a rock-fluid organisation. */
export class FluidUnitDto {
    @ApiProperty({ description: "Fluid unit name", example: "Oil column" })
    @IsString()
    @IsNotEmpty()
    name!: string;

    @ApiPropertyOptional({
        description: "Fluid phase carried by the unit",
        enum: ["aquifer", "gas cap", "oil column", "seal"],
        example: "oil column"
    })
    @IsOptional()
    @IsString()
    phase?: FluidPhase;
}

/** One fluid contact separating two units (GOC / WOC / free-water level …). */
export class FluidBoundaryDto {
    @ApiProperty({ description: "Fluid contact name", example: "OWC" })
    @IsString()
    @IsNotEmpty()
    name!: string;

    @ApiProperty({
        description: "Fluid contact kind",
        enum: ["free water contact", "gas oil contact", "gas water contact", "seal", "water oil contact"],
        example: "water oil contact"
    })
    @IsString()
    @IsNotEmpty()
    contact!: FluidContact;
}

/**
 * Body for a genuine multi-region rock-fluid organisation: a `Model`
 * organisation feature, a `RockVolumeFeature` + phase-tagged
 * `RockFluidUnitInterpretation` per unit, optional `BoundaryFeature` +
 * `FluidBoundaryInterpretation` per contact, and the
 * `RockFluidOrganizationInterpretation` that lists all units. Requires RESQML
 * 2.2+ (unbounded units).
 */
export class RockFluidModelDto {
    @ApiProperty({ description: "Citation title for the rock-fluid organisation", example: "Drogon fluids" })
    @IsString()
    @IsNotEmpty()
    title!: string;

    @ApiProperty({ description: "Fluid units, ordered top → bottom (index 0 shallowest)", type: () => [FluidUnitDto] })
    @IsNotEmpty()
    units!: FluidUnitDto[];

    @ApiPropertyOptional({ description: "Fluid contacts between units (GOC / WOC / FWL …)", type: () => [FluidBoundaryDto] })
    @IsOptional()
    boundaries?: FluidBoundaryDto[];

    @ApiPropertyOptional({ description: "Interpretation domain (default 'depth')", enum: ["depth", "time"] })
    @IsOptional()
    @IsString()
    domain?: Domain;

    @ApiPropertyOptional({ description: "RESQML version to emit (default 2.2.0; must be 2.2.0+)", example: "2.2.0" })
    @IsOptional()
    @IsIn(RESQML_VERSIONS)
    version?: ResqmlVersion;
}


/** One canonical grid-property mapping entry (request/response shape). */
export class GridPropertyMappingDto {
    @ApiProperty({ description: "Canonical GRDECL/EGRID/INIT keyword (≤ 8 chars)", example: "SWATINIT" })
    @IsString()
    @IsNotEmpty()
    keyword!: string;

    @ApiPropertyOptional({ description: "Alternate keyword spellings", type: [String], example: ["SWINIT"] })
    @IsOptional()
    aliases?: string[];

    @ApiProperty({ description: "RESQML property kind (concrete descendant)", example: "saturation" })
    @IsString()
    @IsNotEmpty()
    resqmlKind!: string;

    @ApiProperty({ description: "OSDU canonical property name (source of truth)", example: "InitialWaterSaturation" })
    @IsString()
    @IsNotEmpty()
    osdu!: string;

    @ApiPropertyOptional({ description: "PWLS mnemonic, when a standard one exists", example: "SW" })
    @IsOptional()
    @IsString()
    pwls?: string;

    @ApiProperty({ description: "Canonical (OSDU/RESQML) unit of measure", example: "m3/m3" })
    @IsString()
    @IsNotEmpty()
    uom!: string;

    @ApiPropertyOptional({ description: "Unit the GRDECL/INIT dialect expects, if different from uom", example: "bar" })
    @IsOptional()
    @IsString()
    keywordUom?: string;

    @ApiPropertyOptional({ description: "True for integer/region keywords (ACTNUM, SATNUM, …)" })
    @IsOptional()
    discrete?: boolean;

    @ApiPropertyOptional({
        description: "Descriptive-Title tokens (all must appear) used to recover this keyword on export",
        type: [String],
        example: ["init", "water", "satur"]
    })
    @IsOptional()
    titleTokens?: string[];
}

/** Request body for extending the grid-property mapping registry. */
export class RegisterGridPropertyMappingsDto {
    @ApiProperty({
        description: "Mappings to register (later entries override earlier ones for the same keyword).",
        type: [GridPropertyMappingDto]
    })
    @IsNotEmpty()
    mappings!: GridPropertyMappingDto[];
}

/**
 * Reservoir corner-point grid interoperability exposed over REST.
 *
 * @export
 * @class GridAPI
 */
/** `kind` values of `PUT /dataspaces/{id}/reservoir/{kind}` (dataspace-level reservoir framework objects). */
export const RESERVOIR_KINDS = ["zones", "fluid-model"] as const;
export type ReservoirKind = (typeof RESERVOIR_KINDS)[number];


// Per-kind operation docs and response schemas, surfaced as titled oneOf
// variants on the two merged routes.
const zonesOp = {
    summary: "Create a stratigraphic zonation (zones)",
    description:
        "Writes a StratigraphicColumnRankInterpretation ordering N stratigraphic units (zones), " +
        "each with its own StratigraphicUnitFeature + StratigraphicUnitInterpretation, plus an " +
        "OrganizationFeature and (optionally) a top-level StratigraphicColumn. Fully RESQML " +
        "2.0.1-native; the returned rank UUID can drive a grid's IntervalStratigraphicUnits."
};
const zonesResponse = {
    type: "object",
    properties: {
        rankUuid: { type: "string" },
        featureUuid: { type: "string" },
        columnUuid: { type: "string" },
        unitInterpretationUuids: { type: "array", items: { type: "string" } },
        objects: { type: "number" },
        arrays: { type: "number" }
    }
};
const fluidModelOp = {
    summary: "Create a multi-region rock-fluid organisation (fluid-in-place model)",
    description:
        "Writes a genuine multi-region rock-fluid organisation: a `Model` organisation feature, a " +
        "`RockVolumeFeature` + phase-tagged `RockFluidUnitInterpretation` per fluid unit, an optional " +
        "`BoundaryFeature` + `FluidBoundaryInterpretation` per fluid contact (GOC / WOC / FWL …), and the " +
        "`RockFluidOrganizationInterpretation` that lists every unit. Requires RESQML 2.2+ (unbounded " +
        "units); RESQML 2.0.1 caps the organisation at a single unit. The returned `orgUuid` can drive a " +
        "grid's `CellFluidPhaseUnits` (SDK `buildCellFluidPhaseUnits` or a generic `PUT /resources`)."
};
const fluidModelResponse = {
    type: "object",
    properties: {
        orgUuid: { type: "string" },
        orgFeatureUuid: { type: "string" },
        unitInterpretationUuids: { type: "array", items: { type: "string" } },
        boundaryInterpretationUuids: { type: "array", items: { type: "string" } },
        objects: { type: "number" },
        arrays: { type: "number" }
    }
};

const kindDescription = (entries: [string, { summary?: string; description?: string }][]): string =>
    entries.map(([k, op]) => `**${k}**: ${op.summary ?? ""}. ${op.description ?? ""}`).join("\n\n");

/** Per-kind request DTO (validated with the same rules as the global pipe: whitelist + forbid unknown). */
const RESERVOIR_DTOS: Record<ReservoirKind, ClassConstructor<object>> = {
    zones: StratigraphicColumnDto,
    "fluid-model": RockFluidModelDto
};

async function validateKindBody<T extends object>(dto: ClassConstructor<T>, body: unknown): Promise<T> {
    const instance = plainToInstance(dto, body ?? {});
    const errors = await validate(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
        skipUndefinedProperties: true
    });
    if (errors.length > 0) {
        const messages = errors.flatMap(e => Object.values(e.constraints ?? {}));
        throw new BadRequestException({ description: messages.join("; ") || "Invalid body" });
    }
    return instance;
}

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
@ApiTags("Reservoir")
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("dataspaces")
export default class GridAPI {
    // ──────────────────────────────────────────────────────────────────────
    // Import: GRDECL deck → RESQML IjkGridRepresentation
    // ──────────────────────────────────────────────────────────────────────

    @Put(":dataspaceId/grids")
    @ApiQuery(transactionIdQueryParam)
    @ApiQuery({
        name: "format",
        required: false,
        description:
            "Input deck format (default `grdecl`). Only `grdecl` is currently supported; the " +
            "flag reserves this single path for future binary (egrid/init) import without a new route."
    })
    @ApiOperation({
        summary: "Import a reservoir grid from an OPM/GRDECL deck",
        description:
            "Parse an ASCII corner-point deck (COORD/ZCORN/ACTNUM), synthesise split " +
            "coordinate lines for faults (full split-fault pillar-grid fidelity), create a " +
            "fresh HDF proxy and write the IjkGridRepresentation + geometry arrays.",
        servers: swaggerServers
    })
    public async importGrdecl(
        @Body() body: GrdeclImportDto,
        @Param("dataspaceId") dataspaceId: string,
        @Query("transactionId") transactionId?: string,
        @Query("format") formatQ?: string,
        @Req() request?: express.Request
    ): Promise<Record<string, unknown>> {
        const format = (formatQ ?? "grdecl").trim().toLowerCase();
        if (format !== "grdecl") {
            throw new BadRequestException({
                description: `Unsupported import format '${format}'. Only grdecl is supported.`
            });
        }
        let grid;
        const tParse = Date.now();
        try {
            grid = parseGrdecl(body.text);
        } catch (err) {
            throw new BadRequestException({
                description: `Invalid GRDECL deck: ${(err as Error).message}`
            });
        }

        const tBuild = Date.now();
        const proxy = buildHdfProxy({ version: body.version });
        const built = buildIjkGrid({
            title: body.title,
            hdfUuid: proxy.uuid,
            crsUuid: body.crsUuid,
            version: body.version,
            splitTolerance: body.splitTolerance,
            interpretationUuid: body.interpretationUuid,
            interpretationSrn: body.interpretationSrn,
            interpretationType: body.interpretationType,
            grid
        });

        const tWrite = Date.now();
        const parts: BuiltObject[] = [{ object: proxy.object, arrays: [] }, built];
        const propertyParts = this.buildGridPropertyParts(
            grid,
            built.object.Uuid as string,
            proxy.uuid,
            body.version
        );
        parts.push(...propertyParts);
        const written = await this.execute(request, dataspaceId, transactionId, parts);
        const tEnd = Date.now();
        logger.info(
            `[grid-bench] import ${grid.ni}x${grid.nj}x${grid.nk} ` +
            `parse=${tBuild - tParse}ms build=${tWrite - tBuild}ms write=${tEnd - tWrite}ms ` +
            `bytes=${body.text.length} split=${built.arrays.length} properties=${propertyParts.length}`
        );

        return {
            uuid: built.object.Uuid,
            proxyUuid: proxy.uuid,
            ni: grid.ni,
            nj: grid.nj,
            nk: grid.nk,
            properties: propertyParts.length,
            ...written
        };
    }

    // ──────────────────────────────────────────────────────────────────────
    // Export: RESQML IjkGridRepresentation → OPM/GRDECL deck (grdecl|egrid|init)
    //
    // One route, one `format` flag — the three formats share the same geometry
    // decode and differ only in the final serialiser, so a per-format path
    // would just be three copies of the same session/decode plumbing.
    // ──────────────────────────────────────────────────────────────────────

    @Get(":dataspaceId/grids/:uuid/export")
    @ApiProduces("text/plain", "application/octet-stream")
    @ApiQuery({
        name: "format",
        required: false,
        description:
            "Output format: `grdecl` (ASCII deck, default), `egrid` (binary geometry) or " +
            "`init` (binary static properties). Replaces the former `/grdecl`, `/egrid` and " +
            "`/init` sub-paths."
    })
    @ApiQuery({
        name: "version",
        required: false,
        description: "RESQML version of the source grid (default 2.0.1)"
    })
    @ApiQuery({
        name: "actnum",
        required: false,
        description:
            "`grdecl` only: include the ACTNUM keyword (reads the grid's active-cell property). " +
            "Default false. (`egrid`/`init` always carry ACTNUM.)"
    })
    @ApiQuery({
        name: "properties",
        required: false,
        description:
            "`grdecl`: set truthy to include every cell property keyword (PORO/PERMX…). " +
            "`init`: comma-separated keyword names to include (case-insensitive; omit for every " +
            "ContinuousProperty). Ignored for `egrid`."
    })
    @ApiQuery({
        name: "geometry",
        required: false,
        description:
            "`grdecl` only: emit SPECGRID/COORD/ZCORN geometry. Default true; set false with " +
            "actnum/properties to export a properties-only deck."
    })
    @ApiOperation({
        summary: "Export a RESQML IJK grid as an OPM/GRDECL deck (grdecl | egrid | init)",
        description:
            "Read the coordinate-line node array (+ split-line indexing when faulted), decode to " +
            "a neutral corner-point grid and serialise it in the requested `format`:\n" +
            "• **grdecl** — ASCII SPECGRID/COORD/ZCORN/ACTNUM deck (`text/plain`); ACTNUM and cell " +
            "properties on demand via the flags. Consumed by OPM / `xtgeo.grid_from_file`.\n" +
            "• **egrid** — binary EGRID geometry + ACTNUM (big-endian, Fortran-unformatted); ~3–4× " +
            "smaller than grdecl with no text parse. Read by resdata, OPM, " +
            "`xtgeo.grid_from_file(fileformat='egrid')`.\n" +
            "• **init** — binary INIT static properties (companion to egrid); each ContinuousProperty " +
            "becomes an active-cell keyword (`PORV` global). Read by resdata (`EclInitFile`) / " +
            "`xtgeo.gridproperty_from_file(fileformat='init')`.",
        servers: swaggerServers
    })
    @ApiOkResponse({
        description: "GRDECL text (`grdecl`) or a binary EGRID/INIT file (`egrid`/`init`)",
        schema: { type: "string" }
    })
    @ApiNotFoundResponse({ description: "Grid not found" })
    @ApiInternalServerErrorResponse({ description: "Grid geometry could not be decoded" })
    public async exportGrid(
        @Param("dataspaceId") dataspaceId: string,
        @Param("uuid") uuid: string,
        @Res() res: express.Response,
        @Query("format") formatQ?: string,
        @Query("version") version?: ResqmlVersion,
        @Query("actnum") actnumQ?: string,
        @Query("properties") propertiesQ?: string,
        @Query("geometry") geometryQ?: string,
        @Req() request?: express.Request
    ): Promise<void> {
        const format = (formatQ ?? "grdecl").trim().toLowerCase();
        if (format !== "grdecl" && format !== "egrid" && format !== "init") {
            throw new BadRequestException({
                description: `Unsupported export format '${format}'. Use grdecl, egrid or init.`
            });
        }
        if (version !== undefined && !isResqmlVersion(version)) {
            throw new BadRequestException({
                description: `version must be one of ${RESQML_VERSIONS.join(", ")} (got "${version}")`
            });
        }

        const type = rtype("obj_IjkGridRepresentation", version);
        const m = qualifiedTypeRegex.exec(type);
        if (!m?.groups) {
            throw new InternalServerErrorException({
                description: `Cannot resolve qualified type for '${type}'`
            });
        }
        const uri = EtpUri.createObjectUri(
            dataspaceId,
            m.groups.domainFamily ?? "",
            m.groups.domainVersion ?? "",
            m.groups.dataType ?? "",
            uuid
        ).uri;

        let c: ResqmlClient | undefined = undefined;
        try {
            c = await createSession(
                extractToken(request),
                extractDataPartitionId(request),
                undefined,
                undefined
            );

            const tObj = Date.now();
            const { grid, ni, nj, nk, parametric } = await this.decodeGridGeometry(
                c,
                uri,
                uuid,
                dataspaceId
            );
            const ncell = ni * nj * nk;

            if (format === "grdecl") {
                const wantActnum = parseFlag(actnumQ);
                const wantProperties = parseFlag(propertiesQ);
                const wantGeometry = geometryQ === undefined ? true : parseFlag(geometryQ);
                if (wantActnum || wantProperties) {
                    const loaded = await this.loadGridProperties(
                        c,
                        uri,
                        ncell,
                        version,
                        wantProperties ? "all" : "actnum"
                    );
                    if (wantActnum && loaded.actnum) grid.actnum = loaded.actnum;
                    if (wantProperties && loaded.properties) grid.properties = loaded.properties;
                }
                const tSer = Date.now();
                const text = serializeGrdecl(grid, {
                    geometry: wantGeometry,
                    actnum: wantActnum,
                    properties: wantProperties
                });
                const tEnd = Date.now();
                logger.info(
                    `[grid-bench] export grdecl ${ni}x${nj}x${nk} ${parametric ? "parametric" : "explicit"} ` +
                    `decode=${tSer - tObj}ms serialize=${tEnd - tSer}ms total=${tEnd - tObj}ms bytes=${text.length}`
                );
                res.setHeader("content-type", "text/plain; charset=utf-8");
                res.send(text);
                return;
            }

            if (format === "egrid") {
                const loaded = await this.loadGridProperties(c, uri, ncell, version, "actnum");
                if (loaded.actnum) grid.actnum = loaded.actnum;
                const tSer = Date.now();
                const bytes = serializeEgrid(grid);
                const tEnd = Date.now();
                logger.info(
                    `[grid-bench] export egrid ${ni}x${nj}x${nk} ${parametric ? "parametric" : "explicit"} ` +
                    `decode=${tSer - tObj}ms serialize=${tEnd - tSer}ms total=${tEnd - tObj}ms bytes=${bytes.length}`
                );
                res.setHeader("content-type", "application/octet-stream");
                res.setHeader("content-disposition", `attachment; filename="${uuid}.EGRID"`);
                res.send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
                return;
            }

            // format === "init"
            const loaded = await this.loadGridProperties(c, uri, ncell, version, "all");
            if (loaded.actnum) grid.actnum = loaded.actnum;

            // Optional keyword filter (case-insensitive). Each requested token
            // is resolved through the canonical registry so callers may filter
            // by keyword, alias, or OSDU canonical name interchangeably.
            const wanted = propertiesQ
                ? new Set(
                    propertiesQ
                        .split(",")
                        .map(s => toKeyword(s))
                        .filter(Boolean)
                )
                : undefined;

            // Map each RESQML property Title to a canonical GRDECL/INIT mnemonic via
            // the registry (so "Water saturation" → SWAT, not WATERSA), keeping
            // insertion order and de-duplicating collisions with a numeric suffix.
            const used = new Set<string>();
            const initProps = Object.entries(loaded.properties ?? {})
                .map(([title, values]) => ({ name: uniqueKeyword(toKeyword(title), used), values }))
                .filter(p => !wanted || wanted.has(p.name));

            const tSer = Date.now();
            const bytes = serializeInit(grid, initProps, { actnum: grid.actnum });
            const tEnd = Date.now();
            logger.info(
                `[grid-bench] export init ${ni}x${nj}x${nk} props=${initProps.length} ` +
                `decode=${tSer - tObj}ms serialize=${tEnd - tSer}ms total=${tEnd - tObj}ms bytes=${bytes.length}`
            );
            res.setHeader("content-type", "application/octet-stream");
            res.setHeader("content-disposition", `attachment; filename="${uuid}.INIT"`);
            res.send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
        } catch (err) {
            if (err instanceof NotFoundException || err instanceof InternalServerErrorException) {
                throw err;
            }
            logger.error(`Error during grid export (${format}): ${err}`);
            throw httpErrorFromEtpError(err);
        } finally {
            await c?.closeSession();
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Canonical property mapping registry (OSDU ⇄ RESQML ⇄ GRDECL/INIT)
    // ──────────────────────────────────────────────────────────────────────

    @Get("grid-property-mappings")
    @ApiOperation({
        summary: "List the canonical grid-property mappings",
        description:
            "Returns the bidirectional registry that bridges GRDECL/EGRID/INIT keywords, " +
            "RESQML property kinds, and OSDU canonical names (with units). This drives both " +
            "GRDECL/INIT import (keyword → RESQML kind+UOM) and export (RESQML Title → keyword). " +
            "Extend or override it at runtime with `POST grid-property-mappings`.",
        servers: swaggerServers
    })
    @ApiOkResponse({
        description: "Registered mappings",
        schema: {
            type: "object",
            properties: {
                count: { type: "number" },
                mappings: { type: "array", items: { type: "object" } }
            }
        }
    })
    public listGridPropertyMappings(): { count: number; mappings: readonly GridPropertyMapping[] } {
        const mappings = gridPropertyMappings();
        return { count: mappings.length, mappings };
    }

    @Post("grid-property-mappings")
    @HttpCode(200)
    @ApiOperation({
        summary: "Register (or override) canonical grid-property mappings",
        description:
            "Extend the mapping registry with additional geo-properties (extra saturations, " +
            "region arrays, multipliers, site-specific keywords, …) or override a shipped " +
            "default. A later registration for the same keyword wins. Registrations " +
            "are process-local (reset on restart); persist site defaults in configuration.",
        servers: swaggerServers
    })
    @ApiBody({ type: RegisterGridPropertyMappingsDto })
    @ApiOkResponse({
        description: "Registry after applying the new mappings",
        schema: {
            type: "object",
            properties: {
                added: { type: "number" },
                count: { type: "number" }
            }
        }
    })
    public registerGridPropertyMappings(
        @Body() body: RegisterGridPropertyMappingsDto
    ): { added: number; count: number } {
        const incoming = body?.mappings ?? [];
        if (!Array.isArray(incoming) || incoming.length === 0) {
            throw new BadRequestException({ description: "Body must contain a non-empty 'mappings' array" });
        }
        for (const m of incoming) {
            if (!m.keyword || !m.resqmlKind || !m.osdu || !m.uom) {
                throw new BadRequestException({
                    description: "Each mapping requires 'keyword', 'resqmlKind', 'osdu' and 'uom'"
                });
            }
        }
        registerGridProperties(incoming as GridPropertyMapping[]);
        return { added: incoming.length, count: gridPropertyMappings().length };
    }

    // ──────────────────────────────────────────────────────────────────────
    // Reservoir framework objects: one route per level, `kind` selects the object
    // ──────────────────────────────────────────────────────────────────────

    @Put(":dataspaceId/reservoir/:kind")
    @ApiParam({ name: "dataspaceId", description: "Dataspace id (URL-encoded, e.g. demo%2FVolve)" })
    @ApiParam({
        name: "kind",
        enum: RESERVOIR_KINDS,
        description:
            "`zones` (StratigraphicColumnRankInterpretation + units), " +
            "`fluid-model` (RockFluidOrganizationInterpretation + units)."
    })
    @ApiQuery(transactionIdQueryParam)
    @ApiExtraModels(StratigraphicColumnDto, RockFluidModelDto)
    @ApiBody({
        description: "Spec for the selected `kind` (titled variants below).",
        schema: {
            oneOf: [
                { title: "zones", $ref: getSchemaPath(StratigraphicColumnDto) },
                { title: "fluid-model", $ref: getSchemaPath(RockFluidModelDto) }
            ]
        }
    })
    @ApiOperation({
        summary: "Put a reservoir framework interpretation (zones | fluid-model)",
        description:
            "Dataspace-level organisation interpretations that are tedious to assemble by hand " +
            "(a feature + one interpretation per unit/boundary + the organisation that lists them). " +
            "Written through the ETP write path; auto-opens a transaction unless `transactionId` is supplied. " +
            "Representations that reference grids (GridConnectionSet, BlockedWellbore, IntervalStratigraphicUnits, " +
            "CellFluidPhaseUnits, region properties) are written with the generic `PUT /resources` + `PUT /resources/arrays` " +
            "routes or the SDK builders.\n\n" +
            kindDescription([
                ["zones", zonesOp],
                ["fluid-model", fluidModelOp]
            ]),
        servers: swaggerServers
    })
    @ApiOkResponse({
        description: "Object written; shape depends on `kind`.",
        schema: {
            oneOf: [
                { title: "zones", ...zonesResponse },
                { title: "fluid-model", ...fluidModelResponse }
            ]
        } as SchemaObject
    })
    public async putReservoirObject(
        @Body() body: Record<string, unknown>,
        @Param("dataspaceId") dataspaceId: string,
        @Param("kind") kind: string,
        @Query("transactionId") transactionId?: string,
        @Req() request?: express.Request
    ): Promise<Record<string, unknown>> {
        switch (kind as ReservoirKind) {
            case "zones":
                return this.putZones(
                    await validateKindBody(StratigraphicColumnDto, body), dataspaceId, transactionId, request);
            case "fluid-model":
                return this.putFluidModel(
                    await validateKindBody(RockFluidModelDto, body), dataspaceId, transactionId, request);
            default:
                throw new BadRequestException({
                    description: `kind must be one of ${RESERVOIR_KINDS.join(", ")}`
                });
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Reservoir model — zones (stratigraphy) & fluid model (rock-fluid organisation)
    // ──────────────────────────────────────────────────────────────────────

    private async putZones(
        body: StratigraphicColumnDto,
        dataspaceId: string,
        transactionId?: string,
        request?: express.Request
    ): Promise<Record<string, unknown>> {
        let result: ReturnType<typeof buildStratigraphicColumn>;
        try {
            result = buildStratigraphicColumn({
                title: body.title,
                version: body.version,
                domain: body.domain,
                zones: (body.zones ?? []).map(z => ({ name: z.name, depositionMode: z.depositionMode })),
                orderingCriteria: body.orderingCriteria,
                rankIndex: body.rankIndex,
                includeColumn: body.includeColumn
            });
        } catch (err) {
            throw new BadRequestException({ description: (err as Error).message });
        }

        const parts: BuiltObject[] = result.objects.map(object => ({ object, arrays: [] }));
        const written = await this.execute(request, dataspaceId, transactionId, parts);
        return {
            rankUuid: result.rankUuid,
            featureUuid: result.featureUuid,
            ...(result.columnUuid ? { columnUuid: result.columnUuid } : {}),
            unitInterpretationUuids: result.unitInterpretationUuids,
            ...written
        };
    }


    private async putFluidModel(
        body: RockFluidModelDto,
        dataspaceId: string,
        transactionId?: string,
        request?: express.Request
    ): Promise<Record<string, unknown>> {
        let result: ReturnType<typeof buildRockFluidModel>;
        try {
            result = buildRockFluidModel({
                title: body.title,
                version: body.version,
                domain: body.domain,
                units: (body.units ?? []).map(u => ({ name: u.name, phase: u.phase })),
                boundaries: (body.boundaries ?? []).map(b => ({ name: b.name, contact: b.contact }))
            });
        } catch (err) {
            throw new BadRequestException({ description: (err as Error).message });
        }

        const parts: BuiltObject[] = result.objects.map(object => ({ object, arrays: [] }));
        const written = await this.execute(request, dataspaceId, transactionId, parts);
        return {
            orgUuid: result.orgUuid,
            orgFeatureUuid: result.orgFeatureUuid,
            unitInterpretationUuids: result.unitInterpretationUuids,
            boundaryInterpretationUuids: result.boundaryInterpretationUuids,
            ...written
        };
    }


    // ──────────────────────────────────────────────────────────────────────
    // Shared paths
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Load an IJK grid object and reduce its geometry (explicit or parametric)
     * to the neutral corner-point model shared by the `grdecl` and `egrid`
     * exporters.
     */
    private async decodeGridGeometry(
        c: ResqmlClient,
        uri: string,
        uuid: string,
        dataspaceId: string
    ): Promise<{
        grid: CornerPointGrid;
        ni: number;
        nj: number;
        nk: number;
        parametric: boolean;
    }> {
        const objects = await c.getDataObjects([uri]);
        const obj = objects?.[0];
        if (!obj || !obj.data || obj.data.length === 0) {
            throw new NotFoundException({
                description: `IjkGridRepresentation ${uuid} not found in dataspace ${dataspaceId}`
            });
        }
        const xml = byteToString(obj.data);
        const ni = readIntElement(xml, "Ni");
        const nj = readIntElement(xml, "Nj");
        const nk = readIntElement(xml, "Nk");
        if (!ni || !nj || !nk) {
            throw new InternalServerErrorException({
                description: `Grid ${uuid} is missing Ni/Nj/Nk`
            });
        }

        // Two geometry encodings are supported: explicit corner-point nodes
        // (`Point3dHdf5Array`, what buildIjkGrid writes) and parametric pillar
        // lines (`Point3dParametricArray`, what fesapi/resqpy writers — e.g. the
        // Drogon Geogrid — emit). Both are reduced to the same explicit
        // coordinate-line node buffer before decoding to corner points.
        const parametric = xml.includes("Point3dParametricArray");
        const decoded = parametric
            ? await this.readParametricNodes(c, uri, xml, ni, nj, nk)
            : await this.readExplicitNodes(c, uri, uuid, ni, nj, nk);

        const grid = ijkGridToCornerPoint({
            ni,
            nj,
            nk,
            nodes: decoded.nodes,
            split: decoded.split
        });
        return { grid, ni, nj, nk, parametric };
    }

    /**
     * Build the RESQML property objects for a grid's ACTNUM and cell properties.
     * ACTNUM is emitted as a DiscreteProperty (concrete kind `index` from the
     * grid-property registry); every other cell-length keyword becomes a
     * ContinuousProperty. Each references the grid
     * as its supporting representation and shares the grid's HDF proxy, so the
     * whole set writes in the same transaction. The keyword is preserved as the
     * citation title for a lossless GRDECL round-trip.
     */
    private buildGridPropertyParts(
        grid: CornerPointGrid,
        gridUuid: string,
        hdfUuid: string,
        version?: ResqmlVersion
    ): BuiltObject[] {
        const parts: BuiltObject[] = [];
        const ncell = grid.ni * grid.nj * grid.nk;

        if (grid.actnum && grid.actnum.length === ncell) {
            const dp = buildDiscreteProperty({
                title: "ACTNUM",
                kind: resqmlKindForKeyword("ACTNUM").kind,
                hdfUuid,
                supportingRepUuid: gridUuid,
                supportingRepType: "obj_IjkGridRepresentation",
                values: Array.from(grid.actnum),
                dimensions: [ncell],
                indexable: "cells",
                version
            });
            parts.push({ object: dp.object, arrays: dp.arrays });
        }

        if (grid.properties) {
            for (const [name, arr] of Object.entries(grid.properties)) {
                if (!arr || arr.length !== ncell) continue;
                const mapped = resqmlKindForKeyword(name);
                const cp = buildContinuousProperty({
                    title: name,
                    kind: mapped.kind,
                    uom: mapped.uom,
                    hdfUuid,
                    supportingRepUuid: gridUuid,
                    supportingRepType: "obj_IjkGridRepresentation",
                    values: Array.from(arr),
                    dimensions: [ncell],
                    indexable: "cells",
                    version
                });
                parts.push({ object: cp.object, arrays: cp.arrays });
            }
        }
        return parts;
    }

    /**
     * Read a grid's stored ACTNUM and (optionally) its cell properties back
     * into the neutral corner-point model. Properties are discovered via the
     * ETP source relationships pointing at the grid (a Discrete/Continuous
     * Property references the grid as its SupportingRepresentation). The
     * property's citation title is used as the GRDECL keyword; the ACTNUM
     * discrete property (title `ACTNUM` or kind `active`) populates
     * `grid.actnum`. `which="actnum"` reads only the active flags (used by the
     * EGRID export); `which="all"` also pulls continuous properties.
     */
    private async loadGridProperties(
        c: ResqmlClient,
        gridUri: string,
        ncell: number,
        version: ResqmlVersion | undefined,
        which: "actnum" | "all"
    ): Promise<{ actnum?: Int32Array; properties?: Record<string, Float64Array> }> {
        const types =
            which === "actnum"
                ? [rtype("obj_DiscreteProperty", version)]
                : [rtype("obj_DiscreteProperty", version), rtype("obj_ContinuousProperty", version)];

        const sources = await c.getSources(gridUri, false, types);
        if (!sources.length) return {};

        let actnum: Int32Array | undefined;
        const properties: Record<string, Float64Array> = {};

        for (const s of sources) {
            if (!s.uri) continue;
            const objs = await c.getDataObjects([s.uri]);
            const obj = objs?.[0];
            if (!obj?.data || obj.data.length === 0) continue;
            const xml = byteToString(obj.data);
            const path = hdfPath(xml, "/values_patch0");
            if (!path) continue;
            const arr = await this.readArray(c, s.uri, path);
            if (!arr || arr.values.length !== ncell) continue;

            const title = readStringElement(xml, "Title") ?? "";
            const discrete = xml.includes("DiscreteProperty");
            const isActnum =
                discrete && (title.toUpperCase() === "ACTNUM" || title.toLowerCase() === "active");
            if (isActnum) {
                actnum = Int32Array.from(arr.values);
            } else if (which === "all" && !discrete) {
                properties[title || s.uri] = Float64Array.from(arr.values);
            }
        }

        return {
            actnum,
            properties: Object.keys(properties).length ? properties : undefined
        };
    }

    /** Read a numeric data array and its dimensions, or null when absent. */
    private async readArray(
        c: ResqmlClient,
        uri: string,
        pathInResource: string
    ): Promise<{ values: number[]; dims: number[] } | null> {
        const a = await c.getDataArray(uri, pathInResource);
        if (
            !a ||
            !a.data ||
            a.data instanceof Energistics.Etp.v12.Datatypes.ErrorInfo
        ) {
            return null;
        }
        const values = c.formatArrayData(a.data.data, "json");
        if (!Array.isArray(values)) {
            return null;
        }
        const dims = (a.data.dimensions ?? []).map(Number);
        return { values: values as number[], dims };
    }

    /**
     * Read explicit corner-point geometry (`Point3dHdf5Array`) written by
     * {@link buildIjkGrid}: the `[nk+1, nCoordLines, 3]` node buffer plus the
     * optional split-coordinate-line indexing.
     */
    private async readExplicitNodes(
        c: ResqmlClient,
        uri: string,
        uuid: string,
        ni: number,
        nj: number,
        nk: number
    ): Promise<{ nodes: Float64Array; split?: IjkDecodeInput["split"] }> {
        const base = `/RESQML/${uuid}`;
        const points = await this.readArray(c, uri, `${base}/points`);
        if (!points) {
            throw new NotFoundException({
                description: `Grid ${uuid} coordinate-line points array not found`
            });
        }
        const nodes = Float64Array.from(points.values);

        // nCoordLines is the middle dimension of the [nkl, nCoordLines, 3] array.
        const nCoordLines =
            points.dims.length >= 2 ? points.dims[1] : (ni + 1) * (nj + 1);
        const splitCount = nCoordLines - (ni + 1) * (nj + 1);

        let split: IjkDecodeInput["split"];
        if (splitCount > 0) {
            const sc = `${base}/splitCoordinateLines`;
            const pillarIndices = await this.readArray(c, uri, `${sc}/pillarIndices`);
            const elements = await this.readArray(c, uri, `${sc}/elements`);
            const cumulative = await this.readArray(c, uri, `${sc}/cumulativeLength`);
            if (pillarIndices && elements && cumulative) {
                split = {
                    count: splitCount,
                    pillarIndices: Int32Array.from(pillarIndices.values),
                    columnsElements: Int32Array.from(elements.values),
                    columnsCumulative: Int32Array.from(cumulative.values)
                };
            }
        }
        return { nodes, split };
    }

    /**
     * Read parametric pillar geometry (`Point3dParametricArray`) and reduce it
     * to the same explicit `[nk+1, nCoordLines, 3]` node buffer.
     *
     * Each coordinate line is a straight, linearly-parametrised segment between
     * two control points (`ControlPoints[0|1]`) at parameters
     * `ControlPointParameters[0|1]`; the node at k-level `kn` on line `L` sits at
     * parameter `Parameters[kn, L]`. Split coordinate lines reuse the control
     * points of their base pillar (via `SplitCoordinateLines/PillarIndices`) but
     * carry their own parameter column, so fault throw is preserved. HDF paths
     * are read from the object XML (they are writer-specific, e.g. `parameters`,
     * `controlPoints`, `PillarIndices`).
     */
    private async readParametricNodes(
        c: ResqmlClient,
        uri: string,
        xml: string,
        ni: number,
        nj: number,
        nk: number
    ): Promise<{ nodes: Float64Array; split?: IjkDecodeInput["split"] }> {
        const paramsPath = hdfPath(xml, "/parameters");
        const ctrlPath = hdfPath(xml, "/controlPoints");
        const ctrlParamPath = hdfPath(xml, "/controlPointParameters");
        if (!paramsPath || !ctrlPath || !ctrlParamPath) {
            throw new InternalServerErrorException({
                description: `Parametric grid is missing parameters/controlPoints HDF paths`
            });
        }

        const parameters = await this.readArray(c, uri, paramsPath);
        const controlPoints = await this.readArray(c, uri, ctrlPath);
        const controlPointParameters = await this.readArray(c, uri, ctrlParamPath);
        if (!parameters || !controlPoints || !controlPointParameters) {
            throw new NotFoundException({
                description: `Parametric grid geometry arrays not found in the store`
            });
        }

        const nkl = nk + 1;
        const nBase = (ni + 1) * (nj + 1);
        // Parameters are laid out [nkl, nCoordLines]; the line count is the fast dim.
        const nLines = parameters.dims.length >= 2 ? parameters.dims[1] : nBase;
        const nSplit = nLines - nBase;

        const cp = controlPoints.values; // [2, nBase, 3] row-major
        const cpp = controlPointParameters.values; // [2, nBase] row-major
        const par = parameters.values; // [nkl, nLines] row-major

        let pillarIndices: Int32Array | undefined;
        let split: IjkDecodeInput["split"];
        if (nSplit > 0) {
            const pi = await this.readArrayOpt(c, uri, hdfPath(xml, "/PillarIndices"));
            const el = await this.readArrayOpt(c, uri, hdfPath(xml, "/elements"));
            const cum = await this.readArrayOpt(c, uri, hdfPath(xml, "/cumulativeLength"));
            if (pi && el && cum) {
                pillarIndices = Int32Array.from(pi.values);
                split = {
                    count: nSplit,
                    pillarIndices,
                    columnsElements: Int32Array.from(el.values),
                    columnsCumulative: Int32Array.from(cum.values)
                };
            }
        }

        const nodes = new Float64Array(nkl * nLines * 3);
        for (let L = 0; L < nLines; L++) {
            const pillar =
                L < nBase ? L : pillarIndices ? pillarIndices[L - nBase] : L;
            const b0 = (0 * nBase + pillar) * 3;
            const b1 = (1 * nBase + pillar) * 3;
            const x0 = cp[b0];
            const y0 = cp[b0 + 1];
            const z0 = cp[b0 + 2];
            const x1 = cp[b1];
            const y1 = cp[b1 + 1];
            const z1 = cp[b1 + 2];
            const t0 = cpp[0 * nBase + pillar];
            const t1 = cpp[1 * nBase + pillar];
            const dt = t1 - t0;
            for (let kn = 0; kn < nkl; kn++) {
                const t = par[kn * nLines + L];
                const f = dt !== 0 ? (t - t0) / dt : 0;
                const o = (kn * nLines + L) * 3;
                nodes[o] = x0 + f * (x1 - x0);
                nodes[o + 1] = y0 + f * (y1 - y0);
                nodes[o + 2] = z0 + f * (z1 - z0);
            }
        }
        return { nodes, split };
    }

    /** {@link readArray} guarded on a possibly-null path. */
    private async readArrayOpt(
        c: ResqmlClient,
        uri: string,
        pathInResource: string | null
    ): Promise<{ values: number[]; dims: number[] } | null> {
        return pathInResource ? this.readArray(c, uri, pathInResource) : null;
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
        let localTx:
            | Awaited<ReturnType<ResqmlClient["startTransaction"]>>
            | undefined = undefined;
        try {
            logger.info(
                `Grid write: ${parts.length} object(s) into dataspace ${dataspaceId}` +
                (transactionId ? ` (tx ${transactionId})` : " (auto-commit)")
            );
            c = await createSession(
                extractToken(request),
                extractDataPartitionId(request),
                undefined,
                transactionId,
                extractUserInfo(request)
            );
            // Auto-commit mode must open its own transaction: a grid write puts an
            // object *and* its bulk arrays, and array writes require an active
            // transaction on the ETP session (unlike plain object puts).
            if (!transactionId) {
                const dsUri = EtpUri.createDataSpaceUri(dataspaceId).uri;
                localTx = await c.startTransaction(
                    false,
                    [dsUri],
                    `Grid import into ${dataspaceId}`
                );
            }
            const written = await this.writeParts(c, dataspaceId, parts);
            if (localTx) {
                await c.commitTransaction(localTx);
            }
            if (!transactionId) {
                await c.closeSession();
            }
            return written;
        } catch (err) {
            logger.error(`Error during grid write: ${err}`);
            if (localTx && c) {
                await c
                    .rollbackTransaction(localTx)
                    .catch(e => logger.error(`Grid write rollback failed: ${e}`));
            }
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
        parts: BuiltObject[]
    ): Promise<WriteSummary> {
        const xmlBuilder = new XMLBuilder();

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

        const tPutObj = Date.now();
        await c.putDataObjects(etpObjects as unknown as EtpDataObject[], { throwOnError: true });
        const tPutArr = Date.now();

        let arrayBytes = 0;
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
            const typed = this.toTypedArray(a.Data, a.ArrayType);
            arrayBytes += typed.byteLength;
            return [{ uid: dataArray, dimensions: a.Dimensions, data: typed }];
        });
        // Generic bounded-concurrency array write (ResqmlClient.putDataArrays).
        await c.putDataArrays(arrayInputs);
        const arrayCount = arrayInputs.length;
        const tDone = Date.now();
        logger.info(
            `[grid-bench] writeParts putObjects=${tPutArr - tPutObj}ms ` +
            `putArrays=${tDone - tPutArr}ms (${arrayCount} arrays, ` +
            `${(arrayBytes / 1e6).toFixed(1)}MB)`
        );

        return { objects: etpObjects.length, arrays: arrayCount };
    }

    /**
     * Convert builder array data (a JSON number[]) to the typed array ETP
     * expects. The grid builders emit Float64Array (points) / Int32Array
     * (split indices) bulk data.
     */
    private toTypedArray(
        data: number[] | string,
        arrayType: string
    ): Float64Array | Int32Array {
        if (typeof data === "string") {
            throw new BadRequestException({
                description: "Base64 array data is not supported by the grid lane"
            });
        }
        return arrayType === "Int32Array"
            ? Int32Array.from(data)
            : Float64Array.from(data);
    }


}

/**
 * Read a required non-negative integer child element (e.g. `<Ni>`, `<Nj>`,
 * `<Nk>`) out of a RESQML object's XML, tolerating any namespace prefix.
 * Returns 0 when absent.
 */
function readIntElement(xml: string, name: string): number {
    const re = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>\\s*(\\d+)\\s*</(?:\\w+:)?${name}>`);
    const m = re.exec(xml);
    return m ? Number(m[1]) : 0;
}

/**
 * Read the first text child element `name` (any namespace prefix) from a
 * RESQML object's XML — used to recover a property's citation `Title` (the
 * original GRDECL/INIT keyword) on export. Returns null when absent.
 */
function readStringElement(xml: string, name: string): string | null {
    const re = new RegExp(`<(?:\\w+:)?${name}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</(?:\\w+:)?${name}>`);
    const m = re.exec(xml);
    return m ? m[1] : null;
}

/**
 * Find the first `<PathInHdfFile>` in a RESQML object's XML whose value ends
 * with `suffix` (a leading-slash-anchored dataset name, e.g. `/parameters`,
 * `/controlPoints`, `/PillarIndices`). HDF paths are writer-specific, so
 * parametric-geometry export resolves them from the object rather than
 * assuming a fixed layout. Returns null when absent.
 */
function hdfPath(xml: string, suffix: string): string | null {
    const esc = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
        `<(?:\\w+:)?PathInHdfFile(?:\\s[^>]*)?>\\s*([^<\\s]*${esc})\\s*</(?:\\w+:)?PathInHdfFile>`
    );
    const m = re.exec(xml);
    return m ? m[1] : null;
}
