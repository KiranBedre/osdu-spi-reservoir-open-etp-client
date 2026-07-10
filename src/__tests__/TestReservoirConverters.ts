// ============================================================================
// Tests for Reservoir Management converters and round-trip enhancements
// Covers:
//  - ExtraMetadata non-osdu preservation (ResqmlMetadata, AuthoringSoftware)
//  - IjkGrid v2.0 new fields (RealizationIndex, ParentGridID, HasTruncations, RockFluidOrgIDS)
//  - IjkGrid v2.2 same new fields
//  - GenericProperty FacetIDs mapping
//  - GenericProperty22 FacetIDs, RealizationIndices, TimeIndices
//  - ReservoirCompartmentInterpretation22 converter registration + execution
//  - FluidModel (PRODML) converter registration + execution
//  - ProductionValues (PRODML) converter registration + execution
//  - MilestoneKinds additions
// ============================================================================

import "jest";

import { OSDUContext, ResqmlOSDUMap } from "../lib/jsonTypes/OsduContext";
import { ResqmlWorkProductComponent } from "../lib/jsonTypes/WorkProductComponent";
import type { SimpleJson } from "../lib/mlTypes/XmlJsonUtil";

// Load the full registry
require("../lib/jsonTypes/ResqmlOsdu");

const mockClient = {
  getDataArrayValues: async () => [],
  getResolvedObjects: async () => ({}),
  getObjects: async () => []
} as any;

// ============================================================================
// ExtraMetadata Preservation (non-osdu entries → ResqmlMetadata)
// ============================================================================
describe("ExtraMetadata non-osdu preservation", () => {
  it("stores non-osdu metadata in ExtensionProperties.ResqmlMetadata", () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    // Use a minimal concrete class for testing
    const { GenericPropertyOSDU } = require("../lib/jsonTypes/GenericProperty");

    const xml: any = {
      SchemaVersion: "2.0",
      Uuid: "test-uuid",
      Citation: { Title: "Test", Originator: "tester", Creation: new Date() },
      IndexableElement: "cells",
      Count: 1,
      PropertyKind: { PropertyKind: "length" },
      PatchOfValues: [{ Values: {} }]
    };

    const osdu = new GenericPropertyOSDU(xml, context);
    osdu.data = { ValueCount: 1 };

    const extra = [
      { Name: "AuthoringSoftware", Value: "Petrel 2023" },
      { Name: "CustomField", Value: "MyValue" },
      { Name: "osdu/data/ValueCount", Value: "99" } // osdu-prefixed should go to data
    ];

    osdu.assignExtraMetaData(extra);

    // Non-osdu entries go to ResqmlMetadata sub-object
    expect(osdu.data.ExtensionProperties?.ResqmlMetadata).toBeDefined();
    expect(osdu.data.ExtensionProperties.ResqmlMetadata["AuthoringSoftware"]).toEqual("Petrel 2023");
    expect(osdu.data.ExtensionProperties.ResqmlMetadata["CustomField"]).toEqual("MyValue");
  });

  it("preserves AuthoringSoftware from Citation.Format", () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const { GenericPropertyOSDU } = require("../lib/jsonTypes/GenericProperty");

    const xml: any = {
      SchemaVersion: "2.0",
      Uuid: "test-uuid-2",
      Citation: {
        Title: "Test",
        Originator: "tester",
        Creation: new Date(),
        Format: "ResInsight v2024.1"
      },
      IndexableElement: "cells",
      Count: 1,
      PropertyKind: { PropertyKind: "porosity" },
      PatchOfValues: [{ Values: {} }]
    };

    const osdu = new GenericPropertyOSDU(xml, context);
    osdu.data = { ValueCount: 1 };
    osdu.authoringSoftware = "ResInsight v2024.1";

    osdu.assignExtraMetaData([]);

    expect(osdu.data.ExtensionProperties?.AuthoringSoftware).toEqual("ResInsight v2024.1");
  });

  it("does not create ResqmlMetadata when all entries are osdu-prefixed", () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const { GenericPropertyOSDU } = require("../lib/jsonTypes/GenericProperty");

    const xml: any = {
      SchemaVersion: "2.0",
      Uuid: "test-uuid-3",
      Citation: { Title: "Test", Originator: "tester", Creation: new Date() },
      IndexableElement: "cells",
      Count: 1,
      PropertyKind: { PropertyKind: "length" },
      PatchOfValues: [{ Values: {} }]
    };

    const osdu = new GenericPropertyOSDU(xml, context);
    osdu.data = { ValueCount: 1, ExtensionProperties: {} };

    const extra = [
      { Name: "osdu/tags/quality", Value: "verified" }
    ];

    osdu.assignExtraMetaData(extra);

    expect(osdu.data.ExtensionProperties?.ResqmlMetadata).toBeUndefined();
  });
});

