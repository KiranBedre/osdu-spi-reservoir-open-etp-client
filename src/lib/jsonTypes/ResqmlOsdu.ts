import { ResqmlOSDUMap } from "./OsduContext";

import { ActivityManifest } from "./Activity";
import { Activity23Manifest } from "./Activity23";
import { ActivityTemplateManifest } from "./ActivityTemplate";
import { ActivityTemplate23Manifest } from "./ActivityTemplate23";
import { ColumnBasedTableManifest } from "./ColumnBasedTable";
import { ColumnBasedTable23Manifest } from "./ColumnBasedTable23";
import { EarthModelInterpretationManifest } from "./EarthModelInterpretation";
import { EarthModelInterpretation22Manifest } from "./EarthModelInterpretation22";
import { FaultInterpretationManifest } from "./FaultInterpretation";
import { FaultInterpretation22Manifest } from "./FaultInterpretation22";
import { GenericProperty22Manifest } from "./GenericProperty22";
import { GenericPropertyManifest } from "./GenericProperty";
import { GenericRepresentation22Manifest } from "./GenericRepresentation22";
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
import { MasterDataBoundaryFeatureManifest } from "./MasterDataBoundaryFeature";
import { MasterDataBoundaryFeature22Manifest } from "./MasterDataBoundaryFeature22";

import { WellboreInterpretation22Manifest } from "./WellboreInterpretation22";
import { WellboreTrajectoryRepresentation22Manifest } from "./WellboreTrajectoryRepresentation22";
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

export { EtpDataspaceManifest } from "./ETPDataspace";
export { WorkProductManifest } from "./WorkProduct";

const ResqmlOSDU = ResqmlOSDUMap.getInstance();

ResqmlOSDU.add(
  "resqml22.WellboreInterpretation",
  () => "osdu:wks:work-product-component--WellboreInterpretation:1.2.0",
  WellboreInterpretation22Manifest
);

ResqmlOSDU.add(
  "resqml22.WellboreTrajectoryRepresentation",
  () => "osdu:wks:work-product-component--WellboreTrajectory:1.3.0",
  WellboreTrajectoryRepresentation22Manifest
);

