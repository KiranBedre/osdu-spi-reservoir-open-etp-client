import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";

import {
  ColumnBasedTable,
  Data
} from "./Generated/work-product-component/ColumnBasedTable.1.3.0";

export class DoubleTableLookupOSDU
  extends ResqmlWorkProductComponent<
    SimpleJson<resqml20.obj_DoubleTableLookup>
  >
  implements ColumnBasedTable
{
  public data: Data = {};

  constructor(
    xml: SimpleJson<resqml20.obj_DoubleTableLookup>,
    context: OSDUContext
  ) {
    super(xml, context, "ColumnBasedTable.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<resqml20.obj_DoubleTableLookup>
  ): Promise<DoubleTableLookupOSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }
    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      ColumnBasedTableType: context.addReferenceData(
        "ColumnBasedTableType",
        "NumericLookup"
      ),
      KeyColumns: [
        {
          ValueType: "double",
          ValueCount: 1
        }
      ],
      Columns: [
        {
          ValueType: "double",
          ValueCount: 1
        }
      ],
      ColumnSize: xml.Value.length,
      ColumnValues: [
        { NumberColumn: xml.Value.map(e => e.Key) },
        { NumberColumn: xml.Value.map(e => e.Value) }
      ],
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtraMetadata);

    delete this.__context;
    return this;
  }
}

export const DoubleTableLookupManifest = async (
  uri: string,
  xml: SimpleJson<resqml20.obj_DoubleTableLookup>,
  context: OSDUContext,
  _client: ResqmlClient
): Promise<DoubleTableLookupOSDU> =>
  new DoubleTableLookupOSDU(xml, context).initData(uri, xml);
