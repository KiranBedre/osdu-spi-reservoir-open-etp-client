import { Energistics, EtpUri } from "../client/ResqmlClient";

import type { OSDUContext } from "./OsduContext";

import {
  AccessControlList,
  Data,
  LegalMetaData,
  ParentList,
  WorkProduct
} from "./Generated/work-product/WorkProduct.1.0.0";

class WorkProductOSDU implements WorkProduct {
  public acl: AccessControlList = { owners: [], viewers: [] };
  public kind = "osdu:wks:work-product--WorkProduct:1.0.0";
  public legal: LegalMetaData = {
    legaltags: [],
    otherRelevantDataCountries: []
  };
  public ancestry?: ParentList;
  public createTime: Date;
  public id: string;
  public modifyTime: Date;
  public version: number;
  public tags?: { [key: string]: string };
  public meta?: undefined; //FrameOfReferenceMetaDataItem[];
  public data: Data;

  constructor(
    dataspace: Energistics.Etp.v12.Datatypes.Object.Dataspace,
    context: OSDUContext
  ) {
    this.ancestry = undefined;
    this.createTime = new Date(Number(dataspace.storeCreated / BigInt(1000)));
    this.modifyTime = dataspace.storeLastWrite
      ? new Date(Number(dataspace.storeLastWrite / BigInt(1000)))
      : this.createTime;
    const etpUri = new EtpUri(dataspace.uri);
    this.id = `${
      context.partition
    }:work-product--WorkProduct:${context.datasetId(etpUri)}`;
    this.version = 1;

    this.data = {
      ExistenceKind: context.addReferenceData("ExistenceKind", "Prototype"),
      ResourceCurationStatus: undefined,
      ResourceHomeRegionID: undefined,
      ResourceHostRegionIDs: undefined,
      ResourceLifecycleStatus: undefined,
      ResourceSecurityClassification: undefined,
      Source: undefined,
      TechnicalAssuranceID: undefined,
      Annotations: undefined,
      AuthorIDs: undefined,
      BusinessActivities: undefined,
      Components: [],
      CreationDateTime: this.createTime,
      Description: "Build from Reservoir DMS",
      IsDiscoverable: true,
      IsExtendedLoad: false,
      LineageAssertions: undefined,
      Name: dataspace.path,
      SpatialArea: undefined,
      SpatialPoint: undefined,
      SubmitterName: context.submitter,
      Tags: undefined,
      ExtensionProperties: {
        ETPDataspace: dataspace.uri
      }
    };

    this.tags = context.tags;

    // dataspaceACLs is keyed by the full dataspace URI
    // (eml:///dataspace('...')), as populated in createManifest, not the bare
    // dataspace path. Looking up by etpUri.dataSpace silently missed, leaving
    // the WorkProduct with empty acl/legal — which fails the atomic Storage
    // batch and forces a per-record retry storm during autoIngest=records.
    const dataspaceUri = EtpUri.createDataSpaceUri(etpUri.dataSpace).uri;
    const dataspaceLegalACL =
      context.dataspaceACLs.get(dataspaceUri) ??
      context.dataspaceACLs.get(etpUri.dataSpace);
    if (dataspaceLegalACL !== undefined) {
      this.acl = dataspaceLegalACL.acl;
      this.legal = dataspaceLegalACL.legal;
    }
  }
}

export const WorkProductManifest = (
  dataspace: Energistics.Etp.v12.Datatypes.Object.Dataspace,
  context: OSDUContext
): WorkProduct => new WorkProductOSDU(dataspace, context);
