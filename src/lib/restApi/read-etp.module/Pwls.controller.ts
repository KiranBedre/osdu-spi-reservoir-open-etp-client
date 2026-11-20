import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res
} from "@nestjs/common";

import {
  ApiBody,
  ApiDefaultResponse,
  ApiNotAcceptableResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse
} from "@nestjs/swagger";

import { Allow, ArrayMaxSize, IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import type express from "express";

import { errorMessageSchema, swaggerServers } from "../ControllerUtils";

import {
  getPwlsStatus,
  getQuantityClassFromMnemonic,
  getQuantityClassForProperty,
  getPropertyTypeIdFromMnemonic,
  getPropertyTypeIdForProperty,
  getPropertyEntries,
  getParentProperty,
  getParentPropertyTypeId,
  getPropertyHierarchy,
  isKnownPwlsProperty,
  loadVendorCatalog,
  hasVendorCatalog,
  getLoadedVendors,
  getLoadedMnemonicCount,
  getMnemonicMatch
} from "../../jsonTypes/PwlsCurveCatalog";
import type { MnemonicMatchVia } from "../../jsonTypes/PwlsCurveCatalog";
import { normalizeUnit } from "../../jsonTypes/PwlsUnits";
import {
  RDF_MIME_JSONLD,
  RDF_MIME_NTRIPLES,
  RDF_MIME_TURTLE,
  resolveRdfFormat
} from "./RdfSerialization";
import { serializeDocument } from "./RdfDocument";
import { buildPwlsSkosDocument } from "./RdfVocabulary";

// --- DTOs ---

class PwlsStatusDto {
  @ApiProperty({ example: 875 })
  properties!: number;

  @ApiProperty({ example: 30201 })
  mnemonics!: number;

  @ApiProperty({ example: ["Schlumberger"] })
  vendors!: string[];
}

class PwlsHierarchyNodeDto {
  @ApiProperty({ example: "bulk density" })
  property!: string;

  @ApiPropertyOptional({ example: "8cf38da3-e98e-4134-a186-1c6f562d6430" })
  propertyTypeId?: string;

  @ApiProperty({ example: "mass per volume" })
  quantityClass!: string;
}

class PwlsResolveResultDto {
  @ApiProperty({ example: "GR", description: "The mnemonic that was looked up (or the property name when resolved by property)" })
  mnemonic!: string;

  @ApiPropertyOptional({ example: "gamma ray" })
  property?: string;

  @ApiPropertyOptional({ example: "API gamma ray" })
  quantityClass?: string;

  @ApiPropertyOptional({ example: "uuid-string" })
  propertyTypeId?: string;

  @ApiPropertyOptional({ example: "density", description: "Immediate parent PWLS property (v4 recursive tree)" })
  parent?: string;

  @ApiPropertyOptional({ example: "fd8a4e2e-63d7-43d9-926a-a23da337dc6c", description: "OSDU PropertyType UUID of the parent" })
  parentPropertyTypeId?: string;

  @ApiPropertyOptional({
    example: "alias",
    enum: ["vendor", "vendor-ci", "alias", "property", "none"],
    description: "Which lookup tier produced the match (audit trail for §6.4 alias coverage)"
  })
  matchedVia?: MnemonicMatchVia;

  @ApiPropertyOptional({ example: "INC", description: "The intuitive-alias key that matched (only when matchedVia === 'alias')" })
  alias?: string;

  @ApiProperty({ example: true })
  resolved!: boolean;

  @ApiPropertyOptional({
    type: [PwlsHierarchyNodeDto],
    description: "Only with include=hierarchy: ancestry from the property itself up towards the root (abstract 'property' root omitted)"
  })
  hierarchy?: PwlsHierarchyNodeDto[];

  @ApiPropertyOptional({ example: 2, description: "Only with include=hierarchy: number of levels in the ancestry chain" })
  depth?: number;
}

export class CurveValidationEntry {
  @IsString()
  @ApiProperty({ example: "GR", description: "Curve mnemonic or property name" })
  mnemonic!: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({ example: "gAPI", description: "Unit of measurement (optional)" })
  uom?: string;
}

class CurveValidationResultEntry {
  @ApiProperty({ example: "GR" })
  mnemonic!: string;

  @ApiPropertyOptional({ example: "gamma ray" })
  property?: string;

  @ApiPropertyOptional({ example: "API gamma ray" })
  quantityClass?: string;

  @ApiPropertyOptional({ example: "uuid-string" })
  propertyTypeId?: string;

  @ApiProperty({ example: true, description: "Whether the mnemonic resolved to a known PWLS property" })
  knownProperty!: boolean;

  @ApiProperty({ example: true, description: "Whether the mnemonic resolved via vendor catalog" })
  mnemonicResolved!: boolean;

  @ApiPropertyOptional({
    example: "alias",
    enum: ["vendor", "vendor-ci", "alias", "property", "none"],
    description: "Which lookup tier produced the match"
  })
  matchedVia?: MnemonicMatchVia;

  @ApiPropertyOptional({ example: "INC", description: "The intuitive-alias key that matched" })
  alias?: string;

  @ApiPropertyOptional({ example: "gAPI", description: "Canonical Energistics UoM for the resolved QuantityClass" })
  canonicalUom?: string;

  @ApiPropertyOptional({ example: true, description: "Whether the supplied UoM is dimensionally compatible with the QuantityClass" })
  unitCompatible?: boolean;

  @ApiPropertyOptional({ example: 0.3048, description: "Linear factor to convert the supplied UoM to canonical (value*factor + offset)" })
  conversionFactor?: number;

  @ApiPropertyOptional({
    example: ["UOM 'gAPI' provided but QuantityClass is 'API gamma ray' - verify compatibility"],
    description: "Validation warnings"
  })
  warnings?: string[];
}

export class CurveValidationRequestDto {
  @IsArray()
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => CurveValidationEntry)
  @ApiProperty({
    type: [CurveValidationEntry],
    description: "Array of curves to validate",
    example: [
      { mnemonic: "GR", uom: "gAPI" },
      { mnemonic: "NPHI" },
      { mnemonic: "UNKNOWN_XYZ" }
    ]
  })
  curves!: CurveValidationEntry[];
}

