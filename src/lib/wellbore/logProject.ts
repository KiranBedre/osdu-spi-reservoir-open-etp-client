/**
 * WITSML channel → RESQML log projection.
 *
 * The second genuine WITSML→RESQML transform (see
 * `rddmsmg/rddms/WellboreDdmsReplacement.md` §3): a WITSML `Channel` (a log
 * curve) is sampled onto a `WellboreFrameRepresentation` and exposed as a
 * PWLS-typed `ContinuousProperty`, so a RESQML-only consumer reads native
 * RESQML property values instead of a `witsml21.Channel`. On-demand — this is
 * a projection, not a bulk migration.
 *
 * Composes the existing frame + property builders under `src/lib/builders/`.
 */

import { BuiltObject, newUuid, type ResqmlVersion } from "../builders/core";
import { buildWellboreFrame } from "../builders/wellbore";
import { buildContinuousProperty } from "../builders/property";

/** A single log curve to project (already index-aligned to `md`). */
export interface LogCurveInput {
    /** Curve mnemonic (PWLS-canonicalised upstream). */
    mnemonic: string;
    /** Property kind for the RESQML property (e.g. "gamma ray", "bulk density"). */
    kind: string;
    /** Unit of measure. */
    uom: string;
    /** Curve values, one per frame node. */
    values: number[];
}

export interface ProjectChannelSpec {
    version?: ResqmlVersion;
    hdfUuid: string;
    /** Measured depths defining the frame nodes (one per value). */
    nodeMd: number[];
    /** The RESQML trajectory the frame is sampled along. */
    trajectoryUuid: string;
    trajectoryType?: string;
    /** Wellbore interpretation the frame represents (recommended). */
    interpretationUuid?: string;
    interpretationType?: string;
    /** The curve to expose as a ContinuousProperty. */
    curve: LogCurveInput;
    /** Reuse an existing frame instead of building a new one. */
    frameUuid?: string;
    /** Title for the emitted frame (defaults to the curve mnemonic). */
    frameTitle?: string;
    originator?: string;
}

export interface ProjectChannelResult {
    /** All emitted RESQML objects (frame + property), ready for `resources.put`. */
    objects: BuiltObject["object"][];
    /** All bulk arrays, ready for `arrays.put`. */
    arrays: BuiltObject["arrays"];
    frameUuid: string;
    propertyUuid: string;
}

/**
 * Sample a WITSML channel onto a `WellboreFrameRepresentation` and build the
 * PWLS-typed `ContinuousProperty` on its nodes. When `frameUuid` is supplied
 * the frame is assumed to already exist and only the property is emitted.
 */
export function projectChannelOntoFrame(spec: ProjectChannelSpec): ProjectChannelResult {
    const v = spec.version;
    const objects: BuiltObject["object"][] = [];
    const arrays: BuiltObject["arrays"] = [];

    let frameUuid = spec.frameUuid;
    if (!frameUuid) {
        frameUuid = newUuid();
        const frame = buildWellboreFrame({
            uuid: frameUuid,
            title: spec.frameTitle ?? `${spec.curve.mnemonic} frame`,
            hdfUuid: spec.hdfUuid,
            version: v,
            trajectoryUuid: spec.trajectoryUuid,
            trajectoryType: spec.trajectoryType,
            interpretationUuid: spec.interpretationUuid,
            interpretationType: spec.interpretationType,
            nodeMd: spec.nodeMd,
            originator: spec.originator,
        });
        objects.push(frame.object);
        arrays.push(...frame.arrays);
    }

    const propUuid = newUuid();
    const prop = buildContinuousProperty({
        uuid: propUuid,
        title: spec.curve.mnemonic,
        hdfUuid: spec.hdfUuid,
        version: v,
        supportingRepUuid: frameUuid,
        supportingRepType: "obj_WellboreFrameRepresentation",
        kind: spec.curve.kind,
        uom: spec.curve.uom,
        values: spec.curve.values,
        indexable: "nodes",
        originator: spec.originator,
    });
    objects.push(prop.object);
    arrays.push(...prop.arrays);

    return { objects, arrays, frameUuid, propertyUuid: propUuid };
}
