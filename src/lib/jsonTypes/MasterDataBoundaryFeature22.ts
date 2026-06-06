/**
 * S3: Auto-create master-data--BoundaryFeature from RESQML 2.2 BoundaryFeature
 */
import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlResource } from "./WorkProductComponent";

import {
  MasterDataBoundaryFeatureData,
  MasterDataBoundaryFeature
} from "./Generated/master-data/BoundaryFeature.1.2.0";

/**
 * Maps RESQML 2.2 BoundaryFeature to OSDU master-data--BoundaryFeature:1.2.0.
 */
export class MasterDataBoundaryFeature22OSDU
  extends ResqmlResource<SimpleJson<resqml22.BoundaryFeature>>
  implements MasterDataBoundaryFeature
{
  public data: MasterDataBoundaryFeatureData = {};

  constructor(xml: SimpleJson<resqml22.BoundaryFeature>, context: OSDUContext) {
    super(xml, context, "master-data", "BoundaryFeature.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.BoundaryFeature>
  ): Promise<MasterDataBoundaryFeature22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),

      GeoContexts: undefined,
      NameAliases: undefined,
      SpatialLocation: undefined,
      TechnicalAssurances: context.technicalAssurances,
      DDMSDatasets: [
        ReservoirDMSUrl.replace("eml:///", `eml://${context.rddmsId}/`)
      ],

      FeatureName: xml.Citation?.Title,
      BoundaryFeatureTypeID: undefined,
      Description: xml.Citation?.Description,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

/**
 * Manifest factory that checks OSDU Storage for existing master-data record
 * before creating a new one.
 */
export const MasterDataBoundaryFeature22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.BoundaryFeature>,
  context: OSDUContext,
  _client: ResqmlClient
): Promise<MasterDataBoundaryFeature22OSDU | undefined> => {
  const instance = new MasterDataBoundaryFeature22OSDU(xml, context);
  await instance.initData(uri, xml);

  // S3 safety: Check if this master-data record already exists in OSDU Storage
  if (instance.id && context.bearer) {
    const existingVersion = await context.getOSDUResourceVersion(instance.id);
    if (existingVersion) {
      return undefined;
    }
  }

  return instance;
};
