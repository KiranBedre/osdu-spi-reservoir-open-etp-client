import { v5 as uuidNameSpace } from "uuid";

import { Energistics, EtpUri, ResqmlClient, URI } from "../client/ResqmlClient";

import type { IResqmlDataObject } from "../client/ResqmlClient";

import logging from "../common/Logging";
const logger = logging.getLogger("EtpClient");

import {
  ensureSchemaVersions,
  getKind,
  getKindOrFallback,
  isSchemaRegistered
} from "./MilestoneKinds";
import {
  DataspaceLegalACL,
  OSDUContext,
  OSDUResourceType
} from "./OsduContext";
import ResqmlOSDU, { EtpDataspaceManifest } from "./ResqmlOsdu";
import { WorkProductManifest } from "./WorkProduct";
import {
  CollaborationProjectManifest,
  deriveCollaborationId
} from "./CollaborationProject";
import {
  getPropertyTypeIDFromResqmlAlias,
  PropertyTypesIds
} from "./PropertyTypes";
import { isKnownPwlsProperty } from "./PwlsCurveCatalog";

import { ErrorCode, EtpError } from "../common/EtpTypes";

/**
 * S4: Namespace UUID for deterministic dataspace → collaboration UUID mapping.
 * Uses a well-known namespace so that the same dataspace always maps to the
 * same collaboration UUID regardless of which client instance generates it.
 */
const RDDMS_COLLABORATION_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

import {
  GenericMasterData,
  GenericReferenceData,
  Manifest
} from "./Generated/manifest/Manifest.1.0.0";
import { etpServerPath, osduUrl } from "../common/config";

import serverSchema from "./server-schema.json";

export const dataspaceUriPattern =
  /^(?:eml:\/\/\/|^eml:\/\/\/dataspace\('[^'"]*?(?:''[^'"]*?)*'\))$/;

/**
 * Register DMS if not already registered
 *
 * @param {OSDUContext} context
 */
const registerDMS = async (context: OSDUContext) => {
  const dmsUrl = `${osduUrl}${etpServerPath}`;

  let index = 1;
  while (index > 0) {
    context.rddmsId = `reservoir-ddms${index}`;
    const dms = await context.fetchOSDU<{
      interfaces: { schema: { servers: { url: string }[] } }[];
    }>(`/api/register/v1/ddms/${context.rddmsId}`);
    if (dms === undefined) {
      break;
    }
    if (
      dms.interfaces.some(i => i.schema.servers.some(s => s.url === dmsUrl))
    ) {
      return;
    } else {
      index++;
    }
  }
  serverSchema.id = context.rddmsId;
  serverSchema.interfaces[0].schema.servers[0].url = dmsUrl;

  await context.pushOSDU("/api/register/v1/ddms", serverSchema);
};

/**
 * Get ACL and Legal info from dataspace custom data
 * @param dataspace
 * @returns
 */
const getACLForDataspace = (
  dataspace: Energistics.Etp.v12.Datatypes.Object.Dataspace
): DataspaceLegalACL => {
  const legalACL: DataspaceLegalACL = {
    acl: {
      owners: [],
      viewers: []
    },
    legal: {
      legaltags: [],
      otherRelevantDataCountries: [],
      status: "compliant"
    }
  };

  legalACL.acl.viewers =
    dataspace.customData.get("viewers")?.item?._ArrayOfString?.values ?? [];
  legalACL.acl.owners =
    dataspace.customData.get("owners")?.item?._ArrayOfString?.values ?? [];
  legalACL.legal.legaltags =
    dataspace.customData.get("legaltags")?.item?._ArrayOfString?.values ?? [];
  const countries =
    dataspace.customData.get("otherRelevantDataCountries")?.item?._ArrayOfString
      ?.values ?? [];
  legalACL.legal.otherRelevantDataCountries = countries;
  return legalACL;
};

/**
 * Curated type-pattern preset covering discovery-worthy types (features,
 * interpretations, representations, wells) while excluding bulk properties.
 *
 * NOTE: This is no longer the default. When no `typePatterns` are supplied,
 * manifests now include ALL types (see createManifest). This preset remains
 * exported as an opt-in filter that callers can pass explicitly to reproduce
 * the older, narrower behavior. Properties with canonical OSDU names are still
 * included automatically via a secondary filter (see createManifest).
 */
export const DEFAULT_DATASPACE_TYPE_PATTERNS: string[] = [
  "*Feature",
  "*Interpretation*",
  "*Representation",
  "*StratigraphicColumn",
  "*Activity*",
  "*Collection",
  "witsml21.*"
];

/**
 * Types that reference other data objects but carry little standalone
 * discovery value and frequently introduce referential-integrity noise when
 * combined with property filtering (e.g. Activity records reference every
 * property they consumed; with `propertyFilter="canonical"` those references
 * become dangling). Excluded by default on the auto-ingest path so the emitted
 * manifest stays self-consistent for the OSDU ingestion workflow (Airflow DAG).
 */
export const DEFAULT_INGEST_EXCLUDE_PATTERNS: string[] = [
  "*Activity", // resqml20.obj_Activity / eml23.Activity
  "*ActivityTemplate", // resqml20.obj_ActivityTemplate / eml23.ActivityTemplate
  "*PropertySet" // resqml20.obj_PropertySet -> PersistedCollection (pure grouping container)
];

/** Property type pattern for secondary filter matching */
const PROPERTY_TYPE_PATTERN = /Property$/i;

/**
 * Essential dependency types that are ALWAYS included in a manifest,
 * regardless of any `typePatterns` filter. CRS objects are referenced by
 * representations for spatial context, so they must never be filtered out.
 */
const ALWAYS_INCLUDE_PATTERN = /Crs$/i;

/**
 * Common reservoir-simulation property name abbreviations.
 * These are the short names used by Eclipse, OPM, tNavigator, etc.
 * that don't appear in PWLS or OSDU PropertyType catalogs.
 */
const RESSIM_PROPERTY_NAMES = new Set([
  // Porosity & net-to-gross
  "poro",
  "porosity",
  "ntg",
  "multpv",
  // Permeability
  "permx",
  "permy",
  "permz",
  "permxy",
  "permyz",
  "permzx",
  "perm",
  "kx",
  "ky",
  "kz",
  // Saturations
  "sw",
  "sg",
  "so",
  "swat",
  "sgas",
  "soil",
  "swl",
  "swu",
  "sgl",
  "sgu",
  "sowcr",
  "sogcr",
  "swcr",
  "sgcr",
  // Region numbers
  "satnum",
  "eqlnum",
  "fipnum",
  "pvtnum",
  "imbnum",
  "actnum",
  "endnum",
  "rocknum",
  "fluxnum",
  // Transmissibility & multipliers
  "tranx",
  "trany",
  "tranz",
  "multx",
  "multy",
  "multz",
  "multx-",
  "multy-",
  "multz-",
  "multregt",
  // Pressure & depth
  "pressure",
  "depth",
  "tops",
  "dz",
  "dx",
  "dy",
  // Rock mechanics
  "young",
  "poisson",
  "biot",
  // Common output / init
  "rporv",
  "porv",
  "fipoil",
  "fipgas",
  "fipwat"
]);

/** Property filter mode for manifest generation */
export type PropertyFilter = "canonical" | "none" | "all";

/**
 * Check if a resource is a Property with a canonical or common name.
 * Used as a secondary inclusion filter so that simulation-critical
 * properties are included in manifests without pulling in every
 * unnamed/local property.
 *
 * A property is "canonical" if its Citation.Title (exposed as Resource.name
 * in ETP Discovery) matches any of:
 * - A common reservoir-simulation abbreviation (PORO, PERMX, SW, SATNUM, …)
 * - A known PWLS v4 standard property name (875 entries)
 * - An OSDU PropertyType from the reference-data manifest
 */
export function isCanonicalProperty(
  dataObjectType: string,
  name: string
): boolean {
  if (!PROPERTY_TYPE_PATTERN.test(dataObjectType)) return false;
  if (!name) return false;
  // Check common simulator abbreviations (case-insensitive)
  if (RESSIM_PROPERTY_NAMES.has(name.toLowerCase())) return true;
  // Check PWLS catalog (875 standard property names)
  if (isKnownPwlsProperty(name)) return true;
  // Check OSDU PropertyType reference-data (RESQML alias or Code)
  if (getPropertyTypeIDFromResqmlAlias(name) !== undefined) return true;
  return false;
}

