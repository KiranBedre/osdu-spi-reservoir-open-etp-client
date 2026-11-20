/**
 * Neutral corner-point grid model + OPM/GRDECL I/O.
 *
 * This is the **pivot model** for RESQML ⇄ OPM/GRDECL grid interop. Both the
 * RESQML `IjkGridRepresentation` side (see `ijkgrid.ts`) and the textual GRDECL
 * side map to/from this one flat, typed-array structure, so the hard part —
 * faulted (split-pillar) geometry — is handled in exactly one place.
 *
 * ## Corner-point conventions (GRDECL / OPM)
 *
 * - `SPECGRID` / `DIMENS`: `ni, nj, nk` (i is fastest).
 * - `COORD`: `(ni+1)*(nj+1)` pillars × 6 doubles `[xTop,yTop,zTop, xBot,yBot,zBot]`.
 *   Pillar index `p = jp*(ni+1) + ip` (i-fastest). Pillars are *shared* — all
 *   fault throw is carried by `ZCORN`, not by moving pillars.
 * - `ZCORN`: `2*ni * 2*nj * 2*nk` z-values, **corner-major, i-fastest**. For
 *   cell `(i,j,k)` corner `(ip,jp,kp)` (each 0/1): `x=2i+ip, y=2j+jp, z=2k+kp`,
 *   linear index `x + y*(2ni) + z*(2ni*2nj)`.
 * - `ACTNUM`: `ni*nj*nk` flags, **cell-major i-fastest** (`i + j*ni + k*ni*nj`).
 * - Cell property keywords (PORO, PERMX, …): same cell-major layout as ACTNUM.
 *
 * ## Performance
 *
 * All bulk data is stored in flat `Float64Array` / `Int32Array` buffers with
 * inline index arithmetic — no per-cell object allocation — so million-cell
 * grids stay linear in time and compact in memory. GRDECL text is emitted via
 * chunked array-join with run-length (`n*value`) compression, matching the
 * GRDECL convention and keeping large exports fast.
 */

/** A neutral OPM/GRDECL corner-point grid. All arrays are flat and typed. */
export interface CornerPointGrid {
    ni: number;
    nj: number;
    nk: number;
    /**
     * COORD pillar lines: `(ni+1)*(nj+1)*6` doubles.
     * Pillar `p = jp*(ni+1)+ip`, offset `p*6` → `[xTop,yTop,zTop,xBot,yBot,zBot]`.
     */
    coord: Float64Array;
    /** ZCORN: `8*ni*nj*nk` z-values, corner-major i-fastest (see {@link zcornIndex}). */
    zcorn: Float64Array;
    /** ACTNUM: `ni*nj*nk` flags (1 active / 0 inactive), cell-major i-fastest. Optional (all active if absent). */
    actnum?: Int32Array;
    /** Cell property keyword → flat array (`ni*nj*nk`, cell-major i-fastest). Keys are upper-case GRDECL keywords. */
    properties?: Record<string, Float64Array>;
}

/** Number of cells in a corner-point grid. */
export function cellCount(g: { ni: number; nj: number; nk: number }): number {
    return g.ni * g.nj * g.nk;
}

/** Number of COORD pillars. */
export function pillarCount(g: { ni: number; nj: number }): number {
    return (g.ni + 1) * (g.nj + 1);
}

/** Linear ZCORN index for cell `(i,j,k)` corner `(ip,jp,kp)` — corner-major, i-fastest. */
export function zcornIndex(
    dims: { ni: number; nj: number },
    i: number,
    j: number,
    k: number,
    ip: number,
    jp: number,
    kp: number,
): number {
    const nx = 2 * dims.ni;
    const ny = 2 * dims.nj;
    const x = 2 * i + ip;
    const y = 2 * j + jp;
    const z = 2 * k + kp;
    return x + y * nx + z * nx * ny;
}

/** Linear cell index (cell-major, i-fastest) — used by ACTNUM and property arrays. */
export function cellIndex(dims: { ni: number; nj: number }, i: number, j: number, k: number): number {
    return i + j * dims.ni + k * dims.ni * dims.nj;
}

/** Linear COORD pillar index (i-fastest). */
export function pillarIndex(dims: { ni: number }, ip: number, jp: number): number {
    return jp * (dims.ni + 1) + ip;
}

