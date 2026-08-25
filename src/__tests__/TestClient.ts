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

import "jest";

import Logging from "../lib/common/Logging";

import { execSync } from "child_process";
import http from "http";
import https from "https";
import request from "supertest";

import {
  Eml20,
  Eml23,
  Energistics,
  EtpUri,
  Resqml20,
  Resqml22,
  ResqmlClient,
  XmlUtils
} from "../index";
import type {
  DataArray,
  DataValue,
  IResqmlDataObject,
  Resource,
  SimpleJson
} from "../index";

import { ETPClient } from "../lib/client/ETPClient";

import * as controlUtils from "../lib/restApi/ControllerUtils";

import { EtpDataValue, MessageFlags } from "../lib/common/EtpTypes";

import restApp from "../lib/restApi/App";

import {
  etpServerHost,
  etpServerPath,
  etpServerPort,
  etpServerProtocol,
  etpServerUrl,
  restApiMainUrl,
  restApiPort,
  restApiServerPath
} from "../lib/common/config";
import { Manifest } from "../lib/jsonTypes/Generated/manifest/Manifest.1.0.0";
import { ResourceGraph } from "../lib/common/ResponseHandlers";

import { v4 as uuidRandom } from "uuid";
import { random } from "lodash";

const jwt = XmlUtils.createDefaultJWT();

const failOnUnexpectedError = (err: Error) => {
  expect(err).toBeFalsy();
};

export const dataPartitionMode =
  process.env.RDMS_DATA_PARTITION_MODE || "single";
export const testDataPartitionId =
  process.env.RDMS_TEST_DATA_PARTITION_ID || "osdu";
const testAclViewers = process.env.RDMS_TEST_ACL_VIEWERS;
const testAclOwners = process.env.RDMS_TEST_ACL_OWNERS;
const testLegalTags = process.env.RDMS_TEST_LEGAL_TAGS;
const testOtherRelevantDataCountries =
  process.env.RDMS_TEST_OTHER_RELEVANT_DATA_COUNTRIES;

const viewers = testAclViewers
  ? JSON.parse(testAclViewers)
  : [`data.default.viewers@${testDataPartitionId}.contoso.com`];
const owners = testAclOwners
  ? JSON.parse(testAclOwners)
  : [`data.default.owners@${testDataPartitionId}.contoso.com`];
const legaltags = testLegalTags
  ? JSON.parse(testLegalTags)
  : [`${testDataPartitionId}-RDDMS-Legal-Tag`];
const otherRelevantDataCountries = testOtherRelevantDataCountries
  ? JSON.parse(testOtherRelevantDataCountries)
  : ["US"];

