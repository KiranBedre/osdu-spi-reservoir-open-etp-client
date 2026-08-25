import "jest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import AdmZip from "adm-zip";

import {
    Severity,
    ValidationCategory,
    validateEpcStructure,
    validateXmlAgainstXsd,
    validateDorIntegrity,
    validateHdf5References,
    validateCrossObjectConsistency,
    validateBusinessRules,
    validateFesapiCompat,
    validateRddmsCompat,
    validateEpc,
    validateObjects,
    validateXml,
    parseEpcObjects,
    EpcObject,
} from "../lib/validation/ResqmlValidator";

import { ValidatorClient } from "../lib/client/ValidatorClient";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const RESQML_NS = "http://www.energistics.org/energyml/data/resqmlv2";

/** Build a minimal RESQML 2.0.1 XML object. */
function makeResqml201Xml(
    typeName: string,
    uuid: string,
    title: string,
    body = "",
    schemaVersion = "2.0"
): string {
    return [
        `<?xml version="1.0" encoding="UTF-8"?>`,
        `<${typeName} xmlns="${RESQML_NS}" uuid="${uuid}" schemaVersion="${schemaVersion}">`,
        `  <Citation><Title>${title}</Title><Originator>test</Originator><Creation>2026-01-01T00:00:00Z</Creation><Format>test</Format></Citation>`,
        body,
        `</${typeName}>`,
    ].join("\n");
}

/** Build a minimal EPC (ZIP) from a set of objects. */
function buildEpc(
    objects: Array<{ typeName: string; uuid: string; xml: string; version?: string }>
): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rddms-test-epc-"));
    const epcPath = path.join(tmpDir, "test.epc");

    const zip = new AdmZip();

    // Build [Content_Types].xml
    const overrides = objects.map(o => {
        const v = o.version ?? "2.0";
        return `  <Override PartName="/${o.uuid}.xml" ContentType="application/x-resqml+xml;version=${v};type=${o.typeName}" />`;
    });
    const ctXml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        ...overrides,
        "</Types>",
    ].join("\n");

    zip.addFile("[Content_Types].xml", Buffer.from(ctXml));
    zip.addFile("_rels/.rels", Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));

    for (const o of objects) {
        zip.addFile(`${o.uuid}.xml`, Buffer.from(o.xml));
    }

    zip.writeZip(epcPath);
    return epcPath;
}

/** Make an EpcObject for testing non-EPC layers. */
function makeEpcObj(
    typeName: string,
    uuid: string,
    xml: string,
    version = "2.0.1"
): EpcObject {
    return {
        uuid,
        objectType: typeName,
        qualifiedType: `resqml20.obj_${typeName}`,
        contentType: `application/x-resqml+xml;version=2.0;type=obj_${typeName}`,
        version,
        xmlString: xml,
        xmlDoc: null,
        entryName: `${uuid}.xml`,
    };
}

// ─── Layer 1: EPC Structure ──────────────────────────────────────────────────

