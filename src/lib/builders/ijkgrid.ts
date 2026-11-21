/**
 * RESQML `IjkGridRepresentation` ⇄ neutral corner-point (OPM/GRDECL) mapping,
 * including **split-fault pillar grids**.
 *
 * This module bridges the two ways the same faulted geometry is expressed:
 *
 *  - **OPM/GRDECL** (see `grdecl.ts`): pillars in `COORD` are *shared*; fault
 *    throw lives entirely in per-corner `ZCORN`.
 *  - **RESQML**: the *coordinate line itself* is split (duplicated) via
 *    `SplitCoordinateLines` (`PillarIndices` + `ColumnsPerSplitCoordinateLine`).
 *
 * The split-pillar detection algorithm mirrors bp/resqpy's `grid_from_cp`
 * (primary pillar reference + extra coordinate lines where the up-to-4 columns
 * around a pillar node disagree beyond a tolerance), re-implemented over flat
 * typed arrays so million-cell grids stay linear and allocation-light.
 *
 * ## Coordinate-line node layout
 *
 * Nodes are stored `[NKL][nCoordLines][3]` (k slowest, coordinate line middle,
 * xyz fastest) — the RESQML/HDF5 convention and resqpy's `points_cached` shape.
 * `NKL = nk+1` (vertical node sharing; k-gaps are not yet modelled — a grid with
 * true vertical voids should be imported with k-gap support, a follow-up).
 * The first `#pillars = (ni+1)*(nj+1)` coordinate lines share indexing with the
 * pillars; split lines are appended after them.
 */

import type { DataObject, DataArrayInput } from "./types";
import { BuiltObject, ResqmlVersion, arrayNode, citation, etype, newUuid, ref, resolveIdentity, rtype, schemaVersion } from "./core";
import { CornerPointGrid, cellIndex, zcornIndex } from "./grdecl";

/* -------------------------------------------------------------------------- */
/*  Neutral geometry decomposition (pure)                                     */
/* -------------------------------------------------------------------------- */

/** Result of decomposing a corner-point grid into RESQML coordinate lines. */
export interface CoordinateLines {
    ni: number;
    nj: number;
    nk: number;
    /** Nodes per coordinate line = `nk+1`. */
    nkl: number;
    /** Total coordinate lines = `#pillars + splitCount`. */
    nCoordLines: number;
    /** Flat node buffer `[nkl][nCoordLines][3]`. */
    nodes: Float64Array;
    /** Number of split (extra) coordinate lines. */
    splitCount: number;
    /** Base pillar index for each split line (length `splitCount`). */
    pillarIndices: Int32Array;
    /** Jagged `ColumnsPerSplitCoordinateLine` — flat element buffer (column indices). */
    columnsElements: Int32Array;
    /** Jagged cumulative lengths (length `splitCount`). */
    columnsCumulative: Int32Array;
}

/** Interpolate a cell corner's XYZ on its COORD pillar (COORD pillars are straight). */
function cornerXYZ(
    grid: CornerPointGrid,
    i: number,
    j: number,
    k: number,
    ip: number,
    jp: number,
    kp: number,
    out: Float64Array,
): void {
    const ni = grid.ni;
    const coord = grid.coord;
    const p = ((j + jp) * (ni + 1) + (i + ip)) * 6;
    const xt = coord[p];
    const yt = coord[p + 1];
    const zt = coord[p + 2];
    const xb = coord[p + 3];
    const yb = coord[p + 4];
    const zb = coord[p + 5];
    const z = grid.zcorn[zcornIndex(grid, i, j, k, ip, jp, kp)];
    const denom = zb - zt;
    const t = denom !== 0 ? (z - zt) / denom : 0;
    out[0] = xt + t * (xb - xt);
    out[1] = yt + t * (yb - yt);
    out[2] = z;
}

/** k-reduced node (vertical sharing): node at k-level `kl` for column-corner `(ci,cj,ip,jp)`. */
function nodeXYZ(grid: CornerPointGrid, ci: number, cj: number, ip: number, jp: number, kl: number, out: Float64Array): void {
    if (kl < grid.nk) cornerXYZ(grid, ci, cj, kl, ip, jp, 0, out);
    else cornerXYZ(grid, ci, cj, grid.nk - 1, ip, jp, 1, out);
}

/**
 * Decompose a neutral corner-point grid into RESQML coordinate-line nodes plus
 * split-coordinate-line indexing. Faults are detected where the columns around
 * a pillar node disagree beyond `splitTolerance` (default 1e-3, applied to each
 * of x/y/z). Mirrors resqpy `grid_from_cp` extra-pillar construction.
 */
