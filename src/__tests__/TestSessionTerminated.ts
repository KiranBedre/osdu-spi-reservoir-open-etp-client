// ============================================================================
// Copyright 2026 Microsoft. Inc. or its affiliates. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ============================================================================
//
// Regression tests for ADO WI 70414: dead WebSocket session cascade.
//
// Before this change, when an ETP server force-closed a transaction's
// WebSocket mid-write, the next REST call (PUT data, DELETE, rollback) would
// call `connection?.send(data)` on a closed socket and throw a raw
// "cannot call send() while not connected" transport error. The REST layer's
// generic `httpErrorFromEtpError` fell through to InternalServerErrorException
// and returned an opaque HTTP 500 — making the entire transaction unusable
// without telling the caller why.
//
// The fix: ETPCore.sendData now throws a typed EtpSessionTerminatedError
// when the underlying socket is null/closed, and httpErrorFromEtpError maps
// that error to HTTP 410 Gone with a structured body the caller can act on.

import "jest";

import { GoneException, HttpException, HttpStatus } from "@nestjs/common";

import {
  ErrorCode,
  EtpError,
  EtpSessionTerminatedError
} from "../lib/common/EtpTypes";

import { ETPCore } from "../lib/common/ETPCore";

import { httpErrorFromEtpError } from "../lib/restApi/ControllerUtils";

const getResponse = (e: HttpException): Record<string, unknown> =>
  e.getResponse() as Record<string, unknown>;

describe("EtpSessionTerminatedError", () => {
  it("is an instance of EtpError and carries EINVALID_STATE code", () => {
    const err = new EtpSessionTerminatedError("session is gone");
    expect(err).toBeInstanceOf(EtpError);
    expect(err).toBeInstanceOf(EtpSessionTerminatedError);
    expect(err.code).toBe(ErrorCode.EINVALID_STATE);
    expect(err.name).toBe("EtpSessionTerminatedError");
  });

  it("preserves close metadata when supplied", () => {
    const at = new Date("2026-04-01T05:20:00Z");
    const err = new EtpSessionTerminatedError("dead", {
      transactionId: "txn-1",
      closeCode: 1006,
      closeReason: "abnormal close",
      terminatedAt: at
    });
    expect(err.transactionId).toBe("txn-1");
    expect(err.closeCode).toBe(1006);
    expect(err.closeReason).toBe("abnormal close");
    expect(err.terminatedAt).toBe(at);
  });

  it("defaults terminatedAt to now when omitted", () => {
    const before = Date.now();
    const err = new EtpSessionTerminatedError("dead");
    const after = Date.now();
    expect(err.terminatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(err.terminatedAt.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("httpErrorFromEtpError → 410 Gone for terminated sessions", () => {
  it("maps EtpSessionTerminatedError to GoneException (410)", () => {
    const err = new EtpSessionTerminatedError("session terminated", {
      transactionId: "txn-abc",
      closeCode: 1011,
      closeReason: "server overloaded"
    });
    const result = httpErrorFromEtpError(err);
    expect(result).toBeInstanceOf(GoneException);
    expect(result.getStatus()).toBe(HttpStatus.GONE);
    const body = getResponse(result);
    expect(body.code).toBe("WEBSOCKET_SESSION_TERMINATED");
    expect(body.transactionId).toBe("txn-abc");
    expect(body.closeCode).toBe(1011);
    expect(body.closeReason).toBe("server overloaded");
    expect(body.retryable).toBe(false);
    expect(body.description).toBe("session terminated");
    expect(typeof body.terminatedAt).toBe("string");
  });

  it("does NOT fall through to 500 for the cascade scenario", () => {
    // Reproduces the WI 70414 cascade: rollback retry hits a dead socket and
    // ETPCore.sendData throws EtpSessionTerminatedError. Previously this
    // propagated up unwrapped and the catch chain mapped it to a 500.
    const err = new EtpSessionTerminatedError(
      "ETP WebSocket session is not connected; cannot send message"
    );
    const result = httpErrorFromEtpError(err, "rollbackTransaction");
    expect(result.getStatus()).not.toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result.getStatus()).toBe(HttpStatus.GONE);
  });

  it("does not collide with generic EINVALID_STATE EtpError mapping", () => {
    // Plain EtpError with the same numeric code still maps to 412 — only the
    // typed subclass triggers the 410 branch.
    const err = new EtpError("invalid state", ErrorCode.EINVALID_STATE);
    const result = httpErrorFromEtpError(err);
    expect(result.getStatus()).toBe(HttpStatus.PRECONDITION_FAILED);
  });
});

describe("ETPCore.sendData guards the WebSocket state", () => {
  // ETPCore is abstract; instantiate via a minimal concrete subclass that
  // satisfies the constructor without opening any real socket.
  class TestCore extends ETPCore {
    public constructor() {
      super({ name: "test", traceCalls: false });
    }
    public setConnection(c: unknown): void {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).connection = c;
    }
  }

  let core: TestCore;
  beforeEach(() => {
    core = new TestCore();
  });

  it("is a silent no-op when connection is null (preserves legacy behavior)", () => {
    // Some callers (unit tests, pre-session helpers) construct a client
    // without opening a socket. The previous `connection?.send(data)` was a
    // silent no-op in that case; the guard preserves that contract and only
    // throws when a previously-open socket has since been closed.
    core.setConnection(null);
    const buf = new ArrayBuffer(1);
    expect(() => core.sendData(BigInt(1) as never, buf)).not.toThrow();
  });

  it("throws EtpSessionTerminatedError when readyState !== OPEN", () => {
    const fake = {
      readyState: 3, // CLOSED
      OPEN: 1,
      send: jest.fn()
    };
    core.setConnection(fake);
    const buf = new ArrayBuffer(1);
    expect(() => core.sendData(BigInt(2) as never, buf)).toThrow(
      EtpSessionTerminatedError
    );
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("delegates to connection.send() when socket is OPEN", () => {
    const fake = {
      readyState: 1,
      OPEN: 1,
      send: jest.fn()
    };
    core.setConnection(fake);
    const buf = new ArrayBuffer(4);
    core.sendData(BigInt(3) as never, buf);
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(fake.send).toHaveBeenCalledWith(buf);
  });
});
