/**
 * Property-kind vocabulary + canonicalisation.
 *
 * Two problems this addresses:
 *   1. RESQML strict-validator P02–P04: abstract kinds ("volume per volume",
 *      "dimensionless", "length" on a discrete property) trip the validator.
 *      `resolvePropertyKind()` maps common abstract/free-text kinds to a
 *      concrete RESQML standard kind.
 *   2. Seismic/geophysical kinds are not in the shipped PWLS well-log
 *      vocabulary (datadef interpretation §3). Until canonicalised they land
 *      as free-text and are not queryable. This module carries the target
 *      list so builders stamp a canonical kind, and the client `/pwls/*`
 *      surface stays the authority for well-log curve semantics.
 *
 * This is a *client-side* canonicalisation aid. The server `/pwls/resolve`
 * and `/pwls/validate` remain the source of truth for well-log mnemonics;
 * `RddmsClient` composes both (see `putProperty`).
 */

/** Canonical RESQML reservoir property kinds (concrete descendants). */
export const RESQML_PROPERTY_KINDS = [
    "depth",
    "porosity",
    "permeability rock",
    "rock permeability",
    "net to gross ratio",
    "saturation",
    "fluid volume",
    "pressure",
    "temperature",
    "bulk volume",
    "pore volume",
    "length",
    "thickness",
    "rock volume",
    "transmissibility",
    // concrete kinds emitted by the grid-property registry (grdecl/egrid import)
    "solution gas-oil ratio",
    "vapor oil-gas ratio",
    "property multiplier",
    "index",
    "code",
] as const;

/**
 * Canonical seismic/geophysical property kinds (datadef interpretation §3).
 * Source list: `SeismicAttributeType.1.0.0-Proposal.xlsx`.
 */
export const SEISMIC_PROPERTY_KINDS = [
    // amplitude / attribute
    "amplitude",
    "coherence",
    "sweetness",
    "instantaneous phase",
    "instantaneous frequency",
    "probability",
    // impedance / elastic
    "acoustic impedance",
    "elastic impedance",
    // velocity
    "Vp",
    "Vs",
    "Vp/Vs",
    "interval velocity",
    "average velocity",
    "RMS velocity",
    // domain
    "two-way time",
] as const;

export type SeismicPropertyKind = (typeof SEISMIC_PROPERTY_KINDS)[number];

/** All canonical kinds this SDK recognises (RESQML + seismic). */
export const CANONICAL_PROPERTY_KINDS: readonly string[] = [
    ...RESQML_PROPERTY_KINDS,
    ...SEISMIC_PROPERTY_KINDS,
];

/**
 * Map common abstract / free-text kinds to a concrete descendant.
 * Covers the strict-validator P02/P03 cases from the Drogon EPC builder.
 */
const ABSTRACT_KIND_REMAP: Record<string, string> = {
    "volume per volume": "porosity",
    dimensionless: "net to gross ratio",
    // discrete indices carried on a continuous-hierarchy "length" — remap only
    // when the caller signals a discrete property (see resolvePropertyKind).
};

export interface KindResolution {
    /** The kind after canonicalisation. */
    kind: string;
    /** True if `kind` is in the canonical set. */
    canonical: boolean;
    /** True if the input was remapped from an abstract/free-text kind. */
    remapped: boolean;
    warnings: string[];
}

/** Is this an exact canonical kind? */
export function isCanonicalKind(kind: string): boolean {
    return CANONICAL_PROPERTY_KINDS.includes(kind);
}

/** Is this a canonical seismic/geophysical kind? */
export function isSeismicKind(kind: string): kind is SeismicPropertyKind {
    return (SEISMIC_PROPERTY_KINDS as readonly string[]).includes(kind);
}

/**
 * Canonicalise a property kind. Trims/normalises, remaps known abstract kinds,
 * and reports whether the result is canonical. Does not invent kinds — an
 * unknown kind is returned as-is with a warning so the caller (or the server
 * `/seismic/validate` choke-point) can reject it.
 */
export function resolvePropertyKind(
    input: string,
    opts?: { discrete?: boolean },
): KindResolution {
    const warnings: string[] = [];
    const trimmed = input.trim();
    let kind = trimmed;
    let remapped = false;

    if (opts?.discrete && (trimmed === "length" || trimmed === "dimensionless")) {
        // P03: discrete property must not use a continuous-hierarchy kind.
        kind = "index";
        remapped = true;
        warnings.push(`discrete property kind "${trimmed}" remapped to "index"`);
    } else if (trimmed in ABSTRACT_KIND_REMAP) {
        kind = ABSTRACT_KIND_REMAP[trimmed];
        remapped = true;
        warnings.push(`abstract kind "${trimmed}" remapped to concrete "${kind}"`);
    }

    const canonical = isCanonicalKind(kind);
    if (!canonical && !remapped) {
        warnings.push(`kind "${kind}" is not in the canonical vocabulary`);
    }
    return { kind, canonical, remapped, warnings };
}

