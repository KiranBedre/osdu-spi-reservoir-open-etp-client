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
 * Parser for a bounded, read-only subset of SPARQL 1.1 over the RESQML/ETP
 * property graph. Mirrors the openCypher engine's "strict subset, reject the
 * rest" philosophy: the grammar that is supported is standards-compliant, and
 * anything outside it (updates, federation, OPTIONAL/UNION, aggregation…) is
 * rejected up-front with an HTTP 400 and a character position.
 *
 * Supported query forms:
 *   SELECT [DISTINCT] (?v … | *) WHERE { BGP [FILTER …] } [ORDER BY …] [LIMIT n] [OFFSET n]
 *   ASK WHERE { BGP [FILTER …] }
 *   CONSTRUCT { template } WHERE { BGP [FILTER …] } [LIMIT n] [OFFSET n]
 *   DESCRIBE (?v | iri) … [WHERE { BGP }]
 *
 * Supported graph patterns:
 *   - Basic Graph Patterns: `s p o .` with `;`/`,` predicate-object / object lists.
 *   - Terms: variables (?x / $x), IRIs (<…> or prefix:local), `a` (rdf:type),
 *     string/number/boolean literals (with optional @lang or ^^datatype).
 *   - Fixed-predicate property paths `pfx:pred*` / `pfx:pred+` (variable-length
 *     reachability, capped at the shared MAX_GRAPH_HOPS).
 *   - FILTER with =, !=, <, <=, >, >=, &&, ||, !, and the functions
 *     regex(), CONTAINS(), STRSTARTS(), STRENDS(), BOUND(), isIRI(), isLiteral().
 */

// ── AST ─────────────────────────────────────────────────────────────────────

export type QueryForm = "SELECT" | "ASK" | "CONSTRUCT" | "DESCRIBE";

export type Term =
    | { type: "var"; name: string }
    | { type: "iri"; value: string }
    | { type: "literal"; value: string; datatype?: string; lang?: string };

export interface PredTerm {
    /** Predicate term: a variable or an IRI (`a` is expanded to rdf:type). */
    term: Term;
    /** Fixed-predicate variable-length path modifier, if present. */
    path?: "*" | "+";
}

export interface TriplePattern {
    s: Term;
    p: PredTerm;
    o: Term;
}

export type FilterExpr =
    | { kind: "and"; left: FilterExpr; right: FilterExpr }
    | { kind: "or"; left: FilterExpr; right: FilterExpr }
    | { kind: "not"; arg: FilterExpr }
    | { kind: "compare"; op: "=" | "!=" | "<" | "<=" | ">" | ">="; left: Term; right: Term }
    | { kind: "fn"; name: FilterFn; args: Term[] };

export type FilterFn =
    | "regex"
    | "contains"
    | "strstarts"
    | "strends"
    | "bound"
    | "isiri"
    | "isliteral";

