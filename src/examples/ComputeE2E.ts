// ============================================================================
// Copyright 2019-2026 Emerson Paradigm Holding LLC. All rights reserved.
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

// ---------------------------------------------------------------------------
// Client -> server compute e2e (NO MOCKS).
//
// Proves the compute-routing split proposed by Richard Cognot: array folds
// (STATS / REDUCE / WHERE / WHEREN) are served off a *compute-role* server
// while discovery and writes stay on the *store-role* server.
//
// Topology (both servers share one Postgres and one dataspace):
//   RDMS_ETP_STORE_URL   store-role openETPServer (full protocol set)
//   RDMS_ETP_COMPUTE_URL compute-role openETPServer (RDMS_SERVER_ROLE=compute,
//                        advertises only {Core, DataArray}, read-only)
//   RDMS_ETP_SPACE       optional substring to pick the seeded dataspace
//
// Flow:
//   1. discover arrays on the STORE session (a compute-role server cannot do
//      Discovery/Store, so discovery MUST go to the store)
//   2. fold STATS / REDUCE / WHERE / WHEREN on the COMPUTE session
//   3. assert a write on the COMPUTE session is REJECTED (role write-guard)
//
// Exit code 0 = all checks passed, 1 = a check failed, 2 = fatal/setup error.
// ---------------------------------------------------------------------------

import {
  EtpUri,
  IDataArray,
  IResqmlDataObject,
  ResqmlClient,
  URI,
  XmlUtils,
  byteToString
} from "..";

const storeUrl = process.env.RDMS_ETP_STORE_URL || "ws://localhost:9102/";
const computeUrl = process.env.RDMS_ETP_COMPUTE_URL || "ws://localhost:9106/";
const spaceFilter = process.env.RDMS_ETP_SPACE || "";

const jwt = XmlUtils.createDefaultJWT();

/* eslint-disable no-console */
const log = (...a: unknown[]) => console.log("[compute-e2e]", ...a);

let failures = 0;
const check = (cond: boolean, msg: string): void => {
  if (cond) {
    log(`PASS: ${msg}`);
  } else {
    failures++;
    console.error(`[compute-e2e] FAIL: ${msg}`);
  }
};

interface FoundArray {
  epcUri: string;
  path: string;
  dims: number[];
}

async function discoverArrays(store: ResqmlClient): Promise<FoundArray[]> {
  const spaces = (await store.getDataspaces()) ?? [];
  check(spaces.length > 0, `store lists ${spaces.length} dataspace(s)`);
  const space =
    (spaceFilter
      ? spaces.find(s => s.uri.includes(spaceFilter))
      : spaces[0]) ?? spaces[0];
  check(!!space, `selected dataspace ${space?.uri}`);
  if (!space) {
    return [];
  }

  const resources = await store.getDataspaceResources(space.uri);
  const dobs = await store.getDataObjects(resources.map(r => r.uri));

  const found: FoundArray[] = [];
  for (const dob of dobs) {
    if (!dob) {
      continue;
    }
    const xml = byteToString(dob.data);
    const jsObj = (await XmlUtils.xml2typescript(
      xml,
      new EtpUri(dob.resource.uri).dataObjectType
    )) as IResqmlDataObject;
    if (!jsObj) {
      continue;
    }
    const arrs = new Map<URI, IDataArray>();
    store.findDataArrays(dob.resource.uri, jsObj, arrs);
    for (const a of arrs.values()) {
      found.push({
        epcUri: a.uid.uri,
        path: a.uid.pathInResource,
        dims: a.dimensions ?? []
      });
    }
  }
  return found;
}

