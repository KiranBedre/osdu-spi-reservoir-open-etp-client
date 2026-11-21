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
 * Integration tests for the ETP protocols added in M28 against a LIVE store:
 *
 *   - DiscoveryQuery (13)  FindResources deep/scoped queries, P13 == P3 equivalence,
 *                          dataObjectTypes / storeLastWriteFilter / activeStatusFilter, guards
 *   - GrowingObject (6)    PutParts / GetParts / GetPartsByRange / GetPartsMetadata /
 *                          GetChangeAnnotations / DeleteParts round trips on depth and time indexes
 *   - ChannelSubscribe (21) GetChannelMetadata on a data object (index derived from parts) and on
 *                          a dataspace (Log/Channel/Trajectory listing), error keys
 *   - REST facade          /query/resources/find and /query/growing on the
 *                          in-process NestJS app (JSON serialisation of long/BigInt fields)
 *   - Key types            one seeded object per RESQML key type (IJK grid, strat column chain,
 *                          trajectory, marker frame, deviation survey): exact typed P3
 *                          sources/targets, P13 agreement, P9 array inventory, content probe
 *
 * The suite is a CI gate (npm run test:integration, never part of `npm test`): it
 * FAILS when no ETP server is reachable or when the connected server does not
 * negotiate a protocol it is required to provide (CORE_PROTOCOLS plus
 * RDMS_ETP_PROTOCOLS in config.default.env, pinned together with RDMS_ETP_IMAGE).
 *
 * Everything else is decided by what the store actually negotiates, probed once
 * before registration by the jest globalSetup (fixtures/EtpCapabilities.ts): for
 * each optional protocol either its full block runs (store negotiates it) or the
 * client's FALLBACK block runs (P3 instead of P13, 501 on growing-object routes)
 * and the other twin is registered with describe.skip / it.skip, so it shows up
 * as SKIPPED in the junit report, never as passed. A silent early-return would
 * turn a regression such as "P13 no longer negotiated" into a green pipeline;
 * here it flips the report from the full block to the fallback block instead.
 *
 * Run: npm run env:set -- jest --testPathPattern TestProtocolsIntegration --forceExit
 */

import "jest";
import "reflect-metadata";
import request from "supertest";

import { Energistics, EtpUri, ResqmlClient, XmlUtils } from "../index";
import type { Resource } from "../index";
import restApp from "../lib/restApi/App";
import { etpRequiredProtocols, etpServerUrl, restApiServerPath } from "../lib/common/config";
import Logging from "../lib/common/Logging";
import { getAtPath, seededDataset } from "./fixtures/SeededDataset";
import { negotiatedProtocolsFromEnv } from "./fixtures/EtpCapabilities";
import type { IDataArray } from "../index";

type ContextScopeKind = Energistics.Etp.v12.Datatypes.Object.ContextScopeKind;
type ContextInfo = Energistics.Etp.v12.Datatypes.Object.ContextInfo;
type ObjectPart = Energistics.Etp.v12.Datatypes.Object.ObjectPart;
type IndexInterval = Energistics.Etp.v12.Datatypes.Object.IndexInterval;

const Protocol = Energistics.Etp.v12.Datatypes.Protocol;
const logger = Logging.getLogger("Jest");
const jwt = XmlUtils.createDefaultJWT();

const partitionId = process.env.RDMS_TEST_DATA_PARTITION_ID || "osdu";
const seededDataspace = seededDataset.dataspace;
const testDataspace = `test/protocols-${Date.now().toString(36)}`;
const maxTime = 600000;

const Scope = Energistics.Etp.v12.Datatypes.Object.ContextScopeKind;
const IndexKind = Energistics.Etp.v12.Datatypes.ChannelData.ChannelIndexKind;
const SCOPES: ContextScopeKind[] = [
  Scope.self,
  Scope.sources,
  Scope.targets,
  Scope.sourcesOrSelf,
  Scope.targetsOrSelf
];

const context = (uri: string, depth = 1, dataObjectTypes: string[] = []): ContextInfo => ({
  uri,
  depth,
  dataObjectTypes,
  includeSecondarySources: false,
  includeSecondaryTargets: false,
  navigableEdges: Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Primary
});

const uris = (r: { uri: string }[]) => r.map(x => x.uri).sort();

const indexValue = (v: number | bigint | null): Energistics.Etp.v12.Datatypes.IndexValue => {
  const iv = new Energistics.Etp.v12.Datatypes.IndexValue();
  if (v === null) {
    iv.item = null as any;
  } else if (typeof v === "bigint") {
    iv.item = { _long: v, __keyName: "_long" };
  } else {
    iv.item = { _double: v, __keyName: "_double" };
  }
  return iv;
};

