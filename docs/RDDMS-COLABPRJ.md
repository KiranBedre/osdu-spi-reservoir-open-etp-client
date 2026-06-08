# RDDMS CollaborationProject Integration (S5)

## Overview

The OSDU `master-data--CollaborationProject:1.0.0` schema (M27/Venus) provides a
**namespace for work-in-progress (WIP) data** across DDMS instances and domains.
It represents the "system of engagement" (SOE) — a temporary collaborative workspace
where data lives before being published to the "system of record" (SoR).

In RDDMS, an **ETP dataspace maps directly to a CollaborationProject**:

```mermaid
graph LR
  subgraph DS["ETP Dataspace (maap/drogon)"]
    R[RESQML objects<br/>grids, horizons, faults]
    W[WITSML objects<br/>wells, logs, trajectories]
    A[Data arrays<br/>HDF5 binary]
  end
  DS <-->|"1:1 mapping"| CP["CollaborationProject<br/>(OSDU master-data)"]
```

## Architecture

```mermaid
graph LR
  subgraph RDDMS["RDDMS (SOE)"]
    DS[ETP Dataspace]
    OBJ[Objects<br/>XML/Avro]
    ARR[Arrays<br/>binary]
    LOCK[Lock state]
    MB[Manifest Builder<br/>POST /manifests/build]
    DS --- OBJ
    DS --- ARR
    DS --- LOCK
  end

  subgraph OSDU["OSDU Catalog (SoR)"]
    CP[CollaborationProject<br/>Namespace, Lifecycle,<br/>DefaultWIPACL]
    WPC[WPC records<br/>WellLog, Grid...]
    MD[MasterData<br/>Well, Wellbore...]
  end

  MB -->|manifest| CP
  MB -->|manifest| WPC
  MB -->|manifest| MD
```

## Consistency Model

### The Problem

Multiple processes interact with the same data:
- ETP clients create/modify objects in dataspaces
- Manifest builds push records to OSDU
- Dataspace locks/unlocks change lifecycle state
- Multiple DDMS instances may reference the same collaboration
- OSDU ingestion is eventually consistent (async workflow)

### The Solution: Idempotent Upsert at Manifest Time

RDDMS uses **eventual consistency** with RDDMS as the **source of truth**:

| Guarantee | Mechanism |
|-----------|-----------|
| **Deterministic identity** | UUID v5 from dataspace name → same CP always gets same ID |
| **Version tracking** | Checks existing version in OSDU, bumps on update |
| **Additive updates** | Never deletes fields, only enriches (DDMSDatasets merge) |
| **Idempotent** | Repeated manifest builds produce the same record |
| **Lock-state sync** | LifecycleStatusID reflects dataspace lock at build time |

### What IS guaranteed

1. **Every manifest build includes a fresh CP record** — derived from live dataspace state
2. **CP ID is stable** — same dataspace always maps to the same CollaborationProject UUID
3. **Version conflicts are avoided** — existing OSDU version is checked before push
4. **ACL inheritance** — WIP objects inherit the CP's `DefaultWIPACL`
5. **Multiple DDMS convergence** — if two DDMS instances reference the same dataspace,
   they produce the same CP UUID (deterministic v5)

### What is NOT guaranteed (by design)

1. **Real-time sync** — CP in OSDU reflects state at last manifest build, not live state
2. **Lock propagation** — locking a dataspace in ETP does not immediately update OSDU
3. **Cross-DDMS coordination** — no distributed lock; last-writer-wins at the OSDU layer
4. **Deletion cascade** — deleting a dataspace does not auto-delete the CP from OSDU

### Consistency Timeline

