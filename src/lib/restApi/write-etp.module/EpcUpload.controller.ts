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
import { decode, JwtPayload } from "jsonwebtoken";

import logging from "../../common/Logging";
const logger = logging.getLogger("EtpClient");

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

/** Batch size for putDataObjects calls */
const OBJECT_BATCH_SIZE = 100;

/** Batch size for pushing records to OSDU Storage Service */
const STORAGE_BATCH_SIZE = 500;

/** Valid values for the autoIngest query parameter */
type IngestMode = "records" | "workflow";

// ---------------------------------------------------------------------------
// Multer disk storage — files go to OS temp dir, cleaned up after ingest
// ---------------------------------------------------------------------------

const uploadStorage = diskStorage({
    destination: (_req, _file, cb) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "epc-upload-"));
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        // Sanitise — keep only alphanumerics, dashes, underscores, dots
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
            // PartName starts with "/" — normalise
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
        } catch { /* best effort — may not be empty */ }
    }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

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
    @ApiOkResponse({
        description: "Ingest result summary",
        schema: {
            type: "object",
            properties: {
                success: { type: "boolean" },
                objectsStored: { type: "integer" },
                arraysStored: { type: "integer" },
                skippedArrays: { type: "integer" },
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
            "Upload a RESQML EPC file (ZIP with XML objects) and an optional HDF5 companion file. " +
            "The endpoint unzips the EPC, parses all XML objects, reads referenced array data " +
            "from the H5 file, and ingests everything into the target dataspace within a transaction. " +
            "If no transactionId is provided, an internal transaction is created and committed automatically. " +
            "If transactionId is provided, the caller is responsible for commit/rollback. " +
            "Set autoIngest to automatically build an OSDU manifest and push to the catalog after ingest.",
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
        @Req() request?: express.Request
    ) {
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

        try {
            // ── 1. Unzip EPC ──
            logger.info("Unzipping EPC file...");
            // Use the built-in Node.js zlib/unzip — EPC is a standard ZIP
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

            // ── 2. Extract XML objects ──
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
                    logger.warn(`Skipping ${partName}: no UUID found in XML`);
                    continue;
                }

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

                // Track EpcExternalPartReference UUIDs — these map to the H5 file
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

            logger.info(
                `Extracted ${epcObjects.length} object(s), ${epcExternalPartUuids.size} external part reference(s)`
            );

            // ── 3. Scan XML for HDF5 dataset references ──
            interface H5Reference {
                pathInHdfFile: string;
                /** UUID of the object that references this dataset */
                objectUuid: string;
                /** UUID of the EpcExternalPartReference (container for the array) */
                externalPartUuid: string;
            }

            const h5Refs: H5Reference[] = [];

            for (const obj of epcObjects) {
                // Skip EpcExternalPartReference objects — they don't contain HDF references
                if (obj.dataType === "obj_EpcExternalPartReference") continue;

                // Find all PathInHdfFile references in this object's XML
                const xmlStr = obj.xml;

                // RESQML 2.0/2.2: PathInHdfFile + HdfProxy/UUID appear as
                // siblings under various container elements (Values,
                // Coordinates, Hdf5Dataset, etc.). We scan for every
                // PathInHdfFile and then look for the nearest HdfProxy UUID.
                const pathRegex =
                    /<(?:[\w]+:)?PathInHdfFile[^>]*>([^<]+)<\/(?:[\w]+:)?PathInHdfFile>/g;
                let pathMatch;
                while ((pathMatch = pathRegex.exec(xmlStr)) !== null) {
                    const pathValue = pathMatch[1];
                    // Search forward from the PathInHdfFile match for the
                    // sibling HdfProxy > UUID.  In both v2.0 and v2.2 the
                    // UUID element lives inside <eml:HdfProxy> or a similar
                    // parent within the same container element.
                    const afterPath = xmlStr.slice(pathMatch.index);
                    const uuidMatch = afterPath.match(
                        /<(?:[\w]+:)?HdfProxy[^>]*>[\s\S]*?<(?:[\w]+:)?UUID[^>]*>([0-9a-fA-F-]{36})<\/(?:[\w]+:)?UUID>/
                    );
                    if (uuidMatch?.[1]) {
                        h5Refs.push({
                            pathInHdfFile: pathValue,
                            objectUuid: obj.uuid,
                            externalPartUuid: uuidMatch[1]
                        });
                    }
                }
            }

            logger.info(`Found ${h5Refs.length} HDF5 dataset reference(s) in XML`);

            // ── 4. Open H5 file if we have references and a file ──
            // Map: pathInHdfFile → { shape, typedArrayName }
            const h5DatasetInfo = new Map<
                string,
                { shape: number[]; typedArrayName: string }
            >();

            if (h5Refs.length > 0 && h5File) {
                logger.info("Loading h5wasm...");
                // h5wasm 0.10+ is ESM-only; the ./node export has no CJS
                // "require" condition.  Import the Node entry point by
                // absolute path so it works from compiled CJS code.
                // __dirname = dist/src/lib/restApi/write-etp.module (5 levels from root)
                const h5NodeEntry = path.resolve(
                    __dirname, "..", "..", "..", "..", "..",
                    "node_modules", "h5wasm", "dist", "node", "hdf5_hl.js"
                );
                h5wasm = await import(h5NodeEntry);
                await h5wasm.ready;

                // h5wasm uses an emscripten virtual FS — we need to mount the file
                const h5FileName = path.basename(h5File.path);
                const h5Data = fs.readFileSync(h5File.path);
                h5wasm.FS.writeFile(h5FileName, new Uint8Array(h5Data));
                h5FileHandle = new h5wasm.File(h5FileName, "r");

                // Pre-scan referenced datasets for metadata
                for (const ref of h5Refs) {
                    try {
                        const ds = h5FileHandle.get(ref.pathInHdfFile);
                        if (ds && ds.shape) {
                            h5DatasetInfo.set(ref.pathInHdfFile, {
                                shape: ds.shape as number[],
                                typedArrayName: h5DtypeToTypedArrayName(ds.dtype as string)
                            });
                        }
                    } catch (e) {
                        logger.warn(
                            `Could not read H5 dataset metadata at ${ref.pathInHdfFile}: ${e}`
                        );
                    }
                }
                logger.info(
                    `Pre-scanned ${h5DatasetInfo.size} H5 dataset(s) for metadata`
                );
            } else if (h5Refs.length > 0 && !h5File) {
                logger.warn(
                    "XML objects reference HDF5 datasets but no H5 file was uploaded"
                );
            }

            // ── 5. Create ETP session & transaction ──
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

            const dataspaceUri = `eml:///dataspace('${params.dataspaceId}')`;
            const txId = transactionId
                ? undefined
                : await c.startTransaction(false, [dataspaceUri], "EPC upload");

            logger.info(
                txId
                    ? "Started internal transaction for EPC upload"
                    : "Using caller-provided transaction"
            );

            // ── 6. Build DataObject records ──
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
            // Then the remaining objects (which reference arrays) are stored
            // after the arrays are in place.
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

            // ── 7. PUT array data from H5 file ──
            let arraysStored = 0;
            let skippedArrays = 0;

            if (h5FileHandle && h5Refs.length > 0) {
                // Deduplicate — multiple objects may reference the same H5 dataset path
                // but with different externalPartUuids. Group by externalPartUuid + path.
                const seen = new Set<string>();

                for (const ref of h5Refs) {
                    const dedupeKey = `${ref.externalPartUuid}::${ref.pathInHdfFile}`;
                    if (seen.has(dedupeKey)) continue;
                    seen.add(dedupeKey);

                    const info = h5DatasetInfo.get(ref.pathInHdfFile);
                    if (!info) {
                        logger.warn(
                            `Skipping array ${ref.pathInHdfFile}: no metadata available`
                        );
                        skippedArrays++;
                        continue;
                    }

                    try {
                        // Read dataset values — h5wasm returns a typed array
                        const ds = h5FileHandle.get(ref.pathInHdfFile);
                        if (!ds || !ds.value) {
                            logger.warn(
                                `Skipping array ${ref.pathInHdfFile}: could not read values`
                            );
                            skippedArrays++;
                            continue;
                        }

                        const values = ds.value;

                        // Build the ETP array ID using the EpcExternalPartReference as container
                        const containerUri = EtpUri.createObjectUri(
                            params.dataspaceId,
                            "eml",
                            "20",
                            "obj_EpcExternalPartReference",
                            ref.externalPartUuid
                        ).uri;

                        const arrayId: IArrayId = {
                            uri: containerUri,
                            pathInResource: ref.pathInHdfFile
                        };

                        await c.putDataArray(arrayId, info.shape, values);
                        arraysStored++;

                        logger.info(
                            `Stored array ${ref.pathInHdfFile} (${info.shape.join("×")}) ` +
                            `for object ${ref.objectUuid}`
                        );
                    } catch (arrErr: unknown) {
                        const msg =
                            arrErr instanceof Error ? arrErr.message : String(arrErr);
                        logger.warn(
                            `Failed to store array ${ref.pathInHdfFile} for ${ref.objectUuid}: ${msg}`
                        );
                        skippedArrays++;
                    }
                }
            }

            // 6b. PUT remaining objects (after arrays are in place)
            if (remainingObjects.length > 0) {
                const n = await putBatched(
                    remainingObjects.map(toDataObject),
                    "objects"
                );
                objectsStored += n;
            }
            logger.info(`Stored ${objectsStored} object(s) total`);

            // ── 8. Commit transaction ──
            if (txId) {
                logger.info("Committing transaction...");
                await c.commitTransaction(txId);
                logger.info("Transaction committed");
            }

            if (!transactionId) {
                await c.closeSession();
            }

            // ── 9. Auto-ingest to OSDU catalog (optional) ──
            let catalogIngestion: {
                status: string;
                mode?: string;
                recordCount?: number;
                workflowRunId?: string;
                error?: string;
            } | undefined;

            const ingestMode = this.parseIngestMode(autoIngest);
            if (ingestMode && !transactionId) {
                catalogIngestion = await this.performCatalogIngestion(
                    ingestMode,
                    params.dataspaceId,
                    request
                );
            } else if (ingestMode && transactionId) {
                // Cannot auto-ingest when using external transaction — data may not be committed yet
                catalogIngestion = {
                    status: "skipped",
                    error: "autoIngest requires internal transaction (omit transactionId)"
                };
            }

            const result: Record<string, unknown> = {
                success: true,
                objectsStored,
                arraysStored,
                skippedArrays,
                objects: epcObjects.map(o => ({
                    objectType: `${o.domainFamily}${o.domainVersion}.${o.dataType}`,
                    uuid: o.uuid,
                    title: o.title
                })),
                ...(catalogIngestion ? { catalogIngestion } : {})
            };

            logger.info(
                `EPC upload complete: ${objectsStored} objects, ${arraysStored} arrays, ${skippedArrays} skipped`
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
        request?: express.Request
    ): Promise<{
        status: string;
        mode?: string;
        recordCount?: number;
        workflowRunId?: string;
        error?: string;
    }> {
        const bearer = extractToken(request);
        const partition = extractDataPartitionId(request);

        if (!osduUrl || osduUrl === "http://localhost") {
            return {
                status: "skipped",
                mode,
                error: "RDMS_OSDU_URL not configured — cannot push to catalog"
            };
        }

        try {
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
                false      // includeArrayData — skip for speed
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

            logger.info(`[autoIngest] Manifest built: ${records.length} record(s). Pushing via ${mode}...`);

            if (mode === "workflow") {
                return await this.pushViaWorkflow(manifest, bearer, partition);
            } else {
                return await this.pushViaRecords(records, bearer, partition);
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`[autoIngest] Failed: ${msg}`);
            return { status: "failed", mode, error: msg };
        }
    }

    private async pushViaRecords(
        records: unknown[],
        bearer?: string,
        partition?: string | string[]
    ): Promise<{ status: string; mode: string; recordCount?: number; error?: string }> {
        const partitionStr = typeof partition === "string" ? partition : "osdu";
        let totalPushed = 0;

        for (let i = 0; i < records.length; i += STORAGE_BATCH_SIZE) {
            const batch = records.slice(i, i + STORAGE_BATCH_SIZE);
            const body = JSON.stringify(batch, bigIntToString);
            const res = await fetch(`${osduUrl}/api/storage/v2/records`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": `${Buffer.byteLength(body)}`,
                    "Authorization": `Bearer ${bearer}`,
                    "data-partition-id": partitionStr
                },
                body
            });
            if (res.ok) {
                const result = await res.json() as { recordCount?: number };
                totalPushed += result?.recordCount ?? batch.length;
            } else {
                const errText = await res.text().catch(() => "unknown");
                logger.warn(
                    `[autoIngest] Storage batch ${Math.floor(i / STORAGE_BATCH_SIZE) + 1} failed (${res.status}): ${errText}`
                );
            }
        }

        logger.info(`[autoIngest] Pushed ${totalPushed}/${records.length} records via Storage Service`);
        return { status: "completed", mode: "records", recordCount: totalPushed };
    }

    private async pushViaWorkflow(
        manifest: unknown,
        bearer?: string,
        partition?: string | string[]
    ): Promise<{ status: string; mode: string; workflowRunId?: string; error?: string }> {
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
