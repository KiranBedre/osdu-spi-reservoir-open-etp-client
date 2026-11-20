/**
 * Canonical grid-property registry — the single bidirectional bridge between
 * three naming worlds for reservoir cell properties:
 *
 *   GRDECL / EGRID / INIT keyword     (PORO, PERMX, SWAT, SATNUM …)  ── dialect
 *          ⇅
 *   RESQML property kind + UOM        (porosity, rock permeability …) ── storage
 *          ⇅
 *   OSDU canonical name (+ PWLS)      (Porosity, PermeabilityX …)     ── truth
 *
 * OSDU/PWLS is treated as the source of truth; the GRDECL keyword is just one
 * serialisation dialect reached through this table. The map is bidirectional so
 * import (keyword → RESQML) and export (RESQML → keyword) share one definition,
 * making the GRDECL/EGRID/INIT round-trip stable and idempotent.
 *
 * The default table below is a starting set; it is **runtime-extensible** via
 * {@link registerGridProperty} / {@link registerGridProperties} so sites can add
 * their own geo-properties (extra saturations, region arrays, multipliers, …)
 * or override the shipped defaults without editing this file.
 *
 * Pure/data-only — no I/O, safe to import from builders and the SDK.
 */

/** One canonical property definition spanning the three naming worlds. */
export interface GridPropertyMapping {
    /** Canonical GRDECL/EGRID/INIT keyword (upper-case, ≤ 8 chars). */
    keyword: string;
    /** Alternate keyword spellings that resolve to the same property. */
    aliases?: string[];
    /** RESQML property kind (concrete descendant, see vocabulary.ts). */
    resqmlKind: string;
    /** OSDU canonical property name (the source-of-truth identity). */
    osdu: string;
    /** PWLS mnemonic when a standard one exists (log-adjacent properties). */
    pwls?: string;
    /** Canonical (OSDU/RESQML) unit of measure. */
    uom: string;
    /** UOM the GRDECL/INIT dialect expects, when it differs from {@link uom}. */
    keywordUom?: string;
    /** True for integer/region keywords (ACTNUM, SATNUM, FIPNUM, …). */
    discrete?: boolean;
    /**
     * Optional matcher for descriptive RESQML Titles (e.g. "Water saturation").
     * Used by {@link toKeyword} to recover a keyword when the Title is a
     * human description rather than a mnemonic. All listed tokens must appear
     * (case-insensitive, order-independent) for the entry to match.
     */
    titleTokens?: string[];
}

/**
 * Shipped default mappings. Ordered so earlier entries win on ambiguous
 * descriptive-title matches (e.g. PERMX before PERM). OSDU names are the
 * client-side canonical defaults and can be overridden per site.
 */