export function cornerPointToCoordinateLines(grid: CornerPointGrid, splitTolerance = 1e-3): CoordinateLines {
    const { ni, nj, nk } = grid;
    const nkl = nk + 1;
    const nPillars = (ni + 1) * (nj + 1);
    const actnum = grid.actnum;

    const a = new Float64Array(3);
    const b = new Float64Array(3);

    // Max |Δ| between two column-corner node columns, with early-out past tolerance.
    const nodeColMaxDiff = (
        ci1: number,
        cj1: number,
        ip1: number,
        jp1: number,
        ci2: number,
        cj2: number,
        ip2: number,
        jp2: number,
    ): number => {
        let m = 0;
        for (let kl = 0; kl <= nk; kl++) {
            nodeXYZ(grid, ci1, cj1, ip1, jp1, kl, a);
            nodeXYZ(grid, ci2, cj2, ip2, jp2, kl, b);
            const dx = Math.abs(a[0] - b[0]);
            const dy = Math.abs(a[1] - b[1]);
            const dz = Math.abs(a[2] - b[2]);
            if (dx > m) m = dx;
            if (dy > m) m = dy;
            if (dz > m) m = dz;
            if (m > splitTolerance) return m;
        }
        return m;
    };

    const colHasActive = (ci: number, cj: number): boolean => {
        if (!actnum) return true;
        for (let k = 0; k < nk; k++) if (actnum[cellIndex(grid, ci, cj, k)]) return true;
        return false;
    };

    // --- primary pillar reference: one column-corner per pillar (prefer active) ---
    const primaryJp = new Int8Array(nPillars);
    const primaryIp = new Int8Array(nPillars);
    for (let pj = 0; pj <= nj; pj++) {
        for (let pi = 0; pi <= ni; pi++) {
            const p = pj * (ni + 1) + pi;
            let fjp = 0;
            let fip = 0;
            let haveFallback = false;
            let chosen = false;
            for (let jp = 0; jp < 2 && !chosen; jp++) {
                for (let ip = 0; ip < 2 && !chosen; ip++) {
                    const cj = pj - jp;
                    const ci = pi - ip;
                    if (cj < 0 || cj >= nj || ci < 0 || ci >= ni) continue;
                    if (!haveFallback) {
                        fjp = jp;
                        fip = ip;
                        haveFallback = true;
                    }
                    if (colHasActive(ci, cj)) {
                        fjp = jp;
                        fip = ip;
                        chosen = true;
                    }
                }
            }
            primaryJp[p] = fjp;
            primaryIp[p] = fip;
        }
    }

    // --- extra (split) coordinate lines ---
    const extraPillar: number[] = [];
    const extraCi: number[] = [];
    const extraCj: number[] = [];
    const extraIp: number[] = [];
    const extraJp: number[] = [];
    const extrasByPillar = new Map<number, number[]>();
    // pfc[(cj*ni+ci)*4 + (jp*2+ip)] = coordinate line index used by that column-corner.
    const pfc = new Int32Array(nj * ni * 4);

    for (let pj = 0; pj <= nj; pj++) {
        for (let pi = 0; pi <= ni; pi++) {
            const p = pj * (ni + 1) + pi;
            const pjp = primaryJp[p];
            const pip = primaryIp[p];
            const pci = pi - pip;
            const pcj = pj - pjp;
            for (let jp = 0; jp < 2; jp++) {
                for (let ip = 0; ip < 2; ip++) {
                    const cj = pj - jp;
                    const ci = pi - ip;
                    if (cj < 0 || cj >= nj || ci < 0 || ci >= ni) continue;
                    const slot = (cj * ni + ci) * 4 + (jp * 2 + ip);
                    if (jp === pjp && ip === pip) {
                        pfc[slot] = p;
                        continue;
                    }
                    if (nodeColMaxDiff(ci, cj, ip, jp, pci, pcj, pip, pjp) <= splitTolerance) {
                        pfc[slot] = p;
                        continue;
                    }
                    // reuse an existing extra for this pillar if geometry matches
                    let matched = -1;
                    const list = extrasByPillar.get(p);
                    if (list) {
                        for (let li = 0; li < list.length; li++) {
                            const e = list[li];
                            if (nodeColMaxDiff(ci, cj, ip, jp, extraCi[e], extraCj[e], extraIp[e], extraJp[e]) <= splitTolerance) {
                                matched = e;
                                break;
                            }
                        }
                    }
                    if (matched >= 0) {
                        pfc[slot] = nPillars + matched;
                    } else {
                        const e = extraPillar.length;
                        extraPillar.push(p);
                        extraCi.push(ci);
                        extraCj.push(cj);
                        extraIp.push(ip);
                        extraJp.push(jp);
                        if (list) list.push(e);
                        else extrasByPillar.set(p, [e]);
                        pfc[slot] = nPillars + e;
                    }
                }
            }
        }
    }

    // --- node array ---
    const splitCount = extraPillar.length;
    const nCoordLines = nPillars + splitCount;
    const nodes = new Float64Array(nkl * nCoordLines * 3);
    for (let pj = 0; pj <= nj; pj++) {
        for (let pi = 0; pi <= ni; pi++) {
            const p = pj * (ni + 1) + pi;
            const ci = pi - primaryIp[p];
            const cj = pj - primaryJp[p];
            const pip = primaryIp[p];
            const pjp = primaryJp[p];
            for (let kl = 0; kl <= nk; kl++) {
                nodeXYZ(grid, ci, cj, pip, pjp, kl, a);
                const off = (kl * nCoordLines + p) * 3;
                nodes[off] = a[0];
                nodes[off + 1] = a[1];
                nodes[off + 2] = a[2];
            }
        }
    }
    for (let e = 0; e < splitCount; e++) {
        const coordLine = nPillars + e;
        const ci = extraCi[e];
        const cj = extraCj[e];
        const ip = extraIp[e];
        const jp = extraJp[e];
        for (let kl = 0; kl <= nk; kl++) {
            nodeXYZ(grid, ci, cj, ip, jp, kl, a);
            const off = (kl * nCoordLines + coordLine) * 3;
            nodes[off] = a[0];
            nodes[off + 1] = a[1];
            nodes[off + 2] = a[2];
        }
    }

    // --- ColumnsPerSplitCoordinateLine (jagged) ---
    const colsPerExtra: number[][] = [];
    for (let e = 0; e < splitCount; e++) colsPerExtra.push([]);
    for (let cj = 0; cj < nj; cj++) {
        for (let ci = 0; ci < ni; ci++) {
            for (let corner = 0; corner < 4; corner++) {
                const v = pfc[(cj * ni + ci) * 4 + corner];
                if (v >= nPillars) colsPerExtra[v - nPillars].push(cj * ni + ci);
            }
        }
    }
    const columnsElements: number[] = [];
    const columnsCumulative = new Int32Array(splitCount);
    let cum = 0;
    for (let e = 0; e < splitCount; e++) {
        const cols = colsPerExtra[e];
        for (let ci = 0; ci < cols.length; ci++) columnsElements.push(cols[ci]);
        cum += cols.length;
        columnsCumulative[e] = cum;
    }

    return {
        ni,
        nj,
        nk,
        nkl,
        nCoordLines,
        nodes,
        splitCount,
        pillarIndices: Int32Array.from(extraPillar),
        columnsElements: Int32Array.from(columnsElements),
        columnsCumulative,
    };
}