export interface SparqlQuery {
    form: QueryForm;
    distinct: boolean;
    /** SELECT projection variable names (without `?`); empty when `selectStar`. */
    vars: string[];
    selectStar: boolean;
    /** CONSTRUCT template triples. */
    construct?: TriplePattern[];
    /** DESCRIBE terms (variables or IRIs). */
    describe?: Term[];
    patterns: TriplePattern[];
    filters: FilterExpr[];
    limit?: number;
    offset?: number;
    /** Resolved prefix → namespace map (defaults + PREFIX declarations). */
    prefixes: Record<string, string>;
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class SparqlSyntaxError extends Error {
    constructor(message: string, public readonly position: number) {
        super(message);
        this.name = "SparqlSyntaxError";
    }
}

/** Update / unsupported keywords rejected before evaluation. */
const UNSUPPORTED = new Set([
    "INSERT", "DELETE", "LOAD", "CLEAR", "CREATE", "DROP", "COPY", "MOVE",
    "ADD", "WITH", "USING", "SERVICE", "OPTIONAL", "UNION", "MINUS", "BIND",
    "VALUES", "GROUP", "HAVING", "GRAPH"
]);

// ── Tokenizer ────────────────────────────────────────────────────────────────

type TokKind =
    | "iri" | "prefixed" | "var" | "string" | "number" | "boolean"
    | "keyword" | "punct" | "a" | "eof";

interface Token {
    kind: TokKind;
    value: string;
    /** For string literals: resolved raw string; datatype/lang carried separately. */
    datatype?: string;
    lang?: string;
    pos: number;
}

const KEYWORDS = new Set([
    "SELECT", "ASK", "CONSTRUCT", "DESCRIBE", "WHERE", "DISTINCT", "REDUCED",
    "PREFIX", "BASE", "FILTER", "LIMIT", "OFFSET", "ORDER", "BY", "ASC", "DESC",
    "REGEX", "CONTAINS", "STRSTARTS", "STRENDS", "BOUND", "ISIRI", "ISURI",
    "ISLITERAL", "TRUE", "FALSE", "AS"
]);

function tokenize(src: string): Token[] {
    const toks: Token[] = [];
    let i = 0;
    const n = src.length;
    const push = (kind: TokKind, value: string, pos: number, extra?: Partial<Token>) =>
        toks.push({ kind, value, pos, ...extra });

    while (i < n) {
        const c = src[i];
        // whitespace
        if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
        // line comment
        if (c === "#") { while (i < n && src[i] !== "\n") i++; continue; }
        const start = i;
        // IRI ref <...>
        if (c === "<") {
            i++;
            let v = "";
            while (i < n && src[i] !== ">") {
                if (src[i] === "\n") throw new SparqlSyntaxError("Unterminated IRI reference", start);
                v += src[i++];
            }
            if (i >= n) throw new SparqlSyntaxError("Unterminated IRI reference", start);
            i++; // consume >
            push("iri", v, start);
            continue;
        }
        // variable ?x / $x
        if (c === "?" || c === "$") {
            i++;
            let v = "";
            while (i < n && /[A-Za-z0-9_]/.test(src[i])) v += src[i++];
            if (!v) throw new SparqlSyntaxError("Empty variable name", start);
            push("var", v, start);
            continue;
        }
        // string literal (single or triple quoted, ' or ")
        if (c === '"' || c === "'") {
            const { value, next } = readString(src, i);
            i = next;
            let datatype: string | undefined;
            let lang: string | undefined;
            if (src[i] === "@") {
                i++;
                let l = "";
                while (i < n && /[A-Za-z-]/.test(src[i])) l += src[i++];
                lang = l;
            } else if (src[i] === "^" && src[i + 1] === "^") {
                i += 2;
                if (src[i] === "<") {
                    i++;
                    let dt = "";
                    while (i < n && src[i] !== ">") dt += src[i++];
                    i++;
                    datatype = dt;
                } else {
                    let dt = "";
                    while (i < n && /[A-Za-z0-9_:]/.test(src[i])) dt += src[i++];
                    datatype = dt; // prefixed datatype, resolved later
                }
            }
            push("string", value, start, { datatype, lang });
            continue;
        }
        // number
        if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(src[i + 1] ?? "")) ||
            (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
            let v = "";
            if (c === "-") v += src[i++];
            while (i < n && /[0-9.eE+-]/.test(src[i])) v += src[i++];
            push("number", v, start);
            continue;
        }
        // punctuation
        if (c === "{" || c === "}" || c === "(" || c === ")" || c === "." ||
            c === ";" || c === "," || c === "*" || c === "+") {
            i++;
            push("punct", c, start);
            continue;
        }
        if (c === "!" && src[i + 1] === "=") { i += 2; push("punct", "!=", start); continue; }
        if (c === "<" && src[i + 1] === "=") { i += 2; push("punct", "<=", start); continue; }
        if (c === ">" && src[i + 1] === "=") { i += 2; push("punct", ">=", start); continue; }
        if (c === "&" && src[i + 1] === "&") { i += 2; push("punct", "&&", start); continue; }
        if (c === "|" && src[i + 1] === "|") { i += 2; push("punct", "||", start); continue; }
        if (c === "!" || c === "=" || c === "<" || c === ">") { i++; push("punct", c, start); continue; }
        // prefixed name / keyword / `a`
        if (/[A-Za-z_]/.test(c)) {
            let v = "";
            while (i < n && /[A-Za-z0-9_-]/.test(src[i])) v += src[i++];
            // prefixed name: v ':' local
            if (src[i] === ":") {
                i++;
                let local = "";
                while (i < n && /[A-Za-z0-9_.\-%]/.test(src[i])) local += src[i++];
                push("prefixed", `${v}:${local}`, start);
                continue;
            }
            const up = v.toUpperCase();
            if (v === "a") { push("a", "a", start); continue; }
            if (up === "TRUE" || up === "FALSE") { push("boolean", up.toLowerCase(), start); continue; }
            if (KEYWORDS.has(up)) { push("keyword", up, start); continue; }
            if (UNSUPPORTED.has(up)) {
                throw new SparqlSyntaxError(
                    `Unsupported SPARQL construct: ${v}. This is a read-only ` +
                    `SELECT/ASK/CONSTRUCT/DESCRIBE subset (no updates, federation, ` +
                    `OPTIONAL, UNION, BIND, VALUES or aggregation).`,
                    start
                );
            }
            throw new SparqlSyntaxError(`Unexpected token '${v}'`, start);
        }
        // bare ':' prefixed name (default prefix)
        if (c === ":") {
            i++;
            let local = "";
            while (i < n && /[A-Za-z0-9_.\-%]/.test(src[i])) local += src[i++];
            push("prefixed", `:${local}`, start);
            continue;
        }
        throw new SparqlSyntaxError(`Unexpected character '${c}'`, start);
    }
    push("eof", "", n);
    return toks;
}

