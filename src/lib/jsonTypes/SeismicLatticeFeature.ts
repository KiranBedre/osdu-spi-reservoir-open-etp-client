import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
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

const DBL_CST_ARRAY = "resqml20.DoubleConstantArray";

const RESQML20_Grid2DRepresentation = "resqml20.obj_Grid2dRepresentation";

/**
 * Extract SeismicBinGrid information from a 2D grid
 *
 * @export
 * @class SeismicBinGridOSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml20.obj_SeismicLatticeFeature>>}
 * @implements {SeismicBinGrid}
 */
export class SeismicLatticeFeatureOSDU
  extends ResqmlResource<SimpleJson<resqml20.obj_SeismicLatticeFeature>>
  implements SeismicAcquisitionSurvey
{
  public data: Data = {};

  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml20.obj_SeismicLatticeFeature>,
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
    crs: SimpleJson<resqml20.obj_LocalDepth3dCrs>
  ): { easting: number; northing: number } {
    let easting = Wgs84Coordinates?.length ? Wgs84Coordinates[0][0] : 0;
    let northing = Wgs84Coordinates?.length ? Wgs84Coordinates[0][1] : 0;
    const c0 = easting;
    const c1 = northing;
    if (crs.ProjectedAxisOrder === "northing easting") {
      easting = c1;
      northing = c0;
    } else if (crs.ProjectedAxisOrder === "southing westing") {
      easting = -c1;
      northing = -c0;
    } else if (crs.ProjectedAxisOrder === "northing westing") {
      easting = -c1;
      northing = c0;
    } else if (crs.ProjectedAxisOrder === "westing northing") {
      easting = -c0;
      northing = c1;
    } else if (crs.ProjectedAxisOrder === "westing southing") {
      easting = -c0;
      northing = -c1;
    }
    return { easting, northing };
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_SeismicLatticeFeature>,
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
    let uSpacing: SimpleJson<resqml20.DoubleConstantArray> | undefined =
      undefined;
    let vSpacing: SimpleJson<resqml20.DoubleConstantArray> | undefined =
      undefined;
    let P6MapGridBearingOfBinGridJaxis: number | undefined = undefined;

    // Find associated 2D grid representation
    const grid2dResource = await client.getSources(
      {
        uri: ReservoirDMSUrl,
        depth: 2,
        dataObjectTypes: [RESQML20_Grid2DRepresentation],
        navigableEdges:
          Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both,
        includeSecondarySources: false,
        includeSecondaryTargets: false
      },
      false,
      [RESQML20_Grid2DRepresentation]
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
      const grid2d =
        grid2ds[0] as SimpleJson<resqml20.obj_Grid2dRepresentation>;

      const geometry = grid2d.Grid2dPatch.Geometry;
      let A: [number, number] = [0, 0];
      let B: [number, number] = [0, 0];
      let C: [number, number] = [0, 0];
      let D: [number, number] = [0, 0];

      const dataspaceUri = EtpUri.createDataSpaceUri(
        new EtpUri(ReservoirDMSUrl).dataSpace
      );

      const lArray =
        geometry.Points as SimpleJson<resqml20.Point3dLatticeArray>;
      const [ox, oy] = [lArray.Origin.Coordinate1, lArray.Origin.Coordinate2];
      const [u, v] = [lArray.Offset[0], lArray.Offset[1]];
      if (
        u.Spacing.$type !== DBL_CST_ARRAY ||
        v.Spacing.$type !== DBL_CST_ARRAY
      ) {
        delete this.__context;
        return this;
      }
      uSpacing = u.Spacing as SimpleJson<resqml20.DoubleConstantArray>;
      vSpacing = v.Spacing as SimpleJson<resqml20.DoubleConstantArray>;
      const [uLen, vLen] = [uSpacing.Value, vSpacing.Value];
      const [nu, nv] = [uSpacing.Count + 1, vSpacing.Count + 1];

      const uOffsetLen = Math.sqrt(
        u.Offset.Coordinate1 * u.Offset.Coordinate1 +
          u.Offset.Coordinate2 * u.Offset.Coordinate2
      );

      const vOffsetLen = Math.sqrt(
        v.Offset.Coordinate1 * v.Offset.Coordinate1 +
          v.Offset.Coordinate2 * v.Offset.Coordinate2
      );

      const [ux, uy] = [
        (uLen * u.Offset.Coordinate1) / uOffsetLen,
        (uLen * u.Offset.Coordinate2) / uOffsetLen
      ];
      const [vx, vy] = [
        (vLen * v.Offset.Coordinate1) / vOffsetLen,
        (vLen * v.Offset.Coordinate2) / vOffsetLen
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
      const crs = crsObj as SimpleJson<resqml20.obj_LocalDepth3dCrs>;

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
        crs
      );
      easting = eastingNorthing.easting;
      northing = eastingNorthing.northing;

      P6MapGridBearingOfBinGridJaxis =
        (Math.atan2(v.Offset.Coordinate1, v.Offset.Coordinate2) * 180) /
        Math.PI;
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ABCDBinGridLocalCoordinates: undefined, // Deprecated
      ABCDBinGridSpatialLocation: SpatialArea,
      BinGridDefinitionMethodTypeID: undefined,
      BinGridName: xml.Citation.Title,
      BinGridTypeID: undefined,
      CoveragePercent: undefined,
      P6BinGridOriginI: xml?.FirstInlineIndex,
      P6BinNodeIncrementOnIaxis: xml?.InlineIndexIncrement,
      P6BinGridOriginJ: xml?.FirstCrosslineIndex,
      P6BinNodeIncrementOnJaxis: xml?.CrosslineIndexIncrement,
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

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

/**
 * Manifest converter for all 2D Grids, can create either a binGrid, seismic horizon of generic representation
 *
 * @param {string} uri
 * @param {SimpleJson<resqml20.obj_SeismicLatticeFeature>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @returns {(Promise<SeismicLatticeFeatureOSDU>)}
 */
export const SeismicLatticeFeatureManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_SeismicLatticeFeature>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<SeismicLatticeFeatureOSDU> => {
  return new SeismicLatticeFeatureOSDU(xml, context).initData(uri, xml, client);
};
