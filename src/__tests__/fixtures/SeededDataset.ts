// ============================================================================
// Seeded-dataset descriptors for the integration suites.
//
// The integration tests (TestClient, TestProtocolsIntegration) run against a
// store that was seeded with a known EPC/H5 pair (RDMS_SEED_DATASPACE /
// RDMS_PROJECTS_TO_IMPORT_IN_EML in the compose stack). Every data-dependent
// expectation (object counts, a focus representation, its interpretation, an
// array path, a filter) lives here, keyed by dataset name, so the suites stay
// data-driven and a different seed only needs a new entry — not test edits.
//
// Select with RDMS_TEST_SEEDED_DATASET (default: "drogon", the committed
// data/Demo_Drogon.epc + data/drogon_small.h5 fixture used by CI).
// ============================================================================

export interface SeededRepresentation {
  /** ETP data-object type, e.g. resqml20.obj_PolylineSetRepresentation. */
  type: string;
  uuid: string;
  /** Citation/Title of the object. */
  name: string;
  /** Number of representations of `type` in the dataspace. */
  countOfType: number;
  /** P3 getSources / getTargets counts for the object. */
  sourceCount: number;
  targetCount: number;
  /** Number of arrays reported by GET .../{type}/{uuid}/arrays. */
  arrayCount: number;
  /** eml20 EpcExternalPartReference that owns the arrays. */
  hdfProxyUuid: string;
  /** JSON path (from the resolved object) to the points Hdf5Dataset. */
  pointsJsonPath: string[];
  /** Points array: pathInResource and its first dimension. */
  pointsPath: string;
  pointsFirstDimension: number;
  /** Row/column coordinate of a point value and its expected value. */
  pointsProbe: { starts: [number, number]; value: number };
  /** An Int32 array of the object and its first value. */
  int32Path: string;
  int32FirstValue: number;
  /** OSDU WPC kind the manifest builder emits for the representation. */
  wpcKind: string;
}

export interface SeededInterpretation {
  type: string;
  uuid: string;
  /** Number of interpretations of `type` in the dataspace. */
  countOfType: number;
  /** Types used to filter the interpretation sources (representations + CRS). */
  sourceTypes: string[];
  /** getSources(interpretation, sourceTypes) count without secondary edges... */
  filteredSourceCount: number;
  /** ...and with includeSecondaryTargets at depth 10. */
  filteredSourceWithSecondaryCount: number;
  /** OSDU WPC kind the manifest builder emits for the interpretation. */
  wpcKind: string;
}

/**
 * One object per RESQML key type the integration suites exercise end to end:
 * P3 discovery in both directions (typed, exact), P9 array inventory and the
 * object content itself. Rules are stated per TYPE so the same test runs for a
 * grid, a strat column, a trajectory, ... without per-type test code.
 */
export interface SeededKeyObject {
  /** Short label used in test names. */
  label: string;
  /** ETP data-object type, e.g. resqml20.obj_IjkGridRepresentation. */
  type: string;
  uuid: string;
  /** Citation/Title of the object. */
  name: string;
  /** Number of objects of `type` in the dataspace. */
  countOfType: number;
  /**
   * Exact type histogram of P3 getTargets(depth 1) - the RESQML references the
   * object MUST carry (grid -> CRS, trajectory -> MdDatum + WellboreInterpretation
   * + CRS, ...). Keys are data-object types, values are counts.
   */
  targetTypes: Record<string, number>;
  /**
   * Exact type histogram of P3 getSources(depth 1), the auto-import Activity
   * excluded (it references every imported object and is not a RESQML relation).
   */
  sourceTypes: Record<string, number>;
  /** Number of Hdf5Dataset arrays the object content references. */
  arrayCount: number;
  /**
   * JSON path (resolved object) that must resolve; `length` is asserted when
   * the value is an array (number of ranks / units / markers / ...).
   */
  contentProbe?: { path: string[]; length?: number };
}

export interface SeededDataset {
  /** Dataspace path, e.g. demo/Drogon. */
  dataspace: string;
  /** Distinct data-object types in the dataspace. */
  typeCount: number;
  /** Total data objects (including the auto-import Activity + template). */
  objectCount: number;
  /** Relationship edges of the full dataspace graph. */
  edgeCount: number;
  /** An OData property filter and how many objects match it exactly. */
  filter: { property: string; value: string; count: number };
  representation: SeededRepresentation;
  interpretation: SeededInterpretation;
  /** WPC count of manifests/build for [representation, interpretation]. */
  manifestWpcCount: number;
  /** Key-type objects covered by the per-type discovery/array/content tests. */
  keyObjects: SeededKeyObject[];
}

