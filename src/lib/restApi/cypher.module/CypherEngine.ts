// ============================================================================
// Copyright 2024-2026 Equinor ASA. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ============================================================================

/**
 * In-memory openCypher pattern-matching engine over the RESQML/ETP property
 * graph.
 *
 * The engine is **pure**: it operates on a pre-fetched {@link ResourceGraph}
 * (one deep `getGraph` call on the dataspace), so pattern evaluation involves no
 * further ETP round-trips — a graph DB-style "follow the edge" traversal rather
 * than GraphQL's resolver-per-hop fan-out. Nodes are RESQML resources; edges are
 * DataObjectReferences whose semantic role is inferred by {@link edgeRole}.
 *
 * Label and relationship-type matching is **generic and schema-derived**: labels
 * match the RESQML data-object type by substring/suffix (so `Grid`,
 * `Interpretation`, `resqml20.obj_IjkGridRepresentation` all work), and
 * relationship types map onto inferred DOR roles via a small synonym table
 * (e.g. `INTERPRETED_BY` ⇄ `RepresentedInterpretation`). Unknown/undefined roles
 * are matched leniently so inference gaps never silently drop results.
 */
import { Resource } from "../../common/EtpTypes";
import { ResourceGraph } from "../../common/ResponseHandlers";
import {
    GraphIndex,
    labelMatches,
    typeFromUri,
    uuidFromUri,
    MAX_GRAPH_HOPS
} from "../../common/GraphCore";
import {
    CypherQuery,
    NodePattern,
    ScalarValue,
    WhereExpr,
    Comparison,
    ReturnItem
} from "./CypherParser";

/** Hard cap on variable-length traversal, matching the GraphQL traversal guard. */
export const MAX_CYPHER_HOPS = MAX_GRAPH_HOPS;
/** Hard cap on produced rows before SKIP/LIMIT, to bound memory. */
export const MAX_MATCH_ROWS = 10000;

export interface CypherResult {
    /** RETURN column names (aliases). */
    columns: string[];
    /** Row-major result set; each cell is a projected value. */
    rows: unknown[][];
    /** Diagnostics for the response envelope. */
    stats: {
        nodesScanned: number;
        edges: number;
        rowsBeforeLimit: number;
    };
}

// ---------------------------------------------------------------------------
// Binding state
// ---------------------------------------------------------------------------

interface RelBinding {
    role: string | undefined;
    sourceUri: string;
    targetUri: string;
}

interface Bindings {
    nodes: Map<string, Resource>;
    rels: Map<string, RelBinding>;
    /** Ordered node URIs for an optional path variable. */
    path: string[];
}

