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
 * Convert PRODML 2.3 AssetProductionVolumes to an OSDU ProductionValues WPC.
 *
 * AssetProductionVolumes is the canonical reported/allocated production-volume
 * container (per-facility, per-period product volumes). OSDU has no dedicated
 * "AssetProductionVolumes" kind yet, so it is projected onto the closest
 * existing kind, ProductionValues:1.1.1, with the structural period/facility
 * metadata preserved in ExtensionProperties for round-trip.
 *
 * TODO(osdu-kinds): when a dedicated OSDU production-volumes kind is registered
 * in MilestoneKinds, retarget this converter to it.
 */
export class AssetProductionVolumesOSDU
  extends ResqmlWorkProductComponent<SimpleJson<prodml23.AssetProductionVolumes>>
  implements ProductionValues
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<prodml23.AssetProductionVolumes>,
    context: OSDUContext
  ) {
    super(xml, context, "ProductionValues.1.1.1");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<prodml23.AssetProductionVolumes>,
    client: ResqmlClient
  ): Promise<AssetProductionVolumesOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const src = xml as any;

    // AssetProductionVolumes carries a period/facility date; derive the range.
    let startDateTime: string | undefined;
    let endDateTime: string | undefined;
    const dateVal = src.Date ?? src.DateTime;
    if (dateVal) {
      const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
      if (!Number.isNaN(d.getTime())) {
        startDateTime = d.toISOString();
        endDateTime = d.toISOString();
      }
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      StartDateTime: startDateTime,
      EndDateTime: endDateTime,
      PropertyIDs: undefined,
      ExtensionProperties: undefined
    };

    // Preserve PRODML-specific structure for round-trip / lineage.
    const ext: Record<string, unknown> = {};
    if (src.Facility) {
      ext["Facility"] = Array.isArray(src.Facility)
        ? src.Facility.length
        : src.Facility;
    }
    if (Array.isArray(src.ProductionVolume)) {
      ext["ProductionVolumeCount"] = src.ProductionVolume.length;
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

export const AssetProductionVolumesManifest = async (
  uri: string,
  xml: SimpleJson<prodml23.AssetProductionVolumes>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<AssetProductionVolumesOSDU> =>
  new AssetProductionVolumesOSDU(xml, context).initData(uri, xml, client);
