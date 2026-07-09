# CHANGELOG: Bug fixes and Extensions for RDDMS Client

All changes vs upstream Emerson `@osdu/open-etp-client` (base commit: `cfffaa2`).

**Risk legend:** 🐛 bugfix (output values change) · ⚠️ non-additive (existing behavior/API changes) · 🧪 needs integration testing

---

## MR 7 — FIRP Manifest Fixes (`mr/7-firp-manifest-fixes`) 🐛⚠️🧪

Manifest round-trip fidelity improvements (FIRP = Full Information Round-trip Preservation).

### Circular reference resolution 🐛
**File:** `ResqmlClient.ts`
**Problem:** `resolveReferences()` used `resolved.set()` prematurely, causing objects with circular relationships (e.g., mutual DORs between StratigraphicColumn ↔ StratigraphicColumnRank) to be incompletely resolved — missing child references.
**Fix:** Track in-progress resolution with an `inProgress` Set; only mark as resolved after full traversal completes.

### Name enrichment for display labels ⚠️
**Files:** `StructureMap.ts`, `StructureMap22.ts`, `GenericRepresentation.ts`, `GenericRepresentation22.ts`
**Change:** Prepend `InterpretationName` to WPC `Name` for richer display labels in OSDU catalog (e.g., `"Top Draupne - Grid2d_1"` instead of `"Grid2d_1"`).

---

## MR 6 — FIRP Manifest Gaps (`mr/6-firp-manifest-gaps`) ⚠️

### AuthoringSoftware preservation
**File:** `WorkProductComponent.ts`
**Change:** Map `Citation.Format` to `data.ExtensionProperties.AuthoringSoftware` for all WPCs. Enables round-trip identification of source application.

### Default type patterns expanded ⚠️
**File:** `Manifest.ts`
**Change:** Add `*Property` to `DEFAULT_DATASPACE_TYPE_PATTERNS`. Without this, grid models exported without properties lose their attached PORO/PERMX/SW — breaking grid round-trip.

### StructureMap interpreter field
**Files:** `StructureMap.ts`, `StructureMap22.ts`
**Change:** Populate `ExtensionProperties.Interpreter` from the resolved HorizonInterpretation name (parity with SeismicHorizon converter).

---

## MR 5 — Auto-Negotiate Protocols (`mr/5-auto-negotiate-protocols`) ⚠️🧪

### Protocol auto-negotiation
**Files:** `ResqmlClient.ts`, `ETPClient.ts`
**Change:** Always register DiscoveryQuery (13), StoreQuery (14), GrowingObject (6), and ChannelSubscribe (21) handlers. The `RDMS_ETP_EXTENDED_PROTOCOLS` env var is removed — protocols are now negotiated at ETP session open.

### Runtime protocol guard
**File:** `ControllerUtils.ts`
**Change:** `requireProtocol()` checks server-negotiated capabilities at runtime. REST endpoints backed by unsupported protocols return **501 Not Implemented** instead of crashing.

### Swagger cleanup ⚠️
**File:** `Query.controller.ts`
**Change:** Remove duplicate `/health/pwls` routes. Consolidate Swagger tag order (Auth/Health first, domain-specific last). Replace personal dataspace names in examples with `test/`.

---

## MR 4 Addenda — Schema Service & CollaborationProject

### Schema Service query at startup (MR 270 related)
**Files:** `MilestoneKinds.ts`
**Change:** On startup, query OSDU Schema Service for all registered kind versions. M27+ uses live versions from the catalog; M26 falls back to static map. Env var renamed: `RDMS_OSDU_MILESTONE` → `OSDU_MILESTONE`.

### S5: CollaborationProject support (MR 270)
**Files:** `CollaborationProject.ts`, `Manifest.ts`
**Change:** Every manifest build auto-generates a `master-data--CollaborationProject:1.0.0` record from the ETP dataspace. UUID v5 from dataspace name (deterministic). Checks existing OSDU version and bumps on update. Lifecycle reflects lock state.

### Dataspace ACL override fix (`mr/fix-dataspace-acl-override`) 🐛
**File:** `Manifest.ts`
**Problem:** Pre-configured `dataspaceACLs` (e.g., targeting a different OSDU partition) were always overwritten by ETP dataspace customData.
**Fix:** Only read ACL/legal from ETP customData when no override is already set in context.

---

## Bug Fixes

### #67 — TriangulatedSurface node count 3× overcount 🐛⚠️🧪
**File:** `WorkProductComponent.ts`
**Problem:** `IndexableElementCount` reported ~3× the actual node count for triangulated surfaces, causing OSDU validation failures and incorrect array sizing.
**Root cause:** The counter `pNodeCount++` fired on every coordinate value (x, y, z separately) instead of once per 3D point.
**Fix:** Move the increment inside a `mod === 0` branch so it fires once per complete (x,y,z) tuple.

