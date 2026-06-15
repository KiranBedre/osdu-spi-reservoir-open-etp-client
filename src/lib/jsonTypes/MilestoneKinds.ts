/**
 * Milestone-specific OSDU kind versions.
 *
 * OSDU milestones (e.g. M27) bump schema versions independently of the
 * generated TypeScript types in ./Generated/. This mapping lets converters
 * emit the correct kind string even when the TS type tracks an older version.
 */

const M27_KINDS: Record<string, string> = {
  SeismicHorizon: "osdu:wks:work-product-component--SeismicHorizon:2.1.0",
};

const FALLBACK_KINDS: Record<string, string> = {
  SeismicHorizon: "osdu:wks:work-product-component--SeismicHorizon:2.0.0",
};

/**
 * Return the milestone-selected kind for a given WPC type, or the base
 * version if no milestone override is registered.
 */
export function getKindOrFallback(typeName: string): string {
  return M27_KINDS[typeName] ?? FALLBACK_KINDS[typeName] ?? `osdu:wks:work-product-component--${typeName}:1.0.0`;
}