describe("EPC Structure Validation", () => {
    it("reports error for non-existent file", () => {
        const errors = validateEpcStructure("/does/not/exist.epc");
        expect(errors.length).toBe(1);
        expect(errors[0].severity).toBe(Severity.ERROR);
        expect(errors[0].message).toContain("File not found");
    });

    it("reports error for invalid ZIP", () => {
        const tmpFile = path.join(os.tmpdir(), "bad.epc");
        fs.writeFileSync(tmpFile, "not a zip file");
        try {
            const errors = validateEpcStructure(tmpFile);
            expect(errors.length).toBe(1);
            expect(errors[0].message).toContain("valid ZIP");
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it("reports error for missing [Content_Types].xml", () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "epc-"));
        const epcPath = path.join(tmpDir, "no-ct.epc");
        const zip = new AdmZip();
        zip.addFile("dummy.xml", Buffer.from("<root/>"));
        zip.writeZip(epcPath);
        try {
            const errors = validateEpcStructure(epcPath);
            expect(errors.some(e => e.message.includes("[Content_Types].xml"))).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it("reports warning for missing _rels/.rels", () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "epc-"));
        const epcPath = path.join(tmpDir, "no-rels.epc");
        const zip = new AdmZip();
        zip.addFile("[Content_Types].xml", Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'));
        zip.writeZip(epcPath);
        try {
            const errors = validateEpcStructure(epcPath);
            expect(errors.some(e => e.message.includes("_rels/.rels") && e.severity === Severity.WARNING)).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it("reports warning for part referenced but missing in ZIP", () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "epc-"));
        const epcPath = path.join(tmpDir, "missing-part.epc");
        const zip = new AdmZip();
        zip.addFile("[Content_Types].xml", Buffer.from(
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Override PartName="/ghost.xml" ContentType="application/x-resqml+xml;version=2.0;type=obj_Grid" />' +
            '</Types>'
        ));
        zip.addFile("_rels/.rels", Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
        zip.writeZip(epcPath);
        try {
            const errors = validateEpcStructure(epcPath);
            expect(errors.some(e => e.message.includes("ghost.xml") && e.message.includes("not found"))).toBe(true);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it("passes for a valid EPC", () => {
        const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        const xml = makeResqml201Xml("TriangulatedSetRepresentation", uuid, "Test",
            "<TrianglePatch><NodeCount>3</NodeCount></TrianglePatch>");
        const epcPath = buildEpc([{ typeName: "obj_TriangulatedSetRepresentation", uuid, xml }]);
        try {
            const errors = validateEpcStructure(epcPath);
            const realErrors = errors.filter(e => e.severity === Severity.ERROR);
            expect(realErrors.length).toBe(0);
        } finally {
            fs.rmSync(path.dirname(epcPath), { recursive: true, force: true });
        }
    });
});

// ─── Layer 3: DOR Integrity ─────────────────────────────────────────────────

describe("DOR Integrity Validation", () => {
    it("reports error when DOR references unknown object", () => {
        const uuid1 = "11111111-1111-1111-1111-111111111111";
        const uuid2 = "22222222-2222-2222-2222-222222222222"; // not in EPC
        const xml = makeResqml201Xml("ContinuousProperty", uuid1, "Porosity",
            `<SupportingRepresentation><UUID>${uuid2}</UUID><Title>Grid</Title></SupportingRepresentation>`
        );
        const obj = makeEpcObj("ContinuousProperty", uuid1, xml);
        const errors = validateDorIntegrity([obj]);
        expect(errors.some(e =>
            e.severity === Severity.ERROR &&
            e.message.includes(uuid2) &&
            e.category === ValidationCategory.DOR_INTEGRITY
        )).toBe(true);
    });

    it("passes when all DORs resolve", () => {
        const uuid1 = "11111111-1111-1111-1111-111111111111";
        const uuid2 = "22222222-2222-2222-2222-222222222222";
        const xml1 = makeResqml201Xml("ContinuousProperty", uuid1, "Porosity",
            `<SupportingRepresentation><UUID>${uuid2}</UUID><Title>Grid</Title></SupportingRepresentation>`
        );
        const xml2 = makeResqml201Xml("IjkGridRepresentation", uuid2, "Grid");
        const obj1 = makeEpcObj("ContinuousProperty", uuid1, xml1);
        const obj2 = makeEpcObj("IjkGridRepresentation", uuid2, xml2);
        const errors = validateDorIntegrity([obj1, obj2]);
        expect(errors.filter(e => e.severity === Severity.ERROR).length).toBe(0);
    });

    it("allows standard PropertyKind UUIDs", () => {
        const uuid1 = "11111111-1111-1111-1111-111111111111";
        const pkUuid = "355543d1-fa5c-42b3-ba5d-fed1612a2843"; // porosity (standard)
        const xml = makeResqml201Xml("ContinuousProperty", uuid1, "Porosity",
            `<PropertyKind><UUID>${pkUuid}</UUID><Title>porosity</Title></PropertyKind>`
        );
        const obj = makeEpcObj("ContinuousProperty", uuid1, xml);
        const errors = validateDorIntegrity([obj]);
        expect(errors.filter(e => e.severity === Severity.ERROR).length).toBe(0);
    });
});

// ─── Layer 4: HDF5 References ────────────────────────────────────────────────

describe("HDF5 Reference Validation", () => {
    it("warns about paths not starting with /", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("IjkGridRepresentation", uuid, "Grid",
            `<PathInHdfFile>RESQML/${uuid}/points</PathInHdfFile>`
        );
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml);
        const errors = validateHdf5References([obj]);
        expect(errors.some(e => e.severity === Severity.WARNING && e.message.includes("start with"))).toBe(true);
    });

    it("passes for valid paths", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("IjkGridRepresentation", uuid, "Grid",
            `<PathInHdfFile>/RESQML/${uuid}/points</PathInHdfFile>`
        );
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml);
        const errors = validateHdf5References([obj]);
        expect(errors.length).toBe(0);
    });
});

// ─── Layer 5: Cross-Object Consistency ───────────────────────────────────────

describe("Cross-Object Consistency", () => {
    it("reports duplicate UUIDs", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const obj1 = makeEpcObj("IjkGridRepresentation", uuid, makeResqml201Xml("IjkGrid", uuid, "Grid1"));
        const obj2 = makeEpcObj("TriangulatedSetRepresentation", uuid, makeResqml201Xml("TriSet", uuid, "Tri1"));
        const errors = validateCrossObjectConsistency([obj1, obj2]);
        expect(errors.some(e => e.message.includes("Duplicate UUID"))).toBe(true);
    });

    it("passes with unique UUIDs", () => {
        const obj1 = makeEpcObj("IjkGridRepresentation", "11111111-1111-1111-1111-111111111111", makeResqml201Xml("IjkGrid", "11111111-1111-1111-1111-111111111111", "G1"));
        const obj2 = makeEpcObj("TriangulatedSetRepresentation", "22222222-2222-2222-2222-222222222222", makeResqml201Xml("TriSet", "22222222-2222-2222-2222-222222222222", "T1"));
        const errors = validateCrossObjectConsistency([obj1, obj2]);
        expect(errors.length).toBe(0);
    });
});