### #126 — Invalid dateTime → HTTP 500 🐛⚠️
**File:** `Json2Xml.ts`
**Problem:** Submitting an invalid date string (e.g. `"not-a-date"`) via `PUT /witsml/store` caused an unhandled `RangeError` from `new Date(...).toISOString()`, returning a 500 to the client.
**Fix:** Added `isNaN(d.getTime())` guard; returns HTTP 400 with a descriptive message instead.

### #130 — DELETE locked dataspace returns 204 🐛⚠️🧪
**File:** `ResqmlClient.ts`
**Problem:** Deleting a locked dataspace appeared successful (204) because a `.catch()` block silently swallowed the ETP `ProtocolException` (code 27 = locked resource).
**Fix:** Removed the overly broad catch; the 403 now propagates to the REST caller.

### CRS-2 — ArealRotation wrong for rotated local CRS 🐛⚠️🧪
**File:** `WorkProductComponent.ts` → `createSpatialInfoFrom2dPoints`
**Problem:** `SpatialArea` bounding box coordinates were incorrect when the RESQML model used a rotated local coordinate reference system. The old code applied a simple `point + offset` translation, ignoring the CRS rotation angle.
**Fix:** Apply the full affine transform (`cosθ·x − sinθ·y + xOffset`, `sinθ·x + cosθ·y + yOffset`) using the areal rotation from the CRS definition.

---

## Non-Additive Behavioral Changes

### #125 — SIGTERM graceful shutdown ⚠️🧪
**Files:** `RestServer.ts`, `ControllerUtils.ts`
**Problem:** When Kubernetes sent SIGTERM during pod scaling or deployment, the process hung until the full grace period expired because no signal handler was registered. Any in-flight ETP transactions were abandoned (no rollback).
**Change:** Register a SIGTERM handler that: (1) stops accepting new requests, (2) rolls back open ETP transactions, (3) exits within 30 seconds. Consumers relying on abrupt termination behavior should verify no side effects.

### S1 — Default manifest type filter ⚠️🧪
**File:** `Manifest.ts`
**Problem:** `buildManifest()` returned every RESQML object (~600 records for a typical Volve-sized model), making the output unusable for most consumers and slow to ingest.
**Change:** Default filter now includes only Interpretations, Representations, and WITSML objects (~90% reduction). To restore previous behavior, pass `typePatterns: ["*"]` in the manifest options.

### A2 — Grid2d routing to StructureMap ⚠️🧪
**Files:** `StructureMap.ts`/`22.ts`, `SeismicBinGrid2Representation*.ts`
**Problem:** A depth-domain `Grid2dRepresentation` associated with a `HorizonInterpretation` fell through to `GenericRepresentation` (losing geological semantics).
**Change:** Now routes to `osdu:wks:work-product-component--StructureMap:1.0.0`. Downstream systems expecting the generic kind will see a different OSDU kind for these objects.

### Manifest builder: best-effort mode ⚠️🧪
**File:** `Manifest.ts`
**Problem:** A single converter error (e.g. malformed XML in one object) aborted the entire manifest build, returning nothing even though 99% of objects were fine.
**Change:** Errors are now caught per-object. Failed objects are logged and skipped; the manifest returns everything that succeeded. Callers should check the `errors[]` array in the response.

---

## CRS Enrichments (additive)

All changes in `WorkProductComponent.ts` → `createSpatialInfoFrom2dPoints` / `createSpatialInfo`.

### Vertical CRS extraction
**Motivation:** OSDU consumers performing 3D coordinate transforms need the vertical datum (e.g. MSL, LAT) but it was never populated.
**v2.0:** Reads `VerticalCrs.EpsgCode` from inline vertical CRS definition.
**v2.2:** Follows the DOR (data object reference) to resolve the vertical CRS object and extracts the EPSG code.

### localFrame metadata
**Motivation:** When RESQML uses a local engineering CRS (origin + rotation), the original frame parameters must be preserved for lossless OSDU→RESQML round-trip reconstruction.
**Output:** Returns all 9 local frame fields (`xOffset`, `yOffset`, `zOffset`, `arealRotation`, `projectedUom`, `verticalUom`, `originX`, `originY`, `originZ`) under the `rddms/localFrame/*` namespace.

### WKT CRS detection
**Motivation:** Models using non-EPSG coordinate systems (e.g. company-internal or WKT-defined) got zero spatial metadata because the code only checked for EPSG codes.
**v2.0:** Detects WKT string in `ProjectedUnknownCrs.Unknown` (heuristic: starts with `PROJCS[`).
**v2.2:** Reads `ProjectedWktCrs.WellKnownText` directly.

### LocalAuthority CRS (v2.2 only)
**Motivation:** RESQML v2.2 introduced `ProjectedLocalAuthorityCrs` for company-managed CRS codes, which had no mapping to OSDU reference data.
**Fix:** Maps the authority + code to an OSDU `CoordinateReferenceSystem` reference-data ID.

---

## New Converters

