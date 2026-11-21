import PwlsPropertiesData from "./PwlsProperties.json";
import PwlsVendorSLB from "./PwlsVendorCatalogSLB.json";
import { getPropertyTypeIDFromResqmlAlias } from "./PropertyTypes";

/**
 * PWLS v4.0 Curve Catalog integration for RDDMS.
 *
 * Provides lookup of PWLS standard properties and their QuantityClass,
 * plus resolution of curve mnemonics to PWLS properties when a vendor
 * catalog is loaded.
 *
 * Default: Schlumberger catalog (30,201 mnemonics) auto-loaded at startup.
 * Additional vendor catalogs can be loaded via `loadVendorCatalog()` or
 * the REST endpoint `POST /pwls/catalog`.
 *
 * Hierarchy note: PWLS v4 replaces the legacy PWLS v2 two-tier
 * `LogCurveMainFamily -> LogCurveFamily` taxonomy with a single recursive
 * `PropertyKind` tree (surfaced in OSDU as `PropertyType.ParentPropertyTypeID`).
 * The vendor-neutral ancestry is therefore walked via `parent` /
 * `getPropertyHierarchy()` here - not via the deprecated family record types.
 * Parent lineage is regenerated from the official EML2.3 dictionary by
 * `devops/scripts/generate_pwls_properties.py`.
 *
 * Source: https://community.opengroup.org/energistics/pwls-curve-catalog
 * License: Apache-2.0
 */

interface PwlsPropertyEntry {
  property: string;
  quantityClass: string;
  propertyTypeId?: string;
  /** Parent PWLS property name (from the EML2.3 PropertyKind Parent tree). */
  parent?: string;
  /** Parent OSDU PropertyType UUID. */
  parentPropertyTypeId?: string;
}

interface PwlsPropertiesJson {
  schemaVersion: string;
  source: string;
  license: string;
  lastUpdated: string;
  properties: PwlsPropertyEntry[];
}

interface PwlsVendorCatalog {
  schemaVersion: string;
  "Company Code": number;
  "Company Name": string;
  data: {
    "Curve Mnemonic": string;
    Property: string;
    "Curve Unit Quantity Class": string;
    "LIS Curve Mnemonic": string | null;
    "Curve Description"?: string;
  }[];
}

// --- Static property lookup (bundled, 875 PWLS v4 properties) ---

const propertiesJson = PwlsPropertiesData as PwlsPropertiesJson;

/** Map: lowercase property name → entry */
const propertyMap = new Map<string, PwlsPropertyEntry>();
for (const entry of propertiesJson.properties) {
  propertyMap.set(entry.property.toLowerCase(), entry);
}

/** Set of all known PWLS property names (lowercase) */
export const PwlsPropertyNames = new Set(propertyMap.keys());

/**
 * Get the EML QuantityClass for a PWLS property name.
 * @param property - PWLS property name (case-insensitive)
 */
export function getQuantityClassForProperty(
  property: string
): string | undefined {
  return propertyMap.get(property.toLowerCase())?.quantityClass;
}

/**
 * Get the OSDU PropertyType UUID for a PWLS property name.
 * Falls back to the existing PropertyTypesManifest bridge.
 * @param property - PWLS property name (case-insensitive)
 */
export function getPropertyTypeIdForProperty(
  property: string
): string | undefined {
  const entry = propertyMap.get(property.toLowerCase());
  if (entry?.propertyTypeId) {
    return entry.propertyTypeId;
  }
  // Fallback: try via existing RESQML alias manifest
  return getPropertyTypeIDFromResqmlAlias(property) || undefined;
}

/**
 * Check if a string is a known PWLS v4 property name.
 */
export function isKnownPwlsProperty(property: string): boolean {
  return propertyMap.has(property.toLowerCase());
}

/** A single node in a PWLS property ancestry chain. */
export interface PwlsHierarchyNode {
  property: string;
  propertyTypeId?: string;
  quantityClass: string;
}

/**
 * Get the immediate parent PWLS property name for a property.
 *
 * PWLS v4 replaces the legacy v2 "Main Family / Family" two-tier taxonomy with
 * a single recursive PropertyKind tree. Walk this repeatedly (or use
 * {@link getPropertyHierarchy}) to obtain the full vendor-neutral ancestry.
 *
 * @param property - PWLS property name (case-insensitive)
 * @returns Parent property name, or undefined for top-level properties.
 */
export function getParentProperty(property: string): string | undefined {
  return propertyMap.get(property.toLowerCase())?.parent;
}

/**
 * Get the OSDU PropertyType UUID of the immediate parent property.
 *
 * @param property - PWLS property name (case-insensitive)
 */
