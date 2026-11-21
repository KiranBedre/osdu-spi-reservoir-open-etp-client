/**
 * Grid connection-set builder — the RESQML representation of cell-to-cell
 * connections across faults, and the carrier for fault transmissibility
 * multipliers.
 *
 * `buildGridConnectionSet` emits a `GridConnectionSetRepresentation`
 * (`obj_GridConnectionSetRepresentation`, RESQML 2.0.1 / 2.2 / 2.3) with the
 * topology defined by `GridConnectionSetRepresentation.xsd`:
 *   - `CellIndexPairs` (2 × #connections): the (Cell1, Cell2) flat cell-index
 *     pair for every connection.
 *   - `Count`: number of connections (> 0).
 *   - `Grid[]`: the grid(s) the cell indices resolve against.
 *   - `GridIndexPairs` (2 × #connections): required only when more than one
 *     grid is referenced; the (Grid1, Grid2) index pair per connection.
 *   - `LocalFacePerCellIndexPairs` (2 × #connections): optional entry/exit
 *     local-face-per-cell index per connection (`-1` = undefined).
 *   - `ConnectionInterpretations`: optional association of each connection with
 *     a `FaultInterpretation` (or other feature interpretation) via a RESQML
 *     jagged array, so a single fault can label the connections it seals.
 *
 * The GRDECL `FAULTS` define the cell connections; `MULTFLT` supplies the
 * cross-fault transmissibility multiplier. The multiplier itself is a
 * `ContinuousProperty` whose supporting representation is this connection set
 * and whose indexable element is `contacts` — build it with
 * `buildFaultTransmissibilityMultiplier`.
 *
 * Source of truth: energistics RESQML
 * `GridConnectionSetRepresentation`; fesapi `GridConnectionSetRepresentation`
 * (`setCellIndexPairs` / `setConnectionInterpretationIndices`).
 */

import type { DataObject, DataArrayInput } from "./types";
import { BuiltObject, ResqmlVersion, arrayNode, citation, etype, newUuid, ref, rtype, schemaVersion } from "./core";
import { buildContinuousProperty } from "./property";

/** Association of grid connections with feature (typically fault) interpretations. */
export interface ConnectionInterpretationSpec {
    /** Feature-interpretation UUIDs referenced by the connections. */
    featureInterpretationUuids: string[];
    /** Data-object type of the referenced interpretations. Default `obj_FaultInterpretation`. */
    featureInterpretationType?: string;
    /** Titles for the referenced interpretations (index-aligned with the UUIDs). */
    featureInterpretationTitles?: string[];
    /**
     * Per-connection interpretation index into `featureInterpretationUuids`
     * (length = connection count). Exactly one interpretation per connection.
     */
    interpretationIndexPerConnection: number[];
}

export interface GridConnectionSetSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    version?: ResqmlVersion;
    /** Grid(s) the cell indices resolve against; grid index 0 is the first entry. */
    gridUuids: string[];
    gridTitles?: string[];
    gridType?: string;
    /**
     * Flat (Cell1, Cell2) pairs, length `2 · count`:
     * `[c1_0, c2_0, c1_1, c2_1, …]`.
     */
    cellIndexPairs: number[];
    /**
     * Flat (Grid1, Grid2) index pairs, length `2 · count`. Required (and only
     * meaningful) when more than one grid is referenced.
     */
    gridIndexPairs?: number[];
    /**
     * Flat (Face1, Face2) local-face-per-cell pairs, length `2 · count`;
     * `-1` = undefined. Omit for block-centred grids without face definitions.
     */
    localFacePerCellIndexPairs?: number[];
    /** Optional fault/feature interpretation association for the connections. */
    interpretations?: ConnectionInterpretationSpec;
    originator?: string;
}

/**
 * Build a `GridConnectionSetRepresentation` — the set of cell-to-cell
 * connections (typically across faults) for one or more grids.
 */
