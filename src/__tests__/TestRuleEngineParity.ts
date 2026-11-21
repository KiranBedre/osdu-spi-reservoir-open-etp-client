/**
 * Parity: shared registry RuleEngine vs legacy imperative business rules (TS).
 *
 * Proves the declarative engine (driven by the vendored `resqml_rules.json`,
 * generated from `rddmsmg/energistics/resqml/3.0.0/model/rules/resqml_rules.yaml`) reproduces the
 * S-rule findings of the hand-written `validateBusinessRules` on real EPCs.
 * Together with the Python parity test, this is the guarantee that the two
 * validators stay in sync off a single source of truth.
 *
 * Presence sets of (ruleId, uuid) are compared. Severity is intentionally NOT
 * compared: the registry resolves the historical S14 drift (legacy TS = warning)
 * to the canonical ERROR, so severities may differ by design while the set of
 * firing (rule, object) pairs stays identical.
 */
import "jest";
import * as fs from "fs";
import * as os from "os";

import {
    ValidationCategory,
    validateBusinessRules,
    parseEpcObjects,
    EpcObject,
    ValidationError,
} from "../lib/validation/ResqmlValidator";
import { RuleEngine } from "../lib/validation/RuleEngine";

const DATA = `${os.homedir()}/rddmscg/data`;
const REAL_EPCS = [
    "drogon/drogon22.epc",
    "drogon/drogon201.epc",
    "volve/volve22.epc",
    "teapot/teapot.epc",
    "synth/synthetic201.epc",
];

/** (ruleId, uuid) presence keys for business-rule findings. */
function businessKeys(errs: ValidationError[]): Set<string> {
    const keys = new Set<string>();
    for (const e of errs) {
        if (e.category !== ValidationCategory.RESQML_BUSINESS_RULE) continue;
        const m = e.message.match(/^\[([^\]]+)\]/);
        const rid = m ? m[1] : "";
        keys.add(`${rid}|${e.object_uuid ?? ""}`);
    }
    return keys;
}

describe("RuleEngine parity vs legacy business rules (real EPCs)", () => {
    for (const rel of REAL_EPCS) {
        const p = `${DATA}/${rel}`;
        const maybe = fs.existsSync(p) ? it : it.skip;

        maybe(`matches legacy on ${rel}`, () => {
            const objects: EpcObject[] = parseEpcObjects(p);
            expect(objects.length).toBeGreaterThan(0);

            const uuidIndex = new Set(objects.map(o => o.uuid.toLowerCase()));
            const legacy = businessKeys(validateBusinessRules(objects));
            const engine = businessKeys(new RuleEngine().evaluate(objects, uuidIndex));

            const missing = [...legacy].filter(k => !engine.has(k));
            const extra = [...engine].filter(k => !legacy.has(k));
            expect({ file: rel, missing }).toEqual({ file: rel, missing: [] });
            expect({ file: rel, extra }).toEqual({ file: rel, extra: [] });
        });
    }
});
