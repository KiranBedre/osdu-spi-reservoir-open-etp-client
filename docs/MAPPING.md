# RESQML ↔ OSDU Schema Mapping Reference

> Based on [OSDU Data Definitions — Chapter 13: Earth Modelling](https://community.opengroup.org/osdu/data/data-definitions/-/blob/master/Guides/Chapters/13-EarthModelling.md#132-osdu-type-mapping), extended with RDDMS implementation status for both RESQML 2.0.1 and 2.2.

---

## Complete Type Mapping (ordered by OSDU Kind)

> **Direction:** One-way only. RESQML/WITSML → OSDU manifest record. Not reversible.
>
> **RESQML versions:** Both 2.0.1 (`obj_` prefix) and 2.2 are listed. Each has a separate
> converter file (e.g., `FaultInterpretation.ts` + `FaultInterpretation22.ts`).
>
> **Schema versions:** Will vary by target milestone. See `MilestoneKinds.ts` — versions
> shown here are M27 (Venus). Set `RDMS_OSDU_MILESTONE=M26` for Mercury equivalents.

| OSDU Kind (schema version) | RESQML 2.0.1 Type | RESQML 2.2 Type | Routing Condition | RDDMS Status |
|---|---|---|---|---|
| `master-data--ActivityTemplate:1.1.0` | `obj_ActivityTemplate` | `eml23.ActivityTemplate` | Direct | ✅ Implemented |
| `master-data--BoundaryFeature:1.2.0` | — | — | Auto-created from LocalBoundaryFeature converter | ✅ Implemented |
| `master-data--SeismicAcquisitionSurvey:1.4.0` | `obj_SeismicLatticeFeature` | `SeismicLatticeFeature` | Direct | ✅ Implemented |
| `master-data--Well:1.3.0` | — | `witsml21.Well` | Direct (WITSML) | ✅ Implemented |
| `master-data--Wellbore:1.3.0` | — | `witsml21.Wellbore` | Direct (WITSML) | ✅ Implemented |
| `reference-data--PropertyType:1.0.0` | `obj_PropertyKind` | `eml23.PropertyKind` | Direct | ✅ Implemented |
| `WPC--Activity:1.4.0` | `obj_Activity` | `eml23.Activity` | Direct | ✅ Implemented |
| `WPC--BHARunReport:1.3.0` | — | `witsml21.BhaRun` | Direct (WITSML) | ✅ Implemented |
| `WPC--ColumnBasedTable:1.3.0` | `obj_StringTableLookup` | `obj_StringTableLookup` | Direct | ✅ Implemented |
| `WPC--ColumnBasedTable:1.3.0` | `obj_DoubleTableLookup` | `eml23.ColumnBasedTable` | Direct | ✅ Implemented |
| `WPC--EarthModelInterpretation:1.2.0` | `obj_EarthModelInterpretation` | `EarthModelInterpretation` | Direct | ✅ Implemented |
| `WPC--FaultInterpretation:1.2.0` | `obj_FaultInterpretation` | `FaultInterpretation` | Direct | ✅ Implemented |
| `WPC--FluidBoundaryInterpretation:1.2.0` | `obj_FluidBoundaryFeature` | `FluidBoundaryInterpretation` | Direct | ✅ Implemented |
| `WPC--FluidsReport:1.3.0` | — | `witsml21.FluidsReport` | Direct (WITSML) | ✅ Implemented |
| `WPC--GenericProperty:1.2.0` | `obj_CategoricalProperty`, `obj_ContinuousProperty`, `obj_DiscreteProperty` | `ContinuousProperty`, `DiscreteProperty` | Direct (NOT on WellboreFrame) | ✅ Implemented |
| `WPC--GenericRepresentation:1.2.0` | `obj_TriangulatedSetRepresentation`, `obj_PointSetRepresentation`, `obj_BlockedWellboreRepresentation` | `TriangulatedSetRepresentation`, `PointSetRepresentation`, `BlockedWellboreRepresentation` | Direct (catch-all) | ✅ Implemented |
| `WPC--GenericRepresentation:1.1.0` | `obj_PolylineRepresentation`, `obj_PolylineSetRepresentation` | `PolylineRepresentation`, `PolylineSetRepresentation` | Fallback when NOT SeismicFault | ✅ Implemented |
| `WPC--GeologicUnitOccurrenceInterpretation:1.2.0` | `obj_StratigraphicOccurrenceInterpretation` | `StratigraphicOccurrenceInterpretation` | Direct (1:1 rename) | ✅ Implemented |
| `WPC--GeobodyBoundaryInterpretation:1.1.0` | `obj_GeobodyBoundaryInterpretation` | `GeobodyBoundaryInterpretation` | Direct | ✅ Implemented |
| `WPC--GeobodyInterpretation:1.3.0` | `obj_GeobodyInterpretation` | `GeobodyInterpretation` | Direct | ✅ Implemented |
| `WPC--GridConnectionSetRepresentation:1.2.0` | `obj_GridConnectionSetRepresentation` | `GridConnectionSetRepresentation` | Direct | ✅ Implemented |
| `WPC--HorizonInterpretation:1.2.0` | `obj_HorizonInterpretation` | `HorizonInterpretation` | Direct | ✅ Implemented |
| `WPC--IjkGridRepresentation:1.2.0` | `obj_IjkGridRepresentation` | `IjkGridRepresentation` | Direct | ✅ Implemented |
| `WPC--LocalBoundaryFeature:1.2.0` | `obj_GeneticBoundaryFeature`, `obj_TectonicBoundaryFeature` | `BoundaryFeature` | Direct | ✅ Implemented |
| `WPC--LocalModelCompoundCrs:1.2.0` | `obj_LocalDepth3dCrs`, `obj_LocalTime3dCrs` | `eml23.LocalEngineeringCompoundCrs` | Direct | ✅ Implemented |
| `WPC--LocalModelFeature:1.2.0` | `obj_OrganizationFeature` | `OrganizationFeature` | Direct | ✅ Implemented |
| `WPC--LocalRockVolumeFeature:1.2.0` | `obj_StratigraphicUnitFeature` | `StratigraphicUnitFeature` | Direct | ✅ Implemented |
| `WPC--PersistedCollection:1.2.0` | `obj_PropertySet`, `obj_RepresentationSetRepresentation` | `eml23.DataobjectCollection` | Direct | ✅ Implemented |
| `WPC--Rig:1.3.0` | — | `witsml21.Rig` | Direct (WITSML) | ✅ Implemented |
| `WPC--RockFluidOrganizationInterpretation:1.2.0` | `obj_RockFluidOrganizationInterpretation` | `RockFluidOrganizationInterpretation` | Direct | ✅ Implemented |
| `WPC--RockFluidUnitInterpretation:1.3.0` | `obj_RockFluidUnitInterpretation` | `RockFluidUnitInterpretation` | Direct | ✅ Implemented |
| `WPC--SealedSurfaceFramework:1.2.0` | `obj_SealedSurfaceFrameworkRepresentation` | `SealedSurfaceFrameworkRepresentation` | Direct | ✅ Implemented |
| `WPC--SealedVolumeFramework:1.2.0` | `obj_SealedVolumeFrameworkRepresentation` | `SealedVolumeFrameworkRepresentation` | Direct | ✅ Implemented |
| `WPC--SeismicBinGrid:1.3.0` | `obj_Grid2dRepresentation` | `Grid2dRepresentation` | InterpretedFeature is `SeismicLatticeFeature` | ✅ Implemented |
| `WPC--SeismicFault:2.0.0` | `obj_PolylineRepresentation`, `obj_PolylineSetRepresentation` | `PolylineRepresentation`, `PolylineSetRepresentation` | FaultInterpretation + SeismicCoordinates present | ✅ Implemented |
| `WPC--SeismicHorizon:2.0.0` | `obj_Grid2dRepresentation` | `Grid2dRepresentation` | HorizonInterpretation + Point3dZValueArray on seismic lattice | ✅ Implemented |
| `WPC--SeismicLineGeometry:1.2.0` | `obj_SeismicLineFeature` | — | Direct (feature carries trace index data) | ✅ Implemented (v2.0 only) |
| `WPC--StratigraphicColumn:1.2.0` | `obj_StratigraphicColumn` | `StratigraphicColumn` | Direct | ✅ Implemented |
| `WPC--StratigraphicColumnRankInterpretation:1.3.0` | `obj_StratigraphicColumnRankInterpretation` | `StratigraphicColumnRankInterpretation` | Direct | ✅ Implemented |
| `WPC--StratigraphicUnitInterpretation:1.3.0` | `obj_StratigraphicUnitInterpretation` | `StratigraphicUnitInterpretation` | Direct | ✅ Implemented |
| `WPC--StructuralOrganizationInterpretation:1.2.0` | `obj_StructuralOrganizationInterpretation` | `StructuralOrganizationInterpretation` | Direct | ✅ Implemented |
| `WPC--StructureMap:1.0.0` | `obj_Grid2dRepresentation` | `Grid2dRepresentation` | HorizonInterpretation + NOT on seismic lattice (any domain) | ✅ Implemented (M27 only) |
| `WPC--SubRepresentation:1.2.0` | `obj_SubRepresentation` | `SubRepresentation` | Direct | ✅ Implemented |
| `WPC--TimeSeries:1.2.0` | `obj_TimeSeries` | `TimeSeries` | Direct | ✅ Implemented |
| `WPC--Tubular:1.3.0` | — | `witsml21.Tubular` | Direct (WITSML) | ✅ Implemented |
| `WPC--UnsealedSurfaceFramework:1.3.1` | `obj_NonSealedSurfaceFrameworkRepresentation` | `NonSealedSurfaceFrameworkRepresentation` | Direct | ✅ Implemented |
| `WPC--UnstructuredGridRepresentation:1.2.0` | `obj_UnstructuredGridRepresentation` | `UnstructuredGridRepresentation` | Direct | ✅ Implemented |
| `WPC--WellboreMarkerSet:1.2.0` | `obj_WellboreMarkerFrameRepresentation` | `WellboreIntervalSet` | Direct (v2.0.1→WellboreMarkerFrameRepresentation, v2.2→WellboreIntervalSet) | ✅ Implemented |
| `WPC--WellboreCompletion:1.3.0` | — | `witsml21.WellCompletion` | Direct (WITSML) | ✅ Implemented |
| `WPC--WellboreInterpretation:1.2.0` | — | `WellboreInterpretation` | Direct (v2.2 only) | ✅ Implemented |
| `WPC--WellboreTrajectory:1.3.0` | — | `WellboreTrajectoryRepresentation`, `witsml21.Trajectory` | Direct | ✅ Implemented |
| `WPC--WellLog:1.3.0` | `obj_WellboreFrameRepresentation` + Properties | `WellboreFrameRepresentation` + Properties, `witsml21.Log` | Frame + attached properties → single WellLog | ✅ Implemented |

---

## Dynamic Routing Functions

Three routing functions decide the OSDU kind at runtime based on RESQML object content:

### `Grid2dToOsduKind` / `Grid2dToOsduKind22`

```
Grid2dRepresentation
  ├─ 1. SeismicBinGrid:1.3.0      ← InterpretedFeature is SeismicLatticeFeature
  ├─ 2. SeismicHorizon:2.0.0      ← HorizonInterpretation + Z on seismic lattice
  ├─ 3. StructureMap:1.0.0        ← HorizonInterpretation + NOT on lattice (any domain; M27 only)
  └─ 4. GenericRepresentation:1.2.0  ← fallback (isochores, DEMs, property grids, etc.)
```

### `GenericRepresentationToOsduKind`

```
PolylineRepresentation / PolylineSetRepresentation
  ├─ SeismicFault:2.0.0           ← FaultInterpretation + SeismicCoordinates present
  └─ GenericRepresentation:1.1.0  ← fallback
```

---

## CRS Metadata Enrichment (all WPCs with geometry)

Every WPC that calls `createSpatialInfo()` / `createSpatialInfoFrom2dPoints()` now produces:

| OSDU Field | RESQML 2.0.1 Source | RESQML 2.2 Source | Purpose |
|---|---|---|---|
| `CoordinateReferenceSystemID` | `ProjectedCrs.EpsgCode` | `OriginProjectedCrs.AbstractProjectedCrs.EpsgCode` | OSDU search + CRS Convert |
| `VerticalCoordinateReferenceSystemID` | `VerticalCrs.EpsgCode` | Resolved `VerticalCrs` DOR → EPSG/WKT | Vertical datum awareness |
| `persistableReferenceCrs` | EPSG JSON / WKT from `Unknown` field | EPSG JSON / `ProjectedWktCrs.WellKnownText` / LocalAuthority JSON | CRS Convert v4 input |
| `persistableReferenceVerticalCrs` | EPSG JSON (if vertical is EPSG) | EPSG JSON or WKT | CRS Convert v4 vertical |
| `SpatialArea` coordinates | Offset + rotation applied to local coords | Offset + azimuth applied | Spatial search polygon |
| `localFrame` (ExtensionProperties) | xOffset, yOffset, zOffset, arealRotation, axisOrder, uom, Z-dir | xOffset, yOffset, zOffset, azimuth | RDDMS geomodelling round-trip |

### CRS Reference Forms Supported

| Form | v2.0.1 | v2.2 | OSDU Output |
|---|---|---|---|
| EPSG | `eml20.ProjectedCrsEpsgCode` / `VerticalCrsEpsgCode` | `eml23.ProjectedEpsgCrs` / `VerticalEpsgCrs` | `Projected:EPSG::{code}` / `Vertical:EPSG::{code}` |
| WKT | `eml20.ProjectedUnknownCrs.Unknown` (heuristic) | `eml23.ProjectedWktCrs.WellKnownText` | `Projected:WKT::{title}` + WKT as persistableReference |
| LocalAuthority | N/A (v2.0 has no type) | `eml23.ProjectedLocalAuthorityCrs.LocalAuthorityCrsName` | `Projected:LocalAuthority::{auth}-{code}` |
| Unknown | `eml20.ProjectedUnknownCrs` (non-WKT) | `eml23.ProjectedUnknownCrs` | No CRS metadata (graceful degradation) |

---

## Not Yet Mapped (from OSDU Data Definitions)

> **Mapping direction:** All mappings are **one-way only** (RESQML/WITSML → OSDU). The OSDU record
> is a lossy metadata projection for catalog discoverability. The original object remains in the
> ETP store for full-fidelity retrieval. Round-tripping (OSDU → RESQML) is not supported.

> **Version applicability:** Unless noted, both RESQML 2.0.1 (`obj_` prefix) and 2.2 types are
> candidates. Each would need a separate converter (v2.0 + v2.2 pair, like existing ones).

| OSDU Kind | RESQML 2.0.1 Source | RESQML 2.2 Source | Routing Condition (semantic) | Current Fallback | Ambiguity / Notes |
|---|---|---|---|---|---|
| `WPC--GenericBinGrid:1.0.0` | `obj_Grid2dRepresentation` | `Grid2dRepresentation` | Grid2d that specifically represents a seismic bin grid (needs positive identification) | → GenericRepresentation:1.2.0 | **Ambiguous.** A Grid2d with no interpretation could be an isochore, DEM, thickness map, or any 2D surface — cannot assume bin grid without additional heuristics (domain, regularity, annotations) |
| `WPC--HorizonControlPoints:1.0.0` | `obj_PointSetRepresentation` + `obj_HorizonInterpretation` | `PointSetRepresentation` + `HorizonInterpretation` | PointSet whose `RepresentedInterpretation` is a HorizonInterpretation | → GenericRepresentation:1.2.0 | **Semantic routing needed.** Currently all PointSets are GenericRepresentation. Add routing: if RepresentedInterpretation is Horizon → HorizonControlPoints |
| `WPC--VelocityModeling:1.4.0` | Properties on `obj_Grid2dRepresentation` / `obj_IjkGridRepresentation` | Properties on `Grid2dRepresentation` / `IjkGridRepresentation` | Property with `PropertyKind.Title` containing "velocity" or PWLS code P0028 | → GenericProperty:1.2.0 | **Cross-object detection.** Must inspect PropertyKind of each Property; velocity properties on grids get routed to VelocityModeling instead of GenericProperty |

| `WPC--ReservoirCompartmentInterpretation:1.0.0` | N/A | `ReservoirCompartmentInterpretation` | Direct — v2.2 only type | Not registered (skipped) | **v2.2 only.** No v2.0 equivalent exists |

| `master-data--Seismic3DInterpretationSet:1.0.0` | `obj_SeismicLatticeFeature` | `SeismicLatticeFeature` | Same source as SeismicAcquisitionSurvey — **duplicate mapping** | → SeismicAcquisitionSurvey (current) | **One-to-two conflict.** SeismicLatticeFeature currently maps to SeismicAcquisitionSurvey only. OSDU has both MasterData kinds; decide which takes priority or emit both |
| `master-data--Seismic2DInterpretationSet:1.0.0` | `obj_SeismicLineSetFeature` | `SeismicLineSetFeature` | Direct | Not registered (skipped) | **Not to be confused with SeismicLineGeometry** (which maps from SeismicLineFeature singular). This is the collection type |

---

## Routing Ambiguity Summary

These are cases where a single RESQML type can map to multiple OSDU kinds depending on content.

> **Design principle:** We only route to a specific OSDU kind when we can **positively identify**
> it from the RESQML object's content. When the content is general-purpose or lacks the
> distinguishing characteristics, the safe fallback is `GenericRepresentation` (for geometry
> objects) or `GenericProperty` (for property objects). Many RESQML types carry data that
> could semantically be anything — an isochore, a DEM, a thickness map, a porosity grid —
> and OSDU's more specific kinds (GenericBinGrid, VelocityModeling, HorizonControlPoints)
> require domain knowledge that isn't encoded in the RESQML structure itself.

```
Grid2dRepresentation ─────────────────────────────────────────────────────
  │
  ├─ 1. Has InterpretedFeature = SeismicLatticeFeature?
  │      YES → SeismicBinGrid:1.3.0
  │
  ├─ 2. Has InterpretedFeature = HorizonInterpretation + on seismic lattice?
  │      YES → SeismicHorizon:2.1.0
  │
  ├─ 3. Has InterpretedFeature = HorizonInterpretation + NOT on lattice (any domain)?
  │      YES → StructureMap:1.0.0 (M27; on M26 falls back to GenericRepresentation)
  │
  └─ 4. Anything else (no interp, or unrecognized interp)
         → GenericRepresentation:1.2.0 (fallback)
         (includes isochores, DEMs, thickness maps, property surfaces, etc.)


PointSetRepresentation ───────────────────────────────────────────────────
  │
  ├─ RepresentedInterpretation is HorizonInterpretation?   ← NOT YET IMPLEMENTED
  │      YES → HorizonControlPoints:1.0.0
  │
  └─ Anything else
         → GenericRepresentation:1.2.0 (current)
         (scatter data, well picks, seismic picks, unconformity points, etc.)


PolylineRepresentation / PolylineSetRepresentation ───────────────────────
  │
  ├─ RepresentedInterpretation is FaultInterpretation + has SeismicCoordinates?
  │      YES → SeismicFault:2.0.0
  │
  └─ Anything else
         → GenericRepresentation:1.1.0 (fallback)
         (fault sticks in depth, well paths, contour lines, boundaries, etc.)


Properties (ContinuousProperty / DiscreteProperty) ──────────────────────
  │
  ├─ On a WellboreFrameRepresentation?
  │      YES → (flattened into parent WellLog, not separate record)
  │
  ├─ PropertyKind is velocity-related? (P0028 / "Velocity")   ← NOT YET IMPLEMENTED
  │      YES → VelocityModeling:1.4.0
  │
  └─ Anything else
         → GenericProperty:1.2.0 (current)
         (includes porosity, permeability, saturation, facies, etc. —
          OSDU has no further property-type-specific kinds beyond Velocity)


SeismicLatticeFeature ────────────────────────────────────────────────────
  │
  ├─ Currently → master-data--SeismicAcquisitionSurvey    ← ONE-TO-TWO CONFLICT
  │
  └─ Should also emit → master-data--Seismic3DInterpretationSet?
         (OSDU has both kinds for 3D surveys; need DD clarification)
```

---

## Version History

| Date | Change |
|---|---|
| 2026-06-06 | Schema verification against DD source: StructuralOrganizationInterpretation converter added (was silently dropped), WellboreIntervalSet v2.2 fix, UOM normalization (v/v→m3/m3). 108 synthetic records validated on interop. |
| 2026-06-06 | Added WellboreMarkerSet, UnsealedSurfaceFramework, GeologicUnitOccurrenceInterpretation (unambiguous direct mappings). Reverted GenericBinGrid — no-interpretation Grid2d is ambiguous (could be isochore/DEM/etc). All schema kinds now milestone-aware via `MilestoneKinds.ts`. |
| 2026-06-05 | Added CRS Metadata Enrichment section (5 fixes: vertical, rotation, localFrame, WKT, LocalAuthority) |
| 2026-06-05 | Initial creation from RDDMS `ResqmlOsdu.ts` registrations + OSDU DD Chapter 13 |

