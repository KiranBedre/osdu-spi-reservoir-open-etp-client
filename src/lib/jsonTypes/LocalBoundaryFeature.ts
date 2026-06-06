import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  LocalBoundaryFeature
} from "./Generated/work-product-component/LocalBoundaryFeature.1.2.0";

import { MasterDataBoundaryFeatureManifest } from "./MasterDataBoundaryFeature";

export class LocalBoundaryFeatureOSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml20.obj_BoundaryFeature>>
  implements LocalBoundaryFeature
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_BoundaryFeature>,
    context: OSDUContext
  ) {
    super(xml, context, "LocalBoundaryFeature.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_BoundaryFeature>
  ): Promise<LocalBoundaryFeatureOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      /**
       * When populated, the boundary feature has a wider scope and allows boundary feature
       * correlations across models.
       */
      BoundaryFeatureID: undefined,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

export const LocalBoundaryFeatureManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_BoundaryFeature>,
  context: OSDUContext,
  _client: ResqmlClient
): Promise<LocalBoundaryFeatureOSDU> => {
  // S3: Also produce master-data--BoundaryFeature if it doesn't already exist
  const masterData = await MasterDataBoundaryFeatureManifest(uri, xml, context, _client);
  if (masterData !== undefined && masterData.id) {
    context.created.set(masterData.id, masterData);
  }

  return new LocalBoundaryFeatureOSDU(xml, context).initData(uri, xml);
};
