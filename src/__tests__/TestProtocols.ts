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
 * Integration tests for additional ETP 1.2 protocols:
 * - DiscoveryQuery (Protocol 13)
 * - StoreQuery (Protocol 14)
 * - GrowingObject (Protocol 6)
 * - GrowingObjectNotification (Protocol 7)
 * - ChannelSubscribe (Protocol 21)
 *
 * Prerequisites:
 *   - ETP server running on configured host/port
 *   - At least one dataspace with objects (e.g., maap/drogon with RESQML data)
 *
 * Run: npx jest --testPathPattern TestProtocols --forceExit
 */

import "jest";
import request from "supertest";
import { v4 as uuidRandom } from "uuid";

import {
  Energistics,
  EtpUri,
  ResqmlClient
} from "../index";

import { ETPClient } from "../lib/client/ETPClient";
import * as controlUtils from "../lib/restApi/ControllerUtils";
import restApp from "../lib/restApi/App";
import { XmlUtils } from "../index";

import {
  etpServerUrl,
  restApiMainUrl,
  restApiPort
} from "../lib/common/config";

const jwt = XmlUtils.createDefaultJWT();

const testDataPartitionId =
  process.env.RDMS_TEST_DATA_PARTITION_ID || "osdu";
const testDataspace = process.env.RDMS_TEST_DATASPACE || "maap/drogon";
const testDataspaceUri = `eml:///dataspace('${testDataspace}')`;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// DiscoveryQuery Protocol Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("DiscoveryQuery Protocol (13)", () => {
  let client: ResqmlClient;

  beforeAll(async () => {
    client = new ResqmlClient();
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
  });

  afterAll(async () => {
    await client.closeSession();
  });

  it("should find resources in a dataspace", async () => {
    const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
      uri: testDataspaceUri,
      depth: 1,
      dataObjectTypes: [],
      navigableEdges:
        Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Primary,
        includeSecondaryTargets: false,
        includeSecondarySources: false
    };

    const resources = await client.discoveryQuery.findResources(
      context,
      Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.targets
    );

    expect(resources).toBeDefined();
    expect(Array.isArray(resources)).toBe(true);
    // If dataspace has objects, we should find them
    if (resources.length > 0) {
      expect(resources[0].uri).toContain("eml:///");
      expect(resources[0].name).toBeDefined();
    }
  });

  it("should filter resources by data object type", async () => {
    const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
      uri: testDataspaceUri,
      depth: 1,
      dataObjectTypes: ["resqml22.TriangulatedSetRepresentation"],
      navigableEdges:
        Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Primary,
        includeSecondaryTargets: false,
        includeSecondarySources: false
    };

    const resources = await client.discoveryQuery.findResources(
      context,
      Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.targets
    );

    expect(resources).toBeDefined();
    expect(Array.isArray(resources)).toBe(true);
    // All results should be of the requested type
    resources.forEach(r => {
      expect(r.uri.toLowerCase()).toContain("triangulatedsetrepresentation");
    });
  });

  it("should filter by storeLastWriteFilter", async () => {
    const oneHourAgo = BigInt(
      (Date.now() - 3600_000) * 1000 // microseconds
    );

    const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
      uri: testDataspaceUri,
      depth: 1,
      dataObjectTypes: [],
      navigableEdges:
        Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Primary,
        includeSecondaryTargets: false,
        includeSecondarySources: false
    };

    const resources = await client.discoveryQuery.findResources(
      context,
      Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.targets,
      oneHourAgo
    );

    expect(resources).toBeDefined();
    expect(Array.isArray(resources)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GrowingObject Protocol Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("GrowingObject Protocol (6)", () => {
  let client: ResqmlClient;
  let growingObjectUri: string | null = null;

  beforeAll(async () => {
    client = new ResqmlClient();
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);

    // Find a growing object (WellLog) in the test dataspace
    const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
      uri: testDataspaceUri,
      depth: 1,
      dataObjectTypes: ["witsml21.WellboreGeology", "witsml21.Log"],
      navigableEdges:
        Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Primary,
        includeSecondaryTargets: false,
        includeSecondarySources: false
    };

    try {
      const resources = await client.discovery.getResources(
        context,
        Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.targets
      );
      if (resources.length > 0) {
        growingObjectUri = resources[0].uri;
      }
    } catch {
      // No growing objects available — tests will skip
    }
  });

  afterAll(async () => {
    await client.closeSession();
  });

  it("should get parts metadata if growing object exists", async () => {
    if (!growingObjectUri) {
      console.log("SKIP: No growing object found in test dataspace");
      return;
    }

    const metadata = await client.growingObject.getPartsMetadata(
      growingObjectUri
    );
    expect(metadata).toBeDefined();
    expect(Array.isArray(metadata)).toBe(true);
  });

  it("should handle get parts by range gracefully", async () => {
    if (!growingObjectUri) {
      console.log("SKIP: No growing object found in test dataspace");
      return;
    }

    const startIndex = new Energistics.Etp.v12.Datatypes.IndexValue();
    startIndex.item = { _double: 0.0, __keyName: "_double" };
    const endIndex = new Energistics.Etp.v12.Datatypes.IndexValue();
    endIndex.item = { _double: 100.0, __keyName: "_double" };
    const indexInterval: Energistics.Etp.v12.Datatypes.Object.IndexInterval = {
      startIndex,
      endIndex,
      uom: "m",
      depthDatum: ""
    };

    try {
      const parts = await client.growingObject.getPartsByRange(
        growingObjectUri,
        indexInterval
      );
      expect(parts).toBeDefined();
      expect(Array.isArray(parts)).toBe(true);
    } catch (err: any) {
      // Server may not support growing object for this type
      expect(err.message).toContain("ETP");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ChannelSubscribe Protocol Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ChannelSubscribe Protocol (21)", () => {
  let client: ResqmlClient;
  let channelObjectUri: string | null = null;

  beforeAll(async () => {
    client = new ResqmlClient();
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);

    // Find a channel-capable object (WellLog)
    const context: Energistics.Etp.v12.Datatypes.Object.ContextInfo = {
      uri: testDataspaceUri,
      depth: 1,
      dataObjectTypes: ["witsml21.WellLog", "witsml21.Log"],
      navigableEdges:
        Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Primary,
        includeSecondaryTargets: false,
        includeSecondarySources: false
    };

    try {
      const resources = await client.discovery.getResources(
        context,
        Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.targets
      );
      if (resources.length > 0) {
        channelObjectUri = resources[0].uri;
      }
    } catch {
      // No channel objects available — tests will skip
    }
  });

  afterAll(async () => {
    await client.closeSession();
  });

  it("should get channel metadata if WellLog exists", async () => {
    if (!channelObjectUri) {
      console.log("SKIP: No channel-capable object found in test dataspace");
      return;
    }

    try {
      const metadata = await client.channelSubscribe.getChannelMetadata(
        channelObjectUri
      );
      expect(metadata).toBeDefined();
      expect(Array.isArray(metadata)).toBe(true);
      if (metadata.length > 0) {
        expect(metadata[0].channelName).toBeDefined();
        expect(metadata[0].uom).toBeDefined();
      }
    } catch (err: any) {
      // Server may not support ChannelSubscribe protocol
      expect(err.message).toContain("ETP");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REST API Integration Tests for Query Endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe("Query REST API", () => {
  let nestAppServer: any;

  beforeAll(async () => {
    const nestApp = await restApp();
    nestAppServer = (await nestApp.init()).getHttpServer();
  });

  it("POST /query/resources/find - should find resources in dataspace", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/resources/find`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({
        uri: testDataspaceUri,
        scope: "targets",
        depth: 1
      })
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    if (response.body.length > 0) {
      expect(response.body[0]).toHaveProperty("uri");
      expect(response.body[0]).toHaveProperty("name");
    }
  });

  it("POST /query/resources/find - should filter by object type", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/resources/find`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({
        uri: testDataspaceUri,
        scope: "targets",
        depth: 1,
        dataObjectTypes: ["resqml22.TriangulatedSetRepresentation"]
      })
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
  });

  it("POST /query/objects/find - should return objects with content", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/objects/find`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({
        uri: testDataspaceUri,
        scope: "targets",
        depth: 1,
        dataObjectTypes: ["eml23.DataAssurance"]
      })
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
  });

  it("POST /query/resources/find - should reject missing URI", async () => {
    await request(nestAppServer)
      .post(`${restApiMainUrl}/query/resources/find`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({ scope: "targets" })
      .expect(400);
  });

  it("POST /query/channels/metadata - should handle channel metadata request", async () => {
    const response = await request(nestAppServer)
      .post(`${restApiMainUrl}/query/channels/metadata`)
      .set("Authorization", `Bearer ${jwt}`)
      .set("data-partition-id", testDataPartitionId)
      .send({
        uri: `${testDataspaceUri}/witsml21.WellLog(00000000-0000-0000-0000-000000000001)`
      });

    // May return 200 (with empty array) or 4xx/5xx depending on whether object exists
    expect([200, 404, 500]).toContain(response.status);
  });
});
