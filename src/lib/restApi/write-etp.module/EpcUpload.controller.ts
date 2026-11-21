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
    ArrayByteUuid,
    DataObject,
    DataValue,
    Energistics,
    EtpUri,
    IArrayId,
    ResqmlClient
} from "../../client/ResqmlClient";

import { EtpDataValue } from "../../common/EtpTypes";

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
    transactionIdQueryParam,
    webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import { qualifiedTypeRegex } from "../../common/EtpQualifiedType";

import {
    defaultDataspaceOwners,
    defaultDataspaceViewers,
    defaultDataspaceLegalTags,
    defaultDataspaceDataCountries
} from "../../common/config";
import {
    CatalogIngestionResult,
    parseIngestMode,
    parseCsvPatterns,
    parsePropertyFilter,
    performCatalogIngestion
} from "./catalogIngestion";
import { decode, JwtPayload } from "jsonwebtoken";

import { ValidatorClient } from "../../client/ValidatorClient";
import type { ValidationReport } from "../../client/ValidatorClient";
import { Severity, ValidationCategory } from "../../client/ValidatorClient";

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

/** Max inflated size of a single EPC zip entry (default 500 MB), CWE-409. */
const MAX_EPC_ENTRY_BYTES =
    parseInt(process.env.RDMS_EPC_MAX_ENTRY_SIZE_MB ?? "500", 10) * 1024 * 1024;

/** Max total inflated size across all read EPC zip entries (default 2 GB). */
const MAX_EPC_TOTAL_INFLATED_BYTES =
    parseInt(process.env.RDMS_EPC_MAX_TOTAL_INFLATED_MB ?? "2048", 10) *
    1024 *
    1024;

interface SafeZipEntry {
    entryName: string;
    header?: { size?: number };
    getData(): Buffer;
}

/**
 * Read a zip entry while enforcing per-entry and cumulative inflated-size
 * caps to prevent decompression-bomb attacks (CWE-409). Both the declared
 * header size and the actual inflated length are checked.
 */
function readZipEntrySafely(
    entry: SafeZipEntry,
    counter: { total: number }
): Buffer {
    const declared = entry.header?.size;
    if (typeof declared === "number" && declared > MAX_EPC_ENTRY_BYTES) {
        throw new BadRequestException({
            description: `EPC entry '${entry.entryName}' declares ${declared} bytes, exceeding the ${MAX_EPC_ENTRY_BYTES}-byte limit`
        });
    }
    const data = entry.getData();
    if (data.length > MAX_EPC_ENTRY_BYTES) {
        throw new BadRequestException({
            description: `EPC entry '${entry.entryName}' inflated to ${data.length} bytes, exceeding the ${MAX_EPC_ENTRY_BYTES}-byte limit`
        });
    }
    counter.total += data.length;
    if (counter.total > MAX_EPC_TOTAL_INFLATED_BYTES) {
        throw new BadRequestException({
            description: `EPC total inflated size exceeded the ${MAX_EPC_TOTAL_INFLATED_BYTES}-byte limit`
        });
    }
    return data;
}

/** Max concurrent array uploads (default 5) */
const ARRAY_CONCURRENCY = parseInt(
    process.env.RDMS_ARRAY_CONCURRENCY ?? "5",
    10
);

/** Batch size for putDataObjects calls */
const OBJECT_BATCH_SIZE = 100;

/**
 * Max data objects committed per ETP transaction (default 49).
 *
 * Workaround for an open-etp-server bug: during CommitTransaction the server
 * auto-creates a RESQML 2.0 "import Activity" referencing every object in the
 * transaction, internally chunked into <=49 participants. When a chunk contains
 * a RESQML 2.3 / EML 2.3 object whose CRS / PropertyKind / ActivityTemplate was
 * committed in an *earlier* transaction, the server fails to resolve that
 * cross-transaction reference and writes a null-UUID DOR into the auto-import
 * Activity, surfacing as an "N Missing reference(s)" HTTP 412 at commit (the
 * same path handles 400+ single-transaction RESQML 2.0 objects fine). We work
 * around this by (a) committing in dependency-ordered sub-transactions of
 * <=49 objects and (b) re-including the shared "infrastructure" objects
 * (CRS / PropertyKind / ActivityTemplate) in every sub-transaction so those
 * references always resolve within the current transaction. Re-included objects
 * are idempotent upserts and are de-duplicated by the server's auto-import
 * Activity, so they do not inflate the committed-object count. Set to 0 to
 * disable batching and commit everything in a single transaction.
 */
