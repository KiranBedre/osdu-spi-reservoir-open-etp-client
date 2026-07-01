/**
 * A4: WITSML Tubular → OSDU WPC--Tubular:1.3.0
 *
 * Maps WITSML 2.1 Tubular data object to OSDU work-product-component.
 */
import * as witsml21 from "../mlTypes/xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent, ResqmlResource } from "./WorkProductComponent";

export class WitsmlTubularOSDU extends ResqmlWorkProductComponent<SimpleJson<witsml21.Tubular>> {
  public data: Record<string, any> = {};

  constructor(xml: SimpleJson<witsml21.Tubular>, context: OSDUContext) {
    super(xml, context, "Tubular.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<witsml21.Tubular>,
    client: ResqmlClient
  ): Promise<WitsmlTubularOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    let wellboreSrn: string | undefined;
    if (xml.Wellbore) {
      wellboreSrn = await ResqmlResource.dorToSrn(
        ReservoirDMSUrl,
        xml.Wellbore,
        client,
        context
      );
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      WellboreID: wellboreSrn,
      TypeTubularAssy: xml.TypeTubularAssy,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);
    delete this.__context;
    return this;
  }
}

export const WitsmlTubularManifest = async (
  uri: string,
  xml: SimpleJson<witsml21.Tubular>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WitsmlTubularOSDU> =>
  new WitsmlTubularOSDU(xml, context).initData(uri, xml, client);
