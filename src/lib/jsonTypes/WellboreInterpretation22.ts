import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

interface Data {
  [key: string]: unknown;
  IsDrilled?: boolean;
}

interface WellboreInterpretation {
  data: Data;
}

export class WellboreInterpretation22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.WellboreInterpretation>
  >
  implements WellboreInterpretation
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml22.WellboreInterpretation>,
    context: OSDUContext
  ) {
    super(xml, context, "WellboreInterpretation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.WellboreInterpretation>,
    client: ResqmlClient
  ): Promise<WellboreInterpretation22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
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
      IsDrilled: xml.IsDrilled,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const WellboreInterpretation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.WellboreInterpretation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WellboreInterpretation22OSDU> =>
  new WellboreInterpretation22OSDU(xml, context).initData(uri, xml, client);
