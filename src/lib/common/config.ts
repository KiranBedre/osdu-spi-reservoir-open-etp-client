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

/**
 * Dedicated compute-server endpoint. An open-etp-server started with
 * RDMS_SERVER_ROLE=compute advertises/serves only the read-only DataArray
 * surface (Core + DataArray; writes are rejected), so it can be scaled
 * independently of the write/store tier. Read-only array-compute requests
 * (stats / reduce / where / where-multi) are routed here when
 * RDMS_ETP_COMPUTE_HOST and/or RDMS_ETP_COMPUTE_PORT are configured; otherwise
 * the compute URL collapses to the normal store URL so single-server
 * deployments are unaffected. The protocol/TLS/path are shared with the store
 * endpoint; only host and port can differ.
 */
export const etpComputeHost =
  (process.env.RDMS_ETP_COMPUTE_HOST as string) || etpServerHost;
export const etpComputePort =
  (process.env.RDMS_ETP_COMPUTE_PORT as string) || etpServerPort;
export const etpComputeUrl = `${etpServerProtocol}://${etpComputeHost}:${etpComputePort}${etpServerPath}/`;
/** True when a distinct compute endpoint is configured. */
export const computeRoutingEnabled = etpComputeUrl !== etpServerUrl;

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

/**
 * Maximum accepted request body size for the REST API (Express body-parser
 * `limit`). Large corner-point grids serialise to hundreds of MB of GRDECL
 * text, so the default is generous; override with `RDMS_REST_BODY_LIMIT`
 * (any bytes/`kb`/`mb` string, e.g. "512mb").
 */
export const restApiBodyLimit =
  (process.env.RDMS_REST_BODY_LIMIT as string) || "256mb";

export const osduUrl = (process.env.RDMS_OSDU_URL as string) || restApiMainUrl;

/**
 * Path of the OSDU Wellbore DDMS API on the OSDU host (`osduUrl`), used by
 * `POST /dataspaces/{id}/wells/logs/import`. Override with `RDMS_WDMS_PATH`.
 */
export const wdmsPath =
  (process.env.RDMS_WDMS_PATH as string) || "/api/os-wellbore-ddms/ddms/v3";

/**
 * Default OSDU governance (ACL + legal) stamped onto a dataspace's ETP
 * CustomData **only when the gateway auto-creates a new dataspace** (e.g. via
 * `POST /dataspaces/{id}/epc/upload`). Existing dataspaces keep their own
 * governance untouched. Each is an optional comma-separated env var; when unset
 * the corresponding CustomData key is simply omitted.
 *
 * On OSDU-backed ETP servers a dataspace created without owners/legaltags is
 * rejected on subsequent writes ("Permission denied"), so supplying these lets
 * an upload to a brand-new dataspace succeed without a separate create call.
 */
const parseCsvEnv = (value?: string): string[] | undefined => {
  if (value === undefined) return undefined;
  const list = value.split(",").map(s => s.trim()).filter(s => s.length > 0);
  return list.length > 0 ? list : undefined;
};
export const defaultDataspaceOwners = parseCsvEnv(process.env.RDMS_DEFAULT_OWNERS);
export const defaultDataspaceViewers = parseCsvEnv(process.env.RDMS_DEFAULT_VIEWERS);
export const defaultDataspaceLegalTags = parseCsvEnv(process.env.RDMS_DEFAULT_LEGAL_TAGS);
export const defaultDataspaceDataCountries = parseCsvEnv(
  process.env.RDMS_DEFAULT_DATA_COUNTRIES
);

/**
 * ETP protocol names (Energistics.Etp.v12.Datatypes.Protocol keys) the store
 * under test must negotiate; kept next to RDMS_ETP_IMAGE in config.default.env
 * and consumed by the integration gate (TestProtocolsIntegration). Unset means
 * "no expectation" (the gate then only requires the core P3/P4/P9 set).
 */
export const etpRequiredProtocols = parseCsvEnv(process.env.RDMS_ETP_PROTOCOLS);
