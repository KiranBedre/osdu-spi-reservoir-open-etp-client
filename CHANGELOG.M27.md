# CHANGELOG: M27 (2026) — Reservoir DDMS Client

All changes vs upstream `@osdu/open-etp-client` (base commit: `cfffaa2`).

---

## New Interfaces

### REST Endpoints (8 new)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/query/resources/find` | FindResources by URI + scope/depth/type filter (ETP Protocol 13) |
| POST | `/query/objects/find` | FindDataObjects with full XML content (ETP Protocol 14) |
| POST | `/query/graph/search` | Batch graph search — merged subgraph for multiple URIs |
| POST | `/query/growing/metadata` | Growing-object part metadata (ETP Protocol 6) |
| POST | `/query/growing/range` | Growing-object parts by index range (ETP Protocol 6) |
| POST | `/query/channels/metadata` | Channel metadata for streaming (ETP Protocol 21) |
| PUT | `/witsml/store` | Ingest WITSML 2.1/1.4.1 XML with auto-transaction and channel extraction |
| POST | `/dataspaces/{id}/epc/upload` | Upload EPC + H5 file pair, unzip, parse, and ingest with transaction |
| GET | `/wells?name=&dataspace=&include=` | Cross-dataspace well search with hierarchy resolution |

### GraphQL API

New `/graphql` endpoint with field-level selection and DataLoader batching. Query types: `dataspaces`, `resources` (with lazy `content` and `arrays` fields), `graph` traversal. Uses the same ETP session pool as REST.

### ETP Protocol Handlers (5 new)

| Protocol | ID | Handler | Purpose |
|----------|---|---------|---------|
| DiscoveryQuery | 13 | `DiscoveryQueryCustomer` | URI-pattern resource search with scope/depth |
| StoreQuery | 14 | `StoreQueryCustomer` | Bulk data object retrieval |
| GrowingObject | 6 | `GrowingObjectCustomer` | Log curve / trajectory station parts by range |
| GrowingObjectNotification | 7 | `GrowingObjectNotificationCustomer` | Push notifications for part changes |
| ChannelSubscribe | 21 | `ChannelSubscribeCustomer` | Real-time channel metadata and streaming |

All protocols are auto-negotiated at ETP session open — no configuration needed. The `RDMS_ETP_EXTENDED_PROTOCOLS` env var has been removed.

---

## New Features

### OSDU Manifest Builder Enhancements

- **Schema Service integration** — on boot, queries OSDU Schema Service for latest kind versions (M27+). Falls back to static `FALLBACK_KINDS` if unavailable.
- **CollaborationProject** — auto-generates a `master-data--CollaborationProject:1.0.0` record per dataspace with deterministic UUID v5 and lifecycle events.
- **Lineage** — auto-generated Activity record linking source EPC to output manifest records.
- **Best-effort mode** — converter errors skip the failed object instead of aborting the entire build. Check `errors[]` in the response.
- **`includeArrayData` option** — opt-in to bulk data array reads during manifest build.
- **Smart property inclusion** — properties with canonical OSDU/PWLS names are auto-included; non-canonical properties excluded to avoid manifest bloat.
- **Transmissibility detection** — GridConnectionSet records report `HasTransmissibilityMultipliers` when attached properties are found.
- **WellLog depth range** — WellboreFrame→WellLog populates TopMeasuredDepth/BottomMeasuredDepth.

### OSDU Converters (20+ new)

| Category | Types |
|----------|-------|
| **Reservoir modelling** | IjkGrid enrichments (RealizationIndex, ParentGrid, HasTruncations, RockFluidOrganization), GenericBinGrid, HorizonControlPoints, ReservoirCompartmentInterpretation, GridConnectionSetRepresentation |
| **Structural** | StructuralOrganizationInterpretation, SeismicLineGeometry |
| **PRODML** | FluidModel (FluidCharacterization), ProductionValues (TimeSeriesData) |
| **WITSML** | Rig, Tubular, FluidsReport, BHARun, WellCompletion |
| **WellLog flattening** | WellboreFrame with N properties → single WellLog record |
| **Master data dedup** | BoundaryFeature de-duplication on re-ingest |
| **Lineage** | Activity parameter extraction with typed values |

### CRS Enrichment

- **Vertical CRS extraction** — reads EPSG from inline (v2.0) or DOR-resolved (v2.2) vertical CRS definitions.
- **Local-frame metadata** — preserves all 9 local engineering CRS parameters in `rddms/localFrame/*` for lossless round-trip.
- **WKT CRS detection** — supports non-EPSG coordinate systems via WKT string parsing.
- **Rotated-CRS affine transforms** — correct SpatialArea bounding boxes for rotated local CRS.
- **LocalAuthority CRS (v2.2)** — maps company-managed CRS codes to OSDU reference-data IDs.

