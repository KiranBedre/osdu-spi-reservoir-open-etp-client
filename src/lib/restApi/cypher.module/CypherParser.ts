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
 * Dependency-free recursive-descent parser for a **read-only subset** of
 * openCypher, scoped to the RESQML/ETP property-graph model the client already
 * exposes (resources = nodes, DataObjectReferences = relationships).
 *
 * The subset is deliberately bounded (mirroring the "strict subset" posture of
 * Amazon Neptune / Spanner Graph) and covers the traversal-centric queries that
 * are awkward in GraphQL:
 *
 *   MATCH <pattern> [WHERE <expr>] RETURN <items> [SKIP n] [LIMIT n]
 *
 *   pattern      := nodePat ( relPat nodePat )*
 *   nodePat      := '(' [var] [':' Label] [ '{' prop (',' prop)* '}' ] ')'
 *   relPat       := ( '-' | '<-' ) '[' [var] [':' TYPE ('|' TYPE)*]
 *                       [ '*' [min] ['..' [max]] ] ']' ( '-' | '->' )
 *   WHERE expr   := orExpr                 (AND / OR, comparison, string preds)
 *   RETURN items := item (',' item)*   where item := (var | var '.' prop) [AS alias]
 *
 * NOT supported (rejected with a clear error): CREATE / MERGE / SET / DELETE /
 * REMOVE / WITH / UNWIND / CALL / OPTIONAL MATCH, aggregations, map projections,
 * list/path functions, and parameterised labels. Writes are intentionally out
 * of scope — the graph facade is read-only. Array-cell predicates
 * (e.g. porosity > 0.3) are not expressible in a pattern; use the dedicated
 * `stats` / `reduce` / `where` GraphQL fields or `/query` endpoints for those.
 */

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Direction = "out" | "in" | "both";

export type ScalarValue = string | number | boolean | null;

export interface NodePattern {
    /** Binding variable, e.g. `g` in `(g:Grid)`. Undefined for anonymous nodes. */
    variable?: string;
    /** Single label, e.g. `Grid` or a fully-qualified ETP type. Undefined = any. */
    label?: string;
    /** Inline equality constraints `{ name: "...", ... }`. */
    properties: Record<string, ScalarValue>;
}

export interface RelPattern {
    variable?: string;
    /** Relationship types (roles); OR-ed. Empty = any role. */
    types: string[];
    direction: Direction;
    /** Variable-length lower bound (default 1). */
    minHops: number;
    /** Variable-length upper bound (default = minHops; Infinity for open `*`). */
    maxHops: number;
    /** True when a `*` quantifier was present (variable-length path). */
    varLength: boolean;
}

export interface PatternPart {
    /** Optional path variable, e.g. `p` in `MATCH p = (a)-[*]-(b)`. */
    pathVariable?: string;
    nodes: NodePattern[];
    /** rels[i] connects nodes[i] -> nodes[i+1]. length === nodes.length - 1. */
    rels: RelPattern[];
}

export type ComparisonOp =
    | "="
    | "<>"
    | "<"
    | "<="
    | ">"
    | ">="
    | "=~"
    | "CONTAINS"
    | "STARTS WITH"
    | "ENDS WITH"
    | "IS NULL"
    | "IS NOT NULL";

export interface PropertyRef {
    kind: "property";
    variable: string;
    property: string;
}

export interface Comparison {
    kind: "comparison";
    left: PropertyRef;
    op: ComparisonOp;
    /** Right-hand literal (absent for IS NULL / IS NOT NULL). */
    right?: ScalarValue;
}

export interface BoolExpr {
    kind: "and" | "or";
    left: WhereExpr;
    right: WhereExpr;
}

export interface NotExpr {
    kind: "not";
    operand: WhereExpr;
}

export type WhereExpr = Comparison | BoolExpr | NotExpr;

export interface ReturnItem {
    variable: string;
    /** Undefined = return the whole node; otherwise a scalar property. */
    property?: string;
    alias: string;
}

