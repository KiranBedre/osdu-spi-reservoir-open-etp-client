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

// Phase 4 of the dedicated-compute design (docs/computeServerDesign.md §4):
// some compute is naturally a *job*, not a request/response (e.g. recomputing
// stats / bulk where-multi targeting over a whole dataspace). Such jobs are
// idempotent and read-only, so they can be fanned out over the stateless
// compute tier. This is an in-process, bounded-concurrency async job runner:
// the REST wrapper accepts a job, returns an id immediately, and drains the
// work against the compute endpoint (ControllerUtils routes compute sessions
// to `etpComputeUrl`). Results are retained in memory with a TTL so a client
// can poll for completion.

import { v4 as uuidRandom } from "uuid";

import Logging from "../../common/Logging";

const logger = Logging.getLogger("EtpClient");

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export type ComputeJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

/**
 * The unit of work run by the queue. `run` receives an {@link AbortSignal}
 * that is aborted when the job is canceled, and an optional progress callback
 * so long multi-batch jobs can report `done/total`.
 */
export type ComputeJobRunner = (
  signal: AbortSignal,
  onProgress: (done: number) => void
) => Promise<unknown>;

export interface ComputeJobDescriptor {
  /** Coarse job kind, surfaced in status (e.g. `"where-multi"`). */
  type: string;
  /** Total number of work items, for progress reporting (optional). */
  total?: number;
  run: ComputeJobRunner;
}

export interface ComputeJobView {
  id: string;
  type: string;
  status: ComputeJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: { done: number; total: number };
  result?: unknown;
  error?: string;
}

interface ComputeJob extends ComputeJobView {
  runner: ComputeJobRunner;
  controller: AbortController;
  evictTimer?: ReturnType<typeof setTimeout>;
}

/**
 * In-process async job runner with bounded concurrency and TTL-based result
 * retention. Deliberately decoupled from the ETP layer: callers pass a `run`
 * closure (which, for compute jobs, opens compute-routed sessions and folds
 * arrays), so the queue itself is trivially unit-testable.
 */
export class ComputeJobQueue {
  private readonly jobs = new Map<string, ComputeJob>();
  private readonly waiting: string[] = [];
  private running = 0;

  constructor(
    private readonly concurrency: number = readPositiveInt(
      "RDMS_COMPUTE_JOB_CONCURRENCY",
      2
    ),
    /** How long a finished job's result is retained before eviction (ms). */
    private readonly ttlMs: number = readPositiveInt(
      "RDMS_COMPUTE_JOB_TTL_MS",
      60 * 60 * 1000
    ),
    /** Hard cap on retained jobs; oldest finished jobs are evicted first. */
    private readonly maxJobs: number = readPositiveInt(
      "RDMS_COMPUTE_JOB_MAX",
      100
    )
  ) {}

  submit(descriptor: ComputeJobDescriptor): ComputeJobView {
    this.enforceCap();
    const id = uuidRandom();
    const job: ComputeJob = {
      id,
      type: descriptor.type,
      status: "queued",
      createdAt: new Date().toISOString(),
      progress: { done: 0, total: Math.max(0, descriptor.total ?? 0) },
      runner: descriptor.run,
      controller: new AbortController()
    };
    this.jobs.set(id, job);
    this.waiting.push(id);
    this.pump();
    return toView(job);
  }

  get(id: string): ComputeJobView | undefined {
    const job = this.jobs.get(id);
    return job ? toView(job) : undefined;
  }

  list(): ComputeJobView[] {
    return [...this.jobs.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(toView);
  }

  /**
   * Cancel a queued or running job. Returns false if the job is unknown or
   * already finished. Cancellation is cooperative: the runner must honour the
   * {@link AbortSignal}.
   */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) {
      return false;
    }
    if (job.status === "queued") {
      const idx = this.waiting.indexOf(id);
      if (idx >= 0) {
        this.waiting.splice(idx, 1);
      }
      this.finish(job, "canceled", undefined, "Job canceled before start");
      return true;
    }
    if (job.status === "running") {
      job.controller.abort();
      return true;
    }
    return false;
  }

  /** Test/shutdown helper: abort everything and drop all retained results. */
  clear(): void {
    for (const job of this.jobs.values()) {
      job.controller.abort();
      if (job.evictTimer) {
        clearTimeout(job.evictTimer);
      }
    }
    this.jobs.clear();
    this.waiting.length = 0;
    this.running = 0;
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length > 0) {
      const id = this.waiting.shift();
      if (id === undefined) {
        break;
      }
      const job = this.jobs.get(id);
      if (!job || job.status !== "queued") {
        continue;
      }
      void this.execute(job);
    }
  }

  private async execute(job: ComputeJob): Promise<void> {
    this.running += 1;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    const onProgress = (done: number) => {
      job.progress.done = Math.max(0, Math.floor(done));
    };
    try {
      const result = await job.runner(job.controller.signal, onProgress);
      if (job.controller.signal.aborted) {
        this.finish(job, "canceled", undefined, "Job canceled");
      } else {
        this.finish(job, "succeeded", result);
      }
    } catch (err) {
      if (job.controller.signal.aborted) {
        this.finish(job, "canceled", undefined, "Job canceled");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Compute job ${job.id} (${job.type}) failed: ${message}`);
        this.finish(job, "failed", undefined, message);
      }
    } finally {
      this.running -= 1;
      this.pump();
    }
  }

  private finish(
    job: ComputeJob,
    status: ComputeJobStatus,
    result?: unknown,
    error?: string
  ): void {
    job.status = status;
    job.finishedAt = new Date().toISOString();
    job.result = result;
    job.error = error;
    if (job.evictTimer) {
      clearTimeout(job.evictTimer);
    }
    job.evictTimer = setTimeout(() => {
      this.jobs.delete(job.id);
    }, this.ttlMs);
    // Node keeps the event loop alive for pending timers; a retention timer
    // must not hold the process open on its own.
    if (typeof job.evictTimer.unref === "function") {
      job.evictTimer.unref();
    }
  }

  private enforceCap(): void {
    if (this.jobs.size < this.maxJobs) {
      return;
    }
    const finished = [...this.jobs.values()]
      .filter(j => j.finishedAt !== undefined)
      .sort((a, b) => (a.finishedAt ?? "").localeCompare(b.finishedAt ?? ""));
    const evict = finished[0];
    if (evict) {
      if (evict.evictTimer) {
        clearTimeout(evict.evictTimer);
      }
      this.jobs.delete(evict.id);
    }
  }
}

function toView(job: ComputeJob): ComputeJobView {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: { ...job.progress },
    result: job.result,
    error: job.error
  };
}

/** Process-wide singleton used by the REST controller. */
export const computeJobQueue = new ComputeJobQueue();
