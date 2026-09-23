// ============================================================================
// Copyright 2019-2021 Emerson Paradigm Holding LLC. All rights reserved.
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
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
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
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse
} from "@nestjs/swagger";

import {
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
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import { datePattern } from "./Resource.controller";

import { decode } from "jsonwebtoken";
import express from "express";
import { randomUUID } from "crypto";
import {
  IsArray,
  IsString,
  IsNotEmpty,
  IsOptional,
  ArrayNotEmpty,
  IsBoolean,
  IsObject,
  ValidateNested,
  Matches,
  IsIn
} from "class-validator";
import { Type } from "class-transformer";

import {
  IAcceptableUsage,
  IContact,
  ITechnicalAssurance,
  OSDUContext
} from "../../jsonTypes/OsduContext";
import {
  createManifest,
  DEFAULT_DATASPACE_TYPE_PATTERNS,
  estimateManifestInputCount,
  PropertyFilter
} from "../../jsonTypes/Manifest";
import { JwtPayload } from "jsonwebtoken";
import { bigIntToString } from "../../mlTypes/XmlJsonUtil";
import logging from "../../common/Logging";

const logger = logging.getLogger("EtpClient");

/**
 * In-memory registry for asynchronous manifest builds.
 *
 * Large dataspaces (e.g. demo/Volve) can take longer than the ~60s edge/load
 * balancer timeout that fronts the platform ingress, so the synchronous
 * `POST /manifests/build` connection is cut before the build returns. The async
 * variant returns 202 immediately with a `jobId`, runs the build in-process
 * (no HTTP timeout applies once the response has been sent), and exposes the
 * result/diagnostics/error through `GET /manifests/jobs/{jobId}`.
 *
 * NOTE: the registry is per-process. When the gateway runs multiple replicas,
 * a status poll must reach the same replica that accepted the build (sticky
 * routing) or it will 404. This DDMS is single-replica on the current
 * deployments; a shared store would be required to relax that.
 */
interface ManifestBuildJob {
  jobId: string;
  status: "running" | "completed" | "failed";
  createdAt: number;
  finishedAt?: number;
  partition: string;
  requestedBy?: string;
  uris?: string[];
  durationMs?: number;
  result?: unknown;
  diagnostics?: unknown;
  error?: string;
}

const MANIFEST_JOBS = new Map<string, ManifestBuildJob>();
// Retain completed jobs for 30 minutes so a client has time to poll + download.
const MANIFEST_JOB_TTL_MS = 30 * 60 * 1000;
// Hard cap on retained jobs (each may hold a multi-MB manifest) - evict oldest
// finished jobs beyond this to bound memory.
const MANIFEST_JOB_MAX = 50;

// Auto-async threshold: unless a caller sets `async:true`, a build whose
// filtered input-resource count reaches this many resources is run
// asynchronously so it is not cut by the ~60s edge/LB request timeout. The
// count uses the SAME filter as the build (see estimateManifestInputCount), so
// a Dani-sized dataspace (~938) stays synchronous while a Volve-sized one
// (~3520) auto-switches to a 202 job. Override with MANIFEST_ASYNC_AUTO_MIN_RESOURCES.
const MANIFEST_ASYNC_AUTO_MIN_RESOURCES =
  Number(process.env.MANIFEST_ASYNC_AUTO_MIN_RESOURCES) || 1000;

/** Drop TTL-expired jobs and enforce the size cap (oldest finished first). */
function evictManifestJobs(): void {
  const now = Date.now();
  for (const [id, j] of MANIFEST_JOBS) {
    if (j.finishedAt !== undefined && now - j.finishedAt > MANIFEST_JOB_TTL_MS) {
      MANIFEST_JOBS.delete(id);
    }
  }
  if (MANIFEST_JOBS.size > MANIFEST_JOB_MAX) {
    const finished = Array.from(MANIFEST_JOBS.values())
      .filter(j => j.finishedAt !== undefined)
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    for (const j of finished) {
      if (MANIFEST_JOBS.size <= MANIFEST_JOB_MAX) break;
      MANIFEST_JOBS.delete(j.jobId);
    }
  }
}

const emailPattern =
  /^[a-zA-Z0-9_+&*-]+(?:\.[a-zA-Z0-9_+&*-]+)*@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,7}$/;

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

