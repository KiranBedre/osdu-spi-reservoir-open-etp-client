/**
 * OSDU Wellbore master-data schema type definition.
 * Based on osdu:wks:master-data--Wellbore:1.3.0
 * Inherits: AbstractCommonResources:1.0.0, AbstractMaster:1.1.0, AbstractFacility:1.1.0
 */
export interface Wellbore {
    acl: AccessControlList;
    ancestry?: ParentList;
    createTime?: Date;
    createUser?: string;
    data?: Data;
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
 * Properties for the Wellbore master-data record (osdu:wks:master-data--Wellbore:1.3.0).
 *
 * Composed from:
 * - AbstractCommonResources:1.0.0
 * - AbstractMaster:1.1.0 (GeoContexts, NameAliases, SpatialLocation, TechnicalAssurances, DDMSDatasets)
 * - AbstractFacility:1.1.0 (FacilityName, FacilityID, FacilityNameAliases, etc.)
 * - IndividualProperties (WellID, SequenceNumber, VerticalMeasurements, etc.)
 */
export interface Data {
    // --- AbstractCommonResources:1.0.0 ---
    ExistenceKind?: string;
    ResourceCurationStatus?: string;
    ResourceHomeRegionID?: string;
    ResourceHostRegionIDs?: string[];
    ResourceLifecycleStatus?: string;
    ResourceSecurityClassification?: string;
    Source?: string;
    TechnicalAssuranceID?: string;

    // --- AbstractMaster:1.1.0 ---
    GeoContexts?: any[];
    NameAliases?: any[];
    SpatialLocation?: any;
    TechnicalAssurances?: any[];
    DDMSDatasets?: string[];

    // --- AbstractFacility:1.1.0 ---
    FacilityID?: string;
    FacilityTypeID?: string;
    FacilityOperators?: any[];
    InitialOperatorID?: string;
    CurrentOperatorID?: string;
    DataSourceOrganisationID?: string;
    OperatingEnvironmentID?: string;
    FacilityName?: string;
    FacilityDescription?: string;
    FacilityNameAliases?: any[];
    FacilityStates?: any[];
    FacilityEvents?: any[];
    FacilitySpecifications?: any[];

    // --- IndividualProperties ---
    WellID?: string;
    SequenceNumber?: number;
    VerticalMeasurements?: any[];
    DrillingReasons?: any[];
    WellboreReasonID?: string;
    KickOffWellbore?: string;
    TrajectoryTypeID?: string;
    DefinitiveTrajectoryID?: string;
    TargetFormation?: string;
    FormationNameAtTotalDepth?: string;
    PrimaryMaterialID?: string;
    DefaultVerticalMeasurementID?: string;
    ProjectedBottomHoleLocation?: any;
    GeographicBottomHoleLocation?: any;
    BusinessIntentionID?: string;
    RoleID?: string;
    InterestTypeID?: string;
    ConditionID?: string;
    FluidDirectionID?: string;
    OutcomeID?: string;
    StatusSummaryID?: string;
    PrimaryProductTypeID?: string;

    ExtensionProperties?: { [key: string]: any };
}
