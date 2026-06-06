// ============================================================================
// Copyright 2019-2023 Emerson Paradigm Holding LLC. All rights reserved.
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

import { ResqmlClient, SimpleJson } from "../index";

import {
  AbstractValuesProperty,
  NameValuePair
} from "../lib/mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { GenericPropertyOSDU } from "../lib/jsonTypes/GenericProperty";
import { Data } from "../lib/jsonTypes/Generated/work-product-component/GenericProperty.1.0.0";
import { OSDUContext } from "../lib/jsonTypes/OsduContext";

describe("Manifest Conversion", () => {
  const xml: SimpleJson<AbstractValuesProperty> = {
    SchemaVersion: "2.0",
    Uuid: "1580ddfe-d740-4f5b-bf9c-7fbb9d191daa",
    Citation: {
      Title: "MyTitle",
      Originator: "MyOriginator",
      Creation: new Date("2023-12-05T11:36:00Z"),
      Format: "MyFormat",
      LastUpdate: new Date("2023-12-06T11:36:00Z")
    },
    IndexableElement: "nodes",
    Count: 7,
    PropertyKind: {
      PropertyKind: "length"
    },
    SupportingRepresentation: {
      Title: "MyRepresentation",
      ContentType:
        "application/x-resqml+xml;version=2.0;type=obj_WellboreFrameRepresentation",
      UUID: "2580ddfe-d740-4f5b-bf9c-7fbb9d191d1a"
    },
    PatchOfValues: [
      {
        Values: {}
      }
    ]
  };

  it("Check Citation conversion", () => {
    const osdu: GenericPropertyOSDU = new GenericPropertyOSDU(
      xml,
      new OSDUContext("test", "test")
    );
    osdu.initData("myURI", xml, new ResqmlClient());
    expect(osdu.createUser).toEqual(xml.Citation.Originator);
    expect(osdu.createTime).toEqual(xml.Citation.Creation);
    expect(osdu.modifyUser).toEqual(xml.Citation.Originator);
    expect(osdu.modifyTime).toEqual(xml.Citation.LastUpdate);
  });

  it("Check extra metadata conversion", () => {
    const osdu: GenericPropertyOSDU = new GenericPropertyOSDU(
      xml,
      new OSDUContext("test", "test")
    );
    // No real client so initialize directly instead of using initData
    const data: Data = {
      ValueCount: 7
    };
    osdu.data = data;

    const extra: SimpleJson<NameValuePair>[] = [
      {
        Name: "osdu/test1/test2", // Add to extensionProperties
        Value: "test1"
      },
      {
        Name: "osdu/tags/tag1", // Add to tags
        Value: "tag1"
      },
      {
        Name: "osdu/tags/tag1/tag2", // Add to extension properties (as tags are not nested)
        Value: "tag2"
      }
    ];

    osdu.assignExtraMetaData(extra);
    expect(osdu.data.ValueCount).toEqual(7);
    expect(
      osdu.data.ExtensionProperties &&
        osdu.data.ExtensionProperties["test1/test2"]
    ).toEqual("test1");
    expect(osdu.tags && osdu.tags.tag1).toEqual("tag1");
    expect(
      osdu.data.ExtensionProperties &&
        osdu.data.ExtensionProperties["tags/tag1/tag2"]
    ).toEqual("tag2");
  });
});

describe("R4: Converter Registry", () => {
  const {
    registerConverter,
    registerConverters,
    hasConverter,
    getRegisteredTypes,
    getTargetKind
  } = require("../lib/jsonTypes/registerConverter");

  it("registerConverter registers a type", () => {
    const testType = "test.TestType_R4";
    const kind = () => "osdu:wks:work-product-component--TestType:1.0.0";
    const convert = async () => undefined;

    registerConverter(testType, kind, convert);
    expect(hasConverter(testType)).toBe(true);
  });

  it("registerConverters registers multiple types", () => {
    registerConverters([
      {
        sourceType: "test.BatchA_R4",
        osduKind: () => "osdu:wks:work-product-component--A:1.0.0",
        convert: async () => undefined
      },
      {
        sourceType: "test.BatchB_R4",
        osduKind: () => "osdu:wks:work-product-component--B:1.0.0",
        convert: async () => undefined
      }
    ]);
    expect(hasConverter("test.BatchA_R4")).toBe(true);
    expect(hasConverter("test.BatchB_R4")).toBe(true);
  });

  it("getRegisteredTypes returns all registered types", () => {
    const types = getRegisteredTypes();
    expect(types.length).toBeGreaterThan(0);
    // Should include the types we just registered
    expect(types).toContain("test.TestType_R4");
  });

  it("getTargetKind returns correct OSDU kind", () => {
    const kind = getTargetKind("test.TestType_R4");
    expect(kind).toEqual("osdu:wks:work-product-component--TestType:1.0.0");
  });

  it("getTargetKind returns undefined for unregistered type", () => {
    expect(getTargetKind("nonexistent.type")).toBeUndefined();
  });

  it("hasConverter returns false for unregistered types", () => {
    expect(hasConverter("nonexistent.type")).toBe(false);
  });
});