function readString(src: string, i: number): { value: string; next: number } {
    const quote = src[i];
    const triple = src[i + 1] === quote && src[i + 2] === quote;
    const start = i;
    i += triple ? 3 : 1;
    let v = "";
    const n = src.length;
    while (i < n) {
        if (src[i] === "\\") {
            const e = src[i + 1];
            v += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e ?? "";
            i += 2;
            continue;
        }
        if (!triple && src[i] === quote) return { value: v, next: i + 1 };
        if (triple && src[i] === quote && src[i + 1] === quote && src[i + 2] === quote)
            return { value: v, next: i + 3 };
        v += src[i++];
    }
    throw new SparqlSyntaxError("Unterminated string literal", start);
}

// ── Parser ───────────────────────────────────────────────────────────────────

const DEFAULT_PREFIXES: Record<string, string> = {
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    xsd: "http://www.w3.org/2001/XMLSchema#",
    dcterms: "http://purl.org/dc/terms/",
    rddms: "https://rddms.opengroup.org/ontology#",
    rddmst: "https://rddms.opengroup.org/type#"
};

const RDF_TYPE_IRI = `${DEFAULT_PREFIXES.rdf}type`;

class Parser {
    private pos = 0;
    private prefixes: Record<string, string> = { ...DEFAULT_PREFIXES };

    constructor(private readonly toks: Token[], extraPrefixes?: Record<string, string>) {
        if (extraPrefixes) Object.assign(this.prefixes, extraPrefixes);
    }

    private peek(): Token { return this.toks[this.pos]; }
    private next(): Token { return this.toks[this.pos++]; }
    private atEof(): boolean { return this.peek().kind === "eof"; }

    private expectPunct(p: string): void {
        const t = this.peek();
        if (t.kind !== "punct" || t.value !== p)
            throw new SparqlSyntaxError(`Expected '${p}'`, t.pos);
        this.pos++;
    }

    private expectKeyword(k: string): void {
        const t = this.peek();
        if (t.kind !== "keyword" || t.value !== k)
            throw new SparqlSyntaxError(`Expected ${k}`, t.pos);
        this.pos++;
    }

    parse(): SparqlQuery {
        this.parsePrologue();
        const t = this.peek();
        if (t.kind !== "keyword")
            throw new SparqlSyntaxError("Expected SELECT, ASK, CONSTRUCT or DESCRIBE", t.pos);
        switch (t.value) {
            case "SELECT": return this.parseSelect();
            case "ASK": return this.parseAsk();
            case "CONSTRUCT": return this.parseConstruct();
            case "DESCRIBE": return this.parseDescribe();
            default:
                throw new SparqlSyntaxError(
                    `Expected SELECT, ASK, CONSTRUCT or DESCRIBE`, t.pos);
        }
    }

