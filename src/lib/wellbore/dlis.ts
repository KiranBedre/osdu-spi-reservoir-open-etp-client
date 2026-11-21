/**
 * DLIS (RP66 V1) well-log parser → WITSML 2.1 channels — pure, I/O-free.
 *
 * The binary sibling of `las.ts` / `csv.ts` (see
 * `rddmsmg/rddms/WellboreDdmsReplacement.md` §4). DLIS is a binary format so
 * it has none of the LAS `~` section structure; this module decodes the
 * Storage-Unit / Visible-Record / Logical-Record framing, extracts one FRAME
 * and its CHANNELs, and normalises the result into the same {@link ParsedLas}
 * shape so it can reuse {@link lasToWitsml} — one WITSML `Channel`/`ChannelSet`
 * mapping path for LAS, CSV and DLIS.
 *
 * Scope: RP66 V1 (Schlumberger DLIS). Deliberately dependency-free (no external
 * DLIS library) so it stays trivially unit-testable, exactly like the RESQML
 * builders under `src/lib/builders/`. It supports the common single-storage-set
 * layout (SUL + Visible Records + EFLR/IFLR) and scalar or fixed-dimension
 * numeric channels. Encrypted logical records are skipped.
 */

import type { ParsedLas, LasCurve, LasHeaderItem } from "./las";
import { lasToWitsml, type LasToWitsmlResult } from "./witsmlChannels";

export interface DlisToChannelsOptions {
    /**
     * Select which FRAME to convert, by frame object name. Defaults to the first
     * frame that carries FDATA rows.
     */
    frameName?: string;
    /** ChannelSet title (defaults to the DLIS well name, then "DLIS Channel Set"). */
    title?: string;
    /** Citation originator stamped on emitted objects. */
    originator?: string;
    /** Optional WITSML wellbore UUID the channel set belongs to. */
    wellboreUuid?: string;
}

// ── RP66 V1 representation codes (subset needed for logs) ────────────────────
const RC = {
    FSHORT: 1,
    FSINGL: 2,
    FSING1: 3,
    FSING2: 4,
    ISINGL: 5,
    VSINGL: 6,
    FDOUBL: 7,
    FDOUB1: 8,
    FDOUB2: 9,
    SSHORT: 12,
    SNORM: 13,
    SLONG: 14,
    USHORT: 15,
    UNORM: 16,
    ULONG: 17,
    UVARI: 18,
    IDENT: 19,
    ASCII: 20,
    DTIME: 21,
    ORIGIN: 22,
    OBNAME: 23,
    OBJREF: 24,
    ATTREF: 25,
    STATUS: 26,
    UNITS: 27,
} as const;

/** DLIS object name: (origin, copy-number, identifier). */
interface ObName {
    origin: number;
    copy: number;
    id: string;
}

function obNameKey(o: ObName): string {
    return `${o.origin}.${o.copy}.${o.id}`;
}

/** Minimal cursor over a byte buffer with big-endian DLIS primitives. */
class Reader {
    public pos = 0;
    constructor(public readonly buf: Uint8Array) {}

    get remaining(): number {
        return this.buf.length - this.pos;
    }

