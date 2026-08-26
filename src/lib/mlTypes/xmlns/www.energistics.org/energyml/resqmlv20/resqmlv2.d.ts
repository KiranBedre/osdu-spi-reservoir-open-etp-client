import * as eml20 from "./commonv2";
/* eslint-disable @typescript-eslint/no-empty-interface */

// Source files:
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Activities.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Common.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Features.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Geologic.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Geometry.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Grids.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Interpretations.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Properties.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/PropertySeries.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Representations.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/ResqmlAllObjects.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Seismic.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Streamlines.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Structural.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Technical.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/Wells.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_Activity.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_ActivityTemplate.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_BlockedWellboreRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_BoundaryFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_BoundaryFeatureInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_CategoricalProperty.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_CategoricalPropertySeries.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_CommentProperty.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_CommentPropertySeries.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_ContinuousProperty.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_ContinuousPropertySeries.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_DeviationSurveyRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_DiscreteProperty.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_DiscretePropertySeries.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_DoubleTableLookup.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_EarthModelInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_FaultInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_FluidBoundaryFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_FrontierFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_GenericFeatureInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_GeneticBoundaryFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_GeobodyBoundaryInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_GeobodyFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_GeobodyInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_GeologicUnitFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_GeologicUnitInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_GlobalChronostratigraphicColumn.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_GpGridRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_Grid2dRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_Grid2dSetRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_GridConnectionSetRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_HorizonInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_IjkGridRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_LocalDepth3dCrs.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_LocalGridSet.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_LocalTime3dCrs.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_MdDatum.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_NonSealedSurfaceFrameworkRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_OrganizationFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_PlaneSetRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_PointSetRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_PointsProperty.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_PolylineRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_PolylineSetRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_PropertyKind.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_PropertySet.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_RedefinedGeometryRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_RepresentationIdentitySet.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_RepresentationSetRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_RockFluidOrganizationInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_RockFluidUnitFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_RockFluidUnitInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_SealedSurfaceFrameworkRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_SealedVolumeFrameworkRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_SeismicLatticeFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_SeismicLineFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_SeismicLineSetFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_StratigraphicColumn.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_StratigraphicColumnRankInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_StratigraphicOccurrenceInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_StratigraphicUnitFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_StratigraphicUnitInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_StreamlinesFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_StreamlinesRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_StringTableLookup.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_StructuralOrganizationInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_SubRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_TectonicBoundaryFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_TimeSeries.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_TriangulatedSetRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_TruncatedIjkGridRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_TruncatedUnstructuredColumnLayerGridRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_UnstructuredColumnLayerGridRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_UnstructuredGridRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_WellboreFeature.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_WellboreFrameRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_WellboreInterpretation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_WellboreMarkerFrameRepresentation.xsd
// http://172.20.128.1:8080/resqmlv2/v2.0.1/xsd_schemas/obj_WellboreTrajectoryRepresentation.xsd

declare module "./commonv2" {
  export interface AbstractDataObjectProxyType {
    Activity?: obj_Activity;
    ActivityTemplate?: obj_ActivityTemplate;
    BlockedWellboreRepresentation?: obj_BlockedWellboreRepresentation;
    BoundaryFeature?: obj_BoundaryFeature;
    BoundaryFeatureInterpretation?: obj_BoundaryFeatureInterpretation;
    CategoricalProperty?: obj_CategoricalProperty;
    CategoricalPropertySeries?: obj_CategoricalPropertySeries;
    CommentProperty?: obj_CommentProperty;
    CommentPropertySeries?: obj_CommentPropertySeries;
    ContinuousProperty?: obj_ContinuousProperty;
    ContinuousPropertySeries?: obj_ContinuousPropertySeries;
    DeviationSurveyRepresentation?: obj_DeviationSurveyRepresentation;
    DiscreteProperty?: obj_DiscreteProperty;
    DiscretePropertySeries?: obj_DiscretePropertySeries;
    DoubleTableLookup?: obj_DoubleTableLookup;
    EarthModelInterpretation?: obj_EarthModelInterpretation;
    FaultInterpretation?: obj_FaultInterpretation;
    FluidBoundaryFeature?: obj_FluidBoundaryFeature;
    FrontierFeature?: obj_FrontierFeature;
    GenericFeatureInterpretation?: obj_GenericFeatureInterpretation;
    GeneticBoundaryFeature?: obj_GeneticBoundaryFeature;
    GeobodyBoundaryInterpretation?: obj_GeobodyBoundaryInterpretation;
    GeobodyFeature?: obj_GeobodyFeature;
    GeobodyInterpretation?: obj_GeobodyInterpretation;
    GeologicUnitFeature?: obj_GeologicUnitFeature;
    GeologicUnitInterpretation?: obj_GeologicUnitInterpretation;
    GlobalChronostratigraphicColumn?: obj_GlobalChronostratigraphicColumn;
    GpGridRepresentation?: obj_GpGridRepresentation;
    Grid2dRepresentation?: obj_Grid2dRepresentation;
    Grid2dSetRepresentation?: obj_Grid2dSetRepresentation;
    GridConnectionSetRepresentation?: obj_GridConnectionSetRepresentation;
    HorizonInterpretation?: obj_HorizonInterpretation;
    IjkGridRepresentation?: obj_IjkGridRepresentation;
    LocalDepth3dCrs?: obj_LocalDepth3dCrs;
    LocalGridSet?: obj_LocalGridSet;
    LocalTime3dCrs?: obj_LocalTime3dCrs;
    MdDatum?: obj_MdDatum;
    NonSealedSurfaceFrameworkRepresentation?: obj_NonSealedSurfaceFrameworkRepresentation;
    OrganizationFeature?: obj_OrganizationFeature;
    PlaneSetRepresentation?: obj_PlaneSetRepresentation;
    PointSetRepresentation?: obj_PointSetRepresentation;
    PointsProperty?: obj_PointsProperty;
    PolylineRepresentation?: obj_PolylineRepresentation;
    PolylineSetRepresentation?: obj_PolylineSetRepresentation;
    PropertyKind?: obj_PropertyKind;
    PropertySet?: obj_PropertySet;
    RedefinedGeometryRepresentation?: obj_RedefinedGeometryRepresentation;
    RepresentationIdentitySet?: obj_RepresentationIdentitySet;
    RepresentationSetRepresentation?: obj_RepresentationSetRepresentation;
    RockFluidOrganizationInterpretation?: obj_RockFluidOrganizationInterpretation;
    RockFluidUnitFeature?: obj_RockFluidUnitFeature;
    RockFluidUnitInterpretation?: obj_RockFluidUnitInterpretation;
    SealedSurfaceFrameworkRepresentation?: obj_SealedSurfaceFrameworkRepresentation;
    SealedVolumeFrameworkRepresentation?: obj_SealedVolumeFrameworkRepresentation;
    SeismicLatticeFeature?: obj_SeismicLatticeFeature;
    SeismicLineFeature?: obj_SeismicLineFeature;
    SeismicLineSetFeature?: obj_SeismicLineSetFeature;
    StratigraphicColumn?: obj_StratigraphicColumn;
    StratigraphicColumnRankInterpretation?: obj_StratigraphicColumnRankInterpretation;
    StratigraphicOccurrenceInterpretation?: obj_StratigraphicOccurrenceInterpretation;
    StratigraphicUnitFeature?: obj_StratigraphicUnitFeature;
    StratigraphicUnitInterpretation?: obj_StratigraphicUnitInterpretation;
    StreamlinesFeature?: obj_StreamlinesFeature;
    StreamlinesRepresentation?: obj_StreamlinesRepresentation;
    StringTableLookup?: obj_StringTableLookup;
    StructuralOrganizationInterpretation?: obj_StructuralOrganizationInterpretation;
    SubRepresentation?: obj_SubRepresentation;
    TectonicBoundaryFeature?: obj_TectonicBoundaryFeature;
    TimeSeries?: obj_TimeSeries;
    TriangulatedSetRepresentation?: obj_TriangulatedSetRepresentation;
    TruncatedIjkGridRepresentation?: obj_TruncatedIjkGridRepresentation;
    TruncatedUnstructuredColumnLayerGridRepresentation?: obj_TruncatedUnstructuredColumnLayerGridRepresentation;
    UnstructuredColumnLayerGridRepresentation?: obj_UnstructuredColumnLayerGridRepresentation;
    UnstructuredGridRepresentation?: obj_UnstructuredGridRepresentation;
    WellboreFeature?: obj_WellboreFeature;
    WellboreFrameRepresentation?: obj_WellboreFrameRepresentation;
    WellboreInterpretation?: obj_WellboreInterpretation;
    WellboreMarkerFrameRepresentation?: obj_WellboreMarkerFrameRepresentation;
    WellboreTrajectoryRepresentation?: obj_WellboreTrajectoryRepresentation;
  }
}

interface HandlerInstance {
  content?: any;
  _exists: boolean;
  _namespace: string;
  _parent?: HandlerInstance;
  _name?: string;
  _before?(): void;
  _after?(): void;
}
interface BaseType extends eml20.BaseType { }
/** General parameter value used in one instance of activity */
export interface AbstractActivityParameter extends BaseType {
  /** @integer When parameter is an array, used to indicate the index in the array */
  Index?: number;
  Key?: AbstractParameterKey[];
  /** Textual description about how this parameter was selected. */
  Selection?: string;
  /** Name of the parameter, used to identify it in the activity. Must have an equivalent in the activity descriptor parameters. */
  Title: string;
}

/** Generic representation of an array of Boolean values. Each derived element provides a specialized implementation to allow specific optimization of the representation. */
export interface AbstractBooleanArray extends AbstractValueArray { }

/** Description of the geometry of a column layer grid, e.g., parity and pinch, together with its supporting topology.
 *
 * Column layer grid cell geometry is based upon nodes on coordinate lines.
 *
 * Geometry is contained within the representation of a grid.
 *
 * Point Geometry is that of the column layer coordinate line nodes. Coordinate line nodes for all of the coordinate lines, with NKL nodes per line.
 *
 * The numbering of these lines follow the pillar numbering if no split coordinate lines are present.
 *
 * The unsplit coordinate lines share an indexing with the pillars. The numbering of the remaining lines are defined in the columnsPerSplitCoordinateLine list-of-lists if split coordinate lines are present.
 *
 * Pillar numbering is either 1D or 2D, so for unfaulted grids, the node dimensions may follow either a 2D or 3D array. Otherwise the nodes will be 2D.
 *
 * In HDF5 nodes are stored as separate X, Y, Z, values, so add another dimension (size=3) which is fastest in HDF5. */
export interface AbstractColumnLayerGridGeometry extends AbstractGridGeometry {
  /** Indicator that a cell has a defined geometry. This attribute is grid metadata. If the indicator shows that the cell geometry is NOT defined, then this attribute overrides any other node geometry specification.
   *
   * Array index is 2D/3D. */
  CellGeometryIsDefined?: AbstractBooleanArray;
  KDirection: KDirection;
  /** Optional indicator that two adjacent nodes on a coordinate line are colocated. This is considered grid meta-data, and is intended to over-ride any geometric comparison of node locations.
   *
   * Array index follows #CoordinateLines x (NKL-1). */
  NodeIsColocatedInKDirection?: AbstractBooleanArray;
  /** Optional indicator that two adjacent nodes on the KEDGE of a cell are colocated. This is considered grid meta-data, and is intended to over-ride any geometric comparison of node locations.
   *
   * Array index follows #EdgesPerColumn x NKL for unstructured column layer grids and 4 x NI x NJ x NKL for IJK grids. */
  NodeIsColocatedOnKEdge?: AbstractBooleanArray;
  /** Indicator that a pillar has at least one node with a defined cell geometry. This is considered grid meta-data. If the indicator does not indicate that the pillar geometry is defined, then this over-rides any other node geometry specification.
   *
   * Array index follows #Pillars and so may be either 2d or 1d. */
  PillarGeometryIsDefined: AbstractBooleanArray;
  PillarShape: PillarShape;
  SplitCoordinateLines?: ColumnLayerSplitCoordinateLines;
  SplitNodes?: SplitNodePatch;
  SubnodeTopology?: ColumnLayerSubnodeTopology;
}

/** Abstract class that includes IJK grids and unstructured column layer grids. All column layer grids have a layer index K=1,...,NK or K0=0,...,NK-1.
 *
 * Cell geometry is characterized by nodes on coordinate lines. */
export interface AbstractColumnLayerGridRepresentation
  extends AbstractGridRepresentation {
  IntervalStratigraphicUnits?: IntervalStratigraphicUnits;
  /** @integer Number of layers in the grid. Must be positive. */
  Nk: number;
}

/** The parent class of an atomic, linear, or surface geologic contact description.
 *
 * When the contact is between two surface representations (e.g., fault/fault, horizon/fault, horizon/horizon), then the contact is a line.
 * When the contact is between two volume representations (stratigraphic unit/stratigraphic unit), then the contact is a surface.
 * A contact interpretation can be associated with other contact interpretations in an organization interpretation.
 * To define a contact representation, you must first define a contact interpretation. */
export interface AbstractContactInterpretationPart extends BaseType {
  ContactRelationship: ContactRelationship;
  /** @integer contact index */
  Index: number;
  PartOf?: eml20.DataObjectReference;
}

/** Parent class of the sealed and nonsealed contact elements. */
export interface AbstractContactRepresentationPart extends BaseType {
  /** @integer The index of the contact.
   * Indicates identity of the contact in the surface framework context. It is used for contact identities and to find the interpretation of this particular contact. */
  Index: number;
}

/** Generic representation of an array of double values. Each derived element provides specialized implementation to allow specific optimization of the representation. */
export interface AbstractDoubleArray extends AbstractValueArray { }

/** Something that has physical existence at some point during the exploration, development, production or abandonment of a reservoir. For example: It can be a boundary, a rock volume, a basin area, but also extends to a drilled well, a drilling rig, an injected or produced fluid, or a 2D, 3D, or 4D seismic survey.
 * Features are divided into these categories: geologic or technical. */
export interface AbstractFeature extends AbstractResqmlDataObject { }

/** The main class that contains all of the other feature interpretations included in this interpreted model. */
export interface AbstractFeatureInterpretation
  extends AbstractResqmlDataObject {
  Domain: Domain;
  HasOccuredDuring?: TimeInterval;
  InterpretedFeature: eml20.DataObjectReference;
}

/** Objects that exist a priori, in the natural world, for example: the rock formations and how they are positioned with regard to each other; the fluids that are present before production; or the position of the geological intervals with respect to each. Some of these objects are static-such as geologic intervals---while others are dynamic-such as fluids; their properties, geometries, and quantities may change over time during the course of field production.
 * RESQML has these types of features: geologic and technical. */
export interface AbstractGeologicFeature extends AbstractFeature { }

/** The base class for all geometric values, which is always associated with a representation. */
export interface AbstractGeometry extends BaseType {
  LocalCrs: eml20.DataObjectReference;
  TimeIndex?: TimeIndex;
}

/** Grid geometry described by means of points attached to nodes and additional optional points which may be attached to other indexable elements of the grid representation. */
export interface AbstractGridGeometry extends PointGeometry {
  AdditionalGridPoints?: AdditionalGridPoints[];
}

/** Abstract class for all grid representations. */
export interface AbstractGridRepresentation extends AbstractRepresentation {
  CellFluidPhaseUnits?: CellFluidPhaseUnits;
  CellStratigraphicUnits?: CellStratigraphicUnits;
  ParentWindow?: AbstractParentWindow;
}

/** Generic representation of an array of integer values. Each derived element provides specialized implementation to allow specific optimization of the representation. */
export interface AbstractIntegerArray extends AbstractValueArray { }

/** Defines a local 2D+1D coordinate reference system, by translation and rotation, whose origin is located at the (X,Y,Z) Offset from the Projected and Vertical 2D+1D CRS.
 *
 * The units of measure in XY follow the Projected Crs. The units of measure of the third coordinate is determined in the depth or concrete type.
 *
 * ArealRotation is a plane angle.
 *
 * Defines a local 3D CRS is subject to the following restrictions:
 *
 * - The projected 2d CRS must have orthogonal axes
 *
 * - The vertical 1d CRS must be chosen so that it is orthogonal to the plane defined by the projected 2d CRS
 *
 * As a consequence of the definition:
 *
 * - The local CRS forms a Cartesian system of axes.
 *
 * - The local areal axes are in the plane of the projected system.
 *
 * - The local areal axes are orthogonal to each other.
 *
 * This 3D system is semantically equivalent to a compound CRS composed of a local 2D areal system and a local 1D vertical system.
 * The labels associated with the axes on this local system are X, Y, Z or X, Y, T.
 * The relative orientation of the local Y axis with respect to the local X axis is identical to that of the global axes. */
export interface AbstractLocal3dCrs extends AbstractResqmlDataObject {
  /** The rotation of the local Y axis relative to the projected Y axis.
   *
   * - A positive value indicates a clockwise rotation from the projected Y axis.
   *
   * - A negative value indicates a counter-clockwise rotation form the projected Y axis. */
  ArealRotation: eml20.PlaneAngleMeasure;
  /** Defines the coordinate system axis order of the global projected CRS when the projected CRS is an unknown CRS, else it must be correspond to the axis order of the projected  CRS. */
  ProjectedAxisOrder: eml20.AxisOrder2d;
  ProjectedCrs: eml20.AbstractProjectedCrs;
  /** Unit of measure of the associated Projected CRS. When the projected CRS is not unknown, it must be the same than the unit defined by the Projected CRS. */
  ProjectedUom: eml20.LengthUom;
  VerticalCrs: eml20.AbstractVerticalCrs;
  /** Unit of measure of the associated Vertical CRS. When the vertical CRS is not unknown, it must be the same than the unit defined by the Vertical CRS. */
  VerticalUom: eml20.LengthUom;
  /** The X location of the origin of the local areal axes relative to the projected CRS origin.
   * The value MUST represent the first axis of the coordinate system.
   * The unit of measure is defined by the unit of measure for the projected 2D CRS. */
  XOffset: number;
  /** The Y offset of the origin of the local areal axes relative to the projected CRS origin.
   * The value MUST represent the second axis of the coordinate system.
   * The unit of measure is defined by the unit of measure for the projected 2D CRS. */
  YOffset: number;
  /** Indicates that Z values correspond to depth values and are increasing downward, as opposite to elevation values increasing upward. When the vertical CRS is not an unknown, it must correspond to the axis orientation of the vertical CRS. */
  ZIncreasingDownward: boolean;
  /** The Z offset of the origin of the local vertical axis relative to the vertical CRS origin. According to CRS type (depth or time) it corresponds to the depth or time datum
   * The value MUST represent the third axis of the coordinate system.
   * The unit of measure is defined by the unit of measure for the vertical CRS. */
  ZOffset: number;
}

/** The main class used to group features into meaningful units as a step in working towards the goal of building an earth model (the organization of all other organizations in RESQML).
 * An organization interpretation:
 *
 * - Is typically comprised of one stack of its contained elements.
 *
 * - May be built on other organization interpretations.
 *
 * Typically contains:
 *
 * - contacts between the elements of this stack among themselves.
 * - contacts between the stack elements and other organization elements. */
export interface AbstractOrganizationInterpretation
  extends AbstractFeatureInterpretation {
  ContactInterpretation?: AbstractContactInterpretationPart[];
}

/** Abstract class describing a key used to identify a parameter value. When multiple values are provided for a given parameter, provides a way to identify the parameter through its association with an object, a time index... */
export interface AbstractParameterKey extends BaseType { }

/** Defines an array of parametric lines.
 *
 * The array size is obtained from context. In the current schema, this may be as simple as a 1D array (#Lines=count) or a 2D array #Lines = NIL x NJL for an IJK grid representation. */
export interface AbstractParametricLineArray extends BaseType { }

/** The abstract class for defining a single parametric line. */
export interface AbstractParametricLineGeometry extends AbstractGeometry { }

/** Parent window specification, organized according to the topology of the parent grid. In addition to a window specification, for grids with I, J, and/or K coordinates, the parentage construction includes a regridding description that covers grid refinement, coarsening, or any combination of the two. */
export interface AbstractParentWindow extends BaseType {
  CellOverlap?: CellOverlap;
}

/** The abstract class for all geometric values defined by planes. */
export interface AbstractPlaneGeometry extends AbstractGeometry { }

/** The abstract class of 3D points implemented in a single fashion for the schema. Abstraction allows a variety of instantiations for efficiency or to implicitly provide additional geometric information about a data-object. For example, parametric points can be used to implicitly define a wellbore trajectory using an underlying parametric line, by the specification of the control points along the parametric line.
 *
 * The dimensionality of the array of 3D points is based on context within an instance. */
export interface AbstractPoint3dArray extends BaseType { }

/** Base class for storing all property values on representations, except current geometry location.
 * Values attached to a given element can be either a scalar or a vector. The size of the vector is constant on all elements, and it is assumed that all elements of the vector have identical property types and share the same unit of measure. */
export interface AbstractProperty extends AbstractResqmlDataObject {
  /** @integer Number of elements in a 1D list of properties. When used in a multi-dimensional array, count is always the fastest. */
  Count: number;
  IndexableElement: IndexableElements;
  LocalCrs?: eml20.DataObjectReference;
  PropertyKind: AbstractPropertyKind;
  /** @integer Optional element indicating the realization index (metadata). Used if the property is the result of a multi-realization process. */
  RealizationIndex?: number;
  SupportingRepresentation: eml20.DataObjectReference;
  TimeIndex?: TimeIndex;
  /** @integer Indicates that the property is the output of a specific time step from a flow simulator. Time step is metadata that makes sense in the context of a specific simulation run, and should not be confused with the time index. */
  TimeStep?: number;
}

export interface AbstractPropertyKind extends BaseType { }

/** Generic representation of a property lookup table. Each derived element provides specific lookup methods for different data types. */
export interface AbstractPropertyLookup extends AbstractResqmlDataObject { }

/** The parent class of all specialized digital descriptions, which may provide a representation of a feature interpretation or a technical feature. It may be either of these:
 *
 * - based on a topology and contains the geometry of this digital description.
 *
 * - based on the topology or the geometry of another representation.
 *
 * Not all representations require a defined geometry. For example, it is not required for block-centered grids or wellbore frames. For representations without geometry, a software writer may provide null (NaN) values in the local 3D CRS, which is mandatory.
 *
 * TimeIndex is provided to describe time-dependent geometry. */
export interface AbstractRepresentation extends AbstractResqmlDataObject {
  RepresentedInterpretation?: eml20.DataObjectReference;
}

/** The parent class for all top-level elements in RESQML. Inherits from AbstractCitedDataObject in the commonV2 package of the model. */
export interface AbstractResqmlDataObject
  extends eml20.AbstractCitedDataObject {
  ExtraMetadata?: NameValuePair[];
}

/** Parent class is used to associate horizon and fault representations to seismic 2D and seismic 3D technical features. It stores a 1-to-1 mapping between geometry coordinates (usually X, Y, Z) and trace or inter-trace positions on a seismic survey. */
export interface AbstractSeismicCoordinates extends BaseType {
  SeismicSupport: eml20.DataObjectReference;
}

/** An organization of seismic lines. For the context of RESQML, a seismic survey does not refer to any vertical dimension information, but only really at shot point locations or common midpoint gathers. The seismic traces, if needed by reservoir models, are transferred in an industry standard format such as SEGY.
 * RESQML supports these basic types of seismic surveys:
 *
 * - seismic lattice (organization of the traces for the 3D acquisition and processing phases).
 * - seismic line (organization of the traces for the 2D acquisition and processing phases).
 *
 * Additionally, these seismic lattices and seismic lines can be aggregated into sets. */
export interface AbstractSeismicSurveyFeature
  extends AbstractTechnicalFeature { }

/** The main class that defines the relationships between the stratigraphic units and provides the stratigraphic hierarchy of the Earth.
 *
 * BUSINESS RULE: A stratigraphic organization must be in a ranked order from a lower rank to an upper rank. For example, it is possible to find previous unit containment relationships between several ranks. */
export interface AbstractStratigraphicOrganizationInterpretation
  extends AbstractOrganizationInterpretation {
  OrderingCriteria: OrderingCriteria;
}

/** Parent class for a sealed or non-sealed surface framework representation. Each one instantiates a representation set representation.
 *
 * The difference between the sealed and non-sealed frameworks is that, in the non-sealed case, we do not have all of the contact representations, or we have all of the contacts but they are not all sealed. */
export interface AbstractSurfaceFrameworkRepresentation
  extends obj_RepresentationSetRepresentation {
  ContactIdentity?: ContactIdentity[];
}

/** Parent class of structural surface representations, which can be bounded by an outer ring and has inner rings. These surfaces may consist of one or more patches. */
export interface AbstractSurfaceRepresentation extends AbstractRepresentation {
  Boundaries?: PatchBoundaries[];
  SurfaceRole: SurfaceRole;
}

/** Objects that exist by the action of humans. Examples include: wells and all they may contain, seismic surveys (surface, permanent water bottom), or injected fluid volumes. Because the decision to deploy such equipment is the result of studies or decisions by humans, technical features are usually not subject to the same kind of large changes in interpretation as geologic features. However, they are still subject to measurement error and other sources of uncertainty, and so still can be considered as subject to “interpretation”.
 * RESQML has these types of features: geologic and technical. */
export interface AbstractTechnicalFeature extends AbstractFeature { }

/** Abstract class for truncated IJK grids and truncated unstructured column layer grids. Each column layer grid class must have a defined geometry in which cells are truncated and additional split cells are defined. */
export interface AbstractTruncatedColumnLayerGridRepresentation
  extends AbstractGridRepresentation {
  /** @integer Number of layers in the grid. Must be positive. */
  Nk: number;
  TruncationCells: TruncationCellPatch;
}

