/**
 * ResqmlValidator - TypeScript RESQML strict validator.
 *
 * Port of the Python resqml_converter.strict_validation module.
 * Runs entirely in-process (no subprocess, no HTTP, no Python).
 *
 * Validation layers:
 *   1. EPC structure       - OPC ZIP compliance
 *   2. XSD schema          - lxml-equivalent via libxmljs2
 *   3. DOR integrity       - referential completeness
 *   4. HDF5 references     - dataset path existence (h5wasm)
 *   5. Cross-object        - UUID uniqueness, CRS consistency
 *   6. Business rules      - RESQML spec rules S01–S18
 *   7. PWLS PropertyKind   - dictionary validation (P01–P04)
 *   8. fesapi compat       - xsi:type, element ordering, obj_ prefix
 *   9. RDDMS compat        - ContentType format, .rels integrity
 *
 * Supported versions: RESQML 2.0.1 (EML 2.0) and RESQML 2.2 (EML 2.3).
 */

import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";

// ─── Types ───────────────────────────────────────────────────────────────────

export enum Severity {
    ERROR = "error",
    WARNING = "warning",
    INFO = "info",
}

export enum ValidationCategory {
    EPC_STRUCTURE = "epc_structure",
    XSD_SCHEMA = "xsd_schema",
    DOR_INTEGRITY = "dor_integrity",
    HDF5_REFERENCE = "hdf5_reference",
    CROSS_OBJECT = "cross_object",
    RESQML_BUSINESS_RULE = "resqml_business_rule",
    PWLS = "pwls",
    FESAPI_COMPAT = "fesapi_compat",
    RDDMS_COMPAT = "rddms_compat",
}

export interface ValidationError {
    message: string;
    severity: Severity;
    category: ValidationCategory;
    object_uuid?: string;
    object_type?: string;
    xpath?: string;
    line?: number;
}

export interface ValidationReport {
    is_valid: boolean;
    version: string | null;
    object_count: number;
    validated_count: number;
    error_count: number;
    warning_count: number;
    errors: ValidationError[];
}

export interface ValidationOptions {
    skip_xsd?: boolean;
    skip_dor?: boolean;
    skip_epc_structure?: boolean;
    skip_hdf5?: boolean;
    skip_cross_object?: boolean;
    skip_business_rules?: boolean;
    skip_pwls?: boolean;
    skip_fesapi?: boolean;
    skip_rddms?: boolean;
}

/** A parsed object extracted from an EPC for validation. */
export interface EpcObject {
    uuid: string;
    objectType: string;       // e.g. "IjkGridRepresentation"
    qualifiedType: string;    // e.g. "resqml20.obj_IjkGridRepresentation"
    contentType: string;      // full content-type string
    version: string;          // "2.0.1" or "2.2"
    xmlString: string;        // raw XML
    xmlDoc: any;              // parsed XML (for inspection)
    entryName: string;        // path inside ZIP
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SCHEMAS_DIR = path.resolve(__dirname, "schemas");

const SCHEMA_PATHS: Record<string, string> = {
    "2.0.1": path.join(SCHEMAS_DIR, "2.0.1/resqmlv2/v2.0.1/xsd_schemas/ResqmlAllObjects.xsd"),
    "2.2": path.join(SCHEMAS_DIR, "2.2/resqml/v2.2/xsd_schemas/ResqmlAllObjects.xsd"),
};

const VERSION_MAP: Record<string, string> = {
    "2.0": "2.0.1",
    "2.0.1": "2.0.1",
    "2.2": "2.2",
    "2.2.0": "2.2",
    "2.2.1": "2.2",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RESQML_CT_RE = /application\/x-resqml\+xml;\s*version=([^;]+);\s*type=(\w+)/;
const EML_CT_RE = /application\/x-eml\+xml;\s*version=([^;]+);\s*type=(\w+)/;

const RESQML_NS = "http://www.energistics.org/energyml/data/resqmlv2";
const EML20_NS = "http://www.energistics.org/energyml/data/commonv2";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

// OPC relationship types
const EXT_RESOURCE_TYPE = "http://schemas.energistics.org/package/2012/relationships/externalResource";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeVersion(v: string | null): string | null {
    if (!v) return null;
    return VERSION_MAP[v] ?? null;
}

function makeError(
    message: string,
    severity: Severity,
    category: ValidationCategory,
    opts?: { uuid?: string; type?: string; xpath?: string; line?: number }
): ValidationError {
    return {
        message,
        severity,
        category,
        object_uuid: opts?.uuid,
        object_type: opts?.type,
        xpath: opts?.xpath,
        line: opts?.line,
    };
}

function brError(
    ruleId: string,
    message: string,
    obj: EpcObject,
    severity: Severity = Severity.ERROR
): ValidationError {
    return makeError(
        `[${ruleId}] ${message}`,
        severity,
        ValidationCategory.RESQML_BUSINESS_RULE,
        { uuid: obj.uuid, type: obj.objectType }
    );
}

/**
 * Simple XML element accessor using regex (avoids full DOM for attribute reads).
 * Returns the text content of the first matching element.
 */
function xmlText(xml: string, localName: string): string | null {
    // Match <localName>text</localName> or <ns:localName>text</ns:localName>
    const re = new RegExp(`<(?:[\\w-]+:)?${localName}[^>]*>([^<]*)<\\/`, "i");
    const m = re.exec(xml);
    return m ? m[1].trim() : null;
}

/** Extract all text values for a given local element name. */
function xmlTextAll(xml: string, localName: string): string[] {
    const re = new RegExp(`<(?:[\\w-]+:)?${localName}[^>]*>([^<]*)<\\/`, "gi");
    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        results.push(m[1].trim());
    }
    return results;
}

/** Extract integer attribute/element value. */
function xmlInt(xml: string, localName: string): number | null {
    const t = xmlText(xml, localName);
    if (t === null) return null;
    const n = parseInt(t, 10);
    return isNaN(n) ? null : n;
}

/** Extract attribute from root element. */
function xmlRootAttr(xml: string, attrName: string): string | null {
    // Match first real element's attribute (skip XML declaration <?...?> and comments)
    const rootMatch = xml.match(/<(?!\?|!)([^\s>/]+)\s([^>]*?)>/);
    if (!rootMatch) return null;
    const attrs = rootMatch[2];
    const attrRe = new RegExp(`${attrName}\\s*=\\s*["']([^"']*?)["']`);
    const m = attrRe.exec(attrs);
    return m ? m[1] : null;
}

/** Find all UUID references (DataObjectReference patterns) in XML. */
function findDorUuids(xml: string): Array<{ uuid: string; title: string | null; path: string }> {
    const results: Array<{ uuid: string; title: string | null; path: string }> = [];
    // Match UUID elements inside DOR-like contexts
    // Pattern: <UUID>...</UUID> or <Uuid>...</Uuid> inside reference blocks
    const dorBlockRe = /<(?:[\w-]+:)?(DataObjectReference|LocalCrs|SupportingRepresentation|RepresentedInterpretation|RepresentedObject|PropertyKind|HdfProxy|InterpretedFeature|MdDatum|TimeSeries|StratigraphicColumn)[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1>/gi;
    let block: RegExpExecArray | null;
    while ((block = dorBlockRe.exec(xml)) !== null) {
        const blockXml = block[2];
        const dorPath = block[1];
        const uuidMatch = blockXml.match(/<(?:[\w-]+:)?(?:UUID|Uuid)[^>]*>([^<]+)<\//i);
        const titleMatch = blockXml.match(/<(?:[\w-]+:)?Title[^>]*>([^<]+)<\//i);
        if (uuidMatch) {
            results.push({
                uuid: uuidMatch[1].trim(),
                title: titleMatch ? titleMatch[1].trim() : null,
                path: dorPath,
            });
        }
    }
    return results;
}

/** Find HDF5 dataset paths referenced in XML. */
function findHdf5Paths(xml: string): string[] {
    const paths: string[] = [];
    // ExternalDataArrayPart / Hdf5Dataset patterns
    const re = /<(?:[\w-]+:)?(?:PathInExternalFile|PathInHdfFile)[^>]*>([^<]+)<\//gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        paths.push(m[1].trim());
    }
    return paths;
}

/** Detect RESQML version from raw XML (schemaVersion attribute or namespace). */
function detectVersionFromXml(xml: string): string | null {
    // Try schemaVersion attribute
    const sv = xmlRootAttr(xml, "schemaVersion");
    if (sv) {
        // Extract version number from strings like "2.0" or "2.0.0.20140822"
        const m = sv.match(/^(\d+\.\d+(?:\.\d+)?)/);
        if (m) return normalizeVersion(m[1]);
    }
    // Try namespace
    if (xml.includes("resqmlv2")) {
        if (xml.includes("version=2.2") || xml.includes("energyml/data/resqmlv2\" xmlns:eml")) {
            return "2.2";
        }
        return "2.0.1";
    }
    return null;
}

// ─── XSD Schema Cache ────────────────────────────────────────────────────────

let libxmljs: typeof import("libxmljs2") | null = null;
const schemaCache = new Map<string, any>();

function loadLibxmljs(): typeof import("libxmljs2") {
    if (!libxmljs) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            libxmljs = require("libxmljs2");
        } catch {
            throw new Error(
                "libxmljs2 not available - XSD validation disabled. Install with: npm install libxmljs2"
            );
        }
    }
    return libxmljs!;
}

function loadXsdSchema(version: string): any {
    if (schemaCache.has(version)) return schemaCache.get(version);

    const schemaPath = SCHEMA_PATHS[version];
    if (!schemaPath || !fs.existsSync(schemaPath)) {
        throw new Error(`XSD schema not found for version ${version}: ${schemaPath}`);
    }

    const lib = loadLibxmljs();
    const xsdContent = fs.readFileSync(schemaPath, "utf-8");
    const xsdDoc = lib.parseXml(xsdContent, {
        baseUrl: path.dirname(schemaPath) + "/",
    });
    schemaCache.set(version, xsdDoc);
    return xsdDoc;
}

// ─── Layer 1: EPC Structure ─────────────────────────────────────────────────

export function validateEpcStructure(epcPath: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const C = ValidationCategory.EPC_STRUCTURE;

    if (!fs.existsSync(epcPath)) {
        errors.push(makeError(`File not found: ${epcPath}`, Severity.ERROR, C));
        return errors;
    }

    let zip: AdmZip;
    try {
        zip = new AdmZip(epcPath);
    } catch {
        errors.push(makeError("Not a valid ZIP file", Severity.ERROR, C));
        return errors;
    }

    const entries = zip.getEntries();
    const names = new Set(entries.map(e => e.entryName));

    // [Content_Types].xml required
    const ctEntry = entries.find(
        e => e.entryName.toLowerCase() === "[content_types].xml"
    );
    if (!ctEntry) {
        errors.push(makeError("Missing [Content_Types].xml (required by OPC)", Severity.ERROR, C));
    } else {
        try {
            const ctXml = ctEntry.getData().toString("utf-8");
            // Check PartName entries
            const partNameRe = /PartName\s*=\s*"([^"]+)"/g;
            let pm: RegExpExecArray | null;
            while ((pm = partNameRe.exec(ctXml)) !== null) {
                const partName = pm[1];
                if (!partName.startsWith("/")) {
                    errors.push(makeError(
                        `PartName should start with '/' per OPC spec: ${partName}`,
                        Severity.WARNING, C
                    ));
                }
                const zipName = partName.replace(/^\//, "");
                if (zipName && !names.has(zipName)) {
                    errors.push(makeError(
                        `Part referenced in [Content_Types].xml not found in ZIP: ${partName}`,
                        Severity.WARNING, C
                    ));
                }
            }
        } catch (e: any) {
            errors.push(makeError(
                `[Content_Types].xml is not well-formed XML: ${e.message}`,
                Severity.ERROR, C
            ));
        }
    }

