import * as prodml23 from "../mlTypes/xmlns/www.energistics.org/energyml/prodmlv23/prodmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import { Data } from "./Generated/work-product-component/GenericRepresentation.1.2.0";

/**
 * Convert PRODML 2.3 ProductionWellTests to an OSDU work-product-component.
 *
 * A production well test captures measured flow rates (oil/gas/water) for a
 * well over a test interval. OSDU has no dedicated production-well-test kind
 * registered yet, so this projects onto the generic WPC envelope
 * (GenericRepresentation) and preserves the test measurements in
 * ExtensionProperties. The kind resolver requests "WellProductionData" and
 * gracefully falls back to GenericRepresentation until a dedicated kind exists.
 *
 * TODO(osdu-kinds): register the dedicated OSDU well-test/production kind in
 * MilestoneKinds and retarget this converter.
 */
export class ProductionWellTestsOSDU extends ResqmlWorkProductComponent<
  SimpleJson<prodml23.ProductionWellTests>
> {
  public data: Data = {};

  constructor(
    xml: SimpleJson<prodml23.ProductionWellTests>,
    context: OSDUContext
  ) {
    super(xml, context, "GenericRepresentation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<prodml23.ProductionWellTests>,
    client: ResqmlClient
  ): Promise<ProductionWellTestsOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const src = xml as any;

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      ExtensionProperties: undefined
    };

    const ext: Record<string, unknown> = {};
    if (src.ProductFluidKind) {
      ext["ProductFluidKind"] = src.ProductFluidKind;
    }
    if (src.ProductFluidReference) {
      ext["ProductFluidReference"] = src.ProductFluidReference;
    }
    if (src.VolumeFlowRate !== undefined) {
      ext["VolumeFlowRate"] = src.VolumeFlowRate;
    }
    if (src.MassFlowRate !== undefined) {
      ext["MassFlowRate"] = src.MassFlowRate;
    }
    if (src.Remark) {
      ext["Remark"] = src.Remark;
    }
    if (Object.keys(ext).length > 0) {
      this.data.ExtensionProperties = ext;
    }

    this.assignExtraMetaData(src.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const ProductionWellTestsManifest = async (
  uri: string,
  xml: SimpleJson<prodml23.ProductionWellTests>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<ProductionWellTestsOSDU> =>
  new ProductionWellTestsOSDU(xml, context).initData(uri, xml, client);