class Contact implements IContact {
  EmailAddress?: string;
  PhoneNumber?: string;
  RoleTypeID?: string;
  DataGovernanceRoleTypeID?: string;
  WorkflowPersonaTypeID?: string;
  OrganisationID?: string;
  Name?: string;
}

class AcceptableUsage implements IAcceptableUsage {
  WorkflowUsage?: string;
  WorkflowPersona?: string;
}
class TechnicalAssurance implements ITechnicalAssurance {
  AcceptableUsage?: AcceptableUsage[];
  Comment?: string;
  EffectiveDate?: Date;
  Reviewers?: Contact[];
  TechnicalAssuranceTypeID: string = "";
  UnacceptableUsage?: AcceptableUsage[];
}

export class ContactDto implements IContact {
  @ApiPropertyOptional({
    name: "EmailAddress",
    type: String,
    maxLength: 2048,
    description:
      "Contact email address. Property may be left empty where it is inappropriate to provide personally identifiable information.",
    example: "user@mycompany.com",
    pattern: patternString(emailPattern)
  })
  EmailAddress?: string;

  @ApiPropertyOptional({
    name: "PhoneNumber",
    type: String,
    maxLength: 2048,
    description:
      "Contact phone number. Property may be left empty where it is inappropriate to provide personally identifiable information.",
    example: "1-555-281-5555",
    pattern: patternString(/[0-9-]+/)
  })
  PhoneNumber?: string;

  @ApiPropertyOptional({
    name: "RoleTypeID",
    type: String,
    maxLength: 2048,
    description:
      "The identifier of a reference value for the role of the contact within the associated organization, such as Account owner, Sales Representative, Technical Support, Project Manager, Party Chief, Client Representative, Senior Observer.",
    example: `${partitionId}:reference-data--ContactRoleType:Geologist:`,
    pattern: patternString(
      /^[\\w\\-\\.]+:reference-data\\-\\-ContactRoleType:[\\w\\-\\.\\:\\%]+:[0-9]*$/
    )
  })
  RoleTypeID?: string;

  @ApiPropertyOptional({
    name: "DataGovernanceRoleTypeID",
    type: String,
    maxLength: 2048,
    description:
      "The data governance role assigned to this contact if and only if the context has a data governance role (in context of TechnicalAssurance). The value is kept absent in all other cases.",
    example: `${partitionId}:reference-data--DataGovernanceRoleType:Reviewer:`,
    pattern: patternString(
      /^[\\w\\-\\.]+:reference-data\\-\\-DataGovernanceRoleType:[\\w\\-\\.\\:\\%]+:[0-9]*$/
    )
  })
  DataGovernanceRoleTypeID?: string;

  @ApiPropertyOptional({
    name: "WorkflowPersonaTypeID",
    type: String,
    maxLength: 2048,
    description:
      "The persona in context of workflows associated with this contact, as used in TechnicalAssurance.",
    example: `${partitionId}:reference-data--WorkflowPersonaType:Reviewer:`,
    pattern: patternString(
      /^[\\w\\-\\.]+:reference-data\\-\\-WorkflowPersonaType:[\\w\\-\\.\\:\\%]+:[0-9]*$/
    )
  })
  WorkflowPersonaTypeID?: string;

  @ApiPropertyOptional({
    name: "OrganisationID",
    type: String,
    maxLength: 2048,
    description: "Reference to the company the contact is associated with.",
    example: `${partitionId}:master-data--Organisation:MyCompany:`,
    pattern: patternString(
      /^[\\w\\-\\.]+:master-data\\-\\-Organisation:[\\w\\-\\.\\:\\%]+:[0-9]*$/
    )
  })
  OrganisationID?: string;

  @ApiPropertyOptional({
    name: "Name",
    type: String,
    maxLength: 2048,
    description:
      "Name of the individual contact. Property may be left empty where it is inappropriate to provide personally identifiable information.",
    example: "Evergreen",
    pattern: patternString(/^[a-zA-Z ]*$/)
  })
  Name?: string;
}