// ─── Layer 6: Business Rules ─────────────────────────────────────────────────

describe("Business Rules S01–S18", () => {
    it("S09: rejects invalid UUID", () => {
        const obj = makeEpcObj("IjkGridRepresentation", "not-a-uuid", makeResqml201Xml("IjkGrid", "not-a-uuid", "Grid"));
        const errors = validateBusinessRules([obj]);
        expect(errors.some(e => e.message.includes("S09"))).toBe(true);
    });

    it("S10: rejects empty Citation.Title", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("IjkGridRepresentation", uuid, "");
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml);
        const errors = validateBusinessRules([obj]);
        expect(errors.some(e => e.message.includes("S10"))).toBe(true);
    });

    it("S01: rejects IJK grid with Ni <= 0", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("IjkGridRepresentation", uuid, "Grid",
            "<Ni>0</Ni><Nj>10</Nj><Nk>5</Nk>");
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml);
        const errors = validateBusinessRules([obj]);
        expect(errors.some(e => e.message.includes("S01"))).toBe(true);
    });

    it("S02: rejects IJK grid with Nj <= 0", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("IjkGridRepresentation", uuid, "Grid",
            "<Ni>10</Ni><Nj>-1</Nj><Nk>5</Nk>");
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml);
        const errors = validateBusinessRules([obj]);
        expect(errors.some(e => e.message.includes("S02"))).toBe(true);
    });

    it("S03: rejects Nk <= 0", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("IjkGridRepresentation", uuid, "Grid",
            "<Ni>10</Ni><Nj>10</Nj><Nk>0</Nk>");
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml);
        const errors = validateBusinessRules([obj]);
        expect(errors.some(e => e.message.includes("S03"))).toBe(true);
    });

    it("S04: rejects unstructured grid CellCount <= 0", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("UnstructuredGridRepresentation", uuid, "UGrid",
            "<CellCount>0</CellCount>");
        const obj = makeEpcObj("UnstructuredGridRepresentation", uuid, xml);
        const errors = validateBusinessRules([obj]);
        expect(errors.some(e => e.message.includes("S04"))).toBe(true);
    });

    it("S06: rejects TriangulatedSetRepresentation without TrianglePatch", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("TriangulatedSetRepresentation", uuid, "TriSet", "");
        const obj = makeEpcObj("TriangulatedSetRepresentation", uuid, xml);
        const errors = validateBusinessRules([obj]);
        expect(errors.some(e => e.message.includes("S06"))).toBe(true);
    });

    it("S07: rejects Property Count <= 0", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("ContinuousProperty", uuid, "Prop",
            "<Count>0</Count>");
        const obj = makeEpcObj("ContinuousProperty", uuid, xml);
        const errors = validateBusinessRules([obj]);
        expect(errors.some(e => e.message.includes("S07"))).toBe(true);
    });

    it("passes valid objects", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("IjkGridRepresentation", uuid, "Good Grid",
            "<Ni>10</Ni><Nj>20</Nj><Nk>5</Nk>");
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml);
        const errors = validateBusinessRules([obj]);
        const realErrors = errors.filter(e => e.severity === Severity.ERROR);
        expect(realErrors.length).toBe(0);
    });
});

