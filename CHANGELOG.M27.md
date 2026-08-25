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
| RESQML Validator | 50 | 9 layers, real datasets (pyetp, SKUA, DGI, Aspen RMS), ValidatorClient local mode |
| **Total** | **471** | `npm test` |

Integration tests (require ETP server): `npm run test:integration`

---

## REST API Documentation (OpenAPI / Swagger)

> **New in M27** — the interactive Swagger UI page (served at the REST API root) now contains comprehensive, self-contained documentation for every endpoint. The static `RestApi.md` file has been removed.

### What changed

- **Rich endpoint descriptions** — every `@ApiOperation` decorator now includes purpose, required context (transaction, dataspace), chunking/batching notes, and inline examples where applicable.
- **Tag-level documentation** — each section header (Health, Auth, Resources, Manifest, Query, Transactions, Write, Wells, WITSML, PWLS, Metrics) includes a summary of scope and transaction requirements.
- **Logical tag ordering** — tags are ordered by typical usage flow (health → auth → read → manifest → query → write → domain-specific → metrics), not alphabetically. A custom `tagsSorter` preserves `addTag()` declaration order.
- **Tag split** — "Wells" section split into separate **Wells**, **WITSML**, and **PWLS** tags for clarity.
- **Top-level description** — the Swagger page header documents ETP protocols, write workflow (start transaction → put objects → put arrays → commit), scope values, pagination, and environment variables.
- **`RestApi.md` removed** — all content migrated into the OpenAPI decorators. `README.md` references updated to point to the Swagger UI.
- **`openapi.yaml` and `swagger.json` regenerated** — reflect all enriched descriptions. Can be used for client generation.

### RESQML Validator (built-in)

> **New in M27** — a complete RESQML strict-validation engine is now bundled as a TypeScript module. No Python, no separate container, no subprocess. Runs in-process.

- **9 validation layers** — EPC structure, XSD schema (via libxmljs2/libxml2), DOR integrity, HDF5 references, cross-object consistency, business rules S01–S18, PWLS PropertyKind, fesapi compatibility, RDDMS compatibility.
- **Supported schema versions** — RESQML 2.0.1 and 2.2 (XSD schemas bundled). Versions 2.0.2 and 2.3.0 excluded from public release (not yet published by Energistics).
- **`ValidatorClient` local mode** — when no `RDMS_VALIDATOR_URL` is configured (the default), validation runs in-process via the built-in engine. Set `RDMS_VALIDATOR_URL` to fall back to an external HTTP validator service.
- **In-memory validation** — `validateObjects()` accepts XML strings directly (e.g. from ETP GetDataObjects), no EPC file needed.
- **Skip options** — each layer can be individually disabled: `skip_xsd`, `skip_dor`, `skip_business_rules`, `skip_fesapi`, `skip_hdf5`, etc.
- **38 unit tests + 12 dataset integration tests (50 total)** — covers all 9 layers, end-to-end EPC validation, in-memory validation, `ValidatorClient` local mode, roundtrip diff detection, and real-world EPCs from 4 authoring tools.
- **6 real-dataset integration tests** — validated against EPCs from 4 different authoring tools:

| Dataset | Source | Objects | Errors | Warnings | XSD time | Fast-path |
|---------|--------|---------|--------|----------|----------|-----------|
| demo_seismic | pyetp | 6 | 0 | 2 | 656 ms | 3 ms |
| pyetp_demo | pyetp | 9 | 0 | 4 | 210 ms | 2 ms |
| Volve (SKUA) | PDGM-DX ETP Client | 30 | 0 | 4 | 1.0 s | 7 ms |
| Olympus | DGI cv_etpexport + fesapi | 395 | 0 | 251 | 12.8 s | 95 ms |
| Teapot | DGI cv_etpexport + fesapi | 108 | 0 | 28 | 3.1 s | 23 ms |
| Drogon | Aspen RMS + ores (fesapi roundtrip) | 276 | 0* | 46 | 8.3 s | 101 ms |

  \* Drogon has 1 RDDMS-compat info (missing `.rels` for EpcExternalPartReference) — not a validity error.

- **Performance** — without XSD (fast-path), even the 395-object Olympus model validates in under 100 ms. XSD validation is ~30 ms/object (libxml2 parse + validate per object).
