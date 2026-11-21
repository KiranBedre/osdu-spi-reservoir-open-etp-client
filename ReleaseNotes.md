# Release Notes: Reservoir DDMS Client - M28

Delta over **M27 (= `main`)**. This milestone adds ETP **DiscoveryQuery (13)**,
**GrowingObject (6)** and **ChannelSubscribe (21)** query support on top of the M27 REST gateway.

Everything already shipped in M27 - the `RddmsClient` SDK, OSDU manifest builder,
WITSML store/query, EPC upload, the in-process RESQML validator, the
semantic/linked-data layer and GraphQL - is inherited **unchanged**. See the M27
release notes on `main` for that baseline. Only the deltas below are new in M28.

---
## What's new in M28 — for users

**In one line:** M28 lets you *ask questions of* RDDMS data and *load domain
interpretations* into it without hand-writing ETP or RESQML.

### Why we did it

M27 gave you a solid REST gateway for putting objects in and getting them out,
but two things were still hard:

- **Finding and drilling into data.** You could fetch an object if you already
  knew its URI, but there was no way to *discover* what was in a dataspace, walk
  its relationships, or read just a slice of a growing log/curve.
- **Loading real interpretations.** Getting a velocity model, checkshot survey,
  horizon grid, fault set or well log into RDDMS meant assembling
  version-correct RESQML object graphs by hand — error-prone and slow.

### What's now facilitated

- **Discovery & drill-down** — enumerate resources by context, follow their
  relationships, read channel/curve metadata, and pull just the index range you
  need from a growing object.
- **Domain-first ingest** — send a plain velocity / checkshot / horizon / fault /
  well-log spec and let the client build the spec-correct RESQML and stream the
  bulk arrays for you.
- **Round-trip to OSDU** — objects project cleanly to OSDU records
  (`GenericProperty`, `WellLog`) and back, with fidelity stamped honestly so you
  always know what survived the trip.
- **Fewer round-trips** — server-computed array statistics, dependency-closed EPC
  export, and one-command spec regeneration cut manual steps out of common flows.

> **Depends on the server.** Some of these capabilities (notably the discovery /
> drill-down `/query/*` routes) rely on matching support in the RDDMS server.
> Any server-side change is subject to separate review and approval, so the
> server-dependent client routes ship **behind that gate** — they're present in
> the client and exercised via the SDK/Bruno, but remain hidden from the public
> Swagger/OpenAPI until the server surface is finalised.

### How to use it

Most new capabilities are reachable three ways, pick whichever fits:

1. **SDK** — `rddms.query.*` for discovery/drill-down and `rddms.seismic.*` for
   domain ingest (see the SDK sections below).
2. **REST** — the new `/query/*` and `/dataspaces/{ds}/seismic/*` routes.
3. **Bruno** — ready-to-run requests under `bruno/Query/` and the seismic
   collections for copy-paste exploration.

A typical discovery flow is
`POST /query/resources/find` → `POST /query/growing` (metadata, `includeChannels` for curves) → `POST /query/growing` with `startIndex`/`endIndex`.
A typical ingest flow is: validate the spec (`POST /seismic/validate`), then
`PUT` it — the client handles the RESQML and arrays.

> The sections below are the **technical / developer** reference for everything
> summarised above: exact routes, handlers, SDK methods and builder internals.

---
## New ETP protocol handlers

| Protocol         | ID  | Handler                     | Purpose                                            |
| ---------------- | --- | --------------------------- | -------------------------------------------------- |
| DiscoveryQuery   | 13  | `DiscoveryQueryCustomer`    | Context/scope resource enumeration                 |
| GrowingObject    | 6   | `GrowingObjectCustomer`     | Parts metadata + range reads for growing objects   |
| ChannelSubscribe | 21  | `ChannelSubscribeCustomer`  | Channel (curve) metadata discovery                 |

Located in `src/lib/protocols/`. Each route negotiates its protocol via
`requireProtocol()` and opens/closes a dedicated ETP session per request.

## New REST routes (query drill-down)

| Method | Path                    | Protocol                              | Purpose |
| ------ | ----------------------- | ------------------------------------- | ------- |
| POST   | `/query/resources/find` | DiscoveryQuery 13 (Discovery 3 fallback) | Find resources by context + scope; `scope=targets\|sources`, `depth`, `dataObjectTypes`, `modifiedSince`. Options: `includeContent` (+ `format=xml\|json`) returns the object bodies, `includeEdges` (uri may be an array) returns `links` for graph search, `countObjects` adds relationship counts. Always `200`; the P13-only extras are omitted when the server lacks P13. |
| POST   | `/query/growing`        | GrowingObject 6 / ChannelSubscribe 21 | Growing-object drill-down. Body with only `uri` returns parts `metadata`; with `startIndex`/`endIndex` (+ `includeOverlapping`) returns `parts` in that index range; `includeChannels: true` adds channel/curve `channels` (names, UOM, data kinds, index descriptions). `501` when the server lacks P6 (or P21 for channels). |

Typical drill-down flow:
`POST /query/resources/find` → `POST /query/growing` (metadata, `includeChannels` for curves) → `POST /query/growing` with `startIndex`/`endIndex`.

## API consolidation (post-M26 routes)

Routes introduced after the M26 (0.29) release are not frozen, so M28 folds the
ones that only differed by a parameter into a single route with options. Routes
that shipped in M26 are untouched, except `GET /health/info`, which is kept but
marked deprecated in favour of `GET /info`.

| Area | Before (M27 / early M28) | Now |
| ---- | ------------------------ | --- |
| Array compute | `GET …/arrays/{path}/reduce`, `POST …/arrays/where-multi`, `POST …/arrays/arith`, `POST …/compute/batch` | `POST /dataspaces/{ds}/arrays/compute` with `op` = `stats\|reduce\|where\|where-multi\|arith`, optional `async: true` (202 + job) and `batches`. Jobs: `GET /compute/jobs`, `GET\|DELETE /compute/jobs/{id}`. |
| Array compute (GET shortcut) | `GET …/arrays/{path}/stats`, `GET …/arrays/{path}/where` | `GET …/arrays/{path}/compute?op=stats\|where` (same query parameters: `rangeLo`, `rangeHi`, `bins`, `version`, `transactionId`). |
| Query | `/query/objects/find`, `/query/graph/search` | `POST /query/resources/find` with `includeContent` / `includeEdges`. |
| Growing | `/query/growing/metadata`, `/query/growing/range`, `/query/channels/metadata` | `POST /query/growing` (see table above). |
| PWLS | `GET /pwls/hierarchy` | `GET /pwls/resolve?mnemonic=&include=hierarchy` (adds `hierarchy[]`, `depth`). |
| Linked data | `/rdf/context`, `/rdf/ontology`, `/rdf/alignment` | `GET /rdf/{artifact}` (`?format=`). |
| Seismic | `/seismic/velocity`, `/seismic/checkshots`, `/seismic/bingrid`, `/seismic/horizons/gridded`, `/seismic/horizons/control-points`, `/seismic/faults/sticks`, `/seismic/faults/control-points` | One route, `PUT /dataspaces/{ds}/seismic/{kind}` with `kind` = `bingrid\|horizons\|faults\|velocity\|checkshots`; `?representation=gridded\|control-points` (horizons) / `sticks\|control-points` (faults), auto-detected from the body when omitted; `?version=` for checkshots/bingrid. The concrete URLs (`/seismic/velocity`, `/seismic/horizons?representation=gridded`, ...) are unchanged. `POST /seismic/validate` stays separate. |
| Reservoir | `PUT /grids/connection-set`, `PUT /grids/blocked-wellbore`, `PUT /reservoir/zones`, `PUT /reservoir/regions`, `PUT /reservoir/fluid-model`, `PUT /grids/{gridUuid}/stratigraphic-units`, `PUT /grids/{gridUuid}/fluid-phase-units` | `PUT /dataspaces/{ds}/reservoir/{kind}` with `kind` = `zones\|fluid-model` (body validated against the per-kind DTO). The five grid-referencing writes (connection set, blocked wellbore, region property, interval stratigraphic units, cell fluid-phase units) are removed as REST routes: they were thin wrappers over the SDK builders that duplicated the generic write path (`PUT /resources` + `PUT /resources/arrays`) and repeated the same `transactionId`/`crsUuid`/`hdfProxyUuid`/citation body plumbing. Use the SDK builders (`buildGridConnectionSet`, `buildBlockedWellbore`, `buildRegionSet`, `buildIntervalStratigraphicUnits`, `buildCellFluidPhaseUnits`) and write the result generically. The former route test data is replayed that way in Postman (`09 Reservoir / Grid bindings via generic PUT`) and Bruno (`Grids/Put Grid Bindings` onward): objects through `PUT /resources`, their integer arrays onto the grid's HDF proxy through `PUT /resources/arrays`, and the two grid child elements by fetching, patching and rewriting the grid. |
| Sections | 17 Swagger tags (Dataspaces, Manifest, Resources, Query, GraphQL, Cypher, SPARQL, Compute, Transactions, Write, Well, PWLS, Seismic, Reservoir, Health, Authentication, Metrics) | 10 sections in M27 order with Health first: **Health** (+ Metrics), **Authentication**, **Dataspaces**, **Manifest**, **Resources**, **Query** (+ GraphQL, Cypher, SPARQL, Compute and jobs, `/rdf`), **Write** (+ Transactions), **Well** (+ PWLS, log-structure), **Seismic**, **Reservoir**. Tag headers are short; the detail lives on each operation. |
| Dataspaces | `PUT /dataspaces/{id}/copy` | `POST /dataspaces/{id}/clone?intoExisting=true` (body `DataspaceId` = existing target). |
| WITSML | `POST /witsml/query?$format=` | `?format=` (the M26 `$format` on `/dataspaces/{ds}/resources` is unchanged). |
| Health | `GET /health/info` | Deprecated (still served); use `GET /info`. |
| Write | `PUT /dataspaces/{ds}/resources` answered HTTP 200 with body `false` when the store rejected the batch (dangling reference, malformed UUID, unknown dataspace), leaving the caller to guess | The ETP error is mapped like every other write: 400 for invalid URI/object, 412 for store state rejections, with the store message in `description`. A successful put still answers `true`. |

