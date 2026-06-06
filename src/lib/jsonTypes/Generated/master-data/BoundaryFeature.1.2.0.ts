/**
 * S3: Auto-create master-data--BoundaryFeature from RESQML BoundaryFeature
 *
 * The OSDU master-data--BoundaryFeature schema (M27) stores cross-model
 * boundary features (horizons, faults, fluid contacts) as master data
 * that can be referenced by multiple interpretations.
 *
 * This converter produces a master-data record that sits alongside the
 * existing WPC--LocalBoundaryFeature record. The manifest builder
 * de-duplicates by checking OSDU Storage before emitting.
 */

export interface MasterDataBoundaryFeature {
  acl: AccessControlList;
  ancestry?: ParentList;
  createTime?: Date;
  createUser?: string;
  data?: MasterDataBoundaryFeatureData;
  id?: string;
  kind: string;
  legal: LegalMetaData;
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

/**
 * master-data--BoundaryFeature data fields.
 * Based on OSDU M27 LocalBoundaryFeature.1.2.0 schema + master-data conventions.
 */
export interface MasterDataBoundaryFeatureData {
  // --- AbstractCommonResources ---
  ExistenceKind?: string;
  ResourceCurationStatus?: string;
  ResourceHomeRegionID?: string;
  ResourceHostRegionIDs?: string[];
  ResourceLifecycleStatus?: string;
  ResourceSecurityClassification?: string;
  Source?: string;

  // --- AbstractMaster ---
  GeoContexts?: any[];
  NameAliases?: any[];
  SpatialLocation?: any;
  TechnicalAssurances?: any[];
  DDMSDatasets?: string[];

  // --- BoundaryFeature-specific ---
  /** The name of the boundary feature (horizon, fault, contact). */
  FeatureName?: string;
  /** The type of boundary: horizon, fault, geobody-boundary, fluid-contact. */
  BoundaryFeatureTypeID?: string;
  /** Optional description. */
  Description?: string;

  ExtensionProperties?: { [key: string]: any };
}