const interval = (lo: number | bigint | null, hi: number | bigint | null, uom = "m"): IndexInterval => ({
  startIndex: indexValue(lo),
  endIndex: indexValue(hi),
  uom,
  depthDatum: ""
});

const numberOf = (iv: Energistics.Etp.v12.Datatypes.IndexValue): number => {
  const item: any = iv?.item;
  if (!item) {
    return NaN;
  }
  if (item._double !== undefined) {
    return Number(item._double);
  }
  if (item._long !== undefined) {
    return Number(item._long);
  }
  return NaN;
};

const stationPart = (uid: string, md: number): ObjectPart => {
  const xml =
    `<TrajectoryStation xmlns="http://www.energistics.org/energyml/data/witsmlv2" uid="${uid}">` +
    `<Md uom="m">${md}</Md><Incl uom="dega">1.5</Incl><Azi uom="dega">90</Azi></TrajectoryStation>`;
  return { uid, data: Buffer.from(xml) } as unknown as ObjectPart;
};

const timePart = (uid: string, iso: string): ObjectPart => {
  const xml = `<Row uid="${uid}"><DTim>${iso}</DTim><Value>1</Value></Row>`;
  return { uid, data: Buffer.from(xml) } as unknown as ObjectPart;
};

const opaquePart = (uid: string, text: string): ObjectPart =>
  ({ uid, data: Buffer.from(text) }) as unknown as ObjectPart;

const partText = (p: ObjectPart) => Buffer.from(p.data as any).toString("utf-8");

const crsXml = (uuid: string, title: string) => `<?xml version="1.0" encoding="UTF-8"?>
<resqml2:LocalDepth3dCrs xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:resqml2="http://www.energistics.org/energyml/data/resqmlv2" xmlns:eml="http://www.energistics.org/energyml/data/commonv2" schemaVersion="2.0" uuid="${uuid}" xsi:type="resqml2:obj_LocalDepth3dCrs">
  <eml:Citation xsi:type="eml:Citation">
    <eml:Title xsi:type="eml:DescriptionString">${title}</eml:Title>
    <eml:Originator xsi:type="eml:NameString">TestProtocolsIntegration</eml:Originator>
    <eml:Creation xsi:type="xsd:dateTime">2026-01-01T00:00:00Z</eml:Creation>
    <eml:Format xsi:type="eml:DescriptionString">open-etp-client</eml:Format>
  </eml:Citation>
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

// ---------------------------------------------------------------------------
// Shared live session
// ---------------------------------------------------------------------------

let client: ResqmlClient;

type ProtocolId = Energistics.Etp.v12.Datatypes.Protocol;

/** Every suite needs these; the per-protocol blocks below add their own. */
const CORE_PROTOCOLS: ProtocolId[] = [Protocol.Discovery, Protocol.Store, Protocol.DataArray];

const protocolByName = (name: string): ProtocolId => {
  const id = (Protocol as unknown as Record<string, ProtocolId | string>)[name];
  if (typeof id !== "number") {
    throw new Error(`RDMS_ETP_PROTOCOLS: unknown ETP protocol name '${name}'`);
  }
  return id;
};

/**
 * Protocols the pinned server image MUST negotiate: CORE_PROTOCOLS plus
 * RDMS_ETP_PROTOCOLS (config.default.env, next to RDMS_ETP_IMAGE). Asserted once
 * in beforeAll.
 */
const REQUIRED_PROTOCOLS: ProtocolId[] = [
  ...new Set([...CORE_PROTOCOLS, ...(etpRequiredProtocols ?? []).map(protocolByName)])
];

/**
 * What the live store negotiates, recorded by the globalSetup probe. Without a
 * probe result (store unreachable) assume the required set so the full blocks
 * register and beforeAll reports the connectivity failure.
 */
const NEGOTIATED_PROTOCOLS: ProtocolId[] = negotiatedProtocolsFromEnv() ?? REQUIRED_PROTOCOLS;

const negotiated = (...protocols: ProtocolId[]) => protocols.every(p => NEGOTIATED_PROTOCOLS.includes(p));

/** describe / it for a block that needs the given protocols; .skip (reported) otherwise. */
const describeFor = (...protocols: ProtocolId[]) => (negotiated(...protocols) ? describe : describe.skip);
const itFor = (...protocols: ProtocolId[]) => (negotiated(...protocols) ? it : it.skip);
/** The complement: the client's fallback when the store lacks the protocols. */
const itWithout = (...protocols: ProtocolId[]) => (negotiated(...protocols) ? it.skip : it);

const dsUri = `eml:///dataspace('${testDataspace}')`;
const seededUri = `eml:///dataspace('${seededDataspace}')`;
const crsUuid = "3f0e3a5e-9b8c-4e1f-a4f0-2c1a0f5b7d01";
const crsUri = `${dsUri}/resqml20.obj_LocalDepth3dCrs(${crsUuid})`;
const timeUuid = "3f0e3a5e-9b8c-4e1f-a4f0-2c1a0f5b7d02";
const timeUri = `${dsUri}/resqml20.obj_LocalDepth3dCrs(${timeUuid})`;

