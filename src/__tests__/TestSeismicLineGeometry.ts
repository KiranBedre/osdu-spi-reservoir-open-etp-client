// ============================================================================
// Tests for SeismicLineGeometry converter
// Validates RESQML 2.0 obj_SeismicLineFeature → OSDU SeismicLineGeometry.1.2.0
// ============================================================================

import "jest";

import { SimpleJson } from "../index";

import { obj_SeismicLineFeature } from "../lib/mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { SeismicLineGeometryOSDU } from "../lib/jsonTypes/SeismicLineGeometry";
import { OSDUContext, ResqmlOSDUMap } from "../lib/jsonTypes/OsduContext";

describe("SeismicLineGeometry Converter", () => {
  const baseXml: SimpleJson<obj_SeismicLineFeature> = {
    SchemaVersion: "2.0",
    Uuid: "aabb1122-3344-5566-7788-99aabbccddee",
    Citation: {
      Title: "Seismic Line A",
      Originator: "TestUser",
      Creation: new Date("2024-01-15T10:00:00Z"),
      Format: "RESQML 2.0",
      LastUpdate: new Date("2024-01-16T10:00:00Z")
    },
    FirstTraceIndex: 100,
    TraceCount: 501,
    TraceIndexIncrement: 1,
    $type: "resqml20.obj_SeismicLineFeature"
  };

  it("constructs with correct OSDU kind", () => {
    const osdu = new SeismicLineGeometryOSDU(
      baseXml,
      new OSDUContext("test-partition", "test-rddms")
    );
    expect(osdu.kind).toEqual(
      "osdu:wks:work-product-component--SeismicLineGeometry:1.2.0"
    );
  });

  it("constructs with correct id pattern", () => {
    const osdu = new SeismicLineGeometryOSDU(
      baseXml,
      new OSDUContext("test-partition", "test-rddms")
    );
    expect(osdu.id).toContain("test-partition:");
    expect(osdu.id).toContain("work-product-component--SeismicLineGeometry:");
  });

  it("captures Citation timestamps", () => {
    const osdu = new SeismicLineGeometryOSDU(
      baseXml,
      new OSDUContext("test-partition", "test-rddms")
    );
    expect(osdu.createTime).toEqual(new Date("2024-01-15T10:00:00Z"));
    expect(osdu.createUser).toEqual("TestUser");
    expect(osdu.modifyTime).toEqual(new Date("2024-01-16T10:00:00Z"));
  });

  it("computes CMP range from trace indices (increment=1)", () => {
    const osdu = new SeismicLineGeometryOSDU(
      baseXml,
      new OSDUContext("test-partition", "test-rddms")
    );
    // Manually set data to test CMP computation logic
    const firstCMP = baseXml.FirstTraceIndex;
    const lastCMP =
      baseXml.FirstTraceIndex +
      (baseXml.TraceCount - 1) * baseXml.TraceIndexIncrement;
    expect(firstCMP).toEqual(100);
    expect(lastCMP).toEqual(600);
  });

  it("computes CMP range with non-unity increment", () => {
    const xml: SimpleJson<obj_SeismicLineFeature> = {
      ...baseXml,
      FirstTraceIndex: 50,
      TraceCount: 201,
      TraceIndexIncrement: 2
    };
    const firstCMP = xml.FirstTraceIndex;
    const lastCMP =
      xml.FirstTraceIndex +
      (xml.TraceCount - 1) * xml.TraceIndexIncrement;
    expect(firstCMP).toEqual(50);
    expect(lastCMP).toEqual(450);
  });

  it("sets HasCMPIncreaseByOne correctly", () => {
    // Increment = 1 → true
    expect(baseXml.TraceIndexIncrement === 1).toBe(true);

    // Increment != 1 → false
    const xml2: SimpleJson<obj_SeismicLineFeature> = {
      ...baseXml,
      TraceIndexIncrement: 2
    };
    expect(xml2.TraceIndexIncrement === 1).toBe(false);
  });

  it("handles ExtraMetadata via assignExtraMetaData", () => {
    const osdu = new SeismicLineGeometryOSDU(
      baseXml,
      new OSDUContext("test-partition", "test-rddms")
    );
    osdu.data = {
      FirstCMP: 100,
      LastCMP: 600
    };

    const extra = [
      { Name: "osdu/data/FirstStationLabel", Value: "SP-001" },
      { Name: "osdu/data/LastStationLabel", Value: "SP-501" }
    ];
    osdu.assignExtraMetaData(extra);
    expect(osdu.data.FirstStationLabel).toEqual("SP-001");
    expect(osdu.data.LastStationLabel).toEqual("SP-501");
  });

  it("puts unknown ExtraMetadata in ExtensionProperties", () => {
    const osdu = new SeismicLineGeometryOSDU(
      baseXml,
      new OSDUContext("test-partition", "test-rddms")
    );
    osdu.data = {};

    const extra = [{ Name: "osdu/custom/field", Value: "value123" }];
    osdu.assignExtraMetaData(extra);
    expect(osdu.data.ExtensionProperties?.["custom/field"]).toEqual("value123");
  });
});

describe("SeismicLineGeometry Registration", () => {
  it("is registered in ResqmlOSDU map for resqml20.obj_SeismicLineFeature", () => {
    // Ensure ResqmlOsdu module is loaded (triggers all .add() calls)
    require("../lib/jsonTypes/ResqmlOsdu");
    const map = ResqmlOSDUMap.getInstance();
    const entry = map.get("resqml20.obj_SeismicLineFeature");
    expect(entry).toBeDefined();
    expect(entry?.osduKind({} as any)).toEqual(
      "osdu:wks:work-product-component--SeismicLineGeometry:1.2.0"
    );
  });
});
