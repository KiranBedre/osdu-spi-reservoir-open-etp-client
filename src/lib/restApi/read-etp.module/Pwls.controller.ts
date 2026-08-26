import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query
} from "@nestjs/common";

import {
  ApiBody,
  ApiDefaultResponse,
  ApiNotAcceptableResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse
} from "@nestjs/swagger";

import { Allow, IsOptional } from "class-validator";

import { errorMessageSchema, swaggerServers } from "../ControllerUtils";

import {
  getPwlsStatus,
  getPropertyFromMnemonic,
  getQuantityClassFromMnemonic,
  getQuantityClassForProperty,
  getPropertyTypeIdFromMnemonic,
  getPropertyTypeIdForProperty,
  isKnownPwlsProperty,
  loadVendorCatalog,
  hasVendorCatalog,
  getLoadedVendors,
  getLoadedMnemonicCount
} from "../../jsonTypes/PwlsCurveCatalog";

// --- DTOs ---

class PwlsStatusDto {
  @ApiProperty({ example: 875 })
  properties!: number;

  @ApiProperty({ example: 30201 })
  mnemonics!: number;

  @ApiProperty({ example: ["Schlumberger"] })
  vendors!: string[];
}

class PwlsResolveResultDto {
  @ApiProperty({ example: "GR" })
  mnemonic!: string;

  @ApiPropertyOptional({ example: "gamma ray" })
  property?: string;

  @ApiPropertyOptional({ example: "API gamma ray" })
  quantityClass?: string;

  @ApiPropertyOptional({ example: "uuid-string" })
  propertyTypeId?: string;

  @ApiProperty({ example: true })
  resolved!: boolean;
}

class CurveValidationEntry {
  @ApiProperty({ example: "GR", description: "Curve mnemonic or property name" })
  mnemonic!: string;

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
    example: ["UOM 'gAPI' provided but QuantityClass is 'API gamma ray' - verify compatibility"],
    description: "Validation warnings"
  })
  warnings?: string[];
}

class CurveValidationRequestDto {
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
@ApiTags("PWLS")
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
   * Resolve a single mnemonic to its PWLS property, QuantityClass, and PropertyType UUID.
   */
  @Get("resolve")
  @ApiOkResponse({ description: "Resolved mnemonic", type: PwlsResolveResultDto })
  @ApiQuery({ name: "mnemonic", required: true, description: "Curve mnemonic to resolve (e.g. GR, NPHI, RHOB)" })
  @ApiOperation({
    summary: "Resolve a curve mnemonic",
    description: "Resolves a vendor curve mnemonic to its PWLS standard property name, QuantityClass, and OSDU PropertyType UUID.",
    security: [],
    servers: swaggerServers
  })
  public resolve(@Query("mnemonic") mnemonic: string): PwlsResolveResultDto {
    if (!mnemonic || mnemonic.trim().length === 0) {
      throw new BadRequestException("Query parameter 'mnemonic' is required");
    }

    const property = getPropertyFromMnemonic(mnemonic);
    if (property) {
      return {
        mnemonic,
        property,
        quantityClass: getQuantityClassForProperty(property),
        propertyTypeId: getPropertyTypeIdForProperty(property),
        resolved: true
      };
    }

    // Fallback: check if it's already a PWLS property name
    if (isKnownPwlsProperty(mnemonic)) {
      return {
        mnemonic,
        property: mnemonic.toLowerCase(),
        quantityClass: getQuantityClassForProperty(mnemonic),
        propertyTypeId: getPropertyTypeIdForProperty(mnemonic),
        resolved: true
      };
    }

    return { mnemonic, resolved: false };
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

      // Try vendor catalog resolution
      const property = getPropertyFromMnemonic(entry.mnemonic);
      if (property) {
        result.mnemonicResolved = true;
        result.property = property;
        result.quantityClass = getQuantityClassForProperty(property);
        result.propertyTypeId = getPropertyTypeIdForProperty(property);
        result.knownProperty = isKnownPwlsProperty(property);
      } else if (isKnownPwlsProperty(entry.mnemonic)) {
        // The mnemonic itself is a PWLS property name
        result.knownProperty = true;
        result.property = entry.mnemonic.toLowerCase();
        result.quantityClass = getQuantityClassForProperty(entry.mnemonic);
        result.propertyTypeId = getPropertyTypeIdForProperty(entry.mnemonic);
      }

      // UOM validation warning
      if (entry.uom && result.quantityClass) {
        const warnings: string[] = [];
        warnings.push(
          `UOM '${entry.uom}' provided - QuantityClass is '${result.quantityClass}'. Verify compatibility.`
        );
        result.warnings = warnings;
      } else if (!result.property) {
        result.warnings = [`Mnemonic '${entry.mnemonic}' not found in PWLS catalog or loaded vendor catalogs`];
      }

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
   * Load an additional vendor curve catalog (PWLS v4 format).
   */
  @Post("catalog")
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
    description: "Loads an additional PWLS v4 vendor curve catalog JSON. Mnemonics accumulate; first-loaded entry wins on collision. SLB catalog is auto-loaded at startup.",
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
