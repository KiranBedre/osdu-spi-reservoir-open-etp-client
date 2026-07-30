import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
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
 * @class ActivityTemplateOSDU
 * @extends {ResqmlResource<SimpleJson<resqml20.obj_ActivityTemplate>>}
 * @implements {ActivityTemplate}
 */
export class ActivityTemplateOSDU
  extends ResqmlResource<SimpleJson<resqml20.obj_ActivityTemplate>>
  implements ActivityTemplate
{
  public data: Data = { Parameters: [] };

  constructor(
    xml: SimpleJson<resqml20.obj_ActivityTemplate>,
    context: OSDUContext
  ) {
    super(xml, context, "master-data", "ActivityTemplate.1.1.0");
  }

  private async getParameters(
    xml: SimpleJson<resqml20.ParameterTemplate>[]
  ): Promise<ParameterTemplate[]> {
    const context = this.__context;
    if (context === undefined) {
      return [];
    }

    const Parameters: ParameterTemplate[] = [];

    for (const p of xml) {
      // Map AllowedKind[] to a single reference-data string
      // OSDU expects a single ParameterKind reference; use first if multiple
      let allowedParameterKind: string | undefined;
      if (p.AllowedKind && p.AllowedKind.length > 0) {
        allowedParameterKind = context.addReferenceData(
          "ParameterKind",
          p.AllowedKind[0]
        );
      }

      // Map DataObjectContentType (single string in RESQML → string[] in OSDU)
      const dataObjectContentType = p.DataObjectContentType
        ? [p.DataObjectContentType]
        : undefined;

      // Map DefaultValue[] — OSDU takes single AbstractActivityParameter;
      // use first default if multiple are provided
      let defaultValue: any = undefined;
      if (p.DefaultValue && p.DefaultValue.length > 0) {
        const dv = p.DefaultValue[0] as any;
        if (dv.$type?.includes("StringParameter")) {
          defaultValue = { StringParameter: dv.Value, Title: dv.Title };
        } else if (
          dv.$type?.includes("FloatingPoint") ||
          dv.$type?.includes("Double")
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
    xml: SimpleJson<resqml20.obj_ActivityTemplate>
  ): Promise<ActivityTemplateOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    this.data = {
      ...(await this.AbstractCommonResources(context)),

      Parameters: await this.getParameters(xml.Parameter)
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

/**
 * Convert RESQML ActivityTemplate to OSDU type
 *
 * @param {string} _uri
 * @param {SimpleJson<resqml20.obj_ActivityTemplate>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} _client
 * @returns {Promise<ActivityTemplateOSDU>}
 */
export const ActivityTemplateManifest = async (
  _uri: string,
  xml: SimpleJson<resqml20.obj_ActivityTemplate>,
  context: OSDUContext,
  _client: ResqmlClient
): Promise<ActivityTemplateOSDU> =>
  new ActivityTemplateOSDU(xml, context).initData(xml);