beforeAll(async () => {
  jest.setTimeout(maxTime);
  client = new ResqmlClient();
  client.setCallsTraceability(false);
  await client.openSession(etpServerUrl, jwt, partitionId);
  expect(client.isConnected()).toBe(true);
  const missing = REQUIRED_PROTOCOLS.filter(p => !client.isProtocolSupported(p));
  expect(missing.map(p => Protocol[p])).toEqual([]);
  // the blocks registered above were chosen from the probe; the live session must agree
  const live = NEGOTIATED_PROTOCOLS.filter(p => !client.isProtocolSupported(p));
  expect(live.map(p => Protocol[p])).toEqual([]);

  const ds = new Energistics.Etp.v12.Datatypes.Object.Dataspace();
  ds.uri = dsUri;
  ds.path = testDataspace;
  ds.storeCreated = BigInt(0);
  ds.storeLastWrite = BigInt(0);
  ds.customData = new Map();
  expect(await client.createDataspaces([ds])).toBe(true);
}, maxTime);

afterAll(async () => {
  if (client?.isConnected()) {
    try {
      await client.deleteDataspaces([dsUri]);
    } catch (e) {
      logger.warning(`cleanup failed: ${e}`);
    }
    await client.closeSession();
  }
});

// ---------------------------------------------------------------------------
// Key RESQML types of the seeded dataset, data-driven from SeededDataset.keyObjects
// ---------------------------------------------------------------------------

const typeHistogram = (r: Resource[], ignore: string[] = []): Record<string, number> => {
  const h: Record<string, number> = {};
  for (const x of r) {
    const t = new EtpUri(x.uri).dataObjectType as string;
    if (!ignore.includes(t)) {
      h[t] = (h[t] || 0) + 1;
    }
  }
  return h;
};

const activityType = "resqml20.obj_Activity";

describe.each(seededDataset.keyObjects)("Key type $label ($type)", key => {
  const uri = `${seededUri}/${key.type}(${key.uuid})`;

  it(
    "exists with its title and is one of countOfType objects of its type",
    async () => {
      const ofType = await client.getResources(context(seededUri, 1, [key.type]), Scope.self);
      expect(ofType).toHaveLength(key.countOfType);
      const self = ofType.find(r => r.uri === uri);
      expect(self?.name).toBe(key.name);
    },
    maxTime
  );

  it(
    "P3 getTargets has exactly the RESQML references the type must carry",
    async () => {
      const targets = await client.getTargets(uri);
      expect(typeHistogram(targets)).toEqual(key.targetTypes);
    },
    maxTime
  );

  it(
    "P3 getSources has exactly the expected referrers (auto-import Activity aside)",
    async () => {
      const sources = await client.getSources(uri);
      expect(typeHistogram(sources, [activityType])).toEqual(key.sourceTypes);
    },
    maxTime
  );

  it(
    "discovery is symmetric: every target lists the object among its sources and vice versa",
    async () => {
      const targets = await client.getTargets(uri);
      for (const t of targets) {
        expect(uris(await client.getSources(t.uri))).toContain(uri);
      }
      const sources = await client.getSources(uri);
      for (const src of sources) {
        expect(uris(await client.getTargets(src.uri))).toContain(uri);
      }
    },
    maxTime
  );

  itFor(Protocol.DiscoveryQuery)(
    "P13 FindResources agrees with P3 for sources and targets",
    async () => {
      for (const scope of [Scope.sources, Scope.targets]) {
        const p3 = uris(await client.getResources(context(uri), scope));
        const p13 = uris(await client.discoveryQuery.findResources(context(uri), scope));
        expect(p13).toEqual(p3);
      }
    },
    maxTime
  );

  it(
    "content resolves and references arrayCount Hdf5 datasets with readable metadata",
    async () => {
      const [obj] = await client.getObjects([uri]);
      expect(obj).not.toBeNull();
      expect((obj as any).Uuid ?? (obj as any).uuid).toBe(key.uuid);
      if (key.contentProbe) {
        const v = getAtPath(obj, key.contentProbe.path);
        expect(v).toBeDefined();
        if (key.contentProbe.length !== undefined) {
          expect(v).toHaveLength(key.contentProbe.length);
        }
      }
      const arrays = new Map<string, IDataArray>();
      client.findDataArrays(uri, obj as Record<string, any>, arrays);
      expect(arrays.size).toBe(key.arrayCount);
      for (const a of arrays.values()) {
        const meta = await client.getDataArrayMetadata(a.uid.uri, a.uid.pathInResource);
        expect(meta?.dimensions?.length).toBeGreaterThan(0);
      }
    },
    maxTime
  );
});

