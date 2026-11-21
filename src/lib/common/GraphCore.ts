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
 * Shared graph-traversal core for the RESQML/ETP property graph.
 *
 * This is the single implementation of directed adjacency, role inference and
 * breadth-first reachability that both query surfaces build on:
 *
 *  - the **GraphQL** resolvers (`targets`/`sources`/`graphSearch`) — typed,
 *    field-driven projection; and
 *  - the **openCypher** engine (`POST /cypher`) — declarative pattern matching
 *    and variable-length traversal.
 *
 * Nodes are RESQML resources; edges are DataObjectReferences whose semantic
 * role is inferred by {@link edgeRole}. Keeping one {@link GraphIndex} /
 * {@link bfsReachable} here guarantees GraphQL and Cypher agree on connectivity,
 * direction and role semantics rather than drifting apart in parallel copies.
 */
import { Resource } from "./EtpTypes";
import { ResourceGraph, Edge } from "./ResponseHandlers";

/** Hard cap on transitive / variable-length traversal depth. */
export const MAX_GRAPH_HOPS = 10;

/** Edge orientation relative to the node a hop starts from. */
export type GraphDirection = "out" | "in" | "both";

// ---------------------------------------------------------------------------
// URI / type helpers
// ---------------------------------------------------------------------------

/** Extract the data-object type token from an ETP URI. */
export function typeFromUri(uri: string): string | undefined {
    const slash = uri.lastIndexOf("/");
    if (slash < 0) return undefined;
    const afterSlash = uri.substring(slash + 1);
    const paren = afterSlash.indexOf("(");
    return paren > 0 ? afterSlash.substring(0, paren) : afterSlash;
}

/** Extract the object UUID from an ETP URI (the `(...)` segment). */
export function uuidFromUri(uri: string): string | undefined {
    const open = uri.lastIndexOf("(");
    const close = uri.lastIndexOf(")");
    if (open >= 0 && close > open) return uri.substring(open + 1, close);
    return undefined;
}

/** Normalise a label/type/role for lenient comparison: drop namespace, obj_,
 * and any non-alphanumeric characters, then lowercase. */
