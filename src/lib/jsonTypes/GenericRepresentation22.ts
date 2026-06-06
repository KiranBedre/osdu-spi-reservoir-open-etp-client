import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpUri, ResqmlClient } from "../client/ResqmlClient";

import { OSDUContext } from "./OsduContext";
import {
  getGeometries,
  ResqmlWorkProductComponent
} from "./WorkProductComponent";

import {
  Data,
  FrameOfReferenceMetaDataItem,
  GenericRepresentation
} from "./Generated/work-product-component/GenericRepresentation.1.2.0";

export class GenericRepresentation22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.AbstractSurfaceRepresentation>
  >
  implements GenericRepresentation
{
  public data: Data = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml22.AbstractSurfaceRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "GenericRepresentation.1.2.0");
  }

  private elementCount(xml: SimpleJson<resqml22.AbstractRepresentation>):
    | undefined
    | {
        Count: number;
        IndexableElementID: string; //this.reference("IndexableElement", "cells")
      }[] {
    if (this.__context === undefined) {
      return undefined;
    }
    const context = this.__context;
    if (xml.$type === "resqml22.Grid2dRepresentation") {
      const grid2d = xml as SimpleJson<resqml22.Grid2dRepresentation>;
      return [
        {
          Count: (grid2d.FastestAxisCount - 1) * (grid2d.SlowestAxisCount - 1),
          IndexableElementID:
            context.addReferenceData("IndexableElement", "cells") || ""
        }
      ];
    } else if (xml.$type === "resqml22.TriangulatedSetRepresentation") {
      const trig = xml as SimpleJson<resqml22.TriangulatedSetRepresentation>;
      let Count = 0;
      let NodeCount = 0;
      trig.TrianglePatch.forEach(p => {
        if (p.Triangles.Statistics?.length === 1) {
          Count += p.Triangles.Statistics[0]?.ValidValueCount
            ? p.Triangles.Statistics[0]?.ValidValueCount
            : 0;
        }
        NodeCount += p.NodeCount;
      });
      const elements = [
        {
          Count: NodeCount,
          IndexableElementID:
            context.addReferenceData("IndexableElement", "nodes") || ""
        }
      ];
      if (Count > 0) {
        elements.push({
          Count,
          IndexableElementID:
            context.addReferenceData("IndexableElement", "cells") || ""
        });
      }
      return elements;
    } else if (xml.$type === "resqml22.PolylineSetRepresentation") {
      const polyLine = xml as SimpleJson<resqml22.PolylineSetRepresentation>;
      let Count = 0;
      let NodeCount = 0;
      polyLine.LinePatch.forEach(p => {
        NodeCount = p.NodeCount;
        Count += p.ClosedPolylines ? p.NodeCount : p.NodeCount - 1;
      });
      return [
        {
          Count: NodeCount,
          IndexableElementID:
            context.addReferenceData("IndexableElement", "nodes") || ""
        },
        {
          Count,
          IndexableElementID:
            context.addReferenceData("IndexableElement", "edges") || ""
        }
      ];
    } else if (xml.$type === "resqml22.PointSetRepresentation") {
      const points = xml as SimpleJson<resqml22.PointSetRepresentation>;
      let NodeCount = 0;
      const patches = points.NodePatchGeometry
        ? Array.isArray(points.NodePatchGeometry)
          ? points.NodePatchGeometry
          : [points.NodePatchGeometry]
        : [];
      patches.forEach(p => {
        if (p?.Points) {
          try {
            const arr = this.arrayInfos(p.Points);
            if (arr.rowCount) {
              NodeCount += arr.rowCount / 3;
            }
          } catch {
            // Array data not fully resolved — skip
          }
        }
      });
      return NodeCount
        ? [
            {
              Count: NodeCount,
              IndexableElementID:
                context.addReferenceData("IndexableElement", "nodes") || ""
            }
          ]
        : undefined;
    } else if (xml.$type === "resqml22.PolylineRepresentation") {
      const line = xml as SimpleJson<resqml22.PolylineRepresentation>;
      const arr = this.arrayInfos(line.NodePatchGeometry.Points);
      const NodeCount = arr.rowCount ? arr.rowCount / 3 : undefined;
      const Count =
        line.IsClosed || NodeCount === undefined ? NodeCount : NodeCount - 1;
      return NodeCount && Count
        ? [
            {
              Count: NodeCount,
              IndexableElementID:
                context.addReferenceData("IndexableElement", "nodes") || ""
            },
            {
              Count,
              IndexableElementID:
                context.addReferenceData("IndexableElement", "edges") || ""
            }
          ]
        : undefined;
    }
    return undefined;
  }

  /**
   * Map RESQML representation type to OSDU representation type
   * @param str
   * @returns
   */
  private mapRepresentationType(type: string | undefined): string {
    switch (type) {
      case "Grid2dRepresentation":
        return "Regular2DGrid";
      case "TriangulatedSetRepresentation":
        return "TriangulatedSurface";
      case "PolylineSetRepresentation":
        return "PolylineSet";
      case "PointSetRepresentation":
        return "PointSet";
      case "PolylineRepresentation":
        return "Polyline";
      default:
        return type?.replace("Representation", "") || "";
    }
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.AbstractRepresentation>,
    client: ResqmlClient
  ): Promise<GenericRepresentation22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    let Role = undefined;
    if ("SurfaceRole" in xml) {
      Role = (xml as any).SurfaceRole;
    } else if ("LineRole" in xml) {
      Role = (xml as any).LineRole;
    }
    const geometries = getGeometries(xml);
    let repType = xml.$type?.split(".")[1];
    if (repType?.startsWith("obj)")) {
      repType = repType.slice(4);
    }
    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      IndexableElementCount: this.elementCount(xml),
      InterpretationID: await GenericRepresentation22OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedObject,
        client,
        context
      ),
      InterpretationName: xml.RepresentedObject?.Title,
      LocalModelCompoundCrsID:
        geometries.length > 0
          ? await GenericRepresentation22OSDU.dorToSrn(
              ReservoirDMSUrl,
              geometries[0].LocalCrs,
              client,
              context
            )
          : undefined,
      RealizationIndex: undefined,
      Role: context.addReferenceData(
        "RepresentationRole",
        this.capitalize(Role)
      ),
      Type: context.addReferenceData(
        "RepresentationType",
        this.mapRepresentationType(repType)
      ),
      TimeSeries: undefined, //{ TimeIndex: 0, TimeSeriesID: "" },

      ExtensionProperties: undefined
    };

    const dors = await this.getCreatingObjects(client, ReservoirDMSUrl);
    if (dors.length > 0) {
      this.data.LineageAssertions = [];
      for (const d of dors) {
        const l = await GenericRepresentation22OSDU.dorToSrn(
          ReservoirDMSUrl,
          d,
          client,
          context
        );
        if (l !== undefined) {
          this.data.LineageAssertions.push({ ID: l });
        }
      }
    }

    this.assignExtraMetaData(xml.ExtensionNameValue);

    if (geometries.length > 0) {
      const dataspaceUri = EtpUri.createDataSpaceUri(
        new EtpUri(ReservoirDMSUrl).dataSpace
      );
      const { SpatialPoint, SpatialArea, FrameOfReferenceCRS, NodeCount } =
        await ResqmlWorkProductComponent.createSpatialInfo(
          client,
          dataspaceUri.uri,
          geometries,
          context
        );

      this.data.SpatialPoint = SpatialPoint;
      this.data.SpatialArea = SpatialArea;
      this.meta = [FrameOfReferenceCRS];

      if (this.data.IndexableElementCount === undefined) {
        this.data.IndexableElementCount = [];
      }
      if (NodeCount !== undefined) {
        this.data.IndexableElementCount?.push({
          Count: NodeCount,
          IndexableElementID: context.addReferenceData(
            "IndexableElement",
            "nodes"
          )
        });
      }
    }
    delete this.__context;
    return this;
  }
}

/**
 * Identify OSDU kind for Representation, can create either a SeismicFault, SeismicHorizon or GenericRepresentation
 *
 * @param {IResqmlDataObject} xml
 * @return {string}
 */
export const GenericRepresentation22ToOsduKind = (
  xml: SimpleJson<resqml22.AbstractRepresentation>
): string => {
  const genRep = xml as SimpleJson<resqml22.AbstractRepresentation>;
  if (
    genRep.RepresentedObject?.QualifiedType === "resqml22.FaultInterpretation"
  ) {
    const geometries = getGeometries(xml);
    for (const p of geometries) {
      if (p.SeismicCoordinates !== undefined) {
        return "osdu:wks:work-product-component--SeismicFault.2.0.0";
      }
    }
  }
  return "osdu:wks:work-product-component--GenericRepresentation:1.1.0";
};

export const GenericRepresentation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.AbstractSurfaceRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<GenericRepresentation22OSDU> =>
  new GenericRepresentation22OSDU(xml, context).initData(uri, xml, client);
