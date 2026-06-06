import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  StructuralOrganizationInterpretation
} from "./Generated/work-product-component/StructuralOrganizationInterpretation.1.2.0";

export class StructuralOrganizationInterpretation22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.StructuralOrganizationInterpretation>
  >
  implements StructuralOrganizationInterpretation
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml22.StructuralOrganizationInterpretation>,
    context: OSDUContext
  ) {
    super(xml, context, "StructuralOrganizationInterpretation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.StructuralOrganizationInterpretation>,
    client: ResqmlClient
  ): Promise<StructuralOrganizationInterpretation22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const faultIds: string[] = [];
    const horizonIds: string[] = [];
    if (xml.OrderedBoundaryFeatureInterpretation) {
      for (const item of xml.OrderedBoundaryFeatureInterpretation) {
        const srn = await StructuralOrganizationInterpretation22OSDU.dorToSrn(
          ReservoirDMSUrl,
          item.BoundaryFeatureInterpretation,
          client,
          context
        );
        if (srn) {
          const qt = item.BoundaryFeatureInterpretation?.QualifiedType || "";
          if (qt.includes("Fault")) {
            faultIds.push(srn + ":");
          } else {
            horizonIds.push(srn + ":");
          }
        }
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
        this.capitalize(xml.AscendingOrderingCriteria)
      ),
      FaultInterpretationIDs: faultIds.length > 0 ? faultIds : undefined,
      HorizonInterpretationIDs: horizonIds.length > 0 ? horizonIds : undefined,
      TopFrontierIDs: topIds.length > 0 ? topIds : undefined,
      BottomFrontierIDs: bottomIds.length > 0 ? bottomIds : undefined,
      SideIDs: sideIds.length > 0 ? sideIds : undefined,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

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
      const srn = await StructuralOrganizationInterpretation22OSDU.dorToSrn(
        uri, dor, client, context
      );
      if (srn) results.push(srn + ":");
    }
    return results;
  }
}

export const StructuralOrganizationInterpretation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.StructuralOrganizationInterpretation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<StructuralOrganizationInterpretation22OSDU> =>
  new StructuralOrganizationInterpretation22OSDU(xml, context).initData(
    uri,
    xml,
    client
  );
