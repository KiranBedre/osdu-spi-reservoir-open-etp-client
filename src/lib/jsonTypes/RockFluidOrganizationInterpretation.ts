import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  RockFluidOrganizationInterpretation
} from "./Generated/work-product-component/RockFluidOrganizationInterpretation.1.2.0";

export class RockFluidOrganizationInterpretationOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_RockFluidOrganizationInterpretation>
  >
  implements RockFluidOrganizationInterpretation
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_RockFluidOrganizationInterpretation>,
    context: OSDUContext
  ) {
    super(xml, context, "RockFluidOrganizationInterpretation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_RockFluidOrganizationInterpretation>,
    client: ResqmlClient
  ): Promise<RockFluidOrganizationInterpretationOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const unitIds: string[] = [];
    if (xml.RockFluidUnitIndex) {
      const items = Array.isArray(xml.RockFluidUnitIndex)
        ? xml.RockFluidUnitIndex
        : [xml.RockFluidUnitIndex];
      for (const item of items) {
        const srn = await RockFluidOrganizationInterpretationOSDU.dorToSrn(
          ReservoirDMSUrl, (item as any).RockFluidUnit, client, context
        );
        if (srn) unitIds.push(srn + ":");
      }
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      ...(await this.AbstractInterpretation(
        ReservoirDMSUrl,
        xml,
        client,
        context
      )),
      RockFluidUnitInterpretationIDs:
        unitIds.length > 0 ? unitIds : undefined,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

export const RockFluidOrganizationInterpretationManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_RockFluidOrganizationInterpretation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<RockFluidOrganizationInterpretationOSDU> =>
  new RockFluidOrganizationInterpretationOSDU(xml, context).initData(
    uri,
    xml,
    client
  );