export interface CypherQuery {
    pattern: PatternPart;
    where?: WhereExpr;
    returnItems: ReturnItem[];
    skip?: number;
    limit?: number;
    distinct: boolean;
}

export class CypherSyntaxError extends Error {
    constructor(message: string, public readonly position?: number) {
        super(message);
        this.name = "CypherSyntaxError";
    }
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenKind =
    | "ident"
    | "number"
    | "string"
    | "punct"
    | "param"
    | "eof";

interface Token {
    kind: TokenKind;
    value: string;
    pos: number;
}

const PUNCT = [
    "<-",
    "->",
    "..",
    "<=",
    ">=",
    "<>",
    "=~",
    "(",
    ")",
    "[",
    "]",
    "{",
    "}",
    ":",
    ",",
    ".",
    "=",
    "<",
    ">",
    "-",
    "*",
    "|"
];

function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const n = input.length;
    while (i < n) {
        const ch = input[i];
        if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
            i++;
            continue;
        }
        // Line comment //...
        if (ch === "/" && input[i + 1] === "/") {
            while (i < n && input[i] !== "\n") i++;
            continue;
        }
        // String literal (single or double quoted, with simple escapes)
        if (ch === "'" || ch === '"') {
            const quote = ch;
            const start = i;
            i++;
            let str = "";
            while (i < n && input[i] !== quote) {
                if (input[i] === "\\" && i + 1 < n) {
                    const esc = input[i + 1];
                    str +=
                        esc === "n"
                            ? "\n"
                            : esc === "t"
                            ? "\t"
                            : esc === "r"
                            ? "\r"
                            : esc;
                    i += 2;
                } else {
                    str += input[i];
                    i++;
                }
            }
            if (i >= n) {
                throw new CypherSyntaxError("Unterminated string literal", start);
            }
            i++; // closing quote
            tokens.push({ kind: "string", value: str, pos: start });
            continue;
        }
        // Parameter $name
        if (ch === "$") {
            const start = i;
            i++;
            let name = "";
            while (i < n && /[A-Za-z0-9_]/.test(input[i])) {
                name += input[i];
                i++;
            }
            if (!name) {
                throw new CypherSyntaxError("Expected parameter name after '$'", start);
            }
            tokens.push({ kind: "param", value: name, pos: start });
            continue;
        }
        // Number (int or float, optional leading '-')
        if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
            const start = i;
            let num = "";
            while (i < n && /[0-9.eE+\-]/.test(input[i])) {
                // Stop before a '..' range operator.
                if (input[i] === "." && input[i + 1] === ".") break;
                num += input[i];
                i++;
            }
            tokens.push({ kind: "number", value: num, pos: start });
            continue;
        }
        // Identifier / keyword
        if (/[A-Za-z_`]/.test(ch)) {
            const start = i;
            // Backtick-quoted identifiers may contain almost anything.
            if (ch === "`") {
                i++;
                let id = "";
                while (i < n && input[i] !== "`") {
                    id += input[i];
                    i++;
                }
                if (i >= n) {
                    throw new CypherSyntaxError("Unterminated `identifier`", start);
                }
                i++;
                tokens.push({ kind: "ident", value: id, pos: start });
                continue;
            }
            let id = "";
            while (i < n && /[A-Za-z0-9_.]/.test(input[i])) {
                id += input[i];
                i++;
            }
            tokens.push({ kind: "ident", value: id, pos: start });
            continue;
        }
        // Punctuation (longest match first)
        const two = input.substr(i, 2);
        if (PUNCT.includes(two)) {
            tokens.push({ kind: "punct", value: two, pos: i });
            i += 2;
            continue;
        }
        if (PUNCT.includes(ch)) {
            tokens.push({ kind: "punct", value: ch, pos: i });
            i++;
            continue;
        }
        throw new CypherSyntaxError(`Unexpected character '${ch}'`, i);
    }
    tokens.push({ kind: "eof", value: "", pos: n });
    return tokens;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const UNSUPPORTED_CLAUSES = [
    "CREATE",
    "MERGE",
    "SET",
    "DELETE",
    "REMOVE",
    "DETACH",
    "UNWIND",
    "CALL",
    "FOREACH",
    "LOAD",
    "USING"
];