    u8(): number {
        return this.buf[this.pos++];
    }
    u16(): number {
        const v = (this.buf[this.pos] << 8) | this.buf[this.pos + 1];
        this.pos += 2;
        return v;
    }
    u32(): number {
        const v =
            this.buf[this.pos] * 0x1000000 +
            (this.buf[this.pos + 1] << 16) +
            (this.buf[this.pos + 2] << 8) +
            this.buf[this.pos + 3];
        this.pos += 4;
        return v;
    }
    i8(): number {
        const v = this.buf[this.pos++];
        return v > 0x7f ? v - 0x100 : v;
    }
    i16(): number {
        const v = this.u16();
        return v > 0x7fff ? v - 0x10000 : v;
    }
    i32(): number {
        const v = this.u32();
        return v > 0x7fffffff ? v - 0x100000000 : v;
    }
    f32(): number {
        const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4).getFloat32(0, false);
        this.pos += 4;
        return v;
    }
    f64(): number {
        const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, false);
        this.pos += 8;
        return v;
    }

    /** UVARI: 1, 2 or 4 byte unsigned, length flagged by the top bit(s). */
    uvari(): number {
        const b0 = this.buf[this.pos];
        if ((b0 & 0x80) === 0) {
            this.pos += 1;
            return b0;
        }
        if ((b0 & 0xc0) === 0x80) {
            const v = ((b0 & 0x3f) << 8) | this.buf[this.pos + 1];
            this.pos += 2;
            return v;
        }
        const v =
            ((b0 & 0x3f) << 24) |
            (this.buf[this.pos + 1] << 16) |
            (this.buf[this.pos + 2] << 8) |
            this.buf[this.pos + 3];
        this.pos += 4;
        return v >>> 0;
    }

    /** IDENT / UNITS: USHORT length prefix + ASCII bytes. */
    ident(): string {
        const len = this.u8();
        let s = "";
        for (let i = 0; i < len; i++) s += String.fromCharCode(this.buf[this.pos + i]);
        this.pos += len;
        return s.trim();
    }

    /** ASCII: UVARI length prefix + bytes. */
    ascii(): string {
        const len = this.uvari();
        let s = "";
        for (let i = 0; i < len; i++) s += String.fromCharCode(this.buf[this.pos + i]);
        this.pos += len;
        return s.trim();
    }

    obname(): ObName {
        const origin = this.uvari();
        const copy = this.u8();
        const id = this.ident();
        return { origin, copy, id };
    }

    /** Read one value of the given representation code. Numbers as JS number. */
    value(rc: number): number | string | ObName {
        switch (rc) {
            case RC.FSHORT:
                return this.i16() / 256; // approx: 16-bit fractional
            case RC.FSINGL:
                return this.f32();
            case RC.FSING1:
                return this.f32(); // value; ignore validity companion
            case RC.FSING2:
                return this.f32();
            case RC.ISINGL: {
                // IBM single-precision float
                const b = this.u32();
                return ibmToFloat(b);
            }
            case RC.VSINGL: {
                const b = this.u32();
                return ieeeSingle(b);
            }
            case RC.FDOUBL:
                return this.f64();
            case RC.FDOUB1:
                return this.f64();
            case RC.FDOUB2:
                return this.f64();
            case RC.SSHORT:
                return this.i8();
            case RC.SNORM:
                return this.i16();
            case RC.SLONG:
                return this.i32();
            case RC.USHORT:
                return this.u8();
            case RC.UNORM:
                return this.u16();
            case RC.ULONG:
                return this.u32();
            case RC.UVARI:
            case RC.ORIGIN:
                return this.uvari();
            case RC.IDENT:
            case RC.UNITS:
                return this.ident();
            case RC.ASCII:
                return this.ascii();
            case RC.STATUS:
                return this.u8();
            case RC.DTIME:
                // 8 bytes: y,tz/m,d,h,min,s,ms(hi),ms(lo) — return millis-ish marker
                this.pos += 8;
                return NaN;
            case RC.OBNAME:
                return this.obname();
            case RC.OBJREF: {
                this.ident(); // set type
                return this.obname();
            }
            case RC.ATTREF: {
                this.ident();
                const o = this.obname();
                this.ident();
                return o;
            }
            default:
                // Unknown/unsupported rep code: cannot size it safely.
                throw new Error(`Unsupported DLIS representation code ${rc}`);
        }
    }
}

/** IEEE-754 single from raw 32 bits. */
function ieeeSingle(bits: number): number {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setUint32(0, bits >>> 0, false);
    return dv.getFloat32(0, false);
}

/** IBM 370 single-precision float → IEEE. */
function ibmToFloat(bits: number): number {
    const sign = bits & 0x80000000 ? -1 : 1;
    const exponent = (bits >> 24) & 0x7f;
    const mantissa = bits & 0x00ffffff;
    if (mantissa === 0) return 0;
    return sign * mantissa * Math.pow(16, exponent - 64 - 6);
}

// ── EFLR (explicitly formatted logical record) model ─────────────────────────
interface AttrTemplate {
    label: string;
    count: number;
    repCode: number;
    units: string;
}

interface EflrObject {
    name: ObName;
    attrs: Record<string, { rc: number; units: string; values: (number | string | ObName)[] }>;
}