// ============================================================================
// IjkGrid v2.0 New Fields
// ============================================================================
describe("IjkGrid v2.0 new fields", () => {
  const { IjkGridRepresentationOSDU } = require("../lib/jsonTypes/IjkGridRepresentation");

  const baseXml: any = {
    SchemaVersion: "2.0",
    Uuid: "9a487aca-44ca-4989-8ba7-653a5358ee80",
    Citation: { Title: "TestGrid", Originator: "Test", Creation: new Date() },
    Ni: 10,
    Nj: 20,
    Nk: 5,
    Geometry: {
      LocalCrs: {
        UUID: "eeeeeeee-0000-0000-0000-000000000099",
        Title: "LocalCrs",
        ContentType: "application/x-resqml+xml;version=2.0;type=obj_LocalDepth3dCrs"
      },
      Points: { $type: "Point3dParametricArray" },
      PillarShape: "straight",
      KDirection: "down"
    }
  };

  it("maps RealizationIndex from inherited AbstractRepresentation", async () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const xml = { ...baseXml, Geometry: undefined, RealizationIndex: 42 };
    const osdu = new IjkGridRepresentationOSDU(xml, context);
    await osdu.initData("eml:///dataspace('test')", xml, mockClient);
    expect(osdu.data.RealizationIndex).toEqual(42);
  });

  it("maps ParentGridID from ParentWindow.ParentIjkGridRepresentation", async () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const parentId = "eeeeeeee-0000-0000-0000-000000000001";
    const parentUri = `eml:///dataspace('test')/resqml20.obj_IjkGridRepresentation(${parentId})`;
    // Pre-populate context so dorToSrn resolves without calling the ETP server
    context.uriToObject.set(parentUri, {
      objectType: "resqml20.obj_IjkGridRepresentation",
      uuid: parentId,
      xml: {}
    } as any);
    const xml = {
      ...baseXml,
      Geometry: undefined,
      ParentWindow: {
        ParentIjkGridRepresentation: {
          UUID: parentId,
          Title: "ParentGrid",
          ContentType: "application/x-resqml+xml;version=2.0;type=obj_IjkGridRepresentation"
        }
      }
    };
    const osdu = new IjkGridRepresentationOSDU(xml, context);
    await osdu.initData("eml:///dataspace('test')", xml, mockClient);
    expect(osdu.data.ParentGridID).toBeDefined();
    expect(osdu.data.ParentGridID).toContain(parentId);
  });

  it("sets HasTruncations true when TruncationCells present", async () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const xml = { ...baseXml, Geometry: undefined, TruncationCells: { Count: 3 } };
    const osdu = new IjkGridRepresentationOSDU(xml, context);
    await osdu.initData("eml:///dataspace('test')", xml, mockClient);
    expect(osdu.data.HasTruncations).toBe(true);
  });

  it("sets HasTruncations false when TruncationCells absent", async () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const xml = { ...baseXml, Geometry: undefined };
    const osdu = new IjkGridRepresentationOSDU(xml, context);
    await osdu.initData("eml:///dataspace('test')", xml, mockClient);
    expect(osdu.data.HasTruncations).toBe(false);
  });

  it("maps RockFluidOrganizationInterpretationIDS from CellFluidPhaseUnits", async () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const fluidOrgId = "eeeeeeee-0000-0000-0000-000000000002";
    const fluidOrgUri = `eml:///dataspace('test')/resqml20.obj_RockFluidOrganizationInterpretation(${fluidOrgId})`;
    context.uriToObject.set(fluidOrgUri, {
      objectType: "resqml20.obj_RockFluidOrganizationInterpretation",
      uuid: fluidOrgId,
      xml: {}
    } as any);
    const xml = {
      ...baseXml,
      Geometry: undefined,
      CellFluidPhaseUnits: {
        FluidOrganization: {
          UUID: fluidOrgId,
          Title: "FluidOrg",
          ContentType: "application/x-resqml+xml;version=2.0;type=obj_RockFluidOrganizationInterpretation"
        }
      }
    };
    const osdu = new IjkGridRepresentationOSDU(xml, context);
    await osdu.initData("eml:///dataspace('test')", xml, mockClient);
    expect(osdu.data.RockFluidOrganizationInterpretationIDS).toBeDefined();
    expect(osdu.data.RockFluidOrganizationInterpretationIDS?.length).toBe(1);
    expect(osdu.data.RockFluidOrganizationInterpretationIDS![0]).toContain(fluidOrgId);
  });
});

