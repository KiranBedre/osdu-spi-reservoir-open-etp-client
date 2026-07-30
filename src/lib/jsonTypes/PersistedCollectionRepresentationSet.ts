import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpContentType, ResqmlClient } from "../client/ResqmlClient";

import { ResqmlWorkProductComponent } from "./WorkProductComponent";
import { OSDUContext, ResqmlOSDUMap } from "./OsduContext";

import {
  Data,
  PersistedCollection
} from "./Generated/work-product-component/PersistedCollection.1.2.0";

export class PersistedCollectionRepresentationSetOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_RepresentationSetRepresentation>
  >
  implements PersistedCollection
{
  public data: Data;

  constructor(
    xml: SimpleJson<resqml20.obj_RepresentationSetRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "PersistedCollection.1.2.0");
    this.data = {};
  }
  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_RepresentationSetRepresentation>,
    client: ResqmlClient
  ): Promise<PersistedCollectionRepresentationSetOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    const rTypes = xml.Representation.map(
      p => new EtpContentType(p.ContentType).etpType
    );
    const homogeneous =
      rTypes.length > 0 && rTypes.every((val, _, arr) => val === arr[0]);

    const oType = homogeneous
      ? ResqmlOSDUMap.getInstance().get(rTypes[0])
      : undefined;

    const MemberIDs: string[] | undefined =
      xml.Representation.length === 0 ? undefined : [];
    for (const r of xml.Representation) {
      MemberIDs?.push(
        (await PersistedCollectionRepresentationSetOSDU.dorToSrn(
          ReservoirDMSUrl,
          r,
          client,
          context
        )) ?? ""
      );
    }

    // Extract Purpose from ExtraMetadata if present (osdu/PurposeID convention)
    let purposeId: string | undefined;
    if (xml.ExtraMetadata) {
      const purposeMeta = xml.ExtraMetadata.find(
        (m: any) => m.Name === "osdu/PurposeID" || m.Name === "osdu/Purpose"
      );
      if (purposeMeta?.Value) {
        purposeId = context.addReferenceData(
          "PersistedCollectionPurpose",
          purposeMeta.Value
        );
      }
    }

    // Extract ParentCollectionID from ExtraMetadata if present
    let parentCollectionId: string | undefined;
    if (xml.ExtraMetadata) {
      const parentMeta = xml.ExtraMetadata.find(
        (m: any) => m.Name === "osdu/ParentCollectionID"
      );
      if (parentMeta?.Value) {
        parentCollectionId = parentMeta.Value;
      }
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      HomogeneousMemberKind: oType?.osduKind(xml),
      MemberIDs,
      ParentCollectionID: parentCollectionId,
      PurposeID: purposeId,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

export const PersistedCollectionRepresentationSetManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_RepresentationSetRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<PersistedCollectionRepresentationSetOSDU> =>
  new PersistedCollectionRepresentationSetOSDU(xml, context).initData(
    uri,
    xml,
    client
  );
