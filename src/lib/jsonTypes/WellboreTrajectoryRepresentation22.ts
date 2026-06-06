import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  WellboreTrajectory
} from "./Generated/work-product-component/WellboreTrajectory.1.3.0";

export class WellboreTrajectoryRepresentation22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.WellboreTrajectoryRepresentation>
  >
  implements WellboreTrajectory
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml22.WellboreTrajectoryRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "WellboreTrajectory.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.WellboreTrajectoryRepresentation>,
    client: ResqmlClient
  ): Promise<WellboreTrajectoryRepresentation22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const wellboreId = xml.RepresentedObject
      ? await WellboreTrajectoryRepresentation22OSDU.dorToSrn(
          ReservoirDMSUrl,
          xml.RepresentedObject,
          client,
          context
        )
      : undefined;

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      WellboreID: wellboreId,
      TopDepthMeasuredDepth: xml.MdInterval?.MdMin,
      BaseDepthMeasuredDepth: xml.MdInterval?.MdMax,
      ActiveIndicator: true,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const WellboreTrajectoryRepresentation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.WellboreTrajectoryRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WellboreTrajectoryRepresentation22OSDU> =>
  new WellboreTrajectoryRepresentation22OSDU(xml, context).initData(
    uri,
    xml,
    client
  );
