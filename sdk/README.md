# REST SDK - `RddmsClient`

Typed TypeScript SDK for the Reservoir DDMS REST API.

## Why this SDK?

| Approach                     | Protocol               | Complexity                                        | Maintenance                           |
| ---------------------------- | ---------------------- | ------------------------------------------------- | ------------------------------------- |
| **FESAPI** (C++)             | ETP 1.2 binary         | Compile toolchain, XML schemas, HDF5 linking      | Manual                                |
| **PyETP** (Python)           | ETP 1.2 binary         | Incomplete, raw protocol knowledge needed         | Manual                                |
| **ResqmlClient** (this repo) | ETP 1.2 WebSocket/Avro | Full-featured but requires ETP session management | Manual                                |
| **RddmsClient** (this SDK)   | **HTTP/JSON**          | **Typed fetch calls - no protocol knowledge**     | **Auto-maintained from OpenAPI spec** |

The existing `ResqmlClient` talks raw ETP 1.2 (WebSocket + Avro binary frames)
directly to the ETP server. It is powerful but requires understanding of the
ETP protocol, session lifecycle, and Avro serialization.

`RddmsClient` talks HTTP/JSON to the REST gateway (this service, already running).
The gateway handles all ETP complexity. Users just call typed methods and get JSON
back.

```mermaid
graph TD
    A["<b>Your code</b><br/><code>const pts = await rddms.resources.get(ds, type, guid);</code>"]
    -->|"HTTP/JSON (this SDK)"| B["<b>open-etp-client REST API</b> (NestJS, already running)<br/>Swagger UI at /api/reservoir-ddms/v2/"]
    -->|"WebSocket/Avro ETP 1.2 (handled internally)"| C["<b>ETP Server</b> (C++ binary, PostgreSQL)"]
```

## Quick Start

```typescript
import { RddmsClient } from "./sdk";

const rddms = new RddmsClient({
  baseUrl: "http://localhost:8080/api/reservoir-ddms/v2",
  partitionId: "dev" // data-partition-id header
  // token: '...',             // omit to auto-fetch from /auth/token
});

// List dataspaces
const dataspaces = await rddms.dataspaces.list();

// Atomic write (auto-transaction)
await rddms.atomicWrite("demo/test", [crs, hdfProxy, pointSet], [coordArray]);

// Read object as JSON
const obj = await rddms.resources.get(
  "demo/test",
  "resqml20.obj_PointSetRepresentation",
  guid
);

// Read array data
const arr = await rddms.arrays.get(
  "demo/test",
  "eml20.obj_EpcExternalPartReference",
  hdfGuid,
  arrayPath
);
console.log(arr.data.data); // [0, 0, 0, 1, 1, 1, ...]
```

## API Reference

### Constructor

```typescript
new RddmsClient(options: RddmsClientOptions)
```

| Option        | Type                    | Default     | Description                 |
| ------------- | ----------------------- | ----------- | --------------------------- |
| `baseUrl`     | `string`                | -           | Full REST API URL           |
| `partitionId` | `string`                | `'opendes'` | `data-partition-id` header  |
| `token`       | `string`                | auto-fetch  | Bearer token (omit for dev) |
| `headers`     | `Record<string,string>` | `{}`        | Extra headers               |

### Namespaces

#### `rddms.health`

| Method          | Returns    | Description                |
| --------------- | ---------- | -------------------------- |
| `.readiness()`  | `boolean`  | ETP server reachable?      |
| `.liveness()`   | `boolean`  | Service alive?             |
| `.info()`       | `object`   | Server version, protocols  |
| `.converters()` | `object[]` | Registered type converters |

#### `rddms.dataspaces`

| Method                            | Returns    | Description       |
| --------------------------------- | ---------- | ----------------- |
| `.list()`                         | `object[]` | All dataspaces    |
| `.create(input[])`                | `string[]` | Create dataspaces |
| `.info(ds)`                       | `object`   | Metadata for one  |
| `.delete(ds)`                     | `void`     | Delete            |
| `.clone(ds, {targetDataspaceId}, opts?)` | `string` or summary | Duplicate, or `intoExisting: true` to copy content into an existing dataspace |
| `.lock(ds)` / `.unlock(ds)`       | `boolean`  | Read-only toggle  |

