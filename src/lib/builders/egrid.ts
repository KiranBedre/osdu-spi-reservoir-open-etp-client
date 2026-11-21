/**
 * OPM/GRDECL **EGRID** binary writer (the fast, compact sibling of GRDECL).
 *
 * EGRID is a *binary* grid file: big-endian, Fortran-unformatted
 * records, keyword-block structured. It carries the *same* corner-point
 * geometry as GRDECL — `COORD` pillar lines, `ZCORN` per-corner depths and
 * `ACTNUM` active flags — but as raw `REAL`/`INTE` blocks instead of ASCII, so
 * it is ~3–4× smaller and needs no text parse/format on either side. It is read
 * natively by resdata (`resdata.grid.Grid`), OPM (`opm.io`) and
 * `xtgeo.grid_from_file(fileformat="egrid")`.
 *
 * The COORD / ZCORN / ACTNUM arrays are byte-for-byte the same flat, i-fastest
 * buffers produced for GRDECL (see {@link CornerPointGrid}), so this module is a
 * pure re-encoding of {@link serializeGrdecl}'s payload into binary.
 *
 * ## Binary layout (Fortran-unformatted)
 *
 * Every logical value is wrapped in a Fortran record: a big-endian `int32`
 * byte-length marker, the bytes, then the same marker again. Each keyword is:
 *
 * 1. a 16-byte **header** record — `name` (8 chars) + element `count` (`int32`)
 *    + `type` (4 chars: `INTE`/`REAL`/`DOUB`/`CHAR`);
 * 2. zero or more **data** records — elements chunked into blocks of at most
 *    1000 (numeric) each wrapped in its own record.
 *
 * File keyword order (single global corner-point grid): `FILEHEAD`, `GRIDHEAD`,
 * `COORD`, `ZCORN`, `ACTNUM`, `ENDGRID`.
 */

import { CornerPointGrid, cellCount, pillarCount } from "./grdecl";

/** Binary element types this writer emits. */
type EclType = "INTE" | "REAL" | "DOUB" | "CHAR";

/** Bytes per element for each binary type. */
const EL_SIZE: Record<EclType, number> = { INTE: 4, REAL: 4, DOUB: 8, CHAR: 8 };

/** Max elements per Fortran data record (GRDECL/EGRID convention). */
const BLOCK: Record<EclType, number> = { INTE: 1000, REAL: 1000, DOUB: 1000, CHAR: 105 };

/** One EGRID keyword block: name, type and its payload (numeric or CHAR). */
interface Keyword {
    name: string;
    type: EclType;
    /** Numeric payload for INTE/REAL/DOUB. */
    data?: ArrayLike<number>;
    /** String payload for CHAR (each entry emitted as an 8-char field). */
    chars?: string[];
}

/** Element count of a keyword regardless of payload kind. */
function keywordLength(kw: Keyword): number {
    return kw.type === "CHAR" ? (kw.chars?.length ?? 0) : (kw.data?.length ?? 0);
}

/** Byte size a keyword block occupies in the file (header + data records). */
function keywordBytes(kw: Keyword): number {
    const n = keywordLength(kw);
    const es = EL_SIZE[kw.type];
    const blk = BLOCK[kw.type];
    const nBlocks = n === 0 ? 0 : Math.ceil(n / blk);
    // header record = 4 (marker) + 16 (content) + 4 (marker) = 24
    // data = sum of blocks, each = 4 (marker) + cnt*es + 4 (marker)
    return 24 + n * es + nBlocks * 8;
}

/**
 * GRIDHEAD element indices (libecl / resdata `ecl_kw_magic.h`). Only the grid
 * type, dimensions and reservoir count are meaningful for a single global grid.
 */
const GRIDHEAD_TYPE = 0; // 1 = corner-point
const GRIDHEAD_NX = 1;
const GRIDHEAD_NY = 2;
const GRIDHEAD_NZ = 3;
const GRIDHEAD_NUMRES = 24;

/** FILEHEAD element indices. */
const FILEHEAD_VERSION = 0;
const FILEHEAD_YEAR = 1;

/**
 * Serialise a neutral corner-point grid to an **EGRID** binary blob.
 *
 * `ACTNUM` is written when present on the grid (or supplied via `opts.actnum`);
 * otherwise every cell is marked active. The returned bytes are a complete
 * `.EGRID` file ready to hand to resdata / OPM / xtgeo.
 */
export function serializeEgrid(
    grid: CornerPointGrid,
    opts?: { actnum?: ArrayLike<number>; version?: number; year?: number; gridUnit?: string }
): Uint8Array {
    const { ni, nj, nk } = grid;
    const ncell = cellCount(grid);
    const npillar = pillarCount(grid);

    const expectedCoord = npillar * 6;
    const expectedZcorn = 8 * ncell;
    if (grid.coord.length !== expectedCoord) {
        throw new Error(
            `EGRID: COORD length ${grid.coord.length} != expected ${expectedCoord} for ${ni}x${nj}x${nk}`
        );
    }
    if (grid.zcorn.length !== expectedZcorn) {
        throw new Error(
            `EGRID: ZCORN length ${grid.zcorn.length} != expected ${expectedZcorn} for ${ni}x${nj}x${nk}`
        );
    }

    const fileHead = new Int32Array(100);
    fileHead[FILEHEAD_VERSION] = opts?.version ?? 3;
    fileHead[FILEHEAD_YEAR] = opts?.year ?? 2020;

    const gridHead = new Int32Array(100);
    gridHead[GRIDHEAD_TYPE] = 1; // corner-point
    gridHead[GRIDHEAD_NX] = ni;
    gridHead[GRIDHEAD_NY] = nj;
    gridHead[GRIDHEAD_NZ] = nk;
    gridHead[GRIDHEAD_NUMRES] = 1;

    const actnumSrc = opts?.actnum ?? grid.actnum;
    const actnum = new Int32Array(ncell);
    if (actnumSrc && actnumSrc.length === ncell) {
        for (let i = 0; i < ncell; i++) actnum[i] = actnumSrc[i] ? 1 : 0;
    } else {
        actnum.fill(1);
    }

    const keywords: Keyword[] = [
        { name: "FILEHEAD", type: "INTE", data: fileHead },
        // GRIDUNIT is optional for resdata but required by xtgeo's EGRID reader.
        { name: "GRIDUNIT", type: "CHAR", chars: [opts?.gridUnit ?? "METRES", ""] },
        { name: "GRIDHEAD", type: "INTE", data: gridHead },
        { name: "COORD", type: "REAL", data: grid.coord },
        { name: "ZCORN", type: "REAL", data: grid.zcorn },
        { name: "ACTNUM", type: "INTE", data: actnum },
        { name: "ENDGRID", type: "INTE", data: new Int32Array(0) }
    ];

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
    const putChars = (s: string, width: number): void => {
        const p = (s + " ".repeat(width)).slice(0, width);
        for (let i = 0; i < width; i++) dv.setUint8(o + i, p.charCodeAt(i) & 0xff);
        o += width;
    };

    for (const kw of keywords) {
        const count = keywordLength(kw);
        // Header record: name(8) + count(int32) + type(4) = 16 bytes.
        putI32(16);
        putChars(kw.name, 8);
        putI32(count);
        putChars(kw.type, 4);
        putI32(16);

        // Data records, chunked into Fortran-sized blocks.
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
            } else {
                const data = kw.data!;
                for (let j = 0; j < cnt; j++) putI32(data[i + j]);
            }
            putI32(bytes);
        }
    }

    return new Uint8Array(buf);
}
