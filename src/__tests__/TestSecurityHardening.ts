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
