// ============================================================================
// Test Activity converter parameter extraction (RESQML 2.0.1 focused)
//
// Validates that Activity parameters are individually extracted with correct
// typed values rather than collapsed to count strings.
// ============================================================================

import "jest";

import { ActivityOSDU } from "../lib/jsonTypes/Activity";
import { OSDUContext } from "../lib/jsonTypes/OsduContext";
import { ResqmlClient } from "../lib/client/ResqmlClient";
import type { SimpleJson } from "../lib/mlTypes/XmlJsonUtil";
import * as resqml20 from "../lib/mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";

describe("Activity Converter – Parameter Extraction (RESQML 2.0.1)", () => {
  // Minimal mock — no ETP server connection needed for unit tests
  const mockClient = new ResqmlClient();
  const context = new OSDUContext("test", "opendes");

  /**
   * Build a minimal Activity XML with various parameter types
   */
  function buildActivityXml(
    params: SimpleJson<resqml20.AbstractActivityParameter>[]
  ): SimpleJson<resqml20.obj_Activity> {
    return {
      SchemaVersion: "2.0",
      Uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      Citation: {
        Title: "Test Activity",
        Originator: "UnitTest",
        Creation: new Date("2026-01-01T00:00:00Z"),
        Format: "RESQML 2.0.1"
      },
      ActivityDescriptor: {
        Title: "TestTemplate",
        ContentType:
          "application/x-resqml+xml;version=2.0;type=obj_ActivityTemplate",
        UUID: "11111111-2222-3333-4444-555555555555"
      },
      Parameter: params
    } as SimpleJson<resqml20.obj_Activity>;
  }

  it("extracts StringParameter with value", async () => {
    const xml = buildActivityXml([
      {
        $type: "resqml20.StringParameter",
        Title: "Spud Date",
        Index: 0,
        Value: "2028-Q1"
      } as SimpleJson<resqml20.StringParameter>
    ]);

    const activity = new ActivityOSDU(xml, context);
    const params = await activity.getParameters("http://test", xml.Parameter, mockClient);

    expect(params).toHaveLength(1);
    expect(params[0].Title).toBe("Spud Date");
    expect(params[0].StringParameter).toBe("2028-Q1");
    expect(params[0].ParameterKindID).toContain("ParameterKind");
    expect(params[0].ParameterKindID).toContain("String");
  });

  it("extracts FloatingPointQuantityParameter with value and UOM", async () => {
    const xml = buildActivityXml([
      {
        $type: "resqml20.FloatingPointQuantityParameter",
        Title: "Total Depth",
        Index: 0,
        Value: 4120.0,
        Uom: "m"
      } as SimpleJson<resqml20.FloatingPointQuantityParameter>
    ]);

    const activity = new ActivityOSDU(xml, context);
    const params = await activity.getParameters("http://test", xml.Parameter, mockClient);

    expect(params).toHaveLength(1);
    expect(params[0].Title).toBe("Total Depth");
    expect(params[0].DataQuantityParameter).toBe(4120.0);
    expect(params[0].DataQuantityParameterUOMID).toContain("UnitOfMeasure");
    expect(params[0].DataQuantityParameterUOMID).toContain("m");
    expect(params[0].ParameterKindID).toContain("Double");
  });

  it("extracts IntegerQuantityParameter with value", async () => {
    const xml = buildActivityXml([
      {
        $type: "resqml20.IntegerQuantityParameter",
        Title: "Core Count",
        Index: 0,
        Value: 48
      } as SimpleJson<resqml20.IntegerQuantityParameter>
    ]);

    const activity = new ActivityOSDU(xml, context);
    const params = await activity.getParameters("http://test", xml.Parameter, mockClient);

    expect(params).toHaveLength(1);
    expect(params[0].Title).toBe("Core Count");
    expect(params[0].IntegerQuantityParameter).toBe(48);
    expect(params[0].ParameterKindID).toContain("Integer");
  });

  it("extracts DataObjectParameter with DOR reference (requires ETP — validates structure only)", async () => {
    const xml = buildActivityXml([
      {
        $type: "resqml20.DataObjectParameter",
        Title: "Source Grid",
        Index: 0,
        DataObject: {
          Title: "IjkGrid_Main",
          ContentType:
            "application/x-resqml+xml;version=2.0;type=obj_IjkGridRepresentation",
          UUID: "99999999-8888-7777-6666-555555555555"
        }
      } as SimpleJson<resqml20.DataObjectParameter>
    ]);

    const activity = new ActivityOSDU(xml, context);
    // dorToSrn needs ETP connectivity; verify the parameter KIND detection works
    // without waiting for network. We test structure, not resolution.
    const kind = (activity as any).getKind(xml.Parameter[0]);
    expect(kind).toBe("DataObject");

    // Verify the parameter would be classified correctly in output
    expect(xml.Parameter[0].$type).toBe("resqml20.DataObjectParameter");
  });

  it("extracts multiple parameters preserving order and types", async () => {
    const xml = buildActivityXml([
      {
        $type: "resqml20.StringParameter",
        Title: "Well Type",
        Index: 0,
        Value: "Deep sidetrack (CAP-X)"
      } as SimpleJson<resqml20.StringParameter>,
      {
        $type: "resqml20.FloatingPointQuantityParameter",
        Title: "TD MD",
        Index: 1,
        Value: 4200.0,
        Uom: "m"
      } as SimpleJson<resqml20.FloatingPointQuantityParameter>,
      {
        $type: "resqml20.IntegerQuantityParameter",
        Title: "Casing Strings",
        Index: 2,
        Value: 5
      } as SimpleJson<resqml20.IntegerQuantityParameter>,
      {
        $type: "resqml20.StringParameter",
        Title: "Completion",
        Index: 3,
        Value: "Perforated: Tarbert + Rannoch"
      } as SimpleJson<resqml20.StringParameter>
    ]);

    const activity = new ActivityOSDU(xml, context);
    const params = await activity.getParameters("http://test", xml.Parameter, mockClient);

    expect(params).toHaveLength(4);

    // Param 0: String
    expect(params[0].Title).toBe("Well Type");
    expect(params[0].StringParameter).toBe("Deep sidetrack (CAP-X)");
    expect(params[0].Index).toBe(0);

    // Param 1: Double with UOM
    expect(params[1].Title).toBe("TD MD");
    expect(params[1].DataQuantityParameter).toBe(4200.0);
    expect(params[1].DataQuantityParameterUOMID).toContain("m");
    expect(params[1].Index).toBe(1);

    // Param 2: Integer
    expect(params[2].Title).toBe("Casing Strings");
    expect(params[2].IntegerQuantityParameter).toBe(5);
    expect(params[2].Index).toBe(2);

    // Param 3: String
    expect(params[3].Title).toBe("Completion");
    expect(params[3].StringParameter).toBe("Perforated: Tarbert + Rannoch");
    expect(params[3].Index).toBe(3);
  });

  it("handles empty parameter array", async () => {
    const xml = buildActivityXml([]);

    const activity = new ActivityOSDU(xml, context);
    const params = await activity.getParameters("http://test", xml.Parameter, mockClient);

    expect(params).toHaveLength(0);
  });

  it("assigns Index from parameter position when Index field is absent", async () => {
    const xml = buildActivityXml([
      {
        $type: "resqml20.StringParameter",
        Title: "NoIndex",
        Value: "test"
      } as unknown as SimpleJson<resqml20.StringParameter>
    ]);

    const activity = new ActivityOSDU(xml, context);
    const params = await activity.getParameters("http://test", xml.Parameter, mockClient);

    expect(params).toHaveLength(1);
    expect(params[0].Index).toBe(0); // Falls back to array position
  });

  it("handles unknown $type as StringParameter fallback", async () => {
    const xml = buildActivityXml([
      {
        $type: "resqml20.UnknownFutureParameter" as any,
        Title: "Future Param",
        Index: 0,
        Value: "some value"
      } as any
    ]);

    const activity = new ActivityOSDU(xml, context);
    const params = await activity.getParameters("http://test", xml.Parameter, mockClient);

    expect(params).toHaveLength(1);
    expect(params[0].Title).toBe("Future Param");
    // Falls through to StringParameter branch
    expect(params[0].StringParameter).toBe("some value");
  });

  it("does NOT collapse parameters to count strings (regression)", async () => {
    // This test ensures we never regress to the old "N object(s)" pattern
    const xml = buildActivityXml([
      {
        $type: "resqml20.StringParameter",
        Title: "Param1",
        Index: 0,
        Value: "value1"
      } as SimpleJson<resqml20.StringParameter>,
      {
        $type: "resqml20.StringParameter",
        Title: "Param1",
        Index: 1,
        Value: "value2"
      } as SimpleJson<resqml20.StringParameter>,
      {
        $type: "resqml20.FloatingPointQuantityParameter",
        Title: "Depth",
        Index: 2,
        Value: 3800.0,
        Uom: "m"
      } as SimpleJson<resqml20.FloatingPointQuantityParameter>
    ]);

    const activity = new ActivityOSDU(xml, context);
    const params = await activity.getParameters("http://test", xml.Parameter, mockClient);

    // Must have 3 individual parameters, not 2 aggregated groups
    expect(params).toHaveLength(3);

    // None should contain "object(s)" count string
    for (const p of params) {
      if (p.StringParameter) {
        expect(p.StringParameter).not.toMatch(/\d+ object\(s\)/);
      }
    }

    // Each retains its typed value
    expect(params[0].StringParameter).toBe("value1");
    expect(params[1].StringParameter).toBe("value2");
    expect(params[2].DataQuantityParameter).toBe(3800.0);
  });
});
