import * as Primitive from "../../../xml-primitives";
import * as eml from "./commonv2";

// Source files:
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/Features.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/Geometry.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/GraphicalInformationObject.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/Grids.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/Interpretations.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/Properties.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/Representations.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/ResqmlAllObjects.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/Seismic.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/Streamlines.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/Structural.xsd
// http://172.21.32.1:3000/resqml/v2.2/xsd_schemas/Wells.xsd

declare module "./commonv2" {
  export interface _AbstractDataObjectProxyType {
    BlockedWellboreRepresentation?: BlockedWellboreRepresentation;
    BooleanProperty?: BooleanProperty;
    BoundaryFeature?: BoundaryFeature;
    BoundaryFeatureInterpretation?: BoundaryFeatureInterpretation;
    CmpLineFeature?: CmpLineFeature;
    ColorMapDictionary?: ColorMapDictionary;
    CommentProperty?: CommentProperty;
    ContinuousColorMap?: ContinuousColorMap;
    ContinuousProperty?: ContinuousProperty;
    CulturalFeature?: CulturalFeature;
    DiscreteColorMap?: DiscreteColorMap;
    DiscreteProperty?: DiscreteProperty;
    EarthModelInterpretation?: EarthModelInterpretation;
    FaultInterpretation?: FaultInterpretation;
    FluidBoundaryInterpretation?: FluidBoundaryInterpretation;
    GenericFeatureInterpretation?: GenericFeatureInterpretation;
    GeobodyBoundaryInterpretation?: GeobodyBoundaryInterpretation;
    GeobodyInterpretation?: GeobodyInterpretation;
    GeologicUnitInterpretation?: GeologicUnitInterpretation;
    GeologicUnitOccurrenceInterpretation?: GeologicUnitOccurrenceInterpretation;
    GpGridRepresentation?: GpGridRepresentation;
    Grid2dRepresentation?: Grid2dRepresentation;
    GridConnectionSetRepresentation?: GridConnectionSetRepresentation;
    HorizonInterpretation?: HorizonInterpretation;
    IjkGridRepresentation?: IjkGridRepresentation;
    LocalGridSet?: LocalGridSet;
    Model?: Model;
    NonSealedSurfaceFrameworkRepresentation?: NonSealedSurfaceFrameworkRepresentation;
    PlaneSetRepresentation?: PlaneSetRepresentation;
    PointSetRepresentation?: PointSetRepresentation;
    PointsProperty?: PointsProperty;
    PolylineRepresentation?: PolylineRepresentation;
    PolylineSetRepresentation?: PolylineSetRepresentation;
    RepresentationIdentitySet?: RepresentationIdentitySet;
    RepresentationSetRepresentation?: RepresentationSetRepresentation;
    RockFluidOrganizationInterpretation?: RockFluidOrganizationInterpretation;
    RockFluidUnitInterpretation?: RockFluidUnitInterpretation;
    RockVolumeFeature?: RockVolumeFeature;
    SealedSurfaceFrameworkRepresentation?: SealedSurfaceFrameworkRepresentation;
    SealedVolumeFrameworkRepresentation?: SealedVolumeFrameworkRepresentation;
    Seismic2dPostStackRepresentation?: Seismic2dPostStackRepresentation;
    Seismic3dPostStackRepresentation?: Seismic3dPostStackRepresentation;
    SeismicLatticeFeature?: SeismicLatticeFeature;
    SeismicLineSetFeature?: SeismicLineSetFeature;
    SeismicWellboreFrameRepresentation?: SeismicWellboreFrameRepresentation;
    ShotPointLineFeature?: ShotPointLineFeature;
    StratigraphicColumn?: StratigraphicColumn;
    StratigraphicColumnRankInterpretation?: StratigraphicColumnRankInterpretation;
    StratigraphicUnitInterpretation?: StratigraphicUnitInterpretation;
    StreamlinesFeature?: StreamlinesFeature;
    StreamlinesRepresentation?: StreamlinesRepresentation;
    StructuralOrganizationInterpretation?: StructuralOrganizationInterpretation;
    SubRepresentation?: SubRepresentation;
    TriangulatedSetRepresentation?: TriangulatedSetRepresentation;
    TruncatedIjkGridRepresentation?: TruncatedIjkGridRepresentation;
    TruncatedUnstructuredColumnLayerGridRepresentation?: TruncatedUnstructuredColumnLayerGridRepresentation;
    UnstructuredColumnLayerGridRepresentation?: UnstructuredColumnLayerGridRepresentation;
    UnstructuredGridRepresentation?: UnstructuredGridRepresentation;
    WellboreFeature?: WellboreFeature;
    WellboreFrameRepresentation?: WellboreFrameRepresentation;
    WellboreInterpretation?: WellboreInterpretation;
    WellboreIntervalSet?: WellboreIntervalSet;
    WellboreTrajectoryRepresentation?: WellboreTrajectoryRepresentation;
  }
}
interface BaseType {
  _exists: boolean;
  _namespace: string;
  $type?: string;
}
interface _AbstractColorMap extends eml._AbstractObject {
  AboveMaxColor?: HsvColor;
  BelowMinColor?: HsvColor;
  NullColor?: HsvColor;
}
export interface AbstractColorMap extends _AbstractColorMap { }

/** Description of the geometry of a column layer grid, e.g., parity and pinch, together with its supporting topology.
 *
 * - Column layer grid cell geometry is based upon nodes on coordinate lines.
 * - Geometry is contained within the representation of a grid.
 * - Point Geometry is that of the column layer coordinate line nodes. Coordinate line nodes for all of the coordinate lines, with NKL nodes per line.
 * - The numbering of these lines follow the pillar numbering if no split coordinate lines are present.
 * - The unsplit coordinate lines share an indexing with the pillars. The numbering of the remaining lines are defined in the columnsPerSplitCoordinateLine list-of-lists if split coordinate lines are present.
 * - Pillar numbering is either 1D or 2D, so for unfaulted grids, the node dimensions may follow either a 2D or 3D array. Otherwise the nodes will be 2D.
 * - In HDF5 nodes are stored as separate X, Y, Z, values, so add another dimension (size=3) which is fastest in HDF5. */
interface _AbstractColumnLayerGridGeometry extends _AbstractGridGeometry {
  /** Indicator that a cell has a defined geometry. This attribute is grid metadata. If the indicator shows that the cell geometry is NOT defined, then this attribute overrides any other node geometry specification.
   *
   * Array index is 2D/3D. */
  CellGeometryIsDefined?: eml.AbstractBooleanArray;
  ColumnLayerSplitCoordinateLines?: ColumnLayerSplitCoordinateLines;
  ColumnLayerSubnodeTopology?: ColumnLayerSubnodeTopology;
  KDirection: KDirection;
  /** Optional indicator that two adjacent nodes on a coordinate line are colocated. This is considered grid metadata, and is intended to over-ride any geometric comparison of node locations.
   *
   * Array index follows #CoordinateLines x (NKL-1). */
  NodeIsColocatedInKDirection?: eml.AbstractBooleanArray;
  /** Optional indicator that two adjacent nodes on the KEDGE of a cell are colocated. This is considered grid metadata, and is intended to over-ride any geometric comparison of node locations.
   *
   * Array index follows #EdgesPerColumn x NKL for unstructured column layer grids and 4 x NI x NJ x NKL for IJK grids. */
  NodeIsColocatedOnKEdge?: eml.AbstractBooleanArray;
  /** Indicator that a pillar has at least one node with a defined cell geometry. This is considered grid metadata. If the indicator does not indicate that the pillar geometry is defined, then this over-rides any other node geometry specification.
   *
   * Array index follows #Pillars and so may be either 2D or 1D. */
  PillarGeometryIsDefined: eml.AbstractBooleanArray;
  PillarShape: PillarShape;
  SplitColumnEdges?: SplitColumnEdges;
  SplitNodePatch?: SplitNodePatch;
}
export interface AbstractColumnLayerGridGeometry
  extends _AbstractColumnLayerGridGeometry { }

/** Abstract class that includes IJK grids and unstructured column layer grids. All column layer grids have a layer index K=1,...,NK or K0=0,...,NK-1.
 *
 * Cell geometry is characterized by nodes on coordinate lines. */
interface _AbstractColumnLayerGridRepresentation
  extends _AbstractGridRepresentation {
  /** Number of layers in the grid. Must be positive. */
  Nk: eml.PositiveLong;
}
export interface AbstractColumnLayerGridRepresentation
  extends _AbstractColumnLayerGridRepresentation { }

/** The parent class of an atomic, linear, or surface geologic contact description.
 *
 * When the contact is between two surface representations (e.g., fault/fault, horizon/fault, horizon/horizon), then the contact is a line.
 * When the contact is between two volume representations (stratigraphic unit/stratigraphic unit), then the contact is a surface.
 * A contact interpretation can be associated with other contact interpretations in an organization interpretation.
 * To define a contact representation, you must first define a contact interpretation. */
interface _AbstractContactInterpretationPart extends BaseType {
  PartOf?: eml.DataObjectReference;
}
export interface AbstractContactInterpretationPart
  extends _AbstractContactInterpretationPart { }

/** Something that has physical existence at some point during the exploration, development, production or abandonment of a reservoir. For example: It can be a boundary, a rock volume, a basin area, but also extends to a drilled well, a drilling rig, an injected or produced fluid, or a 2D, 3D, or 4D seismic survey.
 * Features are divided into these categories: geologic or technical. */
interface _AbstractFeature extends eml._AbstractObject {
  IsWellKnown: boolean;
}
export interface AbstractFeature extends _AbstractFeature { }

/** The main class that contains all of the other feature interpretations included in an interpreted model. */
interface _AbstractFeatureInterpretation extends eml._AbstractObject {
  /** An enumeration that specifies in which domain the interpretation of an AbstractFeature has been performed: depth, time, mixed (= depth + time ) */
  Domain?: Domain;
  HasOccurredDuring?: AbstractTimeInterval;
  InterpretedFeature: eml.DataObjectReference;
}
export interface AbstractFeatureInterpretation
  extends _AbstractFeatureInterpretation { }

/** The main class that defines the relationships between the stratigraphic units and provides the stratigraphic hierarchy of the Earth.
 *
 * BUSINESS RULE: A stratigraphic organization must be in a ranked order from a lower rank to an upper rank. For example, it is possible to find previous unit containment relationships between several ranks. */
interface _AbstractGeologicUnitOrganizationInterpretation
  extends _AbstractOrganizationInterpretation {
  AscendingOrderingCriteria: OrderingCriteria;
}
export interface AbstractGeologicUnitOrganizationInterpretation
  extends _AbstractGeologicUnitOrganizationInterpretation { }

/** The base class for all geometric values, which is always associated with a representation. */
interface _AbstractGeometry extends BaseType {
  LocalCrs: eml.DataObjectReference;
  TimeIndex?: eml.TimeIndex;
}
export interface AbstractGeometry extends _AbstractGeometry { }

/** Some general attributes for graphical information applied on some particular indexable elements. */
interface _AbstractGraphicalInformationForIndexableElement extends BaseType {
  /** Index into the graphical information set. */
  ActiveAlphaInformationIndex?: number;
  /** Index into the graphical information set */
  ActiveAnnotationInformationIndex?: number;
  /** Index into the graphical information set */
  ActiveColorInformationIndex?: number;
  /** Index into the graphical information set */
  ActiveSizeInformationIndex?: number;
  /** It multiplies the opacity of the color map.
   * If defined, then AlphaInformation cannot be defined. */
  ConstantAlpha?: number;
  ConstantColor?: HsvColor;
  /** Indicates if this graphical information is intended to be visible or only stored/transferred. */
  IsVisible: boolean;
  /** If both ConstantAlpha and either ConstantColor or ColorInformation are defined, then setting this field to true will indicate that the ConstantAlpha must be used instead of the ConstantColor or ColorInformation alpha(s). Else the product of the two alpha should be used. */
  OverwriteColorAlpha?: boolean;
}
export interface AbstractGraphicalInformationForIndexableElement
  extends _AbstractGraphicalInformationForIndexableElement { }

/** Grid geometry described by means of points attached to nodes and additional optional points which may be attached to other indexable elements of the grid representation. */
interface _AbstractGridGeometry extends _PointGeometry {
  AdditionalGridPoints?: AdditionalGridPoints[];
}
export interface AbstractGridGeometry extends _AbstractGridGeometry { }

/** Abstract class for all grid representations. */
interface _AbstractGridRepresentation extends _AbstractRepresentation {
  CellFluidPhaseUnits?: CellFluidPhaseUnits;
  IntervalStratigraphicUnits?: IntervalStratigraphicUnits;
  ParentWindow?: AbstractParentWindow;
}
export interface AbstractGridRepresentation
  extends _AbstractGridRepresentation { }

/** The main class used to group features into meaningful units as a step in working towards the goal of building an earth model (the organization of all other organizations in RESQML).
 * An organization interpretation:
 * - Is typically comprised of one stack of its contained elements.
 * - May be built on other organization interpretations.
 *
 * Typically contains:
 * - contacts between the elements of this stack among themselves.
 * - contacts between the stack elements and other organization elements. */
interface _AbstractOrganizationInterpretation
  extends _AbstractFeatureInterpretation {
  ContactInterpretation?: AbstractContactInterpretationPart[];
}
export interface AbstractOrganizationInterpretation
  extends _AbstractOrganizationInterpretation { }

/** Defines an array of parametric lines.
 *
 * The array size is obtained from context. In the current schema, this may be as simple as a 1D array (#Lines=count) or a 2D array #Lines = NIL x NJL for an IJK grid representation. */
interface _AbstractParametricLineArray extends BaseType { }
export interface AbstractParametricLineArray
  extends _AbstractParametricLineArray { }

/** The abstract class for defining a single parametric line. */
interface _AbstractParametricLineGeometry extends _AbstractGeometry { }
export interface AbstractParametricLineGeometry
  extends _AbstractParametricLineGeometry { }

/** Parent window specification, organized according to the topology of the parent grid. In addition to a window specification, for grids with I, J, and/or K coordinates, the parentage construction includes a regridding description that covers grid refinement, coarsening, or any combination of the two. */
interface _AbstractParentWindow extends BaseType {
  CellOverlap?: CellOverlap;
}
export interface AbstractParentWindow extends _AbstractParentWindow { }

/** The abstract class for all geometric values defined by planes. */
interface _AbstractPlaneGeometry extends _AbstractGeometry { }
export interface AbstractPlaneGeometry extends _AbstractPlaneGeometry { }

/** The abstract class of 3D points implemented in a single fashion for the schema. Abstraction allows a variety of instantiations for efficiency or to implicitly provide additional geometric information about a data-object. For example, parametric points can be used to implicitly define a wellbore trajectory using an underlying parametric line, by the specification of the control points along the parametric line.
 *
 * The dimensionality of the array of 3D points is based on context within an instance. */
interface _AbstractPoint3dArray extends BaseType { }
export interface AbstractPoint3dArray extends _AbstractPoint3dArray { }

/** Base class for storing all property values on representations, except current geometry location.
 * Values attached to a given element can be either a scalar or a vector. The size of the vector is constant on all elements, and it is assumed that all elements of the vector have identical property types and share the same unit of measure. */
interface _AbstractProperty extends eml._AbstractObject {
  IndexableElement: eml.IndexableElement;
  /** Labels for each component of a vector or tensor property in a linearized way.
   * REMINDER: First (left) given dimension is slowest and last (right) given dimension is fastest. */
  LabelPerComponent?: eml.String64[];
  LocalCrs?: eml.DataObjectReference;
  /** Pointer to a PropertyKind.  The Energistics dictionary can be found at http://w3.energistics.org/energyML/data/common/v2.1/ancillary/PropertyKindDictionary_v2.1.0.xml. */
  PropertyKind: eml.DataObjectReference;
  /** Provide the list of indices corresponding to realizations number. For example, if a user wants to send the realization corresponding to p10, p20, ... he would write the array 10, 20, ...
   * If not provided, then the realization count (which could be 1) does not introduce a dimension to the multi-dimensional array storage. */
  RealizationIndices?: eml.AbstractIntegerArray;
  SupportingRepresentation: eml.DataObjectReference;
  Time?: eml.GeologicTime;
  TimeOrIntervalSeries?: eml.TimeOrIntervalSeries;
  /** The count of value in one dimension for each indexable element. It is ordered as the values are ordered in the data set. REMINDER: First (left) given dimension is slowest and last (right) given dimension is fastest. The top XML element is slower than the bottom. */
  ValueCountPerIndexableElement: eml.PositiveLong[];
}
export interface AbstractProperty extends _AbstractProperty { }

/** The parent class of all specialized digital descriptions, which may provide a representation of any kind of representable object such as interpretations, technical features, or WITSML wellbores. It may be either of these:
 * - based on a topology and contains the geometry of this digital description.
 * - based on the topology or the geometry of another representation.
 *
 * Not all representations require a defined geometry. For example, a defined geometry is not required for block-centered grids or wellbore frames. For representations without geometry, a software writer may provide null (NaN) values in the local 3D CRS, which is mandatory.
 *
 * TimeIndex is provided to describe time-dependent geometry. */
interface _AbstractRepresentation extends eml._AbstractObject {
  /** Optional element indicating a realization id (metadata). Used if the representation is created by a stochastic or Monte Carlo method. Representations with the same id are based on the same set of random values. */
  RealizationIndex?: eml.PositiveLong;
  /** BUSINESS RULE: The data object represented by the representation is either an interpretation or a technical feature. */
  RepresentedObject?: eml.DataObjectReference;
}
export interface AbstractRepresentation extends _AbstractRepresentation { }

/** Parent class that is used to associate horizon and fault representations to seismic 2D and seismic 3D technical features. It stores a 1-to-1 mapping between geometry coordinates (usually X, Y, Z) and trace or inter-trace positions on a seismic survey. */
interface _AbstractSeismicCoordinates extends BaseType {
  SeismicSupport: eml.DataObjectReference;
}
export interface AbstractSeismicCoordinates
  extends _AbstractSeismicCoordinates { }

/** Location of the line used in a 2D seismic acquisition.
 *
 * Defined by one lateral dimension: trace (lateral).
 *
 * To specify its location, the seismic feature can be associated with the seismic coordinates of the points of a representation.
 *
 * Represented by a PolylineRepresentation. */
interface _AbstractSeismicLineFeature extends _AbstractSeismicSurveyFeature {
  IsPartOf?: eml.DataObjectReference;
  TraceLabels?: eml.StringExternalArray;
}
export interface AbstractSeismicLineFeature
  extends _AbstractSeismicLineFeature { }

/** An organization of seismic lines. For the context of RESQML, a seismic survey does not refer to any vertical dimension information, but only areally at shot point locations or common midpoint gathers. The seismic traces, if needed by reservoir models, are transferred in an industry standard format such as SEGY.
 * RESQML supports these basic types of seismic surveys:
 * - seismic lattice (organization of the traces for the 3D acquisition and processing phases).
 * - seismic line (organization of the traces for the 2D acquisition and processing phases).
 * Additionally, these seismic lattices and seismic lines can be aggregated into sets. */
interface _AbstractSeismicSurveyFeature extends _AbstractTechnicalFeature { }
export interface AbstractSeismicSurveyFeature
  extends _AbstractSeismicSurveyFeature { }

/** Parent class of the sealed and non-sealed contact elements. */
interface _AbstractSurfaceFrameworkContact extends BaseType {
  /** The index of the contact.
   * Indicates identity of the contact in the surface framework context. It is used for contact identities and to find the interpretation of this particular contact. */
  Index: eml.NonNegativeLong;
}
export interface AbstractSurfaceFrameworkContact
  extends _AbstractSurfaceFrameworkContact { }

/** Parent class for a sealed or non-sealed surface framework representation. Each one instantiates a representation set representation.
 *
 * The difference between the sealed and non-sealed frameworks is that, in the non-sealed case, we do not have all of the contact representations, or we have all of the contacts but they are not all sealed. */
interface _AbstractSurfaceFrameworkRepresentation
  extends _RepresentationSetRepresentation {
  ContactIdentity?: ContactIdentity[];
}
export interface AbstractSurfaceFrameworkRepresentation
  extends _AbstractSurfaceFrameworkRepresentation { }

/** Parent class of structural surface representations, which can be bounded by an outer ring and has inner rings. These surfaces may consist of one or more patches. */
interface _AbstractSurfaceRepresentation extends _AbstractRepresentation {
  Boundaries?: PatchBoundaries[];
  SurfaceRole: SurfaceRole;
}
export interface AbstractSurfaceRepresentation
  extends _AbstractSurfaceRepresentation { }

