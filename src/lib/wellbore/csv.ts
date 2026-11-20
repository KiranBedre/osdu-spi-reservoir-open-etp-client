/**
 * CSV well-log parser → WITSML 2.1 channels — pure, I/O-free.
 *
 * The CSV sibling of `las.ts` (see `rddmsmg/rddms/WellboreDdmsReplacement.md`
 * §4). A CSV table has none of the
 * LAS `~` section structure, so this module normalises it into the same
 * {@link ParsedLas} shape and then reuses {@link lasToWitsml} — one WITSML
 * `Channel`/`ChannelSet` mapping path for both LAS and CSV.
 *
 * Header units may be embedded (`GR[gAPI]`, `GR (gAPI)`, `GR.gAPI`) or supplied
 * per-column through {@link CsvToChannelsOptions.columns}. Deliberately
 * dependency-free (no CSV library) so it stays trivially unit-testable, exactly
 * like the RESQML builders under `src/lib/builders/`.
 */

import type { ParsedLas, LasCurve, LasHeaderItem } from "./las";
import { lasToWitsml, type LasToWitsmlResult } from "./witsmlChannels";
import { buildColumnBasedTable, type TableColumnSpec } from "../builders/columnBasedTable";
import type { BuiltObject, ResqmlVersion } from "../builders/core";

/** Per-column override: rename the mnemonic and/or set the unit. */
export interface CsvColumnMap {
    mnemonic?: string;
    unit?: string;
}

export interface CsvToChannelsOptions {
    /** Column delimiter (default `,`; use `\t` for TSV). */
    delimiter?: string;
    /** NULL sentinel; matching values become `NaN` (default -999.25). */
    nullValue?: number;
    /**
     * Index (depth/time) column, by header name or 0-based position. When the
     * column is not first it is moved to `curves[0]`. Defaults to column 0.
     */
    indexColumn?: string | number;
    /** Per-column overrides keyed by the raw header cell. */
    columns?: Record<string, CsvColumnMap>;
    /** ChannelSet title (defaults to `wellName` then "CSV Channel Set"). */
    title?: string;
    /** Well name recorded on the parsed document. */
    wellName?: string;
    /** Citation originator stamped on emitted objects. */
    originator?: string;
    /** Optional WITSML wellbore UUID the channel set belongs to. */
    wellboreUuid?: string;
}

/** Split a raw header cell into a mnemonic + embedded unit. */
function splitHeaderCell(cell: string): { mnemonic: string; unit: string } {
    const trimmed = cell.trim();
    // NAME[UNIT] or NAME(UNIT)
    const bracket = trimmed.match(/^(.*?)[\s]*[[(]([^\])]*)[\])]\s*$/);
    if (bracket) {
        return { mnemonic: bracket[1].trim(), unit: bracket[2].trim() };
    }
    // NAME.UNIT (LAS-style, single dot, unit has no spaces)
    const dot = trimmed.match(/^([^.\s]+)\.(\S+)$/);
    if (dot) {
        return { mnemonic: dot[1].trim(), unit: dot[2].trim() };
    }
    return { mnemonic: trimmed, unit: "" };
}

/** Split one CSV line on the delimiter (minimal quote handling). */
function splitRow(line: string, delimiter: string): string[] {
    if (line.indexOf('"') < 0) {
        return line.split(delimiter);
    }
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === delimiter) {
            out.push(cur);
            cur = "";
        } else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}

/**
 * Parse a CSV log table into the normalised {@link ParsedLas} form. The first
 * non-empty, non-comment line is the header; every following line is a row of
 * numeric samples. Non-numeric cells and the NULL sentinel become `NaN`.
 */
