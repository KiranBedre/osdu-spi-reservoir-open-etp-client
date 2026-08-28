import { ResqmlOSDUMap } from "./OsduContext";

import { getKind, getKindOrFallback } from "./MilestoneKinds";
import { ActivityManifest } from "./Activity";
import { Activity23Manifest } from "./Activity23";
import { ActivityTemplateManifest } from "./ActivityTemplate";
import { ActivityTemplate23Manifest } from "./ActivityTemplate23";
import { ColumnBasedTableManifest } from "./ColumnBasedTable";
import { ColumnBasedTable23Manifest } from "./ColumnBasedTable23";
import { DoubleTableLookupManifest } from "./DoubleTableLookup";
import { EarthModelInterpretationManifest } from "./EarthModelInterpretation";
import { EarthModelInterpretation22Manifest } from "./EarthModelInterpretation22";
import { FaultInterpretationManifest } from "./FaultInterpretation";
import { FaultInterpretation22Manifest } from "./FaultInterpretation22";
import { GenericProperty22Manifest } from "./GenericProperty22";
import { GenericPropertyManifest } from "./GenericProperty";
import {
  GenericRepresentation22Manifest,
  GenericRepresentation22ToOsduKind
} from "./GenericRepresentation22";
import {
  GenericRepresentationManifest,
  GenericRepresentationToOsduKind
} from "./GenericRepresentation";
import { GeobodyBoundaryInterpretationManifest } from "./GeobodyBoundaryInterpretation";
import { GeobodyBoundaryInterpretation22Manifest } from "./GeobodyBoundaryInterpretation22";
import { GeobodyInterpretationManifest } from "./GeobodyInterpretation";
import { GeobodyInterpretation22Manifest } from "./GeobodyInterpretation22";
import { GridConnectionSetRepresentationManifest } from "./GridConnectionSetRepresentation";
import { GridConnectionSetRepresentation22Manifest } from "./GridConnectionSetRepresentation22";
import {
  Grid2dToOsduKind,
  Grid2dRepresentationManifest
} from "./SeismicBinGrid2Representation";
import {
  Grid2dToOsduKind22,
  Grid2dRepresentation22Manifest
} from "./SeismicBinGrid2Representation22";
import { HorizonInterpretationManifest } from "./HorizonInterpretation";
import { HorizonInterpretation22Manifest } from "./HorizonInterpretation22";
import { IjkGridRepresentationManifest } from "./IjkGridRepresentation";
import { IjkGridRepresentation22Manifest } from "./IjkGridRepresentation22";
import { LocalBoundaryFeatureManifest } from "./LocalBoundaryFeature";
import { LocalBoundaryFeature22Manifest } from "./LocalBoundaryFeature22";
import { LocalModelCompoundCrsManifest } from "./LocalModelCompoundCrs";
import { LocalModelFeatureManifest } from "./LocalModelFeature";
import { LocalModelFeature22Manifest } from "./LocalModelFeature22";
import { LocalRockVolumeFeatureManifest } from "./LocalRockVolumeFeature";
import { LocalRockVolumeFeature22Manifest } from "./LocalRockVolumeFeature22";
import { PersistedCollectionPropertySetManifest } from "./PersistedCollectionPropertySet";
import { PersistedCollectionRepresentationSetManifest } from "./PersistedCollectionRepresentationSet";
import { PropertyTypeManifest } from "./PropertyType";
import { PropertyType23Manifest } from "./PropertyType23";
import { SeismicLatticeFeatureManifest } from "./SeismicLatticeFeature";
import { SeismicLatticeFeature22Manifest } from "./SeismicLatticeFeature22";
import { SeismicLineGeometryManifest } from "./SeismicLineGeometry";
import { StratigraphicColumnManifest } from "./StratigraphicColumn";
import { StratigraphicColumnRankInterpretationManifest } from "./StratigraphicColumnRankInterpretation";
import { StratigraphicUnitInterpretationManifest } from "./StratigraphicUnitInterpretation";
import { SubRepresentationManifest } from "./SubRepresentation";
import { TimeSeriesManifest } from "./TimeSeries";
import { UnstructuredGridRepresentationManifest } from "./UnstructuredGridRepresentation";
import { PersistedCollectionDataobjectCollection23Manifest } from "./PersistedCollectionDataobjectCollection23";
import { LocalModelCompoundCrs23Manifest } from "./LocalModelCompoundCrs23";
import { StratigraphicColumn22Manifest } from "./StratigraphicColumn22";
import { StratigraphicColumnRankInterpretation22Manifest } from "./StratigraphicColumnRankInterpretation22";
import { StratigraphicUnitInterpretation22Manifest } from "./StratigraphicUnitInterpretation22";
import { SubRepresentation22Manifest } from "./SubRepresentation22";
import { TimeSeries23Manifest } from "./TimeSeries23";
import { UnstructuredGridRepresentation22Manifest } from "./UnstructuredGridRepresentation22";
import { WitsmlWellManifest } from "./WitsmlWell";
import { WitsmlWellboreManifest } from "./WitsmlWellbore";
import { WitsmlWellLogManifest } from "./WitsmlWellLog";
import { WitsmlTrajectoryManifest } from "./WitsmlTrajectory";
import { WitsmlRigManifest } from "./WitsmlRig";
import { WitsmlFluidsReportManifest } from "./WitsmlFluidsReport";
import { WitsmlTubularManifest } from "./WitsmlTubular";
import { WitsmlBhaRunManifest } from "./WitsmlBhaRun";
import { WitsmlWellCompletionManifest } from "./WitsmlWellCompletion";
import { WellboreFrameToWellLogManifest } from "./WellboreFrameToWellLog";
import { WellboreFrameToWellLog22Manifest } from "./WellboreFrameToWellLog22";
import { WellboreMarkerFrameToMarkerSetManifest } from "./WellboreMarkerFrameToMarkerSet";

