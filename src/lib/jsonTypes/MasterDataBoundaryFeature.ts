/**
 * S3: Auto-create master-data--BoundaryFeature from RESQML 2.0 BoundaryFeature
 *
 * Creates master-data records that enable cross-model feature correlation.
 * The converter checks if a master-data record already exists for this UUID
 * to avoid duplicates.
 */
import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext, OSDUResourceType } from "./OsduContext";
import { ResqmlResource } from "./WorkProductComponent";

import {
  MasterDataBoundaryFeatureData,
  MasterDataBoundaryFeature
} from "./Generated/master-data/BoundaryFeature.1.2.0";

/**
 * Maps RESQML 2.0 BoundaryFeature to OSDU master-data--BoundaryFeature:1.2.0.
 */
export class MasterDataBoundaryFeatureOSDU
  extends ResqmlResource<SimpleJson<resqml20.obj_BoundaryFeature>>
  implements MasterDataBoundaryFeature
{
  public data: MasterDataBoundaryFeatureData = {};

  constructor(
    xml: SimpleJson<resqml20.obj_BoundaryFeature>,
    context: OSDUContext
  ) {
    super(xml, context, "master-data", "BoundaryFeature.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_BoundaryFeature>
  ): Promise<MasterDataBoundaryFeatureOSDU> {
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

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

/**
 * Manifest factory that checks OSDU Storage for existing master-data record
 * before creating a new one.
 */
export const MasterDataBoundaryFeatureManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_BoundaryFeature>,
  context: OSDUContext,
  _client: ResqmlClient
): Promise<MasterDataBoundaryFeatureOSDU | undefined> => {
  const instance = new MasterDataBoundaryFeatureOSDU(xml, context);
  await instance.initData(uri, xml);

  // S3 safety: Check if this master-data record already exists in OSDU Storage.
  // The SRN is deterministic from the UUID, so we can check directly.
  if (instance.id && context.bearer) {
    const existingVersion = await context.getOSDUResourceVersion(instance.id);
    if (existingVersion) {
      // Record already exists — do not duplicate
      return undefined;
    }
  }

  return instance;
};