### Round-Trip Fidelity

- **ExtraMetadata preservation** — non-`osdu/`-prefixed entries kept in `ResqmlMetadata`.
- **AuthoringSoftware** — `Citation.Format` mapped for all WPCs.
- **IjkGrid field completion** — RealizationIndex, ParentGridID, RockFluidOrganizationInterpretationIDs, HasTruncations.
- **PropertyKind→UnitQuantity** — QuantityClass lookup for v2.2 PropertyKinds.
- **Activity parameters** — full typed extraction (String, Float+UOM, Integer, DataObject, TimeIndex).
- **Display labels** — InterpretationName prepended to WPC names for richer catalog display.

### WITSML Support

- **Store endpoint** (`PUT /witsml/store`) — accepts WITSML 2.1 and 1.4.1 XML. Auto-detects plural containers, generates deterministic UUIDs, extracts channel data and trajectory stations as ETP arrays.
- **Query endpoint** (`POST /witsml/query`) — query objects by type filter.
- **Well search** (`GET /wells`) — cross-dataspace search with automatic hierarchy resolution (wellbores, logs, trajectories, channelSets).

### EPC Upload

- **Upload endpoint** (`POST /dataspaces/{id}/epc/upload`) — accepts `multipart/form-data` with an EPC file (ZIP) and optional H5 file. Unzips the EPC, parses `[Content_Types].xml`, extracts all XML objects, reads referenced HDF5 datasets, and ingests everything into the target dataspace.
- **Auto-transaction** — wraps the entire ingest in a transaction (start → put objects → put arrays → commit). Rolls back on failure. Supports caller-managed transactions via `?transactionId`.
- **Batched object writes** — objects are sent in batches of 100 to stay within ETP message size limits.
- **Bounded memory** — H5 file stored on disk (multer disk storage), arrays read and sent one at a time.
- **Configurable limits** — `RDMS_EPC_MAX_SIZE_MB` (200), `RDMS_H5_MAX_SIZE_MB` (2048), `RDMS_EPC_MAX_OBJECTS` (10000).

### Operational

- **Converter registry** — `GET /health/converters` lists all registered source types and target OSDU kinds.
- **SIGTERM graceful shutdown** — stops accepting requests, rolls back open transactions, exits within 30s.
- **SSL config** — `RDMS_ETP_SSL_VERIFY=false` for self-signed certificates.
- **Retry + array chunking** — exponential backoff and 4MB chunk limit for large array uploads.

---

## Behavioral Changes ⚠️

These changes may affect existing consumers:

| Change | Old behavior | New behavior | Workaround |
|--------|-------------|--------------|------------|
| **Default manifest filter** | All RESQML types included | Only Interpretations, Representations, WITSML | Pass `typePatterns: ["*"]` |
| **Grid2d routing** | Depth-domain Grid2d with HorizonInterpretation → GenericRepresentation | → StructureMap | — |
| **DELETE locked dataspace** | Returned 204 (silent success) | Returns 403 | Unlock before delete |
| **Protocol negotiation** | `RDMS_ETP_EXTENDED_PROTOCOLS` env var | Auto-negotiated, env var removed | — |
| **Dataspace ACL override** | ETP customData always overrode pre-configured ACLs | Pre-configured ACLs take priority | — |

---

## Bug Fixes

| # | Summary | Impact |
|---|---------|--------|
| — | Circular reference resolution in `resolveReferences()` | Objects with mutual DORs now fully resolved |
| — | TriangulatedSurface node count 3× overcount | `IndexableElementCount` was counting x,y,z separately |
| #126 | Invalid dateTime → HTTP 500 | Now returns 400 with descriptive message |
| #130 | DELETE locked dataspace → 204 | Now propagates 403 |
| CRS-2 | ArealRotation wrong for rotated local CRS | Correct affine transform applied |

---

## Test Coverage

| Suite | Count | Scope |
|-------|-------|-------|
| CRS and bugfixes | 41 | Bug fixes, rotation, routing, chunking, SIGTERM |
| Manifest | 12 | Converter registry, collaboration UUID, dedup, lineage |
| Seismic line geometry | 7 | Coordinate extraction and kind mapping |
| Reservoir converters | 40 | IjkGrid, FacetIDs, MilestoneKinds, PRODML |
| BinGrid + ControlPoints | 18 | GenericBinGrid, HorizonControlPoints routing |
| Activity converter | 9 | Parameter extraction (all typed variants) |
| Reservoir layer 1 | 146 | Smart property filter, transmissibility, ColumnBasedTable |
| Other (unchanged) | 148 | ETP protocol, client, error mapping, validation |
| **Total** | **421** | `npm test` |

Integration tests (require ETP server): `npm run test:integration`