import { WellboreInterpretation22Manifest } from "./WellboreInterpretation22";
import { WellboreInterpretationManifest } from "./WellboreInterpretation";
import { WellboreTrajectoryRepresentation22Manifest } from "./WellboreTrajectoryRepresentation22";
import { WellboreTrajectoryRepresentationManifest } from "./WellboreTrajectoryRepresentation";
import { StructuralOrganizationInterpretationManifest } from "./StructuralOrganizationInterpretation";
import { StructuralOrganizationInterpretation22Manifest } from "./StructuralOrganizationInterpretation22";
import { RockFluidOrganizationInterpretationManifest } from "./RockFluidOrganizationInterpretation";
import { RockFluidOrganizationInterpretation22Manifest } from "./RockFluidOrganizationInterpretation22";
import { RockFluidUnitInterpretationManifest } from "./RockFluidUnitInterpretation";
import { RockFluidUnitInterpretation22Manifest } from "./RockFluidUnitInterpretation22";
import { FluidBoundaryFeatureManifest } from "./FluidBoundaryInterpretation";
import { FluidBoundaryInterpretation22Manifest } from "./FluidBoundaryInterpretation22";
import { SealedSurfaceFrameworkManifest } from "./SealedSurfaceFramework";
import { SealedSurfaceFramework22Manifest } from "./SealedSurfaceFramework22";
import { SealedVolumeFrameworkManifest } from "./SealedVolumeFramework";
import { SealedVolumeFramework22Manifest } from "./SealedVolumeFramework22";
import { ReservoirCompartmentInterpretation22Manifest } from "./ReservoirCompartmentInterpretation22";
import { FluidModelManifest } from "./FluidModel";
import { ProductionValuesManifest } from "./ProductionValues";

export { EtpDataspaceManifest } from "./ETPDataspace";
export { CollaborationProjectManifest, deriveCollaborationId } from "./CollaborationProject";
export { WorkProductManifest } from "./WorkProduct";

const ResqmlOSDU = ResqmlOSDUMap.getInstance();

ResqmlOSDU.add(
  "resqml22.WellboreInterpretation",
  () => getKind("WellboreInterpretation") ?? "osdu:wks:work-product-component--GenericRepresentation:1.1.0",
  WellboreInterpretation22Manifest
);