class Parser {
    private pos = 0;

    constructor(
        private readonly tokens: Token[],
        private readonly params: Record<string, ScalarValue>
    ) {}

    private peek(): Token {
        return this.tokens[this.pos];
    }

    private next(): Token {
        return this.tokens[this.pos++];
    }

    private isKeyword(word: string): boolean {
        const t = this.peek();
        return t.kind === "ident" && t.value.toUpperCase() === word;
    }

    private eatKeyword(word: string): boolean {
        if (this.isKeyword(word)) {
            this.pos++;
            return true;
        }
        return false;
    }

    private expectPunct(value: string): void {
        const t = this.peek();
        if (t.kind !== "punct" || t.value !== value) {
            throw new CypherSyntaxError(
                `Expected '${value}' but found '${t.value || "<eof>"}'`,
                t.pos
            );
        }
        this.pos++;
    }

    private isPunct(value: string): boolean {
        const t = this.peek();
        return t.kind === "punct" && t.value === value;
    }

    parse(): CypherQuery {
        this.rejectUnsupported();

        if (!this.eatKeyword("MATCH")) {
            const t = this.peek();
            throw new CypherSyntaxError(
                `Only read-only MATCH ... RETURN queries are supported; found '${
                    t.value || "<eof>"
                }'`,
                t.pos
            );
        }
        if (this.isKeyword("OPTIONAL")) {
            throw new CypherSyntaxError("OPTIONAL MATCH is not supported", this.peek().pos);
        }

        const pattern = this.parsePatternPart();

        let where: WhereExpr | undefined;
        if (this.eatKeyword("WHERE")) {
            where = this.parseOr();
        }

        if (!this.eatKeyword("RETURN")) {
            throw new CypherSyntaxError(
                "Expected RETURN clause",
                this.peek().pos
            );
        }
        const distinct = this.eatKeyword("DISTINCT");
        const returnItems = this.parseReturnItems();

        let skip: number | undefined;
        let limit: number | undefined;
        // ORDER BY is accepted syntactically but ignored (documented limitation).
        if (this.eatKeyword("ORDER")) {
            if (!this.eatKeyword("BY")) {
                throw new CypherSyntaxError("Expected BY after ORDER", this.peek().pos);
            }
            // Consume order items until SKIP/LIMIT/EOF.
            while (
                !this.isKeyword("SKIP") &&
                !this.isKeyword("LIMIT") &&
                this.peek().kind !== "eof"
            ) {
                this.pos++;
            }
        }
        if (this.eatKeyword("SKIP")) {
            skip = this.parseIntegerLiteral();
        }
        if (this.eatKeyword("LIMIT")) {
            limit = this.parseIntegerLiteral();
        }

        if (this.peek().kind !== "eof") {
            const t = this.peek();
            throw new CypherSyntaxError(
                `Unexpected trailing input '${t.value}'`,
                t.pos
            );
        }

        return { pattern, where, returnItems, skip, limit, distinct };
    }

    private rejectUnsupported(): void {
        for (const t of this.tokens) {
            if (t.kind === "ident" && UNSUPPORTED_CLAUSES.includes(t.value.toUpperCase())) {
                throw new CypherSyntaxError(
                    `Clause '${t.value.toUpperCase()}' is not supported by the read-only Cypher subset. ` +
                        `Supported: MATCH ... [WHERE ...] RETURN ... [ORDER BY ...] [SKIP n] [LIMIT n].`,
                    t.pos
                );
            }
        }
    }

    // -- Pattern -------------------------------------------------------------

