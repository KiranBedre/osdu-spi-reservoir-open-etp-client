import "jest";

import SeismicValidateController, {
    SeismicValidationRequestDto
} from "../lib/restApi/seismic.module/SeismicValidate.controller";

/**
 * Unit tests for POST /seismic/validate.
 * Exercises the controller directly (no DI deps) — canonicalisation of seismic
 * property kinds, alias resolution, UOM checks, aggregate summary, and strict mode.
 */
describe("POST /seismic/validate", () => {
    const controller = new SeismicValidateController();

    const req = (properties: SeismicValidationRequestDto["properties"]): SeismicValidationRequestDto => ({
        properties
    });

    it("canonicalises aliases and reports an aggregate summary", () => {
        const res = controller.validate(
            req([
                { kind: "AI", uom: "kg/(m2.s)", name: "acoustic_impedance" },
                { kind: "RMS", uom: "m/s" },
                { kind: "two-way time", uom: "ms" },
                { kind: "made-up attribute" }
            ])
        );

        expect(res.total).toBe(4);
        expect(res.canonical).toBe(3);
        expect(res.nonCanonical).toBe(1);

        const ai = res.results[0];
        expect(ai.name).toBe("acoustic_impedance");
        expect(ai.kind).toBe("acoustic impedance");
        expect(ai.matchedAlias).toBe(true);
        expect(ai.canonical).toBe(true);
        expect(ai.seismic).toBe(true);

        const rms = res.results[1];
        expect(rms.kind).toBe("RMS velocity");
        expect(rms.expectedUom).toBe("m/s");

        const bad = res.results[3];
        expect(bad.canonical).toBe(false);
        expect(bad.warnings).toBeDefined();
    });

    it("warns on a UOM that disagrees with the expected unit", () => {
        const res = controller.validate(req([{ kind: "RMS velocity", uom: "ft" }]));
        const r = res.results[0];
        expect(r.expectedUom).toBe("m/s");
        expect(r.warnings!.some(w => w.includes("UOM"))).toBe(true);
        expect(res.withWarnings).toBe(1);
    });

    it("passes an already-canonical kind with no warnings", () => {
        const res = controller.validate(req([{ kind: "interval velocity", uom: "m/s" }]));
        const r = res.results[0];
        expect(r.canonical).toBe(true);
        expect(r.matchedAlias).toBe(false);
        expect(r.warnings).toBeUndefined();
        expect(res.withWarnings).toBe(0);
    });

    it("handles an empty properties array", () => {
        const res = controller.validate(req([]));
        expect(res.total).toBe(0);
        expect(res.canonical).toBe(0);
        expect(res.results).toEqual([]);
    });

    it("rejects with 422 in strict mode when a kind is non-canonical", () => {
        expect(() =>
            controller.validate(req([{ kind: "AI" }, { kind: "not-a-kind" }]), "true")
        ).toThrow(/Non-canonical/);
    });

    it("does not reject in strict mode when all kinds are canonical", () => {
        const res = controller.validate(req([{ kind: "AI" }, { kind: "RMS" }]), "true");
        expect(res.canonical).toBe(2);
        expect(res.nonCanonical).toBe(0);
    });
});
