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
// Issue #230: config-driven bounded concurrency + socket backpressure.
//
// Unit tests for the Util concurrency primitives (envInt, concurrency,
// socketHighWaterMark, pLimit, mapLimit) and an integration-style test that
// ETPCore.awaitWritable drains the socket send buffer, plus that the
// ArrayCustomer bulk-array write path awaits writability before sending.

import "jest";

import {
    concurrency,
    envInt,
    mapLimit,
    pLimit,
    socketHighWaterMark
} from "../lib/common/Util";

import { ETPCore } from "../lib/common/ETPCore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const delay = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

/** Restore any env vars this suite mutates so other suites are unaffected. */
const CONCURRENCY_ENV = [
    "RDMS_CONCURRENCY_CONVERT",
    "RDMS_CONCURRENCY_FETCH",
    "RDMS_CONCURRENCY_INDEX",
    "RDMS_CONCURRENCY_LIST",
    "RDMS_SOCKET_HWM_BYTES",
    "RDMS_TEST_ENVINT"
];

describe("envInt", () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
        for (const k of CONCURRENCY_ENV) saved[k] = process.env[k];
    });
    afterEach(() => {
        for (const k of CONCURRENCY_ENV) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k] as string;
        }
    });

    it("returns the default when unset", () => {
        delete process.env.RDMS_TEST_ENVINT;
        expect(envInt("RDMS_TEST_ENVINT", 7)).toBe(7);
    });

    it("returns the default on empty / whitespace / garbage", () => {
        process.env.RDMS_TEST_ENVINT = "";
        expect(envInt("RDMS_TEST_ENVINT", 7)).toBe(7);
        process.env.RDMS_TEST_ENVINT = "   ";
        expect(envInt("RDMS_TEST_ENVINT", 7)).toBe(7);
        process.env.RDMS_TEST_ENVINT = "not-a-number";
        expect(envInt("RDMS_TEST_ENVINT", 7)).toBe(7);
    });

    it("parses a valid integer", () => {
        process.env.RDMS_TEST_ENVINT = "42";
        expect(envInt("RDMS_TEST_ENVINT", 7)).toBe(42);
    });

    it("clamps to [min, max]", () => {
        process.env.RDMS_TEST_ENVINT = "1000";
        expect(envInt("RDMS_TEST_ENVINT", 7, 1, 64)).toBe(64);
        process.env.RDMS_TEST_ENVINT = "0";
        expect(envInt("RDMS_TEST_ENVINT", 7, 4, 64)).toBe(4);
    });

    it("clamps an out-of-range default too", () => {
        delete process.env.RDMS_TEST_ENVINT;
        expect(envInt("RDMS_TEST_ENVINT", 1000, 1, 64)).toBe(64);
    });
});

describe("concurrency limits", () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
        for (const k of CONCURRENCY_ENV) saved[k] = process.env[k];
        for (const k of CONCURRENCY_ENV) delete process.env[k];
    });
    afterEach(() => {
        for (const k of CONCURRENCY_ENV) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k] as string;
        }
    });

    it("exposes the documented defaults (behaviour-preserving)", () => {
        expect(concurrency.convert).toBe(32);
        expect(concurrency.fetch).toBe(16);
        expect(concurrency.index).toBe(8);
        expect(concurrency.list).toBe(8);
    });

    it("honours env overrides at read time", () => {
        process.env.RDMS_CONCURRENCY_CONVERT = "4";
        process.env.RDMS_CONCURRENCY_FETCH = "2";
        process.env.RDMS_CONCURRENCY_INDEX = "3";
        process.env.RDMS_CONCURRENCY_LIST = "5";
        expect(concurrency.convert).toBe(4);
        expect(concurrency.fetch).toBe(2);
        expect(concurrency.index).toBe(3);
        expect(concurrency.list).toBe(5);
    });

    it("socketHighWaterMark defaults to 8 MiB and is overridable (0 disables)", () => {
        expect(socketHighWaterMark()).toBe(8 * 1024 * 1024);
        process.env.RDMS_SOCKET_HWM_BYTES = "0";
        expect(socketHighWaterMark()).toBe(0);
        process.env.RDMS_SOCKET_HWM_BYTES = "1024";
        expect(socketHighWaterMark()).toBe(1024);
    });
});

