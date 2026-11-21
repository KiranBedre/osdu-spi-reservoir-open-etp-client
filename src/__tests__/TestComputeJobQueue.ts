// ============================================================================
// Copyright 2019-2022 Emerson Paradigm Holding LLC. All rights reserved.
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

import {
  ComputeJobQueue,
  ComputeJobView
} from "../lib/restApi/compute-jobs.module/ComputeJobQueue";

const tick = () => new Promise(res => setImmediate(res));

/** A promise whose resolve/reject are exposed, to gate a job mid-flight. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(fn: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await tick();
  }
}

describe("ComputeJobQueue", () => {
  it("runs a job to success and retains its result", async () => {
    const q = new ComputeJobQueue(2, 60_000, 100);
    const view = q.submit({ type: "unit", run: async () => 42 });
    expect(view.id).toBeDefined();
    await waitFor(() => q.get(view.id)?.status === "succeeded");
    const done = q.get(view.id);
    expect(done?.result).toBe(42);
    expect(done?.finishedAt).toBeDefined();
    q.clear();
  });

  it("captures the error of a failing job", async () => {
    const q = new ComputeJobQueue(1, 60_000, 100);
    const view = q.submit({
      type: "unit",
      run: async () => {
        throw new Error("boom");
      }
    });
    await waitFor(() => q.get(view.id)?.status === "failed");
    expect(q.get(view.id)?.error).toBe("boom");
    q.clear();
  });

  it("never exceeds its concurrency limit", async () => {
    const q = new ComputeJobQueue(2, 60_000, 100);
    let active = 0;
    let maxActive = 0;
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const views: ComputeJobView[] = gates.map((g, i) =>
      q.submit({
        type: "unit",
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await g.promise;
          active -= 1;
          return i;
        }
      })
    );
    // Let the queue start as many as it is allowed to.
    await waitFor(() => active === 2);
    expect(maxActive).toBe(2);
    // Release them one at a time; the queue should keep topping up to 2.
    gates[0].resolve();
    await waitFor(() => views.filter(v => q.get(v.id)?.status === "succeeded").length >= 1);
    gates[1].resolve();
    gates[2].resolve();
    gates[3].resolve();
    await waitFor(() =>
      views.every(v => q.get(v.id)?.status === "succeeded")
    );
    expect(maxActive).toBe(2);
    q.clear();
  });

  it("reports progress as batches complete", async () => {
    const q = new ComputeJobQueue(1, 60_000, 100);
    const gate = deferred();
    const view = q.submit({
      type: "unit",
      total: 3,
      run: async (_signal, onProgress) => {
        onProgress(1);
        onProgress(2);
        await gate.promise;
        onProgress(3);
        return "ok";
      }
    });
    await waitFor(() => q.get(view.id)?.progress.done === 2);
    const mid = q.get(view.id);
    expect(mid?.progress.total).toBe(3);
    expect(mid?.status).toBe("running");
    gate.resolve();
    await waitFor(() => q.get(view.id)?.status === "succeeded");
    expect(q.get(view.id)?.progress.done).toBe(3);
    q.clear();
  });

  it("cancels a queued job before it starts", async () => {
    const q = new ComputeJobQueue(1, 60_000, 100);
    const gate = deferred();
    const first = q.submit({ type: "unit", run: async () => gate.promise });
    const second = q.submit({ type: "unit", run: async () => "second" });
    await waitFor(() => q.get(first.id)?.status === "running");
    expect(q.get(second.id)?.status).toBe("queued");
    expect(q.cancel(second.id)).toBe(true);
    expect(q.get(second.id)?.status).toBe("canceled");
    gate.resolve();
    await waitFor(() => q.get(first.id)?.status === "succeeded");
    q.clear();
  });

  it("aborts a running job on cancel", async () => {
    const q = new ComputeJobQueue(1, 60_000, 100);
    let sawAbort = false;
    const view = q.submit({
      type: "unit",
      run: (signal) =>
        new Promise((_res, rej) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            rej(new Error("aborted"));
          });
        })
    });
    await waitFor(() => q.get(view.id)?.status === "running");
    expect(q.cancel(view.id)).toBe(true);
    await waitFor(() => q.get(view.id)?.status === "canceled");
    expect(sawAbort).toBe(true);
    q.clear();
  });

  it("evicts a finished result after its TTL", async () => {
    const q = new ComputeJobQueue(1, 20, 100);
    const view = q.submit({ type: "unit", run: async () => 1 });
    await waitFor(() => q.get(view.id)?.status === "succeeded");
    await waitFor(() => q.get(view.id) === undefined, 1000);
    expect(q.get(view.id)).toBeUndefined();
    q.clear();
  });
});
