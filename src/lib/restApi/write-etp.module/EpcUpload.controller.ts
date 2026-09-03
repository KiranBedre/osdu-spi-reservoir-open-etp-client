// ============================================================================
// Copyright 2024 Open Group. All rights reserved.
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
    Controller,
    InternalServerErrorException,
    Param,
    PayloadTooLargeException,
    Post,
    Query,
    Req,
    UploadedFiles,
    UseGuards,
    UseInterceptors
} from "@nestjs/common";

import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConsumes,
    ApiDefaultResponse,
    ApiForbiddenResponse,
    ApiGoneResponse,
    ApiHeader,
    ApiInternalServerErrorResponse,
    ApiNotAcceptableResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiPayloadTooLargeResponse,
    ApiQuery,
    ApiTags,
    ApiTooManyRequestsResponse
} from "@nestjs/swagger";

import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { diskStorage } from "multer";

import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { XMLParser } from "fast-xml-parser";

import {
    DataObject,
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
    httpErrorFromEtpError,
    partitionPattern,
    patternString,
    swaggerServers,
    transactionIdQueryParam,
    webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import { qualifiedTypeRegex } from "../../common/EtpQualifiedType";

import { createManifest } from "../../jsonTypes/Manifest";
import { OSDUContext } from "../../jsonTypes/OsduContext";
import { osduUrl } from "../../common/config";
import { bigIntToString } from "../../mlTypes/XmlJsonUtil";
import {
    ensureSchemaVersions,
    isSchemaRegistered,
    setSchemaRegistered,
    parseKindIdentity,
    listRegisteredVersions
} from "../../jsonTypes/MilestoneKinds";
import { decode, JwtPayload } from "jsonwebtoken";
import { readFile } from "fs/promises";
import { join } from "path";

import { ValidatorClient } from "../../client/ValidatorClient";
import type { ValidationReport } from "../../client/ValidatorClient";

import logging from "../../common/Logging";
const logger = logging.getLogger("EtpClient");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Warning collected during upload for the response */
interface UploadWarning {
    phase: string;
    message: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Max EPC file size in bytes (default 200 MB) */
const MAX_EPC_BYTES = parseInt(
    process.env.RDMS_EPC_MAX_SIZE_MB ?? "200",
    10
) * 1024 * 1024;

/** Max H5 file size in bytes (default 2 GB) */
const MAX_H5_BYTES = parseInt(
    process.env.RDMS_H5_MAX_SIZE_MB ?? "2048",
    10
) * 1024 * 1024;

/** Max objects allowed in a single EPC (default 10 000) */
const MAX_OBJECTS = parseInt(
    process.env.RDMS_EPC_MAX_OBJECTS ?? "10000",
    10
);

/** Overall upload timeout in ms (default 10 minutes) */
const UPLOAD_TIMEOUT_MS = parseInt(
    process.env.RDMS_EPC_UPLOAD_TIMEOUT_MS ?? "600000",
    10
);

/** If more than this fraction of arrays fail, rollback (default 0.5) */
const ARRAY_FAILURE_THRESHOLD = parseFloat(
    process.env.RDMS_ARRAY_FAILURE_THRESHOLD ?? "0.5"
);

/** Max concurrent array uploads (default 5) */
const ARRAY_CONCURRENCY = parseInt(
    process.env.RDMS_ARRAY_CONCURRENCY ?? "5",
    10
);

/** Batch size for putDataObjects calls */
const OBJECT_BATCH_SIZE = 100;

/** Batch size for pushing records to OSDU Storage Service */
const STORAGE_BATCH_SIZE = 500;

/** Valid values for the autoIngest query parameter */
type IngestMode = "records" | "workflow";

/** Optional directory holding OSDU schema JSON files for auto-registration. */
const SCHEMA_DIR = process.env.RDMS_SCHEMA_DIR;

/**
 * When a kind is not registered at any version, remap it to a registered generic
 * work-product-component sibling (GenericRepresentation / GenericInterpretation /
 * GenericFeature / GenericProperty) instead of dropping the record. Lossy but
 * keeps the object; the original type is preserved in `data.Type`.
 * Opt out with RDMS_INGEST_GENERIC_FALLBACK=false. Default on.
 */
const GENERIC_FALLBACK = (process.env.RDMS_INGEST_GENERIC_FALLBACK ?? "true") !== "false";

/**
 * Map a work-product-component entityType to an ordered list of candidate
 * generic sibling entityTypes, classified by role and (for representations)
 * geometry. Mirrors the converter's routing preference in the RESQML→OSDU guide:
 * grid-derived representations prefer GenericBinGrid (preserves grid geometry:
 * origin, bin widths, node counts) and fall back to GenericRepresentation.
 * Returns [] for non-WPC groups or kinds that are already generic.
 */
function genericSiblingsFor(entityType: string): string[] {
    const m = entityType.match(/^work-product-component--(.+)$/);
    if (!m) return [];                   // only WPCs have generic siblings
    const name = m[1];
    if (name.startsWith("Generic")) return [];
    if (name.endsWith("Interpretation")) return ["work-product-component--GenericInterpretation"];
    if (name.endsWith("Feature")) return ["work-product-component--GenericFeature"];
    if (name.endsWith("Property")) return ["work-product-component--GenericProperty"];
    // Representation family. Grid-derived types keep grid geometry in GenericBinGrid.
    if (/BinGrid|Grid2d|StructureMap|SeismicHorizon/i.test(name)) {
        return [
            "work-product-component--GenericBinGrid",
            "work-product-component--GenericRepresentation"
        ];
    }
    return ["work-product-component--GenericRepresentation"];
}

/** Result of an auto-ingest attempt (returned in the upload response). */
interface CatalogIngestionResult {
    status: string;
    mode?: string;
    recordCount?: number;
    workflowRunId?: string;
    error?: string;
    /** Kinds skipped because no schema is registered on the target instance (kind → record count). */
    unsupportedKinds?: Record<string, number>;
    /** Kinds whose schema was auto-registered during this ingest. */
    registeredSchemas?: string[];
    /** Kinds substituted with a fallback kind before ingest (original kind → substituted kind). */
    remappedKinds?: Record<string, string>;
    /** Number of records that failed the resilient per-record fallback. */
    failedCount?: number;
    /** Sample of per-record failures (capped). */
    failures?: Array<{ id?: string; kind?: string; status: number; error: string }>;
}

// ---------------------------------------------------------------------------
// Multer disk storage - files go to OS temp dir, cleaned up after ingest
// ---------------------------------------------------------------------------

const uploadStorage = diskStorage({
    destination: (_req, _file, cb) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epc-upload-"));
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        // Sanitise - keep only alphanumerics, dashes, underscores, dots
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        cb(null, safe);
    }
});

// ---------------------------------------------------------------------------
// EPC content-type → Energistics domain mapping
// ---------------------------------------------------------------------------

/**
 * Content types in EPC [Content_Types].xml look like:
 *   application/x-resqml+xml;version=2.0;type=obj_IjkGridRepresentation
 *   application/x-eml+xml;version=2.0;type=obj_EpcExternalPartReference
 *
 * This regex extracts domain family, version, and data type.
 */
const epcContentTypeRegex =
    /application\/x-(?<domainFamily>resqml|eml|witsml|prodml)\+xml;version=(?<domainVersion>[\d.]+);type=(?<dataType>\w+)/;

/**
 * Parse the [Content_Types].xml manifest from the EPC zip.
 * Returns a map from part name (zip entry path) to content-type string.
 */
function parseContentTypes(
    xml: string
): Map<string, string> {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_"
    });
    const doc = parser.parse(xml);
    const result = new Map<string, string>();
    const types = doc?.Types;
    if (!types) return result;

    // <Override PartName="/obj_xxx.xml" ContentType="application/x-resqml+xml;..." />
    let overrides = types.Override;
    if (!Array.isArray(overrides)) {
        overrides = overrides ? [overrides] : [];
    }
    for (const ov of overrides) {
        const partName: string = ov["@_PartName"] ?? "";
        const ct: string = ov["@_ContentType"] ?? "";
        if (partName && ct) {
            // PartName starts with "/" - normalise
            result.set(partName.replace(/^\//, ""), ct);
        }
    }
    return result;
}

/**
 * Extract UUID from a RESQML/EML XML buffer.
 * Looks for the `uuid` attribute on the root element.
 */
function extractUuidFromXml(xml: string): string | undefined {
    const m = xml.match(/\buuid="([0-9a-fA-F-]{36})"/);
    return m?.[1];
}

/**
 * Extract Citation Title from RESQML/EML XML.
 */
function extractTitleFromXml(xml: string): string {
    const m = xml.match(/<eml:Title[^>]*>([^<]+)<\/eml:Title>/);
    return m?.[1] ?? "Untitled";
}

/**
 * Walk an HDF5 group recursively and return all dataset paths.
 */
function walkH5Datasets(
    group: any,
    prefix: string
): string[] {
    const paths: string[] = [];
    for (const key of group.keys()) {
        const child = group.get(key);
        if (!child) continue;
        const childPath = prefix ? `${prefix}/${key}` : key;
        if (child.constructor?.name === "Dataset") {
            paths.push("/" + childPath);
        } else if (typeof child.keys === "function") {
            // It's a Group
            paths.push(...walkH5Datasets(child, childPath));
        }
    }
    return paths;
}

/**
 * Map an h5wasm dtype string to a JS TypedArray constructor name.
 */
function h5DtypeToTypedArrayName(dtype: string | object): string {
    if (typeof dtype !== "string") return "Float64Array";
    // h5wasm returns dtype strings like "<f4", "<f8", "<i4", "<u4", etc.
    if (dtype.includes("f8") || dtype.includes("f")) return "Float64Array";
    if (dtype.includes("f4")) return "Float32Array";
    if (dtype.includes("i8")) return "BigInt64Array";
    if (dtype.includes("u8")) return "BigUint64Array";
    if (dtype.includes("i4")) return "Int32Array";
    if (dtype.includes("u4")) return "Uint32Array";
    if (dtype.includes("i2")) return "Int16Array";
    if (dtype.includes("u2")) return "Uint16Array";
    if (dtype.includes("i1")) return "Int8Array";
    if (dtype.includes("u1")) return "Uint8Array";
    return "Float64Array";
}

// ---------------------------------------------------------------------------
// Temp file cleanup helper
// ---------------------------------------------------------------------------

function cleanupFiles(files: { epc?: Express.Multer.File[]; h5?: Express.Multer.File[] }) {
    const allFiles = [...(files.epc ?? []), ...(files.h5 ?? [])];
    for (const f of allFiles) {
        try {
            fs.unlinkSync(f.path);
        } catch { /* best effort */ }
        // Also try to remove the temp directory
        try {
            fs.rmdirSync(path.dirname(f.path));
        } catch { /* best effort - may not be empty */ }
    }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

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
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema("Unknown Error", 500))
@ApiDefaultResponse(errorMessageSchema("Unknown Error", 500))
@Controller("dataspaces/:dataspaceId/epc")
export default class EpcUploadAPI {
    /**
     * Upload an EPC + H5 file pair and ingest into the dataspace.
     *
     * Processing steps:
     *  1. Validate file sizes
     *  2. Unzip EPC → parse [Content_Types].xml → extract XML objects
     *  3. Read H5 datasets referenced by the XML objects
     *  4. Start transaction → PUT objects in batches → PUT arrays → commit
     */
    @Post("upload")
    @ApiConsumes("multipart/form-data")
    @ApiBody({
        description:
            "EPC file (.epc) and optional HDF5 file (.h5). " +
            "The EPC file is a ZIP archive containing RESQML/EML XML objects and a " +
            "[Content_Types].xml manifest. The H5 file contains associated array data.",
        schema: {
            type: "object",
            required: ["epc"],
            properties: {
                epc: {
                    type: "string",
                    format: "binary",
                    description: "EPC file (ZIP archive)"
                },
                h5: {
                    type: "string",
                    format: "binary",
                    description: "HDF5 file (.h5) with array data"
                }
            }
        }
    })
    @ApiQuery(transactionIdQueryParam)
    @ApiQuery({
        name: "dataspace",
        required: false,
        description:
            "Override the dataspace from the URL path. "
            + "When the path uses `dataspaceId=auto` (the recommended default), the dataspace is derived from `{username}/{epc_filename}`. "
            + "Set this query parameter to use a specific dataspace instead (e.g. `?dataspace=myteam/project1`).",
        schema: {
            type: "string"
        }
    })
    @ApiQuery({
        name: "autoIngest",
        required: false,
        description:
            "When set, automatically builds an OSDU manifest after EPC ingest and pushes it to the OSDU catalog. " +
            "Values: 'records' (default if set to 'true') pushes records directly via Storage Service; " +
            "'workflow' submits the manifest to the OSDU ingestion workflow (Airflow DAG) for processing. " +
            "Omit or set to 'false' to skip catalog registration (current default behavior).",
        schema: {
            type: "string",
            enum: ["false", "true", "records", "workflow"],
            default: "false"
        }
    })
    @ApiQuery({
        name: "registerMissingSchemas",
        required: false,
        description:
            "When set to 'true' together with `autoIngest`, any record whose OSDU `kind` has no schema registered on the "
            + "target instance is guarded: RDDMS first attempts to register the schema (from a JSON file under `RDMS_SCHEMA_DIR` "
            + "named `<entityType>:<version>.json`, e.g. `work-product-component--StructureMap:1.0.0.json`), and if no schema "
            + "source is available the record is skipped and reported under `catalogIngestion.unsupportedKinds` so the rest of "
            + "the manifest still ingests. Defaults to 'false' (unsupported kinds are still skipped and reported, but not registered).",
        schema: {
            type: "string",
            enum: ["false", "true"],
            default: "false"
        }
    })
    @ApiQuery({
        name: "validate",
        required: false,
        description:
            "When 'true', runs RESQML strict validation (XSD, DOR integrity, business rules) on the EPC before ingesting. " +
            "If validation finds errors, the upload still proceeds but the response includes a `validation` report. " +
            "Set to 'strict' to reject the upload on validation errors (returns 400).",
        schema: {
            type: "string",
            enum: ["false", "true", "strict"],
            default: "false"
        }
    })
    @ApiOkResponse({
        description: "Ingest result summary",
        schema: {
            type: "object",
            properties: {
                success: { type: "boolean" },
                objectsStored: { type: "integer" },
                arraysStored: { type: "integer" },
                skippedArrays: { type: "integer" },
                h5DataSize: {
                    type: "object",
                    nullable: true,
                    description: "Total H5 array data size (present when arrays were uploaded)",
                    properties: {
                        elements: { type: "integer", description: "Total number of array elements" },
                        bytes: { type: "integer", description: "Total bytes to transfer" }
                    }
                },
                objects: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            objectType: { type: "string" },
                            uuid: { type: "string" },
                            title: { type: "string" }
                        }
                    }
                },
                warnings: {
                    type: "array",
                    nullable: true,
                    description: "Diagnostic warnings collected during upload",
                    items: {
                        type: "object",
                        properties: {
                            phase: { type: "string", description: "Processing phase (extract, h5scan, h5open, putArrays)" },
                            message: { type: "string" }
                        }
                    }
                },
                timings: {
                    type: "object",
                    description: "Elapsed time per phase in milliseconds",
                    properties: {
                        unzip: { type: "integer" },
                        extract: { type: "integer" },
                        validate: { type: "integer" },
                        h5scan: { type: "integer" },
                        h5open: { type: "integer" },
                        session: { type: "integer" },
                        putObjects: { type: "integer" },
                        putArrays: { type: "integer" },
                        commit: { type: "integer" },
                        autoIngest: { type: "integer" },
                        total: { type: "integer" }
                    }
                },
                catalogIngestion: {
                    type: "object",
                    nullable: true,
                    properties: {
                        status: { type: "string", enum: ["submitted", "completed", "failed", "skipped"] },
                        mode: { type: "string", enum: ["records", "workflow"] },
                        recordCount: { type: "integer" },
                        workflowRunId: { type: "string" },
                        error: { type: "string" }
                    }
                },
                validation: {
                    type: "object",
                    nullable: true,
                    description: "RESQML validation report (present when ?validate=true or ?validate=strict)",
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
    })
    @ApiBadRequestResponse(
        errorMessageSchema("Invalid EPC file or missing [Content_Types].xml")
    )
    @ApiPayloadTooLargeResponse(
        errorMessageSchema(
            `File too large. Max EPC: ${MAX_EPC_BYTES / 1024 / 1024} MB, Max H5: ${MAX_H5_BYTES / 1024 / 1024} MB`
        )
    )
    @ApiOperation({
        summary: "Upload EPC + H5 and ingest into dataspace",
        description:
            "Upload a RESQML EPC file (ZIP with XML objects) and an optional HDF5 companion file.\n\n" +
            "**Processing flow**:\n" +
            "1. Validate file sizes against configured limits\n" +
            "2. Unzip EPC → parse `[Content_Types].xml` manifest\n" +
            "3. Extract XML objects, identify `EpcExternalPartReference` entries\n" +
            "4. Scan XML for `<Hdf5Dataset>` blocks → collect H5 dataset paths\n" +
            "5. Open H5 file, pre-scan dataset metadata\n" +
            "6. Ensure dataspace exists (auto-create if needed)\n" +
            "7. Start transaction (or reuse caller's)\n" +
            "8. PUT objects in batches of 100 (avoids ETP message size limits)\n" +
            "9. PUT arrays one-by-one from H5 file (bounded memory)\n" +
            "10. Commit transaction\n" +
            "11. Auto-ingest to OSDU catalog (if `autoIngest` is set)\n\n" +
            "**Dataspace resolution**:\n" +
            "- Use `/dataspaces/auto/epc/upload` to auto-generate the dataspace as `{username}/{epc_name}`\n" +
            "- Override with `?dataspace=my/space` to use a specific name\n" +
            "- The dataspace is auto-created if it doesn't exist\n\n" +
            "**Auto-ingest modes**:\n" +
            "- `false` (default) - no catalog registration\n" +
            "- `true` / `records` - builds manifest → pushes records via Storage Service (data immediately searchable)\n" +
            "- `workflow` - builds manifest → submits to OSDU ingestion workflow DAG\n\n" +
            "**Note**: `autoIngest` requires an internal transaction (omit `transactionId`). When using an external transaction, auto-ingest is skipped because the data may not be committed yet.\n\n" +
            "**Performance**: H5 file is written to disk (not buffered in memory). Arrays are read and sent one at a time. Duplicate H5 dataset references are deduplicated.",
        servers: swaggerServers
    })
    @UseInterceptors(
        FileFieldsInterceptor(
            [
                { name: "epc", maxCount: 1 },
                { name: "h5", maxCount: 1 }
            ],
            {
                storage: uploadStorage,
                limits: {
                    fileSize: Math.max(MAX_EPC_BYTES, MAX_H5_BYTES),
                    files: 2
                }
            }
        )
    )
    public async uploadEpc(
        @UploadedFiles() files: { epc?: Express.Multer.File[]; h5?: Express.Multer.File[] },
        @Param() params: FindInDataSpaceParams,
        @Query("transactionId") transactionId?: string,
        @Query("autoIngest") autoIngest?: string,
        @Query("registerMissingSchemas") registerMissingSchemas?: string,
        @Query("validate") validate?: string,
        @Query("dataspace") dataspaceOverride?: string,
        @Req() request?: express.Request
    ) {
        // ── Resolve dataspace name ──
        // Defaults: dataspaceId="auto" → username/epcname, validate=off, autoIngest=off
        // Override via query: ?dataspace=my/space  ?validate=true  ?autoIngest=records
        let dataspaceId = dataspaceOverride || params.dataspaceId;
        if (dataspaceId === "auto") {
            const epcName = files?.epc?.[0]?.originalname?.replace(/\.epc$/i, "") || "upload";
            const safeName = epcName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
            // Extract user from JWT
            const bearer = extractToken(request);
            let userName = "user";
            if (bearer) {
                try {
                    const jwt = decode(bearer) as JwtPayload;
                    if (jwt && typeof jwt !== "string") {
                        userName = (jwt.unique_name || jwt.preferred_username || jwt.sub || "user")
                            .replace(/@.*/, "")
                            .replace(/[^a-zA-Z0-9_-]/g, "_")
                            .toLowerCase();
                    }
                } catch { /* use default */ }
            }
            dataspaceId = `${userName}/${safeName}`;
            // Overwrite params so downstream code uses the resolved name
            params = { ...params, dataspaceId };
        }

        logger.info(
            `EPC upload request for dataspace: ${params.dataspaceId}`
        );

        // ── Validate uploaded files ──
        const epcFile = files?.epc?.[0];
        if (!epcFile) {
            cleanupFiles(files ?? {});
            throw new BadRequestException({
                description: "Missing required 'epc' file field"
            });
        }
        if (epcFile.size > MAX_EPC_BYTES) {
            cleanupFiles(files ?? {});
            throw new PayloadTooLargeException({
                description: `EPC file exceeds maximum size of ${MAX_EPC_BYTES / 1024 / 1024} MB`
            });
        }
        const h5File = files?.h5?.[0];
        if (h5File && h5File.size > MAX_H5_BYTES) {
            cleanupFiles(files ?? {});
            throw new PayloadTooLargeException({
                description: `H5 file exceeds maximum size of ${MAX_H5_BYTES / 1024 / 1024} MB`
            });
        }

        let c: ResqmlClient | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let h5wasm: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let h5FileHandle: any;

        const warnings: UploadWarning[] = [];
        const timings: Record<string, number> = {};
        const uploadStart = performance.now();

        /** Check if we've exceeded the upload timeout */
        const checkTimeout = (phase: string) => {
            const elapsed = performance.now() - uploadStart;
            if (elapsed > UPLOAD_TIMEOUT_MS) {
                throw new InternalServerErrorException({
                    description: `Upload timeout exceeded in phase '${phase}' after ${(elapsed / 1000).toFixed(1)}s (limit: ${UPLOAD_TIMEOUT_MS / 1000}s)`
                });
            }
        };

        try {
            // ── 1. Unzip EPC ──
            let phaseStart = performance.now();
            logger.info("Unzipping EPC file...");
            const AdmZip = (await import("adm-zip")).default;
            const zip = new AdmZip(epcFile.path);
            const zipEntries = zip.getEntries();

            // Find [Content_Types].xml
            const ctEntry = zipEntries.find(
                e =>
                    e.entryName === "[Content_Types].xml" ||
                    e.entryName === "[Content_types].xml" ||
                    e.entryName.toLowerCase() === "[content_types].xml"
            );
            if (!ctEntry) {
                throw new BadRequestException({
                    description:
                        "Invalid EPC file: missing [Content_Types].xml manifest"
                });
            }
            const contentTypes = parseContentTypes(ctEntry.getData().toString("utf-8"));
            logger.info(`Found ${contentTypes.size} part(s) in [Content_Types].xml`);
            timings.unzip = performance.now() - phaseStart;

            // ── 2. Extract XML objects ──
            phaseStart = performance.now();
            checkTimeout("extract");

            interface EpcObject {
                uuid: string;
                title: string;
                xml: string;
                domainFamily: string;
                domainVersion: string;
                dataType: string;
                entryName: string;
            }

            const epcObjects: EpcObject[] = [];
            const epcExternalPartUuids = new Set<string>();
            const seenUuids = new Map<string, string>(); // uuid → entryName (for duplicate detection)

            for (const [partName, contentType] of contentTypes) {
                const m = epcContentTypeRegex.exec(contentType);
                if (!m?.groups) continue;

                const { domainFamily, domainVersion, dataType } = m.groups;

                // Find the corresponding zip entry
                const entry = zipEntries.find(
                    e =>
                        e.entryName === partName ||
                        e.entryName === "/" + partName
                );
                if (!entry || entry.isDirectory) continue;

                const xmlStr = entry.getData().toString("utf-8");
                const uuid = extractUuidFromXml(xmlStr);
                if (!uuid) {
                    warnings.push({ phase: "extract", message: `Skipping ${partName}: no UUID found in XML` });
                    logger.warn(`Skipping ${partName}: no UUID found in XML`);
                    continue;
                }

                // #12: Detect duplicate UUIDs
                if (seenUuids.has(uuid)) {
                    const firstEntry = seenUuids.get(uuid)!;
                    warnings.push({
                        phase: "extract",
                        message: `Duplicate UUID ${uuid} in '${partName}' (first seen in '${firstEntry}') - skipping duplicate`
                    });
                    logger.warn(`Duplicate UUID ${uuid} in '${partName}' - already seen in '${firstEntry}'`);
                    continue;
                }
                seenUuids.set(uuid, partName);

                const title = extractTitleFromXml(xmlStr);

                // Normalise domain version: "2.0" → "20", "2.2" → "22"
                const normalizedVersion = domainVersion.replace(/\./g, "");

                epcObjects.push({
                    uuid,
                    title,
                    xml: xmlStr,
                    domainFamily,
                    domainVersion: normalizedVersion,
                    dataType,
                    entryName: partName
                });

                // Track EpcExternalPartReference UUIDs - these map to the H5 file
                if (dataType === "obj_EpcExternalPartReference") {
                    epcExternalPartUuids.add(uuid);
                }
            }

            if (epcObjects.length === 0) {
                throw new BadRequestException({
                    description: "No valid RESQML/EML objects found in EPC file"
                });
            }
            if (epcObjects.length > MAX_OBJECTS) {
                throw new BadRequestException({
                    description: `EPC contains ${epcObjects.length} objects, exceeding limit of ${MAX_OBJECTS}`
                });
            }
            timings.extract = performance.now() - phaseStart;

            logger.info(
                `Extracted ${epcObjects.length} object(s), ${epcExternalPartUuids.size} external part reference(s)`
            );

            // ── 2b. Optional RESQML validation ──
            let validationReport: ValidationReport | undefined;
            const doValidate = validate === "true" || validate === "strict";

            if (doValidate) {
                phaseStart = performance.now();
                logger.info("Running RESQML validation on EPC...");
                const validator = new ValidatorClient();
                validationReport = await validator.validateEpcFromPaths(
                    epcFile.path,
                    h5File?.path
                );
                timings.validate = performance.now() - phaseStart;
                logger.info(
                    `Validation complete: ${validationReport.is_valid ? "VALID" : "INVALID"} ` +
                    `(${validationReport.error_count} errors, ${validationReport.warning_count} warnings)`
                );

                if (validate === "strict" && !validationReport.is_valid) {
                    cleanupFiles(files ?? {});
                    throw new BadRequestException({
                        statusCode: 400,
                        message: `RESQML validation failed: ${validationReport.error_count} error(s)`,
                        error: "Validation Failed",
                        validation: validationReport
                    });
                }
            }

            // ── 3. Scan XML for HDF5 dataset references ──
            phaseStart = performance.now();
            checkTimeout("h5scan");

            interface H5Reference {
                pathInHdfFile: string;
                /** UUID of the object that references this dataset */
                objectUuid: string;
                /** UUID of the EpcExternalPartReference (container for the array) */
                externalPartUuid: string;
            }

            const h5Refs: H5Reference[] = [];

            // Pre-compiled regexes - hoisted out of the per-object loop
            // v2.0.1 pattern: <PathInHdfFile>path</PathInHdfFile> + <HdfProxy><UUID>uuid</UUID></HdfProxy>
            const pathRegex =
                /<(?:[\w]+:)?PathInHdfFile[^>]*>([^<]+)<\/(?:[\w]+:)?PathInHdfFile>/g;
            const hdfProxyRegex =
                /<(?:[\w]+:)?HdfProxy[^>]*>[\s\S]*?<(?:[\w]+:)?UUID[^>]*>([0-9a-fA-F-]{36})<\/(?:[\w]+:)?UUID>/g;

            // v2.2 pattern: <ExternalDataArrayPart>...<PathInExternalFile>path</PathInExternalFile>...<URI>file.h5</URI>...</ExternalDataArrayPart>
            const pathInExternalFileRegex =
                /<(?:[\w]+:)?PathInExternalFile[^>]*>([^<]+)<\/(?:[\w]+:)?PathInExternalFile>/g;

            for (const obj of epcObjects) {
                // Skip EpcExternalPartReference objects - they don't contain HDF references
                if (obj.dataType === "obj_EpcExternalPartReference") continue;

                const xmlStr = obj.xml;

                // ── v2.0.1: PathInHdfFile + HdfProxy/UUID ──
                pathRegex.lastIndex = 0;
                let pathMatch;
                while ((pathMatch = pathRegex.exec(xmlStr)) !== null) {
                    const pathValue = pathMatch[1];
                    hdfProxyRegex.lastIndex = pathMatch.index;
                    const uuidMatch = hdfProxyRegex.exec(xmlStr);
                    if (uuidMatch?.[1]) {
                        h5Refs.push({
                            pathInHdfFile: pathValue,
                            objectUuid: obj.uuid,
                            externalPartUuid: uuidMatch[1]
                        });
                    }
                }

                // ── v2.2: PathInExternalFile (ExternalDataArrayPart) ──
                // In RESQML 2.2 / EML 2.3, arrays use ExternalDataArrayPart
                // with PathInExternalFile and URI. No EpcExternalPartReference;
                // the array container URI is the parent object's own URI.
                pathInExternalFileRegex.lastIndex = 0;
                while ((pathMatch = pathInExternalFileRegex.exec(xmlStr)) !== null) {
                    const pathValue = pathMatch[1];
                    h5Refs.push({
                        pathInHdfFile: pathValue,
                        objectUuid: obj.uuid,
                        externalPartUuid: obj.uuid // v2.2: object is its own container
                    });
                }
            }

            logger.info(`Found ${h5Refs.length} HDF5 dataset reference(s) in XML`);

            // #4: Validate that all referenced EpcExternalPartReference UUIDs exist in the EPC
            // (skip v2.2 refs where externalPartUuid === objectUuid — no EPR in v2.2)
            const danglingRefs = new Set<string>();
            for (const ref of h5Refs) {
                if (ref.externalPartUuid === ref.objectUuid) continue; // v2.2: no EPR
                if (!epcExternalPartUuids.has(ref.externalPartUuid)) {
                    danglingRefs.add(ref.externalPartUuid);
                }
            }
            if (danglingRefs.size > 0) {
                const msg = `${danglingRefs.size} HDF proxy UUID(s) referenced in XML but missing from EPC: ${[...danglingRefs].slice(0, 5).join(", ")}${danglingRefs.size > 5 ? "..." : ""}`;
                warnings.push({ phase: "h5scan", message: msg });
                logger.warn(msg);
            }
            timings.h5scan = performance.now() - phaseStart;

            // ── 4. Open H5 file if we have references and a file ──
            phaseStart = performance.now();
            // Map: pathInHdfFile → { shape, typedArrayName }
            const h5DatasetInfo = new Map<
                string,
                { shape: number[]; typedArrayName: string }
            >();
            let h5TotalElements = 0;
            let h5TotalBytes = 0;

            if (h5Refs.length > 0 && h5File) {
                checkTimeout("h5open");
                logger.info("Loading h5wasm...");
                const h5NodeEntry = path.resolve(
                    __dirname, "..", "..", "..", "..", "..",
                    "node_modules", "h5wasm", "dist", "node", "hdf5_hl.js"
                );
                h5wasm = await import(h5NodeEntry);
                await h5wasm.ready;

                // h5wasm uses an emscripten virtual FS - we need to mount the file
                const h5FileName = path.basename(h5File.path);
                // Buffer IS a Uint8Array - pass directly, avoid an extra copy
                const h5Data = fs.readFileSync(h5File.path);
                h5wasm.FS.writeFile(h5FileName, h5Data);
                h5FileHandle = new h5wasm.File(h5FileName, "r");

                // Pre-scan referenced datasets for metadata
                for (const ref of h5Refs) {
                    try {
                        const ds = h5FileHandle.get(ref.pathInHdfFile);
                        if (ds && ds.shape) {
                            const shape = ds.shape as number[];
                            const typedArrayName = h5DtypeToTypedArrayName(ds.dtype as string);
                            h5DatasetInfo.set(ref.pathInHdfFile, { shape, typedArrayName });

                            // #5: Accumulate size totals
                            const elements = shape.reduce((a, b) => a * b, 1);
                            const bytesPerElement = typedArrayName.includes("64") ? 8
                                : typedArrayName.includes("32") ? 4
                                    : typedArrayName.includes("16") ? 2 : 1;
                            h5TotalElements += elements;
                            h5TotalBytes += elements * bytesPerElement;

                            // #10: Warn on potentially mismatched dtype
                            if (typedArrayName === "BigInt64Array" || typedArrayName === "BigUint64Array") {
                                warnings.push({
                                    phase: "h5open",
                                    message: `Dataset '${ref.pathInHdfFile}' uses 64-bit integer dtype - may require special handling`
                                });
                            }
                        }
                    } catch (e) {
                        warnings.push({ phase: "h5open", message: `Could not read H5 dataset metadata at ${ref.pathInHdfFile}: ${e}` });
                        logger.warn(
                            `Could not read H5 dataset metadata at ${ref.pathInHdfFile}: ${e}`
                        );
                    }
                }
                logger.info(
                    `Pre-scanned ${h5DatasetInfo.size} H5 dataset(s): ${h5TotalElements.toLocaleString()} elements, ~${(h5TotalBytes / 1024 / 1024).toFixed(1)} MB to transfer`
                );
            } else if (h5Refs.length > 0 && !h5File) {
                const msg = "XML objects reference HDF5 datasets but no H5 file was uploaded";
                warnings.push({ phase: "h5open", message: msg });
                logger.warn(msg);
            }
            timings.h5open = performance.now() - phaseStart;

            // ── 5. Create ETP session & transaction ──
            phaseStart = performance.now();
            checkTimeout("session");
            logger.info("Creating ETP session...");
            c = await createSession(
                extractToken(request),
                extractDataPartitionId(request),
                undefined,
                transactionId
            );
            if (!c) {
                throw new InternalServerErrorException({
                    description: "Failed to create ETP session"
                });
            }

            // ── 5b. Auto-create dataspace if it doesn't exist ──
            const dataspaceUri = `eml:///dataspace('${params.dataspaceId}')`;
            try {
                const created = await c.findOrCreateDataspace(params.dataspaceId, params.dataspaceId);
                if (created) {
                    logger.info(`Dataspace '${params.dataspaceId}' ensured (findOrCreate)`);
                }
            } catch (dsErr) {
                // Non-fatal — proceed and let the transaction fail if dataspace truly doesn't exist
                logger.warn(`Could not ensure dataspace exists: ${dsErr}`);
            }

            const txId = transactionId
                ? undefined
                : await c.startTransaction(false, [dataspaceUri], "EPC upload");

            logger.info(
                txId
                    ? "Started internal transaction for EPC upload"
                    : "Using caller-provided transaction"
            );
            timings.session = performance.now() - phaseStart;

            // ── 6. Build DataObject records ──
            phaseStart = performance.now();
            const toDataObject = (obj: EpcObject): DataObject => {
                const uri = EtpUri.createObjectUri(
                    params.dataspaceId,
                    obj.domainFamily,
                    obj.domainVersion,
                    obj.dataType,
                    obj.uuid
                ).uri;

                return {
                    resource: {
                        uri,
                        name: obj.title,
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
                    data: Buffer.from(obj.xml, "utf-8"),
                    format: "xml",
                    blobId: null
                };
            };

            // Split: EpcExternalPartReference objects must be stored first so
            // that the ETP server accepts the subsequent PutDataArrays calls.
            const extPartObjects = epcObjects.filter(
                o => o.dataType === "obj_EpcExternalPartReference"
            );
            const remainingObjects = epcObjects.filter(
                o => o.dataType !== "obj_EpcExternalPartReference"
            );

            // Helper: put a list of DataObjects in batches
            const putBatched = async (
                items: DataObject[],
                label: string
            ): Promise<number> => {
                let stored = 0;
                for (let i = 0; i < items.length; i += OBJECT_BATCH_SIZE) {
                    checkTimeout("putObjects");
                    const batch = items.slice(i, i + OBJECT_BATCH_SIZE);
                    logger.info(
                        `Putting ${label} batch ${Math.floor(i / OBJECT_BATCH_SIZE) + 1}/${Math.ceil(items.length / OBJECT_BATCH_SIZE)} (${batch.length} objects)`
                    );
                    const result = await c!.putDataObjects(batch);
                    if (!result) {
                        if (txId) {
                            await c!.rollbackTransaction(txId).catch(() => { });
                        }
                        throw new InternalServerErrorException({
                            description: `PutDataObjects failed at ${label} batch starting from index ${i}`
                        });
                    }
                    stored += batch.length;
                }
                return stored;
            };

            // 6a. PUT EpcExternalPartReference objects first
            let objectsStored = 0;
            if (extPartObjects.length > 0) {
                const n = await putBatched(
                    extPartObjects.map(toDataObject),
                    "EpcExternalPartReference"
                );
                objectsStored += n;
                logger.info(
                    `Stored ${n} EpcExternalPartReference object(s)`
                );
            }
            timings.putObjects = performance.now() - phaseStart;

            // ── 7. PUT array data from H5 file ──
            phaseStart = performance.now();
            let arraysStored = 0;
            let skippedArrays = 0;
            const arrayErrors: string[] = [];

            if (h5FileHandle && h5Refs.length > 0) {
                checkTimeout("putArrays");
                // Deduplicate - multiple objects may reference the same H5 dataset path
                const seen = new Set<string>();

                // Build work items (deduplicated)
                interface ArrayWorkItem {
                    ref: H5Reference;
                    info: { shape: number[]; typedArrayName: string };
                }
                const workItems: ArrayWorkItem[] = [];

                for (const ref of h5Refs) {
                    const dedupeKey = `${ref.externalPartUuid}::${ref.pathInHdfFile}`;
                    if (seen.has(dedupeKey)) continue;
                    seen.add(dedupeKey);

                    const info = h5DatasetInfo.get(ref.pathInHdfFile);
                    if (!info) {
                        warnings.push({ phase: "putArrays", message: `Skipping array ${ref.pathInHdfFile}: no metadata available` });
                        skippedArrays++;
                        continue;
                    }
                    workItems.push({ ref, info });
                }

                // #11: Process arrays with bounded concurrency
                const processArray = async (item: ArrayWorkItem): Promise<boolean> => {
                    const { ref, info } = item;
                    const ds = h5FileHandle.get(ref.pathInHdfFile);
                    if (!ds || !ds.value) {
                        warnings.push({ phase: "putArrays", message: `Skipping array ${ref.pathInHdfFile}: could not read values` });
                        return false;
                    }

                    const values = ds.value;

                    // v2.0.1: container is the EpcExternalPartReference object
                    // v2.2:   container is the parent RESQML object itself
                    let containerUri: string;
                    if (ref.externalPartUuid === ref.objectUuid) {
                        // v2.2 — use the parent object's URI
                        const parentObj = epcObjects.find(o => o.uuid === ref.objectUuid);
                        containerUri = parentObj
                            ? EtpUri.createObjectUri(
                                params.dataspaceId,
                                parentObj.domainFamily,
                                parentObj.domainVersion,
                                parentObj.dataType,
                                parentObj.uuid
                            ).uri
                            : EtpUri.createObjectUri(
                                params.dataspaceId,
                                "eml",
                                "20",
                                "obj_EpcExternalPartReference",
                                ref.externalPartUuid
                            ).uri;
                    } else {
                        // v2.0.1 — container is the EpcExternalPartReference
                        containerUri = EtpUri.createObjectUri(
                            params.dataspaceId,
                            "eml",
                            "20",
                            "obj_EpcExternalPartReference",
                            ref.externalPartUuid
                        ).uri;
                    }

                    const arrayId: IArrayId = {
                        uri: containerUri,
                        pathInResource: ref.pathInHdfFile
                    };

                    // #8: Retry putDataArray once on failure
                    let lastError: unknown;
                    for (let attempt = 0; attempt < 2; attempt++) {
                        try {
                            await c!.putDataArray(arrayId, info.shape, values);
                            return true;
                        } catch (err) {
                            lastError = err;
                            if (attempt === 0) {
                                logger.warn(`putDataArray retry for ${ref.pathInHdfFile}: ${err instanceof Error ? err.message : err}`);
                            }
                        }
                    }
                    const msg = lastError instanceof Error ? lastError.message : String(lastError);
                    arrayErrors.push(`${ref.pathInHdfFile}: ${msg}`);
                    warnings.push({ phase: "putArrays", message: `Failed to store array ${ref.pathInHdfFile} after retry: ${msg}` });
                    return false;
                };

                // Process in batches of ARRAY_CONCURRENCY
                for (let i = 0; i < workItems.length; i += ARRAY_CONCURRENCY) {
                    checkTimeout("putArrays");
                    const batch = workItems.slice(i, i + ARRAY_CONCURRENCY);
                    const results = await Promise.all(batch.map(processArray));
                    for (const ok of results) {
                        if (ok) arraysStored++;
                        else skippedArrays++;
                    }

                    // #3: Check failure threshold - rollback if too many arrays failed
                    const totalProcessed = arraysStored + skippedArrays;
                    if (totalProcessed > 0 && skippedArrays / totalProcessed > ARRAY_FAILURE_THRESHOLD && totalProcessed >= 5) {
                        const msg = `Array failure threshold exceeded: ${skippedArrays}/${totalProcessed} failed (>${(ARRAY_FAILURE_THRESHOLD * 100).toFixed(0)}%)`;
                        logger.error(msg);
                        if (txId) {
                            await c!.rollbackTransaction(txId).catch(() => { });
                        }
                        throw new InternalServerErrorException({
                            description: msg,
                            arrayErrors: arrayErrors.slice(0, 10)
                        });
                    }
                }

                logger.info(
                    `Arrays complete: ${arraysStored} stored, ${skippedArrays} skipped`
                );
            }
            timings.putArrays = performance.now() - phaseStart;

            // 6b. PUT remaining objects (after arrays are in place)
            phaseStart = performance.now();
            if (remainingObjects.length > 0) {
                checkTimeout("putRemainingObjects");
                const n = await putBatched(
                    remainingObjects.map(toDataObject),
                    "objects"
                );
                objectsStored += n;
            }
            timings.putObjects += performance.now() - phaseStart;
            logger.info(`Stored ${objectsStored} object(s) total`);

            // ── 8. Commit transaction ──
            phaseStart = performance.now();
            if (txId) {
                logger.info("Committing transaction...");
                await c.commitTransaction(txId);
                logger.info("Transaction committed");
            }

            if (!transactionId) {
                await c.closeSession();
            }
            timings.commit = performance.now() - phaseStart;

            // ── 9. Auto-ingest to OSDU catalog (optional) ──
            let catalogIngestion: CatalogIngestionResult | undefined;

            const ingestMode = this.parseIngestMode(autoIngest);
            if (ingestMode && !transactionId) {
                phaseStart = performance.now();
                catalogIngestion = await this.performCatalogIngestion(
                    ingestMode,
                    params.dataspaceId,
                    request,
                    registerMissingSchemas === "true" || registerMissingSchemas === "1"
                );
                timings.autoIngest = performance.now() - phaseStart;
            } else if (ingestMode && transactionId) {
                catalogIngestion = {
                    status: "skipped",
                    error: "autoIngest requires internal transaction (omit transactionId)"
                };
            }

            // Build response with timings and warnings
            timings.total = performance.now() - uploadStart;

            const result: Record<string, unknown> = {
                success: true,
                dataspaceId: params.dataspaceId,
                objectsStored,
                arraysStored,
                skippedArrays,
                ...(h5TotalBytes > 0 ? { h5DataSize: { elements: h5TotalElements, bytes: h5TotalBytes } } : {}),
                objects: epcObjects.map(o => ({
                    objectType: `${o.domainFamily}${o.domainVersion}.${o.dataType}`,
                    uuid: o.uuid,
                    title: o.title
                })),
                ...(warnings.length > 0 ? { warnings } : {}),
                timings: Object.fromEntries(
                    Object.entries(timings).map(([k, v]) => [k, Math.round(v)])
                ),
                ...(catalogIngestion ? { catalogIngestion } : {}),
                ...(validationReport ? { validation: validationReport } : {})
            };

            logger.info(
                `EPC upload complete: ${objectsStored} objects, ${arraysStored} arrays, ${skippedArrays} skipped ` +
                `(${(timings.total / 1000).toFixed(1)}s)`
            );

            return result;
        } catch (err) {
            logger.error(`EPC upload failed: ${err}`);
            if (!transactionId) {
                await c?.closeSession();
            }
            // Re-throw NestJS HTTP exceptions as-is
            if (
                err instanceof BadRequestException ||
                err instanceof PayloadTooLargeException ||
                err instanceof InternalServerErrorException
            ) {
                throw err;
            }
            throw httpErrorFromEtpError(err);
        } finally {
            // Close H5 file handle
            try {
                h5FileHandle?.close();
            } catch { /* best effort */ }

            // Clean up temp files
            cleanupFiles(files ?? {});
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Auto-ingest helpers
    // ─────────────────────────────────────────────────────────────────────────

    private parseIngestMode(autoIngest?: string): IngestMode | undefined {
        if (!autoIngest || autoIngest === "false") return undefined;
        if (autoIngest === "true" || autoIngest === "records") return "records";
        if (autoIngest === "workflow") return "workflow";
        return undefined;
    }

    private async performCatalogIngestion(
        mode: IngestMode,
        dataspaceId: string,
        request?: express.Request,
        registerMissing = false
    ): Promise<CatalogIngestionResult> {
        const bearer = extractToken(request);
        const partition = extractDataPartitionId(request);
        const partitionStr = typeof partition === "string" ? partition : "osdu";

        if (!osduUrl || osduUrl === "http://localhost") {
            return {
                status: "skipped",
                mode,
                error: "RDMS_OSDU_URL not configured - cannot push to catalog"
            };
        }

        try {
            // Align stamped kind versions with the live instance using the request
            // token (the startup init runs unauthenticated and can silently no-op).
            await ensureSchemaVersions(osduUrl, bearer, partitionStr);

            logger.info(`[autoIngest] Building manifest for dataspace '${dataspaceId}' (mode=${mode})...`);

            // Create a fresh ETP session for manifest building
            const manifestClient = await createSession(bearer, partition);
            if (!manifestClient) {
                return { status: "failed", mode, error: "Failed to create ETP session for manifest" };
            }

            const jwt = bearer ? (decode(bearer) as JwtPayload) : {};
            const context = new OSDUContext(
                typeof partition === "string" ? partition : "osdu",
                jwt === null || typeof jwt === "string" ? undefined : jwt?.unique_name,
                undefined, // tags
                true,      // createMissingReferences
                false      // includeArrayData - skip for speed
            );
            context.bearer = bearer;

            const collaboration = request?.headers?.["x-collaboration"] as string | undefined;
            if (collaboration) {
                context.collaboration = collaboration;
            }

            const dataspaceUri = `eml:///dataspace('${dataspaceId}')`;
            const manifest = await createManifest(
                manifestClient,
                [dataspaceUri],
                context,
                undefined, // use default type patterns
                1000,
                "canonical"
            );
            await manifestClient.closeSession();

            // Collect all records from manifest
            const records = [
                ...(manifest.Data?.Datasets ?? []),
                ...(manifest.Data?.WorkProductComponents ?? []),
                ...(manifest.Data?.WorkProduct ? [manifest.Data.WorkProduct] : []),
                ...(manifest.MasterData ?? []),
                ...(manifest.ReferenceData ?? [])
            ];

            if (records.length === 0) {
                return { status: "completed", mode, recordCount: 0 };
            }

            // Guard: drop records whose kind has no schema on the target instance
            // (optionally auto-registering first) so one unsupported kind cannot
            // fail the entire atomic batch / workflow.
            const { pushable, unsupportedKinds, registeredSchemas, remappedKinds } =
                await this.partitionBySchema(records, bearer, partitionStr, registerMissing);

            const unsupportedCount = records.length - pushable.length;
            if (unsupportedCount > 0) {
                logger.warn(
                    `[autoIngest] Skipping ${unsupportedCount} record(s) with unregistered kinds: `
                    + `${Object.entries(unsupportedKinds).map(([k, n]) => `${k}×${n}`).join(", ")}`
                );
            }
            if (Object.keys(remappedKinds).length > 0) {
                logger.info(
                    `[autoIngest] Remapped ${Object.keys(remappedKinds).length} unregistered kind(s) to fallbacks: `
                    + `${Object.entries(remappedKinds).map(([k, v]) => `${k}→${v}`).join(", ")}`
                );
            }

            const extra: Partial<CatalogIngestionResult> = {};
            if (Object.keys(unsupportedKinds).length > 0) extra.unsupportedKinds = unsupportedKinds;
            if (registeredSchemas.length > 0) extra.registeredSchemas = registeredSchemas;
            if (Object.keys(remappedKinds).length > 0) extra.remappedKinds = remappedKinds;

            if (pushable.length === 0) {
                return {
                    status: "skipped",
                    mode,
                    recordCount: 0,
                    error: "No records with a registered schema to ingest",
                    ...extra
                };
            }

            logger.info(`[autoIngest] Manifest built: ${pushable.length}/${records.length} record(s) pushable. Pushing via ${mode}...`);

            if (mode === "workflow") {
                const pruned = this.pruneManifest(manifest, new Set(pushable));
                const result = await this.pushViaWorkflow(pruned, bearer, partition);
                return { ...result, ...extra };
            } else {
                const result = await this.pushViaRecords(pushable, bearer, partition);
                return { ...result, ...extra };
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`[autoIngest] Failed: ${msg}`);
            return { status: "failed", mode, error: msg };
        }
    }

    /**
     * Partition manifest records into those whose OSDU `kind` can be ingested on
     * the target Schema Service (pushable) and those that cannot (unsupported).
     *
     * For each unregistered kind, before giving up, it is resolved via
     * {@link resolveKindFallback} (nearest registered version, then a registered
     * generic sibling). When `registerMissing` is set, an unregistered kind is
     * first offered to {@link tryRegisterSchema}. Records whose kind is remapped
     * have their `kind` rewritten in place (and `data.Type` stamped for generic
     * substitutions) so the object is ingested rather than skipped.
     */
    private async partitionBySchema(
        records: unknown[],
        bearer: string | undefined,
        partition: string,
        registerMissing: boolean
    ): Promise<{
        pushable: unknown[];
        unsupportedKinds: Record<string, number>;
        registeredSchemas: string[];
        remappedKinds: Record<string, string>;
    }> {
        const distinctKinds = [...new Set(
            records.map((r: any) => r?.kind).filter((k): k is string => typeof k === "string")
        )];

        type Resolution =
            | { action: "ok" }
            | { action: "remap"; newKind: string; genericType?: string }
            | { action: "unsupported" };
        const resolution = new Map<string, Resolution>();
        const registeredSchemas: string[] = [];
        const remappedKinds: Record<string, string> = {};

        for (const kind of distinctKinds) {
            // 1) exact schema already registered
            if (await isSchemaRegistered(kind, osduUrl, bearer, partition)) {
                resolution.set(kind, { action: "ok" });
                continue;
            }
            // 2) optionally auto-register the exact kind
            if (registerMissing && await this.tryRegisterSchema(kind, bearer, partition)) {
                setSchemaRegistered(kind, true);
                registeredSchemas.push(kind);
                resolution.set(kind, { action: "ok" });
                continue;
            }
            // 3) fall back to a registered kind (nearest version, then generic sibling)
            const fb = await this.resolveKindFallback(kind, bearer, partition);
            if (fb) {
                resolution.set(kind, { action: "remap", newKind: fb.newKind, genericType: fb.genericType });
                remappedKinds[kind] = fb.newKind;
                continue;
            }
            resolution.set(kind, { action: "unsupported" });
        }

        const pushable: unknown[] = [];
        const unsupportedKinds: Record<string, number> = {};
        for (const r of records as any[]) {
            const kind = r?.kind;
            if (typeof kind !== "string") continue;
            const res = resolution.get(kind);
            if (!res || res.action === "unsupported") {
                unsupportedKinds[kind] = (unsupportedKinds[kind] ?? 0) + 1;
                continue;
            }
            if (res.action === "remap") {
                r.kind = res.newKind;
                // Preserve the original type on the generic record so it stays identifiable.
                if (res.genericType && r.data && typeof r.data === "object" && r.data.Type == null) {
                    r.data.Type = res.genericType;
                }
            }
            pushable.push(r);
        }
        return { pushable, unsupportedKinds, registeredSchemas, remappedKinds };
    }

    /**
     * Resolve an unregistered kind to a registered substitute so the record is
     * not dropped. Tries, in order:
     *   1. the nearest registered version of the SAME entityType (same major
     *      first, then highest available) — safe, backward-compatible;
     *   2. a registered generic sibling of the same WPC role (Representation /
     *      Interpretation / Feature / Property) — lossy but keeps the object,
     *      recording the original type in `data.Type` (only when generic fallback
     *      is enabled via RDMS_INGEST_GENERIC_FALLBACK, default on).
     * Returns the substitute kind (and generic short-type, if any), or undefined.
     */
    private async resolveKindFallback(
        kind: string,
        bearer: string | undefined,
        partition: string
    ): Promise<{ newKind: string; genericType?: string } | undefined> {
        const id = parseKindIdentity(kind);
        if (!id) return undefined;

        // 1) nearest registered version of the same entityType
        const versions = await listRegisteredVersions(
            id.entityType, id.authority, id.source, osduUrl, bearer, partition
        );
        if (versions.length > 0) {
            const sameMajor = versions.find((v) => parseInt(v.split(".")[0], 10) === id.schemaVersionMajor);
            const target = sameMajor ?? versions[0];
            const newKind = `${id.authority}:${id.source}:${id.entityType}:${target}`;
            if (newKind !== kind) {
                logger.info(`[autoIngest] Version fallback: '${kind}' → '${newKind}'`);
                return { newKind };
            }
        }

        // 2) generic sibling (opt out via RDMS_INGEST_GENERIC_FALLBACK=false)
        if (!GENERIC_FALLBACK) return undefined;
        for (const genericEntity of genericSiblingsFor(id.entityType)) {
            const gVersions = await listRegisteredVersions(
                genericEntity, id.authority, id.source, osduUrl, bearer, partition
            );
            if (gVersions.length === 0) continue;
            const genericType = id.entityType.split("--").pop();
            const newKind = `${id.authority}:${id.source}:${genericEntity}:${gVersions[0]}`;
            logger.info(`[autoIngest] Generic fallback: '${kind}' → '${newKind}' (Type='${genericType}')`);
            return { newKind, genericType };
        }
        return undefined;
    }

    /**
     * Attempt to register a missing schema on the OSDU Schema Service from a JSON
     * file under `RDMS_SCHEMA_DIR` (named `<entityType>:<version>.json`).
     * Returns true if the schema is (now) registered, false if no source is
     * available or registration failed.
     */
    private async tryRegisterSchema(
        kind: string,
        bearer: string | undefined,
        partition: string
    ): Promise<boolean> {
        const identity = parseKindIdentity(kind);
        if (!identity) return false;

        const schema = await this.loadSchemaJson(kind, identity.entityType,
            `${identity.schemaVersionMajor}.${identity.schemaVersionMinor}.${identity.schemaVersionPatch}`);
        if (!schema) {
            logger.warn(
                `[autoIngest] Cannot auto-register '${kind}': no schema JSON found `
                + `(set RDMS_SCHEMA_DIR and provide '${identity.entityType}:`
                + `${identity.schemaVersionMajor}.${identity.schemaVersionMinor}.${identity.schemaVersionPatch}.json'), `
                + "or register it in the OSDU Schema Service manually."
            );
            return false;
        }

        const body = JSON.stringify({
            schemaInfo: { schemaIdentity: identity, status: "PUBLISHED" },
            schema
        }, bigIntToString);

        try {
            const res = await fetch(`${osduUrl}/api/schema-service/v1/schema`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": `${Buffer.byteLength(body)}`,
                    "Authorization": `Bearer ${bearer}`,
                    "data-partition-id": partition
                },
                body
            });
            if (res.status === 200 || res.status === 201) {
                logger.info(`[autoIngest] Registered schema '${kind}'`);
                return true;
            }
            if (res.status === 409) {
                logger.info(`[autoIngest] Schema '${kind}' already registered`);
                return true;
            }
            const errText = await res.text().catch(() => "unknown");
            logger.warn(`[autoIngest] Schema registration failed for '${kind}' (${res.status}): ${errText}`);
            return false;
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`[autoIngest] Schema registration error for '${kind}': ${msg}`);
            return false;
        }
    }

    /** Load a schema JSON body from RDMS_SCHEMA_DIR, if configured and present. */
    private async loadSchemaJson(
        kind: string,
        entityType: string,
        version: string
    ): Promise<unknown | undefined> {
        if (!SCHEMA_DIR) return undefined;
        const candidates = [
            `${entityType}:${version}.json`,
            `${entityType}.${version}.json`,
            `${kind}.json`
        ];
        for (const name of candidates) {
            try {
                const raw = await readFile(join(SCHEMA_DIR, name), "utf8");
                return JSON.parse(raw);
            } catch { /* try next candidate */ }
        }
        return undefined;
    }

    /** Return a shallow copy of the manifest keeping only the given records. */
    private pruneManifest(manifest: any, keep: Set<unknown>): unknown {
        const pruned = { ...manifest, Data: { ...manifest.Data } };
        if (Array.isArray(pruned.Data?.Datasets)) {
            pruned.Data.Datasets = pruned.Data.Datasets.filter((r: unknown) => keep.has(r));
        }
        if (Array.isArray(pruned.Data?.WorkProductComponents)) {
            pruned.Data.WorkProductComponents = pruned.Data.WorkProductComponents.filter((r: unknown) => keep.has(r));
        }
        if (pruned.Data?.WorkProduct && !keep.has(pruned.Data.WorkProduct)) {
            delete pruned.Data.WorkProduct;
        }
        if (Array.isArray(pruned.MasterData)) {
            pruned.MasterData = pruned.MasterData.filter((r: unknown) => keep.has(r));
        }
        if (Array.isArray(pruned.ReferenceData)) {
            pruned.ReferenceData = pruned.ReferenceData.filter((r: unknown) => keep.has(r));
        }
        return pruned;
    }

    private async pushViaRecords(
        records: unknown[],
        bearer?: string,
        partition?: string | string[]
    ): Promise<CatalogIngestionResult> {
        const partitionStr = typeof partition === "string" ? partition : "osdu";
        let totalPushed = 0;
        const failures: Array<{ id?: string; kind?: string; status: number; error: string }> = [];

        // Deduplicate records by id — Storage API rejects batches with duplicate IDs
        const seenIds = new Set<string>();
        const uniqueRecords = records.filter((r: any) => {
            const id = r?.id;
            if (!id || seenIds.has(id)) return false;
            seenIds.add(id);
            return true;
        });
        if (uniqueRecords.length < records.length) {
            logger.info(`[autoIngest] Deduplicated ${records.length - uniqueRecords.length} duplicate record(s)`);
        }

        for (let i = 0; i < uniqueRecords.length; i += STORAGE_BATCH_SIZE) {
            const batch = uniqueRecords.slice(i, i + STORAGE_BATCH_SIZE);
            const res = await this.putRecords(batch, bearer, partitionStr);
            if (res.ok) {
                const result = await res.json() as { recordCount?: number };
                totalPushed += result?.recordCount ?? batch.length;
                continue;
            }

            // Storage validates a PUT batch atomically: one bad record fails the
            // whole batch. Retry each record individually so the valid ones still
            // land, and capture the offenders for the response.
            const errText = await res.text().catch(() => "unknown");
            logger.warn(
                `[autoIngest] Storage batch ${Math.floor(i / STORAGE_BATCH_SIZE) + 1} failed (${res.status}): `
                + `${errText.slice(0, 300)} - retrying ${batch.length} record(s) individually`
            );
            for (const rec of batch) {
                const single = await this.putRecords([rec], bearer, partitionStr);
                if (single.ok) {
                    totalPushed += 1;
                } else {
                    const et = await single.text().catch(() => "unknown");
                    failures.push({
                        id: (rec as any)?.id,
                        kind: (rec as any)?.kind,
                        status: single.status,
                        error: et.slice(0, 300)
                    });
                }
            }
        }

        if (failures.length > 0) {
            const byKind = failures.reduce<Record<string, number>>((acc, f) => {
                const k = f.kind ?? "unknown";
                acc[k] = (acc[k] ?? 0) + 1;
                return acc;
            }, {});
            logger.warn(
                `[autoIngest] ${failures.length} record(s) rejected by Storage: `
                + `${Object.entries(byKind).map(([k, n]) => `${k}×${n}`).join(", ")}`
            );
        }

        logger.info(`[autoIngest] Pushed ${totalPushed}/${uniqueRecords.length} records via Storage Service`);
        return {
            status: failures.length > 0 ? "partial" : "completed",
            mode: "records",
            recordCount: totalPushed,
            ...(failures.length > 0 ? { failedCount: failures.length, failures: failures.slice(0, 20) } : {})
        };
    }

    /** PUT a batch of records to the OSDU Storage Service. */
    private async putRecords(
        batch: unknown[],
        bearer: string | undefined,
        partition: string
    ): Promise<Response> {
        const body = JSON.stringify(batch, bigIntToString);
        return fetch(`${osduUrl}/api/storage/v2/records`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": `${Buffer.byteLength(body)}`,
                "Authorization": `Bearer ${bearer}`,
                "data-partition-id": partition
            },
            body
        });
    }

    private async pushViaWorkflow(
        manifest: unknown,
        bearer?: string,
        partition?: string | string[]
    ): Promise<CatalogIngestionResult> {
        const partitionStr = typeof partition === "string" ? partition : "osdu";
        const workflowBody = JSON.stringify({
            executionContext: {
                manifest
            }
        }, bigIntToString);

        const res = await fetch(
            `${osduUrl}/api/workflow/v1/workflow/Osdu_ingest/workflowRun`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": `${Buffer.byteLength(workflowBody)}`,
                    "Authorization": `Bearer ${bearer}`,
                    "data-partition-id": partitionStr
                },
                body: workflowBody
            }
        );

        if (!res.ok) {
            const errText = await res.text().catch(() => "unknown");
            return {
                status: "failed",
                mode: "workflow",
                error: `Workflow service returned ${res.status}: ${errText}`
            };
        }

        const result = await res.json() as { runId?: string };
        logger.info(`[autoIngest] Workflow run submitted: ${result?.runId}`);
        return {
            status: "submitted",
            mode: "workflow",
            workflowRunId: result?.runId
        };
    }
}
