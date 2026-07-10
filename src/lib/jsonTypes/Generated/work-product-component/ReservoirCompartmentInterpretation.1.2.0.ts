/**
 * OSDU ReservoirCompartmentInterpretation WPC schema interface.
 *
 * Generated from: osdu:wks:work-product-component--ReservoirCompartmentInterpretation:1.2.0
 *
 * A portion of a reservoir rock which is differentiated laterally from other
 * portions of the same reservoir stratum.
 */

export interface ReservoirCompartmentInterpretation {
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
  // AbstractInterpretation
  FeatureID?: string;
  FeatureName?: string;
  OlderPossibleAge?: number;
  YoungerPossibleAge?: number;
  InterpretationDomain?: string;
  // Reservoir Compartment specific
  ReservoirCompartmentUnits?: ReservoirCompartmentUnit[];
  BoundaryIDs?: string[];
  GeologicUnitShapeTypeID?: string;
  LithologyTypeID?: string;
  DepositionalEnvironmentTypeID?: string;
  ExtensionProperties?: { [key: string]: any };
  // Spatial
  SpatialPoint?: any;
  SpatialArea?: any;
}

export interface ReservoirCompartmentUnit {
  FluidUnitIDs?: string[];
  GeologicUnitInterpretationID?: string;
}

export interface FrameOfReferenceMetaDataItem {
  CoordinateReferenceSystemID?: string;
  CRSLatitude?: number;
  CRSLongitude?: number;
  CRSScaleFactor?: number;
  Name?: string;
  PersistableReference?: string;
  UnitOfMeasureID?: string;
  VerticalCoordinateReferenceSystemID?: string;
}
