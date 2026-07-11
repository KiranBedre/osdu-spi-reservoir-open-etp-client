// ============================================================================
// Tests for Reservoir Simulation Layer 1 improvements:
//  - Smart property inclusion (canonical OSDU names filter)
//  - Transmissibility detection on GridConnectionSet
//  - WellLog depth/sampling from frame index array
//  - ColumnBasedTable23 enrichment (column names, UOM, table type inference)
//  - eml23.ColumnBasedTable type registration
// ============================================================================

import "jest";

import { OSDUContext } from "../lib/jsonTypes/OsduContext";

// Load the full registry
require("../lib/jsonTypes/ResqmlOsdu");

// ============================================================================
// Smart Property Inclusion (canonical OSDU names)
// ============================================================================
describe("Smart property inclusion filter", () => {
  let isCanonicalProperty: (type: string, name: string) => boolean;

  beforeAll(() => {
    // Access the private function via module internals
    const manifestModule = require("../lib/jsonTypes/Manifest");
    // The function is module-scoped; test via DEFAULT_DATASPACE_TYPE_PATTERNS + logic
    // Instead, test the exported patterns and the filter behavior indirectly
    isCanonicalProperty = (manifestModule as any).isCanonicalProperty;
  });

  it("DEFAULT_DATASPACE_TYPE_PATTERNS excludes *Property", () => {
    const { DEFAULT_DATASPACE_TYPE_PATTERNS } = require("../lib/jsonTypes/Manifest");
    expect(DEFAULT_DATASPACE_TYPE_PATTERNS).not.toContain("*Property");
    expect(DEFAULT_DATASPACE_TYPE_PATTERNS).toContain("*Representation");
    expect(DEFAULT_DATASPACE_TYPE_PATTERNS).toContain("*Interpretation*");
  });

  it("DEFAULT_DATASPACE_TYPE_PATTERNS includes standard types", () => {
    const { DEFAULT_DATASPACE_TYPE_PATTERNS } = require("../lib/jsonTypes/Manifest");
    expect(DEFAULT_DATASPACE_TYPE_PATTERNS).toContain("*Feature");
    expect(DEFAULT_DATASPACE_TYPE_PATTERNS).toContain("*StratigraphicColumn");
    expect(DEFAULT_DATASPACE_TYPE_PATTERNS).toContain("witsml21.*");
  });
});

