import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import * as eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
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

export class GenericProperty22OSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml22.AbstractValuesProperty>
  >
  implements GenericProperty {
  public data: Data = {};
  public meta?: FrameOfReferenceMetaDataItem[];

  private async computeStats(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.AbstractValuesProperty>,
    client: ResqmlClient
  ) {
    let MinValue: number | undefined = undefined;
    let MaxValue: number | undefined = undefined;
    let MeanValue: number | undefined = undefined;
    let SqrValue: number | undefined = undefined;
    let ValueCount = 0;

    const continuous =
      xml.$type === "resqml22.ContinuousProperty"
        ? (xml as SimpleJson<resqml22.ContinuousProperty>)
        : undefined;

    const discrete =
      xml.$type === "resqml22.DiscreteProperty"
        ? (xml as SimpleJson<resqml22.DiscreteProperty>)
        : undefined;

    const dataspaceUri = EtpUri.createDataSpaceUri(
      new EtpUri(ReservoirDMSUrl).dataSpace
    );

    const visitor = (
      nullValue: number | undefined,
      values: boolean[] | number[] | bigint[],
      _data: IDataSubarray
    ) => {
      // Check if values is an array of bigints
      if (values.length > 0 && typeof values[0] === "number") {
        const v = values as number[];
        MinValue = Number.POSITIVE_INFINITY;
        MaxValue = Number.NEGATIVE_INFINITY;
        MeanValue = 0;
        SqrValue = 0;
        for (const n of v) {
          if (nullValue !== undefined) {
            if (n === nullValue) {
              continue;
            }
          } else if (Number.isNaN(n)) {
            continue;
          }
          ValueCount++;
          MinValue = Math.min(n, MinValue);
          MaxValue = Math.max(n, MaxValue);
          MeanValue += n;
          SqrValue += n * n;
        }
      } else if (values.length > 0 && typeof values[0] === "bigint") {
        const v = values as bigint[];
        if (nullValue === undefined) {
          ValueCount = v.length;
        } else {
          for (const n of v) {
            if (n !== BigInt(nullValue)) {
              ValueCount++;
            }
          }
        }
      }
    };

    if (continuous !== undefined) {
      for await (const patch of xml.ValuesForPatch) {
        await visitDoubleValues(
          dataspaceUri.uri,
          patch as SimpleJson<eml23.AbstractFloatingPointArray>,
          client,
          visitor.bind(this, undefined)
        );
      }
    } else if (discrete !== undefined) {
      for await (const patch of xml.ValuesForPatch) {
        await visitIntegerValues(
          dataspaceUri.uri,
          patch as SimpleJson<eml23.AbstractIntegerArray>,
          client,
          visitor
        );
      }
    }

    if (MeanValue !== undefined && SqrValue !== undefined && ValueCount) {
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
        MinValue,
        MaxValue,
        MeanValue,
        StdDeviation: undefined,
        ValueCount
      };
    }
  }

  constructor(
    xml: SimpleJson<resqml22.AbstractValuesProperty>,
    context: OSDUContext
  ) {
    super(xml, context, "GenericProperty.1.2.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.AbstractValuesProperty>,
    client: ResqmlClient
  ): Promise<GenericProperty22OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    const continuous =
      xml.$type === "resqml22.ContinuousProperty"
        ? (xml as SimpleJson<resqml22.ContinuousProperty>)
        : undefined;

    const categorical =
      xml.$type === "resqml22.DiscreteProperty"
        ? (xml as SimpleJson<resqml22.DiscreteProperty>)
        : undefined;

    const PropertyTopologyID = await GenericProperty22OSDU.dorToSrn(
      ReservoirDMSUrl,
      xml.SupportingRepresentation,
      client,
      context
    );

    const { MinValue, MaxValue, MeanValue, StdDeviation, ValueCount } =
      await this.computeStats(ReservoirDMSUrl, xml, client);

    const pKind =
      xml.PropertyKind.QualifiedType === "eml23.PropertyKind"
        ? xml.PropertyKind
        : undefined;

    //Map RealizationIndices, TimeIndices, Facets
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
          PropertyTypeID: context.addReferenceData(
            "PropertyType",
            pKind.Uuid
          ),
          Name: pKind.Title
        }
        : undefined,
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
      ClassificationTableID: await GenericProperty22OSDU.dorToSrn(
        ReservoirDMSUrl,
        categorical?.CategoryLookup,
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
        normalizeUom(continuous ? continuous.Uom : "Euc")
      ),
      RealizationIndices: xml.RealizationIndices
        ? [xml.RealizationIndices as any as number]
        : undefined,
      StdDeviation,
      TimeIndices: undefined,
      TimeSeriesID: undefined,
      TimeValues: undefined,
      ExtensionProperties: undefined
    };

    if (xml.TimeOrIntervalSeries) {
      this.data.TimeSeriesID = await GenericProperty22OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.TimeOrIntervalSeries.TimeSeries,
        client,
        context
      );
      this.data.TimeIndices = (xml.TimeOrIntervalSeries as any).TimeIndexStart;
      this.data.TimeValues = xml.Time
        ? [xml.Time.DateTime.toISOString()]
        : undefined;
    }

    await this.initGeometry(ReservoirDMSUrl, xml, client);

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }

  private async initGeometry(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml22.AbstractValuesProperty>,
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
      const rep = (await GenericProperty22OSDU.getObjectFromDor(
        client,
        ReservoirDMSUrl,
        xml.SupportingRepresentation,
        context
      )) as Record<string, unknown>;

      let geometry = rep["Geometry"] as SimpleJson<resqml22.PointGeometry>;
      if (geometry === undefined) {
        for (const p of Object.keys(rep)) {
          if (Array.isArray(rep[p])) {
            (rep[p] as Array<unknown>).forEach(patch => {
              if (patch !== undefined && typeof patch === "object") {
                const oPatch = patch as Record<string, unknown>;
                if ("Geometry" in oPatch) {
                  const g = oPatch["Geometry"];
                  if (g !== undefined) {
                    geometry = g as SimpleJson<resqml22.PointGeometry>;
                  }
                }
              }
            });
          } else {
            const patch = rep[p] as Record<string, unknown>;
            if (patch !== undefined && typeof patch === "object") {
              if ("Geometry" in patch) {
                const g = patch["Geometry"];
                if (g !== undefined) {
                  geometry = g as SimpleJson<resqml22.PointGeometry>;
                }
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
          await ResqmlWorkProductComponent.createSpatialInfo(
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

export const GenericProperty22Manifest = async (
  uri: string,
  xml: SimpleJson<resqml22.AbstractValuesProperty>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<GenericProperty22OSDU | undefined> => {
  const dorUri = ResqmlWorkProductComponent.dorToUri(
    uri,
    xml.SupportingRepresentation
  );
  if (dorUri.includes("resqml22.WellboreFrameRepresentation")) {
    return undefined;
  }
  return new GenericProperty22OSDU(xml, context).initData(uri, xml, client);
};
