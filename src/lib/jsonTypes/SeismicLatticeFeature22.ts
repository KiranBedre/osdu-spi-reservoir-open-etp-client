import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import * as eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { Energistics, EtpUri, ResqmlClient } from "../client/ResqmlClient";

import { OSDUContext } from "./OsduContext";
import {
  ResqmlResource,
  ResqmlWorkProductComponent
} from "./WorkProductComponent";

import {
  Data,
  FrameOfReferenceMetaDataItem,
  SeismicAcquisitionSurvey
} from "./Generated/master-data/SeismicAcquisitionSurvey.1.4.0";

const DBL_CST_ARRAY = "resqml22.DoubleConstantArray";

const RESQML22_Grid2DRepresentation = "resqml22.Grid2dRepresentation";

/**
 * Extract SeismicBinGrid information from a 2D grid
 *
 * @export
 * @class SeismicBinGridOSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml22.SeismicLatticeFeature>>}
 * @implements {SeismicBinGrid}
 */
export class SeismicLatticeFeatureOSDU
  extends ResqmlResource<SimpleJson<resqml22.SeismicLatticeFeature>>
  implements SeismicAcquisitionSurvey {
  public data: Data = {};

  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml22.SeismicLatticeFeature>,
    context: OSDUContext
  ) {
    super(xml, context, "master-data", "SeismicAcquisitionSurvey.1.4.0");
  }

  /**
   * Compute easting and northing values
   *
   * @param Wgs84Coordinates Coordinates in WSG84 coordinate system
   * @param crs Local CRS
   * @returns
   */
  private eastingNorthing(
    Wgs84Coordinates: [number, number][] | undefined,
    crs: SimpleJson<eml23.LocalEngineering2dCrs>
  ): { easting: number; northing: number } {
    let easting = Wgs84Coordinates?.length ? Wgs84Coordinates[0][0] : 0;
    let northing = Wgs84Coordinates?.length ? Wgs84Coordinates[0][1] : 0;
    const c0 = easting;
    const c1 = northing;
    if (crs.OriginProjectedCrs.AxisOrder === "northing easting") {
      easting = c1;
      northing = c0;
    } else if (crs.OriginProjectedCrs.AxisOrder === "southing westing") {
      easting = -c1;
      northing = -c0;
    } else if (crs.OriginProjectedCrs.AxisOrder === "northing westing") {
      easting = -c1;
      northing = c0;
    } else if (crs.OriginProjectedCrs.AxisOrder === "westing northing") {
      easting = -c0;
      northing = c1;
    } else if (crs.OriginProjectedCrs.AxisOrder === "westing southing") {
      easting = -c0;
      northing = -c1;
    }
    return { easting, northing };
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.SeismicLatticeFeature>,
    client: ResqmlClient
  ): Promise<SeismicLatticeFeatureOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    let FrameOfReferenceCRS = undefined;
    let SpatialPoint: any = undefined;
    let SpatialArea: any = undefined;
    let easting: number | undefined = undefined;
    let northing: number | undefined = undefined;
    let uSpacing: SimpleJson<eml23.FloatingPointConstantArray> | undefined =
      undefined;
    let vSpacing: SimpleJson<eml23.FloatingPointConstantArray> | undefined =
      undefined;
    let P6MapGridBearingOfBinGridJaxis: number | undefined = undefined;

    // Find associated 2D grid representation
    const grid2dResource = await client.getSources(
      {
        uri: ReservoirDMSUrl,
        depth: 2,
        dataObjectTypes: [RESQML22_Grid2DRepresentation],
        navigableEdges:
          Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both,
        includeSecondarySources: false,
        includeSecondaryTargets: false
      },
      false,
      [RESQML22_Grid2DRepresentation]
    );

    const grid2ds =
      grid2dResource.length === 0
        ? undefined
        : await ResqmlResource.getObjects(
          client,
          [grid2dResource[0].uri],
          context
        );
    if (grid2ds && grid2ds.length > 0) {
      const grid2d = grid2ds[0] as SimpleJson<resqml22.Grid2dRepresentation>;

      const geometry = grid2d.Geometry;
      let A: [number, number] = [0, 0];
      let B: [number, number] = [0, 0];
      let C: [number, number] = [0, 0];
      let D: [number, number] = [0, 0];

      const dataspaceUri = EtpUri.createDataSpaceUri(
        new EtpUri(ReservoirDMSUrl).dataSpace
      );

      const lArray =
        geometry.Points as SimpleJson<resqml22.Point3dLatticeArray>;
      const dim0 = lArray.Dimension[0];
      const dim1 = lArray.Dimension[1];
      const [ox, oy] = [lArray.Origin.Coordinate1, lArray.Origin.Coordinate2];
      const [u, v] = [dim0.Direction, dim1.Direction];
      if (
        dim0.Spacing.$type !== DBL_CST_ARRAY ||
        dim1.Spacing.$type !== DBL_CST_ARRAY
      ) {
        delete this.__context;
        return this;
      }
      uSpacing = dim0.Spacing as SimpleJson<eml23.FloatingPointConstantArray>;
      vSpacing = dim1.Spacing as SimpleJson<eml23.FloatingPointConstantArray>;
      const [uLen, vLen] = [uSpacing.Value, vSpacing.Value];
      const [nu, nv] = [uSpacing.Count + 1, vSpacing.Count + 1];

      const uOffsetLen = Math.sqrt(
        u.Coordinate1 * u.Coordinate1 + u.Coordinate2 * u.Coordinate2
      );

      const vOffsetLen = Math.sqrt(
        v.Coordinate1 * v.Coordinate1 + v.Coordinate2 * v.Coordinate2
      );

      const [ux, uy] = [
        (uLen * u.Coordinate1) / uOffsetLen,
        (uLen * u.Coordinate2) / uOffsetLen
      ];
      const [vx, vy] = [
        (vLen * v.Coordinate1) / vOffsetLen,
        (vLen * v.Coordinate2) / vOffsetLen
      ];
      A = [ox, oy];
      B = [ox + nu * ux, oy + nu * uy];
      C = [ox + nv * vx, oy + nv * vy];
      D = [B[0] + nv * vx, B[1] + nv * vy];

      const crsObj = await ResqmlWorkProductComponent.getObjectFromDor(
        client,
        dataspaceUri.uri,
        geometry.LocalCrs,
        context
      );
      const crs = crsObj as SimpleJson<eml23.LocalEngineeringCompoundCrs>;
      const crs2dObj = await ResqmlWorkProductComponent.getObjectFromDor(
        client,
        dataspaceUri.uri,
        crs.LocalEngineering2dCrs,
        context
      );
      const crs2d = crs2dObj as SimpleJson<eml23.LocalEngineering2dCrs>;

      const spatial =
        await ResqmlWorkProductComponent.createSpatialInfoFrom2dPoints(
          client,
          dataspaceUri.uri,
          [A, B, D, C, A],
          crs,
          context
        );
      SpatialPoint = spatial.SpatialPoint;
      SpatialArea = spatial.SpatialArea;
      FrameOfReferenceCRS =
        spatial.FrameOfReferenceCRS as FrameOfReferenceMetaDataItem;
      const eastingNorthing = this.eastingNorthing(
        spatial.Wgs84Coordinates,
        crs2d
      );
      easting = eastingNorthing.easting;
      northing = eastingNorthing.northing;

      P6MapGridBearingOfBinGridJaxis =
        (Math.atan2(v.Coordinate1, v.Coordinate2) * 180) / Math.PI;
    }

    const inlineLabels =
      xml?.InlineLabels as SimpleJson<eml23.IntegerLatticeArray>;
    const inlineLabelsOffset = inlineLabels?.Offset;
    const crosslineLabels =
      xml?.CrosslineLabels as SimpleJson<eml23.IntegerLatticeArray>;

    const crosslineLabelsCount = crosslineLabels?.Offset[1].Count;

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ABCDBinGridLocalCoordinates: undefined, // Deprecated
      ABCDBinGridSpatialLocation: SpatialArea,
      BinGridDefinitionMethodTypeID: undefined,
      BinGridName: xml.Citation.Title,
      BinGridTypeID: undefined,
      CoveragePercent: undefined,
      P6BinGridOriginI: inlineLabels?.StartValue / crosslineLabelsCount,
      P6BinNodeIncrementOnIaxis: inlineLabelsOffset
        ? inlineLabelsOffset[0]
        : undefined,
      P6BinGridOriginJ: crosslineLabels?.StartValue % crosslineLabelsCount,
      P6BinNodeIncrementOnJaxis: crosslineLabels?.Offset
        ? crosslineLabels.Offset[1]
        : undefined,
      P6BinGridOriginEasting: easting,
      P6BinGridOriginNorthing: northing,
      P6BinWidthOnIaxis: uSpacing ? uSpacing.Value : undefined,
      P6BinWidthOnJaxis: vSpacing ? vSpacing.Value : undefined,
      P6MapGridBearingOfBinGridJaxis: P6MapGridBearingOfBinGridJaxis,
      P6ScaleFactorOfBinGrid: undefined,
      P6TransformationMethod: undefined,
      SourceBinGridAppID: undefined,
      SourceBinGridID: undefined,

      ExtensionProperties: undefined
    };

    this.data.SpatialPoint = SpatialPoint;
    this.data.SpatialArea = SpatialArea;
    this.data.ABCDBinGridSpatialLocation = SpatialArea;
    this.meta = FrameOfReferenceCRS ? [FrameOfReferenceCRS] : [];

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

/**
 * Manifest converter for all 2D Grids, can create either a binGrid, seismic horizon of generic representation
 *
 * @param {string} uri
 * @param {SimpleJson<resqml22.SeismicLatticeFeature>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @returns {(Promise<SeismicLatticeFeatureOSDU>)}
 */
export const SeismicLatticeFeature22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.SeismicLatticeFeature>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<SeismicLatticeFeatureOSDU> => {
  return new SeismicLatticeFeatureOSDU(xml, context).initData(uri, xml, client);
};
