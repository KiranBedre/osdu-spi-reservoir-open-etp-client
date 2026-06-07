# Discovery & Deep Search — Implementation Guide

> ETP 1.2 Discovery (Protocol 3), DiscoveryQuery (Protocol 13), and REST endpoints.
> Updated: 2026-06-07

---

## Overview

The open-etp-client implements two complementary ETP discovery protocols and
exposes them through REST endpoints designed for both direct use and
integration with external consumers (e.g., ORES GraphQL, OSDU catalog sync).

| Protocol | # | Purpose | REST Exposure |
|----------|---|---------|---------------|
| **Discovery** | 3 | Graph-based resource traversal with edges | `GET /dataspaces/…`, `POST /query/graph/search` |
| **DiscoveryQuery** | 13 | Flat resource enumeration (no edges) | `POST /query/resources/find` |

---

## ETP Protocol Layer

### Discovery (Protocol 3) — `DiscoveryCustomer.ts`

Three messages implemented (customer role):

| Message | Method | Returns |
|---------|--------|---------|
| `GetResources` | `getResources(context, scope, …)` | `Resource[]` |
| `GetResources` (includeEdges=true) | `getGraph(context, scope, …)` | `ResourceGraph {nodes, edges}` |
| `GetDeletedResources` | `getDeletedResources(dataspaceUri, types, filter)` | `DeletedResource[]` |

**Key parameters:**

```typescript
interface ContextInfo {
  uri: string;              // Dataspace or object URI
  depth: number;            // 1 = immediate, N = recursive levels
  dataObjectTypes: string[];// Type filter (e.g., ["resqml20.obj_ContinuousProperty"])
  navigableEdges: RelationshipKind; // Primary, Secondary, or Both
  includeSecondaryTargets: boolean;
  includeSecondarySources: boolean;
}

type ContextScopeKind = "self" | "sources" | "targets" | "sourcesOrSelf" | "targetsOrSelf";
```

**Scope behaviour:**

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
- Combined with `scope=targets` and `dataObjectTypes`, this enables server-side
  deep search without N+1 client calls

### DiscoveryQuery (Protocol 13) — `DiscoveryQueryCustomer.ts`

Single message:

| Message | Method | Returns |
|---------|--------|---------|
| `FindResources` | `findResources(context, scope, filter?, status?)` | `Resource[]` |

Simpler than Discovery — no edge information, no `countObjects`. Designed for
bulk enumeration and OSDU search integration.

### ResqmlClient Convenience Methods

```typescript
// Flat resource lists
client.getResources(context, scope, types?, countObjects?, …)
client.getSources(context, includeSelf?, types?)
client.getTargets(context, includeSelf?, types?)
client.getDeletedResources(dataspaceUri, types?, deleteTimeFilter?)

// Graph with edges
client.getGraph(context, scope, countObjects?, types?, …)

// DiscoveryQuery
client.discoveryQuery.findResources(context, scope, filter?, status?)
```

---

## REST API Endpoints

### Existing Endpoints (enhanced with `depth`)

#### `GET /dataspaces/{id}/resources/all`

List all resources in a dataspace.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `depth` | int | 1 | Recursive traversal depth |
| `dataObjectTypes` | string | — | Comma-separated type filter |
| `countObjects` | bool | false | Include source/target counts |
| `storeLastWriteFilter` | date | — | Only resources modified after this time |
| `$skip`, `$top` | int | — | Pagination |
| `$filter` | string | — | OData-style content filter |

```bash
# All resources, 1 level (default)
curl /dataspaces/maap%2Fdrogon/resources/all

# Deep: all resources + their targets recursively (2 levels)
curl /dataspaces/maap%2Fdrogon/resources/all?depth=2

# Only ContinuousProperty objects, with counts
curl /dataspaces/maap%2Fdrogon/resources/all?dataObjectTypes=resqml20.obj_ContinuousProperty&countObjects=true
```

#### `GET /dataspaces/{id}/graph/all`

Same as above but returns `{resources, links}` with edge information.

```bash
# Full graph with edges, 3 levels deep
curl /dataspaces/maap%2Fdrogon/graph/all?depth=3
```

Response:
```json
{
  "resources": [
    {"uri": "eml:///…", "name": "Grid-1", "sourceCount": 5, "targetCount": 2, …}
  ],
  "links": [
    {"source": "eml:///…/IjkGrid(uuid1)", "target": "eml:///…/LocalCrs(uuid2)", "path": "…"}
  ]
}
```

#### `GET /dataspaces/{id}/resources/{type}/{guid}/targets`

Already supported `depth` parameter — recursive target traversal.

```bash
# All properties attached to a grid (properties are sources of representations)
curl /dataspaces/maap%2Fdrogon/resources/resqml20.obj_IjkGridRepresentation/UUID/sources?depth=2&dataObjectTypes=resqml20.obj_ContinuousProperty,resqml20.obj_DiscreteProperty
```

### New Endpoints

#### `GET /dataspaces/{id}/deleted`

List deleted resources in a dataspace (Discovery Protocol 3, `GetDeletedResources`).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `storeLastWriteFilter` | date | — | Only deletions after this time |
| `dataObjectTypes` | string | — | Comma-separated type filter |

```bash
# All deletions
curl /dataspaces/maap%2Fdrogon/deleted

# Deletions in the last hour
curl /dataspaces/maap%2Fdrogon/deleted?storeLastWriteFilter=2026-06-07T12:00:00Z
```

Response:
```json
[
  {"uri": "eml:///…/resqml20.obj_Well(uuid)", "deletedTime": "2026-06-07T13:45:00.000Z", "customData": {}}
]
```

#### `POST /query/resources/find`

Find resources using DiscoveryQuery Protocol 13. Returns metadata only (no XML body).