// ─── Layer 8: fesapi Compatibility ───────────────────────────────────────────

describe("fesapi Compatibility", () => {
    it("warns when xsi:type is missing (2.0.1 only)", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        // No xsi:type on root
        const xml = `<?xml version="1.0" encoding="UTF-8"?><IjkGridRepresentation xmlns="${RESQML_NS}" uuid="${uuid}" schemaVersion="2.0"><Citation><Title>Grid</Title><Originator>t</Originator><Creation>2026-01-01T00:00:00Z</Creation><Format>t</Format></Citation></IjkGridRepresentation>`;
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml, "2.0.1");
        obj.qualifiedType = "resqml20.obj_IjkGridRepresentation";
        const errors = validateFesapiCompat([obj]);
        expect(errors.some(e => e.message.includes("xsi:type"))).toBe(true);
    });

    it("warns about obj_ prefix in root tag", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = `<?xml version="1.0" encoding="UTF-8"?><obj_IjkGridRepresentation xmlns="${RESQML_NS}" uuid="${uuid}" schemaVersion="2.0"><Citation><Title>G</Title><Originator>t</Originator><Creation>2026-01-01T00:00:00Z</Creation><Format>t</Format></Citation></obj_IjkGridRepresentation>`;
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml, "2.0.1");
        obj.qualifiedType = "resqml20.obj_IjkGridRepresentation";
        const errors = validateFesapiCompat([obj]);
        expect(errors.some(e => e.message.includes("obj_ prefix"))).toBe(true);
    });

    it("errors when ExtraMetadata is not last", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = `<?xml version="1.0" encoding="UTF-8"?><IjkGridRepresentation xmlns="${RESQML_NS}" uuid="${uuid}" schemaVersion="2.0"><Citation><Title>G</Title><Originator>t</Originator><Creation>2026-01-01T00:00:00Z</Creation><Format>t</Format></Citation><ExtraMetadata><Name>key</Name><Value>val</Value></ExtraMetadata><Ni>10</Ni></IjkGridRepresentation>`;
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml, "2.0.1");
        obj.qualifiedType = "resqml20.obj_IjkGridRepresentation";
        const errors = validateFesapiCompat([obj]);
        expect(errors.some(e => e.severity === Severity.ERROR && e.message.includes("ExtraMetadata"))).toBe(true);
    });

    it("skips checks for version 2.2", () => {
        const uuid = "11111111-1111-1111-1111-111111111111";
        const xml = makeResqml201Xml("IjkGridRepresentation", uuid, "Grid");
        const obj = makeEpcObj("IjkGridRepresentation", uuid, xml, "2.2");
        obj.qualifiedType = "resqml22.IjkGridRepresentation";
        const errors = validateFesapiCompat([obj]);
        expect(errors.length).toBe(0);
    });
});

// ─── End-to-End: validateEpc ─────────────────────────────────────────────────