class CurveValidationResponseDto {
  @ApiProperty({ example: 3 })
  total!: number;

  @ApiProperty({ example: 2 })
  resolved!: number;

  @ApiProperty({ example: 1 })
  unresolved!: number;

  @ApiProperty({ example: 0 })
  withWarnings!: number;

  @ApiProperty({ type: [CurveValidationResultEntry] })
  results!: CurveValidationResultEntry[];
}

class VendorCatalogUploadDto {
  @Allow()
  @ApiProperty({ example: "1.0.0" })
  schemaVersion!: string;

  @Allow()
  @ApiProperty({ example: 999 })
  "Company Code"!: number;

  @Allow()
  @ApiProperty({ example: "Halliburton" })
  "Company Name"!: string;

  @Allow()
  @IsOptional()
  @ApiPropertyOptional({ example: "2025-06-01" })
  LastUpdated?: string;

  @Allow()
  @ApiProperty({
    type: "array",
    items: {
      type: "object",
      properties: {
        "Curve Mnemonic": { type: "string", example: "GR" },
        Property: { type: "string", example: "gamma ray" },
        "Curve Unit Quantity Class": { type: "string", example: "API gamma ray" },
        "LIS Curve Mnemonic": { type: "string", nullable: true, example: null }
      }
    }
  })
  data!: {
    "Curve Mnemonic": string;
    Property: string;
    "Curve Unit Quantity Class": string;
    "LIS Curve Mnemonic": string | null;
  }[];
}

// --- Controller ---