    private parsePatternPart(): PatternPart {
        let pathVariable: string | undefined;
        // `p = (...)`
        if (
            this.peek().kind === "ident" &&
            this.tokens[this.pos + 1]?.kind === "punct" &&
            this.tokens[this.pos + 1]?.value === "="
        ) {
            pathVariable = this.next().value;
            this.expectPunct("=");
        }

        const nodes: NodePattern[] = [];
        const rels: RelPattern[] = [];

        nodes.push(this.parseNodePattern());
        while (this.isPunct("-") || this.isPunct("<-")) {
            rels.push(this.parseRelPattern());
            nodes.push(this.parseNodePattern());
        }

        if (this.isPunct(",")) {
            throw new CypherSyntaxError(
                "Multiple comma-separated pattern parts are not supported; use a single connected path.",
                this.peek().pos
            );
        }

        return { pathVariable, nodes, rels };
    }

    private parseNodePattern(): NodePattern {
        this.expectPunct("(");
        const node: NodePattern = { properties: {} };

        // Optional variable
        if (this.peek().kind === "ident" && !this.isPunct(":")) {
            // Could be variable; labels come after ':'.
            node.variable = this.next().value;
        }
        // Optional label
        if (this.isPunct(":")) {
            this.expectPunct(":");
            node.label = this.parseLabelName();
            if (this.isPunct(":")) {
                throw new CypherSyntaxError(
                    "Multiple labels on a node are not supported.",
                    this.peek().pos
                );
            }
        }
        // Optional inline properties
        if (this.isPunct("{")) {
            node.properties = this.parsePropertyMap();
        }

        this.expectPunct(")");
        return node;
    }

    private parseRelPattern(): RelPattern {
        let leftArrow = false;
        if (this.isPunct("<-")) {
            leftArrow = true;
            this.next();
        } else {
            this.expectPunct("-");
        }

        const rel: RelPattern = {
            types: [],
            direction: "both",
            minHops: 1,
            maxHops: 1,
            varLength: false
        };

        // Optional detail block [var:TYPE*min..max]
        if (this.isPunct("[")) {
            this.expectPunct("[");
            if (this.peek().kind === "ident" && !this.isPunct(":") && !this.isPunct("*")) {
                rel.variable = this.next().value;
            }
            if (this.isPunct(":")) {
                this.expectPunct(":");
                rel.types.push(this.parseLabelName());
                while (this.isPunct("|")) {
                    this.next();
                    // Tolerate `|:TYPE`
                    if (this.isPunct(":")) this.next();
                    rel.types.push(this.parseLabelName());
                }
            }
            if (this.isPunct("*")) {
                this.next();
                rel.varLength = true;
                rel.minHops = 1;
                rel.maxHops = Infinity;
                if (this.peek().kind === "number") {
                    rel.minHops = this.parseIntegerLiteral();
                    rel.maxHops = rel.minHops;
                }
                if (this.isPunct("..")) {
                    this.next();
                    rel.maxHops = Infinity;
                    if (this.peek().kind === "number") {
                        rel.maxHops = this.parseIntegerLiteral();
                    }
                }
            }
            this.expectPunct("]");
        }

        let rightArrow = false;
        if (this.isPunct("->")) {
            rightArrow = true;
            this.next();
        } else {
            this.expectPunct("-");
        }

        if (leftArrow && rightArrow) {
            throw new CypherSyntaxError(
                "A relationship cannot be directed both ways (<-...->).",
                this.peek().pos
            );
        }
        rel.direction = leftArrow ? "in" : rightArrow ? "out" : "both";
        return rel;
    }

    private parseLabelName(): string {
        const t = this.peek();
        if (t.kind !== "ident") {
            throw new CypherSyntaxError(
                `Expected a label/type name but found '${t.value || "<eof>"}'`,
                t.pos
            );
        }
        this.pos++;
        return t.value;
    }

    private parsePropertyMap(): Record<string, ScalarValue> {
        this.expectPunct("{");
        const map: Record<string, ScalarValue> = {};
        if (!this.isPunct("}")) {
            do {
                const keyTok = this.peek();
                if (keyTok.kind !== "ident" && keyTok.kind !== "string") {
                    throw new CypherSyntaxError(
                        `Expected property name but found '${keyTok.value || "<eof>"}'`,
                        keyTok.pos
                    );
                }
                this.pos++;
                this.expectPunct(":");
                map[keyTok.value] = this.parseLiteral();
            } while (this.eatComma());
        }
        this.expectPunct("}");
        return map;
    }

