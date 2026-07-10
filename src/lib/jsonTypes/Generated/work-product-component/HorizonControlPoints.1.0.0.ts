// HorizonControlPoints.1.0.0
// OSDU M27 schema — Horizon control points representation.
// A set of scattered points (PointSetRepresentation) associated with a HorizonInterpretation.
// Used when the horizon surface is defined by control points rather than a regular grid.
// Source kind: osdu:wks:work-product-component--HorizonControlPoints:1.0.0

import {
    AbstractSpatialLocation,
    AccessControlList,
    LegalMetaData,
    ParentList
} from "./GenericRepresentation.1.1.0";

import { FrameOfReferenceMetaDataItem } from "../manifest/Manifest.1.0.0";

export interface HorizonControlPoints {
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

    // ─── HorizonControlPoints domain-specific fields ──────────────────────

    /** Domain type — depth, time, or mixed. */
    DomainTypeID?: string;
    /** Extension properties for additional metadata. */
    ExtensionProperties?: Record<string, any>;
    /** Indexable element counts. */
    IndexableElementCount?: IndexableElementCount[];
    /** Reference to the horizon interpretation. */
    InterpretationID?: string;
    /** Name of the horizon interpretation. */
    InterpretationName?: string;
    /** Reference to the local CRS. */
    LocalModelCompoundCrsID?: string;
    /** Number of control points. */
    PointCount?: number;
    /** Realization index. */
    RealizationIndex?: number;
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
