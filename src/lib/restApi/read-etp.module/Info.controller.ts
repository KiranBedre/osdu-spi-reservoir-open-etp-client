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

import { Controller, Get, InternalServerErrorException } from "@nestjs/common";

import {
  ApiDefaultResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from "@nestjs/swagger";

import { errorMessageSchema, getSchemasForType, swaggerServers } from "../ControllerUtils";

import { ClientInfo, ClientInfoDto, collectClientInfo } from "./Health.controller";

/**
 * Service-root `/info` endpoint.
 *
 * The OSDU platform QA checks expect every DDMS to expose
 * `GET /api/<service>/<version>/info` (no token required) returning build
 * metadata. This mirrors `/health/info` at the service root so the Reservoir
 * DDMS is consistent with the other OSDU services.
 *
 * @export
 * @class InfoAPI
 */
@ApiTags("Health")
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller()
export default class InfoAPI {
  /**
   * Return service version and build metadata.
   *
   * @memberof InfoAPI
   */
  @Get("info")
  @ApiOkResponse({
    description: "Success",
    schema: getSchemasForType(ClientInfoDto)
  })
  @ApiInternalServerErrorResponse(errorMessageSchema("Unknown Error"))
  @ApiOperation({
    summary: "Get server version and build metadata.",
    description: `Returns package name, version, git commit hash, commit time, and build time from package.json and git. No authentication required. Use for deployment verification, client compatibility checks, and diagnostics.`,
    security: [],
    servers: swaggerServers
  })
  public Info(): Promise<ClientInfo> {
    return new Promise<ClientInfo>(resolve => {
      try {
        resolve(collectClientInfo());
      } catch (e) {
        throw new InternalServerErrorException({
          description: "Unknown Server Error"
        });
      }
    });
  }
}
