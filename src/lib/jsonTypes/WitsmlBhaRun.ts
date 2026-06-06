/**
 * A4: WITSML BhaRun → OSDU WPC--BHARunReport:1.3.0
 *
 * Maps WITSML 2.1 BhaRun data object to OSDU work-product-component.
 */
import * as witsml21 from "../mlTypes/xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent, ResqmlResource } from "./WorkProductComponent";

export class WitsmlBhaRunOSDU extends ResqmlWorkProductComponent<SimpleJson<witsml21.BhaRun>> {
  public data: Record<string, any> = {};

  constructor(xml: SimpleJson<witsml21.BhaRun>, context: OSDUContext) {
    super(xml, context, "BHARunReport.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<witsml21.BhaRun>,
    client: ResqmlClient
  ): Promise<WitsmlBhaRunOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const x = xml as any;
    let wellboreSrn: string | undefined;
    if (x.Wellbore) {
      wellboreSrn = await ResqmlResource.dorToSrn(
        ReservoirDMSUrl,
        x.Wellbore,
        client,
        context
      );
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      WellboreID: wellboreSrn,
      RunNumber: x.NumBitRun,
      StatusBha: x.StatusBha,
      ReasonTrip: x.ReasonTrip,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);
    delete this.__context;
    return this;
  }
}

export const WitsmlBhaRunManifest = async (
  uri: string,
  xml: SimpleJson<witsml21.BhaRun>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WitsmlBhaRunOSDU> =>
  new WitsmlBhaRunOSDU(xml, context).initData(uri, xml, client);