ResqmlOSDU.add(
  "resqml20.obj_Activity",
  () => "osdu:wks:work-product-component--Activity:1.4.0",
  ActivityManifest
);
ResqmlOSDU.add(
  "eml23.Activity",
  () => "osdu:wks:work-product-component--Activity:1.4.0",
  Activity23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_ActivityTemplate",
  () => "osdu:wks:master-data--ActivityTemplate:1.1.0",
  ActivityTemplateManifest
);
ResqmlOSDU.add(
  "eml23.ActivityTemplate",
  () => "osdu:wks:master-data--ActivityTemplate:1.1.0",
  ActivityTemplate23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_CategoricalProperty",
  () => "osdu:wks:work-product-component--GenericProperty:1.2.0",
  GenericPropertyManifest
);
ResqmlOSDU.add(
  "resqml20.obj_ContinuousProperty",
  () => "osdu:wks:work-product-component--GenericProperty:1.2.0",
  GenericPropertyManifest
);
ResqmlOSDU.add(
  "resqml22.ContinuousProperty",
  () => "osdu:wks:work-product-component--GenericProperty:1.2.0",
  GenericProperty22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_DiscreteProperty",
  () => "osdu:wks:work-product-component--GenericProperty:1.2.0",
  GenericPropertyManifest
);
ResqmlOSDU.add(
  "resqml22.DiscreteProperty",
  () => "osdu:wks:work-product-component--GenericProperty:1.2.0",
  GenericProperty22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_EarthModelInterpretation",
  () => "osdu:wks:work-product-component--EarthModelInterpretation:1.2.0",
  EarthModelInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.EarthModelInterpretation",
  () => "osdu:wks:work-product-component--EarthModelInterpretation:1.2.0",
  EarthModelInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_FaultInterpretation",
  () => "osdu:wks:work-product-component--FaultInterpretation:1.2.0",
  FaultInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.FaultInterpretation",
  () => "osdu:wks:work-product-component--FaultInterpretation:1.2.0",
  FaultInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_GeneticBoundaryFeature",
  () => "osdu:wks:work-product-component--LocalBoundaryFeature:1.2.0",
  LocalBoundaryFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.BoundaryFeature",
  () => "osdu:wks:work-product-component--LocalBoundaryFeature:1.2.0",
  LocalBoundaryFeature22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_GeobodyBoundaryInterpretation",
  () => "osdu:wks:work-product-component--GeobodyBoundaryInterpretation:1.1.0",
  GeobodyBoundaryInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.GeobodyBoundaryInterpretation",
  () => "osdu:wks:work-product-component--GeobodyBoundaryInterpretation:1.1.0",
  GeobodyBoundaryInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_GeobodyInterpretation",
  () => "osdu:wks:work-product-component--GeobodyInterpretation:1.3.0",
  GeobodyInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.GeobodyInterpretation",
  () => "osdu:wks:work-product-component--GeobodyInterpretation:1.3.0",
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
  () =>
    "osdu:wks:work-product-component--GridConnectionSetRepresentation:1.2.0",
  GridConnectionSetRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.GridConnectionSetRepresentation",
  () =>
    "osdu:wks:work-product-component--GridConnectionSetRepresentation:1.2.0",
  GridConnectionSetRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_HorizonInterpretation",
  () => "osdu:wks:work-product-component--HorizonInterpretation:1.2.0",
  HorizonInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.HorizonInterpretation",
  () => "osdu:wks:work-product-component--HorizonInterpretation:1.2.0",
  HorizonInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_IjkGridRepresentation",
  () => "osdu:wks:work-product-component--IjkGridRepresentation:1.2.0",
  IjkGridRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.IjkGridRepresentation",
  () => "osdu:wks:work-product-component--IjkGridRepresentation:1.2.0",
  IjkGridRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_LocalDepth3dCrs",
  () => "osdu:wks:work-product-component--LocalModelCompoundCrs:1.2.0",
  LocalModelCompoundCrsManifest
);
ResqmlOSDU.add(
  "resqml20.obj_LocalTime3dCrs",
  () => "osdu:wks:work-product-component--LocalModelCompoundCrs:1.2.0",
  LocalModelCompoundCrsManifest
);
ResqmlOSDU.add(
  "eml23.LocalEngineeringCompoundCrs",
  () => "osdu:wks:work-product-component--LocalModelCompoundCrs:1.2.0",
  LocalModelCompoundCrs23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_OrganizationFeature",
  () => "osdu:wks:work-product-component--LocalModelFeature:1.2.0",
  LocalModelFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.OrganizationFeature",
  () => "osdu:wks:work-product-component--LocalModelFeature:1.2.0",
  LocalModelFeature22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_PolylineRepresentation",
  GenericRepresentationToOsduKind,
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.PolylineRepresentation",
  GenericRepresentationToOsduKind,
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_PolylineSetRepresentation",
  GenericRepresentationToOsduKind,
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.PolylineSetRepresentation",
  GenericRepresentationToOsduKind,
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_PointSetRepresentation",
  () => "osdu:wks:work-product-component--GenericRepresentation:1.2.0",
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.PointSetRepresentation",
  () => "osdu:wks:work-product-component--GenericRepresentation:1.2.0",
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_PropertySet",
  () => "osdu:wks:work-product-component--PersistedCollection:1.2.0",
  PersistedCollectionPropertySetManifest
);
ResqmlOSDU.add(
  "resqml20.obj_PropertyKind",
  () => "osdu:wks:reference-data--PropertyType:1.0.0",
  PropertyTypeManifest
);
ResqmlOSDU.add(
  "eml23.PropertyKind",
  () => "osdu:wks:work-product-component--PropertyType:1.0.0",
  PropertyType23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_RepresentationSetRepresentation",
  () => "osdu:wks:work-product-component--PersistedCollection:1.2.0",
  PersistedCollectionRepresentationSetManifest
);
ResqmlOSDU.add(
  "eml23.DataobjectCollection",
  () => "osdu:wks:work-product-component--PersistedCollection:1.2.0",
  PersistedCollectionDataobjectCollection23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_SeismicLatticeFeature",
  () => "osdu:wks:master-data--SeismicAcquisitionSurvey.1.4.0",
  SeismicLatticeFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.SeismicLatticeFeature",
  () => "osdu:wks:master-data--SeismicAcquisitionSurvey.1.4.0",
  SeismicLatticeFeature22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_SeismicLineFeature",
  () => "osdu:wks:work-product-component--SeismicLineGeometry:1.2.0",
  SeismicLineGeometryManifest
);
ResqmlOSDU.add(
  "resqml20.obj_StratigraphicColumn",
  () => "osdu:wks:work-product-component--StratigraphicColumn:1.2.0",
  StratigraphicColumnManifest
);
ResqmlOSDU.add(
  "resqml22.StratigraphicColumn",
  () => "osdu:wks:work-product-component--StratigraphicColumn:1.2.0",
  StratigraphicColumn22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_StratigraphicColumnRankInterpretation",
  () =>
    "osdu:wks:work-product-component--StratigraphicColumnRankInterpretation:1.3.0",
  StratigraphicColumnRankInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.StratigraphicColumnRankInterpretation",
  () =>
    "osdu:wks:work-product-component--StratigraphicColumnRankInterpretation:1.3.0",
  StratigraphicColumnRankInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_StratigraphicUnitFeature",
  () => "osdu:wks:work-product-component--LocalRockVolumeFeature:1.2.0",
  LocalRockVolumeFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.StratigraphicUnitFeature",
  () => "osdu:wks:work-product-component--LocalRockVolumeFeature:1.2.0",
  LocalRockVolumeFeature22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_StratigraphicUnitInterpretation",
  () =>
    "osdu:wks:work-product-component--StratigraphicUnitInterpretation:1.3.0",
  StratigraphicUnitInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.StratigraphicUnitInterpretation",
  () =>
    "osdu:wks:work-product-component--StratigraphicUnitInterpretation:1.3.0",
  StratigraphicUnitInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_StringTableLookup",
  () => "osdu:wks:work-product-component--ColumnBasedTable:1.3.0",
  ColumnBasedTableManifest
);
ResqmlOSDU.add(
  "resqml22.obj_StringTableLookup",
  () => "osdu:wks:work-product-component--ColumnBasedTable:1.3.0",
  ColumnBasedTable23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_SubRepresentation",
  () => "osdu:wks:work-product-component--SubRepresentation:1.2.0",
  SubRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.SubRepresentation",
  () => "osdu:wks:work-product-component--SubRepresentation:1.2.0",
  SubRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_TectonicBoundaryFeature",
  () => "osdu:wks:work-product-component--LocalBoundaryFeature:1.2.0",
  LocalBoundaryFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.BoundaryFeature",
  () => "osdu:wks:work-product-component--LocalBoundaryFeature:1.2.0",
  LocalBoundaryFeatureManifest
);
ResqmlOSDU.add(
  "resqml20.obj_TimeSeries",
  () => "osdu:wks:work-product-component--TimeSeries:1.2.0",
  TimeSeriesManifest
);
ResqmlOSDU.add(
  "resqml22.TimeSeries",
  () => "osdu:wks:work-product-component--TimeSeries:1.2.0",
  TimeSeries23Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_TriangulatedSetRepresentation",
  () => "osdu:wks:work-product-component--GenericRepresentation:1.2.0",
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.TriangulatedSetRepresentation",
  () => "osdu:wks:work-product-component--GenericRepresentation:1.2.0",
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_UnstructuredGridRepresentation",
  () => "osdu:wks:work-product-component--UnstructuredGridRepresentation:1.2.0",
  UnstructuredGridRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.UnstructuredGridRepresentation",
  () => "osdu:wks:work-product-component--UnstructuredGridRepresentation:1.2.0",
  UnstructuredGridRepresentation22Manifest
);

