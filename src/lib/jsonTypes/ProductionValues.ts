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
 * Convert PRODML 2.3 TimeSeriesData to OSDU ProductionValues WPC.
 *
 * PRODML TimeSeriesData is a generic time-series container with key-value
 * classification. The OSDU ProductionValues:1.1.1 schema is a richer
 * production-reporting envelope. This converter maps the structural metadata;
 * actual time-series values are stored via the Array/Dataset service.
 */
export class ProductionValuesOSDU
  extends ResqmlWorkProductComponent<SimpleJson<prodml23.TimeSeriesData>>
  implements ProductionValues
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<prodml23.TimeSeriesData>,
    context: OSDUContext
  ) {
    super(xml, context, "ProductionValues.1.1.1");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<prodml23.TimeSeriesData>,
    client: ResqmlClient
  ): Promise<ProductionValuesOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    // Extract date range from DataValue samples
    let startDateTime: string | undefined;
    let endDateTime: string | undefined;
    if (xml.DataValue && Array.isArray(xml.DataValue)) {
      const samples = xml.DataValue as any[];
      const times = samples
        .map((s: any) => s.dTim)
        .filter(Boolean)
        .map((t: any) => (t instanceof Date ? t : new Date(t)));
      if (times.length > 0) {
        times.sort((a: Date, b: Date) => a.getTime() - b.getTime());
        startDateTime = times[0].toISOString();
        endDateTime = times[times.length - 1].toISOString();
      }
    }

    // Map PRODML Key[] to OSDU PropertyIDs
    const propertyIDs: string[] = [];
    if (xml.Key && Array.isArray(xml.Key)) {
      for (const key of xml.Key as any[]) {
        const kw = key.Keyword as string | undefined;
        const val = key.Value as string | undefined;
        if (kw && val) {
          propertyIDs.push(
            context.addReferenceData("ProductionMeasurement", `${kw}:${val}`) as string
          );
        }
      }
    }

    // Map MeasureClass to PropertyID
    if (xml.MeasureClass) {
      propertyIDs.push(
        context.addReferenceData("MeasureClass", String(xml.MeasureClass)) as string
      );
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      StartDateTime: startDateTime,
      EndDateTime: endDateTime,
      PropertyIDs: propertyIDs.length > 0 ? propertyIDs : undefined,
      ExtensionProperties: undefined
    };

    // Preserve PRODML-specific data for round-trip
    const ext: Record<string, unknown> = {};
    if (xml.Comment) {
      ext["Comment"] = xml.Comment;
    }
    if (xml.Uom) {
      ext["Uom"] = xml.Uom;
    }
    if (xml.MeasureClass) {
      ext["MeasureClass"] = xml.MeasureClass;
    }
    if (xml.DataValue && Array.isArray(xml.DataValue)) {
      ext["SampleCount"] = (xml.DataValue as any[]).length;
    }
    if (Object.keys(ext).length > 0) {
      this.data.ExtensionProperties = ext;
    }

    this.assignExtraMetaData((xml as any).ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const ProductionValuesManifest = async (
  uri: string,
  xml: SimpleJson<prodml23.TimeSeriesData>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<ProductionValuesOSDU> =>
  new ProductionValuesOSDU(xml, context).initData(uri, xml, client);