const DEFAULT_MAPPINGS: readonly GridPropertyMapping[] = [
    // ── porosity / volumes ────────────────────────────────────────────────
    { keyword: "PORO", resqmlKind: "porosity", osdu: "Porosity", pwls: "PORO", uom: "m3/m3", titleTokens: ["poros"] },
    { keyword: "PORV", resqmlKind: "pore volume", osdu: "PoreVolume", uom: "m3", titleTokens: ["pore", "volume"] },
    { keyword: "NTG", aliases: ["NETGROSS"], resqmlKind: "net to gross ratio", osdu: "NetToGross", uom: "m3/m3", titleTokens: ["net", "gross"] },
    { keyword: "DZNET", resqmlKind: "thickness", osdu: "NetThickness", uom: "m", titleTokens: ["net", "thick"] },

    // ── permeability ──────────────────────────────────────────────────────
    { keyword: "PERMX", aliases: ["PERMI", "KX"], resqmlKind: "rock permeability", osdu: "PermeabilityX", pwls: "PERM", uom: "mD", titleTokens: ["perm", "x"] },
    { keyword: "PERMY", aliases: ["PERMJ", "KY"], resqmlKind: "rock permeability", osdu: "PermeabilityY", pwls: "PERM", uom: "mD", titleTokens: ["perm", "y"] },
    { keyword: "PERMZ", aliases: ["PERMK", "KZ"], resqmlKind: "rock permeability", osdu: "PermeabilityZ", pwls: "PERM", uom: "mD", titleTokens: ["perm", "z"] },
    { keyword: "PERM", resqmlKind: "rock permeability", osdu: "Permeability", pwls: "PERM", uom: "mD", titleTokens: ["perm"] },

    // ── saturations (initial + endpoints) ─────────────────────────────────
    { keyword: "SWATINIT", resqmlKind: "saturation", osdu: "InitialWaterSaturation", uom: "m3/m3", titleTokens: ["init", "water", "satur"] },
    { keyword: "SWAT", aliases: ["SW"], resqmlKind: "saturation", osdu: "WaterSaturation", uom: "m3/m3", titleTokens: ["water", "satur"] },
    { keyword: "SOIL", aliases: ["SO"], resqmlKind: "saturation", osdu: "OilSaturation", uom: "m3/m3", titleTokens: ["oil", "satur"] },
    { keyword: "SGAS", aliases: ["SG"], resqmlKind: "saturation", osdu: "GasSaturation", uom: "m3/m3", titleTokens: ["gas", "satur"] },
    { keyword: "SWL", resqmlKind: "saturation", osdu: "ConnateWaterSaturation", uom: "m3/m3" },
    { keyword: "SWCR", resqmlKind: "saturation", osdu: "CriticalWaterSaturation", uom: "m3/m3" },
    { keyword: "SGL", resqmlKind: "saturation", osdu: "ConnateGasSaturation", uom: "m3/m3" },
    { keyword: "SGCR", resqmlKind: "saturation", osdu: "CriticalGasSaturation", uom: "m3/m3" },
    { keyword: "SOWCR", resqmlKind: "saturation", osdu: "CriticalOilInWaterSaturation", uom: "m3/m3" },
    { keyword: "SOGCR", resqmlKind: "saturation", osdu: "CriticalOilInGasSaturation", uom: "m3/m3" },

    // ── pressures / state ─────────────────────────────────────────────────
    { keyword: "PRESSURE", resqmlKind: "pressure", osdu: "Pressure", uom: "bar", titleTokens: ["pressure"] },
    { keyword: "RS", resqmlKind: "solution gas-oil ratio", osdu: "SolutionGasOilRatio", uom: "m3/m3" },
    { keyword: "RV", resqmlKind: "vapor oil-gas ratio", osdu: "SolutionOilGasRatio", uom: "m3/m3" },

    // ── transmissibility multipliers ──────────────────────────────────────
    { keyword: "MULTX", resqmlKind: "property multiplier", osdu: "TransmissibilityMultiplierX", uom: "Euc" },
    { keyword: "MULTY", resqmlKind: "property multiplier", osdu: "TransmissibilityMultiplierY", uom: "Euc" },
    { keyword: "MULTZ", resqmlKind: "property multiplier", osdu: "TransmissibilityMultiplierZ", uom: "Euc" },
    { keyword: "MULTPV", resqmlKind: "property multiplier", osdu: "PoreVolumeMultiplier", uom: "Euc" },
    { keyword: "TRANX", resqmlKind: "transmissibility", osdu: "TransmissibilityX", uom: "cP.rm3/day/bar" },
    { keyword: "TRANY", resqmlKind: "transmissibility", osdu: "TransmissibilityY", uom: "cP.rm3/day/bar" },
    { keyword: "TRANZ", resqmlKind: "transmissibility", osdu: "TransmissibilityZ", uom: "cP.rm3/day/bar" },

    // ── geometry-derived ──────────────────────────────────────────────────
    { keyword: "DX", resqmlKind: "length", osdu: "CellSizeX", uom: "m" },
    { keyword: "DY", resqmlKind: "length", osdu: "CellSizeY", uom: "m" },
    { keyword: "DZ", resqmlKind: "thickness", osdu: "CellThickness", uom: "m", titleTokens: ["thick"] },
    { keyword: "TOPS", resqmlKind: "depth", osdu: "CellTopDepth", uom: "m", titleTokens: ["top", "depth"] },
    { keyword: "DEPTH", resqmlKind: "depth", osdu: "CellCenterDepth", uom: "m", titleTokens: ["depth"] },

    // ── discrete region / index arrays ────────────────────────────────────
    // RESQML 2.0.1 has no "active"/"region initialization" standard kinds, and the
    // discrete hierarchy's only concrete leaves are "index" and "code". ACTNUM is a
    // boolean flag and the *NUM arrays are integer region indices → all use "index".
    // The precise reservoir role is kept in the OSDU name, and read-back keys off
    // the Title (e.g. "ACTNUM"), not the kind.
    { keyword: "ACTNUM", aliases: ["ACTIVE"], resqmlKind: "index", osdu: "ActiveCellIndicator", uom: "Euc", discrete: true, titleTokens: ["active"] },
    { keyword: "SATNUM", resqmlKind: "index", osdu: "SaturationRegionNumber", uom: "Euc", discrete: true },
    { keyword: "PVTNUM", resqmlKind: "index", osdu: "PvtRegionNumber", uom: "Euc", discrete: true },
    { keyword: "EQLNUM", resqmlKind: "index", osdu: "EquilibrationRegionNumber", uom: "Euc", discrete: true },
    { keyword: "FIPNUM", resqmlKind: "index", osdu: "FluidInPlaceRegionNumber", uom: "Euc", discrete: true },
    { keyword: "ROCKNUM", resqmlKind: "index", osdu: "RockRegionNumber", uom: "Euc", discrete: true },
    { keyword: "IMBNUM", resqmlKind: "index", osdu: "ImbibitionRegionNumber", uom: "Euc", discrete: true },
    { keyword: "MULTNUM", resqmlKind: "index", osdu: "MultiplierRegionNumber", uom: "Euc", discrete: true },
    { keyword: "ENDNUM", resqmlKind: "index", osdu: "EndpointRegionNumber", uom: "Euc", discrete: true },
    { keyword: "FLUXNUM", resqmlKind: "index", osdu: "FluxRegionNumber", uom: "Euc", discrete: true }
];

