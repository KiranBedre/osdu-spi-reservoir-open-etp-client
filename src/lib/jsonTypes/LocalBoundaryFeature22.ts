import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  LocalBoundaryFeature
} from "./Generated/work-product-component/LocalBoundaryFeature.1.2.0";

import { MasterDataBoundaryFeature22Manifest } from "./MasterDataBoundaryFeature22";

export class LocalBoundaryFeature22OSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml22.BoundaryFeature>>
  implements LocalBoundaryFeature
{
  public data: Data = {};

  constructor(xml: SimpleJson<resqml22.BoundaryFeature>, context: OSDUContext) {
    super(xml, context, "LocalBoundaryFeature.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.BoundaryFeature>
  ): Promise<LocalBoundaryFeature22OSDU> {
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

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const LocalBoundaryFeature22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.BoundaryFeature>,
  context: OSDUContext,
  _client: ResqmlClient
): Promise<LocalBoundaryFeature22OSDU> => {
  // S3: Also produce master-data--BoundaryFeature if it doesn't already exist
  const masterData = await MasterDataBoundaryFeature22Manifest(uri, xml, context, _client);
  if (masterData !== undefined && masterData.id) {
    context.created.set(masterData.id, masterData);
  }

  return new LocalBoundaryFeature22OSDU(xml, context).initData(uri, xml);
};
