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
  httpErrorFromEtpError,
  patternString,
  sliceArray,
  swaggerServers,
  partitionPattern,
  transactionIdQueryParam,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import { XMLBuilder } from "../../mlTypes/Json2Xml";
import { bigIntToString } from "../../mlTypes/XmlJsonUtil";
import { ErrorCode, EtpError } from "../../common/EtpTypes";

import { createHash } from "crypto";

import logging from "../../common/Logging";
const logger = logging.getLogger("EtpClient");

// ─── DTOs ────────────────────────────────────────────────────────────────────

class WitsmlStoreDto {
  @ApiProperty({
    description: "Target dataspace path",
    example: "test/witsml",
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
}

class WitsmlQueryDto {
  @ApiProperty({
    description: "Target dataspace path (e.g., 'test/witsml', 'demo/drogon'). Must be an existing dataspace on the ETP server.",
    example: "test/witsml"
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
    example: "31/2-1"
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
    example: "a1b2c3d4-0000-0000-0000-000000000000"
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
  if (!xml.includes('<eml:Citation>') && !xml.includes('<Citation>')) {
    // Inject minimal Citation if missing
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

// ─── WITSML Channel Data Extraction ──────────────────────────────────────────

interface ChannelArray {
  mnemonic: string;
  values: Float64Array;
  /** Dimensions for putDataArray: [length] for scalar, [rows, dim] for array channels. */
  dimensions: number[];
}

/**
 * Parse a single data row that may contain bracket-encoded multi-dim arrays.
 * Format: "8496.0,[7.48 40.85 21.6],[1023.09 78.6],42.5"
 * Returns an array of tokens, each being either a scalar number or a number[].
 */
function parseDataRow(row: string): (number | number[])[] {
  const tokens: (number | number[])[] = [];
  let i = 0;
  const len = row.length;

  while (i < len) {
    // Skip whitespace/commas
    while (i < len && (row[i] === "," || row[i] === " " || row[i] === "\t")) i++;
    if (i >= len) break;

    if (row[i] === "[") {
      // Bracket-encoded array: [v1 v2 v3 ...]
      const end = row.indexOf("]", i);
      if (end < 0) break;
      const inner = row.slice(i + 1, end).trim();
      const arr = inner
        .split(/\s+/)
        .map(v => { const n = parseFloat(v); return isNaN(n) ? NaN : n; });
      tokens.push(arr);
      i = end + 1;
    } else {
      // Scalar value: read until next comma or bracket
      let j = i;
      while (j < len && row[j] !== "," && row[j] !== "[") j++;
      const val = row.slice(i, j).trim();
      if (val.length > 0) {
        const n = parseFloat(val);
        tokens.push(isNaN(n) ? NaN : n);
      }
      i = j;
    }
  }
  return tokens;
}

/**
 * Extract channel data arrays from WITSML XML containing <logData><data> rows.
 * Supports WITSML 1.4.1 (<logData><data>v1,v2,v3</data>...) and
 * WITSML 2.1 ChannelSet data formats, including bracket-encoded multi-dim arrays.
 *
 * Multi-dimensional channels (e.g. T2_DIST[30]) are stored as flattened
 * Float64Array with dimensions [rows, dim].
 *
 * Returns per-channel Float64Array for each mnemonic (including the index curve).
 */
function extractChannelArrays(xml: string): ChannelArray[] {
  // --- WITSML 1.4.1 format ---
  // <logCurveInfo><mnemonic>GR</mnemonic>...</logCurveInfo>
  // <logData><data>1000.0, 45.2, 105.3</data>...</logData>
  const curveInfoRegex =
    /<(?:[\w]+:)?(?:logCurveInfo|LogCurveInfo)[^>]*>[\s\S]*?<(?:[\w]+:)?(?:mnemonic|Mnemonic)>([^<]+)<\/[\s\S]*?<\/(?:[\w]+:)?(?:logCurveInfo|LogCurveInfo)>/gi;
  const mnemonics: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = curveInfoRegex.exec(xml)) !== null) {
    mnemonics.push(m[1].trim());
  }

  // WITSML 2.1 ChannelSet format: <Channel><Mnemonic>GR</Mnemonic>...</Channel>
  // Also extract from <Index><Mnemonic>MD</Mnemonic>...</Index>
  if (mnemonics.length === 0) {
    const indexMnemonicRegex =
      /<(?:[\w]+:)?Index[^>]*>[\s\S]*?<(?:[\w]+:)?Mnemonic>([^<]+)<\/[\s\S]*?<\/(?:[\w]+:)?Index>/gi;
    while ((m = indexMnemonicRegex.exec(xml)) !== null) {
      mnemonics.push(m[1].trim());
    }
    const channelRegex =
      /<(?:[\w]+:)?Channel\b[^>]*>[\s\S]*?<(?:[\w]+:)?Mnemonic>([^<]+)<\/[\s\S]*?<\/(?:[\w]+:)?Channel>/gi;
    while ((m = channelRegex.exec(xml)) !== null) {
      mnemonics.push(m[1].trim());
    }
  }

  if (mnemonics.length === 0) return [];

  // Extract <data> rows (nested <Data><Data>... or <logData><data>...)
  const dataRowRegex = /<(?:[\w]+:)?[Dd]ata>([^<]+)<\/(?:[\w]+:)?[Dd]ata>/gi;
  const rawRows: string[] = [];
  while ((m = dataRowRegex.exec(xml)) !== null) {
    const content = m[1].trim();
    // Skip MnemonicList-like rows (all text, no numbers)
    if (content.length > 0 && /[\d.-]/.test(content)) {
      rawRows.push(content);
    }
  }

  if (rawRows.length === 0) return [];

  // Parse all rows to detect scalars vs arrays per channel
  const parsedRows = rawRows.map(parseDataRow);
  if (parsedRows.length === 0 || parsedRows[0].length === 0) return [];

  const numChannels = Math.min(mnemonics.length, parsedRows[0].length);
  const numRows = parsedRows.length;
  const arrays: ChannelArray[] = [];

  for (let col = 0; col < numChannels; col++) {
    // Determine if this channel is scalar or array from first non-NaN row
    const sample = parsedRows.find(r => col < r.length && r[col] !== undefined)?.[col];
    const isArray = Array.isArray(sample);

    if (isArray) {
      // Multi-dimensional channel: flatten into [rows * dim]
      const dim = (sample as number[]).length;
      const values = new Float64Array(numRows * dim);
      for (let row = 0; row < numRows; row++) {
        const cell = col < parsedRows[row].length ? parsedRows[row][col] : undefined;
        if (Array.isArray(cell)) {
          for (let d = 0; d < dim; d++) {
            values[row * dim + d] = d < cell.length ? cell[d] : NaN;
          }
        } else {
          // Missing row - fill with NaN
          for (let d = 0; d < dim; d++) {
            values[row * dim + d] = NaN;
          }
        }
      }
      arrays.push({ mnemonic: mnemonics[col], values, dimensions: [numRows, dim] });
    } else {
      // Scalar channel
      const values = new Float64Array(numRows);
      for (let row = 0; row < numRows; row++) {
        const cell = col < parsedRows[row].length ? parsedRows[row][col] : NaN;
        values[row] = typeof cell === "number" ? cell : NaN;
      }
      arrays.push({ mnemonic: mnemonics[col], values, dimensions: [numRows] });
    }
  }

  return arrays;
}

/**
 * Extract trajectory station data as arrays from WITSML trajectory XML.
 * Supports WITSML 1.4.1 <trajectoryStation> elements with <md>, <incl>, <azi>.
 * Returns arrays for MD, Inclination, and Azimuth.
 */
function extractTrajectoryArrays(xml: string): ChannelArray[] {
  // Match individual <trajectoryStation> blocks
  const stationRegex =
    /<(?:[\w]+:)?trajectoryStation[^>]*>([\s\S]*?)<\/(?:[\w]+:)?trajectoryStation>/gi;
  const mdValues: number[] = [];
  const inclValues: number[] = [];
  const aziValues: number[] = [];

  let m: RegExpExecArray | null;
  while ((m = stationRegex.exec(xml)) !== null) {
    const block = m[1];
    const mdMatch = block.match(/<(?:[\w]+:)?md[^>]*>([^<]+)<\//i);
    const inclMatch = block.match(/<(?:[\w]+:)?incl[^>]*>([^<]+)<\//i);
    const aziMatch = block.match(/<(?:[\w]+:)?azi[^>]*>([^<]+)<\//i);

    if (mdMatch) mdValues.push(parseFloat(mdMatch[1]));
    if (inclMatch) inclValues.push(parseFloat(inclMatch[1]));
    if (aziMatch) aziValues.push(parseFloat(aziMatch[1]));
  }

  if (mdValues.length === 0) return [];

  const arrays: ChannelArray[] = [];
  if (mdValues.length > 0) {
    arrays.push({ mnemonic: "MD", values: Float64Array.from(mdValues), dimensions: [mdValues.length] });
  }
  if (inclValues.length > 0) {
    arrays.push({
      mnemonic: "Inclination",
      values: Float64Array.from(inclValues),
      dimensions: [inclValues.length]
    });
  }
  if (aziValues.length > 0) {
    arrays.push({ mnemonic: "Azimuth", values: Float64Array.from(aziValues), dimensions: [aziValues.length] });
  }
  return arrays;
}

/**
 * Inject EML ExternalDataArrayPart references into the XML so the ETP server
 * doesn't consider the arrays "orphans" during transaction commit.
 */
function injectExternalArrayRefs(
  xml: string,
  uuid: string,
  arrays: ChannelArray[]
): string {
  // Ensure xmlns:eml is declared on root element
  if (!xml.includes('xmlns:eml=') && !xml.includes('xmlns:eml =')) {
    xml = xml.replace(
      /(<[\w:]+)/,
      `$1 xmlns:eml="http://www.energistics.org/energyml/data/commonv2"`
    );
  }

  const refs = arrays
    .map(
      ch =>
        `<eml:ExternalDataArrayPart>` +
        `<eml:Count>${ch.values.length}</eml:Count>` +
        `<eml:PathInExternalFile>/WITSML/${uuid}/${ch.mnemonic}</eml:PathInExternalFile>` +
        `</eml:ExternalDataArrayPart>`
    )
    .join("");

  // Insert before the closing root element tag
  const closingTagMatch = xml.match(/<\/[\w:]+>\s*$/);
  if (closingTagMatch && closingTagMatch.index != null) {
    return (
      xml.slice(0, closingTagMatch.index) +
      refs +
      xml.slice(closingTagMatch.index)
    );
  }
  // Fallback: append before end
  return xml + refs;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags("WITSML")
@Controller("witsml")
@ApiBearerAuth("HTTPBearer")
@UseGuards(HasBearerGuard("jwt"))
@ApiHeader({
  name: "data-partition-id",
  required: true,
  schema: { type: "string", pattern: patternString(partitionPattern) }
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
  @ApiOkResponse({ description: "Objects stored successfully" })
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
        transactionId
      );

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

      // Inject ExternalDataArrayPart references into XML for objects that have arrays
      // This prevents the "Orphan arrays" commit error from the ETP server.
      // Also strip inline <data> rows since the data is stored as external arrays.
      for (const obj of parsedObjects) {
        const entry = objectArrayMap.get(obj.uuid);
        if (entry && entry.arrays.length > 0) {
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
      const putResult = await c.putDataObjects(dataObjects);
      if (!putResult) {
        if (txId) {
          await c.rollbackTransaction(txId).catch(() => { });
        }
        throw new BadRequestException(
          "PutDataObjects failed - check UUID format (must be valid UUID) and dataspace existence"
        );
      }

      // ─── Store channel data arrays in the SAME transaction ──
      let arraysStored = 0;
      for (const [uuid, entry] of objectArrayMap) {
        const obj = parsedObjects.find(o => o.uuid === uuid)!;
        const containerUri = EtpUri.createObjectUri(
          dataspace,
          entry.domainFamily,
          entry.domainVersion,
          obj.objectType,
          obj.uuid
        ).uri;

        for (const ch of entry.arrays) {
          const arrayId: IArrayId = {
            uri: containerUri,
            pathInResource: `/WITSML/${obj.uuid}/${ch.mnemonic}`
          };
          try {
            await c.putDataArray(arrayId, ch.dimensions, ch.values);
            arraysStored++;
            logger.info(
              `  Stored array ${ch.mnemonic} (${ch.dimensions.join("×")}) for ${obj.objectType} ${obj.uuid}`
            );
          } catch (arrErr: any) {
            logger.warn(
              `  Failed to store array ${ch.mnemonic} for ${obj.uuid}: ${arrErr?.message ?? arrErr}`
            );
          }
        }
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
  @ApiOkResponse({ description: "Object array with content and metadata (uri, objectType, uuid, name, xml|content, lastChanged), plus count and total" })
  @ApiNotFoundResponse({ description: "Dataspace not found or not accessible" })
  async queryWitsmlObjects(
    @Body() body: WitsmlQueryDto,
    @Req() request: express.Request,
    @Query("$format") formatQuery?: string
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