/** Objects that exist by the action of humans. Examples include: wells and all they may contain, seismic surveys (surface, permanent water bottom), or injected fluid volumes. Because the decision to deploy such equipment is the result of studies or decisions by humans, technical features are usually not subject to the same kind of large changes in interpretation as geologic features. However, they are still subject to measurement error and other sources of uncertainty, and so still can be considered as subject to “interpretation”. */
interface _AbstractTechnicalFeature extends _AbstractFeature { }
export interface AbstractTechnicalFeature extends _AbstractTechnicalFeature { }

/** The abstract superclass for all RESQML time intervals. The super class that contains all types of intervals considered in geolog, including  those based on chronostratigraphy, the duration of geological events, and time intervals used in reservoir simulation (e.g., time step). */
interface _AbstractTimeInterval extends BaseType { }
export interface AbstractTimeInterval extends _AbstractTimeInterval { }

/** Abstract class for truncated IJK grids and truncated unstructured column layer grids. Each column layer grid class must have a defined geometry in which cells are truncated and additional split cells are defined. */
interface _AbstractTruncatedColumnLayerGridRepresentation
  extends _AbstractGridRepresentation {
  /** Number of layers in the grid. Must be positive. */
  Nk: eml.PositiveLong;
  TruncationCellPatch: TruncationCellPatch;
}
export interface AbstractTruncatedColumnLayerGridRepresentation
  extends _AbstractTruncatedColumnLayerGridRepresentation { }

/** Base class for property values. Each derived element provides specific property values, including point property in support of geometries. */
interface _AbstractValuesProperty extends _AbstractProperty {
  Facet?: eml.PropertyKindFacet[];
  /** If the rep has no explicit patch, use only 1 ValuesForPatch.  If the rep has > 1 explicit patch, use as many ValuesforPatch as patches of the rep. The ordering of ValuesForPatch matches the ordering of the patches in the xml document of the representation. */
  ValuesForPatch: eml.AbstractValueArray[];
}
export interface AbstractValuesProperty extends _AbstractValuesProperty { }

/** Used to activate and deactivate the referencing object at the times indicated.
 *
 * - If the activation object is not present, then the referencing object is always active.
 *
 * - If the activation object is present, then the referencing object is not active until activated. */
interface _Activation extends BaseType {
  /** The index in the time series at which the state of the referencing object is changed. Toggle changes state from inactive to active, or toggle changes state from active to inactive. */
  ActivationToggleIndices: eml.AbstractIntegerArray;
  TimeSeries: eml.DataObjectReference;
}
export interface Activation extends _Activation { }

/** Geometry given by means of points attached to additional elements of a grid. */
interface _AdditionalGridPoints extends BaseType {
  Attachment: GridGeometryAttachment;
  Points: AbstractPoint3dArray;
  /** Used to remove ambiguity in geometry attachment, if the attachment element is not sufficient. Usually required for subnodes and for the general purpose grid, but not otherwise. */
  RepresentationPatchIndex?: eml.NonNegativeLong;
}
export interface AdditionalGridPoints extends _AdditionalGridPoints { }

/** Additional grid topology and/or patches, if required, for indexable elements that otherwise do not have their topology defined within the grid representation. For example, column edges need to be defined if you want to have an enumeration for the faces of a column layer grid, but not otherwise. */
interface _AdditionalGridTopology extends BaseType {
  ColumnLayerSubnodeTopology?: ColumnLayerSubnodeTopology;
  SplitColumnEdges?: SplitColumnEdges;
  SplitEdges?: SplitEdges;
  SplitFaces?: SplitFaces;
  SplitNodePatch?: SplitNodePatch;
  UnstructuredColumnEdges?: UnstructuredColumnEdges;
  UnstructuredSubnodeTopology?: UnstructuredSubnodeTopology;
}
export interface AdditionalGridTopology extends _AdditionalGridTopology { }

/** Used for continuous properties and property kinds and for geometry. In the latter case, we need to point to the representation. */
interface _AlphaInformation extends eml._AbstractGraphicalInformation {
  /** Count equals to entry count.
   * It multiplies the opacity of the color map. */
  Alpha: number[];
  /** Count equals to opacity count. */
  Index: string[];
  MinMax?: MinMax;
  /** If both Alpha and either ConstantColor or ColorInformation are defined, then setting this field to true will indicate that the Alpha must be used instead of the ConstantColor or ColorInformation alpha(s). Else the product of the two alpha should be used. */
  OverwriteColorAlpha: boolean;
  /** Indicates that the log of the property values are taken into account when mapped with the index of the color map. */
  UseLogarithmicMapping: boolean;
  /** Indicates that the minimum value of the property corresponds to the maximum index of the color map and that the maximum value of the property corresponds to the minimum index of the color map. */
  UseReverseMapping: boolean;
  /** Especially useful for vector property and for geometry. */
  ValueVectorIndex?: number;
}
export interface AlphaInformation extends _AlphaInformation { }

/** Allows definition of an alternate cell indexing for a representation. If defined, this alternate cell indexing is the only one to rely on when referencing the representation cells. The alternate cell indices must come from existing grid representations. Because this alternate indexing requires a lot of extra work for software readers to process, use only when no other solution is acceptable. */
interface _AlternateCellIndex extends BaseType {
  /** Defines each alternate cell index for each representation cell.
   * BUSINESS RULE :CellIndex.Count = GridIndex.Count = Representation.Cell.Count */
  CellIndex: eml.AbstractIntegerArray;
  /** Defines which grid each alternate cell index comes from. The grids are defined by means of an index of the OriginalGrids set.
   * BUSINESS RULE : GridIndex.Count = CellIndex.Count = Representation.Cell.Count */
  GridIndex: eml.AbstractIntegerArray;
  OriginalGrids: eml.DataObjectReference[];
}
export interface AlternateCellIndex extends _AlternateCellIndex { }

/** Used for properties and property kinds and for geometry. In the latter case, we need to point to the representation. */
interface _AnnotationInformation extends eml._AbstractGraphicalInformation {
  /** Shows the annotation (i.e., the value) on some of the indexable element on a regular basis. */
  ShowAnnotationEvery: number;
  /** Especially useful for vector property and for geometry. */
  ValueVectorIndices: string[];
}
export interface AnnotationInformation extends _AnnotationInformation { }

/** The main class for data describing an opinion of the contact between two geologic feature-interpretations.
 * - A contact interpretation between two surface geological boundaries is usually a line.
 * - A contact interpretation between two volumes (rock feature-interpretation) is usually a surface.
 *
 * This class allows you to build a formal sentence-in the pattern of subject-verb-direct object-which is used to describe the construction of a node, line, or surface contact. It is also possible to attach a primary and a secondary qualifier to the subject and to the direct object.
 *
 * For more information, see the RESQML Technical Usage Guide.
 *
 * For example, one contact interpretation can be described by a sentence such as:
 * The interpreted fault named F1 interp on its hanging wall side splits the interpreted horizon named H1 Interp on both its sides.
 *
 * Subject = F1 Interp, with qualifier "hanging wall side"
 * Verb = splits
 * Direct Object = H1 Interp, with qualifier "on both sides" */
interface _BinaryContactInterpretationPart
  extends _AbstractContactInterpretationPart {
  /** Data-object reference (by UUID link) to a geologic feature-interpretation, which is the direct object of the sentence that defines how the contact was constructed. */
  DirectObject: ContactElement;
  /** Data-object reference (by UUID link) to a geologic feature-interpretation, which is the subject of the sentence that defines how the contact was constructed. */
  Subject: ContactElement;
  Verb: ContactVerb;
}
export interface BinaryContactInterpretationPart
  extends _BinaryContactInterpretationPart { }

/** The information that allows you to locate, on one or several grids (existing or planned), the intersection of volume (cells) and surface (faces) elements with a wellbore trajectory (existing or planned). */
interface _BlockedWellboreRepresentation extends _WellboreFrameRepresentation {
  IntervalGridCells: IntervalGridCells;
}
export interface BlockedWellboreRepresentation
  extends _BlockedWellboreRepresentation {
  $type: "resqml22.BlockedWellboreRepresentation";
}

/** An array of Boolean values that is explicitly defined by indicating which indices in the array are either true or false. This class is used to represent very sparse true or false data, based on a discrete property. */
interface _BooleanArrayFromDiscretePropertyArray
  extends eml._AbstractBooleanArray {
  Property: eml.DataObjectReference;
  /** Integer to match for the value to be considered true */
  Value: number;
}
export interface BooleanArrayFromDiscretePropertyArray
  extends _BooleanArrayFromDiscretePropertyArray { }

/** Information specific to one Boolean property.
 * Used to capture a choice between 2 and only 2 possible values/states for each indexable element of a data object, for example, identifying active cells of a grid.. */
interface _BooleanProperty extends _AbstractValuesProperty { }
export interface BooleanProperty extends _BooleanProperty { }

/** An interface between two objects, such as horizons and faults. It is a surface object.
 * A RockVolumeFeature is a geological feature (which is the general concept that refers to the various categories of geological objects that exist in the natural world).
 * For example: the stratigraphic boundaries, the =geobody boundaries or the fluid boundaries that are present before production. To simplify the hierarchy of concepts, the geological feature is not represented in the RESQML design. */
interface _BoundaryFeature extends _AbstractFeature { }
export interface BoundaryFeature extends _BoundaryFeature {
  $type: "resqml22.BoundaryFeature";
}

/** The main class for data describing an opinion of a surface feature between two volumes.
 *
 * BUSINESS RULE: The data-object reference (of type "interprets") must reference only a boundary feature. */
interface _BoundaryFeatureInterpretation
  extends _AbstractFeatureInterpretation {
  AbsoluteAge?: eml.GeologicTime;
  /** A value in years of the age offset between the DateTime attribute value and the DateTime of a GeologicalEvent occurrence of generation. When it represents a geological event that happened in the past, this value must be POSITIVE. */
  OlderPossibleAge?: number;
  /** A value in years of the age offset between the DateTime attribute value and the DateTime of a GeologicalEvent occurrence of generation. When it represents a geological event that happened in the past, this value must be POSITIVE. */
  YoungerPossibleAge?: number;
}
export interface BoundaryFeatureInterpretation
  extends _BoundaryFeatureInterpretation {
  $type: "resqml22.BoundaryFeatureInterpretation";
}

/** Element that lets you index and order feature interpretations which must be boundaries (horizon, faults and frontiers) or boundary sets (fault network). For possible ordering criteria, see OrderingCriteria.
 *
 * BUSINESS RULE: Only BoundaryFeatureInterpretation and FeatureInterpretationSet having faults as homogeneous type must be used to build a StructuralOrganizationInterpretation. */
interface _BoundaryFeatureInterpretationPlusItsRank extends BaseType {
  BoundaryFeatureInterpretation?: eml.DataObjectReference;
  FeatureInterpretationSet?: eml.DataObjectReference;
  /** The first rank on which you find the boundary or the interpretation set of boundaries. */
  StratigraphicRank?: eml.NonNegativeLong;
}
export interface BoundaryFeatureInterpretationPlusItsRank
  extends _BoundaryFeatureInterpretationPlusItsRank { }

/** A mapping from cells to fluid phase unit interpretation to describe the initial hydrostatic fluid column. */
interface _CellFluidPhaseUnits extends BaseType {
  /** Index of the phase unit kind within a given fluid phase organization for each cell. Follows the indexing defined by the PhaseUnit enumeration. When applied to the wellbore frame representation, the indexing is identical to the number of intervals.
   * Since a single cell or interval may corresponds to several units, the mapping is done using a jagged array.
   *
   * Use null value if no fluid phase is present, e.g., within the seal.
   *
   * BUSINESS RULE: Array length is equal to the number of cells in the representation (grid, wellbore frame or blocked well). */
  PhaseUnitIndices: eml.JaggedArray;
  RockFluidOrganizationInterpretation: eml.DataObjectReference;
}
export interface CellFluidPhaseUnits extends _CellFluidPhaseUnits { }

/** Optional cell volume overlap information between the current grid (the child) and the parent grid. Use this data-object when the child grid has an explicitly defined geometry, and these relationships cannot be inferred from the regrid descriptions. */
interface _CellOverlap extends BaseType {
  /** Number of parent-child cell overlaps. Must be positive. */
  Count: eml.PositiveLong;
  OverlapVolume?: OverlapVolume;
  /** (Parent cell index, child cell index) pair for each overlap.
   *
   * BUSINESS RULE: Length of array must equal 2 x overlapCount. */
  ParentChildCellPairs: eml.AbstractIntegerArray;
}
export interface CellOverlap extends _CellOverlap { }

/** Parent window for ANY grid indexed as if it were an unstructured cell grid, i.e., using a 1D index. */
interface _CellParentWindow extends _AbstractParentWindow {
  /** Cell indices that list the cells in the parent window.
   *
   * BUSINESS RULE: The ratio of fine to coarse cell counts must be an integer for each coarse cell. */
  CellIndices: eml.AbstractIntegerArray;
  ParentGridRepresentation: eml.DataObjectReference;
}
export interface CellParentWindow extends _CellParentWindow { }

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
interface _CellShape extends eml._TypeEnum {
  _: CellShape;
}

/** Location of a single line of common mid-points (CMP) resulting from a 2D seismic acquisition */
interface _CmpLineFeature extends _AbstractSeismicLineFeature {
  /** Index of closest shot point (inside the associated CmpPointLineFeature) for each cmp. */
  NearestShotPointIndices: eml.AbstractIntegerArray;
  ShotPointLineFeature?: eml.DataObjectReference;
}
export interface CmpLineFeature extends _CmpLineFeature { }

/** Used for properties and property kinds and for geometry. In the latter case, we need to point to the representation. */
interface _ColorInformation extends eml._AbstractGraphicalInformation {
  ColorMap?: eml.DataObjectReference;
  /** This is the range of values of the associated property which will result in the minimum color and the maximum color. This is not necessarily the entire range of values of the data - data outside this range will continue to have the extreme color from this range. */
  MinMax?: MinMax;
  /** Indicates that the log of the property values are taken into account when mapped with the index of the color map. */
  UseLogarithmicMapping: boolean;
  /** Indicates that the minimum value of the property corresponds to the maximum index of the color map and that the maximum value of the property corresponds to the minimum index of the color map. */
  UseReverseMapping: boolean;
  /** Especially useful for vectorial property and for geometry. */
  ValueVectorIndex?: number;
}
export interface ColorInformation extends _ColorInformation { }

/** A container for color maps. */
interface _ColorMapDictionary extends eml._AbstractObject {
  ColorMap?: AbstractColorMap[];
}
export interface ColorMapDictionary extends _ColorMapDictionary { }

/** Used to construct a column layer grid patch based upon multiple unstructured column-layer and IJK grids that share a layering scheme.
 *
 * Multiple patches are supported. */
interface _ColumnLayerGpGrid extends BaseType {
  IjkGpGridPatch?: IjkGpGridPatch[];
  KGaps?: KGaps;
  /** Number of layers. Degenerate case (nk=0) is allowed for GPGrid. */
  Nk: eml.NonNegativeLong;
  UnstructuredColumnLayerGpGridPatch?: UnstructuredColumnLayerGpGridPatch[];
}
export interface ColumnLayerGpGrid extends _ColumnLayerGpGrid { }

/** Parent window for any column-layer grid indexed as if it were an unstructured column layer grid, i.e., IJ columns are replaced by a column index. */
interface _ColumnLayerParentWindow extends _AbstractParentWindow {
  /** Column indices that list the columns in the parent window.
   *
   * BUSINESS RULE: The ratio of fine to coarse column counts must be an integer for each coarse column. */
  ColumnIndices: eml.AbstractIntegerArray;
  KRegrid: Regrid;
  /** List of parent cells that are to be retained at their original resolution and are not to be included within a local grid. The "omit" allows non-rectangular local grids to be specified.
   *
   * 0-based indexing follows #Columns x #Layers relative to the parent window cell count, not to the parent grid. */
  OmitParentCells?: eml.AbstractIntegerArray;
  ParentColumnLayerGridRepresentation: eml.DataObjectReference;
}
export interface ColumnLayerParentWindow extends _ColumnLayerParentWindow { }

/** Definition of the indexing for the split coordinate lines. When present, this indexing contributes to the coordinate line nodes. */
interface _ColumnLayerSplitCoordinateLines extends BaseType {
  /** Column indices for each of the split coordinate lines. Used to implicitly define column and cell geometry. List-of-lists construction used to support shared coordinate lines. */
  ColumnsPerSplitCoordinateLine: eml.JaggedArray;
  /** Number of split coordinate lines. The count must be positive. */
  Count: eml.PositiveLong;
  /** Pillar index for each split coordinate line.
   * Length of this array is equal to the number of split coordinate lines.
   *
   * For the first pillarCount lines, the index of the coordinate line equals the index of the corresponding pillar.  This array provides the pillar indices for the additional (split) coordinate lines.
   *
   * Used to implicitly define column and cell geometry. */
  PillarIndices: eml.AbstractIntegerArray;
}
export interface ColumnLayerSplitCoordinateLines
  extends _ColumnLayerSplitCoordinateLines { }

/** This data-object consists of the unstructured cell finite elements subnode topology plus the column subnodes. */
interface _ColumnLayerSubnodeTopology extends _SubnodeTopology {
  ColumnSubnodePatch?: ColumnSubnodePatch[];
}
export interface ColumnLayerSubnodeTopology
  extends _ColumnLayerSubnodeTopology { }

/** Used to indicate that all columns are of a uniform topology, i.e., have the same number of faces per column. This information is supplied by the RESQML writer to indicate the complexity of the grid geometry, as an aide to the RESQML reader.
 *
 * If a specific column shape is not appropriate, then use polygonal.
 *
 * BUSINESS RULE: Should be consistent with the actual geometry of the grid. */
export type ColumnShape = "triangular" | "quadrilateral" | "polygonal";
interface _ColumnShape extends eml._TypeEnum {
  _: ColumnShape;
}

/** Use this subnode construction if the number of subnodes per object varies from column to column, but does not vary from layer to layer. */
interface _ColumnSubnodePatch extends _SubnodePatch {
  /** Number of subnodes per object, with a different number in each column of the grid. */
  SubnodeCountPerObject: eml.AbstractIntegerArray;
}
export interface ColumnSubnodePatch extends _ColumnSubnodePatch { }

/** Information specific to one comment property.
 * Used to capture comments or annotations associated with a given element type in a data-object, for example, associating comments on the specific location of a well path. */
interface _CommentProperty extends _AbstractValuesProperty {
  /** Identify the language (e.g., US English or French) of the string. It is recommended that language names conform to ISO 639. */
  Language?: eml.String64;
}
export interface CommentProperty extends _CommentProperty { }

/** For each connection in the grid connection set representation, zero, one or more feature-interpretations. The use of a jagged array allows multiple interpretations for each connection, e.g., to represent multiple faults discretized onto a single connection. Note: Feature-interpretations are not restricted to faults, so that a connection may also represent a horizon or geobody boundary, for example. */
interface _ConnectionInterpretations extends BaseType {
  FeatureInterpretation: eml.DataObjectReference[];
  /** Indices for the interpretations for each connection, if any. The use of a RESQML jagged array allows zero or more than one interpretation to be associated with a single connection. */
  InterpretationIndices: eml.JaggedArray;
}
export interface ConnectionInterpretations extends _ConnectionInterpretations { }

/** A reference to either a geologic feature interpretation or a frontier feature.
 *
 * BUSINESS RULE: The content type of the corresponding data-object reference must be a geological feature-interpretation or a frontier feature. */
interface _ContactElement extends eml._DataObjectReference {
  Qualifier?: ContactSide;
  SecondaryQualifier?: ContactMode;
}
export interface ContactElement extends _ContactElement { }

/** Indicates identity between two (or more) contacts. For possible types of identities, see IdentityKind. */
interface _ContactIdentity extends BaseType {
  /** The contact representations that share common identity as specified by their indices. */
  ContactIndices: eml.AbstractIntegerArray;
  /** Indicates which nodes (identified by their common index in all contact representations) of the contact representations are identical.
   * If this list is not present, then it indicates that all nodes in each representation are identical, on an element by element level. */
  IdenticalNodeIndices?: eml.AbstractIntegerArray;
  /** The kind of contact identity. Must be one of the enumerations in IdentityKind. */
  IdentityKind: IdentityKind;
}
export interface ContactIdentity extends _ContactIdentity { }

