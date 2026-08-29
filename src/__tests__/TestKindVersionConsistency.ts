/**
 * Test: Kind Version Consistency
 *
 * Validates that the schema version stamped on OSDU records (from converter
 * constructors) is consistent with the dynamically resolved version from
 * MilestoneKinds. Detects version mismatches that could cause Storage rejection
 * on platforms with different schema versions.
 *
 * The converter's `super(xml, context, "Type.X.Y.Z")` hardcodes the record's
 * `.kind` field. This must be ≤ the fallback/resolved version so that content
 * produced by the converter (implementing interface X.Y.Z) is always valid
 * for the declared kind version.
 */

import "jest";
import { getKind, getKindOrFallback } from "../lib/jsonTypes/MilestoneKinds";

/**
 * Map of converter constructor versions (what gets stamped on `record.kind`).
 * Extracted from all `super(xml, context, "Type.X.Y.Z")` calls.
 */
const CONVERTER_VERSIONS: Record<string, string> = {
    // WPC - Representations
    "GenericRepresentation": "1.2.0",
    "StructureMap": "1.0.0",
    "GenericBinGrid": "1.0.0",
    "HorizonControlPoints": "1.0.0",
    "SeismicBinGrid": "1.3.0",
    "SeismicHorizon": "2.0.0",
    "SeismicFault": "2.0.0",
    "SeismicLineGeometry": "1.2.0",
    "IjkGridRepresentation": "1.2.0", // 22 uses 1.2.0, 20 uses 1.1.0
    "UnstructuredGridRepresentation": "1.2.0",
    "GridConnectionSetRepresentation": "1.2.0",
    "SubRepresentation": "1.2.0",
    "ColumnBasedTable": "1.3.0",

    // WPC - Interpretations
    "EarthModelInterpretation": "1.2.0",
    "FaultInterpretation": "1.3.0",
    "HorizonInterpretation": "1.2.0",
    "GeobodyBoundaryInterpretation": "1.2.0",
    "GeobodyInterpretation": "1.3.0",
    "StratigraphicColumn": "1.2.0",
    "StratigraphicColumnRankInterpretation": "1.3.0",
    "StratigraphicUnitInterpretation": "1.3.0",
    "StructuralOrganizationInterpretation": "1.2.0",
    "FluidBoundaryInterpretation": "1.2.0",
    "RockFluidOrganizationInterpretation": "1.2.0",
    "RockFluidUnitInterpretation": "1.3.0",
    "WellboreInterpretation": "1.2.0",
    "SealedSurfaceFramework": "1.2.0",
    "UnsealedSurfaceFramework": "1.2.0",

    // WPC - Wells
    "WellLog": "1.3.0",
    "WellboreTrajectory": "1.3.0",
    "WellboreMarkerSet": "1.2.0",

    // WPC - Other
    "GenericProperty": "1.2.0",
    "LocalModelCompoundCrs": "1.2.0",
    "LocalBoundaryFeature": "1.2.0",
    "LocalModelFeature": "1.2.0",
    "LocalRockVolumeFeature": "1.2.0",
    "TimeSeries": "1.2.0",
    "Activity": "1.4.0",

    // Master Data
    "Well": "1.3.0",
    "Wellbore": "1.3.0",
    "SeismicAcquisitionSurvey": "1.4.0",
    "ActivityTemplate": "1.1.0",
    "Rig": "1.3.0",
    "FluidsReport": "1.3.0",
    "BHARun": "1.3.0",    // WitsmlBhaRun uses "BHARunReport.1.3.0" but entity = BHARun

    // WITSML types that don't have dedicated schemas → GenericRepresentation
    // "Tubular": no fallback (→ GenericRepresentation)
    // "WellboreCompletion": no fallback (→ GenericRepresentation)
};

/** Parse version string into [major, minor, patch] */
function parseVersion(v: string): [number, number, number] {
    const parts = v.split(".").map(Number);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** Compare two semver strings. Returns >0 if a > b. */
function cmpVersion(a: string, b: string): number {
    const [a1, a2, a3] = parseVersion(a);
    const [b1, b2, b3] = parseVersion(b);
    return (a1 - b1) || (a2 - b2) || (a3 - b3);
}

/** Extract version from a full kind string like "osdu:wks:...:1.2.0" */
function extractVersion(kind: string): string {
    const m = kind.match(/:(\d+\.\d+\.\d+)$/);
    return m ? m[1] : "0.0.0";
}

describe("Kind Version Consistency", () => {
    describe("Converter versions vs fallback table", () => {
        for (const [entityType, converterVersion] of Object.entries(CONVERTER_VERSIONS)) {
            it(`${entityType}: converter ${converterVersion} ≤ fallback/resolved`, () => {
                const resolvedKind = getKind(entityType);
                if (resolvedKind === undefined) {
                    // No fallback exists for this type — converter will produce a kind
                    // that might not exist on the platform. This is acceptable only if
                    // the routing logic falls back to GenericRepresentation.
                    console.warn(`  ⚠ ${entityType} has no fallback entry (falls back to GenericRepresentation)`);
                    return;
                }

                const resolvedVersion = extractVersion(resolvedKind);
                const cmp = cmpVersion(converterVersion, resolvedVersion);

                if (cmp > 0) {
                    // Converter produces NEWER content than what the fallback declares.
                    // This means the record is stamped with a version the platform might
                    // not have, and its content might include fields not in the fallback schema.
                    console.warn(
                        `  ⚠ ${entityType}: converter=${converterVersion} > fallback=${resolvedVersion}` +
                        ` — record may be rejected on platforms without ${converterVersion}`
                    );
                }

                // The key invariant: converter version should match what getKindOrFallback returns
                // so that record.kind is consistent with the actual resolved kind.
                const stampedKind = `osdu:wks:work-product-component--${entityType}:${converterVersion}`;
                expect(cmp).toBeLessThanOrEqual(0);
            });
        }
    });

    describe("Record kind must match resolved kind", () => {
        it("GenericRepresentation converter vs resolved", () => {
            const resolved = getKindOrFallback("GenericRepresentation");
            const converterStamps = "osdu:wks:work-product-component--GenericRepresentation:1.2.0";
            // This will FAIL if fallback is 1.1.0 but converter stamps 1.2.0
            expect(converterStamps).toEqual(resolved);
        });

        it("SeismicFault converter vs resolved", () => {
            const resolved = getKindOrFallback("SeismicFault");
            const converterStamps = "osdu:wks:work-product-component--SeismicFault:2.0.0";
            expect(converterStamps).toEqual(resolved);
        });

        it("SeismicBinGrid converter vs resolved", () => {
            const resolved = getKindOrFallback("SeismicBinGrid");
            const converterStamps = "osdu:wks:work-product-component--SeismicBinGrid:1.3.0";
            expect(converterStamps).toEqual(resolved);
        });

        it("Well (WITSML) converter vs resolved", () => {
            const resolved = getKindOrFallback("Well");
            const converterStamps = "osdu:wks:master-data--Well:1.3.0";
            expect(converterStamps).toEqual(resolved);
        });
    });

    describe("All converter types have fallback entries", () => {
        const TYPES_WITHOUT_FALLBACK = ["Tubular", "WellboreCompletion", "BHARunReport"];

        for (const [entityType] of Object.entries(CONVERTER_VERSIONS)) {
            if (TYPES_WITHOUT_FALLBACK.includes(entityType)) continue;

            it(`${entityType} has a fallback entry`, () => {
                const kind = getKind(entityType);
                expect(kind).toBeDefined();
            });
        }
    });
});
