import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpContentType, EtpUri, ResqmlClient } from "../client/ResqmlClient";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";
import { getKindOrFallback } from "./MilestoneKinds";

import {
  Data,
  FrameOfReferenceMetaDataItem,
  SeismicHorizon
} from "./Generated/work-product-component/SeismicHorizon.2.0.0";

/**
 * Extract SeismicHorizon information from a 2D grid
 *
 * @export
 * @class SeismicHorizonOSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml20.obj_Grid2dRepresentation>>}
 * @implements {SeismicBinGrid}
 */
export class SeismicHorizonOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_Grid2dRepresentation>
  >
  implements SeismicHorizon
{
  public data: Data = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "SeismicHorizon.2.0.0");
    // The generated TS type tracks 2.0.0, but the emitted kind must match the
    // milestone-selected version (M27 → 2.1.0) used for dispatch in
    // Grid2dToOsduKind, so the routed kind and the serialized record agree.
    this.kind = getKindOrFallback("SeismicHorizon");
  }

  /**
   * Check if a 2D grid can be an OSDU SeismicHorizon
   *
   * @static
   * @param {SimpleJson<resqml20.obj_Grid2dRepresentation>} xml
   * @returns {boolean}
   * @memberof SeismicHorizonOSDU
   */
  static matchType(
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>
  ): boolean {
    const geo = xml.Grid2dPatch.Geometry;
    if (geo.Points.$type !== "resqml20.Point3dZValueArray") {
      return false;
    }
    const p = geo.Points as SimpleJson<resqml20.Point3dZValueArray>;

    if (
      p.SupportingGeometry.$type !==
      "resqml20.Point3dFromRepresentationLatticeArray"
    ) {
      return false;
    }

    if (xml.RepresentedInterpretation?.ContentType === undefined) {
      return false;
    }
    const ct = new EtpContentType(xml.RepresentedInterpretation?.ContentType);
    return ct.dataType === "obj_HorizonInterpretation";
  }

  public getGeometries(
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>
  ): SimpleJson<resqml20.PointGeometry>[] {
    xml as SimpleJson<resqml20.obj_Grid2dRepresentation>;
    return [xml.Grid2dPatch.Geometry];
  }

  /**
   * Compute the coverage binGrid
   * @param {SimpleJson<resqml20.obj_SeismicLatticeFeature> | undefined} feat lattice feature
   * @param {SimpleJson<resqml20.Point3dFromRepresentationLatticeArray>} lat lattice coordinates
   * @returns
   */
  private coverage(
    feat: SimpleJson<resqml20.obj_SeismicLatticeFeature> | undefined,
    lat: SimpleJson<resqml20.Point3dFromRepresentationLatticeArray>
  ) {
    let NI = undefined;
    let NJ = undefined;
    let dI = undefined;
    let dJ = undefined;
    let BinGridCoveragePercent = undefined;
    if (
      feat &&
      lat.NodeIndicesOnSupportingRepresentation.$type ==
        "resqml20.IntegerLatticeArray"
    ) {
      const offset =
        lat.NodeIndicesOnSupportingRepresentation as SimpleJson<resqml20.IntegerLatticeArray>;
      if (offset.Offset.length === 2) {
        const iOffset = offset
          .Offset[0] as SimpleJson<resqml20.IntegerConstantArray>;
        const jOffset = offset
          .Offset[1] as SimpleJson<resqml20.IntegerConstantArray>;
        if (
          iOffset.$type == "resqml20.IntegerConstantArray" &&
          jOffset.$type == "resqml20.IntegerConstantArray"
        ) {
          NI = iOffset.Count + 1;
          dI = iOffset.Value;
          NJ = jOffset.Count + 1;
          dJ = jOffset.Value;
          BinGridCoveragePercent =
            (100.0 * (NI * dI * NJ * dJ)) /
            (feat.InlineCount * feat.CrosslineCount);
        }
      }
    }
    return BinGridCoveragePercent;
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_Grid2dRepresentation>,
    client: ResqmlClient
  ): Promise<SeismicHorizonOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const geo = xml.Grid2dPatch.Geometry;

    if (geo.Points.$type !== "resqml20.Point3dZValueArray") {
      return this;
    }
    const p = geo.Points as SimpleJson<resqml20.Point3dZValueArray>;

    if (
      p.SupportingGeometry.$type !==
      "resqml20.Point3dFromRepresentationLatticeArray"
    ) {
      return this;
    }

    let Role = undefined;
    if ("SurfaceRole" in xml) {
      Role = (xml as any).SurfaceRole;
    } else if ("LineRole" in xml) {
      Role = (xml as any).LineRole;
    }

    const interpretation = xml.RepresentedInterpretation
      ?._data as SimpleJson<resqml20.obj_HorizonInterpretation>;

    const lat =
      p.SupportingGeometry as SimpleJson<resqml20.Point3dFromRepresentationLatticeArray>;

    const binGrid = lat.SupportingRepresentation
      ._data as SimpleJson<resqml20.AbstractRepresentation>;

    const binInterpretation = binGrid.RepresentedInterpretation
      ?._data as SimpleJson<resqml20.AbstractFeatureInterpretation>;
    const feat: SimpleJson<resqml20.obj_SeismicLatticeFeature> | undefined =
      binInterpretation?.InterpretedFeature
        ._data as SimpleJson<resqml20.obj_SeismicLatticeFeature>;

    const startInlineIndex = feat?.FirstInlineIndex ?? 0;
    const startCrosslineIndex = feat?.FirstCrosslineIndex ?? 0;

    const startInline =
      startInlineIndex +
      (lat.NodeIndicesOnSupportingRepresentation.StartValue % feat.InlineCount);

    const startCrossline =
      startCrosslineIndex +
      lat.NodeIndicesOnSupportingRepresentation.StartValue / feat.InlineCount;

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      IndexableElementCount: undefined,
      InterpretationID: await SeismicHorizonOSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedInterpretation,
        client,
        context
      ),
      InterpretationName: interpretation.Citation.Title,
      LocalModelCompoundCrsID: await SeismicHorizonOSDU.dorToSrn(
        ReservoirDMSUrl,
        geo.LocalCrs,
        client,
        context
      ),
      RealizationIndex: undefined,
      TimeSeries: undefined,
      BinGridID: await SeismicHorizonOSDU.dorToSrn(
        ReservoirDMSUrl,
        lat.SupportingRepresentation,
        client,
        context
      ),
      CrosslineMax:
        startCrossline +
        feat.CrosslineIndexIncrement * (xml.Grid2dPatch.SlowestAxisCount - 1),
      CrosslineMin: startCrossline,
      DomainTypeID: undefined,
      GeologicalUnitName: interpretation.InterpretedFeature.Title,
      InlineMax:
        startInline +
        feat.InlineIndexIncrement * (xml.Grid2dPatch.FastestAxisCount - 1),
      InlineMin: startInline,
      Interpreter: xml.Citation.Originator,
      PetroleumSystemElementTypeID: undefined,
      Remark: undefined,
      RepresentationRole: context.addReferenceData(
        "RepresentationRole",
        this.capitalize(Role)
      ),
      RepresentationType: context.addReferenceData(
        "RepresentationType",
        xml.$type?.split(".")[1].slice(4)
      ),
      Seismic2DInterpretationSetID: undefined,
      Seismic3DInterpretationSetID: undefined,
      SeismicHorizonTypeID: undefined,
      SeismicLineGeometryIDs: undefined,
      SeismicPickingTypeID: undefined,
      SeismicTraceDataIDs: undefined,
      SubjectiveClassificationRatingIDs: undefined,
      ExtensionProperties: undefined
    };

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
      } = await SeismicHorizonOSDU.createSpatialInfo(
        client,
        dataspaceUri.uri,
        geometries,
        context
      );

      this.data.SpatialPoint = SpatialPoint;
      this.data.SpatialArea = SpatialArea;
      (this.data.DomainTypeID = this.data.DomainTypeID =
        context.addReferenceData("DomainType", Domain)),
        (this.meta = [FrameOfReferenceCRS]);

      if (this.data.IndexableElementCount === undefined) {
        this.data.IndexableElementCount = [];
      }
      if (NodeCount !== undefined) {
        this.data.IndexableElementCount?.push({
          Count: NodeCount,
          IndexableElementID: context.addReferenceData(
            "IndexableElement",
            "nodes"
          )
        });
      }
    }

    const dors = await this.getCreatingObjects(client, ReservoirDMSUrl);
    if (dors.length > 0) {
      this.data.LineageAssertions = [];
      for (const d of dors) {
        const l = await SeismicHorizonOSDU.dorToSrn(
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
