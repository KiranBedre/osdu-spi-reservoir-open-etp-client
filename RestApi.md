# REST API Reference

Interactive Swagger UI available at the configured root path (default: `http://localhost:8080/api/reservoir-ddms/v2/`).

All endpoints require `Authorization: Bearer <token>` and (in multi-partition mode) a `data-partition-id` header.

---

## Resources

Read-only access to ETP dataspaces, objects, relationships, and data arrays.

### List dataspaces

```
GET /dataspaces
```

Returns all dataspaces on the ETP server.

### Get dataspace info

```
GET /dataspaces/{dataspaceId}/info
```

`dataspaceId`: URL-encoded path (e.g., `foo%2Fdrogon` for `foo/drogon`).

### List resources in a dataspace

```
GET /dataspaces/{dataspaceId}/resources
```

Returns available object types (with counts).

### List all resources

```
GET /dataspaces/{dataspaceId}/resources/all
```

Returns all resources in a dataspace (URI, name, type, timestamps).

### List deleted resources *(new)*

```
GET /dataspaces/{dataspaceId}/deleted
```

Returns resources that have been deleted from a dataspace with deletion timestamps.

### Get resources by type

```
GET /dataspaces/{dataspaceId}/resources/{dataObjectType}
```

Example: `GET /dataspaces/foo%2Fdrogon/resources/resqml20.obj_IjkGridRepresentation`

### Get object content

```
GET /dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}
```

Returns the full XML/JSON content of a data object.

### Get multiple objects

```
POST /dataspaces/multi-resources/get-content
```

Body: `{ "uris": ["eml:///dataspace('foo/drogon')/resqml20.obj_...(uuid)", ...] }`

### Relationship graph

```
GET /dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/targets
GET /dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/sources
GET /dataspaces/{dataspaceId}/graph/{dataObjectType}/{guid}/targets
GET /dataspaces/{dataspaceId}/graph/{dataObjectType}/{guid}/sources
GET /dataspaces/{dataspaceId}/graph/all
```

- `/resources/.../targets` — flat list of referenced objects
- `/graph/.../targets` — full graph with edges and relationship info
- `/graph/all` — complete relationship graph for all objects in a dataspace

### Lock / Unlock dataspace

```
POST   /dataspaces/{dataspaceId}/lock
DELETE /dataspaces/{dataspaceId}/lock
```

---

## Data Arrays (Channel Storage)

ETP stores numeric data (well log curves, grid properties, seismic traces) as **data arrays** attached to objects. Arrays are stored separately from the XML metadata and can be very large (millions of values).

### List arrays for an object

```
GET /dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays
```

Returns array identifiers (`pathInResource`) and dimensions.

### Get array metadata

```
GET /dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays/{pathInResource}/metadata
```

Returns dimensions, data type, and total element count.

### Get array content

```
GET /dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays/{pathInResource}
```

Returns the full numeric array data. For large arrays, the server streams subarrays and reassembles.

### Put array (write)

```
PUT /dataspaces/{dataspaceId}/resources/arrays
```

Body:
```json
{
  "uri": "eml:///dataspace('foo/drogon')/witsml21.WellLog(uuid)",
  "pathInResource": "/WITSML/<uuid>/GR",
  "dimensions": [1000],
  "data": [45.2, 46.1, 47.8, ...]
}
```

- Requires an active transaction (pass `transactionId` query param)
- For subarrays: include `starts` and `counts` fields
- Supports chunking for arrays > 4MB (automatic)

**Typical workflow for channel data:**

1. Start transaction: `POST /dataspaces/{ds}/transactions`
2. Put the XML object: `PUT /dataspaces/{ds}/resources`
3. Put each array: `PUT /dataspaces/{ds}/resources/arrays` (one per channel/mnemonic)
4. Commit: `PUT /dataspaces/{ds}/transactions/{txId}`

---

## Query & Growing Objects *(new — M27)*

