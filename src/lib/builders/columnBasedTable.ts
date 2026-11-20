/**
 * ColumnBasedTable builder — an EML 2.3 (RESQML 2.2 / 2.3) tabular object for
 * exchanging column-oriented tables such as relative-permeability / capillary
 * pressure (KrPc), PVT and facies tables.
 *
 * A `ColumnBasedTable` is a set of columns; each column is bound to a
 * `PropertyKind` (with an optional UOM override) and carries its values as an
 * external (HDF5) value array. Columns come in two flavours:
 *   - `KeyColumn` — the independent / index variables (e.g. water saturation);
 *   - `Column`    — the dependent variables (e.g. Krw, Krow, Pc).
 *
 * ColumnBasedTable is an EML-common object that only exists on the 2.3 common
 * schema, so this builder targets the 2.2.0 line (external arrays); it
 * rejects the 2.0.x lines where the object is absent.
 *
 * Source of truth: energistics `common/v2.3` `ColumnBasedTable.xsd`
 * (`_ColumnBasedTable { Column[]; KeyColumn?[] }`, `_Column { PropertyKind;
 * Title?; Uom?; ValueCountPerRow; Values }`).
 */

import type { DataObject, DataArrayInput } from "./types";
import { BuiltObject, ResqmlVersion, arrayNode, citation, emlSchemaVersion, etype, newUuid, ref, resolveIdentity, uuidV5, versionInfo } from "./core";

/** One column of a {@link ColumnBasedTableSpec}. */
export interface TableColumnSpec {
    /** PropertyKind this column carries (the DOR title / kind name). */
    propertyKind: string;
    /** UUID of the PropertyKind object the column references. */
    propertyKindUuid?: string;
    /** OSDU SRN of the PropertyKind (deterministic UUID source when no uuid). */
    propertyKindSrn?: string;
    /** Optional column title (defaults to the property-kind name). */
    title?: string;
    /** UOM override; when omitted the PropertyKind default UOM applies. */
    uom?: string;
    /** Values per row (fastest array dimension when > 1). Default 1. */
    valueCountPerRow?: number;
    /** Column values, row-major (length must be `rowCount * valueCountPerRow`). */
    values: number[];
}

export interface ColumnBasedTableSpec {
    uuid?: string;
    title: string;
    /** 2.2.0 (default) or 2.3.0 — ColumnBasedTable is an EML 2.3 (2.2+) object. */
    version?: ResqmlVersion;
    /** EpcExternalPartReference the external column arrays hang off. */
    hdfUuid: string;
    /** Index / key columns (independent variables). */
    keyColumns?: TableColumnSpec[];
    /** Data columns (dependent variables). */
    columns: TableColumnSpec[];
    originator?: string;
}

/** Resolve the PropertyKind UUID for a column (uuid → srn → deterministic from name). */
function propertyKindUuid(col: TableColumnSpec): string {
    if (col.propertyKindUuid && col.propertyKindUuid.length > 0) return col.propertyKindUuid;
    if (col.propertyKindSrn && col.propertyKindSrn.length > 0) return resolveIdentity({ srn: col.propertyKindSrn }).uuid;
    return uuidV5(`PropertyKind:${col.propertyKind}`);
}

/**
 * Build a `ColumnBasedTable` (EML 2.3 / RESQML 2.2 / 2.3). Each column
 * references a PropertyKind DOR and stores its values in an external array.
 * Returns the table object plus one bulk array per column (key columns first).
 */
export function buildColumnBasedTable(spec: ColumnBasedTableSpec): BuiltObject {
    const v = spec.version ?? "2.2.0";
    if (versionInfo(v).arrays !== "external") {
        throw new Error(
            `ColumnBasedTable is an EML 2.3 object; use RESQML 2.2.0 or 2.3.0 (got ${v})`,
        );
    }
    if (spec.columns.length === 0) {
        throw new Error("column-based table requires at least one data column");
    }

    const uuid = spec.uuid ?? newUuid();
    const arrays: DataArrayInput[] = [];

    const toColumn = (col: TableColumnSpec, group: string, index: number): DataObject => {
        const vcr = col.valueCountPerRow ?? 1;
        if (vcr < 1) throw new Error(`column '${col.propertyKind}' valueCountPerRow must be >= 1`);
        if (col.values.length % vcr !== 0) {
            throw new Error(
                `column '${col.propertyKind}' has ${col.values.length} values, not divisible by valueCountPerRow ${vcr}`,
            );
        }
        const rows = col.values.length / vcr;
        const dims = vcr > 1 ? [rows, vcr] : [rows];
        const path = `/RESQML/${uuid}/${group}/${index}`;

        arrays.push({
            ContainerType: etype("obj_EpcExternalPartReference", v),
            ContainerUuid: spec.hdfUuid,
            PathInResource: path,
            Dimensions: dims,
            Data: col.values,
            ArrayType: "Float64Array",
        });

        return {
            $type: etype("Column", v),
            PropertyKind: ref("PropertyKind", propertyKindUuid(col), col.propertyKind, v),
            ...(col.title ? { Title: col.title } : {}),
            ...(col.uom ? { Uom: col.uom } : {}),
            ValueCountPerRow: vcr,
            Values: arrayNode("double", { hdfUuid: spec.hdfUuid, path, dims, version: v }),
        } as unknown as DataObject;
    };

    const keyColumns = (spec.keyColumns ?? []).map((c, i) => toColumn(c, "keyColumns", i));
    const columns = spec.columns.map((c, i) => toColumn(c, "columns", i));

    const object = {
        $type: etype("ColumnBasedTable", v),
        Uuid: uuid,
        SchemaVersion: emlSchemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        Column: columns,
        ...(keyColumns.length ? { KeyColumn: keyColumns } : {}),
    } as unknown as DataObject;

    return { object, arrays };
}
