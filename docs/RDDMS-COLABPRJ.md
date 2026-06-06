# RDDMS CollaborationProject Integration (S5)

## Overview

The OSDU `master-data--CollaborationProject:1.0.0` schema (M27/Venus) provides a
**namespace for work-in-progress (WIP) data** across DDMS instances and domains.
It represents the "system of engagement" (SOE) — a temporary collaborative workspace
where data lives before being published to the "system of record" (SoR).

In RDDMS, an **ETP dataspace maps directly to a CollaborationProject**:

```
ETP Dataspace (maap/drogon) ←→ CollaborationProject (OSDU master-data)
  ├── RESQML objects (grids, horizons, faults)    ← WIP domain objects
  ├── WITSML objects (wells, logs, trajectories)  ← WIP domain objects
  └── Data arrays (HDF5 binary data)              ← WIP array storage
```

## Architecture

```
┌────────────────────────────┐     ┌─────────────────────────────────┐
│       RDDMS (SOE)          │     │      OSDU Catalog (SoR)         │
│                            │     │                                 │
│  ETP Dataspace             │     │  CollaborationProject           │
│  ├── Objects (XML/Avro)    │────▶│  ├── Namespace = dataspace name │
│  ├── Arrays (binary)       │     │  ├── LifecycleStatus            │
│  └── Lock state            │     │  ├── DefaultWIPACL              │
│                            │     │  └── TrustedCollectionID        │
│  Manifest Builder ─────────┼────▶│                                 │
│  (POST /manifests/build)   │     │  WPC records (WellLog, Grid...) │
│                            │     │  MasterData (Well, Wellbore...) │
└────────────────────────────┘     └─────────────────────────────────┘
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

```
t0: Create dataspace 'maap/drogon'     → CP does NOT exist in OSDU yet
t1: Ingest objects via ETP              → CP still doesn't exist
t2: POST /manifests/build               → CP created in OSDU (v1, Open)
t3: More objects added via ETP          → CP in OSDU is stale (missing new objects)
t4: POST /manifests/build               → CP updated in OSDU (v2, Open, enriched)
t5: Lock dataspace                      → CP still shows "Open" until next build
t6: POST /manifests/build               → CP updated (v3, Closed)
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
