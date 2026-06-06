/**
 * A4: WITSML Rig → OSDU WPC--Rig:1.3.0
 *
 * Maps WITSML 2.1 Rig data object to OSDU Rig work-product-component.
 */
import * as witsml21 from "../mlTypes/xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext, OSDUResourceType } from "./OsduContext";
import { ResqmlWorkProductComponent, ResqmlResource } from "./WorkProductComponent";

export class WitsmlRigOSDU extends ResqmlWorkProductComponent<SimpleJson<witsml21.Rig>> {
  public data: Record<string, any> = {};

  constructor(xml: SimpleJson<witsml21.Rig>, context: OSDUContext) {
    super(xml, context, "Rig.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<witsml21.Rig>,
    client: ResqmlClient
  ): Promise<WitsmlRigOSDU> {
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
      RigName: xml.Citation?.Title ?? x.Name,
      TypeRig: x.TypeRig,
      Owner: x.Owner,
      Manufacturer: x.Manufacturer,
      ClassRig: x.ClassRig,
      YearEntService: x.YearEntService,
      IsOffshore: x.IsOffshore,
      RatingWaterDepth: x.RatingWaterDepth?._ ?? undefined,
      RatingDrillDepth: x.RatingDrillDepth?._ ?? undefined,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);
    delete this.__context;
    return this;
  }
}

export const WitsmlRigManifest = async (
  uri: string,
  xml: SimpleJson<witsml21.Rig>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WitsmlRigOSDU> =>
  new WitsmlRigOSDU(xml, context).initData(uri, xml, client);
