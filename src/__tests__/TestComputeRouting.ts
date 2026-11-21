// ============================================================================
// Copyright 2026 Microsoft. Inc. or its affiliates. All Rights Reserved.
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
//
// Compute edge-routing: read-only array-compute requests (stats / reduce /
// where / where-multi) are routed to a dedicated compute endpoint
// (RDMS_ETP_COMPUTE_HOST / RDMS_ETP_COMPUTE_PORT) served by an open-etp-server
// started with RDMS_SERVER_ROLE=compute. These tests pin the pure env ->
// endpoint-URL derivation in common/config.

import "jest";

import ArrayCustomer from "../lib/protocols/ArrayCustomer";
import { ETPCore } from "../lib/common/ETPCore";

// Env vars required by common/config (it throws if any are unset) plus the
// optional compute-endpoint vars this suite exercises.
const BASE_ENV: Record<string, string> = {
  RDMS_ETP_PROTOCOL: "ws",
  RDMS_ETP_HOST: "store-host",
  RDMS_ETP_PORT: "9004",
  RDMS_REST_ROOT_PATH: "/api/reservoir-ddms/v2",
  RDMS_REST_PORT: "8003"
};

const COMPUTE_ENV = [
  "RDMS_ETP_COMPUTE_HOST",
  "RDMS_ETP_COMPUTE_PORT",
  "RDMS_ETP_PATH",
  "RDMS_ETP_SSL"
];

type Config = typeof import("../lib/common/config");

/** Load a fresh copy of common/config with the given env overlay applied. */
const loadConfig = (overrides: Record<string, string>): Config => {
  let cfg: Config | undefined;
  jest.isolateModules(() => {
    for (const [k, v] of Object.entries({ ...BASE_ENV, ...overrides })) {
      process.env[k] = v;
    }
    cfg = require("../lib/common/config") as Config;
  });
  return cfg as Config;
};

describe("compute edge-routing config", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of [...Object.keys(BASE_ENV), ...COMPUTE_ENV]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of [...Object.keys(BASE_ENV), ...COMPUTE_ENV]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("compute URL collapses to the store URL when unset", () => {
    const cfg = loadConfig({});
    expect(cfg.etpComputeUrl).toBe(cfg.etpServerUrl);
    expect(cfg.computeRoutingEnabled).toBe(false);
  });

  test("distinct compute host routes to a separate endpoint", () => {
    const cfg = loadConfig({ RDMS_ETP_COMPUTE_HOST: "compute-host" });
    expect(cfg.etpComputeUrl).toBe("ws://compute-host:9004/");
    expect(cfg.etpServerUrl).toBe("ws://store-host:9004/");
    expect(cfg.computeRoutingEnabled).toBe(true);
  });

  test("distinct compute port routes to a separate endpoint", () => {
    const cfg = loadConfig({ RDMS_ETP_COMPUTE_PORT: "9104" });
    expect(cfg.etpComputeUrl).toBe("ws://store-host:9104/");
    expect(cfg.computeRoutingEnabled).toBe(true);
  });

  test("compute host falls back to store host, port overridden", () => {
    const cfg = loadConfig({
      RDMS_ETP_COMPUTE_HOST: "store-host",
      RDMS_ETP_COMPUTE_PORT: "9004"
    });
    // Same host and port as the store => not a distinct endpoint.
    expect(cfg.etpComputeUrl).toBe(cfg.etpServerUrl);
    expect(cfg.computeRoutingEnabled).toBe(false);
  });

  test("compute endpoint shares protocol and path with the store", () => {
    const cfg = loadConfig({
      RDMS_ETP_PATH: "/etp",
      RDMS_ETP_COMPUTE_HOST: "compute-host"
    });
    expect(cfg.etpComputeUrl).toBe("ws://compute-host:9004/etp/");
    expect(cfg.etpServerUrl).toBe("ws://store-host:9004/etp/");
  });
});

// ---------------------------------------------------------------------------
// Capability guard: when an OpenSession positively showed the store does NOT
// advertise `supportedArrayExtensions` (serverSupportsArrayExtensions === false,
// an un-updated M27 store), the array-compute customer refuses to send any
// stats / reduce / where / where-multi request up front and returns null,
// instead of round-tripping a GetDataArrayMetadata that the store can't fold.
// An `undefined` capability (never negotiated, e.g. a mock session) MUST NOT be
// guarded so existing per-request fallback behaviour is preserved.
// ---------------------------------------------------------------------------
describe("array-compute capability guard", () => {
  const ARRAY_ID = {
    uri: "eml:///dataspace('d')/resqml22.ContinuousProperty(p)",
    pathInResource: "/RESQML/p/values"
  } as any;

  const makeSession = (
    cap: boolean | undefined
  ): { session: ETPCore; send: jest.Mock } => {
    const send = jest.fn().mockReturnValue(BigInt(1));
    const session = {
      responseTimeoutPeriod: 0,
      serverSupportsArrayExtensions: cap,
      createFinalMessageHeader: jest.fn().mockReturnValue({}),
      send
    } as unknown as ETPCore;
    return { session, send };
  };

  test("known non-compute store short-circuits every op to null", async () => {
    const { session, send } = makeSession(false);
    const customer = new ArrayCustomer(session);

    await expect(customer.stats(ARRAY_ID)).resolves.toBeNull();
    await expect(customer.reduce(ARRAY_ID, "mean")).resolves.toBeNull();
    await expect(
      customer.where(ARRAY_ID, { lo: 0, hi: 1 })
    ).resolves.toBeNull();
    await expect(
      customer.whereMulti([{ dataArrayId: ARRAY_ID, range: { lo: 0, hi: 1 } }])
    ).resolves.toBeNull();

    // Nothing was ever put on the wire.
    expect(send).not.toHaveBeenCalled();
  });

  test("un-negotiated capability does NOT short-circuit (still sends)", () => {
    const { session, send } = makeSession(undefined);
    const customer = new ArrayCustomer(session);

    // The method's synchronous prelude runs up to the first await (the request
    // is sent) before suspending on waitForRequest; swallow the pending promise.
    customer.stats(ARRAY_ID).catch(() => undefined);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