export class AcceptableUsageDto implements IAcceptableUsage {
  @ApiPropertyOptional({
    name: "WorkflowUsage",
    type: String,
    description:
      "Name of the business activities, processes, and/or workflows that the record is technical assurance value is valid for.",
    example: `${partitionId}:reference-data--WorkflowUsageType:SeismicProcessing:`,
    pattern: patternString(
      /^[\\w\\-\\.]+:reference-data\\-\\-WorkflowUsageType:[\\w\\-\\.\\:\\%]+:[0-9]*$/
    )
  })
  WorkflowUsage?: string;

  @ApiPropertyOptional({
    name: "WorkflowPersona",
    type: String,
    description:
      "Name of the role or personas that the record is technical assurance value is valid for.",
    example: `${partitionId}:reference-data--WorkflowPersonaType:SeismicProcessor:`,
    pattern: patternString(
      /^[\\w\\-\\.]+:reference-data\\-\\-WorkflowPersonaType:[\\w\\-\\.\\:\\%]+:[0-9]*$/
    )
  })
  WorkflowPersona?: string;
}

export class TechnicalAssuranceDto implements ITechnicalAssurance {
  @ApiPropertyOptional({
    name: "AcceptableUsage",
    type: [AcceptableUsageDto],
    maxItems: 99999,
    description:
      'Describes the workflows and/or personas that the technical assurance value is valid for (e.g., This data has a technical assurance property of "trusted" and it is suitable for Seismic Interpretation).'
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcceptableUsageDto)
  AcceptableUsage?: AcceptableUsageDto[];

  @ApiPropertyOptional({
    name: "Comment",
    description:
      "Any additional context to support the determination of technical assurance",
    example: "This is free form text from reviewer, e.g. restrictions on use",
    pattern: patternString(
      /^[\\w\\-\\.]+:reference-data\\-\\-TechnicalAssuranceType:[\\w\\-\\.\\:\\%]+:[0-9]*$/
    ),
    maxLength: 2048
  })
  Comment?: string;

  @ApiPropertyOptional({
    name: "EffectiveDate",
    pattern: patternString(datePattern),
    example: `2022-01-12`,
    maxLength: 2048,
    description:
      "Date when the technical assurance determination for this record has taken place"
  })
  EffectiveDate?: Date;

  @ApiPropertyOptional({
    name: "Reviewers",
    description:
      "The individuals, or roles, that reviewed and determined the technical assurance value",
    type: [ContactDto],
    maxItems: 99999
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  Reviewers?: ContactDto[];

  @ApiProperty({
    name: "TechnicalAssuranceTypeID",
    description:
      'Describes a master-data record\'s overall suitability for general business consumption based on data quality. Clarifications: Since Certified is the highest classification of suitable quality, any further change or versioning of a Certified record should be carefully considered and justified. If a Technical Assurance value is not populated then one can assume the data has not been evaluated or its quality is unknown (=Unevaluated). Technical Assurance values are not intended to be used for the identification of a single "preferred" or "definitive" record by comparison with other records.',
    example: `${partitionId}:reference-data--TechnicalAssuranceType:Certified:`,
    pattern: patternString(/^[0-9a-zA-Z /(),.]+$/),
    maxLength: 2048
  })
  TechnicalAssuranceTypeID!: string;

  @ApiPropertyOptional({
    name: "UnacceptableUsage",
    type: [AcceptableUsageDto],
    maxItems: 99999,
    description:
      'Describes the workflows and/or personas that the technical assurance value is not valid for (e.g., This data has a technical assurance property of "trusted", but it is not suitable for Seismic Interpretation).'
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AcceptableUsageDto)
  UnacceptableUsage?: AcceptableUsageDto[];
}

/**
 * Represents the input for manifest creation
 *
 * @export
 * @class ManifestInputDto
 */
export class ManifestInputDto {
  @ApiProperty({
    name: "uris",
    type: [String],
    maxItems: 99999,
    maxLength: 2048,
    description: `Uris of resources or dataspaces to generate a manifest for.`,
    example: [
      "eml:///dataspace('demo/Volve')/resqml20.obj_TriangulatedSetRepresentation(a3f31b20-c93a-4682-8f6c-71be087202a4)",
      "eml:///dataspace('demo/Volve')/resqml20.obj_ContinuousProperty(1615d8d2-2a2d-482c-885e-14225b89e90c)"
    ]
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  uris!: string[];

  @ApiPropertyOptional({
    name: "typePatterns",
    type: [String],
    maxItems: 99999,
    maxLength: 2048,
    description: `Optional filter restricting NON-property types when indexing entire dataspaces (accepts * and ? wildcards). When omitted, a curated M26 default set is used: ["*Feature","*Interpretation*","*Representation","*StratigraphicColumn","*Activity*","*Collection","witsml21.*"] (top-level types only). Pass ["*"] to include EVERY type. CRS objects are always included regardless of this filter.`,
    example: ["resqml20.obj_*Representation"],
    pattern: `${patternString(/^[0-9a-zA-Z._*?]+$/)}`
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  typePatterns?: string[];

  @ApiPropertyOptional({
    name: "propertyFilter",
    type: String,
    enum: ["canonical", "none", "all"],
    description: `Controls property inclusion, independent of typePatterns. "none" (default): exclude all properties (fastest — keeps whole-dataspace builds under the ~60s ingress timeout). "canonical": include only properties with standard names (PWLS, OSDU, simulator abbreviations like PORO, PERMX, SW). "all": include every property. Combine with typePatterns to build presets, e.g. all types + all properties (typePatterns:["*"] + propertyFilter:"all").`,
    example: "none"
  })
  @IsOptional()
  @IsString()
  @IsIn(["canonical", "none", "all"])
  propertyFilter?: PropertyFilter;

  @ApiPropertyOptional({
    name: "excludePatterns",
    type: [String],
    maxItems: 99999,
    maxLength: 2048,
    description: `Optional list of type patterns (accepts * and ? wildcards) that HARD-exclude matching types, applied before every inclusion rule except CRS (always kept). Use to drop noisy/low-value types that would otherwise bloat the manifest or introduce dangling references, e.g. ["*Activity","*ActivityTemplate"] (Activity records reference every property they consumed, which become dangling when propertyFilter="canonical"), or ["*GridConnectionSet"] when connection-set counts explode.`,
    example: ["*Activity", "*ActivityTemplate"],
    pattern: `${patternString(/^[0-9a-zA-Z._*?]+$/)}`
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  excludePatterns?: string[];

  @ApiPropertyOptional({
    name: "technicalAssurances",
    type: [TechnicalAssuranceDto],
    maxItems: 1028,
    description: `Technical Assurance information.`
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TechnicalAssuranceDto)
  technicalAssurances?: TechnicalAssuranceDto[];

  @ApiPropertyOptional({
    name: "createMissingReferences",
    description: `If true, an entry corresponding to all references not currently present in OSDU storage will be added, else missing references will be added to an error list.`,
    type: Boolean,
    example: true
  })
  @IsOptional()
  @IsBoolean()
  createMissingReferences?: boolean = true;

  @ApiPropertyOptional({
    name: "tags",
    description: `OSDU tags information to apply.`,
    type: Object,
    example: {
      key1: "value1",
      key2: "value2"
    },
    additionalProperties: {
      type: "string",
      maxLength: 2048,
      pattern: patternString(/^[a-zA-Z0-9_]+$/)
    }
  })
  @IsOptional()
  @IsObject()
  tags?: Record<string, string>;

  @ApiPropertyOptional({
    name: "includeArrayData",
    description: `When true, read bulk data arrays during manifest generation to compute spatial bounding boxes and active cell counts. When false (default), skip array reads for faster performance at the cost of missing SpatialArea and ActiveCellCount fields.`,
    type: Boolean,
    example: false
  })
  @IsOptional()
  @IsBoolean()
  includeArrayData?: boolean = false;

  @ApiPropertyOptional({
    name: "async",
    description: `Controls synchronous vs asynchronous build. When \`true\`, the request returns \`202 Accepted\` with a \`jobId\` immediately and the build continues in-process, so it is not bound by the ~60s edge/load-balancer request timeout that fronts the platform ingress; poll \`GET /manifests/jobs/{jobId}\` for status and, once \`completed\`, the manifest + build diagnostics. When OMITTED or \`false\` (default), the mode is chosen automatically: a cheap pre-count of filtered input resources selects async for large dataspaces (>= ${MANIFEST_ASYNC_AUTO_MIN_RESOURCES} resources, e.g. Volve) so they never hit the timeout, and returns the manifest synchronously in the response body for smaller ones (e.g. Dani). There is no "force synchronous" mode: forcing sync on a large dataspace would only guarantee a timeout, so \`false\` behaves the same as omitted. Use \`true\` when you always want a job handle regardless of size.`,
    type: Boolean,
    example: false
  })
  @IsOptional()
  @IsBoolean()
  async?: boolean;

  @ApiPropertyOptional({
    name: "schemaCompat",
    description: `Opt-in (default OFF, M26 behaviour). Controls the schema-compatibility pass that resolves each record's kind against the target OSDU schema service and remaps/normalizes it to a registered kind (maximizes ingestibility). Omit or set \`false\` (default) to SKIP it for a faster M26-style build — every record keeps its original kind, which the target OSDU may not have registered, so ingestion could reject them. Set \`true\` to RUN the pass; when forced on it is still auto-skipped for very large datasets (assembled record count over \`MANIFEST_SCHEMA_COMPAT_MAX_RECORDS\`, default 500) because the per-kind schema-service round-trips can push the build past the ~60s edge/load-balancer timeout that fronts the platform ingress.`,
    type: Boolean,
    example: false
  })
  @IsOptional()
  @IsBoolean()
  schemaCompat?: boolean;
}

/**
 * Describe the Rest information of an eml object
 *
 * @export
 * @class ManifestDto
 */
export class ManifestDataDto {
  @ApiPropertyOptional({
    name: "Datasets",
    description: "Array of dataset records.",
    type: [Object]
  })
  Datasets?: object[];

  @ApiPropertyOptional({
    name: "WorkProduct",
    description: "Array of work-product records.",
    type: [Object]
  })
  WorkProduct?: object[];

  @ApiPropertyOptional({
    name: "WorkProductComponents",
    description: "Array of work-product-component records.",
    type: [Object]
  })
  WorkProductComponents?: object[];
}

export class ManifestDto {
  @ApiProperty({
    name: "kind",
    pattern: patternString(/osdu:wks:Manifest:1.0.0/),
    example: `osdu:wks:Manifest:1.0.0`,
    description:
      "The schema identification for the manifest record. It is constrained to be version 1.0.0 in the context of this endpoint.",
    maxLength: 23
  })
  kind!: string;

  @ApiPropertyOptional({
    name: "Data",
    description: "Container for Datasets, WorkProduct, and WorkProductComponents.",
    type: ManifestDataDto
  })
  Data?: ManifestDataDto;

  @ApiPropertyOptional({
    name: "MasterData",
    description: "Array of master-data records (Well, Wellbore, BoundaryFeature, etc.).",
    type: [Object]
  })
  MasterData?: object[];

  @ApiPropertyOptional({
    name: "ReferenceData",
    description: "Array of reference-data records (PropertyType, CRS, UOM, etc.).",
    type: [Object]
  })
  ReferenceData?: object[];
}

@ApiBearerAuth("HTTPBearer")
@UseGuards(HasBearerGuard("jwt"))
@ApiHeader({
  name: "data-partition-id",
  description: "Data partition id",
  schema: {
    type: "string",
    example: partitionId,
    maxLength: 1048,
    pattern: patternString(partitionPattern)
  }
})
@UseGuards(HasDataPartitionGuard())
@ApiHeader({
  name: "x-collaboration",
  required: false,
  description: "Optional collaboration context forwarded to OSDU storage services (JSON string).",
  schema: {
    type: "string"
  }
})
@ApiTags("Manifest")
@ApiUnauthorizedResponse(errorMessageSchema("Unauthorized", 401))
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiGoneResponse(webSocketSessionTerminatedSchema())
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("manifests")
export default class ObjectsManifestAPI {
  @Post("build")
  @ApiBody({
    type: ManifestInputDto
  })
  @ApiOperation({
    summary: "Build OSDU manifest from ETP resources",
    description: `Generate an OSDU-compatible manifest from ETP dataspace resources. Converts RESQML, WITSML, PRODML, and EML objects to OSDU record format.

**Supported source domains**: RESQML 2.0.1 & 2.2, PRODML 2.3, WITSML 2.1, EML 2.3. Use \`GET /health/converters\` to list all registered mappings.

**Type filtering**: By DEFAULT a curated discovery set is emitted (M26 behaviour): top-level types (features, interpretations, representations, stratigraphic columns, activities, collections, WITSML 2.1) with NO properties and CRS always included. Two independent controls override this:
- \`typePatterns\`: restrict/expand NON-property types. Pass \`["*"]\` to include EVERY type.
- \`propertyFilter\`: \`none\` (default, exclude properties) | \`canonical\` (only standard-named properties like PORO/PERMX/SW) | \`all\` (every property).

To reproduce the M27 "everything" build, pass \`typePatterns: ["*"]\` and \`propertyFilter: "all"\`. CRS objects are always included regardless of the filter.

**Key behaviors**:
- Best-effort mode - partial results returned on converter errors (check \`errors[]\` in response)
- Auto-generates deterministic collaboration UUID (v5 from dataspace name)
- Uses \`OSDU_MILESTONE\` env var (default M27) for OSDU schema versions
- GridConnectionSet records report \`HasTransmissibilityMultipliers\` when attached transmissibility properties are found
- WellLog records populate TopMeasuredDepth/BottomMeasuredDepth from frame index arrays

**createMissingReferences**: When true, creates placeholder records for unresolved data object references (DORs). When false, missing references appear in the error list.`,
    servers: swaggerServers
  })
  @ApiOkResponse({
    description: "Success",
    type: ManifestDto
  })
  @ApiResponse({
    status: 202,
    description:
      "Accepted (async:true). Body contains { jobId, status, statusUrl }. Poll GET /manifests/jobs/{jobId}."
  })
  public async GetManifest(
    @Body() body: ManifestInputDto,
    @Req() request: express.Request,
    @Res() res: express.Response
  ): Promise<void> {
    logger.info("Received request to create OSDU manifest.");
    res.set("Content-Type", "application/json");

    if (!body.uris) {
      throw new BadRequestException({
        description: "Request body must include a non-empty 'uris' array"
      });
    }

    // Decide sync vs async. `async:true` forces asynchronous (always returns a
    // job handle). Otherwise (omitted OR false) the mode is auto-selected: a
    // cheap pre-count of the filtered input switches large dataspaces
    // (>= MANIFEST_ASYNC_AUTO_MIN_RESOURCES) to async so the build is not cut
    // by the ~60s edge/LB request timeout, while smaller ones run synchronously
    // and return the manifest inline. Forcing sync is intentionally NOT offered:
    // it would only guarantee a timeout on large dataspaces. A pre-count failure
    // falls back to synchronous (safe for the small inputs that reach here).
    let useAsync = body.async === true;
    if (body.async !== true) {
      try {
        const estimated = await this.estimateInputSize(body, request);
        useAsync = estimated >= MANIFEST_ASYNC_AUTO_MIN_RESOURCES;
        logger.info(
          `[manifest] auto-mode: ${estimated} filtered resources -> ${
            useAsync ? "async" : "sync"
          } (threshold ${MANIFEST_ASYNC_AUTO_MIN_RESOURCES})`
        );
      } catch (err) {
        logger.warn(
          `[manifest] auto-mode pre-count failed, defaulting to sync: ${
            (err as { message?: string })?.message ?? String(err)
          }`
        );
      }
    }

    // Async mode: register a job, return 202 with a jobId immediately, and
    // continue the build in-process so it is not bound by the ~60s edge/LB
    // request timeout. Poll GET /manifests/jobs/{jobId}.
    if (useAsync) {
      const bearer = extractToken(request);
      const jwt = bearer ? (decode(bearer) as JwtPayload) : {};
      const partition = extractDataPartitionId(request);
      const partitionStr = typeof partition === "string" ? partition : "osdu";
      const requestedBy =
        jwt === null || typeof jwt === "string" ? undefined : jwt.unique_name;

      const jobId = randomUUID();
      const job: ManifestBuildJob = {
        jobId,
        status: "running",
        createdAt: Date.now(),
        partition: partitionStr,
        requestedBy,
        uris: body.uris
      };
      MANIFEST_JOBS.set(jobId, job);
      evictManifestJobs();

      // Fire-and-forget: the build continues after the 202 response is sent, so
      // it is not bound by the edge/LB request timeout. Any error is captured
      // into the job record; the promise is deliberately not awaited.
      void this.runManifestBuildJob(job, body, request);

      res.status(202).json({
        jobId,
        status: job.status,
        statusUrl: `manifests/jobs/${jobId}`
      });
      return;
    }

    try {
      const { manifest, diagnostics } = await this.buildManifestFromBody(
        body,
        request
      );
      // Echo build diagnostics (non-enumerable, so absent from the body) in a
      // response header. This makes an empty/degraded manifest self-explaining
      // even when server logs are unreachable (e.g. cimpl pods) - the header
      // reports input/created/skip/convert-failed counts and the dominant
      // failing types without altering the schema-compliant manifest body.
      if (diagnostics !== undefined) {
        try {
          res.set("X-Manifest-Build-Diagnostics", JSON.stringify(diagnostics));
        } catch {
          // Never let header serialization break the response.
        }
      }
      res.send(JSON.stringify(manifest, bigIntToString, 2));
    } catch (err) {
      logger.error("Error occurred during manifest creation.");
      throw httpErrorFromEtpError(err);
    }
  }

  /**
   * Shared build path used by both the synchronous `POST /manifests/build`
   * and its asynchronous mode (`POST /manifests/build` with `async: true`).
   * Owns the ETP session lifecycle (always closed via `finally`) and returns
   * the built manifest together with its non-enumerable build diagnostics.
   */
  private async buildManifestFromBody(
    body: ManifestInputDto,
    request: express.Request
  ): Promise<{ manifest: unknown; diagnostics: unknown }> {
    logger.info("Initializing manifest creation process.");
    let maxManifestSize = 1000;

    // Reduce the manifest size for browsers
    const userAgent = request.headers["user-agent"];
    if (
      userAgent?.includes("Mozilla") ||
      userAgent?.includes("Chrome") ||
      userAgent?.includes("Safari")
    ) {
      maxManifestSize = 1;
      logger.info("Detected browser user-agent, reducing manifest size.");
    }
    const bearer = extractToken(request);
    const jwt = bearer ? (decode(bearer) as JwtPayload) : {};
    const partition = extractDataPartitionId(request);

    logger.info(`Extracted partition ID: ${partition}`);
    const context = new OSDUContext(
      typeof partition === "string" ? partition : "osdu",
      jwt === null || typeof jwt === "string" ? undefined : jwt.unique_name,
      body.tags,
      body.createMissingReferences,
      body.includeArrayData
    );

    context.bearer = bearer;

    if (body.schemaCompat !== undefined) {
      context.schemaCompat = body.schemaCompat;
    }

    // Remove the "array" part of the technical assurances to convert to internal representation
    if (body.technicalAssurances !== undefined) {
      context.technicalAssurances = body.technicalAssurances.map(ta => {
        const nta = { ...ta };
        if (ta.AcceptableUsage !== undefined) {
          nta.AcceptableUsage = ta.AcceptableUsage.map(au => ({ ...au }));
        }
        if (ta.Reviewers !== undefined) {
          nta.Reviewers = ta.Reviewers.map(r => ({ ...r }));
        }
        if (ta.UnacceptableUsage !== undefined) {
          nta.UnacceptableUsage = ta.UnacceptableUsage.map(au => ({ ...au }));
        }
        return nta;
      });
    }

    logger.debug("Creating session.");
    const c = await createSession(bearer, partition);
    try {
      const b = await createManifest(
        c,
        body.uris ?? [],
        context,
        body.typePatterns ?? DEFAULT_DATASPACE_TYPE_PATTERNS,
        maxManifestSize,
        body.propertyFilter ?? "none",
        body.excludePatterns
      );
      logger.info("Manifest creation successful.");
      return {
        manifest: b,
        diagnostics: (b as { __buildDiagnostics?: unknown }).__buildDiagnostics
      };
    } finally {
      await c.closeSession();
    }
  }

  /**
   * Cheap pre-flight resource count used to auto-select sync vs async when the
   * caller omits `async`. Opens its own short-lived ETP session, applies the
   * same type/property/exclude filter the build will use, and returns the
   * number of input resources. Whole-dataspace URIs cost one discovery
   * round-trip each; explicit object URIs incur no network call.
   */
  private async estimateInputSize(
    body: ManifestInputDto,
    request: express.Request
  ): Promise<number> {
    const bearer = extractToken(request);
    const partition = extractDataPartitionId(request);
    const c = await createSession(bearer, partition);
    try {
      return await estimateManifestInputCount(
        c,
        body.uris ?? [],
        body.typePatterns ?? DEFAULT_DATASPACE_TYPE_PATTERNS,
        body.propertyFilter ?? "none",
        body.excludePatterns
      );
    } finally {
      await c.closeSession();
    }
  }

  /** Background worker for an async manifest build - never throws. */
  private async runManifestBuildJob(
    job: ManifestBuildJob,
    body: ManifestInputDto,
    request: express.Request
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const { manifest, diagnostics } = await this.buildManifestFromBody(
        body,
        request
      );
      job.result = manifest;
      job.diagnostics = diagnostics;
      job.status = "completed";
      logger.info(`[manifest-async] job ${job.jobId} completed.`);
    } catch (err) {
      job.status = "failed";
      job.error = (err as { message?: string })?.message ?? String(err);
      logger.error(`[manifest-async] job ${job.jobId} failed: ${job.error}`);
    } finally {
      job.finishedAt = Date.now();
      job.durationMs = job.finishedAt - t0;
      evictManifestJobs();
    }
  }

  @Get("jobs/:jobId")
  @ApiParam({
    name: "jobId",
    description: "Job id returned by POST /manifests/build with async:true."
  })
  @ApiOperation({
    summary: "Get the status/result of an async manifest build",
    description: `Returns the current state of an async manifest build started via \`POST /manifests/build\` with \`async: true\`.

- \`status: "running"\` - build in progress; poll again.
- \`status: "completed"\` - includes \`manifest\` and \`diagnostics\`.
- \`status: "failed"\` - includes \`error\`.

Build diagnostics are also echoed in the \`X-Manifest-Build-Diagnostics\` response header when available.`,
    servers: swaggerServers
  })
  @ApiOkResponse({ description: "Job status (and manifest when completed)." })
  public async GetManifestJob(
    @Param("jobId") jobId: string,
    @Res() res: express.Response
  ): Promise<void> {
    const job = MANIFEST_JOBS.get(jobId);
    if (job === undefined) {
      throw new NotFoundException({
        description: `No manifest job '${jobId}' (unknown, expired, or handled by another replica)`
      });
    }

    res.set("Content-Type", "application/json");
    if (job.diagnostics !== undefined) {
      try {
        res.set("X-Manifest-Build-Diagnostics", JSON.stringify(job.diagnostics));
      } catch {
        // Never let header serialization break the response.
      }
    }

    const payload: Record<string, unknown> = {
      jobId: job.jobId,
      status: job.status,
      createdAt: new Date(job.createdAt).toISOString(),
      finishedAt:
        job.finishedAt !== undefined
          ? new Date(job.finishedAt).toISOString()
          : undefined,
      durationMs: job.durationMs,
      partition: job.partition,
      requestedBy: job.requestedBy,
      uris: job.uris
    };
    if (job.status === "completed") {
      payload.diagnostics = job.diagnostics;
      payload.manifest = job.result;
    } else if (job.status === "failed") {
      payload.error = job.error;
    }

    res.status(200).send(JSON.stringify(payload, bigIntToString, 2));
  }
}