// ─── Organization & Fluid Interpretations ────────────────────────────────────

ResqmlOSDU.add(
  "resqml20.obj_StructuralOrganizationInterpretation",
  () =>
    "osdu:wks:work-product-component--StructuralOrganizationInterpretation:1.2.0",
  StructuralOrganizationInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.StructuralOrganizationInterpretation",
  () =>
    "osdu:wks:work-product-component--StructuralOrganizationInterpretation:1.2.0",
  StructuralOrganizationInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_RockFluidOrganizationInterpretation",
  () =>
    "osdu:wks:work-product-component--RockFluidOrganizationInterpretation:1.2.0",
  RockFluidOrganizationInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.RockFluidOrganizationInterpretation",
  () =>
    "osdu:wks:work-product-component--RockFluidOrganizationInterpretation:1.2.0",
  RockFluidOrganizationInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_RockFluidUnitInterpretation",
  () =>
    "osdu:wks:work-product-component--RockFluidUnitInterpretation:1.3.0",
  RockFluidUnitInterpretationManifest
);
ResqmlOSDU.add(
  "resqml22.RockFluidUnitInterpretation",
  () =>
    "osdu:wks:work-product-component--RockFluidUnitInterpretation:1.3.0",
  RockFluidUnitInterpretation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_FluidBoundaryFeature",
  () =>
    "osdu:wks:work-product-component--FluidBoundaryInterpretation:1.2.0",
  FluidBoundaryFeatureManifest
);
ResqmlOSDU.add(
  "resqml22.FluidBoundaryInterpretation",
  () =>
    "osdu:wks:work-product-component--FluidBoundaryInterpretation:1.2.0",
  FluidBoundaryInterpretation22Manifest
);

