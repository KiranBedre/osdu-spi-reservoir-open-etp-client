import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpUri, ResqmlClient } from "../client/ResqmlClient";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  StructureMap
} from "./Generated/work-product-component/StructureMap.1.0.0";

import { FrameOfReferenceMetaDataItem } from "./Generated/manifest/Manifest.1.0.0";

/**
 * Extract StructureMap information from a depth-domain Resqml 2.2 Grid2dRepresentation.
 *
 * A StructureMap is a regular 2D grid surface in depth domain (as opposed to
 * SeismicHorizon which is time-domain on a seismic lattice). Typical use case:
 * exported horizon surfaces from Petrel / RMS where Z is depth below datum.
 *
 * @export
 * @class StructureMap22OSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml22.Grid2dRepresentation>>}
 * @implements {StructureMap}
 */
export class StructureMap22OSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml22.Grid2dRepresentation>>
  implements StructureMap {
  public data: Data = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml22.Grid2dRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "StructureMap.1.0.0");
  }

  /**
   * Check if a Grid2d qualifies as a StructureMap (depth-domain surface with
   * horizon interpretation, NOT on a seismic lattice).
   *
   * @static
   * @param {SimpleJson<resqml22.Grid2dRepresentation>} xml
   * @return {boolean}
   */
  static matchType(xml: SimpleJson<resqml22.Grid2dRepresentation>): boolean {
    // Must have a horizon interpretation
    if (xml.RepresentedObject?.QualifiedType === undefined) {
      return false;
    }
    const qt = xml.RepresentedObject.QualifiedType;
    if (!qt.endsWith("HorizonInterpretation")) {
      return false;
    }

    // Must NOT be on a seismic lattice (those go to SeismicHorizon)
    const geo = xml.Geometry;
    if (geo.Points.$type === "resqml22.Point3dZValueArray") {
      const p = geo.Points as SimpleJson<resqml22.Point3dZValueArray>;
      if (
        p.SupportingGeometry.$type ===
        "resqml22.Point3dFromRepresentationLatticeArray"
      ) {
        // This is on a seismic lattice → SeismicHorizon, not StructureMap
        return false;
      }
    }

    return true;
  }

  public getGeometries(
    xml: SimpleJson<resqml22.Grid2dRepresentation>
  ): SimpleJson<resqml22.PointGeometry>[] {
    return [xml.Geometry];
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.Grid2dRepresentation>,
    client: ResqmlClient
  ): Promise<StructureMap22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const interpretation = xml.RepresentedObject?._data as
      | SimpleJson<resqml22.HorizonInterpretation>
      | undefined;

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      IndexableElementCount: [
        {
          Count: xml.SlowestAxisCount * xml.FastestAxisCount,
          IndexableElementID: context.addReferenceData(
            "IndexableElement",
            "nodes"
          )
        }
      ],
      InterpretationID: await StructureMap22OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedObject,
        client,
        context
      ),
      InterpretationName: interpretation?.Citation?.Title,
      LocalModelCompoundCrsID: await StructureMap22OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.Geometry.LocalCrs,
        client,
        context
      ),
      NodeCountOnIAxis: xml.FastestAxisCount,
      NodeCountOnJAxis: xml.SlowestAxisCount,
      ExtensionProperties: undefined
    };

    // Extract grid geometry from lattice-based Point3dLatticeArray
    // Handles both direct Point3dLatticeArray and Point3dZValueArray with
    // SupportingGeometry containing the lattice.
    const geo = xml.Geometry;
    let lattice: SimpleJson<resqml22.Point3dLatticeArray> | undefined;

    if (geo.Points.$type === "resqml22.Point3dLatticeArray") {
      lattice = geo.Points as SimpleJson<resqml22.Point3dLatticeArray>;
    } else if (geo.Points.$type === "resqml22.Point3dZValueArray") {
      const zArr = geo.Points as SimpleJson<resqml22.Point3dZValueArray>;
      if (
        zArr.SupportingGeometry?.$type === "resqml22.Point3dLatticeArray"
      ) {
        lattice =
          zArr.SupportingGeometry as SimpleJson<resqml22.Point3dLatticeArray>;
      }
    }

    if (lattice) {
      if (lattice.Dimension?.length >= 2) {
        const dim0 = lattice.Dimension[0] as SimpleJson<resqml22.Point3dLatticeDimension>;
        const dim1 = lattice.Dimension[1] as SimpleJson<resqml22.Point3dLatticeDimension>;
        const dir0 = dim0.Direction;
        const dir1 = dim1.Direction;
        // Spacing value: for DoubleConstantArray the step size is Spacing.Value;
        // the direction vector may be a unit vector — actual step = spacing * |dir|.
        const sp0 = (dim0.Spacing as any)?.Value ?? 1;
        const sp1 = (dim1.Spacing as any)?.Value ?? 1;
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
      if (lattice && (lattice as any).Dimension?.length >= 2) {
        const dim0 = (lattice as any).Dimension[0];
        const dim1 = (lattice as any).Dimension[1];
        const dir0 = dim0.Direction;
        const dir1 = dim1.Direction;
        const sp0 = dim0.Spacing?.Value ?? 1;
        const sp1 = dim1.Spacing?.Value ?? 1;
        const countJ = xml.SlowestAxisCount - 1;
        const countI = xml.FastestAxisCount - 1;
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

        const crsObj = await StructureMap22OSDU.getObjectFromDor(
          client,
          dataspaceUri.uri,
          geo.LocalCrs,
          context
        );
        const crs = crsObj as any;
        const Domain =
          crsObj?.$type === "resqml22.obj_LocalDepth3dCrs" ||
            crsObj?.$type === "eml23.LocalEngineeringCompoundCrs"
            ? "Depth"
            : "Time";

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
          } = await StructureMap22OSDU.createSpatialInfoFrom2dPoints(
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
          NodeCount,
          Domain
        } = await StructureMap22OSDU.createSpatialInfo(
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

    // Lineage assertions (creating objects)
    const dors = await this.getCreatingObjects(client, ReservoirDMSUrl);
    if (dors.length > 0) {
      this.data.LineageAssertions = [];
      for (const d of dors) {
        const l = await StructureMap22OSDU.dorToSrn(
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

    // Preserve interpreter info for round-trip fidelity
    if (xml.Citation.Originator) {
      if (!this.data.ExtensionProperties) this.data.ExtensionProperties = {};
      this.data.ExtensionProperties.Interpreter = xml.Citation.Originator;
    }

    delete this.__context;
    return this;
  }
}
