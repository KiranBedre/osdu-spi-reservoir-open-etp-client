import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  SealedSurfaceFramework
} from "./Generated/work-product-component/SealedSurfaceFramework.1.2.0";

export class SealedSurfaceFrameworkOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_SealedSurfaceFrameworkRepresentation>
  >
  implements SealedSurfaceFramework
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_SealedSurfaceFrameworkRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "SealedSurfaceFramework.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_SealedSurfaceFrameworkRepresentation>,
    client: ResqmlClient
  ): Promise<SealedSurfaceFrameworkOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const repIds: string[] = [];
    if (xml.Representation) {
      for (const dor of xml.Representation) {
        const srn = await SealedSurfaceFrameworkOSDU.dorToSrn(
          ReservoirDMSUrl, dor, client, context
        );
        if (srn) repIds.push(srn + ":");
      }
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      InterpretationID: await SealedSurfaceFrameworkOSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedInterpretation,
        client,
        context
      ),
      InterpretationName: xml.RepresentedInterpretation?.Title,
      IsHomogeneous: xml.IsHomogeneous,
      RepresentationIDs: repIds.length > 0 ? repIds : undefined,
      SealedContactCount: xml.SealedContactRepresentation?.length,
      ContactIdentityCount: xml.ContactIdentity?.length,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

export const SealedSurfaceFrameworkManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_SealedSurfaceFrameworkRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<SealedSurfaceFrameworkOSDU> =>
  new SealedSurfaceFrameworkOSDU(xml, context).initData(uri, xml, client);
