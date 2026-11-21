/**
 * WITSML 2.1 ChannelSet builder — single-call metadata-only assembly with
 * inline PWLS resolution and optional unit normalization (PWLS §6.4.1/§6.4.2).
 *
 * Given an index channel and a set of data channels (values held out-of-band as
 * external arrays), this emits:
 *   - a metadata-only `<ChannelSet>` XML (Channels before Index, unprefixed
 *     uuid, matching the proven ingest format), with each channel carrying its
 *     resolved PWLS property / QuantityClass / PropertyType UUID as EML
 *     `ExtraMetadata`, and
 *   - an `arrays[]` payload (one entry per channel) ready for `PUT /witsml/store`
 *     so the whole log lands in one call.
 *
 * Optional `acquisitionMetadata` (tool strings, parameters, zones, …) is written
 * as ChannelSet-level `ExtraMetadata`, giving DLIS acquisition context a home on
 * the object without a separate EML entity (§6.4.2 sidecar).
 */

import { newUuid } from "./core";
import {
    getMnemonicMatch,
    getQuantityClassForProperty,
    getPropertyTypeIdForProperty
} from "../jsonTypes/PwlsCurveCatalog";
import { normalizeUnit } from "../jsonTypes/PwlsUnits";

const NS_W = "http://www.energistics.org/energyml/data/witsmlv2";
const NS_E = "http://www.energistics.org/energyml/data/commonv2";

export interface ChannelSpec {
    mnemonic: string;
    uom: string;
    values: number[];
    /** [rows] for a scalar curve, [rows, binCount] for an array/multi-dim curve. */
    dimensions?: number[];
}

export interface IndexSpec {
    mnemonic: string;
    uom: string;
    /** e.g. "measured depth", "vertical depth", "time". */
    kind: string;
    direction?: "increasing" | "decreasing";
}

/** EML `Aliases` entry, e.g. the OSDU record id under authority `osdu`. */
export interface AliasSpec {
    authority: string;
    identifier: string;
    description?: string;
}

export interface ChannelSetSpec {
    uuid?: string;
    title: string;
    index: IndexSpec;
    channels: ChannelSpec[];
    originator?: string;
    /** DLIS/acquisition context → ChannelSet-level ExtraMetadata (§6.4.2). */
    acquisitionMetadata?: Record<string, string | number>;
    /** Free ChannelSet-level ExtraMetadata written as-is (name → value). */
    extraMetadata?: Record<string, string | number>;
    /** Object aliases (external identities) written before the Citation. */
    aliases?: AliasSpec[];
    /** Parent `witsml21.Wellbore` written as a DOR after the Index. */
    wellbore?: { uuid: string; title?: string };
    /** Normalize/verify each channel's UoM against its resolved QuantityClass. */
    normalizeUnits?: boolean;
    creation?: string;
}

/** Per-channel PWLS resolution result surfaced back to the caller. */
export interface ChannelResolution {
    mnemonic: string;
    property?: string;
    quantityClass?: string;
    propertyTypeId?: string;
    matchedVia: string;
    alias?: string;
    /** Present when normalizeUnits is set and the UoM was evaluated. */
    canonicalUom?: string;
    unitCompatible?: boolean;
    conversionFactor?: number;
    warnings?: string[];
}

/** Array payload entry compatible with `PUT /witsml/store` arrays[]. */
export interface ChannelSetArray {
    mnemonic: string;
    dimensions: number[];
    data: number[];
}

export interface BuiltChannelSet {
    uuid: string;
    xml: string;
    arrays: ChannelSetArray[];
    resolution: ChannelResolution[];
}

