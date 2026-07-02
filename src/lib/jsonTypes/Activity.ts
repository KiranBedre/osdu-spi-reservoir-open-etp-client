import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
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
 * @class ActivityOSDU
 * @extends {ResqmlWorkProductComponent<SimpleJson<resqml20.obj_Activity>>}
 * @implements {Activity}
 */
export class ActivityOSDU
  extends ResqmlWorkProductComponent<SimpleJson<resqml20.obj_Activity>>
  implements Activity
{
  public data: Data = {
    Parameters: []
  };

  constructor(xml: SimpleJson<resqml20.obj_Activity>, context: OSDUContext) {
    super(xml, context, "Activity.1.4.0");
  }

  public async getKeys(
    ReservoirDMSUrl: string,
    keys: SimpleJson<resqml20.AbstractParameterKey>[],
    client: ResqmlClient
  ): Promise<ParameterKey[]> {
    const context = this.__context;
    if (context === undefined) {
      return [];
    }

    return Promise.all(
      keys.map(async k => {
        if (k.$type === "resqml20.ObjectParameterKey") {
          return {
            ObjectParameterKey: (k as SimpleJson<resqml20.ObjectParameterKey>)
              .DataObject.Title
          };
        } else {
          const timeIndex = (k as SimpleJson<resqml20.TimeIndexParameterKey>)
            .TimeIndex;
          const time = (await ActivityOSDU.getObjectFromDor(
            client,
            ReservoirDMSUrl,
            timeIndex.TimeSeries,
            context
          )) as SimpleJson<resqml20.obj_TimeSeries>;
          return {
            TimeParameterKey: time.Time[timeIndex.Index].DateTime.toISOString()
          };
        }
      })
    );
  }

  private getKind(p: SimpleJson<resqml20.AbstractActivityParameter>) {
    if (p.$type === "resqml20.DataObjectParameter") {
      return "DataObject";
    } else if (p.$type === "resqml20.FloatingPointQuantityParameter") {
      return "Double";
    } else if (p.$type === "resqml20.IntegerQuantityParameter") {
      return "Integer";
    } // else if (p.$type === "resqml20.StringParameter") {
    return "String";
  }

  public async getParameters(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.AbstractActivityParameter>[],
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
    xml: SimpleJson<resqml20.obj_Activity>,
    client: ResqmlClient
  ): Promise<ActivityOSDU> {
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
      ActivityTemplateID: await ActivityOSDU.dorToSrn(
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
      ParentActivityID: await ActivityOSDU.dorToSrn(
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

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

/**
 * Convert RESQML Activity to OSDU type
 *
 * @param {string} uri
 * @param {SimpleJson<resqml20.obj_Activity>} xml
 * @param {OSDUContext} context
 * @param {ResqmlClient} client
 * @returns {Promise<ActivityOSDU>}
 */
export const ActivityManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_Activity>,
  context: OSDUContext,
  client: ResqmlClient
): Promise<ActivityOSDU> =>
  new ActivityOSDU(xml, context).initData(uri, xml, client);