export function getParentPropertyTypeId(property: string): string | undefined {
  return propertyMap.get(property.toLowerCase())?.parentPropertyTypeId;
}

/**
 * Resolve the full vendor-neutral ancestry for a PWLS property, from the
 * property itself up towards the root (e.g. `bulk density` -> `density`).
 *
 * The abstract root `property` is not included. Depth is variable (PWLS v4 is a
 * recursive tree, not a fixed 3-tier `MainFamily -> Family -> Type` model).
 *
 * @param property - PWLS property name (case-insensitive)
 * @returns Ancestry chain (self first), or empty array if unknown.
 */
export function getPropertyHierarchy(property: string): PwlsHierarchyNode[] {
  const chain: PwlsHierarchyNode[] = [];
  const seen = new Set<string>();
  let name: string | undefined = property.toLowerCase();
  while (name && !seen.has(name)) {
    const entry = propertyMap.get(name);
    if (!entry) break;
    seen.add(name);
    chain.push({
      property: entry.property,
      propertyTypeId: entry.propertyTypeId,
      quantityClass: entry.quantityClass
    });
    name = entry.parent?.toLowerCase();
  }
  return chain;
}

// --- Vendor mnemonic catalog ---

/** Map: mnemonic (case-sensitive) → PWLS property name */
const mnemonicMap = new Map<string, string>();

/** Map: mnemonic (uppercase) → PWLS property name (for case-insensitive fallback) */
const mnemonicMapUpper = new Map<string, string>();

/** Loaded vendor names for introspection */
const loadedVendors: string[] = [];

/**
 * Load a PWLS v4 vendor curve catalog JSON.
 * Can be called multiple times for different vendors; entries accumulate.
 * First-loaded entry wins if mnemonic collides across vendors.
 *
 * @param catalog - Parsed vendor curve_mappings.json content
 * @returns Number of new mnemonics added
 */
export function loadVendorCatalog(catalog: PwlsVendorCatalog): number {
  let added = 0;
  for (const entry of catalog.data) {
    const m = entry["Curve Mnemonic"];
    if (!mnemonicMap.has(m)) {
      mnemonicMap.set(m, entry.Property);
      mnemonicMapUpper.set(m.toUpperCase(), entry.Property);
      added++;
    }
  }
  if (!loadedVendors.includes(catalog["Company Name"])) {
    loadedVendors.push(catalog["Company Name"]);
  }
  return added;
}

/**
 * Curated intuitive-alias → canonical PWLS property map.
 *
 * Covers common, unambiguous curve spellings that are NOT present in the vendor
 * mnemonic catalog but map 1:1 to a standard PWLS v4 property. Each target was
 * verified to resolve via `/pwls/resolve` (e.g. `INCL`→hole deviation,
 * `x coordinate`→x coordinate). Keep this list conservative: only add aliases
 * with a single obvious canonical meaning.
 */
const intuitiveAliasMap = new Map<string, string>([
  ["INC", "hole deviation"],       // inclination; canonical mnemonics INCL/DEVI/GDEV
  ["INCLINATION", "hole deviation"],
  ["INCL", "hole deviation"],
  ["DEVI", "hole deviation"],      // common directional-survey spelling
  ["AZM", "hole azimuth"],         // canonical mnemonic HAZI
  ["AZI", "hole azimuth"],
  ["AZIMUTH", "hole azimuth"],
  ["HAZI", "hole azimuth"],
  ["EAST", "x coordinate"],        // projected easting → PWLS "x coordinate"
  ["EASTING", "x coordinate"],
  ["NORTH", "y coordinate"],       // projected northing → PWLS "y coordinate"
  ["NORTHING", "y coordinate"],
  ["TVD", "true vertical depth"],  // true vertical depth
  ["TVDSS", "true vertical depth"],
  ["CAL", "caliper"],              // caliper
  ["CALI", "caliper"],
  ["T2_DIST", "transverse relaxation time"], // NMR T2 distribution bins
  ["T2DIST", "transverse relaxation time"],
  ["DOD", "radius"],               // depth-of-detection envelope → length "radius"
  ["PORO", "porosity"],            // modelled/geocellular porosity grid (not in vendor catalog)
  ["KLOGH", "horizontal permeability"], // horizontal-permeability log/model (Petrel/Eclipse KLOGH)
  ["NTG", "net gross thickness ratio"], // net-to-gross ratio
  ["SW_ECL", "water saturation"]   // Eclipse water-saturation grid
]);

/** How a mnemonic was matched to its canonical PWLS property. */
export type MnemonicMatchVia = "vendor" | "vendor-ci" | "alias" | "property" | "none";

