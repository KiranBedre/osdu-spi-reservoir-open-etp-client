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
// Server-side compute SCALING benchmark (NO MOCKS).
//
// Answers: "is the array-compute feature feasible for larger data sets?".
//
// For each element count N it overwrites one declared, writable property array
// in the store (the ingest fixture was h5; the bytes now live in the server kv
// store / Postgres) and times the server-side folds that return ONLY a summary,
// never the array bytes:
//   STATS(A)            min/max/mean/count
//   REDUCE(sum, A)      full-array sum
//   ARITH mul(A, 2)     C = 2*A written back in place (the new write path)
//
// The headline is that the summary payload stays tiny (a few numbers) and the
// wall time grows ~linearly with N, while the equivalent "download N doubles
// and fold on the client" would transfer 8*N bytes every call.
//
// Env: RDMS_ETP_STORE_URL (default ws://localhost:9102/)
//      RDMS_ETP_SPACE     (default Drogon)
//      ARITH_BENCH_SIZES  (default "10000,100000,1000000,10000000")
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
const spaceFilter = process.env.RDMS_ETP_SPACE || "Drogon";
const sizes = (process.env.ARITH_BENCH_SIZES || "10000,100000,1000000,10000000")
  .split(",")
  .map(s => Number(s.trim()))
  .filter(n => Number.isFinite(n) && n > 1);

const jwt = XmlUtils.createDefaultJWT();

/* eslint-disable no-console */
const log = (...a: unknown[]) => console.log("[arith-bench]", ...a);

interface Target {
  epcUri: string;
  path: string;
}

async function findWritableArray(
  store: ResqmlClient
): Promise<Target | undefined> {
  const spaces = (await store.getDataspaces()) ?? [];
  const space =
    (spaceFilter ? spaces.find(s => s.uri.includes(spaceFilter)) : spaces[0]) ??
    spaces[0];
  if (!space) {
    return undefined;
  }
  const resources = await store.getDataspaceResources(space.uri);
  const dobs = await store.getDataObjects(resources.map(r => r.uri));
  for (const dob of dobs) {
    if (!dob) {
      continue;
    }
    const dot = new EtpUri(dob.resource.uri).dataObjectType ?? "";
    if (!/ContinuousProperty/.test(dot)) {
      continue;
    }
    const jsObj = (await XmlUtils.xml2typescript(
      byteToString(dob.data),
      dot
    )) as IResqmlDataObject;
    if (!jsObj) {
      continue;
    }
    const arrs = new Map<URI, IDataArray>();
    store.findDataArrays(dob.resource.uri, jsObj, arrs);
    for (const a of arrs.values()) {
      if (a.uid.uri.includes("EpcExternalPartReference")) {
        return { epcUri: a.uid.uri, path: a.uid.pathInResource };
      }
    }
  }
  return undefined;
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = process.hrtime.bigint();
  const r = await fn();
  const t1 = process.hrtime.bigint();
  return [r, Number(t1 - t0) / 1e6]; // ms
}

async function median(fn: () => Promise<void>, runs = 3): Promise<number> {
  const xs: number[] = [];
  for (let i = 0; i < runs; i++) {
    const [, ms] = await timed(fn);
    xs.push(ms);
  }
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)];
}

function fmt(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
}

async function main(): Promise<void> {
  const store = new ResqmlClient();
  store.setCallsTraceability(false);
  log(`store=${storeUrl} sizes=[${sizes.join(",")}]`);
  await store.openSession(storeUrl, jwt, undefined, undefined, undefined, 20000000);

  try {
    const target = await findWritableArray(store);
    if (!target) {
      throw new Error("no writable ContinuousProperty array found to benchmark");
    }
    log(`target array: ${target.path}`);
    const { epcUri, path } = target;
    const uid = { uri: epcUri, pathInResource: path };

    console.log(
      "\n    N        bytes     upload      STATS      REDUCE(sum)   ARITH mul(A,2)"
    );
    console.log(
      "  -------   --------   --------    --------    -----------   --------------"
    );

    for (const N of sizes) {
      // Fill with strictly-positive, null-free values so every element is valid.
      const data = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        data[i] = 1 + (i % 997) * 1e-3;
      }
      const bytes = N * 8;

      const [, upMs] = await timed(() => store.putDataArray(uid, [N], data));

      let statsCount = 0;
      const statsMs = await median(async () => {
        const s = await store.getDataArrayStats(epcUri, path);
        statsCount = Number(s?.count ?? 0);
      });

      let reduceOk = false;
      const reduceMs = await median(async () => {
        const r = await store.getDataArrayReduce(epcUri, path, "sum");
        reduceOk = !!r;
      });

      let arithTotal = 0;
      const arithMs = await median(async () => {
        const a = await store.getDataArrayArith(
          epcUri,
          path,
          "mul",
          epcUri,
          path,
          { scalar: 2, kind: "scalar" }
        );
        arithTotal = Number(a?.total ?? 0);
      });

      const mb = (bytes / 1e6).toFixed(1) + "MB";
      console.log(
        `  ${N.toString().padStart(8)}  ${mb.padStart(8)}  ${fmt(upMs).padStart(8)}  ` +
          `${fmt(statsMs).padStart(9)}  ${fmt(reduceMs).padStart(11)}  ${fmt(arithMs).padStart(13)}` +
          `   [stats.count=${statsCount} reduce=${reduceOk} arith.total=${arithTotal}]`
      );
    }
    console.log("");
    log("benchmark complete");
  } finally {
    await store.closeSession();
  }
}

main().catch(e => {
  console.error("[arith-bench] FATAL", e);
  process.exit(2);
});
