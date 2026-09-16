import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";
import {
  MasterDataWellboreManifest,
  MasterDataWellboreOSDU
} from "./MasterDataWellbore";

interface Data {
  [key: string]: unknown;
  IsDrilled?: boolean;
  WellboreID?: string;
}

interface WellboreInterpretation {
  data: Data;
}

export class WellboreInterpretationOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_WellboreInterpretation>
  >
  implements WellboreInterpretation {
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_WellboreInterpretation>,
    context: OSDUContext
  ) {
    super(xml, context, "WellboreInterpretation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_WellboreInterpretation>,
    client: ResqmlClient
  ): Promise<WellboreInterpretationOSDU> {
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

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

export const WellboreInterpretationManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_WellboreInterpretation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WellboreInterpretationOSDU> => {
  // Synthesize master-data--Wellbore (and parent Well) if they don't exist in OSDU
  const wellboreMasterData = await MasterDataWellboreManifest(
    uri,
    xml,
    context,
    client
  );
  if (wellboreMasterData !== undefined && wellboreMasterData.id) {
    context.created.set(wellboreMasterData.id, wellboreMasterData);
  }

  return new WellboreInterpretationOSDU(xml, context).initData(uri, xml, client);
};
