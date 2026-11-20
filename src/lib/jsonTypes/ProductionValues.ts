import * as prodml23 from "../mlTypes/xmlns/www.energistics.org/energyml/prodmlv23/prodmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { EtpUri } from "../common/EtpUri";
import { qualifiedTypeRegex } from "../common/EtpQualifiedType";
import { arrayPathFor } from "../restApi/shared/channelArrays";
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
  implements ProductionValues {
  public data: Data = {};

  constructor(
    xml: SimpleJson<prodml23.TimeSeriesData>,
    context: OSDUContext
  ) {
    super(xml, context, "ProductionValues.1.1.1");
  }

  /**
   * Try to obtain the time-series value summary from the store instead of
   * folding the inline samples client-side. Applies when the object's samples
   * were externalized into a server-backed array at `/PRODML/<uuid>/Value`
   * (see ObjectWrite extraction): the store folds Min/Max/Mean/Sum without any
   * bulk transfer. Mirrors {@link GenericPropertyOSDU}'s fast path and returns
   * undefined for inline-only objects or stores without the STATS extension, so
   * the caller falls back to the in-memory reduction.
   */
  private async tryServerTimeSeriesStats(
    ReservoirDMSUrl: string,
    xml: SimpleJson<prodml23.TimeSeriesData>,
    client: ResqmlClient
  ): Promise<
    | { min?: number; max?: number; mean?: number; sum?: number; count: number }
    | undefined
  > {
    if (typeof client.getDataArrayStats !== "function") {
      return undefined;
    }
    const uuid = (xml as { Uuid?: string }).Uuid;
    const type = (xml as { $type?: string }).$type;
    if (!uuid || !type) {
      return undefined;
    }
    const m = type.match(qualifiedTypeRegex);
    if (!m?.groups) {
      return undefined;
    }
    const objectUri = EtpUri.createObjectUri(
      new EtpUri(ReservoirDMSUrl).dataSpace,
      m.groups.domainFamily ?? "",
      m.groups.domainVersion ?? "",
      m.groups.dataType ?? "",
      uuid
    ).uri;
    try {
      const s = await client.getDataArrayStats(
        objectUri,
        arrayPathFor("PRODML", uuid, "Value")
      );
      if (!s || !s.valid || !s.count) {
        return undefined;
      }
      return {
        min: s.minimum,
        max: s.maximum,
        mean: s.mean,
        sum: s.sum,
        count: s.count
      };
    } catch {
      return undefined;
    }
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
      const samples = xml.DataValue as any[];
      ext["SampleCount"] = samples.length;

      // Prefer a store-folded summary when the samples were externalized into
      // a server-backed array (no bulk transfer); mirrors GenericProperty's
      // fast path. Falls back to the in-memory single pass below for inline
      // objects or stores without the STATS extension.
      const serverStats = await this.tryServerTimeSeriesStats(
        ReservoirDMSUrl,
        xml,
        client
      );
      if (serverStats) {
        ext["MinValue"] = serverStats.min;
        ext["MaxValue"] = serverStats.max;
        ext["MeanValue"] = serverStats.mean;
        ext["Sum"] = serverStats.sum;
        ext["ValueCount"] = serverStats.count;
      } else {
        // Fold the inline numeric samples into a small min/max/mean/sum
        // summary so consumers get value ranges without re-reading every
        // sample. The samples are inline (not a store-backed array), so this
        // is an in-memory single pass; use a manual loop rather than
        // Math.min(...arr) to stay safe for long series.
        let mn = Number.POSITIVE_INFINITY;
        let mx = Number.NEGATIVE_INFINITY;
        let sum = 0;
        let n = 0;
        for (const s of samples) {
          const raw =
            s?.value ?? s?.DoubleValue?.value ?? s?.doubleValue?.value;
          const v = typeof raw === "number" ? raw : Number(raw);
          if (!Number.isFinite(v)) {
            continue;
          }
          if (v < mn) mn = v;
          if (v > mx) mx = v;
          sum += v;
          n++;
        }
        if (n > 0) {
          ext["MinValue"] = mn;
          ext["MaxValue"] = mx;
          ext["MeanValue"] = sum / n;
          ext["Sum"] = sum;
          ext["ValueCount"] = n;
        }
      }
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