// ---------------------------------------------------------------------------
// Store round trips (4) used as fixtures by the protocol blocks below
// ---------------------------------------------------------------------------

describe("Store round trip (fixtures)", () => {
  it(
    "put two CRS objects and read them back byte-identical",
    async () => {
      const mk = (uuid: string, title: string) => {
        const o = new Energistics.Etp.v12.Datatypes.Object.DataObject();
        o.data = Buffer.from(crsXml(uuid, title));
        o.format = "xml";
        o.resource = {
          uri: `${dsUri}/resqml20.obj_LocalDepth3dCrs(${uuid})`,
          name: title,
          alternateUris: [],
          sourceCount: null,
          targetCount: null,
          storeCreated: BigInt(0),
          storeLastWrite: BigInt(0),
          activeStatus: Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind.Active,
          lastChanged: BigInt(0),
          customData: new Map()
        } as any;
        return o;
      };
      expect(await client.putDataObjects([mk(crsUuid, "Depth CRS"), mk(timeUuid, "Time CRS")])).toBe(true);
      const back = await client.getDataObjects([crsUri, timeUri]);
      expect(back.length).toBe(2);
      for (const o of back) {
        expect(o).not.toBeNull();
        const xml = Buffer.from(o!.data as any).toString("utf-8");
        expect(xml).toContain("obj_LocalDepth3dCrs");
        expect(xml).toContain(o!.resource.uri.includes(crsUuid) ? "Depth CRS" : "Time CRS");
      }
      const res = await client.getResources(dsUri, Scope.self);
      expect(uris(res)).toEqual([crsUri, timeUri].sort());
    },
    maxTime
  );
});

// ---------------------------------------------------------------------------
// DiscoveryQuery (13)
// ---------------------------------------------------------------------------