/* -------------------------------------------------------------------------- */
/*  GRDECL parsing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Streaming token reader for GRDECL: strips `--` comments and `/`-terminated
 * sections, expands run-length `n*value` tokens on the fly. Keeps only a small
 * lookahead so multi-million-value keyword bodies never materialise as tokens.
 */
class GrdeclTokenizer {
    private readonly text: string;
    private pos = 0;
    // Pending run-length expansion: `repeat` copies of `value` still to emit.
    private repeat = 0;
    private repeatValue = "";

    constructor(text: string) {
        this.text = text;
    }

    /** Next raw token (word or number as string), or null at end. `/` is returned verbatim. */
    next(): string | null {
        if (this.repeat > 0) {
            this.repeat--;
            return this.repeatValue;
        }
        const n = this.text.length;
        while (this.pos < n) {
            const c = this.text[this.pos];
            if (c === " " || c === "\t" || c === "\r" || c === "\n") {
                this.pos++;
                continue;
            }
            // Line comment: skip to end of line.
            if (c === "-" && this.text[this.pos + 1] === "-") {
                while (this.pos < n && this.text[this.pos] !== "\n") this.pos++;
                continue;
            }
            if (c === "/") {
                this.pos++;
                return "/";
            }
            // Read a bare token up to whitespace or '/'.
            let start = this.pos;
            while (this.pos < n) {
                const d = this.text[this.pos];
                if (d === " " || d === "\t" || d === "\r" || d === "\n" || d === "/") break;
                this.pos++;
            }
            const tok = this.text.slice(start, this.pos);
            const star = tok.indexOf("*");
            if (star > 0) {
                // Run-length: `count*value` (value may be empty → default, treated as the literal).
                const count = parseInt(tok.slice(0, star), 10);
                const value = tok.slice(star + 1);
                if (Number.isFinite(count) && count > 0) {
                    this.repeatValue = value;
                    this.repeat = count - 1;
                    return value;
                }
            }
            return tok;
        }
        return null;
    }
}

/** A single parsed GRDECL keyword body (numbers up to the terminating `/`). */
function readNumbersUntilSlash(tok: GrdeclTokenizer, sink: (v: number) => void): void {
    for (; ;) {
        const t = tok.next();
        if (t === null || t === "/") return;
        const v = Number(t);
        if (Number.isFinite(v)) sink(v);
    }
}

/**
 * Parse a GRDECL text into the neutral corner-point model. Recognises
 * `SPECGRID`/`DIMENS`, `COORD`, `ZCORN`, `ACTNUM`, and any additional numeric
 * keyword whose body length equals the cell count (captured as a property).
 */
export function parseGrdecl(text: string): CornerPointGrid {
    const tok = new GrdeclTokenizer(text);
    let ni = 0;
    let nj = 0;
    let nk = 0;
    let coord: Float64Array | undefined;
    let zcorn: Float64Array | undefined;
    let actnum: Int32Array | undefined;
    const rawProps: Record<string, number[]> = {};

    for (; ;) {
        const kw = tok.next();
        if (kw === null) break;
        const key = kw.toUpperCase();

        if (key === "SPECGRID" || key === "DIMENS") {
            const nums: number[] = [];
            readNumbersUntilSlash(tok, (v) => nums.push(v));
            ni = nums[0] | 0;
            nj = nums[1] | 0;
            nk = nums[2] | 0;
            continue;
        }
        if (key === "COORD") {
            const buf: number[] = [];
            readNumbersUntilSlash(tok, (v) => buf.push(v));
            coord = Float64Array.from(buf);
            continue;
        }
        if (key === "ZCORN") {
            const buf: number[] = [];
            readNumbersUntilSlash(tok, (v) => buf.push(v));
            zcorn = Float64Array.from(buf);
            continue;
        }
        if (key === "ACTNUM") {
            const buf: number[] = [];
            readNumbersUntilSlash(tok, (v) => buf.push(v));
            actnum = Int32Array.from(buf);
            continue;
        }
        // Unknown keyword: capture numeric body (may be a cell property).
        const body: number[] = [];
        readNumbersUntilSlash(tok, (v) => body.push(v));
        if (body.length > 0) rawProps[key] = body;
    }

    if (!ni || !nj || !nk) throw new Error("GRDECL: missing or invalid SPECGRID/DIMENS");
    const ncell = ni * nj * nk;
    if (!coord) throw new Error("GRDECL: missing COORD");
    if (!zcorn) throw new Error("GRDECL: missing ZCORN");
    if (coord.length !== (ni + 1) * (nj + 1) * 6)
        throw new Error(`GRDECL: COORD length ${coord.length} != ${(ni + 1) * (nj + 1) * 6}`);
    if (zcorn.length !== 8 * ncell) throw new Error(`GRDECL: ZCORN length ${zcorn.length} != ${8 * ncell}`);

    const properties: Record<string, Float64Array> = {};
    for (const [k, body] of Object.entries(rawProps)) {
        if (body.length === ncell) properties[k] = Float64Array.from(body);
    }

    const grid: CornerPointGrid = { ni, nj, nk, coord, zcorn };
    if (actnum && actnum.length === ncell) grid.actnum = actnum;
    if (Object.keys(properties).length > 0) grid.properties = properties;
    return grid;
}