```mermaid
sequenceDiagram
  participant Client
  participant RDDMS as RDDMS (ETP)
  participant Builder as Manifest Builder
  participant OSDU as OSDU Catalog

  Client->>RDDMS: t0: Create dataspace 'maap/drogon'
  Note over OSDU: CP does NOT exist yet
  Client->>RDDMS: t1: Ingest objects via ETP
  Note over OSDU: CP still doesn't exist
  Client->>Builder: t2: POST /manifests/build
  Builder->>OSDU: CP created (v1, Open)
  Client->>RDDMS: t3: More objects added
  Note over OSDU: CP is stale
  Client->>Builder: t4: POST /manifests/build
  Builder->>OSDU: CP updated (v2, Open, enriched)
  Client->>RDDMS: t5: Lock dataspace
  Note over OSDU: Still shows "Open"
  Client->>Builder: t6: POST /manifests/build
  Builder->>OSDU: CP updated (v3, Closed)
```

**Key insight:** The manifest build is the **sync point**. Between builds, OSDU may be stale.

## Usage Patterns

### Pattern 1: Standard Workflow (ores/drogon demo)

```bash
# 1. Create dataspace (the collaboration namespace)
curl -X POST http://localhost:3000/dataspaces \
  -H "Content-Type: application/json" \
  -d '{"path": "maap/drogon", "acl": {...}, "legal": {...}}'

# 2. Ingest objects (RESQML + WITSML = multi-domain WIP data)
openETPServer hdf5 -i drogon_demo_22.epc -s ws://localhost:9002 -d maap/drogon
curl -X PUT http://localhost:3000/witsml/store?dataspace=maap/drogon \
  -d @well_21.xml

# 3. Build manifest → includes CollaborationProject automatically
curl -X POST http://localhost:3000/manifests/build \
  -H "Content-Type: application/json" \
  -d '{"uris": ["eml:///dataspace('\''maap/drogon'\'')"], "partition": "opendes"}'

# Response includes:
# - MasterData[]: CollaborationProject + Wells + Wellbores
# - Data.Datasets[]: ETPDataspace record
# - Data.WorkProductComponents[]: WellLog, Grid, etc.

# 4. Push to OSDU catalog
curl -X POST https://osdu-instance/api/storage/v2/records \
  -d @manifest.json
```

### Pattern 2: Explicit Collaboration Header

When the caller already has a collaboration project ID (e.g., from an external system):

```bash
curl -X POST http://localhost:3000/manifests/build \
  -H "x-collaboration: {\"id\": \"existing-cp-uuid\"}" \
  -d '{"uris": [...], "partition": "opendes"}'
```

When `x-collaboration` is provided, the auto-generated CP uses that ID instead of
deriving one from the dataspace name.

### Pattern 3: Multi-Domain Collaboration

Multiple DDMS instances contribute to the same project:

```
Reservoir DDMS (RDDMS):  dataspace 'project-alpha/reservoir'
Seismic DDMS:            dataspace 'project-alpha/seismic'
Well DDMS:               dataspace 'project-alpha/wells'
```

Each produces its own CollaborationProject record. To tie them together, use the same
`x-collaboration` header across all manifest builds, or reference a shared
`TrustedCollectionID` (CollaborationProjectCollection).

### Pattern 4: Lifecycle Management

```bash
# Lock dataspace (marks collaboration as "Closed" on next manifest build)
curl -X POST http://localhost:3000/dataspaces/maap%2Fdrogon/lock

# Build manifest → CP.LifecycleStatusID = ...CollaborationProjectLifecycleStatus:Closed:
curl -X POST http://localhost:3000/manifests/build ...

# Unlock to reopen
curl -X DELETE http://localhost:3000/dataspaces/maap%2Fdrogon/lock
```

## Schema Mapping

| ETP Dataspace Field | CollaborationProject Field | Notes |
|---|---|---|
| `path` (dataspace name) | `data.Namespace` | The WIP namespace |
| `path` | `data.ProjectName` | Human-readable name |
| `storeCreated` | `data.CreationDateTime` | When dataspace was created |
| ACL (customData) | `data.DefaultWIPACL` | Applied to WIP objects |
| ACL (customData) | `data.ProjectContributorACL` | Who can contribute |
| Lock state | `data.LifecycleStatusID` | Open/Closed |
| UUID v5(path) | `id` | Deterministic, stable |