function sleep(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

const logger = Logging.getLogger("Jest");

describe("Valid data partition", () => {
  it("Non empty parameters", () => {
    expect(dataPartitionMode).not.toBeFalsy();
    if (dataPartitionMode !== "single") {
      expect(testDataPartitionId).not.toBeFalsy();
    }
  });
});

export const checkServerAvailability: () => Promise<boolean> = async () => {
  const prot = etpServerProtocol === "wss" ? https : http;
  const url = `${etpServerProtocol === "wss" ? "https" : "http"
    }://${etpServerHost}:${etpServerPort}${etpServerPath}/.well-known/etp-server-capabilities?GetVersion=etp12.energistics.org`;
  return new Promise(resolve => {
    try {
      const req = prot.get(url, response => {
        if (response.statusCode === 200 || response.statusCode === 301) {
          resolve(true);
        } else {
          logger.error(`fetch catch error: ${response.statusMessage}`);
        }
      });
      req.on("error", () => {
        logger.info("ETP server NOT running");
        resolve(false);
      });
      req.end();
    } catch (e) {
      resolve(false);
    }
  });
};

export const checkRestAPIAvailability: () => Promise<boolean> = async () => {
  const url = `${controlUtils.swaggerUIUrl}/health/readiness/`;
  return new Promise(resolve => {
    try {
      logger.info(`Connecting to API: ${url}`);
      http
        .get(url, response => {
          if (response.statusCode === 200 || response.statusCode === 301) {
            resolve(true);
          } else {
            logger.error(`API error: ${response.statusMessage}`);
          }
        })
        .on("error", err => {
          logger.info(`API server NOT available on ${url}: ` + err.toString());
          resolve(false);
        });
    } catch (e) {
      resolve(false);
    }
  });
};
let serverAlreadyAvailable = false;

const startServer = async (): Promise<boolean> => {
  try {
    // Look for locally running server before starting container
    const s = await checkServerAvailability();
    logger.info(`ETP server availability ${s}`);

    if (s) {
      serverAlreadyAvailable = true;
      return true;
    }
    // Start server and give it time before starting tests
    logger.info("starting ETP server");
    execSync("npm run docker:compose:start");

    await sleep(20000);

    const startedOK = await checkServerAvailability();
    logger.info("ETP server started: " + startedOK);
    return startedOK;
  } catch (error) {
    return false;
  }
};

const stopServer = (): void => {
  if (serverAlreadyAvailable) {
    logger.info("ETP server maintained");
  } else {
    // Use sync to make sure server stop to avoid open handles
    execSync("npm run docker:compose:stop");
    logger.info("ETP server stopped");
  }
};

/**
 * Create a large object (Local3dCrs) by adding meta data
 * @param {Energistics.Etp.v12.Datatypes.Object.Dataspace} dataspace to create the object in
 * @param {string} uuid of the object
 * @param {number} count number of extrameta to add
 * @return large object resource
 */
const createLargeContent = (
  dataspace: Energistics.Etp.v12.Datatypes.Object.Dataspace,
  uuid: string,
  count: number
): Omit<Energistics.Etp.v12.Datatypes.Object.DataObject, "_schema"> => {
  let xmlContent: string | undefined = `<?xml version="1.0" encoding="UTF-8"?>
          <resqml2:LocalDepth3dCrs xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:gts="http://www.isotc211.org/2005/gts" xmlns:gsr="http://www.isotc211.org/2005/gsr" xmlns:dc="http://purl.org/dc/terms/" xmlns:resqml1="http://www.resqml.org/schemas/1series" xmlns:resqml2="http://www.energistics.org/energyml/data/resqmlv2" xmlns:witsml1="http://www.witsml.org/schemas/1series" xmlns:eml="http://www.energistics.org/energyml/data/commonv2" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:gmd="http://www.isotc211.org/2005/gmd" xmlns:gco="http://www.isotc211.org/2005/gco" xmlns:ptm="http://www.f2i-consulting.com/PropertyTypeMapping" xmlns:abstract="http://www.energistics.org/schemas/abstract" schemaVersion="2.0" uuid="${uuid}" xsi:type="resqml2:obj_LocalDepth3dCrs">
          <eml:Citation xsi:type="eml:Citation">
            <eml:Title xsi:type="eml:DescriptionString">Local Depth CRS</eml:Title>
            <eml:Originator xsi:type="eml:NameString">mike.king</eml:Originator>
            <eml:Creation xsi:type="xsd:dateTime">2023-01-18T14:24:00Z</eml:Creation>
            <eml:Format xsi:type="eml:DescriptionString">RESQML Modeling Application</eml:Format>
          </eml:Citation>`;
  for (let i = 0; i < count; i++) {
    xmlContent += `<resqml2:ExtraMetadata xsi:type="resqml2:NameValuePair">
        <resqml2:Name xsi:type="xsd:string">app/resqml/test${i}</resqml2:Name>
        <resqml2:Value xsi:type="xsd:string">ENERGISTICS</resqml2:Value>
      </resqml2:ExtraMetadata>`;
  }
  xmlContent += `
    <resqml2:YOffset xsi:type="xsd:double">0</resqml2:YOffset>
    <resqml2:ZOffset xsi:type="xsd:double">0</resqml2:ZOffset>
    <resqml2:ArealRotation xsi:type="eml:PlaneAngleMeasure" uom="dega">0</resqml2:ArealRotation>
    <resqml2:ProjectedAxisOrder xsi:type="eml:AxisOrder2d">easting northing</resqml2:ProjectedAxisOrder>
    <resqml2:ProjectedUom xsi:type="eml:LengthUom">m</resqml2:ProjectedUom>
    <resqml2:VerticalUom xsi:type="eml:LengthUom">m</resqml2:VerticalUom>
    <resqml2:XOffset xsi:type="xsd:double">0</resqml2:XOffset>
    <resqml2:ZIncreasingDownward xsi:type="xsd:boolean">true</resqml2:ZIncreasingDownward>
    <resqml2:VerticalCrs xsi:type="eml:VerticalUnknownCrs">
      <eml:Unknown xsi:type="eml:DescriptionString">unknown</eml:Unknown>
    </resqml2:VerticalCrs>
    <resqml2:ProjectedCrs xsi:type="eml:ProjectedUnknownCrs">
      <eml:Unknown xsi:type="eml:DescriptionString">WKT</eml:Unknown>
    </resqml2:ProjectedCrs>
  </resqml2:LocalDepth3dCrs>
  `;

  const res = new Energistics.Etp.v12.Datatypes.Object.DataObject();
  res.data = Buffer.from(xmlContent);
  res.format = "xml";
  res.resource = {
    uri: `${dataspace.uri}/resqml20.obj_LocalDepth3dCrs(${uuid})`,
    name: "Local Depth CRS",
    alternateUris: [],
    sourceCount: null,
    targetCount: null,
    storeCreated: BigInt(Date.now()),
    storeLastWrite: BigInt(Date.now()),
    activeStatus: Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind.Active,
    lastChanged: BigInt(Date.now()),
    customData
  };
  return res;
};

const maxTime = 400000000;

type TServer = Record<string, request.SuperTest<request.Test>>;
const testServers: TServer = {};

// declare servers we want to test
const serverData: string[] = [
  "http", // http server: e.g. docker container image,
  "app" // NestJS app
];

let token = "";

let nestApp: any = undefined;

const customData = new Map<string, DataValue>();
customData.set("viewers", EtpDataValue.fromUnknown(viewers));
customData.set("owners", EtpDataValue.fromUnknown(owners));
customData.set("legaltags", EtpDataValue.fromUnknown(legaltags));
customData.set(
  "otherRelevantDataCountries",
  EtpDataValue.fromUnknown(otherRelevantDataCountries)
);

try {
  beforeAll(async () => {
    jest.setTimeout(maxTime);
    await startServer();

    if (serverData.includes("http")) {
      // http server: e.g. docker container image
      const httpServerTest = request(`${restApiMainUrl}:${restApiPort}`);
      httpServerTest.get(`${restApiServerPath}/health/readiness`).expect(200);
      testServers["http"] = httpServerTest;
    }

    // NestJS app
    if (serverData.includes("app")) {
      nestApp = await restApp();
      const nestAppServer = (await nestApp.init()).getHttpServer();
      const nestAppTest = request(nestAppServer);
      nestAppTest.get(`${restApiServerPath}/health/readiness`).expect(200);
      testServers["app"] = nestAppTest;

      // initialize token for
      const res = await nestAppTest
        .get(`${restApiServerPath}/auth/token`)
        .expect("Content-Type", /json/)
        .expect(200);
      token = res.body.token;
    } else {
      token = jwt;
    }
    return expect(token).not.toBeNull();
  }, maxTime);
} catch (e) {
  logger.error(`beforeAll catch external: ${e}`);
  throw e;
}

afterAll(done => {
  stopServer();
  nestApp && nestApp.close();
  done();
});

const dataspaceName = "demo/Volve";

const crsType = "resqml20.obj_LocalDepth3dCrs";
const grid2dType = "resqml20.obj_Grid2dRepresentation";

const tSurfType = "resqml20.obj_TriangulatedSetRepresentation";
const tSurfUid = "a3f31b20-c93a-4682-8f6c-71be087202a4";
const externalPartUid = "53395ada-6f93-4bac-b506-d45997ded2a2";
const tSurfName = "Depth_Hugin_Fm_Top_ts";
const targetUid = "30489e2b-0ee9-42df-ba14-50f32c85eec0";
const targetType = "resqml20.obj_HorizonInterpretation";
const dataspaceEncoded = encodeURIComponent(dataspaceName);

const wrongDataspace = "wrong/wrong";
const wrongDataspaceEncoded = encodeURIComponent(wrongDataspace);

//*****************************************************/
// ResqmlClient

describe("Authorization", () => {
  it("Check valid Authentication token", async () => {
    const c2 = new ResqmlClient();
    c2.setCallsTraceability(false);
    await c2.connect(etpServerUrl, undefined, testDataPartitionId);
    let thrown = false;
    try {
      await c2.requestAuthorize(jwt);
      await c2.requestSession();
    } catch (err) {
      thrown = true;
    }
    expect(thrown).toBeFalsy();
    await c2.closeSession();
  });
  it("Check invalid Authentication token", async () => {
    const c2 = new ResqmlClient();
    c2.setCallsTraceability(false);
    await c2.connect(etpServerUrl, undefined, testDataPartitionId);
    try {
      await c2.requestAuthorize(`Bearer badToken`);
    } catch (err) {
      expect(err).toHaveProperty("message");
    }
    try {
      await c2.requestSession();
    } catch (err) {
      expect(err).toBeDefined();
    }
    c2.disconnect();
  });
  it("Check Authorization without token", async () => {
    const c2 = new ResqmlClient();
    c2.setCallsTraceability(false);
    await c2.connect(etpServerUrl, undefined, testDataPartitionId);
    try {
      await c2.requestAuthorize();
      await c2.requestSession();
    } catch (err) {
      expect(err).toHaveProperty("message");
    }
    try {
      await c2.requestSession();
    } catch (err) {
      expect(err).toBeDefined();
    }
    c2.disconnect();
  });
});

describe("Ping", () => {
  it("Ping", async () => {
    const c2 = new ResqmlClient();
    c2.setCallsTraceability(false);
    await c2.openSession(etpServerUrl, jwt, testDataPartitionId);
    const res = await c2.ping();
    expect(res).not.toBeNull();
    await c2.closeSession();
  });
  it("Ping no await", async () => {
    const c2 = new ResqmlClient();
    c2.setCallsTraceability(true);
    await c2.openSession(etpServerUrl, jwt, testDataPartitionId);
    const res = c2.ping();
    expect(res).not.toBeNull();
    const res2 = c2.ping();
    expect(res2).not.toBeNull();
    const res3 = c2.ping();
    expect(res3).not.toBeNull();
    await c2.closeSession();
  });
  it("Ping after closeSession", async () => {
    const c2 = new ResqmlClient();
    c2.setCallsTraceability(true);
    await c2.openSession(etpServerUrl, jwt, testDataPartitionId);
    const res = c2.ping();
    expect(res).not.toBeNull();
    const res2 = c2.ping();
    expect(res2).not.toBeNull();
    const res3 = c2.ping();
    expect(res3).not.toBeNull();
    await c2.closeSession();
    try {
      await c2.ping();
    } catch (err) {
      expect(err).toHaveProperty("message");
    }
  });
});

describe("Dataspaces", () => {
  const c2 = new ResqmlClient();
  //TODO: check why this test is failing intermittently
  it.skip("Dataspaces no await", async () => {
    c2.setCallsTraceability(true);
    await c2.openSession(etpServerUrl, jwt, testDataPartitionId);
    let thrown = false;
    try {
      const projects = c2.getDataspaces();
      expect(c2.isConnected()).toBe(true);
      expect(projects).toBeTruthy();
      c2.disconnect();
      await c2.openSession(etpServerUrl, jwt, testDataPartitionId);
      expect(c2.isConnected()).toBe(true);
      await c2.closeSession();
    } catch (err) {
      thrown = true;
    }
    expect(thrown).toBeFalsy();
  });
});

describe("Resource Graph", () => {
  let client: ResqmlClient;
  beforeEach(() => {
    client = new ResqmlClient();
  });

  afterEach(async () => {
    if (client.isInSession()) {
      // ensure that client is closed even if a test is failing
      await client.closeSession();
    }
  });

  it("Check API running", async () => {
    const res = await checkRestAPIAvailability();
    expect(res).toBeTruthy();
  });

  it("Right session", async () => {
    client.setCallsTraceability(true);
    let thrown = false;
    try {
      await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    } catch (err) {
      thrown = true;
    }
    expect(thrown).toBeFalsy();
    expect(client.isConnected()).toBeTruthy();
    expect(client.isInSession()).toBeTruthy();
    await client.closeSession();
  });

  it("Wrong session", async () => {
    const wrongEtpServerUrl = `${etpServerProtocol}://${etpServerHost}:${+etpServerPort + 1
      }${etpServerPath}/`;
    client.setCallsTraceability(true);
    let thrown = false;
    try {
      await client.openSession(wrongEtpServerUrl, jwt, testDataPartitionId);
    } catch (err) {
      expect(err).toEqual("Connection Error");
      thrown = true;
    }
    expect(thrown).toBeTruthy();
    expect(client.isConnected()).toBeFalsy();
    expect(client.isInSession()).toBeFalsy();
  });

  it("Dataspaces", async () => {
    client.setCallsTraceability(true);
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    const projects = await client.getDataspaces();
    expect(client.isConnected()).toBe(true);
    expect(projects).not.toBeNull();
    if (projects) {
      const testDataspace = projects.find(p => p.path.includes(dataspaceName));
      expect(testDataspace).toBeDefined();
    }
    await client.closeSession();
  });

  it("Wrong Dataspaces Error", async () => {
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    const wrongUrl = `eml:///dataspace('${wrongDataspace}')`;
    let hasError = false;
    try {
      await client.getDataspaceTypes(wrongUrl);
    } catch {
      // Error should have been thrown
      hasError = true;
    }
    expect(hasError).toBeTruthy();
    await client.closeSession();
  });

  it("Put and delete Obj", async () => {
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    const projects = await client.getDataspaces();
    expect(projects).toBeTruthy();
    if (!projects) {
      return;
    }
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
          <eml:EpcExternalPartReference xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:gts="http://www.isotc211.org/2005/gts" xmlns:gsr="http://www.isotc211.org/2005/gsr" xmlns:dc="http://purl.org/dc/terms/" xmlns:resqml1="http://www.resqml.org/schemas/1series" xmlns:resqml2="http://www.energistics.org/energyml/data/resqmlv2" xmlns:witsml1="http://www.witsml.org/schemas/1series" xmlns:eml="http://www.energistics.org/energyml/data/commonv2" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:gmd="http://www.isotc211.org/2005/gmd" xmlns:gco="http://www.isotc211.org/2005/gco" xmlns:ptm="http://www.f2i-consulting.com/PropertyTypeMapping" xmlns:abstract="http://www.energistics.org/schemas/abstract" schemaVersion="2.0" uuid="53395ada-6f93-4bac-b506-d45997ded2a2" xsi:type="eml:obj_EpcExternalPartReference">
          <eml:Citation xsi:type="eml:Citation">
            <eml:Title xsi:type="eml:DescriptionString">/home/user1/Desktop/Volve_Demo_Horizons_Depth.h5</eml:Title>
            <eml:Originator xsi:type="eml:NameString">current User</eml:Originator>
            <eml:Creation xsi:type="xsd:dateTime">2021-09-07T18:56:41Z</eml:Creation>
            <eml:Format xsi:type="eml:DescriptionString">[Emerson:TestApp:1]</eml:Format>
            <eml:VersionString xsi:type="xsd:string">2021-09-07T18:56:41Z</eml:VersionString>
          </eml:Citation>
          <eml:MimeType xsi:type="xsd:string">application/x-hdf5</eml:MimeType>
        </eml:EpcExternalPartReference>
        `;
    const p = projects[0];
    const object: Energistics.Etp.v12.Datatypes.Object.DataObject = {
      data: Buffer.from(xmlContent),
      format: "xml",
      resource: {
        uri: `${p.uri}/eml.EpcExternalPartReference(53395ada-6f93-4bac-b506-d45997ded2a2)`,
        name: "test",
        alternateUris: [],
        sourceCount: null,
        targetCount: null,
        storeCreated: BigInt(0),
        storeLastWrite: BigInt(0),
        activeStatus:
          Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind.Active,
        lastChanged: BigInt(0),
        customData
      },
      blobId: null
    };
    const transaction = await client.startTransaction(
      false,
      [projects[0].uri],
      "Create dummy array"
    );
    try {
      await client.putDataObjects([object]);
      await client.deleteObjects([object.resource.uri]);
      await client.rollbackTransaction(transaction);
    } catch (e) {
      await client.rollbackTransaction(transaction);
    }
    await client.closeSession();
  });

  it("Put and Get large object", async () => {
    await client.openSession(
      etpServerUrl,
      jwt,
      testDataPartitionId,
      undefined,
      undefined,
      1900000
    );
    const projects = await client.getDataspaces();
    expect(projects).toBeTruthy();
    if (!projects) {
      return;
    }
    const object = createLargeContent(
      projects[0],
      "53395ada-6f93-4bac-b506-d45997ded2a1",
      8000
    );
    const transaction = await client.startTransaction(
      false,
      [projects[0].uri],
      "Create large object"
    );
    try {
      await client.putDataObjects([object]);
      await client.getDataObjects([object.resource.uri]);
      await client.deleteObjects([object.resource.uri]);
      await client.rollbackTransaction(transaction);
    } catch (e) {
      await client.rollbackTransaction(transaction);
    }
    await client.closeSession(30000);
  });

  it.skip("Create Delete Dataspace", async () => {
    const path = `test/toDelete${uuidRandom()}`;
    const uri = EtpUri.createDataSpaceUri(path);
    const clientWrite = new ResqmlClient();
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    const projects = await client.getDataspaces();

    expect(projects?.filter(r => r.path.includes(path)).length).toBe(0);

    await clientWrite.openSession(
      etpServerUrl,
      jwt,
      testDataPartitionId,
      undefined,
      undefined,
      100000
    );

    await clientWrite.findOrCreateDataspace(path, path, customData);
    const projects2 = await client.getDataspaces();
    expect(projects2).toBeTruthy();
    if (!projects2) {
      return;
    }
    expect(projects2.filter(r => r.path.includes(path)).length).toBe(1);
    const testDataspace = projects2.find(p => p.path.includes(dataspaceName));
    expect(testDataspace).toBeDefined();
    if (!testDataspace) {
      return;
    }
    const resources = await client.getDataspaceResources(testDataspace.uri);
    await clientWrite.copyResourcesToDataspace(
      client,
      resources.map(r => r.uri),
      uri.uri
    );
    const resources2 = await clientWrite.getDataspaceResources(uri.uri, [
      "resqml20.obj_ContinuousProperty"
    ]);

    expect(resources2.length).toBe(10);
    const firstRes = await clientWrite.findResource(resources2[0].uri);
    expect(firstRes).toBeDefined();
    if (firstRes) {
      expect(resources2[0].uri).toEqual(firstRes.uri);
    }
    const sources = (await clientWrite.getSources(resources2[0].uri)).map(
      r => r.uri
    );
    sources.push(resources2[0].uri);
    await clientWrite.deleteObjects(sources);
    const resources3 = await clientWrite.getDataspaceResources(uri.uri);
    expect(resources3.length).toBe(89);

    try {
      await clientWrite.deleteDataspaces([uri.uri]);
    } catch (e) {
      await clientWrite.deleteDataspaces([uri.uri]);
    }

    await clientWrite.closeSession();
    const projects3 = await client.getDataspaces();
    await client.closeSession();
    expect(projects3?.filter(r => r.path.includes(path)).length).toBe(0);
  });

  it("Create Array Transaction", async () => {
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    const projects = await client.getDataspaces();
    expect(client.isConnected()).toBe(true);
    expect(projects).toBeTruthy();
    if (!projects) {
      return;
    }
    const testDataspace = projects.find(p => p.path.includes(dataspaceName));
    expect(testDataspace).toBeDefined();
    const fullArray: Int32Array = Int32Array.from([1, 1, 1, 1, 1, 1]);
    const aa: Int32Array = Int32Array.from([3, 3]);
    const transaction = await client.startTransaction(
      false,
      [projects[0].uri],
      "Create dummy array"
    );
    try {
      const uri = EtpUri.createObjectUri(
        dataspaceName,
        "eml",
        "2.0",
        "obj_EpcExternalPartReference",
        "53395ada-6f93-4bac-b506-d45997ded2a2"
      ).uri;
      const pathInResource = `/Resqml/${tSurfUid}/testArray`;
      await client.putDataArray(
        {
          uri,
          pathInResource
        },
        [2, 3],
        fullArray
      );
      const value = await client.getDataArray(uri, pathInResource);
      expect(value?.data?.data.item._ArrayOfInt?.values[5]).toBe(1);

      await client.putEmptyDataArray(
        {
          uri,
          pathInResource
        },
        aa,
        [2, 3]
      );
      await client.putDataSubArray(
        {
          uri,
          pathInResource
        },
        [1, 1],
        [1, 2],
        aa
      );
      const value2 = await client.getDataArray(uri, pathInResource);
      expect(value2?.data?.data.item._ArrayOfInt?.values[5]).toEqual(3);

      const subarray = await client.getDataSubarray(
        uri,
        pathInResource,
        [1, 0],
        [1, 3]
      );
      const data =
        subarray?.data as Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArray;
      expect(data.data.item._ArrayOfInt?.values[2]).toEqual(3);

      let sum = 0;
      await client.visitDataArrayValues({ uri, pathInResource }, values => {
        values.forEach(v => {
          if (typeof v === "number") {
            sum += v;
          }
        });
      });
      expect(sum).toEqual(6);

      const badPut = await client.putEmptyDataArray(
        {
          uri: EtpUri.createObjectUri(
            dataspaceName,
            "eml",
            "2.0",
            "obj_EpcExternalPartReference",
            "53395ada-6f93-0000-0000-d45997ded2a2"
          ).uri,
          pathInResource
        },
        aa,
        [2, 3]
      );
      expect(badPut).toBeFalsy();
      await client.rollbackTransaction(transaction);
    } catch (e) {
      await client.rollbackTransaction(transaction);
    }
    await client.closeSession();
  });

  it("Subscribe Notification fails", async () => {
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    const projects = await client.getDataspaces();

    const subscribeUuid = await client.subscribeNotifications(
      projects ? projects[0].uri : ""
    );

    expect(subscribeUuid).toBeNull();

    client.unsubscribeNotifications([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ]);
    await client.closeSession();
  });

  it("Delete Wrong Dataspace", async () => {
    const uri = EtpUri.createDataSpaceUri("test/toDeleteWrong");
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    const projects = await client.getDataspaces();
    const nbDataspaces = projects?.length || 0;
    try {
      await client.deleteDataspaces([uri.uri]);
    } catch {
      // Expected: server rejects deletion of non-existent dataspace
    }
    const projects2 = await client.getDataspaces();
    await client.closeSession();
    expect(projects2?.length).toBe(nbDataspaces);
  });

  it("Find Dataspace From itself", async () => {
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    const projects = await client.getDataspaces();
    expect(projects).toBeTruthy();
    if (!projects) {
      return;
    }
    await client.closeSession();
    expect(projects.length).toBeGreaterThanOrEqual(1);
    const testDataspace = projects.find(p => p.path.includes(dataspaceName));
    expect(testDataspace).toBeDefined();
  });
});

describe("SubArray", () => {
  it("Should handle getDataSubarray safely when bandwidth is less than array size", async () => {
    const arraySize = 10000; // Replace with actual array size
    const bandwidth = 200000; // Replace with actual bandwidth
    const dataspaceName = `test/ArrayBandwidth${uuidRandom()}`;

    // Set up the client and open session with low maxMessagePayloadSize
    const client = new ResqmlClient();
    client.setCallsTraceability(true);
    await client.openSession(
      etpServerUrl,
      jwt,
      testDataPartitionId,
      undefined,
      undefined,
      bandwidth
    );

    const dataSpaceUri = EtpUri.createDataSpaceUri(dataspaceName).uri;

    try {
      await client.createDataspaces([
        {
          path: dataspaceName,
          uri: dataSpaceUri,
          storeCreated: BigInt(Date.now()),
          storeLastWrite: BigInt(Date.now()),
          customData
        }
      ]);

      // Create a large array and send it to the server
      const subarray = new Int32Array(arraySize).fill(10);
      const uri = EtpUri.createObjectUri(
        dataspaceName,
        "eml",
        "2.0",
        "obj_EpcExternalPartReference",
        "53395ada-6f93-4bac-b506-d45997ded2a2"
      ).uri;
      const pathInResource = `/Resqml/${tSurfUid}/testArray`;
      const nbSlice = 10;

      // Push empty data array to the server
      await client.putEmptyDataArray({ uri, pathInResource }, subarray, [
        2,
        nbSlice,
        arraySize
      ]);

      // Push the large array to the server slice by slice, iterating over the array second dimension
      for (let i = 0; i < nbSlice; i++) {
        await client.putDataSubArray(
          { uri, pathInResource },
          [0, i, 0],
          [1, 1, arraySize],
          subarray
        );
        await client.putDataSubArray(
          { uri, pathInResource },
          [1, i, 0],
          [1, 1, arraySize],
          subarray
        );
      }

      // Get the subarray that starts at index 2 for each dimension and has ends at the last index
      const subArrayResult = await client.getDataSubarray(
        uri,
        pathInResource,
        [1, 2, 2],
        [1, nbSlice - 2, arraySize - 2]
      );
      expect(subArrayResult?.counts[0]).toBe(1);
      expect(subArrayResult?.counts[1]).toBe(nbSlice - 2);
      expect(subArrayResult?.counts[2]).toBe(arraySize - 2);
      expect(
        (subArrayResult?.data as DataArray).data.item._ArrayOfInt?.values.length
      ).toBe((nbSlice - 2) * (arraySize - 2));

      const arrayResult = await client.getDataArray(uri, pathInResource);
      expect(arrayResult?.data?.dimensions![0]).toBe(BigInt(2));
      expect(arrayResult?.data?.dimensions![1]).toBe(BigInt(nbSlice));
      expect(arrayResult?.data?.dimensions![2]).toBe(BigInt(arraySize));
      expect(
        (arrayResult?.data as DataArray).data.item._ArrayOfInt?.values.length
      ).toBe(2 * arraySize * nbSlice);
    } finally {
      // Delete empty array then delete object containing the array
      client.deleteDataspaces([dataSpaceUri]);
    }
    await client.closeSession();
  });
});

const total_nb_resqml_objects = 91;
const total_nb_relationships = 201;

describe("Objects", () => {
  it("Raw", async () => {
    const client = new ResqmlClient({
      collapseTextElement: false,
      removeNamespace: false
    });
    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    try {
      const projects = await client.getDataspaces();
      expect(projects).toBeTruthy();
      if (!projects) {
        return;
      }
      const testDataspace = projects.find(p => p.path.includes(dataspaceName));
      expect(testDataspace).toBeTruthy();
      if (!testDataspace) {
        return;
      }
      const testDataspaceUri = testDataspace?.uri;

      const t = await client.getDataspaceTypes(testDataspaceUri);
      expect(t.length).toBe(16);

      const objects: Resource[] =
        await client.getDataspaceResources(testDataspaceUri);
      // Objects
      expect(objects.length).toBe(total_nb_resqml_objects);

      const fullGraph: ResourceGraph =
        await client.getDataspaceGraph(testDataspaceUri);
      // Graph
      expect(fullGraph.size).toBe(total_nb_resqml_objects);
      expect(fullGraph.edges.length).toBe(total_nb_relationships);

      // Property
      const uri = `${testDataspaceUri}/${tSurfType}(${tSurfUid})`;
      // Check if property exists
      const obj = await client.findResource(uri);
      expect(obj).toBeDefined();
      const sources = await client.getSources(uri);
      expect(sources.length).toBe(4);

      const graphSources = fullGraph.sources(uri);
      expect(graphSources.length).toBe(4);

      const targets = await client.getTargets(uri);
      expect(targets.length).toBe(2);

      const graphTargets = fullGraph.targets(uri);
      expect(graphTargets.length).toBe(2);

      const target = targets.find(r =>
        r.uri.endsWith(`${targetType}(${targetUid})`)
      );
      expect(target).toBeDefined();

      try {
        await client.getSources(testDataspaceUri);
      } catch (reason) {
        expect(reason).toContain("Invalid URI: Expecting DataObject");
      }

      const searched = await client.getDataspaceResources(
        `${testDataspaceUri}?$filter=SurfaceRole eq 'map'`
      );
      expect(searched).toHaveLength(3);

      // get featured surface and grid horizons
      const interpretations = await client.getDataspaceResources(
        testDataspaceUri,
        [targetType]
      );
      expect(interpretations).toHaveLength(6);
      const interpretation = interpretations.filter(
        ff => ff.uri === `${testDataspaceUri}/${targetType}(${targetUid})`
      )[0];
      expect(interpretation).toBeDefined();
      const featuredSources = await client.getSources(
        interpretation.uri,
        false,
        [crsType, tSurfType, grid2dType]
      );
      expect(featuredSources).toHaveLength(1);
      const featuredSourcesWithSecondary = await client.getSources(
        {
          uri: interpretation.uri,
          depth: 10,
          dataObjectTypes: [crsType, tSurfType, grid2dType],
          includeSecondaryTargets: true,
          includeSecondarySources: false,
          navigableEdges:
            Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both
        },
        false,
        [crsType, tSurfType, grid2dType]
      );
      expect(featuredSourcesWithSecondary.length).toBe(9);
    } catch (err: any) {
      failOnUnexpectedError(err);
    } finally {
      await client.closeSession();
    }
  });
  it("Resolved", async () => {
    const options = {
      collapseTextElement: true,
      removeNamespace: true
    };
    const client = new ResqmlClient(options);

    try {
      await client.openSession(etpServerUrl, jwt, testDataPartitionId);
      const projects = await client.getDataspaces();
      expect(projects).toBeTruthy();
      if (!projects) {
        return;
      }
      const testDataspace = projects.find(p => p.path.includes(dataspaceName));
      expect(testDataspace).toBeTruthy();
      if (!testDataspace) {
        return;
      }
      // project: /home/pdgm/data/testingPackageCpp.epc
      const testDataspaceUri = testDataspace?.uri;

      const objects: Resource[] =
        await client.getDataspaceResources(testDataspaceUri);

      // Objects
      expect(objects.length).toBe(total_nb_resqml_objects);
      const externalObjects = new Map<string, IResqmlDataObject>();
      // Resolving all objects may takes a long time > timeout
      const filteredObjects = objects.filter(o =>
        o.uri.endsWith(`(${tSurfUid})`)
      );
      const resourceObjects = await client.getResolvedObjects(
        filteredObjects.map(o => o.uri),
        externalObjects,
        true
      );

      const ts = resourceObjects.find(r => r && r.Uuid === tSurfUid);
      expect(ts).toBeTruthy();
      expect(ts?.Citation.Title).toBe(tSurfName);
      const dimensions = (
        (ts as SimpleJson<Resqml20.obj_TriangulatedSetRepresentation>)
          ?.TrianglePatch[0]?.Geometry
          ?.Points as SimpleJson<Resqml20.Point3dHdf5Array>
      )?.Coordinates?._data?.Dimensions;
      expect(dimensions).toBeDefined();
      if (dimensions) {
        expect(dimensions[0]).toBe(7523);
      }
      if (!ts) {
        return;
      }
      expect(XmlUtils.checkResqmlObject(ts)).toBeDefined();
      const o2: any = ts;
      o2.Citation = null;
      expect(XmlUtils.checkResqmlObject(ts)).toBeNull();
    } catch (err: any) {
      failOnUnexpectedError(err);
    } finally {
      await client.closeSession();
    }
  });

  it("Add Data Arrays", async () => {
    const options = {
      collapseTextElement: true,
      removeNamespace: true
    };
    const client = new ResqmlClient(options);

    await client.openSession(etpServerUrl, jwt, testDataPartitionId);
    const projects = await client.getDataspaces();
    expect(projects).toBeTruthy();
    if (!projects) {
      return;
    }
    const testDataspace = projects.find(p => p.path.includes(dataspaceName));
    expect(testDataspace).toBeDefined();
    if (!testDataspace) {
      expect(false);
      return;
    }
    // project: /home/pdgm/data/testingPackageCpp.epc
    const testDataspaceUri = testDataspace?.uri;

    const objects: Resource[] =
      await client.getDataspaceResources(testDataspaceUri);

    // Objects
    expect(objects.length).toBe(total_nb_resqml_objects);
    // Resolving all objects may takes a long time > timeout
    const filteredObjects = objects.filter(obj =>
      obj.uri.endsWith(`(${tSurfUid})`)
    );
    const o = await client.getObjects([filteredObjects[0].uri]);
    if (o[0]) {
      const ts = await client.addArrayValues(filteredObjects[0].uri, o[0]);
      const dimensions = (
        (ts as SimpleJson<Resqml20.obj_TriangulatedSetRepresentation>)
          ?.TrianglePatch[0]?.Geometry
          ?.Points as SimpleJson<Resqml20.Point3dHdf5Array>
      )?.Coordinates?._data?.Dimensions;
      expect(dimensions).toBeDefined();
      if (dimensions) {
        expect(dimensions[0]).toBe(7523);
      }
    }
    await client.closeSession();
  });
});

describe("Core messages", () => {
  jest.setTimeout(maxTime);
  let etpClient: ETPClient;
  beforeEach(() => {
    etpClient = new ETPClient({
      name: "Test Core ETP Client"
    });
  });

  afterEach(async () => {
    if (etpClient.isInSession()) {
      etpClient.closeSession();
    }
  });

  it(`Test acknowledge`, async () => {
    const header: Energistics.Etp.v12.Datatypes.MessageHeader = {
      protocol: 0,
      messageType: Energistics.Etp.v12.Protocol.Core.MsgAcknowledge,
      correlationId: BigInt(-1),
      messageId: BigInt(1),
      messageFlags: MessageFlags.FINALPART
    };
    const v = await new Promise(resolve => {
      etpClient.on("acknowledge", () => {
        resolve(true);
      });
      const ack: Energistics.Etp.v12.Protocol.Core.Acknowledge = {};
      etpClient.handleMessage(header, ack);
      setTimeout(() => resolve(false), 5000);
    });
    expect(v).toBeTruthy();
  });
  it(`Test exception`, async () => {
    const header: Energistics.Etp.v12.Datatypes.MessageHeader = {
      protocol: 0,
      messageType: Energistics.Etp.v12.Protocol.Core.MsgProtocolException,
      correlationId: BigInt(-1),
      messageId: BigInt(1),
      messageFlags: MessageFlags.FINALPART
    };
    const v = await new Promise(resolve => {
      etpClient.on("exception", () => {
        resolve(true);
      });
      const exception: Energistics.Etp.v12.Protocol.Core.ProtocolException = {
        error: { code: 1, message: "Error" },
        errors: new Map()
      };
      etpClient.handleMessage(header, exception);
      setTimeout(() => resolve(false), 5000);
    });
    expect(v).toBeTruthy();
  });
  it(`Test On Ping`, async () => {
    const header: Energistics.Etp.v12.Datatypes.MessageHeader = {
      protocol: 0,
      messageType: Energistics.Etp.v12.Protocol.Core.MsgPing,
      correlationId: BigInt(-1),
      messageId: BigInt(1),
      messageFlags: MessageFlags.FINALPART
    };
    const v = await new Promise(resolve => {
      etpClient.on("ping", () => {
        resolve(true);
      });
      const ping: Energistics.Etp.v12.Protocol.Core.Ping = {
        currentDateTime: BigInt(0)
      };
      etpClient.handleMessage(header, ping);
      setTimeout(() => resolve(false), 5000);
    });
    expect(v).toBeTruthy();
  });
  it(`Test closeSession`, async () => {
    const header: Energistics.Etp.v12.Datatypes.MessageHeader = {
      protocol: 0,
      messageType: Energistics.Etp.v12.Protocol.Core.MsgCloseSession,
      correlationId: BigInt(-1),
      messageId: BigInt(1),
      messageFlags: MessageFlags.FINALPART
    };
    const closeMsg: Energistics.Etp.v12.Protocol.Core.CloseSession = {
      reason: "test closure"
    };
    const v = await new Promise(resolve => {
      etpClient.on("close", () => {
        resolve(true);
      });
      etpClient.handleMessage(header, closeMsg);
      setTimeout(() => resolve(false), 5000);
    });
    expect(v).toBeTruthy();
  });
});

describe("OSDU Dataspaces", () => {
  const c2 = new ResqmlClient();
  it("Dataspaces import", async () => {
    c2.setCallsTraceability(true);
    await c2.openSession(etpServerUrl, jwt, testDataPartitionId);
    let thrown = false;
    try {
      const projects = await c2.getDataspaces();
      expect(c2.isConnected()).toBe(true);
      expect(projects).toBeTruthy();

      if (projects == null) {
        await c2.closeSession();
        return;
      }

      const p = projects[0];
      const pInfo = await c2.getDataspaceInfo([p.uri]);
      expect(pInfo.length).toBe(1);
      expect(pInfo[0]?.uri).toBe(p.uri);

      const destinationSpace = "eml:///dataspace('Import/test')";

      await c2.createDataspaces([
        {
          uri: destinationSpace,
          path: "Import/test",
          storeLastWrite: BigInt(0),
          storeCreated: BigInt(0),
          customData
        }
      ]);

      // Attempt to delete lock dataspace should fail
      expect(await c2.lockDataspaces([destinationSpace])).toBeTruthy();
      let deleteLocked = true;
      try {
        await c2.deleteDataspaces([destinationSpace]);
        deleteLocked = false;
      } catch {
        // Expected: cannot delete a locked dataspace
      }
      expect(deleteLocked).toBeTruthy();
      expect(await c2.unlockDataspaces([destinationSpace])).toBeTruthy();

      // Unlock of a read-only dataspace should fail
      expect(await c2.unlockDataspaces([destinationSpace])).toBeFalsy();

      // Import of a read-write dataspace should fail
      expect(
        await c2.copyDataspacesContent(destinationSpace, [p.uri])
      ).toBeFalsy();

      // Import of a read-only dataspace should succeed
      expect(await c2.lockDataspaces([p.uri])).toBeTruthy();
      expect(
        await c2.copyDataspacesContent(destinationSpace, [p.uri])
      ).toBeTruthy();
      //Unlock of a referenced dataspace should fail
      expect(await c2.unlockDataspaces([p.uri])).toBeFalsy();
      expect(
        (await c2.getDataspaceResources(destinationSpace)).length
      ).toBeGreaterThan(0);

      expect(await c2.deleteDataspaces([destinationSpace])).toBeTruthy();
      expect(await c2.unlockDataspaces([p.uri])).toBeTruthy();
    } catch (err) {
      thrown = true;
    }
    await c2.closeSession();
    expect(thrown).toBeFalsy();
  });

  it("Resources import", async () => {
    const c3 = new ResqmlClient();
    c3.setCallsTraceability(true);
    await c3.openSession(etpServerUrl, jwt, testDataPartitionId);
    expect(c3.isConnected()).toBe(true);

    const projects = await c3.getDataspaces();
    expect(projects).toBeTruthy();

    if (projects == null) {
      await c3.closeSession();
      return;
    }

    const p = projects[0];
    const pInfo = await c3.getDataspaceInfo([p.uri]);
    expect(pInfo.length).toBe(1);
    expect(pInfo[0]?.uri).toBe(p.uri);

    const res = await c3.getDataspaceResources(p.uri);
    expect(res.length).toBeGreaterThan(0);

    const destinationSpace = "eml:///dataspace('Import/test2')";

    await c3.createDataspaces([
      {
        uri: destinationSpace,
        path: "Import/test2",
        storeLastWrite: BigInt(0),
        storeCreated: BigInt(0),
        customData
      }
    ]);

    // Import of a read-only dataspace should succeed
    expect(await c3.lockDataspaces([p.uri])).toBeTruthy();
    expect(
      await c3.copyToDataspace(destinationSpace, [res[0].uri])
    ).toBeTruthy();

    //Unlock of a referenced dataspace should fail
    expect(await c3.unlockDataspaces([p.uri])).toBeFalsy();
    expect(
      (await c3.getDataspaceResources(destinationSpace)).length
    ).toBeGreaterThan(0);

    expect(await c3.deleteDataspaces([destinationSpace])).toBeTruthy();
    expect(await c3.unlockDataspaces([p.uri])).toBeTruthy();

    await c3.closeSession();
  });
});

//*****************************************************/
/// REST API
//*****************************************************/
describe("Rest server health", () => {
  it.each(serverData)("Check API readiness probe %s", async type => {
    await testServers[type]
      .get(`${restApiServerPath}/health/readiness`)
      .expect(200);
  });
  it.each(serverData)("Check API liveness probe %s", async type => {
    await testServers[type]
      .get(`${restApiServerPath}/health/liveness`)
      .expect(200);
  });
});

describe("Large number of API access", () => {
  jest.setTimeout(maxTime);
  it.each(serverData)(`Get Dataspace Ok %s`, async type => {
    for (let i = 0; i < 200; i++) {
      await testServers[type]
        .get(`${restApiServerPath}/dataspaces`)
        .set(`Authorization`, `Bearer ${token}`)
        .expect(`Content-Type`, /json/)
        .expect(200);
    }
  });
});

describe("Rest API tools", () => {
  it.each(serverData)("sliceArray", () => {
    expect(
      controlUtils.sliceArray<string>(1, 2, [
        "one",
        "two",
        "three",
        "four",
        "five"
      ])
    ).toStrictEqual(["two", "three"]);
  });

  it.each(serverData)(
    "QueryString",
    async () => {
      const c = new ResqmlClient();
      c.setCallsTraceability(false);
      const query = {
        top: 4
      };
      await c.openSession(etpServerUrl, jwt, testDataPartitionId);
      const projects = await c.getDataspaces();
      const volveDataspace = (projects &&
        projects.find(project => project.path.includes(dataspaceName))) || {
        uri: ""
      };
      const res = await controlUtils.findResources(
        c,
        {
          uri: volveDataspace.uri,
          depth: 1,
          dataObjectTypes: [],
          navigableEdges: "Both"
        },
        query
      );
      await c.closeSession();
      expect(res).toHaveLength(total_nb_resqml_objects);
    },
    400000
  );
});

describe("Rest API Transaction 2.0.1 Workflow", () => {
  it.each(serverData)(
    "Full Workflow",
    async type => {
      const crsObject: SimpleJson<Resqml20.obj_LocalDepth3dCrs> = {
        Citation: {
          Title: "CustomTestCrs",
          Originator: "dalsaab",
          Creation: new Date("2021-09-02T07:57:28.000Z"),
          Format:
            "RESQML Modeling Application v1.0 for Linux_x64",
          Editor: "dalsaab",
          LastUpdate: new Date("2021-09-06T13:30:24.000Z")
        },
        YOffset: 6470000,
        ZOffset: 0,
        ArealRotation: {
          _: 0,
          $type: "eml20.PlaneAngleMeasure",
          Uom: "rad"
        },
        ProjectedAxisOrder: "easting northing",
        ProjectedUom: "m",
        VerticalUom: "m",
        XOffset: 420000,
        ZIncreasingDownward: true,
        VerticalCrs: {
          EpsgCode: 6230,
          $type: "eml20.VerticalCrsEpsgCode"
        },
        ProjectedCrs: {
          EpsgCode: 23031,
          $type: "eml20.ProjectedCrsEpsgCode"
        },
        $type: "resqml20.obj_LocalDepth3dCrs",
        SchemaVersion: "2.0",
        Uuid: "7c7d7987-b7b9-4215-9014-cb7d6fb62173"
      };
      const HdfObject: SimpleJson<Eml20.obj_EpcExternalPartReference> = {
        Citation: {
          $type: "eml20.Citation",
          Title: "Hdf Proxy",
          Originator: "Mathieu",
          Creation: new Date("2014-09-09T15:33:25Z"),
          Format: "[F2I-CONSULTING:resqml2CppApi]"
        },
        MimeType: "application/x-hdf5",
        $type: "eml20.obj_EpcExternalPartReference",
        SchemaVersion: "2.0.0.20140822",
        Uuid: `68f2a7d4-f7c1-4a75-95e9-3c6a7029fb23`
      };
      const pointSet: SimpleJson<Resqml20.obj_PointSetRepresentation> = {
        Citation: {
          Title: "Pointset 1",
          Originator: "user1",
          Creation: new Date("2019-01-08T13:41:25.000Z"),
          Format:
            "RESQML Modeling Application v1.0 for Linux_x64",
          $type: "eml20.Citation"
        },
        ExtraMetadata: [
          {
            Name: "app/resqml/creatorGroup",
            Value: "Interpreters",
            $type: "resqml20.NameValuePair"
          }
        ],
        NodePatch: [
          {
            PatchIndex: 0,
            Count: 6,
            Geometry: {
              $type: "resqml20.PointGeometry",
              LocalCrs: {
                $type: "eml20.DataObjectReference",
                ContentType:
                  "application/x-resqml+xml;version=2.0;type=obj_LocalDepth3dCrs",
                Title: "CustomTestCrs",
                UUID: "7c7d7987-b7b9-4215-9014-cb7d6fb62173"
              },
              Points: {
                $type: "resqml20.Point3dHdf5Array",
                Coordinates: {
                  $type: "eml20.Hdf5Dataset",
                  PathInHdfFile:
                    "/RESQML/5d27775e-5c7f-4786-a048-9a303fa1165a/points_patch0",
                  HdfProxy: {
                    $type: "eml20.DataObjectReference",
                    ContentType:
                      "application/x-resqml+xml;version=2.0;type=obj_EpcExternalPartReference",
                    UUID: "68f2a7d4-f7c1-4a75-95e9-3c6a7029fb23",
                    DescriptionString: "Hdf Proxy",
                    VersionString: "1410276805"
                  }
                }
              }
            }
          }
        ],
        $type: "resqml20.obj_PointSetRepresentation",
        SchemaVersion: "2.0.0.20140822",
        Uuid: "5d27775e-5c7f-4786-a048-9a303fa1165a"
      };
      const array = {
        ContainerType: "eml20.obj_EpcExternalPartReference",
        ContainerUuid: "68f2a7d4-f7c1-4a75-95e9-3c6a7029fb23",
        PathInResource:
          "/RESQML/5d27775e-5c7f-4786-a048-9a303fa1165a/points_patch0",
        Dimensions: [3, 3],
        PreferredSubarrayDimensions: [3, 1],
        Data: "AAAAAAAAAAAAAAAAAACAPwAAgD8AAIA/AAAAQAAAAEAAAABA",
        ArrayType: "Float32Array"
      };

      const dataSpace = `projectA/ScenarioTest${uuidRandom()}`;
      await testServers[type]
        .post(`${restApiServerPath}/dataspaces`)
        .set(`Authorization`, `Bearer ${token}`)
        .send([
          {
            DataspaceId: dataSpace,
            Path: dataSpace,
            CustomData: {
              owners,
              viewers,
              legaltags,
              otherRelevantDataCountries
            }
          }
        ])
        .expect(`Content-Type`, /json/)
        .expect(201);

      const res = await testServers[type]
        .get(`${restApiServerPath}/dataspaces`)
        .set(`Authorization`, `Bearer ${token}`)
        .expect(`Content-Type`, /json/)
        .expect(200);
      const len = res.body.filter(
        (d: any) => d.uri === `eml:///dataspace('${dataSpace}')`
      ).length;
      expect(len).toBe(1);

      const trans = await testServers[type]
        .post(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/transactions`
        )
        .set(`Authorization`, `Bearer ${token}`)
        .expect(201);
      const transId = trans.text;

      await testServers[type]
        .put(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/resources?transactionId=${transId}`
        )
        .set(`Authorization`, `Bearer ${token}`)
        .send([crsObject, HdfObject, pointSet])
        .expect(200);

      await testServers[type]
        .put(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/resources/arrays?transactionId=${transId}`
        )
        .set(`Authorization`, `Bearer ${token}`)
        .send([array])
        .expect(200);

      // Visible Inside transaction
      const res2 = await testServers[type]
        .get(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/resources?transactionId=${transId}`
        )
        .set(`Authorization`, `Bearer ${token}`);
      expect(res2.body.length).toBe(3);

      // Invisible outside transaction
      const res3 = await testServers[type]
        .get(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/resources`
        )
        .set(`Authorization`, `Bearer ${token}`);
      expect(res3.body.length).toBe(0);

      await testServers[type]
        .put(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/transactions/${transId}`
        )
        .set(`Authorization`, `Bearer ${token}`)
        .expect(200);

      // Visible after transaction
      const res4 = await testServers[type]
        .get(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/resources`
        )
        .set(`Authorization`, `Bearer ${token}`);
      expect(res4.body.length).toBeGreaterThanOrEqual(3); // Account for potential import

      await testServers[type]
        .delete(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(dataSpace)}`
        )
        .set(`Authorization`, `Bearer ${token}`)
        .send([
          {
            DataspaceId: `${dataSpace}`,
            Path: `${dataSpace}`,
            CustomData: {
              owners,
              viewers,
              legaltags,
              otherRelevantDataCountries
            }
          }
        ])
        .expect(204);
    },
    400000
  );
});

