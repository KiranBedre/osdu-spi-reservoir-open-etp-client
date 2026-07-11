/**
 * S2: Flatten well-log-in-model mapping
 *
 * Converts a RESQML 2.0 WellboreFrameRepresentation + all attached
 * ContinuousProperty/DiscreteProperty objects into a single
 * WPC--WellLog:1.3.0 with Curves[].
 *
 * This avoids the N+1 object explosion where each curve was a
 * separate OSDU record, and aligns with WITSML Log semantics.
 */
import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import { Energistics } from "../common/Etp12";
import type { IDataArray } from "../common/EtpTypes";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent, ResqmlResource } from "./WorkProductComponent";
import { isKnownPwlsProperty, getPropertyFromMnemonic } from "./PwlsCurveCatalog";

import { Data, WellLog, Curves } from "./Generated/work-product-component/WellLog.1.3.0";

/**
 * Extract OSDU WellLog WPC information from a RESQML 2.0 WellboreFrameRepresentation.
 * Gathers all properties attached to this frame and maps them as Curves[].
 */
export class WellboreFrameToWellLogOSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml20.obj_WellboreFrameRepresentation>>
  implements WellLog {
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_WellboreFrameRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "WellLog.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_WellboreFrameRepresentation>,
    client: ResqmlClient
  ): Promise<WellboreFrameToWellLogOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    // Resolve wellbore reference
    let wellboreSrn: string | undefined;
    if (xml.RepresentedInterpretation) {
      wellboreSrn = await ResqmlResource.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedInterpretation,
        client,
        context
      );
    }

    // Get the nodeCount for frame
    const nodeCount =
      typeof xml.NodeCount === "number"
        ? xml.NodeCount
        : typeof xml.NodeCount === "bigint"
          ? Number(xml.NodeCount)
          : undefined;

    // Build curves from attached properties
    const curves = await this.buildCurves(ReservoirDMSUrl, client, context);

    // Extract depth range from frame index array (best-effort)
    const depthRange = await this.extractDepthRange(ReservoirDMSUrl, xml, nodeCount, client);

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

      TopMeasuredDepth: depthRange?.top,
      BottomMeasuredDepth: depthRange?.bottom,
      SamplingStart: depthRange?.top,
      SamplingStop: depthRange?.bottom,
      SamplingInterval: depthRange?.interval,

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }

  /**
   * Extract depth range from the frame's index array (NodeMd).
   * Reads only the first and last array elements to avoid fetching
   * the entire depth column. Returns undefined if arrays are unavailable.
   */
  private async extractDepthRange(
    frameUri: string,
    xml: SimpleJson<resqml20.obj_WellboreFrameRepresentation>,
    nodeCount: number | undefined,
    client: ResqmlClient
  ): Promise<{ top: number; bottom: number; interval?: number } | undefined> {
    if (!nodeCount || nodeCount < 1) return undefined;
    try {
      const arrays = new Map<string, IDataArray>();
      client.findDataArrays(frameUri, xml as Record<string, any>, arrays);
      // The frame's first array reference is the NodeMd index
      const firstArray = Array.from(arrays.values())[0];
      if (!firstArray) return undefined;

      const { uri, pathInResource } = firstArray.uid;
      // Read first element
      const firstSub = await client.getDataSubarray(uri, pathInResource, [0], [1], false);
      // Read last element
      const lastSub = await client.getDataSubarray(uri, pathInResource, [nodeCount - 1], [1], false);

      const topVal = this.extractNumericValue(firstSub?.data);
      const bottomVal = this.extractNumericValue(lastSub?.data);
      if (topVal === undefined || bottomVal === undefined) return undefined;

      // Compute sampling interval for regular logs
      let interval: number | undefined;
      if (nodeCount > 1) {
        const computed = (bottomVal - topVal) / (nodeCount - 1);
        // Only report interval if it's positive (monotonically increasing depth)
        if (computed > 0) {
          interval = computed;
        }
      }

      return { top: topVal, bottom: bottomVal, interval };
    } catch {
      return undefined;
    }
  }

  /** Extract first numeric value from a DataArray response */
  private extractNumericValue(
    data: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArray | any | null | undefined
  ): number | undefined {
    if (!data?.data?.item) return undefined;
    const item = data.data.item;
    const arr =
      item._ArrayOfDouble?.values ??
      item._ArrayOfFloat?.values ??
      item._ArrayOfInt?.values ??
      item._ArrayOfLong?.values;
    if (arr && arr.length > 0) return Number(arr[0]);
    return undefined;
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

    // Get resources that target this frame (properties referencing the frame)
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

    // Resolve objects in batches
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

        // Extract UOM for continuous properties
        if (o.$type?.includes("ContinuousProperty")) {
          curve.CurveUnit = o.UOM ?? o.Uom ?? undefined;
        }

        // Extract property kind info — resolve via PWLS v4 when possible
        if (o.PropertyKind) {
          const pk = o.PropertyKind;
          const kindName = pk.Kind ?? pk.Title;
          if (kindName) {
            // Use PWLS-validated property name if it matches
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
      // If resolution fails, return whatever we have
    }

    return curves;
  }
}

export const WellboreFrameToWellLogManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_WellboreFrameRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WellboreFrameToWellLogOSDU> =>
  new WellboreFrameToWellLogOSDU(xml, context).initData(uri, xml, client);