export function parseCsvLog(csv: string, opts: CsvToChannelsOptions = {}): ParsedLas {
    const delimiter = opts.delimiter ?? ",";
    const nullValue = opts.nullValue ?? -999.25;

    const lines = csv.split(/\r?\n/);
    let headerCells: string[] | undefined;
    const dataRows: string[][] = [];

    for (const raw of lines) {
        const line = raw.trim();
        if (line.length === 0 || line.startsWith("#")) continue;
        const cells = splitRow(line, delimiter).map((c) => c.trim());
        if (headerCells === undefined) {
            headerCells = cells;
        } else {
            dataRows.push(cells);
        }
    }

    if (headerCells === undefined || headerCells.length === 0) {
        return {
            version: "CSV",
            wrap: false,
            nullValue,
            well: {},
            curves: [],
            wellName: opts.wellName,
        };
    }

    // Resolve mnemonic/unit for each column, applying per-column overrides.
    const cols = headerCells.map((cell) => {
        const base = splitHeaderCell(cell);
        const override = opts.columns?.[cell] ?? opts.columns?.[base.mnemonic];
        return {
            mnemonic: override?.mnemonic ?? base.mnemonic,
            unit: override?.unit ?? base.unit,
        };
    });

    // Determine the index column position.
    let indexPos = 0;
    if (typeof opts.indexColumn === "number") {
        indexPos = opts.indexColumn;
    } else if (typeof opts.indexColumn === "string") {
        const wanted = opts.indexColumn.trim();
        const found = cols.findIndex(
            (c, i) => c.mnemonic === wanted || headerCells![i].trim() === wanted,
        );
        if (found >= 0) indexPos = found;
    }

    // Column order: index first, then the rest in file order.
    const order = [indexPos, ...cols.map((_, i) => i).filter((i) => i !== indexPos)];

    const curves: LasCurve[] = order.map((i) => ({
        mnemonic: cols[i].mnemonic,
        unit: cols[i].unit,
        description: cols[i].mnemonic,
        data: [],
    }));

    for (const row of dataRows) {
        for (let k = 0; k < order.length; k++) {
            const srcCol = order[k];
            const cell = srcCol < row.length ? row[srcCol] : "";
            const n = Number(cell);
            const v = cell.length === 0 || Number.isNaN(n) ? NaN : n;
            curves[k].data.push(v === nullValue ? NaN : v);
        }
    }

    const well: Record<string, LasHeaderItem> = {};
    if (opts.wellName) {
        well["WELL"] = { mnemonic: "WELL", unit: "", value: opts.wellName, description: "WELL NAME" };
    }

    return {
        version: "CSV",
        wrap: false,
        nullValue,
        well,
        curves,
        wellName: opts.wellName,
    };
}

/**
 * Convert a CSV log table into a WITSML 2.1 `ChannelSet` + `Channel`s and their
 * bulk arrays — the CSV entry point mirroring {@link lasToWitsml}.
 */
export function csvToChannels(csv: string, opts: CsvToChannelsOptions = {}): LasToWitsmlResult {
    const parsed = parseCsvLog(csv, opts);
    return lasToWitsml(parsed, {
        originator: opts.originator,
        wellboreUuid: opts.wellboreUuid,
        title: opts.title,
    });
}

export interface CsvToCbtOptions extends CsvToChannelsOptions {
    /** EpcExternalPartReference (HDF proxy) the external column arrays hang off. */
    hdfUuid: string;
    /** EML 2.3 line — `2.2.0` (default) or `2.3.0`. ColumnBasedTable is absent from 2.0.x. */
    version?: ResqmlVersion;
    /**
     * Column mnemonics to treat as key/index columns (independent variables).
     * Defaults to the index column (`curves[0]`); the rest become data columns.
     */
    keyColumns?: string[];
}

/**
 * Map a normalised {@link ParsedLas} onto a RESQML 2.2 / 2.3 `ColumnBasedTable`
 * (each curve → one column bound to a PropertyKind + its external value array).
 * Shared by {@link csvToCbt} and the LAS/DLIS CBT paths.
 */
export function parsedToCbt(parsed: ParsedLas, opts: CsvToCbtOptions): BuiltObject {
    const defaultKeys = parsed.curves.length > 0 ? [parsed.curves[0].mnemonic] : [];
    const keyNames = new Set(
        (opts.keyColumns && opts.keyColumns.length > 0 ? opts.keyColumns : defaultKeys).map((s) =>
            s.toUpperCase(),
        ),
    );
    const toSpec = (c: LasCurve): TableColumnSpec => ({
        propertyKind: c.mnemonic,
        title: c.mnemonic,
        ...(c.unit ? { uom: c.unit } : {}),
        values: c.data,
    });
    const keyColumns = parsed.curves.filter((c) => keyNames.has(c.mnemonic.toUpperCase())).map(toSpec);
    const columns = parsed.curves.filter((c) => !keyNames.has(c.mnemonic.toUpperCase())).map(toSpec);
    return buildColumnBasedTable({
        title: opts.title ?? parsed.wellName ?? "CSV Table",
        version: opts.version ?? "2.2.0",
        hdfUuid: opts.hdfUuid,
        keyColumns,
        columns,
        ...(opts.originator ? { originator: opts.originator } : {}),
    });
}

/**
 * Convert a CSV log table into a RESQML 2.2 / 2.3 `ColumnBasedTable` + one
 * external array per column — the CSV→CBT entry point, sibling of
 * {@link csvToChannels}. Returns the table object and its bulk arrays for the
 * RESQML write path (`resources.put` + `arrays.put`).
 */
export function csvToCbt(csv: string, opts: CsvToCbtOptions): BuiltObject {
    return parsedToCbt(parseCsvLog(csv, opts), opts);
}

