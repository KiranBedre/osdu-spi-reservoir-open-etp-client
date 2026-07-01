import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  FluidBoundaryInterpretation
} from "./Generated/work-product-component/FluidBoundaryInterpretation.1.2.0";

/**
 * In RESQML 2.0.1, FluidBoundary is a Feature (not an interpretation).
 * We still map it to the OSDU FluidBoundaryInterpretation kind.
 */
export class FluidBoundaryFeatureOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_FluidBoundaryFeature>
  >
  implements FluidBoundaryInterpretation
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_FluidBoundaryFeature>,
    context: OSDUContext
  ) {
    super(xml, context, "FluidBoundaryInterpretation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_FluidBoundaryFeature>,
    client: ResqmlClient
  ): Promise<FluidBoundaryFeatureOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      FluidContactTypeID: context.addReferenceData(
        "FluidContactType",
        this.capitalize(xml.FluidContact)
      ),
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

export const FluidBoundaryFeatureManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_FluidBoundaryFeature>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<FluidBoundaryFeatureOSDU> =>
  new FluidBoundaryFeatureOSDU(xml, context).initData(uri, xml, client);