/* -------------------------------------------------------------------------- */
/*  RESQML → neutral corner-point (decode)                                    */
/* -------------------------------------------------------------------------- */

/** Rebuild the column-corner → coordinate-line map from split-line indexing. */
function buildPillarsForColumn(
    ni: number,
    nj: number,
    splitCount: number,
    pillarIndices: ArrayLike<number>,
    columnsElements: ArrayLike<number>,
    columnsCumulative: ArrayLike<number>,
): Int32Array {
    const nPillars = (ni + 1) * (nj + 1);
    const pfc = new Int32Array(nj * ni * 4);
    for (let j = 0; j < nj; j++) {
        for (let i = 0; i < ni; i++) {
            for (let jp = 0; jp < 2; jp++) {
                for (let ip = 0; ip < 2; ip++) {
                    pfc[(j * ni + i) * 4 + (jp * 2 + ip)] = (j + jp) * (ni + 1) + (i + ip);
                }
            }
        }
    }
    let start = 0;
    for (let e = 0; e < splitCount; e++) {
        const p = pillarIndices[e];
        const pi = p % (ni + 1);
        const pj = (p / (ni + 1)) | 0;
        const end = columnsCumulative[e];
        for (let idx = start; idx < end; idx++) {
            const col = columnsElements[idx];
            const ci = col % ni;
            const cj = (col / ni) | 0;
            const ip = pi - ci;
            const jp = pj - cj;
            if (ip < 0 || ip > 1 || jp < 0 || jp > 1) continue;
            pfc[(cj * ni + ci) * 4 + (jp * 2 + ip)] = nPillars + e;
        }
        start = end;
    }
    return pfc;
}

