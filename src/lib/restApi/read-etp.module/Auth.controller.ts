// ============================================================================
// Copyright 2019-2022 Emerson Paradigm Holding LLC. All rights reserved.
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

import { Controller, Get } from "@nestjs/common";

import {
  ApiDefaultResponse,
  ApiNotAcceptableResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiTooManyRequestsResponse
} from "@nestjs/swagger";

import { Matches, MaxLength } from "class-validator";

import {
  errorMessageSchema,
  getSchemasForType,
  swaggerServers
} from "../ControllerUtils";

import { XmlUtils } from "../../client/ResqmlClient";
import logging from "../../common/Logging";

const logger = logging.getLogger("EtpClient");

/**
 * Data transfer object representing Json Web Token
 *
 * @export
 * @class TokenDto
 */
export class TokenDto {
  @ApiProperty({
    name: "token",
    description: "JWT token",
    maxLength: 2048,
    pattern: "(^[A-Za-z0-9-_]*.[A-Za-z0-9-_]*.[A-Za-z0-9-_]*$)"
  })
  @MaxLength(2048)
  @Matches(/(^[A-Za-z0-9-_]*\.[A-Za-z0-9-_]*\.[A-Za-z0-9-_]*$)/)
  token!: string;
}

/**
 * Class for service authentication
 *
 * @export
 * @class Authentication
 * @extends {Controller}
 */
@ApiTags("Authentication")
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("/auth")
export default class Authentication {
  /**
   * Get the JWT required to authorize, note that will only work with server started with defaults
   */
  @Get("/token")
  @ApiOkResponse({
    description: "Success",
    schema: getSchemasForType(TokenDto)
  })
  @ApiOkResponse({ description: "Success", type: TokenDto })
  @ApiOperation({
    summary: "Get a default JWT token (local development only).",
    description: `Returns a pre-built JWT token for local development and testing. In production, obtain a bearer token from your identity provider (Azure AD, Google IAM, etc.) instead.`,
    security: [],
    servers: swaggerServers
  })
  public async GetToken(): Promise<TokenDto> {
    logger.info("Processing request for authentication token...");
    const token = XmlUtils.createDefaultJWT();
    logger.info("Authentication token request processed.");
    return { token };
  }
}