/** Generic representation of an array of numeric, Boolean, and string values. Each derived element provides specialized implementation for specific content types or for optimization of the representation. */
export interface AbstractValueArray extends BaseType { }

/** Base class for property values. Each derived element provides specific property values, including point property in support of geometries. */
export interface AbstractValuesProperty extends AbstractProperty {
  Facet?: PropertyKindFacet[];
  PatchOfValues: PatchOfValues[];
}

/** Used to activate and deactivate the referencing object at the times indicated.
 *
 * If the activation object is not present, then the referencing object is always active.
 *
 * If the activation object is present, then the referencing object is not active until activated. */
export interface Activation extends BaseType {
  /** The index in the time series at which the state of the referencing object is changed. Toggle will change state from inactive to active, or toggle will change state from active to inactive. */
  ActivationToggleIndices: AbstractIntegerArray;
  TimeSeries: eml20.DataObjectReference;
}

/** Geometry given by means of points attached to additional elements of a grid. */
export interface AdditionalGridPoints extends BaseType {
  Attachment: GridGeometryAttachment;
  Points: AbstractPoint3dArray;
  /** @integer Used to remove ambiguity in geometry attachment, if the attachment element is not sufficient. Usually required for subnodes and for the general purpose grid, but not otherwise. */
  RepresentationPatchIndex?: number;
}

/** Additional grid topology and/or patches, if required, for indexable elements that otherwise do not have their topology defined within the grid representation. For example, column edges need to be defined if we wish to have an enumeration for the faces of a column layer grid, but not otherwise. */
export interface AdditionalGridTopology extends BaseType {
  ColumnLayerSubnodeTopology?: ColumnLayerSubnodeTopology;
  IjSplitColumnEdges?: IjSplitColumnEdges;
  SplitColumnEdges?: ColumnLayerSplitColumnEdges;
  SplitEdges?: SplitEdges;
  SplitFaces?: SplitFaces;
  SplitNodes?: SplitNodePatch;
  UnstructuredColumnEdges?: UnstructuredColumnEdges;
  UnstructuredSubnodeTopology?: UnstructuredSubnodeTopology;
}

/** The main class for data describing an opinion of the contact between two geologic feature interpretations. A contact interpretation between two surface geological boundaries is usually a line.
 * A contact interpretation between two volumes (rock feature interpretation) is usually a surface.
 *
 * This class allows you to build a formal sentence-in the pattern of subject-verb-direct object-which is used to describe the construction of a node, line, or surface contact. It is also possible to attach a primary and a secondary qualifier to the subject and to the direct object.
 *
 * For example, one contact interpretation can be described by a sentence such as:
 * The interpreted fault named F1 interp on its hanging wall side splits the interpreted horizon named H1 Interp on both its sides.
 *
 * Subject = F1 Interp, with qualifier "hanging wall side"
 * Verb = splits
 * Direct Object = H1 Interp, with qualifier "on both sides" */
export interface BinaryContactInterpretationPart
  extends AbstractContactInterpretationPart {
  /** Data-object reference (by UUID link) to a geologic feature interpretation, which is the direct object of the sentence that defines how the contact was constructed. */
  DirectObject: ContactElementReference;
  /** Data-object reference (by UUID link) to a geologic feature interpretation, which is the subject of the sentence that defines how the contact was constructed. */
  Subject: ContactElementReference;
  Verb: ContactVerb;
}

/** An array of Boolean values that is explicitly defined by indicating which indices in the array are either true or false. This class is used to represent very sparse true or false data, based on a discrete property. */
export interface BooleanArrayFromDiscretePropertyArray
  extends AbstractBooleanArray {
  Property: eml20.DataObjectReference;
  /** @integer Integer to match for the value to be considered true */
  Value: number;
}

/** An array of Boolean values defined by specifying explicitly which indices in the array are either true or false. This class is used to represent very sparse true or false data. */
export interface BooleanArrayFromIndexArray extends AbstractBooleanArray {
  /** @integer Total number of Boolean elements in the array. This number is different from the number of indices used to represent the array. */
  Count: number;
  /** Indicates whether the specified elements are true or false. */
  IndexIsTrue: boolean;
  /** Array of integer indices.
   *
   * BUSINESS RULE: Must be non-negative. */
  Indices: AbstractIntegerArray;
}

/** Represents an array of Boolean values where all values are identical. This an optimization for which an array of explicit Boolean values is not required. */
export interface BooleanConstantArray extends AbstractBooleanArray {
  /** @integer Size of the array. */
  Count: number;
  /** Value inside all the elements of the array. */
  Value: boolean;
}

/** Array of boolean values provided explicitly by an HDF5 dataset. */
export interface BooleanHdf5Array extends AbstractBooleanArray {
  /** Reference to an HDF5 array of values. */
  Values: eml20.Hdf5Dataset;
}

/** The enumerated attributes of a horizon. */
export type BoundaryRelation =
  | "conformable"
  | "unconformable below and above"
  | "unconformable above"
  | "unconformable below";

/** A mapping from cells to fluid phase unit interpretation to describe the initial hydrostatic fluid column. */
export interface CellFluidPhaseUnits extends BaseType {
  FluidOrganization: eml20.DataObjectReference;
  /** Index of the phase unit kind within a given fluid phase organization for each cell. Follows the indexing defined by the PhaseUnit enumeration. When applied to the wellbore frame representation, the indexing is identical to the number of intervals.
   *
   * Use null (-1) if no fluid phase is present, e.g., within the seal.
   *
   * BUSINESS RULE: Array length is equal to the number of cells in the representation (grid, wellbore frame or blocked well). */
  PhaseUnitIndices: AbstractIntegerArray;
}

/** Optional cell volume overlap information between the current grid (the child) and the parent grid. Use this data-object when the child grid has an explicitly defined geometry, and these relationships cannot be inferred from the regrid descriptions. */
export interface CellOverlap extends BaseType {
  /** @integer Number of parent-child cell overlaps. Must be positive. */
  Count?: number;
  OverlapVolume?: OverlapVolume;
  /** (Parent cell index, Child cell index) pair for each overlap.
   *
   * BUSINESS RULE: Length of array must equal 2 x overlapCount. */
  ParentChildCellPairs?: AbstractIntegerArray;
}

/** Parent window for ANY grid indexed as if it were an unstructured cell grid, i.e., using a 1D index. */
export interface CellParentWindow extends AbstractParentWindow {
  /** Cell indices which list the cells in the parent window.
   *
   * BUSINESS RULE: Number of cells must be consistent with the child grid cell count. */
  CellIndices: AbstractIntegerArray;
  ParentGrid: eml20.DataObjectReference;
}

/** Used to indicate that all cells are of a uniform topology, i.e., have the same number of nodes per cell. This information is supplied by the RESQML writer to indicate the complexity of the grid geometry, as an aide to the RESQML reader.
 *
 * If a specific cell shape is not appropriate, then use polyhedral.
 *
 * BUSINESS RULE: Should be consistent with the actual geometry of the grid. */
export type CellShape =
  | "tetrahedral"
  | "pyramidal"
  | "prism"
  | "hexahedral"
  | "polyhedral";

/** A mapping from cell to stratigraphic unit interpretation for a representations (grids or blocked wells). */
export interface CellStratigraphicUnits extends BaseType {
  StratigraphicOrganization: eml20.DataObjectReference;
  /** Index of the stratigraphic unit of a given stratigraphic column for each cell.
   *
   * Use null (-1) if no stratigraphic column, e.g., within salt
   *
   * BUSINESS RULE: Array length is the number of cells in the grid or the blocked well */
  UnitIndices: AbstractIntegerArray;
}

/** The chronostratigraphic ranking of “well known” stratigraphic unit features in the global chronostratigraphic column.
 * The ranks are organized from container to contained, e.g., (eon=1), (era=2), (period=3)
 * The units are ranked by using age as ordering criteria, from oldest to youngest.
 * These stratigraphic units have no associated interpretations or representations.
 *
 * BUSINESS RULE: The name must reference a well-known stratigraphic unit feature (such as "Jurassic"), for example, from the International Commission on Stratigraphy (http://www.stratigraphy.org). */
export interface ChronostratigraphicRank extends BaseType {
  Contains: eml20.DataObjectReference[];
  /** Name of the chrono rank such as "epoch, era, ..."
   * @maxLength 64 */
  Name: string;
}

/** Parent window for any column layer grid indexed as if it were an unstructured column layer grid, i.e., IJ columns are replaced by a column index. */
export interface ColumnLayerParentWindow extends AbstractParentWindow {
  /** Column indices that list the columns in the parent window.
   *
   * BUSINESS RULE: Number of columns must be consistent with the child grid column count. */
  ColumnIndices: AbstractIntegerArray;
  KRegrid: Regrid;
  /** List of parent cells that are to be retained at their original resolution and are not to be included within a local grid. The omit allows non-rectangular local grids to be specified.
   *
   * 0-based indexing follows #Columns x #Layers relative to the parent window cell count, not to the parent grid. */
  OmitParentCells?: AbstractIntegerArray;
  ParentGrid: eml20.DataObjectReference;
}

/** Column edges are needed to construct the indices for the cell faces for column layer grids. For split column layer grids, the column edge indices must be defined explicitly. Column edges are not required to describe the lowest order grid geometry, but may be required for higher order geometries or properties. */
export interface ColumnLayerSplitColumnEdges extends BaseType {
  /** Column index for each of the split column edges. Used to implicitly define column and cell faces. List-of-lists construction not required since each split column edge must be in a single column. */
  ColumnPerSplitColumnEdge: AbstractIntegerArray;
  /** @integer Number of split column edges in this grid. Must be positive. */
  Count: number;
  /** Parent unsplit column edge index for each of the split column edges. Used to implicitly define split face indexing. */
  ParentColumnEdgeIndices: AbstractIntegerArray;
}

/** Definition of the indexing for the split coordinate lines. When present, this indexing contributes to the coordinate line nodes. */
export interface ColumnLayerSplitCoordinateLines extends BaseType {
  /** Column indices for each of the split coordinate lines. Used to implicitly define column and cell geometry. List-of-lists construction used to support shared coordinate lines. */
  ColumnsPerSplitCoordinateLine: ResqmlJaggedArray;
  /** @integer Number of split coordinate lines. The count must be positive. */
  Count: number;
  /** Pillar index for each split coordinate line.
   * Length of this array is equal to the number of split coordinate lines.
   *
   * For the first pillarCount lines, the index of the coordinate line equals the index of the corresponding pillar.  This array provides the pillar indices for the additional (split) coordinate lines.
   *
   * Used to implicitly define column and cell geometry. */
  PillarIndices: AbstractIntegerArray;
  SplitColumnEdges?: ColumnLayerSplitColumnEdges;
}

/** This data-object consists of the Unstructured Cell Finite Elements subnode topology plus the column subnodes. */
export interface ColumnLayerSubnodeTopology extends SubnodeTopology {
  ColumnSubnodes?: ColumnSubnodePatch[];
}

/** Used to indicate that all columns are of a uniform topology, i.e., have the same number of faces per column. This information is supplied by the RESQML writer to indicate the complexity of the grid geometry, as an aide to the RESQML reader.
 *
 * If a specific column shape is not appropriate, then use polygonal.
 *
 * BUSINESS RULE: Should be consistent with the actual geometry of the grid. */
export type ColumnShape = "triangular" | "quadrilateral" | "polygonal";

/** Use this subnode construction if the number of subnodes per object varies from column to column, but does not vary from layer to layer. */
export interface ColumnSubnodePatch extends SubnodePatch {
  /** Number of subnodes per object, with a different number in each column of the grid. */
  SubnodeCountPerObject: AbstractIntegerArray;
}

export interface ConnectionInterpretations extends BaseType {
  FeatureInterpretation: eml20.DataObjectReference[];
  /** Indices for the interpretations for each connection, if any. The use of a Resqml jagged array allows zero or more than one interpretation to be associated with a single connection. */
  InterpretationIndices: ResqmlJaggedArray;
}

/** A reference to either a geologic feature interpretation or a frontier feature.
 *
 * BUSINESS RULE: The ContentType of the corresponding data-object reference must be a geological feature interpretation or a frontier feature. */
export interface ContactElementReference extends eml20.DataObjectReference {
  Qualifier?: ContactSide;
  SecondaryQualifier?: ContactMode;
}

/** Indicates identity between two (or more) contacts. For possible types of identities, see IdentityKind. */
export interface ContactIdentity extends BaseType {
  IdentityKind: IdentityKind;
  /** The contact representations that share common identity as specified by their indices */
  ListOfContactRepresentations: AbstractIntegerArray;
  /** Indicates which nodes (identified by their common index in all contact representations) of the contact representations are identical.
   *
   * If this list is not present, then it indicates that all nodes in each representation are identical, on an element by element level. */
  ListOfIdenticalNodes?: AbstractIntegerArray;
}

export type ContactMode = "baselap" | "erosion" | "extended" | "proportional";

/** A subset of topological elements of an existing contact representation part (sealed or non-sealed contact). */
export interface ContactPatch extends Patch1d {
  /** @integer Identifies a representation by its index, in the list of representations contained in the organization. */
  RepresentationIndex: number;
  /** The ordered list of nodes (identified by their global index) in the supporting representation, which constitutes the contact patch. */
  SupportingRepresentationNodes: AbstractIntegerArray;
}

/** The enumerations that specify the role of the contacts in a contact interpretation as described in the attributes below. */
export type ContactRelationship =
  | "frontier feature to frontier feature"
  | "genetic boundary to frontier feature"
  | "genetic boundary to genetic boundary"
  | "genetic boundary to tectonic boundary"
  | "stratigraphic unit to frontier feature"
  | "stratigraphic unit to stratigraphic unit"
  | "tectonic boundary to frontier feature"
  | "tectonic boundary to genetic boundary"
  | "tectonic boundary to tectonic boundary";

/** Used when the contact already exists as a top level element representation. */
export interface ContactRepresentationReference
  extends AbstractContactRepresentationPart {
  Representation: eml20.DataObjectReference;
}

/** Enumeration that specifies the location of the contacts, chosen from the attributes listed below. For example, if you specify contact between a horizon and a fault, you can specify if the contact is on the foot wall side or the hanging wall side of the fault, and if the fault is splitting both sides of a horizon or the older side only.
 *
 * From Wikipedia: http://en.wikipedia.org/wiki/Foot_wall
 * CC-BY-SA-3.0-MIGRATED; GFDL-WITH-DISCLAIMERS
 * Released under the GNU Free Documentation License. */
export type ContactSide =
  | "footwall"
  | "hanging wall"
  | "north"
  | "south"
  | "east"
  | "west"
  | "younger"
  | "older"
  | "both";

/** Enumerations for the verbs that can be used to define the impact on the construction of the model of the geological event that created the binary contact. */
export type ContactVerb =
  | "splits"
  | "interrupts"
  | "contains"
  | "conforms"
  | "erodes"
  | "stops at"
  | "crosses"
  | "includes";

/** Parameter referencing to a top level object. */
export interface DataObjectParameter extends AbstractActivityParameter {
  /** Is actually a reference and not a containment relationship. */
  DataObject: eml20.DataObjectReference;
}

/** The enumerated attributes of a horizon. */
export type DepositionMode =
  | "proportional between top and bottom"
  | "parallel to bottom"
  | "parallel to top"
  | "parallel to another boundary";

/** Enumeration for the feature interpretation to specify if the measurement is in the seismic time or depth domain or if it is derived from a laboratory measurement. */
export type Domain = "depth" | "time" | "mixed";

/** Represents an array of double values where all values are identical. This an optimization for which an array of explicit double values is not required. */
export interface DoubleConstantArray extends AbstractDoubleArray {
  /** @integer Size of the array. */
  Count: number;
  /** Values inside all the elements of the array. */
  Value: number;
}

/** An array of double values provided explicitly by an HDF5 dataset.
 * By convention, the null value is NaN. */
export interface DoubleHdf5Array extends AbstractDoubleArray {
  /** Reference to an HDF5 array of doubles. */
  Values: eml20.Hdf5Dataset;
}

/** Represents an array of doubles based on an origin and a multi-dimensional offset. The offset is based on a linearization of a multi-dimensional offset.
 *
 * If count(i) is the number of elements in the dimension i and offset(i) is the offset in the dimension i, then:
 * globalOffsetInNDimension = startValue+ ni*offset(n) + n_1i*count(n)*offset(n-1) + .... + 0i*count(n)*count(n-1)*....count(1)*offset(0) */
export interface DoubleLatticeArray extends AbstractDoubleArray {
  Offset: DoubleConstantArray[];
  /** Value representing the global start for the lattice. */
  StartValue: number;
}

/** (key,value) pairs for a lookup table. */
export interface DoubleLookup extends BaseType {
  /** @integer Input to a table lookup. */
  Key: number;
  /** Output from a table lookup. */
  Value: number;
}

/** Describes edges that are not linked to any other edge. Because edges do not have indices, a consecutive pair of nodes is used to identify each edge.
 *
 * The split edges dataset is a set of nodes (2 nodes per edge). Each patch has a set of 2 nodes. */
export interface EdgePatch extends Patch1d {
  /** An array of split edges to define patches.
   * It points to an HDF5 dataset, which must be a 2D array of non-negative integers with dimensions 2 x numSplitEdges. integers with dimensions {2, numSplitEdges} */
  SplitEdges?: AbstractIntegerArray;
}

/** Unstructured cell grids require the definition of edges if the subnode attachment is of kind edges.
 *
 * Use Case: Finite elements, especially for higher order geometry.
 *
 * BUSINESS RULE: Edges must be defined for unstructured cell grids if subnode nodes of kind edges are used. */
export interface Edges extends BaseType {
  /** @integer Number of edges. Must be positive. */
  Count: number;
  /** Defines a list of 2 nodes per edge.
   *
   * Count = 2 x EdgeCount */
  NodesPerEdge: AbstractIntegerArray;
}

/** Indicates the nature of the relationship between 2 or more representations, specifically if they are partially or totally identical. For possible types of relationships, see IdentityKind.
 *
 * Commonly used to identify contacts between representations in model descriptions. May also be used to relate the components of a grid (e.g., pillars) to those of a structural framework. */
export interface ElementIdentity extends BaseType {
  /** Indicates which elements are identical based on their indices in the (sub)representation.
   * If not given, then the selected indexable elements of each of the selected representations are identical at the element by element level.
   *
   * If not given, then all elements are specified to be identical.
   *
   * BUSINESS RULE: Number of identical elements must equal identicalElementCount for each representation. */
  ElementIndices?: AbstractIntegerArray;
  FromTimeIndex?: TimeIndex;
  IdentityKind: IdentityKind;
  IndexableElement: IndexableElements;
  Representation: eml20.DataObjectReference;
  ToTimeIndex?: TimeIndex;
}

/** Index into the indexable elements selected. */
export interface ElementIndices extends BaseType {
  IndexableElement: IndexableElements;
  Indices: AbstractIntegerArray;
}

/** Enumerations of the type of qualifier that applies to a property type to provide additional context about the nature of the property. For example, may include conditions, direction, qualifiers, or statistics. Facets are used in RESQML to provide qualifiers to existing property types, which minimizes the need to create specialized property types. */
export type Facet =
  | "conditions"
  | "direction"
  | "netgross"
  | "qualifier"
  | "statistics"
  | "what";

/** Identifies the characteristic of the throw of a fault interpretation. */
export interface FaultThrow extends BaseType {
  HasOccuredDuring?: TimeInterval;
  Throw: ThrowKind[];
}

/** Parameter containing a double value. */
export interface FloatingPointQuantityParameter
  extends AbstractActivityParameter {
  /** Unit of measure associated with the value */
  Uom: ResqmlUom;
  /** Double value */
  Value: number;
}

/** Enumerated values used to indicate a specific type of fluid boundary feature. See attributes below. */
export type FluidContact =
  | "free water contact"
  | "gas oil contact"
  | "gas water contact"
  | "seal"
  | "water oil contact";

/** The various fluid a well marker can indicate. */
export type FluidMarker =
  | "gas down to"
  | "gas up to"
  | "oil down to"
  | "oil up to"
  | "water down to"
  | "water up to";

/** Enumerations used to indicate a specific type of genetic boundary feature. See attributes below. Note that a genetic boundary has a younger side and an older side. */
export type GeneticBoundaryKind = "geobody boundary" | "horizon";

/** The enumerated attributes of a horizon. */
export type Geobody3dShape =
  | "dyke"
  | "silt"
  | "dome"
  | "sheeth"
  | "diapir"
  | "batholith"
  | "channel"
  | "delta"
  | "dune"
  | "fan"
  | "reef"
  | "wedge";

/** The various geologic boundary a well marker can indicate. */
export type GeologicBoundaryKind = "fault" | "geobody" | "horizon";

export type GeologicUnitComposition =
  | "intrusive clay "
  | "organic"
  | "intrusive mud "
  | "evaporite salt"
  | "evaporite non salt"
  | "sedimentary siliclastic"
  | "carbonate"
  | "magmatic intrusive granitoid"
  | "magmatic intrusive pyroclastic"
  | "magmatic extrusive lava flow"
  | "other chemichal rock"
  | "sedimentary turbidite";

/** Element that lets you index and order rock feature interpretations. For possible ordering criteria, see OrderingCriteria. */
export interface GeologicUnitInterpretationIndex extends BaseType {
  /** @integer An index value associated to an instance of this type interpretation, given a specific ordering criteria. */
  Index: number;
  Unit: eml20.DataObjectReference;
}

/** The enumerated attributes of a horizon. */
export type GeologicUnitMaterialImplacement = "autochtonous" | "allochtonous";

/** Used to construct a column layer grid patch based upon multiple unstructured column layer and IJK grids which share a layering scheme.
 *
 * Multiple patches are supported. */
export interface GpGridColumnLayerGrid extends BaseType {
  IjkGridPatch?: GpGridIjkGridPatch[];
  KGaps?: KGaps;
  /** @integer Number of layers. Degenerate case (nk=0) is allowed for GPGrid. */
  Nk: number;
  UnstructuredColumnLayerGridPatch?: GpGridUnstructuredColumnLayerGridPatch[];
}

/** Used to specify IJK grid patch(es) within a general purpose grid.
 *
 * Multiple patches are supported. */
export interface GpGridIjkGridPatch extends Patch {
  Geometry?: IjkGridGeometry;
  /** @integer Count of I indices. Degenerate case (ni=0) is allowed for GPGrid representations. */
  Ni: number;
  /** @integer Count of J indices. Degenerate case (nj=0) is allowed for GPGrid representations. */
  Nj: number;
  /** TRUE if the grid is periodic in J, i.e., has the topology of a complete 360 degree circle.
   *
   * If TRUE, then NJL=NJ. Otherwise, NJL=NJ+1 */
  RadialGridIsComplete?: boolean;
  TruncationCells?: TruncationCellPatch;
}

/** Used to specify unstructured column layer grid patch(es) within a general purpose grid.
 *
 * Multiple patches are supported. */
export interface GpGridUnstructuredColumnLayerGridPatch extends Patch {
  Geometry?: UnstructuredColumnLayerGridGeometry;
  TruncationCells?: TruncationCellPatch;
  /** @integer Number of unstructured columns. Degenerate case (count=0) is allowed for GPGrid. */
  UnstructuredColumnCount: number;
}

/** Used to specify unstructured cell grid patch(es) within a general purpose grid.
 *
 * Multiple patches are supported. */
export interface GpGridUnstructuredGridPatch extends Patch {
  Geometry?: UnstructuredGridGeometry;
  /** @integer Number of unstructured cells. Degenerate case (count=0) is allowed for GPGrid. */
  UnstructuredCellCount: number;
}

/** Patch representing a single 2D grid and its geometry.
 * The FastestAxisCount and the SlowestAxisCount determine the indexing of this grid 2D patch, by defining a one dimensional index for the 2D grid as follows:
 * Index = FastestIndex + FastestAxisCount * SlowestIndex
 *
 * This indexing order IS the data order when stored in HDF5, in which case, this would be a SlowestAxisCount*FastestAxisCount two dimensional array in HDF5. */
export interface Grid2dPatch extends Patch {
  /** @integer The number of nodes in the fastest direction. */
  FastestAxisCount: number;
  Geometry: PointGeometry;
  /** @integer The number of nodes in the slowest direction. */
  SlowestAxisCount: number;
}

/** Indexable grid elements to which point geometry may be attached to describe additional grid geometry. */
export type GridGeometryAttachment =
  | "cells"
  | "edges"
  | "faces"
  | "hinge node faces"
  | "nodes"
  | "radial origin polyline"
  | "subnodes";

/** Element that lets you index and order horizon interpretations. For possible ordering criteria, see OrderingCriteria. */
export interface HorizonInterpretationIndex extends BaseType {
  Horizon: eml20.DataObjectReference;
  /** @integer An index value associated to an instance of this type of interpretation, given a specific ordering criteria */
  Index: number;
  /** @integer Number of the stratigraphic rank on which the previous indices have been defined. */
  StratigraphicRank?: number;
}

/** Defines the infinite geometry of a horizontal plane provided by giving its unique Z value. */
export interface HorizontalPlaneGeometry extends AbstractPlaneGeometry {
  Coordinate: number;
}

/** Enumeration of the identity kinds for the element identities (ElementIdentity). */
export type IdentityKind =
  | "colocation"
  | "previous colocation"
  | "equivalence"
  | "previous equivalence";

/** Optional object used to indicate that adjacent columns of the model are split from each other, which is modeled by introducing additional (split) pillars. */
export interface IjGaps extends BaseType {
  /** List of columns for each of the split pillars. This information is used to infer the grid cell geometry.
   *
   * BUSINESS RULE: The length of the first list-of-lists array must match the splitPillarCount. */
  ColumnsPerSplitPillar?: ResqmlJaggedArray;
  IjSplitColumnEdges?: IjSplitColumnEdges;
  /** Parent pillar index for each of the split pillars. This information is used to infer the grid cell geometry.
   *
   * BUSINESS RULE: Array length must match splitPillarCount. */
  ParentPillarIndices?: AbstractIntegerArray;
  /** @integer Number of split pillars in the model. Count must be positive. */
  SplitPillarCount?: number;
}