describe("Rest API Transaction 2.2 Workflow", () => {
  it.each(serverData)(
    "Seismic Horizons",
    async type => {
      const horizonRep: SimpleJson<Resqml22.Grid2dRepresentation> = {
        $type: "resqml22.Grid2dRepresentation",
        SchemaVersion: "2.2",
        Uuid: "030a82f6-10a7-4ecf-af03-54749e098624",
        Citation: {
          $type: "eml23.Citation",
          Title: "Horizon1 Interp1 Grid2dRep",
          Originator: "philippe",
          Creation: new Date("2024-02-06T10:53:01.000Z"),
          Format: "F2I-CONSULTING:FESAPI Example:3.0.0.0"
        },
        OSDUIntegration: {
          LegalTags: ["opendes-ReservoirDDMS-Legal-Tag"],
          OwnerGroup: ["group1"],
          LineageAssertions: [
            {
              $type: "eml23.OSDULineageAssertion",
              ID: "opendes:work-product-component--SeismicHorizon:65681972-6eef-497e-b1d8-2f54a87ad950",
              LineageRelationshipKind: "direct"
            }
          ]
        },
        RepresentedObject: {
          $type: "eml23.DataObjectReference",
          Uuid: "ac12dc12-4951-459b-b585-90f48aa88a5a",
          QualifiedType: "resqml22.HorizonInterpretation",
          Title: "Horizon1 Interp1"
        },
        SurfaceRole: "map",
        FastestAxisCount: 4,
        SlowestAxisCount: 2,
        Geometry: {
          $type: "resqml22.PointGeometry",
          LocalCrs: {
            $type: "eml23.DataObjectReference",
            Uuid: "49ff9f92-aae5-49af-98ec-1496c6343a90",
            QualifiedType: "eml23.LocalEngineeringCompoundCrs",
            Title: "Default local CRS"
          },
          Points: {
            $type: "resqml22.Point3dZValueArray",
            SupportingGeometry: {
              $type: "resqml22.Point3dFromRepresentationLatticeArray",
              NodeIndicesOnSupportingRepresentation: {
                $type: "eml23.IntegerLatticeArray",
                StartValue: 0,
                Offset: [
                  {
                    $type: "eml23.IntegerConstantArray",
                    Value: 1,
                    Count: 1
                  },
                  {
                    $type: "eml23.IntegerConstantArray",
                    Value: 1,
                    Count: 3
                  }
                ]
              },
              SupportingRepresentation: {
                $type: "eml23.DataObjectReference",
                Uuid: "aa5b90f1-2eab-4fa6-8720-69dd4fd51a4d",
                QualifiedType: "resqml22.Grid2dRepresentation",
                Title: "Seismic BinGrid"
              }
            },
            ZValues: {
              $type: "eml23.FloatingPointXmlArray",
              CountPerValue: 1,
              Values: [300.0, 310.0, 350.0, 355.0, 400.0, 410.0, 450.0, 455.0]
            }
          }
        }
      };
      const horizonCrs: SimpleJson<Eml23.LocalEngineeringCompoundCrs> = {
        $type: "eml23.LocalEngineeringCompoundCrs",
        SchemaVersion: "2.3",
        Uuid: "49ff9f92-aae5-49af-98ec-1496c6343a90",
        Citation: {
          $type: "eml23.Citation",
          Title: "Default local CRS",
          Originator: "philippe",
          Creation: new Date("2024-02-06T10:53:01.000Z"),
          Format: "F2I-CONSULTING:FESAPI Example:3.0.0.0"
        },
        VerticalCrs: {
          $type: "eml23.DataObjectReference",
          Uuid: "1f774a06-7d6f-5de0-ad1c-aebde6ecd2ea",
          QualifiedType: "eml23.VerticalCrs",
          Title: "Default local CRS VerticalCrs"
        },
        OriginVerticalCoordinate: 0,
        VerticalAxis: {
          $type: "eml23.VerticalAxis",
          Direction: "down",
          Uom: "m",
          IsTime: false
        },
        LocalEngineering2dCrs: {
          $type: "eml23.DataObjectReference",
          Uuid: "a95299f3-7005-5112-b6ad-6776525a7bbb",
          QualifiedType: "eml23.LocalEngineering2dCrs",
          Title: "Default local CRS LocalEngineering2dCrs"
        }
      };
      const horizonVertCrs: SimpleJson<Eml23.VerticalCrs> = {
        $type: "eml23.VerticalCrs",
        SchemaVersion: "2.3",
        Uom: "m",
        Uuid: "1f774a06-7d6f-5de0-ad1c-aebde6ecd2ea",
        Citation: {
          $type: "eml23.Citation",
          Title: "Default local time CRS VerticalCrs",
          Originator: "philippe",
          Creation: new Date("2024-02-06T10:53:01.000Z"),
          Format: "F2I-CONSULTING:FESAPI Example:3.0.0.0"
        },
        Direction: "down",
        AbstractVerticalCrs: {
          $type: "eml23.VerticalUnknownCrs",
          Unknown: "Unknown"
        }
      };
      const horizon2dCrs: SimpleJson<Eml23.LocalEngineering2dCrs> = {
        $type: "eml23.LocalEngineering2dCrs",
        SchemaVersion: "2.3",
        Uuid: "a95299f3-7005-5112-b6ad-6776525a7bbb",
        Citation: {
          $type: "eml23.Citation",
          Title: "Default local time CRS LocalEngineering2dCrs",
          Originator: "philippe",
          Creation: new Date("2024-02-06T10:53:01.000Z"),
          Format: "F2I-CONSULTING:FESAPI Example:3.0.0.0"
        },
        Azimuth: {
          $type: "eml23.PlaneAngleMeasureExt",
          Uom: "rad",
          _: 0
        },
        AzimuthReference: "grid north",
        OriginProjectedCoordinate1: 1,
        OriginProjectedCoordinate2: 0.1,
        HorizontalAxes: {
          $type: "eml23.HorizontalAxes",
          Direction1: "east",
          Direction2: "north",
          Uom: "m",
          IsTime: false
        },
        OriginProjectedCrs: {
          $type: "eml23.ProjectedCrs",
          SchemaVersion: "2.3",
          Uom: "m",
          Uuid: "ddc1b3b1-7b3b-5e3b-8b3b-3b3b3b3b3b3b",
          Citation: {
            $type: "eml23.Citation",
            Title: "Default local time CRS LocalEngineering2dCrs ProjectedCrs",
            Originator: "philippe",
            Creation: new Date("2024-02-06T10:53:01.000Z"),
            Format: "F2I-CONSULTING:FESAPI Example:3.0.0.0"
          },
          AxisOrder: "easting northing",
          AbstractProjectedCrs: {
            $type: "eml23.ProjectedEpsgCrs",
            EpsgCode: 23031
          }
        }
      };
      const horizonFeat: SimpleJson<Resqml22.BoundaryFeature> = {
        $type: "resqml22.BoundaryFeature",
        SchemaVersion: "2.2",
        Uuid: "35d7b57e-e5ff-4062-95af-ba2d7c4ce347",
        Citation: {
          $type: "eml23.Citation",
          Title: "Horizon1",
          Originator: "philippe",
          Creation: new Date("1900-02-08T15:02:35.000Z"),
          Format: "F2I-CONSULTING:FESAPI Example:3.0.0.0"
        },
        IsWellKnown: false
      };
      const horizonInt: SimpleJson<Resqml22.HorizonInterpretation> = {
        $type: "resqml22.HorizonInterpretation",
        SchemaVersion: "2.2",
        Uuid: "ac12dc12-4951-459b-b585-90f48aa88a5a",
        Citation: {
          $type: "eml23.Citation",
          Title: "Horizon1 Interp1",
          Originator: "philippe",
          Creation: new Date("2024-02-06T10:53:01.000Z"),
          Format: "F2I-CONSULTING:FESAPI Example:3.0.0.0"
        },
        Domain: "mixed",
        InterpretedFeature: {
          $type: "eml23.DataObjectReference",
          Uuid: "35d7b57e-e5ff-4062-95af-ba2d7c4ce347",
          QualifiedType: "resqml22.BoundaryFeature",
          Title: "Horizon1"
        }
      };
      const binGridFeat: SimpleJson<Resqml22.SeismicLatticeFeature> = {
        $type: "resqml22.SeismicLatticeFeature",
        SchemaVersion: "2.2",
        Uuid: "eb6a5e97-4d86-4809-b136-051f34cfcb51",
        Citation: {
          $type: "eml23.Citation",
          Title: "Seismic lattice",
          Originator: "philippe",
          Creation: new Date("2024-02-06T10:53:01.000Z"),
          Format: "F2I-CONSULTING:FESAPI Example:3.0.0.0"
        },
        IsWellKnown: false,
        CrosslineLabels: {
          $type: "eml23.IntegerLatticeArray",
          StartValue: 152,
          Offset: [
            {
              $type: "eml23.IntegerConstantArray",
              Value: 2,
              Count: 1
            }
          ]
        },
        InlineLabels: {
          $type: "eml23.IntegerLatticeArray",
          StartValue: 150,
          Offset: [
            {
              $type: "eml23.IntegerConstantArray",
              Value: 2,
              Count: 3
            }
          ]
        }
      };
      const binGridInterpretation: SimpleJson<Resqml22.GenericFeatureInterpretation> =
      {
        $type: "resqml22.GenericFeatureInterpretation",
        SchemaVersion: "2.2",
        Uuid: "97816427-6ef6-4776-b21c-5b93c8a6310a",
        Citation: {
          $type: "eml23.Citation",
          Title: "Seismic lattice Interp",
          Originator: "philippe",
          Creation: new Date("2024-02-06T10:53:01.000Z"),
          Format: "F2I-CONSULTING:FESAPI Example:3.0.0.0"
        },
        Domain: "depth",
        InterpretedFeature: {
          $type: "eml23.DataObjectReference",
          Uuid: "eb6a5e97-4d86-4809-b136-051f34cfcb51",
          QualifiedType: "resqml22.SeismicLatticeFeature",
          Title: "Seismic lattice"
        }
      };

      const binGrid: SimpleJson<Resqml22.Grid2dRepresentation> = {
        $type: "resqml22.Grid2dRepresentation",
        SchemaVersion: "2.2",
        Uuid: "aa5b90f1-2eab-4fa6-8720-69dd4fd51a4d",
        Citation: {
          $type: "eml23.Citation",
          Title: "Seismic lattice Rep",
          Originator: "philippe",
          Creation: new Date("2024-02-06T10:53:01.000Z"),
          Format: "F2I-CONSULTING:FESAPI Example:3.0.0.0"
        },
        RepresentedObject: {
          $type: "eml23.DataObjectReference",
          Uuid: "97816427-6ef6-4776-b21c-5b93c8a6310a",
          QualifiedType: "resqml22.GenericFeatureInterpretation",
          Title: "Seismic lattice Interp"
        },
        SurfaceRole: "pick",
        FastestAxisCount: 4,
        SlowestAxisCount: 2,
        Geometry: {
          $type: "resqml22.PointGeometry",
          LocalCrs: {
            $type: "eml23.DataObjectReference",
            Uuid: "49ff9f92-aae5-49af-98ec-1496c6343a90",
            QualifiedType: "eml23.LocalEngineeringCompoundCrs",
            Title: "Default local CRS"
          },
          Points: {
            $type: "resqml22.Point3dLatticeArray",
            Origin: {
              $type: "resqml22.Point3d",
              Coordinate1: 0,
              Coordinate2: 0,
              Coordinate3: 0
            },
            Dimension: [
              {
                $type: "resqml22.Point3dLatticeDimension",
                Direction: {
                  $type: "resqml22.Point3d",
                  Coordinate1: 0,
                  Coordinate2: 1,
                  Coordinate3: 3
                },
                Spacing: {
                  $type: "eml23.FloatingPointConstantArray",
                  Value: 200,
                  Count: 1
                }
              },
              {
                $type: "resqml22.Point3dLatticeDimension",
                Direction: {
                  $type: "resqml22.Point3d",
                  Coordinate1: 1,
                  Coordinate2: 0,
                  Coordinate3: 2
                },
                Spacing: {
                  $type: "eml23.FloatingPointConstantArray",
                  Value: 250,
                  Count: 3
                }
              }
            ]
          }
        }
      };

      const dataSpace = `projectA/resqml22${uuidRandom()}`;
      await testServers[type]
        .post(`${restApiServerPath}/dataspaces`)
        .set(`Authorization`, `Bearer ${token}`)
        .send([
          {
            DataspaceId: dataSpace,
            Path: dataSpace,
            CustomData: {
              owners: owners,
              viewers: viewers,
              legaltags: legaltags,
              otherRelevantDataCountries: otherRelevantDataCountries
            }
          }
        ])
        .expect(`Content-Type`, /json/)
        .expect(201);

      const res = await testServers[type]
        .get(`${restApiServerPath}/dataspaces`)
        .set(`Authorization`, `Bearer ${token}`)
        .expect(`Content-Type`, /json/)
        .expect(200);
      const len = res.body.filter(
        (d: any) => d.uri === `eml:///dataspace('${dataSpace}')`
      ).length;
      expect(len).toBe(1);

      const trans = await testServers[type]
        .post(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/transactions`
        )
        .set(`Authorization`, `Bearer ${token}`)
        .expect(201);
      const transId = trans.text;

      await testServers[type]
        .put(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/resources?transactionId=${transId}`
        )
        .set(`Authorization`, `Bearer ${token}`)
        .send([
          horizonCrs,
          horizonVertCrs,
          horizon2dCrs,
          binGridFeat,
          binGridInterpretation,
          binGrid
        ])
        .expect(200);

      await testServers[type]
        .put(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/resources?transactionId=${transId}`
        )
        .set(`Authorization`, `Bearer ${token}`)
        .send([horizonRep, horizonInt, horizonFeat])
        .expect(200);

      await testServers[type]
        .put(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/transactions/${transId}`
        )
        .set(`Authorization`, `Bearer ${token}`)
        .expect(200);

      const res4 = await testServers[type]
        .get(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(
            dataSpace
          )}/resources/all`
        )
        .set(`Authorization`, `Bearer ${token}`);
      expect(res4.body.length).toBe(11);

      await testServers[type]
        .delete(
          `${restApiServerPath}/dataspaces/${encodeURIComponent(dataSpace)}`
        )
        .set(`Authorization`, `Bearer ${token}`)
        .expect(204);
    },
    400000
  );
});

describe(`Dataspace`, () => {
  it.each(serverData)(`Get Dataspace Unauthorized %s`, async type => {
    await testServers[type]
      .get(`${restApiServerPath}/dataspaces`)
      .expect(`Content-Type`, /json/)
      .expect(403);
  });

  it.each(serverData)(`Bad Bearer Format %s`, async type => {
    await testServers[type]
      .get(`${restApiServerPath}/dataspaces`)
      .set(`Authorization`, `${token}`)
      .expect(`Content-Type`, /json/)
      .expect(403);
  });

  it.each(serverData)(`Get Dataspace Ok %s`, async type => {
    await testServers[type]
      .get(`${restApiServerPath}/dataspaces`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
  });
});
describe(`Auth`, () => {
  it.each(serverData)(`No token %s`, async type => {
    const uris = [
      `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources`,
      `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}`,
      `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/all`,
      `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}`,
      `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/targets`,
      `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/sources`,
      `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/arrays`
    ];
    for (const u of uris) {
      await testServers[type].get(u).expect(403);
    }
  });

  it.each(serverData)(`Wrong dataspace %s`, async type => {
    const uris = [
      `${restApiServerPath}/dataspaces/${wrongDataspaceEncoded}/resources`,
      `${restApiServerPath}/dataspaces/${wrongDataspaceEncoded}/resources/${tSurfType}`,
      `${restApiServerPath}/dataspaces/${wrongDataspaceEncoded}/resources/all`,
      `${restApiServerPath}/dataspaces/${wrongDataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/targets`,
      `${restApiServerPath}/dataspaces/${wrongDataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/sources`,
      `${restApiServerPath}/dataspaces/${wrongDataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/arrays`,
      `${restApiServerPath}/dataspaces/${wrongDataspaceEncoded}/graph/all`,
      `${restApiServerPath}/dataspaces/${wrongDataspaceEncoded}/graph/${tSurfType}/${tSurfUid}/targets`,
      `${restApiServerPath}/dataspaces/${wrongDataspaceEncoded}/graph/${tSurfType}/${tSurfUid}/sources`
    ];
    for (const u of uris) {
      await testServers[type]
        .get(u)
        .set(`Authorization`, `Bearer ${token}`)
        .expect(404);
    }
  });
});
describe(`DataArray`, () => {
  it.each(serverData)(`Check Endianness`, () => {
    const arrayBuffer = new ArrayBuffer(2);
    const uint8Array = new Uint8Array(arrayBuffer);
    const uint16array = new Uint16Array(arrayBuffer);
    uint8Array[0] = 0xaa; // set first byte
    uint8Array[1] = 0xbb; // set second byte
    expect(uint16array[0]).toEqual(0xbbaa); // LE
    expect(uint16array[0]).not.toEqual(0xaabb); // BE
  });
});
describe(`Resources`, () => {
  const jsonMime = "application/json; charset=utf-8";
  it.each(serverData)(`Dataspaces %s`, async type => {
    const res = await testServers[type]
      .get(`${restApiServerPath}/dataspaces`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    const len = res.body.length;
    expect(len).toBeGreaterThan(0);
  });
  it.each(serverData)(`Dataspaces Info %s`, async type => {
    const res = await testServers[type]
      .get(`${restApiServerPath}/dataspaces/${dataspaceEncoded}/info`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    expect(res.body.path).toBe(dataspaceName);
  });
  it.each(serverData)(`Dataspaces Lock/unlock %s`, async type => {
    await testServers[type]
      .post(`${restApiServerPath}/dataspaces/${dataspaceEncoded}/lock`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(201);
    await testServers[type]
      .delete(`${restApiServerPath}/dataspaces/${dataspaceEncoded}/lock`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(200);
  });
  it.each(serverData)(`Types %s`, async type => {
    const res = await testServers[type]
      .get(`${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    expect(res.body).toHaveLength(16);
  });

  it.each(serverData)(`Wrong dataspacesTypes %s`, async type => {
    await testServers[type]
      .get(`${restApiServerPath}/dataspaces/${wrongDataspaceEncoded}/resources`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(404);
  });

  it.each(serverData)(`Resource by Types %s`, async type => {
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    expect(res.body).toHaveLength(3);
    const res2 = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}?$skip=1&$top=1`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    expect(res2.body).toHaveLength(1);
  });
  it.each(serverData)(`Find Resources %s`, async type => {
    const res = await testServers[type]
      .get(`${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/all`)

      .query(`$filter=startswith(SurfaceRole,'map') eq true`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    expect(res.body).toHaveLength(3);
  });

  it.each(serverData)(`Find Resources %s`, async type => {
    const res = await testServers[type]
      .get(`${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/all`)

      .query(`$filter=endswith(SurfaceRole,'map') eq true`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    expect(res.body).toHaveLength(3);
  });

  it.each(serverData)(`Get DataObjects JSON %s`, async type => {
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.header[`content-type`]).toBe(jsonMime);
  });

  it.each(serverData)(`Get DataObjects JSON Resolved %s`, async type => {
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}?referencedContent=true`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.header[`content-type`]).toBe(jsonMime);
  });

  it.each(serverData)(`Get DataObjects XML %s`, async type => {
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}?$format=xml`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(200);
    expect(res.header["content-type"]).toBe(
      "application/x-resqml+xml; charset=utf-8"
    );
    expect(res.text).toBeDefined();
  });

  it.each(serverData)(`Get Targets %s`, async type => {
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/targets`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(2);
    const res2 = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/targets?$skip=1&$top=1`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(200);
    expect(res2.body).toHaveLength(1);
  });

  it.each(serverData)(`Get Sources %s`, async type => {
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/sources`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(200);
    expect(res.body).toHaveLength(4);
    const res2 = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/sources?$skip=1&$top=1`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(200);
    expect(res2.body).toHaveLength(1);
  });

  it.each(serverData)(`Get Arrays %s`, async type => {
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/${tSurfType}/${tSurfUid}/arrays`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    expect(res.body).toHaveLength(40);
  });

  it.each(serverData)(`Get DataArrayMetadata %s`, async type => {
    const pathInResource = encodeURIComponent(
      `/RESQML/${tSurfUid}/points_patch0`
    );
    await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/eml20.obj_EpcExternalPartReference/${externalPartUid}/arrays/${pathInResource}/metadata`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
  });

  const firstArrayValue = 2048;

  it.each(serverData)(`Get DataArray JSON %s`, async type => {
    const pathInResource = encodeURIComponent(
      `/RESQML/${tSurfUid}/triangles_patch0`
    );
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/eml20.obj_EpcExternalPartReference/${externalPartUid}/arrays/${pathInResource}`
      )
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    expect(res.body.data.data[0]).toBe(firstArrayValue);
  });

  it.each(serverData)(`Get DataArray Base64 %s`, async type => {
    const pathInResource = encodeURIComponent(
      `/RESQML/${tSurfUid}/triangles_patch0`
    );
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/eml20.obj_EpcExternalPartReference/${externalPartUid}/arrays/${pathInResource}`
      )
      .query(`format=base64`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    // Convert from base64 string to array
    const buf = Buffer.from(res.body.data.data, "base64");
    const int8 = new Int8Array(buf);
    const data = new Int32Array(int8.buffer);
    const arr = Array.from(data);
    expect(arr[0]).toBe(firstArrayValue);
  });

  it.each(serverData)(`Get DataSubArray %s`, async type => {
    const pathInResource = encodeURIComponent(
      `/RESQML/${tSurfUid}/points_patch0`
    );
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/eml20.obj_EpcExternalPartReference/${externalPartUid}/arrays/${pathInResource}`
      )
      .query("starts=10")
      .query("starts=1")
      .query("counts=20")
      .query("counts=1")
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    expect(res.body.data.dimensions[0]).toBe(20);
  });

  it.each(serverData)(`Get DataSubArray Base64 %s`, async type => {
    const pathInResource = encodeURIComponent(
      `/RESQML/${tSurfUid}/points_patch0`
    );
    const res = await testServers[type]
      .get(
        `${restApiServerPath}/dataspaces/${dataspaceEncoded}/resources/eml20.obj_EpcExternalPartReference/${externalPartUid}/arrays/${pathInResource}`
      )
      .query("starts=12")
      .query("starts=1")
      .query("counts=10")
      .query("counts=1")
      .query(`format=base64`)
      .set(`Authorization`, `Bearer ${token}`)
      .expect(`Content-Type`, /json/)
      .expect(200);
    // Convert from base64 string to array
    const buf = Buffer.from(res.body.data.data, "base64");
    const int8 = new Int8Array(buf);
    const data = new Float64Array(int8.buffer);
    const arr = Array.from(data);
    expect(arr[0]).toBeCloseTo(5467.29, 2);
  });
});
describe(`Manifest`, () => {
  it.each(serverData)(
    `Manifest with references %s`,
    async type => {
      const manifestInput = {
        uris: [
          `eml:///dataspace('${dataspaceName}')/${tSurfType}(${tSurfUid})`,
          `eml:///dataspace('${dataspaceName}')/${targetType}(${targetUid})`
        ],
        tags: {
          quality: "good"
        },
        createMissingReferences: true
      };
      const res = await testServers[type]
        .post(`${restApiServerPath}/manifests/build`)
        .set(`Authorization`, `Bearer ${token}`)
        .send(manifestInput)
        .expect(`Content-Type`, /json/)
        .expect(201);
      const manifest = res.body as Manifest;
      expect(manifest.Data?.Datasets).toBeDefined();
      expect(manifest.Data?.WorkProduct).toBeUndefined();
      expect(manifest.Data?.WorkProductComponents?.length).toBe(5);
      expect(manifest.ReferenceData?.length).toBe(8);
    },
    maxTime
  );
});
