import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  RockFluidOrganizationInterpretation
} from "./Generated/work-product-component/RockFluidOrganizationInterpretation.1.2.0";

export class RockFluidOrganizationInterpretation22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.RockFluidOrganizationInterpretation>
  >
  implements RockFluidOrganizationInterpretation
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml22.RockFluidOrganizationInterpretation>,
    context: OSDUContext
  ) {
    super(xml, context, "RockFluidOrganizationInterpretation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.RockFluidOrganizationInterpretation>,
    client: ResqmlClient
  ): Promise<RockFluidOrganizationInterpretation22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const unitIds: string[] = [];
    if (xml.RockFluidUnit) {
      for (const dor of xml.RockFluidUnit) {
        const srn = await RockFluidOrganizationInterpretation22OSDU.dorToSrn(
          ReservoirDMSUrl, dor, client, context
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

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const RockFluidOrganizationInterpretation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.RockFluidOrganizationInterpretation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<RockFluidOrganizationInterpretation22OSDU> =>
  new RockFluidOrganizationInterpretation22OSDU(xml, context).initData(
    uri,
    xml,
    client
  );