/** Explicit geometry definition for the cells of the IJK grid.
 *
 * Grid options are also defined through this object. */
export interface IjkGridGeometry extends AbstractColumnLayerGridGeometry {
  /** Indicates that the IJK grid is right handed, as determined by the triple product of tangent vectors in the I, J, and K directions. */
  GridIsRighthanded: boolean;
  IjGaps?: IjGaps;
}

/** Indexable elements for IJK grids and patches. */
export type IjkIndexableElements =
  | "cells"
  | "column edges"
  | "columns"
  | "coordinate lines"
  | "edges"
  | "edges per column"
  | "faces"
  | "faces per cell"
  | "hinge node faces"
  | "interval edges"
  | "intervals"
  | "I0"
  | "I0 edges"
  | "J0"
  | "J0 edges"
  | "layers"
  | "nodes"
  | "nodes per cell"
  | "nodes per edge"
  | "nodes per face"
  | "pillars"
  | "radial origin polyline"
  | "subnodes";

/** Parent window for any IJK grid. */
export interface IjkParentWindow extends AbstractParentWindow {
  IRegrid: Regrid;
  JRegrid: Regrid;
  KRegrid: Regrid;
  /** List of parent cells that are to be retained at their original resolution and are not to be included within a local grid. The "omit" allows non-rectangular local grids to be specified.
   *
   * 0-based indexing follows NI x NJ x NK relative to the parent window cell count-not to the parent grid. */
  OmitParentCells?: AbstractIntegerArray;
  ParentGrid: eml20.DataObjectReference;
}

/** Used to construct the indices for the cell faces. For IJK grids with IJ gaps, the split column edge indices must be defined explicitly. Otherwise, column edges are not required to describe the lowest order grid geometry, but may be needed for higher order geometries or properties. */
export interface IjSplitColumnEdges extends BaseType {
  /** @integer Number of IJ split column edges in this grid. Must be positive. */
  Count: number;
  /** Definition of the split column edges in terms of the pillars per split column edge. Pillar count per edge is usually 2, but the list-of-lists construction is used to allow split column edges to be defined by more than 2 pillars. */
  PillarsPerSplitColumnEdge: ResqmlJaggedArray;
}

/** Indexable elements for the different representations. The indexing of each element depends upon the specific representation.
 * To order and reference the elements of a representation, RESQML makes extensive use of the concept of indexing. Both one-dimensional and multi-dimensional arrays of elements are used. So that all elements may be referenced in a consistent and uniform fashion, each multi-dimensional index must have a well-defined 1D index.
 *
 * Attributes below identify the IndexableElements, though not all elements apply to all types of representations.
 *
 * Indexable elements are used to:
 *
 * - attach geometry and properties to a representation.
 *
 * - identify portions of a representation when expressing a representation identity.
 *
 * - construct a sub-representation from an existing representation.
 *
 * See the RESQML Overview Guide for the table of indexable elements and the representations to which they apply. */
export type IndexableElements =
  | "cells"
  | "column edges"
  | "columns"
  | "contacts"
  | "coordinate lines"
  | "edges"
  | "edges per column"
  | "enumerated elements"
  | "faces"
  | "faces per cell"
  | "interval edges"
  | "intervals"
  | "I0"
  | "I0 edges"
  | "J0"
  | "J0 edges"
  | "layers"
  | "nodes"
  | "nodes per cell"
  | "nodes per edge"
  | "nodes per face"
  | "patches"
  | "pillars"
  | "regions"
  | "representation"
  | "subnodes"
  | "triangles";

/** One-dimensional array of integer values obtained from the true elements of the Boolean mask. */
export interface IntegerArrayFromBooleanMaskArray extends AbstractIntegerArray {
  /** Boolean mask. A true element indicates that the index is included on the list of integer values. */
  Mask: AbstractBooleanArray;
  /** @integer Total number of integer elements in the array. This number is different from the number of Boolean mask values used to represent the array. */
  TotalIndexCount: number;
}

/** Represents an array of integer values where all values are identical. This an optimization for which an array of explicit integer values is not required. */
export interface IntegerConstantArray extends AbstractIntegerArray {
  /** @integer Size of the array. */
  Count: number;
  /** @integer Values inside all the elements of the array. */
  Value: number;
}

/** Array of integer values provided explicitly by a HDF5 dataset. The null value is explicitly provided. */
export interface IntegerHdf5Array extends AbstractIntegerArray {
  /** @integer Null value */
  NullValue: number;
  /** Reference to an HDF5 array of integers or doubles. */
  Values: eml20.Hdf5Dataset;
}

/** Represents an array of integers based on an origin and a multi-dimensional offset. The offset is based on a linearization of a multi-dimensional offset.
 *
 * If count(i) is the number of elements in the dimension i and offset(i) is the offset in the dimension i, then:
 * globalOffsetInNDimension = startValue+ ni*offset(n) + n_1i*count(n)*offset(n-1) + .... + 0i*count(n)*count(n-1)*....count(1)*offset(0) */
export interface IntegerLatticeArray extends AbstractIntegerArray {
  Offset: IntegerConstantArray[];
  /** @integer Value representing the global start for the lattice:
   * i.e., iStart + jStart*ni + kStart*ni*nj */
  StartValue: number;
}

/** Parameter containing an integer value. */
export interface IntegerQuantityParameter extends AbstractActivityParameter {
  /** @integer Integer value */
  Value: number;
}

/** Defines an array as a range of integers. The range is defined by an initial value and a count defining the size of the range. */
export interface IntegerRangeArray extends AbstractIntegerArray {
  /** @integer Size of the array. */
  Count: number;
  /** @integer Start value for the range.
   * End value is start+count-1. */
  Value: number;
}

/** Specifies the (Grid,Cell) intersection of each Interval of the representation, if any.
 *
 * The information allows you to locate, on one or several grids, the intersection of volume (cells) and surface (faces) elements with a wellbore trajectory (existing or planned), streamline trajectories, or any polyline set. */
export interface IntervalGridCells extends BaseType {
  /** @integer The number of non-null entries in the grid indices array. */
  CellCount: number;
  /** The cell index for each interval of a representation. The grid index is specified by grid index array, to give the (Grid,Cell) index pair.
   *
   * BUSINESS RULE: Array length must equal cell count. */
  CellIndices: AbstractIntegerArray;
  /** Size of array = IntervalCount.
   * Null values of -1 signify that that interval is not within a grid.
   * BUSINESS RULE: The cell count must equal the number of non-null entries in this array. */
  GridIndices: AbstractIntegerArray;
  Grids: eml20.DataObjectReference[];
  /** For each cell, these are the entry and exit intersection faces of the trajectory in the cell. Use null (-1) for missing intersections, e.g., when a trajectory originates or terminates within a cell. The local face-per-cell index is used because a global face index need not have been defined on the grid.
   *
   * BUSINESS RULE: The array dimensions must equal 2 x CellCount. */
  LocalFacePairPerCellIndices: AbstractIntegerArray;
}

/** Refinement and/or Coarsening per interval.
 *
 * If there is a 1:1 correspondence between the parent and child cells, then this object is not needed. */
export interface Intervals extends BaseType {
  /** Weights that are proportional to the relative sizes of child cells within each interval. The weights need not be normalized. */
  ChildCellWeights?: AbstractDoubleArray;
  /** The number of child cells in each interval.
   *
   * If the child grid type is not commensurate with the parent type, then this attribute is ignored by a reader, and its value should be set to null (-1). For example, for a parent IJK grid with a child unstructured column layer grid, then the child count is non-null for a K regrid, but null for an I or J regrid.
   *
   * BUSINESS RULES:
   * 1.) The array length must be equal to intervalCount.
   * 2.) If the child grid type is commensurate with the parent grid, then the sum of values over all intervals must be equal to the corresponding child grid dimension. */
  ChildCountPerInterval: AbstractIntegerArray;
  /** @integer The number of intervals in the regrid description. Must be positive. */
  IntervalCount: number;
  /** The number of parent cells in each interval.
   *
   * BUSINESS RULES:
   * 1.) The array length must be equal to intervalCount.
   * 2.) For the given parentIndex, the total count of parent cells should not extend beyond the boundary of the parent grid. */
  ParentCountPerInterval: AbstractIntegerArray;
}

/** A mapping from intervals to stratigraphic units for representations (grids or wellbore frames). */
export interface IntervalStratigraphicUnits extends BaseType {
  StratigraphicOrganization: eml20.DataObjectReference;
  /** Index of the stratigraphic unit per interval, of a given stratigraphic column.
   *
   * Notes:
   * 1.) For grids, intervals = layers + K gaps.
   * 2.) If there is no stratigraphic column, e.g., within salt, use null (-1)
   *
   * BUSINESS RULE: Array length must equal the number of INTERVALS. */
  UnitIndices: AbstractIntegerArray;
}

/** Enumeration used to specify if the direction of the coordinate lines is uniquely defined for a grid. If not uniquely defined, e.g., for over-turned reservoirs, then indicate that the K direction is not monotonic. */
export type KDirection = "down" | "up" | "not monotonic";

/** Optional object used to indicate that there are global gaps between layers in the grid. With K gaps, the bottom of one layer need not be continuous with the top of the next layer, so the resulting number of intervals is greater than the number of layers. */
export interface KGaps extends BaseType {
  /** @integer Number of gaps between layers. Must be positive.
   *
   * Number of INTERVALS = gapCount + NK. */
  Count?: number;
  /** Boolean array of length NK-1. TRUE if there is a gap after the corresponding layer.
   *
   * NKL = NK + gapCount + 1
   *
   * BUSINESS RULE: gapCount must be consistent with the number of gaps specified by the gapAfterLayer array. */
  GapAfterLayer?: AbstractBooleanArray;
}

/** Indicates the various roles that a polyline topology can have in a representation. */
export type LineRole =
  | "fault center line"
  | "pick"
  | "inner ring"
  | "outer ring"
  | "trajectory"
  | "interpretation line"
  | "contact"
  | "depositional line"
  | "erosion line"
  | "contouring"
  | "pillar";

export interface LocalPropertyKind extends AbstractPropertyKind {
  LocalPropertyKind: eml20.DataObjectReference;
}

/** Different types of measured depths. */
export type MdDomain = "driller" | "logger";

/** Reference location for the measured depth datum (MdDatum).
 *
 * The type of local or permanent reference datum for vertical gravity based (i.e., elevation and vertical depth) and measured depth coordinates within the context of a well. This list includes local points (e.g., kelly bushing) used as a datum and vertical reference datums (e.g., mean sea level). */
export type MdReference =
  | "ground level"
  | "kelly bushing"
  | "mean sea level"
  | "derrick floor"
  | "casing flange"
  | "arbitrary point"
  | "crown valve"
  | "rotary bushing"
  | "rotary table"
  | "sea floor"
  | "lowest astronomical tide"
  | "mean higher high water"
  | "mean high water"
  | "mean lower low water"
  | "mean low water"
  | "mean tide level"
  | "kickoff point";

/** Describes multiple interface contacts of geologic feature interpretations (compared to a binary contact). A composition of several contact interpretations. */
export interface MultipleContactInterpretationPart
  extends AbstractContactInterpretationPart {
  /** @integer Indicates a list of binary contacts (by their UUIDs) that participate in this multiple contact. */
  With: number[];
}

/** Complementary optional metadata information, which may be added to any data-object to qualify it. */
export interface NameValuePair extends BaseType {
  /** Name of the metadata information. */
  Name: string;
  /** Value of the metadata information. */
  Value: string;
}

/** Patch representing a list of nodes to which geometry may be attached. */
export interface NodePatch extends Patch1d {
  Geometry: PointGeometry;
}

/** Optional component of Unstructured Cell Finite Elements.
 *
 * The choice of node order per cell is important for effective use of the RESQML finite element representations. If you are working with an application with a particular node ordering per cell, be sure to specify the nodes in that order here, for ease of use.
 *
 * BUSINESS RULE: If cell subnodes are used for unstructured grids, then nodes per cell must be defined. */
export interface NodesPerCell extends BaseType {
  /** Defines an ordered list of nodes per cell. */
  NodesPerCell: ResqmlJaggedArray;
}

/** Defines a nonsealed contact representation, meaning that this contact representation is defined by a geometry. */
export interface NonSealedContactRepresentationPart
  extends AbstractContactRepresentationPart {
  Contact?: ContactPatch[];
  Geometry: AbstractGeometry;
}

/** Instance of a given activity */
export interface obj_Activity extends AbstractResqmlDataObject {
  ActivityDescriptor: eml20.DataObjectReference;
  Parameter: AbstractActivityParameter[];
  Parent?: eml20.DataObjectReference;
  $type: "resqml20.obj_Activity";
}

/** Description of one type of activity. */
export interface obj_ActivityTemplate extends AbstractResqmlDataObject {
  Parameter: ParameterTemplate[];
  $type: "resqml20.obj_ActivityTemplate";
}

/** The information that allows you to locate, on one or several grids (existing or planned), the intersection of volume (cells) and surface (faces) elements with a wellbore trajectory (existing or planned). */
export interface obj_BlockedWellboreRepresentation
  extends obj_WellboreFrameRepresentation {
  /** @integer The number of non-null entries in the grid indices array. */
  CellCount: number;
  /** The grid cell index for each blocked well cell.
   * BUSINESS RULE: Array length must equal cell count. */
  CellIndices: AbstractIntegerArray;
  Grid: eml20.DataObjectReference[];
  /** Size of array = IntervalCount.
   * Null values of -1 signify that that interval is not within a grid.
   * BUSINESS RULE: The cell count must equal the number of non-null entries in this array. */
  GridIndices: AbstractIntegerArray;
  /** For each cell, these are the entry and exit faces of the trajectory. Use null (-1), for instance, at TD when there only one intersection. The local face-per-cell index is used because a global face index need not have been defined on the grid.
   *
   * BUSINESS RULE: The array dimensions must equal 2 x CellCount. */
  LocalFacePairPerCellIndices: AbstractIntegerArray;
  $type: "resqml20.obj_BlockedWellboreRepresentation";
}

/** An interface between two geological objects, such as horizons and faults. It is a surface object. */
export interface obj_BoundaryFeature extends AbstractGeologicFeature {
  $type:
  | "resqml20.obj_BoundaryFeature"
  | "resqml20.obj_FluidBoundaryFeature"
  | "resqml20.obj_GeneticBoundaryFeature"
  | "resqml20.obj_TectonicBoundaryFeature";
}

/** The main class for data describing an opinion of a surface feature between two volumes.
 *
 * BUSINESS RULE: The data-object reference (of type "interprets") must reference only a boundary feature. */
export interface obj_BoundaryFeatureInterpretation
  extends AbstractFeatureInterpretation {
  $type:
  | "resqml20.obj_BoundaryFeatureInterpretation"
  | "resqml20.obj_FaultInterpretation"
  | "resqml20.obj_HorizonInterpretation"
  | "resqml20.obj_GeobodyBoundaryInterpretation";
}

/** Information specific to one categorical property. Contains discrete integer.
 * This type of property is associated either as:
 *
 * - an internally stored index to a string through a lookup mapping.
 * - an internally stored double to another double value through an explicitly provided table. */
export interface obj_CategoricalProperty extends AbstractValuesProperty {
  Lookup: eml20.DataObjectReference;
  $type:
  | "resqml20.obj_CategoricalProperty"
  | "resqml20.obj_CategoricalPropertySeries";
}

/** Information specific to one comment property.
 * Used to capture comments or annotations associated with a given element type in a data-object, for example, associating comments on the specific location of a well path. */
export interface obj_CategoricalPropertySeries extends obj_CategoricalProperty {
  /** Provide the list of indices corresponding to realizations number. For example, if a user wants to send the realization corresponding to p10, p20, ... he would write the array 10, 20, ...
   * If not provided, then the realization count (which could be 1) does not introduce a dimension to the multi-dimensional array storage. */
  RealizationIndices?: AbstractIntegerArray;
  SeriesTimeIndices?: TimeIndices;
  $type: "resqml20.obj_CategoricalPropertySeries";
}

/** Information specific to one comment property.
 * Used to capture comments or annotations associated with a given element type in a data-object, for example, associating comments on the specific location of a well path. */
export interface obj_CommentProperty extends AbstractValuesProperty {
  /** Identify the language (e.g., US English or French) of the string. It is recommended that language names conform to ISO 639. */
  Language?: string;
  $type: "resqml20.obj_CommentProperty" | "resqml20.obj_CommentPropertySeries";
}

/** Information specific to one comment property.
 * Used to capture comments or annotations associated with a given element type in a data-object, for example, associating comments on the specific location of a well path. */
export interface obj_CommentPropertySeries extends obj_CommentProperty {
  /** Provide the list of indices corresponding to realizations number. For example, if a user wants to send the realization corresponding to p10, p20, ... he would write the array 10, 20, ...
   * If not provided, then the realization count (which could be 1) does not introduce a dimension to the multi-dimensional array storage. */
  RealizationIndices?: AbstractIntegerArray;
  SeriesTimeIndices?: TimeIndices;
  $type: "resqml20.obj_CommentPropertySeries";
}

/** Most common type of property used for storing rock or fluid attributes; all are represented as doubles.
 * So that the value range can be known before accessing all values, the min and max values of the range are also stored.
 * BUSINESS RULE: It also contains a unit of measure that can be different from the unit of measure of its property type, but it must be convertible into this unit. */
export interface obj_ContinuousProperty extends AbstractValuesProperty {
  /** The maximum of the associated property values.
   * BUSINESS RULE: There can be only one value per number of elements. */
  MaximumValue?: number[];
  /** The minimum of the associated property values.
   * BUSINESS RULE: There can be only one value per number of elements. */
  MinimumValue?: number[];
  /** Unit of measure for the property. */
  UOM: ResqmlUom;
  $type:
  | "resqml20.obj_ContinuousProperty"
  | "resqml20.obj_ContinuousPropertySeries";
}

/** Information specific to one comment property.
 * Used to capture comments or annotations associated with a given element type in a data-object, for example, associating comments on the specific location of a well path. */
export interface obj_ContinuousPropertySeries extends obj_ContinuousProperty {
  /** Provide the list of indices corresponding to realizations number. For example, if a user wants to send the realization corresponding to p10, p20, ... he would write the array 10, 20, ...
   * If not provided, then the realization count (which could be 1) does not introduce a dimension to the multi-dimensional array storage. */
  RealizationIndices?: AbstractIntegerArray;
  SeriesTimeIndices?: TimeIndices;
  $type: "resqml20.obj_ContinuousPropertySeries";
}

/** Specifies the station data from a deviation survey.
 *
 * The deviation survey does not provide a complete specification of the geometry of a wellbore trajectory. Although a minimum-curvature algorithm is used in most cases, the implementation varies sufficiently that no single algorithmic specification is available as a data transfer standard.
 *
 * Instead, the geometry of a RESQML wellbore trajectory is represented by a parametric line, parameterized by the MD.
 *
 * CRS and units of measure do not need to be consistent with the CRS and units of measure for wellbore trajectory representation. */
export interface obj_DeviationSurveyRepresentation
  extends AbstractRepresentation {
  /** Defines the units of measure for the azimuth and inclination */
  AngleUom: eml20.PlaneAngleUom;
  /** An array of azimuth angles, one for each survey station. The rotation is relative to the ProjectedCrs north with a positive value indication a clockwise rotation as seen from above.
   *
   * If the local CRS - whether a LocalTime3dCrs or a LocalDepth3dCrs - is rotated relative to the ProjectedCrs, the azimuths remain relative to the ProjectedCrs not the local CRS.
   *
   * Note that the projection’s north is not the same as true north or magnetic north. A good definition of the different kinds of “north” can be found in the OGP Surveying & Positioning Guidance Note 1 http://www.ogp.org.uk/pubs/373-01.pdf (the "True, Grid and Magnetic North bearings" paragraph).
   *
   * BUSINESS RULE: Array length equals station count */
  Azimuths: AbstractDoubleArray;
  /** XYZ location of the first station of the deviation survey. */
  FirstStationLocation: Point3d;
  /** Dip (or inclination) angle for each station.
   *
   * BUSINESS RULE: Array length equals station count */
  Inclinations: AbstractDoubleArray;
  /** Used to indicate that this is a final version of the deviation survey, as distinct from the interim interpretations. */
  IsFinal: boolean;
  MdDatum: eml20.DataObjectReference;
  /** MD values for the position of the stations
   *
   * BUSINESS RULE: Array length equals station count */
  Mds: AbstractDoubleArray;
  /** Units of Measure of the measured depths along this deviation survey. */
  MdUom: eml20.LengthUom;
  /** @integer Number of Stations */
  StationCount: number;
  TimeIndex?: TimeIndex;
  WitsmlDeviationSurvey?: eml20.DataObjectReference;
  $type: "resqml20.obj_DeviationSurveyRepresentation";
}

/** Contains discrete integer values; typically used to store any type of index.
 * So that the value range can be known before accessing all values, it also stores the minimum and maximum value in the range. */
export interface obj_DiscreteProperty extends AbstractValuesProperty {
  /** @integer The maximum of the associated property values.
   * BUSINESS RULE: There can only be one value per number of elements. */
  MaximumValue?: number[];
  /** @integer The minimum of the associated property values.
   * BUSINESS RULE: There can only be one value per number of elements. */
  MinimumValue?: number[];
  $type:
  | "resqml20.obj_DiscreteProperty"
  | "resqml20.obj_DiscretePropertySeries";
}

/** Information specific to one comment property.
 * Used to capture comments or annotations associated with a given element type in a data-object, for example, associating comments on the specific location of a well path. */
export interface obj_DiscretePropertySeries extends obj_DiscreteProperty {
  /** Provide the list of indices corresponding to realizations number. For example, if a user wants to send the realization corresponding to p10, p20, ... he would write the array 10, 20, ...
   * If not provided, then the realization count (which could be 1) does not introduce a dimension to the multi-dimensional array storage. */
  RealizationIndices?: AbstractIntegerArray;
  SeriesTimeIndices?: TimeIndices;
  $type: "resqml20.obj_DiscretePropertySeries";
}

/** Defines a function for table lookups. For example, used for linear interpolation, such as PVT.
 * Used for categorical property, which also may use StringTableLookup. */
export interface obj_DoubleTableLookup extends AbstractPropertyLookup {
  Value: DoubleLookup[];
  $type: "resqml20.obj_DoubleTableLookup";
}

/** An earth model interpretation has a specific role: it gathers a maximum of one of each of these other organization interpretations: structural organization interpretation, stratigraphic organization interpretation, and/or fluid organization interpretation.
 *
 * BUSINESS RULE: An earth model Interpretation interprets only an earth model feature. */
export interface obj_EarthModelInterpretation
  extends AbstractFeatureInterpretation {
  Fluid?: eml20.DataObjectReference;
  StratigraphicColumn?: eml20.DataObjectReference;
  StratigraphicOccurrences?: eml20.DataObjectReference[];
  Structure?: eml20.DataObjectReference;
  $type: "resqml20.obj_EarthModelInterpretation";
}

/** A type of boundary feature, this class contains the data describing an opinion about the characterization of the fault, which includes the attributes listed below. */
export interface obj_FaultInterpretation
  extends obj_BoundaryFeatureInterpretation {
  /** Indicates if the normal fault is listric or not.
   * BUSINESS RULE: Must be present if the fault is normal. Must not be present if the fault is not normal. */
  IsListric?: boolean;
  MaximumThrow?: eml20.LengthMeasure;
  MeanAzimuth?: eml20.PlaneAngleMeasure;
  MeanDip?: eml20.PlaneAngleMeasure;
  ThrowInterpretation?: FaultThrow[];
  $type: "resqml20.obj_FaultInterpretation";
}

/** A boundary (usually a plane) separating two fluid phases, such as a gas-oil contact (GOC), a water-oil contact (WOC), a gas-oil contact (GOC), or others. For types, see FluidContact. */
export interface obj_FluidBoundaryFeature extends obj_BoundaryFeature {
  FluidContact: FluidContact;
  $type: "resqml20.obj_FluidBoundaryFeature";
}

/** Identifies a frontier or boundary in the earth model that is not a geological feature but an arbitrary geographic/geometric surface used to delineate the boundary of the model. */
export interface obj_FrontierFeature extends AbstractTechnicalFeature {
  $type: "resqml20.obj_FrontierFeature";
}

export interface obj_GenericFeatureInterpretation
  extends AbstractFeatureInterpretation {
  $type: "resqml20.obj_GenericFeatureInterpretation";
}

/** A boundary between two units produced by a contrast between two deposits that occurred at two different geologic time periods. For types, see GeneticBoundaryKind. */
export interface obj_GeneticBoundaryFeature extends obj_BoundaryFeature {
  AbsoluteAge?: Timestamp;
  GeneticBoundaryKind: GeneticBoundaryKind;
  $type: "resqml20.obj_GeneticBoundaryFeature";
}

/** A type of boundary feature, this class identifies if the boundary is a geobody and the type of the boundary. */
export interface obj_GeobodyBoundaryInterpretation
  extends obj_BoundaryFeatureInterpretation {
  BoundaryRelation?: BoundaryRelation[];
  $type: "resqml20.obj_GeobodyBoundaryInterpretation";
}

/** A volume of rock that is identified based on some specific attribute, like its mineral content or other physical characteristic. Unlike stratigraphic or phase units, there is no associated time or fluid content semantic. For types, see GeobodyKind. */
export interface obj_GeobodyFeature extends obj_GeologicUnitFeature { }