ResqmlOSDU.add(
  "resqml20.obj_WellboreInterpretation",
  () => getKind("WellboreInterpretation") ?? "osdu:wks:work-product-component--GenericRepresentation:1.1.0",
  WellboreInterpretationManifest
);

ResqmlOSDU.add(
  "resqml22.WellboreTrajectoryRepresentation",
  () => getKindOrFallback("WellboreTrajectory"),
  WellboreTrajectoryRepresentation22Manifest
);

ResqmlOSDU.add(
  "resqml20.obj_WellboreTrajectoryRepresentation",
  () => getKindOrFallback("WellboreTrajectory"),
  WellboreTrajectoryRepresentationManifest
);

ResqmlOSDU.add(
  "resqml20.obj_Activity",
  () => getKindOrFallback("Activity"),
  ActivityManifest
);
ResqmlOSDU.add(
  "eml23.Activity",
  () => getKindOrFallback("Activity"),
  Activity23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_ActivityTemplate",
  () => getKindOrFallback("ActivityTemplate"),
  ActivityTemplateManifest
);
ResqmlOSDU.add(
  "eml23.ActivityTemplate",
  () => getKindOrFallback("ActivityTemplate"),
  ActivityTemplate23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_CategoricalProperty",
  () => getKindOrFallback("GenericProperty"),
  GenericPropertyManifest
);
ResqmlOSDU.add(
  "resqml20.obj_ContinuousProperty",
  () => getKindOrFallback("GenericProperty"),
  GenericPropertyManifest
);
ResqmlOSDU.add(
  "resqml22.ContinuousProperty",
  () => getKindOrFallback("GenericProperty"),
  GenericProperty22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_DiscreteProperty",
  () => getKindOrFallback("GenericProperty"),
  GenericPropertyManifest
);
ResqmlOSDU.add(
  "resqml22.DiscreteProperty",
  () => getKindOrFallback("GenericProperty"),
  GenericProperty22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_EarthModelInterpretation",
  () => getKindOrFallback("EarthModelInterpretation"),
  EarthModelInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.EarthModelInterpretation",
  () => getKindOrFallback("EarthModelInterpretation"),
  EarthModelInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_FaultInterpretation",
  () => getKindOrFallback("FaultInterpretation"),
  FaultInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.FaultInterpretation",
  () => getKindOrFallback("FaultInterpretation"),
  FaultInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_GeneticBoundaryFeature",
  () => getKindOrFallback("LocalBoundaryFeature"),
  LocalBoundaryFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.BoundaryFeature",
  () => getKindOrFallback("LocalBoundaryFeature"),
  LocalBoundaryFeature22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_GeobodyBoundaryInterpretation",
  () => getKindOrFallback("GeobodyBoundaryInterpretation"),
  GeobodyBoundaryInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.GeobodyBoundaryInterpretation",
  () => getKindOrFallback("GeobodyBoundaryInterpretation"),
  GeobodyBoundaryInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_GeobodyInterpretation",
  () => getKindOrFallback("GeobodyInterpretation"),
  GeobodyInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.GeobodyInterpretation",
  () => getKindOrFallback("GeobodyInterpretation"),
  GeobodyInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_Grid2dRepresentation",
  Grid2dToOsduKind,
  Grid2dRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.Grid2dRepresentation",
  Grid2dToOsduKind22,
  Grid2dRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_GridConnectionSetRepresentation",
  () => getKindOrFallback("GridConnectionSetRepresentation"),
  GridConnectionSetRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.GridConnectionSetRepresentation",
  () => getKindOrFallback("GridConnectionSetRepresentation"),
  GridConnectionSetRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_HorizonInterpretation",
  () => getKindOrFallback("HorizonInterpretation"),
  HorizonInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.HorizonInterpretation",
  () => getKindOrFallback("HorizonInterpretation"),
  HorizonInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_IjkGridRepresentation",
  () => getKindOrFallback("IjkGridRepresentation"),
  IjkGridRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.IjkGridRepresentation",
  () => getKindOrFallback("IjkGridRepresentation"),
  IjkGridRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_LocalDepth3dCrs",
  () => getKindOrFallback("LocalModelCompoundCrs"),
  LocalModelCompoundCrsManifest
);
ResqmlOSDU.add(
  "resqml20.obj_LocalTime3dCrs",
  () => getKindOrFallback("LocalModelCompoundCrs"),
  LocalModelCompoundCrsManifest
);
ResqmlOSDU.add(
  "eml23.LocalEngineeringCompoundCrs",
  () => getKindOrFallback("LocalModelCompoundCrs"),
  LocalModelCompoundCrs23Manifest
);
ResqmlOSDU.add(
  "resqml22.LocalDepth3dCrs",
  () => getKindOrFallback("LocalModelCompoundCrs"),
  LocalModelCompoundCrsManifest
);
ResqmlOSDU.add(
  "resqml22.LocalTime3dCrs",
  () => getKindOrFallback("LocalModelCompoundCrs"),
  LocalModelCompoundCrsManifest
);
ResqmlOSDU.add(
  "resqml20.obj_OrganizationFeature",
  () => getKindOrFallback("LocalModelFeature"),
  LocalModelFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.OrganizationFeature",
  () => getKindOrFallback("LocalModelFeature"),
  LocalModelFeature22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_PolylineRepresentation",
  GenericRepresentationToOsduKind,
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.PolylineRepresentation",
  GenericRepresentation22ToOsduKind,
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_PolylineSetRepresentation",
  GenericRepresentationToOsduKind,
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.PolylineSetRepresentation",
  GenericRepresentation22ToOsduKind,
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_PointSetRepresentation",
  GenericRepresentationToOsduKind,
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.PointSetRepresentation",
  GenericRepresentation22ToOsduKind,
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_PropertySet",
  () => getKindOrFallback("PersistedCollection"),
  PersistedCollectionPropertySetManifest
);
ResqmlOSDU.add(
  "resqml20.obj_PropertyKind",
  () => getKindOrFallback("PropertyType"),
  PropertyTypeManifest
);
ResqmlOSDU.add(
  "eml23.PropertyKind",
  () => getKindOrFallback("PropertyType"),
  PropertyType23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_RepresentationSetRepresentation",
  () => getKindOrFallback("PersistedCollection"),
  PersistedCollectionRepresentationSetManifest
);
ResqmlOSDU.add(
  "eml23.DataobjectCollection",
  () => getKindOrFallback("PersistedCollection"),
  PersistedCollectionDataobjectCollection23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_SeismicLatticeFeature",
  () => getKindOrFallback("SeismicAcquisitionSurvey"),
  SeismicLatticeFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.SeismicLatticeFeature",
  () => getKindOrFallback("SeismicAcquisitionSurvey"),
  SeismicLatticeFeature22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_SeismicLineFeature",
  () => getKindOrFallback("SeismicLineGeometry"),
  SeismicLineGeometryManifest
);
ResqmlOSDU.add(
  "resqml20.obj_StratigraphicColumn",
  () => getKindOrFallback("StratigraphicColumn"),
  StratigraphicColumnManifest
);
ResqmlOSDU.add(
  "resqml22.StratigraphicColumn",
  () => getKindOrFallback("StratigraphicColumn"),
  StratigraphicColumn22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_StratigraphicColumnRankInterpretation",
  () => getKindOrFallback("StratigraphicColumnRankInterpretation"),
  StratigraphicColumnRankInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.StratigraphicColumnRankInterpretation",
  () => getKindOrFallback("StratigraphicColumnRankInterpretation"),
  StratigraphicColumnRankInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_StratigraphicUnitFeature",
  () => getKindOrFallback("LocalRockVolumeFeature"),
  LocalRockVolumeFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.StratigraphicUnitFeature",
  () => getKindOrFallback("LocalRockVolumeFeature"),
  LocalRockVolumeFeature22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_StratigraphicUnitInterpretation",
  () => getKindOrFallback("StratigraphicUnitInterpretation"),
  StratigraphicUnitInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.StratigraphicUnitInterpretation",
  () => getKindOrFallback("StratigraphicUnitInterpretation"),
  StratigraphicUnitInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_StructuralOrganizationInterpretation",
  () => getKindOrFallback("StructuralOrganizationInterpretation"),
  StructuralOrganizationInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.StructuralOrganizationInterpretation",
  () => getKindOrFallback("StructuralOrganizationInterpretation"),
  StructuralOrganizationInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_StringTableLookup",
  () => getKindOrFallback("ColumnBasedTable"),
  ColumnBasedTableManifest
);
ResqmlOSDU.add(
  "resqml22.obj_StringTableLookup",
  () => getKindOrFallback("ColumnBasedTable"),
  ColumnBasedTable23Manifest
);
ResqmlOSDU.add(
  "eml23.ColumnBasedTable",
  () => getKindOrFallback("ColumnBasedTable"),
  ColumnBasedTable23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_DoubleTableLookup",
  () => getKindOrFallback("ColumnBasedTable"),
  DoubleTableLookupManifest
);
ResqmlOSDU.add(
  "resqml20.obj_SubRepresentation",
  () => getKindOrFallback("SubRepresentation"),
  SubRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.SubRepresentation",
  () => getKindOrFallback("SubRepresentation"),
  SubRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_TectonicBoundaryFeature",
  () => getKindOrFallback("LocalBoundaryFeature"),
  LocalBoundaryFeatureManifest
);
ResqmlOSDU.add(
  "resqml20.obj_TimeSeries",
  () => getKindOrFallback("TimeSeries"),
  TimeSeriesManifest
);
ResqmlOSDU.add(
  "resqml22.TimeSeries",
  () => getKindOrFallback("TimeSeries"),
  TimeSeries23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_TriangulatedSetRepresentation",
  GenericRepresentationToOsduKind,
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.TriangulatedSetRepresentation",
  GenericRepresentation22ToOsduKind,
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_UnstructuredGridRepresentation",
  () => getKindOrFallback("UnstructuredGridRepresentation"),
  UnstructuredGridRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.UnstructuredGridRepresentation",
  () => getKindOrFallback("UnstructuredGridRepresentation"),
  UnstructuredGridRepresentation22Manifest
);

