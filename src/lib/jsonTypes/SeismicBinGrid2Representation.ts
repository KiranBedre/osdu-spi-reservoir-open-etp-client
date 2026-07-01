import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import {
  EtpUri,
  IResqmlDataObject,
  ResqmlClient
} from "../client/ResqmlClient";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  FrameOfReferenceMetaDataItem,
  SeismicBinGrid
} from "./Generated/work-product-component/SeismicBinGrid.1.3.0";

import { GenericRepresentationOSDU } from "./GenericRepresentation";

import { SeismicHorizonOSDU } from "./SeismicHorizon";

import { StructureMapOSDU } from "./StructureMap";

const DBL_CST_ARRAY = "resqml20.DoubleConstantArray";

/**
 * Extract SeismicBinGrid information from a 2D grid
 *
 * @export
 * @class SeismicBinGridOSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml20.obj_Grid2dRepresentation>>}
 * @implements {SeismicBinGrid}
 */
export class SeismicBinGridOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_Grid2dRepresentation>
  >
  implements SeismicBinGrid
{
  public data: Data = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "SeismicBinGrid.1.3.0");
  }

  /**
   * Check if a 2D grid can be an OSDU SeismicBinGrid
   *
   * @static
   * @param {SimpleJson<resqml20.obj_Grid2dRepresentation>} xml
   * @returns {boolean}
   * @memberof SeismicBinGridOSDU
   */
  static matchType(
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>
  ): boolean {
    const grid2d = xml as SimpleJson<resqml20.obj_Grid2dRepresentation>;
    return (
      (
        grid2d.RepresentedInterpretation
          ?._data as SimpleJson<resqml20.AbstractFeatureInterpretation>
      )?.InterpretedFeature._data?.$type ===
      "resqml20.obj_SeismicLatticeFeature"
    );
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
    if (crs.ProjectedAxisOrder === "northing easting") {
      easting = northing;
      northing = easting;
    } else if (crs.ProjectedAxisOrder === "southing westing") {
      easting = -northing;
      northing = -easting;
    } else if (crs.ProjectedAxisOrder === "northing westing") {
      easting = northing;
      northing = -easting;
    } else if (crs.ProjectedAxisOrder === "westing northing") {
      easting = -easting;
    } else if (crs.ProjectedAxisOrder === "westing southing") {
      easting = -easting;
      northing = -northing;
    }
    return { easting, northing };
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>,
    client: ResqmlClient
  ): Promise<SeismicBinGridOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const interp = xml.RepresentedInterpretation
      ?._data as SimpleJson<resqml20.AbstractFeatureInterpretation>;
    const feat: SimpleJson<resqml20.obj_SeismicLatticeFeature> | undefined =
      interp?.InterpretedFeature
        ._data as SimpleJson<resqml20.obj_SeismicLatticeFeature>;

    let A: [number, number] = [0, 0];
    let B: [number, number] = [0, 0];
    let C: [number, number] = [0, 0];
    let D: [number, number] = [0, 0];

    const dataspaceUri = EtpUri.createDataSpaceUri(
      new EtpUri(ReservoirDMSUrl).dataSpace
    );

    const lArray = xml.Grid2dPatch.Geometry
      .Points as SimpleJson<resqml20.Point3dLatticeArray>;
    const [ox, oy] = [lArray.Origin.Coordinate1, lArray.Origin.Coordinate2];
    const [u, v] = [lArray.Offset[0], lArray.Offset[1]];
    if (
      u.Spacing.$type !== DBL_CST_ARRAY ||
      v.Spacing.$type !== DBL_CST_ARRAY
    ) {
      delete this.__context;
      return this;
    }
    const uSpacing = u.Spacing as SimpleJson<resqml20.DoubleConstantArray>;
    const vSpacing = v.Spacing as SimpleJson<resqml20.DoubleConstantArray>;
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

    const crsObj = await SeismicBinGridOSDU.getObjectFromDor(
      client,
      dataspaceUri.uri,
      xml.Grid2dPatch.Geometry.LocalCrs,
      context
    );
    const crs = crsObj as SimpleJson<resqml20.obj_LocalDepth3dCrs>;

    const { SpatialPoint, SpatialArea, FrameOfReferenceCRS, Wgs84Coordinates } =
      await SeismicBinGridOSDU.createSpatialInfoFrom2dPoints(
        client,
        dataspaceUri.uri,
        [A, B, D, C, A],
        crs,
        context
      );

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      ABCDBinGridLocalCoordinates: undefined, // Deprecated
      ABCDBinGridSpatialLocation: SpatialArea,
      BinGridDefinitionMethodTypeID: undefined,
      BinGridName: xml.Citation.Title,
      BinGridTypeID: undefined,
      CoveragePercent: undefined,
      P6BinGridOriginI: feat?.FirstInlineIndex,
      P6BinNodeIncrementOnIaxis: feat?.InlineIndexIncrement,
      P6BinGridOriginJ: feat?.FirstCrosslineIndex,
      P6BinNodeIncrementOnJaxis: feat?.CrosslineIndexIncrement,
      P6BinGridOriginEasting: ox,
      P6BinGridOriginNorthing: oy,
      P6BinWidthOnIaxis: uLen,
      P6BinWidthOnJaxis: vLen,
      P6MapGridBearingOfBinGridJaxis:
        (Math.atan2(v.Offset.Coordinate1, v.Offset.Coordinate2) * 180) /
        Math.PI,
      P6ScaleFactorOfBinGrid: undefined,
      P6TransformationMethod: undefined,
      SourceBinGridAppID: undefined,
      SourceBinGridID: undefined,

      ExtensionProperties: undefined
    };

    this.data.SpatialPoint = SpatialPoint;
    this.data.SpatialArea = SpatialArea;
    this.data.ABCDBinGridSpatialLocation = SpatialArea;
    this.meta = [FrameOfReferenceCRS];

    const dors = await this.getCreatingObjects(client, ReservoirDMSUrl);
    if (dors.length > 0) {
      this.data.LineageAssertions = [];
      for (const d of dors) {
        const l = await SeismicBinGridOSDU.dorToSrn(
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

/**
 * Identify OSDU kind for all 2D Grids, can create either a SeismicBinGrid,
 * SeismicHorizon, StructureMap or GenericRepresentation.
 *
 * @param {IResqmlDataObject} xml
 * @returns {string}
 */
export const Grid2dToOsduKind = (xml: IResqmlDataObject): string => {
  if (xml.$type !== "resqml20.obj_Grid2dRepresentation") {
    return "osdu:wks:work-product-component--GenericRepresentation:1.2.0";
  }
  const grid2d = xml as SimpleJson<resqml20.obj_Grid2dRepresentation>;
  if (SeismicBinGridOSDU.matchType(grid2d)) {
    return "osdu:wks:work-product-component--SeismicBinGrid:1.3.0";
  } else if (SeismicHorizonOSDU.matchType(grid2d)) {
    return "osdu:wks:work-product-component--SeismicHorizon:2.0.0";
  } else if (StructureMapOSDU.matchType(grid2d)) {
    return "osdu:wks:work-product-component--StructureMap:1.0.0";
  }
  return "osdu:wks:work-product-component--GenericRepresentation:1.2.0";
};

/**
 * Manifest converter for all 2D Grids.
 *
 * @param {string} uri
 * @param {SimpleJson<resqml20.obj_Grid2dRepresentation>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @returns {(Promise<GenericRepresentationOSDU | SeismicBinGridOSDU | SeismicHorizonOSDU | StructureMapOSDU>)}
 */
export const Grid2dRepresentationManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_Grid2dRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<
  GenericRepresentationOSDU | SeismicBinGridOSDU | SeismicHorizonOSDU | StructureMapOSDU
> => {
  const kind = Grid2dToOsduKind(xml);
  if (kind === "osdu:wks:work-product-component--SeismicBinGrid:1.3.0") {
    return new SeismicBinGridOSDU(xml, context).initData(uri, xml, client);
  } else if (kind === "osdu:wks:work-product-component--SeismicHorizon:2.0.0") {
    return new SeismicHorizonOSDU(xml, context).initData(uri, xml, client);
  } else if (kind === "osdu:wks:work-product-component--StructureMap:1.0.0") {
    return new StructureMapOSDU(xml, context).initData(uri, xml, client);
  }
  return new GenericRepresentationOSDU(xml, context).initData(uri, xml, client);
};
