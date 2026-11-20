import * as prodml23 from "../mlTypes/xmlns/www.energistics.org/energyml/prodmlv23/prodmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import { Data } from "./Generated/work-product-component/GenericRepresentation.1.2.0";

/**
 * Convert PRODML 2.3 WellProductionParameters to an OSDU work-product-component.
 *
 * WellProductionParameters records the operating/production parameters of a
 * well over a period (choke, THP/THT, uptime, lift settings, etc.). OSDU has no
 * dedicated kind registered yet, so this projects onto the generic WPC envelope
 * and preserves the parameters in ExtensionProperties. The kind resolver
 * requests "WellProductionParameters" and falls back to GenericRepresentation.
 *
 * TODO(osdu-kinds): retarget to a dedicated OSDU production kind once available.
 */
export class WellProductionParametersOSDU extends ResqmlWorkProductComponent<
  SimpleJson<prodml23.WellProductionParameters>
> {
  public data: Data = {};

  constructor(
    xml: SimpleJson<prodml23.WellProductionParameters>,
    context: OSDUContext
  ) {
    super(xml, context, "GenericRepresentation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<prodml23.WellProductionParameters>,
    client: ResqmlClient
  ): Promise<WellProductionParametersOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const src = xml as any;

    // Derive the reporting period when start/end timestamps are present.
    const toIso = (v: any): string | undefined => {
      if (!v) return undefined;
      const d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    };
    const startDateTime = toIso(src.DTimStart ?? src.DateTime ?? src.Date);
    const endDateTime = toIso(src.DTimEnd) ?? startDateTime;

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      ExtensionProperties: undefined
    };

    const ext: Record<string, unknown> = {};
    if (startDateTime) {
      ext["StartDateTime"] = startDateTime;
    }
    if (endDateTime) {
      ext["EndDateTime"] = endDateTime;
    }
    if (src.Facility) {
      ext["Facility"] = Array.isArray(src.Facility)
        ? src.Facility.length
        : src.Facility;
    }
    if (src.PeriodKind) {
      ext["PeriodKind"] = src.PeriodKind;
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

export const WellProductionParametersManifest = async (
  uri: string,
  xml: SimpleJson<prodml23.WellProductionParameters>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WellProductionParametersOSDU> =>
  new WellProductionParametersOSDU(xml, context).initData(uri, xml, client);
