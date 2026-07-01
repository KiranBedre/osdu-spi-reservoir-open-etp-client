import * as eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlResource } from "./WorkProductComponent";

import {
  Data,
  PropertyType
} from "./Generated/reference-data/PropertyType.1.0.0";
import {
  getPropertyTypeIDFromResqmlAlias,
  PropertyTypesIds
} from "./PropertyTypes";

/**
 * Create OSDU PropertyType from Resqml PropertyKind
 *
 * @export
 * @class PropertyType23OSDU
 * @extends {ResqmlResource<SimpleJson<eml23.PropertyKind>>}
 * @implements {PropertyType}
 */
export class PropertyType23OSDU
  extends ResqmlResource<SimpleJson<eml23.PropertyKind>>
  implements PropertyType
{
  public data: Data = {
    ParentPropertyTypeID: "",
    UnitQuantityID: ""
  };

  constructor(xml: SimpleJson<eml23.PropertyKind>, context: OSDUContext) {
    super(xml, context, "reference-data", "PropertyType.1.0.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<eml23.PropertyKind>,
    client: ResqmlClient
  ): Promise<PropertyType23OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    const pwlsKind = PropertyTypesIds.has(xml.Parent?.Uuid ?? "");

    const ParentPropertyTypeID = pwlsKind
      ? context.addReferenceData("PropertyType", xml.Parent?.Uuid ?? "") ?? ""
      : (await PropertyType23OSDU.dorToSrn(
          ReservoirDMSUrl,
          xml.Parent,
          client,
          context
        )) ?? "";

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
        context.addReferenceData("UnitQuantity", xml.QuantityClass) ?? "",

      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

/**
 * Convert EML 2.3 PropertyKind to OSDU PropertyType
 *
 * @param {string} uri
 * @param {SimpleJson<reml23.PropertyKind>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @return {Promise<PropertyType23OSDU>}
 */
export const PropertyType23Manifest = async (
  uri: string,
  xml: SimpleJson<eml23.PropertyKind>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<PropertyType23OSDU> =>
  new PropertyType23OSDU(xml, context).initData(uri, xml, client);
