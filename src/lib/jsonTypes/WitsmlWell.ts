import * as witsml21 from "../mlTypes/xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlResource } from "./WorkProductComponent";

import { Data, Well } from "./Generated/master-data/Well.1.2.0";

/**
 * Extract OSDU Well master-data information from WITSML Well.
 * Maps to osdu:wks:master-data--Well:1.3.0
 *
 * @export
 * @class WitsmlWellOSDU
 * @extends {ResqmlResource<SimpleJson<witsml21.Well>>}
 * @implements {Well}
 */
export class WitsmlWellOSDU
  extends ResqmlResource<SimpleJson<witsml21.Well>>
  implements Well
{
  public data: Data = {};

  constructor(xml: SimpleJson<witsml21.Well>, context: OSDUContext) {
    super(xml, context, "master-data", "Well.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<witsml21.Well>
  ): Promise<WitsmlWellOSDU> {
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

      FacilityName: xml.Citation?.Title,
      FacilityNameAliases: undefined,
      FacilityStates: undefined,
      FacilityEvents: undefined,

      DefaultVerticalMeasurementID: undefined,
      DefaultVerticalCRSID: undefined,
      VerticalMeasurements: undefined,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const WitsmlWellManifest = async (
  uri: string,
  xml: SimpleJson<witsml21.Well>,
  context: OSDUContext,
  _client: ResqmlClient
): Promise<WitsmlWellOSDU> =>
  new WitsmlWellOSDU(xml, context).initData(uri, xml);