/** Inputs for decoding a RESQML IJK grid back to the neutral corner-point model. */
export interface IjkDecodeInput {
    ni: number;
    nj: number;
    nk: number;
    /** Coordinate-line node buffer `[nkl][nCoordLines][3]`. */
    nodes: Float64Array;
    /** Split-coordinate-line indexing (omit for unfaulted grids). */
    split?: {
        count: number;
        pillarIndices: ArrayLike<number>;
        columnsElements: ArrayLike<number>;
        columnsCumulative: ArrayLike<number>;
    };
    actnum?: Int32Array;
    properties?: Record<string, Float64Array>;
}

/** Decode RESQML coordinate-line geometry back into a neutral corner-point grid. */
export function ijkGridToCornerPoint(input: IjkDecodeInput): CornerPointGrid {
    const { ni, nj, nk, nodes } = input;
    const nPillars = (ni + 1) * (nj + 1);
    const splitCount = input.split?.count ?? 0;
    const nCoordLines = nPillars + splitCount;
    const dims = { ni, nj };

    const pfc =
        splitCount > 0 && input.split
            ? buildPillarsForColumn(
                ni,
                nj,
                splitCount,
                input.split.pillarIndices,
                input.split.columnsElements,
                input.split.columnsCumulative,
            )
            : buildPillarsForColumn(ni, nj, 0, [], [], []);

    // COORD: base-pillar top (kl=0) and bottom (kl=nk) nodes.
    const coord = new Float64Array(nPillars * 6);
    for (let p = 0; p < nPillars; p++) {
        const top = (0 * nCoordLines + p) * 3;
        const bot = (nk * nCoordLines + p) * 3;
        coord[p * 6] = nodes[top];
        coord[p * 6 + 1] = nodes[top + 1];
        coord[p * 6 + 2] = nodes[top + 2];
        coord[p * 6 + 3] = nodes[bot];
        coord[p * 6 + 4] = nodes[bot + 1];
        coord[p * 6 + 5] = nodes[bot + 2];
    }

    // ZCORN: per-corner z from the coordinate line that corner uses.
    const zcorn = new Float64Array(8 * ni * nj * nk);
    for (let k = 0; k < nk; k++) {
        for (let j = 0; j < nj; j++) {
            for (let i = 0; i < ni; i++) {
                for (let kp = 0; kp < 2; kp++) {
                    for (let jp = 0; jp < 2; jp++) {
                        for (let ip = 0; ip < 2; ip++) {
                            const coordLine = pfc[(j * ni + i) * 4 + (jp * 2 + ip)];
                            const kl = k + kp;
                            const z = nodes[(kl * nCoordLines + coordLine) * 3 + 2];
                            zcorn[zcornIndex(dims, i, j, k, ip, jp, kp)] = z;
                        }
                    }
                }
            }
        }
    }

    const grid: CornerPointGrid = { ni, nj, nk, coord, zcorn };
    if (input.actnum) grid.actnum = input.actnum;
    if (input.properties) grid.properties = input.properties;
    return grid;
}

/* -------------------------------------------------------------------------- */
/*  RESQML IjkGridRepresentation builder                                      */
/* -------------------------------------------------------------------------- */

export interface IjkGridSpec {
    uuid?: string;
    title: string;
    hdfUuid: string;
    crsUuid: string;
    crsType?: string;
    version?: ResqmlVersion;
    originator?: string;
    interpretationUuid?: string;
    /**
     * OSDU masterdata SRN of the interpretation this grid represents. Resolved to a
     * deterministic UUID (UUIDv5) when `interpretationUuid` is not supplied, so the
     * grid links to an OSDU FeatureInterpretation that exists only as an SRN.
     */
    interpretationSrn?: string;
    interpretationType?: string;
    /** The neutral corner-point grid (e.g. from `parseGrdecl`). */
    grid: CornerPointGrid;
    /** Split-pillar detection tolerance (per x/y/z), default 1e-3. */
    splitTolerance?: number;
    /** IJK handedness flag written to `GridIsRighthanded` (default true). */
    gridIsRighthanded?: boolean;
}

/**
 * Build a RESQML `IjkGridRepresentation` (corner-point geometry with split
 * coordinate lines for faults) from a neutral corner-point grid. Returns the
 * object plus the bulk arrays it references (points + split indexing). Cell
 * properties are emitted separately via the property builders.
 */
