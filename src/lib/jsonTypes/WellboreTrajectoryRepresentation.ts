import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  WellboreTrajectory
} from "./Generated/work-product-component/WellboreTrajectory.1.3.0";

export class WellboreTrajectoryRepresentationOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_WellboreTrajectoryRepresentation>
  >
  implements WellboreTrajectory
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_WellboreTrajectoryRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "WellboreTrajectory.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_WellboreTrajectoryRepresentation>,
    client: ResqmlClient
  ): Promise<WellboreTrajectoryRepresentationOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    // FIRP: a 2.0.1 trajectory references its WellboreInterpretation via the
    // AbstractRepresentation.RepresentedInterpretation DOR (the 2.2 equivalent
    // is RepresentedObject).
    const wellboreId = xml.RepresentedInterpretation
      ? await WellboreTrajectoryRepresentationOSDU.dorToSrn(
          ReservoirDMSUrl,
          xml.RepresentedInterpretation,
          client,
          context
        )
      : undefined;

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      WellboreID: wellboreId,
      TopDepthMeasuredDepth: xml.StartMd,
      BaseDepthMeasuredDepth: xml.FinishMd,
      ActiveIndicator: true,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

export const WellboreTrajectoryRepresentationManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_WellboreTrajectoryRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WellboreTrajectoryRepresentationOSDU> =>
  new WellboreTrajectoryRepresentationOSDU(xml, context).initData(
    uri,
    xml,
    client
  );
