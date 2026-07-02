/**
 * OSDU Schema Version Resolution.
 *
 * At startup, queries the OSDU Schema Service to discover the latest registered
 * schema version for each entity type. Falls back to a static M27 lookup table
 * when the Schema Service is unavailable (standalone/local mode).
 *
 * Usage:
 *   import { getKind, initSchemaVersions } from "./MilestoneKinds";
 *   await initSchemaVersions();                 // call once at startup
 *   const kind = getKind("WellLog");            // → "osdu:wks:work-product-component--WellLog:1.3.0"
 *   const kind = getKind("StructureMap");       // → undefined if not registered
 *
 * Env vars:
 *   OSDU_MILESTONE — static fallback milestone ("M26" or "M27", default "M27")
 *   RDMS_OSDU_URL  — base URL for Schema Service query (optional)
 */

import logging from "../common/Logging";
const logger = logging.getLogger({ name: "MilestoneKinds", level: "info" });

export type OsduMilestone = "M26" | "M27";

/** Runtime-resolved kinds from Schema Service (populated by initSchemaVersions). */
let resolvedKinds: Map<string, string> | undefined;

/**
 * Read configured milestone from environment. Defaults to M27.
 * Used only as fallback when Schema Service is unavailable.
 */
export function getMilestone(): OsduMilestone {
  const raw = (process.env.OSDU_MILESTONE || "M27").toUpperCase();
  if (raw === "M26") return "M26";
  return "M27";
}

/**
 * Query the OSDU Schema Service to discover the latest version of each
 * work-product-component, master-data, and dataset schema.
 *
 * Call once at server startup. If the service is unreachable, logs a warning
 * and falls back to the static table for OSDU_MILESTONE (default M27).
 */
export async function initSchemaVersions(
  osduBaseUrl?: string,
  token?: string,
  dataPartitionId?: string
): Promise<void> {
  const baseUrl = osduBaseUrl || process.env.RDMS_OSDU_URL;
  if (!baseUrl) {
    logger.info("No OSDU_URL configured — using static fallback (OSDU_MILESTONE=" + getMilestone() + ")");
    return;
  }

  const schemaUrl = `${baseUrl.replace(/\/$/, "")}/api/schema-service/v1/schema`;
  const headers: Record<string, string> = {
    "Accept": "application/json"
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (dataPartitionId) headers["data-partition-id"] = dataPartitionId;

  try {
    const kinds = new Map<string, string>();

    // Query each authority+source combination we care about
    for (const entityPrefix of ["work-product-component", "master-data", "dataset"]) {
      const url = `${schemaUrl}?authority=osdu&source=wks&entityType=${entityPrefix}--*&status=PUBLISHED&limit=1000`;
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        logger.warn(`Schema Service returned ${resp.status} for ${entityPrefix} — skipping`);
        continue;
      }
      const body = await resp.json() as { schemaInfos?: Array<{ schemaIdentity: { id: string } }> };
      const infos = body.schemaInfos ?? [];

      // For each entity type, keep the highest version
      for (const info of infos) {
        const id = info.schemaIdentity?.id;
        if (!id) continue;
        // id format: "osdu:wks:work-product-component--WellLog:1.3.0"
        const match = id.match(/^osdu:wks:[\w-]+--(\w+):/);
        if (!match) continue;
        const entityType = match[1];
        const existing = kinds.get(entityType);
        if (!existing || compareVersions(id, existing) > 0) {
          kinds.set(entityType, id);
        }
      }
    }

    if (kinds.size > 0) {
      resolvedKinds = kinds;
      logger.info(`Schema Service: resolved ${kinds.size} entity types from ${baseUrl}`);
    } else {
      logger.warn("Schema Service returned no schemas — using static fallback");
    }
  } catch (err: any) {
    logger.warn(`Schema Service unavailable (${err?.message ?? err}) — using static fallback (OSDU_MILESTONE=${getMilestone()})`);
  }
}

/** Compare two kind strings by their trailing semver. Returns >0 if a > b. */
function compareVersions(a: string, b: string): number {
  const va = a.match(/:(\d+)\.(\d+)\.(\d+)$/);
  const vb = b.match(/:(\d+)\.(\d+)\.(\d+)$/);
  if (!va || !vb) return 0;
  for (let i = 1; i <= 3; i++) {
    const diff = parseInt(va[i]) - parseInt(vb[i]);
    if (diff !== 0) return diff;
  }
  return 0;
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
 * Get the full OSDU kind string for a given entity type.
 *
 * If Schema Service was queried at startup (initSchemaVersions), returns the
 * dynamically resolved kind. Otherwise falls back to the static table for
 * the configured OSDU_MILESTONE.
 *
 * @param entityType — Short entity name, e.g. "WellLog", "Well", "StructureMap"
 * @returns The full kind string, or undefined if the schema doesn't exist.
 */
export function getKind(entityType: string): string | undefined {
  // Dynamic: use Schema Service result if available
  if (resolvedKinds) {
    return resolvedKinds.get(entityType);
  }
  // Static fallback: use milestone table
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
 * Get all kind strings (for schema registration).
 * Uses Schema Service results if available, otherwise static table.
 */
export function getAllKinds(): string[] {
  if (resolvedKinds) {
    return Array.from(resolvedKinds.values());
  }
  const milestone = getMilestone();
  const kinds: string[] = [];
  for (const entry of KIND_VERSIONS.values()) {
    const kind = entry[milestone];
    if (kind) kinds.push(kind);
  }
  return kinds;
}