/**
 * Common free-text aliases → canonical seismic kind (case-insensitive keys).
 * Keeps the `/seismic/validate` choke-point forgiving on input while still
 * landing a single canonical kind on the object.
 */
const SEISMIC_KIND_ALIASES: Record<string, string> = {
    ai: "acoustic impedance",
    "acoustic-impedance": "acoustic impedance",
    "acoustic impedence": "acoustic impedance",
    ei: "elastic impedance",
    "elastic-impedance": "elastic impedance",
    rms: "RMS velocity",
    "rms velocity": "RMS velocity",
    "root mean square velocity": "RMS velocity",
    vint: "interval velocity",
    "interval-velocity": "interval velocity",
    vavg: "average velocity",
    "average-velocity": "average velocity",
    vp: "Vp",
    vs: "Vs",
    "vp/vs": "Vp/Vs",
    vpvs: "Vp/Vs",
    twt: "two-way time",
    "two way time": "two-way time",
    "two-way traveltime": "two-way time",
    "two way traveltime": "two-way time",
    amp: "amplitude",
    freq: "instantaneous frequency",
    "instantaneous freq": "instantaneous frequency",
    "inst frequency": "instantaneous frequency",
    "inst phase": "instantaneous phase",
};

/**
 * Expected UOM per canonical seismic kind — used for ingest-time UOM sanity
 * checks (§10.4: velocity in m/s, TWT in ms). Advisory only (warn, not reject).
 */
const SEISMIC_KIND_UOM: Record<string, string> = {
    "acoustic impedance": "kg/(m2.s)",
    "elastic impedance": "kg/(m2.s)",
    Vp: "m/s",
    Vs: "m/s",
    "Vp/Vs": "Euc",
    "interval velocity": "m/s",
    "average velocity": "m/s",
    "RMS velocity": "m/s",
    "two-way time": "ms",
};

function normUom(u: string): string {
    return u
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/·/g, ".")
        .replace(/\.s-1$/, "/s")
        .replace(/s-1$/, "/s");
}

/** Loose UOM compatibility check (exact match or a known velocity synonym). */
export function uomCompatible(actual: string, expected: string): boolean {
    const a = normUom(actual);
    const e = normUom(expected);
    if (a === e) {
        return true;
    }
    const velocity = new Set(["m/s", "m.s-1", "ms-1"].map(normUom));
    return velocity.has(e) && velocity.has(a);
}

export interface SeismicKindResolution {
    /** The original input string. */
    input: string;
    /** The kind after alias resolution. */
    kind: string;
    /** True if `kind` is in the canonical set. */
    canonical: boolean;
    /** True if `kind` is a canonical seismic/geophysical kind (not a reservoir kind). */
    seismic: boolean;
    /** True if the input was resolved via an alias. */
    matchedAlias: boolean;
    /** Expected UOM for this kind, if known. */
    expectedUom?: string;
    warnings: string[];
}

/**
 * Canonicalise a seismic property kind for the `/seismic/validate` choke-point.
 * Trims, resolves known aliases (case-insensitive), reports whether the result
 * is a canonical seismic kind, and (when a UOM is supplied) warns on a UOM that
 * disagrees with the expected unit. Never invents a kind — an unknown input is
 * returned as-is with a warning so the caller can reject it.
 */
export function resolveSeismicKind(
    input: string,
    opts?: { uom?: string },
): SeismicKindResolution {
    const warnings: string[] = [];
    const trimmed = (input ?? "").trim();

    if (!trimmed) {
        return {
            input,
            kind: "",
            canonical: false,
            seismic: false,
            matchedAlias: false,
            warnings: ["empty property kind"],
        };
    }

    let kind = trimmed;
    let matchedAlias = false;

    if (!isCanonicalKind(kind)) {
        const alias = SEISMIC_KIND_ALIASES[trimmed.toLowerCase()];
        if (alias) {
            kind = alias;
            matchedAlias = true;
            warnings.push(`"${trimmed}" matched alias → canonical "${kind}"`);
        }
    }

    const canonical = isCanonicalKind(kind);
    const seismic = isSeismicKind(kind);
    const expectedUom = SEISMIC_KIND_UOM[kind];

    if (!canonical) {
        warnings.push(`kind "${trimmed}" is not in the canonical seismic vocabulary`);
    } else if (!seismic) {
        warnings.push(`kind "${kind}" is canonical but not a seismic/geophysical kind`);
    }

    if (opts?.uom && expectedUom && !uomCompatible(opts.uom, expectedUom)) {
        warnings.push(
            `UOM "${opts.uom}" for kind "${kind}" — expected "${expectedUom}"`,
        );
    }

    return { input, kind, canonical, seismic, matchedAlias, expectedUom, warnings };
}
