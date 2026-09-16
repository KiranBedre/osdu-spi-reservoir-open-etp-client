import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpUri, IResqmlDataObject, ResqmlClient } from "../client/ResqmlClient";

import { getKind, getKindOrFallback } from "./MilestoneKinds";
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
  implements GenericRepresentation {
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
      const points = xml as any;
      let NodeCount = 0;
      const patches: any[] = points.NodePatchGeometry
        ? Array.isArray(points.NodePatchGeometry)
          ? points.NodePatchGeometry
          : [points.NodePatchGeometry]
        : [];
      patches.forEach((p: any) => {
        if (p?.Points) {
          try {
            const arr = this.arrayInfos(p.Points);
            if (arr.rowCount) {
              NodeCount += arr.rowCount / 3;
            }
          } catch {
            // Array data not fully resolved - skip
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
      const line = xml as any;
      const geom = line.NodePatchGeometry || line.NodePatch?.Geometry;
      if (!geom?.Points) return undefined;
      const arr = this.arrayInfos(geom.Points);
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
        geometries.length > 0 && geometries[0]?.LocalCrs
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

    // Enrich Name: prefix with InterpretationName (feature/horizon/fault)
    // when the Citation.Title is just a workflow step name.
    const interpName = this.data.InterpretationName;
    if (interpName && this.data.Name && !this.data.Name.startsWith(interpName)) {
      this.data.Name = `${interpName} \u2014 ${this.data.Name}`;
    }

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

      // For Grid2d objects, try analytical lattice-based bounding box first
      let spatialResolved = false;
      if (xml.$type === "resqml22.Grid2dRepresentation") {
        const grid2d = xml as SimpleJson<resqml22.Grid2dRepresentation>;
        const geo = grid2d.Geometry;

        let lattice: any = undefined;
        if (geo?.Points?.$type === "resqml22.Point3dLatticeArray") {
          lattice = geo.Points;
        } else if (geo?.Points?.$type === "resqml22.Point3dZValueArray") {
          const zArr = geo.Points as any;
          if (zArr.SupportingGeometry?.$type === "resqml22.Point3dLatticeArray") {
            lattice = zArr.SupportingGeometry;
          }
        }

        if (lattice && lattice.Dimension?.length >= 2) {
          const dim0 = lattice.Dimension[0];
          const dim1 = lattice.Dimension[1];
          const dir0 = dim0.Direction;
          const dir1 = dim1.Direction;
          const sp0 = dim0.Spacing?.Value ?? 1;
          const sp1 = dim1.Spacing?.Value ?? 1;
          const countJ = grid2d.SlowestAxisCount - 1;
          const countI = grid2d.FastestAxisCount - 1;
          const ox = lattice.Origin.Coordinate1;
          const oy = lattice.Origin.Coordinate2;
          const stepJ = [dir0.Coordinate1 * sp0, dir0.Coordinate2 * sp0];
          const stepI = [dir1.Coordinate1 * sp1, dir1.Coordinate2 * sp1];

          const corners: [number, number][] = [
            [ox, oy],
            [ox + stepI[0] * countI, oy + stepI[1] * countI],
            [
              ox + stepI[0] * countI + stepJ[0] * countJ,
              oy + stepI[1] * countI + stepJ[1] * countJ
            ],
            [ox + stepJ[0] * countJ, oy + stepJ[1] * countJ]
          ];

          const minX = Math.min(...corners.map(c => c[0]));
          const maxX = Math.max(...corners.map(c => c[0]));
          const minY = Math.min(...corners.map(c => c[1]));
          const maxY = Math.max(...corners.map(c => c[1]));

          const crsObj = await GenericRepresentation22OSDU.getObjectFromDor(
            client,
            dataspaceUri.uri,
            geo.LocalCrs,
            context
          );

          if (crsObj) {
            const bboxRing: [number, number][] = [
              [minX, minY],
              [maxX, minY],
              [maxX, maxY],
              [minX, maxY],
              [minX, minY]
            ];

            const {
              SpatialPoint,
              SpatialArea,
              FrameOfReferenceCRS
            } = await GenericRepresentation22OSDU.createSpatialInfoFrom2dPoints(
              client,
              dataspaceUri.uri,
              bboxRing,
              crsObj as any,
              context
            );

            this.data.SpatialPoint = SpatialPoint;
            this.data.SpatialArea = SpatialArea;
            this.meta = [FrameOfReferenceCRS];
            spatialResolved = true;
          }
        }
      }

      if (!spatialResolved) {
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

        if (NodeCount !== undefined) {
          if (this.data.IndexableElementCount === undefined) {
            this.data.IndexableElementCount = [];
          }
          this.data.IndexableElementCount?.push({
            Count: NodeCount,
            IndexableElementID: context.addReferenceData(
              "IndexableElement",
              "nodes"
            )
          });
        }
      }
    }
    delete this.__context;
    return this;
  }
}

import {
  isStructureMapSurface22,
  StructureMapSurface22Manifest,
  StructureMap22OSDU
} from "./StructureMap22";
import {
  isHorizonControlPoints22,
  HorizonControlPoints22Manifest,
  HorizonControlPoints22OSDU
} from "./HorizonControlPoints";

/**
 * Identify OSDU kind for Representation, can create either a SeismicFault, StructureMap, or GenericRepresentation
 *
 * @param {IResqmlDataObject} xml
 * @return {string}
 */
export const GenericRepresentation22ToOsduKind = (
  xml: IResqmlDataObject
): string => {
  const genRep = xml as SimpleJson<resqml22.AbstractRepresentation>;
  if (
    genRep.RepresentedObject?.QualifiedType === "resqml22.FaultInterpretation"
  ) {
    const geometries = getGeometries(xml);
    for (const p of geometries) {
      if (p.SeismicCoordinates !== undefined) {
        return getKindOrFallback("SeismicFault");
      }
    }
  }
  if (isHorizonControlPoints22(genRep)) {
    return getKindOrFallback("HorizonControlPoints");
  }
  if (isStructureMapSurface22(genRep)) {
    return getKindOrFallback("StructureMap");
  }
  return getKindOrFallback("GenericRepresentation");
};

export const GenericRepresentation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.AbstractSurfaceRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<GenericRepresentation22OSDU | StructureMap22OSDU | HorizonControlPoints22OSDU> => {
  const kind = GenericRepresentation22ToOsduKind(xml);
  if (kind === getKind("HorizonControlPoints")) {
    return HorizonControlPoints22Manifest(uri, xml, context, client);
  }
  if (kind === getKind("StructureMap")) {
    return StructureMapSurface22Manifest(uri, xml, context, client);
  }
  return new GenericRepresentation22OSDU(xml, context).initData(uri, xml, client);
};