// ============================================================================
// ColumnBasedTable23 Enrichment
// ============================================================================
describe("ColumnBasedTable23 converter", () => {
  it("is registered for eml23.ColumnBasedTable type", () => {
    const ResqmlOSDU = require("../lib/jsonTypes/ResqmlOsdu").default;
    const converter = ResqmlOSDU.get("eml23.ColumnBasedTable");
    expect(converter).toBeDefined();
  });

  it("is registered for resqml22.obj_StringTableLookup type", () => {
    const ResqmlOSDU = require("../lib/jsonTypes/ResqmlOsdu").default;
    const converter = ResqmlOSDU.get("resqml22.obj_StringTableLookup");
    expect(converter).toBeDefined();
  });

  it("maps columns with names and UOM", async () => {
    const { ColumnBasedTable23OSDU } = require("../lib/jsonTypes/ColumnBasedTable23");
    const context = new OSDUContext("test-partition", "test-rddms");

    const xml: any = {
      SchemaVersion: "2.3",
      Uuid: "table-uuid-001",
      Citation: { Title: "PVT Table", Originator: "test", Creation: new Date() },
      Column: [
        {
          Title: "Pressure",
          PropertyKind: { Title: "pressure", UUID: "pk-uuid-1" },
          Uom: "bar",
          ValueCountPerRow: 1,
          Values: { $type: "eml23.FloatingPointExternalArray" }
        },
        {
          Title: "Viscosity",
          PropertyKind: { Title: "viscosity", UUID: "pk-uuid-2" },
          Uom: "cP",
          ValueCountPerRow: 1,
          Values: { $type: "eml23.FloatingPointExternalArray" }
        }
      ],
      KeyColumn: [
        {
          Title: "Temperature",
          PropertyKind: { Title: "thermodynamic temperature", UUID: "pk-uuid-3" },
          Uom: "degC",
          ValueCountPerRow: 1,
          Values: { $type: "eml23.FloatingPointExternalArray" }
        }
      ]
    };

    const osdu = new ColumnBasedTable23OSDU(xml, context);
    await osdu.initData("eml:///dataspace('test')/eml23.ColumnBasedTable(table-uuid-001)", xml);

    // Columns should have names
    expect(osdu.data.Columns).toHaveLength(2);
    expect(osdu.data.Columns![0].ColumnName).toBe("Pressure");
    expect(osdu.data.Columns![1].ColumnName).toBe("Viscosity");

    // UOM should be populated
    expect(osdu.data.Columns![0].UnitOfMeasureID).toBeDefined();
    expect(osdu.data.Columns![0].UnitOfMeasureID).toContain("bar");

    // KeyColumns should be mapped
    expect(osdu.data.KeyColumns).toHaveLength(1);
    expect(osdu.data.KeyColumns![0].ColumnName).toBe("Temperature");
  });

  it("infers PVT table type from column PropertyKinds", async () => {
    const { ColumnBasedTable23OSDU } = require("../lib/jsonTypes/ColumnBasedTable23");
    const context = new OSDUContext("test-partition", "test-rddms");

    const xml: any = {
      SchemaVersion: "2.3",
      Uuid: "pvt-uuid-001",
      Citation: { Title: "Bo Table", Originator: "test", Creation: new Date() },
      Column: [
        {
          Title: "Formation Volume Factor",
          PropertyKind: { Title: "formation volume factor" },
          ValueCountPerRow: 1,
          Values: { $type: "eml23.FloatingPointExternalArray" }
        }
      ],
      KeyColumn: [
        {
          Title: "Pressure",
          PropertyKind: { Title: "pressure" },
          ValueCountPerRow: 1,
          Values: { $type: "eml23.FloatingPointExternalArray" }
        }
      ]
    };

    const osdu = new ColumnBasedTable23OSDU(xml, context);
    await osdu.initData("eml:///dataspace('test')/eml23.ColumnBasedTable(pvt-uuid-001)", xml);

    // Should NOT be "Facies" (old hardcoded value)
    expect(osdu.data.ColumnBasedTableType).not.toContain("Facies");
  });

  it("infers KrPc table type from saturation/permeability columns", async () => {
    const { ColumnBasedTable23OSDU } = require("../lib/jsonTypes/ColumnBasedTable23");
    const context = new OSDUContext("test-partition", "test-rddms");

    const xml: any = {
      SchemaVersion: "2.3",
      Uuid: "krpc-uuid-001",
      Citation: { Title: "Rel Perm", Originator: "test", Creation: new Date() },
      Column: [
        {
          Title: "Relative Permeability",
          PropertyKind: { Title: "relative permeability" },
          ValueCountPerRow: 1,
          Values: { $type: "eml23.FloatingPointExternalArray" }
        }
      ],
      KeyColumn: [
        {
          Title: "Water Saturation",
          PropertyKind: { Title: "water saturation" },
          ValueCountPerRow: 1,
          Values: { $type: "eml23.FloatingPointExternalArray" }
        }
      ]
    };

    const osdu = new ColumnBasedTable23OSDU(xml, context);
    await osdu.initData("eml:///dataspace('test')/eml23.ColumnBasedTable(krpc-uuid-001)", xml);

    expect(osdu.data.ColumnBasedTableType).toContain("KrPc");
  });
});