## SDK additions (`sdk/RddmsClient.ts`)

New `rddms.query` methods wrapping the routes above:

- `query.findResources({ uri, scope?, depth? })`
- `query.growingMetadata({ uri })`
- `query.growingRange({ uri, startIndex, endIndex, includeOverlapping? })`
- `query.channelMetadata({ uri })`

`query.findObjects` and `query.graphSearch` remain from M27.

## Graph query surface — three query verbs over one RESQML graph

M28 completes a **graph query trio** so you can ask the *same* dataspace graph
three complementary ways. They are grouped as adjacent Swagger tags right after
the **Query** section:

| Tag       | Route       | Model     | Best for                                             |
| --------- | ----------- | --------- | ---------------------------------------------------- |
| GraphQL   | `POST /graphql` | records   | **Retrieval** — fetch objects/fields by shape        |
| Cypher    | `POST /cypher`  | traversal | **Connectivity** — "what is connected to what?"      |
| SPARQL    | `POST /sparql`  | RDF/triples | **Linked data** — query the published RDF directly |

All three are **read-only** and evaluate against a **pre-fetched** in-memory
graph (no extra ETP round-trips during evaluation); the traversal verbs share
the `MAX_GRAPH_HOPS = 10` cap. GraphQL is Apollo-served (not a NestJS
controller), so it is injected into the OpenAPI document for documentation
parity. The three subsections below document each verb.

### `POST /graphql` — semantic edge roles, traversal & array compute

