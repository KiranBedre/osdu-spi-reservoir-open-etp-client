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
 * Seismic property-kind validation choke-point.
 *
 * A public, store-free mirror of `/pwls/validate` for the seismic-interpretation
 * domain (§10.4 / §10.6 #4). It canonicalises free-text seismic property kinds
 * against the SDK vocabulary (`src/lib/builders/vocabulary`, in lockstep with
 * `datadef/interpretation/vocab/seismic-property-kinds.*`) *before* they land as
 * RESQML `ContinuousProperty` / `DiscreteProperty` objects — so non-canonical
 * kinds are surfaced (and, with `?strict=true`, rejected) at ingest instead of
 * polluting OSDU.
 *
 * This is deliberately the same shape as `/pwls/validate`: send a batch of
 * entries, get per-entry resolution + warnings and an aggregate summary.
 */

import {
    Body,
    Controller,
    HttpCode,
    Post,
    Query,
    UnprocessableEntityException
} from "@nestjs/common";

import {
    ApiBody,
    ApiDefaultResponse,
    ApiOkResponse,
    ApiOperation,
    ApiProperty,
    ApiPropertyOptional,
    ApiQuery,
    ApiTags,
    ApiUnprocessableEntityResponse
} from "@nestjs/swagger";

import { ArrayMaxSize, IsArray, IsOptional, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

import { errorMessageSchema, swaggerServers } from "../ControllerUtils";
import { resolveSeismicKind } from "../../builders";

// --- DTOs ---

export class SeismicPropertyEntry {
    @IsString()
    @ApiProperty({ example: "RMS velocity", description: "Seismic property kind (canonical name or alias, e.g. 'AI', 'RMS')" })
    kind!: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ example: "m/s", description: "Unit of measurement (optional, checked against the expected UOM for the kind)" })
    uom?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({ example: "AI_cube", description: "Optional caller-side name/label, echoed back for correlation" })
    name?: string;
}

export class SeismicValidationRequestDto {
    @IsArray()
    @ArrayMaxSize(10000)
    @ValidateNested({ each: true })
    @Type(() => SeismicPropertyEntry)
    @ApiProperty({
        type: [SeismicPropertyEntry],
        description: "Seismic property kinds to validate/canonicalise",
        example: [
            { kind: "AI", uom: "kg/(m2.s)", name: "acoustic_impedance" },
            { kind: "RMS", uom: "m/s" },
            { kind: "two-way time", uom: "ms" },
            { kind: "made-up attribute" }
        ]
    })
    properties!: SeismicPropertyEntry[];
}

class SeismicValidationResultEntry {
    @ApiPropertyOptional({ example: "acoustic_impedance" })
    name?: string;

    @ApiProperty({ example: "AI", description: "The original kind as supplied" })
    input!: string;

    @ApiProperty({ example: "acoustic impedance", description: "Canonicalised kind" })
    kind!: string;

    @ApiProperty({ example: true, description: "Whether the (canonicalised) kind is in the vocabulary" })
    canonical!: boolean;

    @ApiProperty({ example: true, description: "Whether the kind is a seismic/geophysical kind" })
    seismic!: boolean;

    @ApiProperty({ example: true, description: "Whether the input was resolved via an alias" })
    matchedAlias!: boolean;

    @ApiPropertyOptional({ example: "kg/(m2.s)", description: "Expected UOM for this kind, if known" })
    expectedUom?: string;

    @ApiPropertyOptional({
        example: ['"AI" matched alias → canonical "acoustic impedance"'],
        description: "Validation warnings"
    })
    warnings?: string[];
}

class SeismicValidationResponseDto {
    @ApiProperty({ example: 4 })
    total!: number;

    @ApiProperty({ example: 3, description: "Entries that resolved to a canonical kind" })
    canonical!: number;

    @ApiProperty({ example: 1, description: "Entries that did not resolve to a canonical kind" })
    nonCanonical!: number;

    @ApiProperty({ example: 2, description: "Entries that carry at least one warning" })
    withWarnings!: number;

    @ApiProperty({ type: [SeismicValidationResultEntry] })
    results!: SeismicValidationResultEntry[];
}

// --- Controller ---

/**
 * Seismic property-kind validation (store-free canonicalisation choke-point).
 */
@ApiTags("Seismic")
@ApiDefaultResponse(errorMessageSchema("Unknown Error", 500))
@Controller("seismic")
export default class SeismicValidateController {
    /**
     * Validate / canonicalise a batch of seismic property kinds.
     *
     * Mirrors `POST /pwls/validate`. With `?strict=true`, any non-canonical kind
     * makes the whole request fail with `422 Unprocessable Entity` (reject at
     * ingest); otherwise the endpoint always returns `200` with per-entry warnings.
     */
    @Post("validate")
    @HttpCode(200)
    @ApiOkResponse({ description: "Validation results", type: SeismicValidationResponseDto })
    @ApiUnprocessableEntityResponse(errorMessageSchema("One or more kinds are non-canonical (strict mode)", 422))
    @ApiBody({ type: SeismicValidationRequestDto })
    @ApiQuery({
        name: "strict",
        required: false,
        type: Boolean,
        description: "When true, reject (422) if any kind is non-canonical instead of warning"
    })
    @ApiOperation({
        summary: "Validate seismic property kinds",
        description:
            "Canonicalises each seismic property kind against the vocabulary (resolving common aliases such as 'AI', 'RMS', 'TWT') and checks any supplied UOM. Use as an ingest-time choke-point before seismic properties land as RESQML objects.",
        security: [],
        servers: swaggerServers
    })
    public validate(
        @Body() body: SeismicValidationRequestDto,
        @Query("strict") strict?: string
    ): SeismicValidationResponseDto {
        const properties = body?.properties ?? [];

        const results: SeismicValidationResultEntry[] = properties.map(entry => {
            const resolution = resolveSeismicKind(entry.kind ?? "", { uom: entry.uom });
            return {
                name: entry.name,
                input: resolution.input,
                kind: resolution.kind,
                canonical: resolution.canonical,
                seismic: resolution.seismic,
                matchedAlias: resolution.matchedAlias,
                expectedUom: resolution.expectedUom,
                warnings: resolution.warnings.length > 0 ? resolution.warnings : undefined
            };
        });

        const canonical = results.filter(r => r.canonical).length;
        const withWarnings = results.filter(r => r.warnings && r.warnings.length > 0).length;

        const isStrict = strict === "true" || strict === "1";
        if (isStrict && canonical !== results.length) {
            const offenders = results.filter(r => !r.canonical).map(r => r.input);
            throw new UnprocessableEntityException(
                `Non-canonical seismic property kind(s): ${offenders.join(", ")}`
            );
        }

        return {
            total: results.length,
            canonical,
            nonCanonical: results.length - canonical,
            withWarnings,
            results
        };
    }
}