export function buildIjkGrid(spec: IjkGridSpec): BuiltObject {
    const uuid = spec.uuid ?? newUuid();
    const v = spec.version;
    const interpretationUuid =
        spec.interpretationUuid !== undefined || spec.interpretationSrn !== undefined
            ? resolveIdentity({ uuid: spec.interpretationUuid, srn: spec.interpretationSrn }).uuid
            : undefined;
    const container = etype("obj_EpcExternalPartReference", v);
    const crsType = spec.crsType ?? "obj_LocalDepth3dCrs";
    const { ni, nj, nk } = spec.grid;
    const ncell = ni * nj * nk;
    const nPillars = (ni + 1) * (nj + 1);

    const cl = cornerPointToCoordinateLines(spec.grid, spec.splitTolerance);

    const pointsPath = `/RESQML/${uuid}/points`;
    const pillarIdxPath = `/RESQML/${uuid}/splitCoordinateLines/pillarIndices`;
    const colElemsPath = `/RESQML/${uuid}/splitCoordinateLines/elements`;
    const colCumPath = `/RESQML/${uuid}/splitCoordinateLines/cumulativeLength`;

    const geometry: Record<string, unknown> = {
        $type: rtype("IjkGridGeometry", v),
        LocalCrs: ref(crsType, spec.crsUuid, undefined, v),
        KDirection: "down",
        PillarGeometryIsDefined: { $type: rtype("BooleanConstantArray", v), Value: true, Count: nPillars },
        PillarShape: "straight",
        CellGeometryIsDefined: { $type: rtype("BooleanConstantArray", v), Value: true, Count: ncell },
        GridIsRighthanded: spec.gridIsRighthanded ?? true,
        Points: arrayNode("point3d", { hdfUuid: spec.hdfUuid, path: pointsPath, dims: [cl.nkl, cl.nCoordLines, 3], version: v }),
    };

    const arrays: DataArrayInput[] = [
        {
            ContainerType: container,
            ContainerUuid: spec.hdfUuid,
            PathInResource: pointsPath,
            Dimensions: [cl.nkl, cl.nCoordLines, 3],
            Data: Array.from(cl.nodes),
            ArrayType: "Float64Array",
        },
    ];

    if (cl.splitCount > 0) {
        geometry.SplitCoordinateLines = {
            $type: rtype("ColumnLayerSplitCoordinateLines", v),
            Count: cl.splitCount,
            PillarIndices: arrayNode("integer", {
                hdfUuid: spec.hdfUuid,
                path: pillarIdxPath,
                dims: [cl.splitCount],
                nullValue: -1,
                version: v,
            }),
            ColumnsPerSplitCoordinateLine: {
                $type: rtype("ResqmlJaggedArray", v),
                Elements: arrayNode("integer", {
                    hdfUuid: spec.hdfUuid,
                    path: colElemsPath,
                    dims: [cl.columnsElements.length],
                    nullValue: -1,
                    version: v,
                }),
                CumulativeLength: arrayNode("integer", {
                    hdfUuid: spec.hdfUuid,
                    path: colCumPath,
                    dims: [cl.splitCount],
                    nullValue: -1,
                    version: v,
                }),
            },
        };
        arrays.push(
            {
                ContainerType: container,
                ContainerUuid: spec.hdfUuid,
                PathInResource: pillarIdxPath,
                Dimensions: [cl.splitCount],
                Data: Array.from(cl.pillarIndices),
                ArrayType: "Int32Array",
            },
            {
                ContainerType: container,
                ContainerUuid: spec.hdfUuid,
                PathInResource: colElemsPath,
                Dimensions: [cl.columnsElements.length],
                Data: Array.from(cl.columnsElements),
                ArrayType: "Int32Array",
            },
            {
                ContainerType: container,
                ContainerUuid: spec.hdfUuid,
                PathInResource: colCumPath,
                Dimensions: [cl.splitCount],
                Data: Array.from(cl.columnsCumulative),
                ArrayType: "Int32Array",
            },
        );
    }

    const object = {
        $type: rtype("obj_IjkGridRepresentation", v),
        Uuid: uuid,
        SchemaVersion: schemaVersion(v),
        Citation: citation(spec.title, { originator: spec.originator }),
        ...(interpretationUuid
            ? {
                RepresentedInterpretation: ref(
                    spec.interpretationType ?? "obj_StratigraphicColumnRankInterpretation",
                    interpretationUuid,
                    spec.title,
                    v,
                ),
            }
            : {}),
        Nk: nk,
        Ni: ni,
        Nj: nj,
        Geometry: geometry,
    } as unknown as DataObject;

    return { object, arrays };
}