    // -- WHERE expression ----------------------------------------------------

    private parseOr(): WhereExpr {
        let left = this.parseAnd();
        while (this.isKeyword("OR")) {
            this.pos++;
            const right = this.parseAnd();
            left = { kind: "or", left, right };
        }
        return left;
    }

    private parseAnd(): WhereExpr {
        let left = this.parseNot();
        while (this.isKeyword("AND")) {
            this.pos++;
            const right = this.parseNot();
            left = { kind: "and", left, right };
        }
        return left;
    }

    private parseNot(): WhereExpr {
        if (this.eatKeyword("NOT")) {
            return { kind: "not", operand: this.parseNot() };
        }
        if (this.isPunct("(")) {
            this.expectPunct("(");
            const inner = this.parseOr();
            this.expectPunct(")");
            return inner;
        }
        return this.parseComparison();
    }

    private parseComparison(): Comparison {
        const left = this.parsePropertyRef();

        // IS NULL / IS NOT NULL
        if (this.eatKeyword("IS")) {
            if (this.eatKeyword("NOT")) {
                if (!this.eatKeyword("NULL")) {
                    throw new CypherSyntaxError("Expected NULL after IS NOT", this.peek().pos);
                }
                return { kind: "comparison", left, op: "IS NOT NULL" };
            }
            if (!this.eatKeyword("NULL")) {
                throw new CypherSyntaxError("Expected NULL after IS", this.peek().pos);
            }
            return { kind: "comparison", left, op: "IS NULL" };
        }

        // String predicates
        if (this.isKeyword("CONTAINS")) {
            this.pos++;
            return { kind: "comparison", left, op: "CONTAINS", right: this.parseLiteral() };
        }
        if (this.isKeyword("STARTS")) {
            this.pos++;
            if (!this.eatKeyword("WITH")) {
                throw new CypherSyntaxError("Expected WITH after STARTS", this.peek().pos);
            }
            return { kind: "comparison", left, op: "STARTS WITH", right: this.parseLiteral() };
        }
        if (this.isKeyword("ENDS")) {
            this.pos++;
            if (!this.eatKeyword("WITH")) {
                throw new CypherSyntaxError("Expected WITH after ENDS", this.peek().pos);
            }
            return { kind: "comparison", left, op: "ENDS WITH", right: this.parseLiteral() };
        }

        // Comparison operators
        const opTok = this.peek();
        const ops: Record<string, ComparisonOp> = {
            "=": "=",
            "<>": "<>",
            "<": "<",
            "<=": "<=",
            ">": ">",
            ">=": ">=",
            "=~": "=~"
        };
        if (opTok.kind === "punct" && ops[opTok.value]) {
            this.pos++;
            return {
                kind: "comparison",
                left,
                op: ops[opTok.value],
                right: this.parseLiteral()
            };
        }

        throw new CypherSyntaxError(
            `Expected a comparison operator after '${left.variable}.${left.property}' but found '${
                opTok.value || "<eof>"
            }'`,
            opTok.pos
        );
    }

    private parsePropertyRef(): PropertyRef {
        const varTok = this.peek();
        if (varTok.kind !== "ident") {
            throw new CypherSyntaxError(
                `Expected a variable in WHERE but found '${varTok.value || "<eof>"}'`,
                varTok.pos
            );
        }
        this.pos++;
        // Support dotted form captured as a single ident token (e.g. `g.name`).
        const dotIdx = varTok.value.indexOf(".");
        if (dotIdx > 0) {
            return {
                kind: "property",
                variable: varTok.value.slice(0, dotIdx),
                property: varTok.value.slice(dotIdx + 1)
            };
        }
        this.expectPunct(".");
        const propTok = this.peek();
        if (propTok.kind !== "ident") {
            throw new CypherSyntaxError(
                `Expected a property name after '${varTok.value}.'`,
                propTok.pos
            );
        }
        this.pos++;
        return { kind: "property", variable: varTok.value, property: propTok.value };
    }