/** A type of rock feature, this class identifies if a rock feature is a geobody with any qualifications on the interpretation of the geobody. */
export interface obj_GeobodyInterpretation
  extends obj_GeologicUnitInterpretation {
  Geobody3dShape?: Geobody3dShape;
  $type: "resqml20.obj_GeobodyInterpretation";
}

/** A volume of rock located between one or more boundary features.  The limiting boundary features should be genetic boundary features (i.e. should not be faults). */
export interface obj_GeologicUnitFeature extends AbstractGeologicFeature {
  $type:
  | "resqml20.obj_GeologicUnitFeature"
  | "resqml20.obj_RockFluidUnitFeature"
  | "resqml20.obj_StratigraphicUnitFeature";
}

/** The main class for data describing an opinion of a volume-based geologic feature or unit. */
export interface obj_GeologicUnitInterpretation
  extends AbstractFeatureInterpretation {
  GeologicUnitComposition?: GeologicUnitComposition;
  GeologicUnitMaterialImplacement?: GeologicUnitMaterialImplacement;
  $type:
  | "resqml20.obj_GeologicUnitInterpretation"
  | "resqml20.obj_StratigraphicUnitInterpretation"
  | "resqml20.obj_RockFluidUnitInterpretation"
  | "resqml20.obj_GeobodyInterpretation";
}

/** Chronological successions of some chronostratigraphic units organized into 1 to n chronological ranks. */
export interface obj_GlobalChronostratigraphicColumn
  extends AbstractResqmlDataObject {
  ChronostratigraphicColumnComponent: ChronostratigraphicRank[];
  $type: "resqml20.obj_GlobalChronostratigraphicColumn";
}

/** General purpose (GP) grid representation, which includes and/or extends the features from all other grid representations. This general purpose representation is included in the schema for research and/or advanced modeling purposes, but is not expected to be used for routine data transfer. */
export interface obj_GpGridRepresentation extends AbstractGridRepresentation {
  ColumnLayerGrid?: GpGridColumnLayerGrid[];
  UnstructuredGridPatch?: GpGridUnstructuredGridPatch[];
  $type: "resqml20.obj_GpGridRepresentation";
}

/** Representation based on a 2D grid. For definitions of slowest and fastest axes of the array, see Grid2dPatch. */
export interface obj_Grid2dRepresentation
  extends AbstractSurfaceRepresentation {
  Grid2dPatch: Grid2dPatch;
  $type: "resqml20.obj_Grid2dRepresentation";
}

/** Set of representations based on a 2D grid. Each 2D grid representation corresponds to one patch of the set. */
export interface obj_Grid2dSetRepresentation
  extends AbstractSurfaceRepresentation {
  Grid2dPatch: Grid2dPatch[];
  $type: "resqml20.obj_Grid2dSetRepresentation";
}

/** Representation which consists of a list of connections between grid cells, potentially on different grids.
 *
 * Connections are in the form of (Grid,Cell,Face)1<=>(Grid,Cell,Face)2 and are stored as three integer pair arrays corresponding to these six elements.
 *
 * Grid connection sets are the preferred means of representing faults on a grid. The use of cell-face-pairs is more complete than single cell-faces, which are missing a corresponding cell face entry, and only provide an incomplete representation of the topology of a fault.
 *
 * Unlike what is sometimes the case in reservoir simulation software, RESQML does not distinguish between standard and non-standard connections.
 * Within RESQML if a grid connection corresponds to a "nearest neighbor" as defined by the cell indices, then it is never additive to the implicit nearest neighbor connection.
 *
 * BUSINESS RULE: A single cell-face-pair should not appear within more than a single grid connection set. This rule is designed to simplify the interpretation of properties assigned to multiple grid connection sets, which might otherwise have the same property defined more than once on a single connection, with no clear means of resolving the multiple values. */
export interface obj_GridConnectionSetRepresentation
  extends AbstractRepresentation {
  /** 2 x #Connections array of cell indices for (Cell1,Cell2) for each connection. */
  CellIndexPairs: AbstractIntegerArray;
  ConnectionInterpretations?: ConnectionInterpretations;
  /** @integer count of connections. Must be positive. */
  Count: number;
  Grid: eml20.DataObjectReference[];
  /** 2 x #Connections array of grid indices for (Cell1,Cell2) for each connection. The grid indices are obtained from the grid index pairs.
   *
   * If only a single grid is referenced from the grid index, then this array need not be used.
   *
   * BUSINESS RULE: This array should appear if more than one grid index pair is referenced. */
  GridIndexPairs?: AbstractIntegerArray;
  /** Optional 2 x #Connections array of local face per cell indices for (Cell1,Cell2) for each connection. Local face per cell indices are used because global face indices need not have been defined. Null value = -1.
   *
   * If no face per cell definition occur as part of the grid representation, e.g., for a block centered grid, then this array need not appear. */
  LocalFacePerCellIndexPairs?: AbstractIntegerArray;
  $type: "resqml20.obj_GridConnectionSetRepresentation";
}

/** A type of boundary feature, the class specifies if the boundary feature is a horizon.
 *
 * Maximum Flooding Surface
 *
 * - Transgressive Surface ( for erosion or intrusion ?)
 * - Sequence Boundary
 *
 * - Stratigraphic Limit */
export interface obj_HorizonInterpretation
  extends obj_BoundaryFeatureInterpretation {
  BoundaryRelation?: BoundaryRelation[];
  SequenceStratigraphySurface?: SequenceStratigraphySurface;
  $type: "resqml20.obj_HorizonInterpretation";
}

/** Grid whose topology is characterized by structured column indices (I,J) and a layer index, K.
 *
 * Cell geometry is characterized by nodes on coordinate lines, where each column of the model has 4 sides. Geometric degeneracy is permitted.
 *
 * IJK grids support the following specific extensions:
 * IJK radial grids
 * K-Layer gaps
 * IJ-Column gaps */
export interface obj_IjkGridRepresentation
  extends AbstractColumnLayerGridRepresentation {
  Geometry?: IjkGridGeometry;
  KGaps?: KGaps;
  /** @integer Count of cells in the I-direction in the grid. Must be positive. I=1,...,NI, I0=0,...,NI-1. */
  Ni: number;
  /** @integer Count of cells in the J-direction in the grid. Must be positive. J=1,...,NJ, J0=0,...,NJ-1. */
  Nj: number;
  /** TRUE if the grid is periodic in J, i.e., has the topology of a complete 360 degree circle.
   *
   * If TRUE, then NJL=NJ. Otherwise, NJL=NJ+1
   *
   * May be used to change the grid topology for either a cartesian or a radial grid, although radial grid usage is by far the more common. */
  RadialGridIsComplete?: boolean;
  $type: "resqml20.obj_IjkGridRepresentation";
}

/** Defines a local depth coordinate system, the geometrical origin and location is defined by the elements of the base class AbstractLocal3dCRS. This CRS uses the units of measure of its projected and vertical CRS. */
export interface obj_LocalDepth3dCrs extends AbstractLocal3dCrs {
  $type: "resqml20.obj_LocalDepth3dCrs";
}

/** Used to activate and/or deactivate the specified children grids as local grids on their parents. Once activated, this object indicates that a child grid replaces local portions of the corresponding parent grid. Parentage is inferred from the child grid construction. Without a grid set activation, the local grids are always active. Otherwise, the grid set activation is used to activate and/or deactivate the local grids in the set at specific times. */
export interface obj_LocalGridSet extends AbstractResqmlDataObject {
  Activation?: Activation;
  ChildGrid: eml20.DataObjectReference[];
  $type: "resqml20.obj_LocalGridSet";
}

/** Defines a local time coordinate system, the geometrical origin and location is defined by the elements of the base class AbstractLocal3dCRS. This CRS defines the time unit that the time-based geometries that refers it will use. */
export interface obj_LocalTime3dCrs extends AbstractLocal3dCrs {
  /** Defines the unit of measure of the third (time) coordinates, for the geometries that refers to it. */
  TimeUom: eml20.TimeUom;
  $type: "resqml20.obj_LocalTime3dCrs";
}

/** Specifies the location of the measured depth = 0 reference point.
 *
 * The location of this reference point is defined with respect to a CRS, which need not be the same as the CRS of a wellbore trajectory representation, which may reference this location. */
export interface obj_MdDatum extends AbstractResqmlDataObject {
  LocalCrs: eml20.DataObjectReference;
  /** The location of the md reference point relative to a local CRS. */
  Location: Point3d;
  MdReference: MdReference;
  $type: "resqml20.obj_MdDatum";
}

/** A collection of contact representations parts, which are a list of contact patches with no identity. This collection of contact representations is completed by a set of representations gathered at the representation set representation level. */
export interface obj_NonSealedSurfaceFrameworkRepresentation
  extends AbstractSurfaceFrameworkRepresentation {
  NonSealedContactRepresentation?: AbstractContactRepresentationPart[];
  $type: "resqml20.obj_NonSealedSurfaceFrameworkRepresentation";
}

/** The explicit description of the relationships between geologic features, such as rock features (e.g., stratigraphic units, geobodies, phase unit) and boundary features (e.g., genetic, tectonic, and fluid boundaries). For types of organizations, see OrganizationKind. */
export interface obj_OrganizationFeature extends AbstractGeologicFeature {
  OrganizationKind: OrganizationKind;
  $type: "resqml20.obj_OrganizationFeature";
}

/** Defines a plane representation, which can be made up of multiple patches. Commonly represented features are fluid contacts or frontiers. Common geometries of this representation are titled or horizontal planes.
 *
 * BUSINESS RULE: If the plane representation is made up of multiple patches, then you must specify the outer rings for each plane patch. */
export interface obj_PlaneSetRepresentation
  extends AbstractSurfaceRepresentation {
  Planes: AbstractPlaneGeometry[];
  $type: "resqml20.obj_PlaneSetRepresentation";
}

/** A representation that consists of one or more node patches. Each node patch is an array of XYZ coordinates for the 3D points. There is no implied linkage between the multiple patches. */
export interface obj_PointSetRepresentation extends AbstractRepresentation {
  NodePatch: NodePatch[];
  $type: "resqml20.obj_PointSetRepresentation";
}

/** Represents the geometric information that should *not* be used as representation geometry, but should be used in another context where the location or geometrical vectorial distances are needed. */
export interface obj_PointsProperty extends AbstractProperty {
  PatchOfPoints: PatchOfPoints[];
  $type: "resqml20.obj_PointsProperty";
}

/** A representation made up of a single polyline or "polygonal chain", which may be closed or not.
 *
 * Definition from Wikipedia (http://en.wikipedia.org/wiki/Piecewise_linear_curve):
 *
 * A polygonal chain, polygonal curve, polygonal path, or piecewise linear curve, is a connected series of line segments. More formally, a polygonal chain P is a curve specified by a sequence of points \scriptstyle(A_1, A_2, \dots, A_n) called its vertices so that the curve consists of the line segments connecting the consecutive vertices.
 *
 * In computer graphics a polygonal chain is called a polyline and is often used to approximate curved paths.
 *
 * BUSINESS RULE: To record a polyline the writer software must give the values of the geometry of each node in an order corresponding to the logical series of segments (edges). The geometry of a polyline must be a 1D array of points.
 *
 * A simple polygonal chain is one in which only consecutive (or the first and the last) segments intersect and only at their endpoints.
 *
 * A closed polygonal chain (isClosed=True) is one in which the first vertex coincides with the last one, or the first and the last vertices are connected by a line segment. */
export interface obj_PolylineRepresentation extends AbstractRepresentation {
  IsClosed: boolean;
  LineRole?: LineRole;
  NodePatch: NodePatch;
  $type: "resqml20.obj_PolylineRepresentation";
}

/** A representation made up of a set of polylines or a set of polygonal chains (for more information, see PolylineRepresentation).
 *
 * For compactness, it is organized by line patch as a unique polyline set patch.
 *
 * if allPolylineClosed = True, all the polylines are connected between the first and the last point.
 *
 * Its geometry is a 1D array of points, corresponding to the concatenation of the points of all polyline points. */
export interface obj_PolylineSetRepresentation extends AbstractRepresentation {
  LinePatch: PolylineSetPatch[];
  LineRole?: LineRole;
  $type: "resqml20.obj_PolylineSetRepresentation";
}

/** A description of a property name relative to a standard definition. For example, you may specify if the property kind is abstract, the dictionary in which the property is unique, and the representative unit of measure. */
export interface obj_PropertyKind extends AbstractResqmlDataObject {
  /** A value of true indicates that the property kind is abstract and an instance of property values must not represent this kind.
   * A value of false indicates otherwise (i.e., that an instance of property values may represent this kind). */
  IsAbstract: boolean;
  /** The name of the dictionary within which the property is unique. This also defines the name of the controlling authority.
   * Use a URN of the form "urn:x-resqml:domainOrEmail:dictionaryName".
   * An example public dictionary: "urn:resqml:energistics.org:RESQML" assigned to values defined by ResqmlPropertyKind.
   * An example corporate dictionary: "urn:resqml:slb.com:product-x".
   * An example personal dictionary: "urn:resqml:first.last@mycompany.com:my.first.dictionary". The purpose of this scheme is to generate a unique name. Parsing for semantics is not intended. */
  NamingSystem: string;
  ParentPropertyKind: AbstractPropertyKind;
  /** Generally matches the base for conversion, except where multiple classes have the same underlying dimensional analysis. In this case, the representative unit may provide additional information about the underlying concept of the class. For example, “area per volume” has the same dimensional analysis as “per length”, but it specifies a representative unit of “m2/m3” instead of “1/m”. */
  RepresentativeUom: ResqmlUom;
  $type: "resqml20.obj_PropertyKind";
}

/** A set of properties collected together for a specific purpose. For example, a property set can be used to collect all the properties corresponding to the simulation output at a single time, or all the values of a single property type for all times. */
export interface obj_PropertySet extends AbstractResqmlDataObject {
  /** If true, indicates that the collection contains properties with defined realization indices. */
  HasMultipleRealizations: boolean;
  /** If true, indicates that the collection contains only property values associated with a single property kind. */
  HasSinglePropertyKind: boolean;
  /** A pointer to the parent property group of this property group. */
  ParentSet?: eml20.DataObjectReference[];
  Properties: eml20.DataObjectReference[];
  TimeSetKind: TimeSetKind;
  $type: "resqml20.obj_PropertySet";
}

/** A representation derived from an existing representation by redefining its geometry. Example use cases include deformation of the geometry of an object, change of coordinate system, and change of time <=> depth. */
export interface obj_RedefinedGeometryRepresentation
  extends AbstractRepresentation {
  PatchOfGeometry: PatchOfGeometry[];
  SupportingRepresentation: eml20.DataObjectReference;
  $type: "resqml20.obj_RedefinedGeometryRepresentation";
}

/** A collection of representation identities. */
export interface obj_RepresentationIdentitySet
  extends AbstractResqmlDataObject {
  RepresentationIdentity: RepresentationIdentity[];
  $type: "resqml20.obj_RepresentationIdentitySet";
}

/** The parent class of the framework representations. It is used to group together individual representations which may be of the same kind to represent a “bag” of representations. If the bag is homogeneous, then this may be indicated.
 *
 * These “bags” do not imply any geologic consistency. For example, you can define a set of wellbore frames, a set of wellbore trajectories, a set of blocked wellbores.
 *
 * Because the framework representations inherit from this class, they inherit the capability to gather individual representations into sealed and non-sealed surface framework representations, or sealed volume framework representations. */
export interface obj_RepresentationSetRepresentation
  extends AbstractRepresentation {
  /** Indicates that all of the selected representations are of a single kind. */
  IsHomogeneous: boolean;
  Representation: eml20.DataObjectReference[];
  $type:
  | "resqml20.obj_RepresentationSetRepresentation"
  | "resqml20.obj_SealedVolumeFrameworkRepresentation"
  | "resqml20.obj_SealedSurfaceFrameworkRepresentation"
  | "resqml20.obj_NonSealedSurfaceFrameworkRepresentation";
}

/** Interpretation of the fluid organization units. */
export interface obj_RockFluidOrganizationInterpretation
  extends AbstractOrganizationInterpretation {
  RockFluidUnitIndex: RockFluidUnitInterpretationIndex;
  $type: "resqml20.obj_RockFluidOrganizationInterpretation";
}

/** A fluid phase plus one or more stratigraphic units. A unit may correspond to a pair of horizons that are not adjacent stratigraphically, e.g., a coarse zonation, and is often used to define the reservoir. For types, see Phase. */
export interface obj_RockFluidUnitFeature extends obj_GeologicUnitFeature {
  FluidBoundaryBottom: eml20.DataObjectReference;
  FluidBoundaryTop: eml20.DataObjectReference;
  Phase: Phase;
  $type: "resqml20.obj_RockFluidUnitFeature";
}

/** A type of rock fluid feature interpretation , this class identifies if a rock fluid feature by its phase */
export interface obj_RockFluidUnitInterpretation
  extends obj_GeologicUnitInterpretation {
  Phase?: Phase;
  $type: "resqml20.obj_RockFluidUnitInterpretation";
}

/** A collection of contact representations parts, which are a list of contact patches and their identities. This collection of contact representations is completed by a set of representations gathered at the representation set representation level. */
export interface obj_SealedSurfaceFrameworkRepresentation
  extends AbstractSurfaceFrameworkRepresentation {
  SealedContactRepresentation?: SealedContactRepresentationPart[];
  $type: "resqml20.obj_SealedSurfaceFrameworkRepresentation";
}

/** A strict boundary representation (BREP), which represents the volume region by assembling together shells.
 *
 * BUSINESS RULE: The sealed structural framework must be part of the same earth model as this sealed volume framework. */
export interface obj_SealedVolumeFrameworkRepresentation
  extends obj_RepresentationSetRepresentation {
  BasedOn: eml20.DataObjectReference;
  Regions: VolumeRegion[];
  Shells: VolumeShell[];
  $type: "resqml20.obj_SealedVolumeFrameworkRepresentation";
}

/** Defined by two lateral ordered dimensions: inline (lateral), crossline (lateral and orthogonal to the inline dimension), which are fixed.
 *
 * To specify its location, a seismic feature can be associated with the seismic coordinates of the points of a representation. */
export interface obj_SeismicLatticeFeature
  extends AbstractSeismicSurveyFeature {
  /** @integer The count of crosslines in the 3D seismic survey. */
  CrosslineCount: number;
  /** @integer The constant index increment between two consecutive crosslines of the 3D seismic survey. */
  CrosslineIndexIncrement: number;
  /** @integer The index of the first crossline of the 3D seismic survey. */
  FirstCrosslineIndex: number;
  /** @integer The index of the first inline of the 3D seismic survey. */
  FirstInlineIndex: number;
  /** @integer The count of inlines in the 3D seismic survey. */
  InlineCount: number;
  /** @integer The constant index increment between two consecutive inlines of the 3D seismic survey. */
  InlineIndexIncrement: number;
  IsPartOf?: SeismicLatticeSetFeature;
  $type: "resqml20.obj_SeismicLatticeFeature";
}

/** Defined by one lateral dimension: trace (lateral). Seismic trace of the 3D seismic survey.
 *
 * To specify its location, the seismic feature can be associated with the seismic coordinates of the points of a representation. */
export interface obj_SeismicLineFeature extends AbstractSeismicSurveyFeature {
  /** @integer The index of the first trace of the seismic line. */
  FirstTraceIndex: number;
  IsPartOf?: eml20.DataObjectReference;
  /** @integer The count of traces in the seismic line. */
  TraceCount: number;
  /** @integer The constant index increment between two consecutive traces. */
  TraceIndexIncrement: number;
  $type: "resqml20.obj_SeismicLineFeature";
}

/** An unordered set of several seismic lines. Generally, it has no direct interpretation or representation. */
export interface obj_SeismicLineSetFeature
  extends AbstractSeismicSurveyFeature {
  $type: "resqml20.obj_SeismicLineSetFeature";
}

/** A global interpretation of the stratigraphy, which can be made up of several ranks of stratigraphic unit interpretations.
 *
 * BUSINESS RULE: All stratigraphic column rank interpretations that make up a stratigraphic column must be ordered by age. */
export interface obj_StratigraphicColumn extends AbstractResqmlDataObject {
  Ranks: eml20.DataObjectReference[];
  $type: "resqml20.obj_StratigraphicColumn";
}

/** A global hierarchy containing an ordered list of stratigraphic unit interpretations. */
export interface obj_StratigraphicColumnRankInterpretation
  extends AbstractStratigraphicOrganizationInterpretation {
  /** @integer Rank */
  Index: number;
  StratigraphicUnits: StratigraphicUnitInterpretationIndex[];
  $type: "resqml20.obj_StratigraphicColumnRankInterpretation";
}

/** A local Interpretation-it could be along a well, on a 2D map, or on a 2D section or on a part of the global volume of an earth model-of a succession of rock feature elements.
 *
 * The stratigraphic column rank interpretation composing a stratigraphic occurrence can be ordered by the criteria listed in OrderingCriteria.
 *
 * BUSINESS RULE: A representation of a stratigraphic occurrence interpretation can be a wellbore marker or a wellbore frame. */
export interface obj_StratigraphicOccurrenceInterpretation
  extends AbstractStratigraphicOrganizationInterpretation {
  GeologicUnitIndex?: GeologicUnitInterpretationIndex[];
  IsOccurrenceOf?: eml20.DataObjectReference;
  $type: "resqml20.obj_StratigraphicOccurrenceInterpretation";
}

/** A stratigraphic unit that can have a well-known (e.g., "Jurassic") chronostratigraphic top and chronostratigraphic bottom. These chronostratigraphic units have no associated interpretations or representations.
 *
 * BUSINESS RULE: The name must reference a well-known chronostratigraphic unit (such as "Jurassic"), for example, from the International Commission on Stratigraphy (http://www.stratigraphy.org). */
export interface obj_StratigraphicUnitFeature extends obj_GeologicUnitFeature {
  ChronostratigraphicBottom?: eml20.DataObjectReference;
  ChronostratigraphicTop?: eml20.DataObjectReference;
  $type: "resqml20.obj_StratigraphicUnitFeature";
}

/** Interpretation of a stratigraphic unit which includes the knowledge of the top, the bottom, the deposition mode. */
export interface obj_StratigraphicUnitInterpretation
  extends obj_GeologicUnitInterpretation {
  /** BUSINESS RULE / The Deposition mode for a Geological Unit MUST be conssitent with the Boundary Relations of A Genetic Boundary. If it is not the case the Boundary Relation declaration is retained. */
  DepositionMode?: DepositionMode;
  MaxThickness?: eml20.LengthMeasure;
  MinThickness?: eml20.LengthMeasure;
  $type: "resqml20.obj_StratigraphicUnitInterpretation";
}

/** Specification of the vector field upon which the streamlines are based. Streamlines are commonly used to trace the flow of phases (water / oil / gas / total) based upon their flux at a specified time. They may also be used for trace components for compositional simulation, e.g., CO2, or temperatures for thermal simulation.
 *
 * The flux enumeration provides support for the most usual cases with provision for extensions to other fluxes. */
export interface obj_StreamlinesFeature extends AbstractTechnicalFeature {
  /** Specification of the streamline flux, drawn from the enumeration. */
  Flux: StreamlineFlux;
  /** Optional specification of the streamline flux, if an extension is required beyond the enumeration.
   *
   * BUSINESS RULE: OtherFlux should appear if Flux has the value of other. */
  OtherFlux?: string;
  TimeIndex: TimeIndex;
  $type: "resqml20.obj_StreamlinesFeature";
}

/** Representation of streamlines associated with a streamline feature and interpretation.
 *
 * Use StreamlinesFeature to define the vector field that supports the streamlines, i.e., describes what flux is being traced.
 *
 * Use Interpretation to distinguish between shared and differing interpretations.
 *
 * Usage Note: When defining streamline geometry, the PatchIndex will not be referenced, and may be set to a value of 0. */
export interface obj_StreamlinesRepresentation extends AbstractRepresentation {
  Geometry?: StreamlinePolylineSetPatch;
  /** @integer Number of streamlines. */
  LineCount: number;
  StreamlineWellbores?: StreamlineWellbores;
  $type: "resqml20.obj_StreamlinesRepresentation";
}

/** Defines an integer-to-string lookup table, for example, stores facies properties, where a facies index is associated with a facies name. .
 * Used for categorical properties, which also may use a double table lookup. */
export interface obj_StringTableLookup extends AbstractPropertyLookup {
  Value: StringLookup[];
  $type: "resqml20.obj_StringTableLookup";
}

/** One of the main types of RESQML organizations, this class gathers boundary interpretations (e.g., horizons and faults) plus frontier features and their relationships (contacts interpretations), which when taken together define the structure of a part of the earth. */
export interface obj_StructuralOrganizationInterpretation
  extends AbstractOrganizationInterpretation {
  BottomFrontier?: eml20.DataObjectReference[];
  Faults?: eml20.DataObjectReference[];
  Horizons?: HorizonInterpretationIndex[];
  OrderingCriteria: OrderingCriteria;
  Sides?: eml20.DataObjectReference[];
  TopFrontier?: eml20.DataObjectReference[];
  $type: "resqml20.obj_StructuralOrganizationInterpretation";
}

/** An ordered list of indexable elements and/or indexable element pairs of an existing representation.
 *
 * Because the representation concepts of topology, geometry, and property values are separate in RESQML, it is now possible to select a range of nodes, edges, faces, or volumes (cell) indices from the topological support of an existing representation to define a sub-representation.
 *
 * A sub-representation may describe a different feature interpretation using the same geometry or property as the "parent" representation. In this case, the only information exchanged is a set of potentially non-consecutive indices of the topological support of the representation. */
export interface obj_SubRepresentation extends AbstractRepresentation {
  AdditionalGridTopology?: AdditionalGridTopology;
  SubRepresentationPatch: SubRepresentationPatch[];
  SupportingRepresentation: eml20.DataObjectReference;
  $type: "resqml20.obj_SubRepresentation";
}

