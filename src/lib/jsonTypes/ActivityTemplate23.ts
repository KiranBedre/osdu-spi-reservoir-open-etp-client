import * as eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlResource } from "./WorkProductComponent";

import {
  ActivityTemplate,
  Data,
  ParameterTemplate
} from "./Generated/master-data/ActivityTemplate.1.1.0";

/**
 * Extract OSDU ActivityTemplate information from ActivityTemplate
 *
 * @export
 * @class ActivityTemplate23OSDU
 * @extends {ResqmlResource<SimpleJson<eml23.ActivityTemplate>>}
 * @implements {ActivityTemplate}
 */
export class ActivityTemplate23OSDU
  extends ResqmlResource<SimpleJson<eml23.ActivityTemplate>>
  implements ActivityTemplate {
  public data: Data = { Parameters: [] };

  constructor(xml: SimpleJson<eml23.ActivityTemplate>, context: OSDUContext) {
    super(xml, context, "master-data", "ActivityTemplate.1.1.0");
  }

  private async getParameters(
    xml: SimpleJson<eml23.ParameterTemplate>[]
  ): Promise<ParameterTemplate[]> {
    const context = this.__context;
    if (context === undefined) {
      return [];
    }

    const Parameters: ParameterTemplate[] = [];

    for (const p of xml) {
      // Map AllowedKind[] to a single reference-data string
      let allowedParameterKind: string | undefined;
      if (p.AllowedKind && p.AllowedKind.length > 0) {
        allowedParameterKind = context.addReferenceData(
          "ParameterKind",
          p.AllowedKind[0]
        );
      }

      // Map DataObjectContentType (single string in EML → string[] in OSDU)
      const dataObjectContentType = p.DataObjectContentType
        ? [p.DataObjectContentType]
        : undefined;

      // Map DefaultValue[] - OSDU takes single AbstractActivityParameter
      let defaultValue: any = undefined;
      if (p.DefaultValue && p.DefaultValue.length > 0) {
        const dv = p.DefaultValue[0] as any;
        if (dv.$type?.includes("StringParameter")) {
          defaultValue = { StringParameter: dv.Value, Title: dv.Title };
        } else if (
          dv.$type?.includes("DoubleQuantity") ||
          dv.$type?.includes("FloatingPoint")
        ) {
          defaultValue = {
            DataQuantityParameter: dv.Value,
            DataQuantityParameterUOMID: dv.Uom
              ? context.addReferenceData("UnitOfMeasure", dv.Uom)
              : undefined,
            Title: dv.Title
          };
        } else if (dv.$type?.includes("Integer")) {
          defaultValue = {
            IntegerQuantityParameter: dv.Value,
            Title: dv.Title
          };
        }
      }

      // Map KeyConstraint (string[] in both)
      const keyConstraints =
        p.KeyConstraint && p.KeyConstraint.length > 0
          ? p.KeyConstraint
          : undefined;

      Parameters.push({
        AllowedParameterKind: allowedParameterKind,
        Constraint: p.Constraint,
        DataObjectContentType: dataObjectContentType,
        DefaultValue: defaultValue,
        IsInput: p.IsInput,
        IsOutput: p.IsOutput,
        KeyConstraints: keyConstraints,
        MaxOccurs: p.MaxOccurs,
        MinOccurs: p.MinOccurs,
        PropertyType: undefined,
        Title: p.Title,
        UnitQuantityID: undefined
      });
    }
    return Parameters;
  }

  public async initData(
    xml: SimpleJson<eml23.ActivityTemplate>
  ): Promise<ActivityTemplate23OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    this.data = {
      ...(await this.AbstractCommonResources(context)),

      Parameters: await this.getParameters(xml.Parameter)
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

/**
 * Convert RESQML ActivityTemplate to OSDU type
 *
 * @param {string} _uri
 * @param {SimpleJson<eml23.ActivityTemplate>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} _client
 * @return {Promise<ActivityTemplate23OSDU>}
 */
export const ActivityTemplate23Manifest = async (
  _uri: string,
  xml: SimpleJson<eml23.ActivityTemplate>,
  context: OSDUContext,
  _client: ResqmlClient
): Promise<ActivityTemplate23OSDU> =>
  new ActivityTemplate23OSDU(xml, context).initData(xml);
