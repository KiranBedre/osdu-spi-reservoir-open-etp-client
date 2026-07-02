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

`dataspaceId`: URL-encoded path (e.g., `maap%2Fdrogon` for `maap/drogon`).

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

Example: `GET /dataspaces/maap%2Fdrogon/resources/resqml20.obj_IjkGridRepresentation`

### Get object content

```
GET /dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}
```

Returns the full XML/JSON content of a data object.

### Get multiple objects

```
POST /dataspaces/multi-resources/get-content
```

Body: `{ "uris": ["eml:///dataspace('maap/drogon')/resqml20.obj_...(uuid)", ...] }`

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
  "uri": "eml:///dataspace('maap/drogon')/witsml21.WellLog(uuid)",
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

## Query & Growing Objects *(new — MR 4)*

Advanced search using ETP Discovery, GrowingObject, and ChannelSubscribe protocols.

### Find resources (metadata only)

```
POST /query/resources/find
```

Body:
```json
{
  "uri": "eml:///dataspace('maap/drogon')",
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
    "eml:///dataspace('maap/drogon')/resqml20.obj_IjkGridRepresentation(uuid1)",
    "eml:///dataspace('maap/drogon')/resqml20.obj_TriangulatedSetRepresentation(uuid2)"
  ],
  "scope": "targets",
  "depth": 2,
  "countObjects": true
}
```

Builds a merged, deduplicated subgraph for multiple URIs in a single ETP session. Returns `{ resources: [...], links: [...] }`.

### Growing object — parts metadata

```
POST /query/growing/metadata
```

Body:
```json
{
  "uri": "eml:///dataspace('maap/witsml')/witsml21.WellLog(uuid)"
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
  "uri": "eml:///dataspace('maap/witsml')/witsml21.WellLog(uuid)",
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
  "uri": "eml:///dataspace('maap/drogon')/witsml21.WellLog(uuid)"
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

## Wells *(new — MR 4)*

Well-centric search across all dataspaces.

### Search wells

```
GET /wells?name=DROGON*&dataspace=maap/drogon&include=logs,trajectories
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
    "dataspace": "maap/drogon",
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

## WITSML *(new — MR 4)*

Query WITSML/EnergyML objects stored in ETP dataspaces.

### Query objects (full XML)

```
POST /witsml/query
```

Body:
```json
{
  "dataspace": "maap/witsml",
  "objectType": "Well"
}
```

Returns full XML body for each matching object. Omit `objectType` to return all objects.

### List objects (metadata only)

```
GET /witsml/{dataspaceId}/objects?type=Well
```

Lightweight listing — returns URI, name, type, timestamp without fetching XML. Much faster for large dataspaces.

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
TX=$(curl -s -X POST .../dataspaces/maap%2Ftest/transactions \
  -H "Authorization: Bearer $TOKEN" | jq -r .transactionId)

# 2. Put objects
curl -X PUT ".../dataspaces/maap%2Ftest/resources?transactionId=$TX" \
  -H "Content-Type: application/json" \
  -d '[{"$type": "resqml20.obj_TriangulatedSetRepresentation", ...}]'

# 3. Put arrays
curl -X PUT ".../dataspaces/maap%2Ftest/resources/arrays?transactionId=$TX" \
  -H "Content-Type: application/json" \
  -d '{"uri": "eml:///...", "pathInResource": "/points", "dimensions": [100,3], "data": [...]}'

# 4. Commit
curl -X PUT ".../dataspaces/maap%2Ftest/transactions/$TX"
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
  "uris": ["eml:///dataspace('maap/drogon')"],
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

- **Default type filter** — only common representation/interpretation types included. Pass `typePatterns: ["*"]` to restore old behavior.
- **Best-effort mode** — partial results returned on converter errors. Check `errors[]` in response.
- **Auto-collaboration UUID** — deterministic UUID v5 from dataspace name (no manual header needed).
- **Milestone versioning** — uses `RDMS_OSDU_MILESTONE` env var (default M27) for OSDU schema versions.

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
| `RDMS_OSDU_MILESTONE` | `M27` | OSDU schema milestone (`M26` or `M27`) |
| `RDMS_ETP_SSL_VERIFY` | `true` | Set `false` for self-signed certs |