#### `rddms.resources`

| Method                            | Returns             | Description          |
| --------------------------------- | ------------------- | -------------------- |
| `.types(ds)`                      | `TypeCount[]`       | Type summary         |
| `.list(ds, opts?)`                | `ResourceSummary[]` | All resources        |
| `.listByType(ds, type, opts?)`    | `ResourceSummary[]` | By type              |
| `.get(ds, type, guid, opts?)`     | `object[]`          | Full JSON content    |
| `.getMultiple(uris, opts?)`       | `object[]`          | Batch get by URI     |
| `.put(ds, objects, opts?)`        | `boolean`           | Write objects        |
| `.delete(ds, type, guid, opts?)`  | `void`              | Delete object        |
| `.targets(ds, type, guid, opts?)` | `ResourceSummary[]` | Forward refs         |
| `.sources(ds, type, guid, opts?)` | `ResourceSummary[]` | Back refs            |
| `.validate(ds)`                   | `object`            | XSD + DOR validation |

#### `rddms.graph`

| Method                            | Returns       | Description  |
| --------------------------------- | ------------- | ------------ |
| `.all(ds, opts?)`                 | `GraphResult` | Full graph   |
| `.targets(ds, type, guid, opts?)` | `GraphResult` | Target graph |
| `.sources(ds, type, guid, opts?)` | `GraphResult` | Source graph |

#### `rddms.arrays`

| Method                              | Returns       | Description            |
| ----------------------------------- | ------------- | ---------------------- |
| `.list(ds, type, guid)`             | `object[]`    | List arrays for object |
| `.metadata(ds, type, guid, path)`   | `object`      | Type + dimensions      |
| `.get(ds, type, guid, path, opts?)` | `ArrayResult` | Array data             |
| `.put(ds, arrays, opts?)`           | `boolean[]`   | Write arrays           |
| `.compute(ds, body, opts?)`         | `object`      | Server-side stats / reduce / where / where-multi / arith (`async: true` queues a job) |

#### `rddms.compute`

| Method         | Returns    | Description                 |
| -------------- | ---------- | --------------------------- |
| `.jobs()`      | `object[]` | List queued compute jobs    |
| `.job(id)`     | `object`   | One job (status + result)   |
| `.cancel(id)`  | `object`   | Cancel a job                |

#### `rddms.transactions`

| Method                | Returns   | Description      |
| --------------------- | --------- | ---------------- |
| `.start(ds, opts?)`   | `string`  | Transaction UUID |
| `.commit(ds, txId)`   | `boolean` | Commit           |
| `.rollback(ds, txId)` | `boolean` | Rollback         |

#### `rddms.query`

| Method                  | Returns               | Description                                                                                          |
| ----------------------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| `.findResources(input)` | `FindResourcesResult` | URI-based search; `uri` may be an array (batch), `includeContent` inlines objects, `includeEdges` adds links |
| `.growing(input)`       | `GrowingObjectResult` | WellLog/Trajectory parts metadata, parts in `[startIndex, endIndex]`, `includeChannels` adds channel metadata |

#### `rddms.cypher`

Read-only openCypher over the RESQML graph — the relationship/lineage companion
to `graph` and `graphql` (nodes = RESQML resources, relationships = inferred
DataObjectReference roles). Writes and `WITH`/`UNWIND`/`CALL`/`OPTIONAL MATCH`
are rejected (HTTP 400).

| Method                            | Returns        | Description                 |
| --------------------------------- | -------------- | --------------------------- |
| `.run(ds, query, parameters?)`    | `CypherResult` | Pattern-match / traversal   |

```ts
// Everything within 5 hops of a grid
const res = await rddms.cypher.run(
  "demo/drogon",
  "MATCH p = (g {id: $gridId})-[*1..5]-(x) RETURN p",
  { gridId: "0c8a1e2f-3b7d-4e56-9a81-2f6c4b0d9e73" }
);
```