async function main(): Promise<void> {
  const store = new ResqmlClient();
  store.setCallsTraceability(false);
  const compute = new ResqmlClient();
  compute.setCallsTraceability(false);

  log(`store=${storeUrl} compute=${computeUrl} spaceFilter='${spaceFilter}'`);
  await store.openSession(storeUrl, jwt, undefined, undefined, undefined, 20000000);
  await compute.openSession(computeUrl, jwt, undefined, undefined, undefined, 20000000);

  try {
    // 1. discovery on the STORE session ------------------------------------
    const found = await discoverArrays(store);
    check(found.length > 0, `discovered ${found.length} data array(s) via store`);
    if (found.length === 0) {
      throw new Error("no data arrays discovered - was the epc imported?");
    }

    const target =
      found.find(f => f.epcUri.includes("EpcExternalPartReference")) ?? found[0];
    check(
      target.epcUri.includes("EpcExternalPartReference"),
      `array uri resolves to an EpcExternalPartReference (${target.epcUri})`
    );
    log(`target path=${target.path} dims=[${target.dims.join(",")}]`);

    // 2a. STATS on the COMPUTE session -------------------------------------
    const stats = await compute.getDataArrayStats(target.epcUri, target.path);
    check(stats !== null, "compute STATS returned a summary (not null)");
    if (stats) {
      check(stats.valid, "STATS valid flag is true");
      check(stats.count > 0, `STATS count ${stats.count} > 0`);
      check(
        stats.minimum !== undefined &&
          stats.maximum !== undefined &&
          stats.minimum <= stats.maximum,
        `STATS min ${stats.minimum} <= max ${stats.maximum}`
      );
      log(
        "stats:",
        JSON.stringify({
          count: stats.count,
          min: stats.minimum,
          max: stats.maximum,
          mean: stats.mean
        })
      );
    }

    // 2b. REDUCE(sum) on the COMPUTE session -------------------------------
    const reduce = await compute.getDataArrayReduce(
      target.epcUri,
      target.path,
      "sum"
    );
    check(reduce !== null, "compute REDUCE(sum) returned a result");

    // 2c. WHERE over the full [min, max] range -----------------------------
    if (stats && stats.minimum !== undefined && stats.maximum !== undefined) {
      const where = await compute.getDataArrayWhere(target.epcUri, target.path, {
        lo: stats.minimum,
        hi: stats.maximum
      });
      check(where !== null, "compute WHERE returned a result");
      if (where) {
        check(
          where.count > 0,
          `WHERE count ${where.count} > 0 over the full value range`
        );
      }
    }

    // 2d. WHEREN (multi-array AND) when two same-shape arrays exist --------
    const byShape = new Map<string, FoundArray[]>();
    for (const f of found) {
      const size = f.dims.reduce((p, c) => p * c, 1);
      if (f.dims.length === 0 || size === 0) {
        continue;
      }
      const key = f.dims.join("x");
      const bucket = byShape.get(key);
      if (bucket) {
        bucket.push(f);
      } else {
        byShape.set(key, [f]);
      }
    }
    const pair = [...byShape.values()].find(v => v.length >= 2);
    if (pair && stats && stats.minimum !== undefined && stats.maximum !== undefined) {
      const wm = await compute.getDataArrayWhereMulti([
        {
          uri: pair[0].epcUri,
          pathInResource: pair[0].path,
          range: { lo: stats.minimum, hi: stats.maximum }
        },
        {
          uri: pair[1].epcUri,
          pathInResource: pair[1].path,
          range: { lo: -1e30, hi: 1e30 }
        }
      ]);
      check(wm !== null, "compute WHEREN(multi) returned a result");
    } else {
      log("skip WHEREN: need two arrays of the same non-empty shape");
    }

    // 3. a write on the COMPUTE role must be REJECTED ----------------------
    let writeRejected = false;
    let writeError = "";
    try {
      await compute.putDataArray(
        { uri: target.epcUri, pathInResource: target.path },
        target.dims.length ? target.dims : [1],
        Float64Array.from([0])
      );
    } catch (e) {
      writeRejected = true;
      writeError = (e as Error).message;
    }
    check(
      writeRejected,
      `compute role REJECTS putDataArray (read-only write guard)${
        writeError ? ` [${writeError}]` : ""
      }`
    );
  } finally {
    await compute.closeSession().catch(() => undefined);
    await store.closeSession().catch(() => undefined);
  }

  if (failures > 0) {
    console.error(`[compute-e2e] ${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  log("ALL CHECKS PASSED");
  process.exit(0);
}

main().catch(e => {
  console.error("[compute-e2e] FATAL", e);
  process.exit(2);
});
