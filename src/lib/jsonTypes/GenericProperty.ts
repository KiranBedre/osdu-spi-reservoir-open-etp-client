import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { EtpUri, ResqmlClient } from "../client/ResqmlClient";
import { normalizeUom } from "./UomNormalize";

import { IDataSubarray } from "../common/EtpTypes";
import { OSDUContext } from "./OsduContext";
import {
  ResqmlWorkProductComponent,
  visitDoubleValues,
  visitIntegerValues
} from "./WorkProductComponent";

import {
  Data,
  FrameOfReferenceMetaDataItem,
  GenericProperty
} from "./Generated/work-product-component/GenericProperty.1.2.0";
import { GenericRepresentation } from "./Generated/work-product-component/GenericRepresentation.1.2.0";
import { getPropertyTypeIDFromResqmlAlias } from "./PropertyTypes";

export class GenericPropertyOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.AbstractValuesProperty>
  >
  implements GenericProperty {
  public data: Data = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  private async computeStats(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.AbstractValuesProperty>,
    client: ResqmlClient
  ) {
    let MinValue: number = Number.POSITIVE_INFINITY;
    let MaxValue: number = Number.NEGATIVE_INFINITY;
    let MeanValue = 0;
    let SqrValue = 0;
    let ValueCount = 0;

    const continuous =
      xml.$type === "resqml20.obj_ContinuousProperty"
        ? (xml as SimpleJson<resqml20.obj_ContinuousProperty>)
        : undefined;

    const discrete =
      xml.$type === "resqml20.obj_DiscreteProperty"
        ? (xml as SimpleJson<resqml20.obj_DiscreteProperty>)
        : undefined;

    const dataspaceUri = EtpUri.createDataSpaceUri(
      new EtpUri(ReservoirDMSUrl).dataSpace
    );

    const visitor = (
      nullValue: number | undefined,
      values: boolean[] | number[] | bigint[],
      _data: IDataSubarray
    ) => {
      for (const n of values) {
        if (nullValue !== undefined) {
          if (n === nullValue) {
            continue;
          }
        } else if (Number.isNaN(n)) {
          continue;
        }
        ValueCount++;
        // convert to double even if it is an integer or bigint
        const d: number = typeof n === "bigint" ? Number(n) : (n as number);
        MinValue = Math.min(d, MinValue);
        MaxValue = Math.max(d, MaxValue);
        MeanValue += d;
        SqrValue += d * d;
      }
    };

    if (continuous !== undefined) {
      for await (const patch of xml.PatchOfValues) {
        await visitDoubleValues(
          dataspaceUri.uri,
          patch.Values,
          client,
          visitor.bind(this, undefined)
        );
      }
    } else if (discrete !== undefined) {
      for await (const patch of xml.PatchOfValues) {
        await visitIntegerValues(
          dataspaceUri.uri,
          patch.Values,
          client,
          visitor
        );
      }
    }

    if (ValueCount) {
      MeanValue = MeanValue / ValueCount;
      return {
        MinValue,
        MaxValue,
        MeanValue,
        StdDeviation: Math.sqrt(SqrValue / ValueCount - MeanValue * MeanValue),
        ValueCount
      };
    } else {
      return {
        MinValue: undefined,
        MaxValue: undefined,
        MeanValue: undefined,
        StdDeviation: undefined,
        ValueCount: undefined
      };
    }
  }

  constructor(
    xml: SimpleJson<resqml20.AbstractValuesProperty>,
    context: OSDUContext
  ) {
    super(xml, context, "GenericProperty.1.2.0");
  }

  /**
   * Initialize Data in an async method
   *
   * @param {string} ReservoirDMSUrl
   * @param {SimpleJson<resqml20.AbstractValuesProperty>} xml
   * @param {ResqmlClient} client
   * @returns {Promise<GenericPropertyOSDU>}
   */
  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.AbstractValuesProperty>,
    client: ResqmlClient
  ): Promise<GenericPropertyOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    const continuous =
      xml.$type === "resqml20.obj_ContinuousProperty"
        ? (xml as SimpleJson<resqml20.obj_ContinuousProperty>)
        : undefined;

    const categorical =
      xml.$type === "resqml20.obj_CategoricalProperty"
        ? (xml as SimpleJson<resqml20.obj_CategoricalProperty>)
        : undefined;

    const discrete =
      xml.$type === "resqml20.obj_DiscreteProperty"
        ? (xml as SimpleJson<resqml20.obj_DiscreteProperty>)
        : undefined;

    const PropertyTopologyID = await GenericPropertyOSDU.dorToSrn(
      ReservoirDMSUrl,
      xml.SupportingRepresentation,
      client,
      context
    );

    let {
      MinValue,
      MaxValue,
      MeanValue,
      StdDeviation,
      ValueCount
    }: {
      MinValue: number | undefined;
      MaxValue: number | undefined;
      MeanValue: number | undefined;
      StdDeviation: number | undefined;
      ValueCount: number | undefined;
    } = {
      MinValue: undefined,
      MaxValue: undefined,
      MeanValue: undefined,
      StdDeviation: undefined,
      ValueCount: undefined
    };
    if (this.__context?.useDataArrayForManifest) {
      // assign the results of computeStats to the variables
      ({ MinValue, MaxValue, MeanValue, StdDeviation, ValueCount } =
        await this.computeStats(ReservoirDMSUrl, xml, client));
    } else {
      if (continuous !== undefined) {
        MinValue = continuous.MinimumValue
          ? continuous.MinimumValue[0]
          : undefined;
        MaxValue = continuous.MaximumValue
          ? continuous.MaximumValue[0]
          : undefined;
      }
      if (discrete !== undefined) {
        MinValue = discrete.MinimumValue ? discrete.MinimumValue[0] : undefined;
        MaxValue = discrete.MaximumValue ? discrete.MaximumValue[0] : undefined;
      }
    }

    const pKind =
      xml.PropertyKind.$type === "resqml20.LocalPropertyKind"
        ? (xml.PropertyKind as SimpleJson<resqml20.LocalPropertyKind>)
        : undefined;

    const facetIDs = xml.Facet
      ? xml.Facet.filter((f: any) => f.Facet && f.Value).map((f: any) => ({
          FacetRoleID: context.addReferenceData("PropertyKindFacet", f.Value) as string,
          FacetTypeID: context.addReferenceData("FacetType", f.Facet) as string
        }))
      : undefined;

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),
      FacetIDs: facetIDs,
      PropertyType: pKind
        ? {
          PropertyTypeID:
            (await GenericPropertyOSDU.dorToSrn(
              ReservoirDMSUrl,
              pKind.LocalPropertyKind,
              client,
              context
            )) ?? "",
          Name: pKind.LocalPropertyKind.Title
        }
        : {
          PropertyTypeID: context.addReferenceData(
            "PropertyType",
            getPropertyTypeIDFromResqmlAlias(
              (xml.PropertyKind as SimpleJson<resqml20.StandardPropertyKind>)
                .Kind
            )
          ),
          Name: (
            xml.PropertyKind as SimpleJson<resqml20.StandardPropertyKind>
          ).Kind
        },
      /**
       * Only populated if ValueType=="string" and the values are expected to represent record
       * ids, e.g. to a reference-data type, then this value holds the kind (optionally without
       * the semantic version number).
       */
      RelationshipTargetKind: undefined,
      /**
       * Only populated of the ValueType is "number". It holds the UnitQuantity associated with
       * this reference property type. It is a relationship to UnitQuantity record.
       */
      UnitQuantityID: undefined,
      ValueCount,
      ValueType: continuous ? "number" : "integer",
      ClassificationTableID: await GenericPropertyOSDU.dorToSrn(
        ReservoirDMSUrl,
        categorical?.Lookup,
        client,
        context
      ),
      IndexableElementID: context.addReferenceData(
        "IndexableElement",
        xml.IndexableElement.replace(" ", "%20")
      ),
      MaxValue,
      MeanValue,
      MinValue,
      PropertyTopologyID,
      PropertyUnitID: context.addReferenceData(
        "UnitOfMeasure",
        normalizeUom(continuous ? continuous.UOM : "Euc")
      ),
      RealizationIndices: xml.RealizationIndex
        ? [xml.RealizationIndex]
        : undefined,
      StdDeviation,
      TimeIndices: undefined,
      TimeSeriesID: undefined,
      TimeValues: undefined,
      ExtensionProperties: undefined
    };

    if (xml.TimeIndex) {
      const time = (await GenericPropertyOSDU.getObjectFromDor(
        client,
        ReservoirDMSUrl,
        xml.TimeIndex.TimeSeries,
        context
      )) as SimpleJson<resqml20.obj_TimeSeries>;
      this.data.TimeSeriesID = await GenericPropertyOSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.TimeIndex.TimeSeries,
        client,
        context
      );
      this.data.TimeIndices = xml.TimeIndex.Index;
      this.data.TimeValues = [
        time.Time[xml.TimeIndex.Index].DateTime.toISOString()
      ];
    }

    await this.initGeometry(ReservoirDMSUrl, xml, client);

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }

  private async initGeometry(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.AbstractValuesProperty>,
    client: ResqmlClient
  ): Promise<void> {
    const PropertyTopologyID = this.data.PropertyTopologyID;
    if (PropertyTopologyID === undefined) {
      return;
    }
    const context = this.__context;
    if (context === undefined) {
      return;
    }
    // Get the geometry form supporting representation
    const osduRep = context.created.get(PropertyTopologyID.slice(0, -1));
    if (osduRep === undefined) {
      const rep = (await GenericPropertyOSDU.getObjectFromDor(
        client,
        ReservoirDMSUrl,
        xml.SupportingRepresentation,
        context
      )) as Record<string, unknown>;

      let geometry = rep["Geometry"] as SimpleJson<resqml20.PointGeometry>;
      if (geometry === undefined) {
        for (const p of Object.keys(rep)) {
          if (Array.isArray(rep[p])) {
            (rep[p] as Array<unknown>).forEach(patch => {
              if (patch !== undefined && typeof patch === "object") {
                const oPatch = patch as Record<string, unknown>;
                if ("Geometry" in oPatch) {
                  const g = oPatch["Geometry"];
                  if (g !== undefined) {
                    geometry = g as SimpleJson<resqml20.PointGeometry>;
                  }
                }
              }
            });
          } else {
            const patch = rep[p] as Record<string, unknown>;
            if (
              patch !== undefined &&
              typeof patch === "object" &&
              "Geometry" in patch
            ) {
              const g = patch["Geometry"];
              if (g !== undefined) {
                geometry = g as SimpleJson<resqml20.PointGeometry>;
              }
            }
          }
        }
      }
      if (geometry) {
        const dataspaceUri = EtpUri.createDataSpaceUri(
          new EtpUri(ReservoirDMSUrl).dataSpace
        ).uri;
        const { SpatialPoint, SpatialArea, FrameOfReferenceCRS } =
          await GenericPropertyOSDU.createSpatialInfo(
            client,
            dataspaceUri,
            [geometry],
            context
          );
        this.data.SpatialPoint = SpatialPoint;
        this.data.SpatialArea = SpatialArea;

        this.meta = [FrameOfReferenceCRS];
      }
    } else {
      const rep = osduRep as GenericRepresentation;
      const d = osduRep.data;
      if (d !== undefined) {
        if (d.SpatialArea !== undefined) {
          this.data.SpatialArea = d.SpatialArea;
        }
        if (d.SpatialPoint !== undefined) {
          this.data.SpatialPoint = d.SpatialPoint;
        }
        if (rep.meta !== undefined) {
          this.meta = rep.meta;
        }
      }
    }
  }
}

export const GenericPropertyManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.AbstractValuesProperty>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<GenericPropertyOSDU | undefined> => {
  const dorUri = ResqmlWorkProductComponent.dorToUri(
    uri,
    xml.SupportingRepresentation
  );
  if (dorUri.includes("resqml20.obj_WellboreFrameRepresentation")) {
    return undefined;
  }
  return new GenericPropertyOSDU(xml, context).initData(uri, xml, client);
};
