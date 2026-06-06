// Generated from OSDU M27 schema: osdu:wks:work-product-component--SeismicLineGeometry:1.2.0
//
// A representation of the geometry and binning of a single 2D seismic line.

/**
 * A representation of the geometry and binning of a single 2D seismic line.
 * Contains the CMP range, first/last spatial locations, and references to
 * the notional seismic line and interpretation set.
 */
export interface SeismicLineGeometry {
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
  status?: string;
}

export interface Data {
  // --- AbstractCommonResources ---
  ExistenceKind?: string;
  ResourceCurationStatus?: string;
  ResourceHomeRegionID?: string;
  ResourceHostRegionIDs?: string[];
  ResourceLifecycleStatus?: string;
  ResourceSecurityClassification?: string;
  Source?: string;
  TechnicalAssuranceID?: string;

  // --- AbstractWPCGroupType ---
  Artefacts?: Artefacts[];
  Datasets?: string[];
  DDMSDatasets?: string[];
  IsDiscoverable?: boolean;
  IsExtendedLoad?: boolean;
  NameAliases?: AbstractAliasNames[];
  TechnicalAssurances?: AbstractTechnicalAssurance[];

  // --- AbstractWorkProductComponent ---
  AuthorIDs?: string[];
  BusinessActivities?: string[];
  CreationDateTime?: Date;
  Description?: string;
  GeoContexts?: AbstractGeoContext[];
  LineageAssertions?: LineageAssertion[];
  Name?: string;
  SpatialArea?: AbstractSpatialLocation;
  SpatialPoint?: AbstractSpatialLocation;
  SubmitterName?: string;
  Tags?: string[];

  // --- SeismicLineGeometry individual properties ---
  /**
   * The smallest Common Mid-Point number for this 2D line.
   */
  FirstCMP?: number;
  /**
   * The spatial location of the first CMP of this line geometry.
   */
  FirstLocation?: AbstractSpatialLocation;
  /**
   * The label of the station at the first CMP of this line geometry.
   */
  FirstStationLabel?: string;
  /**
   * A flag indicating whether the CMP numbers increase monotonically by one.
   */
  HasCMPIncreaseByOne?: boolean;
  /**
   * A flag indicating whether the station labels are monotonically increasing or decreasing.
   */
  HasMonotonicLabelling?: boolean;
  /**
   * The reference to the Horizontal Coordinate Reference System of this line geometry.
   */
  HorizontalCRSID?: string;
  /**
   * The largest Common Mid-Point number for this 2D line.
   */
  LastCMP?: number;
  /**
   * The spatial location of the last CMP of this line geometry.
   */
  LastLocation?: AbstractSpatialLocation;
  /**
   * The label of the station at the last CMP of this line geometry.
   */
  LastStationLabel?: string;
  /**
   * The reference to the Notional Seismic Line (the named line concept).
   */
  NotionalSeismicLineID?: string;
  /**
   * The reference to the preferred 2D Interpretation Set containing this line.
   */
  Preferred2DInterpretationSetID?: string;

  ExtensionProperties?: { [key: string]: any };
}

export interface Artefacts {
  ResourceID?: string;
  ResourceKind?: string;
  RoleID?: string;
}

export interface AbstractAliasNames {
  AliasName?: string;
  AliasNameTypeID?: string;
  DefinitionOrganisationID?: string;
  EffectiveDateTime?: Date;
  TerminationDateTime?: Date;
}

export interface AbstractTechnicalAssurance {
  EffectiveDateTime?: Date;
  Remark?: string;
  TerminationDateTime?: Date;
  TechnicalAssuranceTypeID?: string;
}

export interface AbstractGeoContext {
  GeoPoliticalEntityID?: string;
  GeoTypeID?: string;
}

export interface LineageAssertion {
  ID?: string;
}

export interface AbstractSpatialLocation {
  AppliedOperations?: string[];
  AsIngestedCoordinates?: AbstractAnyCRSFeatureCollection;
  CoordinateQualityCheckDateTime?: Date;
  CoordinateQualityCheckPerformedBy?: string;
  CoordinateQualityCheckRemarks?: string[];
  QualitativeSpatialAccuracyTypeID?: string;
  QuantitativeAccuracyBandID?: string;
  SpatialGeometryTypeID?: string;
  SpatialLocationCoordinatesDate?: Date;
  SpatialParameterTypeID?: string;
  Wgs84Coordinates?: GeoJSONFeatureCollection;
}

export interface AbstractAnyCRSFeatureCollection {
  CoordinateReferenceSystemID?: string;
  Features?: AnyCRSGeoJSONFeature[];
  PersistableReferenceCrs?: string;
  VerticalCoordinateReferenceSystemID?: string;
}

export interface AnyCRSGeoJSONFeature {
  geometry?: AnyCRSGeoJSON;
  properties?: { [key: string]: any };
  type?: string;
}

export interface AnyCRSGeoJSON {
  coordinates?: any[];
  geometries?: GeometryElement[];
  type?: string;
}

export interface GeometryElement {
  coordinates?: any[];
  type?: string;
}

export interface GeoJSONFeatureCollection {
  features?: GeoJSONFeature[];
  type?: string;
}

export interface GeoJSONFeature {
  geometry?: GeoJSON;
  properties?: { [key: string]: any };
  type?: string;
}

export interface GeoJSON {
  coordinates?: any[];
  geometries?: GeometryObject[];
  type?: string;
}

export interface GeometryObject {
  coordinates?: any[];
  type?: string;
}

export interface FrameOfReferenceMetaDataItem {
  kind: string;
  name?: string;
  persistableReference: string;
  propertyNames?: string[];
  unitOfMeasureID?: string;
  coordinateReferenceSystemID?: string;
}
