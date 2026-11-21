/**
 * Canonical unit normalization for well-log curves (PWLS §6.4 improvement).
 *
 * LAS/DLIS carry free-text unit strings; the EML/PWLS layer expects a
 * controlled Energistics UoM per QuantityClass. This module provides:
 *   - a curated Energistics UoM table (symbol → dimension + linear conversion
 *     to the dimension's canonical unit),
 *   - a QuantityClass → dimension map for the common log quantities,
 *   - {@link normalizeUnit}, which reports the canonical unit, whether an input
 *     unit is dimensionally compatible with a QuantityClass, and the linear
 *     factor/offset needed to convert a value to the canonical unit.
 *
 * The conversions are deliberately conservative and linear (`canonical = value *
 * factor + offset`). Only widely-unambiguous log units are included; unknown
 * units are reported as `recognized: false` rather than guessed.
 */

/** Physical dimension families relevant to well logs. */
export type UnitDimension =
    | "length"
    | "plane angle"
    | "api gamma ray"
    | "mass per volume"
    | "electrical resistivity"
    | "time"
    | "temperature"
    | "volume per volume"
    | "pressure"
    | "sonic slowness"
    | "unitless";

interface UnitDef {
    dimension: UnitDimension;
    /** canonical = value * factor + offset. */
    factor: number;
    offset?: number;
}

/** Canonical Energistics UoM symbol per dimension. */
export const CANONICAL_UOM: Record<UnitDimension, string> = {
    length: "m",
    "plane angle": "dega",
    "api gamma ray": "gAPI",
    "mass per volume": "g/cm3",
    "electrical resistivity": "ohm.m",
    time: "s",
    temperature: "degC",
    "volume per volume": "v/v",
    pressure: "kPa",
    "sonic slowness": "us/ft",
    unitless: "Euc"
};

/**
 * Energistics UoM symbol (lower-cased key) → dimension + linear conversion to
 * that dimension's canonical unit. Several common aliases map to one entry.
 */
const UNITS: Record<string, UnitDef> = {
    // length
    m: { dimension: "length", factor: 1 },
    ft: { dimension: "length", factor: 0.3048 },
    "ft[us]": { dimension: "length", factor: 0.30480061 },
    in: { dimension: "length", factor: 0.0254 },
    cm: { dimension: "length", factor: 0.01 },
    mm: { dimension: "length", factor: 0.001 },
    km: { dimension: "length", factor: 1000 },
    // plane angle
    dega: { dimension: "plane angle", factor: 1 },
    deg: { dimension: "plane angle", factor: 1 },
    degree: { dimension: "plane angle", factor: 1 },
    rad: { dimension: "plane angle", factor: 57.2957795130823 },
    // api gamma ray
    gapi: { dimension: "api gamma ray", factor: 1 },
    api: { dimension: "api gamma ray", factor: 1 },
    // mass per volume (density)
    "g/cm3": { dimension: "mass per volume", factor: 1 },
    "g/cc": { dimension: "mass per volume", factor: 1 },
    "kg/m3": { dimension: "mass per volume", factor: 0.001 },
    // electrical resistivity
    "ohm.m": { dimension: "electrical resistivity", factor: 1 },
    ohmm: { dimension: "electrical resistivity", factor: 1 },
    // time
    s: { dimension: "time", factor: 1 },
    ms: { dimension: "time", factor: 0.001 },
    us: { dimension: "time", factor: 1e-6 },
    // temperature (affine)
    degc: { dimension: "temperature", factor: 1 },
    "deg c": { dimension: "temperature", factor: 1 },
    k: { dimension: "temperature", factor: 1, offset: -273.15 },
    degk: { dimension: "temperature", factor: 1, offset: -273.15 },
    degf: { dimension: "temperature", factor: 5 / 9, offset: -32 * (5 / 9) },
    // volume per volume (porosity/saturation)
    "v/v": { dimension: "volume per volume", factor: 1 },
    "m3/m3": { dimension: "volume per volume", factor: 1 },
    "%": { dimension: "volume per volume", factor: 0.01 },
    pu: { dimension: "volume per volume", factor: 0.01 }, // porosity units
    // pressure
    kpa: { dimension: "pressure", factor: 1 },
    pa: { dimension: "pressure", factor: 0.001 },
    bar: { dimension: "pressure", factor: 100 },
    psi: { dimension: "pressure", factor: 6.894757 },
    // sonic slowness
    "us/ft": { dimension: "sonic slowness", factor: 1 },
    "us/m": { dimension: "sonic slowness", factor: 0.3048 },
    // unitless
    euc: { dimension: "unitless", factor: 1 },
    unitless: { dimension: "unitless", factor: 1 }
};

