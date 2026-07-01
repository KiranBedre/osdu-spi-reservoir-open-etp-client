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
  SeismicLineGeometry
} from "./Generated/work-product-component/SeismicLineGeometry.1.2.0";

import { FrameOfReferenceMetaDataItem } from "./Generated/manifest/Manifest.1.0.0";

const RESQML20_PolylineRepresentation = "resqml20.obj_PolylineRepresentation";

/**
 * Convert a RESQML 2.0 SeismicLineFeature to an OSDU SeismicLineGeometry WPC.
 *
 * Maps trace index information (FirstTraceIndex, TraceCount, TraceIndexIncrement)
 * to OSDU CMP range, and resolves associated PolylineRepresentation for spatial info.
 *
 * @export
 * @class SeismicLineGeometryOSDU
 * @extends {ResqmlResource<SimpleJson<resqml20.obj_SeismicLineFeature>>}
 * @implements {SeismicLineGeometry}
 */
export class SeismicLineGeometryOSDU
  extends ResqmlResource<SimpleJson<resqml20.obj_SeismicLineFeature>>
  implements SeismicLineGeometry
{
  public data: Data = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml20.obj_SeismicLineFeature>,
    context: OSDUContext
  ) {
    super(xml, context, "work-product-component", "SeismicLineGeometry.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_SeismicLineFeature>,
    client: ResqmlClient
  ): Promise<SeismicLineGeometryOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    // Compute CMP range from trace indices
    const firstCMP = xml.FirstTraceIndex;
    const lastCMP =
      xml.FirstTraceIndex +
      (xml.TraceCount - 1) * xml.TraceIndexIncrement;
    const hasCMPIncreaseByOne = xml.TraceIndexIncrement === 1;

    // Resolve IsPartOf reference (links to SeismicLineSetFeature = NotionalSeismicLine concept)
    let notionalSeismicLineID: string | undefined;
    if (xml.IsPartOf !== undefined) {
      notionalSeismicLineID = await ResqmlResource.dorToSrn(
        ReservoirDMSUrl,
        xml.IsPartOf,
        client,
        context
      );
    }

    // Try to find an associated PolylineRepresentation for spatial coordinates
    let SpatialPoint: any = undefined;
    let SpatialArea: any = undefined;
    let FrameOfReferenceCRS: FrameOfReferenceMetaDataItem | undefined =
      undefined;
    let firstLocation: any = undefined;
    let lastLocation: any = undefined;
    let HorizontalCRSID: string | undefined = undefined;

    const polylineResources = await client.getSources(
      {
        uri: ReservoirDMSUrl,
        depth: 2,
        dataObjectTypes: [RESQML20_PolylineRepresentation],
        navigableEdges:
          Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both,
        includeSecondarySources: false,
        includeSecondaryTargets: false
      },
      false,
      [RESQML20_PolylineRepresentation]
    );

    if (polylineResources.length > 0) {
      const polylines = await ResqmlResource.getObjects(
        client,
        [polylineResources[0].uri],
        context
      );

      if (polylines && polylines.length > 0) {
        const polyline =
          polylines[0] as SimpleJson<resqml20.obj_PolylineRepresentation>;

        // Get geometry from the polyline representation
        const geometry = polyline.NodePatch?.Geometry;
        if (geometry) {
          const dataspaceUri = EtpUri.createDataSpaceUri(
            new EtpUri(ReservoirDMSUrl).dataSpace
          );

          // Extract CRS reference
          if (geometry.LocalCrs) {
            HorizontalCRSID = await ResqmlResource.dorToSrn(
              ReservoirDMSUrl,
              geometry.LocalCrs,
              client,
              context
            );
          }

          // Compute spatial info from geometry points
          const spatial =
            await ResqmlWorkProductComponent.createSpatialInfo(
              client,
              dataspaceUri.uri,
              [geometry],
              context
            );
          SpatialPoint = spatial.SpatialPoint;
          SpatialArea = spatial.SpatialArea;
          FrameOfReferenceCRS = spatial.FrameOfReferenceCRS;

          // Extract first/last point locations from the polyline
          // The Wgs84Coordinates from spatial info give us projected points
          if (spatial.SpatialArea?.Wgs84Coordinates?.features?.length) {
            const coords =
              spatial.SpatialArea.Wgs84Coordinates.features[0]?.geometry
                ?.coordinates;
            if (coords && coords.length >= 2) {
              const firstCoord = coords[0];
              const lastCoord = coords[coords.length - 1];
              firstLocation = {
                Wgs84Coordinates: {
                  type: "FeatureCollection",
                  features: [
                    {
                      type: "Feature",
                      geometry: {
                        type: "Point",
                        coordinates: firstCoord
                      },
                      properties: {}
                    }
                  ]
                }
              };
              lastLocation = {
                Wgs84Coordinates: {
                  type: "FeatureCollection",
                  features: [
                    {
                      type: "Feature",
                      geometry: {
                        type: "Point",
                        coordinates: lastCoord
                      },
                      properties: {}
                    }
                  ]
                }
              };
            }
          }
        }
      }
    }

    this.data = {
      ExistenceKind: context.addReferenceData("ExistenceKind", "Prototype"),
      ResourceCurationStatus: undefined,
      ResourceHomeRegionID: undefined,
      ResourceHostRegionIDs: undefined,
      ResourceLifecycleStatus: undefined,
      ResourceSecurityClassification: undefined,
      Source: undefined,
      TechnicalAssuranceID: undefined,
      Artefacts: undefined,
      DDMSDatasets: [
        ReservoirDMSUrl.replace("eml:///", `eml://${context.rddmsId}/`)
      ],
      IsDiscoverable: true,
      IsExtendedLoad: false,
      NameAliases: undefined,
      TechnicalAssurances: context.technicalAssurances,
      AuthorIDs: undefined,
      BusinessActivities: undefined,
      CreationDateTime: this.createTime,
      Description: xml.Citation.Description,
      GeoContexts: undefined,
      LineageAssertions: undefined,
      Name: xml.Citation.Title,
      SpatialArea,
      SpatialPoint,
      SubmitterName: context.submitter,
      Tags: undefined,
      // SeismicLineGeometry individual properties
      FirstCMP: firstCMP,
      LastCMP: lastCMP,
      FirstLocation: firstLocation,
      LastLocation: lastLocation,
      FirstStationLabel: undefined,
      LastStationLabel: undefined,
      HasCMPIncreaseByOne: hasCMPIncreaseByOne,
      HasMonotonicLabelling: hasCMPIncreaseByOne ? true : undefined,
      HorizontalCRSID,
      NotionalSeismicLineID: notionalSeismicLineID,
      Preferred2DInterpretationSetID: undefined,
      ExtensionProperties: undefined
    };

    this.meta = FrameOfReferenceCRS ? [FrameOfReferenceCRS] : [];

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

/**
 * Manifest builder for RESQML 2.0 SeismicLineFeature → OSDU SeismicLineGeometry
 */
export const SeismicLineGeometryManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_SeismicLineFeature>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<SeismicLineGeometryOSDU> => {
  return new SeismicLineGeometryOSDU(xml, context).initData(uri, xml, client);
};
