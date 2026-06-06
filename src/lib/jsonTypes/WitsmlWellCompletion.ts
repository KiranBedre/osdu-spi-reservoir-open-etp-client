/**
 * A7: WITSML WellCompletion → OSDU WPC--WellboreCompletion:1.3.0
 *
 * Maps WITSML 2.1 WellCompletion data object to OSDU WellboreCompletion
 * work-product-component. Stores completion interval data, perforation info,
 * and status history.
 */
import * as witsml21 from "../mlTypes/xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent, ResqmlResource } from "./WorkProductComponent";

export class WitsmlWellCompletionOSDU extends ResqmlWorkProductComponent<SimpleJson<witsml21.WellCompletion>> {
  public data: Record<string, any> = {};

  constructor(xml: SimpleJson<witsml21.WellCompletion>, context: OSDUContext) {
    super(xml, context, "WellboreCompletion.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<witsml21.WellCompletion>,
    client: ResqmlClient
  ): Promise<WitsmlWellCompletionOSDU> {
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

    let wellSrn: string | undefined;
    if (x.Well) {
      wellSrn = await ResqmlResource.dorToSrn(
        ReservoirDMSUrl,
        x.Well,
        client,
        context
      );
    }

    // Map completion status history if available
    const statusHistory = x.CompletionStatusHistory?.map((h: any) => ({
      Status: h.Status,
      StartDate: h.StartDate,
      EndDate: h.EndDate,
      Remark: h.Comment
    }));

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      WellboreID: wellboreSrn,
      WellID: wellSrn,
      CompletionName: xml.Citation?.Title ?? x.Name,
      StatusHistory: statusHistory,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);
    delete this.__context;
    return this;
  }
}

export const WitsmlWellCompletionManifest = async (
  uri: string,
  xml: SimpleJson<witsml21.WellCompletion>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WitsmlWellCompletionOSDU> =>
  new WitsmlWellCompletionOSDU(xml, context).initData(uri, xml, client);
