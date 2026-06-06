import { v5 as uuidNameSpace } from "uuid";

import { Energistics, EtpUri } from "../client/ResqmlClient";

import { OSDUContext } from "./OsduContext";
import { getKind } from "./MilestoneKinds";

import {
  CollaborationProject,
  Data
} from "./Generated/master-data/CollaborationProject.1.0.0";

/**
 * S5: CollaborationProject — maps an ETP dataspace to an OSDU
 * master-data--CollaborationProject record.
 *
 * The dataspace IS the collaboration namespace: temporary/WIP objects live
 * there until "published" to the system of record.
 */

const RDDMS_COLLABORATION_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

class CollaborationProjectOSDU implements CollaborationProject {
  public acl = { owners: [] as string[], viewers: [] as string[] };
  public kind: string;
  public legal = {
    legaltags: [] as string[],
    otherRelevantDataCountries: [] as string[]
  };
  public ancestry?: undefined;
  public createTime: string;
  public modifyTime: string;
  public id: string;
  public version = 1;
  public tags?: { [key: string]: string };
  public data: Data;

  constructor(
    dataspace: Energistics.Etp.v12.Datatypes.Object.Dataspace,
    context: OSDUContext,
    collaborationId: string,
    isLocked?: boolean
  ) {
    this.kind =
      getKind("CollaborationProject") ??
      "osdu:wks:master-data--CollaborationProject:1.0.0";

    this.createTime = new Date(
      Number(dataspace.storeCreated / BigInt(1000))
    ).toISOString();
    this.modifyTime = dataspace.storeLastWrite
      ? new Date(Number(dataspace.storeLastWrite / BigInt(1000))).toISOString()
      : this.createTime;

    this.id = `${context.partition}:master-data--CollaborationProject:${collaborationId}`;

    const etpUri = new EtpUri(dataspace.uri);
    const lifecycleStatus = isLocked ? "Closed" : "Open";

    this.data = {
      ExistenceKind: context.addReferenceData("ExistenceKind", "Actual"),
      Name: dataspace.path ?? etpUri.dataSpace,
      ProjectName: dataspace.path ?? etpUri.dataSpace,
      Description: `Collaboration project for ETP dataspace '${etpUri.dataSpace}'`,
      Namespace: etpUri.dataSpace,
      LifecycleStatusID: `${context.partition}:reference-data--CollaborationProjectLifecycleStatus:${lifecycleStatus}:`,
      CreationDateTime: this.createTime,
      DefaultWIPACL: undefined,
      ProjectContributorACL: undefined,
      ExtensionProperties: {
        DataspaceURI: dataspace.uri
      }
    };

    // Apply dataspace ACL
    const aclLegal = context.dataspaceACLs.get(dataspace.uri);
    if (aclLegal) {
      this.acl = aclLegal.acl;
      this.legal = aclLegal.legal;
      // WIP resources inherit the dataspace ACL by default
      this.data.DefaultWIPACL = aclLegal.acl;
      this.data.ProjectContributorACL = aclLegal.acl;
    }

    this.tags = context.tags;
  }
}

/**
 * Create a CollaborationProject manifest record from an ETP dataspace.
 *
 * @param dataspace — The ETP dataspace object
 * @param context — OSDU context (partition, ACLs, etc.)
 * @param collaborationId — The deterministic UUID for this collaboration
 * @param isLocked — Whether the dataspace is currently locked
 */
export const CollaborationProjectManifest = (
  dataspace: Energistics.Etp.v12.Datatypes.Object.Dataspace,
  context: OSDUContext,
  collaborationId: string,
  isLocked?: boolean
): CollaborationProject =>
  new CollaborationProjectOSDU(dataspace, context, collaborationId, isLocked);

/**
 * Derive a deterministic collaboration UUID from a dataspace name.
 * Re-uses the same namespace as the S4 auto-collaboration in Manifest.ts.
 */
export const deriveCollaborationId = (dataspaceName: string): string =>
  uuidNameSpace(dataspaceName, RDDMS_COLLABORATION_NAMESPACE);