    // -- RETURN --------------------------------------------------------------

    private parseReturnItems(): ReturnItem[] {
        const items: ReturnItem[] = [];
        do {
            const varTok = this.peek();
            if (varTok.kind !== "ident") {
                throw new CypherSyntaxError(
                    `Expected a variable in RETURN but found '${varTok.value || "<eof>"}'. ` +
                        `Aggregations and expressions are not supported.`,
                    varTok.pos
                );
            }
            this.pos++;
            let variable = varTok.value;
            let property: string | undefined;
            const dotIdx = varTok.value.indexOf(".");
            if (dotIdx > 0) {
                variable = varTok.value.slice(0, dotIdx);
                property = varTok.value.slice(dotIdx + 1);
            } else if (this.isPunct(".")) {
                this.expectPunct(".");
                const propTok = this.peek();
                if (propTok.kind !== "ident") {
                    throw new CypherSyntaxError(
                        `Expected a property name after '${variable}.'`,
                        propTok.pos
                    );
                }
                this.pos++;
                property = propTok.value;
            }
            let alias = property ? `${variable}.${property}` : variable;
            if (this.eatKeyword("AS")) {
                const aliasTok = this.peek();
                if (aliasTok.kind !== "ident") {
                    throw new CypherSyntaxError(
                        `Expected an alias name after AS`,
                        aliasTok.pos
                    );
                }
                this.pos++;
                alias = aliasTok.value;
            }
            items.push({ variable, property, alias });
        } while (this.eatComma());
        return items;
    }

    // -- Literals ------------------------------------------------------------

    private parseLiteral(): ScalarValue {
        const t = this.peek();
        if (t.kind === "string") {
            this.pos++;
            return t.value;
        }
        if (t.kind === "number") {
            this.pos++;
            return Number(t.value);
        }
        if (t.kind === "param") {
            this.pos++;
            if (!(t.value in this.params)) {
                throw new CypherSyntaxError(`Missing value for parameter $${t.value}`, t.pos);
            }
            return this.params[t.value];
        }
        if (t.kind === "ident") {
            const upper = t.value.toUpperCase();
            if (upper === "TRUE") {
                this.pos++;
                return true;
            }
            if (upper === "FALSE") {
                this.pos++;
                return false;
            }
            if (upper === "NULL") {
                this.pos++;
                return null;
            }
        }
        throw new CypherSyntaxError(
            `Expected a literal value but found '${t.value || "<eof>"}'`,
            t.pos
        );
    }

    private parseIntegerLiteral(): number {
        const t = this.peek();
        if (t.kind === "number" && /^[0-9]+$/.test(t.value)) {
            this.pos++;
            return parseInt(t.value, 10);
        }
        if (t.kind === "param") {
            this.pos++;
            const v = this.params[t.value];
            if (typeof v === "number" && Number.isInteger(v)) return v;
            throw new CypherSyntaxError(`Parameter $${t.value} must be an integer`, t.pos);
        }
        throw new CypherSyntaxError(
            `Expected an integer but found '${t.value || "<eof>"}'`,
            t.pos
        );
    }

    private eatComma(): boolean {
        if (this.isPunct(",")) {
            this.pos++;
            return true;
        }
        return false;
    }
}

/**
 * Parse a Cypher string into a validated {@link CypherQuery} AST.
 *
 * @param query openCypher text (read-only subset).
 * @param params `$`-parameter values referenced by the query.
 * @throws {CypherSyntaxError} on any syntax error or unsupported construct.
 */
export function parseCypher(
    query: string,
    params: Record<string, ScalarValue> = {}
): CypherQuery {
    if (!query || !query.trim()) {
        throw new CypherSyntaxError("Empty Cypher query");
    }
    const tokens = tokenize(query);
    return new Parser(tokens, params).parse();
}
