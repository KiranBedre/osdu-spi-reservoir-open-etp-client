import * as prodml23 from "../mlTypes/xmlns/www.energistics.org/energyml/prodmlv23/prodmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import { Data } from "./Generated/work-product-component/GenericRepresentation.1.2.0";

/**
 * Convert PRODML 2.3 Report to an OSDU work-product-component.
 *
 * A PRODML Report is the reporting envelope that groups production results for
 * a reporting entity over a period. OSDU has no dedicated production-report kind
 * registered yet, so this projects onto the generic WPC envelope and preserves
 * the report metadata in ExtensionProperties. The kind resolver requests
 * "ProductionReport" and gracefully falls back to GenericRepresentation.
 *
 * TODO(osdu-kinds): retarget to a dedicated OSDU production-report kind once
 * registered in MilestoneKinds.
 */
export class ProductionReportOSDU extends ResqmlWorkProductComponent<
  SimpleJson<prodml23.Report>
> {
  public data: Data = {};

  constructor(xml: SimpleJson<prodml23.Report>, context: OSDUContext) {
    super(xml, context, "GenericRepresentation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<prodml23.Report>,
    client: ResqmlClient
  ): Promise<ProductionReportOSDU> {
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
    if (src.Kind) {
      ext["Kind"] = src.Kind;
    }
    if (src.Title) {
      ext["Title"] = src.Title;
    }
    if (src.Period) {
      ext["Period"] = src.Period;
    }
    if (src.DateStart ?? src.DTimStart) {
      ext["DateStart"] = src.DateStart ?? src.DTimStart;
    }
    if (src.DateEnd ?? src.DTimEnd) {
      ext["DateEnd"] = src.DateEnd ?? src.DTimEnd;
    }
    if (Array.isArray(src.ReportingEntity)) {
      ext["ReportingEntityCount"] = src.ReportingEntity.length;
    }
    if (Object.keys(ext).length > 0) {
      this.data.ExtensionProperties = ext;
    }

    this.assignExtraMetaData(src.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const ProductionReportManifest = async (
  uri: string,
  xml: SimpleJson<prodml23.Report>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<ProductionReportOSDU> =>
  new ProductionReportOSDU(xml, context).initData(uri, xml, client);
