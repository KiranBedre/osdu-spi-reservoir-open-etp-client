/**
 * LAS 2.0 well-log parser / serializer — pure, I/O-free.
 *
 * The read side of LAS well-log ingestion (see
 * `rddmsmg/rddms/WellboreDdmsReplacement.md` §4). Produces a normalised
 * {@link ParsedLas} that `witsmlChannels.ts` maps to WITSML 2.1
 * `Channel`/`ChannelSet` objects + bulk arrays; the inverse is
 * {@link serializeLas}.
 *
 * Deliberately dependency-free and side-effect-free so it is trivially unit
 * testable and reusable from both the NestJS controllers and the standalone
 * SDK, exactly like the RESQML builders under `src/lib/builders/`.
 */

/** A single header item from a `~V`/`~W`/`~P` section: `MNEM.UNIT VALUE : DESCRIPTION`. */
export interface LasHeaderItem {
    mnemonic: string;
    unit: string;
    value: string;
    description: string;
}

/** A single curve from the `~C` section plus its column of `~A` data. */
export interface LasCurve {
    mnemonic: string;
    unit: string;
    description: string;
    /** Column values, NULLs already normalised to `NaN`. */
    data: number[];
}

/** Normalised LAS document. */
export interface ParsedLas {
    /** LAS version string from `~V VERS` (e.g. "2.0"). */
    version: string;
    /** `~V WRAP` flag. */
    wrap: boolean;
    /** `~W NULL` sentinel (defaults to -999.25); occurrences replaced by `NaN` in `curves`. */
    nullValue: number;
    /** `~W` well-information items keyed by mnemonic (uppercased). */
    well: Record<string, LasHeaderItem>;
    /** `~C` curves in file order; `curves[0]` is the index (depth/time) channel. */
    curves: LasCurve[];
    /** Convenience: `~W WELL` value, if present. */
    wellName?: string;
}

const SECTION_RE = /^~(\w)/;

/** Split a header line `MNEM.UNIT VALUE : DESCRIPTION` into its four parts. */
function parseHeaderLine(line: string): LasHeaderItem | undefined {
    const colon = line.lastIndexOf(":");
    if (colon < 0) return undefined;
    const left = line.slice(0, colon).trim();
    const description = line.slice(colon + 1).trim();

    const dot = left.indexOf(".");
    if (dot < 0) return undefined;
    const mnemonic = left.slice(0, dot).trim();

    // After the dot: UNIT (up to first whitespace) then VALUE (remainder).
    const rest = left.slice(dot + 1);
    const wsMatch = rest.match(/\s/);
    let unit = "";
    let value = "";
    if (wsMatch && wsMatch.index !== undefined) {
        unit = rest.slice(0, wsMatch.index).trim();
        value = rest.slice(wsMatch.index).trim();
    } else {
        unit = rest.trim();
    }
    return { mnemonic, unit, value, description };
}

/**
 * Parse LAS 2.0 text into a {@link ParsedLas}. Tolerant of both wrapped and
 * unwrapped `~A` sections: all numeric tokens in the data section are collected
 * and reshaped into rows of `curves.length`.
 */
export function parseLas(text: string): ParsedLas {
    const lines = text.split(/\r?\n/);
    let section = "";
    let version = "2.0";
    let wrap = false;
    let nullValue = -999.25;
    const well: Record<string, LasHeaderItem> = {};
    const curveItems: LasHeaderItem[] = [];
    const dataTokens: number[] = [];

    for (const raw of lines) {
        const line = raw.trim();
        if (line.length === 0 || line.startsWith("#")) continue;

        const sec = line.match(SECTION_RE);
        if (sec) {
            section = sec[1].toUpperCase();
            continue;
        }

        if (section === "A") {
            for (const tok of line.split(/\s+/)) {
                if (tok.length === 0) continue;
                const n = Number(tok);
                dataTokens.push(Number.isNaN(n) ? NaN : n);
            }
            continue;
        }

        const item = parseHeaderLine(line);
        if (!item) continue;

        switch (section) {
            case "V":
                if (item.mnemonic.toUpperCase() === "VERS") version = item.value || version;
                if (item.mnemonic.toUpperCase() === "WRAP") wrap = /^y/i.test(item.value);
                break;
            case "W":
                well[item.mnemonic.toUpperCase()] = item;
                if (item.mnemonic.toUpperCase() === "NULL") {
                    const n = Number(item.value);
                    if (!Number.isNaN(n)) nullValue = n;
                }
                break;
            case "C":
                curveItems.push(item);
                break;
            default:
                break;
        }
    }

    const nCurves = curveItems.length;
    const curves: LasCurve[] = curveItems.map((c) => ({
        mnemonic: c.mnemonic,
        unit: c.unit,
        description: c.description,
        data: [],
    }));

    if (nCurves > 0) {
        const rows = Math.floor(dataTokens.length / nCurves);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < nCurves; c++) {
                const v = dataTokens[r * nCurves + c];
                curves[c].data.push(v === nullValue ? NaN : v);
            }
        }
    }

    return {
        version,
        wrap,
        nullValue,
        well,
        curves,
        wellName: well["WELL"]?.value,
    };
}

/** Serialize a {@link ParsedLas} back into unwrapped LAS 2.0 text. */
export function serializeLas(las: ParsedLas): string {
    const nullTok = String(las.nullValue);
    const out: string[] = [];

    out.push("~Version Information");
    out.push(`VERS.   ${las.version} : CWLS LOG ASCII STANDARD - VERSION ${las.version}`);
    out.push("WRAP.   NO  : ONE LINE PER DEPTH STEP");

    out.push("~Well Information");
    if (!las.well["NULL"]) out.push(`NULL.   ${nullTok} : NULL VALUE`);
    for (const key of Object.keys(las.well)) {
        const it = las.well[key];
        out.push(`${it.mnemonic}.${it.unit} ${it.value} : ${it.description}`);
    }

    out.push("~Curve Information");
    for (const c of las.curves) {
        out.push(`${c.mnemonic}.${c.unit} : ${c.description}`);
    }

    out.push("~ASCII");
    const rows = las.curves[0]?.data.length ?? 0;
    for (let r = 0; r < rows; r++) {
        const cols = las.curves.map((c) => {
            const v = c.data[r];
            return Number.isNaN(v) ? nullTok : String(v);
        });
        out.push(cols.join(" "));
    }

    return out.join("\n") + "\n";
}