interface Eflr {
    setType: string;
    objects: EflrObject[];
}

const ROLE = { ABSATR: 0, ATTRIB: 1, INVATR: 2, OBJECT: 3, RDSET: 5, RSET: 6, SET: 7 } as const;

/** Parse one assembled EFLR logical-record body into a set of objects. */
function parseEflr(body: Uint8Array): Eflr {
    const r = new Reader(body);
    let setType = "";

    // Set component.
    const setDesc = r.u8();
    const setRole = setDesc >> 5;
    if (setRole !== ROLE.SET && setRole !== ROLE.RDSET && setRole !== ROLE.RSET) {
        throw new Error(`EFLR does not start with a Set component (role ${setRole})`);
    }
    if (setDesc & 0x10) setType = r.ident(); // Type
    if (setDesc & 0x08) r.ident(); // Name (unused)

    // Template: a run of ATTRIB components before the first OBJECT.
    const template: AttrTemplate[] = [];
    while (r.remaining > 0) {
        const desc = r.buf[r.pos];
        const role = desc >> 5;
        if (role === ROLE.OBJECT) break;
        if (role !== ROLE.ATTRIB && role !== ROLE.INVATR) break;
        r.pos++; // consume descriptor
        const t: AttrTemplate = { label: "", count: 1, repCode: RC.IDENT, units: "" };
        if (desc & 0x10) t.label = r.ident();
        if (desc & 0x08) t.count = r.uvari();
        if (desc & 0x04) t.repCode = r.u8();
        if (desc & 0x02) t.units = r.ident();
        if (desc & 0x01) {
            // Template default value — read & discard so cursor stays aligned.
            readValues(r, t.repCode, t.count);
        }
        template.push(t);
    }

    // Objects.
    const objects: EflrObject[] = [];
    while (r.remaining > 0) {
        const desc = r.u8();
        const role = desc >> 5;
        if (role !== ROLE.OBJECT) break;
        const name = desc & 0x10 ? r.obname() : { origin: 0, copy: 0, id: "" };
        const obj: EflrObject = { name, attrs: {} };
        for (const tpl of template) {
            if (r.remaining === 0) break;
            const adesc = r.u8();
            const arole = adesc >> 5;
            if (arole === ROLE.ABSATR) {
                // Absent attribute — inherits nothing.
                continue;
            }
            // ATTRIB (may override label/count/rep/units then value).
            let count = tpl.count;
            let repCode = tpl.repCode;
            let units = tpl.units;
            if (adesc & 0x10) r.ident(); // per-object label override (ignored)
            if (adesc & 0x08) count = r.uvari();
            if (adesc & 0x04) repCode = r.u8();
            if (adesc & 0x02) units = r.ident();
            let values: (number | string | ObName)[] = [];
            if (adesc & 0x01) {
                values = readValues(r, repCode, count);
            }
            obj.attrs[tpl.label] = { rc: repCode, units, values };
        }
        objects.push(obj);
    }

    return { setType, objects };
}

function readValues(r: Reader, rc: number, count: number): (number | string | ObName)[] {
    const out: (number | string | ObName)[] = [];
    for (let i = 0; i < count; i++) out.push(r.value(rc));
    return out;
}

// ── Frame / channel assembly ─────────────────────────────────────────────────
interface ChannelDef {
    name: ObName;
    longName: string;
    units: string;
    repCode: number;
    /** Product of the DIMENSION attribute (number of samples per frame row). */
    elements: number;
}

interface FrameDef {
    name: ObName;
    channelKeys: string[];
    indexType: string;
    wellName?: string;
}

function num(v: number | string | ObName | undefined, dflt = 0): number {
    return typeof v === "number" ? v : dflt;
}
function str(v: number | string | ObName | undefined, dflt = ""): string {
    return typeof v === "string" ? v : dflt;
}

/**
 * Decode a DLIS (RP66 V1) buffer into the normalised {@link ParsedLas} form.
 * Reads the first (or named) FRAME and its scalar / fixed-dimension numeric
 * CHANNELs. Non-numeric or unsupported channels are dropped.
 */