/**
 * PWLS (Professional Well Log Standard) reference data controller.
 * Provides mnemonic resolution, property lookup, curve validation,
 * and vendor catalog management.
 */
@ApiTags("Well")
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiDefaultResponse(errorMessageSchema("Unknown Error", 500))
@Controller("pwls")
export default class PwlsController {
  /**
   * Get PWLS catalog status (loaded properties, mnemonics, vendors).
   */
  @Get("status")
  @ApiOkResponse({ description: "PWLS catalog status", type: PwlsStatusDto })
  @ApiOperation({
    summary: "Get PWLS catalog status",
    description: "Returns the number of loaded PWLS properties, vendor mnemonics, and vendor names.",
    security: [],
    servers: swaggerServers
  })
  public getStatus(): PwlsStatusDto {
    return getPwlsStatus();
  }

  /**
   * Resolve a mnemonic (or a PWLS property name) to its PWLS property,
   * QuantityClass and PropertyType UUID; optionally with the vendor-neutral
   * ancestry chain.
   *
   * PWLS v4 replaces the legacy v2 `MainFamily -> Family -> Type` model with a
   * single recursive `PropertyKind` tree (surfaced in OSDU as
   * `PropertyType.ParentPropertyTypeID`). `include=hierarchy` walks that tree
   * from the resolved property up towards the root, e.g. `RHOB` ->
   * `bulk density` -> `density`.
   */
  @Get("resolve")
  @ApiOkResponse({ description: "Resolved mnemonic or property", type: PwlsResolveResultDto })
  @ApiQuery({ name: "mnemonic", required: false, description: "Curve mnemonic to resolve (e.g. GR, NPHI, RHOB)" })
  @ApiQuery({ name: "property", required: false, description: "PWLS property name (e.g. 'bulk density') when the property is already known" })
  @ApiQuery({
    name: "include",
    required: false,
    enum: ["hierarchy"],
    description: "Add the PWLS v4 ancestry chain (`hierarchy`, `depth`), self first up towards the abstract 'property' root"
  })
  @ApiOperation({
    summary: "Resolve a curve mnemonic or property (optionally with its ancestry)",
    description:
      "Resolves a vendor curve mnemonic (or a PWLS property name) to its PWLS standard property, QuantityClass and OSDU PropertyType UUID. Provide either 'mnemonic' or 'property'. With `include=hierarchy` the response also carries the vendor-neutral ancestry chain; its depth is variable because PWLS v4 is a recursive tree, not a fixed 3-tier taxonomy.",
    security: [],
    servers: swaggerServers
  })
  public resolve(
    @Query("mnemonic") mnemonic?: string,
    @Query("property") propertyName?: string,
    @Query("include") include?: string
  ): PwlsResolveResultDto {
    const mnemonicKey = mnemonic?.trim();
    const explicitProperty = propertyName?.trim();
    if (!mnemonicKey && !explicitProperty) {
      throw new BadRequestException("Query parameter 'mnemonic' or 'property' is required");
    }
    const includes = (include ?? "")
      .split(",")
      .map(v => v.trim())
      .filter(v => v.length > 0);
    if (includes.some(v => v !== "hierarchy")) {
      throw new BadRequestException("Query parameter 'include' only accepts 'hierarchy'");
    }
    const withHierarchy = includes.includes("hierarchy");

    const match = mnemonicKey
      ? getMnemonicMatch(mnemonicKey)
      : { property: explicitProperty, matchedVia: "property" as MnemonicMatchVia };
    const property = match.property;
    if (!property) {
      return {
        mnemonic: mnemonicKey ?? explicitProperty ?? "",
        matchedVia: "none",
        resolved: false,
        ...(withHierarchy ? { hierarchy: [], depth: 0 } : {})
      };
    }
    const hierarchy = withHierarchy ? getPropertyHierarchy(property) : undefined;
    const quantityClass = getQuantityClassForProperty(property);
    return {
      mnemonic: mnemonicKey ?? property,
      property,
      quantityClass,
      propertyTypeId: getPropertyTypeIdForProperty(property),
      parent: getParentProperty(property),
      parentPropertyTypeId: getParentPropertyTypeId(property),
      matchedVia: match.matchedVia,
      alias: match.alias,
      // A mnemonic hit is resolved by construction; an explicit property name
      // counts as resolved only when the catalog knows it.
      resolved: mnemonicKey ? true : quantityClass !== undefined || (hierarchy?.length ?? 0) > 0,
      ...(hierarchy ? { hierarchy, depth: hierarchy.length } : {})
    };
  }