Advanced search using ETP Discovery, GrowingObject, and ChannelSubscribe protocols.

### ETP Protocol Context

The query endpoints expose two complementary ETP discovery protocols:

| Protocol | # | Purpose | REST Endpoint |
|----------|---|---------|---------------|
| **Discovery** | 3 | Graph-based resource traversal with edges | `GET /dataspaces/…`, `POST /query/graph/search` |
| **DiscoveryQuery** | 13 | Flat resource enumeration (no edges) | `POST /query/resources/find` |

**Scope parameter values:**

| Scope | What it returns |
|-------|-----------------|
| `self` | Resources directly in the context (e.g., all objects in a dataspace) |
| `targets` | Resources referenced *by* the context object |
| `sources` | Resources that *reference* the context object |
| `targetsOrSelf` | Targets + the context object itself |
| `sourcesOrSelf` | Sources + the context object itself |

**Depth behaviour:**

- `depth=1` — immediate neighbours only
- `depth=N` — recursive traversal up to N levels deep
- Combined with `scope=targets` and `dataObjectTypes`, enables server-side
  deep search without N+1 client calls

### Find resources (metadata only)

```
POST /query/resources/find
```

Body:
```json
{
  "uri": "eml:///dataspace('foo/drogon')",
  "scope": "targets",
  "depth": 1,
  "dataObjectTypes": ["resqml20.obj_IjkGridRepresentation"],
  "modifiedSince": "2026-06-01T00:00:00Z"
}
```

- **scope**: `self`, `sources`, `targets`, `sourcesOrSelf`, `targetsOrSelf`
- **depth**: 1 = direct children, 0 = unlimited
- **modifiedSince**: incremental sync filter
- Uses ETP Discovery Protocol 3

### Find data objects (with content)

```
POST /query/objects/find
```

Same body as `/query/resources/find`. Returns full XML content for each matching object. More expensive — use for bulk export.

### Batch graph search

```
POST /query/graph/search
```

Body:
```json
{
  "uris": [
    "eml:///dataspace('foo/drogon')/resqml20.obj_IjkGridRepresentation(uuid1)",
    "eml:///dataspace('foo/drogon')/resqml20.obj_TriangulatedSetRepresentation(uuid2)"
  ],
  "scope": "sources",
  "depth": 2,
  "dataObjectTypes": ["resqml20.obj_ContinuousProperty", "resqml20.obj_DiscreteProperty"],
  "countObjects": true
}
```

Builds a merged, deduplicated subgraph for multiple URIs in a single ETP session.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `uris` | string[] | *required* | Resource URIs to search from |
| `scope` | string | `"targets"` | `self`, `sources`, `targets`, `sourcesOrSelf`, `targetsOrSelf` |
| `depth` | int | 1 | Recursive traversal depth per URI |
| `dataObjectTypes` | string[] | `[]` | Type filter |
| `countObjects` | bool | false | Include source/target counts |
| `includeSecondaryTargets` | bool | false | Follow weak references |
| `includeSecondarySources` | bool | false | Follow weak references |

Response:
```json
{
  "resources": [
    {"uri": "…", "name": "Porosity", "sourceCount": 0, "targetCount": 1}
  ],
  "links": [
    {"source": "…/ContinuousProperty(p1)", "target": "…/IjkGrid(uuid1)"}
  ]
}
```

**Performance note:** Without this endpoint, deep search across N objects requires N+ individual REST calls. With batch graph search, it's one call. For very large batches (>100 URIs), split into chunks — URIs are processed sequentially within a single ETP session.

### Limitations

- **Depth is server-limited** — ETP server controls max traversal depth. Values > 100 may timeout.
- **No content in Discovery responses** — returns metadata (URI, name, counts) not object XML. For full content, use `POST /query/objects/find`.
- **Client-side pagination** — ETP does not support server-side pagination. `$skip`/`$top` are applied after fetching all results.
- **Deleted resources depend on server support** — not all ETP server versions track deletions.

