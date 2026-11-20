// ============================================================================
// Copyright 2024-2026 Equinor ASA. All rights reserved.
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
  HttpCode,
  Post,
  Put,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";

import {
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
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse
} from "@nestjs/swagger";

import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  Matches,
  MaxLength
} from "class-validator";

import express from "express";

import {
  DataObject,
  Energistics,
  EtpUri,
  IArrayId,
  ResqmlClient,
  byteToString
} from "../../client/ResqmlClient";

import {
  FindInDataSpaceParams,
  HasBearerGuard,
  HasDataPartitionGuard,
  createSession,
  dataspaceNamePattern,
  errorMessageSchema,
  extractDataPartitionId,
  extractToken,
  extractUserInfo,
  httpErrorFromEtpError,
  patternString,
  requireProtocol,
  sliceArray,
  swaggerServers,
  partitionPattern,
  transactionIdQueryParam,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import { XMLBuilder } from "../../mlTypes/Json2Xml";
import { bigIntToString } from "../../mlTypes/XmlJsonUtil";

import {
  ChannelArray,
  arrayPathFor,
  extractChannelArrays,
  extractTrajectoryArrays,
  injectExternalArrayRefs
} from "../shared/channelArrays";
import { ErrorCode, EtpError } from "../../common/EtpTypes";
import { mapLimit, concurrency } from "../../common/Util";

import { createHash } from "crypto";

import logging from "../../common/Logging";
const logger = logging.getLogger("EtpClient");

// ─── DTOs ────────────────────────────────────────────────────────────────────

class WitsmlArrayDto {
  @ApiProperty({
    description:
      "Channel/curve mnemonic this array belongs to. Must match a `<Channel>`/`<Index>` " +
      "mnemonic in the accompanying metadata XML. The array is stored at " +
      "`/WITSML/<containerUuid>/<mnemonic>`.",
    example: "T2_DIST"
  })
  @IsString()
  @IsNotEmpty()
  mnemonic!: string;

  @ApiProperty({
    description:
      "Array shape. `[rows]` for a scalar curve, `[rows, width, ...]` for an N-D channel " +
      "(e.g. an NMR distribution `[1385, 30]`). Row-major (C) order.",
    type: [Number],
    example: [1385, 30]
  })
  @IsArray()
  @IsNumber({}, { each: true })
  dimensions!: number[];

  @ApiPropertyOptional({
    description:
      "Array values as a flat JSON number array in row-major order (length = product of " +
      "`dimensions`). `null` entries are stored as NaN. Provide either `data` or `base64`.",
    type: [Number]
  })
  @IsOptional()
  @IsArray()
  data?: (number | null)[];

  @ApiPropertyOptional({
    description:
      "Array values as base64-encoded little-endian bytes of the declared `arrayType` " +
      "(avoids JSON number-array inflation for large arrays). Provide either `data` or `base64`.",
    example: "AAAAAAAA8D8="
  })
  @IsOptional()
  @IsString()
  base64?: string;

  @ApiPropertyOptional({
    description:
      "Element type of the array. Only `Float64Array` (the default) is supported for the " +
      "binary/base64 path today.",
    example: "Float64Array",
    default: "Float64Array"
  })
  @IsOptional()
  @IsString()
  arrayType?: string;

  @ApiPropertyOptional({
    description:
      "UUID of the container object (ChannelSet/Log) this array belongs to. Optional when the " +
      "payload stores exactly one object — then that object's UUID is used.",
    example: "f8158c5d-1265-429b-89ce-ea60bee1274c"
  })
  @IsOptional()
  @IsString()
  containerUuid?: string;
}

class WitsmlStoreDto {
  @ApiProperty({
    description: "Target dataspace path",
    example: "demo/drogon",
    pattern: patternString(dataspaceNamePattern)
  })
  @IsString()
  @IsNotEmpty()
  @Matches(dataspaceNamePattern)
  @MaxLength(256)
  dataspace!: string;

  @ApiPropertyOptional({
    description: "WITSML 2.1 or EnergyML Common v2 XML document(s) to store. Provide either `xml` or `json`.",
    example: `<Well xmlns="http://www.energistics.org/energyml/data/witsmlv2">...</Well>`
  })
  @IsOptional()
  @IsString()
  xml?: string;

  @ApiPropertyOptional({
    description:
      "Array of Energistics/WITSML objects in JSON form (each with `$type` and `Uuid`). " +
      "Alternative to `xml`; converted to Energistics XML server-side before storing.",
    type: [Object]
  })
  @IsOptional()
  @IsArray()
  json?: Record<string, unknown>[];

  @ApiPropertyOptional({
    description:
      "Pre-computed binary channel arrays to store alongside **metadata-only** XML, all in one " +
      "transaction. This is the efficient, lossless path for large N-D data (e.g. NMR " +
      "distributions, resistivity cubes): send a `ChannelSet` whose `<Channel>`/`<Index>` carry " +
      "no inline `<Data>`, plus one `arrays` entry per mnemonic. The handler injects the required " +
      "`ExternalDataArrayPart` references, stores the object, writes the arrays, and commits " +
      "together — so neither 'Orphan array(s)' nor 'Missing array(s)' can occur. Shapes are " +
      "preserved exactly (an N-D `dimensions` round-trips unchanged).",
    type: [WitsmlArrayDto]
  })
  @IsOptional()
  @IsArray()
  arrays?: WitsmlArrayDto[];
}

class WitsmlQueryDto {
  @ApiProperty({
    description: "Target dataspace path (e.g., 'demo/drogon'). Must be an existing dataspace on the ETP server.",
    example: "demo/drogon"
  })
  @IsString()
  @IsNotEmpty()
  @Matches(dataspaceNamePattern)
  @MaxLength(256)
  dataspace!: string;

  @ApiPropertyOptional({
    description: "Filter by a single ETP object type name (case-insensitive). Common values: Well, Wellbore, WellLog, Trajectory, ChannelSet, WellboreGeology",
    example: "Well"
  })
  @IsOptional()
  @IsString()
  objectType?: string;

  @ApiPropertyOptional({
    description: "Filter by several object type names at once (case-insensitive). Combined with `objectType` if both are given.",
    type: [String],
    example: ["Well", "Wellbore"]
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  objectTypes?: string[];

  @ApiPropertyOptional({
    description: "Case-insensitive substring filter on the object title/name.",
    example: "55/33-1"
  })
  @IsOptional()
  @IsString()
  titleContains?: string;

  @ApiPropertyOptional({
    description: "Return only objects whose UUID is in this list.",
    type: [String]
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  uuids?: string[];

  @ApiPropertyOptional({
    description: "ISO 8601 timestamp - only return objects changed at or after this time (incremental sync).",
    example: "2026-01-01T00:00:00.000Z"
  })
  @IsOptional()
  @IsString()
  modifiedSince?: string;

  @ApiPropertyOptional({
    description:
      "Traverse relationships from a given object instead of listing the whole dataspace. " +
      "Accepts a bare UUID (resolved within the dataspace) or a full ETP object URI. " +
      "Use with `scope` to pick direction (e.g. all Wellbores/Logs under a Well).",
    example: "2b8f1c5e-9d34-4a7e-b016-7c3e5f0a9d21"
  })
  @IsOptional()
  @IsString()
  relatedTo?: string;

  @ApiPropertyOptional({
    description: "Relationship direction when `relatedTo` is set.",
    enum: ["self", "sources", "targets", "sourcesOrSelf", "targetsOrSelf"],
    default: "targets"
  })
  @IsOptional()
  @IsString()
  scope?: string;

  @ApiPropertyOptional({
    description: "Number of results to skip (pagination).",
    example: 0
  })
  @IsOptional()
  @IsNumber()
  skip?: number;

  @ApiPropertyOptional({
    description: "Maximum number of results to return (pagination).",
    example: 100
  })
  @IsOptional()
  @IsNumber()
  top?: number;

  @ApiPropertyOptional({
    description: "Return format for object content: `xml` (raw Energistics XML, default) or `json` (parsed object).",
    enum: ["xml", "json"],
    default: "xml"
  })
  @IsOptional()
  @IsString()
  format?: string;
}

/** Map a scope string to an ETP ContextScopeKind (defaults to targets). */
function witsmlScopeKind(
  scope?: string
): Energistics.Etp.v12.Datatypes.Object.ContextScopeKind {
  const Kind = Energistics.Etp.v12.Datatypes.Object.ContextScopeKind;
  switch (scope) {
    case "self":
      return Kind.self;
    case "sources":
      return Kind.sources;
    case "sourcesOrSelf":
      return Kind.sourcesOrSelf;
    case "targetsOrSelf":
      return Kind.targetsOrSelf;
    default:
      return Kind.targets;
  }
}

/** Convert an ETP micro/epoch timestamp to ISO string, or null. */
function microsToIso(lastChanged: unknown): string | null {
  if (!lastChanged) {
    return null;
  }
  try {
    return new Date(
      Number(BigInt(lastChanged as string | number | bigint) / BigInt(1000))
    ).toISOString();
  } catch {
    return null;
  }
}

// ─── WITSML XML Parser Utilities ─────────────────────────────────────────────

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Upper bound on XML size fed to the backtracking strip regexes below to
 * bound worst-case ReDoS cost (CWE-1333). Default 5 MB.
 */
const MAX_WITSML_REGEX_INPUT = Number(
  process.env.RDMS_MAX_WITSML_REGEX_INPUT ?? 5 * 1024 * 1024
);

interface ParsedWitsmlObject {
  objectType: string;
  uuid: string;
  xml: string;
  title: string;
}

/**
 * Parse WITSML 2.1 / EnergyML Common v2 XML into individual data objects.
 * Supports single root elements, plural container wrappers (1.4.1/1.3.1),
 * and auto-generates UUIDs from uid attributes when no uuid is present.
 */
function parseWitsmlXml(xmlInput: string): ParsedWitsmlObject[] {
  const objects: ParsedWitsmlObject[] = [];

  // Detect WITSML 1.4.1 / 1.3.1 container elements (plural wrappers)
  const containerMatch = xmlInput.match(
    /<(wells|logs|trajectorys|wellbores|rigs|tubulars|mudLogs|bhaRuns|cementJobs|messages)\b[^>]*>/i
  );

  if (containerMatch) {
    // Split container into individual child elements
    const containerTag = containerMatch[1].toLowerCase();
    const childTag = containerTag.replace(/s$/, "").replace(/ys$/, "y");

    // Map 1.4.1 element names to WITSML 2.1 objectType
    const typeMap: Record<string, string> = {
      well: "Well",
      log: "Log",
      trajectory: "Trajectory",
      wellbore: "Wellbore",
      rig: "Rig",
      tubular: "Tubular",
      mudlog: "MudLogReport",
      bharun: "BhaRun",
      cementjob: "CementJob",
      message: "Message"
    };

    // Extract child elements using regex
    const childRegex = new RegExp(
      `<${childTag}\\b[^>]*>([\\s\\S]*?)<\\/${childTag}>`,
      "gi"
    );
    let childMatch: RegExpExecArray | null;

    while ((childMatch = childRegex.exec(xmlInput)) !== null) {
      const childXml = childMatch[0];
      const childContent = childMatch[1];

      // Extract uid attribute
      const uidMatch = childXml.match(/\buid\s*=\s*"([^"]+)"/);
      const uid = uidMatch?.[1] ?? `auto-${objects.length}`;

      // Generate deterministic UUID from uid using uuid5-like hash
      const uuid = uidToUuid(uid);

      // Extract name/title
      const nameMatch = childContent.match(
        /<(?:[\w]+:)?name>([^<]+)<\/(?:[\w]+:)?name>/i
      );
      const title =
        nameMatch?.[1] ??
        childContent.match(/<(?:[\w]+:)?Title>([^<]+)<\//)?.[1] ??
        uid;

      const objectType = typeMap[childTag.toLowerCase()] ?? capitalize(childTag);

      // Wrap in WITSML 2.1 format with proper namespaces for ETP server
      const wrappedXml = wrapAs21(objectType, uuid, title, childXml, xmlInput);

      objects.push({ objectType, uuid, xml: wrappedXml, title });
    }

    if (objects.length > 0) return objects;
  }

  // Single WITSML 2.1 / EML object (existing path)
  const uuidAttrMatch = xmlInput.match(/\buuid\s*=\s*"([^"]+)"/);
  const uuidElemMatch = xmlInput.match(/<(?:[\w]+:)?Uuid>([^<]+)<\//);
  // Also support uid for single elements
  const uidFallback = xmlInput.match(/\buid\s*=\s*"([^"]+)"/);
  const uuid =
    uuidAttrMatch?.[1] ??
    uuidElemMatch?.[1] ??
    (uidFallback ? uidToUuid(uidFallback[1]) : undefined);

  if (!uuid) {
    throw new BadRequestException(
      "WITSML object must have a uuid attribute, <Uuid> element, or uid attribute"
    );
  }

  if (!UUID_REGEX.test(uuid)) {
    throw new BadRequestException(
      `Invalid UUID "${uuid}" - ETP requires standard UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)`
    );
  }

  // Determine object type from root element (strip namespace prefix, skip XML decl)
  const typeMatch = xmlInput.match(
    /<(?:[\w]+:)?([A-Z]\w*)[\s>]/
  );
  const objectType = typeMatch?.[1] ?? "Unknown";

  const titleMatch = xmlInput.match(
    /<(?:[\w]+:)?Title>([^<]*)<\/(?:[\w]+:)?Title>/
  );
  const title = titleMatch?.[1] ?? uuid;

  // Ensure XML has required namespaces
  let xml = xmlInput;
  if (!xml.includes('xmlns:eml=') && !xml.includes('energyml/data/commonv2')) {
    // Inject xmlns:eml into root element for ETP server compatibility
    xml = xml.replace(
      /(<[\w:]+)(\s)/,
      `$1 xmlns:eml="http://www.energistics.org/energyml/data/commonv2"$2`
    );
  }
  // Prefix-agnostic Citation detection: accepts <Citation>, <eml:Citation>,
  // <eml23:Citation ...> etc. Injecting a second Citation when one already
  // exists under another prefix produces XML the ETP server cannot parse.
  if (!/<(?:[\w]+:)?Citation[\s>]/.test(xml)) {
    // Inject minimal Citation if missing. It uses the eml prefix, so make sure
    // that prefix is declared on the root element first.
    if (!xml.includes('xmlns:eml=')) {
      xml = xml.replace(
        /(<[\w:]+)(\s)/,
        `$1 xmlns:eml="http://www.energistics.org/energyml/data/commonv2"$2`
      );
    }
    const insertPoint = xml.match(/<[\w:]+[^>]*>/);
    if (insertPoint && insertPoint.index != null) {
      const after = insertPoint.index + insertPoint[0].length;
      const citation =
        `<eml:Citation><eml:Title>${escapeXml(title)}</eml:Title>` +
        `<eml:Originator>rddms</eml:Originator>` +
        `<eml:Creation>${new Date().toISOString()}</eml:Creation>` +
        `<eml:Format>RDDMS WITSML Store</eml:Format></eml:Citation>`;
      xml = xml.slice(0, after) + citation + xml.slice(after);
    }
  }
  // Ensure uuid attribute is on root element
  if (!xml.match(/\buuid\s*=\s*"/)) {
    xml = xml.replace(/(<[\w:]+)/, `$1 uuid="${uuid}"`);
  }

  objects.push({ objectType, uuid, xml, title });
  return objects;
}

/** Generate a deterministic UUID v5-like hash from a uid string. */
function uidToUuid(uid: string): string {
  const hash = createHash("sha1")
    .update("6ba7b810-9dad-11d1-80b4-00c04fd430c8") // UUID namespace URL
    .update(uid)
    .digest("hex");
  // Format as UUID v5: set version nibble to 5, variant bits to 10xx
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "5" + hash.slice(13, 16),
    ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32)
  ].join("-");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Wrap a WITSML 1.4.1 child element in WITSML 2.1 format for ETP storage. */
function wrapAs21(
  objectType: string,
  uuid: string,
  title: string,
  originalChildXml: string,
  containerXml: string
): string {
  // Detect version from container namespace
  const isWitsml21 = containerXml.includes("energistics.org/energyml/data/witsmlv2");
  if (isWitsml21) {
    // Already 2.1 format - just ensure uuid attribute
    let xml = originalChildXml;
    if (!xml.match(/\buuid\s*=\s*"/)) {
      xml = xml.replace(/(<[\w:]+)/, `$1 uuid="${uuid}"`);
    }
    return xml;
  }

  // Build WITSML 2.1 wrapper
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<${objectType} xmlns="http://www.energistics.org/energyml/data/witsmlv2" ` +
    `xmlns:eml="http://www.energistics.org/energyml/data/commonv2" ` +
    `schemaVersion="2.1" uuid="${uuid}">` +
    `<eml:Citation>` +
    `<eml:Title>${escapeXml(title)}</eml:Title>` +
    `<eml:Originator>rddms</eml:Originator>` +
    `<eml:Creation>${new Date().toISOString()}</eml:Creation>` +
    `<eml:Format>RDDMS WITSML Store</eml:Format>` +
    `</eml:Citation>` +
    originalChildXml +
    `</${objectType}>`
  );
}

/**
 * Determine the ETP domain family and version from the XML namespaces.
 */
function detectDomainInfo(xml: string): {
  domainFamily: string;
  domainVersion: string;
} {
  if (xml.includes("energistics.org/energyml/data/witsmlv2")) {
    return { domainFamily: "witsml", domainVersion: "2.1" };
  }
  if (xml.includes("energistics.org/energyml/data/resqmlv2")) {
    return { domainFamily: "resqml", domainVersion: "2.0.1" };
  }
  if (xml.includes("energistics.org/energyml/data/prodmlv2")) {
    return { domainFamily: "prodml", domainVersion: "2.2" };
  }
  // Default to EML Common
  return { domainFamily: "eml", domainVersion: "2.3" };
}

/** Decode base64 little-endian float64 bytes into a Float64Array. */
function decodeFloat64Base64(b64: string): Float64Array {
  const buf = Buffer.from(b64, "base64");
  if (buf.length % 8 !== 0) {
    throw new BadRequestException(
      `base64 array length ${buf.length} is not a multiple of 8 (Float64Array)`
    );
  }
  const out = new Float64Array(buf.length / 8);
  for (let i = 0; i < out.length; i++) out[i] = buf.readDoubleLE(i * 8);
  return out;
}

/**
 * Convert a caller-supplied binary array DTO into the internal ChannelArray
 * shape, validating element type, dimensions, and value count.
 */
function witsmlArrayDtoToChannelArray(a: WitsmlArrayDto): ChannelArray {
  const arrayType = a.arrayType ?? "Float64Array";
  if (arrayType !== "Float64Array") {
    throw new BadRequestException(
      `arrays[] '${a.mnemonic}': unsupported arrayType '${arrayType}' (only Float64Array is supported)`
    );
  }
  if (
    !Array.isArray(a.dimensions) ||
    a.dimensions.length === 0 ||
    a.dimensions.some(d => !Number.isInteger(d) || d < 1)
  ) {
    throw new BadRequestException(
      `arrays[] '${a.mnemonic}': invalid dimensions ${JSON.stringify(a.dimensions)} (each must be an integer >= 1)`
    );
  }
  let values: Float64Array;
  if (a.base64 != null) {
    values = decodeFloat64Base64(a.base64);
  } else if (a.data != null) {
    values = Float64Array.from(a.data, v => (v == null ? NaN : v));
  } else {
    throw new BadRequestException(
      `arrays[] '${a.mnemonic}': must provide 'data' (JSON numbers) or 'base64'`
    );
  }
  const expected = a.dimensions.reduce((p, d) => p * d, 1);
  if (values.length !== expected) {
    throw new BadRequestException(
      `arrays[] '${a.mnemonic}': ${values.length} value(s) != product(dimensions)=${expected}`
    );
  }
  return { mnemonic: a.mnemonic, values, dimensions: a.dimensions };
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags("Well")
@Controller("witsml")
@ApiBearerAuth("HTTPBearer")
@UseGuards(HasBearerGuard("jwt"))
@ApiHeader({
  name: "data-partition-id",
  description: "Data partition id (ex. 'osdu')",
  required: true,
  schema: { type: "string", example: "osdu", pattern: patternString(partitionPattern) }
})
@UseGuards(HasDataPartitionGuard())
@ApiUnauthorizedResponse(errorMessageSchema("Unauthorized", 401))
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many requests", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema("Unknown Error", 500))
@ApiDefaultResponse(errorMessageSchema("Unknown Error", 500))
export default class WitsmlController {
  /**
   * Store WITSML 2.1 XML objects via ETP PutDataObjects.
   *
   * If transactionId is provided, uses the existing transactional session
   * (caller is responsible for commit/rollback - mirrors ObjectWrite pattern).
   * If transactionId is NOT provided, creates an internal transaction for
   * convenience (start → put → commit in a single request).
   */
  @Put("store")
  @HttpCode(200)
  @ApiOperation({
    summary: "Store WITSML 2.1 objects (XML or JSON)",
    description:
      "Store WITSML 2.1 (or 1.4.1 container) objects as ETP data objects. Provide the payload as `xml` or as a `json` array of Energistics objects (each with `$type` and `Uuid`). " +
      "If no transactionId is provided, automatically wraps the write in a transaction (start → put → commit).\n\n" +
      "**Key features**:\n" +
      "- **XML or JSON input**: Send raw WITSML/EnergyML XML in `xml`, or an array of parsed objects in `json` (converted to XML server-side)\n" +
      "- **WITSML 1.4.1 support**: Detects plural container wrappers (`<wells>`, `<logs>`, etc.) and splits into individual WITSML 2.1 objects with deterministic UUID v5 from uid\n" +
      "- **Channel data extraction**: Automatically extracts `<logData><data>` rows (1.4.1) or ChannelSet data (2.1) as separate ETP data arrays\n" +
      "- **Trajectory support**: Extracts MD/Inclination/Azimuth from `<trajectoryStation>` elements as arrays\n" +
      "- **Auto-transaction**: If no `transactionId` is provided, the write is wrapped in an internal transaction. If provided, the caller manages commit/rollback.",
    servers: swaggerServers
  })
  @ApiBody({ type: WitsmlStoreDto })
  @ApiOkResponse({
    description: "Objects stored successfully",
    schema: {
      type: "object",
      properties: {
        success: { type: "boolean", example: true },
        stored: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objectType: { type: "string", example: "Well" },
              uuid: { type: "string", example: "2b8f1c5e-9d34-4a7e-b016-7c3e5f0a9d21" },
              title: { type: "string", example: "55/33-1" }
            }
          }
        },
        arraysStored: { type: "integer", description: "Number of channel/trajectory data arrays extracted and stored", example: 0 }
      }
    }
  })
  @ApiQuery(transactionIdQueryParam)
  async putWitsmlObjects(
    @Body() body: WitsmlStoreDto,
    @Req() request: express.Request,
    @Query("transactionId") transactionId?: string
  ) {
    const { dataspace, xml, json } = body;
    let c: ResqmlClient | undefined;

    try {
      let parsedObjects: ParsedWitsmlObject[];
      if (json && json.length > 0) {
        // JSON input: convert each Energistics/WITSML object to XML, then reuse
        // the same XML parsing + array-extraction pipeline.
        const builder = new XMLBuilder();
        parsedObjects = json.flatMap(obj => {
          const objXml = builder.JSONtoEnergistics(
            JSON.stringify(obj, bigIntToString)
          );
          if (!objXml) {
            throw new BadRequestException(
              `Invalid or unsupported object: missing/invalid $type${(obj as any)?.Uuid ? ` for ${(obj as any).Uuid}` : ""}`
            );
          }
          return parseWitsmlXml(objXml);
        });
      } else if (xml) {
        parsedObjects = parseWitsmlXml(xml);
      } else {
        throw new BadRequestException(
          "Provide either 'xml' or 'json' in the request body"
        );
      }
      if (parsedObjects.length === 0) {
        throw new BadRequestException("No valid WITSML objects found in input");
      }

      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request),
        undefined,
        transactionId,
        extractUserInfo(request)
      );

      requireProtocol(c, Energistics.Etp.v12.Datatypes.Protocol.Store);
      if (!transactionId) {
        requireProtocol(
          c,
          Energistics.Etp.v12.Datatypes.Protocol.Transaction
        );
      }

      // Start a transaction for PutDataObjects + arrays (required by ETP server)
      const dataspaceUri = `eml:///dataspace('${dataspace}')`;
      const txId = transactionId
        ? undefined
        : await c.startTransaction(false, [dataspaceUri], "WITSML store");

      // Pre-compute arrays so we can inject external references into the XML
      const objectArrayMap = new Map<
        string,
        { arrays: ChannelArray[]; domainFamily: string; domainVersion: string }
      >();
      for (const obj of parsedObjects) {
        let channelArrays = extractChannelArrays(obj.xml);
        if (channelArrays.length === 0) {
          channelArrays = extractTrajectoryArrays(obj.xml);
        }
        if (channelArrays.length > 0) {
          const { domainFamily, domainVersion } = detectDomainInfo(obj.xml);
          objectArrayMap.set(obj.uuid, {
            arrays: channelArrays,
            domainFamily,
            domainVersion
          });
        }
      }

      // Merge caller-supplied binary arrays (metadata-only XML + pre-computed
      // arrays). These attach to their container object by UUID so the same
      // ref-injection + same-transaction array write below applies to them,
      // giving an efficient lossless path without inline <Data> in the XML.
      if (body.arrays && body.arrays.length > 0) {
        const defaultUuid =
          parsedObjects.length === 1 ? parsedObjects[0].uuid : undefined;
        for (const a of body.arrays) {
          const targetUuid = a.containerUuid ?? defaultUuid;
          if (!targetUuid) {
            throw new BadRequestException(
              `arrays[] '${a.mnemonic}': containerUuid is required when the payload stores ${parsedObjects.length} objects`
            );
          }
          const obj = parsedObjects.find(o => o.uuid === targetUuid);
          if (!obj) {
            throw new BadRequestException(
              `arrays[] '${a.mnemonic}': unknown containerUuid '${targetUuid}' (not among stored objects)`
            );
          }
          const ch = witsmlArrayDtoToChannelArray(a);
          let entry = objectArrayMap.get(targetUuid);
          if (!entry) {
            const { domainFamily, domainVersion } = detectDomainInfo(obj.xml);
            entry = { arrays: [], domainFamily, domainVersion };
            objectArrayMap.set(targetUuid, entry);
          }
          entry.arrays.push(ch);
        }
      }

      // Inject ExternalDataArrayPart references into XML for objects that have arrays
      // This prevents the "Orphan arrays" commit error from the ETP server.
      // Also strip inline <data> rows since the data is stored as external arrays.
      for (const obj of parsedObjects) {
        const entry = objectArrayMap.get(obj.uuid);
        if (entry && entry.arrays.length > 0) {
          if (obj.xml.length <= MAX_WITSML_REGEX_INPUT) {
            // Strip WITSML 1.4.1 <logData>...</logData> blocks
            obj.xml = obj.xml.replace(
              /<(?:[\w]+:)?logData\b[^>]*>[\s\S]*?<\/(?:[\w]+:)?logData>/gi,
              ""
            );
            // Strip WITSML 2.1 ChannelSet <Data><Data>rows</Data>...</Data> container
            // Match the outer <Data> that wraps multiple <Data> row elements
            obj.xml = obj.xml.replace(
              /<(?:[\w]+:)?Data>\s*(?:<(?:[\w]+:)?(?:MnemonicList|Data)>[\s\S]*?<\/(?:[\w]+:)?Data>\s*)+<\/(?:[\w]+:)?Data>/gi,
              ""
            );
          }
          obj.xml = injectExternalArrayRefs(obj.xml, obj.uuid, entry.arrays);
        }
      }

      const dataObjects: DataObject[] = parsedObjects.map(obj => {
        const { domainFamily, domainVersion } = detectDomainInfo(obj.xml);
        const uri = EtpUri.createObjectUri(
          dataspace,
          domainFamily,
          domainVersion,
          obj.objectType,
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
      });

      logger.info(
        `Storing ${dataObjects.length} WITSML object(s) in ${dataspace}`
      );
      try {
        // Surface the store's own rejection (unknown dataspace, invalid UUID,
        // dangling reference, ...) instead of a generic 400.
        await c.putDataObjects(dataObjects, { throwOnError: true });
      } catch (putErr) {
        if (txId) {
          await c.rollbackTransaction(txId).catch(() => { });
        }
        throw putErr;
      }

      // ─── Store channel data arrays in the SAME transaction ──
      let arraysStored = 0;
      const channelJobs = [...objectArrayMap].flatMap(([uuid, entry]) => {
        const obj = parsedObjects.find(o => o.uuid === uuid)!;
        const containerUri = EtpUri.createObjectUri(
          dataspace,
          entry.domainFamily,
          entry.domainVersion,
          obj.objectType,
          obj.uuid
        ).uri;
        return entry.arrays.map(ch => ({ obj, ch, containerUri }));
      });
      // Bounded-concurrency fan-out (RDMS_CONCURRENCY_FETCH). Fail-fast: the
      // first array failure rolls back the transaction (mirroring the
      // putDataObjects failure path) so we never commit a partial channel set.
      try {
        await mapLimit(channelJobs, concurrency.fetch, async ({ obj, ch, containerUri }) => {
          const arrayId: IArrayId = {
            uri: containerUri,
            pathInResource: arrayPathFor("WITSML", obj.uuid, ch.mnemonic)
          };
          await c!.putDataArray(arrayId, ch.dimensions, ch.values);
          arraysStored++;
          logger.info(
            `  Stored array ${ch.mnemonic} (${ch.dimensions.join("×")}) for ${obj.objectType} ${obj.uuid}`
          );
        });
      } catch (arrErr) {
        if (txId) {
          await c.rollbackTransaction(txId).catch(() => { });
        }
        throw arrErr;
      }

      // Commit the transaction (objects + arrays together)
      if (txId) {
        await c.commitTransaction(txId);
      }

      if (arraysStored > 0) {
        logger.info(`Stored ${arraysStored} channel data array(s)`);
      }

      if (!transactionId) {
        await c.closeSession();
      }

      return {
        success: true,
        stored: parsedObjects.map(o => ({
          objectType: o.objectType,
          uuid: o.uuid,
          title: o.title
        })),
        arraysStored
      };
    } catch (err) {
      if (!transactionId) {
        await c?.closeSession();
      }
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Query WITSML objects from a dataspace with rich filtering.
   */
  @Post("query")
  @HttpCode(200)
  @ApiOperation({
    summary: "Query WITSML objects with filters (XML or JSON)",
    description:
      "Retrieves WITSML 2.1 / EnergyML objects from a dataspace, returning the full content of each.\n\n" +
      "**Format**: Set `format` to `xml` (raw Energistics XML, default) or `json` (parsed object).\n\n" +
      "**Filters** (all optional, combinable):\n" +
      "- `objectType` / `objectTypes` - restrict to one or several type names (Well, Wellbore, WellLog, ...)\n" +
      "- `titleContains` - case-insensitive substring match on the title/name\n" +
      "- `uuids` - return only a specific set of objects\n" +
      "- `modifiedSince` - ISO timestamp for incremental sync\n" +
      "- `relatedTo` + `scope` - traverse relationships from a given object (e.g. all Wellbores/Logs under a Well) using a bare UUID or full ETP URI\n" +
      "- `skip` / `top` - pagination\n\n" +
      "The response includes `total` (matches before pagination) and `count` (returned in this page).\n\n" +
      "**Note**: For metadata-only listing, use the generic `GET /dataspaces/{dataspaceId}/resources/all` endpoint instead.",
    servers: swaggerServers
  })
  @ApiBody({ type: WitsmlQueryDto })
  @ApiQuery({ name: "format", required: false, enum: ["xml", "json"], description: "Output encoding; overrides the body `format` field. `xml` (default) returns raw Energistics XML in each object's `xml`; `json` returns the parsed object in `content`." })
  @ApiOkResponse({
    description: "Paged object array plus count (this page) and total (all matches before pagination)",
    schema: {
      type: "object",
      properties: {
        objects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              uri: { type: "string", example: "eml:///dataspace('demo/drogon')/witsml21.Well(2b8f1c5e-9d34-4a7e-b016-7c3e5f0a9d21)" },
              objectType: { type: "string", example: "Well" },
              uuid: { type: "string", example: "2b8f1c5e-9d34-4a7e-b016-7c3e5f0a9d21" },
              name: { type: "string", example: "55/33-1" },
              xml: { type: "string", nullable: true, description: "Raw Energistics XML (present when format=xml)" },
              content: { type: "object", nullable: true, description: "Parsed object (present when format=json)" },
              lastChanged: { type: "string", format: "date-time", nullable: true }
            }
          }
        },
        count: { type: "integer", description: "Objects returned in this page", example: 1 },
        total: { type: "integer", description: "Total matches before skip/top pagination", example: 1 }
      }
    }
  })
  @ApiNotFoundResponse({ description: "Dataspace not found or not accessible" })
  async queryWitsmlObjects(
    @Body() body: WitsmlQueryDto,
    @Req() request: express.Request,
    @Query("format") formatQuery?: string
  ) {
    const {
      dataspace,
      objectType,
      objectTypes,
      titleContains,
      uuids,
      modifiedSince,
      relatedTo,
      scope,
      skip,
      top
    } = body;
    const format =
      (formatQuery ?? body.format ?? "xml").toLowerCase() === "json"
        ? "json"
        : "xml";
    let c: ResqmlClient | undefined;

    // The global ValidationPipe runs with skipUndefinedProperties, so a
    // missing required property is not rejected by class-validator.
    if (!dataspace) {
      throw new BadRequestException("Body property 'dataspace' is required");
    }

    try {
      c = await createSession(
        extractToken(request),
        extractDataPartitionId(request)
      );

      const dataspaceUri = `eml:///dataspace('${dataspace}')`;
      const Kind = Energistics.Etp.v12.Datatypes.Object.ContextScopeKind;

      // Determine the starting resource set: either relationship traversal from
      // a given object, or the full dataspace table of contents.
      let resources;
      if (relatedTo) {
        let relUri = relatedTo;
        if (!relatedTo.startsWith("eml:")) {
          // Resolve a bare UUID to its full URI within the dataspace.
          const all = await c.getResources(dataspaceUri, Kind.targets);
          const match = all.find(
            r => new EtpUri(r.uri).uuid?.toLowerCase() === relatedTo.toLowerCase()
          );
          if (!match) {
            await c.closeSession();
            return { objects: [], count: 0, total: 0 };
          }
          relUri = match.uri;
        }
        resources = await c.getResources(relUri, witsmlScopeKind(scope));
      } else {
        resources = await c.getResources(dataspaceUri, Kind.targets);
      }

      // Build the (case-insensitive) type filter set.
      const typeFilter = new Set<string>();
      if (objectType) {
        typeFilter.add(objectType.toLowerCase());
      }
      (objectTypes ?? []).forEach(t => typeFilter.add(t.toLowerCase()));

      let filtered = resources;
      if (typeFilter.size > 0) {
        filtered = filtered.filter(r => {
          const t = new EtpUri(r.uri).objectType?.toLowerCase();
          return t !== undefined && typeFilter.has(t);
        });
      }
      if (uuids && uuids.length > 0) {
        const uuidSet = new Set(uuids.map(u => u.toLowerCase()));
        filtered = filtered.filter(r => {
          const u = new EtpUri(r.uri).uuid?.toLowerCase();
          return u !== undefined && uuidSet.has(u);
        });
      }
      if (titleContains) {
        const needle = titleContains.toLowerCase();
        filtered = filtered.filter(r =>
          (r.name ?? "").toLowerCase().includes(needle)
        );
      }
      if (modifiedSince) {
        const ts = Date.parse(modifiedSince);
        if (!isNaN(ts)) {
          const tsMicros = BigInt(ts) * BigInt(1000);
          filtered = filtered.filter(
            r => r.lastChanged != null && BigInt(r.lastChanged) >= tsMicros
          );
        }
      }

      const total = filtered.length;
      const windowed = sliceArray(skip, top, filtered);

      if (windowed.length === 0) {
        await c.closeSession();
        return { objects: [], count: 0, total };
      }

      const uris = windowed.map(r => r.uri);

      let objects;
      if (format === "json") {
        const parsed = await c.getObjects(uris);
        objects = windowed.map((r, i) => {
          const etpUri = new EtpUri(r.uri);
          return {
            uri: r.uri,
            objectType: etpUri.objectType,
            uuid: etpUri.uuid,
            name: r.name,
            content: parsed[i] ?? null,
            lastChanged: microsToIso(r.lastChanged)
          };
        });
      } else {
        const dataObjects = await c.getDataObjects(uris);
        objects = windowed.map((r, i) => {
          const etpUri = new EtpUri(r.uri);
          const o = dataObjects[i];
          return {
            uri: r.uri,
            objectType: etpUri.objectType,
            uuid: etpUri.uuid,
            name: r.name,
            xml: o ? byteToString(o.data) : null,
            lastChanged: microsToIso(r.lastChanged)
          };
        });
      }

      await c.closeSession();

      return { objects, count: objects.length, total };
    } catch (err) {
      await c?.closeSession();
      throw httpErrorFromEtpError(err);
    }
  }
}
