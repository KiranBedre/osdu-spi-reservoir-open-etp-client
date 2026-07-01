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
 * Default: SLB catalog (30,201 mnemonics) auto-loaded at startup.
 * Additional vendor catalogs can be loaded via `loadVendorCatalog()` or
 * the REST endpoint `POST /pwls/catalog`.
 *
 * Source: https://community.opengroup.org/energistics/pwls-curve-catalog
 * License: Apache-2.0
 */

interface PwlsPropertyEntry {
  property: string;
  quantityClass: string;
  propertyTypeId?: string;
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
 * Resolve a curve mnemonic to its PWLS property name.
 * Requires a vendor catalog to be loaded via `loadVendorCatalog()`.
 *
 * @param mnemonic - Curve mnemonic (e.g., "NPHI", "GR", "DT")
 * @returns PWLS property name or undefined if not found
 */
export function getPropertyFromMnemonic(
  mnemonic: string
): string | undefined {
  // Exact match first
  return mnemonicMap.get(mnemonic) ?? mnemonicMapUpper.get(mnemonic.toUpperCase());
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

// --- Auto-load default vendor catalog (SLB, 30,201 mnemonics) ---
loadVendorCatalog(PwlsVendorSLB as PwlsVendorCatalog);
