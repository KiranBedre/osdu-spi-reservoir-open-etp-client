// StructureMap.1.0.0
// OSDU M27 schema — A structure map (representation) is a support for properties
// based on a GenericBinGrid. Consequently, its type is always a Regular2DGrid.
// It is often associated to some Z values either in depth or time domain.
// Source kind: osdu:wks:work-product-component--StructureMap:1.0.0
// First deployed with milestone M27.0, tag v0.30.0

import {
  AbstractSpatialLocation,
  AccessControlList,
  LegalMetaData,
  ParentList
} from "./GenericRepresentation.1.1.0";

import { FrameOfReferenceMetaDataItem } from "../manifest/Manifest.1.0.0";

export interface StructureMap {
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
  version?: number;
}

export interface Data {
  // ─── AbstractCommonResources ──────────────────────────────────────────
  ExistenceKind?: string;
  ResourceCurationStatus?: string;
  ResourceHomeRegionID?: string;
  ResourceHostRegionIDs?: string[];
  ResourceLifecycleStatus?: string;
  ResourceSecurityClassification?: string;
  Source?: string;
  TechnicalAssuranceID?: string;

  // ─── AbstractWPCGroupType ─────────────────────────────────────────────
  Artefacts?: any[];
  Datasets?: string[];
  DDMSDatasets?: string[];
  IsDiscoverable?: boolean;
  IsExtendedLoad?: boolean;
  TechnicalAssurances?: any[];

  // ─── AbstractWorkProductComponent ─────────────────────────────────────
  NameAliases?: any[];
  AuthorIDs?: string[];
  BusinessActivities?: string[];
  CreationDateTime?: Date;
  Description?: string;
  GeoContexts?: any[];
  LineageAssertions?: any[];
  Name?: string;
  SpatialArea?: AbstractSpatialLocation;
  SpatialPoint?: AbstractSpatialLocation;
  SubmitterName?: string;
  Tags?: string[];

  // ─── StructureMap domain-specific fields ──────────────────────────────

  /**
   * Spatial location of the ABCD bin grid.
   */
  ABCDBinGridSpatialLocation?: AbstractSpatialLocation;
  /**
   * Reference to the GenericBinGrid or SeismicBinGrid that defines the survey geometry.
   */
  BinGridID?: string;
  /**
   * Name of the associated bin grid.
   */
  BinGridName?: string;
  /**
   * Bin width along the I axis (in CRS units, typically meters).
   */
  BinWidthOnIaxis?: number;
  /**
   * Bin width along the J axis (in CRS units, typically meters).
   */
  BinWidthOnJaxis?: number;
  /**
   * Describes the domain of the map — depth, time, or mixed.
   */
  DomainTypeID?: string;
  /**
   * Extension properties for additional metadata.
   */
  ExtensionProperties?: Record<string, any>;
  /**
   * Indexable element counts.
   */
  IndexableElementCount?: IndexableElementCount[];
  /**
   * Reference to the interpretation this structure map represents.
   * Can be HorizonInterpretation, FaultInterpretation, EarthModelInterpretation, etc.
   */
  InterpretationID?: string;
  /**
   * Name of the interpretation.
   */
  InterpretationName?: string;
  /**
   * Reference to the local CRS for this representation.
   */
  LocalModelCompoundCrsID?: string;
  /**
   * Grid bearing of the J-axis of the bin grid (degrees from north).
   */
  MapGridBearingOfBinGridJaxis?: number;
  /**
   * Number of nodes along the I (fastest) axis of the regular grid.
   */
  NodeCountOnIAxis?: number;
  /**
   * Number of nodes along the J (slowest) axis of the regular grid.
   */
  NodeCountOnJAxis?: number;
  /**
   * Easting coordinate of the grid origin (in CRS units).
   */
  OriginEasting?: number;
  /**
   * Northing coordinate of the grid origin (in CRS units).
   */
  OriginNorthing?: number;
  /**
   * The index of the realization of this representation.
   */
  RealizationIndex?: number;
  /**
   * Scale factor of the bin grid.
   */
  ScaleFactor?: number;
  /**
   * Optional reference to an associated SeismicHorizon (time-domain equivalent).
   */
  SeismicHorizonID?: string;
  /**
   * Time series information for time-lapse maps.
   */
  TimeSeries?: TimeSeries;
  /**
   * Transformation method description.
   */
  TransformationMethod?: string;
}

export interface IndexableElementCount {
  Count?: number;
  IndexableElementID?: string;
}

export interface TimeSeries {
  TimeIndex?: number;
  TimeSeriesID?: string;
}
