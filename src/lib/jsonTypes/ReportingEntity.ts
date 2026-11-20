import * as prodml23 from "../mlTypes/xmlns/www.energistics.org/energyml/prodmlv23/prodmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import { Data } from "./Generated/work-product-component/GenericRepresentation.1.2.0";

/**
 * Convert PRODML 2.3 ReportingEntity to an OSDU work-product-component.
 *
 * A ReportingEntity is the named thing (well, wellbore, field, facility, PU)
 * that production volumes are reported against. Conceptually it is closer to an
 * OSDU master-data identity, but no dedicated OSDU reporting-entity kind is
 * registered yet, so this projects onto the generic WPC envelope and preserves
 * the entity kind/name in ExtensionProperties. The kind resolver requests
 * "ReportingEntity" and gracefully falls back to GenericRepresentation.
 *
 * TODO(osdu-kinds): retarget to the appropriate OSDU master-data/facility kind
 * once registered in MilestoneKinds.
 */
export class ReportingEntityOSDU extends ResqmlWorkProductComponent<
  SimpleJson<prodml23.ReportingEntity>
> {
  public data: Data = {};

  constructor(
    xml: SimpleJson<prodml23.ReportingEntity>,
    context: OSDUContext
  ) {
    super(xml, context, "GenericRepresentation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<prodml23.ReportingEntity>,
    client: ResqmlClient
  ): Promise<ReportingEntityOSDU> {
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
    if (src.Name) {
      ext["Name"] = src.Name;
    }
    if (src.EntityKind) {
      ext["EntityKind"] = src.EntityKind;
    }
    if (Object.keys(ext).length > 0) {
      this.data.ExtensionProperties = ext;
    }

    this.assignExtraMetaData(src.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

export const ReportingEntityManifest = async (
  uri: string,
  xml: SimpleJson<prodml23.ReportingEntity>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<ReportingEntityOSDU> =>
  new ReportingEntityOSDU(xml, context).initData(uri, xml, client);
