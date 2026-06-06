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
  implements StructureMap
{
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
    const geo = xml.Grid2dPatch.Geometry;
    if (geo.Points.$type === "resqml20.Point3dLatticeArray") {
      const lat = geo.Points as SimpleJson<resqml20.Point3dLatticeArray>;
      if (lat.Offset?.length >= 2) {
        const off0 = lat.Offset[0] as SimpleJson<resqml20.Point3dOffset>;
        const off1 = lat.Offset[1] as SimpleJson<resqml20.Point3dOffset>;
        const dir0 = off0.Offset;
        const dir1 = off1.Offset;
        this.data.BinWidthOnIaxis = Math.sqrt(
          dir0.Coordinate1 ** 2 + dir0.Coordinate2 ** 2
        );
        this.data.BinWidthOnJaxis = Math.sqrt(
          dir1.Coordinate1 ** 2 + dir1.Coordinate2 ** 2
        );
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
