import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpContentType, EtpUri, ResqmlClient } from "../client/ResqmlClient";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  StructureMap
} from "./Generated/work-product-component/StructureMap.1.0.0";

import { FrameOfReferenceMetaDataItem } from "./Generated/manifest/Manifest.1.0.0";

/**
 * Extract StructureMap information from a depth-domain Resqml 2.0.1 Grid2dRepresentation.
 *
 * @export
 * @class StructureMapOSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml20.obj_Grid2dRepresentation>>}
 * @implements {StructureMap}
 */
export class StructureMapOSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml20.obj_Grid2dRepresentation>>
  implements StructureMap {
  public data: Data = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "StructureMap.1.0.0");
  }

  /**
   * Check if a Grid2d qualifies as a StructureMap (has horizon interpretation,
   * NOT on a seismic lattice).
   */
  static matchType(
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>
  ): boolean {
    // Must have a horizon interpretation
    if (xml.RepresentedInterpretation?.ContentType === undefined) {
      return false;
    }
    const ct = new EtpContentType(xml.RepresentedInterpretation.ContentType);
    if (ct.dataType !== "obj_HorizonInterpretation") {
      return false;
    }

    // Must NOT be on a seismic lattice (those go to SeismicHorizon)
    const geo = xml.Grid2dPatch.Geometry;
    if (geo.Points.$type === "resqml20.Point3dZValueArray") {
      const p = geo.Points as SimpleJson<resqml20.Point3dZValueArray>;
      if (
        p.SupportingGeometry.$type ===
        "resqml20.Point3dFromRepresentationLatticeArray"
      ) {
        return false;
      }
    }

    return true;
  }

  public getGeometries(
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>
  ): SimpleJson<resqml20.PointGeometry>[] {
    return [xml.Grid2dPatch.Geometry];
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>,
    client: ResqmlClient
  ): Promise<StructureMapOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const interpretation = xml.RepresentedInterpretation?._data as
      | SimpleJson<resqml20.obj_HorizonInterpretation>
      | undefined;

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      IndexableElementCount: [
        {
          Count: xml.Grid2dPatch.SlowestAxisCount * xml.Grid2dPatch.FastestAxisCount,
          IndexableElementID: context.addReferenceData(
            "IndexableElement",
            "nodes"
          )
        }
      ],
      InterpretationID: await StructureMapOSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedInterpretation,
        client,
        context
      ),
      InterpretationName: interpretation?.Citation?.Title,
      LocalModelCompoundCrsID: await StructureMapOSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.Grid2dPatch.Geometry.LocalCrs,
        client,
        context
      ),
      NodeCountOnIAxis: xml.Grid2dPatch.FastestAxisCount,
      NodeCountOnJAxis: xml.Grid2dPatch.SlowestAxisCount,
      ExtensionProperties: undefined
    };

    // Extract grid geometry from lattice-based Point3dLatticeArray
    // Handles both direct Point3dLatticeArray and Point3dZValueArray with
    // SupportingGeometry containing the lattice.
    const geo = xml.Grid2dPatch.Geometry;
    let lattice: SimpleJson<resqml20.Point3dLatticeArray> | undefined;

    if (geo.Points.$type === "resqml20.Point3dLatticeArray") {
      lattice = geo.Points as SimpleJson<resqml20.Point3dLatticeArray>;
    } else if (geo.Points.$type === "resqml20.Point3dZValueArray") {
      const zArr = geo.Points as SimpleJson<resqml20.Point3dZValueArray>;
      if (
        zArr.SupportingGeometry?.$type === "resqml20.Point3dLatticeArray"
      ) {
        lattice =
          zArr.SupportingGeometry as SimpleJson<resqml20.Point3dLatticeArray>;
      }
    }

    if (lattice) {
      if (lattice.Offset?.length >= 2) {
        const off0 = lattice.Offset[0] as SimpleJson<resqml20.Point3dOffset>;
        const off1 = lattice.Offset[1] as SimpleJson<resqml20.Point3dOffset>;
        const dir0 = off0.Offset;
        const dir1 = off1.Offset;
        // Spacing value: for DoubleConstantArray the step size is Spacing.Value;
        // the direction vector is just a direction — actual step = spacing * |dir|.
        const sp0 = (off0.Spacing as any)?.Value ?? 1;
        const sp1 = (off1.Spacing as any)?.Value ?? 1;
        this.data.BinWidthOnIaxis = Math.sqrt(
          dir0.Coordinate1 ** 2 + dir0.Coordinate2 ** 2
        ) * sp0;
        this.data.BinWidthOnJaxis = Math.sqrt(
          dir1.Coordinate1 ** 2 + dir1.Coordinate2 ** 2
        ) * sp1;
        this.data.MapGridBearingOfBinGridJaxis =
          (Math.atan2(dir1.Coordinate1, dir1.Coordinate2) * 180) / Math.PI;
      }
      this.data.OriginEasting = lattice.Origin.Coordinate1;
      this.data.OriginNorthing = lattice.Origin.Coordinate2;
    }

    // Spatial info from geometry
    const geometries = this.getGeometries(xml);
    if (geometries.length > 0) {
      const dataspaceUri = EtpUri.createDataSpaceUri(
        new EtpUri(ReservoirDMSUrl).dataSpace
      );

      // If we have lattice data, compute bounding box corners analytically
      // (no need to fetch array data via useDataArrayForManifest)
      if (lattice && lattice.Offset?.length >= 2) {
        const off0 = lattice.Offset[0] as SimpleJson<resqml20.Point3dOffset>;
        const off1 = lattice.Offset[1] as SimpleJson<resqml20.Point3dOffset>;
        const dir0 = off0.Offset;
        const dir1 = off1.Offset;
        const sp0 = (off0.Spacing as any)?.Value ?? 1;
        const sp1 = (off1.Spacing as any)?.Value ?? 1;
        // Offset[0] = slowest axis (J), Offset[1] = fastest axis (I)
        const countJ = xml.Grid2dPatch.SlowestAxisCount - 1;
        const countI = xml.Grid2dPatch.FastestAxisCount - 1;
        const ox = lattice.Origin.Coordinate1;
        const oy = lattice.Origin.Coordinate2;
        // Step vectors (direction × spacing)
        const stepJ = [dir0.Coordinate1 * sp0, dir0.Coordinate2 * sp0];
        const stepI = [dir1.Coordinate1 * sp1, dir1.Coordinate2 * sp1];

        // Compute 4 corners of the grid
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

        const crsObj = await StructureMapOSDU.getObjectFromDor(
          client,
          dataspaceUri.uri,
          geo.LocalCrs,
          context
        );
        const crs = crsObj as SimpleJson<resqml20.AbstractLocal3dCrs>;
        const Domain =
          crsObj?.$type === "resqml20.obj_LocalDepth3dCrs" ? "Depth" : "Time";

        if (crs) {
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
          } = await StructureMapOSDU.createSpatialInfoFrom2dPoints(
            client,
            dataspaceUri.uri,
            bboxRing,
            crs,
            context
          );

          this.data.SpatialPoint = SpatialPoint;
          this.data.SpatialArea = SpatialArea;
          this.data.ABCDBinGridSpatialLocation = SpatialArea;
          this.data.DomainTypeID = context.addReferenceData(
            "DomainType",
            Domain
          );
          this.meta = [FrameOfReferenceCRS];
        }
      } else {
        // Fallback: use createSpatialInfo (requires useDataArrayForManifest for bbox)
        const {
          SpatialPoint,
          SpatialArea,
          FrameOfReferenceCRS,
          Domain
        } = await StructureMapOSDU.createSpatialInfo(
          client,
          dataspaceUri.uri,
          geometries,
          context
        );

        this.data.SpatialPoint = SpatialPoint;
        this.data.SpatialArea = SpatialArea;
        this.data.ABCDBinGridSpatialLocation = SpatialArea;
        this.data.DomainTypeID = context.addReferenceData("DomainType", Domain);
        this.meta = [FrameOfReferenceCRS];
      }
    }

    // Lineage assertions
    const dors = await this.getCreatingObjects(client, ReservoirDMSUrl);
    if (dors.length > 0) {
      this.data.LineageAssertions = [];
      for (const d of dors) {
        const l = await StructureMapOSDU.dorToSrn(
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

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}