describe("pLimit", () => {
    it("never exceeds the configured max in flight", async () => {
        const limit = 3;
        const run = pLimit(limit);
        let active = 0;
        let peak = 0;
        const task = async (): Promise<void> => {
            active++;
            peak = Math.max(peak, active);
            await delay(10);
            active--;
        };
        await Promise.all(Array.from({ length: 20 }, () => run(task)));
        expect(peak).toBeLessThanOrEqual(limit);
        expect(peak).toBeGreaterThan(1); // actually overlapped
    });

    it("coerces non-positive concurrency to at least 1 (serial)", async () => {
        const run = pLimit(0);
        let active = 0;
        let peak = 0;
        const task = async (): Promise<void> => {
            active++;
            peak = Math.max(peak, active);
            await delay(5);
            active--;
        };
        await Promise.all(Array.from({ length: 5 }, () => run(task)));
        expect(peak).toBe(1);
    });

    it("resolves each task with its own value", async () => {
        const run = pLimit(2);
        const results = await Promise.all(
            [1, 2, 3, 4].map(n => run(async () => n * n))
        );
        expect(results).toEqual([1, 4, 9, 16]);
    });

    it("propagates rejections without blocking the queue", async () => {
        const run = pLimit(2);
        const settled = await Promise.allSettled([
            run(async () => {
                throw new Error("boom");
            }),
            run(async () => "ok")
        ]);
        expect(settled[0].status).toBe("rejected");
        expect(settled[1]).toEqual({ status: "fulfilled", value: "ok" });
    });

    it("isolates a synchronous throw inside the task factory", async () => {
        const run = pLimit(1);
        await expect(
            run(() => {
                throw new Error("sync-throw");
            })
        ).rejects.toThrow("sync-throw");
        // Queue still usable afterwards.
        await expect(run(async () => "recovered")).resolves.toBe("recovered");
    });
});

describe("mapLimit", () => {
    it("preserves input order under concurrency", async () => {
        const input = [5, 1, 4, 2, 3];
        const out = await mapLimit(input, 2, async n => {
            await delay(n * 5); // out-of-order completion
            return n * 10;
        });
        expect(out).toEqual([50, 10, 40, 20, 30]);
    });

    it("passes the index to the mapper", async () => {
        const out = await mapLimit(["a", "b", "c"], 3, async (v, i) => `${v}${i}`);
        expect(out).toEqual(["a0", "b1", "c2"]);
    });

    it("caps concurrency across the whole batch", async () => {
        let active = 0;
        let peak = 0;
        await mapLimit(Array.from({ length: 30 }), 4, async () => {
            active++;
            peak = Math.max(peak, active);
            await delay(5);
            active--;
        });
        expect(peak).toBeLessThanOrEqual(4);
    });

    it("rejects on the first task rejection", async () => {
        await expect(
            mapLimit([1, 2, 3], 2, async n => {
                if (n === 2) throw new Error("fail-2");
                return n;
            })
        ).rejects.toThrow("fail-2");
    });
});

// ---------------------------------------------------------------------------
// ETPCore.awaitWritable - socket backpressure (integration-style with a fake
// WebSocket exposing a mutable bufferedAmount / readyState).
// ---------------------------------------------------------------------------

type FakeSocket = {
    bufferedAmount?: number;
    readyState: number;
};

/** Access the protected `connection` field without widening the public API. */
const setConnection = (core: ETPCore, conn: FakeSocket | null): void => {
    (core as unknown as { connection: FakeSocket | null }).connection = conn;
};

const newCore = (): ETPCore => new ETPCore({ name: "test" });