## OSDU Kind

```
osdu:wks:master-data--CollaborationProject:1.0.0   (M27 only)
```

Not available in M26 (Mercury). If running against M26, the CP record is still generated
but must be registered manually via schema service.

## Implementation Files

| File | Purpose |
|---|---|
| `src/lib/jsonTypes/MilestoneKinds.ts` | Kind registration (`M27: "1.0.0"`) |
| `src/lib/jsonTypes/CollaborationProject.ts` | Converter: dataspace → CP record |
| `src/lib/jsonTypes/Generated/master-data/CollaborationProject.1.0.0.ts` | Type interface |
| `src/lib/jsonTypes/Manifest.ts` | S5 integration (emits CP per dataspace) |
| `src/lib/jsonTypes/ResqmlOsdu.ts` | Re-exports `CollaborationProjectManifest` |

## Future Work

- [ ] Event-driven sync: push CP update on dataspace lock/unlock (not just at manifest time)
- [ ] `TrustedCollectionID`: link CP to a `CollaborationProjectCollection` for SoR input tracking
- [ ] `LifecycleEvents`: record state transitions (Open→Closed→Published) with timestamps
- [ ] Cross-DDMS coordination: shared CP across reservoir/seismic/well DDMS via external ID
- [ ] Deletion reconciliation: detect deleted dataspaces and mark CP as archived

## Master Data Strategy: Wells + WellLogs in CollaborationProjects

### The Problem

Wells are **master data** (owned by OSDU catalog / system of record), but WellLogs are
**work-product-components** that must reference a Well. When RDDMS ingests a WellLog,
it needs a Well to point to — but should it CREATE the Well or REFERENCE an existing one?

```mermaid
graph LR
  subgraph SoR["OSDU Catalog (SoR)"]
    WELL["Well: DROGON-A1<br/>(master-data)<br/>id: opendes:..."]
  end
  subgraph SOE["RDDMS (SOE)"]
    LOG["WellLog → Well ref<br/>(witsml21.Log in ETP)"]
  end
  LOG -->|"DDMSDatasets"| WELL
  WELL -->|"references"| LOG
```

### Strategy 1: Reference Existing (Production Pattern)

Wells already exist in OSDU → RDDMS just links to them via `osduAlias`:

```xml
<Well uuid="...">
  <Aliases authority="osdu" Identifier="opendes:master-data--Well:existing-uuid"/>
  ...
</Well>
```

The manifest builder sees the alias → skips creating a new Well → appends `DDMSDatasets`
URI to the existing record (additive merge).

**Best for:** Production environments where MDM processes own Well creation.

### Strategy 2: Create-if-Missing (Current Default)

```typescript
// OSDUContext default:
createMissingReferences: true  // creates stub Well if not in OSDU
```

RDDMS creates a minimal Well record when the log references a Well that doesn't exist.
Only has `FacilityName` + `DDMSDatasets` — no coordinates, no regulatory IDs.

**Risk:** Creates orphan/duplicate Wells if the "real" Well arrives later from MDM.
**Mitigation:** DDMSDatasets merge ensures if the Well IS later created properly, the
DDMS link survives.

**Best for:** Local development, demos, isolated environments.

### Strategy 3: CollaborationProject Namespace (SOE Pattern)

Wells inside a CollaborationProject are **WIP** — they live in the CP namespace and
don't pollute the SoR until published:

```
t0: Create CP (dataspace 'project-x/wells')
t1: Ingest Well + WellLog into ETP dataspace
t2: Build manifest → Well in CP namespace (WIP, not SoR)
t3: Review/approve → Publish Well to SoR (promote to master-data)
t4: CP lifecycle → Closed
```

Wells in a CP are "draft" master data. They carry `x-collaboration` header during
ingestion, so OSDU knows they're namespace-scoped and not yet authoritative.

**Best for:** Multi-user workflows where Wells need review before becoming authoritative.