/** A boundary caused by tectonic movement or metamorphism, such as a fault or a fracture. For types, see TectonicBoundaryKind. */
export interface obj_TectonicBoundaryFeature extends obj_BoundaryFeature {
  TectonicBoundaryKind: TectonicBoundaryKind;
  $type: "resqml20.obj_TectonicBoundaryFeature";
}

/** Stores an ordered list of times, for example, for time-dependent properties, geometries, or representations. It is used in conjunction with the time index to specify times for RESQML. */
export interface obj_TimeSeries extends AbstractResqmlDataObject {
  /** Individual times composing the series. The list ordering is used by the time index. */
  Time: Timestamp[];
  TimeSeriesParentage?: TimeSeriesParentage;
  $type: "resqml20.obj_TimeSeries";
}

/** A representation based on set of triangulated mesh patches, which gets its geometry from a 1D array of points.
 *
 * BUSINESS RULE: The orientation of all the triangles of this representation must be consistent. */
export interface obj_TriangulatedSetRepresentation
  extends AbstractSurfaceRepresentation {
  TrianglePatch: TrianglePatch[];
  $type: "resqml20.obj_TriangulatedSetRepresentation";
}

/** Grid class with an underlying IJK topology, together with a 1D split cell list. The truncated IJK cells have more than the usual 6 faces. The split cells are arbitrary polyhedra, identical to those of an unstructured cell grid. */
export interface obj_TruncatedIjkGridRepresentation
  extends AbstractTruncatedColumnLayerGridRepresentation {
  Geometry: IjkGridGeometry;
  /** @integer Count of I-indices in the grid. Must be positive. */
  Ni: number;
  /** @integer Count of J-indices in the grid. Must be positive. */
  Nj: number;
  $type: "resqml20.obj_TruncatedIjkGridRepresentation";
}

/** Grid class with an underlying unstructured column layer topology, together with a 1D split cell list. The truncated cells have more than the usual number of faces within each column. The split cells are arbitrary polyhedra, identical to those of an unstructured cell grid. */
export interface obj_TruncatedUnstructuredColumnLayerGridRepresentation
  extends AbstractTruncatedColumnLayerGridRepresentation {
  /** @integer Number of unstructured columns in the grid. Must be positive. */
  ColumnCount: number;
  Geometry: UnstructuredColumnLayerGridGeometry;
  $type: "resqml20.obj_TruncatedUnstructuredColumnLayerGridRepresentation";
}

/** Grid whose topology is characterized by an unstructured column index and a layer index, K.
 *
 * Cell geometry is characterized by nodes on coordinate lines, where each column of the model may have an arbitrary number of sides. */
export interface obj_UnstructuredColumnLayerGridRepresentation
  extends AbstractColumnLayerGridRepresentation {
  /** @integer Number of unstructured columns in the grid. Must be positive. */
  ColumnCount: number;
  Geometry?: UnstructuredColumnLayerGridGeometry;
  $type: "resqml20.obj_UnstructuredColumnLayerGridRepresentation";
}

/** Unstructured grid representation characterized by a cell count, and potentially nothing else. Both the oldest and newest simulation formats are based on this format. */
export interface obj_UnstructuredGridRepresentation
  extends AbstractGridRepresentation {
  /** @integer Number of cells in the grid. Must be positive. */
  CellCount: number;
  Geometry?: UnstructuredGridGeometry;
  $type: "resqml20.obj_UnstructuredGridRepresentation";
}

/** May refer to one of these:
 * wellbore. A unique, oriented path from the bottom of a drilled borehole to the surface of the earth. The path must not overlap or cross itself.
 *
 * borehole. A hole excavated in the earth as a result of drilling or boring operations. The borehole may represent the hole of an entire wellbore (when no sidetracks are present), or a sidetrack extension. A borehole extends from an originating point (the surface location for the initial borehole or kickoff point for sidetracks) to a terminating (bottomhole) point.
 *
 * sidetrack. A borehole that originates in another borehole as opposed to originating at the surface. */
export interface obj_WellboreFeature extends AbstractTechnicalFeature {
  WitsmlWellbore?: WitsmlWellboreReference;
  $type: "resqml20.obj_WellboreFeature";
}

/** Representation of a wellbore that is organized along a wellbore trajectory by its MD values. RESQML uses MD values to associate properties on points and to organize association of properties on intervals between MD points. */
export interface obj_WellboreFrameRepresentation
  extends AbstractRepresentation {
  CellFluidPhaseUnits?: CellFluidPhaseUnits;
  IntervalStratigraphiUnits?: IntervalStratigraphicUnits;
  /** @integer Number of nodes. Must be positive. */
  NodeCount: number;
  /** MD values for each node.
   * BUSINESS RULE: MD values and UOM must be consistent with the trajectory representation. */
  NodeMd: AbstractDoubleArray;
  Trajectory: eml20.DataObjectReference;
  /** The reference to the equivalent WITSML well log. */
  WitsmlLogReference?: eml20.DataObjectReference;
  $type:
  | "resqml20.obj_WellboreFrameRepresentation"
  | "resqml20.obj_WellboreMarkerFrameRepresentation"
  | "resqml20.obj_BlockedWellboreRepresentation";
}

/** This class contains the data describing an opinion of a borehole. This interpretation is relative to one particular well trajectory. */
export interface obj_WellboreInterpretation
  extends AbstractFeatureInterpretation {
  /** Used to indicate that this wellbore has been, or is being, drilled. This distinguishes from planned wells. For one wellbore feature we may expect to have multiple wellbore interpretations: IsDrilled=TRUE for instance will be used for updated drilled trajectories. IsDrilled=FALSE for planned trajectories. */
  IsDrilled: boolean;
  $type: "resqml20.obj_WellboreInterpretation";
}

/** A well log frame where each entry represents a well marker */
export interface obj_WellboreMarkerFrameRepresentation
  extends obj_WellboreFrameRepresentation {
  WellboreMarker: WellboreMarker[];
  $type: "resqml20.obj_WellboreMarkerFrameRepresentation";
}

/** Representation of a wellbore trajectory. */
export interface obj_WellboreTrajectoryRepresentation
  extends AbstractRepresentation {
  DeviationSurvey?: eml20.DataObjectReference;
  /** Specifies the ending measured depth of the range for the wellbore trajectory.
   *
   * Range may often be from kickoff to TD, but this is not necessary.
   *
   * BUSINESS RULE: Start MD is always less than the Finish MD. */
  FinishMd: number;
  /** Explicit geometry is not required for vertical wells */
  Geometry?: AbstractParametricLineGeometry;
  MdDatum: eml20.DataObjectReference;
  MdDomain?: MdDomain;
  /** The unit of measure of the reference MD. */
  MdUom: eml20.LengthUom;
  ParentIntersection?: WellboreTrajectoryParentIntersection;
  /** Specifies the measured depth  for the start of the wellbore trajectory.
   *
   * Range may often be from kickoff to TD, but this is not necessary.
   *
   * BUSINESS RULE: Start MD is always less than the Finish MD. */
  StartMd: number;
  /** Pointer to the WITSML trajectory that is contained in the referenced wellbore. (For information about WITSML well and wellbore references, see the definition for RESQML technical feature, WellboreFeature). */
  WitsmlTrajectory?: eml20.DataObjectReference;
  $type: "resqml20.obj_WellboreTrajectoryRepresentation";
}

export interface ObjectParameterKey extends AbstractParameterKey {
  /** Is actually a reference and not a containment relationship. */
  DataObject: eml20.DataObjectReference;
}

/** Enumeration used to specify the order of an abstract stratigraphic organization or a structural organization interpretation. */
export type OrderingCriteria = "age" | "apparent depth" | "measured depth";

/** Enumerations used to indicate a specific type of organization. See attributes below. */
export type OrganizationKind =
  | "earth model"
  | "fluid"
  | "stratigraphic"
  | "structural";

/** An element of a volume shell that is defined by a set of oriented faces belonging to boundable patches.
 *
 * A macroface may describe a contact between:
 *
 * - two structural, stratigraphic, or fluid units
 * - one boundary feature (fault or frontier) and a unit.
 *
 * A face is a bounded open subset of a plane or a curved surface in 3D, delimited by an outer contour and zero, one, or more inner contours describing holes. */
export interface OrientedMacroFace extends BaseType {
  /** @integer Create the triangulation and 2D grid representation for which the patches match the macro faces. */
  PatchIndexOfRepresentation: number;
  /** @integer Identifies the representation by its index, in the list of representations contained in the organization. */
  RepresentationIndex: number;
  SideIsPlus: boolean;
}

/** Optional parent-child cell overlap volume information. If not present, then the CellOverlap data-object lists the overlaps, but with no additional information. */
export interface OverlapVolume extends BaseType {
  /** Parent-child cell volume overlap.
   *
   * BUSINESS RULE: Length of array must equal the cell overlap count. */
  OverlapVolumes?: AbstractDoubleArray;
  /** Units of measure for the overlapVolume. */
  VolumeUom?: eml20.VolumeUom;
}

export type ParameterKind =
  | "dataObject"
  | "floatingPoint"
  | "integer"
  | "string"
  | "timestamp"
  | "subActivity";

/** Description of one parameter that participate in one type of activity. */
export interface ParameterTemplate extends BaseType {
  /** If no allowed type is given, then all kind of datatypes is allowed. */
  AllowedKind?: ParameterKind[];
  /** Textual description of additional constraint associated with the parameter. (note that it will be better to have a formal description of the constraint) */
  Constraint?: string;
  /** When parameter is limited to data object of given types, describe the allowed types. Used only when ParameterType is dataObject */
  DataObjectContentType?: string;
  DefaultValue?: AbstractActivityParameter[];
  /** Indicates if the parameter is an input of the activity.
   * If the parameter is a data object and is also an output of the activity, it is strongly advised to use two parameters : one for input and one for output. The reason is to be able to give two different versions strings for the input and output dataobject which has got obviously the same UUID. */
  IsInput: boolean;
  /** Indicates if the parameter is an output of the activity.
   * If the parameter is a data object and is also an input of the activity, it is strongly advised to use two parameters : one for input and one for output. The reason is to be able to give two different versions strings for the input and output dataobject which has got obviously the same UUID. */
  IsOutput: boolean;
  /** Allows you to indicate that, in the same activity, this parameter template must be associated to another parameter template identified by its title. */
  KeyConstraint?: string[];
  /** @integer Maximum number of parameters of this type allowed in the activity.
   * -1 means "infinite". */
  MaxOccurs: number;
  /** @integer Minimum number of parameters of this type required by the activity.
   * -1 means "infinite". */
  MinOccurs: number;
  /** Name of the parameter in the activity. Key to identify parameter. */
  Title: string;
}

/** Defines an array of parametric lines of multiple kinds.
 *
 * These are the documented parametric line kinds; see additional information below:
 * 0 = vertical
 * 1 = linear spline (piecewise linear)
 * 2 = natural cubic spline
 * 3 = cubic spline
 * 4 = Z linear cubic spline
 * 5 = minimum-curvature spline
 * (-1) = null: no line
 *
 * If isBounded=true in the line definition, then any out of range parametric values in the parametric points are truncated to the first or last control point. Otherwise, the interpolant in the first or last interval is used as an extrapolating function.
 *
 * Special Cases:
 * (1) Natural cubic splines with only two control points reduce to linear interpolation.
 * (2) If required but not defined, tangent vectors at a spline knot are calculated from the control point data using a quadratic fit to the control point and the two adjacent control points (if internal) or, if at an edge, by a vanishing second derivative. This calculation reduces locally to a natural spline.
 * (3) If not expected but provided, then extraneous information is to be ignored, e.g., tangent vectors for linear splines.
 *
 * Vertical:
 * (1) Control points are (X,Y,-).
 * (2) Parameter values are interpreted as depth => (X,Y,Z), where the depth to Z conversion depends on the vertical CRS direction.
 *
 * Piecewise Linear:
 * (1) Control points are (P,X,Y,Z).
 * (2) Piecewise interpolation in (X,Y,Z) as a linear function of P.
 *
 * Natural Cubic:
 * (1) Control points are (P,X,Y,Z).
 * (2) First and second derivatives at each knot are inferred from a quadratic fit to the two adjacent control points, if internal, or, if external knots, by specifying a vanishing second derivative.
 * (3) Interpolating basis functions are obtained by specifying values and second derivatives at the knots.
 *
 * Cubic and Minimum-Curvature.
 * (1) Control points are (P,X,Y,Z).
 * (2) Tangent vectors are (P,TX,TY,TZ). Tangent vectors are defined as the derivative of position with respect to the parameter. If the parameter is arc-length, then the tangent vectors are unit vectors, but not otherwise.
 * (3) Interpolating cubic basis functions obtained by specifying values and first derivatives at the knots.
 * (4) Interpolating minimum-curvature basis functions obtained by a circular arc construction that is constrained by the knot data. This differs from the unconstrained "drilling" algorithm in which the knot locations are not independent but for which the parameter must be arc length.
 *
 * Z Linear Cubic:
 * (1) (X,Y) follow a natural cubic spline and Z follows a linear spline.
 * (2) Parametric values cannot be freely chosen but are instead defined to take the values of 0,,,.N for a line with N intervals, N+1 control points.
 * (3) On export, to go from Z to P, the RESQML "software writer" first needs to determine the interval and then uses linearity in Z to determine P. For the control points, the P values are 0...N and for values of Z, other than the control points, intermediate values of P arise.
 * (4) On import, a RESQML "software reader" converts from P to Z using piecewise linear interpolation, and from P to X and Y using natural cubic spline interpolation. Other than the differing treatment of Z from X and Y, these are completely generic interpolation algorithms.
 * (5) The use of P instead of Z for interpolation allows support for over-turned reservoir structures and removes any apparent discontinuities in parametric derivatives at the spline knots. */
export interface ParametricLineArray extends AbstractParametricLineArray {
  /** An optional array of explicit control point parameters for all of the control points on each of the parametric lines. Used only if control point parameters are present.
   *
   * The number of explicit control point parameters per line is given by the count of non-null parameters on each line.
   *
   * Described as a 1D array, the control point parameter array is divided into segments of length count, with null (NaN) values added to each segment to fill it up.
   *
   * Size = count x #Lines, e.g., 2D or 3D
   *
   * BUSINESS RULE: This count should be zero for vertical and Z linear cubic parametric lines. For all other parametric line kinds, there should be one control point parameter for each control point.
   *
   * NOTES:
   * (1) Vertical parametric lines do not require control point parameters
   * (2) Z linear cubic splines have implicitly defined parameters. For a line with N intervals (N+1 control points), the parametric values are P=0,...,N.
   *
   * BUSINESS RULE: The parametric values must be strictly monotonically increasing on each parametric line. */
  ControlPointParameters?: AbstractDoubleArray;
  /** An array of 3D points for all of the control points on each of the parametric lines. The number of control points per line is given by the count of non-null 3D points on each line.
   *
   * Described as a 1D array, the control point array is divided into segments of length count, with null (NaN) values added to each segment to fill it up.
   *
   * Size = count x #Lines, e.g., 2D or 3D */
  ControlPoints: AbstractPoint3dArray;
  /** @integer The first dimension of the control point, control point parameter, and tangent vector arrays for the parametric splines. The Knot Count is typically chosen to be the maximum number of control points, parameters or tangent vectors on any parametric line in the array of parametric lines. */
  KnotCount: number;
  /** An array of integers indicating the parametric line kind.
   *
   * 0 = vertical
   * 1 = linear spline
   * 2 = natural cubic spline
   * 3 = cubic spline
   * 4 = Z linear cubic spline
   * 5 = minimum-curvature spline
   * (-1) = null: no line
   *
   * Size = #Lines, e.g., (1D or 2D) */
  LineKindIndices: AbstractIntegerArray;
  ParametricLineIntersections?: ParametricLineIntersections;
  /** An optional array that is of tangent vectors for all of the control points on each of the cubic and minimum-curvature parametric lines. Used only if tangent vectors are present.
   * The number of tangent vectors per line is given by the count of non-null tangent vectors on each of these line kinds.
   *
   * Described as a 1D array, the tangent vector array is divided into segments of length count, with null (NaN) values added to each segment to fill it up.
   *
   * Size = count x #Lines, e.g., 2D or 3D
   *
   * BUSINESS RULE: For all lines other than the cubic and minimum-curvature parametric lines, this count is zero. For these line kinds, there is one tangent vector for each control point.
   *
   * If a tangent vector is missing, then it is computed in the same fashion as for a natural cubic spline. Specifically, to obtain the tangent at internal knots, the control points are fit by a quadratic function with the two adjacent control points. At edge knots, the second derivative vanishes. */
  TangentVectors?: AbstractPoint3dArray;
}

/** The parametric line extracted from an existing representation.
 *
 * BUSINESS RULE: The supporting representation must have pillars or lines as indexable elements. */
export interface ParametricLineFromRepresentationGeometry
  extends AbstractParametricLineGeometry {
  /** @integer The line index of the selected line in the supporting representation.
   *
   * For a column-layer grid, the parametric lines follow the indexing of the pillars. */
  LineIndiexOnSupportingRepresentation: number;
  SupportingRepresentation: eml20.DataObjectReference;
}

/** The lattice array of parametric lines extracted from an existing representation.
 *
 * BUSINESS RULE: The supporting representation must have pillars or lines as indexable elements. */
export interface ParametricLineFromRepresentationLatticeArray
  extends AbstractParametricLineArray {
  /** The line indices of the selected lines in the supporting representation. The index selection is regularly incremented from one node to the next node.
   *
   * BUSINESS RULE: The dimensions of the integer lattice array must be consistent with the dimensions of the supporting representation.
   *
   * For a column-layer grid, the parametric lines follow the indexing of the pillars.
   *
   * BUSINESS RULE: The start value of the integer lattice array must be the linearized index of the starting line.
   * Example: iStart + ni * jStart in case of a supporting 2D grid. */
  LineIndicesOnSupportingRepresentation: IntegerLatticeArray;
  SupportingRepresentation: eml20.DataObjectReference;
}

/** Defines a parametric line of any kind.
 *
 * For more information on the supported parametric lines, see ParametricLineArray. */
export interface ParametricLineGeometry extends AbstractParametricLineGeometry {
  /** An optional array of explicit control point parameters for the control points on the parametric line. Used only if control point parameters are present.
   *
   * NOTES:
   * (1) Vertical parametric lines do not require control point parameters.
   * (2) Z linear cubic splines have implicitly defined parameters. For a line with N intervals (N+1 control points), the parametric values are P=0,...,N.
   *
   * BUSINESS RULE: If present, the size must match the number of control points.
   *
   * BUSINESS RULE: For vertical and Z linear cubic parametric lines, this count must be zero. For all other parametric line kinds, each control point must have one control point parameter.
   *
   * BUSINESS RULE: The parametric values must be strictly monotonically increasing on each parametric line.
   * This is an optional array which should only be used if control point parameters are present.
   *
   * BUSINESS RILE: If present, the size must match the number of control points.
   *
   * BUSINESS RULE: This count should be zero for vertical and Z linear cubic parametric lines. For all other parametric line kinds there should be one control point parameter for each control point.
   *
   * Notes:
   * (1) Vertical parametric lines do not require control point parameters
   * (2) Z linear cubic splines have implicitly defined parameters. For a line with N intervals (N+1 control points), the parametric values are P=0,...,N.
   *
   * BUSINESS RULE: The parametric values must be strictly monotonically increasing on each parametric line. */
  ControlPointParameters?: AbstractDoubleArray;
  /** An array of 3D points for the control points on the parametric line. */
  ControlPoints: AbstractPoint3dArray;
  /** @integer Number of spline knots in the parametric line. */
  KnotCount: number;
  /** @integer Integer indicating the parametric line kind
   *
   * 0 for vertical
   * 1 for linear spline
   * 2 for natural cubic spline
   * 3 for cubic spline
   * 4 for z linear cubic spline
   * 5 for minimum-curvature spline
   * (-1) for null: no line */
  LineKindIndex: number;
  /** An optional array of tangent vectors for each control point on the cubic and minimum-curvature parametric lines. Used only if tangent vectors are present.
   *
   * If a tangent vector is missing, then it is computed in the same fashion as for a natural cubic spline. Specifically, to obtain the tangent at internal knots, the control points are fit by a quadratic function with the two adjacent control points. At edge knots, the second derivative vanishes. */
  TangentVectors?: AbstractPoint3dArray;
}

/** Used to specify the intersections between parametric lines. This information is purely geometric and is not required for the evaluation of the parametric point locations on these lines. The information required for that purpose is stored in the parametric points array. */
export interface ParametricLineIntersections extends BaseType {
  /** @integer Number of parametric line intersections. Must be positive. */
  Count: number;
  /** Intersected line index pair for (line 1, line 2).
   *
   * Size = 2 x count */
  IntersectionLinePairs: AbstractIntegerArray;
  /** Intersected line parameter value pairs for (line 1, line 2).
   *
   * Size = 2 x count */
  ParameterValuePairs: AbstractValueArray;
}

/** Set or range of one kind of topological element used to define part of a data-object; this concept exists for grid and structural data-objects. Subset of a specified kind of indexable element of a representation, associated with a patch index. The patch index is used to define the relative order for the elements. It may also be used to access patches of indexable elements directly for geometry, properties, or relationships.
 *
 * Patches are used to remove any ambiguity in data ordering among the indexable elements. For example, the triangle indexing of a triangulated set representation consists of multiple triangles, each with a patch index. This index specifies the relative ordering of the triangle patches. Those data-objects that inherit a patch index from the abstract class of patches all include the word “Patch” as part of their name, e.g., TrianglePatch. */
export interface Patch extends BaseType {
  /** @integer Local index of the patch, making it unique within the representation. */
  PatchIndex: number;
}

/** A patch with a single 1D index count. */
export interface Patch1d extends Patch {
  /** @integer Number of items in the patch. */
  Count: number;
}

/** Defines the boundaries of an indexed patch. These boundaries are outer and inner rings. */
export interface PatchBoundaries extends BaseType {
  /** A hole inside a representation patch. Inside the ring, the representation patch is not defined, outside it is.
   * In case of contact, inner ring polyline representations should be typed as an erosion line, deposition line, or contact.
   *
   * BUSINESS RULE: Must be a polyline reference to a polyline representation, either a single polyline representation or a subrepresentation. Must be closed. */
  InnerRing?: eml20.DataObjectReference[];
  /** The extension of a representation patch. Inside the ring, the representation patch is defined, outside it is not.
   *
   * BUSINESS RULE: Must be a reference to a polyline, either a single polyline representation or a subrepresentation. Must be closed. */
  OuterRing?: eml20.DataObjectReference;
  /** @integer UUID of the referenced topological patch. */
  ReferencedPatch: number;
}

/** Indicates which patch of the representation has a new geometry. */
export interface PatchOfGeometry extends BaseType {
  Geometry: AbstractGeometry;
  /** @integer Patch index for the geometry attachment, if required */
  RepresentationPatchIndex?: number;
}

/** A patch of points. In RESQML, a patch is a set or range of one kind of topological elements used to define part of a data-object, such as grids or structural data-objects. */
export interface PatchOfPoints extends BaseType {
  /** Geometric points (or vectors) to be attached to the specified indexable elements. */
  Points: AbstractPoint3dArray;
  /** @integer Optional patch index used to attach properties to a specific patch of the indexable elements. */
  RepresentationPatchIndex?: number;
}

/** A patch of values. */
export interface PatchOfValues extends BaseType {
  /** @integer Patch index used to attach properties to a specific patch of the indexable elements. */
  RepresentationPatchIndex?: number;
  /** Values to be attached to the indexable elements. */
  Values: AbstractValueArray;
}

/** The enumeration of the possible RockFluid Unit phase  in a hydrostatic column.
 * The seal is considered here as a part ( the coverage phase) of an hydrostatic column. */
export type Phase = "aquifer" | "gas cap" | "oil column" | "seal";

/** Used to indicate that all pillars are of a uniform kind, i.e., may be represented using the same number of nodes per pillar. This information is supplied by the RESQML writer to indicate the complexity of the grid geometry, as an aide to the RESQML reader.
 *
 * If a combination of vertical and straight, then use straight.
 *
 * If a specific pillar shape is not appropriate, then use curved.
 *
 * BUSINESS RULE: Should be consistent with the actual geometry of the grid. */
export type PillarShape = "vertical" | "straight" | "curved";

/** An array of explicit XY points stored as two coordinates in an HDF5 dataset. If needed, the implied Z coordinate is uniformly 0. */
export interface Point2dHdf5Array extends AbstractPoint3dArray {
  /** Reference to an HDF5 2D dataset of XY points. The 2 coordinates are stored sequentially in HDF5, i.e., a multi-dimensional array of points is stored as a 2 x ... HDF5 array. */
  Coordinates: eml20.Hdf5Dataset;
}

/** Defines a point using coordinates in 3D space. */
export interface Point3d extends BaseType {
  /** X Coordinate */
  Coordinate1: number;
  /** Y Coordinate */
  Coordinate2: number;
  /** Either Z or T Coordinate */
  Coordinate3: number;
}

/** A lattice array of points extracted from an existing representation.
 *
 * BUSINESS RULE: The supporting representation must have nodes as indexable elements */
export interface Point3dFromRepresentationLatticeArray
  extends AbstractPoint3dArray {
  /** The node indices of the selected nodes in the supporting representation. The index selection is regularly incremented from one node to the next node.
   *
   * BUSINESS RULE: The node indices must be consistent with the size of supporting representation. */
  NodeIndicesOnSupportingRepresentation: IntegerLatticeArray;
  SupportingRepresentation: eml20.DataObjectReference;
}