const COMMIT_BATCH_SIZE = parseInt(
    process.env.RDMS_COMMIT_BATCH_SIZE ?? "49",
    10
);

/**
 * RESQML/EML object type-name fragments (matched against the EPC dataType,
 * e.g. "LocalEngineeringCompoundCrs", "PropertyKind", "ActivityTemplate")
 * whose objects are shared "infrastructure" referenced by many others. These
 * are re-included in every commit sub-transaction so cross-transaction
 * references to them resolve. See COMMIT_BATCH_SIZE.
 */
const INFRA_TYPE_FRAGMENTS = ["Crs", "PropertyKind", "ActivityTemplate"];

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

/**
 * Build the ETP CustomData governance map (owners / viewers / legaltags /
 * otherRelevantDataCountries) applied when auto-creating a NEW dataspace during
 * an EPC upload. Per-request comma-separated query values take precedence over
 * the `RDMS_DEFAULT_*` env fallbacks. Returns an empty Map when nothing is
 * configured, in which case dataspace auto-create behaves exactly as before
 * (no governance stamped).
 */
function buildDataspaceGovernance(overrides: {
    owners?: string;
    viewers?: string;
    legaltags?: string;
    otherRelevantDataCountries?: string;
}): Map<string, DataValue> {
    const customData = new Map<string, DataValue>();
    const csv = (v?: string): string[] | undefined => {
        if (v === undefined) return undefined;
        const list = v.split(",").map(s => s.trim()).filter(s => s.length > 0);
        return list.length > 0 ? list : undefined;
    };
    const entries: [string, string[] | undefined][] = [
        ["owners", csv(overrides.owners) ?? defaultDataspaceOwners],
        ["viewers", csv(overrides.viewers) ?? defaultDataspaceViewers],
        ["legaltags", csv(overrides.legaltags) ?? defaultDataspaceLegalTags],
        [
            "otherRelevantDataCountries",
            csv(overrides.otherRelevantDataCountries) ?? defaultDataspaceDataCountries
        ]
    ];
    for (const [key, value] of entries) {
        if (value && value.length > 0) {
            customData.set(key, EtpDataValue.fromUnknown(value));
        }
    }
    return customData;
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
            "When 'true', runs RESQML validation (XSD, DOR integrity, business rules) on the EPC before ingesting. " +
            "If validation finds errors, the upload still proceeds but the response includes a `validation` report. " +
            "Set to 'strict' to reject the upload (returns 400) - but only on errors that actually block ingestion " +
            "(malformed package, broken references, missing arrays, known store incompatibilities). " +
            "Pure XSD-schema / business-rule pedantries that the ETP store tolerates are reported but do not block.",
        schema: {
            type: "string",
            enum: ["false", "true", "strict"],
            default: "false"
        }
    })
    @ApiQuery({
        name: "typePatterns",
        required: false,
        description:
            "Auto-ingest manifest filter (only used with `autoIngest`). Comma-separated list of type patterns "
            + "(accept `*`/`?` wildcards) restricting NON-property types, consistent with `POST /manifests/build`. "
            + "When omitted, the curated auto-ingest preset is used "
            + "(`*Feature,*Interpretation*,*Representation,*StratigraphicColumn,*Activity*,*Collection,witsml21.*`). "
            + "Pass `*` to include all types. CRS is always included.",
        schema: { type: "string" }
    })
    @ApiQuery({
        name: "propertyFilter",
        required: false,
        description:
            "Auto-ingest property inclusion (only used with `autoIngest`), consistent with `POST /manifests/build`. "
            + "`canonical` (default for auto-ingest): only standard-named properties (PORO/PERMX/SW, PWLS, OSDU). "
            + "`all`: every property. `none`: no properties.",
        schema: { type: "string", enum: ["canonical", "none", "all"], default: "canonical" }
    })
    @ApiQuery({
        name: "excludePatterns",
        required: false,
        description:
            "Auto-ingest hard-exclude type patterns (only used with `autoIngest`). Comma-separated list "
            + "(accept `*`/`?` wildcards) of types to drop even if they would otherwise be included, applied before "
            + "every inclusion rule except CRS. When omitted, defaults to `*Activity,*ActivityTemplate` - Activity "
            + "records reference every property they consumed, which become dangling references (and fail the OSDU "
            + "ingestion workflow) when `propertyFilter=canonical`. Pass an empty value to disable exclusions.",
        schema: { type: "string", default: "*Activity,*ActivityTemplate" }
    })
    @ApiQuery({
        name: "owners",
        required: false,
        description:
            "OSDU ACL owner group(s) stamped into the dataspace governance **only when this upload auto-creates a "
            + "new dataspace** (an existing dataspace is left untouched). Comma-separated. Overrides the `RDMS_DEFAULT_OWNERS` "
            + "env fallback. On OSDU-backed ETP servers a dataspace created without owners/legaltags rejects subsequent "
            + "writes with \"Permission denied\", so supply these when uploading to a brand-new dataspace.",
        schema: { type: "string" }
    })
    @ApiQuery({
        name: "viewers",
        required: false,
        description:
            "OSDU ACL viewer group(s) for a newly auto-created dataspace (see `owners`). Comma-separated. "
            + "Overrides the `RDMS_DEFAULT_VIEWERS` env fallback.",
        schema: { type: "string" }
    })
    @ApiQuery({
        name: "legaltags",
        required: false,
        description:
            "OSDU legal tag(s) for a newly auto-created dataspace (see `owners`). Comma-separated. "
            + "Overrides the `RDMS_DEFAULT_LEGAL_TAGS` env fallback.",
        schema: { type: "string" }
    })
    @ApiQuery({
        name: "otherRelevantDataCountries",
        required: false,
        description:
            "OSDU other-relevant-data-country code(s) (e.g. `US`) for a newly auto-created dataspace (see `owners`). "
            + "Comma-separated. Overrides the `RDMS_DEFAULT_DATA_COUNTRIES` env fallback.",
        schema: { type: "string" }
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
        @Query("typePatterns") typePatterns?: string,
        @Query("propertyFilter") propertyFilter?: string,
        @Query("excludePatterns") excludePatterns?: string,
        @Query("owners") owners?: string,
        @Query("viewers") viewers?: string,
        @Query("legaltags") legaltags?: string,
        @Query("otherRelevantDataCountries") otherRelevantDataCountries?: string,
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
            const inflatedCounter = { total: 0 };

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
            const contentTypes = parseContentTypes(readZipEntrySafely(ctEntry, inflatedCounter).toString("utf-8"));
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

                const xmlStr = readZipEntrySafely(entry, inflatedCounter).toString("utf-8");
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

                // Normalise the domain version to the ETP token derived from the
                // XML *namespace*, not the content-type version string. RESQML 2.2
                // and 2.3 share the resqmlv2 namespace (ETP token "resqml22"), and
                // EML/common 2.2 and 2.3 share the commonv2 namespace (ETP token
                // "eml23"). The open-etp-server keys both object storage and DOR
                // resolution by these namespace tokens, so RESQML 2.3 (an unreleased
                // line here) is masked as 2.2 and EML 2.2/2.3 fold to "eml23".
                const rawVersion = domainVersion.replace(/\./g, "");
                let normalizedVersion = rawVersion;
                if (domainFamily === "resqml" && (rawVersion === "22" || rawVersion === "23")) {
                    normalizedVersion = "22";
                } else if (domainFamily === "eml" && (rawVersion === "22" || rawVersion === "23")) {
                    normalizedVersion = "23";
                }

                // Align the object's own schemaVersion with the canonical version
                // of its ETP token. The server stores each object's version from
                // its schemaVersion attribute and resolves DOR tokens to a fixed
                // canonical version (resqml22→"2.2", eml23→"2.3", …). RESQML 2.3
                // reuses the resqmlv2 (2.2) namespace, so its objects must present
                // schemaVersion="2.2" to match incoming references; otherwise every
                // reference to them resolves as missing.
                const canonicalSchemaVersion: Record<string, string> = {
                    resqml22: "2.2",
                    resqml20: "2.0",
                    eml23: "2.3",
                    eml20: "2.0",
                    witsml21: "2.1",
                    prodml22: "2.2"
                };
                const etpToken = `${domainFamily}${normalizedVersion}`;
                const wantSchemaVersion = canonicalSchemaVersion[etpToken];
                const normalizedXml =
                    wantSchemaVersion !== undefined
                        ? xmlStr.replace(/(\sschemaVersion=")[^"]*(")/, `$1${wantSchemaVersion}$2`)
                        : xmlStr;

                epcObjects.push({
                    uuid,
                    title,
                    xml: normalizedXml,
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
                    // The ETP store tolerates many XSD-schema pedantries
                    // (element ordering, optional-element placement, etc.) that
                    // the strict validator flags as errors. Only reject uploads
                    // on errors that genuinely prevent ingestion so we do not
                    // block EPCs the server would happily accept.
                    const BLOCKING_CATEGORIES = new Set<ValidationCategory>([
                        ValidationCategory.EPC_STRUCTURE,
                        ValidationCategory.DOR_INTEGRITY,
                        ValidationCategory.HDF5_REFERENCE,
                        ValidationCategory.RDDMS_COMPAT
                    ]);
                    const blockingErrors = validationReport.errors.filter(
                        e =>
                            e.severity === Severity.ERROR &&
                            BLOCKING_CATEGORIES.has(e.category)
                    );
                    if (blockingErrors.length > 0) {
                        cleanupFiles(files ?? {});
                        throw new BadRequestException({
                            statusCode: 400,
                            message: `RESQML validation failed: ${blockingErrors.length} blocking error(s)`,
                            error: "Validation Failed",
                            validation: validationReport
                        });
                    }
                    logger.info(
                        `Strict validation found ${validationReport.error_count} error(s) but ` +
                        `none are blocking (XSD/business-rule pedantry the store tolerates); proceeding with ingest.`
                    );
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
            // (skip v2.2 refs where externalPartUuid === objectUuid - no EPR in v2.2)
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

                // h5wasm's node build uses NODERAWFS, so the emscripten FS maps
                // directly onto the real filesystem and relative paths resolve
                // against process.cwd() (read-only in the container). Use the
                // absolute temp path (already under os.tmpdir()) so the write and
                // open target a writable location.
                const h5FileName = h5File.path;
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
                transactionId,
                extractUserInfo(request)
            );
            if (!c) {
                throw new InternalServerErrorException({
                    description: "Failed to create ETP session"
                });
            }

            // ── 5b. Auto-create dataspace if it doesn't exist ──
            const dataspaceUri = `eml:///dataspace('${params.dataspaceId}')`;
            try {
                // Governance (ACL + legal) is stamped into the new dataspace's
                // ETP CustomData ONLY when it does not already exist — an
                // existing dataspace keeps its own governance. Sources (each
                // optional): request query params override the RDMS_DEFAULT_*
                // env fallbacks. On OSDU-backed ETP servers a dataspace created
                // without owners/legaltags rejects the subsequent writes with
                // "Permission denied", so this lets an upload to a brand-new
                // dataspace succeed without a separate create call.
                const govCustomData = buildDataspaceGovernance({
                    owners,
                    viewers,
                    legaltags,
                    otherRelevantDataCountries
                });
                const created = await c.findOrCreateDataspace(
                    params.dataspaceId,
                    params.dataspaceId,
                    govCustomData
                );
                if (created) {
                    logger.info(`Dataspace '${params.dataspaceId}' ensured (findOrCreate)`);
                }
            } catch (dsErr) {
                // Non-fatal - proceed and let the transaction fail if dataspace truly doesn't exist
                logger.warn(`Could not ensure dataspace exists: ${dsErr}`);
            }

            timings.session = performance.now() - phaseStart;

            // ── 6. Build DataObject records & array work items ──
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

            // Build deduplicated array work items. Each item is keyed to the UUID
            // of the object that OWNS (references) the array, `ref.objectUuid`, not
            // to its ETP array container. For v2.0.1 the container is the shared
            // EpcExternalPartReference, which is committed in the first
            // sub-transaction; keying on it would push every array into that
            // batch before its owner object exists and the server would reject
            // the commit with "N Orphan array(s)". Keying on the owner puts each
            // array in the same sub-transaction as the object that binds it.
            // For v2.2/2.3 owner and container are the same object.
            interface ArrayWorkItem {
                ref: H5Reference;
                info: { shape: number[]; typedArrayName: string };
                ownerUuid: string;
            }
            const workItems: ArrayWorkItem[] = [];
            let arraysStored = 0;
            let skippedArrays = 0;
            const arrayErrors: string[] = [];
            if (h5FileHandle && h5Refs.length > 0) {
                const seen = new Set<string>();
                for (const ref of h5Refs) {
                    // Dedupe per owner: a dataset shared by two objects is put
                    // once per owner (idempotent upsert) so each owner's batch
                    // binds it regardless of commit order.
                    const dedupeKey = `${ref.objectUuid}::${ref.externalPartUuid}::${ref.pathInHdfFile}`;
                    if (seen.has(dedupeKey)) continue;
                    seen.add(dedupeKey);

                    const info = h5DatasetInfo.get(ref.pathInHdfFile);
                    if (!info) {
                        warnings.push({ phase: "putArrays", message: `Skipping array ${ref.pathInHdfFile}: no metadata available` });
                        skippedArrays++;
                        continue;
                    }
                    workItems.push({ ref, info, ownerUuid: ref.objectUuid });
                }
            }

            // Store a single array (with one retry). Returns true on success.
            const processArray = async (item: ArrayWorkItem): Promise<boolean> => {
                const { ref, info } = item;
                const ds = h5FileHandle!.get(ref.pathInHdfFile);
                if (!ds || !ds.value) {
                    warnings.push({ phase: "putArrays", message: `Skipping array ${ref.pathInHdfFile}: could not read values` });
                    return false;
                }

                const values = ds.value;

                // v2.0.1: container is the EpcExternalPartReference object
                // v2.2/2.3: container is the parent RESQML object itself
                let containerUri: string;
                if (ref.externalPartUuid === ref.objectUuid) {
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

            // Put objects in ETP-sized batches inside the currently open transaction.
            // On failure the given transaction (if any) is rolled back.
            const putObjectsBatched = async (
                items: DataObject[],
                label: string,
                rollbackTx: ArrayByteUuid | undefined
            ): Promise<number> => {
                let stored = 0;
                for (let i = 0; i < items.length; i += OBJECT_BATCH_SIZE) {
                    checkTimeout("putObjects");
                    const batch = items.slice(i, i + OBJECT_BATCH_SIZE);
                    try {
                        await c!.putDataObjects(batch, { throwOnError: true });
                    } catch (putErr) {
                        if (rollbackTx) {
                            await c!.rollbackTransaction(rollbackTx).catch(() => { });
                        }
                        // Keep the store's reason (invalid object, dangling
                        // reference, locked dataspace, ...) and its status.
                        throw httpErrorFromEtpError(
                            putErr,
                            `EPC upload ${label} batch starting from index ${i}`
                        );
                    }
                    stored += batch.length;
                }
                return stored;
            };

            // Put every array whose owner object is in `ownerUuids`, with
            // bounded concurrency and the same failure-threshold rollback policy.
            const putArraysForOwners = async (
                ownerUuids: Set<string>,
                rollbackTx: ArrayByteUuid | undefined
            ): Promise<void> => {
                if (!h5FileHandle || workItems.length === 0) return;
                const items = workItems.filter(w => ownerUuids.has(w.ownerUuid));
                for (let i = 0; i < items.length; i += ARRAY_CONCURRENCY) {
                    checkTimeout("putArrays");
                    const batch = items.slice(i, i + ARRAY_CONCURRENCY);
                    const results = await Promise.all(batch.map(processArray));
                    for (const ok of results) {
                        if (ok) arraysStored++;
                        else skippedArrays++;
                    }

                    const totalProcessed = arraysStored + skippedArrays;
                    if (totalProcessed > 0 && skippedArrays / totalProcessed > ARRAY_FAILURE_THRESHOLD && totalProcessed >= 5) {
                        const msg = `Array failure threshold exceeded: ${skippedArrays}/${totalProcessed} failed (>${(ARRAY_FAILURE_THRESHOLD * 100).toFixed(0)}%)`;
                        logger.error(msg);
                        if (rollbackTx) {
                            await c!.rollbackTransaction(rollbackTx).catch(() => { });
                        }
                        throw new InternalServerErrorException({
                            description: msg,
                            arrayErrors: arrayErrors.slice(0, 10)
                        });
                    }
                }
            };

            // Dependency-order the objects so that, when they are chunked across
            // sub-transactions, every cross-batch DOR points at an object that was
            // committed in an earlier (or the same) batch. EpcExternalPartReference
            // objects are emitted first (array containers); the rest are ordered by
            // a stable topological sort over their outgoing DOR target UUIDs.
            const orderObjectsForCommit = (
                extParts: EpcObject[],
                rest: EpcObject[]
            ): EpcObject[] => {
                const uuidRe = /<(?:[\w]+:)?U[Uu][Ii][Dd]\b[^>]*>\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*<\/(?:[\w]+:)?U[Uu][Ii][Dd]>/g;
                const lowerToOrig = new Map<string, string>();
                for (const o of rest) lowerToOrig.set(o.uuid.toLowerCase(), o.uuid);

                const adj = new Map<string, string[]>();   // target -> dependents
                const indeg = new Map<string, number>();
                for (const o of rest) { adj.set(o.uuid, []); indeg.set(o.uuid, 0); }

                for (const o of rest) {
                    const targets = new Set<string>();
                    let m: RegExpExecArray | null;
                    uuidRe.lastIndex = 0;
                    while ((m = uuidRe.exec(o.xml)) !== null) {
                        const orig = lowerToOrig.get(m[1].toLowerCase());
                        if (orig && orig !== o.uuid) targets.add(orig);
                    }
                    for (const t of targets) {          // edge t -> o (t before o)
                        adj.get(t)!.push(o.uuid);
                        indeg.set(o.uuid, indeg.get(o.uuid)! + 1);
                    }
                }

                const queue = rest.filter(o => indeg.get(o.uuid) === 0).map(o => o.uuid);
                const orderedUuids: string[] = [];
                for (let qi = 0; qi < queue.length; qi++) {
                    const u = queue[qi];
                    orderedUuids.push(u);
                    for (const v of adj.get(u)!) {
                        indeg.set(v, indeg.get(v)! - 1);
                        if (indeg.get(v) === 0) queue.push(v);
                    }
                }
                if (orderedUuids.length < rest.length) {
                    // dependency cycle - append the remainder in original order
                    const done = new Set(orderedUuids);
                    for (const o of rest) if (!done.has(o.uuid)) orderedUuids.push(o.uuid);
                }
                const restByUuid = new Map(rest.map(o => [o.uuid, o]));
                return [...extParts, ...orderedUuids.map(u => restByUuid.get(u)!)];
            };

            let objectsStored = 0;

            if (transactionId) {
                // ── External (caller-managed) transaction: single flow, no commit ──
                if (extPartObjects.length > 0) {
                    objectsStored += await putObjectsBatched(
                        extPartObjects.map(toDataObject), "EpcExternalPartReference", undefined
                    );
                }
                await putArraysForOwners(new Set(workItems.map(w => w.ownerUuid)), undefined);
                if (remainingObjects.length > 0) {
                    objectsStored += await putObjectsBatched(
                        remainingObjects.map(toDataObject), "objects", undefined
                    );
                }
                logger.info(`Stored ${objectsStored} object(s) total (caller-managed transaction)`);
                timings.putObjects = performance.now() - phaseStart;
                timings.putArrays = 0;
                timings.commit = 0;
            } else {
                // ── Internal transaction: commit in dependency-ordered sub-transactions ──
                // of <= COMMIT_BATCH_SIZE objects each, re-including shared infrastructure
                // objects (CRS / PropertyKind / ActivityTemplate) in every sub-transaction
                // so cross-transaction references to them resolve (open-etp-server
                // auto-import Activity bug - see COMMIT_BATCH_SIZE).
                const ordered = orderObjectsForCommit(extPartObjects, remainingObjects);
                const isInfra = (o: EpcObject) =>
                    INFRA_TYPE_FRAGMENTS.some(f => o.dataType.includes(f));
                const infraObjects = ordered.filter(isInfra);
                const nonInfraObjects = ordered.filter(o => !isInfra(o));

                const batchSize = COMMIT_BATCH_SIZE > 0 ? COMMIT_BATCH_SIZE : ordered.length || 1;
                // Leave room for the re-included infra objects in every chunk. If infra
                // alone would fill (or overflow) a batch, fall back to at least one
                // non-infra object per chunk to guarantee forward progress.
                const perChunkNonInfra = Math.max(1, batchSize - infraObjects.length);
                const chunks: EpcObject[][] = [];
                for (let i = 0; i < nonInfraObjects.length; i += perChunkNonInfra) {
                    chunks.push([...infraObjects, ...nonInfraObjects.slice(i, i + perChunkNonInfra)]);
                }
                if (chunks.length === 0 && infraObjects.length > 0) {
                    chunks.push([...infraObjects]);
                }

                logger.info(
                    `Committing ${ordered.length} object(s) (${infraObjects.length} infra re-included per batch) ` +
                    `in ${chunks.length} transaction(s) of <=${batchSize}`
                );

                timings.putObjects = 0;
                timings.putArrays = 0;
                timings.commit = 0;

                // Distinct committed UUIDs - infra objects are re-put in every chunk but
                // counted once so the reported total matches the EPC object count.
                const committedUuids = new Set<string>();

                for (let ci = 0; ci < chunks.length; ci++) {
                    checkTimeout("commitBatch");
                    const chunk = chunks[ci];
                    const subTx = await c.startTransaction(
                        false, [dataspaceUri], `EPC upload ${ci + 1}/${chunks.length}`
                    );
                    if (!subTx) {
                        throw new InternalServerErrorException({
                            description: `Failed to start transaction for batch ${ci + 1}/${chunks.length}`
                        });
                    }
                    try {
                        let t = performance.now();
                        await putObjectsBatched(
                            chunk.map(toDataObject), `batch ${ci + 1}/${chunks.length}`, subTx
                        );
                        timings.putObjects += performance.now() - t;

                        // Arrays owned by objects committed in this batch. Infra and
                        // EpcExternalPartReference objects own no arrays, so including
                        // them here is a no-op.
                        t = performance.now();
                        await putArraysForOwners(new Set(chunk.map(o => o.uuid)), subTx);
                        timings.putArrays += performance.now() - t;

                        t = performance.now();
                        await c.commitTransaction(subTx);
                        timings.commit += performance.now() - t;
                        for (const o of chunk) committedUuids.add(o.uuid);
                        logger.info(
                            `Committed batch ${ci + 1}/${chunks.length} (${chunk.length} objects)`
                        );
                    } catch (e) {
                        await c.rollbackTransaction(subTx).catch(() => { });
                        throw e;
                    }
                }

                objectsStored += committedUuids.size;

                logger.info(`Arrays complete: ${arraysStored} stored, ${skippedArrays} skipped`);
                logger.info(
                    `Stored ${objectsStored} object(s) total across ${chunks.length} transaction(s)`
                );
            }

            if (!transactionId) {
                await c.closeSession();
            }

            // ── 9. Auto-ingest to OSDU catalog (optional) ──
            let catalogIngestion: CatalogIngestionResult | undefined;

            const ingestMode = parseIngestMode(autoIngest);
            if (ingestMode && !transactionId) {
                phaseStart = performance.now();
                catalogIngestion = await performCatalogIngestion(
                    ingestMode,
                    params.dataspaceId,
                    {
                        bearer: extractToken(request),
                        partition: extractDataPartitionId(request),
                        collaboration: request?.headers?.["x-collaboration"] as string | undefined
                    },
                    registerMissingSchemas === "true" || registerMissingSchemas === "1",
                    {
                        typePatterns: parseCsvPatterns(typePatterns),
                        propertyFilter: parsePropertyFilter(propertyFilter),
                        excludePatterns: parseCsvPatterns(excludePatterns)
                    }
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

}
