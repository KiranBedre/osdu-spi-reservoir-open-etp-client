/**
 * OSDU Schema Kind Resolution.
 *
 * At startup, queries the OSDU Schema Service to discover the latest registered
 * schema version for each entity type (forward-compatible with M28, M29, ...).
 * Falls back to a static table (aligned with data-definitions master) when the Schema Service
 * is unavailable (standalone/local mode).
 *
 * Usage:
 *   import { getKind, initSchemaVersions } from "./MilestoneKinds";
 *   await initSchemaVersions();       // call once at startup
 *   const kind = getKind("WellLog");  // → "osdu:wks:work-product-component--WellLog:1.3.0" (from Schema Service)
 *                                     // → "osdu:wks:work-product-component--WellLog:1.3.0" (static fallback)
 *
 * Env vars:
 *   RDMS_OSDU_URL - base URL for Schema Service query (optional)
 */

import logging from "../common/Logging";
const logger = logging.getLogger({ name: "MilestoneKinds", level: "info" });

/** Runtime-resolved kinds from Schema Service (populated by initSchemaVersions). */
let resolvedKinds: Map<string, string> | undefined;

/** De-dupes concurrent lazy initialisation attempts (ensureSchemaVersions). */
let schemaInitPromise: Promise<void> | undefined;

/** Per-kind "is this schema registered on the target instance?" cache. */
const schemaExistsCache = new Map<string, boolean>();

/**
 * Query the OSDU Schema Service to discover the latest version of each
 * work-product-component, master-data, and dataset schema.
 *
 * Call once at server startup. If the service is unreachable, logs a warning
 * and falls back to the static table.
 */
