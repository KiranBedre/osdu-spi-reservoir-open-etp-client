import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  SealedVolumeFramework
} from "./Generated/work-product-component/SealedVolumeFramework.1.2.0";

export class SealedVolumeFramework22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.SealedVolumeFrameworkRepresentation>
  >
  implements SealedVolumeFramework
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml22.SealedVolumeFrameworkRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "SealedVolumeFramework.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.SealedVolumeFrameworkRepresentation>,
    client: ResqmlClient
  ): Promise<SealedVolumeFramework22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const repIds: string[] = [];
    if (xml.Representation) {
      for (const dor of xml.Representation) {
        const srn = await SealedVolumeFramework22OSDU.dorToSrn(
          ReservoirDMSUrl, dor, client, context
        );
        if (srn) repIds.push(srn + ":");
      }
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      BasedOnID: await SealedVolumeFramework22OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.BasedOn,
        client,
        context
      ),
      IsHomogeneous: xml.IsHomogeneous,
      RepresentationIDs: repIds.length > 0 ? repIds : undefined,
      RegionCount: xml.Regions?.length,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const SealedVolumeFramework22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.SealedVolumeFrameworkRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<SealedVolumeFramework22OSDU> =>
  new SealedVolumeFramework22OSDU(xml, context).initData(uri, xml, client);
