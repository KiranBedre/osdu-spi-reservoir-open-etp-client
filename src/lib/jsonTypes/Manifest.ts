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
 * Default type patterns applied when indexing entire dataspaces without
 * explicit typePatterns. Focuses on discovery-worthy types (features,
 * interpretations, representations, wells) and excludes bulk properties
 * to avoid manifest bloat. Properties with canonical OSDU names are
 * included automatically via a secondary filter (see createManifest).
 *
 * Pass ["*"] to index all types, or ["*Property", ...DEFAULT_DATASPACE_TYPE_PATTERNS]
 * to include ALL properties regardless of name.
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

/** Property type pattern for secondary filter matching */
const PROPERTY_TYPE_PATTERN = /Property$/i;

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
 * Create a manifest for a list of uris
 *
 * @param {ResqmlClient} client linked to ETP server
 * @param {URI[]} uris List of URIS to add as work product components
 * @param {OSDUContext} context OSDU related information
 * @param {string[]} [typePatterns] Optional list of type patterns to filter the URIs.
 *   When undefined, DEFAULT_DATASPACE_TYPE_PATTERNS is used for dataspace-level URIs.
 *   Pass ["*"] to index all types.
 * @param {number} [maxManifestSize] Optional maximum size of the manifest in MB, default is 1000
 * @param {PropertyFilter} [propertyFilter] Controls property inclusion:
 *   - "canonical" (default): include properties with standard names (PWLS, OSDU, simulator)
 *   - "none": exclude all properties
 *   - "all": include all properties regardless of name
 * @return {Promise<Manifest>}
 */
export const createManifest = async (
  client: ResqmlClient,
  uris: URI[],
  context: OSDUContext,
  typePatterns?: string[],
  maxManifestSize: number = 1000,
  propertyFilter: PropertyFilter = "canonical"
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

    const effectivePatterns = typePatterns ?? DEFAULT_DATASPACE_TYPE_PATTERNS;
    const matchPatterns: RegExp[] = effectivePatterns.map(
      t => new RegExp(t.replaceAll("*", "\\w*").replaceAll("?", "\\w?"))
    );

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
        if (matchPatterns.length > 0) {
          dataspaceUris = dataspaceUris.filter(f => {
            const u: EtpUri = new EtpUri(f.uri);
            for (const p of matchPatterns) {
              if (u.dataObjectType.match(p)) {
                return true;
              }
            }
            // Property inclusion based on propertyFilter setting
            if (PROPERTY_TYPE_PATTERN.test(u.dataObjectType)) {
              if (propertyFilter === "none") return false;
              if (propertyFilter === "all") return true;
              // "canonical": include only properties with standard names
              return isCanonicalProperty(u.dataObjectType, f.name);
            }
            return false;
          });
        }
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

    // A3: Auto-generate lineage Activity record for this manifest build
    if (context.created.size > 0 && context.generateLineageActivity !== false) {
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
            ActivityTemplateID: `${context.partition}:master-data--ActivityTemplate:RDDMSManifestBuild:`,
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

    for (const res of generatedSrn) {
      const id: string = res[0];
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