describeFor(Protocol.DiscoveryQuery)("DiscoveryQuery (13) FindResources", () => {
  let seeded: Resource[] = [];

  it(
    "dataspace self: P13 == P3 and non empty on the seeded dataspace",
    async () => {
      seeded = await client.getResources(seededUri, Scope.self);
      const p13 = await client.discoveryQuery.findResources(context(seededUri), Scope.self);
      expect(seeded.length).toBeGreaterThan(0);
      expect(uris(p13)).toEqual(uris(seeded));
    },
    maxTime
  );

  it(
    "deep queries: every scope x depth 1..3 on a sample of objects equals GetResources",
    async () => {
      // Deterministic sample: every Nth resource, at least 25, favouring well connected types.
      const step = Math.max(1, Math.floor(seeded.length / 25));
      const sample = seeded.filter((_, i) => i % step === 0);
      let pairs = 0;
      const mismatches: string[] = [];
      for (const r of sample) {
        for (const scope of SCOPES) {
          for (const depth of [1, 2, 3]) {
            const ctx = context(r.uri, depth);
            const a = uris(await client.getResources({ ...ctx }, scope));
            const b = uris(await client.discoveryQuery.findResources({ ...ctx }, scope));
            pairs++;
            if (JSON.stringify(a) !== JSON.stringify(b)) {
              mismatches.push(`${scope} d${depth} ${r.uri}: P3=${a.length} P13=${b.length}`);
            }
          }
        }
      }
      logger.info(`P13 == P3 over ${pairs} pairs, mismatches=${mismatches.length}`);
      expect(mismatches).toEqual([]);
      expect(pairs).toBeGreaterThanOrEqual(25 * SCOPES.length * 3);
    },
    maxTime
  );

  it(
    "dataObjectTypes filter restricts the type set and matches P3",
    async () => {
      const types = new Set(seeded.map(r => new EtpUri(r.uri).dataObjectType).filter(Boolean));
      expect(types.size).toBeGreaterThan(1);
      const [t1, t2] = [...types] as string[];
      const p13 = await client.discoveryQuery.findResources(context(seededUri, 1, [t1, t2]), Scope.self);
      const p3 = await client.getResources(context(seededUri, 1, [t1, t2]), Scope.self);
      expect(p13.length).toBeGreaterThan(0);
      expect(uris(p13)).toEqual(uris(p3));
      for (const r of p13) {
        expect([t1, t2]).toContain(new EtpUri(r.uri).dataObjectType);
      }
    },
    maxTime
  );

  it(
    "storeLastWriteFilter in the future returns nothing, in the past returns everything",
    async () => {
      const future = BigInt(Date.now() + 3600_000) * BigInt(1000);
      const fut = await client.discoveryQuery.findResources(context(seededUri), Scope.self, future);
      expect(fut.length).toBe(0);
      const past = await client.discoveryQuery.findResources(context(seededUri), Scope.self, BigInt(0));
      expect(uris(past)).toEqual(uris(seeded));
    },
    maxTime
  );

  it(
    "activeStatusFilter: the store tracks no active status, so Active selects nothing and Inactive everything (P13 == P3)",
    async () => {
      const Active = Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind.Active;
      const Inactive = Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind.Inactive;
      const all = await client.discoveryQuery.findResources(context(dsUri), Scope.self);
      expect(all.length).toBe(2);
      for (const r of all) expect(r.activeStatus).toBe(Inactive);

      const act = await client.discoveryQuery.findResources(context(dsUri), Scope.self, null, Active);
      const inact = await client.discoveryQuery.findResources(context(dsUri), Scope.self, null, Inactive);
      expect(act.length).toBe(0);
      expect(uris(inact)).toEqual(uris(all));

      // Same answer from Discovery (3) on the same store.
      const p3Act = await client.getResources(context(dsUri), Scope.self, undefined, false, null, Active);
      const p3Inact = await client.getResources(context(dsUri), Scope.self, undefined, false, null, Inactive);
      expect(p3Act.length).toBe(0);
      expect(uris(p3Inact)).toEqual(uris(all));
    },
    maxTime
  );

  it.each([
    ["negative depth", { uri: seededUri, depth: -1 }],
    ["type URI", { uri: `${seededUri}/resqml20.obj_WellboreFeature`, depth: 1 }],
    ["malformed URI", { uri: "eml:///nonsense(", depth: 1 }],
    ["missing dataspace", { uri: "eml:///dataspace('no/such-ds')", depth: 1 }]
  ])(
    "guard: %s is rejected with a protocol exception",
    async (_label, ctx) => {
      await expect(
        client.discoveryQuery.findResources(context(ctx.uri, ctx.depth), Scope.self)
      ).rejects.toBeDefined();
    },
    maxTime
  );
});

// ---------------------------------------------------------------------------
// GrowingObject (6)
// ---------------------------------------------------------------------------

