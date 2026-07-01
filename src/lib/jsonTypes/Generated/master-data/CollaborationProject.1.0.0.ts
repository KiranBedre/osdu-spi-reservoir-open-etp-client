/**
 * Generated interface for osdu:wks:master-data--CollaborationProject:1.0.0
 *
 * The context for a collaboration project, a multi-user collaboration space,
 * also known as "system of engagement" with references to data in the "system of record".
 */
export interface CollaborationProject {
  acl: AccessControlList;
  ancestry?: ParentList;
  createTime?: Date | string;
  createUser?: string;
  data?: Data;
  id?: string;
  kind: string;
  legal: LegalMetaData;
  meta?: FrameOfReferenceMetaDataItem[];
  modifyTime?: Date | string;
  modifyUser?: string;
  tags?: { [key: string]: string };
  version?: number;
}

export interface Data {
  // AbstractCommonResources
  ExistenceKind?: string;
  ResourceCurationStatus?: string;
  ResourceHomeRegionID?: string;
  ResourceHostRegionIDs?: string[];
  ResourceLifecycleStatus?: string;
  ResourceSecurityClassification?: string;
  Source?: string;
  TechnicalAssuranceID?: string;
  // AbstractMaster
  Name?: string;
  // AbstractProject
  ProjectName?: string;
  ProjectDescription?: string;
  // AbstractProjectActivity
  ActivityStartDateTime?: string;
  ActivityEndDateTime?: string;
  // CollaborationProject-specific
  ProjectContributorACL?: AccessControlList;
  DefaultWIPACL?: AccessControlList;
  LifecycleStatusID?: string;
  Namespace?: string;
  CreationDateTime?: string;
  EndDateTime?: string;
  Description?: string;
  TrustedCollectionID?: string;
  LifecycleEvents?: LifecycleEvent[];
  ExtensionProperties?: { [key: string]: any };
}

export interface LifecycleEvent {
  EventType?: string;
  EventDateTime?: string;
  EventDescription?: string;
}

export interface AccessControlList {
  owners: string[];
  viewers: string[];
}

export interface LegalMetaData {
  legaltags: string[];
  otherRelevantDataCountries: string[];
  status?: string;
}

export interface ParentList {
  parents?: string[];
}

export interface FrameOfReferenceMetaDataItem {
  kind?: string;
  name?: string;
  persistableReference?: string;
  propertyType?: string;
  source?: string;
  unitOfMeasure?: string;
}
