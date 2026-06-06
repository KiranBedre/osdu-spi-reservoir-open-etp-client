/**
 * OSDU Schema Version Mapping per Milestone.
 *
 * Each OSDU milestone (M26, M27/Venus, ...) ships a specific set of
 * pre-registered schema versions. This module provides the correct kind
 * string for the configured target milestone via `getKind(entityType)`.
 *
 * Usage:
 *   import { getKind, getMilestone } from "./MilestoneKinds";
 *   const kind = getKind("WellLog");            // → "osdu:wks:work-product-component--WellLog:1.2.0" (M26)
 *   const kind = getKind("WellLog");            // → "osdu:wks:work-product-component--WellLog:1.3.0" (M27)
 *   const kind = getKind("StructureMap");       // → undefined on M26 (schema doesn't exist)
 *
 * The milestone is selected via env var RDMS_OSDU_MILESTONE (default: "M27").
 */

export type OsduMilestone = "M26" | "M27";

/**
 * Read configured milestone from environment. Defaults to M27.
 */
export function getMilestone(): OsduMilestone {
  const raw = (process.env.RDMS_OSDU_MILESTONE || "M27").toUpperCase();
  if (raw === "M26") return "M26";
  return "M27";
}

// ─── Kind version table ──────────────────────────────────────────────────────
// Format: [M26 version | undefined (not available), M27 version]
// undefined means the schema does not exist in that milestone.

type VersionPair = { M26: string | undefined; M27: string };

const PREFIX_WPC = "osdu:wks:work-product-component--";
const PREFIX_MD = "osdu:wks:master-data--";
const PREFIX_REF = "osdu:wks:reference-data--";
const PREFIX_DS = "osdu:wks:dataset--";

function wpc(entity: string, versions: { M26?: string; M27: string }): [string, VersionPair] {
  return [
    entity,
    {
      M26: versions.M26 ? `${PREFIX_WPC}${entity}:${versions.M26}` : undefined,
      M27: `${PREFIX_WPC}${entity}:${versions.M27}`,
    },
  ];
}

function md(entity: string, versions: { M26?: string; M27: string }): [string, VersionPair] {
  return [
    entity,
    {
      M26: versions.M26 ? `${PREFIX_MD}${entity}:${versions.M26}` : undefined,
      M27: `${PREFIX_MD}${entity}:${versions.M27}`,
    },
  ];
}

function ref(entity: string, versions: { M26?: string; M27: string }): [string, VersionPair] {
  return [
    entity,
    {
      M26: versions.M26 ? `${PREFIX_REF}${entity}:${versions.M26}` : undefined,
      M27: `${PREFIX_REF}${entity}:${versions.M27}`,
    },
  ];
}

function ds(entity: string, versions: { M26?: string; M27: string }): [string, VersionPair] {
  return [
    entity,
    {
      M26: versions.M26 ? `${PREFIX_DS}${entity}:${versions.M26}` : undefined,
      M27: `${PREFIX_DS}${entity}:${versions.M27}`,
    },
  ];
}

/**
 * Version mapping: M26 (Mercury) → M27 (Venus).
 *
 * Where M26 is undefined, the schema did not exist in that milestone and will
 * fall back to GenericRepresentation.
 */