| Feature | Motivation | Key Files |
|---------|-----------|-----------|
| **M27 Phase 1** (9 schemas) | Upstream used approximate kind mappings (e.g. all organizations → GenericInterpretation), losing semantic distinctions | `StructuralOrganizationInterpretation.ts`…`GridConnectionSetRepresentation22.ts` |
| **SeismicLineGeometry** (#66) | 2D seismic lines had no dedicated OSDU kind; were dropped during manifest | `SeismicLineGeometry.ts` (7 unit tests) |
| **S2: WellLog flattening** | A WellboreFrame with N properties produced N+1 OSDU records; should be 1 WellLog | `WellboreFrameToWellLog.ts` / `22.ts` |
| **S3: MasterData dedup** | Re-ingesting the same EPC created duplicate BoundaryFeature master-data records | `MasterDataBoundaryFeature.ts` / `22.ts` |
| **A1: 15 type registrations** | 15 RESQML types were unregistered — silently skipped during manifest build | `ResqmlOsdu.ts` |
| **A3: Activity generation** | Ingested manifests had no lineage/provenance linking source EPC to output records | `Manifest.ts` |
| **A4+A7: WITSML converters** | Rig, Tubular, FluidsReport, BHARun, WellCompletion had no OSDU mapping | `WitsmlRig.ts`…`WitsmlWellCompletion.ts` |
| **O1: PropertyKind→UnitQuantity** | `UnitQuantityID` was always `undefined` for v2.2 PropertyKinds (QuantityClass lookup missing) | `PropertyType23.ts` |
| **S4: Auto-collaboration** | Every API call required a manual `x-collaboration` header; most callers forgot it | `Manifest.ts` — generates UUID v5 from dataspace name |
| **O4: Retry + array chunking** | Large HDF5 array uploads failed (payload too big); transient 503s crashed the client | `Util.ts`, `ResqmlClient.ts` — exponential backoff + 4MB chunk limit |
| **R4: Converter registry** | No runtime way to discover which RESQML/WITSML types are supported | `registerConverter.ts` + `GET /health/converters` endpoint |
| **#24: SSL config** | Cannot connect to ETP servers with self-signed certificates | `RDMS_ETP_SSL_VERIFY=false` env var in `config.default.env` |
| **#91/#23/#25: OpenAPI fixes** | Response schemas wrong; `x-collaboration` header undocumented | `Manifest.controller.ts` |

---

## ETP Protocol Handlers (new files)

| Protocol | File | Purpose |
|----------|------|---------|
| 13 — DiscoveryQuery | `DiscoveryQueryCustomer.ts` | Find resources by URI pattern with scope/depth/type filtering. Wraps `FindResources` message. |
| 14 — StoreQuery | `StoreQueryCustomer.ts` | Retrieve full DataObject XML/content by URI set. Wraps `FindDataObjects`. |
| 6 — GrowingObject | `GrowingObjectCustomer.ts` | Read/write/delete parts (log curves, trajectory stations) by UID or index range. |
| 7 — GrowingObjectNotification | `GrowingObjectNotificationCustomer.ts` | Subscribe to push notifications when parts are added/changed/deleted. EventEmitter pattern. |
| 21 — ChannelSubscribe | `ChannelSubscribeCustomer.ts` | Real-time streaming subscription for channel data (curves). Supports metadata discovery + range queries. |

All handlers registered in `ResqmlClient.ts` and exposed via REST endpoints below.

---

## REST Endpoints (new)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/query/resources/find` | Find resources by URI + filter (wraps Protocol 13) |
| POST | `/query/objects/find` | Get DataObjects with XML content (wraps Protocol 14) |
| POST | `/query/growing/metadata` | Get growing-object part metadata (Protocol 6) |
| POST | `/query/growing/range` | Get parts by index range (Protocol 6) |
| POST | `/query/channels/metadata` | Get channel metadata for streaming (Protocol 21) |
| PUT | `/witsml/store` | Ingest WITSML XML (v1.3–2.1) via ETP transaction |
| POST | `/witsml/query` | Query WITSML objects by type + filter |
| GET | `/wells?name=&dataspace=&include=` | Cross-dataspace well search with optional include of logs/trajectories |

---

## Test Coverage

| Suite | Count | What it covers |
|-------|-------|----------------|
| `TestCrsAndBugfixes.ts` | 41 | All bug fixes and non-additive changes above (rotation, node count, dateTime, delete, routing, chunking, SIGTERM, type filter, best-effort) |
| `TestManifest.ts` | 12 | Converter registry, collaboration UUID, dedup, SSL toggle, lineage generation |
| `TestSeismicLineGeometry.ts` | 7 | SeismicLine coordinate extraction and kind mapping |
| Other suites (unchanged) | 239 | Pre-existing ETP protocol, client, error mapping, input validation tests |
| **Total** | **299** | All pass via `npm test` |

**Integration tests** (require running ETP server — excluded from `npm test`):
- `TestClient.ts` — end-to-end ETP connection + auth
- `TestProtocols.ts` — all 5 protocol handlers against live server
- `TestWitsmlQuery.ts` — WITSML ingest + query round-trip

Run: `npm run test:integration`