const crsType = "resqml20.obj_LocalDepth3dCrs";
const T = {
  crs: crsType,
  grid: "resqml20.obj_IjkGridRepresentation",
  column: "resqml20.obj_StratigraphicColumn",
  rank: "resqml20.obj_StratigraphicColumnRankInterpretation",
  unitInterp: "resqml20.obj_StratigraphicUnitInterpretation",
  unitFeature: "resqml20.obj_StratigraphicUnitFeature",
  orgFeature: "resqml20.obj_OrganizationFeature",
  horizonInterp: "resqml20.obj_HorizonInterpretation",
  faultInterp: "resqml20.obj_FaultInterpretation",
  trajectory: "resqml20.obj_WellboreTrajectoryRepresentation",
  mdDatum: "resqml20.obj_MdDatum",
  wellboreInterp: "resqml20.obj_WellboreInterpretation",
  wellboreFrame: "resqml20.obj_WellboreFrameRepresentation",
  markerFrame: "resqml20.obj_WellboreMarkerFrameRepresentation",
  deviationSurvey: "resqml20.obj_DeviationSurveyRepresentation"
};

/**
 * data/Demo_Drogon.epc + data/drogon_small.h5 (Equinor Drogon synthetic field,
 * trimmed): 25 types, 186 imported objects + Activity/ActivityTemplate created
 * by the automated import = 188. Fault sticks are PolylineSetRepresentations
 * pointing at FaultInterpretations.
 */
const drogon: SeededDataset = {
  dataspace: "demo/Drogon",
  typeCount: 25,
  objectCount: 188,
  edgeCount: 493,
  filter: { property: "Domain", value: "depth", count: 37 },
  representation: {
    type: "resqml20.obj_PolylineSetRepresentation",
    uuid: "00c3f092-4ed0-4316-8c45-af49f472c99b",
    name: "F4",
    countOfType: 12,
    sourceCount: 1,
    targetCount: 2,
    arrayCount: 2,
    hdfProxyUuid: "5f208144-aba3-4d5b-906c-5ffb4294025c",
    pointsJsonPath: ["LinePatch", "0", "Geometry", "Points", "Coordinates"],
    pointsPath: "/RESQML/00c3f092-4ed0-4316-8c45-af49f472c99b/points_patch0",
    pointsFirstDimension: 30,
    pointsProbe: { starts: [12, 1], value: 5934257.649658203 },
    int32Path:
      "/RESQML/00c3f092-4ed0-4316-8c45-af49f472c99b/NodeCountPerPolyline_patch0",
    int32FirstValue: 2,
    wpcKind: "GenericRepresentation"
  },
  interpretation: {
    type: "resqml20.obj_FaultInterpretation",
    uuid: "2ec55c7d-a5dc-485d-8027-9e9fb941a855",
    countOfType: 6,
    sourceTypes: [
      crsType,
      "resqml20.obj_PolylineSetRepresentation",
      "resqml20.obj_IjkGridRepresentation"
    ],
    filteredSourceCount: 2,
    filteredSourceWithSecondaryCount: 14,
    wpcKind: "FaultInterpretation"
  },
  manifestWpcCount: 4,
  keyObjects: [
    {
      label: "IjkGrid",
      type: T.grid,
      uuid: "de998a86-23f2-4d7b-823b-0103792eed61",
      name: "Small Demo IJK Grid",
      countOfType: 1,
      targetTypes: { [T.crs]: 1 },
      sourceTypes: {},
      arrayCount: 1,
      contentProbe: { path: ["Geometry", "Points", "Coordinates", "PathInHdfFile"] }
    },
    {
      label: "StratigraphicColumn",
      type: T.column,
      uuid: "135bf687-c990-46bf-87b1-2a1f4817c352",
      name: "Strati column for Simgrid",
      countOfType: 2,
      targetTypes: { [T.rank]: 1 },
      sourceTypes: {},
      arrayCount: 0,
      contentProbe: { path: ["Ranks"], length: 1 }
    },
    {
      label: "StratigraphicColumnRankInterpretation",
      type: T.rank,
      uuid: "ecf57ba3-04b5-49d8-bfaa-a5b6ddf2e715",
      name: "Structural model for Simgrid",
      countOfType: 2,
      targetTypes: { [T.unitInterp]: 5, [T.horizonInterp]: 4, [T.orgFeature]: 1 },
      sourceTypes: { [T.column]: 1 },
      arrayCount: 0,
      contentProbe: { path: ["StratigraphicUnits"], length: 5 }
    },
    {
      label: "StratigraphicUnitInterpretation",
      type: T.unitInterp,
      uuid: "1eb65bf0-b8af-4b3c-8c76-f45ba9c76bdc",
      name: "Volon",
      countOfType: 5,
      targetTypes: { [T.unitFeature]: 1 },
      sourceTypes: { [T.rank]: 2 },
      arrayCount: 0
    },
    {
      label: "WellboreTrajectory",
      type: T.trajectory,
      uuid: "411a80a2-ecb6-4bdc-bda4-3ee1afc2b9a8",
      name: "Drilled trajectory",
      countOfType: 18,
      targetTypes: { [T.crs]: 1, [T.mdDatum]: 1, [T.wellboreInterp]: 1 },
      sourceTypes: { [T.wellboreFrame]: 1, [T.markerFrame]: 1 },
      arrayCount: 3,
      contentProbe: { path: ["Geometry", "ControlPoints", "Coordinates", "PathInHdfFile"] }
    },
    {
      label: "WellboreMarkerFrame",
      type: T.markerFrame,
      uuid: "011abcb0-0b01-4387-a50c-b45efeb09884",
      name: "Segment FB4",
      countOfType: 9,
      targetTypes: { [T.trajectory]: 1, [T.wellboreInterp]: 1, [T.horizonInterp]: 5, [T.faultInterp]: 2 },
      sourceTypes: {},
      arrayCount: 1,
      // 12 markers, several share a boundary interpretation (5 horizons + 2 faults)
      contentProbe: { path: ["WellboreMarker"], length: 12 }
    },
    {
      label: "DeviationSurvey",
      type: T.deviationSurvey,
      uuid: "0766af17-b734-4deb-9b41-cb8bcf0b0c39",
      name: "Drilled trajectory",
      countOfType: 18,
      targetTypes: { [T.mdDatum]: 1, [T.wellboreInterp]: 1 },
      sourceTypes: {},
      arrayCount: 3
    }
  ]
};