### Decision Matrix

```mermaid
flowchart TD
  A[Manifest build time:<br/>Well referenced by WellLog] --> B{Well has osduAlias?}
  B -->|YES| C[Strategy 1:<br/>Reference existing record]
  B -->|NO| D{Inside a CollaborationProject?}
  D -->|YES| E[Strategy 3:<br/>Create in CP namespace as WIP]
  D -->|NO| F{createMissingReferences?}
  F -->|true| G[Strategy 2:<br/>Create stub Well]
  F -->|false| H[Error: missing reference]
```

### Practical Rules for Adding Logs

1. **Well exists in OSDU** → pass its ID via `osduAlias` or `x-collaboration` header
2. **New field study** → use a CollaborationProject dataspace (WIP wells)
3. **Demo/local dev** → rely on `createMissingReferences: true` (auto-creates stubs)

The DDMSDatasets merge pattern (already implemented) ensures that regardless of which
path created the Well, subsequent WellLog ingestions **enrich** the record rather than
duplicating it.

---

## Development Roadmap & Opportunities

### Project-Scoped Dataspaces

P&WS projects could **automatically provision RDDMS dataspaces** aligned with project lifecycle:
- `POST /projects` → creates a locked SOR dataspace + unlocked WIP dataspace
- `POST /status {"status": "Closed"}` → locks the WIP dataspace
- Dataspace names follow a convention: `<project-id>/sor`, `<project-id>/wip`

### RESQML-Aware WIP Publishing

Extend WIP publishing to understand RESQML object graphs. When publishing a grid property, automatically include the parent grid and its CRS. When publishing a surface, include the referenced interpretation and bin grid. This prevents orphaned references in SOR.

### Array-Level Conflict Detection

Current P&WS conflict detection works at the record ID level. RDDMS could enable **array-level** conflict detection:
- Compare Z-value arrays between WIP and SOR versions of a surface
- Show property value differences between WIP and SOR grid properties
- Provide delta statistics (RMSE, max diff, histogram) for reviewer decision support

### Deep-Search Project Dashboard

Combine P&WS project resources with RDDMS deep-search to build a **project dashboard** showing:
- All trusted SOR objects with types, counts, and array statistics
- All WIP objects with modification dates and delta from SOR baseline
- Object relationship graph (targets/sources) within the project scope
- Property coverage matrix: which zones / reservoir segments have which properties

### ETP Streaming for WIP Sync

Use ETP WebSocket for efficient WIP data transfer:
- Bulk import of RESQML objects from Petrel/ResInsight into the project WIP dataspace
- Real-time notifications when WIP objects change (for multi-user collaboration)
- Streaming array data for large grids and properties without full EPC file round-trips

### Activity Provenance Integration

Link RDDMS operations to OSDU Activity records:
- RESQML import → `Activity` with input = EPC file, output = list of imported WPC IDs
- Grid property computation → `Activity` linking input grid + computation parameters to output property
- Ensemble grid variations → multiple `Activity` records keyed by `Realisation`

### Cross-Dataspace Federation

Enable P&WS projects to reference resources across multiple RDDMS dataspaces (e.g., base geomodel in one dataspace, seismic reprocessing in another). The GraphQL federated-search already supports multi-dataspace queries - extending this to P&WS project context would enable cross-domain collaboration.

### Version Comparison & Merge

Extend RDDMS with version-aware operations for P&WS:
- **Compare**: Side-by-side diff of two versions of a grid, surface, or property (visual + statistical)
- **Merge**: Combine changes from multiple WIP contributors into a single SOR version (analogous to git merge for subsurface data)
- **Revert**: Restore a previous version from the lifecycle event journal

---

## Improvement Requirements

### P&WS Service Improvements