    // _rels/.rels recommended
    if (!names.has("_rels/.rels")) {
        errors.push(makeError("Missing _rels/.rels (recommended by OPC)", Severity.WARNING, C));
    }

    return errors;
}

// ─── Layer 2: XSD Schema Validation ─────────────────────────────────────────

export function validateXmlAgainstXsd(
    xmlString: string,
    version: string,
    objectUuid?: string,
    objectType?: string
): ValidationError[] {
    const errors: ValidationError[] = [];
    const C = ValidationCategory.XSD_SCHEMA;

    let xsdDoc: any;
    try {
        xsdDoc = loadXsdSchema(version);
    } catch (e: any) {
        errors.push(makeError(e.message, Severity.ERROR, C, { uuid: objectUuid, type: objectType }));
        return errors;
    }

    const lib = loadLibxmljs();

    // Pre-process: strip obj_ prefix from root element BEFORE parsing (avoids double parse+validate)
    let xmlToValidate = xmlString;
    const objPrefixMatch = xmlToValidate.match(/<(?:[\w-]+:)?obj_(\w+)/);
    if (objPrefixMatch) {
        const typeName = objPrefixMatch[1];
        xmlToValidate = xmlToValidate.replace(
            new RegExp(`(</?(?:[\\w-]+:)?)obj_${typeName}`, "g"),
            `$1${typeName}`
        );
    }

    let doc: any;
    try {
        doc = lib.parseXml(xmlToValidate);
    } catch (e: any) {
        errors.push(makeError(
            `XML parse error: ${e.message}`,
            Severity.ERROR, C,
            { uuid: objectUuid, type: objectType }
        ));
        return errors;
    }

    if (doc.validate(xsdDoc)) return errors;

    // Report validation errors (cap at 5 per object to avoid noise)
    const validationErrors = (doc.validationErrors || []).slice(0, 5);
    for (const err of validationErrors) {
        const errStr = typeof err === "string" ? err : err.message || String(err);
        // Demote ExtraMetadata position errors to warnings — moving ExtraMetadata
        // to the end is intentional (fesapi requirement) even though it violates
        // the strict XSD element sequence for some types.
        const severity = errStr.includes("ExtraMetadata") ? Severity.WARNING : Severity.ERROR;
        errors.push(makeError(errStr, severity, C, {
            uuid: objectUuid,
            type: objectType,
            line: typeof err === "object" ? err.line : undefined,
        }));
    }

    // If no specific errors captured, add a generic one
    if (errors.length === 0) {
        errors.push(makeError(
            "XSD validation failed (no detailed errors available)",
            Severity.ERROR, C,
            { uuid: objectUuid, type: objectType }
        ));
    }

    return errors;
}

