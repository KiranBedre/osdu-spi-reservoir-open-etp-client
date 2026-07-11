import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpUri, ResqmlClient } from "../client/ResqmlClient";

import { IDataSubarray } from "../common/EtpTypes";

import { OSDUContext } from "./OsduContext";
import {
  ResqmlWorkProductComponent,
  getIntegerValues,
  visitBooleanValues,
  visitIntegerValues
} from "./WorkProductComponent";

import {
  Abstract,
  FrameOfReferenceMetaDataItem,
  IjkGridRepresentation,
  StratigraphicUnits
} from "./Generated/work-product-component/IjkGridRepresentation.1.2.0";

enum ExpansionInDirection {
  I = "I",
  J = "J",
  K = "K"
}

/**
 * Extract OSDU IjkGridRepresentation information from RESQML IjkGridRepresentation
 *
 * @export
 * @class IjkGridRepresentationOSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml20.obj_IjkGridRepresentation>>}
 * @implements {IjkGridRepresentation}
 */
export class IjkGridRepresentationOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_IjkGridRepresentation>
  >
  implements IjkGridRepresentation {
  public data: Abstract = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml20.obj_IjkGridRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "IjkGridRepresentation.1.1.0");
  }

  private async activeCellCount(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_IjkGridRepresentation>,
    client: ResqmlClient
  ): Promise<number | undefined> {
    if (!xml.Geometry?.CellGeometryIsDefined) {
      return xml.Ni * xml.Nj * xml.Nk;
    }
    if (!this.__context?.useDataArrayForManifest) {
      return undefined;
    }
    try {
      let activeCellCount = 0;
      const dataspaceUri = EtpUri.createDataSpaceUri(
        new EtpUri(ReservoirDMSUrl).dataSpace
      ).uri;
      const dataobjectUri = EtpUri.createObjectUri(
        new EtpUri(ReservoirDMSUrl).dataSpace,
        "resqml",
        "2.0",
        `obj_IjkGridRepresentation`,
        xml.Uuid
      ).uri;

      // Search for the active property : https://docs.energistics.org/#RESQML/RESQML_TOPICS/RESQML-000-289-0-C-sv2010.html
      const assoc = await client.getSources(dataobjectUri, false, [
        `resqml20.obj_DiscreteProperty`
      ]);
      for (const a of assoc) {
        const associationUri = a.uri;
        if (a.uri) {
          const obj = await client.getObjects([associationUri]);
          if (obj.length !== 1) {
            continue;
          }
          const target = obj[0] as SimpleJson<resqml20.obj_DiscreteProperty>;
          if (target) {
            const pKind =
              target.PropertyKind.$type === "resqml20.LocalPropertyKind"
                ? (target.PropertyKind as SimpleJson<resqml20.LocalPropertyKind>)
                : undefined;
            if (pKind?.LocalPropertyKind.Title === "active") {
              const visitor = (
                nullValue: number | undefined,
                values: boolean[] | number[] | bigint[],
                _data: IDataSubarray
              ) => {
                for (const n of values) {
                  if (nullValue !== undefined && n === nullValue) {
                    continue;
                  } else if (n !== 0) {
                    activeCellCount++;
                  }
                }
              };

              for await (const patch of target.PatchOfValues) {
                await visitIntegerValues(
                  dataspaceUri,
                  patch.Values,
                  client,
                  visitor
                );
              }

              return activeCellCount;
            }
          }
        }
      }

      // Look for the CellGeometryIsDefined property if no active property found
      await visitBooleanValues(
        dataspaceUri,
        xml.Geometry?.CellGeometryIsDefined,
        client,
        (values: boolean[] | number[] | bigint[], _data: IDataSubarray) => {
          const v = values as boolean[];
          v.forEach(b => (activeCellCount += b ? 1 : 0));
        }
      );
      return activeCellCount;
    } catch (e) {
      return undefined;
    }
  }

  private async stratigraphicUnits(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_IjkGridRepresentation>,
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
            (await IjkGridRepresentationOSDU.dorToSrn(
              ReservoirDMSUrl,
              xml.IntervalStratigraphicUnits?.StratigraphicOrganization,
              client,
              context
            )) ?? "",
          StratigraphicUnitsIndices: stratiIndices.map(i => [i])
        };
      }
    } catch (e) {
      return undefined;
    }
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_IjkGridRepresentation>,
    client: ResqmlClient
  ): Promise<IjkGridRepresentationOSDU> {
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
        },
        {
          Count: (xml.Ni - 1) * (xml.Nj - 1) * (xml.Nk - 1),
          IndexableElementID: context.addReferenceData(
            "IndexableElement",
            "nodes"
          )
        }
      ],
      InterpretationID: await IjkGridRepresentationOSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedInterpretation,
        client,
        context
      ),
      InterpretationName: xml.RepresentedInterpretation?.Title,
      LocalModelCompoundCrsID: await IjkGridRepresentationOSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.Geometry?.LocalCrs,
        client,
        context
      ),
      RealizationIndex: (xml as any).RealizationIndex,
      TimeSeries: undefined,
      ActiveCellCount: await this.activeCellCount(ReservoirDMSUrl, xml, client),
      HasFiniteElementSubnodes: xml.Geometry?.SubnodeTopology !== undefined,
      HasNaNGeometry: undefined,
      ParentGridID: xml.ParentWindow
        ? await IjkGridRepresentationOSDU.dorToSrn(
          ReservoirDMSUrl,
          (xml.ParentWindow as any).ParentIjkGridRepresentation ??
          (xml.ParentWindow as any).ParentColumnLayerGridRepresentation,
          client,
          context
        )
        : undefined,
      RockFluidOrganizationInterpretationIDS: xml.CellFluidPhaseUnits
        ? [
          await IjkGridRepresentationOSDU.dorToSrn(
            ReservoirDMSUrl,
            xml.CellFluidPhaseUnits.FluidOrganization,
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
      HasSplitNode: xml.Geometry?.SplitNodes !== undefined,
      HasTruncations: (xml as any).TruncationCells !== undefined,
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

    this.assignExtraMetaData(xml.ExtraMetadata);

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
 * @param {SimpleJson<resqml20.obj_IjkGridRepresentation>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @returns {Promise<IjkGridRepresentationOSDU>}
 */
export const IjkGridRepresentationManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_IjkGridRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<IjkGridRepresentationOSDU> =>
  new IjkGridRepresentationOSDU(xml, context).initData(uri, xml, client);
