/**
 * S2: Flatten well-log-in-model mapping (RESQML 2.2)
 *
 * Converts a RESQML 2.2 WellboreFrameRepresentation + all attached
 * ContinuousProperty/DiscreteProperty objects into a single
 * WPC--WellLog:1.3.0 with Curves[].
 */
import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import { Energistics } from "../common/Etp12";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent, ResqmlResource } from "./WorkProductComponent";
import { isKnownPwlsProperty, getPropertyFromMnemonic } from "./PwlsCurveCatalog";

import { Data, WellLog, Curves } from "./Generated/work-product-component/WellLog.1.3.0";

/**
 * Extract OSDU WellLog WPC information from a RESQML 2.2 WellboreFrameRepresentation.
 * Gathers all properties attached to this frame and maps them as Curves[].
 */
export class WellboreFrameToWellLog22OSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml22.WellboreFrameRepresentation>>
  implements WellLog
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml22.WellboreFrameRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "WellLog.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.WellboreFrameRepresentation>,
    client: ResqmlClient
  ): Promise<WellboreFrameToWellLog22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    // Resolve wellbore reference (v2.2 uses RepresentedObject)
    let wellboreSrn: string | undefined;
    const repObj = (xml as any).RepresentedObject ?? (xml as any).RepresentedInterpretation;
    if (repObj) {
      wellboreSrn = await ResqmlResource.dorToSrn(
        ReservoirDMSUrl,
        repObj,
        client,
        context
      );
    }

    // Build curves from attached properties
    const curves = await this.buildCurves(ReservoirDMSUrl, client, context);

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      WellboreID: wellboreSrn,
      Curves: curves.length > 0 ? curves : undefined,
      IsRegular: false,
      SamplingDomainTypeID: context.addReferenceData(
        "SamplingDomainType",
        "MeasuredDepth"
      ),

      TopMeasuredDepth: undefined,
      BottomMeasuredDepth: undefined,
      SamplingStart: undefined,
      SamplingStop: undefined,
      SamplingInterval: undefined,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }

  /**
   * Find all properties in the dataspace that reference this frame
   * and build WellLog Curves[] entries from them.
   */
  private async buildCurves(
    frameUri: string,
    client: ResqmlClient,
    context: OSDUContext
  ): Promise<Curves[]> {
    const curves: Curves[] = [];

    let relatedUris: string[];
    try {
      const related = await client.getResources(
        frameUri,
        Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.sources
      );
      relatedUris = related
        .filter(
          (r: any) =>
            r.uri.includes("ContinuousProperty") ||
            r.uri.includes("DiscreteProperty") ||
            r.uri.includes("CategoricalProperty")
        )
        .map((r: any) => r.uri);
    } catch {
      return curves;
    }

    if (relatedUris.length === 0) {
      return curves;
    }

    const objects = new Map<string, any>();
    const batch = relatedUris.slice(0, 50);
    try {
      const resolved = await client.getResolvedObjects(batch, objects, false);
      for (const obj of resolved) {
        if (obj === null || obj === undefined) continue;
        const o = obj as any;

        const curve: Curves = {
          CurveID: o.Uuid ?? o.Citation?.Title,
          CurveDescription: o.Citation?.Description ?? o.Citation?.Title,
          LogCurveMainFamilyID: undefined,
          CurveUnit: undefined,
          Mnemonic: o.Citation?.Title
        };

        // v2.2 uses Uom
        if (o.$type?.includes("ContinuousProperty") && o.Uom) {
          curve.CurveUnit = o.Uom;
        }

        // Property kind info — resolve via PWLS v4 when possible
        if (o.PropertyKind) {
          const pk = o.PropertyKind;
          const kindName = pk.Title ?? pk.Kind;
          if (kindName) {
            const pwlsProperty = isKnownPwlsProperty(kindName)
              ? kindName
              : undefined;
            curve.LogCurveMainFamilyID = context.addReferenceData(
              "CurveMainFamily",
              pwlsProperty ?? kindName
            );
          }
        }

        // Fallback: if no PropertyKind but mnemonic resolves via PWLS vendor catalog
        if (!curve.LogCurveMainFamilyID && curve.Mnemonic) {
          const resolved = getPropertyFromMnemonic(curve.Mnemonic);
          if (resolved) {
            curve.LogCurveMainFamilyID = context.addReferenceData(
              "CurveMainFamily",
              resolved
            );
          }
        }

        curves.push(curve);
      }
    } catch {
      // Return whatever we have
    }

    return curves;
  }
}

export const WellboreFrameToWellLog22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.WellboreFrameRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WellboreFrameToWellLog22OSDU> =>
  new WellboreFrameToWellLog22OSDU(xml, context).initData(uri, xml, client);