/** Normalise a name/keyword/title to an alphanumeric upper-case token. */
function norm(s: string): string {
    return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Live registry state, seeded from the defaults and mutable via register*. */
const byKeyword = new Map<string, GridPropertyMapping>();
const byAlias = new Map<string, GridPropertyMapping>();
const byOsdu = new Map<string, GridPropertyMapping>();
const byKind = new Map<string, GridPropertyMapping>();
const ordered: GridPropertyMapping[] = [];

/** Index a single mapping into all lookup tables (last registration wins). */
function indexMapping(m: GridPropertyMapping): void {
    byKeyword.set(norm(m.keyword), m);
    byAlias.set(norm(m.keyword), m);
    for (const a of m.aliases ?? []) byAlias.set(norm(a), m);
    byOsdu.set(norm(m.osdu), m);
    if (!byKind.has(norm(m.resqmlKind))) byKind.set(norm(m.resqmlKind), m);
    ordered.push(m);
}

/**
 * Register (or override) a single grid-property mapping at runtime. A later
 * registration for the same keyword replaces the earlier one for
 * keyword/alias/OSDU lookups.
 */
export function registerGridProperty(mapping: GridPropertyMapping): void {
    indexMapping(mapping);
}

/** Register (or override) several mappings at once. */
export function registerGridProperties(mappings: Iterable<GridPropertyMapping>): void {
    for (const m of mappings) indexMapping(m);
}

/** Reset the registry to the shipped defaults (drops all custom entries). */
export function resetGridPropertyRegistry(): void {
    byKeyword.clear();
    byAlias.clear();
    byOsdu.clear();
    byKind.clear();
    ordered.length = 0;
    for (const m of DEFAULT_MAPPINGS) indexMapping(m);
}

resetGridPropertyRegistry();

/** All currently-registered mappings (defaults + custom), in registration order. */
export function gridPropertyMappings(): readonly GridPropertyMapping[] {
    return ordered;
}

/** Look up a mapping by GRDECL/INIT keyword or any registered alias. */
export function lookupByKeyword(keyword: string): GridPropertyMapping | undefined {
    return byAlias.get(norm(keyword));
}

/** Look up a mapping by OSDU canonical name. */
export function lookupByOsdu(name: string): GridPropertyMapping | undefined {
    return byOsdu.get(norm(name));
}

/** Look up a representative mapping for a RESQML property kind. */
export function lookupByResqmlKind(kind: string): GridPropertyMapping | undefined {
    return byKind.get(norm(kind));
}

/**
 * Resolve an arbitrary RESQML property Title to a canonical mapping. Tries, in
 * order: exact keyword/alias, exact OSDU name, then descriptive
 * `titleTokens` matching (all tokens present). Returns undefined when nothing
 * matches so callers can fall back to a sanitised keyword.
 */
export function lookupByTitle(title: string): GridPropertyMapping | undefined {
    const n = norm(title);
    const direct = byAlias.get(n) ?? byOsdu.get(n);
    if (direct) return direct;
    const lower = title.toLowerCase();
    for (const m of ordered) {
        if (m.titleTokens && m.titleTokens.every(t => lower.includes(t))) return m;
    }
    return undefined;
}

/** Forward (import) map: GRDECL/INIT keyword → RESQML `{ kind, uom }`. */
export function resqmlKindForKeyword(keyword: string): { kind: string; uom: string } {
    const m = lookupByKeyword(keyword);
    return m ? { kind: m.resqmlKind, uom: m.uom } : { kind: "continuous", uom: "Euc" };
}

/**
 * Reverse (export) map: reduce a RESQML property Title to a canonical GRDECL/INIT
 * keyword. Uses the registry first (so "Water saturation" → `SWAT`), then falls
 * back to a sanitised, ≤ 8-char upper-case token. Never returns an empty string.
 */
export function toKeyword(title: string): string {
    const hit = lookupByTitle(title);
    if (hit) return hit.keyword;
    const k = norm(title).slice(0, 8);
    return k || "PROP";
}

// ── unit conversion ───────────────────────────────────────────────────────

interface LinearConversion {
    factor: number;
    offset: number;
}

/** Linear conversions keyed `FROM|TO` (value_to = value_from * factor + offset). */
const UNIT_CONVERSIONS: Record<string, LinearConversion> = {
    // permeability
    "mD|m2": { factor: 9.869233e-16, offset: 0 },
    "m2|mD": { factor: 1 / 9.869233e-16, offset: 0 },
    "mD|D": { factor: 1e-3, offset: 0 },
    "D|mD": { factor: 1e3, offset: 0 },
    // pressure
    "bar|Pa": { factor: 1e5, offset: 0 },
    "Pa|bar": { factor: 1e-5, offset: 0 },
    "bar|kPa": { factor: 100, offset: 0 },
    "kPa|bar": { factor: 0.01, offset: 0 },
    "bar|psi": { factor: 14.503773773, offset: 0 },
    "psi|bar": { factor: 1 / 14.503773773, offset: 0 },
    // length
    "m|ft": { factor: 3.280839895, offset: 0 },
    "ft|m": { factor: 0.3048, offset: 0 },
    // temperature
    "degC|degK": { factor: 1, offset: 273.15 },
    "degK|degC": { factor: 1, offset: -273.15 },
    "degC|degF": { factor: 1.8, offset: 32 },
    "degF|degC": { factor: 1 / 1.8, offset: -32 / 1.8 }
};

/** Fractional units treated as interchangeable identities. */
const FRACTION_UNITS = new Set(["m3/m3", "euc", "fraction", "", "1"]);

function unitKey(u?: string): string {
    return (u ?? "").trim();
}

/** True when {@link convertUnitValue} can convert `from` → `to` losslessly. */
export function canConvertUnit(from?: string, to?: string): boolean {
    const f = unitKey(from);
    const t = unitKey(to);
    if (f === t) return true;
    if (FRACTION_UNITS.has(f.toLowerCase()) && FRACTION_UNITS.has(t.toLowerCase())) return true;
    return `${f}|${t}` in UNIT_CONVERSIONS;
}

/**
 * Convert a scalar between two units when a known linear relation exists.
 * Identity when the units are equal, both fractional, or unknown (so callers
 * can pass values through unchanged rather than corrupting them).
 */
export function convertUnitValue(value: number, from?: string, to?: string): number {
    const f = unitKey(from);
    const t = unitKey(to);
    if (f === t) return value;
    if (FRACTION_UNITS.has(f.toLowerCase()) && FRACTION_UNITS.has(t.toLowerCase())) return value;
    const c = UNIT_CONVERSIONS[`${f}|${t}`];
    return c ? value * c.factor + c.offset : value;
}
