import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpUri, ResqmlClient } from "../client/ResqmlClient";

import { IDataSubarray } from "../common/EtpTypes";

import { OSDUContext } from "./OsduContext";
import {
  ResqmlWorkProductComponent,
  getIntegerValues,
  visitBooleanValues
} from "./WorkProductComponent";

import {
  Abstract,
  FrameOfReferenceMetaDataItem,
  IjkGridRepresentation,
  StratigraphicUnits
} from "./Generated/work-product-component/IjkGridRepresentation.1.2.0";
import { context } from "../cxml/cxml";

enum ExpansionInDirection {
  I = "I",
  J = "J",
  K = "K"
}

/**
 * Extract OSDU IjkGridRepresentation information from RESQML IjkGridRepresentation
 *
 * @export
 * @class IjkGridRepresentation22OSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml22.IjkGridRepresentation>>}
 * @implements {IjkGridRepresentation}
 */
export class IjkGridRepresentation22OSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml22.IjkGridRepresentation>>
  implements IjkGridRepresentation {
  public data: Abstract = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml22.IjkGridRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "IjkGridRepresentation.1.2.0");
  }

  private async activeCellCount(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.IjkGridRepresentation>,
    client: ResqmlClient
  ): Promise<number | undefined> {
    if (!xml.Geometry?.CellGeometryIsDefined) {
      return xml.Ni * xml.Nj * xml.Nk;
    }
    if (!this.__context?.useDataArrayForManifest) {
      return undefined;
    }
    try {
      let count = 0;
      const dataspaceUri = EtpUri.createDataSpaceUri(
        new EtpUri(ReservoirDMSUrl).dataSpace
      ).uri;
      await visitBooleanValues(
        dataspaceUri,
        xml.Geometry?.CellGeometryIsDefined,
        client,
        (values: boolean[] | number[] | bigint[], _data: IDataSubarray) => {
          const v = values as boolean[];
          v.forEach(b => (count += b ? 1 : 0));
        }
      );
      return count;
    } catch (e) {
      return undefined;
    }
  }

  private async stratigraphicUnits(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.IjkGridRepresentation>,
    client: ResqmlClient
  ): Promise<StratigraphicUnits | undefined> {
    try {
      const dataspaceUri = EtpUri.createDataSpaceUri(
        new EtpUri(ReservoirDMSUrl).dataSpace
      ).uri;
      const stratiIndices = xml.IntervalStratigraphicUnits?.UnitIndices
        ? await getIntegerValues(
          dataspaceUri,
          xml.IntervalStratigraphicUnits?.UnitIndices,
          client
        )
        : undefined;

      const context = this.__context;
      if (stratiIndices && context) {
        return {
          StratigraphicColumnRankInterpretationID:
            (await IjkGridRepresentation22OSDU.dorToSrn(
              ReservoirDMSUrl,
              xml.IntervalStratigraphicUnits
                ?.StratigraphicOrganizationInterpretation,
              client,
              context
            )) || "",
          StratigraphicUnitsIndices: stratiIndices.map(i => [i])
        };
      }
    } catch (e) {
      return undefined;
    }
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.IjkGridRepresentation>,
    client: ResqmlClient
  ): Promise<IjkGridRepresentation22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    const dataspaceUri = EtpUri.createDataSpaceUri(
      new EtpUri(ReservoirDMSUrl).dataSpace
    );

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      IndexableElementCount: [
        {
          Count: xml.Ni * xml.Nj * xml.Nk,
          IndexableElementID: context.addReferenceData(
            "IndexableElement",
            "cells"
          )
        }
      ],
      InterpretationID: await IjkGridRepresentation22OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedObject,
        client,
        context
      ),
      InterpretationName: xml.RepresentedObject?.Title,
      LocalModelCompoundCrsID: await IjkGridRepresentation22OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.Geometry?.LocalCrs,
        client,
        context
      ),
      RealizationIndex: xml.RealizationIndex,
      TimeSeries: undefined,
      ActiveCellCount: await this.activeCellCount(ReservoirDMSUrl, xml, client),
      HasFiniteElementSubnodes:
        xml.Geometry?.ColumnLayerSubnodeTopology !== undefined,
      HasNaNGeometry: undefined,
      ParentGridID: xml.ParentWindow
        ? await IjkGridRepresentation22OSDU.dorToSrn(
          ReservoirDMSUrl,
          (xml.ParentWindow as any).ParentIjkGridRepresentation ??
          (xml.ParentWindow as any).ParentColumnLayerGridRepresentation,
          client,
          context
        )
        : undefined,
      RockFluidOrganizationInterpretationIDS: xml.CellFluidPhaseUnits
        ? [
          await IjkGridRepresentation22OSDU.dorToSrn(
            ReservoirDMSUrl,
            xml.CellFluidPhaseUnits.RockFluidOrganizationInterpretation,
            client,
            context
          )
        ].filter((x): x is string => x !== undefined)
        : undefined,
      StratigraphicUnits: await this.stratigraphicUnits(
        ReservoirDMSUrl,
        xml,
        client
      ),
      ExpansionInDirection: ExpansionInDirection.K,
      HasCollocatedNodeInKDirection:
        xml.Geometry?.NodeIsColocatedInKDirection !== undefined,
      HasKGaps:
        xml.KGaps && xml.KGaps.Count !== undefined && xml.KGaps.Count > 0,
      HasLateralGaps: xml.Geometry?.IjGaps !== undefined,
      HasParametricGeometry:
        xml.Geometry?.Points.$type === "Point3dParametricArray",
      HasNoGeometry: xml.Geometry === undefined,
      HasSplitNode: xml.Geometry?.SplitNodePatch !== undefined,
      HasTruncations: (xml as any).TruncationCellPatch !== undefined,
      KDirectionID: context.addReferenceData(
        "KDirectionType",
        xml.Geometry?.KDirection.replace(" ", "%20")
      ),
      Ni: xml.Ni,
      Nj: xml.Nj,
      Nk: xml.Nk,
      PillarShapeID: context.addReferenceData(
        "PillarShapeType",
        xml.Geometry?.PillarShape
      ), //"vertical" | "straight" | "curved"
      IsRadial: xml.RadialGridIsComplete,
      IsRightHanded: xml.Geometry?.GridIsRighthanded,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    if (xml.Geometry) {
      const si = await ResqmlWorkProductComponent.createSpatialInfo(
        client,
        dataspaceUri.uri,
        [xml.Geometry],
        context
      );

      this.data.SpatialPoint = si.SpatialPoint;
      this.data.SpatialArea = si.SpatialArea;
      this.meta = [si.FrameOfReferenceCRS];
    }

    delete this.__context;
    return this;
  }
}

/**
 * Convert RESQML IjkGridRepresentation to OSDU type
 *
 * @param {string} uri
 * @param {SimpleJson<resqml22.IjkGridRepresentation>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @return {Promise<IjkGridRepresentationOSDU>}
 */
export const IjkGridRepresentation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.IjkGridRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<IjkGridRepresentation22OSDU> =>
  new IjkGridRepresentation22OSDU(xml, context).initData(uri, xml, client);
