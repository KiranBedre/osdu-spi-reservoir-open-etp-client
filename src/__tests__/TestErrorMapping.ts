// ============================================================================
// Copyright 2026 Microsoft. Inc. or its affiliates. All Rights Reserved
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

import "jest";

import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  GatewayTimeoutException,
  GoneException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  NotImplementedException,
  PreconditionFailedException,
  UnauthorizedException
} from "@nestjs/common";

import { ErrorCode, EtpError } from "../lib/common/EtpTypes";

import {
  HasDataPartitionGuard,
  httpErrorFromEtpError
} from "../lib/restApi/ControllerUtils";

const getResponse = (e: HttpException): Record<string, unknown> =>
  e.getResponse() as Record<string, unknown>;

const buildContext = (header: string | undefined): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) =>
          name.toLowerCase() === "data-partition-id" ? header : undefined
      })
    })
  }) as unknown as ExecutionContext;

describe("httpErrorFromEtpError", () => {
  describe("HttpException pass-through", () => {
    it.each<[string, HttpException]>([
      ["BadRequestException", new BadRequestException("client mistake")],
      [
        "InternalServerErrorException",
        new InternalServerErrorException("server fault")
      ],
      ["NotFoundException", new NotFoundException("missing")],
      ["UnauthorizedException", new UnauthorizedException("no auth")],
      ["ForbiddenException", new ForbiddenException("denied")]
    ])("returns the same %s instance untouched", (_, original) => {
      const result = httpErrorFromEtpError(original);
      expect(result).toBe(original);
      expect(result.getStatus()).toBe(original.getStatus());
      expect(result.message).toBe(original.message);
    });
  });

  describe("EtpError code mapping (regression)", () => {
    const cases: Array<{
      code: ErrorCode;
      type: new (...args: never[]) => HttpException;
      status: number;
    }> = [
        {
          code: ErrorCode.EAUTHORIZATION_REQUIRED,
          type: UnauthorizedException,
          status: HttpStatus.UNAUTHORIZED
        },
        {
          code: ErrorCode.EAUTHORIZATION_EXPIRED,
          type: UnauthorizedException,
          status: HttpStatus.UNAUTHORIZED
        },
        {
          code: ErrorCode.EAUTHORIZATION_EXPIRING,
          type: UnauthorizedException,
          status: HttpStatus.UNAUTHORIZED
        },
        {
          code: ErrorCode.EREQUEST_DENIED,
          type: ForbiddenException,
          status: HttpStatus.FORBIDDEN
        },
        {
          code: ErrorCode.ENOROLE,
          type: ForbiddenException,
          status: HttpStatus.FORBIDDEN
        },
        {
          code: ErrorCode.EUPDATEGROWINGOBJECT_DENIED,
          type: ForbiddenException,
          status: HttpStatus.FORBIDDEN
        },
        {
          code: ErrorCode.ENOT_FOUND,
          type: NotFoundException,
          status: HttpStatus.NOT_FOUND
        },
        {
          code: ErrorCode.EINVALID_URI,
          type: BadRequestException,
          status: HttpStatus.BAD_REQUEST
        },
        {
          code: ErrorCode.EINVALID_ARGUMENT,
          type: BadRequestException,
          status: HttpStatus.BAD_REQUEST
        },
        {
          code: ErrorCode.EMAXSIZE_EXCEEDED,
          type: BadRequestException,
          status: HttpStatus.BAD_REQUEST
        },
        {
          code: ErrorCode.EINVALID_OBJECT,
          type: BadRequestException,
          status: HttpStatus.BAD_REQUEST
        },
        {
          code: ErrorCode.EINVALID_MESSAGE,
          type: BadRequestException,
          status: HttpStatus.BAD_REQUEST
        },
        {
          code: ErrorCode.EINVALID_INDEXKIND,
          type: BadRequestException,
          status: HttpStatus.BAD_REQUEST
        },
        {
          code: ErrorCode.EINVALID_CHANNELID,
          type: BadRequestException,
          status: HttpStatus.BAD_REQUEST
        },
        {
          code: ErrorCode.ENOTGROWINGOBJECT,
          type: BadRequestException,
          status: HttpStatus.BAD_REQUEST
        },
        {
          code: ErrorCode.EREQUESTUUID_REJECTED,
          type: ConflictException,
          status: HttpStatus.CONFLICT
        },
        {
          code: ErrorCode.ENOCASCADE_DELETE,
          type: ConflictException,
          status: HttpStatus.CONFLICT
        },
        {
          code: ErrorCode.EPLURAL_OBJECT,
          type: ConflictException,
          status: HttpStatus.CONFLICT
        },
        {
          code: ErrorCode.ERETENTION_PERIOD_EXCEEDED,
          type: GoneException,
          status: HttpStatus.GONE
        },
        {
          code: ErrorCode.ELIMIT_EXCEEDED,
          type: HttpException,
          status: HttpStatus.TOO_MANY_REQUESTS
        },
        {
          code: ErrorCode.EBACKPRESSURE_LIMIT_EXCEEDED,
          type: HttpException,
          status: HttpStatus.TOO_MANY_REQUESTS
        },
        {
          code: ErrorCode.ETIMED_OUT,
          type: GatewayTimeoutException,
          status: HttpStatus.GATEWAY_TIMEOUT
        },
        {
          code: ErrorCode.EINVALID_STATE,
          type: PreconditionFailedException,
          status: HttpStatus.PRECONDITION_FAILED
        },
        {
          code: ErrorCode.EMAX_TRANSACTIONS_EXCEEDED,
          type: PreconditionFailedException,
          status: HttpStatus.PRECONDITION_FAILED
        },
        {
          code: ErrorCode.ENOSUPPORTEDPROTOCOLS,
          type: NotImplementedException,
          status: HttpStatus.NOT_IMPLEMENTED
        },
        {
          code: ErrorCode.ENOTSUPPORTED,
          type: NotImplementedException,
          status: HttpStatus.NOT_IMPLEMENTED
        },
        {
          code: ErrorCode.EUNSUPPORTED_PROTOCOL,
          type: NotImplementedException,
          status: HttpStatus.NOT_IMPLEMENTED
        },
        {
          code: ErrorCode.ECOMPRESSION_NOTSUPPORTED,
          type: NotImplementedException,
          status: HttpStatus.NOT_IMPLEMENTED
        },
        {
          code: ErrorCode.EDATAOBJECTTYPE_NOTSUPPORTED,
          type: NotImplementedException,
          status: HttpStatus.NOT_IMPLEMENTED
        }
      ];
    cases.forEach(({ code, type, status }) => {
      it(`maps EtpError(code=${code}) to ${type.name} (${status})`, () => {
        const result = httpErrorFromEtpError(new EtpError("oops", code));
        expect(result).toBeInstanceOf(type);
        expect(result.getStatus()).toBe(status);
        expect(getResponse(result).description).toBe("oops");
      });
    });
  });

  describe("Plain Error treated as server fault", () => {
    it.each([
      ["Legal tags not found in OSDU instance"],
      ["Unknown Error: Bad Request Exception"],
      ["dimensions not compatible with array dimensions"],
      ["Validation Failed: Missing $type"],
      ["Some upstream service was unreachable"]
    ])("returns 500 with original message %p preserved", message => {
      const result = httpErrorFromEtpError(new Error(message));
      expect(result).toBeInstanceOf(InternalServerErrorException);
      expect(result.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(getResponse(result).description).toBe(message);
    });

    it("falls back to a generic message when error.message is empty", () => {
      const result = httpErrorFromEtpError(new Error(""));
      expect(result).toBeInstanceOf(InternalServerErrorException);
      expect(getResponse(result).description).toBe("Internal server error");
    });
  });

  describe("EtpError with unmapped code", () => {
    it("returns 400 preserving the original EtpError message", () => {
      // pick a code that isn't in the mapping table
      const result = httpErrorFromEtpError(
        new EtpError("Some unexpected ETP failure", 9999 as ErrorCode)
      );
      expect(result).toBeInstanceOf(BadRequestException);
      expect(getResponse(result).description).toBe(
        "Some unexpected ETP failure"
      );
    });
  });

  describe("Unknown error fallthrough - does not leak stack/object internals", () => {
    it("returns the error message but NOT the stack trace", () => {
      const err = new Error("upstream timeout while fetching foo");
      const result = httpErrorFromEtpError(err);
      expect(result).toBeInstanceOf(InternalServerErrorException);
      const description = String(getResponse(result).description ?? "");
      expect(description).toBe("upstream timeout while fetching foo");
      // Sanity: stack frames must not be embedded in the response body
      expect(description).not.toContain("at Object.");
      expect(description).not.toContain("node_modules");
    });

    it("returns generic 500 for plain object errors with no message", () => {
      const result = httpErrorFromEtpError({ foo: "bar" });
      expect(result).toBeInstanceOf(InternalServerErrorException);
      expect(getResponse(result).description).toBe("Internal server error");
    });

    it("returns generic 500 for null/undefined", () => {
      expect(httpErrorFromEtpError(null)).toBeInstanceOf(
        InternalServerErrorException
      );
      expect(httpErrorFromEtpError(undefined)).toBeInstanceOf(
        InternalServerErrorException
      );
    });

    it("preserves the message when a string is thrown", () => {
      const result = httpErrorFromEtpError("oops something went wrong");
      expect(result).toBeInstanceOf(InternalServerErrorException);
      expect(getResponse(result).description).toBe("oops something went wrong");
    });

    it("preserves the message when a number is thrown", () => {
      const result = httpErrorFromEtpError(42);
      expect(result).toBeInstanceOf(InternalServerErrorException);
      expect(getResponse(result).description).toBe("42");
    });
  });

  describe("Node.js system error mapping (transport / dependency failures)", () => {
    const makeSysErr = (code: string): Error & { code: string } => {
      const e = new Error(`connect ${code} 10.0.0.1:443`) as Error & {
        code: string;
      };
      e.code = code;
      return e;
    };

    it.each([
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "EHOSTUNREACH",
      "ENETUNREACH"
    ])("maps Node syscall %s to 502 BadGateway", sysCode => {
      const result = httpErrorFromEtpError(makeSysErr(sysCode));
      expect(result).toBeInstanceOf(BadGatewayException);
      expect(result.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(getResponse(result).description).toBe(
        "Upstream service is unreachable"
      );
    });

    it.each(["ETIMEDOUT", "ESOCKETTIMEDOUT"])(
      "maps Node syscall %s to 504 GatewayTimeout",
      sysCode => {
        const result = httpErrorFromEtpError(makeSysErr(sysCode));
        expect(result).toBeInstanceOf(GatewayTimeoutException);
        expect(result.getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT);
        expect(getResponse(result).description).toBe(
          "Upstream service timed out"
        );
      }
    );

    it("does not mistake an unrelated string `code` for a syscall", () => {
      const e = new Error("nope") as Error & { code: string };
      e.code = "SOMETHING_ELSE";
      const result = httpErrorFromEtpError(e);
      expect(result).toBeInstanceOf(InternalServerErrorException);
    });
  });
});

describe("HasDataPartitionGuard", () => {
  const originalMode = process.env.RDMS_DATA_PARTITION_MODE;
  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.RDMS_DATA_PARTITION_MODE;
    } else {
      process.env.RDMS_DATA_PARTITION_MODE = originalMode;
    }
  });

  it("throws BadRequestException (400) when header is missing", () => {
    process.env.RDMS_DATA_PARTITION_MODE = "multi";
    const guard = HasDataPartitionGuard();
    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      BadRequestException
    );
  });

  it("throws BadRequestException (400) when header has no valid characters", () => {
    process.env.RDMS_DATA_PARTITION_MODE = "multi";
    const guard = HasDataPartitionGuard();
    // Header containing no alphanumerics fails partitionRegexp entirely.
    expect(() => guard.canActivate(buildContext("!@#$%^"))).toThrow(
      BadRequestException
    );
  });

  it.each([
    ["../etc/passwd"],
    ["opendes/../foo"],
    ["dp1; DROP TABLE x"],
    ["space inside"],
    ["dp1\nheader-injection: x"]
  ])(
    "throws BadRequestException (400) when header contains invalid sub-tokens (%j)",
    (header: string) => {
      // Anchored partitionRegexp must reject any header that is not entirely
      // composed of alphanumeric / hyphen-separated tokens. A substring match
      // would let path traversal / header injection / SQLi-shaped values
      // through.
      process.env.RDMS_DATA_PARTITION_MODE = "multi";
      const guard = HasDataPartitionGuard();
      expect(() => guard.canActivate(buildContext(header))).toThrow(
        BadRequestException
      );
    }
  );

  it("returns true when valid header is provided", () => {
    process.env.RDMS_DATA_PARTITION_MODE = "multi";
    const guard = HasDataPartitionGuard();
    expect(guard.canActivate(buildContext("opendes"))).toBe(true);
  });

  it("returns true unconditionally in single-partition mode", () => {
    process.env.RDMS_DATA_PARTITION_MODE = "single";
    const guard = HasDataPartitionGuard();
    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });
});
