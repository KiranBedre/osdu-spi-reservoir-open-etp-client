/**
 * OSDU FluidModel WPC schema interface.
 *
 * Generated from: osdu:wks:work-product-component--FluidModel:1.0.0
 *
 * Describes the parameterization of a fluid model used in reservoir simulation.
 */

export interface FluidModel {
  acl?: any;
  ancestry?: any;
  createTime?: Date;
  createUser?: string;
  data?: Data;
  id?: string;
  kind: string;
  legal?: any;
  meta?: FrameOfReferenceMetaDataItem[];
  modifyTime?: Date;
  modifyUser?: string;
  tags?: { [key: string]: any };
  version?: number;
}

export interface Data {
  // AbstractCommonResources
  ExistenceKind?: string;
  ResourceCurationStatus?: string;
  ResourceHomeRegionID?: string;
  ResourceHostRegionIDs?: string[];
  ResourceLifecycleStatus?: string;
  ResourceSecurityClassification?: string;
  Source?: string;
  TechnicalAssuranceID?: string;
  // AbstractWPCGroupType
  Artefacts?: any[];
  Datasets?: string[];
  DDMSDatasets?: string[];
  IsDiscoverable?: boolean;
  // AbstractWorkProductComponent
  Name?: string;
  Description?: string;
  CreationDateTime?: Date;
  // FluidModel specific
  FluidModelTypeID?: string;
  FluidModelSaturationTypeID?: string;
  BasisOfModelling?: BasisOfModelling;
  ParentModelID?: string;
  DatePublished?: string;
  ModellingContacts?: ModellingContact[];
  ModelAreaOfInterestIDs?: string[];
  IsApplicableForThermalSimulation?: boolean;
  HasVariableDepthFluidProperties?: boolean;
  Remarks?: string[];
  ExtensionProperties?: { [key: string]: any };
  // Spatial
  SpatialPoint?: any;
  SpatialArea?: any;
}

export interface BasisOfModelling {
  ModelSourceDescription?: string;
  IntendedUsage?: string;
}

export interface ModellingContact {
  Name?: string;
  Role?: string;
}

export interface FrameOfReferenceMetaDataItem {
  CoordinateReferenceSystemID?: string;
  Name?: string;
  PersistableReference?: string;
  UnitOfMeasureID?: string;
}
