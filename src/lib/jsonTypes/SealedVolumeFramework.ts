import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  SealedVolumeFramework
} from "./Generated/work-product-component/SealedVolumeFramework.1.2.0";

export class SealedVolumeFrameworkOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_SealedVolumeFrameworkRepresentation>
  >
  implements SealedVolumeFramework
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_SealedVolumeFrameworkRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "SealedVolumeFramework.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_SealedVolumeFrameworkRepresentation>,
    client: ResqmlClient
  ): Promise<SealedVolumeFrameworkOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const repIds: string[] = [];
    if (xml.Representation) {
      for (const dor of xml.Representation) {
        const srn = await SealedVolumeFrameworkOSDU.dorToSrn(
          ReservoirDMSUrl, dor, client, context
        );
        if (srn) repIds.push(srn + ":");
      }
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      BasedOnID: await SealedVolumeFrameworkOSDU.dorToSrn(
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

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

export const SealedVolumeFrameworkManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_SealedVolumeFrameworkRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<SealedVolumeFrameworkOSDU> =>
  new SealedVolumeFrameworkOSDU(xml, context).initData(uri, xml, client);
