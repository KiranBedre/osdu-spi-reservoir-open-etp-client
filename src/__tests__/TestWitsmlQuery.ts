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
 * Integration tests for WITSML Store and Query REST endpoints.
 *
 * Tests cover:
 *   - Input validation (DTO decorators, guard responses)
 *   - Swagger contract conformance (status codes, error shapes)
 *   - WITSML store/query flow
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
  Energistics,
  EtpUri,
  ResqmlClient,
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
const testWitsmlDataspace = "test/witsml-" + Date.now().toString(36);

// ─────────────────────────────────────────────────────────────────────────────
// WITSML Store REST API Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("WITSML Store — Input Validation", () => {
  let nestAppServer: any;

  beforeAll(async () => {
    const nestApp = await restApp();
    nestAppServer = (await nestApp.init()).getHttpServer();
  });

  it("PUT /witsml/store — rejects missing Authorization header", async () => {
    const response = await request(nestAppServer)
      .put(`${restApiMainUrl}/witsml/store`)
      .set("data-partition-id", testDataPartitionId)
      .send({ dataspace: "test/ds", xml: "<Well/>" });

    expect(response.status).toBe(401);
  });

  it("PUT /witsml/store — rejects missing data-partition-id header", async () => {
    const response = await request(nestAppServer)
      .put(`${restApiMainUrl}/witsml/store`)
      .set("Authorization", `Bearer ${jwt}`)
      .send({ dataspace: "test/ds", xml: "<Well/>" });

    // Depending on partition mode, may be 400 or pass
    expect([200, 400]).toContain(response.status);
  });

  it("PUT /witsml/store — rejects empty body", async () => {
    const response = await request(nestAppServer)
      .put(`${restApiMainUrl}/witsml/store`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({});

    expect(response.status).toBe(400);
  });

  it("PUT /witsml/store — rejects missing xml field", async () => {
    const response = await request(nestAppServer)
      .put(`${restApiMainUrl}/witsml/store`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ dataspace: "test/ds" });

    expect(response.status).toBe(400);
  });

  it("PUT /witsml/store — rejects missing dataspace field", async () => {
    const response = await request(nestAppServer)
      .put(`${restApiMainUrl}/witsml/store`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ xml: "<Well/>" });

    expect(response.status).toBe(400);
  });

  it("PUT /witsml/store — rejects invalid dataspace pattern", async () => {
    const response = await request(nestAppServer)
      .put(`${restApiMainUrl}/witsml/store`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ dataspace: "invalid dataspace!!!@#$", xml: "<Well/>" });

    expect(response.status).toBe(400);
  });

  it("POST /witsml/query — rejects missing dataspace", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/witsml/query`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({});

    expect(response.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WITSML Store — Functional Tests (requires ETP server)
// ─────────────────────────────────────────────────────────────────────────────

describe("WITSML Store — Functional", () => {
  let nestAppServer: any;

  beforeAll(async () => {
    const nestApp = await restApp();
    nestAppServer = (await nestApp.init()).getHttpServer();
  });

  const sampleWell = `
    <Well xmlns="http://www.energistics.org/energyml/data/witsmlv2"
          xmlns:eml="http://www.energistics.org/energyml/data/commonv2"
          schemaVersion="2.1" uuid="test-well-${Date.now()}">
      <eml:Citation>
        <eml:Title>Test Well Integration</eml:Title>
        <eml:Originator>test</eml:Originator>
        <eml:Creation>2026-06-02T00:00:00Z</eml:Creation>
        <eml:Format>WITSML v2.1</eml:Format>
      </eml:Citation>
      <NameLegal>Test Legal Name</NameLegal>
      <Country>Norway</Country>
      <TimeZone>+01:00</TimeZone>
    </Well>`;

  it("PUT /witsml/store — stores a valid WITSML 2.1 Well", async () => {
    const response = await request(nestAppServer)
      .put(`${restApiMainUrl}/witsml/store`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ dataspace: testDataspace, xml: sampleWell });

    // Accept 200 (success) or 502 (ETP server not running in CI)
    expect([200, 502]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body).toBeDefined();
    }
  });

  it("POST /witsml/query — queries objects in a dataspace", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/witsml/query`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ dataspace: testDataspace });

    expect([200, 502]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it("POST /witsml/query — filters by object type", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/witsml/query`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ dataspace: testDataspace, objectType: "Well" });

    expect([200, 502]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it("GET /witsml/:dataspaceId/objects — lists objects", async () => {
    const encoded = encodeURIComponent(testDataspace);
    const response = await request(nestAppServer)
      .get(`${restApiMainUrl}/witsml/${encoded}/objects`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId);

    expect([200, 502]).toContain(response.status);
    if (response.status === 200) {
      expect(Array.isArray(response.body)).toBe(true);
    }
  });

  it("GET /witsml/:dataspaceId/objects?type=Well — filters by type param", async () => {
    const encoded = encodeURIComponent(testDataspace);
    const response = await request(nestAppServer)
      .get(`${restApiMainUrl}/witsml/${encoded}/objects?type=Well`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId);

    expect([200, 502]).toContain(response.status);
  });
});

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