/**
 * Decide whether a dataspace resource should be included in a manifest.
 *
 * The result is controlled by two independent dimensions:
 *
 * 1. `typePatterns` - restricts NON-property types. When omitted, all types
 *    are included. Pass an explicit list (e.g. DEFAULT_DATASPACE_TYPE_PATTERNS)
 *    to restrict to a curated top-level set.
 * 2. `propertyFilter` - controls properties independently of `typePatterns`:
 *    - "all": include every property
 *    - "canonical": include only properties with standard names (PWLS/OSDU/simulator)
 *    - "none": exclude all properties
 *
 * Essential dependency types (e.g. CRS) are ALWAYS included, regardless of
 * either dimension. This yields the supported preset combinations:
 *   - all types + all properties (default)
 *   - all types, no properties            (propertyFilter="none")
 *   - all types + canonical properties    (propertyFilter="canonical")
 *   - curated top-level, no properties    (typePatterns=DEFAULT_..., propertyFilter="none")
 *
 * @param {string} dataObjectType Energistics data-object type (e.g. "resqml20.obj_ContinuousProperty")
 * @param {string} name Resource name (Citation.Title exposed via ETP Discovery)
 * @param {string[]} [typePatterns] Optional type patterns (accept `*` and `?` wildcards) restricting non-property types. When omitted, all types match.
 * @param {PropertyFilter} [propertyFilter] Property inclusion mode (default "all").
 * @param {string[]} [excludePatterns] Optional type patterns (accept `*` and `?` wildcards) that HARD-exclude matching types (properties included). Applied before every other rule except the always-include set (CRS).
 * @return {boolean} true if the resource should be included
 */
export function manifestFilterMatches(
  dataObjectType: string,
  name: string,
  typePatterns?: string[],
  propertyFilter: PropertyFilter = "all",
  excludePatterns?: string[]
): boolean {
  // Essential dependency types (CRS, ...) are never filtered out.
  if (ALWAYS_INCLUDE_PATTERN.test(dataObjectType)) return true;

  // Hard exclusions win over every inclusion rule below (except CRS above).
  if (excludePatterns && excludePatterns.length > 0) {
    for (const p of compilePatterns(excludePatterns)) {
      if (dataObjectType.match(p)) return false;
    }
  }

  // Properties are gated solely by propertyFilter, independent of typePatterns.
  if (PROPERTY_TYPE_PATTERN.test(dataObjectType)) {
    if (propertyFilter === "none") return false;
    if (propertyFilter === "all") return true;
    // "canonical": include only properties with standard names
    return isCanonicalProperty(dataObjectType, name);
  }

  // Non-property types: default include all; an empty filter also means "all".
  const effectivePatterns = typePatterns ?? ["*"];
  if (effectivePatterns.length === 0) return true;
  for (const p of compilePatterns(effectivePatterns)) {
    if (dataObjectType.match(p)) return true;
  }
  return false;
}

/** Compile `*`/`?` wildcard type patterns into RegExp matchers. */
function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map(
    t => new RegExp(t.replaceAll("*", "\\w*").replaceAll("?", "\\w?"))
  );
}

/**
 * Cheap pre-flight estimate of how many input resources a build would process,
 * applying the SAME type/property/exclude filter as {@link createManifest} (so
 * the count matches what the build actually iterates - e.g. Dani ~938 vs Volve
 * ~3520). Used by the REST layer to auto-select an asynchronous build for large
 * dataspaces that would otherwise exceed the ~60s edge/LB request timeout.
 *
 * Whole-dataspace URIs are expanded and filtered via one discovery round-trip
 * each; explicit object URIs count as one and incur NO network call. Nothing is
 * fetched, converted, or resolved beyond the dataspace resource listing.
 */
export const estimateManifestInputCount = async (
  client: ResqmlClient,
  uris: URI[],
  typePatterns?: string[],
  propertyFilter: PropertyFilter = "none",
  excludePatterns?: string[]
): Promise<number> => {
  const allUris = new Set<string>();
  for (const uri of uris) {
    const etpUri = new EtpUri(uri);
    if (!etpUri.isValid) {
      continue;
    }
    if (etpUri.domain === "") {
      // Whole dataspace: list + filter exactly like createManifest's discovery.
      const dataspaceUri = EtpUri.createDataSpaceUri(etpUri.dataSpace);
      const dataspaceUris = await client.getDataspaceResources(
        dataspaceUri.uri
      );
      for (const f of dataspaceUris) {
        const u = new EtpUri(f.uri);
        if (
          manifestFilterMatches(
            u.dataObjectType,
            f.name,
            typePatterns,
            propertyFilter,
            excludePatterns
          )
        ) {
          allUris.add(f.uri);
        }
      }
    } else {
      allUris.add(etpUri.uri);
    }
  }
  return allUris.size;
};

/**
 * Create a manifest for a list of uris
 *
 * @param {ResqmlClient} client linked to ETP server
 * @param {URI[]} uris List of URIS to add as work product components
 * @param {OSDUContext} context OSDU related information
 * @param {string[]} [typePatterns] Optional list of type patterns to filter the URIs.
 *   When undefined, ALL types are included (filtering is opt-in). Pass an explicit
 *   pattern list (e.g. DEFAULT_DATASPACE_TYPE_PATTERNS) to restrict results.
 *   CRS objects are always included regardless of the filter.
 * @param {number} [maxManifestSize] Optional maximum size of the manifest in MB, default is 1000
 * @param {PropertyFilter} [propertyFilter] Controls property inclusion (independent of typePatterns):
 *   - "all" (default): include all properties regardless of name
 *   - "canonical": include only properties with standard names (PWLS, OSDU, simulator)
 *   - "none": exclude all properties
 * @param {string[]} [excludePatterns] Optional type patterns that HARD-exclude matching
 *   types (e.g. DEFAULT_INGEST_EXCLUDE_PATTERNS to drop Activity records that would
 *   otherwise emit dangling references). CRS is always kept regardless.
 * @return {Promise<Manifest>}
 */