/** n array of explicit XYZ points stored as three coordinates in an HDF5 dataset. */
export interface Point3dHdf5Array extends AbstractPoint3dArray {
  /** Reference to an HDF5 3D dataset of XYZ points. The 3 coordinates are stored sequentially in HDF5, i.e., a multi-dimensional array of points is stored as a 3 x ... HDF5 array. */
  Coordinates: eml20.Hdf5Dataset;
}

/** Describes a lattice array of points obtained by sampling from along a multi-dimensional lattice. Each dimension of the lattice can be uniformly or irregularly spaced. */
export interface Point3dLatticeArray extends AbstractPoint3dArray {
  /** The optional element that indicates that the offset vectors for each direction are mutually orthogonal to each other. This meta-information is useful to remove any doubt of orthogonality in case of numerical precision issues.
   *
   * BUSINESS RULE: If you don't know it or if only one lattice dimension is given, do not provide this element. */
  AllDimensionsAreOrthogonal?: boolean;
  Offset: Point3dOffset[];
  /** The origin location of the lattice given as XYZ coordinates. */
  Origin: Point3d;
}

/** Defines the size and sampling in each dimension (direction) of the point 3D lattice array. Sampling can be uniform or irregular. */
export interface Point3dOffset extends BaseType {
  /** The direction of the axis of this lattice dimension. This is a relative offset vector instead of an absolute 3D point. */
  Offset: Point3d;
  /** A lattice of N offset points is described by a spacing array of size N-1. The offset between points is given by the spacing value multiplied by the offset vector. For example, the first offset is 0. The second offset is the first spacing * offset. The second offset is (first spacing + second spacing) * offset, etc. */
  Spacing: AbstractDoubleArray;
}

/** A parametric specification of an array of XYZ points. */
export interface Point3dParametricArray extends AbstractPoint3dArray {
  /** A multi-dimensional array of parametric values that implicitly specifies an array of XYZ points.
   *
   * The parametric values provided in this data-object must be consistent with the parametric values specified in the referenced parametric line array.
   *
   * When constructing a column-layer grid geometry using parametric points, the array indexing follows the dimensionality of the coordinate lines x NKL, which is either a 2D or 3D array. */
  Parameters: AbstractValueArray;
  /** An optional array of indices that map from the array index to the index of the corresponding parametric line.
   * If this information is known from context, then this array is not needed. For example, in either of these cases:
   * (1) If the mapping from array index to parametric line is 1:1.
   * (2) If the mapping has already been specified, as with the pillar Index from the column-layer geometry of a grid.
   *
   * For example, when constructing a column-layer grid geometry using parametric lines, the array indexing follows the dimensionality of the coordinate lines. */
  ParametricLineIndices?: AbstractIntegerArray;
  ParametricLines: AbstractParametricLineArray;
  /** A 2D array of line indices for use with intersecting parametric lines. Each record consists of a single line index, which indicates the array line that uses this truncation information, followed by the parametric line indices for each of the points on that line.
   *
   * For a non-truncated line, the equivalent record repeats the array line index NKL+1 times.
   *
   * Size = (NKL+1) x truncatedLineCount */
  TruncatedLineIndices?: AbstractIntegerArray;
}

/** An array of points defined by applying a Z value on top of an existing array of points, XYZ, where Z is ignored. Used in these cases:
 *
 * - in 2D for defining geometry of one patch of a 2D grid representation.
 * - for extracting nodal geometry from one grid representation for use in another. */
export interface Point3dZValueArray extends AbstractPoint3dArray {
  /** Geometry defining the X and Y coordinates. */
  SupportingGeometry: AbstractPoint3dArray;
  /** The values for Z coordinates */
  ZValues: AbstractDoubleArray;
}

/** The geometry of a set of points defined by their location in the local CRS, with optional seismic coordinates. */
export interface PointGeometry extends AbstractGeometry {
  Points: AbstractPoint3dArray;
  SeismicCoordinates?: AbstractSeismicCoordinates;
}

/** A patch containing a set of polylines.
 *
 * For performance reasons, the geometry of each patch is described in only one 1D array of 3D points, which aggregates the nodes of all the polylines together.
 *
 * To be able to separate the polyline descriptions, additional information is added about the type of each polyline (closed or not) and the number of 3D points (node count) of each polyline.
 *
 * This additional information is contained in two arrays which are associated with each polyline set patch. The dimension of these arrays is the number of polylines gathered in one polyline set patch.
 *
 * - The first array contains a Boolean for each polyline (closed or not closed)
 * - The second array contains the count of nodes for each polyline. */
export interface PolylineSetPatch extends Patch {
  ClosedPolylines: AbstractBooleanArray;
  Geometry: PointGeometry;
  /** The first number in the list defines the node count for the first polyline in the polyline set patch.
   * The second number in the list defines the node count for the second polyline in the polyline set patch.
   * etc. */
  NodeCountPerPolyline: AbstractIntegerArray;
}

/** Qualifiers for property values, which allows users to semantically specialize a property without creating a new property kind.
 * For the list of enumerations, see Facet. */
export interface PropertyKindFacet extends BaseType {
  /** Facet of the property kind (see the enumeration) */
  Facet: Facet;
  /** Property facet value. */
  Value: string;
}

export interface PropertyValuesPatch extends BaseType {
  /** @integer Index of the patch */
  patchUid: number;
  values: AbstractValueArray;
}

/** One-dimensional I, J, or K refinement and coarsening regrid specification. The regrid description is organized using intervals. Within each interval, the number of parent and child cells is specified. Parent and child grid cell faces are aligned at interval boundaries. By default, child cells are uniformly sized within an interval unless weights are used to modify their size.
 *
 * If the child grid is a root grid with an independent geometry, then there will usually be only a single interval for a regrid, because internal cell faces are not necessarily aligned. */
export interface Regrid extends BaseType {
  /** @integer 0-based index for the placement of the window on the parent grid. */
  InitialIndexOnParentGrid: number;
  Intervals?: Intervals;
}

/** Indicates the nature of the relationship between 2 or more representations, specifically if they are partially or totally identical. For possible types of relationships, see IdentityKind. */
export interface RepresentationIdentity extends BaseType {
  AdditionalGridTopology?: AdditionalGridTopology;
  ElementIdentity: ElementIdentity[];
  /** @integer Number of elements within each representation for which a representation identity is specified. */
  IdenticalElementCount: number;
}

/** Representation for an array of 1D variable length arrays. The representation consists of these two arrays:
 *
 * - An aggregation of all the variable length arrays into a single dimensional array.
 * - The offsets into the other array, given by the sum of all the previous array lengths, including the current array. */
export interface ResqmlJaggedArray extends BaseType {
  /** 1D array of cumulative lengths to the end of the current array. This is also equal to the index of the next element, i.e., the index in the elements array, for which the current variable length array begins. */
  CumulativeLength: AbstractIntegerArray;
  /** 1D array of elements containing the aggregation of individual array data. */
  Elements: AbstractValueArray;
}

/** Enumeration of the standard set of RESQML property kinds. */
export type ResqmlPropertyKind =
  | "absorbed dose"
  | "acceleration linear"
  | "activity (of radioactivity)"
  | "amount of substance"
  | "amplitude"
  | "angle per length"
  | "angle per time"
  | "angle per volume"
  | "angular acceleration"
  | "area"
  | "area per area"
  | "area per volume"
  | "attenuation"
  | "attenuation per length"
  | "azimuth"
  | "bubble point pressure"
  | "bulk modulus"
  | "capacitance"
  | "categorical"
  | "cell length"
  | "charge density"
  | "chemical potential"
  | "code"
  | "compressibility"
  | "concentration of B"
  | "conductivity"
  | "continuous"
  | "cross section absorption"
  | "current density"
  | "Darcy flow coefficient"
  | "data transmission speed"
  | "delta temperature"
  | "density"
  | "depth"
  | "diffusion coefficient"
  | "digital storage"
  | "dimensionless"
  | "dip"
  | "discrete"
  | "dose equivalent"
  | "dose equivalent rate"
  | "dynamic viscosity"
  | "electric charge"
  | "electric conductance"
  | "electric current"
  | "electric dipole moment"
  | "electric field strength"
  | "electric polarization"
  | "electric potential"
  | "electrical resistivity"
  | "electrochemical equivalent"
  | "electromagnetic moment"
  | "energy length per area"
  | "energy length per time area temperature"
  | "energy per area"
  | "energy per length"
  | "equivalent per mass"
  | "equivalent per volume"
  | "exposure (radioactivity)"
  | "fluid volume"
  | "force"
  | "force area"
  | "force length per length"
  | "force per force"
  | "force per length"
  | "force per volume"
  | "formation volume factor"
  | "frequency"
  | "frequency interval"
  | "gamma ray API unit"
  | "heat capacity"
  | "heat flow rate"
  | "heat transfer coefficient"
  | "illuminance"
  | "index"
  | "irradiance"
  | "isothermal compressibility"
  | "kinematic viscosity"
  | "Lambda Rho"
  | "Lame constant"
  | "length"
  | "length per length"
  | "length per temperature"
  | "length per volume"
  | "level of power intensity"
  | "light exposure"
  | "linear thermal expansion"
  | "luminance"
  | "luminous efficacy"
  | "luminous flux"
  | "luminous intensity"
  | "magnetic dipole moment"
  | "magnetic field strength"
  | "magnetic flux"
  | "magnetic induction"
  | "magnetic permeability"
  | "magnetic vector potential"
  | "mass"
  | "mass attenuation coefficient"
  | "mass concentration"
  | "mass flow rate"
  | "mass length"
  | "mass per energy"
  | "mass per length"
  | "mass per time per area"
  | "mass per time per length"
  | "mass per volume per length"
  | "mobility"
  | "modulus of compression"
  | "molar concentration"
  | "molar heat capacity"
  | "molar volume"
  | "mole per area"
  | "mole per time"
  | "mole per time per area"
  | "moment of force"
  | "moment of inertia"
  | "moment of section"
  | "momentum"
  | "Mu Rho"
  | "net to gross ratio"
  | "neutron API unit"
  | "nonDarcy flow coefficient"
  | "operations per time"
  | "parachor"
  | "per area"
  | "per electric potential"
  | "per force"
  | "per length"
  | "per mass"
  | "per volume"
  | "permeability length"
  | "permeability rock"
  | "permeability thickness"
  | "permeance"
  | "permittivity"
  | "pH"
  | "plane angle"
  | "Poisson ratio"
  | "pore volume"
  | "porosity"
  | "potential difference per power drop"
  | "power"
  | "power per volume"
  | "pressure"
  | "pressure per time"
  | "pressure squared"
  | "pressure squared per force time per area"
  | "pressure time per volume"
  | "productivity index"
  | "property multiplier"
  | "quantity"
  | "quantity of light"
  | "radiance"
  | "radiant intensity"
  | "relative permeability"
  | "relative power"
  | "relative time"
  | "reluctance"
  | "resistance"
  | "resistivity per length"
  | "RESQML root property"
  | "Rock Impedance"
  | "rock permeability"
  | "rock volume"
  | "saturation"
  | "second moment of area"
  | "shear modulus"
  | "solid angle"
  | "solution gas-oil ratio"
  | "specific activity (of radioactivity)"
  | "specific energy"
  | "specific heat capacity"
  | "specific productivity index"
  | "specific volume"
  | "surface density"
  | "temperature per length"
  | "temperature per time"
  | "thermal conductance"
  | "thermal conductivity"
  | "thermal diffusivity"
  | "thermal insulance"
  | "thermal resistance"
  | "thermodynamic temperature"
  | "thickness"
  | "time"
  | "time per length"
  | "time per volume"
  | "transmissibility"
  | "unit productivity index"
  | "unitless"
  | "vapor oil-gas ratio"
  | "velocity"
  | "volume"
  | "volume flow rate"
  | "volume length per time"
  | "volume per area"
  | "volume per length"
  | "volume per time per area"
  | "volume per time per length"
  | "volume per time per time"
  | "volume per time per volume"
  | "volume per volume"
  | "volumetric heat transfer coefficient"
  | "volumetric thermal expansion"
  | "work"
  | "Young modulus";

