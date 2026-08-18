import "jest";

import { normalizeDataspacePath } from "../lib/restApi/dataspacePath";

// Verifies the gateway-decoded "%2F" recovery used to keep slash-containing
// dataspace ids (e.g. "demo/Volve") routable behind ingress layers that
// normalize escaped slashes. See src/lib/restApi/dataspacePath.ts.
describe("normalizeDataspacePath", () => {
    const prefix = "/api/reservoir-ddms/v2";

    it("re-encodes a decoded id before a sub-resource (transactions)", () => {
        expect(
            normalizeDataspacePath(`${prefix}/dataspaces/test/ci-bruno/transactions`)
        ).toBe(`${prefix}/dataspaces/test%2Fci-bruno/transactions`);
    });

    it("re-encodes a decoded id for the bare dataspace route", () => {
        expect(normalizeDataspacePath(`${prefix}/dataspaces/demo/Volve`)).toBe(
            `${prefix}/dataspaces/demo%2FVolve`
        );
    });

    it("re-encodes for nested resource paths", () => {
        expect(
            normalizeDataspacePath(
                `${prefix}/dataspaces/demo/Volve/resources/resqml20.obj_Well/guid-1/targets`
            )
        ).toBe(
            `${prefix}/dataspaces/demo%2FVolve/resources/resqml20.obj_Well/guid-1/targets`
        );
    });

    it("re-encodes for the transaction commit route (trailing id)", () => {
        expect(
            normalizeDataspacePath(
                `${prefix}/dataspaces/test/ci-bruno/transactions/abc-123`
            )
        ).toBe(`${prefix}/dataspaces/test%2Fci-bruno/transactions/abc-123`);
    });

    it("preserves the query string", () => {
        expect(
            normalizeDataspacePath(`${prefix}/dataspaces/demo/Volve/info?foo=bar`)
        ).toBe(`${prefix}/dataspaces/demo%2FVolve/info?foo=bar`);
    });

    it("is a no-op when the id is already encoded", () => {
        const url = `${prefix}/dataspaces/demo%2FVolve/transactions`;
        expect(normalizeDataspacePath(url)).toBe(url);
    });

    it("is a no-op for the id-less list/create route", () => {
        const url = `${prefix}/dataspaces`;
        expect(normalizeDataspacePath(url)).toBe(url);
    });

    it("is a no-op for the multi-resources literal route", () => {
        const url = `${prefix}/dataspaces/multi-resources`;
        expect(normalizeDataspacePath(url)).toBe(url);
    });

    it("is a no-op for unrelated routes", () => {
        const url = `${prefix}/health/liveness`;
        expect(normalizeDataspacePath(url)).toBe(url);
    });

    it("works when the global prefix is '/'", () => {
        expect(
            normalizeDataspacePath(`/dataspaces/test/ci-bruno/transactions`)
        ).toBe(`/dataspaces/test%2Fci-bruno/transactions`);
    });
});