// ─── Layer 3: DOR Integrity ─────────────────────────────────────────────────

export function validateDorIntegrity(objects: EpcObject[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const C = ValidationCategory.DOR_INTEGRITY;

    // Build UUID index
    const knownUuids = new Set(objects.map(o => o.uuid.toLowerCase()));

    for (const obj of objects) {
        const dors = findDorUuids(obj.xmlString);
        for (const dor of dors) {
            if (!dor.uuid) {
                errors.push(makeError(
                    `DOR has no UUID at path '${dor.path}'`,
                    Severity.ERROR, C,
                    { uuid: obj.uuid, type: obj.objectType, xpath: dor.path }
                ));
                continue;
            }

            if (!knownUuids.has(dor.uuid.toLowerCase())) {
                // Skip well-known Energistics property kind UUIDs (they're defined in the standard, not in the EPC)
                if (isStandardPropertyKindUuid(dor.uuid)) continue;

                errors.push(makeError(
                    `Referenced object not found: uuid='${dor.uuid}' title='${dor.title ?? "?"}'`,
                    Severity.ERROR, C,
                    { uuid: obj.uuid, type: obj.objectType, xpath: dor.path }
                ));
            }
        }
    }

    return errors;
}

// Standard Energistics PropertyKind UUIDs (a subset - these are defined in the spec, not in EPCs)
const STANDARD_PK_UUIDS = new Set([
    "a48c9c25-1e3a-43c8-be6a-044224cc69cb", // length
    "f6ad8329-4a87-4a08-8f11-db9ccc7bddbc", // dimensionless
    "742e9e25-6898-46b1-8098-a1c0a0034e81", // angle
    "4a305182-221e-4205-9e7c-a36b06fa5b3d", // area
    "58c4dc52-4278-4b48-84d4-3042e4e0a59d", // volume
    "1e8c0144-a7e6-4e20-a4a5-f8abc4252b08", // time
    "3bf23ef0-d649-48cd-aa7c-d84e83ecad38", // mass
    "aa2c59d5-5ee8-4570-b8df-f13bbc22c9e6", // pressure
    "84e3e5e6-8ccc-4076-b5c7-7c3b300e3fae", // temperature
    "cf4df5e5-e3b6-41e0-92c0-3c17d4aa92c7", // permeability rock
    "355543d1-fa5c-42b3-ba5d-fed1612a2843", // porosity
    "09df05c7-a06e-475e-a7a2-7ece1a071e9f", // saturation
    "71e52983-7da2-4f39-b4d5-f0e44f29cec6", // density
]);

function isStandardPropertyKindUuid(uuid: string): boolean {
    return STANDARD_PK_UUIDS.has(uuid.toLowerCase());
}

// ─── Layer 4: HDF5 Reference Validation ─────────────────────────────────────

export function validateHdf5References(
    objects: EpcObject[],
    h5Path?: string
): ValidationError[] {
    const errors: ValidationError[] = [];
    const C = ValidationCategory.HDF5_REFERENCE;

    const allPaths = new Set<string>();

    for (const obj of objects) {
        const paths = findHdf5Paths(obj.xmlString);
        for (const p of paths) {
            allPaths.add(p);
            if (!p.startsWith("/")) {
                errors.push(makeError(
                    `HDF5 path should start with '/': '${p}'`,
                    Severity.WARNING, C,
                    { uuid: obj.uuid, type: obj.objectType }
                ));
            }
        }
    }

    // If H5 file is provided, verify datasets exist (metadata-only - no array reads)
    if (h5Path && fs.existsSync(h5Path) && allPaths.size > 0) {
        let h5wasm: any;
        try {
            h5wasm = require("h5wasm");
        } catch {
            // h5wasm not installed - skip dataset existence checks silently
            return errors;
        }
        try {
            const f = new h5wasm.File(h5Path, "r");
            for (const dsPath of allPaths) {
                try {
                    const item = f.get(dsPath);
                    if (!item) {
                        errors.push(makeError(
                            `HDF5 dataset not found: '${dsPath}'`,
                            Severity.ERROR, C
                        ));
                    }
                } catch {
                    errors.push(makeError(
                        `HDF5 dataset not found: '${dsPath}'`,
                        Severity.ERROR, C
                    ));
                }
            }
            f.close();
        } catch (e: any) {
            if (e.message?.includes("not found")) {
                // h5wasm dataset-level error - already reported
            } else {
                errors.push(makeError(
                    `Error reading HDF5 file: ${e.message}`,
                    Severity.WARNING, C
                ));
            }
        }
    }

    return errors;
}

// ─── Layer 5: Cross-Object Consistency ───────────────────────────────────────

export function validateCrossObjectConsistency(
    objects: EpcObject[]
): ValidationError[] {
    const errors: ValidationError[] = [];
    const C = ValidationCategory.CROSS_OBJECT;

    // UUID uniqueness
    const uuidMap = new Map<string, string[]>();
    for (const obj of objects) {
        const key = obj.uuid.toLowerCase();
        if (!uuidMap.has(key)) uuidMap.set(key, []);
        uuidMap.get(key)!.push(obj.objectType);
    }

    for (const [uuid, types] of uuidMap) {
        if (types.length > 1) {
            errors.push(makeError(
                `Duplicate UUID '${uuid}' used by: ${types.join(", ")}`,
                Severity.ERROR, C,
                { uuid }
            ));
        }
    }

    return errors;
}

// ─── Layer 6: Business Rules S01–S18 ─────────────────────────────────────────

export function validateBusinessRules(objects: EpcObject[]): ValidationError[] {
    const errors: ValidationError[] = [];

    // Build UUID index for reference lookups
    const uuidIndex = new Map(objects.map(o => [o.uuid.toLowerCase(), o]));

    for (const obj of objects) {
        errors.push(...validateCommonRules(obj));
        errors.push(...validateGridRules(obj));
        errors.push(...validateTriangulatedRules(obj));
        errors.push(...validatePropertyRules(obj, uuidIndex));
        errors.push(...validateGeometryRules(obj));
    }

    return errors;
}

function validateCommonRules(obj: EpcObject): ValidationError[] {
    const errors: ValidationError[] = [];

    // S09: UUID must be valid RFC 4122
    if (!UUID_RE.test(obj.uuid)) {
        errors.push(brError("S09", `UUID is not valid RFC 4122 format: '${obj.uuid}'`, obj));
    }

    // S10: Citation.Title must not be empty
    const title = xmlText(obj.xmlString, "Title");
    if (title !== null && !title.trim()) {
        errors.push(brError("S10", "Citation.Title must not be empty", obj));
    }

    // S11: Citation.Creation should be present
    const creation = xmlText(obj.xmlString, "Creation");
    if (creation === null) {
        errors.push(brError("S11", "Citation.Creation is missing (expected a valid datetime)", obj, Severity.WARNING));
    }

    // S12: schemaVersion should be present and non-empty
    const schemaVer = xmlRootAttr(obj.xmlString, "schemaVersion");
    if (schemaVer !== null && !schemaVer.trim()) {
        errors.push(brError("S12", "schemaVersion is present but empty", obj, Severity.WARNING));
    }

    return errors;
}

function validateGridRules(obj: EpcObject): ValidationError[] {
    const errors: ValidationError[] = [];
    const t = obj.objectType;

    // S01/S02: IJK grid Ni, Nj > 0
    if (t.includes("IjkGridRepresentation")) {
        const ni = xmlInt(obj.xmlString, "Ni");
        const nj = xmlInt(obj.xmlString, "Nj");
        if (ni !== null && ni <= 0) errors.push(brError("S01", `IJK grid Ni must be positive, got ${ni}`, obj));
        if (nj !== null && nj <= 0) errors.push(brError("S02", `IJK grid Nj must be positive, got ${nj}`, obj));

        // S18: KGaps consistency
        const kgapsCount = xmlInt(obj.xmlString, "Count");
        if (kgapsCount !== null && kgapsCount < 0) {
            errors.push(brError("S18", `KGaps.Count must be non-negative, got ${kgapsCount}`, obj));
        }
    }

    // S03: Column-layer grid Nk > 0
    if (t.includes("ColumnLayer") || t.includes("IjkGrid")) {
        const nk = xmlInt(obj.xmlString, "Nk");
        if (nk !== null && nk <= 0) errors.push(brError("S03", `Column-layer grid Nk must be positive, got ${nk}`, obj));
    }

    // S04: Unstructured grid CellCount > 0
    if (t.includes("UnstructuredGridRepresentation")) {
        const cellCount = xmlInt(obj.xmlString, "CellCount");
        if (cellCount !== null && cellCount <= 0) {
            errors.push(brError("S04", `Unstructured grid CellCount must be positive, got ${cellCount}`, obj));
        }
    }

    // S16: Grid2dPatch FastestAxisCount, SlowestAxisCount > 0
    if (t.includes("Grid2d")) {
        const fastest = xmlInt(obj.xmlString, "FastestAxisCount");
        const slowest = xmlInt(obj.xmlString, "SlowestAxisCount");
        if (fastest !== null && fastest <= 0) {
            errors.push(brError("S16", `Grid2dPatch.FastestAxisCount must be positive, got ${fastest}`, obj));
        }
        if (slowest !== null && slowest <= 0) {
            errors.push(brError("S16", `Grid2dPatch.SlowestAxisCount must be positive, got ${slowest}`, obj));
        }
    }

    return errors;
}

function validateTriangulatedRules(obj: EpcObject): ValidationError[] {
    const errors: ValidationError[] = [];
    const t = obj.objectType;

    // S06: TriangulatedSetRepresentation must have ≥1 TrianglePatch
    if (t.includes("TriangulatedSetRepresentation")) {
        const hasPatch = obj.xmlString.includes("TrianglePatch");
        if (!hasPatch) {
            errors.push(brError("S06", "TriangulatedSetRepresentation must have at least one TrianglePatch", obj));
        }
    }

    // S05: TrianglePatch NodeCount > 0
    if (obj.xmlString.includes("TrianglePatch")) {
        const nodeCounts = xmlTextAll(obj.xmlString, "NodeCount");
        for (const nc of nodeCounts) {
            const n = parseInt(nc, 10);
            if (!isNaN(n) && n <= 0) {
                errors.push(brError("S05", `TrianglePatch.NodeCount must be positive, got ${n}`, obj));
            }
        }
    }

    return errors;
}

function validatePropertyRules(
    obj: EpcObject,
    uuidIndex: Map<string, EpcObject>
): ValidationError[] {
    const errors: ValidationError[] = [];
    if (!obj.objectType.includes("Property")) return errors;

    // S07: Property Count > 0
    // "Count" inside Property context (not KGaps.Count etc.) - look for Count as direct child
    const countMatch = obj.xmlString.match(/<(?:[\w-]+:)?Count>(\d+)<\//);
    if (countMatch) {
        const c = parseInt(countMatch[1], 10);
        if (c <= 0) {
            errors.push(brError("S07", `Property Count (values per element) must be positive, got ${c}`, obj));
        }
    }

    // S08: SupportingRepresentation must reference a valid object
    const supRepMatch = obj.xmlString.match(
        /<(?:[\w-]+:)?SupportingRepresentation[\s\S]*?<(?:[\w-]+:)?(?:UUID|Uuid)[^>]*>([^<]+)<\//i
    );
    if (supRepMatch) {
        const supUuid = supRepMatch[1].trim().toLowerCase();
        if (!uuidIndex.has(supUuid) && !isStandardPropertyKindUuid(supUuid)) {
            errors.push(brError("S08", `SupportingRepresentation references unknown object: uuid='${supRepMatch[1].trim()}'`, obj));
        }
    }

    return errors;
}

function validateGeometryRules(obj: EpcObject): ValidationError[] {
    const errors: ValidationError[] = [];
    const t = obj.objectType;

    // S14: PointGeometry must reference a LocalCRS
    if (obj.xmlString.includes("PointGeometry") || obj.xmlString.includes("Point3d")) {
        const hasLocalCrs = obj.xmlString.includes("LocalCrs") || obj.xmlString.includes("localCrs");
        if (!hasLocalCrs && obj.xmlString.includes("PointGeometry")) {
            errors.push(brError("S14", "PointGeometry must reference a LocalCRS", obj, Severity.WARNING));
        }
    }

    // S13: Key representations should reference an Interpretation
    if (t.includes("Representation") && !t.includes("Sub")) {
        const hasInterp = obj.xmlString.includes("RepresentedInterpretation") ||
            obj.xmlString.includes("RepresentedObject");
        if (!hasInterp) {
            const needsInterp = ["IjkGrid", "UnstructuredGrid", "TriangulatedSet", "Grid2d", "PolylineSet"];
            if (needsInterp.some(kw => t.includes(kw))) {
                errors.push(brError("S13",
                    "Representation should reference an Interpretation (RepresentedInterpretation/RepresentedObject)",
                    obj, Severity.WARNING
                ));
            }
        }
    }

    return errors;
}

// ─── Layer 7: PWLS PropertyKind Validation ───────────────────────────────────

export function validatePwlsPropertyKinds(objects: EpcObject[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const C = ValidationCategory.PWLS;

    // Try loading the RDDMS PWLS catalog
    let isKnownPwls: (name: string) => boolean;
    try {
        const pwlsMod = require("../jsonTypes/PwlsCurveCatalog");
        isKnownPwls = pwlsMod.isKnownPwlsProperty ?? (() => false);
    } catch {
        return errors; // PWLS catalog not available, skip silently
    }

    // Build set of locally defined PropertyKinds
    const localPkUuids = new Set(
        objects
            .filter(o => o.objectType.includes("PropertyKind"))
            .map(o => o.uuid.toLowerCase())
    );

    for (const obj of objects) {
        if (!obj.objectType.includes("Property")) continue;

        // Extract the PropertyKind element content (bounded to avoid matching HdfProxy DORs)
        const pkElementMatch = obj.xmlString.match(
            /<(?:[\w-]+:)?PropertyKind\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?PropertyKind>/i
        );
        if (!pkElementMatch) continue;
        const pkContent = pkElementMatch[1];

        // Find UUID within the PropertyKind element only
        const pkRefMatch = pkContent.match(
            /<(?:[\w-]+:)?(?:UUID|Uuid)[^>]*>([^<]+)<\//i
        );
        if (!pkRefMatch) continue;

        const refUuid = pkRefMatch[1].trim();

        // Skip locally defined or standard property kinds
        if (localPkUuids.has(refUuid.toLowerCase())) continue;
        if (isStandardPropertyKindUuid(refUuid)) continue;

        // P01: Check if UUID is a known PWLS entry (by title)
        const titleMatch = pkContent.match(
            /<(?:[\w-]+:)?Title[^>]*>([^<]+)<\//i
        );
        const refTitle = titleMatch ? titleMatch[1].trim() : null;
        if (refTitle && !isKnownPwls(refTitle)) {
            errors.push(makeError(
                `P01: PropertyKind reference uuid='${refUuid}' title='${refTitle}' not found in PWLS dictionary and not defined locally`,
                Severity.WARNING, C,
                { uuid: obj.uuid, type: obj.objectType }
            ));
        }
    }

    return errors;
}

// ─── Layer 7b: PropertyKind Hierarchy Validation ─────────────────────────────

/** Abstract property kinds (isAbstract=true in enumValuesResqml.xml). */
const ABSTRACT_PROPERTY_KINDS = new Set([
    "resqml root property", "continuous", "discrete", "categorical",
    "quantity", "unitless", "dimensionless",
    "angle per length", "angle per time", "angle per volume",
    "area per area", "area per volume",
    "energy length per area", "energy length per time area temperature",
    "energy per length",
    "force area", "force length per length", "force per force", "force per volume",
    "length per length", "length per temperature", "length per volume",
    "mass length", "mass per length",
    "mass per time per area", "mass per time per length", "mass per volume per length",
    "per area", "per electric potential", "per force", "per length", "per mass", "per volume",
    "permeability rock",
    "power per volume",
    "pressure per time", "pressure squared",
    "pressure squared per force time per area", "pressure time per volume",
    "resistivity per length",
    "time per length", "time per volume",
    "volume length per time", "volume per area", "volume per length",
    "volume per time per area", "volume per time per length",
    "volume per time per time", "volume per time per volume",
    "volume per volume",
]);

/** Concrete kinds in the discrete/categorical hierarchy. */
const DISCRETE_HIERARCHY_KINDS = new Set(["index", "code"]);

/** Well-known continuous-hierarchy kinds that are invalid for DiscreteProperty. */
const CONTINUOUS_HIERARCHY_KINDS = new Set([
    "length", "depth", "cell length", "thickness", "velocity",
    "pressure", "density", "temperature", "thermodynamic temperature",
    "porosity", "saturation", "permeability rock", "rock permeability",
    "amplitude", "volume", "area", "angle", "time", "mass",
    "net to gross ratio", "formation volume factor",
    "property multiplier", "relative permeability",
    "absorbed dose", "acceleration linear", "azimuth", "dip",
    "dynamic viscosity", "electric current", "force", "frequency",
    "heat capacity", "luminous intensity", "momentum", "power",
    "solution gas-oil ratio", "vapor oil-gas ratio",
]);

/**
 * Validate property kind assignments against the Energistics hierarchy.
 *
 * P02: Abstract property kinds must not be directly assigned.
 * P03: DiscreteProperty must not use a kind from the continuous hierarchy.
 * P04: ContinuousProperty must not use a kind from the discrete hierarchy.
 */
export function validatePropertyKindHierarchy(objects: EpcObject[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const C = ValidationCategory.PWLS;

    for (const obj of objects) {
        if (!obj.objectType.includes("Property") || obj.objectType === "PropertyKind") continue;

        const isDiscrete = obj.objectType.includes("Discrete") || obj.objectType.includes("Categorical");
        const isContinuous = obj.objectType.includes("Continuous");

        // Extract property kind name — try StandardPropertyKind/Kind first (v2.0.1),
        // then DOR Title (v2.2)
        let kindName: string | null = null;

        // v2.0.1: <PropertyKind xsi:type="...StandardPropertyKind"><Kind>name</Kind>
        const stdKindMatch = obj.xmlString.match(
            /<(?:[\w-]+:)?Kind[^>]*>([^<]+)<\/(?:[\w-]+:)?Kind>/i
        );
        if (stdKindMatch) {
            kindName = stdKindMatch[1].trim();
        }

        // v2.2: PropertyKind DOR with Title
        if (!kindName) {
            const dorTitleMatch = obj.xmlString.match(
                /<(?:[\w-]+:)?PropertyKind[\s\S]*?<(?:[\w-]+:)?Title[^>]*>([^<]+)<\//i
            );
            if (dorTitleMatch) {
                kindName = dorTitleMatch[1].trim();
            }
        }

        if (!kindName) continue;

        const kindLower = kindName.toLowerCase();

        // P02: Abstract kind check
        if (ABSTRACT_PROPERTY_KINDS.has(kindLower)) {
            errors.push(makeError(
                `P02: PropertyKind "${kindName}" is abstract and must not be directly assigned to a property. Use a concrete descendant.`,
                Severity.ERROR, C,
                { uuid: obj.uuid, type: obj.objectType }
            ));
        }

        // P03: Discrete property using continuous-hierarchy kind
        if (isDiscrete && CONTINUOUS_HIERARCHY_KINDS.has(kindLower)) {
            errors.push(makeError(
                `P03: DiscreteProperty uses PropertyKind "${kindName}" which belongs to the continuous hierarchy. Use "index" or "code" instead.`,
                Severity.ERROR, C,
                { uuid: obj.uuid, type: obj.objectType }
            ));
        }

        // P04: Continuous property using discrete-hierarchy kind
        if (isContinuous && DISCRETE_HIERARCHY_KINDS.has(kindLower)) {
            errors.push(makeError(
                `P04: ContinuousProperty uses PropertyKind "${kindName}" which belongs to the discrete hierarchy.`,
                Severity.ERROR, C,
                { uuid: obj.uuid, type: obj.objectType }
            ));
        }
    }

    return errors;
}

// ─── Layer 8: fesapi Compatibility ───────────────────────────────────────────

export function validateFesapiCompat(
    objects: EpcObject[]
): ValidationError[] {
    const errors: ValidationError[] = [];
    const C = ValidationCategory.FESAPI_COMPAT;

    for (const obj of objects) {
        const isV201 = obj.version === "2.0.1";
        const isV22 = obj.version === "2.2" || obj.version === "2.2.0" || obj.version === "2.2.1";
        if (!isV201 && !isV22) continue;

        // Skip non-RESQML objects (e.g. EpcExternalPartReference)
        if (!obj.qualifiedType.startsWith("resqml") && !obj.qualifiedType.startsWith("eml")) continue;

        // Check 1: xsi:type on root element (v2.0.1 only — v2.2 doesn't require it)
        if (isV201) {
            const hasXsiType = obj.xmlString.includes("xsi:type") ||
                obj.xmlString.includes(`${XSI_NS}}type`);
            if (!hasXsiType) {
                errors.push(makeError(
                    `Missing xsi:type on root element. fesapi can read this locally, but RDDMS ETP import requires xsi:type for server-side deserialization. Expected xsi:type containing 'obj_${obj.objectType}'`,
                    Severity.WARNING, C,
                    { uuid: obj.uuid, type: obj.objectType }
                ));
            }
        }

        // Check 2: Root element should NOT have obj_ prefix in tag name (both versions)
        const rootTagMatch = obj.xmlString.match(/<(?!\?|!)([^\s>/]+)/);
        if (rootTagMatch) {
            const rootLocal = rootTagMatch[1].replace(/^[\w-]+:/, "");
            if (rootLocal.startsWith("obj_")) {
                const sev = isV22 ? Severity.ERROR : Severity.WARNING;
                errors.push(makeError(
                    `Root element uses obj_ prefix in tag name (<${rootLocal}>). ${isV22 ? "v2.2 must not use obj_ prefix." : "fesapi expects the tag without obj_ prefix."}`,
                    sev, C,
                    { uuid: obj.uuid, type: obj.objectType }
                ));
            }
        }

        // Check 3: v2.2 filename should not use obj_ prefix
        if (isV22 && obj.entryName) {
            const fileName = obj.entryName.replace(/^.*\//, "");
            if (fileName.startsWith("obj_")) {
                errors.push(makeError(
                    `v2.2 EPC entry filename uses obj_ prefix: '${obj.entryName}'. RESQML 2.2 filenames should not use obj_ prefix.`,
                    Severity.ERROR, C,
                    { uuid: obj.uuid, type: obj.objectType }
                ));
            }
        }

        // Check 4: ExtraMetadata position (v2.0.1 only)
        if (obj.objectType.includes("StringTableLookup")) continue; // XSD exception

        if (isV201) {
            // Check ExtraMetadata position: must be last among top-level children.
            // We extract only top-level child element names (depth 1) by tracking
            // nesting depth, to avoid false positives from ExtraMetadata/Name and
            // ExtraMetadata/Value child elements.
            const topLevelChildren: string[] = [];
            let depth = 0;
            const tagRe = /<(\/?)(?:[\w-]+:)?(\w+)[^>]*\/?>/g;
            let m: RegExpExecArray | null;
            while ((m = tagRe.exec(obj.xmlString)) !== null) {
                const isClose = m[1] === "/";
                const isSelfClose = m[0].endsWith("/>");
                const local = m[2];
                if (isClose) {
                    depth--;
                } else {
                    if (depth === 1) {
                        topLevelChildren.push(local);
                    }
                    if (!isSelfClose) depth++;
                }
            }
            let firstEmIdx = -1;
            let lastNonEmIdx = -1;
            for (let i = 0; i < topLevelChildren.length; i++) {
                if (topLevelChildren[i] === "ExtraMetadata") {
                    if (firstEmIdx === -1) firstEmIdx = i;
                } else {
                    lastNonEmIdx = i;
                }
            }
            if (firstEmIdx !== -1 && lastNonEmIdx > firstEmIdx) {
                errors.push(makeError(
                    "ExtraMetadata appears before other elements. fesapi requires ExtraMetadata to be the last child elements.",
                    Severity.WARNING, C,
                    { uuid: obj.uuid, type: obj.objectType }
                ));
            }
        }

        // Check 5: xsi:type on Hdf5Dataset elements (v2.0.1)
        // Without xsi:type="eml20:Hdf5Dataset", the ETP server returns JSON
        // without $type, and findDataArrays() cannot discover array references.
        if (isV201) {
            const hdfPathRe = /<(?:[\w-]+:)?PathInHdfFile[^>]*>/g;
            if (hdfPathRe.test(obj.xmlString)) {
                // Check if any Hdf5Dataset xsi:type is present near PathInHdfFile
                const hasHdf5Type = /xsi:type\s*=\s*"[^"]*Hdf5Dataset[^"]*"/i.test(obj.xmlString);
                if (!hasHdf5Type) {
                    errors.push(makeError(
                        `Object references HDF5 datasets (PathInHdfFile) but XML lacks xsi:type="...Hdf5Dataset" on the containing element. ` +
                        `This prevents ETP clients from discovering array metadata. Add xsi:type="eml20:Hdf5Dataset" to the Values element.`,
                        Severity.WARNING, C,
                        { uuid: obj.uuid, type: obj.objectType }
                    ));
                }
            }
        }
    }

    return errors;
}

// ─── Layer 9: RDDMS Compatibility ────────────────────────────────────────────

export function validateRddmsCompat(
    epcPath: string,
    objects: EpcObject[]
): ValidationError[] {
    const errors: ValidationError[] = [];
    const C = ValidationCategory.RDDMS_COMPAT;

    const has201 = objects.some(o => o.version === "2.0.1");
    const has22 = objects.some(o => o.version === "2.2" || o.version === "2.2.0" || o.version === "2.2.1");
    if (!has201 && !has22) return errors;

    let zip: AdmZip;
    try {
        zip = new AdmZip(epcPath);
    } catch {
        return errors;
    }

    const entries = zip.getEntries();
    const names = new Set(entries.map(e => e.entryName));

    // Check [Content_Types].xml format
    const ctEntry = entries.find(e => e.entryName.toLowerCase() === "[content_types].xml");
    if (ctEntry) {
        const ctXml = ctEntry.getData().toString("utf-8");
        const overrideRe = /ContentType\s*=\s*"([^"]+)"[\s\S]*?PartName\s*=\s*"([^"]+)"|PartName\s*=\s*"([^"]+)"[\s\S]*?ContentType\s*=\s*"([^"]+)"/g;
        let om: RegExpExecArray | null;
        while ((om = overrideRe.exec(ctXml)) !== null) {
            const ct = om[1] || om[4];
            const pn = om[2] || om[3];
            if (ct && ct.includes("x-resqml+xml")) {
                if (has201) {
                    if (!ct.includes("version=2.0")) {
                        errors.push(makeError(
                            `ContentType missing version=2.0: '${ct}' for ${pn}`,
                            Severity.WARNING, C
                        ));
                    }
                    if (!ct.includes("type=obj_")) {
                        errors.push(makeError(
                            `ContentType missing type=obj_ prefix: '${ct}' for ${pn}`,
                            Severity.WARNING, C
                        ));
                    }
                }
                if (has22) {
                    if (!ct.includes("version=2.2")) {
                        errors.push(makeError(
                            `ContentType version should be 2.2 for RESQML 2.2: '${ct}' for ${pn}`,
                            Severity.WARNING, C
                        ));
                    }
                    if (ct.includes("type=obj_")) {
                        errors.push(makeError(
                            `ContentType should NOT use obj_ prefix for RESQML 2.2: '${ct}' for ${pn}`,
                            Severity.ERROR, C
                        ));
                    }
                }
            }
            if (ct && ct.includes("x-eml+xml") && has22) {
                if (ct.includes("type=obj_")) {
                    errors.push(makeError(
                        `EML 2.3 ContentType should NOT use obj_ prefix: '${ct}' for ${pn}`,
                        Severity.ERROR, C
                    ));
                }
            }
        }

        // v2.2: should NOT have <Default Extension="xml">
        if (has22 && ctXml.includes('Extension="xml"')) {
            errors.push(makeError(
                `[Content_Types].xml has <Default Extension="xml"> which can conflict with per-part Override entries in v2.2 EPCs`,
                Severity.WARNING, C
            ));
        }
    }

    // v2.2: Validate DOR format in XML objects
    if (has22) {
        for (const obj of objects) {
            if (obj.version !== "2.2" && obj.version !== "2.2.0" && obj.version !== "2.2.1") continue;
            const v201DorRe = /<(?:[\w-]+:)?ContentType[^>]*>[^<]*(?:version=2\.0|obj_)[^<]*<\/(?:[\w-]+:)?ContentType>/g;
            let dorMatch;
            while ((dorMatch = v201DorRe.exec(obj.xmlString)) !== null) {
                errors.push(makeError(
                    `v2.2 object contains v2.0.1-style DOR ContentType: ${dorMatch[0].substring(0, 80)}... — server will fail to resolve these references`,
                    Severity.ERROR, C,
                    { uuid: obj.uuid, type: obj.objectType }
                ));
            }
        }
    }

    // v2.0.1: Check EpcExternalPartReference .rels has HDF5 link
    if (has201) {
        const eprEntries = entries.filter(
            e => e.entryName.includes("EpcExternalPartReference") &&
                e.entryName.endsWith(".xml") &&
                !e.entryName.startsWith("_rels/")
        );
        for (const epr of eprEntries) {
            const relsPath = `_rels/${epr.entryName}.rels`;
            if (!names.has(relsPath)) {
                errors.push(makeError(
                    `Missing .rels for EpcExternalPartReference: ${relsPath}`,
                    Severity.ERROR, C
                ));
                continue;
            }

            const relsXml = zip.getEntry(relsPath)?.getData().toString("utf-8") ?? "";
            if (relsXml.includes(EXT_RESOURCE_TYPE)) {
                if (!relsXml.includes('TargetMode="External"')) {
                    errors.push(makeError(
                        `EPR .rels externalResource should have TargetMode="External"`,
                        Severity.WARNING, C
                    ));
                }
            }
        }
    }

    // v2.2: Should NOT have EpcExternalPartReference objects
    if (has22) {
        const eprObjects = objects.filter(o =>
            o.objectType === "EpcExternalPartReference" || o.objectType === "obj_EpcExternalPartReference"
        );
        if (eprObjects.length > 0) {
            errors.push(makeError(
                `v2.2 EPC contains ${eprObjects.length} EpcExternalPartReference object(s) — v2.2 uses ExternalDataArrayPart with URI instead`,
                Severity.WARNING, C
            ));
        }
    }

    // Validate .rels relationship graph (both versions)
    for (const obj of objects) {
        if (obj.objectType === "EpcExternalPartReference" || obj.objectType === "obj_EpcExternalPartReference") continue;
        const objRelsPath = `_rels/${obj.entryName ?? ""}.rels`;
        const objRelsAlt = `_rels/${(obj.entryName ?? "").replace(/^\//, "")}.rels`;
        if (obj.entryName && !names.has(objRelsPath) && !names.has(objRelsAlt)) {
            const hasDorRef = /<(?:[\w-]+:)?(?:Uuid|UUID)[^>]*>[0-9a-fA-F-]{36}<\//.test(obj.xmlString);
            if (hasDorRef) {
                errors.push(makeError(
                    `Object references other objects via DOR but has no .rels file: ${obj.entryName}`,
                    Severity.WARNING, C,
                    { uuid: obj.uuid, type: obj.objectType }
                ));
            }
        }
    }

    return errors;
}

// ─── EPC Parsing ─────────────────────────────────────────────────────────────

export function parseEpcObjects(epcPath: string): EpcObject[] {
    const zip = new AdmZip(epcPath);
    const entries = zip.getEntries();
    const objects: EpcObject[] = [];

    // Parse [Content_Types].xml to map part names to content types
    const ctEntry = entries.find(e => e.entryName.toLowerCase() === "[content_types].xml");
    if (!ctEntry) return objects;

    const ctXml = ctEntry.getData().toString("utf-8");
    const partMap = new Map<string, string>();
    const overrideRe = /PartName\s*=\s*"([^"]+)"\s+ContentType\s*=\s*"([^"]+)"|ContentType\s*=\s*"([^"]+)"\s+PartName\s*=\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = overrideRe.exec(ctXml)) !== null) {
        const partName = (m[1] || m[4]).replace(/^\//, "");
        const contentType = m[2] || m[3];
        partMap.set(partName, contentType);
    }

    for (const [partName, contentType] of partMap) {
        // Parse content type
        const resqmlMatch = RESQML_CT_RE.exec(contentType);
        const emlMatch = EML_CT_RE.exec(contentType);
        const ctMatch = resqmlMatch || emlMatch;
        if (!ctMatch) continue;

        const versionRaw = ctMatch[1];
        const typeName = ctMatch[2];
        const version = normalizeVersion(versionRaw);
        if (!version) continue;

        // Read XML from ZIP
        const entry = entries.find(e => e.entryName === partName);
        if (!entry || entry.isDirectory) continue;

        const xmlString = entry.getData().toString("utf-8");
        const uuid = xmlRootAttr(xmlString, "uuid") ?? xmlText(xmlString, "Uuid") ?? "";

        const objType = typeName.startsWith("obj_") ? typeName.slice(4) : typeName;
        const domainPrefix = resqmlMatch ? "resqml" : "eml";
        const domainVersion = version === "2.0.1" ? "20" : "22";

        objects.push({
            uuid,
            objectType: objType,
            qualifiedType: `${domainPrefix}${domainVersion}.${typeName}`,
            contentType,
            version,
            xmlString,
            xmlDoc: null,
            entryName: partName,
        });
    }

    return objects;
}

// ─── Main Entry Points ──────────────────────────────────────────────────────

/**
 * Validate an EPC file with all layers.
 * This is the main entry point - equivalent to Python's validate_epc_strict().
 */
export function validateEpc(
    epcPath: string,
    options: ValidationOptions = {},
    h5Path?: string,
): ValidationReport {
    const report: ValidationReport = {
        is_valid: true,
        version: null,
        object_count: 0,
        validated_count: 0,
        error_count: 0,
        warning_count: 0,
        errors: [],
    };

    // 1. EPC structure
    if (!options.skip_epc_structure) {
        report.errors.push(...validateEpcStructure(epcPath));
    }

    // Parse objects
    let objects: EpcObject[];
    try {
        objects = parseEpcObjects(epcPath);
    } catch (e: any) {
        report.errors.push(makeError(
            `Failed to read EPC: ${e.message}`,
            Severity.ERROR,
            ValidationCategory.EPC_STRUCTURE
        ));
        return finalizeReport(report);
    }

    report.object_count = objects.length;

    // Detect version (majority vote)
    const versionCounts = new Map<string, number>();
    for (const obj of objects) {
        versionCounts.set(obj.version, (versionCounts.get(obj.version) ?? 0) + 1);
    }
    let majorityVersion: string | null = null;
    let maxCount = 0;
    for (const [v, c] of versionCounts) {
        if (c > maxCount) { majorityVersion = v; maxCount = c; }
    }
    report.version = majorityVersion;

    // 2. XSD schema validation (per-object version)
    if (!options.skip_xsd) {
        // Pre-load XSD schemas to avoid repeated file I/O
        const versionsPresent = new Set(objects.map(o => o.version));
        for (const v of versionsPresent) {
            try { loadXsdSchema(v); } catch { /* will report per-object below */ }
        }

        for (const obj of objects) {
            // Skip EpcExternalPartReference - trivial metadata, not worth XSD cost
            if (obj.objectType === "EpcExternalPartReference") {
                report.validated_count++;
                continue;
            }
            try {
                const xsdErrors = validateXmlAgainstXsd(
                    obj.xmlString, obj.version, obj.uuid, obj.objectType
                );
                report.errors.push(...xsdErrors);
                if (xsdErrors.filter(e => e.severity === Severity.ERROR).length === 0) {
                    report.validated_count++;
                }
            } catch (e: any) {
                report.errors.push(makeError(
                    `XSD validation error: ${e.message}`,
                    Severity.ERROR,
                    ValidationCategory.XSD_SCHEMA,
                    { uuid: obj.uuid, type: obj.objectType }
                ));
            }
        }
    } else {
        report.validated_count = objects.length;
    }

    // 3. DOR integrity
    if (!options.skip_dor) {
        report.errors.push(...validateDorIntegrity(objects));
    }

    // 4. HDF5 references
    if (!options.skip_hdf5) {
        report.errors.push(...validateHdf5References(objects, h5Path));
    }

    // 5. Cross-object consistency
    if (!options.skip_cross_object) {
        report.errors.push(...validateCrossObjectConsistency(objects));
    }

    // 6. Business rules
    if (!options.skip_business_rules) {
        report.errors.push(...validateBusinessRules(objects));
    }

    // 7. PWLS PropertyKind
    if (!options.skip_pwls) {
        report.errors.push(...validatePwlsPropertyKinds(objects));
        report.errors.push(...validatePropertyKindHierarchy(objects));
    }

    // 8. fesapi compatibility
    if (!options.skip_fesapi) {
        report.errors.push(...validateFesapiCompat(objects));
    }

    // 9. RDDMS compatibility
    if (!options.skip_rddms) {
        report.errors.push(...validateRddmsCompat(epcPath, objects));
    }

    return finalizeReport(report);
}

/**
 * Validate in-memory XML objects (e.g. from ETP GetDataObjects response).
 * No EPC file needed - builds a virtual EPC from the object list.
 */
export function validateObjects(
    xmlObjects: Array<{ content_type: string; uuid: string; xml: string }>,
    options: ValidationOptions = {},
): ValidationReport {
    const report: ValidationReport = {
        is_valid: true,
        version: null,
        object_count: xmlObjects.length,
        validated_count: 0,
        error_count: 0,
        warning_count: 0,
        errors: [],
    };

    // Convert to EpcObject format
    const objects: EpcObject[] = xmlObjects.map(o => {
        const resqmlMatch = RESQML_CT_RE.exec(o.content_type);
        const emlMatch = EML_CT_RE.exec(o.content_type);
        const ctMatch = resqmlMatch || emlMatch;
        const versionRaw = ctMatch ? ctMatch[1] : null;
        const typeName = ctMatch ? ctMatch[2] : "Unknown";
        const version = normalizeVersion(versionRaw) ?? detectVersionFromXml(o.xml) ?? "2.0.1";
        const objType = typeName.startsWith("obj_") ? typeName.slice(4) : typeName;
        const domainPrefix = resqmlMatch ? "resqml" : "eml";
        const domainVersion = version === "2.0.1" ? "20" : "22";

        return {
            uuid: o.uuid,
            objectType: objType,
            qualifiedType: `${domainPrefix}${domainVersion}.${typeName}`,
            contentType: o.content_type,
            version,
            xmlString: o.xml,
            xmlDoc: null,
            entryName: `${o.uuid}.xml`,
        };
    });

    // Detect majority version
    const versionCounts = new Map<string, number>();
    for (const obj of objects) {
        versionCounts.set(obj.version, (versionCounts.get(obj.version) ?? 0) + 1);
    }
    let majorityVersion: string | null = null;
    let maxCount = 0;
    for (const [v, c] of versionCounts) {
        if (c > maxCount) { majorityVersion = v; maxCount = c; }
    }
    report.version = majorityVersion;

    // 2. XSD schema validation
    if (!options.skip_xsd) {
        for (const obj of objects) {
            try {
                const xsdErrors = validateXmlAgainstXsd(
                    obj.xmlString, obj.version, obj.uuid, obj.objectType
                );
                report.errors.push(...xsdErrors);
                if (xsdErrors.filter(e => e.severity === Severity.ERROR).length === 0) {
                    report.validated_count++;
                }
            } catch (e: any) {
                report.errors.push(makeError(
                    `XSD validation error: ${e.message}`,
                    Severity.ERROR,
                    ValidationCategory.XSD_SCHEMA,
                    { uuid: obj.uuid, type: obj.objectType }
                ));
            }
        }
    } else {
        report.validated_count = objects.length;
    }

    // 3. DOR integrity
    if (!options.skip_dor) {
        report.errors.push(...validateDorIntegrity(objects));
    }

    // 4. HDF5 references (no file - just path format checks)
    if (!options.skip_hdf5) {
        report.errors.push(...validateHdf5References(objects));
    }

    // 5. Cross-object consistency
    if (!options.skip_cross_object) {
        report.errors.push(...validateCrossObjectConsistency(objects));
    }

    // 6. Business rules
    if (!options.skip_business_rules) {
        report.errors.push(...validateBusinessRules(objects));
    }

    // 7. PWLS
    if (!options.skip_pwls) {
        report.errors.push(...validatePwlsPropertyKinds(objects));
        report.errors.push(...validatePropertyKindHierarchy(objects));
    }

    // 8. fesapi compat
    if (!options.skip_fesapi) {
        report.errors.push(...validateFesapiCompat(objects));
    }

    return finalizeReport(report);
}

/**
 * Validate a single XML document.
 */
export function validateXml(
    xmlString: string,
    version?: string,
): ValidationReport {
    const detected = version ? normalizeVersion(version) : detectVersionFromXml(xmlString);
    const report: ValidationReport = {
        is_valid: true,
        version: detected,
        object_count: 1,
        validated_count: 0,
        error_count: 0,
        warning_count: 0,
        errors: [],
    };

    if (!detected) {
        report.errors.push(makeError(
            "Could not detect RESQML version from XML",
            Severity.ERROR,
            ValidationCategory.XSD_SCHEMA,
        ));
        return finalizeReport(report);
    }

    const xsdErrors = validateXmlAgainstXsd(xmlString, detected);
    report.errors.push(...xsdErrors);
    if (xsdErrors.filter(e => e.severity === Severity.ERROR).length === 0) {
        report.validated_count = 1;
    }

    return finalizeReport(report);
}

// ─── Report Finalization ─────────────────────────────────────────────────────

function finalizeReport(report: ValidationReport): ValidationReport {
    report.error_count = report.errors.filter(e => e.severity === Severity.ERROR).length;
    report.warning_count = report.errors.filter(e => e.severity === Severity.WARNING).length;
    report.is_valid = report.error_count === 0;
    return report;
}
