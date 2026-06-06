import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";
import { normalizeUom } from "./UomNormalize";

import { OSDUContext } from "./OsduContext";
import { ResqmlResource } from "./WorkProductComponent";

import {
  Data,
  PropertyType
} from "./Generated/reference-data/PropertyType.1.0.0";
import { getPropertyTypeIDFromResqmlAlias } from "./PropertyTypes";

/**
 * Create OSDU PropertyType from Resqml PropertyKind
 *
 * @export
 * @class PropertyTypeOSDU
 * @extends {ResqmlResource<SimpleJson<resqml20.obj_PropertyKind>>}
 * @implements {PropertyType}
 */
export class PropertyTypeOSDU
  extends ResqmlResource<SimpleJson<resqml20.obj_PropertyKind>>
  implements PropertyType
{
  public data: Data = {
    ParentPropertyTypeID: "",
    UnitQuantityID: ""
  };

  constructor(
    xml: SimpleJson<resqml20.obj_PropertyKind>,
    context: OSDUContext
  ) {
    super(xml, context, "reference-data", "PropertyType.1.0.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_PropertyKind>,
    client: ResqmlClient
  ): Promise<PropertyTypeOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const localKind =
      xml.ParentPropertyKind.$type === "resqml20.LocalPropertyKind";

    const ParentPropertyTypeID = localKind
      ? (await PropertyTypeOSDU.dorToSrn(
          ReservoirDMSUrl,
          (xml.ParentPropertyKind as SimpleJson<resqml20.LocalPropertyKind>)
            .LocalPropertyKind,
          client,
          context
        )) ?? ""
      : context.addReferenceData(
          "PropertyType",
          getPropertyTypeIDFromResqmlAlias(
            (
              xml.ParentPropertyKind as SimpleJson<resqml20.StandardPropertyKind>
            ).Kind
          )
        ) ?? "";
    this.data = {
      ...(await this.AbstractCommonResources(context)),

      Name: xml.Citation.Title,
      Code: xml.Citation.Title,

      /**
       * Relationship to the parent PropertyType. The root PropertyType is called 'property' and
       * refers to itself as parent.
       */
      ParentPropertyTypeID,
      /**
       * The relationship to a UnitQuantity, which connects to frame of reference conversion.
       */
      UnitQuantityID:
        context.addReferenceData("UnitQuantity", normalizeUom(xml.RepresentativeUom)) || "",

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

/**
 * Convert RESQML PropertyKind to OSDU PropertyType
 *
 * @param {string} uri
 * @param {SimpleJson<resqml20.obj_PropertyKind>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @returns {Promise<PropertyTypeOSDU>}
 */
export const PropertyTypeManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_PropertyKind>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<PropertyTypeOSDU> =>
  new PropertyTypeOSDU(xml, context).initData(uri, xml, client);
