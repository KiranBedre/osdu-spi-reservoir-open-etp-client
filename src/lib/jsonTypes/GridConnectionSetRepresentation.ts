import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import { Energistics } from "../common/Etp12";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  GridConnectionSetRepresentation
} from "./Generated/work-product-component/GridConnectionSetRepresentation.1.2.0";

/**
 * Extract OSDU GridConnectionSetRepresentation information from RESQML GridConnectionSetRepresentation
 *
 * @export
 * @class GridConnectionSetRepresentationOSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml20.obj_GridConnectionSetRepresentation>>}
 * @implements {GridConnectionSetRepresentation}
 */
export class GridConnectionSetRepresentationOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_GridConnectionSetRepresentation>
  >
  implements GridConnectionSetRepresentation {
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_GridConnectionSetRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "GridConnectionSetRepresentation.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_GridConnectionSetRepresentation>,
    client: ResqmlClient
  ): Promise<GridConnectionSetRepresentationOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    const gridUris = xml.Grid.map(d =>
      ResqmlWorkProductComponent.dorToUri(ReservoirDMSUrl, d)
    );
    const grids = await client.getResolvedObjects(gridUris);

    const InterpretationIDs = [];
    for (const gr of grids) {
      InterpretationIDs.push(
        (await GridConnectionSetRepresentationOSDU.dorToSrn(
          ReservoirDMSUrl,
          (gr as SimpleJson<resqml20.AbstractRepresentation>)
            .RepresentedInterpretation,
          client,
          context
        )) ?? ""
      );
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      IndexableElementCount: [
        {
          Count: xml.Count,
          IndexableElementID: context.addReferenceData(
            "IndexableElement",
            "contacts"
          )
        }
      ],
      InterpretationID: await GridConnectionSetRepresentationOSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedInterpretation,
        client,
        context
      ),
      InterpretationName: xml.RepresentedInterpretation?.Title,
      LocalModelCompoundCrsID: undefined,
      RealizationIndex: undefined,
      TimeSeries: undefined, //{ TimeIndex: 0, TimeSeriesID: "" },
      ConnectionCount: xml.Count,
      GridRepresentationIDs: gridUris.map((g, i) => {
        const gr = grids[i];
        if (gr !== null) {
          return `${context.uriToSrn(g, gr)}:`;
        }
        return "";
      }),

      InterpretationIDs: InterpretationIDs.filter(a => a !== ""),
      ExtensionProperties: await this.detectTransmissibility(ReservoirDMSUrl, client)
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }

  /**
   * Detect whether transmissibility multiplier properties are attached to
   * this connection set. Returns ExtensionProperties if found, else undefined.
   */
  private async detectTransmissibility(
    uri: string,
    client: ResqmlClient
  ): Promise<{ [key: string]: any } | undefined> {
    try {
      const related = await client.getResources(
        uri,
        Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.sources
      );
      const transmProps = related.filter(
        (r: any) =>
          r.uri.includes("ContinuousProperty") &&
          (r.name?.toLowerCase().includes("transmissibility") ||
            r.name?.toLowerCase().includes("trans"))
      );
      if (transmProps.length === 0) return undefined;
      return {
        HasTransmissibilityMultipliers: true,
        TransmissibilityPropertyCount: transmProps.length
      };
    } catch {
      return undefined;
    }
  }
}

/**
 * Convert RESQML GridConnectionSetRepresentation to OSDU type
 *
 * @param {string} uri
 * @param {SimpleJson<resqml20.obj_GridConnectionSetRepresentation>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @returns {Promise<GridConnectionSetRepresentationOSDU>}
 */
export const GridConnectionSetRepresentationManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_GridConnectionSetRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<GridConnectionSetRepresentationOSDU> =>
  new GridConnectionSetRepresentationOSDU(xml, context).initData(
    uri,
    xml,
    client
  );
