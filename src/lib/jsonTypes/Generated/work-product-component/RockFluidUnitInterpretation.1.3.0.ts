/**
 * OSDU RockFluidUnitInterpretation work-product-component schema type definition.
 * Based on osdu:wks:work-product-component--RockFluidUnitInterpretation:1.3.0
 * Inherits: AbstractCommonResources:1.0.0, AbstractWPCGroupType:1.2.0, AbstractWorkProductComponent:1.1.0
 */
export interface RockFluidUnitInterpretation {
  acl: AccessControlList;
  ancestry?: ParentList;
  createTime?: Date;
  createUser?: string;
  data?: Data;
  id?: string;
  kind: string;
  legal: LegalMetaData;
  meta?: FrameOfReferenceMetaDataItem[];
  modifyTime?: Date;
  modifyUser?: string;
  tags?: { [key: string]: string };
  version?: number;
}

export interface AccessControlList {
  owners: string[];
  viewers: string[];
}

export interface ParentList {
  parents?: string[];
}

export interface LegalMetaData {
  legaltags: string[];
  otherRelevantDataCountries: string[];
}

export interface FrameOfReferenceMetaDataItem {
  kind?: string;
  name?: string;
  persistableReference?: string;
  coordinateReferenceSystemID?: string;
}

/**
 * Properties for the RockFluidUnitInterpretation WPC record.
 */
export interface Data {
  ExistenceKind?: string;
  ResourceCurationStatus?: string;
  ResourceHomeRegionID?: string;
  ResourceHostRegionIDs?: string[];
  ResourceLifecycleStatus?: string;
  ResourceSecurityClassification?: string;
  Source?: string;
  TechnicalAssuranceID?: string;
  Artefacts?: any[];
  Datasets?: string[];
  DDMSDatasets?: string[];
  IsDiscoverable?: boolean;
  IsExtendedLoad?: boolean;
  NameAliases?: any[];
  TechnicalAssurances?: any[];

  AuthorIDs?: string[];
  BusinessActivities?: string[];
  CreationDateTime?: Date;
  Description?: string;
  GeoContexts?: any[];
  LineageAssertions?: any[];
  Name?: string;
  SpatialArea?: any;
  SpatialPoint?: any;
  SubmitterName?: string;
  Tags?: string[];

  /** Describes the domain of the interpretation: Depth, Time, Mixed */
  DomainTypeID?: string;
  /** Reference to the Feature the Interpretation refers to. */
  FeatureID?: string;
  /** Name of the feature the Interpretation refers to. */
  FeatureName?: string;

  /** The fluid phase of this rock-fluid unit (e.g. "aquifer", "gas cap", "oil column"). */
  PhaseID?: string;
  /** Shape of the geologic unit (reference-data--GeologicUnitShapeType). */
  GeologicUnitShapeTypeID?: string;
  /** Lithology type of the geologic unit (reference-data--LithologyType). */
  LithologyTypeID?: string;

  ExtensionProperties?: { [key: string]: any };
}