/** Resolution provenance for a single mnemonic. */
export interface MnemonicMatch {
  /** Canonical PWLS property name, if resolved. */
  property?: string;
  /** Which lookup tier produced the match. */
  matchedVia: MnemonicMatchVia;
  /** The alias key that matched (only when matchedVia === "alias"). */
  alias?: string;
}

/**
 * Resolve a curve mnemonic AND report which lookup tier matched, so callers can
 * surface the chosen alias for auditability (PWLS §6.4 improvement).
 *
 * Tiers, in order: exact vendor catalog → case-insensitive vendor → curated
 * intuitive-alias map → the mnemonic already being a PWLS property name.
 */
export function getMnemonicMatch(mnemonic: string): MnemonicMatch {
  const exact = mnemonicMap.get(mnemonic);
  if (exact) return { property: exact, matchedVia: "vendor" };

  const upper = mnemonic.toUpperCase();
  const ci = mnemonicMapUpper.get(upper);
  if (ci) return { property: ci, matchedVia: "vendor-ci" };

  const alias = intuitiveAliasMap.get(upper);
  if (alias) return { property: alias, matchedVia: "alias", alias: upper };

  if (isKnownPwlsProperty(mnemonic)) {
    return { property: mnemonic.toLowerCase(), matchedVia: "property" };
  }
  return { matchedVia: "none" };
}


/**
 * Resolve a curve mnemonic to its PWLS property name.
 * Requires a vendor catalog to be loaded via `loadVendorCatalog()`.
 *
 * @param mnemonic - Curve mnemonic (e.g., "NPHI", "GR", "DT")
 * @returns PWLS property name or undefined if not found
 */
export function getPropertyFromMnemonic(
  mnemonic: string
): string | undefined {
  // Exact vendor-catalog match first, then the curated intuitive-alias fallback.
  return (
    mnemonicMap.get(mnemonic) ??
    mnemonicMapUpper.get(mnemonic.toUpperCase()) ??
    intuitiveAliasMap.get(mnemonic.toUpperCase())
  );
}

/**
 * Resolve a curve mnemonic to the OSDU PropertyType UUID.
 * Combines mnemonic→property→UUID lookup in one call.
 *
 * @param mnemonic - Curve mnemonic (e.g., "NPHI", "GR", "DT")
 * @returns OSDU PropertyType UUID or undefined
 */
export function getPropertyTypeIdFromMnemonic(
  mnemonic: string
): string | undefined {
  const property = getPropertyFromMnemonic(mnemonic);
  if (!property) return undefined;
  return getPropertyTypeIdForProperty(property);
}

/**
 * Resolve a curve mnemonic to the EML QuantityClass.
 *
 * @param mnemonic - Curve mnemonic (e.g., "NPHI", "GR", "DT")
 * @returns EML QuantityClass string or undefined
 */
export function getQuantityClassFromMnemonic(
  mnemonic: string
): string | undefined {
  const property = getPropertyFromMnemonic(mnemonic);
  if (!property) return undefined;
  return getQuantityClassForProperty(property);
}

/**
 * Get the number of loaded vendor mnemonics.
 */
export function getLoadedMnemonicCount(): number {
  return mnemonicMap.size;
}

/**
 * Get all loaded mnemonic → PWLS property mappings.
 * Read-only snapshot for exports (e.g. the SKOS concept scheme).
 */
export function getMnemonicEntries(): Array<[string, string]> {
  return [...mnemonicMap.entries()];
}

/**
 * Get all known PWLS property names with their EML QuantityClass.
 * Read-only snapshot for exports.
 */
export function getPropertyEntries(): Array<{
  property: string;
  quantityClass: string;
}> {
  return [...propertyMap.values()].map(e => ({
    property: e.property,
    quantityClass: e.quantityClass
  }));
}

/**
 * Check if any vendor catalog has been loaded.
 */
export function hasVendorCatalog(): boolean {
  return mnemonicMap.size > 0;
}

/**
 * Get list of loaded vendor names.
 */
export function getLoadedVendors(): string[] {
  return [...loadedVendors];
}

/**
 * Get PWLS catalog status summary (for health/status endpoints).
 */
export function getPwlsStatus(): {
  properties: number;
  mnemonics: number;
  vendors: string[];
} {
  return {
    properties: propertyMap.size,
    mnemonics: mnemonicMap.size,
    vendors: [...loadedVendors]
  };
}

// --- Auto-load default vendor catalog (Schlumberger, 30,201 mnemonics) ---
loadVendorCatalog(PwlsVendorSLB as PwlsVendorCatalog);
