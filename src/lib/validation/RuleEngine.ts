/**
 * RuleEngine - declarative RESQML rule evaluation for TypeScript.
 *
 * Executes the shared, language-neutral rule registry authored in
 * `rddmsmg/energistics/resqml/3.0.0/model/rules/resqml_rules.yaml` and vendored here as
 * `resqml_rules.json`. This is the TypeScript counterpart to the Python
 * engine (`resqml_converter/rule_engine.py`); both consume the SAME registry,
 * which is how the two validators stay in sync.
 *
 * Only *declarative* rules (those with `check` / `checks`) run here. Rules
 * carrying a `handler` are catalog-only: their logic stays in the imperative
 * validator (DOR / EPC / HDF5 / serialization layers), which needs EPC-wide or
 * binary context an XML string view cannot provide.
 *
 * Edit rules in the YAML source only, then regenerate the JSON - never here.
 */

import {
    Severity,
    ValidationCategory,
    ValidationError,
    EpcObject,
    isStandardPropertyKindUuid,
} from "./ResqmlValidator";

import registryJson from "./resqml_rules.json";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Registry types ──────────────────────────────────────────────────────────

interface Rule {
    id: string;
    title: string;
    category: string;
    severity: string;
    source?: string;
    applies_to?: { type_contains?: string[]; type_excludes?: string[] };
    check?: Predicate;
    checks?: Predicate[];
    handler?: string;
    message: string;
}

interface Predicate {
    // leaf
    field?: string;
    op?: string;
    value?: any;
    null_ok?: boolean;
    // count
    count_of?: string;
    // reference
    ref?: string;
    must_resolve?: boolean;
    allow_standard_property_kind?: boolean;
    // iterate
    for_each?: string;
    satisfy?: Predicate;
    // compose
    all_of?: Predicate[];
    any_of?: Predicate[];
    not?: Predicate;
}

interface Registry {
    version: string;
    description?: string;
    rules: Rule[];
}

const REGISTRY = registryJson as unknown as Registry;

// ─── XML object view ─────────────────────────────────────────────────────────
//
// Resolves PascalCase logical field paths onto an EpcObject's raw XML, mirroring
// the reads the legacy validator performs. The LAST path segment is the XML
// local element name; `Uuid` and `SchemaVersion` are special-cased to the
// object identity / root attribute.

/** First text content of a (namespaced) element by local name. */
function xmlText(xml: string, localName: string): string | null {
    const re = new RegExp(`<(?:[\\w-]+:)?${localName}[^>]*>([^<]*)<\\/`, "i");
    const m = re.exec(xml);
    return m ? m[1].trim() : null;
}

/** Root element attribute (skips <?xml?> / comments). */
function xmlRootAttr(xml: string, attrName: string): string | null {
    const rootMatch = xml.match(/<(?!\?|!)([^\s>/]+)\s([^>]*?)>/);
    if (!rootMatch) return null;
    const attrRe = new RegExp(`${attrName}\\s*=\\s*["']([^"']*?)["']`);
    const m = attrRe.exec(rootMatch[2]);
    return m ? m[1] : null;
}

/** Extract each `<Type ...>...</Type>` block's inner XML (self-closing => ""). */
function xmlBlocks(xml: string, typeName: string): string[] {
    const blocks: string[] = [];
    const openClose = new RegExp(
        `<(?:[\\w-]+:)?${typeName}\\b[^>]*?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${typeName}>`,
        "gi"
    );
    let m: RegExpExecArray | null;
    while ((m = openClose.exec(xml)) !== null) blocks.push(m[1]);
    // self-closing occurrences
    const selfClose = new RegExp(`<(?:[\\w-]+:)?${typeName}\\b[^>]*?/>`, "gi");
    while ((m = selfClose.exec(xml)) !== null) blocks.push("");
    return blocks;
}

/** Number of occurrences of a (possibly nested) element type. */
function xmlCount(xml: string, typeName: string): number {
    return xmlBlocks(xml, typeName).length;
}

/** Whether a (namespaced) element with the given local name exists at all. */
function xmlHas(xml: string, localName: string): boolean {
    return new RegExp(`<(?:[\\w-]+:)?${localName}[\\s>/]`, "i").test(xml);
}

/** UUID inside a named reference element block. */
function refUuid(xml: string, elementName: string): string | null {
    const re = new RegExp(
        `<(?:[\\w-]+:)?${elementName}\\b[\\s\\S]*?<(?:[\\w-]+:)?(?:UUID|Uuid)[^>]*>([^<]+)<\\/`,
        "i"
    );
    const m = re.exec(xml);
    return m ? m[1].trim() : null;
}

/** A view over an object (or a nested element block during for_each). */
class ObjView {
    constructor(
        public xml: string,
        public uuid: string,
        public objectType: string
    ) { }

    /** Last segment resolved as element text (Uuid / SchemaVersion special). */
    fieldText(path: string): string | null {
        if (path === "Uuid") return this.uuid || null;
        if (path === "SchemaVersion") return xmlRootAttr(this.xml, "schemaVersion");
        const seg = path.split(".").pop() as string;
        return xmlText(this.xml, seg);
    }

    fieldInt(path: string): number | null {
        const t = this.fieldText(path);
        if (t === null) return null;
        const n = parseInt(t, 10);
        return isNaN(n) ? null : n;
    }
}

// ─── Predicate evaluation ────────────────────────────────────────────────────

