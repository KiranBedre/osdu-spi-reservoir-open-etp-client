import * as eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import { ResqmlClient } from "../client/ResqmlClient";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { OSDUContext } from "./OsduContext";
import { ResqmlWorkProductComponent } from "./WorkProductComponent";
import { getPropertyTypeIDFromResqmlAlias } from "./PropertyTypes";

import {
  AbstractReferencePropertyType,
  ColumnBasedTable,
  Data
} from "./Generated/work-product-component/ColumnBasedTable.1.3.0";

export class ColumnBasedTable23OSDU
  extends ResqmlWorkProductComponent<SimpleJson<eml23.ColumnBasedTable>>
  implements ColumnBasedTable {
  public data: Data = {};

  constructor(xml: SimpleJson<eml23.ColumnBasedTable>, context: OSDUContext) {
    super(xml, context, "ColumnBasedTable.1.3.0");
  }

  public async initData(
    ReservoirDMSUrl: string,
    xml: SimpleJson<eml23.ColumnBasedTable>
  ): Promise<ColumnBasedTable23OSDU> {
    const context = this.__context;
    if (context === undefined) {
      return this;
    }

    // Derive table type from PropertyKind of key/value columns
    const tableType = this.inferTableType(xml);

    this.data = {
      ...(await this.AbstractCommonResources(context)),
      ...(await this.AbstractWPCGroupType(ReservoirDMSUrl, context)),
      ...(await this.AbstractWorkProductComponent(xml, context)),

      ColumnBasedTableType: context.addReferenceData(
        "ColumnBasedTableType",
        tableType
      ),
      KeyColumns: xml.KeyColumn
        ? xml.KeyColumn.map(col => this.mapColumn(col, context))
        : undefined,
      Columns: xml.Column.map(col => this.mapColumn(col, context)),
      ColumnSize: this.inferColumnSize(xml),
      ColumnValues: undefined,
      ExtensionProperties: undefined
    };

    this.assignExtraMetaData(xml.ExtensionNameValue);

    delete this.__context;
    return this;
  }

  /**
   * Map an EML 2.3 Column to OSDU AbstractReferencePropertyType.
   * Extracts column name, UOM, PropertyKind, and value type.
   */
  private mapColumn(
    col: SimpleJson<eml23.Column>,
    context: OSDUContext
  ): AbstractReferencePropertyType {
    const arrayInfo = this.arrayInfos(col);
    const kindTitle = col.PropertyKind?.Title ?? col.Title;
    const propertyTypeId = kindTitle
      ? getPropertyTypeIDFromResqmlAlias(kindTitle)
      : undefined;

    return {
      ColumnName: col.Title ?? col.PropertyKind?.Title,
      ValueType: arrayInfo.valueType,
      ValueCount: col.ValueCountPerRow
        ? Number(col.ValueCountPerRow)
        : arrayInfo.valuePerRow,
      UnitOfMeasureID: col.Uom
        ? context.addReferenceData("UnitOfMeasure", col.Uom as string)
        : undefined,
      PropertyType: kindTitle
        ? {
          Name: kindTitle,
          PropertyTypeID: propertyTypeId
            ? context.addReferenceData("PropertyType", propertyTypeId)
            : undefined
        }
        : undefined
    };
  }

  /**
   * Infer ColumnSize from the first column's array dimensions.
   */
  private inferColumnSize(
    xml: SimpleJson<eml23.ColumnBasedTable>
  ): number | undefined {
    const firstCol = xml.Column?.[0] ?? xml.KeyColumn?.[0];
    if (!firstCol) return undefined;
    const info = this.arrayInfos(firstCol);
    return info.rowCount;
  }

  /**
   * Infer the ColumnBasedTableType from column PropertyKinds.
   * Heuristic: look for common patterns (saturation, permeability → KrPc;
   * pressure, viscosity → PVT; facies/lithology → Facies).
   */
  private inferTableType(xml: SimpleJson<eml23.ColumnBasedTable>): string {
    const allKinds = [
      ...(xml.KeyColumn ?? []),
      ...xml.Column
    ]
      .map(c => (c.PropertyKind?.Title ?? c.Title ?? "").toLowerCase())
      .filter(Boolean);

    if (allKinds.some(k => k.includes("permeability") || k.includes("saturation") || k.includes("capillary"))) {
      return "KrPc";
    }
    if (allKinds.some(k => k.includes("viscosity") || k.includes("formation volume") || k.includes("solution gas"))) {
      return "PVT";
    }
    if (allKinds.some(k => k.includes("facies") || k.includes("lithology"))) {
      return "Facies";
    }
    return "Generic";
  }
}

export const ColumnBasedTable23Manifest = async (
  uri: string,
  xml: SimpleJson<eml23.ColumnBasedTable>,
  context: OSDUContext,
  _client: ResqmlClient
): Promise<ColumnBasedTable23OSDU> =>
  new ColumnBasedTable23OSDU(xml, context).initData(uri, xml);