// ─── Organization & Fluid Interpretations ────────────────────────────────────

ResqmlOSDU.add(
  "resqml20.obj_RockFluidOrganizationInterpretation",
  () => getKindOrFallback("RockFluidOrganizationInterpretation"),
  RockFluidOrganizationInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.RockFluidOrganizationInterpretation",
  () => getKindOrFallback("RockFluidOrganizationInterpretation"),
  RockFluidOrganizationInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_RockFluidUnitInterpretation",
  () => getKindOrFallback("RockFluidUnitInterpretation"),
  RockFluidUnitInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.RockFluidUnitInterpretation",
  () => getKindOrFallback("RockFluidUnitInterpretation"),
  RockFluidUnitInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_FluidBoundaryFeature",
  () => getKindOrFallback("FluidBoundaryInterpretation"),
  FluidBoundaryFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.FluidBoundaryInterpretation",
  () => getKindOrFallback("FluidBoundaryInterpretation"),
  FluidBoundaryInterpretation22Manifest
);

// ─── Framework & Wellbore Representations ────────────────────────────────────

ResqmlOSDU.add(
  "resqml20.obj_SealedSurfaceFrameworkRepresentation",
  () => getKindOrFallback("SealedSurfaceFramework"),
  SealedSurfaceFrameworkManifest
);
ResqmlOSDU.add(
  "resqml22.SealedSurfaceFrameworkRepresentation",
  () => getKindOrFallback("SealedSurfaceFramework"),
  SealedSurfaceFramework22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_SealedVolumeFrameworkRepresentation",
  () => getKindOrFallback("SealedVolumeFramework"),
  SealedVolumeFrameworkManifest
);
ResqmlOSDU.add(
  "resqml22.SealedVolumeFrameworkRepresentation",
  () => getKindOrFallback("SealedVolumeFramework"),
  SealedVolumeFramework22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_BlockedWellboreRepresentation",
  () => getKindOrFallback("GenericRepresentation"),
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.BlockedWellboreRepresentation",
  () => getKindOrFallback("GenericRepresentation"),
  GenericRepresentation22Manifest
);