/**
 * QuantityClass name (lower-cased, as used in the PWLS catalog) → dimension.
 * Only the common log quantities are mapped; others return `undefined` and are
 * reported as "unknown quantity class" (no compatibility assertion).
 */
const QC_DIMENSION: Record<string, UnitDimension> = {
    length: "length",
    "true vertical depth": "length",
    "measured depth": "length",
    radius: "length",
    caliper: "length",
    "x coordinate": "length",
    "y coordinate": "length",
    "plane angle": "plane angle",
    "hole deviation": "plane angle",
    "hole azimuth": "plane angle",
    "api gamma ray": "api gamma ray",
    "mass per volume": "mass per volume",
    "electric resistivity": "electrical resistivity",
    "electrical resistivity": "electrical resistivity",
    resistivity: "electrical resistivity",
    time: "time",
    "transverse relaxation time": "time",
    "thermodynamic temperature": "temperature",
    temperature: "temperature",
    "volume per volume": "volume per volume",
    "dimensionless": "volume per volume",
    pressure: "pressure",
    "time per length": "sonic slowness"
};

export interface UnitNormalization {
    /** The input unit string, verbatim. */
    inputUom?: string;
    /** Whether the input unit was recognized in the UoM table. */
    recognized: boolean;
    /** Dimension of the input unit, if recognized. */
    dimension?: UnitDimension;
    /** Canonical Energistics UoM for the input unit's dimension. */
    canonicalUom?: string;
    /** Linear factor to convert input → canonical (`canonical = v*factor + offset`). */
    factor?: number;
    /** Affine offset for the conversion (temperature). */
    offset?: number;
    /** True when the input unit already equals its canonical form. */
    isCanonical?: boolean;
    /** The QuantityClass checked against, if provided. */
    quantityClass?: string;
    /** Expected dimension derived from the QuantityClass. */
    expectedDimension?: UnitDimension;
    /**
     * Dimensional compatibility verdict against the QuantityClass:
     *   true  → unit dimension matches the expected QuantityClass dimension,
     *   false → mismatch (likely a wrong/garbled unit),
     *   undefined → no verdict (unit or QuantityClass unknown).
     */
    compatible?: boolean;
    /** Human-readable note. */
    note: string;
}

/** Convert a value from the input unit to its canonical unit. */
export function toCanonicalValue(value: number, norm: UnitNormalization): number {
    if (norm.factor == null) return value;
    return value * norm.factor + (norm.offset ?? 0);
}

/**
 * Normalize a (unit, QuantityClass) pair. See {@link UnitNormalization}.
 */
export function normalizeUnit(
    uom?: string,
    quantityClass?: string
): UnitNormalization {
    const qc = quantityClass?.trim().toLowerCase();
    const expectedDimension = qc ? QC_DIMENSION[qc] : undefined;

    if (!uom || uom.trim().length === 0) {
        return {
            inputUom: uom,
            recognized: false,
            quantityClass,
            expectedDimension,
            compatible: undefined,
            note: "No unit provided."
        };
    }

    const key = uom.trim().toLowerCase();
    const def = UNITS[key];
    if (!def) {
        return {
            inputUom: uom,
            recognized: false,
            quantityClass,
            expectedDimension,
            compatible: undefined,
            note: `Unit '${uom}' not in the Energistics UoM table; cannot normalize or verify.`
        };
    }

    const canonicalUom = CANONICAL_UOM[def.dimension];
    const isCanonical = def.factor === 1 && !def.offset;
    let compatible: boolean | undefined;
    let note: string;

    if (expectedDimension == null) {
        compatible = undefined;
        note = qc
            ? `QuantityClass '${quantityClass}' not mapped; unit '${uom}' is ${def.dimension} (canonical ${canonicalUom}).`
            : `Unit '${uom}' is ${def.dimension} (canonical ${canonicalUom}).`;
    } else if (expectedDimension === def.dimension) {
        compatible = true;
        note = isCanonical
            ? `Unit '${uom}' is already canonical for ${quantityClass}.`
            : `Unit '${uom}' is compatible with ${quantityClass}; convert to '${canonicalUom}' via value*${def.factor}${def.offset ? `+${def.offset}` : ""}.`;
    } else {
        compatible = false;
        note = `Unit '${uom}' is ${def.dimension} but QuantityClass '${quantityClass}' expects ${expectedDimension} (${CANONICAL_UOM[expectedDimension]}).`;
    }

    return {
        inputUom: uom,
        recognized: true,
        dimension: def.dimension,
        canonicalUom,
        factor: def.factor,
        offset: def.offset,
        isCanonical,
        quantityClass,
        expectedDimension,
        compatible,
        note
    };
}
