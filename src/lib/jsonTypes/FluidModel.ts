import * as prodml23 from "../mlTypes/xmlns/www.energistics.org/energyml/prodmlv23/prodmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  FluidModel
} from "./Generated/work-product-component/FluidModel.1.0.0";

/**
 * Convert PRODML 2.3 FluidCharacterization to OSDU FluidModel WPC.
 *
 * The PRODML FluidCharacterization is a rich object containing EoS parameters,
 * component catalogs, and PVT tables. The OSDU FluidModel:1.0.0 WPC schema is
 * a thin metadata envelope. Detailed data (tables, components) should be stored
 * as content-schema records or ColumnBasedTable references, linked via
 * ExtensionProperties or DDMSDatasets.
 */
export class FluidModelOSDU
  extends ResqmlWorkProductComponent<SimpleJson<prodml23.FluidCharacterization>>
  implements FluidModel
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<prodml23.FluidCharacterization>,
    context: OSDUContext
  ) {
    super(xml, context, "FluidModel.1.0.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<prodml23.FluidCharacterization>,
    client: ResqmlClient
  ): Promise<FluidModelOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    // Map PRODML Kind to OSDU FluidModelType reference-data
    const fluidModelTypeID = xml.Kind
      ? context.addReferenceData("FluidModelType", xml.Kind)
      : undefined;

    // Resolve RockFluidUnitInterpretation DOR to ModelAreaOfInterest
    const modelAreaIDs: string[] = [];
    if (xml.RockFluidUnitInterpretation) {
      const srn = await FluidModelOSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RockFluidUnitInterpretation,
        client,
        context
      );
      if (srn) modelAreaIDs.push(srn);
    }

    // Extract model names for lineage/remarks
    const remarks: string[] = [];
    if (xml.Remark) {
      remarks.push(typeof xml.Remark === "string" ? xml.Remark : String(xml.Remark));
    }
    if (xml.IntendedUsage) {
      remarks.push(`Intended usage: ${xml.IntendedUsage}`);
    }

    // Determine if compositional (has FluidComponentCatalog)
    const hasComponents = xml.FluidComponentCatalog !== undefined;
    const hasModels = xml.Model !== undefined && (xml.Model as any[]).length > 0;

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      FluidModelTypeID: fluidModelTypeID,
      FluidModelSaturationTypeID: undefined,
      BasisOfModelling: xml.IntendedUsage
        ? { IntendedUsage: xml.IntendedUsage }
        : undefined,
      ParentModelID: undefined,
      DatePublished: undefined,
      ModelAreaOfInterestIDs:
        modelAreaIDs.length > 0 ? modelAreaIDs : undefined,
      IsApplicableForThermalSimulation: undefined,
      HasVariableDepthFluidProperties: hasComponents || undefined,
      Remarks: remarks.length > 0 ? remarks : undefined,
      ExtensionProperties: undefined
    };

    // Preserve rich PRODML data in ExtensionProperties for round-trip
    const ext: Record<string, unknown> = {};
    if (xml.ApplicationTarget) {
      ext["ApplicationTarget"] = xml.ApplicationTarget;
    }
    if (hasModels) {
      ext["ModelCount"] = (xml.Model as any[]).length;
      ext["ModelNames"] = (xml.Model as any[])
        .map((m: any) => m.Name)
        .filter(Boolean);
    }
    if (hasComponents) {
      ext["HasFluidComponentCatalog"] = true;
    }
    if (xml.StandardConditions) {
      ext["StandardConditions"] = xml.StandardConditions;
    }
    if (Object.keys(ext).length > 0) {
      this.data.ExtensionProperties = ext;
    }

    this.assignExtraMetaData((xml as any).ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const FluidModelManifest = async (
  uri: string,
  xml: SimpleJson<prodml23.FluidCharacterization>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<FluidModelOSDU> =>
  new FluidModelOSDU(xml, context).initData(uri, xml, client);
