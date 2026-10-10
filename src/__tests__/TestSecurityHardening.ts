// ============================================================================
// Security hardening regression tests (CodeMender findings, M27/validate)
// Covers:
//  - #221 CWE-1321: prototype pollution via ExtraMetadata property path
//  - #216/#217 CWE-918: SSRF boundary on outbound URLs
// ============================================================================

import "jest";

import { OSDUContext } from "../lib/jsonTypes/OsduContext";
import { assertSafeOutboundUrl } from "../lib/common/SafeFetch";

// Load the full registry so concrete converters are available
require("../lib/jsonTypes/ResqmlOsdu");

function makeOsdu(): any {
    const context = new OSDUContext("test-partition", "test-rddms");
    const { GenericPropertyOSDU } = require("../lib/jsonTypes/GenericProperty");
    const xml: any = {
        SchemaVersion: "2.0",
        Uuid: "sec-test-uuid",
        Citation: { Title: "Test", Originator: "tester", Creation: new Date() },
        IndexableElement: "cells",
        Count: 1,
        PropertyKind: { PropertyKind: "length" },
        PatchOfValues: [{ Values: {} }]
    };
    const osdu = new GenericPropertyOSDU(xml, context);
    osdu.data = { ValueCount: 1 };
    return osdu;
}

// ============================================================================
// #221 — prototype pollution via assignExtraMetaData (CWE-1321)
// ============================================================================
describe("#221 prototype pollution via ExtraMetadata property path", () => {
    afterEach(() => {
        // Defensive cleanup: ensure no test leaves Object.prototype polluted
        delete (Object.prototype as any).polluted;
        delete (Object.prototype as any).isAdmin;
    });

    it("does not pollute Object.prototype via osdu/__proto__/... path", () => {
        const osdu = makeOsdu();
        osdu.assignExtraMetaData([
            { Name: "osdu/__proto__/polluted", Value: "yes" }
        ]);
        expect(({} as any).polluted).toBeUndefined();
        expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it("does not pollute via constructor/prototype segments", () => {
        const osdu = makeOsdu();
        osdu.assignExtraMetaData([
            { Name: "osdu/constructor/prototype/isAdmin", Value: "true" }
        ]);
        expect(({} as any).isAdmin).toBeUndefined();
        expect((Object.prototype as any).isAdmin).toBeUndefined();
    });

    it("ignores __proto__ as the final path segment", () => {
        const osdu = makeOsdu();
        osdu.assignExtraMetaData([
            { Name: "osdu/data/__proto__", Value: '{"polluted":"yes"}' }
        ]);
        expect(({} as any).polluted).toBeUndefined();
        expect((Object.prototype as any).polluted).toBeUndefined();
    });

    it("does not pollute via non-osdu ResqmlMetadata name when opted in", () => {
        const prev = process.env.RDMS_PRESERVE_RESQML_METADATA;
        process.env.RDMS_PRESERVE_RESQML_METADATA = "true";
        try {
            const osdu = makeOsdu();
            osdu.assignExtraMetaData([
                { Name: "__proto__", Value: '{"polluted":"yes"}' }
            ]);
            expect(({} as any).polluted).toBeUndefined();
            expect((Object.prototype as any).polluted).toBeUndefined();
        } finally {
            if (prev === undefined) delete process.env.RDMS_PRESERVE_RESQML_METADATA;
            else process.env.RDMS_PRESERVE_RESQML_METADATA = prev;
        }
    });

    it("still maps legitimate osdu/-prefixed metadata unchanged", () => {
        const osdu = makeOsdu();
        osdu.assignExtraMetaData([
            { Name: "osdu/data/ValueCount", Value: "99" }
        ]);
        expect(osdu.data.ValueCount).toEqual(99);
    });
});

// ============================================================================
// #216/#217 — SSRF boundary on outbound URLs (CWE-918)
// ============================================================================
describe("#216/#217 assertSafeOutboundUrl SSRF boundary", () => {
    const prevAllow = process.env.RDMS_OUTBOUND_ALLOWED_HOSTS;
    afterEach(() => {
        if (prevAllow === undefined) delete process.env.RDMS_OUTBOUND_ALLOWED_HOSTS;
        else process.env.RDMS_OUTBOUND_ALLOWED_HOSTS = prevAllow;
    });

    it("accepts http and https URLs", () => {
        delete process.env.RDMS_OUTBOUND_ALLOWED_HOSTS;
        expect(assertSafeOutboundUrl("http://osdu.example.com/api").host).toEqual(
            "osdu.example.com"
        );
        expect(
            assertSafeOutboundUrl("https://osdu.example.com:8443/api").protocol
        ).toEqual("https:");
    });

    it("rejects non-http(s) schemes (file, ftp, gopher, data)", () => {
        delete process.env.RDMS_OUTBOUND_ALLOWED_HOSTS;
        expect(() => assertSafeOutboundUrl("file:///etc/passwd")).toThrow();
        expect(() => assertSafeOutboundUrl("ftp://host/x")).toThrow();
        expect(() => assertSafeOutboundUrl("gopher://host/x")).toThrow();
        expect(() => assertSafeOutboundUrl("data:text/plain,hi")).toThrow();
    });

    it("rejects malformed URLs", () => {
        delete process.env.RDMS_OUTBOUND_ALLOWED_HOSTS;
        expect(() => assertSafeOutboundUrl("not a url")).toThrow();
        expect(() => assertSafeOutboundUrl("")).toThrow();
    });

    it("enforces host allowlist when configured", () => {
        process.env.RDMS_OUTBOUND_ALLOWED_HOSTS = "osdu.example.com,storage:9000";
        expect(assertSafeOutboundUrl("https://osdu.example.com/a").hostname).toEqual(
            "osdu.example.com"
        );
        expect(assertSafeOutboundUrl("http://storage:9000/b").host).toEqual(
            "storage:9000"
        );
        expect(() =>
            assertSafeOutboundUrl("http://169.254.169.254/latest/meta-data")
        ).toThrow();
        expect(() => assertSafeOutboundUrl("http://evil.example.net/")).toThrow();
    });

    it("allows any http(s) host when no allowlist is set", () => {
        delete process.env.RDMS_OUTBOUND_ALLOWED_HOSTS;
        expect(() =>
            assertSafeOutboundUrl("http://internal.service.local/x")
        ).not.toThrow();
    });
});

// ============================================================================
// #219 — metric route cardinality normalization (CWE-400)
// ============================================================================
import { normalizeMetricRoute } from "../lib/restApi/monitoring.module/normalizeMetricRoute";

describe("#219 normalizeMetricRoute label cardinality", () => {
    it("strips query and fragment", () => {
        expect(normalizeMetricRoute("/api/v1/wells?name=foo#frag")).toEqual(
            "/api/v1/wells"
        );
    });

    it("replaces UUID segments with :uuid", () => {
        expect(
            normalizeMetricRoute(
                "/api/v1/wells/123e4567-e89b-12d3-a456-426614174000/log"
            )
        ).toEqual("/api/v1/wells/:uuid/log");
    });

    it("replaces all-numeric segments with :n", () => {
        expect(normalizeMetricRoute("/api/v1/items/12345")).toEqual(
            "/api/v1/items/:n"
        );
    });

    it("replaces long hex segments with :id", () => {
        expect(
            normalizeMetricRoute("/api/v1/blob/deadbeefdeadbeef1234")
        ).toEqual("/api/v1/blob/:id");
    });

    it("caps the number of segments", () => {
        const many = "/" + Array.from({ length: 30 }, (_, i) => `s${i}`).join("/");
        const out = normalizeMetricRoute(many);
        expect(out.endsWith("/...")).toBe(true);
        expect(out.split("/").length).toBeLessThanOrEqual(14);
    });

    it("does not throw on malformed percent-encoding", () => {
        expect(() => normalizeMetricRoute("/api/%E0%A4%A")).not.toThrow();
    });
});

// ============================================================================
// #218/#223 — auth header handling (CWE-287 / CWE-488)
// ============================================================================
import {
    extractToken,
    extractUserInfo,
    HasBearerGuard
} from "../lib/restApi/ControllerUtils";

function req(authorization?: string): any {
    return { headers: authorization ? { authorization } : {} };
}

describe("#218 extractToken bearer scheme", () => {
    it("returns the token for a valid Bearer header", () => {
        expect(extractToken(req("Bearer abc.def-ghi_123"))).toEqual(
            "abc.def-ghi_123"
        );
    });

    it("is case-insensitive on the Bearer scheme", () => {
        expect(extractToken(req("bearer abc123"))).toEqual("abc123");
    });

    it("rejects a non-Bearer two-part header", () => {
        expect(extractToken(req("Negotiate abc123"))).toEqual("");
    });

    it("throws on a malformed bearer token", () => {
        expect(() => extractToken(req("Bearer bad!!token"))).toThrow();
    });

    it("returns empty for Basic auth", () => {
        expect(extractToken(req("Basic dXNlcjpwYXNz"))).toEqual("");
    });
});

describe("#223 extractUserInfo is request-scoped", () => {
    it("returns the Basic header for the given request", () => {
        expect(extractUserInfo(req("Basic dXNlcjpwYXNz"))).toEqual(
            "Basic dXNlcjpwYXNz"
        );
    });

    it("returns empty for Bearer auth", () => {
        expect(extractUserInfo(req("Bearer abc123"))).toEqual("");
    });

    it("returns empty when no header present", () => {
        expect(extractUserInfo(req())).toEqual("");
    });
});

describe("#218 HasBearerGuard scheme validation", () => {
    const ctx = (authorization?: string): any => ({
        getArgs: () => [req(authorization)]
    });
    const guard = HasBearerGuard("jwt");

    it("allows a valid Bearer header", () => {
        expect(guard.canActivate(ctx("Bearer abc123") as any)).toBe(true);
    });

    it("rejects a missing header", () => {
        expect(guard.canActivate(ctx() as any)).toBe(false);
    });

    it("rejects an unknown scheme", () => {
        expect(guard.canActivate(ctx("Foo abc123") as any)).toBe(false);
    });

    it("rejects an empty credential", () => {
        expect(guard.canActivate(ctx("Bearer ") as any)).toBe(false);
    });
});
