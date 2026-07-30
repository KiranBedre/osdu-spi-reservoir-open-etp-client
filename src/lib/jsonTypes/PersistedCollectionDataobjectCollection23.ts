import * as eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { ResqmlClient } from "../client/ResqmlClient";

import { ResqmlWorkProductComponent } from "./WorkProductComponent";
import { OSDUContext, ResqmlOSDUMap } from "./OsduContext";

import {
  Data,
  PersistedCollection
} from "./Generated/work-product-component/PersistedCollection.1.2.0";

export class PersistedCollectionDataobjectCollection23OSDU
  extends ResqmlWorkProductComponent<SimpleJson<eml23.DataobjectCollection>>
  implements PersistedCollection
{
  public data: Data;

  constructor(
    xml: SimpleJson<eml23.DataobjectCollection>,
    context: OSDUContext
  ) {
    super(xml, context, "PersistedCollection.1.2.0");
    this.data = {};
  }
  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<eml23.DataobjectCollection>,
    client: ResqmlClient
  ): Promise<PersistedCollectionDataobjectCollection23OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    const assoc = await client.getSources(xml.Uuid, false, [
      "eml23.CollectionsToDataobjectsAssociationSet"
    ]);
    const MemberIDs: string[] = [];
    let oType: string | undefined = "";
    for (const a of assoc) {
      const associationUri = a.uri;
      if (a.uri) {
        const obj = await client.getObjects([associationUri]);
        if (obj.length !== 1) {
          continue;
        }
        const target =
          obj[0] as SimpleJson<eml23.CollectionsToDataobjectsAssociationSet>;
        if (target) {
          for (const col of target.SingleCollectionAssociation) {
            if (!col.HomogeneousDatatype) {
              oType = undefined;
            }
            if (oType !== undefined) {
              if (oType === "" && col.Dataobject.length > 0) {
                oType = col.Dataobject[0].QualifiedType;
              } else {
                if (col.Dataobject[0].QualifiedType !== oType) {
                  oType = undefined;
                }
              }
            }
            for (const o of col.Dataobject) {
              MemberIDs?.push(
                (await PersistedCollectionDataobjectCollection23OSDU.dorToSrn(
                  ReservoirDMSUrl,
                  o,
                  client,
                  context
                )) || ""
              );
            }
          }
        }
      }
    }

    let HomogeneousMemberKind: string | undefined = undefined;
    if (oType !== undefined && oType !== "") {
      // TODO Get the OSDU type from the ETP type

      const orType = ResqmlOSDUMap.getInstance().get(oType);
      HomogeneousMemberKind = orType?.osduKind(xml);
    }

    // Map EML 2.3 DataobjectCollection.Kind → OSDU PurposeID
    const purposeId = xml.Kind
      ? context.addReferenceData("PersistedCollectionPurpose", xml.Kind)
      : undefined;

    // Extract ParentCollectionID from ExtensionNameValue if present
    let parentCollectionId: string | undefined;
    if (xml.ExtensionNameValue) {
      const parentMeta = xml.ExtensionNameValue.find(
        (m: any) => m.Name === "osdu/ParentCollectionID"
      );
      if (parentMeta?.Value?._ || parentMeta?.Value) {
        parentCollectionId =
          typeof parentMeta.Value === "string"
            ? parentMeta.Value
            : parentMeta.Value._;
      }
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      HomogeneousMemberKind,
      MemberIDs,
      ParentCollectionID: parentCollectionId,
      PurposeID: purposeId,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const PersistedCollectionDataobjectCollection23Manifest = async (
  uri: string,
  xml: SimpleJson<eml23.DataobjectCollection>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<PersistedCollectionDataobjectCollection23OSDU> =>
  new PersistedCollectionDataobjectCollection23OSDU(xml, context).initData(
    uri,
    xml,
    client
  );