The code-first Apollo GraphQL surface gains enhancements that bring its graph
semantics in line with the REST graph endpoint (`/query/resources/find` with `scope`/`depth`/`includeEdges`). All are additive and
read-only. _(open-etp-client #172, MR !435.)_

#### Semantic edge roles — `GqlEdge.role`

Every edge returned by `graphSearch` now carries a nullable **`role`** — the
semantic relationship kind of the link, with the **source holding the DOR**
(direction is `source → target`):

- **Native path.** When the ETP server reports a DOR `path` for the edge (the
  XML field name of the `DataObjectReference` on the source object, surfaced via
  ETP relationship `customData`), that field name **is** the role and is
  returned verbatim — e.g. `RepresentedInterpretation`, `InterpretedFeature`,
  `SupportingRepresentation`. Leading slashes, XPath indices (`[2]`) and
  namespace prefixes (`ns:`) are stripped to the leaf token.
- **Inferred fallback.** When no `path` is reported, the role is inferred from
  the RESQML tiers of the source/target object types
  (`feature → interpretation → representation → property`): interpretation→feature
  ⇒ `InterpretedFeature`, representation→interpretation ⇒ `RepresentedInterpretation`,
  representation/property→representation ⇒ `SupportingRepresentation`, else
  `RelatedRepresentation`; unclassifiable edges leave `role` null.

This lets downstream consumers (e.g. the ORES `geologicalGraph` query) read the
native relationship semantics instead of re-deriving them locally — they
auto-upgrade from inferred to server-reported roles once the server populates
the DOR `path` (tracked on open-etp-server #228 / MR !583).

```graphql
query {
  graphSearch(uris: ["eml:///dataspace('demo')/resqml20.obj_IjkGridRepresentation(…)"], depth: 2) {
    edges { sourceUri targetUri role }   # role: "RepresentedInterpretation", …
  }
}
```

#### Traversal args on `targets` / `sources`

The lazy `targets` and `sources` field resolvers now accept:

- **`depth: Int = 1`** — walks **transitive** targets/sources. `depth = 1` keeps
  the cached depth-1 graph fast path; `depth > 1` fetches a depth-N server graph
  and performs a **breadth-first, cycle-guarded** walk. Depth is clamped to
  `[1, 10]` (`MAX_TRAVERSAL_DEPTH`) so a pathological request cannot run away.
- **`scope: String = "related"`** — `related` (default) returns the reachable
  resources excluding the origin; `withSelf` prepends the origin resource.

BFS is deduplicated (diamond fan-in collapses) and guaranteed terminating on
cyclic graphs (the origin is pre-visited and never re-emitted).

```graphql
query {
  resource(uri: "eml:///dataspace('demo')/resqml20.obj_IjkGridRepresentation(…)") {
    uri
    targets(depth: 3, scope: "related") { uri dataObjectType }
    sources(depth: 2) { uri }
  }
}
```

#### Array compute on the graph surface — `stats` / `reduce` / `where` fields, `screenCells` / `screen` queries

The GraphQL surface now also exposes the **server-computed array primitives**
(the `STATS` / `REDUCE` / `WHERE` / `WHEREN` extensions documented under
[Array statistics](#array-statistics-server-computed-reductions) and
[Array reduce & where](#array-reduce--where-targeting-maps--aim-points)), so a
single GraphQL request can discover objects **and** screen their arrays without
a second REST round-trip or any array bytes leaving the store. All fields are
additive, read-only, and resolve through the same per-request ETP session /
DataLoaders. Every result type is **nullable** — a `null` answer is the same
"store lacks the extension, fall back to a client-side reduction" signal used by
the ETP/REST surfaces.

On **`GqlResource`** (lazy field resolvers — only run when selected):

- **`stats(pathInResource, rangeLo?, rangeHi?, bins?)` → `GqlArrayStats`** —
  count / null-count / min / max / mean / stddev / sum, plus `inRangeCount` when
  a range is given and `histogram` + `p10`/`p50`/`p90` when `bins` is added.
- **`reduce(pathInResource, op, k0?, k1?, rangeLo?, rangeHi?, cellDz?)` →
  `GqlArrayReduce`** — collapses a 3-D property `[Nk, Nj, Ni]` down the K axis
  into a 2-D `[nj, ni]` column map (`op` = `sum`/`mean`/`min`/`max`/`count`/`net`;
  `count`/`net` require a range; `k0`/`k1` limit the K-zone; `cellDz` sets
  net-thickness per cell).
- **`where(pathInResource, rangeLo, rangeHi)` → `GqlArrayWhere`** — count, ijk
  bounding box and ijk centroid (aim point) of the cells whose value is in
  `[rangeLo, rangeHi]`.

Two **root queries** for multi-criteria targeting:

- **`screenCells(predicates: [GqlWherePredicate!]!)` → `GqlArrayWhere`** — ANDs
  several explicit `{ uri, pathInResource, lo, hi }` predicates over the shared
  grid (WHEREN) and returns the passing count, its ijk centroid, the number of
  connected `components`, and the **largest connected body** (`bodyCount`,
  `bci`/`bcj`/`bck` = the drillable aim point).
- **`screen(dataspaceUri, filters: [GqlScreenFilter!]!, propertyType?)` →
  `GqlArrayWhere`** — a title-matched convenience that mirrors the ORES
  Strawberry `screen` shape. Each `GqlScreenFilter { titleContains, operator,
  threshold }` is resolved to a property object by title within the dataspace,
  its array is located, the `operator`/`threshold` is mapped to an inclusive
  `[lo, hi]` range (`GT`/`GTE` → `lo`, `LT`/`LTE` → `hi`, `EQ` → both), and all
  predicates are ANDed server-side. `propertyType` defaults to
  `resqml20.obj_ContinuousProperty`. This lets a client express a net-pay /
  saturation screen without first knowing object URIs or array paths.

```graphql
query {
  # title-matched screen (no URIs/paths needed) — net-pay aim point
  screen(
    dataspaceUri: "eml:///dataspace('demo')"
    filters: [
      { titleContains: "poro", operator: "GT", threshold: 0.10 }
      { titleContains: "SW",   operator: "LT", threshold: 0.50 }
    ]
  ) { valid count components bodyCount bci bcj bck }
}
```

This is the GraphQL half of the same server-side array compute surfaced over ETP
(`DataArrayCustomer`), the SDK (`ResqmlClient.getDataArray{Stats,Reduce,Where,
WhereMulti}`) and REST (`…/arrays/{path}/{stats,where}` and `POST …/arrays/compute`); pick whichever surface fits the caller.

### `POST /cypher` — read-only openCypher traversal

Nodes are RESQML resources; relationships are `DataObjectReference` edges whose
**role** is inferred from the RESQML tier chain. Labels match the data-object
type by substring (`Grid`, `Interpretation`) or fully-qualified
(`resqml20.obj_IjkGridRepresentation`).

- **Supported:** `MATCH … [WHERE …] RETURN … [ORDER BY] [SKIP n] [LIMIT n]`,
  directed/undirected and variable-length `*min..max` paths, `AND/OR/NOT`,
  string predicates, `DISTINCT`, `AS` aliases, `$params`.
- **Rejected (HTTP 400):** writes (`CREATE/MERGE/SET/DELETE`), `WITH`,
  `UNWIND`, `CALL`, `OPTIONAL MATCH`.

**Request body** — `{ dataspaceUri, query, parameters? }`. **Result** —
`{ columns, data[], stats }`; node variables expand to
`{ uri, id, name, type, sourceCount, targetCount }`, path variables to
`{ length, nodes[] }`, and `var.prop` projections to scalars.

```http
POST /cypher
{
  "dataspaceUri": "eml:///dataspace('demo/drogon')",
  "query": "MATCH p = (g {id: $gridId})-[*1..5]-(x) RETURN p",
  "parameters": { "gridId": "0c8a1e2f-3b7d-4e56-9a81-2f6c4b0d9e73" }
}
```

### `POST /sparql` — read-only SPARQL 1.1 over the published RDF

SPARQL is the **query verb over the RDF noun**: it evaluates against exactly the
triples the `/rdf/*` endpoints emit, via a shared `graphToTriples` projector, so
a SPARQL query sees the same linked data the service already serves.

**Vocabulary** (identical to the `/rdf/*` emission):

| Triple                              | Meaning                                              |
| ----------------------------------- | ---------------------------------------------------- |
| subject                             | the ETP URI of the object                            |
| `rdf:type` → `rddmst:<family><ver>.<Type>` | RESQML class, e.g. `rddmst:resqml20.IjkGridRepresentation` (falls back to `rddms:Resource`) |
| `rdfs:label`                        | object name                                          |
| `rddms:uuid`, `rddms:dataspace`, `rddms:objectVersion`, `rddms:activeStatus` | identity / state |
| `rddms:sourceCount` / `rddms:targetCount` (`xsd:integer`) | relationship degree             |
| `dcterms:created` / `dcterms:modified` (`xsd:dateTime`) | store timestamps                   |
| `rddms:references`                  | generic DOR edge (every reference)                   |
| `rddms:<role>` e.g. `rddms:representedInterpretation` | role-specific edge from the DOR path |

Prefixes `rdf` / `rdfs` / `xsd` / `dcterms` / `rddms` / `rddmst` are
pre-declared; add your own with `PREFIX`. Namespaces:
`rddms: <https://rddms.opengroup.org/ontology#>`,
`rddmst: <https://rddms.opengroup.org/type#>`.

**Supported subset**

- **Query forms:** `SELECT`, `ASK`, `CONSTRUCT`, `DESCRIBE`.
- **Patterns:** basic graph patterns with `;` / `,` predicate-object lists and
  `a` (→ `rdf:type`); fixed-predicate **property paths** `pred*` / `pred+`
  (capped at `MAX_GRAPH_HOPS = 10`).
- **FILTER:** comparisons (`=`, `!=`, `<`, `<=`, `>`, `>=`), boolean
  `&&` / `||` / `!`, and functions `regex` (with `i` flag), `contains`,
  `strstarts`, `strends`, `bound`, `isiri`, `isliteral`.
- **Modifiers:** `DISTINCT`, `ORDER BY` (parsed), `LIMIT`, `OFFSET`.
- **Rejected (HTTP 400, with character position):** updates
  (`INSERT/DELETE/LOAD/CLEAR/CREATE/DROP/…`), `OPTIONAL`, `UNION`, `MINUS`,
  `BIND`, `VALUES`, `GROUP BY` / `HAVING`, `SERVICE`, named `GRAPH`.

**Request body** — `{ dataspaceUri, query, format? }`, where `format` is
`"json"` (default), `"turtle"` or `"jsonld"`. `format` may also be passed as a
`?format=` query param (body wins).

**Results**

- `SELECT` → W3C SPARQL 1.1 JSON:
  `{ form:"SELECT", head:{vars}, results:{bindings:[{var:{type,value,datatype?,"xml:lang"?}}]}, stats }`.
- `ASK` → `{ form:"ASK", boolean, stats }`.
- `CONSTRUCT` / `DESCRIBE` → `{ form, triples:[{subject,predicate,object}], rdf?, stats }`;
  `rdf` is a serialized string only when `format` is `turtle` / `jsonld`
  (reusing the shared RDF document writer).
- `stats` → `{ triplesScanned, solutions, form }`.

```http
POST /sparql
{
  "dataspaceUri": "eml:///dataspace('demo/drogon')",
  "query": "SELECT ?name WHERE { ?p rddms:supportingRepresentation ?g . ?g a rddmst:resqml20.IjkGridRepresentation . ?p rdfs:label ?name }",
  "format": "json"
}
```

Common shapes:

```sparql
# ASK — does any property support an Ijk grid?
ASK { ?p rddms:supportingRepresentation ?g . ?g a rddmst:resqml20.IjkGridRepresentation }

# Variable-length reachability (the neighbourhood of a grid)
SELECT ?x WHERE { <eml:///…/IjkGridRepresentation(…)> rddms:references+ ?x }

# CONSTRUCT a lineage subgraph as Turtle (format:"turtle")
CONSTRUCT { ?g rddms:references ?x }
WHERE { ?g a rddmst:resqml20.IjkGridRepresentation ; rddms:references+ ?x }

# DESCRIBE every triple about one object
DESCRIBE <eml:///…/ContinuousProperty(…)>
```

**Implementation** (`src/lib/restApi/sparql.module/`):

- `SparqlParser.ts` — tokeniser + recursive-descent parser producing a small AST
  (`SparqlQuery` with `form`, `vars`, `patterns`, `filters`, paths, modifiers);
  throws `SparqlSyntaxError` (carrying a `position`) for malformed or
  unsupported input.
- `SparqlEngine.ts` — projects the fetched `ResourceGraph` through
  `graphToTriples`, indexes by subject and by predicate (for property-path BFS),
  then runs a nested-loop BGP join with FILTER evaluation. Exposes
  `MAX_SOLUTIONS = 10000` and `MAX_SPARQL_HOPS = MAX_GRAPH_HOPS`.
- `Sparql.controller.ts` — `@Controller("sparql")` / `@ApiTags("SPARQL")`;
  parses first (400 on syntax error), fetches the dataspace graph
  (`depth:0`, `RelationshipKind.Both`, targets-or-self), then runs the engine.
  Shares the Cypher controller's bearer / data-partition guards.
- `RdfSerialization.ts` — now exports a structured `Triple` model and the
  `graphToTriples` projector shared by `/rdf/*`, `/cypher`-adjacent tooling and
  `/sparql`, so there is a single source of RDF truth.

**SDK** — `rddms.sparql.run(dataspace, query, format?)` returns a discriminated
`SparqlResult` (`SparqlSelectResult | SparqlAskResult | SparqlGraphResult`); see
the SDK README `#### rddms.sparql` section. **Tests** — `src/__tests__/TestSparql.ts`
(35 cases: parser grammar/rejections/error-position, engine
SELECT/ASK/CONSTRUCT/DESCRIBE, FILTER, property paths, DISTINCT/LIMIT/OFFSET,
stats and RESQML regression queries).

## EPC download (dependency-closed export)

New REST route — the inverse of the M27 EPC uploader:

| Method | Path                          | Purpose                                                                 |
| ------ | ----------------------------- | ----------------------------------------------------------------------- |
| GET    | `/dataspaces/{dataspaceId}/epc` | Export a self-contained `.epc` (OPC zip with an embedded HDF5 file). |

Query params:

- `uuids` — comma-separated object UUIDs to seed the export; when omitted the
  whole dataspace is exported.
- `includeReferences` (default `true`) — follow every DOR reference and include
  all referenced children (CRS, HDF proxy / `EpcExternalPartReference`,
  interpretations, features, …).

The gather step walks the store graph's targets to a full dependency closure,
pulls the bulk HDF5 arrays each object points at, and writes OPC `_rels/*.rels`
so the package is standards-valid. The result round-trips losslessly back
through the uploader (`validate=strict` → 0 errors) and opens cleanly in
fesapi / resqpy. Boolean masks (e.g. `cellGeometryIsDefined`) are preserved as
HDF5 `int8`.

New SDK method (`sdk/RddmsClient.ts`):

- `epc.download(ds, { uuids?, includeReferences? })` → `ArrayBuffer`

`epc.upload` remains from M27.

## Reservoir grid & model routes

The **Reservoir** section is the domain lane that bridges simulator/interpretation
tooling (OPM, resdata, xtgeo, resqpy, fesapi) and RESQML. All writes auto-open a
transaction unless a `transactionId` is supplied — **pass one to batch several
writes into a single commit** (avoids a round-trip per call).

### Grid geometry I/O — `format`-flagged import/export

Two routes cover all deck formats via a `format` flag, instead of one path per
format:

| Method | Path | Use case |
| ------ | ---- | -------- |
| PUT | `/dataspaces/{ds}/grids?format=grdecl` | Import an ASCII GRDECL corner-point deck as a RESQML `IjkGridRepresentation` (split-fault pillars synthesised, HDF proxy created). |
| GET | `/dataspaces/{ds}/grids/{uuid}/export?format=grdecl\|egrid\|init` | Export a RESQML grid back to a simulator deck. |

- **Motivation** — get a grid built in Petrel/RMS/OPM into the store (and back
  out) without hand-authoring RESQML geometry. The heavy corner-point ⇄ pillar
  math and keyword↔property-kind mapping live server-side; a generic
  `PUT /resources` cannot do this.
- **Example**
  ```bash
  # import
  curl -X PUT "$API/dataspaces/demo%2Ffield/grids?format=grdecl" \
       -H "Authorization: Bearer $TOK" -H "data-partition-id: osdu" \
       -H 'content-type: application/json' \
       -d '{"text":"SPECGRID\n...","title":"Geogrid","crsUuid":"<crs>"}'
  # export geometry as compact binary
  curl "$API/dataspaces/demo%2Ffield/grids/<uuid>/export?format=egrid" -o grid.EGRID
  # export static properties, filtered
  curl "$API/dataspaces/demo%2Ffield/grids/<uuid>/export?format=init&properties=PORO,PERMX" -o grid.INIT
  ```
- **Performance** — prefer `egrid`/`init` (binary, Fortran-unformatted) over
  `grdecl` for large grids: ~3–4× smaller and no ASCII parse/format step. For
  `init`, pass `properties=` to stream only the keywords you need. `grdecl`
  supports `geometry=false` with `actnum`/`properties` for a properties-only
  deck. Each call logs a `[grid-bench]` line (decode vs serialize ms, byte size).

### Grid-attached features

Connection sets and blocked wellbores are no longer separate REST routes. Build
them with the SDK (`buildGridConnectionSet`, `buildBlockedWellbore`,
`buildFaultTransmissibilityMultiplier`) and write the parts with the generic
`PUT /dataspaces/{ds}/resources` + `PUT …/resources/arrays` routes (or
`RddmsClient.atomicWrite(dataspace, objects, arrays)`). The builders carry the RESQML correctness (XSD order,
DOR envelopes, HDF paths); the REST wrappers only added a second body schema.

### Property-keyword registry

| Method | Path | Use case |
| ------ | ---- | -------- |
| GET | `/dataspaces/grid-property-mappings` | Read the canonical OSDU↔RESQML↔GRDECL keyword registry (drives import kind/UOM and export mnemonics). |
| POST | `/dataspaces/grid-property-mappings` | Register/override mappings at runtime (e.g. a vendor keyword → RESQML kind). |

- **Motivation** — make round-trips stable and idempotent: `PORO`→`porosity`,
  `Water saturation`→`SWAT`, etc., without editing code.
- **Performance** — in-memory, read-only GET; no ETP session.

### Reservoir model organisation

| Method | Path | Use case |
| ------ | ---- | -------- |
| PUT | `/dataspaces/{ds}/reservoir/zones` | Stratigraphic zonation → `StratigraphicColumnRankInterpretation` (+ features, optional `StratigraphicColumn`). Returns `rankUuid`. |
| PUT | `/dataspaces/{ds}/reservoir/fluid-model` | Multi-region `RockFluidOrganizationInterpretation` (RESQML 2.2) with phase-tagged units + optional GOC/WOC/FWL contacts. Returns `orgUuid`. |

- **Motivation**: these two kinds encapsulate a *cluster* of interrelated
  RESQML objects (one feature + one interpretation per unit or boundary + the
  organisation that lists them) with the correct XSD ordering and cross-version
  DOR envelopes. Authoring that via generic `PUT /resources` means hand-writing
  the whole graph.
- **Binding to a grid**: `rankUuid` / `orgUuid` feed the SDK builders
  `buildIntervalStratigraphicUnits` and `buildCellFluidPhaseUnits`; region codes
  (SATNUM/PVTNUM/...) are plain `DiscreteProperty`/`CategoricalProperty` writes
  (`buildRegionSet`). Write those parts generically; the dedicated binding
  routes were removed (see migration table).

## Seismic interpretation routes

Domain builders that emit interpretation-grade RESQML; kept as their own
**Seismic** section. Writes auto-open a transaction unless `transactionId` is set.

| Method | Path | Use case |
| ------ | ---- | -------- |
| PUT | `/dataspaces/{ds}/seismic/velocity` | Velocity model → `ContinuousProperty` with a canonical velocity kind (interval/average/rms/Vp/Vs). |
| PUT | `/dataspaces/{ds}/seismic/checkshots?version=` | Checkshot/TZ curve → a `WellboreFrame` + time property on 2.2.0/2.0.1. |
| PUT | `/dataspaces/{ds}/seismic/horizons?representation=gridded` | Gridded horizon → regular `Grid2dRepresentation` (lattice XY + row-major Z of length `ni*nj`). |
| POST | `/seismic/validate` | Stateless shape/units check on a spec before writing (no store access). |

- **Motivation** — write velocity/checkshot/horizon interpretations without
  assembling the version-specific RESQML by hand; `validate` lets a caller
  pre-flight a payload cheaply.
- **Example**
  ```bash
  curl -X POST "$API/seismic/validate" -H 'content-type: application/json' \
       -d @horizon.json          # 200 = shape OK, 400 = actionable errors
  curl -X PUT "$API/dataspaces/demo%2Ffield/seismic/checkshots?version=2.2.0" \
       -H "Authorization: Bearer $TOK" -H "data-partition-id: osdu" \
       -H 'content-type: application/json' -d @checkshot.json
  ```
- **Performance** — call `POST /seismic/validate` first in bulk-load pipelines to
  reject bad payloads before opening an ETP session.

## Well & tabular convenience routes

Two more dedicated builder lanes (same "domain spec in → spec-correct RESQML
object graph + bulk arrays out, written through the shared ETP session path"
pattern as the Seismic/Reservoir lanes). Writes auto-open a transaction unless a
`transactionId` is supplied.

| Method | Path | Section | Use case |
| ------ | ---- | ------- | -------- |
| PUT | `/dataspaces/{ds}/wells/markers` | **Well** | Wellbore marker frame → `WellboreMarkerFrameRepresentation` (MD picks along a trajectory + one `WellboreMarker` per pick). |
| PUT | `/dataspaces/{ds}/resources/tables/column-based` | **Write** | Column-based table → EML 2.3 `ColumnBasedTable` (KrPc / PVT / facies): one `Column` per curve, each bound to a PropertyKind + external value array. |

- **`buildWellboreMarkerFrame`** (`src/lib/builders/wellbore.ts`) — honours the
  **stratigraphy/FIRP** model per marker via the shared `resolveInterpretedFeature`
  resolver: each marker reuses an existing boundary interpretation
  (`interpretationUuid`), links to OSDU masterdata by SRN
  (`interpretationSrn`/`featureSrn`, deterministic UUID → idempotent upsert), or
  has its Feature + Interpretation auto-created from a title. Objects are deduped
  by UUID so markers sharing an SRN write their interpretation once. Version-aware
  (2.0.1/2.2.0); returns `{ representationUuid, interpretationUuids }`.
- **`buildColumnBasedTable`** (`src/lib/builders/columnBasedTable.ts`) — emits an
  EML 2.3 `eml23.ColumnBasedTable` (a 2.2+ common object; the builder rejects the
  2.0.x lines). Each `Column`/`KeyColumn` references a `PropertyKind` DOR (uuid,
  SRN, or a deterministic UUID derived from the kind name), carries an optional
  UOM override + `ValueCountPerRow`, and stores its values in an external
  (HDF5-backed) array — one bulk array per column.
- **Naming** — the OpenAPI/Swagger **`WITSML` tag was renamed to `Well`**
  (the `/witsml/*` store/query routes, the `/wells` search route and the new
  `/wells/markers` route now group under **Well**); the Postman collection folder
  `9. WITSML` is likewise `9. Well`. Route paths are unchanged.
- **Example**
  ```bash
  curl -X PUT "$API/dataspaces/demo%2Ffield/wells/markers" \
       -H "Authorization: Bearer $TOK" -H "data-partition-id: osdu" \
       -H 'content-type: application/json' -d @markers.json
  curl -X PUT "$API/dataspaces/demo%2Ffield/resources/tables/column-based" \
       -H "Authorization: Bearer $TOK" -H "data-partition-id: osdu" \
       -H 'content-type: application/json' -d @krpc.json     # version 2.2.0 (EML 2.3)
  ```

## Wellbore DDMS import (replaces the `/ddms/v3` shim)

The earlier `ddms/v3` controller mimicked the OSDU Wellbore DDMS API path
(`/api/reservoir-ddms/v2/ddms/v3/...`) and only wrapped `/witsml/store` and the
RESQML builders behind a Wellbore-DDMS-shaped surface. It has been **removed**
(`src/lib/restApi/ddms.module/`, its six routes, the Bruno `W08`/`W09` requests
and the Postman `WB1-WB3` / `WT03b` / `WT07` / `WT08` items). RDDMS is not a
Wellbore DDMS replacement; what is useful is copying well logs **from** the
Wellbore DDMS **into** a dataspace while keeping their master-data identity.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| POST | `/dataspaces/{dataspaceId}/wells/logs/import` | Copy one Wellbore DDMS `WellLog` (record + bulk) into the dataspace as a WITSML 2.1 `ChannelSet` with channel arrays. |

Body: `{ "id": "osdu:work-product-component--WellLog:...", "version"?: n,
"wellboreUuid"?: uuid, "wellUuid"?: uuid, "originator"?: string }`, optional
`?transactionId`. Steps:

1. `GET {RDMS_WDMS_PATH}/welllogs/{id}` (or `/versions/{version}`) and
   `GET .../welllogs/{id}/data?orient=split` with the caller's bearer and
   `data-partition-id` (`OSDUContext.fetchOSDU`). `RDMS_WDMS_PATH` defaults to
   `/api/os-wellbore-ddms/ddms/v3` relative to `RDMS_OSDU_URL`.
2. `data.WellboreID` -> `GET .../wellbores/{id}` -> `data.WellID`. Unless
   `wellboreUuid` / `wellUuid` point at existing WITSML objects, a
   `witsml21.Well` and `witsml21.Wellbore` are written with UUIDs derived
   deterministically from the master-data ids (`uuidV5`), each carrying the
   OSDU record id as `Aliases/Authority="osdu"`, so the catalog identity stays
   the `master-data--Well` / `master-data--Wellbore` record.
3. `data.Curves[]` -> `ChannelSet` (`buildChannelSet`): `ReferenceCurveID`
   becomes the `Index` (measured depth or date time), each other curve a
   `Channel` with its unit symbol taken from the `UnitOfMeasure` reference id;
   the split-orient columns become the channel arrays (null -> NaN). The
   `ChannelSet` carries the WellLog id as an `osdu` alias, a `Wellbore` DOR and
   `osdu:sourceId` / `osdu:sourceVersion` / `osdu:legalTags` / `osdu:acl`
   provenance as `ExtraMetadata`.
4. Everything is stored through `WitsmlController.putWitsmlObjects` in one
   transaction (auto-opened and committed unless `transactionId` is given).
5. Response: `{ channelSetUuid, wellboreUuid, wellUuid, mnemonics, source: {
   id, version, wellboreId, wellId }, objectsStored, arraysStored }`. A missing
   WellLog answers `404`; a WellLog without curves or bulk answers `400`.

The pure converters under `src/lib/wellbore/` (LAS/CSV/DLIS parsers,
`witsmlChannels`, `bridge`, `trajectory`, `logProject`, `facade`) are unchanged
and remain available to the SDK. The Grids Bruno/Postman flows that used the
design-first `wellbores/resqml` + `wellboretrajectories/.../resqml` routes to
give the blocked wellbore a trajectory now author `WellboreFeature`,
`WellboreInterpretation`, `MdDatum` and a metadata-only
`WellboreTrajectoryRepresentation` through the generic `PUT /resources`
(`bruno/Grids/Put Wellbore And Trajectory For Blocked Wellbore.bru`, Postman
`07 Well / WB1`).

The WDMS record mapping is a pure module (`src/lib/wellbore/wdms.ts`) covered by
`src/__tests__/TestWdmsImport.ts`; `buildChannelSet` gained optional `aliases`,
`wellbore` and `extraMetadata` inputs.

## Array statistics (server-computed reductions)

A read-side capability that asks the **server** to reduce a stored array to a
fixed-size statistical summary instead of streaming the whole array to the client
and reducing it here. Bulk stays in the store; only an O(1) summary crosses the
wire. This is the client half of the server's `GetDataArrayStats` reducer (see the
**open-etp-server** release notes) and the first "push compute to the bytes"
primitive in the stack.

| Layer | Surface | Purpose |
| ----- | ------- | ------- |
| ETP    | `DataArrayCustomer.stats(dataArrayId, range?, histogramBins?)` | Sends the `STATS` / `STATS\|lo\|hi` / `STATS\|lo\|hi\|bins` correlation-id marker on `GetDataArrayMetadata`; parses `stats.*` (incl. the `stats.histogram` `ArrayOfLong` and `stats.p10/p50/p90`) from `customData`. |
| Client | `ResqmlClient.getDataArrayStats(uri, pathInResource, range?, histogramBins?)` | Resolves the array id then calls `stats()`; returns `IArrayStatsSummary \| null`. |
| REST   | `GET /dataspaces/{ds}/resources/{...}/arrays/{pathInResource}/compute?op=stats&rangeLo=&rangeHi=&bins=` | HTTP surface; `501` when the server lacks the extension, `400` on a malformed range or `bins` without a range. |

- **Return shape** — `IArrayStatsSummary { valid, count, nullCount, minimum?,
  maximum?, mean?, stddev?, sum?, inRangeCount?, rangeLo?, rangeHi?, histogram?,
  histBins?, histLo?, histHi?, histUnderflow?, histOverflow?, p10?, p50?, p90? }`.
  `parseArrayStats()` returns `null` when the server did **not** answer with
  `stats.*` keys (older server), which callers use as the "fall back to a
  client-side reduction" signal.
- **Histogram + percentiles (new)** — passing `bins` (with a `[rangeLo, rangeHi]`
  domain) asks the store to fold a fixed-width **histogram** and derive
  **p10/p50/p90** in the *same* single pass. The per-bin counts come back as a
  native `ArrayOfLong` (`stats.histogram`), with out-of-domain finite values split
  into `histUnderflow`/`histOverflow`; percentiles are interpolated from the
  cumulative histogram (accurate to within one bin width, clamped to `[min,max]`).
  Backward compatible — bare `STATS` and `STATS|lo|hi` are unchanged.
- **ORES geology-targeting consumer** — this distribution surface is what the ORES
  GraphQL targeting / fitness routes need for net-pay & saturation **distributions**
  and the OWC/HCPV **uncertainty** screen (`app/grid_geometry.py`
  `score_target_fitness` + the §9.3 push-compute roadmap): a single
  `GET …/arrays/{path}/compute?op=stats&rangeLo&rangeHi&bins` answers "what fraction of this
  property is pay, and how is it distributed" without ever downloading the 3-D
  array.
- **RESQML property fast-path** — `GenericProperty` / `GenericProperty22`
  continuous-statistics (`MinValue`/`MaxValue`/`MeanValue`/`StdDeviation`/`ValueCount`)
  now try the server reducer first (single-patch, HDF5-backed) and only fall back
  to the in-process JS single-pass loop when the server has no stats extension or
  the array is constant/lattice/inline. Fixed alongside: a **multi-patch reset
  bug** in the RESQML 2.2 continuous path where per-patch seeds reset the running
  min/max instead of folding across patches.
- **WellLog depth-range fast-path** — the RESQML `WellboreFrameRepresentation` →
  `WellLog` converter now folds the `NodeMd` index into a server-side min/max
  summary (`getDataArrayStats`) to derive top/bottom/interval, inserted between
  the first/last-element `GetDataSubarray` probe and the previous
  **full-array download** fallback — so an unindexed / subarray-less store no
  longer has to stream the whole depth column. Same graceful degradation.
- **ProdML `ProductionValues` value summary** — the `prodml23.TimeSeriesData`
  converter now **folds on the server first**: when the object's samples were
  externalized into a store-backed array at `/PRODML/<uuid>/Value` (see the
  first-class ingest below), it calls `getDataArrayStats` and lifts
  `MinValue`/`MaxValue`/`MeanValue`/`Sum`/`ValueCount` from the O(1) summary — no
  sample bytes cross the wire. For genuinely **inline** objects (or a store
  without the stats extension) it falls back to a single in-memory pass over the
  inline samples (manual loop, not `Math.min(...arr)`, to stay safe on long
  series), still emitting `SampleCount`.
- **Domain reach** — the stats capability itself is domain-agnostic (keyed by
  array URI + path), so WITSML / ProdML / EML arrays are summarisable through the
  generic `GET …/arrays/{path}/compute?op=stats` route today; the typed fast-paths above are
  the RESQML/well/ProdML convenience wrappers. (WITSML per-curve stats and a
  seismic-lane accessor remain follow-ups — see `ToDo`.)
- **Back-compat** — the marker is opaque to servers without the extension, so a
  mixed fleet degrades gracefully to the client-side reduction.
- **Capability advertisement (M27-server guard)** — a compute-capable store now
  advertises a `supportedArrayExtensions` endpoint capability (comma list:
  `stats,histogram,reduce,where,where-multi,arith`) in its `ServerCapabilities`
  and per-session `OpenSession` response. An **un-updated M27 store** omits the
  key, so a caller can detect a non-compute build *up front* at session
  negotiation and route the request to a compute-capable server — instead of only
  discovering it per-request through the `null` fallback above. The key's
  **presence** is the signal (its value is an advisory extension list); omission
  is treated as "not compute-capable". This guard covers every compute operation
  below (`reduce` / `where` / `where-multi` / `arith`), not just `stats`.

### Array reduce & where (targeting maps & aim points)

The targeting-query generalisation of array statistics: the same "compute at the
bytes" contract, but returning the two primitives targeting workflows actually
need — a **K-axis column map** and a **masked predicate with an aim point** —
still without ever downloading the 3-D array. Client half of the server's
`REDUCE` / `WHERE` extensions (see the **open-etp-server** release notes).

| Layer | Surface | Purpose |
| ----- | ------- | ------- |
| ETP    | `DataArrayCustomer.reduce(id, op, { kRange?, range?, cellDz? })` · `DataArrayCustomer.where(id, { lo, hi })` · `DataArrayCustomer.whereMulti(predicates)` | Sends the `REDUCE\|<op>\|…` / `WHERE\|lo\|hi` / per-array `WHEREN\|<idx>\|lo\|hi` correlation-id marker on `GetDataArrayMetadata`; parses `reduce.*` (incl. the `reduce.map` `ArrayOfDouble`) / `where.*` (incl. `where.arrays`) from `customData`. |
| Client | `ResqmlClient.getDataArrayReduce(uri, path, op, opts?)` · `ResqmlClient.getDataArrayWhere(uri, path, range)` · `ResqmlClient.getDataArrayWhereMulti(predicates)` | Resolves the array id(s) then calls `reduce()` / `where()` / `whereMulti()`; returns `IArrayReduceResult \| null` / `IArrayWhereResult \| null` / `IArrayMultiWhereResult \| null`. |
| REST   | `POST …/arrays/compute` (`op=reduce`, `reducer=`, `k0`/`k1`/`rangeLo`/`rangeHi`/`cellDz`; `op=where-multi` with `predicates`) · `GET …/arrays/{path}/compute?op=where&rangeLo=&rangeHi=` | HTTP surface; `501` when the server lacks the extension, `400` on a bad operator / range / K-zone. |

- **`reduce` — column maps.** Collapses a 3-D property `[Nk, Nj, Ni]` down the K
  axis into a 2-D `[Nj, Ni]` map. `op` ∈ `sum`/`mean`/`min`/`max`/`count` (cells in
  `[rangeLo, rangeHi]`) / `net` (net-thickness = in-range count × `cellDz`); optional
  `[k0, k1)` K-zone. `IArrayReduceResult { op, ni, nj, columns, map }` — `map` is the
  row-major `[nj, ni]` column map (empty columns NaN for min/max/mean, 0 for
  sum/count/net). This is the net-pay / net-to-gross / targeting-map backbone the
  ORES geology-targeting routes need.
- **`where` — aim points.** Counts the cells whose value is in `[rangeLo, rangeHi]`
  and returns their inclusive **ijk bounding box** and **ijk centroid** (aim point):
  `IArrayWhereResult { valid, count, rangeLo?, rangeHi?, iMin?…kMax?, ci?, cj?, ck? }`
  — i.e. "where is φ·(1−Sw) > cutoff, and where is its centre of mass?".
- **`whereMulti` — intersected aim points (logical AND).** Takes several
  `{ dataArrayId, range }` predicates evaluated on the **same grid** and returns the
  cells satisfying *every* band simultaneously: `IArrayMultiWhereResult { valid, arrays,
  count, iMin?…kMax?, ci?, cj?, ck? }` where `arrays` is the number of predicates
  intersected — e.g. "where is φ in-range **and** Sw below cutoff **and** Kh above
  threshold?". A single predicate degenerates to the same answer as `where`.
- **Largest connected body (the drillable target).** The whole passing set may be a dust
  of isolated cells scattered through tight rock, so `IArrayMultiWhereResult` also carries
  the biggest **6-connected** body: `components` (number of separate bodies), `bodyCount`
  (its volume), `biMin?…bkMax?` (its ijk bbox) and `bci?`/`bcj?`/`bck?` (its ijk centroid =
  the aim point). Compare `bodyCount` against `count` to judge fragmentation. The store cuts
  only geometric gaps today; sealing (low-transmissibility) fault faces will split bodies
  once `GridConnectionSet` transmissibilities are extracted server-side.
- **Graceful degradation** — `parseArrayReduce()` / `parseArrayWhere()` /
  `parseArrayMultiWhere()` return `null`
  when the server did not answer with `reduce.*` / `where.*` keys (older server),
  the same "fall back to a client-side reduction" signal as `stats`.
- **Back-compat** — additive; the markers are opaque to servers without the
  extension, and non-extension `GetDataArrayMetadata` behaviour is unchanged.

### Verified semantics, guards & numbers (validated against open-etp-server !611/!612)

What the store actually computes — asserted by the client test suites rather than
assumed:

- **`stddev` is the population standard deviation** (`sqrt(m2 / count)`), not the
  sample one. `count + nullCount == Nk·Nj·Ni`; `sum == mean · count`; integer-null
  sentinels (`INT32_MIN`, …) are excluded from `count` and the folds.
- **Percentiles are clamped to `[minimum, maximum]`.** A percentile falling in the
  under-tail returns `min(minimum, rangeLo)`, in the over-tail `max(maximum,
  rangeHi)`; inside a bin it is linearly interpolated (accuracy one bin width). So a
  window entirely above the data yields all-underflow, zero bins and three finite
  percentiles equal to the minimum.
- **Conservation across paths** (checked on Drogon PORO, `[31,73,46]`):
  `histUnderflow + Σbins + histOverflow == count`, `Σbins == inRangeCount`,
  `Σ reduce(sum) == stats.sum`, `Σ reduce(count,[lo,hi]) == stats.inRangeCount ==
  where.count` (49 535), `Σ reduce(net, dz) == dz · inRangeCount`, full K-zone
  `[0, Nk)` == un-zoned, single-predicate `whereMulti` == `where`.
- **Guards (REST status ← ETP code).** `400 ← EINVALID_ARGUMENT`: `rangeLo >
  rangeHi`, non-finite bound, `bins` without a range, `bins > 65536`, `op=count`
  without a range, unknown `op`, `k0 >= Nk` (`k1 > Nk` is clamped), `cellDz <= 0`,
  more than 16 `where-multi` predicates. `404 ← ENOT_FOUND`: any missing array
  (also inside a `where-multi` batch). `412 ← EINVALID_STATE`: `where-multi`
  predicates on arrays of different shape. `501 ← ENOTSUPPORTED`: store without
  the extension.
- **Marker grammar fix (client side).** `REDUCE|<op>|k0|k1|lo|hi|dz` is positional;
  `DataArrayCustomer.reduce()` used to send `0|0` for "no K-zone", which the store
  rejects as `k1 <= k0`, so every range-only `count` / `net` reduce failed with
  `400`. It now emits the documented `-|-` placeholder. No server change.
- **Coverage.** Bruno `Drogon/D41–D71` (31 requests, 83 assertions: the invariants
  above, the tails cases, integer-valued properties, every guard) and jest
  `TestClient` exact-value cases on a `[3,2,2]` grid with `V[g] = g` (e.g. `sum 66`,
  `mean 5.5`, `stddev √(143/12)`, `p10/p50/p90 = 1.2/6/10.8` over 12 unit bins,
  `reduce sum [12,15,18,21]`, `where [3,8] → bbox i[0,1] j[0,1] k[0,2], centroid
  (0.5,0.5,1.0)`) plus the rejection matrix. Run: `cd bruno && npx @usebruno/cli
  run Drogon/D4*.bru Drogon/D5*.bru Drogon/D6*.bru Drogon/D7*.bru --env Local`.
- **Indicative cost** through this gateway against a debug (+coverage) server build
  on one host, 5-run median — the M27 alternative is `GET …/arrays/{path}` and
  compute client-side:

  | Path | 104 098 cells | 899 944 cells |
  | ---- | ------------- | ------------- |
  | M27: GET full array (JSON) | 50 ms · 1.47 MB | 167 ms · 1.80 MB |
  | `stats` (+range, 10 bins, p10/50/90) | 13 ms · 176–429 B | 31–36 ms · 145–356 B |
  | `reduce` (`sum` / `count` / `net` → `[nj,ni]` map) | 13–16 ms · 10–62 KB | 23–28 ms · 36–45 KB |
  | `where` (bbox + centroid) | 14 ms · 195 B | 28 ms · 191 B |
  | `where-multi` (2 predicates + bodies) | 23 ms · 349 B | 77 ms · 346 B |

  Reply size is the hard number (O(1) for `stats`/`where`, O(nj·ni) for `reduce`);
  the time ratio on this host is dominated by JSON serialisation of the full array
  and is not a throughput claim.

## First-class array ingest (ProdML / WITSML unification)

Inline, XML-encoded sample data (WITSML logs & trajectories, ProdML time-series /
DAS / DTS) is now unified behind one domain-neutral extraction layer,
`src/lib/restApi/shared/channelArrays.ts`, so every domain externalizes bulk into
ETP data arrays the same way through `ResqmlClient.putDataArray`.

> **Design note — params over routes.** This lane adds **no** per-domain
> endpoints. All convenience is exposed as **query params / options on the
> existing generic array routes** (and options bags on the SDK), so WITSML, ProdML
> and EML arrays share one surface: `?starts=&counts=` (windowed reads),
> `…/stats?rangeLo=&rangeHi=` (server-side reduction), `?override=true|false`
> (force/skip extraction), and advisory compression via ETP `customData` — never a
> new route. SDK helpers are option-driven too (`parseCsvLog(csv, opts)`,
> `importCsv(text, opts)`, `getDataSubarray(uri, path, starts, counts)`).

- **Domain-neutral extractors** — `extractChannelArrays` (WITSML logs / ChannelSet),
  `extractTrajectoryArrays`, `extractProdmlTimeSeriesArrays`, plus the
  `extractProdmlArrays(xml, uri)` dispatcher that returns `{ arrays, kind }`
  (`das` | `timeseries` | `channel` | `none`). Common `injectExternalArrayRefs` /
  `arrayPathFor("<PREFIX>", uuid, mnemonic)` helpers wire the external-array
  references and the `/PREFIX/<uuid>/<mnemonic>` path convention.
- **N-D shape preservation (UDAR / DAS / tensor channels)** — `injectExternalArrayRefs`
  now emits EML `ExternalDataArrayPart.Count` and `.StartIndex` as the
  **per-dimension** lists the schema defines (`PositiveLong[]` / `NonNegativeLong[]`),
  one `<eml:Count>` per axis plus a whole-array `<eml:StartIndex>0</eml:StartIndex>`
  per axis, in XSD sequence order (`Count[]` → `PathInExternalFile` → `StartIndex[]`).
  A rank-3 UDAR azimuthal-resistivity tensor `[depth, spacing, freq]` therefore
  round-trips its shape (`4·3·2` axes) instead of collapsing to a single flattened
  length; 1-D curves are unchanged (one Count, one StartIndex).
- **DAS / DTS classification** — `isDasHdf5Object` routes ProdML DAS
  (DasRaw/Fbe/Spectra) to the HDF5/EPC path (samples live only in companion HDF5,
  never inline); `isDtsChannelObject` recognises DTS temperature-vs-distance
  ChannelSets so `extractChannelArrays` handles their numeric payload. Rank-agnostic
  `ChannelArray.dimensions` keeps N-D tensors (e.g. UDAR azimuthal resistivity)
  ingestible as external arrays even absent a public schema.
- **First-class ingest policy** — `shouldExtractArrays({ override, byteLength })`
  is tri-state: `override="false"` never extracts, `"true"` always, and unset
  auto-extracts only when the serialized payload exceeds
  `INLINE_ARRAY_THRESHOLD_BYTES` (64 KiB) — matching the store's inline/`bin`
  boundary, so small objects stay cheaply inline. The `@Put` object-write gate
  honours this per object.
- **Windowed / lazy reads** — `GET …/arrays/{path}?starts=&counts=` fetches an
  N-D subarray (`ResqmlClient.getDataSubarray`, Protocol 9 `starts[]`/`counts[]`)
  instead of the whole array, with `starts`/`counts` validated against the array
  dimensions; large windows are auto-sliced to fit the negotiated message size.
  Domain-agnostic, so DAS/DTS/time-series windows all read through the same route.
- **Compression hints** — `compressionHintFor({ byteLength })` emits an advisory
  `{ zcomp: true, PreferredCompression: "gzip" }` for arrays above
  `ZCOMP_HINT_THRESHOLD_BYTES`, attached as ETP `customData` on the array put. It
  is purely advisory: a store that supports `zcomp` may compress the `bin` chunks,
  and any store that does not simply round-trips the keys back in the array
  metadata — keeping the client server-independent.
- **Tests** — `src/__tests__/TestChannelArrays.ts` covers the extractors,
  DAS/DTS classification, the dispatcher (incl. a DTS ChannelSet round-trip), the
  ingest policy and the compression-hint thresholds (`tsc --noEmit` clean).

## `/witsml/store` binary-array hardening (M28)

`PUT /witsml/store` historically accepted bulk sample data **only** as inline-XML
`<Data>` arrays. That path is lossless but balloons the payload (a single Chevron
KKS1 CMR ingest produced ~**178 MB** of XML) and left the caller to hand-roll an
orphan/missing-array transaction dance. The endpoint now accepts **pre-computed
binary arrays** so a lossless N-D ingest is a single call.

- **`WitsmlStoreDto.arrays?: WitsmlArrayDto[]`** (`src/lib/.../Witsml.controller.ts`)
  — each entry is `{ mnemonic, dimensions, data?: (number|null)[] | base64?,
  arrayType?, containerUuid? }`. `data` carries JSON floats (`null` → `NaN`);
  `base64` carries little-endian `Float64` bytes (≈ 40 % smaller on the wire, no
  JSON number parsing).
- **Conversion + validation** — `decodeFloat64Base64` + `witsmlArrayDtoToChannelArray`
  validate element type, dimensions and value count, then merge each entry into the
  existing `objectArrayMap` keyed by `containerUuid` (defaulting to the sole object
  when only one is stored) **after** inline-XML extraction and **before** the
  inject-refs loop. The **existing** `injectExternalArrayRefs` + `putDataObjects` +
  `putDataArray` + commit flow then runs — all inside one transaction. Pass
  `?transactionId=` to co-manage with a caller-owned txn, omit it to auto
  open+commit. This collapses the four-step (open txn → PUT metadata → PUT arrays →
  commit) ingest into server-side logic.
- **Approaches** — inline-XML arrays (one call, no bookkeeping, but XML balloons;
  use for tiny logs); manual four-step binary (full control + custom batching/row
  slicing for multi-GB arrays, but caller injects refs and manages the txn); and
  the new `arrays[]` field (single call, binary float64/base64 efficiency, refs +
  txn handled server-side, N-D shape preserved) — the recommended default.
- Validated: `tsc` clean; KKS1 round-trip (`T2_DIST [1385,30]`, 41 550 values)
  still green; the same scripts drove real WITSML ChannelSets into the Interop RDDMS
  (`maap/udar`, `maap/kks`) over ETP with shapes intact.

## PWLS intuitive-mnemonic alias layer (M28)

`getPropertyFromMnemonic` (`src/lib/jsonTypes/PwlsCurveCatalog.ts`) gains a curated
`intuitiveAliasMap` so common vendor curve mnemonics that are **not** in the PWLS v4
catalog still resolve to one unambiguous canonical property: `INC` → *hole deviation*
(`0d7bf711…`), `AZM` → *hole azimuth* (`69e09051…`), `EAST` → *x coordinate*
(`620cec71…`), `NORTH` → *y coordinate* (`cfcfdb04…`), `DOD` → *radius*
(`977d5685…`). Exact vendor mnemonics still win first; the alias map is only a
fallback. `/pwls/resolve` therefore returns `property` + `quantityClass` +
`propertyTypeId` for these intuitive spellings end-to-end.

## SDK, builders & OSDU converters (M28)

> These shipped as SDK / converter deltas over M27 (the REST routes above are their
> HTTP façade). Migrated here from the roadmap's "Recently shipped" log so the todo
> tracks only open work.

### Seismic-interpretation SDK lane

Built on RESQML **2.2.0** (with **2.0.1** fallback).

- **Object builders** (`src/lib/builders/`, pure, validator-passing):
  `buildGrid2d`, `buildPointSet`, `buildPolylineSet`,
  `buildContinuousProperty` / `buildDiscreteProperty`, `buildLocalCrs`,
  feature/interpretation stubs; plus `buildVelocityModel`,
  `buildWellboreFrame` / `buildCheckshot`.
- **Domain SDK** `RddmsClient.seismic.*` — transaction-aware `put`/`get` for
  `velocity`, `checkshots`, `horizons.{putGridded,putPicks}`, `faults.putSticks`,
  `properties`, with **reversible** OSDU projection on `get`.
- **Reversible OSDU projections**:
  `toOsduGenericProperty` → `GenericProperty:1.0.0`; `toOsduWellLog` →
  `WellLog:1.3.0` (flattened MinMd/MaxMd/SamplingInterval). Round-trip fidelity is
  stamped honestly in `ExtensionProperties.RoundTripFidelity`: checkshots are
  `lossy` on 2.2.0/2.0.1 (decomposed into a `WellboreFrame` + time property), while
  velocity round-trips fully on every line. *(A `full` checkshot path via a native
  `SeismicWellboreFrameRepresentation` is wired in but forward-looking — that object
  arrives in a future RESQML line and is not exercised on 2.2.0/2.0.1.)*
- **Manifest classification** (`buildSeismicWpc` / `classifySeismicObject`):
  CRS-domain-driven WPC — `Grid2d` time → `SeismicHorizon`, `Grid2d` depth →
  `StructureMap`, `PolylineSet` → `SeismicFault`, `PointSet`/`ContinuousProperty` →
  `GenericProperty`.
- **SDMS↔RDDMS bridge resolver** (`src/lib/builders/bridge.ts`, pure/I-O-free):
  forward `resolveCubeRefs(wpc)`, attach `withCubeRefs`, reverse
  `interpretationsForCube` / `indexInterpretationsByCube` — answers "which cube was
  this picked on?" over a caller-supplied catalog-WPC set without moving bulk data.
- **Seismic property-kind vocabulary** — `resolveSeismicKind` / `uomCompatible`
  (`vocabulary.ts`), 15 canonical SKOS kinds, lockstep-verified against the datadef
  vocab (`datadef/interpretation/vocab/seismic-property-kinds.{json,ttl}`).

### OSDU converter & data-model deltas

- **CRS (O1)** hollow-record fix — `LocalModelCompoundCrs` converter fills the
  pure-geodetic identity (`CoordinateReferenceSystemID`,
  `VerticalCoordinateReferenceSystemID`, `PersistableReference*`, `*CrsName`);
  local frame kept on dataset metadata; `ExtensionProperties` fallback until the
  ≥1.3.0 kind is registered in the Schema/Search service.
- **CRS (O1a) preferred Coordinate Transformation (opt-in)** — RESQML has no
  Bound CRS, so a bare projected EPSG code cannot say *which* datum-shift
  operation to WGS84 applies. New `RDMS_PREFERRED_CT` env (format
  `sourceEpsg:ctEpsg,…` with `*` fallback) lets an operator pin the CT. When set,
  `OSDUContext.findBoundedEPSGCrs` fetches the exact
  `BoundProjected:EPSG::<base>_EPSG::<ct>` record by deterministic id (instead of
  taking an arbitrary search hit) so WGS84 conversion is reproducible, and
  `LocalModelCompoundCrs` stamps that BoundProjected id on write. **Purely
  additive** — unset leaves all CRS behaviour byte-for-byte unchanged. No new
  route; applies server-side to every REST/SDK call that resolves a CRS.
- **Well converters complete** — Well, Wellbore, Trajectory, Tubular, Completion,
  WellLog, Activity, BhaRun, Rig, FluidsReport.
- **RESQML strict validator** — PropertyKind-hierarchy validation (P02–P04);
  Drogon demo EPC verified to emit **concrete** property kinds throughout (0
  validator errors).
- **ProdML 2.3 production converters (new)** — six ProdML→OSDU manifest converters
  registered in `ResqmlOsdu` (ProdML coverage 2 → 8): `ProductVolume` and
  `AssetProductionVolumes` → `ProductionValues:1.1.1`; `ProductionWellTests`,
  `WellProductionParameters`, `Report` and `ReportingEntity` →
  `GenericRepresentation:1.2.0` (no dedicated OSDU production kind is registered
  yet). Domain specifics (facility, reporting period, flow rates, report / entity
  metadata) are preserved in `ExtensionProperties`; the kind resolver uses
  `getKindOrFallback("<IntendedKind>")`, degrading gracefully to
  GenericRepresentation rather than inventing `osdu:wks:*` kind strings, with
  `TODO(osdu-kinds)` markers where a dedicated kind should later be retargeted.
  Converters read measurement values inline from the parsed ProdML XML (no array
  round-trip). Dispatched through the existing `/manifest` route, listed by
  `GET /health/converters`; `tsc --noEmit` clean.

## Manifest build — selective inclusion & reference closure

Two additions to `POST /manifests/build` (and `createManifest` in
`src/lib/jsonTypes/Manifest.ts`) make it convenient to manifest a hand-picked
selection of objects together with everything they depend on, while dropping
whole categories of records:

- **`followReferences`** (boolean, default `false`) — when the request `uris`
  list names specific objects (rather than a whole dataspace), each selected
  object is expanded to its **full transitive dependency closure**
  (interpretations, features, CRS, property kinds, supporting representations, …)
  and every referenced object is emitted as a **first-class record** — not merely
  resolved internally for DOR/CRS wiring. The objects you listed are never
  filtered out; the pulled-in references still honour
  `typePatterns`/`propertyFilter`/`excludePatterns` (CRS always kept). No effect
  on whole-dataspace inputs, which already enumerate everything.
- **`excludePatterns` friendly kind aliases** — in addition to raw Energistics
  type wildcards (e.g. `"*Activity"`), `excludePatterns` now accepts OSDU-ish
  kind shortnames that expand to the underlying ETP type patterns: `wells`,
  `wellbores`, `logs`, `markers`, `trajectories`, `properties`, `activities`,
  `grids`, `seismic`, `interpretations`, `representations`, `features`. Unknown
  tokens fall through as literal patterns, so `["wells","*GridConnectionSet"]`
  works. Matching stays generic (ETP type names, evaluated at enumeration time
  before OSDU conversion); the aliases are a convenience layer only.

Typical "cherry-pick + closure, minus wells" request:

```jsonc
{
  "uris": ["eml:///dataspace('demo/drogon')/resqml20.obj_TriangulatedSetRepresentation(a3f3…)"],
  "followReferences": true,
  "excludePatterns": ["wells", "logs"]
}
```

## Tooling — one-command spec regeneration

`npm run openAPI` now emits **all three** API spec artifacts from the single
in-memory Nest document so they can never drift: `swagger.json` (legacy filename),
`openapi.json` (byte-identical) and `openapi.yaml` (js-yaml rendering). Previously
only `swagger.json` was written and the `openapi.*` files had to be produced by
hand. `npm run build` runs this step automatically.

## Bug fixes (M28 hardening)

- **LAS/CSV/DLIS channel conversion now yields a valid WITSML 2.1 `ChannelSet`.** The old generator (`lasToWitsml`) emitted each curve as a *separate*
  top-level `Channel` object with its own UUID and produced a `ChannelSet` with **no
  mandatory `<Index>`** — both invalid per the WITSML 2.1 schema, so the store rejected
  every object (surfaced only as a misleading `check UUID format` `400`). Replaced with
  `lasToWitsmlChannelSetXml`, which authors a single schema-complete `ChannelSet` XML
  document directly (default WITSML namespace, **unprefixed** `uuid=` attribute,
  `<eml:Citation>`, **inline** `<Channel>` children — each with `Mnemonic` / `DataType` /
  `Uom` — followed by the required `<Index>`, channels before index) and stores it over
  the working `/witsml/store` `xml` path instead of round-tripping through the
  `xsi:type`-decorated JSON→XML builder (which the server rejects for WITSML growing
  objects). All three input formats (`las` / `csv` / `dlis`) normalise to `ParsedLas` and
  share this one emitter. File: `src/lib/wellbore/witsmlChannels.ts`.
- **`GET /dataspaces/{id}/deleted` no longer hangs on a missing/errored dataspace.**
  `DiscoveryCustomer.onDiscoveryError` routed a `Core.ProtocolException` **only** to the
  `GetResources` handler, never to the `GetDeletedResources` handler. So when the server
  answered a deleted-resources request with a `fatalError` (e.g. `ENOT_FOUND` for a dataspace
  that does not exist), the exception was silently dropped and `waitForRequest` never settled —
  the REST call hung indefinitely. The exception is now offered to both handlers, so the
  request rejects and surfaces the proper HTTP error (e.g. `404`) instead of hanging.
  File: `src/lib/protocols/DiscoveryCustomer.ts`.
- **Preship integration test — clone/reidentify object counts.** `grep -c .` prints `0` **and**
  exits non-zero on no match, so the `|| echo 0` fallback appended a second line, yielding a
  `"0\n0"` value that broke the `[[ … -eq 0 ]]` arithmetic test. Switched the five count
  expressions to `|| true`. File: `test-preship-integration.sh`.
- **`GenericProperty` realisation-index join key (`RealizationIndices`).** The OSDU
  `GenericProperty` record carries `RealizationIndices: number[]`, but the converters only
  emitted the RESQML *scalar* `RealizationIndex` and dropped the inline `RealizationIndices`
  integer array — and the 2.2 path (`GenericProperty22`) blindly cast the whole
  `AbstractIntegerArray` **object** to a number, producing a malformed `[{…}]` element and
  ignoring the 2.2 scalar entirely. Both converters now route through one shared
  `collectRealizationIndices` helper that unions the scalar with any inline
  `IntegerConstant` / `IntegerRange` / `IntegerLattice` array (in the `resqml20` or `eml23`
  namespace), de-duplicates and sorts. HDF5-backed or multi-dimensional index arrays are left
  unresolved and logged (`[U6]`) rather than emitted as garbage. Files:
  `src/lib/jsonTypes/WorkProductComponent.ts`, `GenericProperty.ts`, `GenericProperty22.ts`;
  tests in `src/__tests__/TestReservoirConverters.ts` and `TestManifest.ts`.
- **Store rejections of a `PutDataObjects` batch are no longer swallowed.**
  `StoreCustomer.put` collapsed a scalar `ProtocolException` (for example
  `ETP-8 1 Missing reference(s) in space X`, a locked dataspace or an invalid object) into
  `Unknown error`, and `ResqmlClient.putDataObjects` then logged it and returned `false`.
  Every builder lane (`/seismic/*`, `/grid/*`, `/tables/*`, `/wells/*`),
  `/witsml/store` and `/epc/upload` awaited that boolean without checking it, so a rejected
  write answered `200` with nothing stored (or a misleading `check UUID format` `400`). The
  protocol layer now keeps the server's message and code, `putDataObjects` /
  `lockDataspaces` / `unlockDataspaces` accept `{ throwOnError: true }`, and all write lanes
  use it, so the store reason reaches the client with the right status (`412` for a missing
  reference, `409` for a lock conflict, `404` for an unknown dataspace). Files:
  `src/lib/protocols/StoreCustomer.ts`, `src/lib/client/ResqmlClient.ts`, the write
  controllers.
- **`PUT /dataspaces/{id}/lock` and `/unlock` answer `409 Conflict`** with the store's
  reason when the dataspace is already in the requested state (or an `intoExisting` clone
  still references it) instead of `404 Not Found`. A missing dataspace stays `404`.
  File: `src/lib/restApi/read-etp.module/Resource.controller.ts`.
- **Table / Well / Seismic lanes write the HDF proxy when absent.** The builders emit
  arrays whose container is the caller's `hdfUuid` `EpcExternalPartReference`; if that object
  had never been written the store rejected the arrays with `Missing array container(s)`.
  `ensureHdfProxies` now looks the proxy up (either EML version, same session so a joined
  transaction is honoured) and prepends a freshly built one to the batch when it is missing.
  The Grid lane already did this. File: `src/lib/restApi/HdfProxyUtils.ts`.
- **`GET /dataspaces/{id}/arrays/{uri}` honours `Accept: application/octet-stream`** as an
  alternative to `?format=binary`. File: `src/lib/restApi/read-etp.module/Array.controller.ts`.
- **Collections.** Postman `06 Query` is split into `Find` / `Compute` / `Graph languages` /
  `Linked data` (the RDF artifacts use the `/rdf/:artifact` path variable); lock tests assert
  the `409` states; `SE3` writes the checkshot as RESQML 2.0.1 to match the 2.0.1 trajectory of
  `WB2` (a 2.2.0 object cannot reference a 2.0.1 one). Bruno `W02` / `W03` assert the stored
  WITSML object (W03 read the dataspace with `bru.getVar`, which does not see environment
  variables; it now uses `bru.getEnvVar`), and the LAS header checks are case-insensitive.

> Server-side companion: the reidentify/clone round-trip failure (`ETP-8 … vector::reserve`) on
> large dataspaces is fixed in **open-etp-server** (partial-final-batch clamp `1115d82`,
> `typ_id` array-escape `f1461fe`) — see [open-etp-server !586](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-server/-/merge_requests/586)
> and the server M28 release notes.

## Verified against open-etp-server (live integration, 2026-11-14)

The whole M28 delta was exercised against a live open-etp-server built from
`maap/3-growing-channel` `d06dce6` (DiscoveryQuery 13, GrowingObject 6,
ChannelSubscribe 21 and the array compute extensions, stacked on server !583 `d91e958`
and !616), started with `--authN none` on port 9002, `demo/Volve` seeded from
`tests/data/eml/WELL_RESQML.epc` (91 objects, 16 types), REST gateway on port 8080.

| Suite | What it covers | Result |
|---|---|---|
| `npm run test:integration` (`TestClient.ts`) | store / discovery / arrays / dataspace copy, lock, reidentify / REST round trips | 131 passed, 2 skipped |
| `TestProtocolsIntegration.ts` (new, live-only: part of `npm run test:integration`, excluded from the unit run because it needs a seeded dataspace and a P13/P6/P21 server) | P13 `FindResources` x 5 scopes x depth 1..3 compared with P3 on the same seed; P6 parts round trip (Md and DTim indexed parts, ranges, metadata, change annotations, upsert, delete); P21 `GetChannelMetadata` on object and dataspace URIs; REST `/query/*` facade | 35 passed |
| `TestWitsmlQuery.ts` functional | `/witsml/store` and `/witsml/query` against a self-contained `test/witsml-<ts>` dataspace with canonical UUIDs | 23 passed |

Bugs found by the live run and fixed in this delta:

- `Manifest.ts`: ACL key ordering regression in the generated OSDU manifest.
- `Metrics.provider.ts`: Prometheus counters were registered against the global
  registry instead of the module registry (duplicate registration on hot reload).
- `Witsml.controller.ts`: a store request without a dataspace returned 500; it is
  now a 400 with a problem message.
- WITSML sample Well used a non-canonical UUID; the server rejects those with 400
  "ETP requires standard UUID format", so fixtures and tests use canonical UUIDs.
- P21 dataspace-scope test derives its expectation from P3: a dataspace without
  Log / Channel / Trajectory objects correctly yields 0 channels.

Server facts the tests now rely on: `CopyToDataspace` / `CopyDataspacesContent`
require the source dataspace to be locked and leave an `admin.space_rel` reference that
blocks a later unlock of the referenced dataspace; `PutDataArrays` needs the container
data object to exist first; `activeStatusFilter` was accepted but ignored by P3 / P13
until server `d91e958`.

Against a stock server `main` (without !583 / !616) the `/query/*` routes and the
P13 / P6 / P21 customers answer 501 Not Implemented; everything else in this delta is
compatible with the M27 server.

## Not yet included

- **EPC + H5 upload against a store that enforces the orphan-array rule (#247).**
  `POST /dataspaces/{id}/epc/upload` commits in sub-transactions of
  `RDMS_COMMIT_BATCH_SIZE` (default 49) objects and puts each array in the batch
  that commits its *container* (`EpcExternalPartReference`, batch 1) rather than
  its *owner* object (a later batch). An M28 open-etp-server rejects batch 1 with
  `412 "N Orphan array(s)"` and the whole upload fails. Workaround until fixed:
  `RDMS_COMMIT_BATCH_SIZE=0` (single transaction).

- **Real-time channel streaming (Protocol 21)** - `SubscribeChannels` /
  `UnsubscribeChannels` return `ENOTSUPPORTED` server-side; `POST /query/growing` with `includeChannels` is
  discovery-only. Streaming (SSE / WebSocket) is deferred - see `ToDo.md`.
- **GrowingObjectNotification (Protocol 7)** - not implemented (no server handler,
  no client customer).