export async function initSchemaVersions(
  osduBaseUrl?: string,
  token?: string,
  dataPartitionId?: string
): Promise<void> {
  const baseUrl = osduBaseUrl || process.env.RDMS_OSDU_URL;
  if (!baseUrl) {
    logger.info("No RDMS_OSDU_URL configured - using static fallback");
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

    for (const entityPrefix of ["work-product-component", "master-data", "dataset", "reference-data"]) {
      const url = `${schemaUrl}?authority=osdu&source=wks&entityType=${entityPrefix}--*&status=PUBLISHED&limit=1000`;
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) {
        logger.warn(`Schema Service returned ${resp.status} for ${entityPrefix} - skipping`);
        continue;
      }
      const body = await resp.json() as { schemaInfos?: Array<{ schemaIdentity: { id: string } }> };
      const infos = body.schemaInfos ?? [];

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
      logger.warn("Schema Service returned no schemas - using static fallback");
    }
  } catch (err: any) {
    logger.warn(`Schema Service unavailable (${err?.message ?? err}) - using static fallback`);
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

// ─── Static fallback table (aligned with data-definitions master) ────────────

const PREFIX_WPC = "osdu:wks:work-product-component--";
const PREFIX_MD = "osdu:wks:master-data--";
const PREFIX_REF = "osdu:wks:reference-data--";
const PREFIX_DS = "osdu:wks:dataset--";

const FALLBACK_KINDS = new Map<string, string>([
  // ─── Master Data ───────────────────────────────────────────────────────────
  ["Well", `${PREFIX_MD}Well:1.3.0`],
  ["Wellbore", `${PREFIX_MD}Wellbore:1.3.0`],
  ["ActivityTemplate", `${PREFIX_MD}ActivityTemplate:1.1.0`],
  ["SeismicAcquisitionSurvey", `${PREFIX_MD}SeismicAcquisitionSurvey:1.4.0`],
  ["BoundaryFeature", `${PREFIX_MD}BoundaryFeature:1.1.0`],
  ["Reservoir", `${PREFIX_MD}Reservoir:2.0.0`],
  ["ReservoirSegment", `${PREFIX_MD}ReservoirSegment:2.0.0`],

  // ─── Work Product Components - Wells ───────────────────────────────────────
  ["WellLog", `${PREFIX_WPC}WellLog:1.3.0`],
  ["WellboreTrajectory", `${PREFIX_WPC}WellboreTrajectory:1.3.0`],

  // ─── Work Product Components - Interpretations ─────────────────────────────
  ["EarthModelInterpretation", `${PREFIX_WPC}EarthModelInterpretation:1.2.0`],
  ["FaultInterpretation", `${PREFIX_WPC}FaultInterpretation:1.3.0`],
  ["HorizonInterpretation", `${PREFIX_WPC}HorizonInterpretation:1.2.0`],
  ["GeobodyBoundaryInterpretation", `${PREFIX_WPC}GeobodyBoundaryInterpretation:1.2.0`],
  ["GeobodyInterpretation", `${PREFIX_WPC}GeobodyInterpretation:1.3.0`],
  ["FluidBoundaryInterpretation", `${PREFIX_WPC}FluidBoundaryInterpretation:1.2.0`],
  ["RockFluidOrganizationInterpretation", `${PREFIX_WPC}RockFluidOrganizationInterpretation:1.2.0`],
  ["RockFluidUnitInterpretation", `${PREFIX_WPC}RockFluidUnitInterpretation:1.3.0`],
  ["StructuralOrganizationInterpretation", `${PREFIX_WPC}StructuralOrganizationInterpretation:1.2.0`],
  ["StratigraphicColumn", `${PREFIX_WPC}StratigraphicColumn:1.2.0`],
  ["StratigraphicColumnRankInterpretation", `${PREFIX_WPC}StratigraphicColumnRankInterpretation:1.3.0`],
  ["StratigraphicUnitInterpretation", `${PREFIX_WPC}StratigraphicUnitInterpretation:1.3.0`],
  ["WellboreMarkerSet", `${PREFIX_WPC}WellboreMarkerSet:1.2.0`],
  ["WellboreInterpretation", `${PREFIX_WPC}WellboreInterpretation:1.2.0`],
  ["UnsealedSurfaceFramework", `${PREFIX_WPC}UnsealedSurfaceFramework:1.2.0`],
  ["SealedSurfaceFramework", `${PREFIX_WPC}SealedSurfaceFramework:1.2.0`],
  ["ReservoirCompartmentInterpretation", `${PREFIX_WPC}ReservoirCompartmentInterpretation:1.2.0`],

  // ─── Work Product Components - Representations / Properties ────────────────
  ["GenericRepresentation", `${PREFIX_WPC}GenericRepresentation:1.2.0`],
  ["GenericProperty", `${PREFIX_WPC}GenericProperty:1.2.0`],
  ["IjkGridRepresentation", `${PREFIX_WPC}IjkGridRepresentation:1.2.0`],
  ["UnstructuredGridRepresentation", `${PREFIX_WPC}UnstructuredGridRepresentation:1.2.0`],
  ["GridConnectionSetRepresentation", `${PREFIX_WPC}GridConnectionSetRepresentation:1.2.0`],
  ["SubRepresentation", `${PREFIX_WPC}SubRepresentation:1.2.0`],
  ["StructureMap", `${PREFIX_WPC}StructureMap:1.0.0`],
  ["LocalModelCompoundCrs", `${PREFIX_WPC}LocalModelCompoundCrs:1.2.0`],
  ["LocalBoundaryFeature", `${PREFIX_WPC}LocalBoundaryFeature:1.2.0`],
  ["LocalModelFeature", `${PREFIX_WPC}LocalModelFeature:1.2.0`],
  ["LocalRockVolumeFeature", `${PREFIX_WPC}LocalRockVolumeFeature:1.2.0`],
  ["PersistedCollection", `${PREFIX_WPC}PersistedCollection:1.1.0`],
  ["TimeSeries", `${PREFIX_WPC}TimeSeries:1.2.0`],
  ["ColumnBasedTable", `${PREFIX_WPC}ColumnBasedTable:1.3.0`],
  ["Activity", `${PREFIX_WPC}Activity:1.4.0`],

  // ─── Work Product Components - Seismic ─────────────────────────────────────
  ["SeismicBinGrid", `${PREFIX_WPC}SeismicBinGrid:1.3.0`],
  ["SeismicHorizon", `${PREFIX_WPC}SeismicHorizon:2.0.0`],
  ["SeismicFault", `${PREFIX_WPC}SeismicFault:2.0.0`],
  ["SeismicLineGeometry", `${PREFIX_WPC}SeismicLineGeometry:1.2.0`],
  ["GenericBinGrid", `${PREFIX_WPC}GenericBinGrid:1.0.0`],
  ["HorizonControlPoints", `${PREFIX_WPC}HorizonControlPoints:1.0.0`],

  // ─── Master Data - WITSML ──────────────────────────────────────────────────
  ["Rig", `${PREFIX_MD}Rig:1.3.0`],
  ["FluidsReport", `${PREFIX_MD}FluidsReport:1.3.0`],
  ["BHARun", `${PREFIX_MD}BHARun:1.3.0`],

  // ─── Work Product Components - Reservoir Management / Simulation ───────────
  ["FluidModel", `${PREFIX_WPC}FluidModel:1.0.0`],
  ["SaturationFunctionSet", `${PREFIX_WPC}SaturationFunctionSet:1.0.0`],
  ["ReservoirModelScenario", `${PREFIX_WPC}ReservoirModelScenario:1.0.0`],
  ["ReservoirSimulationModel", `${PREFIX_WPC}ReservoirSimulationModel:1.0.0`],
  ["ReservoirSimulationEquilibriumModel", `${PREFIX_WPC}ReservoirSimulationEquilibriumModel:1.0.0`],
  ["ReservoirSimulationRockPhysicsModel", `${PREFIX_WPC}ReservoirSimulationRockPhysicsModel:1.0.0`],
  ["ReservoirSimulationRunConfiguration", `${PREFIX_WPC}ReservoirSimulationRunConfiguration:1.0.0`],
  ["ReservoirEstimatedVolumes", `${PREFIX_WPC}ReservoirEstimatedVolumes:1.1.1`],
  ["ProductionValues", `${PREFIX_WPC}ProductionValues:1.1.1`],
  ["GeoLabelSet", `${PREFIX_WPC}GeoLabelSet:1.1.0`],

  // ─── Reference Data ────────────────────────────────────────────────────────
  ["PropertyType", `${PREFIX_REF}PropertyType:1.0.0`],

  // ─── Datasets ──────────────────────────────────────────────────────────────
  ["ETPDataspace", `${PREFIX_DS}ETPDataspace:1.0.1`],
]);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the full OSDU kind string for a given entity type.
 *
 * Returns the Schema Service resolved version if available,
 * otherwise the static fallback.
 */
export function getKind(entityType: string): string | undefined {
  if (resolvedKinds) {
    return resolvedKinds.get(entityType);
  }
  return FALLBACK_KINDS.get(entityType);
}

/**
 * Get the full OSDU kind string, falling back to GenericRepresentation if
 * the requested type doesn't exist.
 */
export function getKindOrFallback(entityType: string): string {
  return getKind(entityType) ?? getKind("GenericRepresentation") as string;
}

/**
 * Returns true if the given entity type has a known kind.
 */
export function isKindAvailable(entityType: string): boolean {
  return getKind(entityType) !== undefined;
}

/**
 * Get all kind strings (for schema registration).
 */
export function getAllKinds(): string[] {
  if (resolvedKinds) {
    return Array.from(resolvedKinds.values());
  }
  return Array.from(FALLBACK_KINDS.values());
}

/**
 * Lazily resolve schema versions against the live Schema Service using a real
 * request token.
 *
 * `initSchemaVersions()` runs once at startup, but on a secured OSDU instance it
 * has no bearer token / data-partition-id and the Schema Service call is rejected,
 * so we silently keep the static fallback. This helper re-attempts resolution the
 * first time an authenticated request flows through, and caches the result. If the
 * attempt fails (or nothing resolves) it stays on the static fallback and allows a
 * later request to retry.
 */
export async function ensureSchemaVersions(
  osduBaseUrl?: string,
  token?: string,
  dataPartitionId?: string
): Promise<void> {
  if (resolvedKinds) return;
  if (!schemaInitPromise) {
    schemaInitPromise = initSchemaVersions(osduBaseUrl, token, dataPartitionId)
      .catch(err => {
        logger.warn(`ensureSchemaVersions failed (${err?.message ?? err}) - keeping static fallback`);
      })
      .finally(() => {
        // Allow a later authenticated request to retry if nothing resolved.
        if (!resolvedKinds) schemaInitPromise = undefined;
      });
  }
  return schemaInitPromise;
}

/**
 * Returns true if the exact kind (authority:source:entityType:version) is
 * registered on the target OSDU Schema Service. Results are cached per kind.
 *
 * When no OSDU base URL is configured (standalone/local mode) this returns true
 * so ingest is never blocked. On a transient lookup error it also returns true
 * and defers to the resilient per-record ingest path.
 */
export async function isSchemaRegistered(
  kind: string,
  osduBaseUrl?: string,
  token?: string,
  dataPartitionId?: string
): Promise<boolean> {
  const baseUrl = osduBaseUrl || process.env.RDMS_OSDU_URL;
  if (!baseUrl || baseUrl === "http://localhost") return true;
  const cached = schemaExistsCache.get(kind);
  if (cached !== undefined) return cached;

  const url = `${baseUrl.replace(/\/$/, "")}/api/schema-service/v1/schema/${kind}`;
  const headers: Record<string, string> = { "Accept": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (dataPartitionId) headers["data-partition-id"] = dataPartitionId;

  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    const ok = resp.status === 200;
    schemaExistsCache.set(kind, ok);
    return ok;
  } catch (err: any) {
    logger.warn(`Schema existence check failed for '${kind}' (${err?.message ?? err}) - assuming present`);
    return true;
  }
}

/** Record that a kind is (now) registered, e.g. after a successful auto-registration. */
export function setSchemaRegistered(kind: string, registered = true): void {
  schemaExistsCache.set(kind, registered);
}

/**
 * Parse a full kind string into its Schema Service identity components.
 * e.g. "osdu:wks:work-product-component--StructureMap:1.0.0"
 */
export function parseKindIdentity(kind: string): {
  authority: string;
  source: string;
  entityType: string;
  schemaVersionMajor: number;
  schemaVersionMinor: number;
  schemaVersionPatch: number;
} | undefined {
  const m = kind.match(/^([^:]+):([^:]+):(.+):(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return undefined;
  return {
    authority: m[1],
    source: m[2],
    entityType: m[3],
    schemaVersionMajor: parseInt(m[4], 10),
    schemaVersionMinor: parseInt(m[5], 10),
    schemaVersionPatch: parseInt(m[6], 10)
  };
}