// ─── Framework & Wellbore Representations ────────────────────────────────────

ResqmlOSDU.add(
  "resqml20.obj_SealedSurfaceFrameworkRepresentation",
  () => "osdu:wks:work-product-component--SealedSurfaceFramework:1.2.0",
  SealedSurfaceFrameworkManifest
);
ResqmlOSDU.add(
  "resqml22.SealedSurfaceFrameworkRepresentation",
  () => "osdu:wks:work-product-component--SealedSurfaceFramework:1.2.0",
  SealedSurfaceFramework22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_SealedVolumeFrameworkRepresentation",
  () => "osdu:wks:work-product-component--SealedVolumeFramework:1.2.0",
  SealedVolumeFrameworkManifest
);
ResqmlOSDU.add(
  "resqml22.SealedVolumeFrameworkRepresentation",
  () => "osdu:wks:work-product-component--SealedVolumeFramework:1.2.0",
  SealedVolumeFramework22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_BlockedWellboreRepresentation",
  () => "osdu:wks:work-product-component--GenericRepresentation:1.2.0",
  GenericRepresentationManifest
);
ResqmlOSDU.add(
  "resqml22.BlockedWellboreRepresentation",
  () => "osdu:wks:work-product-component--GenericRepresentation:1.2.0",
  GenericRepresentation22Manifest
);
ResqmlOSDU.add(
  "resqml20.obj_WellboreMarkerFrameRepresentation",
  () => "osdu:wks:work-product-component--GenericRepresentation:1.2.0",
  GenericRepresentationManifest
);

// ─── WITSML Types ────────────────────────────────────────────────────────────

ResqmlOSDU.add(
  "witsml21.Well",
  () => "osdu:wks:master-data--Well:1.3.0",
  WitsmlWellManifest
);
ResqmlOSDU.add(
  "witsml21.Wellbore",
  () => "osdu:wks:master-data--Wellbore:1.3.0",
  WitsmlWellboreManifest
);
ResqmlOSDU.add(
  "witsml21.Log",
  () => "osdu:wks:work-product-component--WellLog:1.3.0",
  WitsmlWellLogManifest
);
ResqmlOSDU.add(
  "witsml21.Trajectory",
  () => "osdu:wks:work-product-component--WellboreTrajectory:1.3.0",
  WitsmlTrajectoryManifest
);
ResqmlOSDU.add(
  "witsml21.Rig",
  () => "osdu:wks:work-product-component--Rig:1.3.0",
  WitsmlRigManifest
);
ResqmlOSDU.add(
  "witsml21.FluidsReport",
  () => "osdu:wks:work-product-component--FluidsReport:1.3.0",
  WitsmlFluidsReportManifest
);
ResqmlOSDU.add(
  "witsml21.Tubular",
  () => "osdu:wks:work-product-component--Tubular:1.3.0",
  WitsmlTubularManifest
);
ResqmlOSDU.add(
  "witsml21.BhaRun",
  () => "osdu:wks:work-product-component--BHARunReport:1.3.0",
  WitsmlBhaRunManifest
);
ResqmlOSDU.add(
  "witsml21.WellCompletion",
  () => "osdu:wks:work-product-component--WellboreCompletion:1.3.0",
  WitsmlWellCompletionManifest
);

// ─── S2: WellboreFrameRepresentation → WellLog (flatten) ────────────────────

ResqmlOSDU.add(
  "resqml20.obj_WellboreFrameRepresentation",
  () => "osdu:wks:work-product-component--WellLog:1.3.0",
  WellboreFrameToWellLogManifest
);
ResqmlOSDU.add(
  "resqml22.WellboreFrameRepresentation",
  () => "osdu:wks:work-product-component--WellLog:1.3.0",
  WellboreFrameToWellLog22Manifest
);

export default ResqmlOSDU;