// ============================================================================
// IjkGrid v2.2 New Fields
// ============================================================================
describe("IjkGrid v2.2 new fields", () => {
  const { IjkGridRepresentation22OSDU } = require("../lib/jsonTypes/IjkGridRepresentation22");

  const baseXml22: any = {
    SchemaVersion: "2.2",
    Uuid: "22222222-aaaa-bbbb-cccc-dddddddddddd",
    Citation: { Title: "TestGrid22", Originator: "Test", Creation: new Date() },
    Ni: 15,
    Nj: 25,
    Nk: 8,
    Geometry: {
      LocalCrs: { Uuid: "cccccccc-0000-0000-0000-000000000001", Title: "LocalCrs22", QualifiedType: "eml23.LocalEngineeringCompoundCrs" },
      Points: { $type: "Point3dParametricArray" },
      PillarShape: "curved",
      KDirection: "down"
    }
  };

  it("maps RealizationIndex directly (no cast needed for v2.2)", async () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    // No Geometry = no spatial info computation
    const xml = { ...baseXml22, Geometry: undefined, RealizationIndex: 7 };
    const osdu = new IjkGridRepresentation22OSDU(xml, context);
    await osdu.initData("eml:///dataspace('test22')", xml, mockClient);
    expect(osdu.data.RealizationIndex).toEqual(7);
  });

  it("maps ParentGridID from ParentWindow", async () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const parentId = "cccccccc-0000-0000-0000-000000000002";
    const parentUri = `eml:///dataspace('test22')/resqml22.IjkGridRepresentation(${parentId})`;
    context.uriToObject.set(parentUri, {
      objectType: "resqml22.IjkGridRepresentation",
      uuid: parentId,
      xml: {}
    } as any);
    const xml = {
      ...baseXml22,
      Geometry: undefined,
      ParentWindow: {
        ParentIjkGridRepresentation: {
          Uuid: parentId,
          Title: "ParentGrid22",
          QualifiedType: "resqml22.IjkGridRepresentation"
        }
      }
    };
    const osdu = new IjkGridRepresentation22OSDU(xml, context);
    await osdu.initData("eml:///dataspace('test22')", xml, mockClient);
    expect(osdu.data.ParentGridID).toBeDefined();
    expect(osdu.data.ParentGridID).toContain(parentId);
  });

  it("sets HasTruncations from TruncationCellPatch (v2.2 naming)", async () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const xml = { ...baseXml22, Geometry: undefined, TruncationCellPatch: { Count: 2 } };
    const osdu = new IjkGridRepresentation22OSDU(xml, context);
    await osdu.initData("eml:///dataspace('test22')", xml, mockClient);
    expect(osdu.data.HasTruncations).toBe(true);
  });
});