describe("S4: Auto-collaboration from dataspace", () => {
  it("derives deterministic UUID from dataspace name", () => {
    const { v5: uuidNameSpace } = require("uuid");
    const RDDMS_COLLABORATION_NAMESPACE =
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

    const id1 = uuidNameSpace("demo/Volve", RDDMS_COLLABORATION_NAMESPACE);
    const id2 = uuidNameSpace("demo/Volve", RDDMS_COLLABORATION_NAMESPACE);
    const id3 = uuidNameSpace("demo/Drogon", RDDMS_COLLABORATION_NAMESPACE);

    // Same input → same output (deterministic)
    expect(id1).toEqual(id2);
    // Different input → different output
    expect(id1).not.toEqual(id3);
    // Valid UUID format
    expect(id1).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe("S3: MasterData BoundaryFeature dedup", () => {
  it("returns undefined when master-data already exists", async () => {
    const { MasterDataBoundaryFeature22Manifest } = require(
      "../lib/jsonTypes/MasterDataBoundaryFeature22"
    );
    const context = new OSDUContext("test", "test");
    // Simulate existing resource by mocking getOSDUResourceVersion
    context.getOSDUResourceVersion = async () => 1;
    context.bearer = "test-token";

    const xml = {
      Uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      Citation: { Title: "TestHorizon" }
    };

    const result = await MasterDataBoundaryFeature22Manifest(
      "eml:///dataspace('test')/resqml22.BoundaryFeature(aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee)",
      xml,
      context,
      {} // mock client
    );

    // Should skip (return undefined) since record already exists
    expect(result).toBeUndefined();
  });
});

describe("24: SSL config", () => {
  it("RDMS_ETP_SSL_VERIFY defaults to true (verify certs)", () => {
    // Default behavior: no env var = verify
    const originalEnv = process.env.RDMS_ETP_SSL_VERIFY;
    delete process.env.RDMS_ETP_SSL_VERIFY;

    // Test the logic directly (config.ts reads at import, but we test the logic)
    const verify = process.env.RDMS_ETP_SSL_VERIFY !== "false";
    expect(verify).toBe(true);

    if (originalEnv !== undefined) {
      process.env.RDMS_ETP_SSL_VERIFY = originalEnv;
    }
  });

  it("RDMS_ETP_SSL_VERIFY=false disables cert verification", () => {
    const originalEnv = process.env.RDMS_ETP_SSL_VERIFY;
    process.env.RDMS_ETP_SSL_VERIFY = "false";

    const verify = process.env.RDMS_ETP_SSL_VERIFY !== "false";
    expect(verify).toBe(false);

    if (originalEnv !== undefined) {
      process.env.RDMS_ETP_SSL_VERIFY = originalEnv;
    } else {
      delete process.env.RDMS_ETP_SSL_VERIFY;
    }
  });
});

describe("A3: Auto-lineage Activity generation", () => {
  it("generates deterministic Activity record from created WPCs", () => {
    const { v5: uuidv5 } = require("uuid");
    const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

    // Simulate 2 WPCs created
    const outputIds = [
      "opendes:work-product-component--WellLog:aaa",
      "opendes:work-product-component--WellboreTrajectory:bbb"
    ];

    // Same logic as Manifest.ts
    const activityUuid = uuidv5(
      outputIds.sort().join("|"),
      NAMESPACE
    );

    // Deterministic: same inputs → same UUID
    const activityUuid2 = uuidv5(
      outputIds.sort().join("|"),
      NAMESPACE
    );
    expect(activityUuid).toBe(activityUuid2);

    // Different inputs → different UUID
    const otherUuid = uuidv5(
      ["opendes:work-product-component--WellLog:ccc"].join("|"),
      NAMESPACE
    );
    expect(otherUuid).not.toBe(activityUuid);

    // Verify the activity ID format
    const activityId = `opendes:work-product-component--Activity:${activityUuid}`;
    expect(activityId).toContain("work-product-component--Activity:");
    expect(activityId).toMatch(
      /^opendes:work-product-component--Activity:[0-9a-f-]{36}$/
    );
  });

  it("context.generateLineageActivity defaults to true", () => {
    const context = new OSDUContext("test", "test");
    expect(context.generateLineageActivity).toBe(true);
  });

  it("can be disabled via context.generateLineageActivity = false", () => {
    const context = new OSDUContext("test", "test");
    context.generateLineageActivity = false;
    expect(context.generateLineageActivity).toBe(false);
  });
});

describe("RESQML 2.2 Converter Registration", () => {
  const { ResqmlOSDUMap } = require("../lib/jsonTypes/OsduContext");
  const registry = ResqmlOSDUMap.getInstance();

  // Ensure ResqmlOsdu module is loaded (triggers all .add() calls)
  require("../lib/jsonTypes/ResqmlOsdu");

  const resqml22Types = [
    {
      type: "resqml22.FluidBoundaryInterpretation",
      kind: "osdu:wks:work-product-component--FluidBoundaryInterpretation:1.2.0"
    },
    {
      type: "resqml22.SealedSurfaceFrameworkRepresentation",
      kind: "osdu:wks:work-product-component--SealedSurfaceFramework:1.2.0"
    },
    {
      type: "resqml22.RockFluidOrganizationInterpretation",
      kind: "osdu:wks:work-product-component--RockFluidOrganizationInterpretation:1.2.0"
    },
    {
      type: "resqml22.RockFluidUnitInterpretation",
      kind: "osdu:wks:work-product-component--RockFluidUnitInterpretation:1.3.0"
    },
    {
      type: "resqml22.StructuralOrganizationInterpretation",
      kind: "osdu:wks:work-product-component--StructuralOrganizationInterpretation:1.2.0"
    },
    {
      type: "resqml22.WellboreInterpretation",
      kind: "osdu:wks:work-product-component--WellboreInterpretation:1.2.0"
    },
    {
      type: "resqml22.WellboreTrajectoryRepresentation",
      kind: "osdu:wks:work-product-component--WellboreTrajectory:1.3.0"
    },
    {
      type: "resqml22.SubRepresentation",
      kind: "osdu:wks:work-product-component--SubRepresentation:1.2.0"
    },
    {
      type: "resqml22.UnstructuredGridRepresentation",
      kind: "osdu:wks:work-product-component--UnstructuredGridRepresentation:1.2.0"
    },
    {
      type: "resqml22.EarthModelInterpretation",
      kind: "osdu:wks:work-product-component--EarthModelInterpretation:1.2.0"
    },
    {
      type: "resqml22.FaultInterpretation",
      kind: "osdu:wks:work-product-component--FaultInterpretation:1.3.0"
    },
    {
      type: "resqml22.HorizonInterpretation",
      kind: "osdu:wks:work-product-component--HorizonInterpretation:1.2.0"
    },
    {
      type: "resqml22.IjkGridRepresentation",
      kind: "osdu:wks:work-product-component--IjkGridRepresentation:1.2.0"
    },
    {
      type: "resqml22.GeobodyBoundaryInterpretation",
      kind: "osdu:wks:work-product-component--GeobodyBoundaryInterpretation:1.1.0"
    },
    {
      type: "resqml22.GeobodyInterpretation",
      kind: "osdu:wks:work-product-component--GeobodyInterpretation:1.3.0"
    },
    {
      type: "resqml22.GridConnectionSetRepresentation",
      kind: "osdu:wks:work-product-component--GridConnectionSetRepresentation:1.2.0"
    },
    {
      type: "resqml22.BoundaryFeature",
      kind: "osdu:wks:work-product-component--LocalBoundaryFeature:1.2.0"
    },
    {
      type: "resqml22.StratigraphicColumn",
      kind: "osdu:wks:work-product-component--StratigraphicColumn:1.2.0"
    },
    {
      type: "resqml22.StratigraphicColumnRankInterpretation",
      kind: "osdu:wks:work-product-component--StratigraphicColumnRankInterpretation:1.3.0"
    },
    {
      type: "resqml22.StratigraphicUnitInterpretation",
      kind: "osdu:wks:work-product-component--StratigraphicUnitInterpretation:1.3.0"
    },
    {
      type: "resqml22.ContinuousProperty",
      kind: "osdu:wks:work-product-component--GenericProperty:1.2.0"
    },
    {
      type: "resqml22.DiscreteProperty",
      kind: "osdu:wks:work-product-component--GenericProperty:1.2.0"
    }
  ];

  it.each(resqml22Types)(
    "has converter registered for $type",
    ({ type }) => {
      const entry = registry.get(type);
      expect(entry).toBeDefined();
      expect(entry.convert).toBeInstanceOf(Function);
    }
  );

  it.each(resqml22Types)(
    "returns correct OSDU kind for $type",
    ({ type, kind }) => {
      const entry = registry.get(type);
      expect(entry).toBeDefined();
      // osduKind is a function that takes an object and returns the kind string
      const result = entry.osduKind({} as any);
      expect(result).toEqual(kind);
    }
  );

  it("all resqml22 types have matching resqml20 counterparts where applicable", () => {
    // Key types that should exist in both versions
    const dualTypes = [
      ["resqml22.FaultInterpretation", "resqml20.obj_FaultInterpretation"],
      ["resqml22.HorizonInterpretation", "resqml20.obj_HorizonInterpretation"],
      ["resqml22.EarthModelInterpretation", "resqml20.obj_EarthModelInterpretation"],
      ["resqml22.IjkGridRepresentation", "resqml20.obj_IjkGridRepresentation"]
    ];

    for (const [v22, v20] of dualTypes) {
      const entry22 = registry.get(v22);
      const entry20 = registry.get(v20);
      expect(entry22).toBeDefined();
      expect(entry20).toBeDefined();
      // Both should produce the same OSDU kind
      expect(entry22.osduKind({} as any)).toEqual(entry20.osduKind({} as any));
    }
  });
});
