import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  SealedSurfaceFramework
} from "./Generated/work-product-component/SealedSurfaceFramework.1.2.0";

export class SealedSurfaceFramework22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.SealedSurfaceFrameworkRepresentation>
  >
  implements SealedSurfaceFramework
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml22.SealedSurfaceFrameworkRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "SealedSurfaceFramework.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.SealedSurfaceFrameworkRepresentation>,
    client: ResqmlClient
  ): Promise<SealedSurfaceFramework22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const repIds: string[] = [];
    if (xml.Representation) {
      for (const dor of xml.Representation) {
        const srn = await SealedSurfaceFramework22OSDU.dorToSrn(
          ReservoirDMSUrl, dor, client, context
        );
        if (srn) repIds.push(srn + ":");
      }
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      InterpretationID: await SealedSurfaceFramework22OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedObject,
        client,
        context
      ),
      InterpretationName: xml.RepresentedObject?.Title,
      IsHomogeneous: xml.IsHomogeneous,
      RepresentationIDs: repIds.length > 0 ? repIds : undefined,
      SealedContactCount: xml.Contacts?.length,
      ContactIdentityCount: xml.ContactIdentity?.length,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const SealedSurfaceFramework22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.SealedSurfaceFrameworkRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<SealedSurfaceFramework22OSDU> =>
  new SealedSurfaceFramework22OSDU(xml, context).initData(uri, xml, client);
