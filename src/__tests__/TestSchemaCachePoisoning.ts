/**
 * Test: Schema-existence cache poisoning guard
 *
 * Regression for the manifest "drops all records" defect: `isSchemaRegistered`
 * previously cached `resp.status === 200` for EVERY response, so a single
 * transient/auth failure (401/403/5xx) cached `false` for that kind for the
 * whole process lifetime. The schema-compat pass in Manifest.ts then silently
 * dropped every WorkProductComponent/MasterData/ReferenceData record of that
 * kind, yielding an ETPDataspace-only manifest until restart.
 *
 * The fix only caches DEFINITIVE answers (200 = registered, 404 = not
 * registered). Non-definitive statuses are treated as "assume present" and are
 * NOT cached, so a later call with a valid token resolves the real answer.
 */

import "jest";
import { isSchemaRegistered } from "../lib/jsonTypes/MilestoneKinds";

const OSDU = "https://osdu.example";

function mockStatus(status: number): void {
    // isSchemaRegistered only reads resp.status.
    global.fetch = jest.fn(async () => ({ status }) as Response) as unknown as typeof fetch;
}

describe("isSchemaRegistered cache poisoning guard", () => {
    const realFetch = global.fetch;
    afterEach(() => {
        global.fetch = realFetch;
    });

    it("200 caches the kind as registered", async () => {
        mockStatus(200);
        const kind = "osdu:wks:test--Present200:1.0.0";
        expect(await isSchemaRegistered(kind, OSDU)).toBe(true);
    });

    it("404 caches the kind as not-registered", async () => {
        mockStatus(404);
        const kind = "osdu:wks:test--Missing404:1.0.0";
        expect(await isSchemaRegistered(kind, OSDU)).toBe(false);
        // A subsequent 200 must NOT flip it — 404 is a definitive cached answer.
        mockStatus(200);
        expect(await isSchemaRegistered(kind, OSDU)).toBe(false);
    });

    it("401 does not poison the cache (assume present, not cached)", async () => {
        mockStatus(401);
        const kind = "osdu:wks:test--Poison401:1.0.0";
        expect(await isSchemaRegistered(kind, OSDU)).toBe(true);
        // A later call with a valid token (200) must resolve the real answer,
        // not a poisoned `false`.
        mockStatus(200);
        expect(await isSchemaRegistered(kind, OSDU)).toBe(true);
    });

    it("5xx does not poison the cache", async () => {
        mockStatus(503);
        const kind = "osdu:wks:test--Transient503:1.0.0";
        expect(await isSchemaRegistered(kind, OSDU)).toBe(true);
        mockStatus(200);
        expect(await isSchemaRegistered(kind, OSDU)).toBe(true);
    });

    it("network error does not poison the cache", async () => {
        global.fetch = jest.fn(async () => {
            throw new Error("ECONNRESET");
        }) as unknown as typeof fetch;
        const kind = "osdu:wks:test--NetErr:1.0.0";
        expect(await isSchemaRegistered(kind, OSDU)).toBe(true);
        mockStatus(200);
        expect(await isSchemaRegistered(kind, OSDU)).toBe(true);
    });
});