// ============================================================================
// GenericProperty v2.0 FacetIDs
// ============================================================================
describe("GenericProperty v2.0 FacetIDs", () => {
  const { GenericPropertyOSDU } = require("../lib/jsonTypes/GenericProperty");

  it("maps Facet array to FacetIDs with reference-data SRNs", async () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const gridId = "ffffffff-0000-0000-0000-000000000001";
    // Pre-populate SupportingRepresentation DOR
    const repUri = `eml:///dataspace('test')/resqml20.obj_IjkGridRepresentation(${gridId})`;
    context.uriToObject.set(repUri, {
      objectType: "resqml20.obj_IjkGridRepresentation",
      uuid: gridId,
      xml: {}
    } as any);

    const xml: any = {
      $type: "resqml20.obj_ContinuousProperty",
      SchemaVersion: "2.0",
      Uuid: "ffffffff-0000-0000-0000-000000000002",
      Citation: { Title: "FacetProp", Originator: "Test", Creation: new Date() },
      IndexableElement: "cells",
      Count: 100,
      PropertyKind: { PropertyKind: "porosity" },
      Facet: [
        { Facet: "direction", Value: "I" },
        { Facet: "condition", Value: "initial" }
      ],
      SupportingRepresentation: {
        UUID: gridId,
        Title: "Grid",
        ContentType: "application/x-resqml+xml;version=2.0;type=obj_IjkGridRepresentation"
      },
      PatchOfValues: [{ Values: {} }]
    };

    const osdu = new GenericPropertyOSDU(xml, context);
    await osdu.initData("eml:///dataspace('test')", xml, mockClient);

    expect(osdu.data.FacetIDs).toBeDefined();
    expect(osdu.data.FacetIDs?.length).toBe(2);
    expect(osdu.data.FacetIDs![0].FacetRoleID).toContain("PropertyKindFacet");
    expect(osdu.data.FacetIDs![0].FacetRoleID).toContain("I");
    expect(osdu.data.FacetIDs![0].FacetTypeID).toContain("FacetType");
    expect(osdu.data.FacetIDs![0].FacetTypeID).toContain("direction");
  });

  it("returns undefined FacetIDs when no Facet array present", async () => {
    const context = new OSDUContext("test-partition", "test-rddms");
    const gridId = "ffffffff-0000-0000-0000-000000000003";
    const repUri = `eml:///dataspace('test')/resqml20.obj_IjkGridRepresentation(${gridId})`;
    context.uriToObject.set(repUri, {
      objectType: "resqml20.obj_IjkGridRepresentation",
      uuid: gridId,
      xml: {}
    } as any);

    const xml: any = {
      $type: "resqml20.obj_ContinuousProperty",
      SchemaVersion: "2.0",
      Uuid: "ffffffff-0000-0000-0000-000000000004",
      Citation: { Title: "NoFacet", Originator: "Test", Creation: new Date() },
      IndexableElement: "cells",
      Count: 50,
      PropertyKind: { PropertyKind: "permeability" },
      SupportingRepresentation: {
        UUID: gridId,
        Title: "Grid2",
        ContentType: "application/x-resqml+xml;version=2.0;type=obj_IjkGridRepresentation"
      },
      PatchOfValues: [{ Values: {} }]
    };

    const osdu = new GenericPropertyOSDU(xml, context);
    await osdu.initData("eml:///dataspace('test')", xml, mockClient);

    expect(osdu.data.FacetIDs).toBeUndefined();
  });
});

