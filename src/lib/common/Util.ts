/*
 *License notice
 *
 * Energistics copyright 2015-
 * Energistics Transfer Protocol
 *
 * All rights of any portion thereof, shall remain with Energistics or its suppliers
 * and shall remain subject to the terms of the Product License Agreement available at
 * http://www.energistics.org/product-license-agreement.
 *
 * Apache
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file
 * except in compliance with the License.
 *
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the
 * License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
 * either express or implied.
 *
 * See the License for the specific language governing permissions and limitations under the
 * License.
 *
 * All rights reserved.
 *
 */

import { SchemaCache as AvroSchemaCache } from "./EtpAvro";
import schemas from "./EtpSchemas";
import { ErrorCode } from "./EtpTypes";

export class SchemaCache extends AvroSchemaCache {
  constructor(types: any = schemas.types) {
    super(types);
    this.createProtocolMap();
  }
  public find(protocol: number, messageType: number): any {
    // High-numbered messages are multi-protocol
    if (messageType >= 1000) {
      protocol = 0;
    }
    const schemaName: string | undefined = this.schemaName(
      protocol,
      messageType
    );
    if (schemaName) {
      return this.findSchema(schemaName);
    }

    throw new Error(`Schema for [${protocol}:${messageType}] not found.`);
  }

  public createProtocolMap(): void {
    return undefined;
  }
}

/**
 * Provides a retry mechanism with exponential backoff
 *
 * @param fn Function to retry
 * @param {number} retriesLeft  Number of retries
 * @param {number} interval Time interval (ms) after first retry
 * @param {number} factor Factor to increase the interval between retries
 * @returns the result of the function
 * @throws error after last unsuccessful retry
 */
export const retry = async <T>(
  fn: () => Promise<T>,
  retriesLeft = 6,
  interval = 400,
  factor = 2
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    if (retriesLeft) {
      await new Promise(resolve => setTimeout(resolve, interval));
      return retry(fn, retriesLeft - 1, interval * factor, factor);
    }
    throw error;
  }
};

/**
 * Provides a retry mechanism with exponential backoff, when an etp request fails with a specific error codes
 *
 * @param fn Function to retry
 * @param {ErrorCode[]} errorCodes Error codes to retry on
 * @param {number} retriesLeft  Number of retries
 * @param {number} interval Time interval (ms) after first retry
 * @param {number} factor Factor to increase the interval between retries
 * @returns the result of the function
 * @throws error after last unsuccessful retry
 */
export const retryOnEtpErrors = async <T>(
  fn: () => Promise<T>,
  errorCodes: [ErrorCode],
  retriesLeft = 6,
  interval = 400,
  factor = 2
): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    if (retriesLeft && errorCodes.indexOf(error.code) != -1) {
      await new Promise(resolve => setTimeout(resolve, interval));
      return retryOnEtpErrors(
        fn,
        errorCodes,
        retriesLeft - 1,
        interval * factor,
        factor
      );
    }
    throw error;
  }
};

/**
 * Read a positive integer from an environment variable, clamped to
 * `[min, max]`. Unset, empty, or non-numeric values fall back to `def`.
 * Centralises tuning knobs so concurrency/backpressure limits are
 * configurable per deployment without a rebuild.
 *
 * @param name environment variable name
 * @param def default when unset / invalid
 * @param min inclusive lower bound (default 1)
 * @param max inclusive upper bound (default Number.MAX_SAFE_INTEGER)
 */
export const envInt = (
  name: string,
  def: number,
  min = 1,
  max = Number.MAX_SAFE_INTEGER
): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return Math.min(max, Math.max(min, def));
  }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return Math.min(max, Math.max(min, def));
  }
  return Math.min(max, Math.max(min, n));
};

/**
 * Centralised, environment-overridable concurrency limits. Defaults match the
 * previously hard-coded literals, so behaviour is unchanged unless the
 * corresponding env var is set. Implemented as getters so overrides (and
 * tests) take effect without re-importing the module.
 */
export const concurrency = {
  /** Object-conversion worker pool width (`RDMS_CONCURRENCY_CONVERT`). */
  get convert(): number {
    return envInt("RDMS_CONCURRENCY_CONVERT", 32);
  },
  /** Bulk-fetch worker pool width (`RDMS_CONCURRENCY_FETCH`). */
  get fetch(): number {
    return envInt("RDMS_CONCURRENCY_FETCH", 16);
  },
  /** Index-fetch worker pool width (`RDMS_CONCURRENCY_INDEX`). */
  get index(): number {
    return envInt("RDMS_CONCURRENCY_INDEX", 8);
  },
  /** List-fetch worker pool width (`RDMS_CONCURRENCY_LIST`). */
  get list(): number {
    return envInt("RDMS_CONCURRENCY_LIST", 8);
  }
};

/**
 * Outbound-socket backpressure high-water mark in bytes
 * (`RDMS_SOCKET_HWM_BYTES`, default 8 MiB). `0` disables backpressure.
 */
export const socketHighWaterMark = (): number =>
  envInt("RDMS_SOCKET_HWM_BYTES", 8 * 1024 * 1024, 0);

/**
 * Classic bounded-concurrency limiter. Returns a function that queues calls so
 * that at most `n` of them are in flight at once, resolving/rejecting exactly
 * like the wrapped promise.
 *
 * @param n maximum number of concurrently running tasks (coerced to >= 1)
 */
export const pLimit = (
  n: number
): (<T>(fn: () => Promise<T>) => Promise<T>) => {
  const limit = Math.max(1, Math.floor(n) || 1);
  let active = 0;
  const queue: Array<() => void> = [];
  const next = (): void => {
    active--;
    const run = queue.shift();
    if (run) {
      run();
    }
  };
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = (): void => {
        active++;
        // Defer settlement handling so `next` always runs after this task
        // settles, regardless of sync throws inside `fn`.
        Promise.resolve().then(fn).then(resolve, reject).finally(next);
      };
      if (active < limit) {
        run();
      } else {
        queue.push(run);
      }
    });
};

/**
 * Map over `items` with bounded concurrency, preserving input order in the
 * resolved array (like `Promise.all(items.map(fn))` but with at most `n`
 * in-flight tasks). Rejects on the first task rejection.
 *
 * @param items inputs to map
 * @param n maximum number of concurrent tasks
 * @param fn async mapper invoked with `(item, index)`
 */
export const mapLimit = async <T, R>(
  items: readonly T[],
  n: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const run = pLimit(n);
  return Promise.all(items.map((item, i) => run(() => fn(item, i))));
};
