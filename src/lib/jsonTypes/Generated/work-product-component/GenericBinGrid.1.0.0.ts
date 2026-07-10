// GenericBinGrid.1.0.0
// OSDU M27 schema — A generic 2D regular bin grid definition.
// Used for Grid2dRepresentation objects that have no associated interpretation
// (e.g. isochore maps, DEM surfaces, generic depth/time grids).
// Source kind: osdu:wks:work-product-component--GenericBinGrid:1.0.0

import {
    AbstractSpatialLocation,
    AccessControlList,
    LegalMetaData,
    ParentList
} from "./GenericRepresentation.1.1.0";

import { FrameOfReferenceMetaDataItem } from "../manifest/Manifest.1.0.0";

export interface GenericBinGrid {
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

    // ─── GenericBinGrid domain-specific fields ────────────────────────────

    /** Spatial location of the bin grid (ABCD polygon). */
    ABCDBinGridSpatialLocation?: AbstractSpatialLocation;
    /** Bin width along the I (fastest) axis in CRS units. */
    BinWidthOnIaxis?: number;
    /** Bin width along the J (slowest) axis in CRS units. */
    BinWidthOnJaxis?: number;
    /** Domain type — depth, time, or mixed. */
    DomainTypeID?: string;
    /** Extension properties for additional metadata. */
    ExtensionProperties?: Record<string, any>;
    /** Indexable element counts. */
    IndexableElementCount?: IndexableElementCount[];
    /** Reference to the local CRS. */
    LocalModelCompoundCrsID?: string;
    /** Grid bearing of the J-axis (degrees from north). */
    MapGridBearingOfBinGridJaxis?: number;
    /** Number of nodes along the I (fastest) axis. */
    NodeCountOnIAxis?: number;
    /** Number of nodes along the J (slowest) axis. */
    NodeCountOnJAxis?: number;
    /** Easting coordinate of the grid origin (in CRS units). */
    OriginEasting?: number;
    /** Northing coordinate of the grid origin (in CRS units). */
    OriginNorthing?: number;
    /** Realization index. */
    RealizationIndex?: number;
    /** Scale factor. */
    ScaleFactor?: number;
    /** Time series information. */
    TimeSeries?: TimeSeries;
}

export interface IndexableElementCount {
    Count?: number;
    IndexableElementID?: string;
}

export interface TimeSeries {
    TimeIndex?: number;
    TimeSeriesID?: string;
}
