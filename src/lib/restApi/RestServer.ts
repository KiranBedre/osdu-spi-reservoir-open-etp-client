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

import http from "http";

import app from "./App";
import { restApiPort } from "./ControllerUtils";
import { drainTransactions, drainSessionPool } from "./ControllerUtils";
import { initSchemaVersions } from "../jsonTypes/MilestoneKinds";
import Logging from "../common/Logging";
import MetricsProvider from "./monitoring.module/Metrics.provider";

const logger = Logging.getLogger("EtpClient");

let server: http.Server;
let metricsProvider: MetricsProvider | undefined;

/**
 * Record a process-level error (unhandled rejection / uncaught exception) to
 * the structured logger and the Prometheus error counter. Uses the same
 * `any_error_counter` metric as {@link ExceptionCounterFilter} so process-level
 * failures show up alongside request-level ones.
 */
const recordProcessError = (kind: string, error: unknown): void => {
  logger.error({ kind, error }, `${kind} captured at process level`);
  try {
    metricsProvider
      ?.registerCounterMetric("any_error_counter", "Number of errors", [
        "exception_type",
        "additional_info"
      ])
      .labels(kind, "")
      .inc();
  } catch (metricErr) {
    logger.error({ metricErr }, "Failed to record process-error metric");
  }
};

const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, starting graceful shutdown`);
  if (server) {
    server.close();
  }
  await Promise.race([
    Promise.all([drainTransactions(), drainSessionPool()]),
    new Promise(resolve => setTimeout(resolve, 30_000))
  ]);
  process.exit(0);
};

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

// A rejected promise nobody awaited is the usual symptom of a missing `await`
// on a write/commit/close. Surface it loudly instead of letting Node print a
// bare stack (or, on future Node versions, crash) with no metric.
process.on("unhandledRejection", (reason: unknown) => {
  recordProcessError("unhandled_rejection", reason);
});

// After an uncaught exception the process state is undefined; log, count, then
// drain and exit non-zero so the orchestrator restarts us cleanly.
process.on("uncaughtException", (error: Error) => {
  recordProcessError("uncaught_exception", error);
  void gracefulShutdown("uncaughtException").finally(() => process.exit(1));
});

const main = async (p: number): Promise<void> => {
  await initSchemaVersions();
  const nestApp = await app();
  metricsProvider = nestApp.get(MetricsProvider, { strict: false });
  server = nestApp.getHttpServer();
  await nestApp.listen(p);
};

main(restApiPort).catch(error => {
  logger.error({ error }, "Fatal error during REST server startup");
  process.exit(1);
});
