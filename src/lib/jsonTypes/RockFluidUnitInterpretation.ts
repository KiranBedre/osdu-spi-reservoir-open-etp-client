import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  RockFluidUnitInterpretation
} from "./Generated/work-product-component/RockFluidUnitInterpretation.1.3.0";

export class RockFluidUnitInterpretationOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_RockFluidUnitInterpretation>
  >
  implements RockFluidUnitInterpretation
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_RockFluidUnitInterpretation>,
    context: OSDUContext
  ) {
    super(xml, context, "RockFluidUnitInterpretation.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_RockFluidUnitInterpretation>,
    client: ResqmlClient
  ): Promise<RockFluidUnitInterpretationOSDU> {
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
      GeologicUnitShapeTypeID: undefined,
      LithologyTypeID: context.addReferenceData(
        "LithologyType",
        this.capitalize(xml.GeologicUnitComposition)
      ),
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

export const RockFluidUnitInterpretationManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_RockFluidUnitInterpretation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<RockFluidUnitInterpretationOSDU> =>
  new RockFluidUnitInterpretationOSDU(xml, context).initData(
    uri,
    xml,
    client
  );
