import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpUri, ResqmlClient } from "../client/ResqmlClient";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  Data,
  FrameOfReferenceMetaDataItem,
  SeismicHorizon
} from "./Generated/work-product-component/SeismicHorizon.2.0.0";

/**
 * Extract SeismicHorizon information from a Resqml 2.2 2D grid
 *
 * @export
 * @class SeismicHorizon22OSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml22.Grid2dRepresentation>>}
 * @implements {SeismicBinGrid}
 */
export class SeismicHorizon22OSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml22.Grid2dRepresentation>>
  implements SeismicHorizon
{
  public data: Data = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  constructor(
    xml: SimpleJson<resqml22.Grid2dRepresentation>,
    context: OSDUContext
  ) {
    super(xml, context, "SeismicHorizon.2.0.0");
  }

  /**
   * Check if a 2D grid can be an OSDU SeismicHorizon
   *
   * @static
   * @param {SimpleJson<resqml22.Grid2dRepresentation>} xml
   * @return {boolean}
   * @memberof SeismicHorizonOSDU
   */
  static matchType(xml: SimpleJson<resqml22.Grid2dRepresentation>): boolean {
    const geo = xml.Geometry;
    if (!geo?.Points || geo.Points.$type !== "resqml22.Point3dZValueArray") {
      return false;
    }
    const p = geo.Points as SimpleJson<resqml22.Point3dZValueArray>;

    if (
      !p.SupportingGeometry ||
      p.SupportingGeometry.$type !==
      "resqml22.Point3dFromRepresentationLatticeArray"
    ) {
      return false;
    }

    if (xml.RepresentedObject?.QualifiedType === undefined) {
      return false;
    }
    const ct = xml.RepresentedObject.QualifiedType.split(".");
    return ct.length === 2 && (ct[1] === "obj_HorizonInterpretation" || ct[1] === "HorizonInterpretation");
  }

  public getGeometries(
    xml: SimpleJson<resqml22.Grid2dRepresentation>
  ): SimpleJson<resqml22.PointGeometry>[] {
    xml as SimpleJson<resqml22.Grid2dRepresentation>;
    return [xml.Geometry];
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.Grid2dRepresentation>,
    client: ResqmlClient
  ): Promise<SeismicHorizon22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const geo = xml.Geometry;
    if (!geo?.Points) {
      return this;
    }

    if (geo.Points.$type !== "resqml22.Point3dZValueArray") {
      return this;
    }
    const p = geo.Points as SimpleJson<resqml22.Point3dZValueArray>;

    if (
      p.SupportingGeometry.$type !==
      "resqml22.Point3dFromRepresentationLatticeArray"
    ) {
      return this;
    }

    const interpretation =
      xml.RepresentedObject?.QualifiedType ===
      "resqml22.obj_HorizonInterpretation"
        ? (xml.RepresentedObject
            ?._data as SimpleJson<resqml22.HorizonInterpretation>)
        : undefined;

    const lat =
      p.SupportingGeometry as SimpleJson<resqml22.Point3dFromRepresentationLatticeArray>;

    const binGrid = lat.SupportingRepresentation
      ._data as SimpleJson<resqml22.AbstractRepresentation>;

    const binInterpretation = binGrid.RepresentedObject
      ?._data as SimpleJson<resqml22.AbstractFeatureInterpretation>;
    const feat: SimpleJson<resqml22.SeismicLatticeFeature> | undefined =
      binInterpretation?.InterpretedFeature
        ._data as SimpleJson<resqml22.SeismicLatticeFeature>;

    const inlineCount = feat?.InlineLabels?.Offset[0].Count ?? 1;

    const startInlineIndex = feat?.InlineLabels?.StartValue ?? 0;
    const startCrosslineIndex = feat?.CrosslineLabels?.StartValue ?? 0;

    const startInline =
      startInlineIndex +
      (lat.NodeIndicesOnSupportingRepresentation.StartValue % inlineCount);

    const startCrossline =
      startCrosslineIndex +
      lat.NodeIndicesOnSupportingRepresentation.StartValue / inlineCount;

    let Role = undefined;
    if ("SurfaceRole" in xml) {
      Role = (xml as any).SurfaceRole;
    } else if ("LineRole" in xml) {
      Role = (xml as any).LineRole;
    }

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
      InterpretationID: await SeismicHorizon22OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.RepresentedObject,
        client,
        context
      ),
      InterpretationName: interpretation?.Citation.Title,
      LocalModelCompoundCrsID: await SeismicHorizon22OSDU.dorToSrn(
        ReservoirDMSUrl,
        geo.LocalCrs,
        client,
        context
      ),
      RealizationIndex: undefined,
      TimeSeries: undefined,
      BinGridID: await SeismicHorizon22OSDU.dorToSrn(
        ReservoirDMSUrl,
        lat.SupportingRepresentation,
        client,
        context
      ),
      CrosslineMax:
        startCrossline +
        (feat.CrosslineLabels?.Offset[0].Value ?? 1) * xml.SlowestAxisCount,
      CrosslineMin: startCrossline,
      DomainTypeID: undefined,
      GeologicalUnitName: interpretation?.InterpretedFeature.Title,
      InlineMax:
        startInline +
        (feat.InlineLabels?.Offset[0].Value ?? 1) * xml.FastestAxisCount,
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
      } = await SeismicHorizon22OSDU.createSpatialInfo(
        client,
        dataspaceUri.uri,
        geometries,
        context
      );

      (this.data.DomainTypeID = context.addReferenceData("DomainType", Domain)),
        (this.data.SpatialPoint = SpatialPoint);
      this.data.SpatialArea = SpatialArea;
      this.meta = [FrameOfReferenceCRS];

      if (this.data.IndexableElementCount === undefined) {
        this.data.IndexableElementCount = [];
      }
      if (NodeCount !== undefined) {
        // Add the node count to the IndexableElementCount
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
        const l = await SeismicHorizon22OSDU.dorToSrn(
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
