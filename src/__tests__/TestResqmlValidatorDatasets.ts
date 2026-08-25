import "jest";
import * as fs from "fs";
import {
    validateEpc,
    Severity,
    ValidationCategory,
} from "../lib/validation/ResqmlValidator";

/**
 * Integration tests: validate real EPC files from different authoring tools.
 * Skipped when dataset files are not present.
 */

const DATASETS: Array<{
    label: string;
    epcPath: string;
    h5Path?: string;
    minObjects: number;
    source: string;
}> = [
        {
            label: "pyetp demo_seismic (PointSet + Grid2d)",
            epcPath: "/tmp/pyetp-ingest/demo_seismic.epc",
            h5Path: "/tmp/pyetp-ingest/demo_seismic.h5",
            minObjects: 6,
            source: "pyetp (equinor:pyetp:0.0.52)",
        },
        {
            label: "pyetp interop (PointSet + Grid2d + BinGrid + Horizon)",
            epcPath: "/tmp/pyetp-interop/pyetp_demo.epc",
            h5Path: "/tmp/pyetp-interop/pyetp_demo.h5",
            minObjects: 9,
            source: "pyetp (equinor:pyetp:0.0.52)",
        },
        {
            label: "SKUA Volve (Paradigm PDGM-DX ETP Client)",
            epcPath: "/home/maap/rddms/tmp/fabien_volve_skua.epc",
            minObjects: 30,
            source: "SKUA (PDGM-DX ETP Client 2.0.1)",
        },
        {
            label: "Olympus (DGI cv_etpexport + fesapi, 397 objects)",
            epcPath: "/home/maap/rddms/tmp/olympus.epc",
            minObjects: 390,
            source: "DGI:cv_etpexport:17.0 + F2I-CONSULTING:FESAPI:2.9.0.0",
        },
        {
            label: "Teapot (DGI cv_etpexport + fesapi, 110 objects)",
            epcPath: "/home/maap/rddms/tmp/teapot.epc",
            minObjects: 100,
            source: "DGI:cv_etpexport:17.0 + F2I-CONSULTING:FESAPI:2.9.0.0",
        },
        {
            label: "Drogon fesapi roundtrip (Aspen RMS origin, 276 objects)",
            epcPath: "/tmp/drogon_fesapi_roundtrip.epc",
            minObjects: 270,
            source: "Aspen RMS + ores (fesapi roundtrip)",
        },
    ];

for (const ds of DATASETS) {
    const skip = !fs.existsSync(ds.epcPath);

    describe(`Real dataset: ${ds.label}`, () => {
        (skip ? it.skip : it)("parses and validates without crashes", () => {
            const t0 = performance.now();

            const report = validateEpc(ds.epcPath, {
                skip_xsd: false,
                skip_hdf5: !ds.h5Path,
            }, ds.h5Path);

            const elapsed = (performance.now() - t0).toFixed(0);

            console.log(`\n── ${ds.label} ──`);
            console.log(`   source:     ${ds.source}`);
            console.log(`   objects:    ${report.object_count}`);
            console.log(`   validated:  ${report.validated_count}`);
            console.log(`   version:    ${report.version}`);
            console.log(`   errors:     ${report.error_count}`);
            console.log(`   warnings:   ${report.warning_count}`);
            console.log(`   time:       ${elapsed} ms`);

            // Expect at least N objects parsed
            expect(report.object_count).toBeGreaterThanOrEqual(ds.minObjects);

            // Group errors by category for diagnostics
            const byCategory = new Map<string, number>();
            for (const e of report.errors) {
                byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
            }
            if (byCategory.size > 0) {
                console.log("   by category:");
                for (const [cat, cnt] of [...byCategory.entries()].sort()) {
                    console.log(`     ${cat}: ${cnt}`);
                }
            }

            // Log first few errors/warnings of each category for diagnosis
            const seen = new Set<string>();
            for (const e of report.errors) {
                const key = `${e.category}|${e.severity}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    console.log(`   [${e.severity}] ${e.category}: ${e.message.substring(0, 120)}`);
                }
            }
        });

        (skip ? it.skip : it)("completes within reasonable time", () => {
            const t0 = performance.now();
            validateEpc(ds.epcPath, { skip_xsd: true, skip_hdf5: true });
            const elapsed = performance.now() - t0;
            console.log(`   fast-path (skip XSD+H5): ${elapsed.toFixed(0)} ms`);

            // Even the largest EPC should validate without XSD in under 2s
            expect(elapsed).toBeLessThan(2000);
        });
    });
}