#### `rddms.sparql`

Read-only SPARQL 1.1 over the **same RDF** the `/rdf/*` endpoints publish — the
linked-data companion to `cypher` (traversal) and `graphql` (record retrieval).
Subjects are ETP URIs; `rdf:type` is the RESQML class, `rdfs:label` the name,
and references appear as `rddms:references` plus a role-specific predicate.
`SELECT`/`ASK` return W3C SPARQL JSON; `CONSTRUCT`/`DESCRIBE` return structured
`triples` (plus an `rdf` string when `format` is `turtle`/`jsonld`). Updates,
`OPTIONAL`, `UNION`, `BIND`, `VALUES`, `SERVICE` and named graphs are rejected
(HTTP 400).

| Method                        | Returns        | Description                      |
| ----------------------------- | -------------- | -------------------------------- |
| `.run(ds, query, format?)`    | `SparqlResult` | SELECT / ASK / CONSTRUCT / DESCRIBE |

```ts
// Which properties support the grid?
const res = await rddms.sparql.run(
  "demo/drogon",
  `SELECT ?name WHERE {
     ?p rddms:supportingRepresentation ?g .
     ?g a rddmst:resqml20.IjkGridRepresentation .
     ?p rdfs:label ?name
   }`
);
```

#### `rddms.manifest`

| Method          | Returns  | Description            |
| --------------- | -------- | ---------------------- |
| `.build(input)` | `object` | OSDU manifest from ETP |

#### `rddms.epc`

| Method                   | Returns       | Description                                   |
| ------------------------ | ------------- | --------------------------------------------- |
| `.upload(ds, files, opts?)`  | `object`      | Ingest an `.epc` (+ optional `.h5`) into a dataspace |
| `.download(ds, opts?)`   | `ArrayBuffer` | Export a dependency-closed `.epc` (embedded HDF5) |

`download` gathers the whole dataspace — or the `uuids` subset — plus every
DOR-referenced child (CRS, HDF proxy, interpretations, features, …), pulls their
HDF5 arrays and returns a self-contained OPC zip that round-trips back through
`upload`.

```typescript
// Whole dataspace
const bytes = await rddms.epc.download("my/space");

// Just one grid and its dependency closure
const grid = await rddms.epc.download("my/space", {
    uuids: "2c6de928-7e08-4601-b979-34048bd68c02",
});
// grid is an ArrayBuffer — write it out, or feed it straight to epc.upload
```

### Helper

```typescript
await rddms.atomicWrite(dataspace, objects, arrays?)
```

Start transaction → put objects → put arrays → commit. Auto-rollback on error.

## Examples

| File                                                              | What it demonstrates                               |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| [`01-hello-pointset.ts`](src/examples/sdk/01-hello-pointset.ts)   | PointSet write + array upload + read-back + graph  |
| [`02-grid2d-property.ts`](src/examples/sdk/02-grid2d-property.ts) | Grid2D with continuous property and Z-values array |
| [`03-transactions.ts`](src/examples/sdk/03-transactions.ts)       | Commit vs rollback, atomicWrite helper             |
| [`04-query-graph.ts`](src/examples/sdk/04-query-graph.ts)         | FindResources, batch graph search, list all        |
| [`05-dataspaces.ts`](src/examples/sdk/05-dataspaces.ts)           | Create, list, info, lock/unlock, clone, delete     |

Run any example:

```sh
npx ts-node src/examples/sdk/01-hello-pointset.ts
```

## When to use what

| Use case                           | Tool                                             |
| ---------------------------------- | ------------------------------------------------ |
| **App integration, scripting, CI** | `RddmsClient` (this SDK)                         |
| **Interactive API exploration**    | Swagger UI or Bruno collection                   |
| **Custom ETP protocol handlers**   | `ResqmlClient` (low-level)                       |
| **C++ desktop application**        | FESAPI                                           |
| **Python data science**            | PyETP or call REST SDK endpoints with `requests` |