export type ResqmlUom =
  | "%"
  | "%[area]"
  | "%[mass]"
  | "%[molar]"
  | "%[vol]"
  | "(bbl/d)/(bbl/d)"
  | "(m3/d)/(m3/d)"
  | "(m3/s)/(m3/s)"
  | "0.001 bbl/ft3"
  | "0.001 bbl/m3"
  | "0.001 d/ft3"
  | "0.001 gal[UK]/bbl"
  | "0.001 gal[UK]/gal[UK]"
  | "0.001 gal[US]/bbl"
  | "0.001 gal[US]/ft3"
  | "0.001 gal[US]/gal[US]"
  | "0.001 h/ft"
  | "0.001 kPa2/cP"
  | "0.001 lbm/bbl"
  | "0.001 lbm/gal[UK]"
  | "0.001 lbm/gal[US]"
  | "0.001 psi/ft"
  | "0.001 pt[UK]/bbl"
  | "0.001 seca"
  | "0.01 bbl/bbl"
  | "0.01 dega/ft"
  | "0.01 degF/ft"
  | "0.01 dm3/km"
  | "0.01 ft/ft"
  | "0.01 grain/ft3"
  | "0.01 L/kg"
  | "0.01 L/km"
  | "0.01 lbf/ft"
  | "0.01 lbf/ft2"
  | "0.01 lbm/ft2"
  | "0.01 psi/ft"
  | "0.1 ft"
  | "0.1 ft[US]"
  | "0.1 gal[US]/bbl"
  | "0.1 in"
  | "0.1 L/bbl"
  | "0.1 lbm/bbl"
  | "0.1 pt[US]/bbl"
  | "0.1 yd"
  | "1/(kg.s)"
  | "1/16 in"
  | "1/2 ft"
  | "1/2 ms"
  | "1/30 cm3/min"
  | "1/30 dega/ft"
  | "1/30 dega/m"
  | "1/30 lbf/m"
  | "1/30 m/m"
  | "1/30 N/m"
  | "1/32 in"
  | "1/64 in"
  | "1/a"
  | "1/angstrom"
  | "1/bar"
  | "1/bbl"
  | "1/cm"
  | "1/d"
  | "1/degC"
  | "1/degF"
  | "1/degR"
  | "1/ft"
  | "1/ft2"
  | "1/ft3"
  | "1/g"
  | "1/gal[UK]"
  | "1/gal[US]"
  | "1/H"
  | "1/h"
  | "1/in"
  | "1/K"
  | "1/kg"
  | "1/km2"
  | "1/kPa"
  | "1/L"
  | "1/lbf"
  | "1/lbm"
  | "1/m"
  | "1/m2"
  | "1/m3"
  | "1/mi"
  | "1/mi2"
  | "1/min"
  | "1/mm"
  | "1/ms"
  | "1/N"
  | "1/nm"
  | "1/Pa"
  | "1/pPa"
  | "1/psi"
  | "1/s"
  | "1/upsi"
  | "1/us"
  | "1/uV"
  | "1/V"
  | "1/wk"
  | "1/yd"
  | "10 ft"
  | "10 in"
  | "10 km"
  | "10 kN"
  | "10 Mg/m3"
  | "100 ft"
  | "100 ka[t]"
  | "100 km"
  | "1000 bbl"
  | "1000 bbl.ft/d"
  | "1000 bbl/d"
  | "1000 ft"
  | "1000 ft/h"
  | "1000 ft/s"
  | "1000 ft3"
  | "1000 ft3/(d.ft)"
  | "1000 ft3/(psi.d)"
  | "1000 ft3/bbl"
  | "1000 ft3/d"
  | "1000 gal[UK]"
  | "1000 gal[US]"
  | "1000 lbf.ft"
  | "1000 m3"
  | "1000 m3/(d.m)"
  | "1000 m3/(h.m)"
  | "1000 m3/d"
  | "1000 m3/h"
  | "1000 m3/m3"
  | "1000 m4/d"
  | "1E-6 acre.ft/bbl"
  | "1E-6 bbl/ft3"
  | "1E-6 bbl/m3"
  | "1E-6 gal[US]"
  | "1E-6 m3/(m3.degC)"
  | "1E-6 m3/(m3.degF)"
  | "1E-9 1/ft"
  | "1E12 ft3"
  | "1E6 (ft3/d)/(bbl/d)"
  | "1E6 bbl"
  | "1E6 bbl/(acre.ft)"
  | "1E6 bbl/acre"
  | "1E6 bbl/d"
  | "1E6 Btu[IT]"
  | "1E6 Btu[IT]/h"
  | "1E6 ft3"
  | "1E6 ft3/(acre.ft)"
  | "1E6 ft3/bbl"
  | "1E6 ft3/d"
  | "1E6 lbm/a"
  | "1E6 m3"
  | "1E6 m3/d"
  | "1E9 bbl"
  | "1E9 ft3"
  | "30 ft"
  | "30 m"
  | "A"
  | "a"
  | "A.h"
  | "A.m2"
  | "A.s"
  | "A.s/kg"
  | "A.s/m3"
  | "A/cm2"
  | "A/ft2"
  | "A/m"
  | "A/m2"
  | "A/mm"
  | "A/mm2"
  | "a[t]"
  | "acre"
  | "acre.ft"
  | "ag"
  | "aJ"
  | "angstrom"
  | "at"
  | "atm"
  | "atm/ft"
  | "atm/h"
  | "atm/hm"
  | "atm/m"
  | "b"
  | "B"
  | "B.W"
  | "b/cm3"
  | "B/m"
  | "B/O"
  | "bar"
  | "bar/h"
  | "bar/km"
  | "bar/m"
  | "bar2"
  | "bar2/cP"
  | "bbl"
  | "bbl/(acre.ft)"
  | "bbl/(d.acre.ft)"
  | "bbl/(d.ft)"
  | "bbl/(ft.psi.d)"
  | "bbl/(kPa.d)"
  | "bbl/(psi.d)"
  | "bbl/acre"
  | "bbl/bbl"
  | "bbl/d"
  | "bbl/d2"
  | "bbl/ft"
  | "bbl/ft3"
  | "bbl/h"
  | "bbl/h2"
  | "bbl/in"
  | "bbl/m3"
  | "bbl/mi"
  | "bbl/min"
  | "bbl/psi"
  | "bbl/ton[UK]"
  | "bbl/ton[US]"
  | "Bd"
  | "bit"
  | "bit/s"
  | "Bq"
  | "Bq/kg"
  | "Btu[IT]"
  | "Btu[IT].in/(h.ft2.degF)"
  | "Btu[IT]/(h.ft.degF)"
  | "Btu[IT]/(h.ft2)"
  | "Btu[IT]/(h.ft2.degF)"
  | "Btu[IT]/(h.ft2.degR)"
  | "Btu[IT]/(h.ft3)"
  | "Btu[IT]/(h.ft3.degF)"
  | "Btu[IT]/(h.m2.degC)"
  | "Btu[IT]/(hp.h)"
  | "Btu[IT]/(lbm.degF)"
  | "Btu[IT]/(lbm.degR)"
  | "Btu[IT]/(lbmol.degF)"
  | "Btu[IT]/(s.ft2)"
  | "Btu[IT]/(s.ft2.degF)"
  | "Btu[IT]/(s.ft3)"
  | "Btu[IT]/(s.ft3.degF)"
  | "Btu[IT]/bbl"
  | "Btu[IT]/ft3"
  | "Btu[IT]/gal[UK]"
  | "Btu[IT]/gal[US]"
  | "Btu[IT]/h"
  | "Btu[IT]/lbm"
  | "Btu[IT]/lbmol"
  | "Btu[IT]/min"
  | "Btu[IT]/s"
  | "Btu[th]"
  | "Btu[UK]"
  | "byte"
  | "byte/s"
  | "C"
  | "C.m"
  | "C/cm2"
  | "C/cm3"
  | "C/g"
  | "C/kg"
  | "C/m2"
  | "C/m3"
  | "C/mm2"
  | "C/mm3"
  | "ca"
  | "cA"
  | "cal[IT]"
  | "cal[th]"
  | "cal[th]/(g.K)"
  | "cal[th]/(h.cm.degC)"
  | "cal[th]/(h.cm2)"
  | "cal[th]/(h.cm2.degC)"
  | "cal[th]/(h.cm3)"
  | "cal[th]/(mol.degC)"
  | "cal[th]/(s.cm.degC)"
  | "cal[th]/(s.cm2.degC)"
  | "cal[th]/(s.cm3)"
  | "cal[th]/cm3"
  | "cal[th]/g"
  | "cal[th]/h"
  | "cal[th]/kg"
  | "cal[th]/lbm"
  | "cal[th]/mL"
  | "cal[th]/mm3"
  | "cC"
  | "ccal[th]"
  | "ccgr"
  | "cd"
  | "cd/m2"
  | "cEuc"
  | "ceV"
  | "cF"
  | "cg"
  | "cgauss"
  | "cgr"
  | "cGy"
  | "cH"
  | "chain"
  | "chain[BnA]"
  | "chain[BnB]"
  | "chain[Cla]"
  | "chain[Ind37]"
  | "chain[Se]"
  | "chain[SeT]"
  | "chain[US]"
  | "cHz"
  | "Ci"
  | "cJ"
  | "cm"
  | "cm/a"
  | "cm/s"
  | "cm/s2"
  | "cm2"
  | "cm2/g"
  | "cm2/s"
  | "cm3"
  | "cm3/cm3"
  | "cm3/g"
  | "cm3/h"
  | "cm3/L"
  | "cm3/m3"
  | "cm3/min"
  | "cm3/s"
  | "cm4"
  | "cmH2O[4degC]"
  | "cN"
  | "cohm"
  | "cP"
  | "cPa"
  | "crd"
  | "cS"
  | "cs"
  | "cSt"
  | "ct"
  | "cT"
  | "cu"
  | "cV"
  | "cW"
  | "cWb"
  | "cwt[UK]"
  | "cwt[US]"
  | "d"
  | "D"
  | "D.ft"
  | "D.m"
  | "D/(Pa.s)"
  | "d/bbl"
  | "D/cP"
  | "d/ft3"
  | "d/m3"
  | "D[API]"
  | "dA"
  | "dam"
  | "daN"
  | "daN.m"
  | "dAPI"
  | "dB"
  | "dB.MW"
  | "dB.mW"
  | "dB.W"
  | "dB/ft"
  | "dB/km"
  | "dB/m"
  | "dB/O"
  | "dC"
  | "dcal[th]"
  | "dega"
  | "dega/ft"
  | "dega/h"
  | "dega/m"
  | "dega/min"
  | "dega/s"
  | "degC"
  | "degC.m2.h/kcal[th]"
  | "degC/ft"
  | "degC/h"
  | "degC/hm"
  | "degC/km"
  | "degC/kPa"
  | "degC/m"
  | "degC/min"
  | "degC/s"
  | "degF"
  | "degF.ft2.h/Btu[IT]"
  | "degF/ft"
  | "degF/h"
  | "degF/m"
  | "degF/min"
  | "degF/psi"
  | "degF/s"
  | "degR"
  | "dEuc"
  | "deV"
  | "dF"
  | "dgauss"
  | "dGy"
  | "dH"
  | "dHz"
  | "dJ"
  | "dm"
  | "dm/s"
  | "dm3"
  | "dm3/(kW.h)"
  | "dm3/kg"
  | "dm3/kmol"
  | "dm3/m"
  | "dm3/m3"
  | "dm3/MJ"
  | "dm3/s"
  | "dm3/s2"
  | "dm3/t"
  | "dN"
  | "dN.m"
  | "dohm"
  | "dP"
  | "dPa"
  | "drd"
  | "ds"
  | "dS"
  | "dT"
  | "dV"
  | "dW"
  | "dWb"
  | "dyne"
  | "dyne.cm2"
  | "dyne.s/cm2"
  | "dyne/cm"
  | "dyne/cm2"
  | "EA"
  | "Ea[t]"
  | "EC"
  | "Ecal[th]"
  | "EEuc"
  | "EeV"
  | "EF"
  | "Eg"
  | "Egauss"
  | "EGy"
  | "EH"
  | "EHz"
  | "EJ"
  | "EJ/a"
  | "Em"
  | "EN"
  | "Eohm"
  | "EP"
  | "EPa"
  | "Erd"
  | "erg"
  | "erg/a"
  | "erg/cm2"
  | "erg/cm3"
  | "erg/g"
  | "erg/kg"
  | "erg/m3"
  | "ES"
  | "ET"
  | "Euc"
  | "eV"
  | "EW"
  | "EWb"
  | "F"
  | "F/m"
  | "fa"
  | "fA"
  | "fathom"
  | "fC"
  | "fcal[th]"
  | "fEuc"
  | "feV"
  | "fF"
  | "fg"
  | "fgauss"
  | "fGy"
  | "fH"
  | "fHz"
  | "fJ"
  | "floz[UK]"
  | "floz[US]"
  | "fm"
  | "fN"
  | "fohm"
  | "footcandle"
  | "footcandle.s"
  | "fP"
  | "fPa"
  | "frd"
  | "fS"
  | "ft"
  | "fT"
  | "ft/bbl"
  | "ft/d"
  | "ft/degF"
  | "ft/ft"
  | "ft/ft3"
  | "ft/gal[US]"
  | "ft/h"
  | "ft/in"
  | "ft/lbm"
  | "ft/m"
  | "ft/mi"
  | "ft/min"
  | "ft/ms"
  | "ft/psi"
  | "ft/s"
  | "ft/s2"
  | "ft/us"
  | "ft[BnA]"
  | "ft[BnB]"
  | "ft[Br36]"
  | "ft[Br65]"
  | "ft[Cla]"
  | "ft[GC]"
  | "ft[Ind]"
  | "ft[Ind37]"
  | "ft[Ind62]"
  | "ft[Ind75]"
  | "ft[Se]"
  | "ft[SeT]"
  | "ft[US]"
  | "ft2"
  | "ft2/h"
  | "ft2/in3"
  | "ft2/lbm"
  | "ft2/s"
  | "ft3"
  | "ft3/(d.ft)"
  | "ft3/(ft.psi.d)"
  | "ft3/(min.ft2)"
  | "ft3/(s.ft2)"
  | "ft3/bbl"
  | "ft3/d"
  | "ft3/d2"
  | "ft3/ft"
  | "ft3/ft2"
  | "ft3/ft3"
  | "ft3/h"
  | "ft3/h2"
  | "ft3/kg"
  | "ft3/lbm"
  | "ft3/lbmol"
  | "ft3/min"
  | "ft3/min2"
  | "ft3/rad"
  | "ft3/s"
  | "ft3/s2"
  | "ft3/sack[94lbm]"
  | "fur[US]"
  | "fV"
  | "fW"
  | "fWb"
  | "g"
  | "g.ft/(cm3.s)"
  | "g.m/(cm3.s)"
  | "g/cm3"
  | "g/cm4"
  | "g/dm3"
  | "g/gal[UK]"
  | "g/gal[US]"
  | "g/kg"
  | "g/L"
  | "g/m3"
  | "g/mol"
  | "g/s"
  | "g/t"
  | "GA"
  | "Ga[t]"
  | "Gal"
  | "gal[UK]"
  | "gal[UK]/(h.ft)"
  | "gal[UK]/(h.ft2)"
  | "gal[UK]/(h.in)"
  | "gal[UK]/(h.in2)"
  | "gal[UK]/(min.ft)"
  | "gal[UK]/(min.ft2)"
  | "gal[UK]/d"
  | "gal[UK]/ft3"
  | "gal[UK]/h"
  | "gal[UK]/h2"
  | "gal[UK]/lbm"
  | "gal[UK]/mi"
  | "gal[UK]/min"
  | "gal[UK]/min2"
  | "gal[US]"
  | "gal[US]/(h.ft)"
  | "gal[US]/(h.ft2)"
  | "gal[US]/(h.in)"
  | "gal[US]/(h.in2)"
  | "gal[US]/(min.ft)"
  | "gal[US]/(min.ft2)"
  | "gal[US]/bbl"
  | "gal[US]/d"
  | "gal[US]/ft"
  | "gal[US]/ft3"
  | "gal[US]/h"
  | "gal[US]/h2"
  | "gal[US]/lbm"
  | "gal[US]/mi"
  | "gal[US]/min"
  | "gal[US]/min2"
  | "gal[US]/sack[94lbm]"
  | "gal[US]/ton[UK]"
  | "gal[US]/ton[US]"
  | "gAPI"
  | "gauss"
  | "gauss/cm"
  | "GBq"
  | "GC"
  | "Gcal[th]"
  | "GEuc"
  | "GeV"
  | "gf"
  | "GF"
  | "Gg"
  | "Ggauss"
  | "GGy"
  | "GH"
  | "GHz"
  | "GJ"
  | "Gm"
  | "gn"
  | "GN"
  | "Gohm"
  | "gon"
  | "GP"
  | "GPa"
  | "GPa/cm"
  | "GPa2"
  | "grain"
  | "grain/ft3"
  | "grain/gal[US]"
  | "Grd"
  | "GS"
  | "GT"
  | "GV"
  | "GW"
  | "GW.h"
  | "GWb"
  | "Gy"
  | "H"
  | "h"
  | "h/ft3"
  | "h/km"
  | "H/m"
  | "h/m3"
  | "ha"
  | "ha.m"
  | "hbar"
  | "hg"
  | "hL"
  | "hm"
  | "hN"
  | "hp"
  | "hp.h"
  | "hp.h/bbl"
  | "hp.h/lbm"
  | "hp/ft3"
  | "hp/in2"
  | "hp[elec]"
  | "hp[hyd]"
  | "hp[hyd]/in2"
  | "hp[metric]"
  | "hp[metric].h"
  | "hs"
  | "Hz"
  | "in"
  | "in/(in.degF)"
  | "in/a"
  | "in/min"
  | "in/s"
  | "in/s2"
  | "in[US]"
  | "in2"
  | "in2/ft2"
  | "in2/in2"
  | "in2/s"
  | "in3"
  | "in3/ft"
  | "in4"
  | "inH2O[39degF]"
  | "inH2O[60degF]"
  | "inHg[32degF]"
  | "inHg[60degF]"
  | "J"
  | "J.m/(s.m2.K)"
  | "J.m/m2"
  | "J/(g.K)"
  | "J/(kg.K)"
  | "J/(mol.K)"
  | "J/(s.m2.degC)"
  | "J/cm2"
  | "J/dm3"
  | "J/g"
  | "J/K"
  | "J/kg"
  | "J/m"
  | "J/m2"
  | "J/m3"
  | "J/mol"
  | "J/s"
  | "K"
  | "K.m2/kW"
  | "K.m2/W"
  | "K/km"
  | "K/m"
  | "K/Pa"
  | "K/s"
  | "K/W"
  | "kA"
  | "ka[t]"
  | "kC"
  | "kcal[th]"
  | "kcal[th].m/cm2"
  | "kcal[th]/(h.m.degC)"
  | "kcal[th]/(h.m2.degC)"
  | "kcal[th]/(kg.degC)"
  | "kcal[th]/cm3"
  | "kcal[th]/g"
  | "kcal[th]/h"
  | "kcal[th]/kg"
  | "kcal[th]/m3"
  | "kcal[th]/mol"
  | "kcd"
  | "kdyne"
  | "kEuc"
  | "keV"
  | "kF"
  | "kg"
  | "kg.m"
  | "kg.m/cm2"
  | "kg.m/s"
  | "kg.m2"
  | "kg/(kW.h)"
  | "kg/(m.s)"
  | "kg/(m2.s)"
  | "kg/d"
  | "kg/dm3"
  | "kg/dm4"
  | "kg/h"
  | "kg/J"
  | "kg/kg"
  | "kg/L"
  | "kg/m"
  | "kg/m2"
  | "kg/m3"
  | "kg/m4"
  | "kg/min"
  | "kg/MJ"
  | "kg/mol"
  | "kg/s"
  | "kg/sack[94lbm]"
  | "kg/t"
  | "kgauss"
  | "kgf"
  | "kgf.m"
  | "kgf.m/cm2"
  | "kgf.m/m"
  | "kgf.m2"
  | "kgf.s/m2"
  | "kgf/cm"
  | "kgf/cm2"
  | "kgf/kgf"
  | "kgf/m2"
  | "kgf/mm2"
  | "kGy"
  | "kH"
  | "kHz"
  | "Kibyte"
  | "kJ"
  | "kJ.m/(h.m2.K)"
  | "kJ/(h.m2.K)"
  | "kJ/(kg.K)"
  | "kJ/(kmol.K)"
  | "kJ/dm3"
  | "kJ/kg"
  | "kJ/kmol"
  | "kJ/m3"
  | "klbf"
  | "klbm"
  | "klbm/in"
  | "klx"
  | "km"
  | "km/cm"
  | "km/dm3"
  | "km/h"
  | "km/L"
  | "km/s"
  | "km2"
  | "km3"
  | "kmol"
  | "kmol/h"
  | "kmol/m3"
  | "kmol/s"
  | "kN"
  | "kN.m"
  | "kN.m2"
  | "kN/m"
  | "kN/m2"
  | "knot"
  | "kohm"
  | "kohm.m"
  | "kP"
  | "kPa"
  | "kPa.s/m"
  | "kPa/h"
  | "kPa/hm"
  | "kPa/m"
  | "kPa/min"
  | "kPa2"
  | "kPa2/cP"
  | "kpsi"
  | "kpsi2"
  | "krad"
  | "krd"
  | "kS"
  | "kS/m"
  | "kT"
  | "kV"
  | "kW"
  | "kW.h"
  | "kW.h/(kg.degC)"
  | "kW.h/dm3"
  | "kW.h/kg"
  | "kW.h/m3"
  | "kW/(m2.K)"
  | "kW/(m3.K)"
  | "kW/cm2"
  | "kW/m2"
  | "kW/m3"
  | "kWb"
  | "L"
  | "L/(bar.min)"
  | "L/h"
  | "L/kg"
  | "L/kmol"
  | "L/m"
  | "L/m3"
  | "L/min"
  | "L/mol"
  | "L/s"
  | "L/s2"
  | "L/t"
  | "L/ton[UK]"
  | "lbf"
  | "lbf.ft"
  | "lbf.ft/bbl"
  | "lbf.ft/gal[US]"
  | "lbf.ft/in"
  | "lbf.ft/in2"
  | "lbf.ft/lbm"
  | "lbf.ft/min"
  | "lbf.ft/s"
  | "lbf.in"
  | "lbf.in/in"
  | "lbf.in2"
  | "lbf.s/ft2"
  | "lbf.s/in2"
  | "lbf/ft"
  | "lbf/ft2"
  | "lbf/ft3"
  | "lbf/gal[US]"
  | "lbf/in"
  | "lbf/lbf"
  | "lbm"
  | "lbm.ft"
  | "lbm.ft/s"
  | "lbm.ft2"
  | "lbm.ft2/s2"
  | "lbm/(ft.h)"
  | "lbm/(ft.s)"
  | "lbm/(ft2.h)"
  | "lbm/(ft2.s)"
  | "lbm/(gal[UK].ft)"
  | "lbm/(gal[US].ft)"
  | "lbm/(hp.h)"
  | "lbm/bbl"
  | "lbm/d"
  | "lbm/ft"
  | "lbm/ft2"
  | "lbm/ft3"
  | "lbm/ft4"
  | "lbm/gal[UK]"
  | "lbm/gal[US]"
  | "lbm/h"
  | "lbm/in3"
  | "lbm/lbmol"
  | "lbm/min"
  | "lbm/s"
  | "lbmol"
  | "lbmol/(h.ft2)"
  | "lbmol/(s.ft2)"
  | "lbmol/ft3"
  | "lbmol/gal[UK]"
  | "lbmol/gal[US]"
  | "lbmol/h"
  | "lbmol/s"
  | "link"
  | "link[BnA]"
  | "link[BnB]"
  | "link[Cla]"
  | "link[Se]"
  | "link[SeT]"
  | "link[US]"
  | "lm"
  | "lm.s"
  | "lm/m2"
  | "lm/W"
  | "lx"
  | "lx.s"
  | "m"
  | "m/(m.K)"
  | "m/cm"
  | "m/d"
  | "m/h"
  | "m/K"
  | "m/kg"
  | "m/km"
  | "m/kPa"
  | "m/m"
  | "m/m3"
  | "m/min"
  | "m/ms"
  | "m/Pa"
  | "m/s"
  | "m/s2"
  | "m[Ger]"
  | "m2"
  | "m2/(kPa.d)"
  | "m2/(Pa.s)"
  | "m2/cm3"
  | "m2/d"
  | "m2/g"
  | "m2/h"
  | "m2/kg"
  | "m2/m2"
  | "m2/m3"
  | "m2/mol"
  | "m2/s"
  | "m3"
  | "m3/(bar.d)"
  | "m3/(bar.h)"
  | "m3/(bar.min)"
  | "m3/(d.m)"
  | "m3/(h.m)"
  | "m3/(ha.m)"
  | "m3/(kPa.d)"
  | "m3/(kPa.h)"
  | "m3/(kW.h)"
  | "m3/(m3.K)"
  | "m3/(Pa.s)"
  | "m3/(psi.d)"
  | "m3/(s.ft)"
  | "m3/(s.m)"
  | "m3/(s.m2)"
  | "m3/(s.m3)"
  | "m3/bbl"
  | "m3/d"
  | "m3/d2"
  | "m3/g"
  | "m3/h"
  | "m3/J"
  | "m3/kg"
  | "m3/km"
  | "m3/kmol"
  | "m3/kPa"
  | "m3/m"
  | "m3/m2"
  | "m3/m3"
  | "m3/min"
  | "m3/mol"
  | "m3/Pa"
  | "m3/rad"
  | "m3/rev"
  | "m3/s"
  | "m3/s2"
  | "m3/t"
  | "m3/ton[UK]"
  | "m3/ton[US]"
  | "m4"
  | "m4/s"
  | "mA"
  | "MA"
  | "mA/cm2"
  | "mA/ft2"
  | "Ma[t]"
  | "mbar"
  | "MBq"
  | "mC"
  | "MC"
  | "mC/m2"
  | "Mcal[th]"
  | "mcal[th]"
  | "mCi"
  | "mD"
  | "mD.ft"
  | "mD.ft2/(lbf.s)"
  | "mD.in2/(lbf.s)"
  | "mD.m"
  | "mD/(Pa.s)"
  | "mD/cP"
  | "MEuc"
  | "mEuc"
  | "meV"
  | "MeV"
  | "mF"
  | "MF"
  | "Mg"
  | "mg"
  | "Mg/a"
  | "Mg/d"
  | "mg/dm3"
  | "mg/g"
  | "mg/gal[US]"
  | "Mg/h"
  | "Mg/in"
  | "mg/J"
  | "mg/kg"
  | "mg/L"
  | "Mg/m2"
  | "Mg/m3"
  | "mg/m3"
  | "Mg/min"
  | "mGal"
  | "Mgauss"
  | "mgauss"
  | "Mgf"
  | "mgn"
  | "MGy"
  | "mGy"
  | "MH"
  | "mH"
  | "mHz"
  | "MHz"
  | "mi"
  | "mi/gal[UK]"
  | "mi/gal[US]"
  | "mi/h"
  | "mi/in"
  | "mi[naut]"
  | "mi[nautUK]"
  | "mi[US]"
  | "mi[US]2"
  | "mi2"
  | "mi3"
  | "Mibyte"
  | "mil"
  | "mil/a"
  | "mila"
  | "min"
  | "min/ft"
  | "min/m"
  | "mina"
  | "mJ"
  | "MJ"
  | "MJ/a"
  | "mJ/cm2"
  | "MJ/kg"
  | "MJ/kmol"
  | "MJ/m"
  | "mJ/m2"
  | "MJ/m3"
  | "mL"
  | "mL/gal[UK]"
  | "mL/gal[US]"
  | "mL/mL"
  | "Mm"
  | "mm"
  | "mm/(mm.K)"
  | "mm/a"
  | "mm/s"
  | "mm2"
  | "mm2/mm2"
  | "mm2/s"
  | "mm3"
  | "mm3/J"
  | "mmHg[0degC]"
  | "mmol"
  | "mN"
  | "MN"
  | "mN.m2"
  | "mN/km"
  | "mN/m"
  | "mohm"
  | "Mohm"
  | "mol"
  | "mol.m2/(mol.s)"
  | "mol/(s.m2)"
  | "mol/m2"
  | "mol/m3"
  | "mol/mol"
  | "mol/s"
  | "mP"
  | "MP"
  | "MPa"
  | "mPa"
  | "mPa.s"
  | "MPa.s/m"
  | "MPa/h"
  | "MPa/m"
  | "Mpsi"
  | "mrad"
  | "Mrad"
  | "Mrd"
  | "mrd"
  | "mrem"
  | "mrem/h"
  | "MS"
  | "mS"
  | "ms"
  | "ms/cm"
  | "mS/cm"
  | "ms/ft"
  | "ms/in"
  | "mS/m"
  | "ms/m"
  | "ms/s"
  | "mSv"
  | "mSv/h"
  | "mT"
  | "mT/dm"
  | "MV"
  | "mV"
  | "mV/ft"
  | "mV/m"
  | "MW"
  | "mW"
  | "MW.h"
  | "MW.h/kg"
  | "MW.h/m3"
  | "mW/m2"
  | "mWb"
  | "MWb"
  | "N"
  | "N.m"
  | "N.m/m"
  | "N.m2"
  | "N.s/m2"
  | "N/m"
  | "N/m2"
  | "N/m3"
  | "N/mm2"
  | "N/N"
  | "nA"
  | "na"
  | "nAPI"
  | "nC"
  | "ncal[th]"
  | "nCi"
  | "nEuc"
  | "neV"
  | "nF"
  | "ng"
  | "ng/g"
  | "ng/mg"
  | "ngauss"
  | "nGy"
  | "nH"
  | "nHz"
  | "nJ"
  | "nm"
  | "nm/s"
  | "nN"
  | "nohm"
  | "nohm.mil2/ft"
  | "nohm.mm2/m"
  | "nP"
  | "nPa"
  | "nrd"
  | "nS"
  | "ns"
  | "ns/ft"
  | "ns/m"
  | "nT"
  | "nV"
  | "nW"
  | "nWb"
  | "O"
  | "Oe"
  | "ohm"
  | "ohm.cm"
  | "ohm.m"
  | "ohm.m2/m"
  | "ohm/m"
  | "ozf"
  | "ozm"
  | "ozm[troy]"
  | "P"
  | "pA"
  | "Pa"
  | "Pa.s"
  | "Pa.s.m3/kg"
  | "Pa.s/m3"
  | "Pa.s2/m3"
  | "Pa/h"
  | "Pa/m"
  | "Pa/m3"
  | "Pa/s"
  | "Pa2"
  | "Pa2/(Pa.s)"
  | "pC"
  | "pcal[th]"
  | "pCi"
  | "pCi/g"
  | "pdl"
  | "pdl.cm2"
  | "pdl.ft"
  | "pdl/cm"
  | "pEuc"
  | "peV"
  | "pF"
  | "pg"
  | "pgauss"
  | "pGy"
  | "pHz"
  | "pJ"
  | "pm"
  | "pN"
  | "pohm"
  | "pP"
  | "pPa"
  | "ppk"
  | "ppm"
  | "ppm[mass]"
  | "ppm[vol]"
  | "ppm[vol]/degC"
  | "ppm[vol]/degF"
  | "prd"
  | "ps"
  | "pS"
  | "psi"
  | "psi.d/bbl"
  | "psi.s"
  | "psi/ft"
  | "psi/h"
  | "psi/m"
  | "psi/min"
  | "psi2"
  | "psi2.d/(cP.ft3)"
  | "psi2/cP"
  | "pT"
  | "pt[UK]"
  | "pt[UK]/(hp.h)"
  | "pt[US]"
  | "pV"
  | "pW"
  | "pWb"
  | "qt[UK]"
  | "qt[US]"
  | "quad"
  | "quad/a"
  | "rad"
  | "rad/ft"
  | "rad/ft3"
  | "rad/m"
  | "rad/m3"
  | "rad/s"
  | "rad/s2"
  | "rd"
  | "rem"
  | "rem/h"
  | "rev"
  | "rev/ft"
  | "rev/m"
  | "rev/s"
  | "rod[US]"
  | "rpm"
  | "rpm/s"
  | "S"
  | "s"
  | "s/cm"
  | "s/ft"
  | "s/ft3"
  | "s/in"
  | "s/kg"
  | "s/L"
  | "S/m"
  | "s/m"
  | "s/m3"
  | "s/qt[UK]"
  | "s/qt[US]"
  | "s/s"
  | "sack[94lbm]"
  | "seca"
  | "section"
  | "sr"
  | "St"
  | "Sv"
  | "Sv/h"
  | "Sv/s"
  | "t"
  | "T"
  | "t/a"
  | "t/d"
  | "t/h"
  | "T/m"
  | "t/m3"
  | "t/min"
  | "TA"
  | "Ta[t]"
  | "TBq"
  | "TC"
  | "Tcal[th]"
  | "TD[API]"
  | "TD[API].m"
  | "TD[API]/(Pa.s)"
  | "TEuc"
  | "TeV"
  | "TF"
  | "Tg"
  | "Tgauss"
  | "TGy"
  | "TH"
  | "therm[EC]"
  | "therm[UK]"
  | "therm[US]"
  | "THz"
  | "TJ"
  | "TJ/a"
  | "Tm"
  | "TN"
  | "Tohm"
  | "ton[UK]"
  | "ton[UK]/a"
  | "ton[UK]/d"
  | "ton[UK]/h"
  | "ton[UK]/min"
  | "ton[US]"
  | "ton[US]/a"
  | "ton[US]/d"
  | "ton[US]/ft2"
  | "ton[US]/h"
  | "ton[US]/min"
  | "tonf[UK]"
  | "tonf[UK].ft2"
  | "tonf[UK]/ft"
  | "tonf[UK]/ft2"
  | "tonf[US]"
  | "tonf[US].ft"
  | "tonf[US].ft2"
  | "tonf[US].mi"
  | "tonf[US].mi/bbl"
  | "tonf[US].mi/ft"
  | "tonf[US]/ft"
  | "tonf[US]/ft2"
  | "tonf[US]/in2"
  | "tonRefrig"
  | "torr"
  | "TP"
  | "TPa"
  | "Trd"
  | "TS"
  | "TT"
  | "TV"
  | "TW"
  | "TW.h"
  | "TWb"
  | "uA"
  | "uA/cm2"
  | "uA/in2"
  | "ubar"
  | "uC"
  | "ucal[th]"
  | "ucal[th]/(s.cm2)"
  | "ucal[th]/s"
  | "uCi"
  | "uEuc"
  | "ueV"
  | "uF"
  | "uF/m"
  | "ug"
  | "ug/cm3"
  | "ug/g"
  | "ug/mg"
  | "ugauss"
  | "uGy"
  | "uH"
  | "uH/m"
  | "uHz"
  | "uJ"
  | "um"
  | "um/s"
  | "um2"
  | "um2.m"
  | "umHg[0degC]"
  | "umol"
  | "uN"
  | "uohm"
  | "uohm/ft"
  | "uohm/m"
  | "uP"
  | "uPa"
  | "upsi"
  | "urad"
  | "urd"
  | "us"
  | "uS"
  | "us/ft"
  | "us/in"
  | "us/m"
  | "uT"
  | "uV"
  | "uV/ft"
  | "uV/m"
  | "uW"
  | "uW/m3"
  | "uWb"
  | "V"
  | "V/B"
  | "V/dB"
  | "V/m"
  | "W"
  | "W.m2.K/(J.K)"
  | "W/(m.K)"
  | "W/(m2.K)"
  | "W/(m2.sr)"
  | "W/(m3.K)"
  | "W/cm2"
  | "W/K"
  | "W/kW"
  | "W/m2"
  | "W/m3"
  | "W/mm2"
  | "W/sr"
  | "W/W"
  | "Wb"
  | "Wb.m"
  | "Wb/m"
  | "Wb/mm"
  | "wk"
  | "yd"
  | "yd[BnA]"
  | "yd[BnB]"
  | "yd[Cla]"
  | "yd[Ind]"
  | "yd[Ind37]"
  | "yd[Ind62]"
  | "yd[Ind75]"
  | "yd[Se]"
  | "yd[SeT]"
  | "yd[US]"
  | "yd2"
  | "yd3";

/** An element that allows ordering of fluid feature interpretations in a fluid organization interpretation. */
export interface RockFluidUnitInterpretationIndex extends BaseType {
  /** @integer Index of the fluid feature interpretation. */
  Index: number;
  RockFluidUnit: eml20.DataObjectReference;
}

/** Sealed contact elements that indicate that 2 or more contact patches are partially or totally colocated or equivalent. For possible types of identity, see IdentityKind. */
export interface SealedContactRepresentationPart
  extends AbstractContactRepresentationPart {
  Contact: ContactPatch[];
  /** Indicate which nodes (identified by their common index in all contact patches) of the contact patches are identical.
   *
   * If this list is not present, then it indicates that all nodes in each representation are identical, on an element-by-element level. */
  IdenticalNodeIndices?: AbstractIntegerArray;
  IdentityKind: IdentityKind;
}

/** A group of 2D seismic coordinates that stores the 1-to-1 mapping between geometry patch coordinates (usually X, Y, Z) and trace or inter-trace positions on a seismic line.
 * BUSINESS RULE: This patch must reference a geometry patch by its UUID. */
export interface Seismic2dCoordinates extends AbstractSeismicCoordinates {
  /** The sequence of trace or inter-trace positions that correspond to the geometry coordinates.
   * BUSINESS RULE: Both sequences must be in the same order. */
  LineAbscissa: AbstractDoubleArray;
  /** The sequence of vertical sample or inter-sample positions that correspond to the geometry coordinates.
   * BUSINESS RULE: Sequence must be in the same order than previous one. */
  VerticalCoordinates?: AbstractDoubleArray;
}

/** The 1-to-1 mapping between geometry coordinates (usually X, Y, Z or X, Y, TWT) and trace or inter-trace positions on a seismic lattice. */
export interface Seismic3dCoordinates extends AbstractSeismicCoordinates {
  /** The sequence of trace or inter-trace crossline positions that correspond to the geometry coordinates.
   * BUSINESS RULE: Both sequences must be in the same order. */
  CrosslineCoordinates: AbstractDoubleArray;
  /** The sequence of trace or inter-trace inline positions that correspond to the geometry coordinates.
   * BUSINESS RULE: Both sequences must be in the same order. */
  InlineCoordinates: AbstractDoubleArray;
  /** The sequence of vertical sample or inter-sample positions that correspond to the geometry coordinates.
   * BUSINESS RULE: Sequence must be in the same order than two previous ones. */
  VerticalCoordinates?: AbstractDoubleArray;
}

/** An unordered set of several seismic lattices. Generally, it has no direct interpretation or representation. */
export interface SeismicLatticeSetFeature
  extends AbstractSeismicSurveyFeature { }

/** The enumerated attributes of a horizon. */
export type SequenceStratigraphySurface =
  | "flooding"
  | "ravinement"
  | "maximum flooding"
  | "transgressive";

/** If split nodes are used in the construction of a column layer grid and indexable elements of kind edges are referenced, then the grid edges need to be re-defined.
 *
 * Use Case: finite elements, especially for higher order geometry. */
export interface SplitEdges extends BaseType {
  /** @integer Number of edges. Must be positive. */
  Count: number;
  /** Association of faces with the split edges, used to infer continuity of property, geometry, or interpretation with an attachment kind of edges. */
  FacesPerSplitEdge: ResqmlJaggedArray;
  /** Parent unsplit edge index for each of the additional split edges. */
  ParentEdgeIndices: AbstractIntegerArray;
}

