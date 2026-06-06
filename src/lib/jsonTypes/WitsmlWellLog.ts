import * as witsml21 from "../mlTypes/xmlns/www.energistics.org/energyml/witsmlv21/witsmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent, ResqmlResource } from "./WorkProductComponent";
import { getPropertyFromMnemonic, isKnownPwlsProperty } from "./PwlsCurveCatalog";

import { Data, WellLog, Curves } from "./Generated/work-product-component/WellLog.1.3.0";

/**
 * Extract OSDU WellLog WPC information from WITSML Log
 *
 * @export
 * @class WitsmlWellLogOSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<witsml21.Log>>}
 * @implements {WellLog}
 */
export class WitsmlWellLogOSDU
  extends ResqmlWorkProductComponent<SimpleJson<witsml21.Log>>
  implements WellLog
{
  public data: Data = {};

  constructor(xml: SimpleJson<witsml21.Log>, context: OSDUContext) {
    super(xml, context, "WellLog.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<witsml21.Log>,
    client: ResqmlClient
  ): Promise<WitsmlWellLogOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    let wellboreSrn: string | undefined;
    if (xml.Wellbore) {
      wellboreSrn = await ResqmlResource.dorToSrn(
        ReservoirDMSUrl,
        xml.Wellbore,
        client,
        context
      );
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      WellboreID: wellboreSrn,

      // Extract curves from ChannelSets with PWLS mnemonic resolution
      Curves: WitsmlWellLogOSDU.buildCurves(xml, context),

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }

  /**
   * Build WellLog Curves[] from WITSML ChannelSet/Channel structure.
   * Resolves curve mnemonics to PWLS v4 standard property names where possible.
   */
  private static buildCurves(
    xml: SimpleJson<witsml21.Log>,
    context: OSDUContext
  ): Curves[] | undefined {
    const curves: Curves[] = [];

    const channelSets = (xml as any).ChannelSet;
    if (!Array.isArray(channelSets)) return undefined;

    for (const cs of channelSets) {
      const channels = cs.Channel;
      if (!Array.isArray(channels)) continue;

      for (const ch of channels) {
        const mnemonic: string = ch.Mnemonic ?? ch.Citation?.Title ?? "";
        if (!mnemonic) continue;

        const curve: Curves = {
          CurveID: ch.Uuid ?? mnemonic,
          Mnemonic: mnemonic,
          CurveDescription: ch.Citation?.Description ?? ch.Citation?.Title,
          CurveUnit: ch.Uom ?? undefined,
          LogCurveMainFamilyID: undefined
        };

        // Resolve property kind — prefer ChannelPropertyKind.Title, then PWLS mnemonic lookup
        const pkTitle: string | undefined =
          ch.ChannelPropertyKind?.Title ?? ch.ChannelPropertyKind?.Uuid;

        if (pkTitle && isKnownPwlsProperty(pkTitle)) {
          curve.LogCurveMainFamilyID = context.addReferenceData(
            "CurveMainFamily",
            pkTitle
          );
        } else {
          // Try PWLS mnemonic resolution (vendor catalog must be loaded for full coverage)
          const resolved = getPropertyFromMnemonic(mnemonic);
          if (resolved) {
            curve.LogCurveMainFamilyID = context.addReferenceData(
              "CurveMainFamily",
              resolved
            );
          } else if (pkTitle) {
            // Fallback: use raw property kind title
            curve.LogCurveMainFamilyID = context.addReferenceData(
              "CurveMainFamily",
              pkTitle
            );
          }
        }

        curves.push(curve);
      }
    }

    return curves.length > 0 ? curves : undefined;
  }
}

export const WitsmlWellLogManifest = async (
  uri: string,
  xml: SimpleJson<witsml21.Log>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WitsmlWellLogOSDU> =>
  new WitsmlWellLogOSDU(xml, context).initData(uri, xml, client);
