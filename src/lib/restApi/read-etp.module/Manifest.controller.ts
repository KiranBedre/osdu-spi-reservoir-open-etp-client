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
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotAcceptableResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
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
  swaggerServers
} from "../ControllerUtils";

import { datePattern } from "./Resource.controller";

import { decode } from "jsonwebtoken";
import express from "express";
import {
  IsArray,
  IsString,
  IsNotEmpty,
  IsOptional,
  ArrayNotEmpty,
  IsBoolean,
  IsObject,
  ValidateNested,
  Matches
} from "class-validator";
import { Type } from "class-transformer";

import {
  IAcceptableUsage,
  IContact,
  ITechnicalAssurance,
  OSDUContext
} from "../../jsonTypes/OsduContext";
import { createManifest } from "../../jsonTypes/Manifest";
import { JwtPayload } from "jsonwebtoken";
import { bigIntToString } from "../../mlTypes/XmlJsonUtil";
import logging from "../../common/Logging";

const logger = logging.getLogger("EtpClient");

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
    description: `Energistics types to restrict search against when indexing entire dataspaces, accept * and . wildcard.`,
    example: ["resqml20.obj_*Representation"],
    pattern: `${patternString(/^[0-9a-zA-Z._*?]+$/)}`
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  typePatterns?: string[];

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
}

/**
 * Describe the Rest information of an eml object
 *
 * @export
 * @class ManifestDto
 */
export class ManifestDto {
  @ApiProperty({
    name: "kind",
    pattern: patternString(/osdu:wks:Manifest:1.0.0/),
    example: `osdu:wks:Manifest:1.0.0`,
    description:
      "The schema identification for the manifest record. It is constrained to be version 1.0.0 in the context of this endpoint.",
    maxLength: 23
  })
  id!: string;
}

@ApiBearerAuth("access-token")
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
@ApiTags("Manifest")
@ApiUnauthorizedResponse(errorMessageSchema("Unauthorized", 401))
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("manifests")
export default class ObjectsManifestAPI {
  @Post("build")
  @ApiBody({
    type: ManifestInputDto
  })
  @ApiOperation({
    summary: "Create OSDU manifest.",
    description: `Create the OSDU manifest for several resources.`,
    servers: swaggerServers
  })
  @ApiOkResponse({
    description: "Success",
    type: ManifestDto
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

    let c = undefined;
    try {
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
        body.createMissingReferences
      );

      context.bearer = bearer;

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
      c = await createSession(bearer, partition);
      const b = await createManifest(
        c,
        body.uris ?? [],
        context,
        body.typePatterns,
        maxManifestSize
      );
      logger.info("Manifest creation successful.");
      await c.closeSession();
      c = undefined;
      res.send(JSON.stringify(b, bigIntToString, 2));
    } catch (err) {
      logger.error("Error occurred during manifest creation.");
      c?.closeSession();
      throw httpErrorFromEtpError(err);
    }
  }
}
