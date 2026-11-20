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
 * In-memory SPARQL (read-only subset) engine over the RESQML/ETP property
 * graph. Like the openCypher engine it is **pure**: it evaluates against a
 * pre-fetched {@link ResourceGraph} with no further ETP round-trips. The graph
 * is projected into the *same* RDF triples the `/rdf/*` endpoints publish (via
 * {@link graphToTriples}), so a SPARQL query sees exactly the linked data the
 * service serves — SPARQL is simply the query verb over the RDF noun.
 *
 * SELECT and ASK return the standard W3C SPARQL 1.1 Query Results JSON shape;
 * CONSTRUCT and DESCRIBE return the resulting RDF as structured triples (and,
 * on request, Turtle / JSON-LD via the shared RDF document writer).
 */
import { ResourceGraph } from "../../common/ResponseHandlers";
import { Energistics } from "../../client/ResqmlClient";
import { MAX_GRAPH_HOPS } from "../../common/GraphCore";
import {
    graphToTriples,
    Triple,
    TripleObject,
    RdfGraph,
    RdfResource
} from "../read-etp.module/RdfSerialization";
import {
    documentToTurtle,
    documentToJsonLd,
    RdfDocumentModel,
    RdfObject
} from "../read-etp.module/RdfDocument";
import {
    SparqlQuery,
    Term,
    TriplePattern,
    FilterExpr,
    PredTerm
} from "./SparqlParser";

/** Hard cap on produced solutions before OFFSET/LIMIT, to bound memory. */
export const MAX_SOLUTIONS = 10000;
/** Hard cap on property-path traversal depth (shared graph guard). */
export const MAX_SPARQL_HOPS = MAX_GRAPH_HOPS;

const RDDMS_NS = "https://rddms.opengroup.org/ontology#";

/** A bound term in a solution: an IRI or a literal (mirrors TripleObject). */
type Bound = TripleObject;

/** One solution mapping (variable name → bound term). */
type Solution = Map<string, Bound>;

export interface SparqlSelectResult {
    form: "SELECT";
    head: { vars: string[] };
    results: { bindings: Array<Record<string, SparqlJsonTerm>> };
    stats: SparqlStats;
}

export interface SparqlAskResult {
    form: "ASK";
    boolean: boolean;
    stats: SparqlStats;
}

export interface SparqlGraphResult {
    form: "CONSTRUCT" | "DESCRIBE";
    triples: Array<{ subject: string; predicate: string; object: SparqlJsonTerm }>;
    /** Serialized RDF when a non-JSON `format` was requested. */
    rdf?: string;
    stats: SparqlStats;
}

export type SparqlResult = SparqlSelectResult | SparqlAskResult | SparqlGraphResult;

export interface SparqlStats {
    triplesScanned: number;
    solutions: number;
    form: string;
}

/** W3C SPARQL JSON result term. */
export interface SparqlJsonTerm {
    type: "uri" | "literal";
    value: string;
    datatype?: string;
    "xml:lang"?: string;
}

export type SparqlRdfFormat = "json" | "turtle" | "jsonld";

// ---------------------------------------------------------------------------

export class SparqlEngine {
    private readonly triples: Triple[];
    /** Subject → triples. */
    private readonly byS = new Map<string, Triple[]>();
    /** Predicate IRI → directed adjacency (subject → objects) for property paths. */
    private readonly adjByPred = new Map<string, Map<string, string[]>>();

    constructor(graph: ResourceGraph) {
        this.triples = graphToTriples(toRdfGraph(graph));
        for (const t of this.triples) {
            const list = this.byS.get(t.s);
            if (list) list.push(t);
            else this.byS.set(t.s, [t]);
            if (t.o.kind === "iri") {
                let adj = this.adjByPred.get(t.p);
                if (!adj) { adj = new Map(); this.adjByPred.set(t.p, adj); }
                const outs = adj.get(t.s);
                if (outs) outs.push(t.o.value);
                else adj.set(t.s, [t.o.value]);
            }
        }
    }

