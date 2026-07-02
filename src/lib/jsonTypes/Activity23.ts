import * as eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  AbstractActivityParameter,
  Activity,
  Data,
  ParameterKey
} from "./Generated/work-product-component/Activity.1.4.0";

/**
 * Extract OSDU Activity information from Activity
 *
 * @export
 * @class Activity23OSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<eml23.Activity>>}
 * @implements {Activity}
 */
export class Activity23OSDU
  extends ResqmlWorkProductComponent<SimpleJson<eml23.Activity>>
  implements Activity
{
  public data: Data = {
    Parameters: []
  };

  constructor(xml: SimpleJson<eml23.Activity>, context: OSDUContext) {
    super(xml, context, "Activity.1.4.0");
  }

  public async getKeys(
    ReservoirDMSUrl: string,
    keys: SimpleJson<eml23.AbstractParameterKey>[],
    client: ResqmlClient
  ): Promise<ParameterKey[]> {
    const context = this.__context;
    if (context === undefined) {
      return [];
    }

    return Promise.all(
      keys.map(async k => {
        if (k.$type === "eml23.ObjectParameterKey") {
          return {
            ObjectParameterKey: (k as SimpleJson<eml23.ObjectParameterKey>)
              .DataObject.Title
          };
        } else {
          const timeIndex = (k as SimpleJson<eml23.TimeIndexParameterKey>)
            .TimeIndex;
          const time = (await Activity23OSDU.getObjectFromDor(
            client,
            ReservoirDMSUrl,
            timeIndex.TimeSeries,
            context
          )) as SimpleJson<eml23.TimeSeries>;
          return {
            TimeParameterKey: time.Time[timeIndex.Index].DateTime.toISOString()
          };
        }
      })
    );
  }

  private getKind(p: SimpleJson<eml23.AbstractActivityParameter>) {
    if (p.$type === "eml23.DataObjectParameter") {
      return "DataObjectParameter";
    } else if (p.$type === "eml23.FloatingPointQuantityParameter") {
      return "FloatingPointQuantityParameter";
    } else if (p.$type === "eml23.IntegerQuantityParameter") {
      return "IntegerQuantityParameter";
    } // else if (p.$type === "eml23.StringParameter") {
    return "StringParameter";
  }

  public async getParameters(
    ReservoirDMSUrl: string,
    xml: SimpleJson<eml23.AbstractActivityParameter>[],
    client: ResqmlClient
  ): Promise<AbstractActivityParameter[]> {
    const context = this.__context;
    if (context === undefined) {
      return [];
    }

    // Emit only a compact summary: one entry per unique Title grouping the count
    const titleCounts: Record<string, number> = {};
    for (const p of xml) {
      const title = p.Title || "unnamed";
      titleCounts[title] = (titleCounts[title] || 0) + 1;
    }

    const Parameters: AbstractActivityParameter[] = [];
    let idx = 0;
    for (const [title, count] of Object.entries(titleCounts)) {
      Parameters.push({
        ParameterKindID:
          context.addReferenceData("ParameterKind", "DataObject") ?? "",
        Title: title,
        Index: idx++,
        StringParameter: `${count} object(s)`
      });
    }
    return Parameters;
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<eml23.Activity>,
    client: ResqmlClient
  ): Promise<Activity23OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      /**
       * The relation to the ActivityTemplate carrying expected parameter definitions and default
       * values.
       */
      ActivityTemplateID: await Activity23OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.ActivityDescriptor,
        client,
        context
      ),
      /**
       * General parameter value used in one instance of activity.  Includes reference to data
       * objects which are inputs and outputs of the activity.
       */
      Parameters: await this.getParameters(
        ReservoirDMSUrl,
        xml.Parameter,
        client
      ),
      /**
       * The relationship to a parent activity.
       */
      ParentActivityID: await Activity23OSDU.dorToSrn(
        ReservoirDMSUrl,
        xml.Parent,
        client,
        context
      ),
      /**
       * The relationship to a parent project acting as a parent activity.
       */
      ParentProjectID: undefined,
      /**
       * The activity or activities feeding results into this activity instance.
       */
      PriorActivityIDs: undefined,
      /**
       * Software names and versions used.
       */
      SoftwareSpecifications: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }
}

/**
 * Convert RESQML Activity to OSDU type
 *
 * @param {string} uri
 * @param {SimpleJson<eml23.Activity>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @return {Promise<Activity23OSDU>}
 */
export const Activity23Manifest = async (
  uri: string,
  xml: SimpleJson<eml23.Activity>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<Activity23OSDU> =>
  new Activity23OSDU(xml, context).initData(uri, xml, client);