    private parsePrologue(): void {
        for (;;) {
            const t = this.peek();
            if (t.kind === "keyword" && t.value === "PREFIX") {
                this.pos++;
                const p = this.next();
                if (p.kind !== "prefixed" || !p.value.endsWith(":"))
                    // tokenizer emits "pfx:" with empty local as prefixed "pfx:"
                    if (p.kind !== "prefixed")
                        throw new SparqlSyntaxError("Expected prefix label", p.pos);
                const label = p.value.replace(/:$/, "").split(":")[0];
                const iri = this.next();
                if (iri.kind !== "iri")
                    throw new SparqlSyntaxError("Expected IRI in PREFIX", iri.pos);
                this.prefixes[label] = iri.value;
                continue;
            }
            if (t.kind === "keyword" && t.value === "BASE") {
                this.pos++;
                this.next(); // consume + ignore BASE IRI
                continue;
            }
            break;
        }
    }

    private parseSelect(): SparqlQuery {
        this.expectKeyword("SELECT");
        let distinct = false;
        const nt = this.peek();
        if (nt.kind === "keyword" && (nt.value === "DISTINCT" || nt.value === "REDUCED")) {
            distinct = nt.value === "DISTINCT";
            this.pos++;
        }
        const vars: string[] = [];
        let selectStar = false;
        if (this.peek().kind === "punct" && this.peek().value === "*") {
            selectStar = true;
            this.pos++;
        } else {
            while (this.peek().kind === "var") vars.push(this.next().value);
            if (vars.length === 0)
                throw new SparqlSyntaxError("SELECT requires variables or *", this.peek().pos);
        }
        const { patterns, filters } = this.parseWhere();
        const { limit, offset } = this.parseModifiers();
        this.ensureEnd();
        return { form: "SELECT", distinct, vars, selectStar, patterns, filters, limit, offset, prefixes: this.prefixes };
    }

    private parseAsk(): SparqlQuery {
        this.expectKeyword("ASK");
        const { patterns, filters } = this.parseWhere();
        this.parseModifiers();
        this.ensureEnd();
        return { form: "ASK", distinct: false, vars: [], selectStar: false, patterns, filters, prefixes: this.prefixes };
    }

    private parseConstruct(): SparqlQuery {
        this.expectKeyword("CONSTRUCT");
        this.expectPunct("{");
        const construct = this.parseTriples();
        this.expectPunct("}");
        const { patterns, filters } = this.parseWhere();
        const { limit, offset } = this.parseModifiers();
        this.ensureEnd();
        return { form: "CONSTRUCT", distinct: false, vars: [], selectStar: false, construct, patterns, filters, limit, offset, prefixes: this.prefixes };
    }

    private parseDescribe(): SparqlQuery {
        this.expectKeyword("DESCRIBE");
        const describe: Term[] = [];
        if (this.peek().kind === "punct" && this.peek().value === "*") {
            this.pos++;
        } else {
            while (this.peek().kind === "var" || this.peek().kind === "iri" || this.peek().kind === "prefixed")
                describe.push(this.parseTerm());
            if (describe.length === 0)
                throw new SparqlSyntaxError("DESCRIBE requires variables or IRIs", this.peek().pos);
        }
        let patterns: TriplePattern[] = [];
        let filters: FilterExpr[] = [];
        if (this.peek().kind === "keyword" && this.peek().value === "WHERE") {
            const w = this.parseWhere();
            patterns = w.patterns;
            filters = w.filters;
        } else if (this.peek().kind === "punct" && this.peek().value === "{") {
            const w = this.parseWhere();
            patterns = w.patterns;
            filters = w.filters;
        }
        const { limit, offset } = this.parseModifiers();
        this.ensureEnd();
        return { form: "DESCRIBE", distinct: false, vars: [], selectStar: false, describe, patterns, filters, limit, offset, prefixes: this.prefixes };
    }

    private parseWhere(): { patterns: TriplePattern[]; filters: FilterExpr[] } {
        if (this.peek().kind === "keyword" && this.peek().value === "WHERE") this.pos++;
        this.expectPunct("{");
        const patterns: TriplePattern[] = [];
        const filters: FilterExpr[] = [];
        while (!(this.peek().kind === "punct" && this.peek().value === "}")) {
            if (this.atEof()) throw new SparqlSyntaxError("Unterminated WHERE block", this.peek().pos);
            if (this.peek().kind === "keyword" && this.peek().value === "FILTER") {
                this.pos++;
                filters.push(this.parseFilter());
                continue;
            }
            if (this.peek().kind === "punct" && this.peek().value === "{")
                throw new SparqlSyntaxError("Group graph patterns / subqueries are not supported", this.peek().pos);
            for (const tp of this.parseTriples()) patterns.push(tp);
            if (this.peek().kind === "punct" && this.peek().value === ".") this.pos++;
        }
        this.expectPunct("}");
        return { patterns, filters };
    }

