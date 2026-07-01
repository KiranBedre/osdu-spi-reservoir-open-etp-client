import * as witsml21 from "../mlTypes/xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlResource } from "./WorkProductComponent";

import { Data, Wellbore } from "./Generated/master-data/Wellbore.1.3.0";

/**
 * Extract OSDU Wellbore master-data information from WITSML Wellbore.
 * Maps to osdu:wks:master-data--Wellbore:1.3.0
 *
 * @export
 * @class WitsmlWellboreOSDU
 * @extends {ResqmlResource<SimpleJson<witsml21.Wellbore>>}
 * @implements {Wellbore}
 */
export class WitsmlWellboreOSDU
  extends ResqmlResource<SimpleJson<witsml21.Wellbore>>
  implements Wellbore
{
  public data: Data = {};

  constructor(xml: SimpleJson<witsml21.Wellbore>, context: OSDUContext) {
    super(xml, context, "master-data", "Wellbore.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<witsml21.Wellbore>,
    client: ResqmlClient
  ): Promise<WitsmlWellboreOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    let wellSrn: string | undefined;
    if (xml.Well) {
      wellSrn = await ResqmlResource.dorToSrn(
        ReservoirDMSUrl,
        xml.Well,
        client,
        context
      );
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

      WellID: wellSrn,
      SequenceNumber: undefined,
      VerticalMeasurements: undefined,
      DefaultVerticalMeasurementID: undefined,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const WitsmlWellboreManifest = async (
  uri: string,
  xml: SimpleJson<witsml21.Wellbore>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WitsmlWellboreOSDU> =>
  new WitsmlWellboreOSDU(xml, context).initData(uri, xml, client);