  /**
   * Validate a set of curves against the PWLS catalog.
   * Returns resolution status and warnings for each curve.
   */
  @Post("validate")
  @HttpCode(200)
  @ApiOkResponse({ description: "Validation results", type: CurveValidationResponseDto })
  @ApiBody({ type: CurveValidationRequestDto })
  @ApiOperation({
    summary: "Validate curves against PWLS",
    description: "Checks each curve mnemonic against the PWLS catalog. Returns whether each mnemonic is recognized, its standard property, QuantityClass, and any UOM warnings.",
    security: [],
    servers: swaggerServers
  })
  public validate(@Body() body: CurveValidationRequestDto): CurveValidationResponseDto {
    if (!body?.curves || !Array.isArray(body.curves)) {
      throw new BadRequestException("Body must contain a 'curves' array");
    }

    if (body.curves.length > 10000) {
      throw new BadRequestException("Maximum 10,000 curves per request");
    }

    const results: CurveValidationResultEntry[] = [];

    for (const entry of body.curves) {
      if (!entry.mnemonic || typeof entry.mnemonic !== "string") {
        results.push({
          mnemonic: entry.mnemonic ?? "",
          knownProperty: false,
          mnemonicResolved: false,
          warnings: ["Invalid or missing mnemonic"]
        });
        continue;
      }

      const result: CurveValidationResultEntry = {
        mnemonic: entry.mnemonic,
        knownProperty: false,
        mnemonicResolved: false
      };

      // Resolve mnemonic + record which lookup tier matched (§6.4 audit trail)
      const match = getMnemonicMatch(entry.mnemonic);
      if (match.property) {
        const property = match.property;
        result.mnemonicResolved = match.matchedVia === "vendor" || match.matchedVia === "vendor-ci" || match.matchedVia === "alias";
        result.property = property;
        result.quantityClass = getQuantityClassForProperty(property);
        result.propertyTypeId = getPropertyTypeIdForProperty(property);
        result.knownProperty = isKnownPwlsProperty(property);
        result.matchedVia = match.matchedVia;
        result.alias = match.alias;
      } else {
        result.matchedVia = "none";
      }

      // UOM normalization + dimensional compatibility check (§6.4 unit normalization)
      const warnings: string[] = [];
      if (entry.uom && result.quantityClass) {
        const norm = normalizeUnit(entry.uom, result.quantityClass);
        result.canonicalUom = norm.canonicalUom;
        result.unitCompatible = norm.compatible;
        result.conversionFactor = norm.factor;
        if (norm.compatible === false) {
          warnings.push(norm.note);
        } else if (!norm.recognized) {
          warnings.push(norm.note);
        } else if (norm.compatible === true && !norm.isCanonical) {
          warnings.push(norm.note);
        }
      } else if (!result.property) {
        warnings.push(`Mnemonic '${entry.mnemonic}' not found in PWLS catalog or loaded vendor catalogs`);
      }
      if (warnings.length > 0) result.warnings = warnings;

      results.push(result);
    }

    const resolved = results.filter(r => r.mnemonicResolved || r.knownProperty).length;
    const withWarnings = results.filter(r => r.warnings && r.warnings.length > 0).length;

    return {
      total: results.length,
      resolved,
      unresolved: results.length - resolved,
      withWarnings,
      results
    };
  }