    /** Parse a triple block: subject predicate-object list, with ; and , chaining. */
    private parseTriples(): TriplePattern[] {
        const out: TriplePattern[] = [];
        for (;;) {
            if (this.peek().kind === "punct" && (this.peek().value === "}" || this.peek().value === "."))
                break;
            if (this.peek().kind === "keyword") break;
            const subject = this.parseTerm();
            this.parsePredObjList(subject, out);
            if (this.peek().kind === "punct" && this.peek().value === ".") {
                this.pos++;
                if (this.peek().kind === "punct" && this.peek().value === "}") break;
                if (this.peek().kind === "keyword" || this.atEof()) break;
                continue;
            }
            break;
        }
        return out;
    }

    private parsePredObjList(subject: Term, out: TriplePattern[]): void {
        for (;;) {
            const pred = this.parsePredicate();
            for (;;) {
                const obj = this.parseTerm();
                out.push({ s: subject, p: pred, o: obj });
                if (this.peek().kind === "punct" && this.peek().value === ",") { this.pos++; continue; }
                break;
            }
            if (this.peek().kind === "punct" && this.peek().value === ";") { this.pos++;
                // allow trailing ; before . or }
                if (this.peek().kind === "punct" && (this.peek().value === "." || this.peek().value === "}")) break;
                continue;
            }
            break;
        }
    }

    private parsePredicate(): PredTerm {
        const t = this.peek();
        if (t.kind === "a") { this.pos++; return { term: { type: "iri", value: RDF_TYPE_IRI } }; }
        const term = this.parseTerm();
        let path: "*" | "+" | undefined;
        if (this.peek().kind === "punct" && (this.peek().value === "*" || this.peek().value === "+")) {
            path = this.next().value as "*" | "+";
            if (term.type !== "iri")
                throw new SparqlSyntaxError("Property paths are only supported on a fixed predicate IRI", t.pos);
        }
        return { term, path };
    }

    private parseTerm(): Term {
        const t = this.next();
        switch (t.kind) {
            case "var": return { type: "var", name: t.value };
            case "iri": return { type: "iri", value: t.value };
            case "a": return { type: "iri", value: RDF_TYPE_IRI };
            case "prefixed": return { type: "iri", value: this.resolvePrefixed(t.value, t.pos) };
            case "string": return {
                type: "literal",
                value: t.value,
                datatype: t.datatype ? this.resolveDatatype(t.datatype, t.pos) : undefined,
                lang: t.lang
            };
            case "number": return { type: "literal", value: t.value, datatype: `${DEFAULT_PREFIXES.xsd}decimal` };
            case "boolean": return { type: "literal", value: t.value, datatype: `${DEFAULT_PREFIXES.xsd}boolean` };
            default:
                throw new SparqlSyntaxError(`Expected an RDF term, got '${t.value || t.kind}'`, t.pos);
        }
    }

    private resolvePrefixed(qname: string, pos: number): string {
        const idx = qname.indexOf(":");
        const prefix = qname.slice(0, idx);
        const local = qname.slice(idx + 1);
        const ns = this.prefixes[prefix];
        if (ns === undefined)
            throw new SparqlSyntaxError(`Unknown prefix '${prefix}:'`, pos);
        return ns + local;
    }

    private resolveDatatype(dt: string, pos: number): string {
        return dt.includes(":") && !dt.startsWith("http") ? this.resolvePrefixed(dt, pos) : dt;
    }

    // --- FILTER ---------------------------------------------------------------

    private parseFilter(): FilterExpr {
        // FILTER ( expr )  |  FILTER fn(...)
        if (this.peek().kind === "punct" && this.peek().value === "(") {
            this.pos++;
            const e = this.parseOr();
            this.expectPunct(")");
            return e;
        }
        return this.parsePrimary();
    }

    private parseOr(): FilterExpr {
        let left = this.parseAnd();
        while (this.peek().kind === "punct" && this.peek().value === "||") {
            this.pos++;
            left = { kind: "or", left, right: this.parseAnd() };
        }
        return left;
    }

