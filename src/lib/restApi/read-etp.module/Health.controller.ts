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
  ApiNotAcceptableResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiTooManyRequestsResponse
} from "@nestjs/swagger";

import {
  errorMessageSchema,
  getSchemasForType,
  patternString,
  swaggerServers
} from "../ControllerUtils";

import {
  etpServerHost,
  etpServerPath,
  etpServerPort,
  etpServerProtocol
} from "../../common/config";

import http from "http";
import https from "https";

import fs from "fs";
import * as child_process from "child_process";

interface ClientInfo {
  groupId: string;
  artifactId: string;
  version: string;
  commitId: string;
  commitTime: string;
  buildTime?: string;
}

export class ClientInfoDto {
  @ApiProperty({
    name: "groupId",
    example: "org.opengroup.osdu",
    maxLength: 2048,
    pattern: patternString(/^[0-9a-zA-Z.]+$/)
  })
  groupId!: string;
  @ApiProperty({
    name: "artifactId",
    example: "@osdu/open-etp-client",
    maxLength: 2048,
    pattern: patternString(/^[0-9a-zA-Z@\-/]+$/)
  })
  artifactId!: string;
  @ApiProperty({
    name: "version",
    example: "1.0.1",
    maxLength: 2048,
    pattern: patternString(/^[0-9.]+$/)
  })
  version!: string;
  @ApiProperty({
    name: "commitId",
    example: "1.0.1",
    maxLength: 2048,
    pattern: patternString(/^[0-9a-fA-F]+$/)
  })
  commitId!: string;
  @ApiProperty({
    name: "commitTime",
    example: "2023-07-24 20:53:33 -0500",
    maxLength: 2048,
    pattern: patternString(/^[0-9a-zA-Z \-:]+$/)
  })
  commitTime!: string;
  @ApiProperty({
    name: "buildTime",
    example: "2023-07-24 20:53:33 -0500",
    maxLength: 2048,
    pattern: patternString(/^[0-9a-zA-Z \-:]+$/)
  })
  buildTime!: string;
}

/**
 * Class for checking service health
 *
 * @export
 * @class HealthAPI
 */
@ApiTags("Health")
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiNotAcceptableResponse(errorMessageSchema("Not acceptable response", 406))
@ApiTooManyRequestsResponse(errorMessageSchema("Too many request", 429))
@ApiDefaultResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("health")
export default class HealthAPI {
  /**
   * Checking service readiness and access to underlying data repository
   *
   * @memberof HealthAPI
   */
  @Get("readiness")
  @ApiOkResponse({ description: "Success", type: Boolean })
  @ApiInternalServerErrorResponse(errorMessageSchema("Unknown Error"))
  @ApiOperation({
    summary: "Check readiness (ETP backend connectivity).",
    description: `Returns true if the underlying ETP WebSocket server is reachable and accepting connections. Returns 500 if the ETP server cannot be contacted.\n\n**Use case**: Kubernetes readiness probe - the pod is removed from service endpoints while the ETP backend is unreachable.`,
    security: [],
    servers: swaggerServers
  })
  public IsReady(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const prot = etpServerProtocol === "wss" ? https : http;
        const url = `${etpServerProtocol === "wss" ? "https" : "http"
          }://${etpServerHost}:${etpServerPort}${etpServerPath}/.well-known/etp-server-capabilities?GetVersion=etp12.energistics.org`;
        const req = prot
          .get(url, response => {
            if (response.statusCode === 200 || response.statusCode === 301) {
              resolve(true);
            } else {
              throw new InternalServerErrorException({
                description: "Server not available"
              });
            }
          })
          .on("error", () => {
            reject("Server not available");
          });
        req.end();
      } catch (e) {
        throw new InternalServerErrorException({
          description: "Unknown Server Error"
        });
      }
    });
  }

  /**
   * Checking service liveness
   *
   * @memberof HealthAPI
   */
  @Get("liveness")
  @ApiOkResponse({ description: "Success", type: Boolean })
  @ApiInternalServerErrorResponse(errorMessageSchema("Unknown Error"))
  @ApiOperation({
    summary: "Check liveness of the REST process.",
    description: `Returns true immediately - confirms the NestJS process is alive. Does not verify ETP backend connectivity (use \`/health/readiness\` for that).\n\n**Use case**: Kubernetes liveness probe - the pod is restarted if this endpoint stops responding.`,
    security: [],
    servers: swaggerServers
  })
  public IsLive(): Promise<boolean> {
    return new Promise(resolve => {
      try {
        resolve(true);
      } catch (e) {
        throw new InternalServerErrorException({
          description: "Unknown Server Error"
        });
      }
    });
  }

  /**
   * Return service information
   *
   * @memberof HealthAPI
   */
  @Get("info")
  @ApiOkResponse({
    description: "Success",
    schema: getSchemasForType(ClientInfoDto)
  })
  @ApiNotFoundResponse(errorMessageSchema("Not found", 404))
  @ApiInternalServerErrorResponse(errorMessageSchema("Unknown Error"))
  @ApiOperation({
    summary: "Get server version and build metadata.",
    description: `Returns package name, version, git commit hash, commit time, and build time from package.json and git. Use for deployment verification, client compatibility checks, and diagnostics.`,
    security: [],
    servers: swaggerServers
  })
  public Info(): Promise<ClientInfo> {
    return new Promise<ClientInfo>(resolve => {
      try {
        const groupId = "org.opengroup.osdu";

        // get info from package.json
        const packageJson = JSON.parse(
          fs.readFileSync("./package.json", "utf8")
        );
        const version = packageJson.version;
        const artifactId = packageJson.name;
        let commitId = "unknown";
        let commitTime = "unknown";

        //Get commitId, commitTime and buildTime from env variables
        // get commit info from Git
        try {
          commitId = child_process
            .execSync("git rev-parse HEAD")
            .toString()
            .trim();
          commitTime = child_process
            .execSync("git log -1 --format=%ci")
            .toString()
            .trim();
        } catch (e) {
          //Nothing
        }

        resolve({
          groupId,
          artifactId,
          version,
          commitId,
          commitTime
        });
      } catch (e) {
        throw new InternalServerErrorException({
          description: "Unknown Server Error"
        });
      }
    });
  }

  /**
   * R4: List all registered converters for diagnostics.
   * Returns the source types and their target OSDU kinds.
   */
  @Get("converters")
  @ApiOkResponse({
    description: "List of registered type converters",
    schema: {
      type: "object",
      properties: {
        count: { type: "number" },
        types: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sourceType: { type: "string" },
              targetKind: { type: "string" }
            }
          }
        }
      }
    }
  })
  @ApiOperation({
    summary: "List registered converters.",
    description: "Returns all registered RESQML/WITSML → OSDU type converters for diagnostics and validation.",
    security: [],
    servers: swaggerServers
  })
  public Converters(): { count: number; types: { sourceType: string; targetKind: string }[] } {
    const { getRegisteredTypes, getTargetKind } = require("../../jsonTypes/registerConverter");
    const types: string[] = getRegisteredTypes();
    return {
      count: types.length,
      types: types.map(t => ({
        sourceType: t,
        targetKind: getTargetKind(t) ?? "unknown"
      }))
    };
  }
}