/** An optional second qualifier that may be used when describing binary contact interpretation parts. (See also BinaryContactInterpretationPart and the RESQML Technical Usage Guide.) */
export type ContactMode = "conformable" | "extended" | "unconformable";
interface _ContactMode extends eml._TypeEnum {
  _: ContactMode;
}

/** A subset of topological elements of an existing contact representation part (sealed or non-sealed contact). */
interface _ContactPatch extends BaseType {
  /** Identifies a representation by its index, in the list of representations contained in the organization. */
  RepresentationIndex: eml.NonNegativeLong;
  /** The ordered list of nodes (identified by their global index) in the supporting representation, which constitutes the contact patch. */
  SupportingRepresentationNodes: eml.AbstractIntegerArray;
}
export interface ContactPatch extends _ContactPatch { }

/** Used when the contact already exists as a top-level element representation. */
interface _ContactReference extends _AbstractSurfaceFrameworkContact {
  Representation: eml.DataObjectReference;
}
export interface ContactReference extends _ContactReference { }

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
interface _ContactSide extends eml._TypeEnum {
  _: ContactSide;
}

/** Enumerations for the verbs that can be used to define the impact on the construction of the model of the geological event that created the binary contact. */
export type ContactVerb = "stops" | "splits" | "crosses";
interface _ContactVerb extends eml._TypeEnum {
  _: ContactVerb;
}

/** A color map associating a double value to a color. */
interface _ContinuousColorMap extends _AbstractColorMap {
  Entry: ContinuousColorMapEntry[];
  /** The domain for the interpolation between color map entries. */
  InterpolationDomain: InterpolationDomain;
  /** The method for the interpolation between color map entries. */
  InterpolationMethod: InterpolationMethod;
}
export interface ContinuousColorMap extends _ContinuousColorMap {
  $type: "resqml22.ContinuousColorMap";
}

/** An association between a single double value and a color. */
interface _ContinuousColorMapEntry extends BaseType {
  Hsv: HsvColor;
  /** The double value to be associated with a particular color. */
  Index: number;
}
export interface ContinuousColorMapEntry extends _ContinuousColorMapEntry { }

/** Most common type of property used for storing rock or fluid attributes; all are represented as doubles.
 * Statistics about values such as maximum and minimum can be found in the statistics of each ValueForPatch.
 * BUSINESS RULE: It also contains a unit of measure, which can be different from the unit of measure of its property type, but it must be convertible into this unit. */
interface _ContinuousProperty extends _AbstractValuesProperty {
  CustomUnitDictionary?: eml.DataObjectReference;
  /** Unit of measure for the property. */
  Uom: eml.UnitOfMeasureExt;
}
export interface ContinuousProperty extends _ContinuousProperty {
  $type: "resqml22.ContinuousProperty";
}

/** Information about contour lines between regions having different ranges of values (elevation or depth mostly). */
interface _ContourLineSetInformation extends eml._AbstractGraphicalInformation {
  /** Indicator to display the contour line value on major lines. To differentiate minor and major lines, see ShowMajorLineEvery. */
  DisplayLabelOnMajorLine?: boolean;
  /** Indicator to display the contour line value on minor lines. To differentiate minor and major lines, see ShowMajorLineEvery. */
  DisplayLabelOnMinorLine?: boolean;
  /** The absolute incremented value between two consecutive minor contour lines. */
  Increment?: number;
  /** Graphical information of major lines. */
  MajorLineGraphicalInformation?: GraphicalInformationForEdges;
  /** Graphical information of minor lines. */
  MinorLineGraphicalInformation?: GraphicalInformationForEdges;
  /** Allows to regularly promote some minor lines to major lines. */
  ShowMajorLineEvery?: number;
  /** Especially useful for vectorial property and for geometry. */
  ValueVectorIndex?: number;
}
export interface ContourLineSetInformation extends _ContourLineSetInformation { }

/** Occurs only if a correction has been applied on the survey wellbore. */
interface _CorrectionInformation extends BaseType {
  /** The UOM is composed by:
   * UOM of the LocalDepth3dCrs of the associated wellbore frame trajectory / UOM of the associated LocalTime3dCrs.
   *
   * If not used, enter zero. */
  CorrectionAverageVelocity?: number;
  /** The UOM is the one specified in the LocalTime3dCrs.
   *
   * If not used, enter zero. */
  CorrectionTimeShift?: number;
}
export interface CorrectionInformation extends _CorrectionInformation { }

/** Identifies a frontier or boundary in the earth model that is not a geological feature but an arbitrary geographic/geometric surface used to delineate the boundary of the model. */
interface _CulturalFeature extends _AbstractTechnicalFeature {
  CulturalFeatureKind: CulturalFeatureKindExt;
}
export interface CulturalFeature extends _CulturalFeature {
  $type: "resqml22.CulturalFeature";
}

/** The enumeration of the possible cultural feature. */
export type CulturalFeatureKind =
  | "fieldblock"
  | "licenses"
  | "pipeline"
  | "project boundaries"
  | "model frontier";
interface _CulturalFeatureKind extends eml._TypeEnum {
  _: CulturalFeatureKind;
}

export type CulturalFeatureKindExt = string;
type _CulturalFeatureKindExt = Primitive._string;

/** Either for Feature, Interp or representation, marker */
interface _DefaultGraphicalInformation
  extends eml._AbstractGraphicalInformation {
  IndexableElementInfo: AbstractGraphicalInformationForIndexableElement[];
  /** Use this especially to differentiate between two viewers of the same kind */
  ViewerId?: string;
  /** The kind of viewer where this graphical information is supposed to be used. */
  ViewerKind: ViewerKindExt;
}
export interface DefaultGraphicalInformation
  extends _DefaultGraphicalInformation { }

export type DepositionalEnvironmentKind =
  | "continental"
  | "paralic shallow marine"
  | "deep marine"
  | "carbonate continental"
  | "carbonate paralic shallow marine"
  | "carbonate deep marine";
interface _DepositionalEnvironmentKind extends eml._TypeEnum {
  _: DepositionalEnvironmentKind;
}

export type DepositionalEnvironmentKindExt = string;
type _DepositionalEnvironmentKindExt = Primitive._string;

export type DepositionalFaciesKind =
  | "carbonates"
  | "carbonates basinal"
  | "carbonates foreslope"
  | "carbonates foreslope pelagic"
  | "carbonates foreslope turbidite"
  | "carbonates highenergy"
  | "carbonates highenergy platform"
  | "carbonates highenergy platform interior"
  | "carbonates highenergy platform margin"
  | "carbonates highenergy ramp"
  | "carbonates highenergy ramp inner"
  | "carbonates highenergy ramp middle"
  | "carbonates highenergy ramp outer"
  | "carbonates highenergy shelf"
  | "carbonates highenergy shelf interior"
  | "carbonates highenergy shelf margin"
  | "carbonates highenergy slope"
  | "carbonates highenergy slope distal"
  | "carbonates highenergy slope lower"
  | "carbonates highenergy slope upper"
  | "carbonates lacustrine"
  | "carbonates lacustrine abiotic"
  | "carbonates lacustrine basinal"
  | "carbonates lacustrine organicbuildup"
  | "carbonates lacustrine ramp"
  | "carbonates lacustrine ramp inner"
  | "carbonates lacustrine ramp middle"
  | "carbonates lacustrine ramp outer"
  | "carbonates lacustrine shelf"
  | "carbonates lacustrine shelf interior"
  | "carbonates lacustrine shelf margin"
  | "carbonates lacustrine shelf slope"
  | "carbonates lacustrine shelf slope distal"
  | "carbonates lacustrine shelf slope lower"
  | "carbonates lacustrine shelf slope upper"
  | "carbonates lowenergy"
  | "carbonates lowenergy ramp"
  | "carbonates lowenergy sabkha"
  | "carbonates lowenergy shelf"
  | "carbonates lowenergy tidalflat"
  | "carbonates organicbuildup"
  | "carbonates organicbuildup bank"
  | "carbonates organicbuildup reef"
  | "carbonates organicbuildup reef mound"
  | "carbonates organicbuildup reef patch"
  | "carbonates organicbuildup reef pinnacle"
  | "carbonates subaerial"
  | "continental"
  | "continental alluvial"
  | "continental alluvial debrisflow"
  | "continental alluvial sheetflow"
  | "continental eolian"
  | "continental eolian erg"
  | "continental eolian mixedeolianfluvial"
  | "continental eolian mixedeoliansabkha"
  | "continental fluvial"
  | "continental fluvial alluvialplain"
  | "continental fluvial river"
  | "continental fluvial river anastomosing"
  | "continental fluvial river braided"
  | "continental fluvial river meandering"
  | "continental fluvial river straight"
  | "continental glacial"
  | "continental lacustrine"
  | "continental lacustrine barrier"
  | "continental lacustrine beach"
  | "continental lacustrine delta braided"
  | "continental lacustrine delta fan"
  | "continental lacustrine sublacustrinefan"
  | "deepmarine"
  | "deepmarine abysal"
  | "deepmarine channelcomplex"
  | "deepmarine channelcomplex confined"
  | "deepmarine channelcomplex confined channelfill"
  | "deepmarine channelcomplex confined levee"
  | "deepmarine channelcomplex distributary"
  | "deepmarine channelcomplex distributary channelfill"
  | "deepmarine channelcomplex distributary levee"
  | "deepmarine channelcomplex distributary lobe"
  | "deepmarine channelcomplex erosiveaggradational"
  | "deepmarine channelcomplex erosiveaggradational channelfill"
  | "deepmarine channelcomplex erosiveaggradational debrite"
  | "deepmarine channelcomplex erosiveaggradational levee"
  | "deepmarine channelcomplex erosiveaggradational overbankdeposit"
  | "deepmarine conouritedrift"
  | "deepmarine conouritedrift moatmound"
  | "deepmarine conouritedrift plastered"
  | "deepmarine conouritedrift sheetlike"
  | "deepmarine injectite"
  | "deepmarine intraslopebasin"
  | "deepmarine masstransportdeposit"
  | "deepmarine pelagic"
  | "deepmarine shelf"
  | "deepmarine shelf edge"
  | "deepmarine slope"
  | "deepmarine slope lower"
  | "deepmarine slope upper"
  | "deepmarine turbiditecontourite"
  | "deepmarine turbiditecontourite confined"
  | "deepmarine turbiditecontourite distributary"
  | "marineshallow"
  | "marineshallow barrierisland"
  | "marineshallow barrierisland waveinfluenced"
  | "marineshallow bay"
  | "marineshallow coast"
  | "marineshallow coast tidedominated"
  | "marineshallow coastalplain"
  | "marineshallow delta"
  | "marineshallow delta braided"
  | "marineshallow delta fan"
  | "marineshallow delta fluvialdominated"
  | "marineshallow delta fluvialinfluenced"
  | "marineshallow delta tidedominated"
  | "marineshallow delta tideinfluenced"
  | "marineshallow delta wavedominated"
  | "marineshallow delta waveinfluenced"
  | "marineshallow lagon"
  | "marineshallow lagon wavedominated"
  | "marineshallow shoreline"
  | "marineshallow shoreline estuary"
  | "marineshallow shoreline estuary fluvialdominated"
  | "marineshallow shoreline estuary fluvialinfluenced"
  | "marineshallow shoreline estuary mixedinfluenced"
  | "marineshallow shoreline estuary tidedominated"
  | "marineshallow shoreline estuary tideinfluenced"
  | "marineshallow shoreline estuary wavedominated"
  | "marineshallow shoreline estuary waveinfluenced"
  | "marineshallow shoreline shoreface"
  | "marineshallow shoreline shoreface foreshore"
  | "marineshallow shoreline shoreface lower"
  | "marineshallow shoreline shoreface middle"
  | "marineshallow shoreline shoreface offshore"
  | "marineshallow shoreline shoreface upper"
  | "marineshallow shoreline shoreline fluvialdominated"
  | "marineshallow shoreline shoreline fluvialinfluenced"
  | "marineshallow shoreline shoreline mixedinfluenced"
  | "marineshallow shoreline shoreline tidedominated"
  | "marineshallow shoreline shoreline tideinfluenced"
  | "marineshallow shoreline shoreline wavedominated"
  | "marineshallow shoreline shoreline waveinfluenced"
  | "marineshallow strandplain"
  | "marineshallow tidalflat";
interface _DepositionalFaciesKind extends eml._TypeEnum {
  _: DepositionalFaciesKind;
}

export type DepositionalFaciesKindExt = string;
type _DepositionalFaciesKindExt = Primitive._string;

/** Specifies the position of the stratification of a stratigraphic unit with respect to its top and bottom boundaries. */
export type DepositionMode =
  | "proportional between top and bottom"
  | "parallel to bottom"
  | "parallel to top"
  | "parallel to another boundary";
interface _DepositionMode extends eml._TypeEnum {
  _: DepositionMode;
}

/** A color map associating an integer value to a color.
 * BUSINESS RULE: When using a discrete color map for a continuous property the property value will be equal to the next lowest integer in the color map.  For example a color map of 10, 20, 30, etc., and a continuous property value of 16.5 will result in a value of 10 for the minimum. */
interface _DiscreteColorMap extends _AbstractColorMap {
  Entry: DiscreteColorMapEntry[];
}
export interface DiscreteColorMap extends _DiscreteColorMap {
  $type: "resqml22.DiscreteColorMap";
}

/** An association between a single integer value and a color. */
interface _DiscreteColorMapEntry extends BaseType {
  Hsv: HsvColor;
  /** The integer value to be associated with a particular color. */
  index: number;
}
export interface DiscreteColorMapEntry extends _DiscreteColorMapEntry { }

/** Contains discrete integer values; typically used to store any type of index.
 * Statistics about values such as maximum and minimum can be found in the statistics of each ValueForPatch. */
interface _DiscreteProperty extends _AbstractValuesProperty {
  CategoryLookup?: eml.DataObjectReference;
  $type: "resqml22.DiscreteProperty";
}
export interface DiscreteProperty extends _DiscreteProperty { }

export type DisplaySpace = "device" | "model";
interface _DisplaySpace extends eml._TypeEnum {
  _: DisplaySpace;
}

/** An enumeration that specifies in which domain the interpretation of an AbstractFeature has been performed: depth, time, or mixed (= depth + time). */
export type Domain = "depth" | "time" | "mixed";
interface _Domain extends eml._TypeEnum {
  _: Domain;
}

/** An earth model interpretation has the specific role of gathering at most:
 * - one StratigraphicOrganizationInterpretation
 * - One or several StructuralOrganizationInterpretations
 * - One or several RockFluidOrganizationInterpretations
 *
 * BUSINESS RULE: An earth model Interpretation interprets only a model feature. */
interface _EarthModelInterpretation extends _AbstractFeatureInterpretation {
  Fluid?: eml.DataObjectReference[];
  StratigraphicColumn?: eml.DataObjectReference;
  StratigraphicOccurrences?: eml.DataObjectReference[];
  Structure?: eml.DataObjectReference[];
  WellboreInterpretationSet?: eml.DataObjectReference[];
}
export interface EarthModelInterpretation extends _EarthModelInterpretation { }

/** Describes edges that are not linked to any other edge. Because edges do not have indices, a consecutive pair of nodes is used to identify each edge.
 *
 * The split edges dataset is a set of nodes (2 nodes per edge). Each patch has a set of 2 nodes. */
interface _EdgePatch extends BaseType {
  /** An array of split edges to define patches.
   * It points to an HDF5 dataset, which must be a 2D array of non-negative integers with dimensions 2 x numSplitEdges. */
  SplitEdges: eml.AbstractIntegerArray;
}
export interface EdgePatch extends _EdgePatch { }

/** The graphical patterns that an edge can support. */
export type EdgePattern = "dashed" | "dotted" | "solid" | "wavy";
interface _EdgePattern extends eml._TypeEnum {
  _: EdgePattern;
}

/** Allows the use of custom edge pattern in addition to the EdgePattern enumeration. */
export type EdgePatternExt = string;
type _EdgePatternExt = Primitive._string;

/** Unstructured cell grids require the definition of edges if the subnode attachment is of kind edges.
 *
 * Use Case: Finite elements, especially for higher order geometry.
 *
 * BUSINESS RULE: Edges must be defined for unstructured cell grids if subnode nodes of kind edges are used. */
interface _Edges extends BaseType {
  /** Number of edges. Must be positive. */
  Count: eml.PositiveLong;
  /** Defines a list of 2 nodes per edge.
   *
   * Count = 2 x EdgeCount */
  NodesPerEdge: eml.AbstractIntegerArray;
}
export interface Edges extends _Edges { }

/** Indicates the nature of the relationship between 2 or more representations, specifically if they are partially or totally identical. For possible types of relationships, see IdentityKind.
 * Commonly used to identify contacts between representations in model descriptions. May also be used to relate the components of a grid (e.g., pillars) to those of a structural framework. */
interface _ElementIdentity extends BaseType {
  /** Indicates which elements are identical based on their indices in the (sub)representation.
   * If not given, then the selected indexable elements of each of the selected representations are identical at the element by element level.
   * BUSINESS RULE: The number of identical elements must be equal to identicalElementCount for each representation. */
  ElementIndices?: eml.AbstractIntegerArray;
  FromTimeIndex?: eml.TimeIndex;
  /** Must be one of the enumerations in IdentityKind. */
  IdentityKind: IdentityKind;
  IndexableElement: eml.IndexableElement;
  Representation: eml.DataObjectReference;
  ToTimeIndex?: eml.TimeIndex;
}
export interface ElementIdentity extends _ElementIdentity { }

/** Index into the indexable elements selected. */
interface _ElementIndices extends BaseType {
  SupportingRepresentationIndex?: eml.AbstractIntegerArray;
}
export interface ElementIndices extends _ElementIndices { }

/** A general term for designating a boundary feature intepretation that corresponds to a discontinuity having a tectonic origin, identified at mapping or outcrop scale. Fault may designate true faults but also thrust surfaces. A thrust surface  is specified as a FaultInterpretation whose FaultThrow kind is “thrust” and which has the attributes: is Listric = 0, MaximumThrow = 0. */
interface _FaultInterpretation extends _BoundaryFeatureInterpretation {
  /** If not set (absent), the NorthReferenceKind is Grid North. */
  DipDirectionNorthReferenceKind?: eml.NorthReferenceKind;
  /** Indicates if the normal fault is listric or not.
   * BUSINESS RULE: Must be present if the fault is normal. Must not be present if the fault is not normal. */
  IsListric?: boolean;
  IsSealed?: boolean;
  MaximumThrow?: eml.LengthMeasure;
  /** For this element, “mean” means “representative”; it is not a mathematically derived mean. */
  MeanAzimuth?: eml.PlaneAngleMeasure;
  /** For this element, “mean” means “representative”; it is not a mathematically derived mean.
   * It is relative to horizontal however horizontal is defined by the CRS. */
  MeanDip?: eml.PlaneAngleMeasure;
  ThrowInterpretation?: FaultThrow[];
}
export interface FaultInterpretation extends _FaultInterpretation {
  $type: "resqml22.FaultInterpretation";
}

/** Identifies the characteristic of the throw of a fault interpretation. */
interface _FaultThrow extends BaseType {
  HasOccurredDuring?: AbstractTimeInterval;
  Throw: ThrowKindExt[];
}
export interface FaultThrow extends _FaultThrow { }

/** A boundary (usually a plane or a set of planes) separating two fluid phases, such as a gas-oil contact (GOC), a water-oil contact (WOC), a gas-oil contact (GOC), or others. For types, see FluidContact. */
interface _FluidBoundaryInterpretation extends _BoundaryFeatureInterpretation {
  /** The kind of contact of this boundary. */
  FluidContact: FluidContact;
}
export interface FluidBoundaryInterpretation
  extends _FluidBoundaryInterpretation {
  $type: "resqml22.FluidBoundaryInterpretation";
}

/** Enumerated values used to indicate a specific type of fluid boundary interpretation. */
export type FluidContact =
  | "free water contact"
  | "gas oil contact"
  | "gas water contact"
  | "seal"
  | "water oil contact";
interface _FluidContact extends eml._TypeEnum {
  _: FluidContact;
}

/** This represents a boundary between two intervals where at least one side of the boundary is a fluid. */
interface _FluidIntervalBoundary extends _MarkerBoundary { }
export interface FluidIntervalBoundary extends _FluidIntervalBoundary { }

