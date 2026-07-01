import * as witsml21 from "../mlTypes/xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent, ResqmlResource } from "./WorkProductComponent";

import {
  Data,
  WellboreTrajectory
} from "./Generated/work-product-component/WellboreTrajectory.1.3.0";

/**
 * Extract OSDU WellboreTrajectory WPC information from WITSML Trajectory.
 * Maps to osdu:wks:work-product-component--WellboreTrajectory:1.3.0
 *
 * @export
 * @class WitsmlTrajectoryOSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<witsml21.Trajectory>>}
 * @implements {WellboreTrajectory}
 */
export class WitsmlTrajectoryOSDU
  extends ResqmlWorkProductComponent<SimpleJson<witsml21.Trajectory>>
  implements WellboreTrajectory
{
  public data: Data = {};

  constructor(xml: SimpleJson<witsml21.Trajectory>, context: OSDUContext) {
    super(xml, context, "WellboreTrajectory.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<witsml21.Trajectory>,
    client: ResqmlClient
  ): Promise<WitsmlTrajectoryOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    let wellboreSrn: string | undefined;
    if (xml.Wellbore) {
      wellboreSrn = await ResqmlResource.dorToSrn(
        ReservoirDMSUrl,
        xml.Wellbore,
        client,
        context
      );
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      WellboreID: wellboreSrn,
      AzimuthReferenceType: xml.AziRef,
      ServiceCompanyID: undefined,
      TopDepthMeasuredDepth: undefined,
      BaseDepthMeasuredDepth:
        (xml.MdMaxMeasured?.MeasuredDepth as any)?._ ?? undefined,
      AcquisitionRemark: xml.AcquisitionRemark,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const WitsmlTrajectoryManifest = async (
  uri: string,
  xml: SimpleJson<witsml21.Trajectory>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WitsmlTrajectoryOSDU> =>
  new WitsmlTrajectoryOSDU(xml, context).initData(uri, xml, client);