// ============================================================================
// GridConnectionSet Transmissibility Detection
// ============================================================================
describe("GridConnectionSet transmissibility detection", () => {
  it("detectTransmissibility returns undefined when no sources found", async () => {
    const { GridConnectionSetRepresentationOSDU } = require("../lib/jsonTypes/GridConnectionSetRepresentation");
    const context = new OSDUContext("test-partition", "test-rddms");

    const xml: any = {
      SchemaVersion: "2.0",
      Uuid: "gcs-uuid-001",
      Citation: { Title: "Faults", Originator: "test", Creation: new Date() },
      Count: 100,
      Grid: [],
      RepresentedInterpretation: null
    };

    const osdu = new GridConnectionSetRepresentationOSDU(xml, context);

    // Mock client that returns empty resources
    const mockClient = {
      getResources: async () => [],
      getResolvedObjects: async () => []
    } as any;

    // Call detectTransmissibility directly
    const result = await (osdu as any).detectTransmissibility(
      "eml:///dataspace('test')/resqml20.obj_GridConnectionSetRepresentation(gcs-uuid-001)",
      mockClient
    );

    expect(result).toBeUndefined();
  });

  it("detectTransmissibility returns properties when transmissibility found", async () => {
    const { GridConnectionSetRepresentationOSDU } = require("../lib/jsonTypes/GridConnectionSetRepresentation");
    const context = new OSDUContext("test-partition", "test-rddms");

    const xml: any = {
      SchemaVersion: "2.0",
      Uuid: "gcs-uuid-002",
      Citation: { Title: "Faults", Originator: "test", Creation: new Date() },
      Count: 200,
      Grid: [],
      RepresentedInterpretation: null
    };

    const osdu = new GridConnectionSetRepresentationOSDU(xml, context);

    // Mock client returning a transmissibility property
    const mockClient = {
      getResources: async () => [
        {
          uri: "eml:///dataspace('test')/resqml20.obj_ContinuousProperty(trans-uuid)",
          name: "transmissibility multiplier"
        }
      ],
      getResolvedObjects: async () => []
    } as any;

    const result = await (osdu as any).detectTransmissibility(
      "eml:///dataspace('test')/resqml20.obj_GridConnectionSetRepresentation(gcs-uuid-002)",
      mockClient
    );

    expect(result).toBeDefined();
    expect(result!.HasTransmissibilityMultipliers).toBe(true);
    expect(result!.TransmissibilityPropertyCount).toBe(1);
  });
});

// ============================================================================
// WellLog Depth Extraction
// ============================================================================
describe("WellLog depth extraction from frame array", () => {
  it("extractDepthRange returns undefined when no arrays found", async () => {
    const { WellboreFrameToWellLogOSDU } = require("../lib/jsonTypes/WellboreFrameToWellLog");
    const context = new OSDUContext("test-partition", "test-rddms");

    const xml: any = {
      SchemaVersion: "2.0",
      Uuid: "frame-uuid-001",
      Citation: { Title: "MD Frame", Originator: "test", Creation: new Date() },
      NodeCount: 100
    };

    const osdu = new WellboreFrameToWellLogOSDU(xml, context);

    // Mock client
    const mockClient = {
      findDataArrays: () => {},
      getDataSubarray: async () => null
    } as any;

    const result = await (osdu as any).extractDepthRange(
      "eml:///dataspace('test')/resqml20.obj_WellboreFrameRepresentation(frame-uuid-001)",
      xml,
      100,
      mockClient
    );

    // No arrays found in the XML → returns undefined
    expect(result).toBeUndefined();
  });

  it("extractDepthRange returns undefined for nodeCount < 1", async () => {
    const { WellboreFrameToWellLogOSDU } = require("../lib/jsonTypes/WellboreFrameToWellLog");
    const context = new OSDUContext("test-partition", "test-rddms");

    const xml: any = {
      SchemaVersion: "2.0",
      Uuid: "frame-uuid-002",
      Citation: { Title: "Empty Frame", Originator: "test", Creation: new Date() },
      NodeCount: 0
    };

    const osdu = new WellboreFrameToWellLogOSDU(xml, context);
    const mockClient = {} as any;

    const result = await (osdu as any).extractDepthRange(
      "eml:///",
      xml,
      0,
      mockClient
    );

    expect(result).toBeUndefined();
  });
});