    run(q: SparqlQuery, format: SparqlRdfFormat = "json"): SparqlResult {
        const solutions = this.evaluate(q);
        const stats: SparqlStats = {
            triplesScanned: this.triples.length,
            solutions: solutions.length,
            form: q.form
        };

        if (q.form === "ASK")
            return { form: "ASK", boolean: solutions.length > 0, stats };

        if (q.form === "SELECT") {
            const vars = q.selectStar ? this.allVars(q) : q.vars;
            let rows = solutions.map(s => projectRow(s, vars));
            if (q.distinct) rows = dedupeRows(rows, vars);
            rows = applyWindow(rows, q.offset, q.limit);
            return {
                form: "SELECT",
                head: { vars },
                results: { bindings: rows },
                stats: { ...stats, solutions: rows.length }
            };
        }

        // CONSTRUCT / DESCRIBE → triples
        const outTriples = q.form === "CONSTRUCT"
            ? this.instantiateConstruct(q.construct ?? [], solutions)
            : this.describe(q, solutions);
        const windowed = applyTripleWindow(outTriples, q.offset, q.limit);
        const result: SparqlGraphResult = {
            form: q.form,
            triples: windowed.map(t => ({
                subject: t.s,
                predicate: t.p,
                object: toJsonTerm(t.o)
            })),
            stats: { ...stats, solutions: windowed.length }
        };
        if (format !== "json")
            result.rdf = serializeConstruct(windowed, q.prefixes, format);
        return result;
    }

    // --- evaluation -----------------------------------------------------------

    private evaluate(q: SparqlQuery): Solution[] {
        let solutions: Solution[] = [new Map()];
        for (const pat of q.patterns) {
            const next: Solution[] = [];
            for (const sol of solutions) {
                for (const ext of this.matchPattern(pat, sol)) {
                    next.push(ext);
                    if (next.length >= MAX_SOLUTIONS) break;
                }
                if (next.length >= MAX_SOLUTIONS) break;
            }
            solutions = next;
            if (solutions.length === 0) break;
        }
        if (q.filters.length > 0)
            solutions = solutions.filter(s => q.filters.every(f => evalFilter(f, s)));
        return solutions;
    }

    /** Extend a solution by all matches of a single triple pattern. */
    private matchPattern(pat: TriplePattern, sol: Solution): Solution[] {
        if (pat.p.path) return this.matchPath(pat, sol);

        const sBound = resolve(pat.s, sol);
        const pIri = predicateIri(pat.p, sol);
        const oBound = resolve(pat.o, sol);

        const candidates: Triple[] =
            sBound && sBound.kind === "iri"
                ? this.byS.get(sBound.value) ?? []
                : this.triples;

        const out: Solution[] = [];
        for (const t of candidates) {
            if (sBound && !termEq(sBound, { kind: "iri", value: t.s })) continue;
            if (pIri !== undefined && t.p !== pIri) continue;
            if (oBound && !termEq(oBound, t.o)) continue;
            const ext = new Map(sol);
            if (pat.s.type === "var") ext.set(pat.s.name, { kind: "iri", value: t.s });
            if (pat.p.term.type === "var") ext.set(pat.p.term.name, { kind: "iri", value: t.p });
            if (pat.o.type === "var") ext.set(pat.o.name, t.o);
            out.push(ext);
        }
        return out;
    }

    /** Fixed-predicate variable-length path (`pred*` / `pred+`). */
    private matchPath(pat: TriplePattern, sol: Solution): Solution[] {
        const pred = (pat.p.term as { value: string }).value;
        const adj = this.adjByPred.get(pred) ?? new Map<string, string[]>();
        const minHops = pat.p.path === "+" ? 1 : 0;
        const sBound = resolve(pat.s, sol);
        const oBound = resolve(pat.o, sol);

        const starts: string[] = sBound && sBound.kind === "iri"
            ? [sBound.value]
            : [...new Set(this.triples.map(t => t.s))];

        const out: Solution[] = [];
        for (const start of starts) {
            const reached = bfsOverPred(adj, start, minHops);
            for (const target of reached) {
                if (oBound && !(oBound.kind === "iri" && oBound.value === target)) continue;
                const ext = new Map(sol);
                if (pat.s.type === "var") ext.set(pat.s.name, { kind: "iri", value: start });
                if (pat.o.type === "var") ext.set(pat.o.name, { kind: "iri", value: target });
                out.push(ext);
                if (out.length >= MAX_SOLUTIONS) return out;
            }
        }
        return out;
    }

