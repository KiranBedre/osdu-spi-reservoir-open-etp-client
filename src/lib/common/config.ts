// ============================================================================
// Copyright 2022 Emerson Paradigm Holding LLC. All rights reserved.
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

const unsetEnvVars: string[] = [];
[
  "RDMS_ETP_PROTOCOL",
  "RDMS_ETP_HOST",
  "RDMS_ETP_PORT",
  "RDMS_REST_ROOT_PATH",
  "RDMS_REST_PORT"
].forEach(envVarName => {
  if (!process.env[envVarName]) {
    unsetEnvVars.push(envVarName);
  }
});
if (unsetEnvVars.length > 0) {
  throw new Error(
    "The following environment variables must be set: " +
      unsetEnvVars.join(", ")
  );
}

export const etpServerProtocol = process.env.RDMS_ETP_SSL === "true"
  ? "wss"
  : (process.env.RDMS_ETP_PROTOCOL as string);
export const etpServerHost = process.env.RDMS_ETP_HOST as string;
export const etpServerPort = process.env.RDMS_ETP_PORT as string;
export const etpServerPath = (process.env.RDMS_ETP_PATH as string) || "";
export const etpServerUrl = `${etpServerProtocol}://${etpServerHost}:${etpServerPort}${etpServerPath}/`;
export const etpJwt = (process.env.RDMS_JWT_SECRET as string) || undefined;

/**
 * Item 24: SSL certificate verification control.
 * When RDMS_ETP_SSL_VERIFY is "false", self-signed certificates are accepted
 * for WSS connections. This eliminates the need for separate Docker images
 * for SSL vs non-SSL deployments.
 * Default: true (verify certificates).
 */
export const etpSslVerify =
  process.env.RDMS_ETP_SSL_VERIFY !== "false";

export const dataPartitionId =
  process.env.RDMS_DATA_PARTITION_MODE !== "single"
    ? (process.env.RDMS_TEST_DATA_PARTITION_ID as string)
    : undefined;

export const restApiProtocol = etpServerProtocol.startsWith("wss")
  ? "https"
  : "http";
export const restApiMainUrl =
  (process.env.RDMS_REST_MAIN_URL as string) ??
  `${restApiProtocol}://${etpServerHost}`;
export const restApiRoutePath = process.env.RDMS_REST_ROOT_PATH as string;
export const restApiServerPath =
  process.env.RDMS_REST_SERVER_PATH !== undefined
    ? process.env.RDMS_REST_SERVER_PATH
    : restApiRoutePath.endsWith("/")
    ? restApiRoutePath.substring(0, restApiRoutePath.length - 1)
    : restApiRoutePath;
export const restApiPort = parseInt(process.env.RDMS_REST_PORT as string);
export const openApiPort =
  parseInt(process.env.OPEN_API_PORT as string) || restApiPort;

export const osduUrl = (process.env.RDMS_OSDU_URL as string) || restApiMainUrl;