/** The various fluids a well marker can indicate. */
export type FluidMarker =
  | "gas down to"
  | "gas up to"
  | "oil down to"
  | "oil up to"
  | "water down to"
  | "water up to";
interface _FluidMarker extends eml._TypeEnum {
  _: FluidMarker;
}

/** An interpretation of a feature that is not specialized. For example, use it when the specialized type of the associated feature is not known.
 * For example, to set up a StructuralOrganizationInterpretation you must reference the interpretations of each feature you want to include. These features must include FrontierFeatures which have no interpretations because they are technical features. For consistency of design of the StructuralOrganizationInterpretation, create a GenericFeatureInterpretation for each FrontierFeature. */
interface _GenericFeatureInterpretation
  extends _AbstractFeatureInterpretation { }
export interface GenericFeatureInterpretation
  extends _GenericFeatureInterpretation {
  $type: "resqml22.GenericFeatureInterpretation";
}

/** Geological time during which a geological event (e.g., deposition, erosion, fracturation, faulting, intrusion) occurred. */
interface _GeneticBoundaryBasedTimeInterval extends _AbstractTimeInterval {
  ChronoBottom: eml.DataObjectReference;
  ChronoTop: eml.DataObjectReference;
}
export interface GeneticBoundaryBasedTimeInterval
  extends _GeneticBoundaryBasedTimeInterval { }

/** Contains the data describing an opinion about the characterization of a geobody BoundaryFeature, and it includes the attribute boundary relation. */
interface _GeobodyBoundaryInterpretation
  extends _BoundaryFeatureInterpretation {
  /** Characterizes the stratigraphic relationships of a horizon with the stratigraphic units that its bounds. */
  BoundaryRelation?: string[];
  /** Optional Boolean flag to indicate that the geobody boundary interpretation is conformable above. */
  IsConformableAbove?: boolean;
  /** Optional Boolean flag to indicate that the geobody boundary interpretation is conformable below. */
  IsConformableBelow?: boolean;
}
export interface GeobodyBoundaryInterpretation
  extends _GeobodyBoundaryInterpretation {
  $type: "resqml22.GeobodyBoundaryInterpretation";
}

/** A volume of rock that is identified based on some specific attribute, like its mineral content or other physical characteristic. Unlike stratigraphic or phase units, there is no associated time or fluid content semantic. */
interface _GeobodyInterpretation extends _GeologicUnitInterpretation { }
export interface GeobodyInterpretation extends _GeobodyInterpretation {
  $type: "resqml22.GeobodyInterpretation";
}

/** The various geologic boundaries a well marker can indicate. */
export type GeologicBoundaryKind = "fault" | "geobody" | "horizon";
interface _GeologicBoundaryKind extends eml._TypeEnum {
  _: GeologicBoundaryKind;
}

/** A time interval that is bounded by two geologic times.
 * Can correspond to a TimeStep in a TimeSeries, such as the International Chronostratigraphic Scale or a regional chronostratigraphic scale. */
interface _GeologicTimeBasedTimeInterval extends _AbstractTimeInterval {
  End: eml.GeologicTime;
  Start: eml.GeologicTime;
}
export interface GeologicTimeBasedTimeInterval
  extends _GeologicTimeBasedTimeInterval { }

/** The main class for data describing an opinion of an originally continuous rock volume individualized in view of some characteristic property (e.g., physical, chemical, temporal) defined by GeologicUnitComposition and/or GeologicUnitMaterialImplacement, which can have a 3D defined shape. BUSINESS RULE: The data object reference (of type "interprets") must reference only a rock volume feature.
 * In an earth model, a geological unit interrupted by faults may consist of several disconnected rock volumes. */
interface _GeologicUnitInterpretation extends _AbstractFeatureInterpretation {
  DepositionalEnvironment?: DepositionalEnvironmentKindExt;
  DepositionalFacies?: DepositionalFaciesKindExt;
  /** 3D shape of the geologic unit. */
  GeologicUnit3dShape?: Shape3dExt;
  GeologicUnitComposition?: eml.LithologyKindExt;
  /** Attribute specifying whether the GeologicalUnitIntepretation is intrusive or not. */
  GeologicUnitMaterialEmplacement?: GeologicUnitMaterialEmplacement;
}
export interface GeologicUnitInterpretation
  extends _GeologicUnitInterpretation {
  $type: "resqml22.GeologicUnitInterpretation";
}

/** The enumerated attributes of a horizon. */
export type GeologicUnitMaterialEmplacement = "intrusive" | "non-intrusive";
interface _GeologicUnitMaterialEmplacement extends eml._TypeEnum {
  _: GeologicUnitMaterialEmplacement;
}

/** A local Interpretation-it could be along a well, on a 2D map, or on a 2D section or on a part of the global volume of an earth model-of a succession of rock feature elements.
 * The stratigraphic column rank interpretation composing a stratigraphic occurrence can be ordered by the criteria listed in OrderingCriteria.
 * Note: When the chosen ordering criterion is not age but measured depth along a well trajectory, the semantics of the name of this class could be inconsistent semantics. In this case:
 * - When faults are present, the observed succession may show repetition of a stratigraphic succession composed of a series of units each younger than the one below it.
 * - This succession should not be called a stratigraphic occurrence because it is not stratigraphic (because the adjective ‘stratigraphic’ applies to a succession of units ordered according to their relative ages).
 * A more general term for designating a succession of geological units encountered in drilling would be “Geologic Occurrence”. So we may consider that the term “stratigraphic cccurrence interpretation” should be understood as “geologic occurrence interpretation”. */
interface _GeologicUnitOccurrenceInterpretation
  extends _AbstractGeologicUnitOrganizationInterpretation {
  GeologicUnit?: eml.DataObjectReference[];
  IsOccurrenceOf?: eml.DataObjectReference;
}
export interface GeologicUnitOccurrenceInterpretation
  extends _GeologicUnitOccurrenceInterpretation { }

/** General purpose (GP) grid representation, which includes and/or extends the features from all other grid representations. This general purpose representation is included in the schema for research and/or advanced modeling purposes, but is not expected to be used for routine data transfer. */
interface _GpGridRepresentation extends _AbstractGridRepresentation {
  ColumnLayerGpGrid?: ColumnLayerGpGrid[];
  UnstructuredGpGridPatch?: UnstructuredGpGridPatch[];
}
export interface GpGridRepresentation extends _GpGridRepresentation {
  $type: "resqml22.GpGridRepresentation";
}

/** The geometry of a single point defined by its location in the local CRS. */
interface _Graph2dRepresentation extends _AbstractRepresentation {
  Edges: eml.AbstractIntegerArray;
  Geometry: PointGeometry;
  isDirected: boolean;
}
export interface Graph2dRepresentation extends _Graph2dRepresentation { }

/** Graphical information for edges. */
interface _GraphicalInformationForEdges
  extends _AbstractGraphicalInformationForIndexableElement {
  DisplaySpace?: DisplaySpace;
  /** The pattern of the edge. */
  Pattern?: EdgePatternExt;
  /** The thickness of the edge. */
  Thickness?: eml.LengthMeasureExt;
  /** Use color and size interpolation between nodes. */
  UseInterpolationBetweenNodes?: boolean;
}
export interface GraphicalInformationForEdges
  extends _GraphicalInformationForEdges { }

/** Graphical information for faces. */
interface _GraphicalInformationForFaces
  extends _AbstractGraphicalInformationForIndexableElement {
  /** If true the graphical information only applies to the right handed side of the face. If false, it only applies to the left handed side of the face.
   * If not present the graphical information applies to both sides of faces. */
  AppliesOnRightHandedFace?: boolean;
  /** Interpolate the values all along the face based on fixed value set on nodes. */
  UseInterpolationBetweenNodes?: boolean;
}
export interface GraphicalInformationForFaces
  extends _GraphicalInformationForFaces { }

/** Graphical information for nodes. */
interface _GraphicalInformationForNodes
  extends _AbstractGraphicalInformationForIndexableElement {
  /** A size for all the nodes.
   * Not defined if ActiveSizeInformationIndex is defined. */
  ConstantSize?: eml.LengthMeasureExt;
  DisplaySpace?: DisplaySpace;
  /** Allows you to show only a subset of nodes (instead of all of them). */
  ShowSymbolEvery?: number;
  /** The symbol used to visualize a single node. */
  Symbol?: NodeSymbolExt;
}
export interface GraphicalInformationForNodes
  extends _GraphicalInformationForNodes { }

/** Graphical information for volumes. */
interface _GraphicalInformationForVolumes
  extends _AbstractGraphicalInformationForIndexableElement {
  /** Interpolate the values all along the volume based on a fixed value set on nodes. */
  UseInterpolationBetweenNodes?: boolean;
}
export interface GraphicalInformationForVolumes
  extends _GraphicalInformationForVolumes { }

/** Graphical information for the whole data object. */
interface _GraphicalInformationForWholeObject
  extends _AbstractGraphicalInformationForIndexableElement {
  /** Display the contour line of the visualized data object according to information at a particular index of the GraphicalInformationSet. */
  ActiveContourLineSetInformationIndex?: number;
  /** Display the title of the visualized data object next to it. */
  DisplayTitle?: boolean;
}
export interface GraphicalInformationForWholeObject
  extends _GraphicalInformationForWholeObject { }

/** Representation based on a 2D grid. For definitions of slowest and fastest axes of the array, see Grid2dPatch. */
interface _Grid2dRepresentation extends _AbstractSurfaceRepresentation {
  FastestAxisCount: eml.PositiveLong;
  Geometry: PointGeometry;
  SlowestAxisCount: eml.PositiveLong;
}
export interface Grid2dRepresentation extends _Grid2dRepresentation {
  $type: "resqml22.Grid2dRepresentation";
}

/** Representation that consists of a list of connections between grid cells, potentially on different grids.
 *
 * Connections are in the form of (Grid,Cell,Face)1<=>(Grid,Cell,Face)2 and are stored as three integer pair arrays corresponding to these six elements.
 *
 * Grid connection sets are the preferred means of representing faults on a grid. The use of cell-face-pairs is more complete than single cell-faces, which are missing a corresponding cell face entry, and only provide an incomplete representation of the topology of a fault.
 *
 * Unlike what is sometimes the case in reservoir simulation software, RESQML does not distinguish between standard and non-standard connections.
 * Within RESQML, if a grid connection corresponds to a "nearest neighbor" as defined by the cell indices, then it is never additive to the implicit nearest neighbor connection.
 *
 * BUSINESS RULE: A single cell-face-pair should not appear within more than a single grid connection set. This rule is designed to simplify the interpretation of properties assigned to multiple grid connection sets, which might otherwise have the same property defined more than once on a single connection, with no clear means of resolving the multiple values. */
