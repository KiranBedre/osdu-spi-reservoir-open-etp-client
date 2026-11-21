/**
 * `WellboreBridge` — the user-friendly facade over the wellbore converters.
 *
 * Hides the WITSML-vs-RESQML split behind a small, discoverable API so callers
 * do not have to remember which store each object belongs to (see
 * `rddmsmg/rddms/WellboreDdmsReplacement.md` §3/§4). The rule it encodes:
 *
 *   - raw well inputs (LAS/CSV curves, headers, surveys) → **WITSML**;
 *   - geomodelling views (feature/interpretation, trajectory geometry, sampled
 *     logs) → **RESQML** that *references/derives from* the WITSML source.
 *
 * Accumulate with the fluent methods, then call {@link build} to get two
 * ready-to-send payloads: `witsml` (→ `PUT /witsml/store`) and `resqml`
 * (→ `resources.put` + `arrays.put`).
 */

import type { DataObject, DataArrayInput } from "../builders/types";
import type { ResqmlVersion } from "../builders/core";
import { parseLas } from "./las";
import { parseDlis } from "./dlis";
import { lasToWitsml } from "./witsmlChannels";
import { bridgeWellbore, type WitsmlWellboreRef, type WellboreDomain } from "./bridge";
import { buildWellboreTrajectory, type TrajectoryStation } from "./trajectory";
import { projectChannelOntoFrame, type LogCurveInput } from "./logProject";

export interface WellboreBridgeOptions {
    /** External-part (HDF) proxy UUID that owns the emitted RESQML arrays. */
    hdfUuid: string;
    /** RESQML schema line for emitted RESQML objects. */
    version?: ResqmlVersion;
    /** Citation originator stamped on every emitted object. */
    originator?: string;
}

/** Two store-scoped payloads produced by {@link WellboreBridge.build}. */
export interface WellborePayload {
    witsml: { objects: DataObject[]; arrays: DataArrayInput[] };
    resqml: { objects: DataObject[]; arrays: DataArrayInput[] };
}

export class WellboreBridge {
    private readonly opts: WellboreBridgeOptions;
    private readonly witsmlObjects: DataObject[] = [];
    private readonly witsmlArrays: DataArrayInput[] = [];
    private readonly resqmlObjects: DataObject[] = [];
    private readonly resqmlArrays: DataArrayInput[] = [];

    constructor(opts: WellboreBridgeOptions) {
        this.opts = opts;
    }

    /** Import a LAS 2.0 document as WITSML `ChannelSet` + `Channel`s (raw data → WITSML). */
    importLas(text: string, opts: { wellboreUuid?: string; title?: string } = {}): { channelSetUuid: string; mnemonics: string[] } {
        const parsed = parseLas(text);
        const { objects, arrays } = lasToWitsml(parsed, {
            originator: this.opts.originator,
            wellboreUuid: opts.wellboreUuid,
            title: opts.title,
        });
        this.witsmlObjects.push(...objects);
        this.witsmlArrays.push(...arrays);
        const set = objects.find((o) => o.$type === "witsml21.ChannelSet");
        return {
            channelSetUuid: (set?.Uuid as string) ?? "",
            mnemonics: parsed.curves.map((c) => c.mnemonic),
        };
    }

    /** Import a DLIS (RP66 V1) blob as WITSML `ChannelSet` + `Channel`s (raw data → WITSML). */
    importDlis(
        input: Uint8Array | string,
        opts: { wellboreUuid?: string; title?: string; frameName?: string } = {},
    ): { channelSetUuid: string; mnemonics: string[] } {
        const bytes = typeof input === "string" ? Buffer.from(input, "base64") : input;
        const parsed = parseDlis(bytes, { frameName: opts.frameName, title: opts.title });
        const { objects, arrays } = lasToWitsml(parsed, {
            originator: this.opts.originator,
            wellboreUuid: opts.wellboreUuid,
            title: opts.title,
        });
        this.witsmlObjects.push(...objects);
        this.witsmlArrays.push(...arrays);
        const set = objects.find((o) => o.$type === "witsml21.ChannelSet");
        return {
            channelSetUuid: (set?.Uuid as string) ?? "",
            mnemonics: parsed.curves.map((c) => c.mnemonic),
        };
    }
    linkWitsmlWellbore(
        witsmlWellbore: WitsmlWellboreRef,
        opts: { title?: string; domain?: WellboreDomain } = {},
    ): { featureUuid: string; interpretationUuid: string } {
        const { feature, interpretation } = bridgeWellbore({
            version: this.opts.version,
            originator: this.opts.originator,
            witsmlWellbore,
            title: opts.title,
            domain: opts.domain,
        });
        this.resqmlObjects.push(feature, interpretation);
        return {
            featureUuid: feature.Uuid,
            interpretationUuid: interpretation.Uuid,
        };
    }

    /** Convert WITSML survey stations into a RESQML trajectory (min-curvature geometry). */
    convertTrajectory(
        stations: TrajectoryStation[],
        opts: {
            title?: string;
            interpretationUuid?: string;
            origin?: { x: number; y: number; z: number };
            mdUom?: string;
            mdDatumUuid?: string;
        } = {},
    ): { trajectoryUuid: string } {
        const built = buildWellboreTrajectory({
            title: opts.title ?? "Trajectory",
            hdfUuid: this.opts.hdfUuid,
            version: this.opts.version,
            originator: this.opts.originator,
            stations,
            origin: opts.origin,
            mdUom: opts.mdUom,
            interpretationUuid: opts.interpretationUuid,
            mdDatumUuid: opts.mdDatumUuid,
        });
        this.resqmlObjects.push(built.object);
        this.resqmlArrays.push(...built.arrays);
        return { trajectoryUuid: built.object.Uuid };
    }

    /** Sample a WITSML curve onto a RESQML frame as a PWLS-typed `ContinuousProperty`. */
    projectCurve(spec: {
        trajectoryUuid: string;
        nodeMd: number[];
        curve: LogCurveInput;
        interpretationUuid?: string;
        frameUuid?: string;
        frameTitle?: string;
    }): { frameUuid: string; propertyUuid: string } {
        const res = projectChannelOntoFrame({
            version: this.opts.version,
            hdfUuid: this.opts.hdfUuid,
            originator: this.opts.originator,
            nodeMd: spec.nodeMd,
            trajectoryUuid: spec.trajectoryUuid,
            interpretationUuid: spec.interpretationUuid,
            curve: spec.curve,
            frameUuid: spec.frameUuid,
            frameTitle: spec.frameTitle,
        });
        this.resqmlObjects.push(...res.objects);
        this.resqmlArrays.push(...res.arrays);
        return { frameUuid: res.frameUuid, propertyUuid: res.propertyUuid };
    }

    /** Return the two store-scoped payloads accumulated so far. */
    build(): WellborePayload {
        return {
            witsml: { objects: this.witsmlObjects, arrays: this.witsmlArrays },
            resqml: { objects: this.resqmlObjects, arrays: this.resqmlArrays },
        };
    }
}