    private instantiateConstruct(template: TriplePattern[], solutions: Solution[]): Triple[] {
        const seen = new Set<string>();
        const out: Triple[] = [];
        for (const sol of solutions) {
            for (const tp of template) {
                const s = groundTerm(tp.s, sol);
                const p = groundTerm(tp.p.term, sol);
                const o = tp.o.type === "var" ? sol.get(tp.o.name) : termToObject(tp.o);
                if (!s || s.kind !== "iri" || !p || p.kind !== "iri" || !o) continue;
                const key = `${s.value}|${p.value}|${objKey(o)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ s: s.value, p: p.value, o });
            }
        }
        return out;
    }

    private describe(q: SparqlQuery, solutions: Solution[]): Triple[] {
        const subjects = new Set<string>();
        for (const term of q.describe ?? []) {
            if (term.type === "iri") subjects.add(term.value);
            else if (term.type === "var") {
                for (const sol of solutions) {
                    const b = sol.get(term.name);
                    if (b && b.kind === "iri") subjects.add(b.value);
                }
            }
        }
        const out: Triple[] = [];
        for (const s of subjects)
            for (const t of this.byS.get(s) ?? []) out.push(t);
        return out;
    }

    private allVars(q: SparqlQuery): string[] {
        const seen = new Set<string>();
        const vars: string[] = [];
        const add = (t: Term) => {
            if (t.type === "var" && !seen.has(t.name)) { seen.add(t.name); vars.push(t.name); }
        };
        for (const pat of q.patterns) { add(pat.s); add(pat.p.term); add(pat.o); }
        return vars;
    }
}

// ---------------------------------------------------------------------------
// Graph projection
// ---------------------------------------------------------------------------

/** Project a {@link ResourceGraph} into the RDF-serializer graph shape. */
function toRdfGraph(graph: ResourceGraph): RdfGraph {
    const asDate = (v: unknown): Date | undefined =>
        typeof v === "bigint"
            ? new Date(Number(v / BigInt(1000)))
            : v instanceof Date
                ? v
                : undefined;
    const resources: RdfResource[] = [...graph.values()].map(r => ({
        uri: r.uri,
        name: r.name ?? undefined,
        activeStatus:
            r.activeStatus ===
                Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind.Inactive
                ? "Inactive"
                : "Active",
        sourceCount: typeof r.sourceCount === "number" ? r.sourceCount : undefined,
        targetCount: typeof r.targetCount === "number" ? r.targetCount : undefined,
        lastChanged: asDate(r.lastChanged),
        storeCreated: asDate(r.storeCreated),
        storeLastWrite: asDate(r.storeLastWrite)
    }));
    const links = (graph.edges ?? []).map(e => ({
        source: e.sourceUri,
        target: e.targetUri,
        path: e.path
    }));
    return { resources, links };
}

// ---------------------------------------------------------------------------
// Term / binding helpers
// ---------------------------------------------------------------------------

function resolve(term: Term, sol: Solution): Bound | undefined {
    if (term.type === "var") return sol.get(term.name);
    return termToObject(term);
}

function termToObject(term: Term): Bound | undefined {
    if (term.type === "iri") return { kind: "iri", value: term.value };
    if (term.type === "literal")
        return { kind: "literal", value: term.value, datatype: term.datatype, lang: term.lang };
    return undefined;
}

function groundTerm(term: Term, sol: Solution): Bound | undefined {
    return term.type === "var" ? sol.get(term.name) : termToObject(term);
}

function predicateIri(p: PredTerm, sol: Solution): string | undefined {
    if (p.term.type === "iri") return p.term.value;
    if (p.term.type !== "var") return undefined;
    const b = sol.get(p.term.name);
    return b && b.kind === "iri" ? b.value : undefined;
}

function termEq(a: Bound, b: Bound): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "iri") return a.value === (b as { value: string }).value;
    const bl = b as { value: string; datatype?: string; lang?: string };
    return a.value === bl.value && (a.datatype ?? "") === (bl.datatype ?? "") &&
        (a.lang ?? "") === (bl.lang ?? "");
}

function objKey(o: Bound): string {
    return o.kind === "iri" ? `<${o.value}>` : `"${o.value}"|${o.datatype ?? ""}|${o.lang ?? ""}`;
}

function bfsOverPred(adj: Map<string, string[]>, start: string, minHops: number): string[] {
    const visited = new Set<string>([start]);
    const reached: string[] = [];
    if (minHops === 0) reached.push(start);
    let frontier = [start];
    for (let d = 0; d < MAX_SPARQL_HOPS && frontier.length > 0; d++) {
        const next: string[] = [];
        for (const node of frontier)
            for (const to of adj.get(node) ?? [])
                if (!visited.has(to)) {
                    visited.add(to);
                    reached.push(to);
                    next.push(to);
                }
        frontier = next;
    }
    return reached;
}

// ---------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------

function toJsonTerm(o: Bound): SparqlJsonTerm {
    if (o.kind === "iri") return { type: "uri", value: o.value };
    const t: SparqlJsonTerm = { type: "literal", value: o.value };
    if (o.datatype) t.datatype = o.datatype;
    if (o.lang) t["xml:lang"] = o.lang;
    return t;
}

function projectRow(sol: Solution, vars: string[]): Record<string, SparqlJsonTerm> {
    const row: Record<string, SparqlJsonTerm> = {};
    for (const v of vars) {
        const b = sol.get(v);
        if (b) row[v] = toJsonTerm(b);
    }
    return row;
}

function dedupeRows(
    rows: Array<Record<string, SparqlJsonTerm>>,
    vars: string[]
): Array<Record<string, SparqlJsonTerm>> {
    const seen = new Set<string>();
    const out: Array<Record<string, SparqlJsonTerm>> = [];
    for (const row of rows) {
        const key = vars.map(v => {
            const t = row[v];
            return t ? `${t.type}:${t.value}:${t.datatype ?? ""}:${t["xml:lang"] ?? ""}` : "∅";
        }).join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
    }
    return out;
}

function applyWindow<T>(rows: T[], offset?: number, limit?: number): T[] {
    const start = offset && offset > 0 ? offset : 0;
    const end = limit !== undefined && limit >= 0 ? start + limit : undefined;
    return rows.slice(start, end);
}

function applyTripleWindow(triples: Triple[], offset?: number, limit?: number): Triple[] {
    return applyWindow(triples, offset, limit);
}

function serializeConstruct(
    triples: Triple[],
    prefixes: Record<string, string>,
    format: SparqlRdfFormat
): string {
    const bySubject = new Map<string, Triple[]>();
    for (const t of triples) {
        const list = bySubject.get(t.s);
        if (list) list.push(t);
        else bySubject.set(t.s, [t]);
    }
    const toRdfObject = (o: TripleObject): RdfObject =>
        o.kind === "iri"
            ? { iri: o.value }
            : { literal: o.value, datatype: o.datatype, lang: o.lang };
    const model: RdfDocumentModel = {
        prefixes,
        subjects: [...bySubject.entries()].map(([iri, ts]) => ({
            iri,
            predicates: ts.map(t => ({ predicate: t.p, objects: [toRdfObject(t.o)] }))
        }))
    };
    const doc = format === "turtle" ? documentToTurtle(model) : documentToJsonLd(model);
    return typeof doc === "string" ? doc : JSON.stringify(doc, null, 2);
}

// ---------------------------------------------------------------------------
// FILTER evaluation
// ---------------------------------------------------------------------------

function evalFilter(f: FilterExpr, sol: Solution): boolean {
    switch (f.kind) {
        case "and": return evalFilter(f.left, sol) && evalFilter(f.right, sol);
        case "or": return evalFilter(f.left, sol) || evalFilter(f.right, sol);
        case "not": return !evalFilter(f.arg, sol);
        case "compare": return evalCompare(f.op, resolve(f.left, sol), resolve(f.right, sol));
        case "fn": return evalFn(f.name, f.args, sol);
    }
}

function lexical(b: Bound | undefined): string | undefined {
    return b === undefined ? undefined : b.value;
}

function numeric(b: Bound | undefined): number | undefined {
    if (!b) return undefined;
    const n = Number(b.value);
    return Number.isFinite(n) ? n : undefined;
}

function evalCompare(op: string, l?: Bound, r?: Bound): boolean {
    if (l === undefined || r === undefined) return false;
    const ln = numeric(l);
    const rn = numeric(r);
    const bothNumeric = ln !== undefined && rn !== undefined &&
        l.kind === "literal" && r.kind === "literal";
    if (bothNumeric) {
        switch (op) {
            case "=": return ln === rn;
            case "!=": return ln !== rn;
            case "<": return (ln as number) < (rn as number);
            case "<=": return (ln as number) <= (rn as number);
            case ">": return (ln as number) > (rn as number);
            case ">=": return (ln as number) >= (rn as number);
        }
    }
    const ls = lexical(l) ?? "";
    const rs = lexical(r) ?? "";
    switch (op) {
        case "=": return ls === rs;
        case "!=": return ls !== rs;
        case "<": return ls < rs;
        case "<=": return ls <= rs;
        case ">": return ls > rs;
        case ">=": return ls >= rs;
        default: return false;
    }
}

function evalFn(name: string, args: Term[], sol: Solution): boolean {
    const vals = args.map(a => resolve(a, sol));
    switch (name) {
        case "bound":
            return args[0]?.type === "var" ? sol.has(args[0].name) : vals[0] !== undefined;
        case "isiri":
            return vals[0]?.kind === "iri";
        case "isliteral":
            return vals[0]?.kind === "literal";
        case "contains":
            return str(vals[0]).includes(str(vals[1]));
        case "strstarts":
            return str(vals[0]).startsWith(str(vals[1]));
        case "strends":
            return str(vals[0]).endsWith(str(vals[1]));
        case "regex": {
            const flags = vals[2] ? str(vals[2]) : "";
            try {
                return new RegExp(str(vals[1]), flags).test(str(vals[0]));
            } catch {
                return false;
            }
        }
        default:
            return false;
    }
}

function str(b: Bound | undefined): string {
    return b === undefined ? "" : b.value;
}

/** Namespace exported for callers that build response envelopes. */
export const SPARQL_RDDMS_NS = RDDMS_NS;