interface _GridConnectionSetRepresentation extends _AbstractRepresentation {
  /** 2 x #Connections array of cell indices for (Cell1,Cell2) for each connection. */
  CellIndexPairs: eml.AbstractIntegerArray;
  ConnectionInterpretations?: ConnectionInterpretations;
  /** count of connections. Must be positive. */
  Count: eml.PositiveLong;
  Grid: eml.DataObjectReference[];
  /** 2 x #Connections array of grid indices for (Cell1,Cell2) for each connection. The grid indices are obtained from the grid index pairs.
   *
   * If only a single grid is referenced from the grid index, then this array need not be used.
   *
   * BUSINESS RULE: If more than one grid index pair is referenced, then this array should appear. */
  GridIndexPairs?: eml.AbstractIntegerArray;
  /** Optional 2 x #Connections array of local face-per-cell indices for (Cell1,Cell2) for each connection. Local face-per-cell indices are used because global face indices need not have been defined.
   *
   * If no face-per-cell definition occurs as part of the grid representation, e.g., for a block-centered grid, then this array need not appear. */
  LocalFacePerCellIndexPairs?: eml.AbstractIntegerArray;
}
export interface GridConnectionSetRepresentation
  extends _GridConnectionSetRepresentation {
  $type: "resqml22.GridConnectionSetRepresentation";
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
interface _GridGeometryAttachment extends eml._TypeEnum {
  _: GridGeometryAttachment;
}

/** An interpretation of a horizon, which optionally provides stratigraphic information on BoundaryRelation, HorizonStratigraphicRole, SequenceStratigraphysurface
 * . */
interface _HorizonInterpretation extends _BoundaryFeatureInterpretation {
  /** Optional Boolean flag to indicate that the horizon interpretation is conformable above. */
  IsConformableAbove?: boolean;
  /** Optional Boolean flag to indicate that the horizon interpretation is conformable below. */
  IsConformableBelow?: boolean;
  SequenceStratigraphySurface?: SequenceStratigraphySurfaceKindExt;
  StratigraphicRole?: StratigraphicRole[];
}
export interface HorizonInterpretation extends _HorizonInterpretation {
  $type: "resqml22.HorizonInterpretation";
}

/** Defines the infinite geometry of a horizontal plane provided by giving its unique Z value. */
interface _HorizontalPlaneGeometry extends _AbstractPlaneGeometry {
  Coordinate: number;
}
export interface HorizontalPlaneGeometry extends _HorizontalPlaneGeometry { }

/** See https://en.wikipedia.org/wiki/HSL_and_HSV */
interface _HsvColor extends BaseType {
  /** Transparency/opacity of the color: 0 is totally transparent while 1 is totally opaque. */
  Alpha: number;
  /** Hue of the color in the HSV model. */
  Hue: number;
  /** Saturation of the color in the HSV model. */
  Saturation: number;
  /** Name of the color. */
  Title?: string;
  /** Value of the color in the HSV model. */
  Value: number;
}
export interface HsvColor extends _HsvColor { }

/** Enumeration of the identity kinds for the element identities (ElementIdentity). */
export type IdentityKind =
  | "collocation"
  | "previous collocation"
  | "equivalence"
  | "previous equivalence";
interface _IdentityKind extends eml._TypeEnum {
  _: IdentityKind;
}

/** Optional object used to indicate that adjacent columns of the model are split from each other, which is modeled by introducing additional (split) pillars.
 *
 * Use the ColumnLayerSplitColumnEdges object to specify the numbering  of the additional column edges generated by the IJ Gaps. */
interface _IjGaps extends BaseType {
  /** List of columns for each of the split pillars. This information is used to infer the grid cell geometry.
   *
   * BUSINESS RULE: The length of the first list-of-lists array must match the splitPillarCount. */
  ColumnsPerSplitPillar: eml.JaggedArray;
  /** Parent pillar index for each of the split pillars. This information is used to infer the grid cell geometry.
   *
   * BUSINESS RULE: Array length must match splitPillarCount. */
  ParentPillarIndices: eml.AbstractIntegerArray;
  /** Number of split pillars in the model. Count must be positive. */
  SplitPillarCount: eml.PositiveLong;
}
export interface IjGaps extends _IjGaps { }

/** Used to specify IJK grid patch(es) within a general purpose grid.
 *
 * Multiple patches are supported. */
interface _IjkGpGridPatch extends BaseType {
  Geometry?: IjkGridGeometry;
  /** Count of I indices. Degenerate case (ni=0) is allowed for GPGrid representations. */
  Ni: eml.NonNegativeLong;
  /** Count of J indices. Degenerate case (nj=0) is allowed for GPGrid representations. */
  Nj: eml.NonNegativeLong;
  /** TRUE if the grid is periodic in J, i.e., has the topology of a complete 360 degree circle.
   *
   * If TRUE, then NJL=NJ. Otherwise, NJL=NJ+1 */
  RadialGridIsComplete?: boolean;
  TruncationCellPatch?: TruncationCellPatch;
}
export interface IjkGpGridPatch extends _IjkGpGridPatch { }

/** Explicit geometry definition for the cells of the IJK grid.
 *
 * Grid options are also defined through this data-object. */
interface _IjkGridGeometry extends _AbstractColumnLayerGridGeometry {
  /** Indicates that the IJK grid is right handed, as determined by the triple product of tangent vectors in the I, J, and K directions. */
  GridIsRighthanded: boolean;
  IjGaps?: IjGaps;
}
export interface IjkGridGeometry extends _IjkGridGeometry { }

/** Grid whose topology is characterized by structured column indices (I,J) and a layer index, K.
 *
 * Cell geometry is characterized by nodes on coordinate lines, where each column of the model has 4 sides. Geometric degeneracy is permitted.
 *
 * IJK grids support the following specific extensions:
 * - IJK radial grids
 * - K-Layer gaps
 * - IJ-Column gaps */
interface _IjkGridRepresentation
  extends _AbstractColumnLayerGridRepresentation {
  Geometry?: IjkGridGeometry;
  KGaps?: KGaps;
  /** Count of cells in the I-direction in the grid. Must be positive. I=1,...,NI, I0=0,...,NI-1. */
  Ni: eml.PositiveLong;
  /** Count of cells in the J-direction in the grid. Must be positive. J=1,...,NJ, J0=0,...,NJ-1. */
  Nj: eml.PositiveLong;
  /** TRUE if the grid is periodic in J, i.e., has the topology of a complete 360 degree circle.
   *
   * If TRUE, then NJL=NJ. Otherwise, NJL=NJ+1
   *
   * May be used to change the grid topology for either a Cartesian or a radial grid, although radial grid usage is by far the more common. */
  RadialGridIsComplete?: boolean;
}
export interface IjkGridRepresentation extends _IjkGridRepresentation {
  $type: "resqml22.IjkGridRepresentation";
}

/** Parent window for any IJK grid. */
interface _IjkParentWindow extends _AbstractParentWindow {
  IRegrid: Regrid;
  JRegrid: Regrid;
  KRegrid: Regrid;
  /** List of parent cells that are to be retained at their original resolution and are not to be included within a local grid. The "omit" allows non-rectangular local grids to be specified.
   *
   * 0-based indexing follows NI x NJ x NK relative to the parent window cell count-not to the parent grid. */
  OmitParentCells?: eml.AbstractIntegerArray;
  ParentIjkGridRepresentation: eml.DataObjectReference;
}
export interface IjkParentWindow extends _IjkParentWindow { }

/** Color domain/model for interpolation. */
export type InterpolationDomain = "hsv" | "rgb";
interface _InterpolationDomain extends eml._TypeEnum {
  _: InterpolationDomain;
}

/** Method for interpolation. */
export type InterpolationMethod = "linear" | "logarithmic";
interface _InterpolationMethod extends eml._TypeEnum {
  _: InterpolationMethod;
}

/** Specifies the (Grid,Cell) intersection of each interval of the representation, if any.
 * The information allows you to locate, on one or several grids, the intersection of volume (cells) and surface (faces) elements with a wellbore trajectory (existing or planned), streamline trajectories, or any polyline set. */
interface _IntervalGridCells extends BaseType {
  /** The number of non-null entries in the grid indices array. */
  CellCount: eml.PositiveLong;
  /** The cell index for each interval of a representation. The grid index is specified by grid index array, to give the (Grid,Cell) index pair. Null values signify that interval is not within a grid.
   * BUSINESS RULE : Size of array = IntervalCount */
  CellIndices: eml.AbstractIntegerArray;
  Grid: eml.DataObjectReference[];
  /** The grid index for each interval of a representation. The grid index is specified by grid index array, to give the (Grid,Cell) index pair. Null values signify that the interval is not within a grid.
   * BUSINESS RULE : Size of array = IntervalCount */
  GridIndices: eml.AbstractIntegerArray;
  /** For each cell, these are the entry and exit intersection faces of the trajectory in the cell. Use null for missing intersections, e.g., when a trajectory originates or terminates within a cell or when an interval is not within a grid. The local face-per-cell index is used because a global face index need not have been defined on the grid.
   * BUSINESS RULE: Size of array = 2 * IntervalCount */
  LocalFacePairPerCellIndices: eml.AbstractIntegerArray;
}
export interface IntervalGridCells extends _IntervalGridCells { }

/** Refinement and/or coarsening per interval.
 *
 * If there is a 1:1 correspondence between the parent and child cells, then this object is not needed. */
interface _Intervals extends BaseType {
  /** Weights that are proportional to the relative sizes of child cells within each interval. The weights need not be normalized. */
  ChildCellWeights?: eml.AbstractFloatingPointArray;
  /** The number of child cells in each interval.
   *
   * If the child grid type is not commensurate with the parent type, then this attribute is ignored by a reader and its value should be set to null value. For example, for a parent IJK grid with a child unstructured column-layer grid, then the child count is non-null for a K regrid, but null for an I or J regrid.
   *
   * BUSINESS RULES:
   * 1.) The array length must be equal to intervalCount.
   * 2.) If the child grid type is commensurate with the parent grid, then the sum of values over all intervals must be equal to the corresponding child grid dimension. */
  ChildCountPerInterval: eml.AbstractIntegerArray;
  /** The number of intervals in the regrid description. Must be positive. */
  IntervalCount: eml.PositiveLong;
  /** The number of parent cells in each interval.
   *
   * BUSINESS RULES:
   * 1.) The array length must be equal to intervalCount.
   * 2.) For the given parentIndex, the total count of parent cells should not extend beyond the boundary of the parent grid. */
  ParentCountPerInterval: eml.AbstractIntegerArray;
}
export interface Intervals extends _Intervals { }

/** A mapping from intervals to stratigraphic units for representations (grids or wellbore frames). Since a single interval may corresponds to several units, the mapping is done using a jagged array. */
interface _IntervalStratigraphicUnits extends BaseType {
  StratigraphicOrganizationInterpretation: eml.DataObjectReference;
  /** Index of the stratigraphic unit per interval, of a given stratigraphic column.
   *
   * Notes:
   * 1.) For grids:
   * if it does not exist a property kind "geologic k" attached to the grid then
   * intervals = layers + K gaps
   * else
   * intervals = values property of property kind "geologic k"
   * 2.) If there is no stratigraphic column, e.g., within salt, use null value
   *
   * BUSINESS RULE: Array length must equal the number of intervals. */
  UnitIndices: eml.JaggedArray;
}
export interface IntervalStratigraphicUnits
  extends _IntervalStratigraphicUnits { }

/** Enumeration used to specify if the direction of the coordinate lines is uniquely defined for a grid. If not uniquely defined, e.g., for over-turned reservoirs, then indicate that the K direction is not monotonic. */
export type KDirection = "down" | "up" | "not monotonic";
interface _KDirection extends eml._TypeEnum {
  _: KDirection;
}

/** Optional data-object used to indicate that there are global gaps between layers in the grid. With K gaps, the bottom of one layer need not be continuous with the top of the next layer, so the resulting number of intervals is greater than the number of layers. */
interface _KGaps extends BaseType {
  /** Number of gaps between layers. Must be positive.
   *
   * Number of intervals = gapCount + NK. */
  Count: eml.PositiveLong;
  /** Boolean array of length NK-1. TRUE if there is a gap after the corresponding layer.
   *
   * NKL = NK + gapCount + 1
   *
   * BUSINESS RULE: gapCount must be consistent with the number of gaps specified by the gapAfterLayer array. */
  GapAfterLayer: eml.AbstractBooleanArray;
}
export interface KGaps extends _KGaps { }

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
  | "contour"
  | "pillar"
  | "break line"
  | "structural closure"
  | "culture";
interface _LineRole extends eml._TypeEnum {
  _: LineRole;
}

export type LineRoleExt = string;
type _LineRoleExt = Primitive._string;

/** Used to activate and/or deactivate the specified children grids as local grids on their parents. Once activated, this object indicates that a child grid replaces local portions of the corresponding parent grid. Specifically, properties and/or geometry in the region of a parent window will be stored on both the parent and child grids, usually with differing spatial resolutions. The choice of whether non-null properties are stored on both grids, or only the child grid, is application specific. Parentage is inferred from the child grid construction. Without a grid set activation, the local grids are always active. Otherwise, the grid set activation is used to activate and/or deactivate the local grids in the set at specific times. */
interface _LocalGridSet extends eml._AbstractObject {
  Activation?: Activation;
  ChildGrid: eml.DataObjectReference[];
}
export interface LocalGridSet extends _LocalGridSet { }

/** Represent interval limits associated with Witsml:WellMarkers. */
interface _MarkerBoundary extends BaseType {
  FluidContact?: FluidContact;
  FluidMarker?: FluidMarker;
  GeologicBoundaryKind: GeologicBoundaryKind;
  Interpretation?: eml.DataObjectReference;
  /** This is a DataObjectReference to a WITSML WellboreMarker */
  Marker?: eml.DataObjectReference;
  /** This is a DataObjectReference to a WITSML WellboreMarkerSet */
  MarkerSet?: eml.DataObjectReference;
  Qualifier?: string;
}
export interface MarkerBoundary extends _MarkerBoundary { }

interface _MarkerInterval extends BaseType {
  Interpretation?: eml.DataObjectReference[];
  Organization?: eml.DataObjectReference;
}
export interface MarkerInterval extends _MarkerInterval { }

/** Different types of measured depths. */
export type MdDomain = "driller" | "logger";
interface _MdDomain extends eml._TypeEnum {
  _: MdDomain;
}

/** A simple reusable structure that carries a minimum and a maximum double value leading to the definition of an interval of values. */
interface _MinMax extends BaseType {
  /** The maximum value of the interval. */
  Maximum: number;
  /** The minimum value of the interval. */
  Minimum: number;
}
export interface MinMax extends _MinMax { }

/** The explicit description of the relationships between geologic features, such as rock features (e.g. stratigraphic units, geobodies, phase unit) and boundary features (e.g., genetic, tectonic, and fluid boundaries). In general, this concept is usually called an “earth model”, but it is not called that in RESQML. In RESQML, model is not to be confused with the concept of earth model organization interpretation. */
interface _Model extends _AbstractFeature { }
export interface Model extends _Model { }

/** Describes multiple interface contacts of geologic feature-interpretations (compared to a binary contact). A composition of several contact interpretations. */
interface _MultipleContactInterpretationPart
  extends _AbstractContactInterpretationPart {
  /** Indicates a list of binary contacts (by their UUIDs) that participate in this multiple-part contact. */
  With: eml.NonNegativeLong[];
}
export interface MultipleContactInterpretationPart
  extends _MultipleContactInterpretationPart { }

/** Standardized symbols for node visualization. */
export type NodeSymbol =
  | "circle"
  | "cross"
  | "cube"
  | "diamond"
  | "plus"
  | "point"
  | "pyramid"
  | "sphere"
  | "star"
  | "tetrahedron";
interface _NodeSymbol extends eml._TypeEnum {
  _: NodeSymbol;
}

/** Allows you to use custom node symbols in addition to the NodeSymbol enumeration. */
export type NodeSymbolExt = string;
type _NodeSymbolExt = Primitive._string;

/** Defines a non-sealed contact representation, meaning that this contact representation is defined by a geometry. */
interface _NonSealedContact extends _AbstractSurfaceFrameworkContact {
  Geometry?: AbstractGeometry;
  Patches?: ContactPatch[];
}
export interface NonSealedContact extends _NonSealedContact { }

/** A collection of contact representations parts, which are a list of contact patches with no identity. This collection of contact representations is completed by a set of representations gathered at the representation set representation level. */
interface _NonSealedSurfaceFrameworkRepresentation
  extends _AbstractSurfaceFrameworkRepresentation {
  Contacts?: AbstractSurfaceFrameworkContact[];
}
export interface NonSealedSurfaceFrameworkRepresentation
  extends _NonSealedSurfaceFrameworkRepresentation {
  $type: "resqml22.NonSealedSurfaceFrameworkRepresentation";
}

/** Enumeration used to specify the order of an abstract stratigraphic organization or a structural organization interpretation. */
export type OrderingCriteria = "age" | "apparent depth";
interface _OrderingCriteria extends eml._TypeEnum {
  _: OrderingCriteria;
}

/** Optional parent-child cell overlap volume information. If not present, then the CellOverlap data-object lists the overlaps, but with no additional information. */
interface _OverlapVolume extends BaseType {
  /** Parent-child cell volume overlap.
   *
   * BUSINESS RULE: Length of array must equal the cell overlap count. */
  OverlapVolumes: eml.AbstractFloatingPointArray;
  /** Units of measure for the overlapVolume. */
  VolumeUom: eml.VolumeUom;
}
export interface OverlapVolume extends _OverlapVolume { }

/** Defines an array of parametric lines of multiple kinds.
 * For more information, see the RESQML Technical Usage Guide.
 * In general, a parametric line is unbounded so the interpolant in the first or last interval is used as an extrapolating function.
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
 *
 * Tangential Cubic and Minimum-Curvature.
 * (1) Control points are (P,X,Y,Z).
 * (2) Tangent vectors are (P,TX,TY,TZ). Tangent vectors are defined as the derivative of position with respect to the parameter. If the parameter is arc-length, then the tangent vectors are unit vectors, but not otherwise.
 * (3) Interpolating minimum-curvature basis functions obtained by a circular arc construction. This differs from the "drilling" algorithm in which the parameter must be arc length.
 *
 * Z Linear Cubic:
 * (1) (X,Y) follow a natural cubic spline and Z follows a linear spline.
 * (2) On export, to go from Z to P, the RESQML "software writer" first needs to determine the interval and then uses linearity in Z to determine P.
 * (3) On import, a RESQML "software reader" converts from P to Z using piecewise linear interpolation, and from P to X and Y using natural cubic spline interpolation. Other than the differing treatment of Z from X and Y, these are completely generic interpolation algorithms.
 * (4) The use of P instead of Z for interpolation allows support for over-turned reservoir structures and removes any apparent discontinuities in parametric derivatives at the spline knots. */
interface _ParametricLineArray extends _AbstractParametricLineArray {
  /** An array of explicit control point parameters for all of the control points on each of the parametric lines.
   * If you cannot provide enough control point parameters for a parametric line, then pad with NaN values.
   * BUSINESS RULE: The parametric values must be strictly monotonically increasing on each parametric line. */
  ControlPointParameters?: eml.AbstractFloatingPointArray;
  /** An array of 3D points for all of the control points on each of the parametric lines. The number of control points per line is given by the KnotCount.
   * Control points are ordered by lines going fastest, then by knots going slowest.
   * If you cannot provide enough control points for a parametric line, then pad with NaN values. */
  ControlPoints: AbstractPoint3dArray;
  /** The first dimension of the control point, control point parameter, and tangent vector arrays for the parametric splines. The Knot Count is typically chosen to be the maximum number of control points, parameters or tangent vectors on any parametric line in the array of parametric lines. */
  KnotCount: eml.PositiveLong;
  /** An array of integers indicating the parametric line kind.
   *
   * 0 = vertical
   * 1 = linear spline
   * 2 = natural cubic spline
   * 3 = tangential cubic spline
   * 4 = Z linear cubic spline
   * 5 = minimum-curvature spline
   * null value: no line
   *
   * Size = #Lines, e.g., (1D or 2D) */
  LineKindIndices: eml.AbstractIntegerArray;
  ParametricLineIntersections?: ParametricLineIntersections;
  /** An optional array of tangent vectors for all of the control points on each of the tangential cubic and minimum-curvature parametric lines. Used only if tangent vectors are present.
   * The number of tangent vectors per line is given by the KnotCount for these spline types.
   *
   * Described as a 1D array, the tangent vector array is divided into segments of length Knot Count, with null (NaN) values added to each segment to fill it up.
   *
   * Size = Knot Count x #Lines, e.g., 2D or 3D
   *
   * BUSINESS RULE: For all lines other than the cubic and minimum-curvature parametric lines, this array should not appear. For these line kinds, there should be one tangent vector for each control point.
   *
   * If a tangent vector is missing, then it is computed in the same fashion as for a natural cubic spline. Specifically, to obtain the tangent at internal knots, the control points are fit by a quadratic function with the two adjacent control points. At edge knots, the second derivative vanishes. */
  TangentVectors?: AbstractPoint3dArray;
}
export interface ParametricLineArray extends _ParametricLineArray { }

/** The parametric line extracted from an existing representation.
 *
 * BUSINESS RULE: The supporting representation must have pillars or lines as indexable elements. */
interface _ParametricLineFromRepresentationGeometry
  extends _AbstractParametricLineGeometry {
  /** The line index of the selected line in the supporting representation.
   *
   * For a column-layer grid, the parametric lines follow the indexing of the pillars. */
  LineIndexOnSupportingRepresentation: eml.NonNegativeLong;
  SupportingRepresentation: eml.DataObjectReference;
}
export interface ParametricLineFromRepresentationGeometry
  extends _ParametricLineFromRepresentationGeometry { }

/** The lattice array of parametric lines extracted from an existing representation.
 *
 * BUSINESS RULE: The supporting representation must have pillars or lines as indexable elements. */
interface _ParametricLineFromRepresentationLatticeArray
  extends _AbstractParametricLineArray {
  /** The line indices of the selected lines in the supporting representation. The index selection is regularly incremented from one node to the next node.
   *
   * BUSINESS RULE: The dimensions of the integer lattice array must be consistent with the dimensions of the supporting representation.
   *
   * For a column-layer grid, the parametric lines follow the indexing of the pillars.
   *
   * BUSINESS RULE: The start value of the integer lattice array must be the linearized index of the starting line.
   * Example: iStart + ni * jStart in case of a supporting 2D grid. */
  LineIndicesOnSupportingRepresentation: eml.IntegerLatticeArray;
  SupportingRepresentation: eml.DataObjectReference;
}
export interface ParametricLineFromRepresentationLatticeArray
  extends _ParametricLineFromRepresentationLatticeArray { }

/** Defines a parametric line of any kind.
 *
 * For more information on the supported parametric lines, see ParametricLineArray. */
interface _ParametricLineGeometry extends _AbstractParametricLineGeometry {
  /** An array of explicit control point parameters for the control points on the parametric line.
   * BUSINESS RULE: The size MUST match the number of control points.
   * BUSINESS RULE: The parametric values MUST be strictly monotonically increasing on the parametric line. */
  ControlPointParameters?: eml.AbstractFloatingPointArray;
  /** An array of 3D points for the control points on the parametric line. */
  ControlPoints: AbstractPoint3dArray;
  /** Number of spline knots in the parametric line. */
  KnotCount: eml.PositiveLong;
  /** Integer indicating the parametric line kind
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
export interface ParametricLineGeometry extends _ParametricLineGeometry { }

/** Used to specify the intersections between parametric lines. This information is purely geometric and is not required for the evaluation of the parametric point locations on these lines. The information required for that purpose is stored in the parametric points array. */
interface _ParametricLineIntersections extends BaseType {
  /** Number of parametric line intersections. Must be positive. */
  Count: eml.PositiveLong;
  /** Intersected line index pair for (line 1, line 2).
   *
   * Size = 2 x count */
  IntersectionLinePairs: eml.AbstractIntegerArray;
  /** Intersected line parameter value pairs for (line 1, line 2).
   *
   * Size = 2 x count */
  ParameterValuePairs: eml.AbstractValueArray;
}
export interface ParametricLineIntersections
  extends _ParametricLineIntersections { }

/** Defines the boundaries of an indexed patch. These boundaries are outer and inner rings. */
interface _PatchBoundaries extends BaseType {
  InnerRing?: eml.DataObjectReference[];
  OuterRing?: eml.DataObjectReference;
  /** The XML index of the referenced patch inside this representation. */
  ReferencedPatch: eml.NonNegativeLong;
}
export interface PatchBoundaries extends _PatchBoundaries { }

/** The enumeration of the possible rock fluid unit phases in a hydrostatic column.
 * The seal is considered here as a part (the coverage phase) of a hydrostatic column. */
export type Phase = "aquifer" | "gas cap" | "oil column" | "seal";
interface _Phase extends eml._TypeEnum {
  _: Phase;
}

/** Used to indicate that all pillars are of a uniform kind, i.e., may be represented using the same number of nodes per pillar. This information is supplied by the RESQML writer to indicate the complexity of the grid geometry, as an aide to the RESQML reader.
 *
 * If a combination of vertical and straight, then use straight.
 *
 * If a specific pillar shape is not appropriate, then use curved.
 *
 * BUSINESS RULE: Should be consistent with the actual geometry of the grid. */
export type PillarShape = "vertical" | "straight" | "curved";
interface _PillarShape extends eml._TypeEnum {
  _: PillarShape;
}

/** Defines a plane representation, which can be made up of multiple patches. Commonly represented features are fluid contacts or frontiers. Common geometries of this representation are titled or horizontal planes.
 *
 * BUSINESS RULE: If the plane representation is made up of multiple patches, then you must specify the outer rings for each plane patch. */
interface _PlaneSetRepresentation extends _AbstractSurfaceRepresentation {
  Planes: AbstractPlaneGeometry[];
}
export interface PlaneSetRepresentation extends _PlaneSetRepresentation {
  $type: "resqml22.PlaneSetRepresentation";
}

/** An array of explicit XY points stored as two coordinates in an HDF5 dataset. If needed, the implied Z coordinate is uniformly 0. */
interface _Point2dExternalArray extends _AbstractPoint3dArray {
  /** Reference to an HDF5 2D dataset of XY points. The 2 coordinates are stored sequentially in HDF5, i.e., a multi-dimensional array of points is stored as a 2 x ... HDF5 array. */
  Coordinates: eml.ExternalDataArray;
}
export interface Point2dExternalArray extends _Point2dExternalArray { }

/** Defines a point using coordinates in 3D space. */
interface _Point3d extends BaseType {
  /** X coordinate */
  Coordinate1: number;
  /** Y coordinate */
  Coordinate2: number;
  /** Either Z or T coordinate */
  Coordinate3: number;
}
export interface Point3d extends _Point3d { }

/** An array of explicit XYZ points stored as three coordinates in an HDF5 dataset. */
interface _Point3dExternalArray extends _AbstractPoint3dArray {
  /** Reference to an HDF5 3D dataset of XYZ points. The 3 coordinates are stored sequentially in HDF5, i.e., a multi-dimensional array of points is stored as a 3 x ... HDF5 array. */
  Coordinates: eml.ExternalDataArray;
}
export interface Point3dExternalArray extends _Point3dExternalArray { }

/** A lattice array of points extracted from an existing representation.
 *
 * BUSINESS RULE: The supporting representation must have nodes as indexable elements. */
interface _Point3dFromRepresentationLatticeArray extends _AbstractPoint3dArray {
  /** The node indices of the selected nodes in the supporting representation. The index selection is regularly incremented from one node to the next node.
   *
   * BUSINESS RULE: The node indices must be consistent with the size of supporting representation. */
  NodeIndicesOnSupportingRepresentation: eml.IntegerLatticeArray;
  SupportingRepresentation: eml.DataObjectReference;
}
export interface Point3dFromRepresentationLatticeArray
  extends _Point3dFromRepresentationLatticeArray { }

/** Describes a lattice array of points obtained by sampling from along a multi-dimensional lattice. Each dimension of the lattice can be uniformly or irregularly spaced. */
interface _Point3dLatticeArray extends _AbstractPoint3dArray {
  /** The optional element that indicates that the offset vectors for each direction are mutually orthogonal to each other. This meta-information is useful to remove any doubt of orthogonality in case of numerical precision issues.
   *
   * BUSINESS RULE: If you don't know it or if only one lattice dimension is given, do not provide this element. */
  AllDimensionsAreOrthogonal?: boolean;
  Dimension: Point3dLatticeDimension[];
  /** The origin location of the lattice given as XYZ coordinates. */
  Origin: Point3d;
}
export interface Point3dLatticeArray extends _Point3dLatticeArray { }

/** Defines the size and sampling in each dimension (direction) of the point 3D lattice array. Sampling can be uniform or irregular. */
interface _Point3dLatticeDimension extends BaseType {
  /** The direction of the axis of this lattice dimension. This is a relative offset vector instead of an absolute 3D point. */
  Direction: Point3d;
  /** A lattice of N offset points is described by a spacing array of size N-1. The offset between points is given by the spacing value multiplied by the offset vector. For example, the first offset is 0. The second offset is the first spacing * offset. The second offset is (first spacing + second spacing) * offset, etc. */
  Spacing: eml.AbstractFloatingPointArray;
}
export interface Point3dLatticeDimension extends _Point3dLatticeDimension { }

/** A parametric specification of an array of XYZ points. */
interface _Point3dParametricArray extends _AbstractPoint3dArray {
  /** A multi-dimensional array of parametric values that implicitly specifies an array of XYZ points.
   *
   * The parametric values provided in this data-object must be consistent with the parametric values specified in the referenced parametric line array.
   *
   * When constructing a column-layer grid geometry using parametric points, the array indexing follows the dimensionality of the coordinate lines x NKL, which is either a 2D or 3D array. */
  Parameters: eml.AbstractValueArray;
  /** An optional array of indices that map from the array index to the index of the corresponding parametric line.
   * If this information is known from context, then this array is not needed. For example, in either of these cases:
   * (1) If the mapping from array index to parametric line is 1:1.
   * (2) If the mapping has already been specified, as with the pillar Index from the column-layer geometry of a grid.
   *
   * For example, when constructing a column-layer grid geometry using parametric lines, the array indexing follows the dimensionality of the coordinate lines. */
  ParametricLineIndices?: eml.AbstractIntegerArray;
  ParametricLines: AbstractParametricLineArray;
  /** A 2D array of line indices for use with intersecting parametric lines. Each record consists of a single line index, which indicates the array line that uses this truncation information, followed by the parametric line indices for each of the points on that line.
   *
   * For a non-truncated line, the equivalent record repeats the array line index NKL+1 times.
   *
   * Size = (NKL+1) x truncatedLineCount */
  TruncatedLineIndices?: eml.AbstractIntegerArray;
}
export interface Point3dParametricArray extends _Point3dParametricArray { }

/** An array of points defined by applying a Z value on top of an existing array of points, XYZ, where Z is ignored. Used in these cases:
 * - in 2D for defining geometry of one patch of a 2D grid representation.
 * - for extracting nodal geometry from one grid representation for use in another. */
interface _Point3dZValueArray extends _AbstractPoint3dArray {
  /** Geometry defining the X and Y coordinates. */
  SupportingGeometry: AbstractPoint3dArray;
  /** The values for Z coordinates */
  ZValues: eml.AbstractFloatingPointArray;
}
export interface Point3dZValueArray extends _Point3dZValueArray { }

/** The geometry of a set of points defined by their location in the local CRS, with optional seismic coordinates. */
interface _PointGeometry extends _AbstractGeometry {
  Points: AbstractPoint3dArray;
  SeismicCoordinates?: AbstractSeismicCoordinates;
}
export interface PointGeometry extends _PointGeometry { }

/** A representation that consists of one or more node patches. Each node patch is an array of XYZ coordinates for the 3D points. There is no implied linkage between the multiple patches. */
interface _PointSetRepresentation extends _AbstractRepresentation {
  NodePatchGeometry: PointGeometry[];
}
export interface PointSetRepresentation extends _PointSetRepresentation {
  $type: "resqml22.PointSetRepresentation";
}

/** Represents the geometric information that should *not* be used as representation geometry, but should be used in another context where the location or geometrical vectorial distances are needed. */
interface _PointsProperty extends _AbstractProperty {
  /** Geometric points (or vectors) to be attached to the specified indexable elements. */
  PointsForPatch: AbstractPoint3dArray[];
}
export interface PointsProperty extends _PointsProperty { }

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
interface _PolylineRepresentation extends _AbstractRepresentation {
  IsClosed: boolean;
  LineRole?: LineRoleExt;
  NodePatchGeometry: PointGeometry;
}
export interface PolylineRepresentation extends _PolylineRepresentation {
  $type: "resqml22.PolylineRepresentation";
}

/** A Patch containing a set of polylines.
 *
 * For performance reasons, the geometry of each Patch is described in only one 1D array of 3D points, which aggregates the nodes of all the polylines together.
 *
 * To be able to separate the polyline descriptions, additional information is added about the type of each polyline (closed or not) and the number of 3D points (node count) of each polyline.
 *
 * This additional information is contained in two arrays, which are associated with each polyline set patch. The dimension of these arrays is the number of polylines gathered in one polyline set patch.
 * - The first array contains a Boolean for each polyline (closed or not closed).
 * - The second array contains the count of nodes for each polyline. */
interface _PolylineSetPatch extends BaseType {
  /** Indicates whether a polyline is closed.
   *
   * If closed, then the interval count for that polyline is equal to the node count.
   *
   * If open, then the interval count for that polyline is one less than the node count. */
  ClosedPolylines: eml.AbstractBooleanArray;
  Geometry: PointGeometry;
  /** Total number of intervals.
   *
   * BUSINESS RULE: Should be equal to the sum of the count of intervals per polyline. */
  IntervalCount: eml.NonNegativeLong;
  IntervalGridCells?: IntervalGridCells;
  /** Total number of nodes.
   *
   * BUSINESS RULE: Should be equal to the sum of the number of nodes per polyline. */
  NodeCount: eml.PositiveLong;
  /** The first number in the list defines the node count for the first polyline in the polyline set patch.
   * The second number in the list defines the node count for the second polyline in the polyline set patch.
   * etc. */
  NodeCountPerPolyline: eml.AbstractIntegerArray;
}
export interface PolylineSetPatch extends _PolylineSetPatch { }

/** A representation made up of a set of polylines or a set of polygonal chains (for more information, see PolylineRepresentation).
 *
 * For compactness, it is organized by line patch as a unique polyline set patch.
 *
 * If allPolylineClosed = True, all the polylines are connected between the first and the last point.
 *
 * Its geometry is a 1D array of points, corresponding to the concatenation of the points of all polyline points. */
interface _PolylineSetRepresentation extends _AbstractRepresentation {
  LinePatch: PolylineSetPatch[];
  LineRole?: LineRoleExt;
}
export interface PolylineSetRepresentation extends _PolylineSetRepresentation {
  $type: "resqml22.PolylineSetRepresentation";
}

/** One-dimensional I, J, or K refinement and coarsening regrid specification.
 *
 * The regrid description is organized using intervals. Within each interval, the number of parent and child cells is specified. Parent and child grid cell faces are aligned at interval boundaries. By default, child cells are uniformly sized within an interval unless weights are used to modify their size.
 *
 * If the child grid is a root grid with an independent geometry, then there will usually be only a single interval for a regrid, because internal cell faces are not necessarily aligned. */
interface _Regrid extends BaseType {
  /** 0-based index for the placement of the window on the parent grid. */
  InitialIndexOnParentGrid: eml.NonNegativeLong;
  Intervals?: Intervals;
}
export interface Regrid extends _Regrid { }

/** Indicates the nature of the relationship between 2 or more representations, specifically if they are partially or totally identical. For possible types of relationships, see IdentityKind. */
interface _RepresentationIdentity extends BaseType {
  AdditionalGridTopology?: AdditionalGridTopology;
  ElementIdentity: ElementIdentity[];
  /** Number of elements within each representation for which a representation identity is specified. */
  IdenticalElementCount: eml.PositiveLong;
}
export interface RepresentationIdentity extends _RepresentationIdentity { }

/** A collection of representation identities. */
interface _RepresentationIdentitySet extends eml._AbstractObject {
  RepresentationIdentity: RepresentationIdentity[];
}
export interface RepresentationIdentitySet extends _RepresentationIdentitySet { }

/** The parent class of the framework representations. It is used to group together individual representations to represent a “bag” of representations. If the individual representations are all of the same, then you can indicate that the set is homogenous.
 * These “bags” do not imply any geologic consistency. For example, you can define a set of wellbore frames, a set of wellbore trajectories, a set of blocked wellbores.
 * Because the framework representations inherit from this class, they inherit the capability to gather individual representations into sealed and non-sealed surface framework representations, or sealed volume framework representations.
 * For more information, see the RESQML Technical Usage Guide. */
interface _RepresentationSetRepresentation extends _AbstractRepresentation {
  /** Indicates that all of the selected representations are of a single kind. */
  IsHomogeneous: boolean;
  Representation: eml.DataObjectReference[];
}
export interface RepresentationSetRepresentation
  extends _RepresentationSetRepresentation {
  $type: "resqml22.RepresentationSetRepresentation";
}

/** A portion of a reservoir rock which is differentiated laterally from other portions of the same reservoir stratum. This differentiation could be due to being in a different fault block or a different channel or other stratigraphic or structural aspect.
 *
 * A reservoir compartment may or may not be in contact with other reservoir compartments. */
interface _ReservoirCompartmentInterpretation
  extends _GeologicUnitInterpretation { }
export interface ReservoirCompartmentInterpretation
  extends _ReservoirCompartmentInterpretation { }

/** A geologic unit or formation located within a reservoir compartment. */
interface _ReservoirCompartmentUnitInterpretation extends BaseType {
  FluidUnits?: eml.DataObjectReference[];
  GeologicUnitInterpretation?: eml.DataObjectReference;
  ReservoirCompartment: ReservoirCompartmentInterpretation;
}
export interface ReservoirCompartmentUnitInterpretation
  extends _ReservoirCompartmentUnitInterpretation { }

/** This class describes the organization of geological reservoir, i.e., of an interconnected network of porous and permeable rock units, containing an accumulation of economic fluids, such as oil and gas.
 * A reservoir is normally enveloped by rock and fluid barriers and contains a single natural pressure system. */
interface _RockFluidOrganizationInterpretation
  extends _AbstractOrganizationInterpretation {
  RockFluidUnit?: eml.DataObjectReference[];
}
export interface RockFluidOrganizationInterpretation
  extends _RockFluidOrganizationInterpretation { }

/** A type of rock fluid feature-interpretation, this class identifies a rock fluid unit interpretation by its phase. */
interface _RockFluidUnitInterpretation extends _GeologicUnitInterpretation {
  Phase?: Phase;
}
export interface RockFluidUnitInterpretation
  extends _RockFluidUnitInterpretation {
  $type: "resqml22.RockFluidUnitInterpretation";
}

/** A continuous portion of rock material bounded by definite rock boundaries. It is a volume object.
 * Some of these rock volumes are “static”, while others are “dynamic”. Reservoir fluids are dynamic because their properties, geometries, and quantities may change over time during the course of field production.
 * A RockVolume feature is a geological feature--which is the general concept that refers to the various categories of geological objects that exist in the natural world, for example, the rock volume or the fluids that are present before production. The geological feature is not represented in the RESQML design. */
interface _RockVolumeFeature extends _AbstractFeature { }
export interface RockVolumeFeature extends _RockVolumeFeature {
  $type: "resqml22.RockVolumeFeature";
}

/** Sealed contact elements that indicate that 2 or more contact patches are partially or totally colocated or equivalent. For possible types of identity, see IdentityKind. */
interface _SealedContact extends _AbstractSurfaceFrameworkContact {
  /** Indicates which nodes (identified by their common index in all contact patches) of the contact patches are identical.
   * If this list is not present, then it indicates that all nodes in each representation are identical, on an element-by-element level. */
  IdenticalNodeIndices?: eml.AbstractIntegerArray;
  /** Must be one of the enumerations in IdentityKind. */
  IdentityKind: IdentityKind;
  Patches: ContactPatch[];
}
export interface SealedContact extends _SealedContact { }

/** A collection of contact representations parts, which are a list of contact patches and their identities. This collection of contact representations is completed by a set of representations gathered at the representation set representation level. */
interface _SealedSurfaceFrameworkRepresentation
  extends _AbstractSurfaceFrameworkRepresentation {
  Contacts?: SealedContact[];
}
export interface SealedSurfaceFrameworkRepresentation
  extends _SealedSurfaceFrameworkRepresentation {
  $type: "resqml22.SealedSurfaceFrameworkRepresentation";
}

/** A strict boundary representation (BREP), which represents the volume region by assembling together shells.
 *
 * BUSINESS RULE: The sealed structural framework must be part of the same earth model as this sealed volume framework. */
interface _SealedVolumeFrameworkRepresentation
  extends _RepresentationSetRepresentation {
  BasedOn: eml.DataObjectReference;
  Regions: VolumeRegion[];
}
export interface SealedVolumeFrameworkRepresentation
  extends _SealedVolumeFrameworkRepresentation {
  $type: "resqml22.SealedVolumeFrameworkRepresentation";
}

/** A group of 2D seismic coordinates that stores the 1-to-1 mapping between geometry patch coordinates (usually X, Y, Z) and trace or inter-trace positions on a seismic line.
 * BUSINESS RULE: This patch must reference a geometry patch by its UUID. */
interface _Seismic2dCoordinates extends _AbstractSeismicCoordinates {
  /** The sequence of trace or inter-trace positions that correspond to the geometry coordinates.
   * BUSINESS RULE: Both sequences must be in the same order. */
  LineAbscissa: eml.AbstractFloatingPointArray;
  /** The sequence of vertical sample or inter-sample positions that corresponds to the geometry coordinates.
   * BUSINESS RULE: Sequence must be in the same order as the previous one. */
  VerticalCoordinates?: eml.AbstractFloatingPointArray;
}
export interface Seismic2dCoordinates extends _Seismic2dCoordinates { }

/** The feature of this representation should be the same survey feature as the associated PolylineRepresentation represents..
 *
 * The indexing convention (mainly for associated properties) is :
 * - Trace sample goes fastest
 * - Then polyline node slowest
 * The indexing convention only applies to HDF datasets (not SEGY file).
 * A whole SEGY file can be referenced in properties of this representation, but not partial files. */
interface _Seismic2dPostStackRepresentation extends _AbstractRepresentation {
  LocalCrs: eml.DataObjectReference;
  SeismicLineRepresentation: eml.DataObjectReference;
  /** This array must be one dimension and count must be the node count in the associated seismic line i.e., polylineRepresentation.
   *
   * The index is based on array indexing, not on index labeling of traces.
   *
   * The values of the integer lattice array are the increments between 2 consecutive subsampled nodes. */
  SeismicLineSubSampling: eml.IntegerLatticeArray;
  /** Defines the sampling in the vertical dimension of the representation.
   *
   * This array must be one dimension.
   *
   * The values are given with respect to the associated local CRS. */
  TraceSampling: eml.FloatingPointLatticeArray;
}
export interface Seismic2dPostStackRepresentation
  extends _Seismic2dPostStackRepresentation { }

/** The 1-to-1 mapping between geometry coordinates (usually X, Y, Z or X, Y, TWT) and trace or inter-trace positions on a seismic lattice. */
interface _Seismic3dCoordinates extends _AbstractSeismicCoordinates {
  /** The sequence of trace or inter-trace crossline positions that correspond to the geometry coordinates.
   * BUSINESS RULE: Both sequences must be in the same order. */
  CrosslineCoordinates: eml.AbstractFloatingPointArray;
  /** The sequence of trace or inter-trace inline positions that correspond to the geometry coordinates.
   * BUSINESS RULE: Both sequences must be in the same order. */
  InlineCoordinates: eml.AbstractFloatingPointArray;
  /** The sequence of vertical sample or inter-sample positions that corresponds to the geometry coordinates.
   * BUSINESS RULE: Sequence must be in the same order as the two previous ones. */
  VerticalCoordinates?: eml.AbstractFloatingPointArray;
}
export interface Seismic3dCoordinates extends _Seismic3dCoordinates { }

/** The feature of this representation should be the same survey feature as the associated Grid2Representation represents.
 *
 * The indexing convention (mainly for associated properties) is:
 * - Trace sample goes fastest
 * - Then inline
 * - And crossline goes slowest
 * The indexing convention only applies to HDF datasets (not SEGY file).
 * A whole SEGY file can be referenced in properties of this representation, but not partial files. */
interface _Seismic3dPostStackRepresentation
  extends _AbstractGridRepresentation {
  LocalCrs: eml.DataObjectReference;
  SeismicLatticeRepresentation: eml.DataObjectReference;
  /** This array must be two dimensions:
   * - Fastest Axis is inline.
   * - Slowest Axis is crossline.
   *
   * The index is based on array indexing, not on index labeling of inlines/crosslines.
   *
   * The values of the integer lattice array are the increments between 2 consecutive subsampled nodes. */
  SeismicLatticeSubSampling: eml.IntegerLatticeArray;
  /** Defines the sampling in the vertical dimension of the representation.
   *
   * This array must be one dimension.
   *
   * The values are given with respect to the associated Local Crs. */
  TraceSampling: eml.FloatingPointLatticeArray;
}
export interface Seismic3dPostStackRepresentation
  extends _Seismic3dPostStackRepresentation {
  $type: "resqml22.Seismic3dPostStackRepresentation";
}

/** Defined by two lateral ordered dimensions: inline (lateral), crossline (lateral and orthogonal to the inline dimension), which are fixed.
 *
 * To specify its location, a seismic feature can be associated with the seismic coordinates of the points of a representation.
 *
 * Represented by a 2D grid representation. */
interface _SeismicLatticeFeature extends _AbstractSeismicSurveyFeature {
  /** The labels (as they would be found in SEGY trace headers for example) of the crosslines of the 3D seismic survey.
   *
   * BUSINESS RULE: Count of this array must be the same as the count of nodes in the slowest axis of the associated grid 2D representations. */
  CrosslineLabels?: eml.IntegerLatticeArray;
  /** The labels (as they would be found in SEGY trace headers for example) of the inlines of the 3D seismic survey.
   *
   * BUSINESS RULE: Count of this array must be the same as the count of nodes in the fastest axis of the associated grid 2D representations. */
  InlineLabels?: eml.IntegerLatticeArray;
  IsPartOf?: SeismicLatticeSetFeature;
}
export interface SeismicLatticeFeature extends _SeismicLatticeFeature {
  $type: "resqml22.SeismicLatticeFeature";
}

/** An unordered set of several seismic lattices. Generally, it has no direct interpretation or representation. */
interface _SeismicLatticeSetFeature extends _AbstractSeismicSurveyFeature { }
export interface SeismicLatticeSetFeature extends _SeismicLatticeSetFeature {
  $type: "resqml22.SeismicLatticeSetFeature";
}

/** An unordered set of several seismic lines. Generally, it has no direct interpretation or representation. */
interface _SeismicLineSetFeature extends _AbstractSeismicSurveyFeature { }
export interface SeismicLineSetFeature extends _SeismicLineSetFeature {
  $type: "resqml22.SeismicLineSetFeature";
}

/** The interpretation of this representation must be a WellboreInterpretation.
 *
 * The acquisition information such as the time kind (e.g., TWT vs OWT for example) or survey acquisition type (e.g., checkshot vs VSP) should be captured by the associated acquisition activity. */
interface _SeismicWellboreFrameRepresentation
  extends _WellboreFrameRepresentation {
  CorrectionInformation?: CorrectionInformation;
  LocalTime3dCrs: eml.DataObjectReference;
  /** BUSINESS RULE: Count must be  equal to the inherited NodeCount.
   *
   * The direction of the supporting axis is given by the LocalTime3dCrs itself. It is necessary to get this information to know what means positive or negative values.
   *
   * The values are given with respect to the SeismicReferenceDatum.
   *
   * The UOM is the one specified in the LocalTime3dCrs. */
  NodeTimeValues: eml.AbstractFloatingPointArray;
  /** This is the Z value where the seismic time is equal to zero for this survey wellbore frame.
   *
   * The direction of the supporting axis is given by the LocalTime3dCrs of the associated wellbore trajectory. It is necessary to get the information to know what means a positive or a negative value.
   *
   * The value is given with respect to the ZOffset of the LocalDepth3dCrs of the associated wellbore trajectory.
   *
   * The UOM is the one specified in the LocalDepth3dCrs of the associated wellbore trajectory. */
  SeismicReferenceDatum: number;
  TvdInformation?: TvdInformation;
  /** The UOM is composed by:
   * UOM of the LocalDepth3dCrs of the associated wellbore frame trajectory / UOM of the associated LocalTime3dCrs
   *
   * Sometimes also called seismic velocity replacement. */
  WeatheringVelocity: number;
}
export interface SeismicWellboreFrameRepresentation
  extends _SeismicWellboreFrameRepresentation {
  $type: "resqml22.SeismicWellboreFrameRepresentation";
}

/** The enumerated attributes of a horizon. */
export type SequenceStratigraphySurfaceKind =
  | "flooding"
  | "maximum flooding"
  | "regressive"
  | "maximum regressive"
  | "transgressive"
  | "maximum transgressive"
  | "abandonment"
  | "correlative conformity"
  | "ravinement"
  | "sequence boundary";
interface _SequenceStratigraphySurfaceKind extends eml._TypeEnum {
  _: SequenceStratigraphySurfaceKind;
}

export type SequenceStratigraphySurfaceKindExt = string;
type _SequenceStratigraphySurfaceKindExt = Primitive._string;

/** Enumeration characterizing the 3D shape of a geological unit. */
export type Shape3d =
  | "sheet"
  | "dyke"
  | "dome"
  | "mushroom"
  | "channel"
  | "delta"
  | "dune"
  | "fan"
  | "reef"
  | "wedge";
interface _Shape3d extends eml._TypeEnum {
  _: Shape3d;
}

export type Shape3dExt = string;
type _Shape3dExt = Primitive._string;

/** Location of a single line of shot points in a 2D seismic acquisition. */
interface _ShotPointLineFeature extends _AbstractSeismicLineFeature { }
export interface ShotPointLineFeature extends _ShotPointLineFeature { }

/** The geometry of a single point defined by its location in the local CRS. */
interface _SinglePointGeometry extends _AbstractGeometry {
  Point3d: Point3d;
}
export interface SinglePointGeometry extends _SinglePointGeometry { }

/** Used for properties and property kinds and for geometry. In the latter case, we need to point to the representation. */
interface _SizeInformation extends eml._AbstractGraphicalInformation {
  MinMax?: MinMax;
  /** Indicates that the log of the property values are taken into account when mapped with the index of the color map. */
  UseLogarithmicMapping: boolean;
  /** Indicates that the minimum value of the property corresponds to the maximum index of the color map and that te maximum value of the property corresponds to the minimum index of the color map. */
  UseReverseMapping: boolean;
  /** Especially useful for vectorial property and for geometry. */
  ValueVectorIndex?: number;
}
export interface SizeInformation extends _SizeInformation { }

/** Column edges are needed to construct the indices for the cell faces for column-layer grids. For split column-layer grids, the column edge indices must be defined explicitly. Column edges are not required to describe the lowest order grid geometry, but may be required for higher order geometries or properties. */
interface _SplitColumnEdges extends BaseType {
  /** Column index for each of the split column edges. Used to implicitly define column and cell faces. List-of-lists construction not required because each split column edge must be in a single column. */
  ColumnPerSplitColumnEdge: eml.AbstractIntegerArray;
  /** Number of split column edges in this grid. Must be positive. */
  Count: eml.PositiveLong;
  /** Parent unsplit column edge index for each of the split column edges. Used to implicitly define split face indexing. */
  ParentColumnEdgeIndices: eml.AbstractIntegerArray;
}
export interface SplitColumnEdges extends _SplitColumnEdges { }

/** If split nodes are used in the construction of a column-layer grid and indexable elements of kind edges are referenced, then the grid edges need to be re-defined.
 *
 * Use Case: finite elements, especially for higher order geometry. */
interface _SplitEdges extends BaseType {
  /** Number of edges. Must be positive. */
  Count: eml.PositiveLong;
  /** Association of faces with the split edges, used to infer continuity of property, geometry, or interpretation with an attachment kind of edges. */
  FacesPerSplitEdge: eml.JaggedArray;
  /** Parent unsplit edge index for each of the additional split edges. */
  ParentEdgeIndices: eml.AbstractIntegerArray;
}
export interface SplitEdges extends _SplitEdges { }

/** Optional construction used to introduce additional faces created by split nodes. Used to represent complex geometries, e.g., for stair-step grids and reverse faults. */
interface _SplitFaces extends BaseType {
  /** Cell index for each split face. Used to implicitly define cell geometry. */
  CellPerSplitFace: eml.AbstractIntegerArray;
  /** Number of additional split faces. Count must be positive. */
  Count: eml.PositiveLong;
  /** Parent unsplit face index for each of the additional split faces. */
  ParentFaceIndices: eml.AbstractIntegerArray;
  SplitEdges?: SplitEdges;
}
export interface SplitFaces extends _SplitFaces { }

/** Optional construction used to introduce additional nodes on coordinate lines. Used to represent complex geometries, e.g., for stair-step grids and reverse faults.
 *
 * BUSINESS RULE: Patch index must be positive because a patch index of 0 refers to the fundamental column-layer coordinate line nodes. */
interface _SplitNodePatch extends BaseType {
  /** Cell indices for each of the split nodes. Used to implicitly define cell geometry. List-of-lists construction used to support split nodes shared between multiple cells. */
  CellsPerSplitNode: eml.JaggedArray;
  /** Number of additional split nodes. Count must be positive. */
  Count: eml.PositiveLong;
  /** Parent coordinate line node index for each of the split nodes. Used to implicitly define cell geometry. */
  ParentNodeIndices: eml.AbstractIntegerArray;
  SplitFaces?: SplitFaces;
}
export interface SplitNodePatch extends _SplitNodePatch { }

/** A global interpretation of the stratigraphy, which can be made up of several ranks of stratigraphic unit interpretations.
 *
 * BUSINESS RULE: All stratigraphic column rank interpretations that make up a stratigraphic column must be ordered by age. */
interface _StratigraphicColumn extends eml._AbstractObject {
  Ranks: eml.DataObjectReference[];
}
export interface StratigraphicColumn extends _StratigraphicColumn {
  $type: "resqml22.StratigraphicColumn";
}

/** A global hierarchy containing an ordered list of stratigraphic unit interpretations. */
interface _StratigraphicColumnRankInterpretation
  extends _AbstractGeologicUnitOrganizationInterpretation {
  /** The rank in the stratigraphic column. */
  RankInStratigraphicColumn: eml.NonNegativeLong;
  StratigraphicUnits: eml.DataObjectReference[];
}
export interface StratigraphicColumnRankInterpretation
  extends _StratigraphicColumnRankInterpretation {
  $type: "resqml22.StratigraphicColumnRankInterpretation";
}

/** This represents a stratigraphic boundary between two intervals. */
interface _StratigraphicIntervalBoundary extends _MarkerBoundary {
  /** This is an optional boolean indicating that the relationship between the boundary and the unit above is conformable. It is typically used as a placeholder for the interpreter to put some information before the association with an organization is made. */
  ContactConformableAbove?: boolean;
  /** This is an optional boolean indicating that the relationship between the boundary and the unit below is conformable. It is typically used as a placeholder for the interpreter to put some information before the association with an organization is made. */
  ContactConformableBelow?: boolean;
}
export interface StratigraphicIntervalBoundary
  extends _StratigraphicIntervalBoundary { }

/** Interpretation of the stratigraphic role of a picked horizon (chrono, litho or bio).
 * Here the word “role” is a business term which doesn’t correspond to an entity dependent from an external property but simply characterizes a kind of horizon. */
export type StratigraphicRole =
  | "chronostratigraphic"
  | "lithostratigraphic"
  | "biostratigraphic"
  | "magnetostratigraphic"
  | "chemostratigraphic"
  | "seismicstratigraphic";
interface _StratigraphicRole extends eml._TypeEnum {
  _: StratigraphicRole;
}

/** A volume of rock of identifiable origin and relative age range that is defined by the distinctive and dominant, easily mapped and recognizable features that characterize it (petrographic, lithologic, paleontologic, paleomagnetic or chemical features).
 * Some stratigraphic units (chronostratigraphic units) have a GeneticBoundaryBasedTimeInterval (between its ChronoTop and ChronoBottom) defined by a BoundaryFeatureInterpretation.
 * A stratigraphic unit has no direct link to its physical top and bottom limits. These physical limits are only defined as contacts between StratigraphicUnitInterpretations defined within a StratigraphicOrganizationInterpretation. */
interface _StratigraphicUnitInterpretation extends _GeologicUnitInterpretation {
  /** BUSINESS RULE: The deposition mode for a geological unit MUST be consistent with the boundary relations of a genetic boundary. If it is not, then the boundary relation declaration is retained. */
  DepositionMode?: DepositionMode;
  MaxThickness?: eml.LengthMeasure;
  MinThickness?: eml.LengthMeasure;
  StratigraphicRole?: StratigraphicRole;
}
export interface StratigraphicUnitInterpretation
  extends _StratigraphicUnitInterpretation {
  $type: "resqml22.StratigraphicUnitInterpretation";
}

/** Enumeration of the usual streamline fluxes */
export type StreamlineFlux = "oil" | "gas" | "water" | "total" | "other";
interface _StreamlineFlux extends eml._TypeEnum {
  _: StreamlineFlux;
}

export type StreamlineFluxExt = string;
type _StreamlineFluxExt = Primitive._string;

/** Specification of the vector field upon which the streamlines are based. Streamlines are commonly used to trace the flow of phases (water / oil / gas / total) based upon their flux at a specified time. They may also be used for trace components for compositional simulation, e.g., CO2, or temperatures for thermal simulation.
 *
 * The flux enumeration provides support for the most usual cases with provision for extensions to other fluxes. */
interface _StreamlinesFeature extends _AbstractTechnicalFeature {
  /** Specification of the streamline flux, drawn from the enumeration. */
  Flux: StreamlineFluxExt;
  TimeIndex: eml.TimeIndex;
}
export interface StreamlinesFeature extends _StreamlinesFeature {
  $type: "resqml22.StreamlinesFeature";
}

/** Representation of streamlines associated with a streamline feature and interpretation.
 *
 * Use StreamlinesFeature to define the vector field that supports the streamlines, i.e., describes what flux is being traced.
 *
 * Use Interpretation to distinguish between shared and differing interpretations.
 *
 * Usage Note: When defining streamline geometry, the PatchIndex is not referenced and may be set to a value of 0. */
interface _StreamlinesRepresentation extends _AbstractRepresentation {
  Geometry?: PolylineSetPatch;
  /** Number of streamlines. */
  LineCount: eml.PositiveLong;
  StreamlineWellbores?: StreamlineWellbores;
}
export interface StreamlinesRepresentation extends _StreamlinesRepresentation {
  $type: "resqml22.StreamlinesRepresentation";
}

/** Used to specify the wellbores on which streamlines may originate or terminate. Additional properties, e.g., MD, or cell index may be used to specify locations along a wellbore.
 *
 * The 0-based wellbore index is defined by the order of the wellbore in the list of WellboreTrajectoryRepresentation references. */
interface _StreamlineWellbores extends BaseType {
  /** Size of array = LineCount.
   *
   * Null values signify that that line does not initiate at an injector, e.g., it may come from fluid expansion or an aquifer. */
  InjectorPerLine: eml.AbstractIntegerArray;
  /** Size of array = LineCount
   *
   * Null values signify that that line does not terminate at a producer, e.g., it may approach a stagnation area.
   *
   * BUSINESS RULE: The cell count must equal the number of non-null entries in this array. */
  ProducerPerLine: eml.AbstractIntegerArray;
  WellboreTrajectoryRepresentation: eml.DataObjectReference[];
}
export interface StreamlineWellbores extends _StreamlineWellbores {
  $type: "resqml22.StreamlineWellbores";
}

/** One of the main types of RESQML organizations, this class gathers boundary interpretations (e.g., horizons, faults and fault networks) plus frontier features and their relationships (contacts interpretations), which when taken together define the structure of a part of the earth.
 * IMPLEMENTATION RULE: Two use cases are presented:
 *
 * 1. If the relative age or apparent depth between faults and horizons is unknown, the writer must provide all individual faults within the UnorderedFaultCollection FeatureInterpretationSet.
 * 2. Else, the writer must provide individual faults and fault collections within the OrderedBoundaryFeatureInterpretation list.
 *
 * BUSINESS RULE: Two use cases are processed:
 *
 * 1. If relative age or apparent depth between faults and horizons are unknown, the writer must provides all individual faults within the UnorderedFaultCollection FeatureInterpretationSet.
 * 2. Else, individual faults and fault collections are provided within the OrderedBoundaryFeatureInterpretation list. */
interface _StructuralOrganizationInterpretation
  extends _AbstractOrganizationInterpretation {
  AscendingOrderingCriteria: OrderingCriteria;
  /** BUSINESS RULE: It either points to a CulturalFeature whose Kind is model frontier or to a BoundaryFeatureInterpretation if the frontier is actually a geologic surface */
  BottomFrontier?: eml.DataObjectReference[];
  OrderedBoundaryFeatureInterpretation?: BoundaryFeatureInterpretationPlusItsRank[];
  /** BUSINESS RULE: It either points to a CulturalFeature whose Kind is model frontier or to a BoundaryFeatureInterpretation if the frontier is actually a geologic surface */
  Sides?: eml.DataObjectReference[];
  /** BUSINESS RULE: It either points to a CulturalFeature whose Kind is model frontier or to a BoundaryFeatureInterpretation if the frontier is actually a geologic surface */
  TopFrontier?: eml.DataObjectReference[];
}
export interface StructuralOrganizationInterpretation
  extends _StructuralOrganizationInterpretation {
  $type: "resqml22.StructuralOrganizationInterpretation";
}

/** SubnodeNodeObject is used to specify the node object that supports the subnodes. This determines the number of nodes per subnode and the continuity of the associated geometry or property. For instance, for hexahedral cells, cell indicates a fixed value of 8, while for an unstructured column layer grid, cell indicates that this count varies from column to column. */
export type SubnodeNodeObject = "cell" | "face" | "edge";
interface _SubnodeNodeObject extends eml._TypeEnum {
  _: SubnodeNodeObject;
}

/** Each patch of subnodes is defined independently of the others. Number of nodes per object is determined by the subnode kind. */
interface _SubnodePatch extends BaseType {
  /** Node weights for each subnode. Count of nodes per subnode is known for each specific subnode construction.
   *
   * Data order consists of all the nodes for each subnode in turn. For example, if uniform and stored as a multi-dimensional array, the node index cycles first.
   *
   * BUSINESS RULE: Weights must be non-negative.
   *
   * BUSINESS RULE: Length of array must be consistent with the sum of nodeCount x subnodeCount per object, e.g., for 3 subnodes per edge (uniform), there are 6 weights. */
  NodeWeightsPerSubnode: eml.AbstractValueArray;
  SubnodeNodeObject: SubnodeNodeObject;
}
export interface SubnodePatch extends _SubnodePatch { }

/** Finite element subnode topology for an unstructured cell can be either variable or uniform, but not columnar. */
interface _SubnodeTopology extends BaseType {
  UniformSubnodePatch?: UniformSubnodePatch[];
  VariableSubnodePatch?: VariableSubnodePatch[];
}
export interface SubnodeTopology extends _SubnodeTopology { }

/** An ordered list of indexable elements and/or indexable element pairs of an existing representation.
 * Because the representation concepts of topology, geometry, and property values are separate in RESQML, it is now possible to select a range of nodes, edges, faces, or volumes (cell) indices from the topological support of an existing representation to define a sub-representation.
 * A sub-representation may describe a different feature interpretation using the same geometry or property as the "parent" representation. In this case, the only information exchanged is a set of potentially non-consecutive indices of the topological support of the representation.
 *
 * Optional additional grid topology is available for grid representations. */
interface _SubRepresentation extends _AbstractRepresentation {
  AdditionalGridTopology?: AdditionalGridTopology;
  IndexableElement: eml.IndexableElement;
  SubRepresentationPatch: SubRepresentationPatch[];
}
export interface SubRepresentation extends _SubRepresentation { }

/** Each sub-representation patch has its own list of representation indices, drawn from the supporting representation.
 *
 * If a list of pairwise elements is required, use two ElementIndices. The count of elements (or pair of elements) is defined in SubRepresentationPatch. */
interface _SubRepresentationPatch extends BaseType {
  Indices: eml.AbstractIntegerArray;
  SupportingRepresentation: eml.DataObjectReference;
}
export interface SubRepresentationPatch extends _SubRepresentationPatch { }

/** Indicates the various roles that a surface topology can have. */
export type SurfaceRole = "map" | "pick";
interface _SurfaceRole extends eml._TypeEnum {
  _: SurfaceRole;
}

/** List of three 3D points. */
interface _ThreePoint3d extends BaseType {
  Point3d: Point3d[];
}
export interface ThreePoint3d extends _ThreePoint3d { }

/** Enumeration that characterizes the type of discontinuity corresponding to a fault. */
export type ThrowKind =
  | "reverse"
  | "strike-slip"
  | "normal"
  | "thrust"
  | "scissor"
  | "variable";
interface _ThrowKind extends eml._TypeEnum {
  _: ThrowKind;
}

export type ThrowKindExt = string;
type _ThrowKindExt = Primitive._string;

/** Describes the geometry of a tilted (or potentially not tilted) plane from three points. */
interface _TiltedPlaneGeometry extends _AbstractPlaneGeometry {
  Plane: ThreePoint3d[];
}
export interface TiltedPlaneGeometry extends _TiltedPlaneGeometry { }

/** Patch made of triangles, where the number of triangles is given by the patch count.
 * BUSINESS RULE: Within a patch, all the triangles must be contiguous.
 *
 * The patch contains:
 * - Number of nodes within the triangulation and their locations.
 * - 2D array describing the topology of the triangles.
 *
 * Two triangles that are connected may be in different patches. */
interface _TrianglePatch extends BaseType {
  Geometry: PointGeometry;
  NodeCount: eml.NonNegativeLong;
  SplitEdgePatch?: EdgePatch[];
  /** The triangles are a 2D array of non-negative integers with the dimensions 3 x numTriangles. */
  Triangles: eml.AbstractIntegerArray;
}
export interface TrianglePatch extends _TrianglePatch { }

/** A representation based on set of triangulated mesh patches, which gets its geometry from a 1D array of points.
 *
 * BUSINESS RULE: The orientation of all the triangles of this representation must be consistent. */
interface _TriangulatedSetRepresentation
  extends _AbstractSurfaceRepresentation {
  TrianglePatch: TrianglePatch[];
}
export interface TriangulatedSetRepresentation
  extends _TriangulatedSetRepresentation {
  $type: "resqml22.TriangulatedSetRepresentation";
}

/** Grid class with an underlying IJK topology, together with a 1D split-cell list. The truncated IJK cells have more than the usual 6 faces. The split cells are arbitrary polyhedra, identical to those of an unstructured cell grid. */
interface _TruncatedIjkGridRepresentation
  extends _AbstractTruncatedColumnLayerGridRepresentation {
  Geometry: IjkGridGeometry;
  /** Count of I-indices in the grid. Must be positive. */
  Ni: eml.PositiveLong;
  /** Count of J-indices in the grid. Must be positive. */
  Nj: eml.PositiveLong;
}
export interface TruncatedIjkGridRepresentation
  extends _TruncatedIjkGridRepresentation {
  $type: "resqml22.TruncatedIjkGridRepresentation";
}

/** Grid class with an underlying unstructured column-layer topology, together with a 1D split-cell list. The truncated cells have more than the usual number of faces within each column. The split cells are arbitrary polyhedra, identical to those of an unstructured cell grid. */
interface _TruncatedUnstructuredColumnLayerGridRepresentation
  extends _AbstractTruncatedColumnLayerGridRepresentation {
  /** Number of unstructured columns in the grid. Must be positive. */
  ColumnCount: eml.PositiveLong;
  Geometry: UnstructuredColumnLayerGridGeometry;
}
export interface TruncatedUnstructuredColumnLayerGridRepresentation
  extends _TruncatedUnstructuredColumnLayerGridRepresentation {
  $type: "resqml22.TruncatedUnstructuredColumnLayerGridRepresentation";
}

/** Truncation definitions for the truncated and split cells.
 *
 * BUSINESS RULE: Patch Index must be positive because a patch index of 0 refers to the fundamental column-layer coordinate line nodes and cells. */
interface _TruncationCellPatch extends BaseType {
  /** Local cell face index for those faces that are retained from the parent cell in the definition of the truncation cell.
   *
   * The use of a local cell-face index, e.g., 0...5 for an IJK cell, can be used even if the face indices have not been defined. */
  LocalFacesPerCell: eml.JaggedArray;
  /** Definition of the truncation faces is in terms of an ordered list of nodes. Node indexing is EXTENDED, i.e., is based on the list of untruncated grid nodes (always first) plus the split nodes (if any) and the truncation face nodes. Relative order of split nodes and truncation face nodes is set by the pillar indices. */
  NodesPerTruncationFace: eml.JaggedArray;
  /** Parent cell index for each of the truncation cells.
   *
   * BUSINESS RULE: Size must match truncationCellCount */
  ParentCellIndices: eml.AbstractIntegerArray;
  /** Number of polyhedral cells created by truncation. Must be positive. Note: Parent cells are replaced. */
  TruncationCellCount: eml.PositiveLong;
  /** Boolean mask used to indicate which truncation cell faces have an outwardly directed normal, following a right hand rule. Data size and order follows the truncationFacesPerCell list-of-lists. */
  TruncationCellFaceIsRightHanded: eml.AbstractBooleanArray;
  /** Number of additional faces required for the split and truncation construction. The construction does not modify existing face definitions, but instead uses these new faces to redefine the truncated cell geometry. Must be positive.
   *
   * These faces are added to the enumeration of faces for the grid */
  TruncationFaceCount: eml.PositiveLong;
  /** Truncation face index for the additional cell faces that are required to complete the definition of the truncation cell.
   *
   * The resulting local cell face index follows the local faces-per-cell list, followed by the truncation faces in the order within the list-of-lists constructions. */
  TruncationFacesPerCell: eml.JaggedArray;
  /** Number of additional nodes required for the truncation construction. Must be positive. Uses a separate enumeration and does not increase the number of nodes, except as noted below. */
  TruncationNodeCount: eml.PositiveLong;
}
export interface TruncationCellPatch extends _TruncationCellPatch { }

/** Business rule: */
interface _TvdInformation extends BaseType {
  LocalDepth3dCrs: eml.DataObjectReference;
  /** Count must be equal to count of nodes of the associated wellbore frame.
   *
   * The direction of the supporting axis is given by the LocalDepth3dCrs itself. It is necessary to get the information to know what are positive or negative values.
   *
   * The values are given with respect to the TvdDatum, not with respect to the ZOffest of the LocalDepth3dCrs
   *
   * The UOM is the one specified in the LocalDepth3dCrs. */
  NodeTvdValues: eml.AbstractFloatingPointArray;
  /** The direction of the supporting axis is given by the LocalDepth3dCrs itself. It is necessary to get the information to know what is a positive or a negative value.
   *
   * The value is given with respect to the ZOffset of the  LocalDepth3dCrs.
   *
   * The UOM is the one specified in the LocalDepth3dCrs. */
  TvdDatum: number;
  TvdReference: eml.DataObjectReference;
}
export interface TvdInformation extends _TvdInformation { }

/** Use this subnode construction if the number of subnodes is the same for every object, e.g., 3 subnodes per edge for all edges. */
interface _UniformSubnodePatch extends _SubnodePatch {
  /** Number of subnodes per object, with the same number for each of this data-object kind in the grid. */
  SubnodeCountPerObject: eml.PositiveLong;
}
export interface UniformSubnodePatch extends _UniformSubnodePatch { }

/** Column edges are used to construct the index for faces. For unstructured column-layer grids, the column edge indices must be defined explicitly. Column edges are not required to describe lowest order grid geometry, but may be needed for higher order geometries or properties. */
interface _UnstructuredColumnEdges extends BaseType {
  /** Number of unstructured column edges in this grid. Must be positive. */
  Count: eml.PositiveLong;
  /** Definition of the column edges in terms of the pillars-per-column edge. Pillar count per edge is usually 2, but the list-of-lists construction is used to allow column edges to be defined by more than 2 pillars. */
  PillarsPerColumnEdge: eml.JaggedArray;
}
export interface UnstructuredColumnEdges extends _UnstructuredColumnEdges { }

/** Used to specify unstructured column-layer grid patch(es) within a general purpose grid.
 *
 * Multiple patches are supported. */
interface _UnstructuredColumnLayerGpGridPatch extends BaseType {
  Geometry?: UnstructuredColumnLayerGridGeometry;
  TruncationCellPatch?: TruncationCellPatch;
  /** Number of unstructured columns. Degenerate case (count=0) is allowed for GPGrid. */
  UnstructuredColumnCount: eml.NonNegativeLong;
}
export interface UnstructuredColumnLayerGpGridPatch
  extends _UnstructuredColumnLayerGpGridPatch { }

/** Description of the geometry of an unstructured column-layer grid, e.g., parity and pinch, together with its supporting topology.
 *
 * Unstructured column-layer cell geometry is derived from column-layer cell geometry and hence is based upon nodes on coordinate lines.
 *
 * Geometry is contained within the representation of a grid. */
interface _UnstructuredColumnLayerGridGeometry
  extends _AbstractColumnLayerGridGeometry {
  /** List of columns that are right handed. Right handedness is evaluated following the pillar order and the K-direction tangent vector for each column. */
  ColumnIsRightHanded: eml.AbstractBooleanArray;
  ColumnShape: ColumnShape;
  /** Number of pillars in the grid. Must be positive. Pillars are used to describe the shape of the columns in the grid. */
  PillarCount: eml.PositiveLong;
  /** List of pillars for each column. The pillars define the corners of each column.
   *
   * The number of pillars per column can be obtained from the offsets in the first list-of-lists array.
   *
   * BUSINESS RULE: The length of the first array in the list -of-lists construction must equal the columnCount. */
  PillarsPerColumn: eml.JaggedArray;
  UnstructuredColumnEdges?: UnstructuredColumnEdges;
}
export interface UnstructuredColumnLayerGridGeometry
  extends _UnstructuredColumnLayerGridGeometry { }

/** Grid whose topology is characterized by an unstructured column index and a layer index, K.
 *
 * Cell geometry is characterized by nodes on coordinate lines, where each column of the model may have an arbitrary number of sides. */
interface _UnstructuredColumnLayerGridRepresentation
  extends _AbstractColumnLayerGridRepresentation {
  /** Number of unstructured columns in the grid. Must be positive. */
  ColumnCount: eml.PositiveLong;
  Geometry?: UnstructuredColumnLayerGridGeometry;
}
export interface UnstructuredColumnLayerGridRepresentation
  extends _UnstructuredColumnLayerGridRepresentation { }

/** Used to specify unstructured cell grid patch(es) within a general purpose grid.
 *
 * Multiple patches are supported. */
interface _UnstructuredGpGridPatch extends BaseType {
  Geometry?: UnstructuredGridGeometry;
  /** Number of unstructured cells. Degenerate case (count=0) is allowed for GPGrid. */
  UnstructuredCellCount: eml.NonNegativeLong;
}
export interface UnstructuredGpGridPatch extends _UnstructuredGpGridPatch { }

/** Description of the geometry of an unstructured cell grid, which includes geometric characteristics, e.g., cell face parity, and supporting topology.
 *
 * Each grid cell is defined by a (signed) list of cell faces. Each cell face is defined by a list of nodes. */
interface _UnstructuredGridGeometry extends _AbstractGridGeometry {
  /** Boolean mask used to indicate which cell faces have an outwardly directed normal following a right hand rule. Array length is the sum of the cell face count per cell, and the data follows the order of the faces per cell RESQMLlist-of-lists. */
  CellFaceIsRightHanded: eml.AbstractBooleanArray;
  CellShape: CellShape;
  /** Total number of faces in the grid. Must be positive. */
  FaceCount: eml.PositiveLong;
  /** List of faces per cell. Face count per cell can be obtained from the offsets in the first list-of-lists array.
   *
   * BUSINESS RULE: CellCount must match the length of the first list-of-lists array. */
  FacesPerCell: eml.JaggedArray;
  /** Total number of nodes in the grid. Must be positive. */
  NodeCount: eml.PositiveLong;
  /** List of nodes per face. Node count per face can be obtained from the offsets in the first list-of-lists array.
   *
   * BUSINESS RULE: FaceCount must match the length of the first list- of-lists array. */
  NodesPerFace: eml.JaggedArray;
  UnstructuredGridHingeNodeFaces?: UnstructuredGridHingeNodeFaces;
  UnstructuredSubnodeTopology?: UnstructuredSubnodeTopology;
}
export interface UnstructuredGridGeometry extends _UnstructuredGridGeometry { }

/** Hinge nodes define a triangulated interpolation on a cell face. In practice, they arise on the K faces of column layer cells and are used to add additional geometric resolution to the shape of the cell. The specification of triangulated interpolation also uniquely defines the interpolation schema on the cell face, and hence the cell volume.
 *
 * For an unstructured cell grid, the hinge node faces need to be defined explicitly.
 *
 * This hinge node faces data-object is optional and is only expected to be used if the hinge node faces higher order grid point attachment arises. Hinge node faces are not supported for property attachment. Instead use a subrepresentation or an attachment kind of faces or faces per cell.
 *
 * BUSINESS RULE: Each cell must have either 0 or 2 hinge node faces, so that the two hinge nodes for the cell may be used to define a cell center line and a cell thickness. */
interface _UnstructuredGridHingeNodeFaces extends BaseType {
  /** Number of K faces. This count must be positive. */
  Count: eml.PositiveLong;
  /** List of faces to be identified as K faces for hinge node geometry attachment.
   *
   * BUSINESS RULE: Array length equals K face count. */
  FaceIndices: eml.AbstractIntegerArray;
}
export interface UnstructuredGridHingeNodeFaces
  extends _UnstructuredGridHingeNodeFaces { }

/** Unstructured grid representation characterized by a cell count, and potentially nothing else. Both the oldest and newest simulation formats are based on this format. */
interface _UnstructuredGridRepresentation extends _AbstractGridRepresentation {
  /** Number of cells in the grid. Must be positive. */
  CellCount: eml.PositiveLong;
  Geometry?: UnstructuredGridGeometry;
  OriginalCellIndex?: AlternateCellIndex;
}
export interface UnstructuredGridRepresentation
  extends _UnstructuredGridRepresentation { }

/** If edge subnodes are used, then edges must be defined. If cell subnodes are used, nodes per cell must be defined. */
interface _UnstructuredSubnodeTopology extends _SubnodeTopology {
  Edges?: Edges;
  NodesPerCell?: eml.JaggedArray;
}
export interface UnstructuredSubnodeTopology
  extends _UnstructuredSubnodeTopology { }

/** If the number of subnodes per data-object are variable for each data-object, use this subnode construction. */
interface _VariableSubnodePatch extends _SubnodePatch {
  /** Indices of the selected data-objects */
  ObjectIndices: eml.AbstractIntegerArray;
  /** Number of subnodes per selected data-object. */
  SubnodeCountPerSelectedObject: eml.AbstractIntegerArray;
}
export interface VariableSubnodePatch extends _VariableSubnodePatch { }

/** Standardized kinds of viewers. */
export type ViewerKind = "3d" | "base map" | "section" | "well correlation";
interface _ViewerKind extends eml._TypeEnum {
  _: ViewerKind;
}

/** Allows you to use custom viewer kinds in addition to the ViewerKind enumeration. */
export type ViewerKindExt = string;
type _ViewerKindExt = Primitive._string;

/** A group of ReservoirSegments which are hydraulically connected and are generally developed as a single reservoir.
 *
 * Membership in this organization can change over time (geologic and over the life of a field or interpretation activity) and is an interpretation. */
interface _VoidageGroupInterpretation
  extends _AbstractOrganizationInterpretation {
  Compartments?: ReservoirCompartmentInterpretation[];
  Fluids?: eml.DataObjectReference;
  Stratigraphy?: eml.DataObjectReference;
}
export interface VoidageGroupInterpretation
  extends _VoidageGroupInterpretation { }

/** The volume within a shell. */
interface _VolumeRegion extends BaseType {
  ExternalShell: VolumeShell;
  InternalShells?: VolumeShell[];
  Represents: eml.DataObjectReference;
}
export interface VolumeRegion extends _VolumeRegion { }

/** The shell or envelope of a geologic unit. It is a collection of macro faces. Each macro face is defined by a triplet of values, each value being at the same index in the three arrays contained in this class. */
interface _VolumeShell extends BaseType {
  /** Each index identifies the surface representation patch describing the macro face. */
  PatchIndicesOfRepresentation: eml.IntegerExternalArray;
  /** Each index identifies the macro face surface representation by its index in the list of representations contained in the organization. */
  RepresentationIndices: eml.IntegerExternalArray;
  /** Each index identifies the side of the macro face. */
  SideIsPlus: eml.BooleanExternalArray;
}
export interface VolumeShell extends _VolumeShell { }

/** May refer to one of these:
 * wellbore. A unique, oriented path from the bottom of a drilled borehole to the surface of the earth. The path must not overlap or cross itself.
 *
 * borehole. A hole excavated in the earth as a result of drilling or boring operations. The borehole may represent the hole of an entire wellbore (when no sidetracks are present), or a sidetrack extension. A borehole extends from an originating point (the surface location for the initial borehole or kickoff point for sidetracks) to a terminating (bottomhole) point.
 *
 * sidetrack. A borehole that originates in another borehole as opposed to originating at the surface. */
interface _WellboreFeature extends _AbstractTechnicalFeature {
  WitsmlWellbore?: WitsmlWellWellbore;
}
export interface WellboreFeature extends _WellboreFeature {
  $type: "resqml22.WellboreFeature";
}

/** Representation of a wellbore that is organized along a wellbore trajectory by its MD values. RESQML uses MD values to associate properties on points and to organize association of properties on intervals between MD points.
 *
 * For this particular representation a WITSML v2 Wellbore is considered as a RESQML Technical Feature, meaning that the WITSML v2 Wellbore can be used as the represented data object for this representation. */
interface _WellboreFrameRepresentation extends _AbstractRepresentation {
  CellFluidPhaseUnits?: CellFluidPhaseUnits;
  IntervalStratigraphicUnits?: IntervalStratigraphicUnits[];
  /** Number of nodes. Must be positive. */
  NodeCount: eml.PositiveLong;
  /** MD values for each node.
   * BUSINESS RULE: MD values and UOM must be consistent with the trajectory representation. */
  NodeMd: eml.AbstractFloatingPointArray;
  Trajectory: eml.DataObjectReference;
  /** The reference to the equivalent WITSML well log. */
  WitsmlLog?: eml.DataObjectReference;
}
export interface WellboreFrameRepresentation
  extends _WellboreFrameRepresentation {
  $type: "resqml22.WellboreFrameRepresentation";
}

/** Contains the data describing an opinion of a borehole. This interpretation is relative to one particular well trajectory. */
interface _WellboreInterpretation extends _AbstractFeatureInterpretation {
  /** Used to indicate that this wellbore has been, or is being, drilled, as opposed to planned wells. One wellbore feature may have multiple wellbore interpretations.
   * - For updated drilled trajectories, use IsDrilled=TRUE.
   * - For planned trajectories, use IsDrilled=FALSE used. */
  IsDrilled: boolean;
}
export interface WellboreInterpretation extends _WellboreInterpretation {
  $type: "resqml22.WellboreInterpretation";
}

interface _WellboreIntervalSet extends _AbstractRepresentation {
  IntervalBoundaries?: MarkerBoundary[];
  MarkerInterval: MarkerInterval[];
}
export interface WellboreIntervalSet extends _WellboreIntervalSet {
  $type: "resqml22.WellboreIntervalSet";
}

/** For a wellbore trajectory in a multi-lateral well, indicates the MD of the kickoff point where the trajectory begins and the corresponding MD of the parent trajectory. */
interface _WellboreTrajectoryParentIntersection extends BaseType {
  /** KickoffMd is the measured depth for the start of the child trajectory, as defined within the child. */
  KickoffMd: number;
  /** If the kickoff MD in the child (KickoffMd) is different from the kickoff MD in the parent (ParentMd), then specify the ParentMD here. If not specified, then these two MD's are implied to be identical. */
  ParentMd?: number;
  ParentTrajectory: eml.DataObjectReference;
}
export interface WellboreTrajectoryParentIntersection
  extends _WellboreTrajectoryParentIntersection { }

/** Representation of a wellbore trajectory.
 *
 * For this particular representation a WITSML v2 Wellbore is considered as a RESQML Technical Feature, meaning that the WITSML v2 Wellbore can be used as the represented data object for this representation. */
interface _WellboreTrajectoryRepresentation extends _AbstractRepresentation {
  /** If the unit of measure of the MdInterval is an extended value, this is a reference to an object containing the custom unit dictionary. */
  CustomUnitDictionary?: eml.DataObjectReference;
  /** Explicit geometry is not required for vertical wells */
  Geometry?: AbstractParametricLineGeometry;
  /** Indicates if the MD is either in “driller” domain or “logger” domain. */
  MdDomain?: MdDomain;
  /** The interval which represents the minimum and maximum values of measured depth for the trajectory.
   *
   * BUSINESS RULE: For purposes of the trajectory the MdDatum within the MdInterval is mandatory.
   *
   * BUSINESS RULE: The MdMin must be less than the MdMax within the MdInterval */
  MdInterval: eml.MdInterval;
  ParentIntersection?: WellboreTrajectoryParentIntersection;
  /** Pointer to the WITSML trajectory that is contained in the referenced wellbore. (For information about WITSML well and wellbore references, see the definition for RESQML technical feature, WellboreFeature). */
  WitsmlTrajectory?: eml.DataObjectReference;
}
export interface WellboreTrajectoryRepresentation
  extends _WellboreTrajectoryRepresentation {
  $type: "resqml22.WellboreTrajectoryRepresentation";
}

/** Reference to the WITSML wellbore that this wellbore feature is based on. */
interface _WitsmlWellWellbore extends BaseType {
  WitsmlWell: eml.DataObjectReference;
  WitsmlWellbore: eml.DataObjectReference;
}
export interface WitsmlWellWellbore extends _WitsmlWellWellbore {
  $type: "resqml22.WitsmlWellWellbore";
}

export interface document extends BaseType {
  BlockedWellboreRepresentation: BlockedWellboreRepresentation;
  BooleanProperty: BooleanProperty;
  BoundaryFeature: BoundaryFeature;
  BoundaryFeatureInterpretation: BoundaryFeatureInterpretation;
  CmpLineFeature: CmpLineFeature;
  ColorMapDictionary: ColorMapDictionary;
  CommentProperty: CommentProperty;
  ContinuousColorMap: ContinuousColorMap;
  ContinuousProperty: ContinuousProperty;
  CulturalFeature: CulturalFeature;
  DiscreteColorMap: DiscreteColorMap;
  DiscreteProperty: DiscreteProperty;
  EarthModelInterpretation: EarthModelInterpretation;
  FaultInterpretation: FaultInterpretation;
  FluidBoundaryInterpretation: FluidBoundaryInterpretation;
  GenericFeatureInterpretation: GenericFeatureInterpretation;
  GeobodyBoundaryInterpretation: GeobodyBoundaryInterpretation;
  GeobodyInterpretation: GeobodyInterpretation;
  GeologicUnitInterpretation: GeologicUnitInterpretation;
  GeologicUnitOccurrenceInterpretation: GeologicUnitOccurrenceInterpretation;
  GpGridRepresentation: GpGridRepresentation;
  Grid2dRepresentation: Grid2dRepresentation;
  GridConnectionSetRepresentation: GridConnectionSetRepresentation;
  HorizonInterpretation: HorizonInterpretation;
  IjkGridRepresentation: IjkGridRepresentation;
  LocalGridSet: LocalGridSet;
  Model: Model;
  NonSealedSurfaceFrameworkRepresentation: NonSealedSurfaceFrameworkRepresentation;
  PlaneSetRepresentation: PlaneSetRepresentation;
  PointSetRepresentation: PointSetRepresentation;
  PointsProperty: PointsProperty;
  PolylineRepresentation: PolylineRepresentation;
  PolylineSetRepresentation: PolylineSetRepresentation;
  RepresentationIdentitySet: RepresentationIdentitySet;
  RepresentationSetRepresentation: RepresentationSetRepresentation;
  RockFluidOrganizationInterpretation: RockFluidOrganizationInterpretation;
  RockFluidUnitInterpretation: RockFluidUnitInterpretation;
  RockVolumeFeature: RockVolumeFeature;
  SealedSurfaceFrameworkRepresentation: SealedSurfaceFrameworkRepresentation;
  SealedVolumeFrameworkRepresentation: SealedVolumeFrameworkRepresentation;
  Seismic2dPostStackRepresentation: Seismic2dPostStackRepresentation;
  Seismic3dPostStackRepresentation: Seismic3dPostStackRepresentation;
  SeismicLatticeFeature: SeismicLatticeFeature;
  SeismicLineSetFeature: SeismicLineSetFeature;
  SeismicWellboreFrameRepresentation: SeismicWellboreFrameRepresentation;
  ShotPointLineFeature: ShotPointLineFeature;
  StratigraphicColumn: StratigraphicColumn;
  StratigraphicColumnRankInterpretation: StratigraphicColumnRankInterpretation;
  StratigraphicUnitInterpretation: StratigraphicUnitInterpretation;
  StreamlinesFeature: StreamlinesFeature;
  StreamlinesRepresentation: StreamlinesRepresentation;
  StructuralOrganizationInterpretation: StructuralOrganizationInterpretation;
  SubRepresentation: SubRepresentation;
  TriangulatedSetRepresentation: TriangulatedSetRepresentation;
  TruncatedIjkGridRepresentation: TruncatedIjkGridRepresentation;
  TruncatedUnstructuredColumnLayerGridRepresentation: TruncatedUnstructuredColumnLayerGridRepresentation;
  UnstructuredColumnLayerGridRepresentation: UnstructuredColumnLayerGridRepresentation;
  UnstructuredGridRepresentation: UnstructuredGridRepresentation;
  WellboreFeature: WellboreFeature;
  WellboreFrameRepresentation: WellboreFrameRepresentation;
  WellboreInterpretation: WellboreInterpretation;
  WellboreIntervalSet: WellboreIntervalSet;
  WellboreTrajectoryRepresentation: WellboreTrajectoryRepresentation;
}
export const document: document;