export const createManifest = async (
  client: ResqmlClient,
  uris: URI[],
  context: OSDUContext,
  typePatterns?: string[],
  maxManifestSize: number = 1000,
  propertyFilter: PropertyFilter = "all",
  excludePatterns?: string[]
): Promise<Manifest> => {
  if (uris.length === 0) {
    return Promise.reject("No URI provided");
  }
  try {
    const tManifestStart = Date.now();
    // Per-build tally of ETP object types that never reach the manifest, so the
    // otherwise-silent "omit" filters produce an actionable list instead of a
    // blind spot. `skippedNoConverter` = no converter registered for the type;
    // `skippedConverterUndefined` = a converter matched but chose to skip the
    // object (returned undefined). Emitted once at the end of the build.
    const skippedNoConverter = new Map<string, number>();
    const skippedConverterUndefined = new Map<string, number>();
    // `convertFailed` = a converter matched and ran but THREW (e.g. an OSDU
    // CRS/reference lookup rejected, or a converter bug). Previously this path
    // dropped the object silently with no tally, so a systemic convert-time
    // failure (e.g. OSDU unreachable on a deployed instance) produced an empty
    // manifest with zero explanation. Counting it turns that blind spot into an
    // actionable, surfaced diagnostic.
    const convertFailed = new Map<string, number>();
    // Total objects that had a resolvable $type and were therefore eligible for
    // conversion. Compared against `context.created.size` to detect the
    // pathological "N inputs, 0 outputs" case and raise a loud warning.
    let attemptedConversions = 0;
    const bumpSkip = (m: Map<string, number>, key: string): void => {
      m.set(key, (m.get(key) ?? 0) + 1);
    };
    // M26 parity (default): make NO schema-service calls - stamp kinds straight
    // from the static fallback table, exactly like the M26 boundary. Only when
    // schemaCompat:true is explicitly requested do we align stamped kind
    // versions with the live target instance (resolving registered versions and
    // falling back GenericRepresentation for unknown WPC types). This keeps the
    // default build path free of every schema-service round-trip.
    if (context.schemaCompat === true) {
      try {
        await ensureSchemaVersions(osduUrl, context.bearer, context.partition);
      } catch {
        // Keep the static fallback table if resolution fails.
      }
    }
    try {
      await registerDMS(context);
    } catch {
      // Ignore registration errors - continue without DMS registration
    }
    logger.info(`[perf] registerDMS: ${Date.now() - tManifestStart}ms`);
    const manifests: Manifest = {
      // $schema:
      //   "https://community.opengroup.org/osdu/data/data-definitions/-/raw/master/Generated/manifest/Manifest.1.0.0.json",
      kind: `osdu:wks:Manifest:1.0.0`,
      Data: {}
    };

    const objectUris: string[] = [];
    const currentDataspaces = new Set<string>();

    const allUris = new Set<string>();

    for (const uri of uris) {
      const etpUri = new EtpUri(uri);
      if (!etpUri.isValid) {
        continue;
      }
      if (etpUri.domain === "") {
        // Add entire dataspace content by ensuring a proper dataspace uri
        const dataspaceUri = EtpUri.createDataSpaceUri(etpUri.dataSpace);
        let dataspaceUris = await client.getDataspaceResources(
          dataspaceUri.uri
        );
        dataspaceUris = dataspaceUris.filter(f => {
          const u: EtpUri = new EtpUri(f.uri);
          return manifestFilterMatches(
            u.dataObjectType,
            f.name,
            typePatterns,
            propertyFilter,
            excludePatterns
          );
        });
        dataspaceUris.forEach(r => allUris.add(r.uri));
      } else {
        allUris.add(etpUri.uri);
      }
    }

    for (const uri of allUris) {
      const etpUri = new EtpUri(uri);

      const dataspaceId = `${context.partition
        }:dataset--ETPDataspace:${context.datasetId(etpUri)}`;

      // Create dataspace entry if not exists
      if (!currentDataspaces.has(dataspaceId)) {
        // Check if the object dataspace exists on server
        const dataspaceUri = EtpUri.createDataSpaceUri(etpUri.dataSpace).uri;
        const dataspace = await client.getDataspaceInfo([dataspaceUri]).then(
          dataspaces => (dataspaces.length === 1 ? dataspaces[0] : undefined),
          () => undefined
        );
        if (manifests.Data === undefined || !dataspace) {
          continue;
        }

        // Create WorkProduct. The DAG-based OSDU ingestion workflow
        // (Osdu_ingest) is WorkProduct-centric: it walks the WorkProduct's
        // Components array to discover and ingest the associated
        // WorkProductComponents. Without an emitted WorkProduct the WPCs are
        // orphaned and silently skipped by the DAG. The Components array is
        // populated later (see the WPC loop) via
        // `manifests.Data.WorkProduct?.data?.Components?.push(...)`.
        // Populate the dataspace ACL/legal cache BEFORE constructing the
        // WorkProduct: WorkProductOSDU stamps its acl/legal from
        // context.dataspaceACLs at construction time, so this must run first or
        // the WorkProduct is emitted with empty acl/legal (which fails the
        // atomic Storage batch and triggers a per-record retry storm).
        if (!context.dataspaceACLs.has(dataspaceUri)) {
          const aclLegal = getACLForDataspace(dataspace);
          context.dataspaceACLs.set(dataspaceUri, aclLegal);
        }
        manifests.Data.WorkProduct = WorkProductManifest(dataspace, context);
        manifests.Data.WorkProduct.version = 1;
        currentDataspaces.add(dataspaceId);

        manifests.Data.Datasets = manifests.Data.Datasets ?? [];
        manifests.Data.Datasets.push(EtpDataspaceManifest(dataspace, context));
      }

      // Check that it is an object
      if (etpUri.uuid !== "") {
        objectUris.push(uri);
      }
    }

    if (manifests.Data === undefined) {
      return Promise.reject("Manifest creation failed");
    }

    // S4: Auto-map dataspace UUID → x-collaboration header when not explicitly provided.
    // Derives a deterministic collaboration UUID from the first dataspace being processed,
    // enabling automatic OSDU collaboration project association without caller intervention.
    if (!context.collaboration && allUris.size > 0) {
      const firstUri = allUris.values().next().value;
      if (firstUri) {
        const firstEtpUri = new EtpUri(firstUri);
        if (firstEtpUri.dataSpace) {
          const collaborationId = uuidNameSpace(
            firstEtpUri.dataSpace,
            RDDMS_COLLABORATION_NAMESPACE
          );
          context.collaboration = JSON.stringify({ id: collaborationId });
          logger.info(
            `S4: Auto-mapped dataspace '${firstEtpUri.dataSpace}' → collaboration ${collaborationId}`
          );
        }
      }
    }

    manifests.Data.WorkProductComponents = [];
    manifests.MasterData = [];

    // S5: Emit a CollaborationProject master-data record per dataspace.
    // Maps each ETP dataspace to an OSDU CollaborationProject (SOE namespace).
    // Uses idempotent upsert: checks existing version in OSDU and bumps version
    // to ensure consistency across multiple manifest builds.
    for (const dataspaceUri of context.dataspaceACLs.keys()) {
      const dsEtpUri = new EtpUri(dataspaceUri);
      const collabId = deriveCollaborationId(dsEtpUri.dataSpace);
      const dsInfo = await client.getDataspaceInfo([dataspaceUri]).then(
        ds => (ds.length === 1 ? ds[0] : undefined),
        () => undefined
      );
      if (dsInfo) {
        const cpRecord = CollaborationProjectManifest(
          dsInfo,
          context,
          collabId
        ) as any;

        // Check if CP already exists in OSDU - version bump for consistency
        const existingVersion = await context
          .getOSDUResourceVersion(cpRecord.id)
          .catch(() => undefined);
        if (existingVersion !== undefined) {
          cpRecord.version = existingVersion + 1;
          logger.info(
            `S5: Updating existing CollaborationProject v${existingVersion} → v${cpRecord.version}`
          );
        }

        manifests.MasterData.push(cpRecord);
        logger.info(
          `S5: CollaborationProject '${dsEtpUri.dataSpace}' → ${cpRecord.id}`
        );
      }
    }

    const dataspaceObjects: Record<string, string[]> = {};

    for (const uri of objectUris) {
      const etpUri = new EtpUri(uri);
      if (dataspaceObjects[etpUri.dataSpace] === undefined) {
        dataspaceObjects[etpUri.dataSpace] = [];
      }
      dataspaceObjects[etpUri.dataSpace].push(uri);
    }

    // Get objects infos
    const objects: Map<URI, IResqmlDataObject> = new Map<
      URI,
      IResqmlDataObject
    >();
    for (const dataspace in dataspaceObjects) {
      const tmpUris = [...dataspaceObjects[dataspace]];
      const resolvedObjects: (IResqmlDataObject | null)[] = [];

      const t0 = Date.now();
      // Batch size: use larger batches to minimize ETP round-trips.
      // The ETP protocol layer already handles message-size splitting internally.
      const BATCH_SIZE = 50;
      while (tmpUris.length > 0) {
        const batch = tmpUris.splice(0, BATCH_SIZE);
        logger.info(
          `[perf] Fetching batch of ${batch.length
          } URIs from ${dataspace}, first: ${batch[0]?.substring(
            batch[0].lastIndexOf("/")
          )}`
        );
        try {
          const t1 = Date.now();
          const arr = await client.getResolvedObjects(batch, objects, false);
          const batchNulls = arr.filter(o => o === null).length;
          logger.info(
            `[perf] Batch result: ${arr.length
            } items, ${batchNulls} nulls, objects map size=${objects.size
            }, took ${Date.now() - t1}ms`
          );
          if (batchNulls > 0 && batchNulls === arr.length) {
            // Try single fetch to diagnose
            const testUri = batch[0];
            logger.warn(
              `[debug] All nulls! Trying single getObjects for: ${testUri}`
            );
            const singleMap = new Map<string, any>();
            const single = await client.getResolvedObjects(
              [testUri],
              singleMap,
              false
            );
            logger.warn(
              `[debug] Single result: ${single.length} items, null=${single[0] === null
              }, singleMap size=${singleMap.size}`
            );
          }
          // Append in place (bounded batch): avoids O(n²) reallocation from
          // resolvedObjects.concat in the batch loop
          for (let i = 0; i < arr.length; i++) {
            resolvedObjects.push(arr[i]);
          }
        } catch (e: any) {
          logger.error(
            `getResolvedObjects failed for batch: ${batch
              .map(u => u.substring(u.lastIndexOf("/") + 1))
              .join(", ")} - ${e?.message ?? e}`
          );
        }
      }

      const nullCount = resolvedObjects.filter(o => o === null).length;
      const noTypeCount = resolvedObjects.filter(
        o => o !== null && o?.$type === undefined
      ).length;
      logger.info(
        `Resolved ${resolvedObjects.length
        } objects for dataspace ${dataspace} in ${Date.now() - t0
        }ms (null=${nullCount}, noType=${noTypeCount})`
      );

      // Seed the DOR-resolution cache from the batch-resolved objects. During
      // conversion, references (SupportingRepresentation, PropertyKind, Lookup,
      // geometry, ...) are resolved via context.uriToObject; without seeding,
      // each reference issues its own ETP getObjects round-trip even though the
      // target was already fetched into `objects` by getResolvedObjects'
      // recursive target resolution. Seeding turns those N+1 round-trips into
      // in-memory cache hits.
      let seeded = 0;
      for (const [u, o] of objects) {
        if (o !== null && o !== undefined && !context.uriToObject.has(u)) {
          context.uriToObject.set(u, o);
          seeded++;
        }
      }
      logger.info(
        `[perf] Seeded DOR cache with ${seeded} objects (uriToObject size=${context.uriToObject.size})`
      );

      // ---------------------------------------------------------------------
      // WellLog curve-index pre-pass.
      //
      // The WellLog converter needs, per WellboreFrameRepresentation, the
      // Continuous/Discrete/CategoricalProperty objects that reference it.
      // Property objects are excluded from the primary object set by the
      // manifest filter (propertyFilter), so without an index each frame issues
      // its OWN getResources(sources) + getResolvedObjects round-trip — two ETP
      // calls per WellLog. On dataspaces with hundreds of frames that dominates
      // build time.
      //
      // Instead, when the set contains frames, enumerate ALL property objects
      // in the dataspace once, bulk-fetch them with bounded concurrency, and
      // invert them into a frame-UUID -> property[] index on the context. The
      // converter then assembles Curves[] from memory (zero per-frame calls).
      // Keyed by UUID to stay robust against URI version/format differences.
      // ---------------------------------------------------------------------
      const hasFrames = resolvedObjects.some(
        o =>
          o !== null &&
          typeof (o as any)?.$type === "string" &&
          (o as any).$type.includes("WellboreFrameRepresentation")
      );
      if (hasFrames) {
        const tIdx = Date.now();
        try {
          if (context.frameCurveProps === undefined) {
            context.frameCurveProps = new Map<string, IResqmlDataObject[]>();
          }
          const frameIndex = context.frameCurveProps;
          const dsUri = EtpUri.createDataSpaceUri(dataspace).uri;
          const propResources = await client.getDataspaceResources(dsUri);
          const propUris = propResources
            .map(r => r.uri)
            .filter(
              u =>
                u.includes("ContinuousProperty") ||
                u.includes("DiscreteProperty") ||
                u.includes("CategoricalProperty")
            );
          if (propUris.length > 0) {
            const propCache: Map<URI, IResqmlDataObject> = new Map<
              URI,
              IResqmlDataObject
            >();
            const IDX_BATCH = 50;
            const IDX_CONCURRENCY = 8;
            const idxBatches: string[][] = [];
            for (let i = 0; i < propUris.length; i += IDX_BATCH) {
              idxBatches.push(propUris.slice(i, i + IDX_BATCH));
            }
            let idxCursor = 0;
            let idxFailed = false;
            const idxWorker = async (): Promise<void> => {
              while (idxCursor < idxBatches.length) {
                const b = idxBatches[idxCursor++];
                try {
                  await client.getResolvedObjects(b, propCache, false);
                } catch (e: any) {
                  idxFailed = true;
                  logger.warn(
                    `[welllog-index] property fetch batch failed: ${e?.message ?? e
                    }`
                  );
                }
              }
            };
            await Promise.all(
              Array.from(
                { length: Math.min(IDX_CONCURRENCY, idxBatches.length) },
                () => idxWorker()
              )
            );
            if (idxFailed) {
              // A batch failed: the index would be incomplete, which would make
              // the converter silently drop curves. Discard it so every frame
              // falls back to the resilient per-frame fetch path instead.
              context.frameCurveProps = undefined;
              logger.warn(
                `[welllog-index] incomplete property fetch; discarding index and falling back to per-frame fetch`
              );
            } else {
              let indexed = 0;
              for (const [, propObj] of propCache) {
                if (propObj === null || propObj === undefined) continue;
                const t = (propObj as any).$type;
                if (
                  typeof t !== "string" ||
                  !(
                    t.includes("ContinuousProperty") ||
                    t.includes("DiscreteProperty") ||
                    t.includes("CategoricalProperty")
                  )
                ) {
                  continue;
                }
                const targets = new Set<string>();
                client.getObjectTargets(dataspace, propObj, targets);
                for (const target of targets) {
                  if (!target.includes("WellboreFrameRepresentation")) continue;
                  const frameKey = new EtpUri(target).uuid;
                  if (!frameKey) continue;
                  const list = frameIndex.get(frameKey);
                  if (list) {
                    list.push(propObj);
                  } else {
                    frameIndex.set(frameKey, [propObj]);
                  }
                  indexed++;
                }
              }
              logger.info(
                `[welllog-index] indexed ${indexed} curve properties across ${frameIndex.size
                } frames (${propUris.length} property objects, ${idxBatches.length
                } batches) in ${Date.now() - tIdx}ms`
              );
            }
          } else {
            logger.info(
              `[welllog-index] no property objects in ${dataspace}; frames have no curves`
            );
          }
        } catch (e: any) {
          // Enumeration itself failed: discard any partial index so the
          // converter uses the resilient per-frame fetch path.
          context.frameCurveProps = undefined;
          logger.warn(
            `[welllog-index] pre-pass failed; converter will fall back to per-frame fetch: ${e?.message ?? e
            }`
          );
        }
      }

      const tConvert = Date.now();
      // Convert objects with bounded concurrency. Each conversion is dominated
      // by independent network round-trips (ETP object/array fetches and OSDU
      // Storage existence checks); running them strictly serially serialises
      // that latency. Node is single-threaded, so overlapping the awaits is
      // safe for the synchronous Map/Set mutations on the shared context while
      // still cutting wall-clock time dramatically on large models.
      // 32-way: profiling large models (e.g. demo/Volve) showed the build is
      // dominated by independent ETP getObjects/getDataArray round-trip LATENCY
      // rather than CPU, so raising the number of in-flight requests on the
      // multiplexed ETP session hides more of that latency.
      const CONVERT_CONCURRENCY = 32;
      const processOne = async (i: number): Promise<void> => {
        const resObj = resolvedObjects[i];
        if (resObj?.$type === undefined) {
          return;
        }
        attemptedConversions++;

        const m = resObj.$type.match(
          /^(?<domainFamily>resqml|eml|witsml|prodml)(?<domainVersion>[\d]+).(?<dataType>[\w]+)$/i
        );
        const etpUri = EtpUri.createObjectUri(
          dataspace,
          m?.groups?.domainFamily ?? "",
          m?.groups?.domainVersion ?? "",
          m?.groups?.dataType ?? "",
          resObj.Uuid,
          resObj.ObjectVersion
        );

        const c = ResqmlOSDU.get(etpUri.dataObjectType);
        if (c === undefined) {
          bumpSkip(skippedNoConverter, etpUri.dataObjectType);
          return;
        }
        // Stage 1: core conversion. This is the ONLY step whose failure can
        // legitimately drop the object, because a throw here means no record
        // was produced. Everything after this point is best-effort enrichment
        // that must never cost us an otherwise-valid record (warn, don't skip).
        let res: OSDUResourceType | undefined;
        try {
          const tObj = Date.now();
          res = await c.convert(etpUri.uri, resolvedObjects[i], context, client);
          const convertMs = Date.now() - tObj;
          if (convertMs > 200) {
            logger.warn(
              `[perf] Slow converter: ${etpUri.dataObjectType} took ${convertMs}ms`
            );
          }
        } catch (convErr: any) {
          // No record produced. Count and warn (loudly) instead of dropping
          // silently, so a systemic convert-time failure is diagnosable.
          bumpSkip(convertFailed, etpUri.dataObjectType);
          logger.warn(
            `[convert] Converter threw for ${etpUri.dataObjectType} (${resObj.Uuid}); no record produced: ${convErr?.message ?? convErr
            }`
          );
          return;
        }
        if (res === undefined) {
          // Converter deliberately declined this object (returned undefined).
          bumpSkip(skippedConverterUndefined, etpUri.dataObjectType);
          return;
        }

        // Stage 2: resolve the platform kind + fix the record id prefix.
        // The converter constructor hardcodes a compile-time version, but the
        // platform may have a different version registered. Failure here is
        // non-fatal: we keep the converter's default kind and still emit.
        try {
          const resolvedKind = c.osduKind(resolvedObjects[i]!);
          if (resolvedKind) {
            res.kind = resolvedKind;
            // Ensure record.id uses the correct resource-type--Entity prefix
            const kindParts = resolvedKind.split(":");
            // kindParts = ["osdu", "wks", "resource-type--Entity", "X.Y.Z"]
            const typeEntity = kindParts[2]; // e.g. "master-data--BHARun"
            if (typeEntity && res.id) {
              const idParts = res.id.split(":");
              // idParts = ["partition", "old-type--Entity", "uuid"]
              if (idParts.length >= 3) {
                idParts[1] = typeEntity;
                res.id = idParts.join(":");
              }
            }
          }
        } catch (kindErr: any) {
          logger.warn(
            `[enrich] Kind resolution failed for ${etpUri.dataObjectType} (${resObj.Uuid}); keeping converter default kind: ${kindErr?.message ?? kindErr
            }`
          );
        }

        // Stage 3: stamp the dataspace ACL/legal tags (required for OSDU
        // Storage compliance). Synchronous and safe.
        const dataspaceUri = EtpUri.createDataSpaceUri(etpUri.dataSpace).uri;
        const aclLegal = context.dataspaceACLs.get(dataspaceUri);
        if (aclLegal !== undefined) {
          res.acl = aclLegal?.acl ?? { owners: [], viewers: [] };
          res.legal = aclLegal?.legal ?? {
            legaltags: [],
            otherRelevantDataCountries: []
          };
        }

        // Stage 4: reconcile with any pre-existing OSDU record (merge dataset
        // references). If OSDU is unreachable or this lookup throws, warn and
        // emit the freshly converted record rather than dropping it.
        if (res.id) {
          try {
            // Check if it is an explicit osdu resource
            if (OSDUContext.osduAlias(resObj) !== undefined) {
              //Check that a version exists
              const d = res.id.split(":");
              const version = await context.getOSDUResourceVersion(res.id);
              if (version) {
                const stored = await context.fetchOSDU<OSDUResourceType>(
                  `/api/storage/v2/records/${d[0]}:${d[1]}:${d[2]}`
                );
                if (stored) {
                  // If version exists, just update the DDMSDatasets field in the exiting record
                  if (res && res.data?.DDMSDatasets?.length > 0) {
                    if (!stored.data) {
                      stored.data = {};
                    }
                    if (!stored.data.DDMSDatasets) {
                      stored.data.DDMSDatasets = [];
                    } else if (
                      // If the DDMSDatasets already contain the current grid, skip it
                      stored.data.DDMSDatasets.findIndex(
                        (e: string) =>
                          res?.data?.DDMSDatasets &&
                          e === res.data.DDMSDatasets[0]
                      ) !== -1
                    ) {
                      return;
                    }
                    stored.data.DDMSDatasets = [
                      ...stored.data.DDMSDatasets,
                      ...res.data.DDMSDatasets
                    ];
                  }
                  res = stored;
                }
              }
            }
          } catch (osduErr: any) {
            logger.warn(
              `[enrich] OSDU reconciliation failed for ${res.id}; emitting freshly converted record: ${osduErr?.message ?? osduErr
              }`
            );
          }
          if (res && res.id) {
            context.created.set(res.id, res);
          }
        }
      };

      let __nextIndex = 0;
      const worker = async (): Promise<void> => {
        for (; ;) {
          const i = __nextIndex++;
          if (i >= resolvedObjects.length) {
            return;
          }
          await processOne(i);
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(CONVERT_CONCURRENCY, resolvedObjects.length) },
          () => worker()
        )
      );
      logger.info(
        `[perf] Convert ${resolvedObjects.length} objects: ${Date.now() - tConvert
        }ms`
      );
    }

    // A3: Auto-generate lineage Activity record for this manifest build.
    // Suppressed when the caller excludes the Activity type (e.g. auto-ingest
    // defaults to excluding "*Activity"), keeping the manifest consistent with
    // the requested filter instead of injecting a synthetic Activity.
    const lineageSuppressed =
      !!excludePatterns?.length &&
      compilePatterns(excludePatterns).some(p => "Activity".match(p));
    if (
      context.created.size > 0 &&
      context.generateLineageActivity !== false &&
      !lineageSuppressed
    ) {
      const outputIds: string[] = [];
      context.created.forEach((_, id) => {
        if (!id.includes("reference-data") && !id.includes("master-data")) {
          outputIds.push(id);
        }
      });
      if (outputIds.length > 0) {
        const activityUuid = uuidNameSpace(
          outputIds.sort().join("|"),
          RDDMS_COLLABORATION_NAMESPACE
        );
        const activityId = `${context.partition}:work-product-component--Activity:${activityUuid}`;
        const now = new Date().toISOString();
        const activityRecord: OSDUResourceType = {
          id: activityId,
          kind: getKindOrFallback("Activity"),
          acl: { owners: [], viewers: [] },
          legal: { legaltags: [], otherRelevantDataCountries: [] },
          data: {
            Name: "RDDMS Manifest Build",
            Description: `Auto-generated lineage: ${outputIds.length} work-product-component(s) produced from ETP dataspace objects.`,
            Parameters: outputIds.map(id => ({
              ParameterKindID: `${context.partition}:reference-data--ParameterKind:DataObject:`,
              Title: "Output",
              DataObjectParameter: `${id}:`
            })),
            SoftwareSpecifications: [{ SoftwareName: "RDDMS", Version: "1.0" }],
            // ActivityTemplateID intentionally omitted: no matching
            // master-data--ActivityTemplate record is emitted, so referencing
            // one would create a dangling reference that fails OSDU referential
            // integrity (the OSDU Activity schema makes this field optional).
            ActivityTemplateID: undefined,
            ParentActivityID: undefined,
            ParentProjectID: undefined,
            PriorActivityIDs: undefined
          },
          createTime: now,
          modifyTime: now
        } as any;
        // Apply dataspace ACL if available
        const firstDataspace = Object.keys(dataspaceObjects)[0];
        if (firstDataspace) {
          const dsUri = EtpUri.createDataSpaceUri(firstDataspace).uri;
          const aclLegal = context.dataspaceACLs.get(dsUri);
          if (aclLegal) {
            activityRecord.acl = aclLegal.acl ?? activityRecord.acl;
            activityRecord.legal = aclLegal.legal ?? activityRecord.legal;
          }
        }
        context.created.set(activityId, activityRecord);
        logger.info(
          `A3: Auto-generated lineage Activity ${activityUuid} with ${outputIds.length} output(s)`
        );
      }
    }

    manifests.ReferenceData = [];

    const generatedSrn = new Map<string, OSDUResourceType>();
    context.created.forEach((v, k) => {
      generatedSrn.set(k, v);
    });

    // Find referenced objects not currently part of the manifest and not already in OSDU
    let missingSrn: string[] = Array.from(context.srnToUri.keys()).filter(
      k => generatedSrn.get(k) === undefined
    );
    missingSrn = await context.filterOSDUResources(missingSrn);

    const unknownSrn = new Set<string>();
    const processedSrn = new Set<string>();
    if (context.createMissingReferences) {
      while (missingSrn.length > 0) {
        logger.info(
          `[perf] Reference resolution wave: ${missingSrn.length} missing SRNs`
        );

        // 1. Identify which URIs need fetching (not already in objects cache)
        const toResolve: { srn: string; uri: string; etpUri: EtpUri }[] = [];
        for (const k of missingSrn) {
          processedSrn.add(k);
          const objUri = context.srnToUri.get(k);
          if (objUri === undefined) {
            unknownSrn.add(k);
            continue;
          }
          const etpUri = new EtpUri(objUri);
          const c = ResqmlOSDU.get(etpUri.dataObjectType);
          if (c === undefined) {
            bumpSkip(skippedNoConverter, etpUri.dataObjectType);
            unknownSrn.add(k);
            continue;
          }
          if (!objects.has(objUri)) {
            toResolve.push({ srn: k, uri: objUri, etpUri });
          }
        }

        // 2. Batch-fetch uncached objects via ETP (50 per batch). Fire the
        //    batches with bounded concurrency instead of one-at-a-time: a
        //    Well/log-heavy dataspace can need ~20+ batches per wave, and the
        //    old sequential loop paid every ETP round-trip end to end.
        const FETCH_BATCH = 50;
        const FETCH_CONCURRENCY = 8;
        if (toResolve.length > 0) {
          const t0 = Date.now();
          const batches: string[][] = [];
          for (let i = 0; i < toResolve.length; i += FETCH_BATCH) {
            batches.push(toResolve.slice(i, i + FETCH_BATCH).map(r => r.uri));
          }
          let cursor = 0;
          const worker = async (): Promise<void> => {
            while (cursor < batches.length) {
              const batchUris = batches[cursor++];
              try {
                await client.getResolvedObjects(batchUris, objects, false);
              } catch (e: any) {
                logger.warn(`[perf] Batch ETP fetch failed: ${e?.message ?? e}`);
              }
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(FETCH_CONCURRENCY, batches.length) }, () => worker())
          );
          logger.info(
            `[perf] Fetched ${toResolve.length} objects in ${Date.now() - t0}ms`
          );
        }

        // 3. Convert all missing refs (objects now in cache)
        const refConvertOne = async (k: string): Promise<void> => {
          if (unknownSrn.has(k)) return;
          const objUri = context.srnToUri.get(k);
          if (!objUri) {
            unknownSrn.add(k);
            return;
          }
          const etpUri = new EtpUri(objUri);
          const c = ResqmlOSDU.get(etpUri.dataObjectType);
          if (!c) {
            bumpSkip(skippedNoConverter, etpUri.dataObjectType);
            unknownSrn.add(k);
            return;
          }

          const obj = objects.get(objUri);
          if (!obj) {
            unknownSrn.add(k);
            return;
          }

          try {
            const res = await c.convert(objUri, obj, context, client);
            // Override record.kind with resolved version (same as primary loop)
            if (res !== undefined) {
              const resolvedKind = c.osduKind(obj);
              if (resolvedKind) {
                res.kind = resolvedKind;
                const kindParts = resolvedKind.split(":");
                const typeEntity = kindParts[2];
                if (typeEntity && res.id) {
                  const idParts = res.id.split(":");
                  if (idParts.length >= 3) {
                    idParts[1] = typeEntity;
                    res.id = idParts.join(":");
                  }
                }
              }
            }
            const srn = context.uriToSrn(objUri, obj);
            if (res === undefined) {
              bumpSkip(skippedConverterUndefined, etpUri.dataObjectType);
            }
            if (
              srn === undefined ||
              res === undefined ||
              res.id === undefined
            ) {
              unknownSrn.add(k);
            } else {
              const dataspaceUri = EtpUri.createDataSpaceUri(
                etpUri.dataSpace
              ).uri;
              const aclLegal = context.dataspaceACLs.get(dataspaceUri);
              if (aclLegal !== undefined && res !== undefined) {
                res.acl = aclLegal?.acl ?? { owners: [], viewers: [] };
                res.legal = aclLegal?.legal ?? {
                  legaltags: [],
                  otherRelevantDataCountries: []
                };
              }
              generatedSrn.set(`${srn}`, res);
            }
          } catch {
            unknownSrn.add(k);
          }
        };

        // Convert the missing refs with bounded concurrency, overlapping the
        // per-object OSDU existence checks the same way the primary loop does.
        // Matches the primary loop's 32-way width: reference resolution is the
        // same latency-bound ETP round-trip workload.
        const REF_CONCURRENCY = 32;
        let refIndex = 0;
        const refWorker = async (): Promise<void> => {
          for (; ;) {
            const idx = refIndex++;
            if (idx >= missingSrn.length) {
              return;
            }
            await refConvertOne(missingSrn[idx]);
          }
        };
        await Promise.all(
          Array.from(
            { length: Math.min(REF_CONCURRENCY, missingSrn.length) },
            () => refWorker()
          )
        );
        // Only consider NEW references not yet processed or generated
        missingSrn = Array.from(context.srnToUri.keys()).filter(
          k => generatedSrn.get(k) === undefined && !processedSrn.has(k)
        );
        // Remove references that cannot be resolved
        missingSrn = missingSrn.filter(k => !unknownSrn.has(k));
        missingSrn = await context.filterOSDUResources(missingSrn);
      }
    }

    // Cascade-remove records whose references could not be resolved.
    // Skip in best-effort mode (createMissingReferences=true): unresolvable
    // reference-data (UnitOfMeasure, PropertyKind, etc.) is expected to be
    // supplied by the platform and should not invalidate successfully-built WPCs.
    //
    // There is no explicit origin->target edge list, so derive the edges from
    // the serialized records: a record whose JSON embeds the SRN of an
    // unresolved (unknown) object depends on it and must be dropped too. Removal
    // makes the origin itself unresolved, so repeat to a fixpoint (transitive
    // cascade).
    if (!context.createMissingReferences) {
      const recordJson = new Map<string, string>();
      generatedSrn.forEach((rec, srn) => {
        recordJson.set(srn, JSON.stringify(rec));
      });
      let frontier: string[] = Array.from(unknownSrn);
      while (frontier.length > 0) {
        const removed: string[] = [];
        recordJson.forEach((json, srn) => {
          if (!generatedSrn.has(srn)) {
            return;
          }
          if (frontier.some(bad => bad.length > 0 && json.includes(bad))) {
            generatedSrn.delete(srn);
            unknownSrn.add(srn);
            removed.push(srn);
          }
        });
        frontier = removed;
      }
    }

    const toRemove: string[] = [];
    generatedSrn.forEach((v, k) => {
      if (v === undefined) {
        toRemove.push(k);
      }
    });

    // Backfill ACL/legal on any record that slipped through the per-object
    // stamping in the conversion loops. Master-data records synthesized as a
    // side-effect inside other converters (e.g. Well / Wellbore / BoundaryFeature)
    // are added straight to context.created and never receive the dataspace ACL,
    // so Storage rejects them ("acl.viewers / legaltags / otherRelevantDataCountries
    // cannot be empty"). Use the dataspace ACL as the backfill source; records that
    // already carry a non-empty ACL keep their own.
    const fallbackAclLegal = context.dataspaceACLs.values().next().value as
      | DataspaceLegalACL
      | undefined;
    if (fallbackAclLegal !== undefined) {
      for (const [, rec] of generatedSrn) {
        if (rec === undefined) continue;
        const aclEmpty =
          rec.acl === undefined ||
          ((rec.acl.viewers?.length ?? 0) === 0 &&
            (rec.acl.owners?.length ?? 0) === 0);
        const legalEmpty =
          rec.legal === undefined || (rec.legal.legaltags?.length ?? 0) === 0;
        if (aclEmpty && fallbackAclLegal.acl !== undefined) {
          rec.acl = fallbackAclLegal.acl;
        }
        if (legalEmpty && fallbackAclLegal.legal !== undefined) {
          rec.legal = fallbackAclLegal.legal;
        }
      }
    }

    // Deduplicate records by .id before assembling manifest arrays.
    // The generatedSrn Map is keyed by SRN, but the kind override in the
    // primary and reference loops can produce entries with different SRN keys
    // that share the same record .id - the Storage API rejects duplicate IDs
    // within a single PUT batch.
    const seenRecordIds = new Set<string>();

    for (const res of generatedSrn) {
      const id: string = res[0];
      const recordId: string | undefined = res[1]?.id;
      if (recordId && seenRecordIds.has(recordId)) {
        continue; // skip duplicate record
      }
      if (recordId) {
        seenRecordIds.add(recordId);
      }
      if (id.includes("master-data")) {
        manifests.MasterData.push(res[1] as GenericMasterData);
      } else if (id.includes("reference-data")) {
        manifests.ReferenceData.push(res[1] as GenericReferenceData);
      } else {
        if (
          context.spatialPoint !== undefined &&
          res[1].data.SpatialPoint === undefined
        ) {
          res[1].data.SpatialPoint = context.spatialPoint;
        }
        manifests.Data.WorkProductComponents.push(res[1]);
        manifests.Data.WorkProduct?.data?.Components?.push(`${res[0]}:`);
      }
    }

    if (context.spatialPoint !== undefined) {
      if (
        manifests.Data?.WorkProduct?.data !== undefined &&
        manifests.Data.WorkProduct.data.SpatialPoint === undefined
      ) {
        manifests.Data.WorkProduct.data.SpatialPoint = context.spatialPoint;
      }
    }

    // Batch-check existing versions (O(N/20) queries instead of O(N))
    const allIds = Array.from(generatedSrn.keys());
    const versions = await context.getVersions(allIds);
    for (const [id, record] of generatedSrn) {
      const v = versions.get(id);
      if (v !== undefined) {
        record.version = v + 1;
      }
    }

    // Process missing reference data
    const missing = Array.from(context.srnToUri.keys()).filter(
      k => generatedSrn.get(k) === undefined
    );
    if (missing.length > 0 && context.createMissingReferences === false) {
      context.references.forEach(r => {
        missing.push(r);
      });
      if (missing.length > 0) {
        return Promise.reject(
          new EtpError(`Missing reference(s): ${missing}`, ErrorCode.ENOT_FOUND)
        );
      }
    } else {
      const references = await context.filterOSDUReferenceData(
        Array.from(context.references)
      );
      references.forEach(r => {
        const s = r.split(":");
        if (
          s.length > 2 &&
          s[1] === "reference-data--PropertyType" &&
          PropertyTypesIds.has(s[2])
        ) {
          return;
        }
        // Since r is a srn, it ends with ':'. We need to remove it to build the reference id
        const rd = ResqmlOSDU.buildReference(r.slice(0, -1), context);
        if (rd !== undefined) {
          manifests.ReferenceData?.push(rd);
          generatedSrn.set(r, rd);
        }
      });
    }

    // Final target-compatibility pass. Some records carry a schema kind that
    // bypasses getKind() - master-data side-records (e.g. BoundaryFeature) and
    // reference-data records built via buildReference() hardcode their version.
    // When a live target registry is available, reconcile each record's kind
    // against it:
    //   - version drift      -> rewrite to the registered version (id is
    //                           unaffected; the version is not part of the SRN)
    //   - absent WPC type     -> fall back to GenericRepresentation
    //   - absent ref/md type  -> drop the record (soft SRN references become
    //                           dangling, which OSDU tolerates)
    // In standalone/local mode isSchemaRegistered() returns true for everything,
    // so this pass is a no-op there.
    //
    // Snapshot the assembled record counts BEFORE this pass so the build
    // diagnostics can attribute any shrinkage to it (the `created` counter is
    // taken from context.created and cannot see records dropped here).
    const assembledCounts = {
      workProductComponents: manifests.Data?.WorkProductComponents?.length ?? 0,
      masterData: manifests.MasterData?.length ?? 0,
      referenceData: manifests.ReferenceData?.length ?? 0
    };
    let schemaCompatDiag:
      | {
        masterData: { remap: number; drop: number };
        referenceData: { remap: number; drop: number };
        workProductComponents: { remap: number; drop: number };
        suppressed: boolean;
        skipped: boolean;
      }
      | undefined;
    // OFF BY DEFAULT (M26 behaviour): the schema-compatibility pass probes every
    // DISTINCT record kind against the target schema service. Results are cached
    // per kind (both 200 and 404 are cached, see isSchemaRegistered), but on a
    // cold cache the round-trips still add latency and, on whole-dataspace
    // builds, can push past the ~60s edge/LB timeout that fronts the platform
    // ingress (observed on SKUA/Dani builds that regressed from ~57s to >60s ->
    // HTTP 500). The pass is therefore OPT-IN: it runs only when the caller sets
    // `schemaCompat: true`. When forced on it is still auto-skipped for very
    // large datasets (assembled record count over
    // MANIFEST_SCHEMA_COMPAT_MAX_RECORDS, default 500) to stay under the timeout.
    const schemaCompatMaxRecordsRaw =
      process.env.MANIFEST_SCHEMA_COMPAT_MAX_RECORDS;
    const schemaCompatMaxRecords =
      schemaCompatMaxRecordsRaw !== undefined &&
        schemaCompatMaxRecordsRaw !== "" &&
        Number.isFinite(Number(schemaCompatMaxRecordsRaw))
        ? Math.max(0, Number(schemaCompatMaxRecordsRaw))
        : 500;
    const assembledTotal =
      assembledCounts.workProductComponents +
      assembledCounts.masterData +
      assembledCounts.referenceData;
    if (context.schemaCompat !== true) {
      // OFF by default (M26-style fast path): skip the live schema-service kind
      // resolution/normalize pass unless the caller explicitly opts in with
      // `schemaCompat: true`. Every record keeps its original kind - no per-kind
      // schema GETs - which keeps whole-dataspace builds under the ~60s ingress
      // timeout, at the cost of NOT remapping kinds to what the target OSDU has
      // registered (ingestion may reject unknown kinds).
      schemaCompatDiag = {
        masterData: { remap: 0, drop: 0 },
        referenceData: { remap: 0, drop: 0 },
        workProductComponents: { remap: 0, drop: 0 },
        suppressed: false,
        skipped: true
      };
      logger.info(
        "[schema-compat] SKIPPED (off by default; pass schemaCompat:true to " +
        "enable live kind remapping). Ensure the target OSDU has these kinds " +
        "registered or ingestion may reject them."
      );
    } else if (assembledTotal > schemaCompatMaxRecords) {
      // Forced on (schemaCompat:true) but auto-skip very large builds so the
      // per-kind schema GETs cannot push the build past the ~60s ingress
      // timeout. Tune the threshold with MANIFEST_SCHEMA_COMPAT_MAX_RECORDS.
      schemaCompatDiag = {
        masterData: { remap: 0, drop: 0 },
        referenceData: { remap: 0, drop: 0 },
        workProductComponents: { remap: 0, drop: 0 },
        suppressed: false,
        skipped: true
      };
      logger.info(
        `[schema-compat] SKIPPED (schemaCompat:true but large dataset: ` +
        `${assembledTotal} assembled record(s) > ` +
        `MANIFEST_SCHEMA_COMPAT_MAX_RECORDS=${schemaCompatMaxRecords}) to stay ` +
        "under the ~60s ingress timeout."
      );
    } else if (osduUrl && osduUrl !== "http://localhost") {
      const bearer = context.bearer;
      const partition = context.partition;
      const categoryOf = (kind: string): string =>
        (kind.split(":")[2] ?? "").split("--")[0];
      const entityOf = (kind: string): string =>
        (kind.split(":")[2] ?? "").split("--")[1] ?? "";
      const rewriteKindAndId = (rec: any, newKind: string): void => {
        rec.kind = newKind;
        const typeSeg = newKind.split(":")[2];
        if (typeSeg && typeof rec.id === "string") {
          const idParts = rec.id.split(":");
          if (idParts.length >= 3) {
            idParts[1] = typeSeg;
            rec.id = idParts.join(":");
          }
        }
      };
      const resolveKind = async (kind: string): Promise<string | undefined> => {
        if (await isSchemaRegistered(kind, osduUrl, bearer, partition)) {
          return kind;
        }
        const cat = categoryOf(kind);
        // 1) version drift: registered version for the same entity type
        const byEntity = getKind(entityOf(kind));
        if (
          byEntity &&
          byEntity !== kind &&
          categoryOf(byEntity) === cat &&
          (await isSchemaRegistered(byEntity, osduUrl, bearer, partition))
        ) {
          return byEntity;
        }
        // 2) absent work-product-component -> GenericRepresentation
        if (cat === "work-product-component") {
          const generic = getKind("GenericRepresentation");
          if (
            generic &&
            (await isSchemaRegistered(generic, osduUrl, bearer, partition))
          ) {
            return generic;
          }
        }
        // 3) absent reference-data / master-data -> drop
        return undefined;
      };
      const normalizeArray = async (
        arr: any[] | undefined
      ): Promise<{ kept: any[]; remapped: number; dropped: number }> => {
        const kept: any[] = [];
        let remapped = 0;
        let dropped = 0;
        for (const rec of arr ?? []) {
          if (!rec?.kind) {
            kept.push(rec);
            continue;
          }
          const target = await resolveKind(rec.kind);
          if (target === undefined) {
            dropped++;
            continue;
          }
          if (target !== rec.kind) {
            rewriteKindAndId(rec, target);
            remapped++;
          }
          kept.push(rec);
        }
        return { kept, remapped, dropped };
      };

      // Pre-warm the schema-existence cache concurrently. isSchemaRegistered
      // memoizes per kind, but normalizeArray would otherwise trigger the first
      // lookup for each distinct kind SERIALLY (hundreds of records => one slow
      // OSDU schema GET each). Collect every kind resolveKind might query and
      // warm them in parallel so the normalizeArray passes are all cache hits.
      const warmKinds = new Set<string>();
      for (const arr of [
        manifests.MasterData,
        manifests.ReferenceData,
        manifests.Data?.WorkProductComponents
      ]) {
        for (const rec of arr ?? []) {
          const k = (rec as { kind?: string } | undefined)?.kind;
          if (!k) continue;
          warmKinds.add(k);
          const byEntity = getKind(entityOf(k));
          if (byEntity) warmKinds.add(byEntity);
          if (categoryOf(k) === "work-product-component") {
            const g = getKind("GenericRepresentation");
            if (g) warmKinds.add(g);
          }
        }
      }
      const warmResults = await Promise.all(
        Array.from(warmKinds).map(k =>
          isSchemaRegistered(k, osduUrl, bearer, partition)
        )
      );

      // Short-circuit: if EVERY distinct kind got a definitive 404 from the
      // schema service, the service is reachable but has NOTHING registered for
      // this deployment (e.g. RDMS_OSDU_URL points at a bare/misconfigured OSDU
      // instance). Running the normalize passes would then drop 100% of every
      // array only for the per-array fail-safe to revert it all - pure wasted
      // work whose only trace is misleading "drop=all/suppressed" diagnostics.
      // isSchemaRegistered returns TRUE on transient/unreachable errors (and
      // never caches `false`), so `some(true)===false` specifically means
      // "definitive 404 for ALL kinds" - not "network down". Skip the pass.
      const schemaServiceUsable =
        warmResults.length === 0 || warmResults.some(r => r === true);

      // Fail-safe: the schema-compatibility pass must NEVER empty out a
      // non-empty array. A reachable-but-misconfigured schema service (or a
      // partition/version mismatch that returns 404 for legitimately-registered
      // kinds) would otherwise drop EVERY record and ship an empty manifest -
      // exactly the fragile failure mode this build guards against. If a
      // normalize pass would remove 100% of a non-empty array, keep the
      // pre-pass records and warn loudly instead of shipping nothing.
      let schemaCompatSuppressed = false;
      const applyNormalized = (
        label: string,
        input: OSDUResourceType[] | undefined,
        res: { kept: any[]; remapped: number; dropped: number }
      ): any[] => {
        const inN = input?.length ?? 0;
        if (inN > 0 && res.kept.length === 0) {
          logger.warn(
            `[schema-compat] ${label}: normalize would drop ALL ${inN} record(s) ` +
            `- schema service at '${osduUrl}' likely unreachable/misconfigured; ` +
            `KEEPING originals to avoid an empty manifest`
          );
          schemaCompatSuppressed = true;
          return input as any[];
        }
        return res.kept;
      };

      if (!schemaServiceUsable) {
        // Every distinct kind 404'd (see rationale above): skip the normalize
        // passes entirely and keep all records unchanged - no per-record work.
        schemaCompatDiag = {
          masterData: { remap: 0, drop: 0 },
          referenceData: { remap: 0, drop: 0 },
          workProductComponents: { remap: 0, drop: 0 },
          suppressed: false,
          skipped: true
        };
        logger.warn(
          `[schema-compat] SKIPPED: schema service at '${osduUrl}' returned 404 ` +
          `for ALL ${warmKinds.size} distinct kind(s) - nothing registered for ` +
          `this deployment; keeping every record unchanged (no per-record ` +
          `normalize). Verify RDMS_OSDU_URL targets an OSDU whose schema-service ` +
          `has the osdu:wks manifest kinds registered.`
        );
      } else {
        const mdRes = await normalizeArray(manifests.MasterData);
        manifests.MasterData = applyNormalized(
          "MasterData",
          manifests.MasterData,
          mdRes
        );
        const rdRes = await normalizeArray(manifests.ReferenceData);
        manifests.ReferenceData = applyNormalized(
          "ReferenceData",
          manifests.ReferenceData,
          rdRes
        );
        let wpcRemapped = 0;
        let wpcDropped = 0;
        if (manifests.Data?.WorkProductComponents) {
          const wpcInput = manifests.Data.WorkProductComponents;
          const wpcRes = await normalizeArray(wpcInput);
          manifests.Data.WorkProductComponents = applyNormalized(
            "WorkProductComponents",
            wpcInput,
            wpcRes
          );
          wpcRemapped = wpcRes.remapped;
          wpcDropped = wpcRes.dropped;
          // Resync the WorkProduct's Components list with the surviving WPC ids
          // (post-remap/drop, or the reverted originals when the pass was
          // suppressed) so the WorkProduct-centric DAG ingestion stays consistent.
          if (manifests.Data?.WorkProduct?.data) {
            manifests.Data.WorkProduct.data.Components =
              manifests.Data.WorkProductComponents
                .filter(rec => typeof (rec as { id?: unknown }).id === "string")
                .map(rec => `${(rec as { id: string }).id}:`);
          }
        }
        schemaCompatDiag = {
          masterData: { remap: mdRes.remapped, drop: mdRes.dropped },
          referenceData: { remap: rdRes.remapped, drop: rdRes.dropped },
          workProductComponents: { remap: wpcRemapped, drop: wpcDropped },
          suppressed: schemaCompatSuppressed,
          skipped: false
        };
        logger.info(
          `[schema-compat] MasterData(remap=${mdRes.remapped},drop=${mdRes.dropped}) ` +
          `ReferenceData(remap=${rdRes.remapped},drop=${rdRes.dropped}) ` +
          `WorkProductComponents(remap=${wpcRemapped},drop=${wpcDropped})` +
          (schemaCompatSuppressed ? " [SUPPRESSED: kept originals]" : "")
        );
      }
    }

    // Actionable summary of ETP object types that were omitted from the
    // manifest by the converter-registry / converter-skip filters. Sorted by
    // frequency so the highest-value missing converters surface first.
    const sumMap = (m: Map<string, number>): number =>
      Array.from(m.values()).reduce((a, b) => a + b, 0);
    const fmtMap = (m: Map<string, number>): string =>
      Array.from(m.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `${t}×${n}`)
        .join(", ");
    if (
      skippedNoConverter.size > 0 ||
      skippedConverterUndefined.size > 0 ||
      convertFailed.size > 0
    ) {
      logger.info(
        `[skip] no-converter=${sumMap(skippedNoConverter)} [${fmtMap(
          skippedNoConverter
        )}] ` +
        `converter-skipped=${sumMap(skippedConverterUndefined)} [${fmtMap(
          skippedConverterUndefined
        )}] ` +
        `convert-failed=${sumMap(convertFailed)} [${fmtMap(convertFailed)}]`
      );
    }

    // Build-time diagnostics. Surfaced (below) via a non-enumerable property so
    // the caller can echo them in a response header WITHOUT polluting the
    // schema-compliant manifest body. These make an empty/degraded manifest
    // self-explaining even when server logs are unreachable (e.g. cimpl pods).
    const noConverterN = sumMap(skippedNoConverter);
    const converterSkippedN = sumMap(skippedConverterUndefined);
    const convertFailedN = sumMap(convertFailed);
    const createdN = context.created.size;
    const buildDiagnostics = {
      inputObjects: attemptedConversions,
      created: createdN,
      noConverter: noConverterN,
      converterSkipped: converterSkippedN,
      convertFailed: convertFailedN,
      noConverterTypes: Array.from(skippedNoConverter.keys()),
      convertFailedTypes: Array.from(convertFailed.keys()),
      // Post-assembly visibility: `created` is counted before the
      // schema-compatibility pass, so a full `created` with empty final arrays
      // pinpoints that pass (see schemaCompat) rather than conversion.
      assembled: assembledCounts,
      schemaCompat: schemaCompatDiag,
      finalCounts: {
        workProductComponents:
          manifests.Data?.WorkProductComponents?.length ?? 0,
        masterData: manifests.MasterData?.length ?? 0,
        referenceData: manifests.ReferenceData?.length ?? 0
      },
      osduUrl: osduUrl || "(unset)"
    };

    // Loud, actionable warning for the pathological "N eligible inputs -> 0
    // records" case. Previously this shipped as an HTTP 201 with an empty body
    // and zero explanation; now it names the dominant failure mode.
    if (createdN === 0 && attemptedConversions > 0) {
      logger.warn(
        `[manifest] EMPTY RESULT: ${attemptedConversions} object(s) were eligible ` +
        `for conversion but 0 record(s) were produced ` +
        `(no-converter=${noConverterN}, converter-skipped=${converterSkippedN}, ` +
        `convert-failed=${convertFailedN}). ` +
        (convertFailedN > 0
          ? `Dominant cause appears to be converter throws (check OSDU/CRS reachability): [${fmtMap(
            convertFailed
          )}].`
          : noConverterN > 0
            ? `Dominant cause appears to be missing converters: [${fmtMap(
              skippedNoConverter
            )}].`
            : `Converters ran but declined every object.`)
      );
    }

    if (manifests.MasterData.length === 0) {
      manifests.MasterData = undefined;
    }
    if (manifests.ReferenceData.length === 0) {
      manifests.ReferenceData = undefined;
    }

    // Final safety net: guarantee the manifest never ships duplicate
    // WorkProductComponent ids. The primary dedup (seenRecordIds) runs before
    // the schema-compatibility pass, but normalizeArray can REWRITE a WPC id
    // when it remaps an unregistered kind onto GenericRepresentation - and
    // several distinct WPCs (e.g. HorizonControlPoints) can then collapse onto
    // the same id. Duplicate ids fail the atomic OSDU Storage batch, so drop the
    // post-remap collisions here and resync the WorkProduct's Components list to
    // the surviving ids so the DAG ingestion stays consistent.
    if (manifests.Data?.WorkProductComponents) {
      const seenWpcIds = new Set<string>();
      const originalCount = manifests.Data.WorkProductComponents.length;
      const dedupedWpcs = manifests.Data.WorkProductComponents.filter(rec => {
        const id = (rec as { id?: unknown }).id;
        if (typeof id !== "string" || id === "") {
          return true; // keep id-less records untouched
        }
        if (seenWpcIds.has(id)) {
          return false;
        }
        seenWpcIds.add(id);
        return true;
      });
      if (dedupedWpcs.length !== originalCount) {
        logger.warn(
          `[dedup] Dropped ${originalCount -
          dedupedWpcs.length} duplicate WorkProductComponent id(s) from manifest`
        );
        manifests.Data.WorkProductComponents = dedupedWpcs;
        if (manifests.Data?.WorkProduct?.data) {
          manifests.Data.WorkProduct.data.Components = dedupedWpcs
            .filter(rec => typeof (rec as { id?: unknown }).id === "string")
            .map(rec => `${(rec as { id: string }).id}:`);
        }
      }
    }

    // Compute the size in MB of the json representation of manifests
    const size = Buffer.byteLength(JSON.stringify(manifests)) / 1024 / 1024;
    if (size > maxManifestSize) {
      return Promise.reject(
        new EtpError(
          `Manifest size is too large (${size.toFixed(
            2
          )} MB). Please reduce the number of objects to fit in ${maxManifestSize}MB.`,
          ErrorCode.EMAXSIZE_EXCEEDED
        )
      );
    }
    // Attach build diagnostics as a NON-enumerable property so JSON.stringify
    // (and therefore the wire body) ignores it, preserving strict
    // osdu:wks:Manifest schema compliance, while the controller can still read
    // it to emit an X-Manifest-Build-Diagnostics response header.
    Object.defineProperty(manifests, "__buildDiagnostics", {
      value: buildDiagnostics,
      enumerable: false,
      configurable: true,
      writable: false
    });
    return manifests;
  } catch (err: any) {
    logger.error("Manifest creation failed:", err?.message || err);
    logger.error("Stack:", err?.stack);
    return Promise.reject(
      new EtpError(
        "Manifest creation failed: " + (err?.message || "unknown"),
        ErrorCode.EINVALID_STATE
      )
    );
  }
};