const NUMERIC_OPS: Record<string, (a: number, b: number) => boolean> = {
    gt: (a, b) => a > b,
    ge: (a, b) => a >= b,
    lt: (a, b) => a < b,
    le: (a, b) => a <= b,
    eq: (a, b) => a === b,
    ne: (a, b) => a !== b,
};

interface EngineContext {
    uuidIndex: Set<string>; // lowercased
}

/** Existence of a field: element presence (containers/leaves), or identity. */
function existsField(path: string, view: ObjView): boolean {
    if (path === "Uuid") return !!view.uuid;
    if (path === "SchemaVersion") return xmlRootAttr(view.xml, "schemaVersion") !== null;
    const seg = path.split(".").pop() as string;
    return xmlHas(view.xml, seg);
}

/** Evaluate a leaf `field` predicate; returns offending values ([] == ok). */
function evalLeafField(pred: Predicate, view: ObjView): any[] {
    const path = pred.field as string;
    const op = pred.op as string;
    const nullOk = pred.null_ok !== false;

    if (op === "present") {
        return existsField(path, view) ? [] : [null];
    }
    if (op === "absent") {
        return existsField(path, view) ? [null] : [];
    }

    const raw = view.fieldText(path);
    if (raw === null) return nullOk ? [] : [null];

    switch (op) {
        case "nonempty":
            return raw.trim() ? [] : [raw];
        case "is_uuid":
            return UUID_RE.test(raw) ? [] : [raw];
        case "matches":
            return new RegExp(pred.value).test(raw) ? [] : [raw];
        case "in": {
            const allowed = (pred.value as any[]).map(a =>
                typeof a === "string" ? a.toLowerCase() : a
            );
            return allowed.includes(raw.toLowerCase()) ? [] : [raw];
        }
        default: {
            if (op in NUMERIC_OPS) {
                const n = parseInt(raw, 10);
                if (isNaN(n)) return []; // non-numeric => satisfied (matches legacy guards)
                return NUMERIC_OPS[op](n, pred.value) ? [] : [n];
            }
            return [];
        }
    }
}

function evalPredicate(pred: Predicate, view: ObjView, ctx: EngineContext): any[] {
    if (pred.all_of) {
        const out: any[] = [];
        for (const sub of pred.all_of) out.push(...evalPredicate(sub, view, ctx));
        return out;
    }
    if (pred.any_of) {
        for (const sub of pred.any_of) {
            if (evalPredicate(sub, view, ctx).length === 0) return []; // one satisfied
        }
        return [null];
    }
    if (pred.not) {
        return evalPredicate(pred.not, view, ctx).length === 0 ? [null] : [];
    }
    if (pred.for_each) {
        const out: any[] = [];
        for (const block of xmlBlocks(view.xml, pred.for_each)) {
            const sub = new ObjView(block, view.uuid, view.objectType);
            out.push(...evalPredicate(pred.satisfy as Predicate, sub, ctx));
        }
        return out;
    }
    if (pred.count_of) {
        const n = xmlCount(view.xml, pred.count_of);
        const op = pred.op as string;
        return NUMERIC_OPS[op](n, pred.value) ? [] : [n];
    }
    if (pred.ref) {
        const uuid = refUuid(view.xml, pred.ref);
        if (!uuid) return [];
        if (ctx.uuidIndex.has(uuid.toLowerCase())) return [];
        if (pred.allow_standard_property_kind && isStandardPropertyKindUuid(uuid)) return [];
        return [uuid];
    }
    if (pred.field) {
        return evalLeafField(pred, view);
    }
    return [];
}

// ─── Engine ──────────────────────────────────────────────────────────────────

export class RuleEngine {
    private declarative: Rule[];

    constructor(private registry: Registry = REGISTRY) {
        this.declarative = registry.rules.filter(r => r.check || r.checks);
    }

    private applies(rule: Rule, objectType: string): boolean {
        const sel = rule.applies_to;
        if (!sel) return true;
        if (sel.type_contains && !sel.type_contains.some(t => objectType.includes(t))) {
            return false;
        }
        if (sel.type_excludes && sel.type_excludes.some(t => objectType.includes(t))) {
            return false;
        }
        return true;
    }

    private finding(rule: Rule, obj: EpcObject, value: any): ValidationError {
        let msg = rule.message;
        if (msg.includes("{value}")) {
            msg = msg.replace("{value}", value === null || value === undefined ? "" : String(value));
        }
        return {
            message: `[${rule.id}] ${msg}`,
            severity: rule.severity as Severity,
            category: rule.category as ValidationCategory,
            object_uuid: obj.uuid,
            object_type: obj.objectType,
        };
    }

    evaluate(objects: EpcObject[], uuidIndex?: Set<string>): ValidationError[] {
        const index =
            uuidIndex ?? new Set(objects.map(o => o.uuid.toLowerCase()));
        const ctx: EngineContext = { uuidIndex: index };
        const errors: ValidationError[] = [];

        for (const obj of objects) {
            const view = new ObjView(obj.xmlString, obj.uuid, obj.objectType);
            for (const rule of this.declarative) {
                if (!this.applies(rule, obj.objectType)) continue;
                const preds = rule.checks ?? [rule.check as Predicate];
                for (const pred of preds) {
                    for (const value of evalPredicate(pred, view, ctx)) {
                        errors.push(this.finding(rule, obj, value));
                    }
                }
            }
        }
        return errors;
    }
}