### Growing object — parts metadata

```
POST /query/growing/metadata
```

Body:
```json
{
  "uri": "eml:///dataspace('foo/witsml')/witsml21.WellLog(uuid)"
}
```

Returns available index ranges, part UIDs, and curve information. Use before fetching range data.

### Growing object — get parts by range

```
POST /query/growing/range
```

Body:
```json
{
  "uri": "eml:///dataspace('foo/witsml')/witsml21.WellLog(uuid)",
  "startIndex": 2500.0,
  "endIndex": 3000.0,
  "includeOverlapping": true
}
```

- **startIndex/endIndex**: depth in meters, or microseconds for time-indexed objects
- Returns part data for the requested interval
- Uses ETP GrowingObject Protocol 6

### Channel metadata

```
POST /query/channels/metadata
```

Body:
```json
{
  "uri": "eml:///dataspace('foo/drogon')/witsml21.WellLog(uuid)"
}
```

Discovers available channels (curves): names, units of measure, data kinds, index info. Uses ETP ChannelSubscribe Protocol 21.

**Example response:**
```json
[
  { "channelId": 1, "channelName": "GR", "uom": "gAPI", "dataKind": "float64" },
  { "channelId": 2, "channelName": "RHOB", "uom": "g/cm3", "dataKind": "float64" },
  { "channelId": 3, "channelName": "NPHI", "uom": "m3/m3", "dataKind": "float64" }
]
```

---

## Write

Create, update, and delete ETP data objects.

### Put objects

```
PUT /dataspaces/{dataspaceId}/resources
```

Body: JSON array of Energistics objects (must include `$type` field).

Requires an active transaction (pass `transactionId` query param) or operates in auto-commit mode.

### Delete object

```
DELETE /dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}?transactionId=...
```

### Create dataspace

```
POST /dataspaces
```

Body: `{ "dataspaces": ["team/project-name"] }`

### Clone dataspace

```
POST /dataspaces/{dataspaceId}/clone
```

Body: `{ "target": "team/clone-name" }`

### Delete dataspace

```
DELETE /dataspaces/{dataspaceId}
```

Returns 403 if dataspace is locked (breaking change from MR 3).

### Upload EPC + H5 *(new)*

```
POST /dataspaces/{dataspaceId}/epc/upload
```

Upload a RESQML EPC file (ZIP with XML objects) and an optional HDF5 companion file.
The endpoint unzips the EPC, parses all XML objects from `[Content_Types].xml`,
reads referenced array data from the H5 file, and ingests everything into the
target dataspace within a transaction.

**Content-Type:** `multipart/form-data`

| Field | Required | Description |
|-------|----------|-------------|
| `epc` | yes | EPC file (ZIP archive containing RESQML/EML XML) |
| `h5` | no | HDF5 file with array data referenced by the XML objects |

**Query parameters:**

| Param | Required | Description |
|-------|----------|-------------|
| `transactionId` | no | Use an existing transaction. If omitted, auto-creates and commits. |
| `autoIngest` | no | Auto-register in OSDU catalog after ingest. Values: `false` (default), `true`/`records` (direct Storage Service PUT), `workflow` (submit to OSDU Ingestion Workflow DAG). |

**Processing flow:**