// ============================================================================
// GenericProperty v2.2 FacetIDs + RealizationIndices
// ============================================================================
describe("GenericProperty v2.2 enhancements", () => {
  const { GenericProperty22OSDU } = require("../lib/jsonTypes/GenericProperty22");

  const baseXml22: any = {
    $type: "resqml22.ContinuousProperty",
    SchemaVersion: "2.2",
    Uuid: "dddddddd-0000-0000-0000-000000000001",
    Citation: { Title: "GP22Test", Originator: "Test", Creation: new Date() },
    IndexableElement: "cells",
    Count: 200,
    PropertyKind: { Uuid: "dddddddd-0000-0000-0000-000000000002", Title: "porosity", QualifiedType: "resqml22.PropertyKind" },
    Facet: [
      { Facet: "what", Value: "net" }
    ],
    SupportingRepresentation: {
      Uuid: "dddddddd-0000-0000-0000-000000000003",
      Title: "Rep22",
      QualifiedType: "resqml22.IjkGridRepresentation"
    },
    ValuesForPatch: [],
    PatchOfValues: [{ Values: {} }]
  };

  function makeContext() {
    const context = new OSDUContext("test-partition", "test-rddms");
    const repUri = "eml:///dataspace('test22')/resqml22.IjkGridRepresentation(dddddddd-0000-0000-0000-000000000003)";
    context.uriToObject.set(repUri, {
      objectType: "resqml22.IjkGridRepresentation",
      uuid: "dddddddd-0000-0000-0000-000000000003",
      xml: {}
    } as any);
    return context;
  }

  it("maps FacetIDs from Facet array (v2.2)", async () => {
    const context = makeContext();
    const osdu = new GenericProperty22OSDU(baseXml22, context);
    await osdu.initData("eml:///dataspace('test22')", baseXml22, mockClient);

    expect(osdu.data.FacetIDs).toBeDefined();
    expect(osdu.data.FacetIDs?.length).toBe(1);
    expect(osdu.data.FacetIDs![0].FacetRoleID).toContain("net");
    expect(osdu.data.FacetIDs![0].FacetTypeID).toContain("what");
  });

  it("maps RealizationIndices to single-element array", async () => {
    const context = makeContext();
    const xml = { ...baseXml22, RealizationIndices: 3 };
    const osdu = new GenericProperty22OSDU(xml, context);
    await osdu.initData("eml:///dataspace('test22')", xml, mockClient);

    expect(osdu.data.RealizationIndices).toEqual([3]);
  });

  it("leaves RealizationIndices undefined when absent", async () => {
    const context = makeContext();
    const osdu = new GenericProperty22OSDU(baseXml22, context);
    await osdu.initData("eml:///dataspace('test22')", baseXml22, mockClient);

    expect(osdu.data.RealizationIndices).toBeUndefined();
  });
});

