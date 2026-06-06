import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  RockFluidUnitInterpretation
} from "./Generated/work-product-component/RockFluidUnitInterpretation.1.3.0";

export class RockFluidUnitInterpretation22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.RockFluidUnitInterpretation>
  >
  implements RockFluidUnitInterpretation
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml22.RockFluidUnitInterpretation>,
    context: OSDUContext
  ) {
    super(xml, context, "RockFluidUnitInterpretation.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.RockFluidUnitInterpretation>,
    client: ResqmlClient
  ): Promise<RockFluidUnitInterpretation22OSDU> {
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
      PhaseID: context.addReferenceData(
        "RockFluidUnitPhase",
        this.capitalize(xml.Phase)
      ),
      GeologicUnitShapeTypeID: context.addReferenceData(
        "GeologicUnitShapeType",
        this.capitalize(xml.GeologicUnit3dShape)
      ),
      LithologyTypeID: context.addReferenceData(
        "LithologyType",
        this.capitalize(xml.GeologicUnitComposition)
      ),
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const RockFluidUnitInterpretation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.RockFluidUnitInterpretation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<RockFluidUnitInterpretation22OSDU> =>
  new RockFluidUnitInterpretation22OSDU(xml, context).initData(
    uri,
    xml,
    client
  );
