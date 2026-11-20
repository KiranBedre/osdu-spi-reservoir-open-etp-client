/**
 * OPM/GRDECL **INIT** binary writer — the static-property companion to the
 * geometry-only {@link serializeEgrid}.
 *
 * An `.EGRID` file carries only corner-point geometry (`COORD`/`ZCORN`) and
 * `ACTNUM`; the static cell properties a simulator needs (porosity,
 * permeabilities, net-to-gross, pore volume, …) live in the sibling `.INIT`
 * file. This module emits a spec-reasonable INIT so the pair
 * `{name}.EGRID` + `{name}.INIT` can be handed straight to resdata
 * (`resdata.resfile.ResdataFile` / `EclInitFile`) or
 * `xtgeo.gridproperty_from_file(fformat="init", grid=…)`.
 *
 * ## Binary layout (Fortran-unformatted)
 *
 * Identical record framing to EGRID: every keyword is a 16-byte header record
 * (`name` 8 chars + element `count` int32 + `type` 4 chars) followed by data
 * records chunked into blocks (≤1000 numeric / ≤105 CHAR), each block wrapped in
 * a big-endian Fortran `int32` byte-length marker on both sides.
 *
 * File keyword order: `INTEHEAD`, `LOGIHEAD`, `DOUBHEAD`, `PORV`, then one
 * keyword per static property. `PORV` is written **globally** (one value per
 * `nx·ny·nz` cell, `0` on inactive cells — the usual simulator convention); every other
 * property is written **active-cell only** (length = number of active cells, in
 * natural i-fastest order), which is how simulators store and readers expand
 * them against the grid's `ACTNUM`.
 */

import { CornerPointGrid, cellCount } from "./grdecl";

/** Binary element types this writer emits. */
type EclType = "INTE" | "REAL" | "DOUB" | "LOGI" | "CHAR";

/** Bytes per element for each binary type. */
const EL_SIZE: Record<EclType, number> = { INTE: 4, REAL: 4, DOUB: 8, LOGI: 4, CHAR: 8 };

/** Max elements per Fortran data record (GRDECL/INIT convention). */
const BLOCK: Record<EclType, number> = { INTE: 1000, REAL: 1000, DOUB: 1000, LOGI: 1000, CHAR: 105 };

/** One INIT keyword block. */
interface Keyword {
    name: string;
    type: EclType;
    data?: ArrayLike<number>;
    chars?: string[];
}

/**
 * INTEHEAD element indices (libecl / resdata `ecl_kw_magic.h`). Only the unit,
 * grid dimensions, active-cell count and phase indicator are meaningful for a
 * static INIT; the remaining 400-odd slots stay zero.
 */
const INTEHEAD_LEN = 411;
const INTEHEAD_UNIT = 2; // 1 = metric, 2 = field, 3 = lab
const INTEHEAD_NX = 8;
const INTEHEAD_NY = 9;
const INTEHEAD_NZ = 10;
const INTEHEAD_NACTIVE = 11;
const INTEHEAD_PHASE = 14; // 1=oil 2=wat 3=oil/wat 4=gas 5=oil/gas 6=gas/wat 7=oil/wat/gas
const INTEHEAD_DAY = 64;
const INTEHEAD_MONTH = 65;
const INTEHEAD_YEAR = 66;
const INTEHEAD_IPROG = 94; // simulator id (100 = classic black-oil simulator)

const LOGIHEAD_LEN = 121;
const DOUBHEAD_LEN = 229;

/** A static property to embed in the INIT file. */
export interface InitProperty {
    /** INIT keyword (upper-cased and truncated to 8 chars on write). */
    name: string;
    /** Global values, one per `nx·ny·nz` cell (i-fastest). Inactive entries are dropped. */
    values: ArrayLike<number>;
    /** Element type — REAL (default) for floats, INTE for integer cell props. */
    type?: "REAL" | "INTE" | "DOUB";
}

/** Options controlling the INIT headers and pore-volume handling. */
export interface SerializeInitOptions {
    /** ACTNUM override (else `grid.actnum`; absent ⇒ every cell active). */
    actnum?: ArrayLike<number>;
    /** Unit system stamped in INTEHEAD (default 1 = metric). */
    unit?: number;
    /** Phase indicator stamped in INTEHEAD (default 7 = oil/water/gas). */
    phases?: number;
    /** Simulator id for INTEHEAD[IPROG] (default 100 = classic black-oil simulator). */
    simulator?: number;
    /** Report date stamped in INTEHEAD (defaults to 1 Jan 2020). */
    date?: { day: number; month: number; year: number };
    /**
     * Global pore volume, one value per `nx·ny·nz` cell. When omitted, `PORV`
     * is synthesised as `1.0` on active cells and `0.0` on inactive ones so the
     * active set is still recoverable by readers (the volume is a placeholder).
     */
    porv?: ArrayLike<number>;
}

/** Element count of a keyword regardless of payload kind. */
function keywordLength(kw: Keyword): number {
    return kw.type === "CHAR" ? (kw.chars?.length ?? 0) : (kw.data?.length ?? 0);
}

/** Byte size a keyword block occupies (header record + data records). */
function keywordBytes(kw: Keyword): number {
    const n = keywordLength(kw);
    const es = EL_SIZE[kw.type];
    const blk = BLOCK[kw.type];
    const nBlocks = n === 0 ? 0 : Math.ceil(n / blk);
    return 24 + n * es + nBlocks * 8;
}