// ============================================================================
// S3: ReservoirCompartmentInterpretation22 Converter
// ============================================================================
describe("ReservoirCompartmentInterpretation22 converter", () => {
  const registry = ResqmlOSDUMap.getInstance();

  it("is registered for resqml22.ReservoirCompartmentInterpretation", () => {
    const entry = registry.get("resqml22.ReservoirCompartmentInterpretation");
    expect(entry).toBeDefined();
    expect(entry!.convert).toBeInstanceOf(Function);
  });

  it("returns correct OSDU kind", () => {
    const entry = registry.get("resqml22.ReservoirCompartmentInterpretation");
    const kind = entry!.osduKind({} as any);
    expect(kind).toContain("ReservoirCompartmentInterpretation");
  });

  it("converts basic ReservoirCompartmentInterpretation", async () => {
    const { ReservoirCompartmentInterpretation22Manifest } = require(
      "../lib/jsonTypes/ReservoirCompartmentInterpretation22"
    );
    const context = new OSDUContext("test-partition", "test-rddms");

    const featureId = "bbbbbbbb-0000-0000-0000-000000000001";
    const rciId = "bbbbbbbb-0000-0000-0000-000000000002";

    // Pre-populate referenced feature
    const featureUri = `eml:///dataspace('test')/resqml22.RockVolumeFeature(${featureId})`;
    context.uriToObject.set(featureUri, {
      objectType: "resqml22.RockVolumeFeature",
      uuid: featureId,
      xml: {}
    } as any);

    const xml: any = {
      Uuid: rciId,
      Citation: {
        Title: "TestCompartment",
        Originator: "Test",
        Creation: new Date("2024-01-01"),
        Format: "TestSoftware"
      },
      GeologicUnit3dShape: "sheet",
      GeologicUnitComposition: "ite",
      DepositionalEnvironment: "marine",
      InterpretedFeature: {
        Uuid: featureId,
        Title: "TestFeature",
        QualifiedType: "resqml22.RockVolumeFeature"
      },
      Domain: "depth"
    };

    const result = await ReservoirCompartmentInterpretation22Manifest(
      `eml:///dataspace('test')/resqml22.ReservoirCompartmentInterpretation(${rciId})`,
      xml,
      context,
      mockClient
    );

    expect(result).toBeDefined();
    expect(result.data).toBeDefined();
    expect(result.data.GeologicUnitShapeTypeID).toContain("GeologicUnitShapeType");
    expect(result.data.GeologicUnitShapeTypeID).toContain("Sheet");
    expect(result.data.LithologyTypeID).toContain("LithologyType");
    expect(result.data.LithologyTypeID).toContain("Ite");
    expect(result.data.DepositionalEnvironmentTypeID).toContain("DepositionalEnvironmentType");
    expect(result.data.DepositionalEnvironmentTypeID).toContain("Marine");
  });

  it("converts ReservoirCompartmentUnits", async () => {
    const { ReservoirCompartmentInterpretation22Manifest } = require(
      "../lib/jsonTypes/ReservoirCompartmentInterpretation22"
    );
    const context = new OSDUContext("test-partition", "test-rddms");

    const featId = "aaaaaaaa-0000-0000-0000-000000000001";
    const fluid1Id = "aaaaaaaa-0000-0000-0000-000000000002";
    const fluid2Id = "aaaaaaaa-0000-0000-0000-000000000003";
    const geo1Id = "aaaaaaaa-0000-0000-0000-000000000004";
    const geo2Id = "aaaaaaaa-0000-0000-0000-000000000005";
    const rciId = "aaaaaaaa-0000-0000-0000-000000000006";

    // Pre-populate referenced objects
    context.uriToObject.set(`eml:///dataspace('test')/resqml22.RockVolumeFeature(${featId})`, { objectType: "resqml22.RockVolumeFeature", uuid: featId, xml: {} } as any);
    context.uriToObject.set(`eml:///dataspace('test')/resqml22.RockFluidUnitInterpretation(${fluid1Id})`, { objectType: "resqml22.RockFluidUnitInterpretation", uuid: fluid1Id, xml: {} } as any);
    context.uriToObject.set(`eml:///dataspace('test')/resqml22.RockFluidUnitInterpretation(${fluid2Id})`, { objectType: "resqml22.RockFluidUnitInterpretation", uuid: fluid2Id, xml: {} } as any);
    context.uriToObject.set(`eml:///dataspace('test')/resqml22.GeologicUnitInterpretation(${geo1Id})`, { objectType: "resqml22.GeologicUnitInterpretation", uuid: geo1Id, xml: {} } as any);
    context.uriToObject.set(`eml:///dataspace('test')/resqml22.GeologicUnitInterpretation(${geo2Id})`, { objectType: "resqml22.GeologicUnitInterpretation", uuid: geo2Id, xml: {} } as any);

    const xml: any = {
      Uuid: rciId,
      Citation: {
        Title: "CompartmentWithUnits",
        Originator: "Test",
        Creation: new Date("2024-01-01")
      },
      InterpretedFeature: { Uuid: featId, Title: "Feat", QualifiedType: "resqml22.RockVolumeFeature" },
      Domain: "depth",
      ReservoirCompartmentUnit: [
        {
          FluidUnits: [
            { Uuid: fluid1Id, Title: "FluidUnit1", QualifiedType: "resqml22.RockFluidUnitInterpretation" }
          ],
          GeologicUnitInterpretation: { Uuid: geo1Id, Title: "GeoUnit1", QualifiedType: "resqml22.GeologicUnitInterpretation" }
        },
        {
          FluidUnits: { Uuid: fluid2Id, Title: "FluidUnit2", QualifiedType: "resqml22.RockFluidUnitInterpretation" },
          GeologicUnitInterpretation: { Uuid: geo2Id, Title: "GeoUnit2", QualifiedType: "resqml22.GeologicUnitInterpretation" }
        }
      ]
    };

    const result = await ReservoirCompartmentInterpretation22Manifest(
      `eml:///dataspace('test')/resqml22.ReservoirCompartmentInterpretation(${rciId})`,
      xml,
      context,
      mockClient
    );

    expect(result.data.ReservoirCompartmentUnits).toBeDefined();
    expect(result.data.ReservoirCompartmentUnits!.length).toBe(2);
    // First unit has array of fluid units (RockFluidUnitInterpretation IS registered, so it resolves)
    expect(result.data.ReservoirCompartmentUnits![0].FluidUnitIDs?.length).toBe(1);
    expect(result.data.ReservoirCompartmentUnits![0].FluidUnitIDs![0]).toContain(fluid1Id);
    // GeologicUnitInterpretation is NOT registered in ResqmlOsdu.ts, so dorToSrn returns undefined
    expect(result.data.ReservoirCompartmentUnits![0].GeologicUnitInterpretationID).toBeUndefined();
    // Second unit has single fluid unit (not array)
    expect(result.data.ReservoirCompartmentUnits![1].FluidUnitIDs?.length).toBe(1);
  });
});