function xmlEscape(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function extraMetadata(name: string, value: string | number): string {
    return (
        `<eml:ExtraMetadata>` +
        `<eml:Name>${xmlEscape(name)}</eml:Name>` +
        `<eml:Value>${xmlEscape(String(value))}</eml:Value>` +
        `</eml:ExtraMetadata>`
    );
}

function citation(title: string, originator: string, now: string): string {
    return (
        `<eml:Citation>` +
        `<eml:Title>${xmlEscape(title)}</eml:Title>` +
        `<eml:Originator>${xmlEscape(originator)}</eml:Originator>` +
        `<eml:Creation>${now}</eml:Creation>` +
        `<eml:Format>etpclient</eml:Format>` +
        `<eml:LastUpdate>${now}</eml:LastUpdate>` +
        `</eml:Citation>`
    );
}

function aliases(list: AliasSpec[] | undefined): string {
    return (list ?? [])
        .map(
            a =>
                `<eml:Aliases authority="${xmlEscape(a.authority)}">` +
                `<eml:Identifier>${xmlEscape(a.identifier)}</eml:Identifier>` +
                (a.description ? `<eml:Description>${xmlEscape(a.description)}</eml:Description>` : "") +
                `</eml:Aliases>`
        )
        .join("");
}

function metadataEntries(map: Record<string, string | number> | undefined, prefix = ""): string {
    return Object.entries(map ?? {})
        .map(([k, v]) => extraMetadata(`${prefix}${k}`, v))
        .join("");
}

/**
 * Build a metadata-only ChannelSet with inline PWLS resolution + external
 * array payloads. Returns `{ uuid, xml, arrays, resolution }`.
 */
export function buildChannelSet(spec: ChannelSetSpec): BuiltChannelSet {
    if (!spec.title) {throw new Error("ChannelSet requires a title");}
    if (!spec.index?.mnemonic) {throw new Error("ChannelSet requires an index channel");}
    if (!Array.isArray(spec.channels) || spec.channels.length === 0) {
        throw new Error("ChannelSet requires at least one data channel");
    }

    const uuid = spec.uuid ?? newUuid();
    const originator = spec.originator ?? "etpclient";
    const now = spec.creation ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    const resolution: ChannelResolution[] = [];
    const arrays: ChannelSetArray[] = [];
    let channelsXml = "";

    for (const ch of spec.channels) {
        if (!ch.mnemonic) {throw new Error("Each channel requires a mnemonic");}
        const match = getMnemonicMatch(ch.mnemonic);
        const property = match.property;
        const quantityClass = property ? getQuantityClassForProperty(property) : undefined;
        const propertyTypeId = property ? getPropertyTypeIdForProperty(property) : undefined;

        const res: ChannelResolution = {
            mnemonic: ch.mnemonic,
            property,
            quantityClass,
            propertyTypeId,
            matchedVia: match.matchedVia,
            alias: match.alias
        };

        if (spec.normalizeUnits && ch.uom && quantityClass) {
            const norm = normalizeUnit(ch.uom, quantityClass);
            res.canonicalUom = norm.canonicalUom;
            res.unitCompatible = norm.compatible;
            res.conversionFactor = norm.factor;
            if (norm.compatible === false || !norm.recognized) {
                res.warnings = [norm.note];
            }
        }
        resolution.push(res);

        const rows = ch.dimensions?.[0] ?? ch.values.length;
        const dims = ch.dimensions ?? [rows];
        arrays.push({ mnemonic: ch.mnemonic, dimensions: dims, data: ch.values });

        const meta =
            (property ? extraMetadata("pwls:property", property) : "") +
            (quantityClass ? extraMetadata("pwls:quantityClass", quantityClass) : "") +
            (propertyTypeId ? extraMetadata("pwls:propertyTypeId", propertyTypeId) : "") +
            extraMetadata("pwls:matchedVia", match.matchedVia) +
            (match.alias ? extraMetadata("pwls:alias", match.alias) : "");

        channelsXml +=
            `<Channel>` +
            citation(ch.mnemonic, originator, now) +
            `<Mnemonic>${xmlEscape(ch.mnemonic)}</Mnemonic>` +
            `<DataType>double</DataType>` +
            `<Uom>${xmlEscape(ch.uom)}</Uom>` +
            meta +
            `</Channel>`;
    }

    const acqMeta = metadataEntries(spec.acquisitionMetadata, "acq:") + metadataEntries(spec.extraMetadata);

    const wellbore = spec.wellbore
        ? `<Wellbore>` +
          `<eml:Uuid>${xmlEscape(spec.wellbore.uuid)}</eml:Uuid>` +
          `<eml:QualifiedType>witsml21.Wellbore</eml:QualifiedType>` +
          `<eml:Title>${xmlEscape(spec.wellbore.title ?? spec.wellbore.uuid)}</eml:Title>` +
          `</Wellbore>`
        : "";

    const direction = spec.index.direction ?? "increasing";
    const xml =
        `<ChannelSet xmlns="${NS_W}" xmlns:eml="${NS_E}" schemaVersion="2.1" uuid="${uuid}">` +
        aliases(spec.aliases) +
        citation(spec.title, originator, now) +
        acqMeta +
        channelsXml +
        `<Index>` +
        `<Mnemonic>${xmlEscape(spec.index.mnemonic)}</Mnemonic>` +
        `<Uom>${xmlEscape(spec.index.uom)}</Uom>` +
        `<IndexKind>${xmlEscape(spec.index.kind)}</IndexKind>` +
        `<Direction>${direction}</Direction>` +
        `</Index>` +
        wellbore +
        `</ChannelSet>`;

    return { uuid, xml, arrays, resolution };
}