/** Optional construction used to introduce additional faces created by split nodes. Used to represent complex geometries, e.g., for stair-step grids and reverse faults. */
export interface SplitFaces extends BaseType {
  /** Cell index for each split face. Used to implicitly define cell geometry. */
  CellIndices: AbstractIntegerArray;
  /** @integer Number of additional split faces. Count must be positive. */
  Count: number;
  /** Parent unsplit face index for each of the additional split faces. */
  ParentFaceIndices: AbstractIntegerArray;
  SplitEdges?: SplitEdges;
}

/** Optional construction used to introduce additional nodes on coordinate lines. Used to represent complex geometries, e.g., for stair-step grids and reverse faults.
 *
 * BUSINESS RULE: Patch Index must be positive since a patch index of 0 refers to the fundamental column layer coordinate line nodes. */
export interface SplitNodePatch extends Patch {
  /** Cell indices for each of the split nodes. Used to implicitly define cell geometry. List-of-lists construction used to support split nodes shared between multiple cells. */
  CellsPerSplitNode: ResqmlJaggedArray;
  /** @integer Number of additional split nodes. Count must be positive. */
  Count: number;
  /** Parent coordinate line node index for each of the split nodes. Used to implicitly define cell geometry. */
  ParentNodeIndices: AbstractIntegerArray;
  SplitFaces?: SplitFaces;
}

/** A standard property kind is defined in the Energistics catalog. It has an unique name. */
export interface StandardPropertyKind extends AbstractPropertyKind {
  Kind: ResqmlPropertyKind;
}

/** Element that lets you index and order stratigraphic unit interpretations. For possible ordering criteria, see OrderingCriteria. */
export interface StratigraphicUnitInterpretationIndex extends BaseType {
  /** @integer An index value associated to an instance of this type of interpretation, given a specific ordering criteria. */
  Index: number;
  Unit: eml20.DataObjectReference;
}

/** Enumeration of the usual streamline fluxes */
export type StreamlineFlux = "oil" | "gas" | "water" | "total" | "other";

/** A patch containing a set of polylines.
 *
 * For performance reasons, the geometry of each patch is described in only one 1D array of 3D points, which aggregates the nodes of all the polylines together.
 *
 * To be able to separate the polyline descriptions, additional information is added about the type of each polyline (closed or not) and the number of 3D points (node count) of each polyline.
 *
 * This additional information is contained in two arrays which are associated with each polyline set patch. The dimension of these arrays is the number of polylines gathered in one polyline set patch.
 *
 * - The first array contains a Boolean for each polyline (closed or not closed)
 * - The second array contains the count of nodes for each polyline. */
export interface StreamlinePolylineSetPatch extends Patch {
  /** Indicates whether a polyline is closed.
   *
   * If closed, then the interval count for that polyline is equal to the node count.
   *
   * If open, then the interval count for that polyline is one less than the node count. */
  ClosedPolylines: AbstractBooleanArray;
  /** @integer Total number of intervals.
   *
   * BUSINESS RULE: Should be equal to the sum of the count of intervals per polyline. */
  IntervalCount: number;
  IntervalGridCells?: IntervalGridCells;
  /** @integer Total number of nodes.
   *
   * BUSINESS RULE: Should be equal to the sum of the number of nodes per polyline */
  NodeCount: number;
  /** The first number in the list defines the node count for the first polyline in the polyline set patch.
   * The second number in the list defines the node count for the second polyline in the polyline set patch.
   * etc. */
  NodeCountPerPolyline: AbstractIntegerArray;
}

/** The information that allows you to locate, on one or several grids (existing or planned), the intersection of volume (cells) and surface (faces) elements with a wellbore trajectory (existing or planned). */
export interface StreamlineWellbores extends BaseType {
  /** Size of array = LineCount.
   *
   * Null values of -1 signify that that line does not initiate at a injector, e.g., it may come from fluid expansion or an aquifer. */
  InjectorPerLine: AbstractIntegerArray;
  /** Size of array = LineCount.
   *
   * Null values of -1 signify that that line does not terminate at a producer, e.g., it may approach a stagnation area.
   *
   * BUSINESS RULE: The cell count must equal the number of non-null entries in this array. */
  ProducerPerLine: AbstractIntegerArray;
  WellboreTrajectoryRepresentation: eml20.DataObjectReference[];
}

/** Used to store explicit string values, i.e., values that are not double, boolean or integers. The datatype of the values will be identified by means of the HDF5 API. */
export interface StringHdf5Array extends AbstractValueArray {
  /** Reference to HDF5 array of integer or double */
  Values: eml20.Hdf5Dataset;
}

/** Defines an element inside a string-to-integer lookup table. */
export interface StringLookup extends BaseType {
  /** @integer The corresponding integer value.
   * This value is used in HDF5 instead of the string value.
   * The value of null integer value must be reserved for NULL.
   * The size of this value is constrained by the size of the format used in HDF5, */
  Key: number;
  /** A string value. Output from the lookup table. */
  Value: string;
}

/** Parameter containing a string value. */
export interface StringParameter extends AbstractActivityParameter {
  Value: string;
}

/** SubnodeNodeObject is used to specify the node object that supports the subnodes. This determines the number of nodes per subnode and the continuity of the associated geometry or property. For instance, for hexahedral cells, cell indicates a fixed value of 8, while for an unstructured column layer grid, cell indicates that this count varies from column to column. */
export type SubnodeNodeObject = "cell" | "face" | "edge";

/** Each patch of subnodes is defined independently of the others. Number of nodes per object is determined by the subnode kind. */
export interface SubnodePatch extends Patch {
  /** Node weights for each subnode. Count of nodes per subnode is known for each specific subnode construction.
   *
   * Data order consists of all the nodes for each subnode in turn. For example, if uniform and stored as a multi-dimensional array, the node index cycles first.
   *
   * BUSINESS RULE: Weights must be non-negative.
   *
   * BUSINESS RULE: Length of array must be consistent with the sum of nodeCount x subnodeCount per object, e.g., for 3 subnodes per edge (uniform), there are 6 weights. */
  NodeWeightsPerSubnode: AbstractValueArray;
  SubnodeNodeObject: SubnodeNodeObject;
}

/** Finite element subnode topology for an unstructured cell can be either variable or uniform, but not columnar. */
export interface SubnodeTopology extends BaseType {
  UniformSubnodes?: UniformSubnodePatch[];
  VariableSubnodes?: VariableSubnodePatch[];
}

/** Each sub-representation patch has its own list of representation indices, drawn from the supporting representation.
 *
 * If a list of pairwise elements is required, use two representation indices. The count of elements is defined in SubRepresenationPatch.
 *
 * Optional additional grid topology is available for grid representations. */
export interface SubRepresentationPatch extends Patch1d {
  ElementIndices: ElementIndices[];
}

/** Indicates the various roles that a surface topology can have. */
export type SurfaceRole = "map" | "pick";

/** Enumeration of the types of tectonic boundaries. */
export type TectonicBoundaryKind = "fault" | "fracture";

/** List of three 3D points. */
export interface ThreePoint3d extends BaseType {
  Point3d: Point3d[];
}

/** Enumerations that characterize the throw of the fault interpretation. */
export type ThrowKind =
  | "reverse"
  | "normal"
  | "thrust"
  | "strike and slip"
  | "scissor"
  | "variable";

/** Describes the geometry of a tilted (or potentially not tilted) plane from three points. */
export interface TiltedPlaneGeometry extends AbstractPlaneGeometry {
  Plane: ThreePoint3d[];
}

/** Index into a time series. Used to specify time. (Not to be confused with time step.) */
export interface TimeIndex extends BaseType {
  /** @integer The index of the time in the time series. */
  Index: number;
  TimeSeries: eml20.DataObjectReference;
}

/** Parameter containing a time index value. */
export interface TimeIndexParameter extends AbstractActivityParameter {
  TimeIndex: TimeIndex;
}

export interface TimeIndexParameterKey extends AbstractParameterKey {
  TimeIndex: TimeIndex;
}

/** Indices
 * into a time series. Used to specify time. (Not to be confused with time step.) */
export interface TimeIndices extends BaseType {
  /** Simulation time step for each time index */
  SimulatorTimeStep?: AbstractIntegerArray;
  /** @integer Number of indices */
  TimeIndexCount: number;
  /** @integer The index of the start time in the time series, if not zero. */
  TimeIndexStart?: number;
  TimeSeries: eml20.DataObjectReference;
  /** When UseInterval is true, the values are associated with each time intervals between two consecutive time entries instead of each individual time entry. As a consequence the dimension of the value array corresponding to the time series is the number of entry in the series minus one. */
  UseInterval: boolean;
}

/** Geological time during which a geological event (e.g., deposition, erosion, fracturation, faulting, intrusion) occurred.
 *
 * BUSINESS RULE: All rock features that are present in the global chronostratigraphic column feature must have a time interval. */
export interface TimeInterval extends BaseType {
  ChronoBottom: eml20.DataObjectReference;
  ChronoTop: eml20.DataObjectReference;
}

/** Indicates that a time series has the associated time series as a parent, i.e., that the series continues from the parent time series. */
export interface TimeSeriesParentage extends BaseType {
  /** Used to indicate that a time series overlaps with its parent time series, e.g., as may be done for simulation studies, where the end state of one calculation is the initial state of the next. */
  HasOverlap: boolean;
  ParentTimeIndex: TimeIndex;
}

/** Indicates that the collection of properties shares this time relationship, if any. */
export type TimeSetKind = "single time" | "equivalent times" | "not a time set";

/** Time */
export interface Timestamp extends BaseType {
  /** A date which can be represented according to the W3CDTF format. */
  DateTime: Date;
  /** @integer Indicates that the dateTime attribute must be translated according to this value. */
  YearOffset?: number;
}

/** Patch made of triangles, where the number of triangles is given by the patch count.
 * BUSINESS RULE: Within a patch, all the triangles must be contiguous.
 *
 * The patch contains:
 *
 * - Number of nodes within the triangulation and their locations.
 * - 2D array describing the topology of the triangles.
 *
 * Two triangles that are connected may be in different patches. */
export interface TrianglePatch extends Patch1d {
  Geometry: PointGeometry;
  /** @integer Number of nodes */
  NodeCount: number;
  SplitEdgePatch?: EdgePatch[];
  /** The triangles are a 2D array of non-negative integers with the
   * dimensions 3 x numTriangles. */
  Triangles: AbstractIntegerArray;
}

/** Truncation definitions for the truncated and split cells.
 *
 * BUSINESS RULE: Patch Index must be positive since a patch index of 0 refers to the fundamental column layer coordinate line nodes and cells. */
export interface TruncationCellPatch extends Patch {
  /** Local cell face index for those faces which are retained from the parent cell in the definition of the truncation cell.
   *
   * The use of a local cell face index, e.g., 0...5 for an IJK cell, can be used even if the face indices have not been defined. */
  LocalFacesPerCell: ResqmlJaggedArray;
  /** Definition of the truncation faces is in terms of an ordered list of nodes. Node indexing is EXTENDED, i.e., is based on the list of untruncated grid nodes (always first) plus the split nodes (if any) and the truncation face nodes. Relative order of split nodes and truncation face nodes is set by the pillar indices. */
  NodesPerTruncationFace: ResqmlJaggedArray;
  /** Parent cell index for each of the truncation cells.
   *
   * BUSINESS RULE: Size must match truncationCellCount */
  ParentCellIndices: AbstractIntegerArray;
  /** @integer Number of polyhedral cells created by truncation. Must be positive. Note: Parent cells are replace */
  TruncationCellCount: number;
  /** Boolean mask used to indicate which truncation cell faces have an outwardly directed normal, following a right hand rule. Data size and order follows the truncationFacesPerCell list-of-lists. */
  TruncationCellFaceIsRightHanded: AbstractBooleanArray;
  /** @integer Number of additional faces required for the split and truncation construction. The construction does not modify existing face definitions, but instead uses these new faces to redefine the truncated cell geometry. Must be positive.
   *
   * These faces are added to the enumeration of faces for the grid */
  TruncationFaceCount: number;
  /** Truncation face index for the additional cell faces which are required to complete the definition of the truncation cell.
   *
   * The resulting local cell face index follows the local faces per cell list, followed by the truncation faces in the order within the list-of-lists constructions. */
  TruncationFacesPerCell: ResqmlJaggedArray;
  /** @integer Number of additional nodes required for the truncation construction. Must be positive. Uses a separate enumeration and does not increase the number of nodes, except as noted below. */
  TruncationNodeCount: number;
}

/** Use this subnode construction if the number of subnodes is the same for every object, e.g., 3 subnodes per edge for all edges. */
export interface UniformSubnodePatch extends SubnodePatch {
  /** @integer Number of subnodes per object, with the same number for each of this object kind in the grid. */
  SubnodeCountPerObject: number;
}

/** Indexable elements for unstructured cell grids and patches. */
export type UnstructuredCellIndexableElements =
  | "cells"
  | "edges"
  | "faces"
  | "faces per cell"
  | "hinge node faces"
  | "nodes"
  | "nodes per cell"
  | "nodes per edge"
  | "nodes per face"
  | "subnodes";

/** Column edges are used to construct the index for faces. For unstructured column layer grids, the column edge indices must be defined explicitly. Column edges are not required to describe lowest order grid geometry, but may be needed for higher order geometries or properties. */
export interface UnstructuredColumnEdges extends BaseType {
  /** @integer Number of unstructured column edges in this grid. Must be positive. */
  Count: number;
  /** Definition of the column edges in terms of the pillars per column edge. Pillar count per edge is usually 2, but the list-of-lists construction is used to allow column edges to be defined by more than 2 pillars. */
  PillarsPerColumnEdge: ResqmlJaggedArray;
}

/** Description of the geometry of an unstructured column layer grid, e.g., parity and pinch, together with its supporting topology.
 *
 * Unstructured column layer cell geometry is derived from column layer cell geometry and hence is based upon nodes on coordinate lines.
 *
 * Geometry is contained within the representation of a grid. */
export interface UnstructuredColumnLayerGridGeometry
  extends AbstractColumnLayerGridGeometry {
  ColumnEdges?: UnstructuredColumnEdges;
  /** List of columns which are right handed. Right handedness is evaluated following the pillar order and the K-direction tangent vector for each column. */
  ColumnIsRightHanded: AbstractBooleanArray;
  ColumnShape: ColumnShape;
  /** @integer Number of pillars in the grid. Must be positive. Pillars are used to describe the shape of the columns in the grid. */
  PillarCount: number;
  /** List of pillars for each column. The pillars define the corners of each column.
   *
   * The number of pillars per column can be obtained from the offsets in the first list of list array.
   *
   * BUSINESS RULE: The length of the first array in the list of list construction should equal the columnCount. */
  PillarsPerColumn: ResqmlJaggedArray;
}

/** Indexable elements for unstructured column layer grids and patches. */
export type UnstructuredColumnLayerIndexableElements =
  | "cells"
  | "column edges"
  | "columns"
  | "coordinate lines"
  | "edges"
  | "edges per column"
  | "faces"
  | "faces per cell"
  | "hinge node faces"
  | "interval edges"
  | "intervals"
  | "layers"
  | "nodes"
  | "nodes per cell"
  | "nodes per edge"
  | "nodes per face"
  | "pillars"
  | "subnodes";

/** Description of the geometry of an unstructured cell grid, which includes geometric characteristics, e.g., cell face parity, and supporting topology.
 *
 * Each grid cell is defined by a (signed) list of cell faces. Each cell face is defined by a list of nodes. */
export interface UnstructuredGridGeometry extends AbstractGridGeometry {
  /** Boolean mask used to indicate which cell faces have an outwardly directed normal following a right hand rule. Array length is the sum of the cell face count per cell, and the data follows the order of the faces per cell resqml list-of-lists. */
  CellFaceIsRightHanded: AbstractBooleanArray;
  CellShape: CellShape;
  /** @integer Total number of faces in the grid. Must be positive. */
  FaceCount: number;
  /** List of faces per cell. face count per cell can be obtained from the offsets in the first list of list array.
   *
   * BUSINESS RULE: cellCount must match the length of the first list of list array. */
  FacesPerCell: ResqmlJaggedArray;
  HingeNodeFaces?: UnstructuredGridHingeNodeFaces;
  /** @integer Total number of nodes in the grid. Must be positive. */
  NodeCount: number;
  /** List of nodes per face. node count per face can be obtained from the offsets in the first list of list array.
   *
   * BUSINESS RULE: faceCount must match the length of the first list of list array. */
  NodesPerFace: ResqmlJaggedArray;
  SubnodeTopology?: UnstructuredSubnodeTopology;
}

/** Hinge nodes define a triangulated interpolation on a cell face. In practice, they arise on the K faces of column layer cells and are used to add additional geometric resolution to the shape of the cell. The specification of triangulated interpolation also uniquely defines the interpolation schema on the cell face, and hence the cell volume.
 *
 * For an unstructured cell grid, the hinge node faces need to be defined explicitly.
 *
 * This hinge node faces object is optional and is only expected to be used if the hinge node faces higher order grid point attachment arises. Hinge node faces are not supported for property attachment. Instead use a subrepresentation or an attachment kind of faces or faces per cell.
 *
 * BUSINESS RULE: Each cell must have either 0 or 2 hinge node faces, so that the two hinge nodes for the cell may be used to define a cell center line and a cell thickness. */
export interface UnstructuredGridHingeNodeFaces extends BaseType {
  /** @integer Number of K faces. This count must be positive. */
  Count: number;
  /** List of faces to be identified as K faces for hinge node geometry attachment.
   *
   * BUSINESS RULE: Array length equals K face count. */
  FaceIndices: AbstractIntegerArray;
}

/** If edge subnodes are used, then edges must be defined. If cell subnodes are used, nodes per cell must be defined. */
export interface UnstructuredSubnodeTopology extends SubnodeTopology {
  Edges?: Edges;
  NodesPerCell?: NodesPerCell;
}

/** If the number of subnodes per object are variable for each object, use this subnode construction. */
export interface VariableSubnodePatch extends SubnodePatch {
  /** Indices of the selected objects */
  ObjectIndices: AbstractIntegerArray;
  /** Number of subnodes per selected object. */
  SubnodeCountPerSelectedObject: AbstractIntegerArray;
}

/** The volume within a shell or envelope. */
export interface VolumeRegion extends BaseType {
  ExternalShell: VolumeShell;
  InternalShells?: VolumeShell[];
  /** @integer Index of the patch */
  PatchIndex: number;
  Represents: eml20.DataObjectReference;
}

/** The shell or envelope of a structural, stratigraphic, or fluid unit. */
export interface VolumeShell extends BaseType {
  MacroFaces: OrientedMacroFace[];
  ShellUid: string;
}

/** The elements on a wellbore frame that may be indexed. */
export type WellboreFrameIndexableElements = "intervals" | "nodes" | "cells";

/** Representation of a wellbore marker that is located along a wellbore trajectory, one for each MD value in the wellbore frame.
 *
 * BUSINESS RULE: Ordering of the wellbore markers must match the ordering of the nodes in the wellbore marker frame representation */
export interface WellboreMarker extends AbstractResqmlDataObject {
  FluidContact?: FluidContact;
  FluidMarker?: FluidMarker;
  GeologicBoundaryKind?: GeologicBoundaryKind;
  Interpretation?: eml20.DataObjectReference;
  /** Optional WITSML wellbore reference of the well marker frame. */
  WitsmlFormationMarker?: eml20.DataObjectReference;
}

/** For a wellbore trajectory in a multi-lateral well, indicates the MD of the kickoff point where the trajectory begins and the corresponding MD of the parent trajectory. */
export interface WellboreTrajectoryParentIntersection extends BaseType {
  KickoffMd: number;
  ParentMd: number;
  ParentTrajectory: eml20.DataObjectReference;
}

/** Reference to the WITSML wellbore that this wellbore feature is based on. */
export interface WitsmlWellboreReference extends BaseType {
  WitsmlWell: eml20.DataObjectReference;
  WitsmlWellbore: eml20.DataObjectReference;
}

export interface document extends BaseType {
  Activity: obj_Activity;
  ActivityTemplate: obj_ActivityTemplate;
  BlockedWellboreRepresentation: obj_BlockedWellboreRepresentation;
  BoundaryFeature: obj_BoundaryFeature;
  BoundaryFeatureInterpretation: obj_BoundaryFeatureInterpretation;
  CategoricalProperty: obj_CategoricalProperty;
  CategoricalPropertySeries: obj_CategoricalPropertySeries;
  CommentProperty: obj_CommentProperty;
  CommentPropertySeries: obj_CommentPropertySeries;
  ContinuousProperty: obj_ContinuousProperty;
  ContinuousPropertySeries: obj_ContinuousPropertySeries;
  DeviationSurveyRepresentation: obj_DeviationSurveyRepresentation;
  DiscreteProperty: obj_DiscreteProperty;
  DiscretePropertySeries: obj_DiscretePropertySeries;
  DoubleTableLookup: obj_DoubleTableLookup;
  EarthModelInterpretation: obj_EarthModelInterpretation;
  FaultInterpretation: obj_FaultInterpretation;
  FluidBoundaryFeature: obj_FluidBoundaryFeature;
  FrontierFeature: obj_FrontierFeature;
  GenericFeatureInterpretation: obj_GenericFeatureInterpretation;
  GeneticBoundaryFeature: obj_GeneticBoundaryFeature;
  GeobodyBoundaryInterpretation: obj_GeobodyBoundaryInterpretation;
  GeobodyFeature: obj_GeobodyFeature;
  GeobodyInterpretation: obj_GeobodyInterpretation;
  GeologicUnitFeature: obj_GeologicUnitFeature;
  GeologicUnitInterpretation: obj_GeologicUnitInterpretation;
  GlobalChronostratigraphicColumn: obj_GlobalChronostratigraphicColumn;
  GpGridRepresentation: obj_GpGridRepresentation;
  Grid2dRepresentation: obj_Grid2dRepresentation;
  Grid2dSetRepresentation: obj_Grid2dSetRepresentation;
  GridConnectionSetRepresentation: obj_GridConnectionSetRepresentation;
  HorizonInterpretation: obj_HorizonInterpretation;
  IjkGridRepresentation: obj_IjkGridRepresentation;
  LocalDepth3dCrs: obj_LocalDepth3dCrs;
  LocalGridSet: obj_LocalGridSet;
  LocalTime3dCrs: obj_LocalTime3dCrs;
  MdDatum: obj_MdDatum;
  NonSealedSurfaceFrameworkRepresentation: obj_NonSealedSurfaceFrameworkRepresentation;
  OrganizationFeature: obj_OrganizationFeature;
  PlaneSetRepresentation: obj_PlaneSetRepresentation;
  PointSetRepresentation: obj_PointSetRepresentation;
  PointsProperty: obj_PointsProperty;
  PolylineRepresentation: obj_PolylineRepresentation;
  PolylineSetRepresentation: obj_PolylineSetRepresentation;
  PropertyKind: obj_PropertyKind;
  PropertySet: obj_PropertySet;
  RedefinedGeometryRepresentation: obj_RedefinedGeometryRepresentation;
  RepresentationIdentitySet: obj_RepresentationIdentitySet;
  RepresentationSetRepresentation: obj_RepresentationSetRepresentation;
  RockFluidOrganizationInterpretation: obj_RockFluidOrganizationInterpretation;
  RockFluidUnitFeature: obj_RockFluidUnitFeature;
  RockFluidUnitInterpretation: obj_RockFluidUnitInterpretation;
  SealedSurfaceFrameworkRepresentation: obj_SealedSurfaceFrameworkRepresentation;
  SealedVolumeFrameworkRepresentation: obj_SealedVolumeFrameworkRepresentation;
  SeismicLatticeFeature: obj_SeismicLatticeFeature;
  SeismicLineFeature: obj_SeismicLineFeature;
  SeismicLineSetFeature: obj_SeismicLineSetFeature;
  StratigraphicColumn: obj_StratigraphicColumn;
  StratigraphicColumnRankInterpretation: obj_StratigraphicColumnRankInterpretation;
  StratigraphicOccurrenceInterpretation: obj_StratigraphicOccurrenceInterpretation;
  StratigraphicUnitFeature: obj_StratigraphicUnitFeature;
  StratigraphicUnitInterpretation: obj_StratigraphicUnitInterpretation;
  StreamlinesFeature: obj_StreamlinesFeature;
  StreamlinesRepresentation: obj_StreamlinesRepresentation;
  StringTableLookup: obj_StringTableLookup;
  StructuralOrganizationInterpretation: obj_StructuralOrganizationInterpretation;
  SubRepresentation: obj_SubRepresentation;
  TectonicBoundaryFeature: obj_TectonicBoundaryFeature;
  TimeSeries: obj_TimeSeries;
  TriangulatedSetRepresentation: obj_TriangulatedSetRepresentation;
  TruncatedIjkGridRepresentation: obj_TruncatedIjkGridRepresentation;
  TruncatedUnstructuredColumnLayerGridRepresentation: obj_TruncatedUnstructuredColumnLayerGridRepresentation;
  UnstructuredColumnLayerGridRepresentation: obj_UnstructuredColumnLayerGridRepresentation;
  UnstructuredGridRepresentation: obj_UnstructuredGridRepresentation;
  WellboreFeature: obj_WellboreFeature;
  WellboreFrameRepresentation: obj_WellboreFrameRepresentation;
  WellboreInterpretation: obj_WellboreInterpretation;
  WellboreMarkerFrameRepresentation: obj_WellboreMarkerFrameRepresentation;
  WellboreTrajectoryRepresentation: obj_WellboreTrajectoryRepresentation;
}
export const document: document;