| Area | Requirement | Priority |
|------|-------------|----------|
| **Azure availability** | Deploy P&WS on Azure ADME (currently AWS-only) | High |
| **RDDMS-aware publishing** | Extend WIP publishing to handle RESQML object graphs (dependencies, parent objects) | High |
| **Conflict resolution UX** | When 409 conflict occurs, provide a merge/override workflow rather than just a report | High |
| **Bulk operations** | Support batch creation of projects and batch resource registration | Medium |
| **Project templates** | Pre-configured project structures for common workflows (DG study, well planning, seismic reprocessing) | Medium |
| **Notifications** | Webhook or event-driven notifications for lifecycle events (project opened, WIP published, etc.) | Medium |
| **Search integration** | Searchable project metadata - find projects by reservoir, purpose, date range, personnel | Medium |
| **Role-based access** | Finer-grained roles beyond owner/viewer (e.g., reviewer, contributor, observer) | Low |

### RDDMS Improvements for P&WS Collaboration

| Area | Requirement | Priority | Status |
|------|-------------|----------|--------|
| **Dataspace lifecycle API** | Programmatic create/lock/unlock/delete aligned with P&WS project status changes | High | ✅ Available (REST + ETP DataspaceOSDU) |
| **Cross-dataspace copy** | Efficient bulk copy of RESQML objects between dataspaces (WIP → SOR promotion) | High | ✅ Available (`CopyDataspacesContent`, `CopyToDataspace`) |
| **Object-graph-aware operations** | When copying/publishing a RESQML object, automatically include all referenced objects (CRS, grids, interpretations) | High | Planned |
| **Array differencing** | REST/GraphQL endpoint to compute and return differences between two versions of an array (delta surface, delta property) | Medium | Planned |
| **Dataspace ACLs** | Per-dataspace access control that can be synchronized with P&WS `ProjectContributorACL` | Medium | Partial (CustomData `viewers`/`owners`) |
| **ETP project channels** | ETP notification channels scoped to a P&WS project - broadcast changes to all project participants | Medium | Planned |
| **Object provenance** | Track which P&WS project and lifecycle event caused each RESQML object to be created/modified | Medium | Partial (Activity resolution via `getSources`) |
| **Concurrent edit detection** | Optimistic locking for RESQML objects within a shared WIP dataspace | Low | Planned |

### ORES Client Improvements

| Area | Requirement | Priority |
|------|-------------|----------|
| **P&WS integration page** | Dedicated UI for browsing P&WS projects, viewing lifecycle journal, managing SOR/WIP resources | High |
| **WIP diff viewer** | Visual comparison of WIP vs SOR objects using 3D viewer (overlay surfaces, highlight property differences) | High |
| **Project-scoped search** | Filter Search/GraphQL results to only resources within a specific P&WS project | Medium |
| **Lifecycle timeline** | Interactive timeline visualization of project events (created → opened → resources added → published → closed) | Medium |
| **Publish workflow wizard** | Guided multi-step wizard for WIP → SOR publishing with dependency checking and conflict resolution | Medium |
| **Dataspace ↔ project linking** | Auto-create RDDMS dataspaces when creating a P&WS project from the Add DG tab | Low |

### Schema & Data Model Gaps

| Gap | Description | Impact |
|-----|-------------|--------|
| **No P&WS ↔ RDDMS schema link** | `CollaborationProject` has no native field for RDDMS dataspace references - currently modeled as `Parameters[]` | Fragile; depends on convention (`GeoModelDataspace` key) |
| **Missing project-resource relationship type** | No OSDU relationship type for "resource is trusted by project" or "resource is WIP in project" | Limits search and graph queries |
| **No WIP status on WPC** | Individual WPC records don't indicate whether they are SOR or WIP | Consumers must query P&WS to determine status |
| **CollaborationProjectCollection limits** | Large projects with thousands of resources may hit collection size limits | Need pagination or hierarchical collections |
| **No standard lifecycle event types** | Event names are convention-based strings (`SOR Resources added`, `WIP Resources published`) - not reference-data | Limits machine processing and reporting |
| **No cross-project lineage** | When a WPC is published from project A and registered in project B, there is no formal lineage link | Limits multi-project provenance tracking |
