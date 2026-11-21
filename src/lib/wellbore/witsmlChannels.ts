/**
 * LAS → WITSML 2.1 channel mapping.
 *
 * Maps a normalised {@link ParsedLas} to WITSML 2.1 `ChannelSet` + `Channel`
 * objects (JSON form accepted by `PUT /witsml/store`: each object carries
 * `$type` + `Uuid` + `SchemaVersion` + `Citation`) plus the bulk numeric
 * columns as {@link DataArrayInput}s. See
 * `rddmsmg/rddms/WellboreDdmsReplacement.md` §4.
 *
 * NOTE: the WITSML 2.1 `Channel` field set is intentionally minimal here and
 * SHOULD be reconciled against the witsml v2.1 XSD before production use; the
 * curve mnemonic/unit and the numeric arrays (the parts that matter for a
 * round-trip) are complete. Mnemonics are expected to be PWLS-validated at the
 * ingest choke-point (`POST /pwls/validate`) before this runs.
 */

import type { DataObject, DataArrayInput } from "../builders/types";
import { citation, newUuid } from "../builders/core";
import type { ParsedLas } from "./las";

/** WITSML 2.1 `$type` token. */
function wtype(bare: string): string {
    return `witsml21.${bare}`;
}

export interface LasToWitsmlOptions {
    /** Citation originator stamped on emitted objects. */
    originator?: string;
    /** Optional WITSML wellbore UUID the channel set belongs to. */
    wellboreUuid?: string;
    /** ChannelSet title (defaults to the LAS well name). */
    title?: string;
}

export interface LasToWitsmlResult {
    /** WITSML JSON objects for `PUT /witsml/store` (`json` array form). */
    objects: DataObject[];
    /** Bulk numeric columns referenced by the channels. */
    arrays: DataArrayInput[];
}

/**
 * Convert a parsed LAS document into a WITSML 2.1 `ChannelSet` + `Channel`s and
 * their bulk arrays. `curves[0]` is treated as the index (depth/time) channel.
 */
export function lasToWitsml(las: ParsedLas, opts: LasToWitsmlOptions = {}): LasToWitsmlResult {
    if (las.curves.length === 0) {
        return { objects: [], arrays: [] };
    }

    const originator = opts.originator;
    const title = opts.title ?? las.wellName ?? "LAS Channel Set";
    const setUuid = newUuid();
    const indexCurve = las.curves[0];

    const objects: DataObject[] = [];
    const arrays: DataArrayInput[] = [];

    const channelUuids: { uuid: string; mnemonic: string }[] = [];

    for (let i = 0; i < las.curves.length; i++) {
        const curve = las.curves[i];
        const chUuid = newUuid();
        const path = `/WITSML/${setUuid}/${curve.mnemonic}`;

        const channel = {
            $type: wtype("Channel"),
            Uuid: chUuid,
            SchemaVersion: "2.1",
            Citation: citation(curve.mnemonic, { originator, format: "WITSML v2.1" }),
            Mnemonic: curve.mnemonic,
            Uom: curve.unit,
            IsIndex: i === 0,
            DataType: "double",
        } as unknown as DataObject;
        objects.push(channel);
        channelUuids.push({ uuid: chUuid, mnemonic: curve.mnemonic });

        arrays.push({
            ContainerType: "witsml21.obj_ChannelSet",
            ContainerUuid: setUuid,
            PathInResource: path,
            Dimensions: [curve.data.length],
            ArrayType: "Float64Array",
            Data: curve.data,
        });
    }

    const channelSet = {
        $type: wtype("ChannelSet"),
        Uuid: setUuid,
        SchemaVersion: "2.1",
        Citation: citation(title, { originator, format: "WITSML v2.1" }),
        IndexMnemonic: indexCurve.mnemonic,
        Channels: channelUuids.map((c) => ({ Mnemonic: c.mnemonic, Uuid: c.uuid })),
        ...(opts.wellboreUuid ? { Wellbore: { Uuid: opts.wellboreUuid } } : {}),
    } as unknown as DataObject;
    objects.unshift(channelSet);

    return { objects, arrays };
}