describeFor(Protocol.GrowingObject)("GrowingObject (6) parts round trip", () => {
  const mds = [100, 200, 300, 400];
  const uid = (md: number) => `st-${md}`;

  it(
    "PutParts then GetParts by uid returns the same XML",
    async () => {
      const parts = new Map<string, ObjectPart>();
      for (const md of mds) {
        parts.set(uid(md), stationPart(uid(md), md));
      }
      expect(await client.growingObject.putParts(crsUri, parts)).toBe(true);

      const want = new Map<string, string>([["0", uid(100)], ["1", uid(300)]]);
      const got = await client.growingObject.getParts(crsUri, want);
      expect(got.map(p => p.uid).sort()).toEqual([uid(100), uid(300)]);
      for (const p of got) {
        expect(partText(p)).toBe(partText(stationPart(p.uid, Number(p.uid.slice(3)))));
      }
    },
    maxTime
  );

  it(
    "GetPartsByRange honours closed, half open and unbounded depth intervals",
    async () => {
      const range = async (lo: number | null, hi: number | null) =>
        (await client.growingObject.getPartsByRange(crsUri, interval(lo, hi))).map(p => p.uid);
      expect(await range(null, null)).toEqual(mds.map(uid));
      expect(await range(150, 350)).toEqual([uid(200), uid(300)]);
      expect(await range(200, 300)).toEqual([uid(200), uid(300)]);
      expect(await range(300, null)).toEqual([uid(300), uid(400)]);
      expect(await range(null, 100)).toEqual([uid(100)]);
      expect(await range(401, null)).toEqual([]);
    },
    maxTime
  );

  it(
    "GetPartsMetadata reports the measured depth index interval covering all parts",
    async () => {
      const meta = await client.growingObject.getPartsMetadata(crsUri);
      expect(meta.length).toBe(1);
      expect(meta[0].uri).toBe(crsUri);
      expect(meta[0].index.indexKind).toBe(IndexKind.MeasuredDepth);
      expect(numberOf(meta[0].index.interval.startIndex)).toBe(100);
      expect(numberOf(meta[0].index.interval.endIndex)).toBe(400);
    },
    maxTime
  );

  it(
    "PutParts upserts: same uid, new depth moves the part in the index",
    async () => {
      const moved = new Map<string, ObjectPart>([[uid(400), stationPart(uid(400), 450)]]);
      expect(await client.growingObject.putParts(crsUri, moved)).toBe(true);
      const hi = await client.growingObject.getPartsByRange(crsUri, interval(440, 460));
      expect(hi.map(p => p.uid)).toEqual([uid(400)]);
      expect(partText(hi[0])).toContain("<Md uom=\"m\">450</Md>");
      const meta = await client.growingObject.getPartsMetadata(crsUri);
      expect(numberOf(meta[0].index.interval.endIndex)).toBe(450);
      // restore
      await client.growingObject.putParts(crsUri, new Map([[uid(400), stationPart(uid(400), 400)]]));
    },
    maxTime
  );

  it(
    "GetChangeAnnotations lists one change per indexed part since epoch and none in the future",
    async () => {
      const all = await client.growingObject.getChangeAnnotations(crsUri, BigInt(0));
      expect(all.length).toBe(1);
      const changes = [...all[0].changes.values()].flat();
      expect(changes.length).toBe(mds.length);
      const starts = changes.map(c => numberOf(c.interval.startIndex)).sort((a, b) => a - b);
      expect(starts).toEqual(mds);
      const future = BigInt(Date.now() + 3600_000) * BigInt(1000);
      const none = await client.growingObject.getChangeAnnotations(crsUri, future);
      expect(none.length).toBe(1);
      expect(none[0].changes.size).toBe(0);
    },
    maxTime
  );

  it(
    "unindexed (non XML or index-less) parts are stored, listed last on an unbounded range and never on a bounded one",
    async () => {
      const blobs = new Map<string, ObjectPart>([
        ["a", opaquePart("blob-1", "not xml at all")],
        ["b", opaquePart("blob-2", "<a><b/></a>")]
      ]);
      expect(await client.growingObject.putParts(crsUri, blobs)).toBe(true);
      const got = await client.growingObject.getParts(crsUri, new Map([["0", "blob-1"], ["1", "blob-2"]]));
      expect(got.map(p => p.uid).sort()).toEqual(["blob-1", "blob-2"]);
      expect(partText(got.find(p => p.uid === "blob-1")!)).toBe("not xml at all");
      const all = await client.growingObject.getPartsByRange(crsUri, interval(null, null));
      expect(all.map(p => p.uid)).toEqual([...mds.map(uid), "blob-1", "blob-2"]);
      const bounded = await client.growingObject.getPartsByRange(crsUri, interval(0, 1000));
      expect(bounded.map(p => p.uid)).toEqual(mds.map(uid));
      await client.growingObject.deleteParts(crsUri, new Map([["0", "blob-1"], ["1", "blob-2"]]));
    },
    maxTime
  );

  it(
    "time indexed parts: DTim becomes a DateTime index in microseconds",
    async () => {
      const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
      const iso = (s: number) => new Date(t0 + s * 1000).toISOString();
      const parts = new Map<string, ObjectPart>();
      for (const [k, s] of [["t1", 0], ["t2", 60], ["t3", 120]] as const) {
        parts.set(k, timePart(k, iso(s)));
      }
      expect(await client.growingObject.putParts(timeUri, parts)).toBe(true);
      const meta = await client.growingObject.getPartsMetadata(timeUri);
      expect(meta[0].index.indexKind).toBe(IndexKind.DateTime);
      expect(numberOf(meta[0].index.interval.startIndex)).toBe(t0 * 1000);
      expect(numberOf(meta[0].index.interval.endIndex)).toBe((t0 + 120_000) * 1000);
      const lo = BigInt((t0 + 30_000) * 1000);
      const win = await client.growingObject.getPartsByRange(timeUri, interval(lo, null, "us"));
      expect(win.map(p => p.uid)).toEqual(["t2", "t3"]);
    },
    maxTime
  );

  it(
    "DeleteParts removes parts and GetParts on a missing uid yields a protocol error",
    async () => {
      expect(await client.growingObject.deleteParts(crsUri, new Map([["0", uid(100)], ["1", uid(200)]]))).toBe(true);
      const left = await client.growingObject.getPartsByRange(crsUri, interval(null, null));
      expect(left.map(p => p.uid)).toEqual([uid(300), uid(400)]);
      const meta = await client.growingObject.getPartsMetadata(crsUri);
      expect(numberOf(meta[0].index.interval.startIndex)).toBe(300);
      await expect(
        client.growingObject.getParts(crsUri, new Map([["0", "does-not-exist"]]))
      ).rejects.toBeDefined();
    },
    maxTime
  );

  it.each([
    ["type URI", `${dsUri}/resqml20.obj_LocalDepth3dCrs`],
    ["dataspace URI", dsUri],
    ["unknown object", `${dsUri}/resqml20.obj_LocalDepth3dCrs(00000000-0000-0000-0000-000000000000)`]
  ])(
    "guard: PutParts on %s is rejected",
    async (_label, badUri) => {
      await expect(
        client.growingObject.putParts(badUri, new Map([["0", stationPart("x", 1)]]))
      ).rejects.toBeDefined();
    },
    maxTime
  );
});

