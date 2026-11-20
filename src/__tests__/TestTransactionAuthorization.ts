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

import "jest";
import { ExecutionContext } from "@nestjs/common";
import express from "express";
import { Energistics, ResqmlClient } from "../lib/client/ResqmlClient";
import { EtpUri } from "../lib/common/EtpUri";
import { ErrorCode, EtpError } from "../lib/common/EtpTypes";
import { OSDUContext } from "../lib/jsonTypes/OsduContext";
import {
  FindInDataSpaceParams,
  HasBearerGuard,
  commitTransaction,
  createSession,
  createTransaction,
  drainSessionPool,
  drainTransactions,
  extractToken,
  extractUserInfo,
  httpErrorFromEtpError,
  rollbackTransaction
} from "../lib/restApi/ControllerUtils";
import TransactionsAPI, {
  TransactionParams
} from "../lib/restApi/write-etp.module/Transactions.controller";
import WellLogImportAPI from "../lib/restApi/wells.module/WellLogImport.controller";
import WitsmlController from "../lib/restApi/witsml.module/Witsml.controller";

const dataspace = "eml:///dataspace('private')";
const partition = "test-partition";
const makeToken = (claims: Record<string, unknown> = {}): string =>
  `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
    "base64url"
  )}.${Buffer.from(
    JSON.stringify({
      iss: "https://issuer.example/tenant",
      tid: "tenant",
      oid: "owner",
      sub: "subject",
      exp: 2000000000,
      ...claims
    })
  ).toString("base64url")}.synthetic-signature`;
const ownerToken = makeToken();
const renewedToken = makeToken({
  sub: "renewed-subject",
  exp: 2000003600
});
const basic = `Basic ${Buffer.from("user:password").toString("base64")}`;

const request = (authorization?: string): express.Request =>
  ({
    headers: authorization ? { authorization } : {},
    header: (name: string) =>
      name.toLowerCase() === "data-partition-id" ? partition : undefined
  }) as express.Request;

const operations: [
  string,
  (
    id: string,
    token: string,
    dataPartitionId?: string,
    userInfo?: string
  ) => Promise<unknown>
][] = [
  [
    "reuse",
    (id, token, dataPartitionId, userInfo) =>
      createSession(token, dataPartitionId, undefined, id, userInfo)
  ],
  ["commit", commitTransaction],
  ["rollback", rollbackTransaction]
];

const expectStatus = async (
  operation: Promise<unknown>,
  status: number
): Promise<void> => {
  try {
    await operation;
  } catch (error) {
    expect(httpErrorFromEtpError(error).getStatus()).toBe(status);
    return;
  }
  throw new Error(`Expected HTTP ${status}`);
};

let sequence = 0;

