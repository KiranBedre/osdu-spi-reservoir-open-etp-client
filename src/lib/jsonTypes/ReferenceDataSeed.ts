/**
 * ReferenceDataSeed.ts – Auto-seed OSDU reference-data records for RESQML vocabulary.
 *
 * Contains the complete set of RESQML enum values (from 2.0.1 & 2.2 XSDs) that
 * converters emit via addReferenceData(). Seeded once per partition on first
 * manifest build so that createMissingReferences is not needed for standard vocabulary.
 *
 * Only types actually used by converters are included - not the full XSD universe.
 */

import logging from "../common/Logging";
const logger = logging.getLogger("EtpClient");

import type { OSDUContext } from "./OsduContext";

// ═══════════════════════════════════════════════════════════════════════════════
// Complete RESQML vocabulary used by converters (from XSD enums)
// ═══════════════════════════════════════════════════════════════════════════════

export const RESQML_REFERENCE_DATA: Record<string, string[]> = {
  ExistenceKind: [
    "Actual",
    "Planned",
    "Simulated",
    "Test",
    "Prototype",
  ],
  DomainType: [
    "Depth",
    "Time",
    "Mixed",
  ],
  IndexableElement: [
    "cells",
    "column edges",
    "columns",
    "contacts",
    "coordinate lines",
    "edges",
    "edges per column",
    "enumerated elements",
    "faces",
    "faces per cell",
    "interval edges",
    "intervals",
    "I0",
    "I0 edges",
    "J0",
    "J0 edges",
    "layers",
    "nodes",
    "nodes per cell",
    "nodes per edge",
    "nodes per face",
    "patches",
    "pillars",
    "regions",
    "representation",
    "subnodes",
    "triangles",
  ],
  ParameterKind: [
    "DataObject",
    "FloatingPoint",
    "Integer",
    "String",
    "Timestamp",
    "SubActivity",
  ],
  KDirectionType: [
    "down",
    "up",
    "not monotonic",
  ],
  PillarShapeType: [
    "vertical",
    "straight",
    "curved",
  ],
  RepresentationRole: [
    "Map",
    "Pick",
    "Section",
    "InterpretationLine",
  ],
  RepresentationType: [
    "Grid2d",
    "PolylineSet",
    "TriangulatedSurface",
    "PointSet",
    "BlockedWellbore",
    "StratigraphicOccurrenceInterpretation",
  ],
  StratigraphicRoleType: [
    "Chronostratigraphic",
    "Lithostratigraphic",
    "Biostratigraphic",
  ],
  SamplingDomainType: [
    "MeasuredDepth",
    "TrueVerticalDepth",
    "Time",
  ],
  MarkerType: [
    "horizon",
    "fault",
    "geobody",
  ],
  OrderingCriteria: [
    "Age",
    "ApparentDepth",
    "MeasuredDepth",
  ],
  LogCurveMainFamily: [
    "absorbed dose",
    "amplitude",
    "density",
    "depth",
    "dimensionless",
    "electrical resistivity",
    "gamma ray API unit",
    "index",
    "length",
    "mass per volume",
    "porosity",
    "rock permeability",
    "Rock Impedance",
    "saturation",
    "shale volume",
    "shale volume fraction",
    "velocity",
    "volume fraction",
    "volume per volume",
    "water saturation",
    "spontaneous potential",
    "acoustic impedance",
    "sonic slowness",
    "neutron porosity",
    "bulk density",
    "photoelectric factor",
    "caliper",
    "formation pressure",
  ],
  ColumnBasedTableType: [
    "WellboreStatistics",
  ],
};

// Track which partitions have been seeded this process lifetime
const seededPartitions = new Set<string>();

/**
 * Seed reference-data records for a partition if not already done.
 *
 * - Checks OSDU catalog for existing records (batched search)
 * - Creates only missing ones via Storage API PUT
 * - Only runs once per partition per process lifetime
 *
 * @param context  OSDUContext with bearer/partition set
 */
export async function seedReferenceDataIfNeeded(
  context: OSDUContext
): Promise<void> {
  const partition = context.partition;
  if (seededPartitions.has(partition)) {
    return; // Already seeded this session
  }
  seededPartitions.add(partition);

  const t0 = Date.now();

  // Build the full list of (type, value) → record id
  const allRecords: { type: string; value: string; id: string }[] = [];
  for (const [type, values] of Object.entries(RESQML_REFERENCE_DATA)) {
    for (const value of values) {
      const encoded = encodeURIComponent(value);
      const id = `${partition}:reference-data--${type}:${encoded}`;
      allRecords.push({ type, value, id });
    }
  }

  // Batch-check which already exist using the authoritative Storage service
  // (source of truth, no Elasticsearch index lag) so records written moments
  // earlier are reliably seen and not re-seeded.
  const existingIds = new Set<string>();
  try {
    const found = await context.batchOsduRecordVersions(
      allRecords.map(r => r.id)
    );
    for (const id of found.keys()) {
      existingIds.add(id);
    }
  } catch (e: any) {
    // Storage lookup failed: we cannot tell which records already exist, so we
    // MUST NOT proceed - PUTting the stub payload blindly would clobber any
    // authoritative catalog records that are already present. Abort seeding and
    // let createMissingReferences handle genuinely-missing vocabulary later.
    logger.warn(
      `[seed] Existence check failed for partition '${partition}', skipping seed to avoid overwriting catalog records: ${e?.message ?? e}`
    );
    return;
  }

  // Filter to only missing records
  const missing = allRecords.filter(r => !existingIds.has(r.id));
  if (missing.length === 0) {
    logger.info(
      `[seed] Partition '${partition}' already has all ${allRecords.length} reference-data records (${Date.now() - t0}ms)`
    );
    return;
  }

  logger.info(
    `[seed] Partition '${partition}': ${existingIds.size}/${allRecords.length} exist, seeding ${missing.length} missing reference-data records`
  );

  // Get ACL/legal from context (first dataspace)
  let acl = { owners: [] as string[], viewers: [] as string[] };
  let legal = {
    legaltags: [] as string[],
    otherRelevantDataCountries: [] as string[],
  };
  for (const aclLegal of context.dataspaceACLs.values()) {
    acl = aclLegal.acl ?? acl;
    legal = aclLegal.legal ?? legal;
    break;
  }

  // Build OSDU records for missing items
  const now = new Date().toISOString();
  const records = missing.map(r => ({
    id: r.id,
    kind: `osdu:wks:reference-data--${r.type}:1.0.0`,
    acl,
    legal,
    data: {
      Code: r.value,
      Name: `${r.type}-${r.value}`,
      Source: "RESQML",
    },
    createTime: now,
    modifyTime: now,
  }));

  // Push in batches via Storage API
  const STORAGE_BATCH = 20;
  let created = 0;
  for (let i = 0; i < records.length; i += STORAGE_BATCH) {
    const batch = records.slice(i, i + STORAGE_BATCH);
    try {
      const body = JSON.stringify(batch);
      const result = await context.fetchOSDU<{ recordCount?: number }>(
        "/api/storage/v2/records",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": `${body.length}`,
          },
          body,
        }
      );
      created += result?.recordCount ?? batch.length;
    } catch (e: any) {
      logger.warn(
        `[seed] Failed to push batch ${Math.floor(i / STORAGE_BATCH) + 1}: ${e?.message ?? e}`
      );
    }
  }

  logger.info(
    `[seed] Seeded ${created}/${missing.length} reference-data records for '${partition}' in ${Date.now() - t0}ms`
  );
}