```bash
curl -X POST /query/resources/find \
  -H "Content-Type: application/json" \
  -d '{
    "uri": "eml:///dataspace('\''maap/drogon'\'')",
    "scope": "targets",
    "depth": 1,
    "dataObjectTypes": ["resqml22.TriangulatedSetRepresentation"]
  }'
```

#### `POST /query/graph/search` ⭐

**Batch graph search** — the key endpoint for efficient deep search. Builds a
merged, deduplicated subgraph for multiple URIs in a single ETP session.

```bash
curl -X POST /query/graph/search \
  -H "Content-Type: application/json" \
  -d '{
    "uris": [
      "eml:///dataspace('\''maap/drogon'\'')/resqml20.obj_IjkGridRepresentation(uuid1)",
      "eml:///dataspace('\''maap/drogon'\'')/resqml20.obj_TriangulatedSetRepresentation(uuid2)"
    ],
    "scope": "sources",
    "depth": 2,
    "dataObjectTypes": ["resqml20.obj_ContinuousProperty", "resqml20.obj_DiscreteProperty"],
    "countObjects": true
  }'
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `uris` | string[] | *required* | Resource URIs to search from |
| `scope` | string | `"targets"` | `self`, `sources`, `targets`, `sourcesOrSelf`, `targetsOrSelf` |
| `depth` | int | 1 | Recursive traversal depth per URI |
| `dataObjectTypes` | string[] | `[]` | Type filter |
| `countObjects` | bool | false | Include source/target counts |
| `includeSecondaryTargets` | bool | false | Follow weak references |
| `includeSecondarySources` | bool | false | Follow weak references |

Response: merged graph with deduplicated nodes and edges.

```json
{
  "resources": [
    {"uri": "…", "name": "Porosity", "sourceCount": 0, "targetCount": 1, …}
  ],
  "links": [
    {"source": "…/ContinuousProperty(p1)", "target": "…/IjkGrid(uuid1)"}
  ]
}
```

**Why this matters:** Without this endpoint, a deep search across 50 objects
requires 50+ individual REST calls (one per object for sources/targets).
With batch graph search, it's **one call**.

---

## Integration with ORES GraphQL

The ORES GraphQL deep search (`graphql_search.py`) has two backends:

| Backend | When used | Performance |
|---------|-----------|-------------|
| **PostgreSQL direct** | Co-located with ETP server (local dev) | Fast (SQL JOINs) |
| **REST** (via etp-client) | Remote / OSDU ADME deployments | Slower (HTTP round-trips) |

### Before (N+1 pattern)

```
for each object in dataspace:
    GET /resources/{type}/{uuid}/sources        ← N calls
    for each property source:
        GET /resources/{propType}/{propUuid}     ← N×M calls
        GET /resources/{propType}/{propUuid}/arrays  ← N×M calls
```

### After (batch pattern)

```
POST /query/graph/search                        ← 1 call
  { uris: [all candidate URIs],
    scope: "sources",
    depth: 2,
    dataObjectTypes: ["resqml20.obj_ContinuousProperty", ...] }

→ merged graph with all properties + edges
```

### ORES Adaptation Guide

In `app/osdu.py`, add:

```python
async def graph_search(access_token: str, uris: list[str], scope: str = "sources",
                       depth: int = 2, data_object_types: list[str] | None = None) -> dict:
    """POST /query/graph/search — batch graph across multiple URIs."""
    async with _http(timeout=120) as client:
        r = await client.post(
            _rddms_url("/query/graph/search"),
            headers=headers(access_token),
            json={
                "uris": uris,
                "scope": scope,
                "depth": depth,
                "dataObjectTypes": data_object_types or [],
                "countObjects": True,
            },
        )
        r.raise_for_status()
        return r.json()
```

In `app/graphql_search.py`, replace the N+1 loop in `_deep_search_rest` with:

```python
graph = await osdu.graph_search(
    token,
    [r["uri"] for r in candidates],
    scope="sources",
    depth=2,
    data_object_types=["resqml20.obj_ContinuousProperty", "resqml20.obj_DiscreteProperty"],
)
# graph["resources"] has all properties pre-fetched
# graph["links"] has source→target edges
```

---

## Limitations

1. **Depth is server-limited** — the ETP server (C++) ultimately controls max traversal depth. Values > 100 may timeout.
2. **No content in Discovery responses** — Discovery returns metadata (URI, name, counts) not object XML. For property `kind` extraction, a follow-up `GetDataObjects` or `POST /query/objects/find` call is still needed.
3. **Batch graph search is sequential** — URIs are processed in sequence within one ETP session (not parallel). For very large batches (>100 URIs), consider splitting.
4. **Deleted resources depend on server support** — not all ETP server versions track deletions. May return empty results.
5. **Client-side pagination** — ETP does not support server-side pagination. `$skip`/`$top` are applied after fetching all results.

---

## Test Coverage

### Certification Tests — `src/certification/3.DiscoveryProtocol.cert.ts`

15+ test cases covering:
- GetResources from `eml:///` with various scopes
- Type filtering with `dataObjectTypes`
- `countObjects` behaviour
- GetResourcesEdges (graph with edges)
- GetDeletedResources with timestamp filters
- Error cases (invalid URIs, empty context)

### Integration Tests — `src/__tests__/TestProtocols.ts`

Protocol-level tests:
- DiscoveryQuery `findResources` with type and timestamp filters

REST endpoint tests:
- `POST /query/resources/find` — basic + type filter + missing URI rejection
- `POST /query/graph/search` — basic + type filter + deduplication + empty URIs rejection
- `GET /resources/all?depth=N` — depth parameter acceptance
- `GET /graph/all?depth=N` — graph with depth
- `GET /deleted` — deleted resources listing + type filter