describe("authenticated transaction ownership", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(ResqmlClient.prototype, "openSession").mockResolvedValue();
    jest
      .spyOn(ResqmlClient.prototype, "isProtocolSupported")
      .mockReturnValue(true);
    jest
      .spyOn(ResqmlClient.prototype, "getDataspaceInfo")
      .mockResolvedValue([
        new Energistics.Etp.v12.Datatypes.Object.Dataspace()
      ]);
    jest
      .spyOn(ResqmlClient.prototype, "startTransaction")
      .mockImplementation(async () =>
        EtpUri.uuidStringToByteArray(
          `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`
        )
      );
    jest.spyOn(ResqmlClient.prototype, "isConnected").mockReturnValue(true);
    jest.spyOn(ResqmlClient.prototype, "ping").mockResolvedValue(null);
    jest
      .spyOn(ResqmlClient.prototype, "commitTransaction")
      .mockResolvedValue(true);
    jest
      .spyOn(ResqmlClient.prototype, "rollbackTransaction")
      .mockResolvedValue(true);
    jest.spyOn(ResqmlClient.prototype, "closeSession").mockResolvedValue();
    jest.spyOn(ResqmlClient.prototype, "disconnect").mockResolvedValue();
  });

  afterEach(async () => {
    await drainTransactions();
    await drainSessionPool();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const create = (token = ownerToken, userInfo?: string): Promise<string> =>
    createTransaction(token, dataspace, undefined, partition, 300, 6, userInfo);

  it("authenticates renewal on a fresh session and preserves the pooled client", async () => {
    const id = await create();
    const pooled = jest.mocked(ResqmlClient.prototype.openSession).mock
      .contexts[0];
    await expect(
      createSession(renewedToken, partition, undefined, id)
    ).resolves.toBe(pooled);
    const authentication = jest.mocked(ResqmlClient.prototype.openSession).mock
      .contexts[1];
    expect(authentication).not.toBe(pooled);
    expect(ResqmlClient.prototype.openSession).toHaveBeenLastCalledWith(
      expect.any(String),
      renewedToken,
      partition,
      ""
    );
    expect(
      jest.mocked(ResqmlClient.prototype.closeSession).mock.contexts
    ).toEqual([authentication]);
    await expect(commitTransaction(id, renewedToken, partition)).resolves.toBe(
      true
    );
  });

  describe.each(operations)("%s", (_name, operation) => {
    it("authenticates with the backend even when the exact credential has a warm pooled session", async () => {
      const id = await create();
      const warm = await createSession(
        ownerToken,
        partition,
        undefined,
        undefined,
        ""
      );
      await warm.closeSession();
      const opens = jest.mocked(ResqmlClient.prototype.openSession);
      expect(opens).toHaveBeenCalledTimes(2);
      opens.mockRejectedValueOnce(
        new EtpError("Credential rejected", ErrorCode.EAUTHORIZATION_REQUIRED)
      );

      await expectStatus(operation(id, ownerToken, partition), 401);

      expect(opens).toHaveBeenCalledTimes(3);
      expect(ResqmlClient.prototype.commitTransaction).not.toHaveBeenCalled();
      expect(ResqmlClient.prototype.rollbackTransaction).not.toHaveBeenCalled();
      const reused = await createSession(
        ownerToken,
        partition,
        undefined,
        undefined,
        ""
      );
      expect(opens).toHaveBeenCalledTimes(3);
      await reused.closeSession();
      await rollbackTransaction(id, ownerToken, partition);
    });

    it.each([
      ["principal", makeToken({ oid: "other" }), partition],
      ["issuer", makeToken({ iss: "https://other.example" }), partition],
      ["tenant", makeToken({ tid: "other" }), partition],
      ["partition", renewedToken, "other"],
      ["missing partition", renewedToken, undefined]
    ])(
      "rejects a foreign %s with 403 without consuming the transaction",
      async (_kind, token, callerPartition) => {
        const id = await create();
        const timers = jest.getTimerCount();
        await expectStatus(operation(id, token!, callerPartition), 403);
        expect(jest.getTimerCount()).toBe(timers);
        expect(ResqmlClient.prototype.commitTransaction).not.toHaveBeenCalled();
        expect(
          ResqmlClient.prototype.rollbackTransaction
        ).not.toHaveBeenCalled();
        await rollbackTransaction(id, renewedToken, partition);
      }
    );

    it.each([
      ErrorCode.EAUTHORIZATION_REQUIRED,
      ErrorCode.EAUTHORIZATION_EXPIRED
    ])(
      "does not trust forged matching claims when backend rejects with %s",
      async code => {
        const id = await create();
        jest
          .mocked(ResqmlClient.prototype.openSession)
          .mockRejectedValueOnce(new EtpError("Credential rejected", code));
        await expectStatus(operation(id, renewedToken, partition), 401);
        expect(ResqmlClient.prototype.commitTransaction).not.toHaveBeenCalled();
        expect(
          ResqmlClient.prototype.rollbackTransaction
        ).not.toHaveBeenCalled();
        await rollbackTransaction(id, ownerToken, partition);
      }
    );

    it("rejects missing credentials rather than using shared Basic state", async () => {
      const id = await create("", basic);
      extractToken(request(basic));
      await expectStatus(operation(id, "", partition), 401);
      expect(ResqmlClient.prototype.openSession).toHaveBeenCalledTimes(1);
      await rollbackTransaction(id, "", partition, basic);
    });

    it.each([undefined, "tenant-hint"])(
      "supports issuer-qualified subjects with tenant hint %s",
      async tid => {
        const token = makeToken({ oid: undefined, tid });
        const id = await create(token);
        await expect(
          operation(
            id,
            makeToken({ oid: undefined, tid, exp: 2000003600 }),
            partition
          )
        ).resolves.toBeDefined();
      }
    );

    it("rejects another subject when the token has a tenant hint", async () => {
      const id = await create(makeToken({ oid: undefined }));
      await expectStatus(
        operation(id, makeToken({ oid: undefined, sub: "other" }), partition),
        403
      );
    });

    it.each(["basic ", "BASIC ", "Basic  "])(
      "matches Basic credentials with scheme/separator %s",
      async prefix => {
        const id = await create("", basic);
        await expect(
          operation(id, "", partition, basic.replace(/^Basic /, prefix))
        ).resolves.toBeDefined();
      }
    );

    it.each([true, false])(
      "preserves authenticated operations when auth-session close fails (connected=%s)",
      async connected => {
        const id = await create();
        jest
          .mocked(ResqmlClient.prototype.closeSession)
          .mockRejectedValueOnce(
            new EtpError("Close failed", ErrorCode.EINVALID_STATE)
          );
        jest
          .mocked(ResqmlClient.prototype.isConnected)
          .mockReturnValueOnce(connected);
        await expect(
          operation(id, renewedToken, partition)
        ).resolves.toBeDefined();
        expect(ResqmlClient.prototype.disconnect).toHaveBeenCalledTimes(
          connected ? 1 : 0
        );
      }
    );

    it("does not bypass ownership when auth-session cleanup fails", async () => {
      const id = await create();
      jest
        .mocked(ResqmlClient.prototype.closeSession)
        .mockRejectedValueOnce(
          new EtpError("Close failed", ErrorCode.EINVALID_STATE)
        );
      jest
        .mocked(ResqmlClient.prototype.disconnect)
        .mockRejectedValueOnce(new Error("Disconnect failed"));
      await expectStatus(
        operation(id, makeToken({ oid: "other" }), partition),
        403
      );
      expect(ResqmlClient.prototype.disconnect).toHaveBeenCalledTimes(1);
      expect(ResqmlClient.prototype.commitTransaction).not.toHaveBeenCalled();
      expect(ResqmlClient.prototype.rollbackTransaction).not.toHaveBeenCalled();
    });

    it("rejects another non-Entra subject or issuer", async () => {
      const id = await create(makeToken({ oid: undefined, tid: undefined }));
      await expectStatus(
        operation(
          id,
          makeToken({ oid: undefined, tid: undefined, sub: "other" }),
          partition
        ),
        403
      );
      await expectStatus(
        operation(
          id,
          makeToken({
            oid: undefined,
            tid: undefined,
            iss: "https://other.example"
          }),
          partition
        ),
        403
      );
    });

    it.each([
      ["Basic", "", basic, "", `${basic}-other`],
      ["opaque", "opaque-owner", "", "opaque-other", ""]
    ])(
      "preserves %s credential matching",
      async (_kind, token, userInfo, otherToken, otherUserInfo) => {
        const id = await create(token, userInfo);
        await expectStatus(
          operation(id, otherToken, partition, otherUserInfo),
          403
        );
        await expect(
          operation(id, token, partition, userInfo)
        ).resolves.toBeDefined();
        expect(ResqmlClient.prototype.openSession).toHaveBeenLastCalledWith(
          expect.any(String),
          token,
          partition,
          userInfo
        );
      }
    );

    it("rechecks the transaction after authentication waits past timeout", async () => {
      const id = await create();
      let release!: () => void;
      jest
        .mocked(ResqmlClient.prototype.openSession)
        .mockImplementationOnce(
          () => new Promise<void>(resolve => (release = resolve))
        );
      const pending = operation(id, renewedToken, partition);
      const assertion = expectStatus(pending, 404);
      await jest.advanceTimersByTimeAsync(300000);
      release();
      await assertion;
      expect(ResqmlClient.prototype.rollbackTransaction).toHaveBeenCalledTimes(
        1
      );
      expect(ResqmlClient.prototype.commitTransaction).not.toHaveBeenCalled();
    });

    it("preserves disconnect metadata when the session closes during authentication", async () => {
      const onDisconnect = jest.spyOn(ResqmlClient.prototype, "onDisconnect");
      const id = await create();
      let release!: () => void;
      jest
        .mocked(ResqmlClient.prototype.openSession)
        .mockImplementationOnce(
          () => new Promise<void>(resolve => (release = resolve))
        );
      const pending = operation(id, renewedToken, partition);
      const assertion = expect(pending).rejects.toMatchObject({
        transactionId: id,
        closeCode: 1006,
        closeReason: "connection lost"
      });
      onDisconnect.mock.calls[0][0](undefined, 1006, "connection lost");
      release();
      await assertion;
      expect(ResqmlClient.prototype.commitTransaction).not.toHaveBeenCalled();
      expect(ResqmlClient.prototype.rollbackTransaction).not.toHaveBeenCalled();
    });

    it("does not operate on a replacement transaction after authentication waits", async () => {
      const id = await create();
      let release!: () => void;
      jest
        .mocked(ResqmlClient.prototype.openSession)
        .mockImplementationOnce(
          () => new Promise<void>(resolve => (release = resolve))
        );
      const pending = operation(id, renewedToken, partition);
      const assertion = expectStatus(pending, 404);
      await rollbackTransaction(id, ownerToken, partition);
      jest
        .mocked(ResqmlClient.prototype.startTransaction)
        .mockResolvedValueOnce(EtpUri.uuidStringToByteArray(id));
      await create();
      release();
      await assertion;
      expect(ResqmlClient.prototype.commitTransaction).not.toHaveBeenCalled();
      expect(ResqmlClient.prototype.rollbackTransaction).toHaveBeenCalledTimes(
        1
      );
    });
  });

  it.each([
    "",
    " ",
    "not-json.not-json.signature",
    makeToken({ iss: undefined }),
    makeToken({ iss: [] }),
    makeToken({ sub: {} }),
    makeToken({ oid: 42 }),
    makeToken({ oid: "" }),
    makeToken({ tid: undefined }),
    makeToken({ oid: undefined, sub: undefined }),
    makeToken({ oid: undefined, tid: undefined, sub: undefined })
  ])(
    "rejects missing or malformed identity without opaque fallback",
    async token => {
      await expectStatus(create(token), 401);
      expect(ResqmlClient.prototype.startTransaction).not.toHaveBeenCalled();
    }
  );

  it("does not turn malformed JWT claims into a credential owner on reuse", async () => {
    const id = await create();
    await expectStatus(
      createSession(makeToken({ oid: [] }), partition, undefined, id),
      401
    );
    expect(ResqmlClient.prototype.openSession).toHaveBeenCalledTimes(2);
    expect(ResqmlClient.prototype.closeSession).toHaveBeenCalledTimes(1);
  });

  it("cleans up the authenticated session even when identity parsing and close fail", async () => {
    const id = await create();
    jest
      .mocked(ResqmlClient.prototype.closeSession)
      .mockRejectedValueOnce(
        new EtpError("Close failed", ErrorCode.EINVALID_STATE)
      );
    await expectStatus(
      createSession(makeToken({ oid: [] }), partition, undefined, id),
      401
    );
    expect(ResqmlClient.prototype.closeSession).toHaveBeenCalledTimes(1);
    expect(ResqmlClient.prototype.disconnect).toHaveBeenCalledTimes(1);
    expect(ResqmlClient.prototype.commitTransaction).not.toHaveBeenCalled();
  });

  it("keeps timeout rollback independent of incoming credentials", async () => {
    await create();
    jest
      .mocked(ResqmlClient.prototype.openSession)
      .mockRejectedValue(
        new EtpError("Expired", ErrorCode.EAUTHORIZATION_EXPIRED)
      );
    await jest.advanceTimersByTimeAsync(300000);
    expect(ResqmlClient.prototype.openSession).toHaveBeenCalledTimes(1);
    expect(ResqmlClient.prototype.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it("resets the timeout only after authorized reuse", async () => {
    const id = await create();
    await jest.advanceTimersByTimeAsync(200000);
    await createSession(renewedToken, partition, undefined, id);
    await jest.advanceTimersByTimeAsync(200000);
    expect(ResqmlClient.prototype.rollbackTransaction).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(100000);
    expect(ResqmlClient.prototype.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  it("prevents concurrent finalizers and reuse while finalization is in flight", async () => {
    const id = await create();
    let release!: (result: boolean) => void;
    jest
      .mocked(ResqmlClient.prototype.commitTransaction)
      .mockImplementationOnce(
        () => new Promise<boolean>(resolve => (release = resolve))
      );
    const pending = commitTransaction(id, ownerToken, partition);
    // Let authentication and finalization reach the deferred ETP commit.
    for (let i = 0; i < 10 && !release; i++) {
      await Promise.resolve();
    }
    expect(release).toBeDefined();
    await expectStatus(rollbackTransaction(id, ownerToken, partition), 412);
    await expectStatus(
      createSession(renewedToken, partition, undefined, id),
      412
    );
    release(true);
    await expect(pending).resolves.toBe(true);
    expect(ResqmlClient.prototype.commitTransaction).toHaveBeenCalledTimes(1);
    expect(ResqmlClient.prototype.rollbackTransaction).not.toHaveBeenCalled();
  });

  it("allows only one finalizer when two callers authenticate concurrently", async () => {
    const id = await create();
    const results = await Promise.allSettled([
      commitTransaction(id, ownerToken, partition),
      rollbackTransaction(id, renewedToken, partition)
    ]);
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(
      1
    );
    expect(ResqmlClient.prototype.commitTransaction).toHaveBeenCalledTimes(1);
    expect(ResqmlClient.prototype.rollbackTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["commit", commitTransaction, "commitTransaction"],
    ["rollback", rollbackTransaction, "rollbackTransaction"]
  ] as const)(
    "closes the transaction session after a failed %s even if cleanup also fails",
    async (_name, operation, method) => {
      const id = await create();
      const client = jest.mocked(ResqmlClient.prototype.openSession).mock
        .contexts[0];
      jest
        .mocked(ResqmlClient.prototype[method])
        .mockRejectedValueOnce(
          new EtpError("Operation failed", ErrorCode.EINVALID_STATE)
        );
      jest
        .mocked(ResqmlClient.prototype.closeSession)
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new Error("Cleanup failed"));

      await expect(operation(id, ownerToken, partition)).rejects.toMatchObject({
        message: "Operation failed",
        code: ErrorCode.EINVALID_STATE
      });

      expect(
        jest.mocked(ResqmlClient.prototype.closeSession).mock.contexts
      ).toContain(client);
      await expectStatus(
        createSession(ownerToken, partition, undefined, id),
        404
      );
    }
  );

  it("retains dataspace existence validation at creation", async () => {
    jest.mocked(ResqmlClient.prototype.getDataspaceInfo).mockResolvedValue([]);
    await expectStatus(create(), 404);
    expect(ResqmlClient.prototype.startTransaction).not.toHaveBeenCalled();
    expect(ResqmlClient.prototype.closeSession).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])(
    "forwards caller credentials through well-log import finalization (write failure: %s)",
    async failWrite => {
      const logId = "osdu:work-product-component--WellLog:test";
      jest
        .spyOn(OSDUContext.prototype, "fetchOSDU")
        .mockResolvedValueOnce({
          id: logId,
          data: {
            Name: "Test log",
            ReferenceCurveID: "MD",
            Curves: [{ CurveID: "MD", Mnemonic: "DEPTH" }]
          }
        })
        .mockResolvedValueOnce({ columns: ["MD"], data: [[1000], [1001]] });
      const write = jest
        .spyOn(WitsmlController.prototype, "putWitsmlObjects")
        .mockResolvedValue({ success: true, stored: [], arraysStored: 1 });
      const failure = new Error("Write failed");
      if (failWrite) {
        write.mockRejectedValueOnce(failure);
      }

      const pending = new WellLogImportAPI().importWellLog(
        { id: logId, wellboreUuid: "00000000-0000-4000-8000-000000000001" },
        { dataspaceId: "private" } as FindInDataSpaceParams,
        undefined,
        request(`Bearer ${ownerToken}`)
      );
      if (failWrite) {
        await expect(pending).rejects.toBe(failure);
        expect(
          ResqmlClient.prototype.rollbackTransaction
        ).toHaveBeenCalledTimes(1);
        expect(ResqmlClient.prototype.commitTransaction).not.toHaveBeenCalled();
      } else {
        await expect(pending).resolves.toBeDefined();
        expect(ResqmlClient.prototype.commitTransaction).toHaveBeenCalledTimes(
          1
        );
      }
      expect(ResqmlClient.prototype.openSession).toHaveBeenCalledTimes(2);
      expect(ResqmlClient.prototype.openSession).toHaveBeenLastCalledWith(
        expect.any(String),
        ownerToken,
        partition,
        ""
      );
    }
  );

  describe("transaction REST caller forwarding", () => {
    const api = new TransactionsAPI();
    const params = (id: string, dataspaceId = "private") =>
      ({ dataspaceId, transactionId: id }) as TransactionParams;

    it.each(["CommitTransaction", "RollbackTransaction"] as const)(
      "authorizes %s using the request credential",
      async method => {
        const id = await create();
        await expectStatus(
          api[method](
            params(id),
            request(`Bearer ${makeToken({ oid: "other" })}`)
          ),
          403
        );
        await expect(
          api[method](params(id), request(`Bearer ${renewedToken}`))
        ).resolves.toBe(true);
      }
    );

    it.each(["CommitTransaction", "RollbackTransaction"] as const)(
      "preserves dataspace checks before %s",
      async method => {
        const id = await create();
        await expectStatus(
          api[method](params(id, "other"), request(`Bearer ${ownerToken}`)),
          400
        );
        expect(ResqmlClient.prototype.openSession).toHaveBeenCalledTimes(1);
      }
    );

    it("forwards Basic credentials on creation and finalization", async () => {
      const id = await api.PostTransaction(
        { dataspaceId: "private" } as FindInDataSpaceParams,
        undefined,
        request(basic)
      );
      await expect(
        api.RollbackTransaction(params(id), request(basic))
      ).resolves.toBe(true);
      expect(ResqmlClient.prototype.openSession).toHaveBeenLastCalledWith(
        expect.any(String),
        "",
        partition,
        basic
      );
    });
  });
});

describe("transaction credential extraction and guards", () => {
  it("preserves HTTP 400 for a malformed bearer header", () => {
    expect(() => extractToken(request("Bearer invalid@credential"))).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it("keeps case-insensitive Basic authentication request-scoped", () => {
    const header = basic.replace("Basic", "basic");
    expect(extractToken(request(header))).toBe("");
    expect(extractUserInfo(request(header))).toBe(header);
    expect(extractToken(request("Bearer opaqueBasicCredential"))).toBe(
      "opaqueBasicCredential"
    );
    expect(extractUserInfo(request("Bearer opaqueBasicCredential"))).toBe("");
  });

  it.each([undefined, "Bearer ", "Unknown value", "Bearer one two"])(
    "preserves guard rejection for a missing or invalid authorization header",
    authorization => {
      const context = {
        getArgs: () => [request(authorization)]
      } as unknown as ExecutionContext;
      expect(HasBearerGuard("jwt").canActivate(context)).toBe(false);
    }
  );
});