  /**
   * Get the PWLS curve-property catalogue.
   *
   * Default JSON returns the catalogue summary and property list. Send
   * `Accept: text/turtle` / `application/ld+json` / `application/n-triples`
   * (or `?format=`) to receive the catalogue as a SKOS concept scheme, with
   * vendor mnemonics attached as `skos:altLabel` on each property concept.
   */
  @Get("catalog")
  @ApiProduces("application/json", RDF_MIME_TURTLE, RDF_MIME_JSONLD, RDF_MIME_NTRIPLES)
  @ApiQuery({
    name: "format",
    required: false,
    enum: ["turtle", "jsonld", "ntriples"],
    description: "RDF serialization to return (SKOS). Overrides the Accept header."
  })
  @ApiQuery({
    name: "mnemonics",
    required: false,
    type: Boolean,
    description: "Include vendor mnemonics as skos:altLabel in RDF output (default true)."
  })
  @ApiOkResponse({ description: "PWLS catalogue (JSON summary or SKOS concept scheme)" })
  @ApiOperation({
    summary: "Get the PWLS curve-property catalogue",
    description:
      "Returns the PWLS v4 catalogue. Default JSON lists the standard properties and their QuantityClass. Content-negotiate (Accept or `format`) to receive a SKOS concept scheme in Turtle, JSON-LD or N-Triples.",
    security: [],
    servers: swaggerServers
  })
  public getCatalog(
    @Query("format") format?: string,
    @Query("mnemonics") mnemonics?: string,
    @Req() request?: express.Request,
    @Res({ passthrough: true }) response?: express.Response
  ):
    | { schemaVersion: string; properties: Array<{ property: string; quantityClass: string }>; status: PwlsStatusDto }
    | string
    | Record<string, unknown> {
    const rdfFormat = resolveRdfFormat(request?.headers.accept, format);
    if (rdfFormat) {
      const includeMnemonics = mnemonics !== "false";
      const { body, contentType } = serializeDocument(
        buildPwlsSkosDocument({ includeMnemonics }),
        rdfFormat
      );
      response?.type(contentType);
      return body;
    }
    return {
      schemaVersion: "PWLS v4.0",
      properties: getPropertyEntries(),
      status: getPwlsStatus()
    };
  }

  /**
   * Load an additional vendor curve catalog (PWLS v4 format).
   */
  @Post("catalog")
  @HttpCode(200)
  @ApiOkResponse({
    description: "Catalog loaded",
    schema: {
      type: "object",
      properties: {
        added: { type: "number", example: 5000 },
        totalMnemonics: { type: "number", example: 35201 },
        vendors: { type: "array", items: { type: "string" }, example: ["Schlumberger", "Halliburton"] }
      }
    }
  })
  @ApiBody({ type: VendorCatalogUploadDto })
  @ApiOperation({
    summary: "Load a vendor curve catalog",
    description: "Loads an additional PWLS v4 vendor curve catalog JSON. Mnemonics accumulate; first-loaded entry wins on collision. The Schlumberger catalog is auto-loaded at startup.",
    security: [],
    servers: swaggerServers
  })
  public loadCatalog(
    @Body() body: VendorCatalogUploadDto
  ): { added: number; totalMnemonics: number; vendors: string[] } {
    if (!body?.data || !Array.isArray(body.data)) {
      throw new BadRequestException("Body must contain a 'data' array of curve mappings");
    }

    if (!body["Company Name"] || typeof body["Company Name"] !== "string") {
      throw new BadRequestException("Body must contain 'Company Name'");
    }

    if (!body["Company Code"] || typeof body["Company Code"] !== "number") {
      throw new BadRequestException("Body must contain numeric 'Company Code'");
    }

    const added = loadVendorCatalog(body as any);

    return {
      added,
      totalMnemonics: getLoadedMnemonicCount(),
      vendors: getLoadedVendors()
    };
  }
}