// ============================================================================
// S3: FluidModel (PRODML) Converter
// ============================================================================
describe("FluidModel (PRODML) converter", () => {
  const registry = ResqmlOSDUMap.getInstance();

  it("is registered for prodml23.FluidCharacterization", () => {
    const entry = registry.get("prodml23.FluidCharacterization");
    expect(entry).toBeDefined();
    expect(entry!.convert).toBeInstanceOf(Function);
  });

  it("returns correct OSDU kind", () => {
    const entry = registry.get("prodml23.FluidCharacterization");
    const kind = entry!.osduKind({} as any);
    expect(kind).toContain("FluidModel");
  });

  it("converts FluidCharacterization to FluidModel", async () => {
    const { FluidModelManifest } = require("../lib/jsonTypes/FluidModel");
    const context = new OSDUContext("test-partition", "test-rddms");

    const xml: any = {
      Uuid: "fluid-char-uuid",
      Citation: {
        Title: "TestFluid",
        Originator: "PVTSim",
        Creation: new Date("2024-06-01")
      },
      Kind: "Black Oil",
      IntendedUsage: "reservoir simulation",
      Remark: "High GOR fluid system",
      ApplicationTarget: "Eclipse",
      FluidComponentCatalog: { Component: [] },
      Model: [
        { Name: "Model1" },
        { Name: "Model2" }
      ],
      StandardConditions: { Temperature: 15.56, Pressure: 101.325 }
    };

    const result = await FluidModelManifest(
      "eml:///dataspace('test')/prodml23.FluidCharacterization(fluid-char-uuid)",
      xml,
      context,
      mockClient
    );

    expect(result).toBeDefined();
    expect(result.data.FluidModelTypeID).toContain("FluidModelType");
    expect(result.data.FluidModelTypeID).toContain("Black%20Oil");
    expect(result.data.Remarks).toBeDefined();
    expect(result.data.Remarks!.length).toBe(2);
    expect(result.data.HasVariableDepthFluidProperties).toBe(true);

    // ExtensionProperties for round-trip
    expect(result.data.ExtensionProperties?.ApplicationTarget).toEqual("Eclipse");
    expect(result.data.ExtensionProperties?.ModelCount).toBe(2);
    expect(result.data.ExtensionProperties?.ModelNames).toEqual(["Model1", "Model2"]);
    expect(result.data.ExtensionProperties?.HasFluidComponentCatalog).toBe(true);
    expect(result.data.ExtensionProperties?.StandardConditions).toBeDefined();
  });
});