/** Result of {@link lasToWitsmlChannelSetXml}. */
export interface LasToWitsmlXmlResult {
    /** A single, schema-complete WITSML 2.1 `ChannelSet` XML document. */
    xml: string;
    /** The ChannelSet UUID (also the array `ContainerUuid`). */
    setUuid: string;
    /** Curve mnemonics in emitted order (index first). */
    mnemonics: string[];
    /** Bulk numeric columns referenced by the channels. */
    arrays: DataArrayInput[];
}

/** Minimal XML text escaper for element content and attribute values. */
function xmlEscape(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
}

/**
 * Emit a **single, schema-complete WITSML 2.1 `ChannelSet` XML document** for
 * the working `PUT /witsml/store` (`xml` field) path.
 *
 * Unlike {@link lasToWitsml} (which produced one JSON object per Channel and a
 * ChannelSet without an `Index` — both rejected by the store), this builds the
 * store-accepted shape verified against the ETP server:
 *   - the `uuid` lives on the **unprefixed** `uuid=` attribute (`eml:uuid` →
 *     "Invalid UUID"),
 *   - `Channel`s are **inline children** of the `ChannelSet` (not standalone
 *     objects), and
 *   - a mandatory `<Index>` (Mnemonic/Uom/IndexKind/Direction) is present.
 *
 * The XML is authored directly (default WITSML namespace, no `xsi:type`
 * decoration) because the server rejects the `xsi:type`-heavy form produced by
 * the JSON→XML builder.
 */
export function lasToWitsmlChannelSetXml(las: ParsedLas, opts: LasToWitsmlOptions = {}): LasToWitsmlXmlResult {
    if (las.curves.length === 0) {
        return { xml: "", setUuid: "", mnemonics: [], arrays: [] };
    }

    const originator = opts.originator ?? "etpclient";
    const title = opts.title ?? las.wellName ?? "Channel Set";
    const setUuid = newUuid();
    const indexCurve = las.curves[0];
    const now = new Date().toISOString();
    const arrays: DataArrayInput[] = [];
    const mnemonics: string[] = [];

    // A depth index unit maps to "measured depth"; anything time-like to "date time".
    const idxUnit = (indexCurve.unit || "").toLowerCase();
    const indexKind = /(^|[^a-z])(s|sec|ms|hr|h|min|date|time)([^a-z]|$)/.test(idxUnit)
        ? "date time"
        : "measured depth";

    const cit = (t: string): string =>
        `<eml:Citation>` +
        `<eml:Title>${xmlEscape(t)}</eml:Title>` +
        `<eml:Originator>${xmlEscape(originator)}</eml:Originator>` +
        `<eml:Creation>${now}</eml:Creation>` +
        `<eml:Format>etpclient</eml:Format>` +
        `<eml:LastUpdate>${now}</eml:LastUpdate>` +
        `</eml:Citation>`;

    const channelXml: string[] = [];
    for (const curve of las.curves) {
        mnemonics.push(curve.mnemonic);
        channelXml.push(
            `<Channel>` +
            cit(curve.mnemonic) +
            `<Mnemonic>${xmlEscape(curve.mnemonic)}</Mnemonic>` +
            (curve.description ? `<Description>${xmlEscape(curve.description)}</Description>` : "") +
            `<DataType>double</DataType>` +
            (curve.unit ? `<Uom>${xmlEscape(curve.unit)}</Uom>` : "") +
            `</Channel>`
        );
        arrays.push({
            ContainerType: "witsml21.obj_ChannelSet",
            ContainerUuid: setUuid,
            PathInResource: `/WITSML/${setUuid}/${curve.mnemonic}`,
            Dimensions: [curve.data.length],
            ArrayType: "Float64Array",
            Data: curve.data,
        });
    }

    // XSD sequence: Citation, (Channel*), Index.
    const xml =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<ChannelSet xmlns="http://www.energistics.org/energyml/data/witsmlv2"` +
        ` xmlns:eml="http://www.energistics.org/energyml/data/commonv2"` +
        ` schemaVersion="2.1" uuid="${setUuid}">` +
        cit(title) +
        channelXml.join("") +
        `<Index>` +
        `<Mnemonic>${xmlEscape(indexCurve.mnemonic)}</Mnemonic>` +
        `<Uom>${xmlEscape(indexCurve.unit || "m")}</Uom>` +
        `<IndexKind>${indexKind}</IndexKind>` +
        `<Direction>increasing</Direction>` +
        `</Index>` +
        `</ChannelSet>`;

    return { xml, setUuid, mnemonics, arrays };
}