const KIND_VERSIONS = new Map<string, VersionPair>([
  // ─── Master Data ───────────────────────────────────────────────────────────
  md("Well", { M26: "1.2.0", M27: "1.3.0" }),
  md("Wellbore", { M26: "1.2.0", M27: "1.3.0" }),
  md("ActivityTemplate", { M26: "1.0.0", M27: "1.1.0" }),
  md("SeismicAcquisitionSurvey", { M26: "1.3.0", M27: "1.4.0" }),
  md("BoundaryFeature", { M26: "1.1.0", M27: "1.2.0" }),
  md("CollaborationProject", { M27: "1.0.0" }),

  // ─── Work Product Components — Wells ───────────────────────────────────────
  wpc("WellLog", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("WellboreTrajectory", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("WellboreInterpretation", { M26: "1.1.0", M27: "1.2.0" }),

  // ─── Work Product Components — Interpretations ─────────────────────────────
  wpc("EarthModelInterpretation", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("FaultInterpretation", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("HorizonInterpretation", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("GeobodyBoundaryInterpretation", { M26: "1.0.0", M27: "1.1.0" }),
  wpc("GeobodyInterpretation", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("StratigraphicColumn", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("StratigraphicColumnRankInterpretation", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("StratigraphicUnitInterpretation", { M26: "1.2.0", M27: "1.3.0" }),

  // ─── Work Product Components — M27-only (Venus new schemas) ────────────────
  wpc("StructuralOrganizationInterpretation", { M27: "1.2.0" }),
  wpc("RockFluidOrganizationInterpretation", { M27: "1.2.0" }),
  wpc("RockFluidUnitInterpretation", { M27: "1.3.0" }),
  wpc("FluidBoundaryInterpretation", { M27: "1.2.0" }),
  wpc("SealedSurfaceFramework", { M27: "1.2.0" }),
  wpc("SealedVolumeFramework", { M27: "1.2.0" }),
  wpc("StructureMap", { M27: "1.0.0" }),
  wpc("SeismicLineGeometry", { M27: "1.2.0" }),
  wpc("GridConnectionSetRepresentation", { M27: "1.2.0" }),
  wpc("WellboreMarkerSet", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("GeologicUnitOccurrenceInterpretation", { M27: "1.2.0" }),
  wpc("UnsealedSurfaceFramework", { M26: "1.2.0", M27: "1.3.1" }),

  // ─── Work Product Components — Representations / Properties ────────────────
  wpc("GenericRepresentation", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("GenericProperty", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("IjkGridRepresentation", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("UnstructuredGridRepresentation", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("SubRepresentation", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("LocalModelCompoundCrs", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("LocalBoundaryFeature", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("LocalModelFeature", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("LocalRockVolumeFeature", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("PersistedCollection", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("TimeSeries", { M26: "1.1.0", M27: "1.2.0" }),
  wpc("ColumnBasedTable", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("Activity", { M26: "1.2.0", M27: "1.4.0" }),

  // ─── Work Product Components — Seismic ─────────────────────────────────────
  wpc("SeismicBinGrid", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("SeismicHorizon", { M26: "2.0.0", M27: "2.1.0" }),
  wpc("SeismicFault", { M26: "1.1.0", M27: "2.0.0" }),

  // ─── Work Product Components — WITSML specific ─────────────────────────────
  wpc("Rig", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("FluidsReport", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("Tubular", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("BHARunReport", { M26: "1.2.0", M27: "1.3.0" }),
  wpc("WellboreCompletion", { M26: "1.2.0", M27: "1.3.0" }),

  // ─── Reference Data ────────────────────────────────────────────────────────
  ref("PropertyType", { M26: "1.0.0", M27: "1.0.0" }),

  // ─── Datasets ──────────────────────────────────────────────────────────────
  ds("ETPDataspace", { M26: "1.0.1", M27: "1.0.1" }),
]);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the full OSDU kind string for a given entity type at the configured milestone.
 *
 * @param entityType — Short entity name, e.g. "WellLog", "Well", "StructureMap"
 * @returns The full kind string, or undefined if the schema doesn't exist at
 *          the configured milestone.
 */
export function getKind(entityType: string): string | undefined {
  const entry = KIND_VERSIONS.get(entityType);
  if (!entry) return undefined;
  return entry[getMilestone()];
}

/**
 * Get the full OSDU kind string, falling back to GenericRepresentation if
 * the requested type doesn't exist at the configured milestone.
 */
export function getKindOrFallback(entityType: string): string {
  const kind = getKind(entityType);
  if (kind) return kind;
  // Fall back to GenericRepresentation at whatever version the milestone supports
  return getKind("GenericRepresentation") as string;
}

/**
 * Returns true if the given entity type is available at the configured milestone.
 */
export function isKindAvailable(entityType: string): boolean {
  return getKind(entityType) !== undefined;
}

/**
 * Get all kind strings for the current milestone (for schema registration).
 */
export function getAllKinds(): string[] {
  const milestone = getMilestone();
  const kinds: string[] = [];
  for (const entry of KIND_VERSIONS.values()) {
    const kind = entry[milestone];
    if (kind) kinds.push(kind);
  }
  return kinds;
}