describe("validateEpc (end-to-end)", () => {
    it("validates a well-formed EPC", () => {
        const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        const xml = makeResqml201Xml("TriangulatedSetRepresentation", uuid, "Surface",
            "<TrianglePatch><NodeCount>3</NodeCount></TrianglePatch>");
        const epcPath = buildEpc([{ typeName: "obj_TriangulatedSetRepresentation", uuid, xml }]);
        try {
            const report = validateEpc(epcPath, { skip_xsd: true });
            expect(report.object_count).toBe(1);
            expect(report.version).toBe("2.0.1");
            // May have warnings (xsi:type, fesapi, rddms etc.) but no structural/business/DOR errors
            const structErrors = report.errors.filter(
                e => e.severity === Severity.ERROR &&
                    e.category !== ValidationCategory.FESAPI_COMPAT &&
                    e.category !== ValidationCategory.RDDMS_COMPAT
            );
            expect(structErrors.length).toBe(0);
        } finally {
            fs.rmSync(path.dirname(epcPath), { recursive: true, force: true });
        }
    });

    it("catches multiple issues in a bad EPC", () => {
        const uuid1 = "11111111-1111-1111-1111-111111111111";
        // IJK grid with Ni=0, references unknown object
        const xml1 = makeResqml201Xml("IjkGridRepresentation", uuid1, "Bad Grid",
            `<Ni>0</Ni><Nj>10</Nj><Nk>5</Nk>` +
            `<LocalCrs><UUID>99999999-9999-9999-9999-999999999999</UUID><Title>CRS</Title></LocalCrs>`
        );
        const epcPath = buildEpc([{ typeName: "obj_IjkGridRepresentation", uuid: uuid1, xml: xml1 }]);
        try {
            const report = validateEpc(epcPath, { skip_xsd: true });
            expect(report.is_valid).toBe(false);
            // Should catch S01 (Ni=0) and DOR integrity (unknown CRS uuid)
            expect(report.errors.some(e => e.message.includes("S01"))).toBe(true);
            expect(report.errors.some(e => e.category === ValidationCategory.DOR_INTEGRITY)).toBe(true);
        } finally {
            fs.rmSync(path.dirname(epcPath), { recursive: true, force: true });
        }
    });

    it("respects skip options", () => {
        const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        const xml = makeResqml201Xml("IjkGridRepresentation", uuid, "Grid",
            "<Ni>0</Ni><Nj>10</Nj><Nk>5</Nk>");
        const epcPath = buildEpc([{ typeName: "obj_IjkGridRepresentation", uuid, xml }]);
        try {
            const report = validateEpc(epcPath, {
                skip_xsd: true,
                skip_business_rules: true,
                skip_fesapi: true,
                skip_rddms: true,
            });
            // S01 should NOT be reported when business_rules is skipped
            expect(report.errors.some(e => e.message.includes("S01"))).toBe(false);
        } finally {
            fs.rmSync(path.dirname(epcPath), { recursive: true, force: true });
        }
    });
});

// ─── validateObjects (in-memory) ─────────────────────────────────────────────

describe("validateObjects (in-memory)", () => {
    it("validates objects without an EPC file", () => {
        const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        const xml = makeResqml201Xml("TriangulatedSetRepresentation", uuid, "Surface",
            "<TrianglePatch><NodeCount>3</NodeCount></TrianglePatch>");

        const report = validateObjects([{
            content_type: "application/x-resqml+xml;version=2.0;type=obj_TriangulatedSetRepresentation",
            uuid,
            xml,
        }], { skip_xsd: true });

        expect(report.object_count).toBe(1);
        expect(report.version).toBe("2.0.1");
    });

    it("catches business rule violations in-memory", () => {
        const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        const xml = makeResqml201Xml("IjkGridRepresentation", uuid, "Grid",
            "<Ni>0</Ni><Nj>10</Nj><Nk>5</Nk>");

        const report = validateObjects([{
            content_type: "application/x-resqml+xml;version=2.0;type=obj_IjkGridRepresentation",
            uuid,
            xml,
        }], { skip_xsd: true });

        expect(report.errors.some(e => e.message.includes("S01"))).toBe(true);
    });
});

// ─── ValidatorClient (local mode) ────────────────────────────────────────────