// ---------------------------------------------------------------------------
// ChannelSubscribe (21)
// ---------------------------------------------------------------------------

describeFor(Protocol.ChannelSubscribe)("ChannelSubscribe (21) GetChannelMetadata", () => {
  itFor(Protocol.GrowingObject)(
    "object URI: one record whose index interval is derived from the stored parts",
    async () => {
      const recs = await client.channelSubscribe.getChannelMetadata(crsUri);
      expect(recs.length).toBe(1);
      expect(recs[0].uri).toBe(crsUri);
      expect(recs[0].channelName).toBe("Depth CRS");
      expect(recs[0].indexes.length).toBeGreaterThanOrEqual(1);
      const idx = recs[0].indexes[0];
      expect(idx.indexKind).toBe(IndexKind.MeasuredDepth);
      expect(numberOf(idx.interval.startIndex)).toBe(300);
      expect(numberOf(idx.interval.endIndex)).toBe(400);
    },
    maxTime
  );

  itFor(Protocol.GrowingObject)(
    "object URI with a time index reports DateTime with uom us",
    async () => {
      const recs = await client.channelSubscribe.getChannelMetadata(timeUri);
      expect(recs.length).toBe(1);
      expect(recs[0].indexes[0].indexKind).toBe(IndexKind.DateTime);
      expect(recs[0].indexes[0].uom).toBe("us");
    },
    maxTime
  );

  it(
    "dataspace URI: lists exactly the Log/Channel/Trajectory objects of the seeded dataspace",
    async () => {
      // The seeded dataset may have no growing objects, so the
      // expected set is derived from P3 and may legitimately be empty. The
      // check is that P21 agrees with P3 for a dataspace context.
      const recs = await client.channelSubscribe.getChannelMetadata(seededUri);
      const types = recs.map(r => new EtpUri(r.uri).dataObjectType ?? "");
      for (const t of types) {
        expect(/Log|Channel|Trajectory/.test(t)).toBe(true);
      }
      const p3 = await client.getResources(seededUri, Scope.self);
      expect(p3.length).toBeGreaterThan(0);
      const expected = p3
        .map(r => r.uri)
        .filter(u => /Log|Channel|Trajectory/.test(new EtpUri(u).dataObjectType ?? ""))
        .sort();
      expect(uris(recs)).toEqual(expected);
      // channel ids are unique longs
      expect(new Set(recs.map(r => String(r.id))).size).toBe(recs.length);
      // the fixture dataspace holds CRS objects with parts but no growing types
      const own = await client.channelSubscribe.getChannelMetadata(dsUri);
      expect(uris(own)).toEqual(
        (await client.getResources(dsUri, Scope.self))
          .map(r => r.uri)
          .filter(u => /Log|Channel|Trajectory/.test(new EtpUri(u).dataObjectType ?? ""))
          .sort()
      );
    },
    maxTime
  );

  it.each([
    ["unknown object", `${dsUri}/resqml20.obj_LocalDepth3dCrs(00000000-0000-0000-0000-000000000000)`],
    ["missing dataspace", "eml:///dataspace('no/such-ds')"],
    ["type URI", `${dsUri}/resqml20.obj_LocalDepth3dCrs`]
  ])(
    "guard: %s is rejected",
    async (_label, badUri) => {
      await expect(client.channelSubscribe.getChannelMetadata(badUri)).rejects.toBeDefined();
    },
    maxTime
  );
});