// ============================================================================
// S3: ProductionValues (PRODML) Converter
// ============================================================================
describe("ProductionValues (PRODML) converter", () => {
  const registry = ResqmlOSDUMap.getInstance();

  it("is registered for prodml23.TimeSeriesData", () => {
    const entry = registry.get("prodml23.TimeSeriesData");
    expect(entry).toBeDefined();
    expect(entry!.convert).toBeInstanceOf(Function);
  });

  it("returns correct OSDU kind", () => {
    const entry = registry.get("prodml23.TimeSeriesData");
    const kind = entry!.osduKind({} as any);
    expect(kind).toContain("ProductionValues");
  });

  it("converts TimeSeriesData to ProductionValues", async () => {
    const { ProductionValuesManifest } = require("../lib/jsonTypes/ProductionValues");
    const context = new OSDUContext("test-partition", "test-rddms");

    const xml: any = {
      Uuid: "ts-data-uuid",
      Citation: {
        Title: "WellProd",
        Originator: "Production System",
        Creation: new Date("2024-03-01")
      },
      Key: [
        { Keyword: "Well", Value: "NO 15/9-F-1" },
        { Keyword: "Measurement", Value: "OilRate" }
      ],
      MeasureClass: "volume per time",
      Uom: "m3/d",
      Comment: "Daily oil production",
      DataValue: [
        { dTim: "2024-01-01T00:00:00Z", Value: 100.5 },
        { dTim: "2024-01-02T00:00:00Z", Value: 101.2 },
        { dTim: "2024-01-03T00:00:00Z", Value: 99.8 }
      ]
    };

    const result = await ProductionValuesManifest(
      "eml:///dataspace('test')/prodml23.TimeSeriesData(ts-data-uuid)",
      xml,
      context,
      mockClient
    );

    expect(result).toBeDefined();
    // Date range extraction
    expect(result.data.StartDateTime).toEqual("2024-01-01T00:00:00.000Z");
    expect(result.data.EndDateTime).toEqual("2024-01-03T00:00:00.000Z");
    // PropertyIDs from Key
    expect(result.data.PropertyIDs).toBeDefined();
    expect(result.data.PropertyIDs!.length).toBe(3); // 2 keys + 1 MeasureClass
    expect(result.data.PropertyIDs![0]).toContain("ProductionMeasurement");
    expect(result.data.PropertyIDs![0]).toContain("Well");
    // ExtensionProperties
    expect(result.data.ExtensionProperties?.Comment).toEqual("Daily oil production");
    expect(result.data.ExtensionProperties?.Uom).toEqual("m3/d");
    expect(result.data.ExtensionProperties?.MeasureClass).toEqual("volume per time");
    expect(result.data.ExtensionProperties?.SampleCount).toBe(3);
  });

  it("handles empty DataValue gracefully", async () => {
    const { ProductionValuesManifest } = require("../lib/jsonTypes/ProductionValues");
    const context = new OSDUContext("test-partition", "test-rddms");

    const xml: any = {
      Uuid: "ts-empty-uuid",
      Citation: {
        Title: "EmptyTimeSeries",
        Originator: "Test",
        Creation: new Date("2024-03-01")
      }
    };

    const result = await ProductionValuesManifest(
      "eml:///dataspace('test')/prodml23.TimeSeriesData(ts-empty-uuid)",
      xml,
      context,
      mockClient
    );

    expect(result).toBeDefined();
    expect(result.data.StartDateTime).toBeUndefined();
    expect(result.data.EndDateTime).toBeUndefined();
    expect(result.data.PropertyIDs).toBeUndefined();
  });
});

// ============================================================================
// MilestoneKinds Additions
// ============================================================================
describe("MilestoneKinds reservoir entries", () => {
  const { getKind, isKindAvailable } = require("../lib/jsonTypes/MilestoneKinds");

  const expectedWpcKinds = [
    "ReservoirCompartmentInterpretation",
    "FluidModel",
    "SaturationFunctionSet",
    "ReservoirModelScenario",
    "ReservoirSimulationModel",
    "ReservoirSimulationEquilibriumModel",
    "ReservoirSimulationRockPhysicsModel",
    "ReservoirSimulationRunConfiguration",
    "ReservoirEstimatedVolumes",
    "ProductionValues",
    "GeoLabelSet"
  ];

  it.each(expectedWpcKinds)(
    "has %s in fallback kinds",
    (kindName) => {
      expect(isKindAvailable(kindName)).toBe(true);
      const kind = getKind(kindName);
      expect(kind).toContain(`work-product-component--${kindName}:`);
    }
  );

  it("has Reservoir master-data", () => {
    expect(isKindAvailable("Reservoir")).toBe(true);
    expect(getKind("Reservoir")).toContain("master-data--Reservoir:");
  });

  it("has ReservoirSegment master-data", () => {
    expect(isKindAvailable("ReservoirSegment")).toBe(true);
    expect(getKind("ReservoirSegment")).toContain("master-data--ReservoirSegment:");
  });
});