function cloneBindings(b: Bindings): Bindings {
    return {
        nodes: new Map(b.nodes),
        rels: new Map(b.rels),
        path: [...b.path]
    };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class CypherEngine {
    private readonly index: GraphIndex;

    constructor(graph: ResourceGraph) {
        this.index = new GraphIndex(graph);
    }

    /** The maximum traversal depth the planner needs for a query (used by the
     * controller to size the deep `getGraph` fetch). */
    static requiredDepth(query: CypherQuery): number {
        let depth = 0;
        for (const r of query.pattern.rels) {
            depth += r.maxHops === Infinity ? MAX_CYPHER_HOPS : r.maxHops;
        }
        return Math.min(Math.max(depth, 1), MAX_CYPHER_HOPS);
    }

    run(query: CypherQuery): CypherResult {
        const { pattern } = query;
        const matches: Bindings[] = [];

        // Seed: every node matching the first node pattern.
        const firstPat = pattern.nodes[0];
        for (const [uri, res] of this.index.nodes) {
            if (!this.matchNode(res, firstPat)) continue;
            const b: Bindings = {
                nodes: new Map(),
                rels: new Map(),
                path: [uri]
            };
            if (firstPat.variable) b.nodes.set(firstPat.variable, res);
            this.expand(query, 0, uri, b, matches);
            if (matches.length >= MAX_MATCH_ROWS) break;
        }

        return this.project(query, matches);
    }

    /** Recursively extend a partial match from `relIndex` onwards. */
    private expand(
        query: CypherQuery,
        relIndex: number,
        currentUri: string,
        bindings: Bindings,
        out: Bindings[]
    ): void {
        const { pattern } = query;
        if (out.length >= MAX_MATCH_ROWS) return;

        if (relIndex >= pattern.rels.length) {
            // Whole pattern bound; apply WHERE then record.
            if (!query.where || this.evalWhere(query.where, bindings)) {
                out.push(bindings);
            }
            return;
        }

        const rel = pattern.rels[relIndex];
        const nextPat = pattern.nodes[relIndex + 1];
        const minHops = Math.max(1, rel.minHops);
        const maxHops = Math.min(
            rel.maxHops === Infinity ? MAX_CYPHER_HOPS : rel.maxHops,
            MAX_CYPHER_HOPS
        );

        // BFS from currentUri collecting endpoints reachable in [minHops, maxHops]
        // that satisfy the next node pattern. Each discovered endpoint spawns a
        // fresh binding branch (backtracking). `trail` records the intermediate
        // node URIs visited after currentUri so variable-length path variables
        // expose the full node sequence, not just the endpoints.
        interface Frontier {
            uri: string;
            hops: number;
            /** Nodes traversed after currentUri, up to and including `uri`. */
            trail: string[];
            visited: Set<string>;
        }
        const start: Frontier = {
            uri: currentUri,
            hops: 0,
            trail: [],
            visited: new Set([currentUri])
        };
        const queue: Frontier[] = [start];

        while (queue.length > 0) {
            if (out.length >= MAX_MATCH_ROWS) return;
            const f = queue.shift()!;
            for (const nb of this.index.neighbours(f.uri, rel.direction, rel.types)) {
                if (f.visited.has(nb.to)) continue;
                const hops = f.hops + 1;
                if (hops > maxHops) continue;
                const trail = [...f.trail, nb.to];

                if (hops >= minHops) {
                    const endRes = this.index.nodes.get(nb.to);
                    if (endRes && this.matchNode(endRes, nextPat)) {
                        const branch = cloneBindings(bindings);
                        if (nextPat.variable) branch.nodes.set(nextPat.variable, endRes);
                        if (rel.variable) {
                            branch.rels.set(rel.variable, {
                                role: nb.role,
                                sourceUri: nb.dir === "out" ? f.uri : nb.to,
                                targetUri: nb.dir === "out" ? nb.to : f.uri
                            });
                        }
                        branch.path.push(...trail);
                        this.expand(query, relIndex + 1, nb.to, branch, out);
                    }
                }
                if (hops < maxHops) {
                    const nextVisited = new Set(f.visited);
                    nextVisited.add(nb.to);
                    queue.push({
                        uri: nb.to,
                        hops,
                        trail,
                        visited: nextVisited
                    });
                }
            }
        }
    }

    /** Node pattern match: label + inline property equality. */
    private matchNode(res: Resource, pat: NodePattern): boolean {
        if (!labelMatches(pat.label, typeFromUri(res.uri))) return false;
        for (const [key, want] of Object.entries(pat.properties)) {
            const have = this.nodeProp(res, key);
            if (!looseEquals(have, want)) return false;
        }
        return true;
    }

    // -- WHERE evaluation ----------------------------------------------------

    private evalWhere(expr: WhereExpr, b: Bindings): boolean {
        switch (expr.kind) {
            case "and":
                return this.evalWhere(expr.left, b) && this.evalWhere(expr.right, b);
            case "or":
                return this.evalWhere(expr.left, b) || this.evalWhere(expr.right, b);
            case "not":
                return !this.evalWhere(expr.operand, b);
            case "comparison":
                return this.evalComparison(expr, b);
        }
    }

    private evalComparison(c: Comparison, b: Bindings): boolean {
        const have = this.resolveProp(c.left.variable, c.left.property, b);
        switch (c.op) {
            case "IS NULL":
                return have === undefined || have === null;
            case "IS NOT NULL":
                return have !== undefined && have !== null;
        }
        const want = c.right ?? null;
        switch (c.op) {
            case "=":
                return looseEquals(have, want);
            case "<>":
                return !looseEquals(have, want);
            case "<":
                return compare(have, want) < 0;
            case "<=":
                return compare(have, want) <= 0;
            case ">":
                return compare(have, want) > 0;
            case ">=":
                return compare(have, want) >= 0;
            case "CONTAINS":
                return String(have ?? "").includes(String(want ?? ""));
            case "STARTS WITH":
                return String(have ?? "").startsWith(String(want ?? ""));
            case "ENDS WITH":
                return String(have ?? "").endsWith(String(want ?? ""));
            case "=~":
                try {
                    return new RegExp(`^(?:${String(want ?? "")})$`).test(String(have ?? ""));
                } catch {
                    return false;
                }
        }
    }

    /** Resolve `var.prop` against the current bindings (node or relationship). */
    private resolveProp(
        variable: string,
        property: string,
        b: Bindings
    ): ScalarValue | undefined {
        const node = b.nodes.get(variable);
        if (node) return this.nodeProp(node, property);
        const rel = b.rels.get(variable);
        if (rel) return this.relProp(rel, property);
        return undefined;
    }

    private nodeProp(res: Resource, property: string): ScalarValue | undefined {
        switch (property.toLowerCase()) {
            case "uri":
                return res.uri;
            case "name":
                return res.name ?? undefined;
            case "id":
            case "uuid":
                return uuidFromUri(res.uri) ?? undefined;
            case "type":
            case "datatype":
            case "dataobjecttype":
            case "label":
                return typeFromUri(res.uri) ?? undefined;
            case "sourcecount":
                return res.sourceCount ?? undefined;
            case "targetcount":
                return res.targetCount ?? undefined;
            default:
                return undefined;
        }
    }

    private relProp(rel: RelBinding, property: string): ScalarValue | undefined {
        switch (property.toLowerCase()) {
            case "type":
            case "role":
                return rel.role ?? undefined;
            case "source":
            case "sourceuri":
                return rel.sourceUri;
            case "target":
            case "targeturi":
                return rel.targetUri;
            default:
                return undefined;
        }
    }

    // -- Projection ----------------------------------------------------------

    private project(query: CypherQuery, matches: Bindings[]): CypherResult {
        const columns = query.returnItems.map(i => i.alias);
        let rows = matches.map(b =>
            query.returnItems.map(item => this.projectItem(item, b, query))
        );

        if (query.distinct) {
            const seen = new Set<string>();
            rows = rows.filter(r => {
                const key = JSON.stringify(r);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        const rowsBeforeLimit = rows.length;
        if (query.skip !== undefined) rows = rows.slice(query.skip);
        if (query.limit !== undefined) rows = rows.slice(0, query.limit);

        return {
            columns,
            rows,
            stats: {
                nodesScanned: this.index.nodes.size,
                edges: this.index.edgeCount,
                rowsBeforeLimit
            }
        };
    }

    private projectItem(item: ReturnItem, b: Bindings, query: CypherQuery): unknown {
        // Path variable → ordered node list.
        if (
            query.pattern.pathVariable &&
            item.variable === query.pattern.pathVariable &&
            !item.property
        ) {
            return {
                length: Math.max(0, b.path.length - 1),
                nodes: b.path.map(uri => this.nodeView(this.index.nodes.get(uri)))
            };
        }

        if (item.property) {
            return this.resolveProp(item.variable, item.property, b) ?? null;
        }

        const node = b.nodes.get(item.variable);
        if (node) return this.nodeView(node);
        const rel = b.rels.get(item.variable);
        if (rel) {
            return {
                type: rel.role ?? null,
                sourceUri: rel.sourceUri,
                targetUri: rel.targetUri
            };
        }
        return null;
    }

    private nodeView(res: Resource | undefined): unknown {
        if (!res) return null;
        return {
            uri: res.uri,
            id: uuidFromUri(res.uri) ?? null,
            name: res.name ?? null,
            type: typeFromUri(res.uri) ?? null,
            sourceCount: res.sourceCount ?? null,
            targetCount: res.targetCount ?? null
        };
    }
}

// ---------------------------------------------------------------------------
// Scalar comparison helpers
// ---------------------------------------------------------------------------

function looseEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === undefined || a === null || b === undefined || b === null) return false;
    if (typeof a === "number" || typeof b === "number") {
        return Number(a) === Number(b);
    }
    return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
    if (a === undefined || a === null) return -1;
    if (b === undefined || b === null) return 1;
    const an = Number(a);
    const bn = Number(b);
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return String(a).localeCompare(String(b));
}