1. Validate file sizes against configured limits
2. Unzip EPC → parse `[Content_Types].xml` manifest
3. Extract XML objects, identify `EpcExternalPartReference` entries
4. Scan XML for `<Hdf5Dataset>` blocks → collect H5 dataset paths
5. Open H5 file with h5wasm, pre-scan dataset metadata
6. Start transaction (or reuse caller's)
7. PUT objects in batches of 100 (avoids ETP message size limits)
8. PUT arrays one-by-one from H5 file (bounded memory)
9. Commit transaction
10. Clean up temp files

**Example:**

```bash
curl -X POST ".../dataspaces/demo%2Fvolve/epc/upload?autoIngest=true" \
  -H "Authorization: Bearer $TOKEN" \
  -F "epc=@model.epc" \
  -F "h5=@model.h5"
```

**Response:**
```json
{
  "success": true,
  "objectsStored": 42,
  "arraysStored": 156,
  "skippedArrays": 0,
  "objects": [
    { "objectType": "resqml20.obj_IjkGridRepresentation", "uuid": "9a487aca-...", "title": "flow_simulation_grid" }
  ],
  "catalogIngestion": {
    "status": "completed",
    "mode": "records",
    "recordCount": 38
  }
}
```

**Auto-ingest modes:**

| Mode | Behavior | Latency | When to use |
|------|----------|---------|-------------|
| `false` (default) | No catalog registration | 0 | Manual manifest workflow, SoE dataspaces |
| `true` / `records` | Builds manifest → pushes records via `PUT /api/storage/v2/records` | +5-30s | **Default for SoR** — data immediately searchable |
| `workflow` | Builds manifest → submits to Airflow `Osdu_ingest` DAG | +5-30s (response), +30-90s (indexed) | Environments requiring audit trail or platform-managed ingestion |

> **Note:** `autoIngest` requires internal transaction (omit `transactionId`). When using an external transaction, the data may not be committed yet, so auto-ingest is skipped.
```

**Size limits** (configurable via env vars):

| Limit | Default | Env var |
|-------|---------|--------|
| EPC file size | 200 MB | `RDMS_EPC_MAX_SIZE_MB` |
| H5 file size | 2 GB | `RDMS_H5_MAX_SIZE_MB` |
| Max objects per EPC | 10,000 | `RDMS_EPC_MAX_OBJECTS` |

**Performance notes:**

- H5 file is written to disk (multer disk storage), not buffered in memory
- Arrays are read and sent one at a time to bound memory usage
- Objects are batched in groups of 100 for PutDataObjects calls
- Large arrays are automatically chunked by the ETP layer (~10 MB per WebSocket message)
- Duplicate H5 dataset references (same path + external part UUID) are deduplicated

---

## Transactions

ETP transaction lifecycle. Required for write operations to ensure atomicity.

### Start transaction

```
POST /dataspaces/{dataspaceId}/transactions
```

Returns `{ "transactionId": "uuid" }`. Pass this ID to write/array endpoints.

Transactions auto-rollback after timeout (default 300s) if not committed.

### Commit

```
PUT /dataspaces/{dataspaceId}/transactions/{transactionId}
```

### Rollback

```
DELETE /dataspaces/{dataspaceId}/transactions/{transactionId}
```

**Full write workflow example:**

```bash
# 1. Start transaction
TX=$(curl -s -X POST .../dataspaces/foo%2Ftest/transactions \
  -H "Authorization: Bearer $TOKEN" | jq -r .transactionId)

# 2. Put objects
curl -X PUT ".../dataspaces/foo%2Ftest/resources?transactionId=$TX" \
  -H "Content-Type: application/json" \
  -d '[{"$type": "resqml20.obj_TriangulatedSetRepresentation", ...}]'

# 3. Put arrays
curl -X PUT ".../dataspaces/foo%2Ftest/resources/arrays?transactionId=$TX" \
  -H "Content-Type: application/json" \
  -d '{"uri": "eml:///...", "pathInResource": "/points", "dimensions": [100,3], "data": [...]}'

# 4. Commit
curl -X PUT ".../dataspaces/foo%2Ftest/transactions/$TX"
```

---

## Manifest

Generate OSDU-compatible manifests from ETP data.

### Build manifest

```
POST /manifests/build
```

Body:
```json
{
  "uris": ["eml:///dataspace('foo/drogon')"],
  "typePatterns": ["resqml20.obj_*Representation", "resqml20.obj_*Interpretation"],
  "createMissingReferences": true,
  "tags": { "project": "drogon" }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `uris` | yes | Dataspace URIs or individual object URIs |
| `typePatterns` | no | Wildcard filter (default: common types, use `["*"]` for all) |
| `createMissingReferences` | no | Create placeholder records for unresolved DORs |
| `tags` | no | OSDU tags to apply to all records |

**Key behaviors (MR 3 changes):**

- **Default type filter** — only common representation/interpretation types included. Pass `typePatterns: ["*"]` for all.
- **Smart property inclusion** — properties with canonical OSDU/PWLS names (porosity, permeability, saturation, etc.) are auto-included even without explicit `*Property` pattern. Non-canonical properties are excluded to avoid manifest bloat.
- **Best-effort mode** — partial results returned on converter errors. Check `errors[]` in response.
- **Auto-collaboration UUID** — deterministic UUID v5 from dataspace name (no manual header needed).
- **Milestone versioning** — uses `OSDU_MILESTONE` env var (default M27) for OSDU schema versions.
- **Transmissibility detection** — GridConnectionSet records report `HasTransmissibilityMultipliers` in ExtensionProperties when attached transmissibility properties are found.
- **WellLog depth range** — WellboreFrame → WellLog converter populates TopMeasuredDepth/BottomMeasuredDepth from frame index array.

**Supported source domains:**

- RESQML 2.0.1 (`resqml20.obj_*`) — grids, interpretations, representations, properties
- RESQML 2.2 (`resqml22.*`) — same + ReservoirCompartmentInterpretation, StreamlinesFeature
- PRODML 2.3 (`prodml23.*`) — FluidCharacterization → FluidModel, TimeSeriesData → ProductionValues
- WITSML 2.1 (`witsml21.*`) — Well, Wellbore, Log, Trajectory, Rig, Tubular, FluidsReport, BHARun, WellCompletion
- EML 2.3 (`eml23.*`) — Activity, ActivityTemplate, PropertyKind, DataobjectCollection, ColumnBasedTable

Use `GET /health/converters` to list all registered source types and their target OSDU kinds.

---

## Authentication

### Get token info

```
GET /auth/token
```

Returns the decoded JWT claims for the current bearer token.

---

## Health

### Liveness / Readiness

```
GET /health/liveness
GET /health/readiness
```

### Server info

```
GET /health/info
```

### List registered converters *(new — MR 2)*

```
GET /health/converters
```

Returns all RESQML/WITSML → OSDU converter mappings with supported versions.

### PWLS status

```
GET /health/pwls
POST /health/pwls/catalog
```

---

# Non-Core / Domain-Specific Endpoints

The following endpoints provide domain-specific functionality for WITSML well data,
well-centric search, and PWLS curve standardization. They are not part of the core
ETP/RESQML data management API but are useful for WITSML-oriented workflows.

---

## Wells

Well-centric search across all dataspaces with automatic hierarchy resolution.

### Search wells

```
GET /wells?name=DROGON*&dataspace=foo/drogon&include=logs,trajectories
```

| Param | Required | Description |
|-------|----------|-------------|
| `name` | yes | Well name pattern (`*` wildcard, case-insensitive) |
| `dataspace` | no | Restrict to one dataspace (faster) |
| `include` | no | Comma-separated: `logs`, `trajectories`, `channelSets` |

**Example response:**
```json
[
  {
    "name": "DROGON-1",
    "uuid": "abc-123",
    "dataspace": "foo/drogon",
    "typeName": "witsml21.Well",
    "wellbores": [{ "uuid": "...", "name": "WB-1", "typeName": "witsml21.Wellbore" }],
    "logs": [{ "uuid": "...", "name": "GR_LOG", "typeName": "witsml21.WellLog" }],
    "trajectories": [],
    "channelSets": []
  }
]
```

Searches WITSML 2.1 Wells first, falls back to RESQML WellboreFeature. Resolves child hierarchy via ETP graph traversal.

---

## WITSML

Query and store WITSML/EnergyML objects in ETP dataspaces.

### Query objects (full XML)

```
POST /witsml/query
```

Body:
```json
{
  "dataspace": "foo/witsml",
  "objectType": "Well"
}
```

Returns full XML body for each matching object. Omit `objectType` to return all objects.

### List objects (metadata only)

```
GET /witsml/{dataspaceId}/objects?type=Well
```

Lightweight listing — returns URI, name, type, timestamp without fetching XML. Much faster for large dataspaces.

### Store WITSML objects

```
PUT /witsml/store?transactionId=<optional>
```

Body:
```json
{
  "dataspace": "foo/witsml",
  "xml": "<Well xmlns=\"http://www.energistics.org/energyml/data/witsmlv2\" uuid=\"...\">...</Well>"
}
```

Parses WITSML 2.1 (or 1.4.1 container) XML, stores as ETP data objects, and automatically
extracts embedded channel data (log curves, trajectory stations) as ETP data arrays.

**Key features:**

- **Auto-transaction**: If no `transactionId` is provided, wraps the write in an internal transaction (start → put → commit). If provided, the caller manages commit/rollback.
- **WITSML 1.4.1 support**: Detects plural container wrappers (`<wells>`, `<logs>`, etc.) and splits into individual WITSML 2.1 objects with deterministic UUID v5 from uid.
- **Channel data extraction**: Automatically extracts `<logData><data>` rows (1.4.1) or ChannelSet data (2.1) as separate ETP data arrays, and injects `ExternalDataArrayPart` references into the XML.
- **Trajectory support**: Extracts MD/Inclination/Azimuth from `<trajectoryStation>` elements.

**Example — store a well log with channel data:**

```bash
curl -X PUT ".../witsml/store" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "dataspace": "maap/witsml",
    "xml": "<Log xmlns=\"http://www.energistics.org/energyml/data/witsmlv2\" uuid=\"a1b2c3d4-...\">...</Log>"
  }'
```

**Response:**
```json
{
  "success": true,
  "stored": [{ "objectType": "Log", "uuid": "a1b2c3d4-...", "title": "GR_LOG" }],
  "arraysStored": 2
}
```

---

## PWLS (Parameter/Well Log Standard)

Curve mnemonic resolution and validation against PWLS v4.0 catalog.

### Status

```
GET /pwls/status
```

### Resolve mnemonic

```
GET /pwls/resolve?mnemonic=GR&vendor=SLB
```

Maps a vendor-specific curve mnemonic to PWLS standard.

### Validate curves

```
POST /pwls/validate
```

Body: `{ "curves": [{"mnemonic": "GR", "uom": "gAPI"}, ...] }`

### Load vendor catalog

```
POST /pwls/catalog
```

Body: vendor catalog JSON (SLB format supported).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RDMS_ETP_HOST` | — | ETP server hostname |
| `RDMS_ETP_PORT` | `9002` | ETP server port |
| `RDMS_ETP_PROTOCOL` | `wss` | `ws` or `wss` |
| `RDMS_REST_PORT` | `8080` | REST API port |
| `RDMS_REST_ROOT_PATH` | `/api/reservoir-ddms/v2/` | Base path |
| `RDMS_DATA_PARTITION_MODE` | `single` | `single` or `multi` |
| `OSDU_MILESTONE` | `M27` | OSDU schema milestone (`M26` or `M27`) |
| `RDMS_ETP_SSL_VERIFY` | `true` | Set `false` for self-signed certs |
| `RDMS_EPC_MAX_SIZE_MB` | `200` | Max EPC upload file size (MB) |
| `RDMS_H5_MAX_SIZE_MB` | `2048` | Max H5 upload file size (MB) |
| `RDMS_EPC_MAX_OBJECTS` | `10000` | Max objects allowed per EPC upload |
