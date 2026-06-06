/**
 * OSDU StructuralOrganizationInterpretation work-product-component schema type definition.
 * Based on osdu:wks:work-product-component--StructuralOrganizationInterpretation:1.2.0
 * Inherits: AbstractCommonResources:1.0.0, AbstractWPCGroupType:1.2.0, AbstractWorkProductComponent:1.1.0
 */
export interface StructuralOrganizationInterpretation {
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
 * Properties for the StructuralOrganizationInterpretation WPC record.
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

  /** The ordering criterion used for faults/horizons (e.g. "age", "measured depth", "TVD"). */
  OrderingCriteriaID?: string;
  /** References to the FaultInterpretation objects belonging to this structural organization. */
  FaultInterpretationIDs?: string[];
  /** References to the HorizonInterpretation objects belonging to this structural organization, ordered. */
  HorizonInterpretationIDs?: string[];
  /** References to boundary interpretations forming the top frontier. */
  TopFrontierIDs?: string[];
  /** References to boundary interpretations forming the bottom frontier. */
  BottomFrontierIDs?: string[];
  /** References to boundary interpretations forming the sides. */
  SideIDs?: string[];

  ExtensionProperties?: { [key: string]: any };
}