/** Compact a global cell array to its active entries (i-fastest natural order). */
function compactActive(values: ArrayLike<number>, actnum: Int32Array): number[] {
    const out: number[] = [];
    for (let i = 0; i < actnum.length; i++) {
        if (actnum[i]) out.push(values[i]);
    }
    return out;
}

/**
 * Serialise a corner-point grid's static properties to an INIT
 * binary blob. Pair the result with {@link serializeEgrid} output of the same
 * grid to reconstruct a full simulation deck.
 */
export function serializeInit(
    grid: CornerPointGrid,
    properties: InitProperty[],
    opts?: SerializeInitOptions
): Uint8Array {
    const { ni, nj, nk } = grid;
    const ncell = cellCount(grid);

    const actnumSrc = opts?.actnum ?? grid.actnum;
    const actnum = new Int32Array(ncell);
    if (actnumSrc && actnumSrc.length === ncell) {
        for (let i = 0; i < ncell; i++) actnum[i] = actnumSrc[i] ? 1 : 0;
    } else {
        actnum.fill(1);
    }
    let nactive = 0;
    for (let i = 0; i < ncell; i++) nactive += actnum[i];

    const intehead = new Int32Array(INTEHEAD_LEN);
    intehead[INTEHEAD_UNIT] = opts?.unit ?? 1;
    intehead[INTEHEAD_NX] = ni;
    intehead[INTEHEAD_NY] = nj;
    intehead[INTEHEAD_NZ] = nk;
    intehead[INTEHEAD_NACTIVE] = nactive;
    intehead[INTEHEAD_PHASE] = opts?.phases ?? 7;
    intehead[INTEHEAD_DAY] = opts?.date?.day ?? 1;
    intehead[INTEHEAD_MONTH] = opts?.date?.month ?? 1;
    intehead[INTEHEAD_YEAR] = opts?.date?.year ?? 2020;
    intehead[INTEHEAD_IPROG] = opts?.simulator ?? 100;

    const logihead = new Int32Array(LOGIHEAD_LEN);
    const doubhead = new Float64Array(DOUBHEAD_LEN);

    // PORV is global (one per cell); 0 marks inactive cells.
    const porv = new Float32Array(ncell);
    if (opts?.porv && opts.porv.length === ncell) {
        for (let i = 0; i < ncell; i++) porv[i] = actnum[i] ? opts.porv[i] : 0;
    } else {
        for (let i = 0; i < ncell; i++) porv[i] = actnum[i] ? 1 : 0;
    }

    const keywords: Keyword[] = [
        { name: "INTEHEAD", type: "INTE", data: intehead },
        { name: "LOGIHEAD", type: "LOGI", data: logihead },
        { name: "DOUBHEAD", type: "DOUB", data: doubhead },
        { name: "PORV", type: "REAL", data: porv }
    ];

    for (const p of properties) {
        if (p.values.length !== ncell) {
            throw new Error(
                `INIT: property '${p.name}' length ${p.values.length} != cell count ${ncell}`
            );
        }
        const active = compactActive(p.values, actnum);
        const type = p.type ?? "REAL";
        keywords.push({
            name: p.name.toUpperCase().slice(0, 8),
            type,
            data: type === "DOUB" ? Float64Array.from(active) : type === "INTE" ? Int32Array.from(active) : Float32Array.from(active)
        });
    }

    const total = keywords.reduce((s, kw) => s + keywordBytes(kw), 0);
    const buf = new ArrayBuffer(total);
    const dv = new DataView(buf);
    let o = 0;

    const putI32 = (v: number): void => {
        dv.setInt32(o, v | 0, false);
        o += 4;
    };
    const putF32 = (v: number): void => {
        dv.setFloat32(o, v, false);
        o += 4;
    };
    const putF64 = (v: number): void => {
        dv.setFloat64(o, v, false);
        o += 8;
    };
    const putChars = (s: string, width: number): void => {
        const p = (s + " ".repeat(width)).slice(0, width);
        for (let i = 0; i < width; i++) dv.setUint8(o + i, p.charCodeAt(i) & 0xff);
        o += width;
    };

    for (const kw of keywords) {
        const count = keywordLength(kw);
        putI32(16);
        putChars(kw.name, 8);
        putI32(count);
        putChars(kw.type, 4);
        putI32(16);

        const es = EL_SIZE[kw.type];
        const blk = BLOCK[kw.type];
        for (let i = 0; i < count; i += blk) {
            const cnt = Math.min(blk, count - i);
            const bytes = cnt * es;
            putI32(bytes);
            if (kw.type === "CHAR") {
                const chars = kw.chars!;
                for (let j = 0; j < cnt; j++) putChars(chars[i + j] ?? "", 8);
            } else if (kw.type === "REAL") {
                const data = kw.data!;
                for (let j = 0; j < cnt; j++) putF32(data[i + j]);
            } else if (kw.type === "DOUB") {
                const data = kw.data!;
                for (let j = 0; j < cnt; j++) putF64(data[i + j]);
            } else {
                // INTE / LOGI both stored as 4-byte big-endian integers.
                const data = kw.data!;
                for (let j = 0; j < cnt; j++) putI32(data[i + j]);
            }
            putI32(bytes);
        }
    }

    return new Uint8Array(buf);
}
