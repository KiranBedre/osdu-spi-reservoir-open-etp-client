import { v5 as uuidNameSpace } from "uuid";

import { Energistics, EtpUri, ResqmlClient, URI } from "../client/ResqmlClient";

import type { IResqmlDataObject } from "../client/ResqmlClient";

import logging from "../common/Logging";
const logger = logging.getLogger("EtpClient");

import { getKindOrFallback } from "./MilestoneKinds";
import {
  DataspaceLegalACL,
  OSDUContext,
  OSDUResourceType
} from "./OsduContext";
import ResqmlOSDU, { EtpDataspaceManifest } from "./ResqmlOsdu";
import {
  CollaborationProjectManifest,
  deriveCollaborationId
} from "./CollaborationProject";
import { getPropertyTypeIDFromResqmlAlias, PropertyTypesIds } from "./PropertyTypes";
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
  "*Activity",          // resqml20.obj_Activity / eml23.Activity
  "*ActivityTemplate",  // resqml20.obj_ActivityTemplate / eml23.ActivityTemplate
  "*PropertySet"        // resqml20.obj_PropertySet -> PersistedCollection (pure grouping container)
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
  "poro", "porosity", "ntg", "multpv",
  // Permeability
  "permx", "permy", "permz", "permxy", "permyz", "permzx",
  "perm", "kx", "ky", "kz",
  // Saturations
  "sw", "sg", "so", "swat", "sgas", "soil",
  "swl", "swu", "sgl", "sgu", "sowcr", "sogcr", "swcr", "sgcr",
  // Region numbers
  "satnum", "eqlnum", "fipnum", "pvtnum", "imbnum", "actnum",
  "endnum", "rocknum", "fluxnum",
  // Transmissibility & multipliers
  "tranx", "trany", "tranz", "multx", "multy", "multz",
  "multx-", "multy-", "multz-", "multregt",
  // Pressure & depth
  "pressure", "depth", "tops", "dz", "dx", "dy",
  // Rock mechanics
  "young", "poisson", "biot",
  // Common output / init
  "rporv", "porv", "fipoil", "fipgas", "fipwat",
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
export function isCanonicalProperty(dataObjectType: string, name: string): boolean {
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
 * 1. `typePatterns` — restricts NON-property types. When omitted, all types
 *    are included. Pass an explicit list (e.g. DEFAULT_DATASPACE_TYPE_PATTERNS)
 *    to restrict to a curated top-level set.
 * 2. `propertyFilter` — controls properties independently of `typePatterns`:
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

        // Create WorkProduct
        // manifests.Data.WorkProduct = WorkProductManifest(
        //   dataspaces[0],
        //   context
        // );
        // manifests.Data.WorkProduct.version = 1;
        currentDataspaces.add(dataspaceId);
        if (!context.dataspaceACLs.has(dataspaceUri)) {
          const aclLegal = getACLForDataspace(dataspace);
          context.dataspaceACLs.set(dataspaceUri, aclLegal);
        }

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
      const dsInfo = await client
        .getDataspaceInfo([dataspaceUri])
        .then(
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
      let resolvedObjects: (IResqmlDataObject | null)[] = [];

      const t0 = Date.now();
      // Batch size: use larger batches to minimize ETP round-trips.
      // The ETP protocol layer already handles message-size splitting internally.
      const BATCH_SIZE = 50;
      while (tmpUris.length > 0) {
        const batch = tmpUris.splice(0, BATCH_SIZE);
        logger.info(`[perf] Fetching batch of ${batch.length} URIs from ${dataspace}, first: ${batch[0]?.substring(batch[0].lastIndexOf('/'))}`);
        try {
          const t1 = Date.now();
          const arr = await client.getResolvedObjects(
            batch,
            objects,
            false
          );
          const batchNulls = arr.filter(o => o === null).length;
          logger.info(`[perf] Batch result: ${arr.length} items, ${batchNulls} nulls, objects map size=${objects.size}, took ${Date.now() - t1}ms`);
          if (batchNulls > 0 && batchNulls === arr.length) {
            // Try single fetch to diagnose
            const testUri = batch[0];
            logger.warn(`[debug] All nulls! Trying single getObjects for: ${testUri}`);
            const singleMap = new Map<string, any>();
            const single = await client.getResolvedObjects([testUri], singleMap, false);
            logger.warn(`[debug] Single result: ${single.length} items, null=${single[0] === null}, singleMap size=${singleMap.size}`);
          }
          resolvedObjects = resolvedObjects.concat(arr);
        } catch (e: any) {
          logger.error(`getResolvedObjects failed for batch: ${batch.map(u => u.substring(u.lastIndexOf('/') + 1)).join(', ')} - ${e?.message ?? e}`);
        }
      }

      const nullCount = resolvedObjects.filter(o => o === null).length;
      const noTypeCount = resolvedObjects.filter(o => o !== null && o?.$type === undefined).length;
      logger.info(`Resolved ${resolvedObjects.length} objects for dataspace ${dataspace} in ${Date.now() - t0}ms (null=${nullCount}, noType=${noTypeCount})`);

      const tConvert = Date.now();
      for (let i = 0; i < resolvedObjects.length; i++) {
        const resObj = resolvedObjects[i];
        if (resObj?.$type === undefined) {
          continue;
        }

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
          logger.warn(`No converter for type: ${etpUri.dataObjectType} (from $type=${resObj.$type})`);
          continue;
        }
        try {
          const tObj = Date.now();
          let res = await c.convert(
            etpUri.uri,
            resolvedObjects[i],
            context,
            client
          );
          const convertMs = Date.now() - tObj;
          if (convertMs > 200) {
            logger.warn(`[perf] Slow converter: ${etpUri.dataObjectType} took ${convertMs}ms`);
          }
          // Override record.kind with the dynamically resolved version.
          // The converter constructor hardcodes a compile-time version, but the
          // platform may have a different version registered. The resolved kind
          // from the registry ensures the record references a schema version
          // that actually exists on the target platform.
          // Also fix record.id prefix when the converter uses a different
          // resource type than the schema (e.g. WPC base class for master-data schemas).
          if (res !== undefined) {
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
          }
          const dataspaceUri = EtpUri.createDataSpaceUri(etpUri.dataSpace).uri;
          const aclLegal = context.dataspaceACLs.get(dataspaceUri);
          if (aclLegal !== undefined && res !== undefined) {
            res.acl = aclLegal?.acl ?? { owners: [], viewers: [] };
            res.legal = aclLegal?.legal ?? {
              legaltags: [],
              otherRelevantDataCountries: []
            };
          }
          if (res !== undefined && res.id) {
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
                      continue;
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
            if (res !== undefined && res.id) {
              context.created.set(res.id, res);
            }
          }
        } catch (convErr: any) {
          // Converter failed for this object - skip it
          logger.error(`Converter failed for ${etpUri.dataObjectType} (${resObj.Uuid}): ${convErr?.message ?? convErr}`);
          continue;
        }
      }
      logger.info(`[perf] Convert ${resolvedObjects.length} objects: ${Date.now() - tConvert}ms`);
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
        logger.info(`A3: Auto-generated lineage Activity ${activityUuid} with ${outputIds.length} output(s)`);
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
        logger.info(`[perf] Reference resolution wave: ${missingSrn.length} missing SRNs`);

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
            unknownSrn.add(k);
            continue;
          }
          if (!objects.has(objUri)) {
            toResolve.push({ srn: k, uri: objUri, etpUri });
          }
        }

        // 2. Batch-fetch uncached objects via ETP (50 per batch)
        const FETCH_BATCH = 50;
        if (toResolve.length > 0) {
          const t0 = Date.now();
          for (let i = 0; i < toResolve.length; i += FETCH_BATCH) {
            const batch = toResolve.slice(i, i + FETCH_BATCH);
            const batchUris = batch.map(r => r.uri);
            try {
              await client.getResolvedObjects(batchUris, objects, false);
            } catch (e: any) {
              logger.warn(`[perf] Batch ETP fetch failed: ${e?.message ?? e}`);
            }
          }
          logger.info(`[perf] Fetched ${toResolve.length} objects in ${Date.now() - t0}ms`);
        }

        // 3. Convert all missing refs (objects now in cache)
        for (const k of missingSrn) {
          if (unknownSrn.has(k)) continue;
          const objUri = context.srnToUri.get(k);
          if (!objUri) { unknownSrn.add(k); continue; }
          const etpUri = new EtpUri(objUri);
          const c = ResqmlOSDU.get(etpUri.dataObjectType);
          if (!c) { unknownSrn.add(k); continue; }

          const obj = objects.get(objUri);
          if (!obj) { unknownSrn.add(k); continue; }

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
            if (srn === undefined || res === undefined || res.id === undefined) {
              unknownSrn.add(k);
            } else {
              const dataspaceUri = EtpUri.createDataSpaceUri(etpUri.dataSpace).uri;
              const aclLegal = context.dataspaceACLs.get(dataspaceUri);
              if (aclLegal !== undefined && res !== undefined) {
                res.acl = aclLegal?.acl ?? { owners: [], viewers: [] };
                res.legal = aclLegal?.legal ?? { legaltags: [], otherRelevantDataCountries: [] };
              }
              generatedSrn.set(`${srn}`, res);
            }
          } catch {
            unknownSrn.add(k);
          }
        }
        // Only consider NEW references not yet processed or generated
        missingSrn = Array.from(context.srnToUri.keys()).filter(
          k => generatedSrn.get(k) === undefined && !processedSrn.has(k)
        );
        // Remove references that cannot be resolved
        missingSrn = missingSrn.filter(k => !unknownSrn.has(k));
        missingSrn = await context.filterOSDUResources(missingSrn);
      }
    }

    // Cascade-remove WPCs whose references could not be resolved.
    // Skip in best-effort mode (createMissingReferences=true): unresolvable
    // reference-data (UnitOfMeasure, PropertyKind, etc.) is expected to be
    // supplied by the platform and should not invalidate successfully-built WPCs.
    if (!context.createMissingReferences) {
      let edges = context.edges.filter(e =>
        unknownSrn.has(e.target.slice(0, -1))
      );
      while (edges.length > 0) {
        unknownSrn.clear();
        edges.forEach(e => {
          if (generatedSrn.delete(e.origin)) {
            unknownSrn.add(e.origin);
          }
        });
        edges = context.edges.filter(e => unknownSrn.has(e.target.slice(0, -1)));
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
    const fallbackAclLegal =
      context.dataspaceACLs.values().next().value as DataspaceLegalACL | undefined;
    if (fallbackAclLegal !== undefined) {
      for (const [, rec] of generatedSrn) {
        if (rec === undefined) continue;
        const aclEmpty =
          rec.acl === undefined ||
          ((rec.acl.viewers?.length ?? 0) === 0 &&
            (rec.acl.owners?.length ?? 0) === 0);
        const legalEmpty =
          rec.legal === undefined ||
          (rec.legal.legaltags?.length ?? 0) === 0;
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
    // that share the same record .id — the Storage API rejects duplicate IDs
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

    if (manifests.MasterData.length === 0) {
      manifests.MasterData = undefined;
    }
    if (manifests.ReferenceData.length === 0) {
      manifests.ReferenceData = undefined;
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
    return manifests;
  } catch (err: any) {
    logger.error("Manifest creation failed:", err?.message || err);
    logger.error("Stack:", err?.stack);
    return Promise.reject(
      new EtpError("Manifest creation failed: " + (err?.message || "unknown"), ErrorCode.EINVALID_STATE)
    );
  }
};