    private parseAnd(): FilterExpr {
        let left = this.parseUnary();
        while (this.peek().kind === "punct" && this.peek().value === "&&") {
            this.pos++;
            left = { kind: "and", left, right: this.parseUnary() };
        }
        return left;
    }

    private parseUnary(): FilterExpr {
        if (this.peek().kind === "punct" && this.peek().value === "!") {
            this.pos++;
            return { kind: "not", arg: this.parseUnary() };
        }
        if (this.peek().kind === "punct" && this.peek().value === "(") {
            this.pos++;
            const e = this.parseOr();
            this.expectPunct(")");
            return e;
        }
        return this.parsePrimary();
    }

    private parsePrimary(): FilterExpr {
        const t = this.peek();
        // function call
        if (t.kind === "keyword" && FILTER_FNS.has(t.value)) {
            this.pos++;
            this.expectPunct("(");
            const args: Term[] = [];
            while (!(this.peek().kind === "punct" && this.peek().value === ")")) {
                args.push(this.parseTerm());
                if (this.peek().kind === "punct" && this.peek().value === ",") { this.pos++; continue; }
                break;
            }
            this.expectPunct(")");
            const name = FN_NAME[t.value];
            return { kind: "fn", name, args };
        }
        // comparison: term op term
        const left = this.parseTerm();
        const op = this.peek();
        if (op.kind === "punct" && ["=", "!=", "<", "<=", ">", ">="].includes(op.value)) {
            this.pos++;
            const right = this.parseTerm();
            return { kind: "compare", op: op.value as "=", left, right };
        }
        throw new SparqlSyntaxError("Expected a comparison or boolean function in FILTER", op.pos);
    }

    // --- modifiers ------------------------------------------------------------

    private parseModifiers(): { limit?: number; offset?: number } {
        let limit: number | undefined;
        let offset: number | undefined;
        // ORDER BY (parsed and ignored — results are a set)
        if (this.peek().kind === "keyword" && this.peek().value === "ORDER") {
            this.pos++;
            this.expectKeyword("BY");
            while (this.peek().kind === "var" || this.peek().kind === "keyword" &&
                (this.peek().value === "ASC" || this.peek().value === "DESC") ||
                this.peek().kind === "punct" && (this.peek().value === "(" || this.peek().value === ")")) {
                this.pos++;
            }
        }
        for (let guard = 0; guard < 2; guard++) {
            const t = this.peek();
            if (t.kind === "keyword" && t.value === "LIMIT") {
                this.pos++;
                limit = this.readInt("LIMIT");
            } else if (t.kind === "keyword" && t.value === "OFFSET") {
                this.pos++;
                offset = this.readInt("OFFSET");
            } else break;
        }
        return { limit, offset };
    }

    private readInt(what: string): number {
        const t = this.next();
        const v = Number(t.value);
        if (t.kind !== "number" || !Number.isFinite(v) || v < 0)
            throw new SparqlSyntaxError(`${what} requires a non-negative integer`, t.pos);
        return Math.floor(v);
    }

    private ensureEnd(): void {
        if (!this.atEof())
            throw new SparqlSyntaxError(`Unexpected trailing input '${this.peek().value}'`, this.peek().pos);
    }
}

const FILTER_FNS = new Set([
    "REGEX", "CONTAINS", "STRSTARTS", "STRENDS", "BOUND", "ISIRI", "ISURI", "ISLITERAL"
]);

const FN_NAME: Record<string, FilterFn> = {
    REGEX: "regex",
    CONTAINS: "contains",
    STRSTARTS: "strstarts",
    STRENDS: "strends",
    BOUND: "bound",
    ISIRI: "isiri",
    ISURI: "isiri",
    ISLITERAL: "isliteral"
};

/**
 * Parse a read-only SPARQL query into an AST, or throw {@link SparqlSyntaxError}
 * (carrying a character position) for syntax errors and unsupported constructs.
 */
export function parseSparql(
    query: string,
    extraPrefixes?: Record<string, string>
): SparqlQuery {
    if (!query || !query.trim())
        throw new SparqlSyntaxError("Empty SPARQL query", 0);
    const toks = tokenize(query);
    return new Parser(toks, extraPrefixes).parse();
}
