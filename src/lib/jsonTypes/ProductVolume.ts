import * as prodml23 from "../mlTypes/xmlns/www.energistics.org/energyml/prodmlv23/prodmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  ProductionValues
} from "./Generated/work-product-component/ProductionValues.1.1.1";

/**
 * Convert PRODML 2.3 ProductVolume to an OSDU ProductionValues WPC.
 *
 * ProductVolume is a product-flow reporting report (facility network volumes
 * over a period). OSDU has no dedicated ProductVolume kind yet, so it is
 * projected onto ProductionValues:1.1.1 with the facility/period structure
 * preserved in ExtensionProperties.
 *
 * TODO(osdu-kinds): retarget to a dedicated OSDU production kind once available.
 */
export class ProductVolumeOSDU
  extends ResqmlWorkProductComponent<SimpleJson<prodml23.ProductVolume>>
  implements ProductionValues
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<prodml23.ProductVolume>,
    context: OSDUContext
  ) {
    super(xml, context, "ProductionValues.1.1.1");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<prodml23.ProductVolume>,
    client: ResqmlClient
  ): Promise<ProductVolumeOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const src = xml as any;

    // Derive the reporting period from DateTime / PeriodKind when present.
    let startDateTime: string | undefined;
    let endDateTime: string | undefined;
    const start = src.DTimStart ?? src.DateTime ?? src.Date;
    const end = src.DTimEnd ?? start;
    const toIso = (v: any): string | undefined => {
      if (!v) return undefined;
      const d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    };
    startDateTime = toIso(start);
    endDateTime = toIso(end);

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      StartDateTime: startDateTime,
      EndDateTime: endDateTime,
      PropertyIDs: undefined,
      ExtensionProperties: undefined
    };

    const ext: Record<string, unknown> = {};
    if (src.Facility) {
      ext["Facility"] = Array.isArray(src.Facility)
        ? src.Facility.length
        : src.Facility;
    }
    if (src.Kind) {
      ext["Kind"] = src.Kind;
    }
    if (src.PeriodKind) {
      ext["PeriodKind"] = src.PeriodKind;
    }
    if (src.StandardTempPress) {
      ext["StandardTempPress"] = src.StandardTempPress;
    }
    if (Object.keys(ext).length > 0) {
      this.data.ExtensionProperties = ext;
    }

    this.assignExtraMetaData(src.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const ProductVolumeManifest = async (
  uri: string,
  xml: SimpleJson<prodml23.ProductVolume>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<ProductVolumeOSDU> =>
  new ProductVolumeOSDU(xml, context).initData(uri, xml, client);