export function norm(s: string | undefined): string {
    if (!s) return "";
    const noNs = s.includes(".") ? s.substring(s.indexOf(".") + 1) : s;
    return noNs.replace(/^obj_/i, "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

/**
 * Coarse RESQML tier of a data-object type, used to infer an edge role when the
 * server does not report a DOR path. Mirrors the tiers the ORES geological-graph
 * client expects: feature -> interpretation -> representation -> property.
 */
export function typeTier(
    type?: string
): "feature" | "interpretation" | "representation" | "property" | "other" {
    if (!type) return "other";
    const t = type.replace(/^obj_/, "");
    if (/Property$/.test(t) || /^(ContinuousProperty|DiscreteProperty|CategoricalProperty|PointsProperty|CommentProperty)/.test(t)) {
        return "property";
    }
    if (/Representation$/.test(t) || /^(Grid2d|IjkGrid|UnstructuredGrid|TriangulatedSet|PointSet|PolylineSet|WellboreFrame|WellboreTrajectory|BlockedWellbore)/.test(t)) {
        return "representation";
    }
    if (/Interpretation$/.test(t)) return "interpretation";
    if (/Feature$/.test(t) || /^(BoundaryFeature|GeobodyFeature|TectonicBoundaryFeature|GeneticBoundaryFeature|RockFluidUnitFeature|StratigraphicUnitFeature|OrganizationFeature|WellboreFeature|SeismicLatticeFeature|SeismicLineFeature|FrontierFeature)/.test(t)) {
        return "feature";
    }
    return "other";
}

/**
 * Derive the semantic relationship role of a graph edge. When the server reports
 * a DOR `path` (the XML field name of the DataObjectReference on the source
 * object, surfaced via ETP relationship customData) that field name IS the role,
 * so we return its leaf token verbatim. Otherwise we infer a RESQML-canonical
 * role from the source/target object tiers. The `source` holds the DOR, so the
 * edge direction is source -> target (source references target).
 */
export function edgeRole(
    path: string | undefined,
    sourceType: string | undefined,
    targetType: string | undefined
): string | undefined {
    if (path) {
        // Keep the final identifier-looking token, stripping XPath indices,
        // namespace prefixes and leading slashes (e.g. "/ns:RepresentedInterpretation[0]").
        const leaf = path.split("/").filter(Boolean).pop();
        if (leaf) {
            const token = leaf.replace(/\[.*?\]$/, "").replace(/^[^:]+:/, "").trim();
            if (token) return token;
        }
    }
    const src = typeTier(sourceType);
    const tgt = typeTier(targetType);
    if (src === "interpretation" && tgt === "feature") return "InterpretedFeature";
    if (src === "representation" && tgt === "interpretation") return "RepresentedInterpretation";
    if (src === "representation" && tgt === "representation") return "SupportingRepresentation";
    if (src === "property" && tgt === "representation") return "SupportingRepresentation";
    if (src === "other" || tgt === "other") return undefined;
    return "RelatedRepresentation";
}

// ---------------------------------------------------------------------------
// Label / role matching (used by Cypher; generic and schema-derived)
// ---------------------------------------------------------------------------

/**
 * Does a resource's data-object type satisfy a node label?
 * - No label → matches anything.
 * - Fully-qualified label (contains '.') → exact / suffix match.
 * - Bare label → substring match (so `Grid` matches `obj_IjkGridRepresentation`,
 *   `Interpretation` matches `obj_FaultInterpretation`, etc.).
 */
export function labelMatches(label: string | undefined, type: string | undefined): boolean {
    if (!label) return true;
    if (!type) return false;
    const nl = norm(label);
    const nt = norm(type);
    if (!nl) return true;
    if (label.includes(".")) return nt === nl || nt.endsWith(nl);
    return nt.includes(nl);
}

/** Common Cypher-style relationship names → inferred RESQML DOR roles. */
export const ROLE_SYNONYMS: Record<string, string[]> = {
    hasproperty: ["supportingrepresentation"],
    supportedby: ["supportingrepresentation"],
    supports: ["supportingrepresentation"],
    interpretedby: ["representedinterpretation"],
    represents: ["representedinterpretation"],
    representedby: ["representedinterpretation"],
    interprets: ["interpretedfeature"],
    partof: ["interpretedfeature", "representedinterpretation"],
    contains: ["supportingrepresentation"],
    relatedto: ["relatedrepresentation"]
};

/**
 * Does an edge's inferred role satisfy one of the requested relationship types?
 * Lenient by design: empty request matches any; an undefined/unknown role
 * matches any requested type (inference gaps never drop edges).
 */
export function roleMatches(requestedTypes: string[], role: string | undefined): boolean {
    if (requestedTypes.length === 0) return true;
    if (!role) return true;
    const nr = norm(role);
    for (const t of requestedTypes) {
        const nt = norm(t);
        if (!nt) return true;
        if (nr === nt || nr.includes(nt) || nt.includes(nr)) return true;
        const syn = ROLE_SYNONYMS[nt];
        if (syn && syn.some(s => s === nr || nr.includes(s))) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Directed adjacency index built once from a ResourceGraph
// ---------------------------------------------------------------------------

export interface DirectedEdge {
    to: string;
    role: string | undefined;
    /** Edge orientation relative to `to`: "out" = from→to, "in" = to→from. */
    dir: "out" | "in";
}

/**
 * Directed adjacency over a {@link ResourceGraph}. Each undirected
 * DataObjectReference becomes two {@link DirectedEdge}s (out from the source,
 * in to the target) so a single hop can be followed in any requested direction.
 * This is the one-hop primitive shared by GraphQL reachability and the Cypher
 * pattern matcher.
 */
export class GraphIndex {
    readonly nodes: Map<string, Resource>;
    private readonly adjacency = new Map<string, DirectedEdge[]>();
    readonly edgeCount: number;

    constructor(graph: ResourceGraph) {
        this.nodes = graph;
        const edges: Edge[] = graph.edges ?? [];
        this.edgeCount = edges.length;
        for (const e of edges) {
            const role = edgeRole(
                e.path,
                typeFromUri(e.sourceUri),
                typeFromUri(e.targetUri)
            );
            this.push(e.sourceUri, { to: e.targetUri, role, dir: "out" });
            this.push(e.targetUri, { to: e.sourceUri, role, dir: "in" });
        }
    }

    /** Build an index from edges alone (no node attributes), for pure
     * reachability where resource objects are not needed. */
    static fromEdges(edges: readonly Edge[]): GraphIndex {
        return new GraphIndex(new ResourceGraph([], [...edges]));
    }

    private push(from: string, de: DirectedEdge): void {
        const list = this.adjacency.get(from);
        if (list) list.push(de);
        else this.adjacency.set(from, [de]);
    }

    /** Neighbours of `uri` reachable by a single hop in the given direction and
     * whose role matches one of the requested types (empty = any role). */
    neighbours(uri: string, direction: GraphDirection, types: string[]): DirectedEdge[] {
        const all = this.adjacency.get(uri) ?? [];
        return all.filter(de => {
            const dirOk =
                direction === "both" ||
                (direction === "out" && de.dir === "out") ||
                (direction === "in" && de.dir === "in");
            return dirOk && roleMatches(types, de.role);
        });
    }
}

// ---------------------------------------------------------------------------
// Breadth-first reachability (the shared transitive-traversal primitive)
// ---------------------------------------------------------------------------

/**
 * BFS over a {@link GraphIndex} from `startUri`, following edges in `direction`
 * up to `depth` hops (clamped to [1, MAX_GRAPH_HOPS]). Role-agnostic. Cycle- and
 * origin-guarded (the start node is pre-visited), returning reachable URIs in
 * BFS order, excluding the start node.
 */
export function bfsReachable(
    index: GraphIndex,
    startUri: string,
    direction: "out" | "in",
    depth: number
): string[] {
    const maxDepth = Math.max(1, Math.min(Math.floor(depth) || 1, MAX_GRAPH_HOPS));
    const visited = new Set<string>([startUri]);
    const out: string[] = [];
    let frontier = [startUri];
    for (let d = 0; d < maxDepth && frontier.length > 0; d++) {
        const next: string[] = [];
        for (const node of frontier) {
            for (const nb of index.neighbours(node, direction, [])) {
                if (!visited.has(nb.to)) {
                    visited.add(nb.to);
                    out.push(nb.to);
                    next.push(nb.to);
                }
            }
        }
        frontier = next;
    }
    return out;
}