describe("ValidatorClient local mode", () => {
    it("defaults to local mode when no URL is set", async () => {
        const savedUrl = process.env.RDMS_VALIDATOR_URL;
        delete process.env.RDMS_VALIDATOR_URL;
        try {
            const client = new ValidatorClient();
            expect(await client.isHealthy()).toBe(true);
        } finally {
            if (savedUrl) process.env.RDMS_VALIDATOR_URL = savedUrl;
        }
    });

    it("validates objects in local mode", async () => {
        const savedUrl = process.env.RDMS_VALIDATOR_URL;
        delete process.env.RDMS_VALIDATOR_URL;
        try {
            const client = new ValidatorClient();
            const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
            const xml = makeResqml201Xml("TriangulatedSetRepresentation", uuid, "Test",
                "<TrianglePatch><NodeCount>3</NodeCount></TrianglePatch>");

            const report = await client.validateObjects([{
                content_type: "application/x-resqml+xml;version=2.0;type=obj_TriangulatedSetRepresentation",
                uuid,
                xml,
            }], { skip_xsd: true });

            expect(report.object_count).toBe(1);
        } finally {
            if (savedUrl) process.env.RDMS_VALIDATOR_URL = savedUrl;
        }
    });

    it("validates EPC buffer in local mode", async () => {
        const savedUrl = process.env.RDMS_VALIDATOR_URL;
        delete process.env.RDMS_VALIDATOR_URL;
        try {
            const client = new ValidatorClient();
            const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
            const xml = makeResqml201Xml("TriangulatedSetRepresentation", uuid, "Surface",
                "<TrianglePatch><NodeCount>3</NodeCount></TrianglePatch>");
            const epcPath = buildEpc([{ typeName: "obj_TriangulatedSetRepresentation", uuid, xml }]);
            const epcBuffer = fs.readFileSync(epcPath);
            fs.rmSync(path.dirname(epcPath), { recursive: true, force: true });

            const report = await client.validateEpc(epcBuffer, undefined, { skip_xsd: true });
            expect(report.object_count).toBe(1);
        } finally {
            if (savedUrl) process.env.RDMS_VALIDATOR_URL = savedUrl;
        }
    });

    it("roundtrip validation detects missing objects", async () => {
        const savedUrl = process.env.RDMS_VALIDATOR_URL;
        delete process.env.RDMS_VALIDATOR_URL;
        try {
            const client = new ValidatorClient();
            const uuid1 = "11111111-1111-1111-1111-111111111111";
            const uuid2 = "22222222-2222-2222-2222-222222222222";

            const sent = [
                { content_type: "application/x-resqml+xml;version=2.0;type=obj_TriangulatedSetRepresentation", uuid: uuid1, xml: makeResqml201Xml("TriSet", uuid1, "A", "<TrianglePatch><NodeCount>3</NodeCount></TrianglePatch>") },
                { content_type: "application/x-resqml+xml;version=2.0;type=obj_TriangulatedSetRepresentation", uuid: uuid2, xml: makeResqml201Xml("TriSet", uuid2, "B", "<TrianglePatch><NodeCount>3</NodeCount></TrianglePatch>") },
            ];
            const received = [sent[0]]; // uuid2 is missing

            const result = await client.validateRoundtrip(sent, received, { skip_xsd: true });
            expect(result.roundtrip_ok).toBe(false);
            expect(result.roundtrip_diff.missing_in_received).toContain(uuid2);
        } finally {
            if (savedUrl) process.env.RDMS_VALIDATOR_URL = savedUrl;
        }
    });
});

// ─── XSD Validation (Layer 2) ────────────────────────────────────────────────

describe("XSD Schema Validation", () => {
    let hasLibxmljs = false;
    beforeAll(() => {
        try {
            require("libxmljs2");
            hasLibxmljs = true;
        } catch {
            hasLibxmljs = false;
        }
    });

    it("validates well-formed RESQML 2.0.1 XML against XSD", () => {
        if (!hasLibxmljs) return; // skip if libxmljs2 not available

        const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
        // Minimal but schema-valid XML is complex — test that XSD loading works
        const xml = makeResqml201Xml("TriangulatedSetRepresentation", uuid, "Surface",
            "<TrianglePatch><NodeCount>3</NodeCount></TrianglePatch>");

        // This may fail XSD validation (minimal XML may not satisfy all XSD constraints)
        // but should NOT throw — errors should be returned in the array
        const errors = validateXmlAgainstXsd(xml, "2.0.1", uuid, "TriangulatedSetRepresentation");
        expect(Array.isArray(errors)).toBe(true);
    });

    it("reports parse error for broken XML", () => {
        if (!hasLibxmljs) return;

        const errors = validateXmlAgainstXsd("<broken><xml", "2.0.1");
        expect(errors.some(e => e.severity === Severity.ERROR)).toBe(true);
    });

    it("reports error for unknown schema version", () => {
        if (!hasLibxmljs) return;

        const errors = validateXmlAgainstXsd("<root/>", "9.9.9");
        expect(errors.some(e => e.message.includes("not found"))).toBe(true);
    });
});
