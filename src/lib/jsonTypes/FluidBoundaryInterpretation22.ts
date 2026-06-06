import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  FluidBoundaryInterpretation
} from "./Generated/work-product-component/FluidBoundaryInterpretation.1.2.0";

export class FluidBoundaryInterpretation22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.FluidBoundaryInterpretation>
  >
  implements FluidBoundaryInterpretation
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml22.FluidBoundaryInterpretation>,
    context: OSDUContext
  ) {
    super(xml, context, "FluidBoundaryInterpretation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.FluidBoundaryInterpretation>,
    client: ResqmlClient
  ): Promise<FluidBoundaryInterpretation22OSDU> {
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
      FluidContactTypeID: context.addReferenceData(
        "FluidContactType",
        this.capitalize(xml.FluidContact)
      ),
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const FluidBoundaryInterpretation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.FluidBoundaryInterpretation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<FluidBoundaryInterpretation22OSDU> =>
  new FluidBoundaryInterpretation22OSDU(xml, context).initData(
    uri,
    xml,
    client
  );