// ─── Unambiguous direct mappings (milestone-aware) ───────────────────────────

ResqmlOSDU.add(
  "resqml20.obj_WellboreMarkerFrameRepresentation",
  () => getKindOrFallback("WellboreMarkerSet"),
  WellboreMarkerFrameToMarkerSetManifest
);
ResqmlOSDU.add(
  "resqml22.WellboreMarkerFrameRepresentation",
  () => getKindOrFallback("WellboreMarkerSet"),
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml22.RockVolumeFeature",
  () => getKindOrFallback("LocalRockVolumeFeature"),
  LocalRockVolumeFeature22Manifest
);
ResqmlOSDU.add(
  "resqml22.WellboreIntervalSet",
  () => getKindOrFallback("WellboreMarkerSet"),
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_StratigraphicOccurrenceInterpretation",
  () => getKindOrFallback("GeologicUnitOccurrenceInterpretation"),
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.StratigraphicOccurrenceInterpretation",
  () => getKindOrFallback("GeologicUnitOccurrenceInterpretation"),
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_NonSealedSurfaceFrameworkRepresentation",
  () => getKindOrFallback("UnsealedSurfaceFramework"),
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.NonSealedSurfaceFrameworkRepresentation",
  () => getKindOrFallback("UnsealedSurfaceFramework"),
  GenericRepresentation22Manifest
);

