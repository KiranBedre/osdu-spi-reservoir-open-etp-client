/**
 * OSDU ProductionValues WPC schema interface.
 *
 * Generated from: osdu:wks:work-product-component--ProductionValues:1.1.1
 *
 * Production and allocation data reporting values.
 */

export interface ProductionValues {
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
  // ProductionValues specific
  ReportingEntityID?: string;
  StartDateTime?: string;
  EndDateTime?: string;
  NominalPeriodIDs?: string[];
  QuantityMethodIDs?: string[];
  DurationContextIDs?: string[];
  PropertyIDs?: string[];
  ProductIDs?: string[];
  VolumeFlowMeasurementTypeIDs?: string[];
  DispositionIDs?: string[];
  ValueContexts?: any[];
  ReservoirModelScenarioID?: string;
  AmendReasonID?: string;
  ObservationInterval?: string;
  ExtensionProperties?: { [key: string]: any };
  // Spatial
  SpatialPoint?: any;
  SpatialArea?: any;
}

export interface FrameOfReferenceMetaDataItem {
  CoordinateReferenceSystemID?: string;
  Name?: string;
  PersistableReference?: string;
  UnitOfMeasureID?: string;
}
