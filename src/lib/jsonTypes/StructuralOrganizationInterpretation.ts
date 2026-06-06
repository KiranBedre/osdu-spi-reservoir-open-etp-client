import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  StructuralOrganizationInterpretation
} from "./Generated/work-product-component/StructuralOrganizationInterpretation.1.2.0";

export class StructuralOrganizationInterpretationOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_StructuralOrganizationInterpretation>
  >
  implements StructuralOrganizationInterpretation
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_StructuralOrganizationInterpretation>,
    context: OSDUContext
  ) {
    super(xml, context, "StructuralOrganizationInterpretation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_StructuralOrganizationInterpretation>,
    client: ResqmlClient
  ): Promise<StructuralOrganizationInterpretationOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const faultIds = await this.resolveDorArray(
      ReservoirDMSUrl, xml.Faults, client, context
    );
    const horizonIds: string[] = [];
    if (xml.Horizons) {
      for (const h of xml.Horizons) {
        const srn = await StructuralOrganizationInterpretationOSDU.dorToSrn(
          ReservoirDMSUrl, h.Horizon, client, context
        );
        if (srn) horizonIds.push(srn + ":");
      }
    }
    const topIds = await this.resolveDorArray(
      ReservoirDMSUrl, xml.TopFrontier, client, context
    );
    const bottomIds = await this.resolveDorArray(
      ReservoirDMSUrl, xml.BottomFrontier, client, context
    );
    const sideIds = await this.resolveDorArray(
      ReservoirDMSUrl, xml.Sides, client, context
    );

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
      OrderingCriteriaID: context.addReferenceData(
        "OrderingCriteria",
        this.capitalize(xml.OrderingCriteria)
      ),
      FaultInterpretationIDs: faultIds.length > 0 ? faultIds : undefined,
      HorizonInterpretationIDs: horizonIds.length > 0 ? horizonIds : undefined,
      TopFrontierIDs: topIds.length > 0 ? topIds : undefined,
      BottomFrontierIDs: bottomIds.length > 0 ? bottomIds : undefined,
      SideIDs: sideIds.length > 0 ? sideIds : undefined,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }

  private async resolveDorArray(
    uri: string,
    dors: any[] | undefined,
    client: ResqmlClient,
    context: OSDUContext
  ): Promise<string[]> {
    if (!dors) return [];
    const results: string[] = [];
    for (const dor of dors) {
      const srn = await StructuralOrganizationInterpretationOSDU.dorToSrn(
        uri, dor, client, context
      );
      if (srn) results.push(srn + ":");
    }
    return results;
  }
}

export const StructuralOrganizationInterpretationManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_StructuralOrganizationInterpretation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<StructuralOrganizationInterpretationOSDU> =>
  new StructuralOrganizationInterpretationOSDU(xml, context).initData(
    uri,
    xml,
    client
  );