/**
 * Legacy Volve_Demo_Horizons_Depth seed (Emerson test package, not committed):
 * kept as data for servers still seeded with it.
 */
const volve: SeededDataset = {
  dataspace: "demo/Volve",
  typeCount: 16,
  objectCount: 91,
  edgeCount: 201,
  filter: { property: "SurfaceRole", value: "map", count: 3 },
  representation: {
    type: "resqml20.obj_TriangulatedSetRepresentation",
    uuid: "a3f31b20-c93a-4682-8f6c-71be087202a4",
    name: "Depth_Hugin_Fm_Top_ts",
    countOfType: 3,
    sourceCount: 4,
    targetCount: 2,
    arrayCount: 40,
    hdfProxyUuid: "53395ada-6f93-4bac-b506-d45997ded2a2",
    pointsJsonPath: ["TrianglePatch", "0", "Geometry", "Points", "Coordinates"],
    pointsPath: "/RESQML/a3f31b20-c93a-4682-8f6c-71be087202a4/points_patch0",
    pointsFirstDimension: 7523,
    pointsProbe: { starts: [12, 1], value: 5467.29 },
    int32Path: "/RESQML/a3f31b20-c93a-4682-8f6c-71be087202a4/triangles_patch0",
    int32FirstValue: 2048,
    wpcKind: "StructureMap"
  },
  interpretation: {
    type: "resqml20.obj_HorizonInterpretation",
    uuid: "30489e2b-0ee9-42df-ba14-50f32c85eec0",
    countOfType: 6,
    sourceTypes: [
      crsType,
      "resqml20.obj_TriangulatedSetRepresentation",
      "resqml20.obj_Grid2dRepresentation"
    ],
    filteredSourceCount: 1,
    filteredSourceWithSecondaryCount: 9,
    wpcKind: "HorizonInterpretation"
  },
  manifestWpcCount: 4,
  keyObjects: []
};

export const SEEDED_DATASETS: Readonly<Record<string, SeededDataset>> = {
  drogon,
  volve
};

const selected = process.env.RDMS_TEST_SEEDED_DATASET || "drogon";
if (!(selected in SEEDED_DATASETS)) {
  throw new Error(
    `RDMS_TEST_SEEDED_DATASET=${selected} is not one of ${Object.keys(
      SEEDED_DATASETS
    ).join(", ")}`
  );
}

/** The seeded dataset the integration suites run against. */
export const seededDataset: SeededDataset = SEEDED_DATASETS[selected];

/** Resolve a JSON path (array of keys) inside a resolved data object. */
export const getAtPath = (obj: unknown, path: string[]): any =>
  path.reduce<any>((cur, key) => (cur == null ? undefined : cur[key]), obj);