/* -------------------------------------------------------------------------- */
/*  GRDECL serialization                                                      */
/* -------------------------------------------------------------------------- */

/** Format a float compactly (trim trailing zeros; avoid exponent noise for typical coords). */
function fmt(v: number): string {
    if (Number.isInteger(v)) return String(v);
    // 6 significant decimals is ample for metre-scale grid geometry.
    let s = v.toFixed(6);
    // Trim trailing zeros / dot.
    s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
}

/**
 * Append a numeric keyword body to `out` with run-length (`n*value`) compression
 * and line wrapping. `values` may be a typed array; formatting is streamed so
 * million-value bodies never build an intermediate string array per element.
 */
function writeKeyword(
    out: string[],
    keyword: string,
    values: ArrayLike<number>,
    opts?: { integer?: boolean; perLine?: number },
): void {
    const perLine = opts?.perLine ?? 8;
    out.push(keyword);
    let line: string[] = [];
    let runValue = "";
    let runCount = 0;

    const flushRun = () => {
        if (runCount === 0) return;
        const token = runCount === 1 ? runValue : `${runCount}*${runValue}`;
        line.push(token);
        if (line.length >= perLine) {
            out.push("  " + line.join(" "));
            line = [];
        }
        runCount = 0;
    };

    const n = values.length;
    for (let idx = 0; idx < n; idx++) {
        const raw = values[idx];
        const s = opts?.integer ? String(raw | 0) : fmt(raw);
        if (s === runValue && runCount > 0) {
            runCount++;
        } else {
            flushRun();
            runValue = s;
            runCount = 1;
        }
    }
    flushRun();
    if (line.length > 0) out.push("  " + line.join(" "));
    out.push("/");
    out.push("");
}

/**
 * Options controlling which keyword groups {@link serializeGrdecl} emits.
 * All default to `true`; set `geometry:false` to emit a properties-only deck
 * (ACTNUM + property keywords with no SPECGRID/COORD/ZCORN).
 */
export interface SerializeGrdeclOptions {
    /** Emit SPECGRID / COORD / ZCORN geometry. */
    geometry?: boolean;
    /** Emit ACTNUM when present on the grid. */
    actnum?: boolean;
    /** Emit cell property keywords when present on the grid. */
    properties?: boolean;
}

/**
 * Serialize the neutral corner-point model to OPM/GRDECL text.
 * Emits SPECGRID, COORD, ZCORN, ACTNUM (if present) and every property keyword.
 * Use {@link SerializeGrdeclOptions} to restrict the output (e.g. properties
 * only, or geometry without properties).
 */
export function serializeGrdecl(grid: CornerPointGrid, opts?: SerializeGrdeclOptions): string {
    const geometry = opts?.geometry ?? true;
    const withActnum = opts?.actnum ?? true;
    const withProperties = opts?.properties ?? true;
    const out: string[] = [];
    out.push("-- Generated by rddms-sdk (RESQML → GRDECL corner-point export)");
    out.push("");
    if (geometry) {
        out.push("SPECGRID");
        out.push(`  ${grid.ni} ${grid.nj} ${grid.nk} 1 F`);
        out.push("/");
        out.push("");

        writeKeyword(out, "COORD", grid.coord, { perLine: 6 });
        writeKeyword(out, "ZCORN", grid.zcorn, { perLine: 8 });
    }
    if (withActnum && grid.actnum) writeKeyword(out, "ACTNUM", grid.actnum, { integer: true, perLine: 20 });
    if (withProperties && grid.properties) {
        for (const [kw, arr] of Object.entries(grid.properties)) {
            writeKeyword(out, kw, arr, { perLine: 8 });
        }
    }
    return out.join("\n");
}