// ---------------------------------------------------------------------------
// REST facade on the in-process NestJS app
// ---------------------------------------------------------------------------

describe("REST /query facade for protocols 13/6/21", () => {
  let app: any;
  let server: any;
  let token = "";

  beforeAll(async () => {
    app = await restApp();
    server = (await app.init()).getHttpServer();
    const res = await request(server).get(`${restApiServerPath}/auth/token`).expect(200);
    token = res.body.token;
  }, maxTime);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const post = (path: string, body: object) =>
    request(server)
      .post(`${restApiServerPath}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .set("data-partition-id", partitionId)
      .send(body);

  it(
    "POST /query/resources/find returns the seeded resources (P13, or P3 fallback)",
    async () => {
      const res = await post("/query/resources/find", {
        uri: seededUri,
        scope: "self",
        depth: 1,
        dataObjectTypes: []
      });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.resources)).toBe(true);
      const p3 = await client.getResources(seededUri, Scope.self);
      expect(res.body.resources.length).toBe(p3.length);
    },
    maxTime
  );

  itFor(Protocol.GrowingObject)(
    "POST /query/growing (metadata) serialises the index interval as JSON numbers",
    async () => {
      const res = await post("/query/growing", { uri: crsUri });
      expect(res.status).toBe(200);
      const metadata = res.body.metadata;
      expect(Array.isArray(metadata)).toBe(true);
      expect(metadata.length).toBe(1);
      expect(metadata[0].uri).toBe(crsUri);
      expect(metadata[0].index.indexKind).toBe(IndexKind.MeasuredDepth);
      expect(JSON.stringify(metadata[0].index.interval)).toContain("300");
      expect(res.body.parts).toBeUndefined();
    },
    maxTime
  );

  itFor(Protocol.GrowingObject)(
    "POST /query/growing (range) returns uid + decoded XML for the window",
    async () => {
      const res = await post("/query/growing", { uri: crsUri, startIndex: 350, endIndex: 450 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ parts: [{ uid: "st-400", data: partText(stationPart("st-400", 400)) }] });
    },
    maxTime
  );

  itFor(Protocol.GrowingObject, Protocol.ChannelSubscribe)(
    "POST /query/growing includeChannels serialises long channel ids and the index",
    async () => {
      const res = await post("/query/growing", { uri: crsUri, includeChannels: true });
      expect(res.status).toBe(200);
      const channels = res.body.channels;
      expect(Array.isArray(channels)).toBe(true);
      expect(channels.length).toBe(1);
      expect(channels[0].channelName).toBe("Depth CRS");
      expect(channels[0].indexes[0].indexKind).toBe(IndexKind.MeasuredDepth);
      expect(Array.isArray(res.body.metadata)).toBe(true);
    },
    maxTime
  );

  itFor(Protocol.GrowingObject).each([
    ["/query/growing", { uri: dsUri }],
    ["/query/growing", { uri: dsUri, startIndex: 0, endIndex: 1 }],
    ["/query/growing", { uri: `${dsUri}/resqml20.obj_LocalDepth3dCrs`, includeChannels: true }]
  ])(
    "guard: %s with a non object URI is a 4xx, never a 5xx",
    async (path, body) => {
      const res = await post(path, body);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    },
    maxTime
  );

  itFor(Protocol.GrowingObject)(
    "guard: unknown object on /query/growing maps ENOT_FOUND to 404",
    async () => {
      const res = await post("/query/growing", {
        uri: `${dsUri}/resqml20.obj_LocalDepth3dCrs(00000000-0000-0000-0000-000000000000)`
      });
      expect(res.status).toBe(404);
    },
    maxTime
  );

  itWithout(Protocol.GrowingObject)(
    "fallback: /query/growing answers 501 Not Implemented when the store lacks GrowingObject (6)",
    async () => {
      for (const body of [{ uri: crsUri }, { uri: crsUri, startIndex: 0, endIndex: 1 }, { uri: crsUri, includeChannels: true }]) {
        const res = await post("/query/growing", body);
        expect(res.status).toBe(501);
      }
    },
    maxTime
  );
});
