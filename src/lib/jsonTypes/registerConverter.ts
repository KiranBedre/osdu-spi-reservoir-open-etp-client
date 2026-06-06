/**
 * R4: Modular Converter Registry
 *
 * Provides a clean, documented API for registering RESQML/WITSML/PRODML → OSDU converters.
 * Each converter module can self-register by importing and calling `registerConverter()`.
 *
 * ## Community Contribution Guide
 *
 * To add a new converter:
 * 1. Create a new .ts file in src/lib/jsonTypes/ (e.g., `MyNewType22.ts`)
 * 2. Implement the converter function matching the `ConverterFn` signature
 * 3. Call `registerConverter()` at the bottom of your file OR
 *    export a manifest function and add `ResqmlOSDU.add()` in `ResqmlOsdu.ts`
 * 4. Add unit tests in `src/__tests__/TestManifest.ts`
 *
 * ## Self-Registration Pattern (preferred for new converters)
 *
 * ```typescript
 * import { registerConverter } from "./registerConverter";
 *
 * const MyTypeManifest: ConverterFn = async (uri, xml, context, client) => {
 *   // ... build OSDU record ...
 *   return record;
 * };
 *
 * registerConverter(
 *   "resqml22.MyNewType",
 *   () => "osdu:wks:work-product-component--MyNewType:1.2.0",
 *   MyTypeManifest
 * );
 * ```
 *
 * @module registerConverter
 */

import { ResqmlOSDUMap } from "./OsduContext";
import type { IResqmlDataObject, ResqmlClient } from "../client/ResqmlClient";
import type { OSDUContext, OSDUResourceType } from "./OsduContext";

/**
 * Converter function signature.
 * Takes an ETP URI, parsed XML object, OSDU context, and ETP client.
 * Returns an OSDU record (any kind) or undefined to skip.
 */
export type ConverterFn = (
  uri: string,
  xml: any,
  context: OSDUContext,
  client: ResqmlClient
) => Promise<OSDUResourceType | undefined>;

/**
 * OSDU kind resolver function.
 * Given a parsed data object, returns the target OSDU kind string.
 * Can be a simple lambda for static kinds, or inspect the object for dynamic routing.
 */
export type KindResolver = (obj: IResqmlDataObject) => string;

/**
 * Registration descriptor for batch registration.
 */
export interface ConverterRegistration {
  /** ETP qualified data object type (e.g., "resqml22.FaultInterpretation") */
  sourceType: string;
  /** Function that resolves the target OSDU kind string */
  osduKind: KindResolver;
  /** Async converter function */
  convert: ConverterFn;
}

/**
 * Register a single converter with the global ResqmlOSDU registry.
 * Safe to call multiple times — last registration wins for a given sourceType.
 *
 * @param etpType ETP qualified data object type (e.g., "resqml22.BoundaryFeature")
 * @param osduKind Function returning target OSDU kind string
 * @param convert Async function that converts ETP object to OSDU record
 */
export function registerConverter(
  etpType: string,
  osduKind: KindResolver,
  convert: ConverterFn
): void {
  ResqmlOSDUMap.getInstance().add(etpType, osduKind, convert);
}

/**
 * Register multiple converters at once (batch registration).
 * Useful for registering both v2.0 and v2.2 variants of the same logical type.
 *
 * @example
 * ```typescript
 * registerConverters([
 *   { sourceType: "resqml20.obj_FaultInterpretation", osduKind: kind, convert: v20Manifest },
 *   { sourceType: "resqml22.FaultInterpretation", osduKind: kind, convert: v22Manifest }
 * ]);
 * ```
 */
export function registerConverters(registrations: ConverterRegistration[]): void {
  for (const reg of registrations) {
    registerConverter(reg.sourceType, reg.osduKind, reg.convert);
  }
}

/**
 * Check if a converter is already registered for a given source type.
 * Useful to avoid duplicate registrations in tests or dynamic loading.
 */
export function hasConverter(sourceType: string): boolean {
  return ResqmlOSDUMap.getInstance().get(sourceType) !== undefined;
}

/**
 * Get all registered source types.
 * Useful for diagnostics, validation, and health endpoints.
 */
export function getRegisteredTypes(): string[] {
  return Array.from(ResqmlOSDUMap.getInstance().getAll().keys());
}

/**
 * Get the OSDU kind that a source type maps to (for diagnostics).
 * Returns undefined if the type is not registered.
 */
export function getTargetKind(sourceType: string, obj?: any): string | undefined {
  const entry = ResqmlOSDUMap.getInstance().get(sourceType);
  if (!entry) return undefined;
  return entry.osduKind(obj ?? {});
}

