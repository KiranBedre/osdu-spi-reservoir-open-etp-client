/**
 * WITSML 2.1 object validation — the WITSML counterpart to the RESQML strict
 * validator, reusing its report/error types (see
 * `rddmsmg/rddms/WellboreDdmsReplacement.md` §5). Runs on the JSON objects the
 * converters emit *before* they hit `PUT /witsml/store`, the same ingest guard
 * pattern the RESQML path uses.
 *
 * Structural / referential only (in-process, no XSD): every full WITSML XSD
 * layer can later fold into `ResqmlValidator` (which already carries the EML
 * common schemas). What is checked here is exactly what the converters can get
 * wrong: object identity, citation completeness, ChannelSet↔Channel integrity,
 * and the single-index-channel invariant.
 */

import { Severity, ValidationCategory, type ValidationError, type ValidationReport } from "../validation/ResqmlValidator";
import type { DataObject } from "../builders/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(message: string, obj?: DataObject): ValidationError {
    return {
        message,
        severity: Severity.ERROR,
        category: ValidationCategory.WITSML,
        object_uuid: obj?.Uuid as string | undefined,
        object_type: obj?.$type as string | undefined,
    };
}

function warn(message: string, obj?: DataObject): ValidationError {
    return {
        message,
        severity: Severity.WARNING,
        category: ValidationCategory.WITSML,
        object_uuid: obj?.Uuid as string | undefined,
        object_type: obj?.$type as string | undefined,
    };
}

/** Validate a batch of WITSML 2.1 JSON objects (converter output). */
export function validateWitsmlObjects(objects: DataObject[]): ValidationReport {
    const errors: ValidationError[] = [];
    const seenUuids = new Set<string>();
    let validated = 0;

    for (const obj of objects) {
        const type = obj.$type;
        if (typeof type !== "string" || !type.startsWith("witsml21.")) {
            errors.push(err(`Object $type must be a witsml21.* token, got "${String(type)}"`, obj));
            continue;
        }
        validated++;

        // Identity.
        const uuid = obj.Uuid as string | undefined;
        if (!uuid || !UUID_RE.test(uuid)) {
            errors.push(err(`Missing or malformed Uuid`, obj));
        } else if (seenUuids.has(uuid.toLowerCase())) {
            errors.push(err(`Duplicate Uuid ${uuid}`, obj));
        } else {
            seenUuids.add(uuid.toLowerCase());
        }

        if (obj.SchemaVersion !== "2.1") {
            errors.push(warn(`SchemaVersion should be "2.1", got "${String(obj.SchemaVersion)}"`, obj));
        }

        // Citation completeness (EML common: Title/Originator/Creation/Format required).
        const cit = obj.Citation as unknown as Record<string, unknown> | undefined;
        if (!cit) {
            errors.push(err(`Missing Citation`, obj));
        } else {
            for (const field of ["Title", "Originator", "Creation", "Format"]) {
                const v = cit[field];
                if (typeof v !== "string" || v.length === 0) {
                    errors.push(err(`Citation.${field} is required and must be non-empty`, obj));
                }
            }
        }

        // Type-specific structural checks.
        if (type === "witsml21.Channel") {
            if (!obj.Mnemonic) errors.push(err(`Channel requires Mnemonic`, obj));
            if (obj.Uom === undefined) errors.push(warn(`Channel has no Uom`, obj));
        }
    }

    // ChannelSet ↔ Channel referential integrity + single index invariant.
    const channels = objects.filter((o) => o.$type === "witsml21.Channel");
    const channelByUuid = new Map<string, DataObject>();
    for (const c of channels) {
        if (typeof c.Uuid === "string") channelByUuid.set(c.Uuid.toLowerCase(), c);
    }

    for (const set of objects.filter((o) => o.$type === "witsml21.ChannelSet")) {
        const refs = (set.Channels as Array<{ Uuid?: string; Mnemonic?: string }> | undefined) ?? [];
        if (refs.length === 0) {
            errors.push(warn(`ChannelSet references no Channels`, set));
        }
        let indexCount = 0;
        for (const r of refs) {
            const target = r.Uuid ? channelByUuid.get(r.Uuid.toLowerCase()) : undefined;
            if (!target) {
                errors.push(err(`ChannelSet references unknown Channel Uuid ${String(r.Uuid)}`, set));
                continue;
            }
            if ((target as { IsIndex?: boolean }).IsIndex) indexCount++;
        }
        if (refs.length > 0 && indexCount !== 1) {
            errors.push(err(`ChannelSet must have exactly one index Channel (found ${indexCount})`, set));
        }
        const indexMnemonic = set.IndexMnemonic as string | undefined;
        if (!indexMnemonic) {
            errors.push(warn(`ChannelSet has no IndexMnemonic`, set));
        }
    }

    const errorCount = errors.filter((e) => e.severity === Severity.ERROR).length;
    const warningCount = errors.filter((e) => e.severity === Severity.WARNING).length;

    return {
        is_valid: errorCount === 0,
        version: "2.1",
        object_count: objects.length,
        validated_count: validated,
        error_count: errorCount,
        warning_count: warningCount,
        errors,
    };
}