export function parseDlis(bytes: Uint8Array, opts: DlisToChannelsOptions = {}): ParsedLas {
    // Storage Unit Label (80 bytes ASCII) is present when bytes[0..3] are digits
    // (the Storage Unit Sequence Number). Skip it when found.
    let start = 0;
    if (bytes.length >= 80 && isDigits(bytes, 0, 4)) {
        start = 80;
    }

    const eflrs: Eflr[] = [];
    // Assemble logical records from visible records + logical-record segments.
    const fdata: { frame: ObName; body: Uint8Array }[] = [];

    let vrPos = start;
    // Segment assembly state for a logical record spanning multiple segments.
    let segAcc: number[] | null = null;
    let segIsEflr = false;

    while (vrPos + 4 <= bytes.length) {
        const vrLen = (bytes[vrPos] << 8) | bytes[vrPos + 1];
        if (vrLen < 4) break;
        // bytes[vrPos+2] = 0xFF (format), bytes[vrPos+3] = major version
        const vrEnd = Math.min(vrPos + vrLen, bytes.length);
        let p = vrPos + 4;
        while (p + 4 <= vrEnd) {
            const lrsLen = (bytes[p] << 8) | bytes[p + 1];
            if (lrsLen < 4) break;
            const attrs = bytes[p + 2];
            // const lrType = bytes[p + 3];
            const isEflr = (attrs & 0x80) !== 0;
            const hasPredecessor = (attrs & 0x40) !== 0;
            const hasSuccessor = (attrs & 0x20) !== 0;
            const encrypted = (attrs & 0x10) !== 0;
            const hasPad = (attrs & 0x01) !== 0;
            const hasChecksum = (attrs & 0x02) !== 0;
            const hasTrailingLen = (attrs & 0x04) !== 0;

            let bodyStart = p + 4;
            let bodyEnd = p + lrsLen;
            // Trailing bytes come off the END of the segment body.
            let trailer = 0;
            if (hasChecksum) trailer += 2;
            if (hasTrailingLen) trailer += 2;
            bodyEnd -= trailer;
            let padLen = 0;
            if (hasPad && bodyEnd > bodyStart) {
                padLen = bytes[bodyEnd - 1];
            }
            const dataEnd = Math.max(bodyStart, bodyEnd - padLen);

            if (!encrypted) {
                if (!hasPredecessor) {
                    segAcc = [];
                    segIsEflr = isEflr;
                }
                if (segAcc) {
                    for (let i = bodyStart; i < dataEnd; i++) segAcc.push(bytes[i]);
                }
                if (!hasSuccessor && segAcc) {
                    const lr = Uint8Array.from(segAcc);
                    if (segIsEflr) {
                        try {
                            eflrs.push(parseEflr(lr));
                        } catch {
                            /* skip malformed EFLR */
                        }
                    } else {
                        // IFLR: OBNAME (frame) + UVARI (frame number) + frame data.
                        try {
                            const rr = new Reader(lr);
                            const frame = rr.obname();
                            rr.uvari(); // frame number
                            fdata.push({ frame, body: lr.subarray(rr.pos) });
                        } catch {
                            /* skip malformed IFLR */
                        }
                    }
                    segAcc = null;
                }
            } else if (!hasSuccessor) {
                segAcc = null;
            }
            p += lrsLen;
        }
        vrPos = vrEnd;
    }

    // Index CHANNEL objects.
    const channels = new Map<string, ChannelDef>();
    let wellName: string | undefined = opts.title;
    for (const e of eflrs) {
        if (e.setType.toUpperCase() === "CHANNEL") {
            for (const o of e.objects) {
                const dim = o.attrs["DIMENSION"]?.values ?? [];
                const elements = dim.length ? dim.reduce((a: number, v) => a * num(v, 1), 1) : 1;
                channels.set(obNameKey(o.name), {
                    name: o.name,
                    longName: str(o.attrs["LONG-NAME"]?.values?.[0], o.name.id),
                    units: o.attrs["UNITS"]?.units || str(o.attrs["UNITS"]?.values?.[0], ""),
                    repCode: num(o.attrs["REPRESENTATION-CODE"]?.values?.[0], RC.FSINGL),
                    elements: Math.max(1, elements),
                });
            }
        } else if (e.setType.toUpperCase() === "ORIGIN") {
            for (const o of e.objects) {
                const wn = str(o.attrs["WELL-NAME"]?.values?.[0], "");
                if (wn && !wellName) wellName = wn;
            }
        }
    }

    // Index FRAME objects.
    const frames: FrameDef[] = [];
    for (const e of eflrs) {
        if (e.setType.toUpperCase() !== "FRAME") continue;
        for (const o of e.objects) {
            const chans = (o.attrs["CHANNELS"]?.values ?? []).filter(
                (v): v is ObName => typeof v === "object",
            );
            frames.push({
                name: o.name,
                channelKeys: chans.map(obNameKey),
                indexType: str(o.attrs["INDEX-TYPE"]?.values?.[0], ""),
            });
        }
    }

    // Choose the frame: named, else first with FDATA rows, else first frame.
    const framesWithData = new Set(fdata.map((f) => obNameKey(f.frame)));
    let frame: FrameDef | undefined;
    if (opts.frameName) {
        frame = frames.find((f) => f.name.id === opts.frameName);
    }
    if (!frame) frame = frames.find((f) => framesWithData.has(obNameKey(f.name)));
    if (!frame) frame = frames[0];

    if (!frame || frame.channelKeys.length === 0) {
        return emptyParsed(wellName);
    }

    // Build curve slots (expanding multi-element channels to `MNEM[k]`).
    const frameChannels = frame.channelKeys
        .map((k) => channels.get(k))
        .filter((c): c is ChannelDef => c !== undefined);

    const curves: LasCurve[] = [];
    const slotForChannel: number[][] = []; // channel index -> curve indices
    for (const ch of frameChannels) {
        const idxs: number[] = [];
        for (let e = 0; e < ch.elements; e++) {
            const mnem = ch.elements > 1 ? `${ch.name.id}[${e}]` : ch.name.id;
            idxs.push(curves.length);
            curves.push({ mnemonic: mnem, unit: ch.units, description: ch.longName, data: [] });
        }
        slotForChannel.push(idxs);
    }

    // Decode FDATA rows for the chosen frame in channel order.
    const frameKey = obNameKey(frame.name);
    for (const row of fdata) {
        if (obNameKey(row.frame) !== frameKey) continue;
        const rr = new Reader(row.body);
        try {
            for (let ci = 0; ci < frameChannels.length; ci++) {
                const ch = frameChannels[ci];
                const slots = slotForChannel[ci];
                for (let e = 0; e < ch.elements; e++) {
                    const v = rr.value(ch.repCode);
                    curves[slots[e]].data.push(typeof v === "number" ? v : NaN);
                }
            }
        } catch {
            // Truncated/row rep-code mismatch: stop consuming this frame's rows.
            break;
        }
    }

    const well: Record<string, LasHeaderItem> = {};
    if (wellName) {
        well["WELL"] = { mnemonic: "WELL", unit: "", value: wellName, description: "WELL NAME" };
    }

    return {
        version: "DLIS",
        wrap: false,
        nullValue: -999.25,
        well,
        curves,
        wellName,
    };
}

function emptyParsed(wellName?: string): ParsedLas {
    return { version: "DLIS", wrap: false, nullValue: -999.25, well: {}, curves: [], wellName };
}

function isDigits(buf: Uint8Array, from: number, len: number): boolean {
    for (let i = from; i < from + len; i++) {
        const c = buf[i];
        if (c < 0x30 || c > 0x39) return false;
    }
    return true;
}

/**
 * Convert a DLIS (RP66 V1) buffer into a WITSML 2.1 `ChannelSet` + `Channel`s
 * and their bulk arrays — the DLIS entry point mirroring {@link lasToWitsml}
 * and {@link csvToChannels}. `input` is the raw file bytes or a base64 string.
 */
export function dlisToChannels(
    input: Uint8Array | string,
    opts: DlisToChannelsOptions = {},
): LasToWitsmlResult {
    const bytes = typeof input === "string" ? Buffer.from(input, "base64") : input;
    const parsed = parseDlis(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), opts);
    return lasToWitsml(parsed, {
        originator: opts.originator,
        wellboreUuid: opts.wellboreUuid,
        title: opts.title,
    });
}
