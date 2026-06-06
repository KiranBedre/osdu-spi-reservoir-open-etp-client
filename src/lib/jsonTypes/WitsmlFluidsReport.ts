/**
 * A4: WITSML FluidsReport → OSDU WPC--FluidsReport:1.3.0
 *
 * Maps WITSML 2.1 FluidsReport data object to OSDU work-product-component.
 */
import * as witsml21 from "../mlTypes/xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent, ResqmlResource } from "./WorkProductComponent";

export class WitsmlFluidsReportOSDU extends ResqmlWorkProductComponent<SimpleJson<witsml21.FluidsReport>> {
  public data: Record<string, any> = {};

  constructor(xml: SimpleJson<witsml21.FluidsReport>, context: OSDUContext) {
    super(xml, context, "FluidsReport.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<witsml21.FluidsReport>,
    client: ResqmlClient
  ): Promise<WitsmlFluidsReportOSDU> {
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
      ReportDate: xml.DTim,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);
    delete this.__context;
    return this;
  }
}

export const WitsmlFluidsReportManifest = async (
  uri: string,
  xml: SimpleJson<witsml21.FluidsReport>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WitsmlFluidsReportOSDU> =>
  new WitsmlFluidsReportOSDU(xml, context).initData(uri, xml, client);