describe("ETPCore.awaitWritable (backpressure)", () => {
    // w3cwebsocket readyState constants: CONNECTING 0, OPEN 1, CLOSING 2, CLOSED 3
    const OPEN = 1;
    const CLOSING = 2;
    const CLOSED = 3;

    it("no-ops when there is no connection", async () => {
        const core = newCore();
        setConnection(core, null);
        await expect(core.awaitWritable(1024)).resolves.toBeUndefined();
    });

    it("no-ops when the transport exposes no bufferedAmount", async () => {
        const core = newCore();
        setConnection(core, { readyState: OPEN }); // no bufferedAmount field
        await expect(core.awaitWritable(1024)).resolves.toBeUndefined();
    });

    it("no-ops when backpressure is disabled (highWaterMark <= 0)", async () => {
        const core = newCore();
        setConnection(core, { readyState: OPEN, bufferedAmount: 10_000_000 });
        await expect(core.awaitWritable(0)).resolves.toBeUndefined();
    });

    it("resolves immediately when already under the high-water mark", async () => {
        const core = newCore();
        setConnection(core, { readyState: OPEN, bufferedAmount: 100 });
        const t0 = Date.now();
        await core.awaitWritable(1024, 5, 1000);
        expect(Date.now() - t0).toBeLessThan(50);
    });

    it("waits while over the mark, then resolves once drained", async () => {
        const core = newCore();
        const sock: FakeSocket = { readyState: OPEN, bufferedAmount: 5000 };
        setConnection(core, sock);
        // Drain below the mark after ~30ms.
        const drain = setTimeout(() => {
            sock.bufferedAmount = 10;
        }, 30);
        const t0 = Date.now();
        await core.awaitWritable(1024, 5, 2000);
        clearTimeout(drain);
        expect(sock.bufferedAmount).toBeLessThanOrEqual(1024);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(20);
    });

    it("returns promptly when the socket is closing/closed (never deadlocks)", async () => {
        for (const state of [CLOSING, CLOSED]) {
            const core = newCore();
            setConnection(core, { readyState: state, bufferedAmount: 9_000_000 });
            const t0 = Date.now();
            await core.awaitWritable(1024, 5, 5000);
            expect(Date.now() - t0).toBeLessThan(100);
        }
    });

    it("respects maxWaitMs when the buffer never drains", async () => {
        const core = newCore();
        setConnection(core, { readyState: OPEN, bufferedAmount: 9_000_000 });
        const t0 = Date.now();
        await core.awaitWritable(1024, 5, 60);
        const elapsed = Date.now() - t0;
        expect(elapsed).toBeGreaterThanOrEqual(40);
        expect(elapsed).toBeLessThan(500);
    });
});

// ---------------------------------------------------------------------------
// Integration: the bulk-array write path awaits writability *before* sending.
// ---------------------------------------------------------------------------

import ArrayCustomerImpl from "../lib/protocols/ArrayCustomer";
import { Energistics } from "../lib/common/Etp12";

describe("ArrayCustomer bulk writes await backpressure before send", () => {
    const makePut = () => ({
        array: {
            dimensions: [BigInt(1)],
            data: {
                item: { values: [1] }
            }
        } as unknown as Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArray,
        uid: { uri: "eml:///dataspace('x')", pathInResource: "/a" },
        customData: new Map()
    });

    it("put() calls awaitWritable and only sends after it resolves", async () => {
        const core = newCore();
        // Control awaitWritable so we can observe ordering deterministically.
        let release!: () => void;
        const gate = new Promise<void>(r => (release = r));
        const awaitSpy = jest
            .spyOn(core, "awaitWritable")
            .mockImplementation(() => gate);
        const sendSpy = jest
            .spyOn(core, "send")
            .mockImplementation(() => BigInt(2));

        const customer = new ArrayCustomerImpl(core);
        // Do not await: waitForRequest never resolves without a server response.
        void customer.put([makePut()]);

        // Yield microtasks: awaitWritable should be pending, send not yet called.
        await Promise.resolve();
        expect(awaitSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy).not.toHaveBeenCalled();

        // Release backpressure -> the send must now happen.
        release();
        await Promise.resolve();
        await Promise.resolve();
        expect(sendSpy).toHaveBeenCalledTimes(1);

        awaitSpy.mockRestore();
        sendSpy.mockRestore();
    });

    it("putSubarrays() also awaits writability before sending", async () => {
        const core = newCore();
        let release!: () => void;
        const gate = new Promise<void>(r => (release = r));
        const awaitSpy = jest
            .spyOn(core, "awaitWritable")
            .mockImplementation(() => gate);
        const sendSpy = jest
            .spyOn(core, "send")
            .mockImplementation(() => BigInt(2));

        const customer = new ArrayCustomerImpl(core);
        void customer.putSubarrays([
            {
                data: {
                    item: { values: [1] }
                },
                uid: { uri: "eml:///dataspace('x')", pathInResource: "/a" },
                starts: [BigInt(0)],
                counts: [BigInt(1)]
            } as unknown as Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataSubarraysType
        ]);

        await Promise.resolve();
        expect(awaitSpy).toHaveBeenCalledTimes(1);
        expect(sendSpy).not.toHaveBeenCalled();

        release();
        await Promise.resolve();
        await Promise.resolve();
        expect(sendSpy).toHaveBeenCalledTimes(1);

        awaitSpy.mockRestore();
        sendSpy.mockRestore();
    });
});
