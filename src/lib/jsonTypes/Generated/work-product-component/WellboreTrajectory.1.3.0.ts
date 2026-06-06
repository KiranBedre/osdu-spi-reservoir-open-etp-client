/**
 * OSDU WellboreTrajectory work-product-component schema type definition.
 * Based on osdu:wks:work-product-component--WellboreTrajectory:1.3.0
 * Inherits: AbstractCommonResources:1.0.0, AbstractWPCGroupType:1.2.0, AbstractWorkProductComponent:1.1.0
 */
export interface WellboreTrajectory {
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
 * Properties for the WellboreTrajectory WPC record (osdu:wks:work-product-component--WellboreTrajectory:1.3.0).
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
    BusinessActivities?: any[];
    CreationDateTime?: Date;
    Description?: string;
    GeoContexts?: any[];
    LineageAssertions?: any[];
    Name?: string;
    SpatialArea?: any;
    SpatialPoint?: any;
    SubmitterName?: string;
    Tags?: any[];

    /** Reference to the parent wellbore (osdu:wks:master-data--Wellbore). */
    WellboreID?: string;
    /** The North reference of the trajectory (reference-data--AzimuthReferenceType). */
    AzimuthReferenceType?: string;
    /** The service company that acquired the trajectory (master-data--Organisation). */
    ServiceCompanyID?: string;
    /** Measured depth where the directional survey starts. */
    TopDepthMeasuredDepth?: number;
    /** Measured depth of the LAST surveyed station with recorded data. */
    BaseDepthMeasuredDepth?: number;
    /** Calculation method used to compute TVD, offsets (reference-data--CalculationMethodType). */
    CalculationMethodType?: string;
    /** Projected CRS for station coordinates (reference-data--CoordinateReferenceSystem). */
    ProjectedCRSID?: string;
    /** Flag indicating if the survey is currently active. */
    ActiveIndicator?: boolean;
    /** Type of this directional survey (e.g., "Directional Survey", "Position Log"). */
    SurveyType?: string;
    /** Date that the survey data was acquired. */
    AcquisitionDate?: string;
    /** Geographic CRS for station lat/lon (reference-data--CoordinateReferenceSystem). */
    GeographicCRSID?: string;
    /** Remarks related to acquisition context. */
    AcquisitionRemark?: string;
    /** Unique survey reference number/identifier. */
    SurveyReferenceIdentifier?: string;
    /** Type of survey tool (reference-data--SurveyToolType). */
    SurveyToolTypeID?: string;
    /** Version of the wellbore survey deliverable. */
    SurveyVersion?: string;
    /** Measured depth to which the survey was extrapolated. */
    ExtrapolatedMeasuredDepth?: number;
    /** Tie-point measured depth. */
    TieMeasuredDepth?: number;
    /** True Vertical Depth of the TieMeasuredDepth. */
    TieTrueVerticalDepth?: number;
    /** Vertical datum reference for all station measured depths. */
    VerticalMeasurement?: any;
    /** Available properties for trajectory stations. */
    AvailableTrajectoryStationProperties?: any[];

    ExtensionProperties?: { [key: string]: any };
}
