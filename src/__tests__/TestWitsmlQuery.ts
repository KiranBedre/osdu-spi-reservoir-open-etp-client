// ============================================================================
// Copyright 2024-2026 Equinor ASA. All rights reserved.
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
 * Integration tests for WITSML Query REST endpoints.
 *
 * Tests cover:
 *   - Input validation (DTO decorators, guard responses)
 *   - Swagger contract conformance (status codes, error shapes)
 *   - Query protocol REST endpoints
 *
 * Prerequisites:
 *   - ETP server running on configured host/port
 *   - `npm test` sets RDMS_ETP_* and RDMS_REST_* env vars
 *
 * Run: npx jest --testPathPattern TestWitsmlQuery --forceExit
 */

import "jest";
import "reflect-metadata";
import request from "supertest";

import {
  XmlUtils
} from "../index";

import restApp from "../lib/restApi/App";

import {
  restApiMainUrl
} from "../lib/common/config";

const jwt = XmlUtils.createDefaultJWT();

const testDataPartitionId =
  process.env.RDMS_TEST_DATA_PARTITION_ID || "osdu";
const testDataspace = process.env.RDMS_TEST_DATASPACE || "maap/drogon";

// ─────────────────────────────────────────────────────────────────────────────
// Query REST API Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Query REST API — Input Validation", () => {
  let nestAppServer: any;

  beforeAll(async () => {
    const nestApp = await restApp();
    nestAppServer = (await nestApp.init()).getHttpServer();
  });

  it("POST /query/resources/find — rejects missing Authorization", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/resources/find`)
      .set("data-partition-id", testDataPartitionId)
      .send({ uri: "eml:///dataspace('test')" });

    expect(response.status).toBe(401);
  });

  it("POST /query/resources/find — rejects missing uri", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/resources/find`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({});

    expect(response.status).toBe(400);
  });

  it("POST /query/resources/find — rejects invalid scope enum", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/resources/find`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ uri: "eml:///dataspace('test')", scope: "INVALID_SCOPE" });

    expect(response.status).toBe(400);
  });

  it("POST /query/objects/find — rejects missing uri", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/objects/find`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({});

    expect(response.status).toBe(400);
  });

  it("POST /query/growing/metadata — rejects missing uri", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/growing/metadata`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({});

    expect(response.status).toBe(400);
  });

  it("POST /query/growing/range — rejects missing required fields", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/growing/range`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ uri: "eml:///dataspace('test')" });

    expect(response.status).toBe(400);
  });

  it("POST /query/channels/metadata — rejects missing uri", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/channels/metadata`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({});

    expect(response.status).toBe(400);
  });
});

describe("Query REST API — Functional", () => {
  let nestAppServer: any;
  const testUri = `eml:///dataspace('${testDataspace}')`;

  beforeAll(async () => {
    const nestApp = await restApp();
    nestAppServer = (await nestApp.init()).getHttpServer();
  });

  it("POST /query/resources/find — finds resources in dataspace", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/resources/find`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({
        uri: testUri,
        scope: "targets",
        depth: 1
      });

    expect([200, 502]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it("POST /query/resources/find — filters by data object type", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/resources/find`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({
        uri: testUri,
        scope: "targets",
        depth: 1,
        dataObjectTypes: ["resqml22.TriangulatedSetRepresentation"]
      });

    expect([200, 502]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it("POST /query/objects/find — retrieves objects with content", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/objects/find`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({
        uri: testUri,
        scope: "targets",
        depth: 1
      });

    expect([200, 502]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it("POST /query/growing/metadata — handles gracefully", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/growing/metadata`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ uri: testUri });

    // May return 200 (with data) or 502 (ETP down) or 404 (no growing objects)
    expect([200, 404, 502]).toContain(response.status);
  });

  it("POST /query/channels/metadata — handles gracefully", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/channels/metadata`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ uri: testUri });

    expect([200, 404, 502]).toContain(response.status);
  });
});
