import * as eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv20/resqmlv2";
import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
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

import { GenericRepresentation22OSDU } from "./GenericRepresentation22";

import { SeismicHorizon22OSDU } from "./SeismicHorizon22";

import { StructureMap22OSDU } from "./StructureMap22";

const DBL_CST_ARRAY = "eml23.FloatingPointConstantArray";

/**
 * Extract SeismicBinGrid information from a 2D grid
 *
 * @export
 * @class SeismicBinGrid22OSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml22.Grid2dRepresentation>>}
 * @implements {SeismicBinGrid}
 */
export class SeismicBinGrid22OSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml22.Grid2dRepresentation>>
  implements SeismicBinGrid
{
  public data: Data = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml22.Grid2dRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "SeismicBinGrid.1.3.0");
  }

  /**
   * Check if a 2D grid can be an OSDU SeismicBinGrid
   *
   * @static
   * @param {SimpleJson<resqml22.Grid2dRepresentation>} xml
   * @return {boolean}
   * @memberof SeismicBinGridOSDU
   */
  static matchType(xml: SimpleJson<resqml22.Grid2dRepresentation>): boolean {
    const grid2d = xml as SimpleJson<resqml22.Grid2dRepresentation>;
    return (
      (
        grid2d.RepresentedObject
          ?._data as SimpleJson<resqml22.AbstractFeatureInterpretation>
      )?.InterpretedFeature._data?.$type === "resqml22.SeismicLatticeFeature"
    );
  }

  /**
   * Compute easting and northing values
   *
   * @param Wgs84Coordinates Coordinates in WSG84 coordinate system
   * @param crs Local CRS
   * @returns
   */
  private async eastingNorthing(
    Wgs84Coordinates: [number, number][] | undefined,
    crs:
      | SimpleJson<resqml20.AbstractLocal3dCrs>
      | SimpleJson<eml23.LocalEngineeringCompoundCrs>,
    dataspaceUri: EtpUri,
    client: ResqmlClient
  ): Promise<{ easting: number; northing: number }> {
    const context = this.__context as OSDUContext;
    let easting = Wgs84Coordinates?.length ? Wgs84Coordinates[0][0] : 0;
    let northing = Wgs84Coordinates?.length ? Wgs84Coordinates[0][1] : 0;
    if (crs.$type === "resqml20.obj_LocalDepth3dCrs") {
      const crs20 = crs as SimpleJson<resqml20.obj_LocalDepth3dCrs>;
      if (crs20.ProjectedAxisOrder === "northing easting") {
        easting = northing;
        northing = easting;
      } else if (crs20.ProjectedAxisOrder === "southing westing") {
        easting = -northing;
        northing = -easting;
      } else if (crs20.ProjectedAxisOrder === "northing westing") {
        easting = northing;
        northing = -easting;
      } else if (crs20.ProjectedAxisOrder === "westing northing") {
        easting = -easting;
      } else if (crs20.ProjectedAxisOrder === "westing southing") {
        easting = -easting;
        northing = -northing;
      }
    } else {
      const crs23 = crs as SimpleJson<eml23.LocalEngineeringCompoundCrs>;
      const pcrs23 = (await SeismicBinGrid22OSDU.getObjectFromDor(
        client,
        dataspaceUri.uri,
        crs23.LocalEngineering2dCrs,
        context
      )) as SimpleJson<eml23.LocalEngineering2dCrs>;
      if (
        pcrs23.HorizontalAxes.Direction1 === "north" &&
        pcrs23.HorizontalAxes.Direction2 === "east"
      ) {
        easting = northing;
        northing = easting;
      } else if (
        pcrs23.HorizontalAxes.Direction1 === "south" &&
        pcrs23.HorizontalAxes.Direction2 === "west"
      ) {
        easting = -northing;
        northing = -easting;
      } else if (
        pcrs23.HorizontalAxes.Direction1 === "north" &&
        pcrs23.HorizontalAxes.Direction2 === "west"
      ) {
        easting = northing;
        northing = -easting;
      } else if (
        pcrs23.HorizontalAxes.Direction1 === "west" &&
        pcrs23.HorizontalAxes.Direction2 === "north"
      ) {
        easting = -easting;
      } else if (
        pcrs23.HorizontalAxes.Direction1 === "west" &&
        pcrs23.HorizontalAxes.Direction2 === "south"
      ) {
        easting = -easting;
        northing = -northing;
      }
    }
    return { easting, northing };
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.Grid2dRepresentation>,
    client: ResqmlClient
  ): Promise<SeismicBinGrid22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const interp = xml.RepresentedObject
      ?._data as SimpleJson<resqml22.AbstractFeatureInterpretation>;
    const feat: SimpleJson<resqml22.SeismicLatticeFeature> | undefined = interp
      ?.InterpretedFeature._data as SimpleJson<resqml22.SeismicLatticeFeature>;

    let A: [number, number] = [0, 0];
    let B: [number, number] = [0, 0];
    let C: [number, number] = [0, 0];
    let D: [number, number] = [0, 0];

    const dataspaceUri = EtpUri.createDataSpaceUri(
      new EtpUri(ReservoirDMSUrl).dataSpace
    );

    const lArray = xml.Geometry
      .Points as SimpleJson<resqml22.Point3dLatticeArray>;
    const [ox, oy] = [lArray.Origin.Coordinate1, lArray.Origin.Coordinate2];
    const [u, v] = [lArray.Dimension[0], lArray.Dimension[1]];
    if (
      u.Spacing.$type !== DBL_CST_ARRAY ||
      v.Spacing.$type !== DBL_CST_ARRAY
    ) {
      delete this.__context;
      return this;
    }
    const uSpacing = u.Spacing as SimpleJson<eml23.FloatingPointConstantArray>;
    const vSpacing = v.Spacing as SimpleJson<eml23.FloatingPointConstantArray>;
    const [uLen, vLen] = [uSpacing.Value, vSpacing.Value];
    const [nu, nv] = [uSpacing.Count + 1, vSpacing.Count + 1];

    const uOffsetLen = Math.sqrt(
      u.Direction.Coordinate1 * u.Direction.Coordinate1 +
        u.Direction.Coordinate2 * u.Direction.Coordinate2
    );

    const vOffsetLen = Math.sqrt(
      v.Direction.Coordinate1 * v.Direction.Coordinate1 +
        v.Direction.Coordinate2 * v.Direction.Coordinate2
    );

    const [ux, uy] = [
      (uLen * u.Direction.Coordinate1) / uOffsetLen,
      (uLen * u.Direction.Coordinate2) / uOffsetLen
    ];
    const [vx, vy] = [
      (vLen * v.Direction.Coordinate1) / vOffsetLen,
      (vLen * v.Direction.Coordinate2) / vOffsetLen
    ];
    A = [ox, oy];
    B = [ox + nu * ux, oy + nu * uy];
    C = [ox + nv * vx, oy + nv * vy];
    D = [B[0] + nv * vx, B[1] + nv * vy];

    const crs = (await SeismicBinGrid22OSDU.getObjectFromDor(
      client,
      dataspaceUri.uri,
      xml.Geometry.LocalCrs,
      context
    )) as
      | SimpleJson<resqml20.obj_LocalDepth3dCrs>
      | SimpleJson<eml23._LocalEngineeringCompoundCrs>;

    const { SpatialPoint, SpatialArea, FrameOfReferenceCRS, Wgs84Coordinates } =
      await SeismicBinGrid22OSDU.createSpatialInfoFrom2dPoints(
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
      P6BinGridOriginI: feat?.InlineLabels?.StartValue,
      P6BinNodeIncrementOnIaxis: feat?.InlineLabels?.Offset[0].Value,
      P6BinGridOriginJ: feat?.CrosslineLabels?.StartValue,
      P6BinNodeIncrementOnJaxis: feat?.CrosslineLabels?.Offset[0].Value,
      P6BinGridOriginEasting: ox,
      P6BinGridOriginNorthing: oy,
      P6BinWidthOnIaxis: uLen,
      P6BinWidthOnJaxis: vLen,
      P6MapGridBearingOfBinGridJaxis:
        (Math.atan2(v.Direction.Coordinate1, v.Direction.Coordinate2) * 180) /
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
        const l = await SeismicBinGrid22OSDU.dorToSrn(
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

/**
 * Identify OSDU kind for all 2D Grids, can create either a SeismicBinGrid,
 * SeismicHorizon, StructureMap or GenericRepresentation.
 *
 * Routing logic:
 * 1. SeismicBinGrid — the grid IS the seismic survey lattice definition
 * 2. SeismicHorizon — time-domain horizon on a seismic lattice
 * 3. StructureMap — depth-domain horizon surface (regular grid, not on seismic lattice)
 * 4. GenericRepresentation — fallback
 *
 * @param {IResqmlDataObject} xml
 * @return {string}
 */
export const Grid2dToOsduKind22 = (xml: IResqmlDataObject): string => {
  if (xml.$type !== "resqml22.Grid2dRepresentation") {
    return "osdu:wks:work-product-component--GenericRepresentation:1.2.0";
  }
  const grid2d = xml as SimpleJson<resqml22.Grid2dRepresentation>;
  if (SeismicBinGrid22OSDU.matchType(grid2d)) {
    return "osdu:wks:work-product-component--SeismicBinGrid:1.3.0";
  } else if (SeismicHorizon22OSDU.matchType(grid2d)) {
    return "osdu:wks:work-product-component--SeismicHorizon:2.0.0";
  } else if (StructureMap22OSDU.matchType(grid2d)) {
    return "osdu:wks:work-product-component--StructureMap:1.0.0";
  }
  return "osdu:wks:work-product-component--GenericRepresentation:1.2.0";
};

/**
 * Manifest converter for all 2D Grids, can create either a binGrid, seismic horizon,
 * structure map or generic representation.
 *
 * @param {string} uri
 * @param {SimpleJson<resqml22.Grid2dRepresentation>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @return {(Promise<GenericRepresentation22OSDU | SeismicBinGrid22OSDU | SeismicHorizon22OSDU | StructureMap22OSDU>)}
 */
export const Grid2dRepresentation22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.Grid2dRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<
  GenericRepresentation22OSDU | SeismicBinGrid22OSDU | SeismicHorizon22OSDU | StructureMap22OSDU
> => {
  const kind = Grid2dToOsduKind22(xml);
  if (kind === "osdu:wks:work-product-component--SeismicBinGrid:1.3.0") {
    return new SeismicBinGrid22OSDU(xml, context).initData(uri, xml, client);
  } else if (kind === "osdu:wks:work-product-component--SeismicHorizon:2.0.0") {
    return new SeismicHorizon22OSDU(xml, context).initData(uri, xml, client);
  } else if (kind === "osdu:wks:work-product-component--StructureMap:1.0.0") {
    return new StructureMap22OSDU(xml, context).initData(uri, xml, client);
  }
  return new GenericRepresentation22OSDU(xml, context).initData(
    uri,
    xml,
    client
  );
};
