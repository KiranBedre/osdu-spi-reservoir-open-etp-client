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
  implements StructureMap
{
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
    const geo = xml.Geometry;
    if (geo.Points.$type === "resqml22.Point3dLatticeArray") {
      const lat = geo.Points as SimpleJson<resqml22.Point3dLatticeArray>;
      if (lat.Dimension?.length >= 2) {
        const dim0 = lat.Dimension[0] as SimpleJson<resqml22.Point3dLatticeDimension>;
        const dim1 = lat.Dimension[1] as SimpleJson<resqml22.Point3dLatticeDimension>;
        const dir0 = dim0.Direction;
        const dir1 = dim1.Direction;
        // Bin width = magnitude of the direction vector (already scaled if uniform)
        this.data.BinWidthOnIaxis = Math.sqrt(
          dir0.Coordinate1 ** 2 + dir0.Coordinate2 ** 2
        );
        this.data.BinWidthOnJaxis = Math.sqrt(
          dir1.Coordinate1 ** 2 + dir1.Coordinate2 ** 2
        );

        // Bearing of J-axis (degrees from north)
        this.data.MapGridBearingOfBinGridJaxis =
          (Math.atan2(dir1.Coordinate1, dir1.Coordinate2) * 180) / Math.PI;
      }
      this.data.OriginEasting = lat.Origin.Coordinate1;
      this.data.OriginNorthing = lat.Origin.Coordinate2;
    }

    // Spatial info from geometry
    const geometries = this.getGeometries(xml);
    if (geometries.length > 0) {
      const dataspaceUri = EtpUri.createDataSpaceUri(
        new EtpUri(ReservoirDMSUrl).dataSpace
      );

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

    delete this.__context;
    return this;
  }
}
