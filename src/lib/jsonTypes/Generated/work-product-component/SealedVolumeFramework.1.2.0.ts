/**
 * OSDU SealedVolumeFramework work-product-component schema type definition.
 * Based on osdu:wks:work-product-component--SealedVolumeFramework:1.2.0
 * Inherits: AbstractCommonResources:1.0.0, AbstractWPCGroupType:1.2.0, AbstractWorkProductComponent:1.1.0
 */
export interface SealedVolumeFramework {
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
 * Properties for the SealedVolumeFramework WPC record.
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

  /** Reference to the SealedSurfaceFramework this volume framework is based on. */
  BasedOnID?: string;
  /** Whether all representations in the set share the same type. */
  IsHomogeneous?: boolean;
  /** References to the representations composing this framework. */
  RepresentationIDs?: string[];
  /** Number of volume regions defined in this framework. */
  RegionCount?: number;

  ExtensionProperties?: { [key: string]: any };
}