export function buildGridConnectionSet(spec: GridConnectionSetSpec): BuiltObject {
    const v = spec.version;
    const uuid = spec.uuid ?? newUuid();

    if (!spec.gridUuids.length) {
        throw new Error(`grid connection set "${spec.title}": at least one grid UUID is required`);
    }
    if (spec.cellIndexPairs.length === 0 || spec.cellIndexPairs.length % 2 !== 0) {
        throw new Error(
            `grid connection set "${spec.title}": cellIndexPairs length (${spec.cellIndexPairs.length}) must be a positive multiple of 2`,
        );
    }
    const count = spec.cellIndexPairs.length / 2;

    if (spec.gridIndexPairs && spec.gridIndexPairs.length !== 2 * count) {
        throw new Error(
            `grid connection set "${spec.title}": gridIndexPairs length (${spec.gridIndexPairs.length}) must equal 2·count (${2 * count})`,
        );
    }
    if (spec.gridUuids.length > 1 && !spec.gridIndexPairs) {
        throw new Error(
            `grid connection set "${spec.title}": gridIndexPairs is required when more than one grid is referenced`,
        );
    }
    if (spec.localFacePerCellIndexPairs && spec.localFacePerCellIndexPairs.length !== 2 * count) {
        throw new Error(
            `grid connection set "${spec.title}": localFacePerCellIndexPairs length (${spec.localFacePerCellIndexPairs.length}) must equal 2·count (${2 * count})`,
        );
    }

    const gridType = spec.gridType ?? "obj_IjkGridRepresentation";
    const container = etype("obj_EpcExternalPartReference", v);
    const cellPairsPath = `/RESQML/${uuid}/cellIndexPairs`;
    const gridPairsPath = `/RESQML/${uuid}/gridIndexPairs`;
    const facePairsPath = `/RESQML/${uuid}/localFacePerCellIndexPairs`;
    const interpElemsPath = `/RESQML/${uuid}/interpretationIndices/elements`;
    const interpCumPath = `/RESQML/${uuid}/interpretationIndices/cumulativeLength`;

    const arrays: DataArrayInput[] = [
        {
            ContainerType: container,
            ContainerUuid: spec.hdfUuid,
            PathInResource: cellPairsPath,
            Dimensions: [count, 2],
            Data: spec.cellIndexPairs,
            ArrayType: "Int32Array",
        },
    ];

    const object: Record<string, unknown> = {
        $type: rtype("obj_GridConnectionSetRepresentation", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        Count: count,
        CellIndexPairs: arrayNode("integer", { hdfUuid: spec.hdfUuid, path: cellPairsPath, dims: [count, 2], version: v }),
        Grid: spec.gridUuids.map((g, i) => ref(gridType, g, spec.gridTitles?.[i] ?? spec.title, v)),
    };

    if (spec.gridIndexPairs) {
        object.GridIndexPairs = arrayNode("integer", { hdfUuid: spec.hdfUuid, path: gridPairsPath, dims: [count, 2], version: v });
        arrays.push({
            ContainerType: container,
            ContainerUuid: spec.hdfUuid,
            PathInResource: gridPairsPath,
            Dimensions: [count, 2],
            Data: spec.gridIndexPairs,
            ArrayType: "Int32Array",
        });
    }

    if (spec.localFacePerCellIndexPairs) {
        object.LocalFacePerCellIndexPairs = arrayNode("integer", {
            hdfUuid: spec.hdfUuid,
            path: facePairsPath,
            dims: [count, 2],
            nullValue: -1,
            version: v,
        });
        arrays.push({
            ContainerType: container,
            ContainerUuid: spec.hdfUuid,
            PathInResource: facePairsPath,
            Dimensions: [count, 2],
            Data: spec.localFacePerCellIndexPairs,
            ArrayType: "Int32Array",
        });
    }

    if (spec.interpretations) {
        const it = spec.interpretations;
        if (!it.featureInterpretationUuids.length) {
            throw new Error(`grid connection set "${spec.title}": interpretations require at least one feature-interpretation UUID`);
        }
        if (it.interpretationIndexPerConnection.length !== count) {
            throw new Error(
                `grid connection set "${spec.title}": interpretationIndexPerConnection length (${it.interpretationIndexPerConnection.length}) must equal count (${count})`,
            );
        }
        for (const idx of it.interpretationIndexPerConnection) {
            if (idx < 0 || idx >= it.featureInterpretationUuids.length) {
                throw new Error(
                    `grid connection set "${spec.title}": interpretation index ${idx} is out of range for ${it.featureInterpretationUuids.length} interpretation(s)`,
                );
            }
        }
        const interpType = it.featureInterpretationType ?? "obj_FaultInterpretation";
        // One interpretation per connection → cumulative lengths are 1,2,3,…,count.
        const cumulative = Array.from({ length: count }, (_, i) => i + 1);
        object.ConnectionInterpretations = {
            $type: rtype("ConnectionInterpretations", v),
            FeatureInterpretation: it.featureInterpretationUuids.map((u, i) =>
                ref(interpType, u, it.featureInterpretationTitles?.[i] ?? spec.title, v),
            ),
            InterpretationIndices: {
                $type: rtype("ResqmlJaggedArray", v),
                Elements: arrayNode("integer", { hdfUuid: spec.hdfUuid, path: interpElemsPath, dims: [count], version: v }),
                CumulativeLength: arrayNode("integer", { hdfUuid: spec.hdfUuid, path: interpCumPath, dims: [count], version: v }),
            },
        };
        arrays.push(
            {
                ContainerType: container,
                ContainerUuid: spec.hdfUuid,
                PathInResource: interpElemsPath,
                Dimensions: [count],
                Data: it.interpretationIndexPerConnection,
                ArrayType: "Int32Array",
            },
            {
                ContainerType: container,
                ContainerUuid: spec.hdfUuid,
                PathInResource: interpCumPath,
                Dimensions: [count],
                Data: cumulative,
                ArrayType: "Int32Array",
            },
        );
    }

    return { object: object as unknown as DataObject, arrays };
}

export interface FaultTransmissibilityMultiplierSpec {
    uuid?: string;
    title?: string;
    hdfUuid: string;
    version?: ResqmlVersion;
    /** The grid connection set these multipliers apply to. */
    connectionSetUuid: string;
    /** One transmissibility multiplier per connection (length = connection count). */
    multipliers: number[];
    originator?: string;
}

/**
 * Build the fault transmissibility-multiplier `ContinuousProperty` for a grid
 * connection set (GRDECL `MULTFLT`). Indexed per connection (`contacts`),
 * unitless (`Euc`), kind `property multiplier`.
 */
export function buildFaultTransmissibilityMultiplier(spec: FaultTransmissibilityMultiplierSpec): BuiltObject {
    if (spec.multipliers.length === 0) {
        throw new Error("fault transmissibility multiplier: at least one value is required");
    }
    const built = buildContinuousProperty({
        uuid: spec.uuid,
        title: spec.title ?? "MULTFLT",
        hdfUuid: spec.hdfUuid,
        version: spec.version,
        supportingRepUuid: spec.connectionSetUuid,
        supportingRepType: "obj_GridConnectionSetRepresentation",
        kind: "property multiplier",
        uom: "Euc",
        indexable: "contacts",
        values: spec.multipliers,
        originator: spec.originator,
    });
    return { object: built.object, arrays: built.arrays };
}