// ─── WITSML Types ────────────────────────────────────────────────────────────

ResqmlOSDU.add(
  "witsml21.Well",
  () => getKindOrFallback("Well"),
  WitsmlWellManifest
);
ResqmlOSDU.add(
  "witsml21.Wellbore",
  () => getKindOrFallback("Wellbore"),
  WitsmlWellboreManifest
);
ResqmlOSDU.add(
  "witsml21.Log",
  () => getKindOrFallback("WellLog"),
  WitsmlWellLogManifest
);
ResqmlOSDU.add(
  "witsml21.Trajectory",
  () => getKindOrFallback("WellboreTrajectory"),
  WitsmlTrajectoryManifest
);
ResqmlOSDU.add(
  "witsml21.Rig",
  () => getKind("Rig") ?? "osdu:wks:master-data--Rig:1.2.0",
  WitsmlRigManifest
);
ResqmlOSDU.add(
  "witsml21.FluidsReport",
  () => getKind("FluidsReport") ?? "osdu:wks:master-data--FluidsReport:1.2.0",
  WitsmlFluidsReportManifest
);
ResqmlOSDU.add(
  "witsml21.Tubular",
  () => getKind("Tubular") ?? "osdu:wks:work-product-component--GenericRepresentation:1.1.0",
  WitsmlTubularManifest
);
ResqmlOSDU.add(
  "witsml21.BhaRun",
  () => getKind("BHARun") ?? "osdu:wks:master-data--BHARun:1.2.0",
  WitsmlBhaRunManifest
);
ResqmlOSDU.add(
  "witsml21.WellCompletion",
  () => getKind("WellboreCompletion") ?? "osdu:wks:work-product-component--GenericRepresentation:1.1.0",
  WitsmlWellCompletionManifest
);

// ─── S2: WellboreFrameRepresentation → WellLog (flatten) ────────────────────

ResqmlOSDU.add(
  "resqml20.obj_WellboreFrameRepresentation",
  () => getKindOrFallback("WellLog"),
  WellboreFrameToWellLogManifest
);
ResqmlOSDU.add(
  "resqml22.WellboreFrameRepresentation",
  () => getKindOrFallback("WellLog"),
  WellboreFrameToWellLog22Manifest
);

// ─── S3: Reservoir Management & Engineering ──────────────────────────────────

ResqmlOSDU.add(
  "resqml22.ReservoirCompartmentInterpretation",
  () => getKindOrFallback("ReservoirCompartmentInterpretation"),
  ReservoirCompartmentInterpretation22Manifest
);

ResqmlOSDU.add(
  "prodml23.FluidCharacterization",
  () => getKindOrFallback("FluidModel"),
  FluidModelManifest
);

ResqmlOSDU.add(
  "prodml23.TimeSeriesData",
  () => getKindOrFallback("ProductionValues"),
  ProductionValuesManifest
);

export default ResqmlOSDU;
