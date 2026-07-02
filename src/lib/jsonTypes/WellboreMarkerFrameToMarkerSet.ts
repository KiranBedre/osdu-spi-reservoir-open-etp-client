/**
 * Flatten RESQML WellboreMarkerFrameRepresentation -> WPC--WellboreMarkerSet:1.2.0
 *
 * A WellboreMarkerFrameRepresentation pairs an ordered list of WellboreMarker
 * elements with a parallel NodeMd array (one MD value per marker, by index).
 * The generic representation converter emitted a bare WPC with no Markers[],
 * no WellboreID and no interpretation references. This converter produces a
 * proper WellboreMarkerSet record:
 *   - WellboreID            <- frame.RepresentedInterpretation (WellboreInterpretation)
 *   - Markers[].MarkerName  <- WellboreMarker.Citation.Title
 *   - Markers[].MarkerMeasuredDepth        <- NodeMd[i]
 *   - Markers[].InterpretationID           <- WellboreMarker.Interpretation (HorizonInterpretation, ...)
 *   - Markers[].MarkerObservationNumber    <- i + 1 (document order)
 *   - Markers[].MarkerGeologicUnitID / boundary kind carried where available
 */
import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import {
  ResqmlWorkProductComponent,
  ResqmlResource,
  visitDoubleValues
} from "./WorkProductComponent";

/** One formation-top pick in an OSDU WellboreMarkerSet:1.2.0 record. */
interface Marker {
  MarkerName?: string;
  MarkerMeasuredDepth?: number;
  MarkerObservationNumber?: number;
  MarkerTypeID?: string;
  InterpretationID?: string;
  GeologicalAge?: string;
  [key: string]: unknown;
}

/** OSDU WellboreMarkerSet:1.2.0 data block. */
interface MarkerSetData {
  WellboreID?: string;
  Markers?: Marker[];
  StratigraphicColumnID?: string;
  StratigraphicColumnRankInterpretationID?: string;
  [key: string]: unknown;
}

/**
 * Extract an OSDU WellboreMarkerSet WPC from a RESQML 2.0
 * WellboreMarkerFrameRepresentation.
 */
export class WellboreMarkerFrameToMarkerSetOSDU extends ResqmlWorkProductComponent<
  SimpleJson<resqml20.obj_WellboreMarkerFrameRepresentation>
> {
  public data: MarkerSetData = {};

  constructor(
    xml: SimpleJson<resqml20.obj_WellboreMarkerFrameRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "WellboreMarkerSet.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_WellboreMarkerFrameRepresentation>,
    client: ResqmlClient
  ): Promise<WellboreMarkerFrameToMarkerSetOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    // Resolve wellbore reference (RepresentedInterpretation -> WellboreInterpretation)
    let wellboreSrn: string | undefined;
    if (xml.RepresentedInterpretation) {
      wellboreSrn = await ResqmlResource.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedInterpretation,
        client,
        context
      );
    }

    // Read the parallel NodeMd array (one value per marker, by index).
    const mdValues = await this.readNodeMd(ReservoirDMSUrl, xml, client);

    // Build Markers[] in document order, pairing marker[i] with mdValues[i].
    const markerElems = this.normaliseMarkers(xml.WellboreMarker);
    const markers: Marker[] = [];
    for (let i = 0; i < markerElems.length; i++) {
      const m = markerElems[i];
      const marker: Marker = {
        MarkerName: m.Citation?.Title,
        MarkerMeasuredDepth: mdValues[i],
        MarkerObservationNumber: i + 1
      };
      if (m.Interpretation) {
        marker.InterpretationID = await ResqmlResource.dorToSrn(
          ReservoirDMSUrl,
          m.Interpretation,
          client,
          context
        );
      }
      if (m.GeologicBoundaryKind) {
        marker.MarkerTypeID = context.addReferenceData(
          "MarkerType",
          String(m.GeologicBoundaryKind)
        );
      }
      markers.push(marker);
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      WellboreID: wellboreSrn,
      Markers: markers.length > 0 ? markers : undefined,

      // Frame does not carry a stratigraphic-column reference directly.
      StratigraphicColumnID: undefined,
      StratigraphicColumnRankInterpretationID: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }

  /** Normalise WellboreMarker into an array (SimpleJson collapses singletons). */
  private normaliseMarkers(
    wm:
      | SimpleJson<resqml20.WellboreMarker>
      | SimpleJson<resqml20.WellboreMarker>[]
      | undefined
  ): SimpleJson<resqml20.WellboreMarker>[] {
    if (wm === undefined) {
      return [];
    }
    return Array.isArray(wm) ? wm : [wm];
  }

  /** Read NodeMd into a flat, index-ordered array of MD values. */
  private async readNodeMd(
    uri: string,
    xml: SimpleJson<resqml20.obj_WellboreMarkerFrameRepresentation>,
    client: ResqmlClient
  ): Promise<number[]> {
    const out: number[] = [];
    if (!xml.NodeMd) {
      return out;
    }
    try {
      await visitDoubleValues(uri, xml.NodeMd, client, async (values, meta) => {
        const start =
          meta && meta.starts && meta.starts.length > 0 ? meta.starts[0] : 0;
        for (let i = 0; i < values.length; i++) {
          out[start + i] = Number(values[i]);
        }
      });
    } catch {
      // If the array cannot be read, emit markers without MD values.
    }
    return out;
  }
}

export const WellboreMarkerFrameToMarkerSetManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_WellboreMarkerFrameRepresentation>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<WellboreMarkerFrameToMarkerSetOSDU> =>
  new WellboreMarkerFrameToMarkerSetOSDU(xml, context).initData(
    uri,
    xml,
    client
  );
