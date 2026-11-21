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
// Client -> server array-arithmetic e2e (NO MOCKS).
//
// Exercises the server-side ARITH extension end-to-end through the TypeScript
// client's new ArrayCustomer.arith()/ResqmlClient.getDataArrayArith().
//
// NOTE on storage: the server keeps array bytes in its kv store (Postgres), NOT
// in .h5 files. The h5/epc are only client-side ingest fixtures; once ingested,
// a ContinuousProperty's values live in the server as a declared ETP array that
// arith reads/writes. No h5 file is touched at compute time.
//
//   1. discover a declared property operand array A (with real values)
//   2. use that same declared, writable property array in place as target C
//   3. C = mul(A, 2)       (scalar) -> assert C == 2*A elementwise
//   4. C = add(A, A)       (binary) -> assert C == 2*A elementwise
//   5. C = affine(A;0.5,0) (unary)  -> assert C == 0.5*A elementwise
//   6. assert the returned summary echoes op/kind and counts every element
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
const spaceFilter = process.env.RDMS_ETP_SPACE || "Drogon";

const jwt = XmlUtils.createDefaultJWT();

/* eslint-disable no-console */
const log = (...a: unknown[]) => console.log("[arith-e2e]", ...a);

let failures = 0;
const check = (cond: boolean, msg: string): void => {
  if (cond) {
    log(`PASS: ${msg}`);
  } else {
    failures++;
    console.error(`[arith-e2e] FAIL: ${msg}`);
  }
};

interface FoundArray {
  propUri: string;
  epcUri: string;
  path: string;
  dims: number[];
}

async function discoverArrays(store: ResqmlClient): Promise<FoundArray[]> {
  const spaces = (await store.getDataspaces()) ?? [];
  const space =
    (spaceFilter ? spaces.find(s => s.uri.includes(spaceFilter)) : spaces[0]) ??
    spaces[0];
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
    // Only cell PROPERTY arrays are valid, writable arith operands/targets.
    // These are stored in the server's kv store (Postgres) as proper declared
    // arrays with a valid epc_guid (the h5 was only the client-side ingest
    // fixture). Geometry/points arrays (grid geometry, representations) have no
    // writable epc_guid and must never be used as an arith target.
    const dot = new EtpUri(dob.resource.uri).dataObjectType ?? "";
    if (!/ContinuousProperty|DiscreteProperty/.test(dot)) {
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
      // Only external-part-backed arrays (stored in the server kv store) are
      // writable arith operands/targets; skip self-describing constant arrays.
      if (!a.uid.uri.includes("EpcExternalPartReference")) {
        continue;
      }
      found.push({
        propUri: dob.resource.uri,
        epcUri: a.uid.uri,
        path: a.uid.pathInResource,
        dims: a.dimensions ?? []
      });
    }
  }
  return found;
}

function approxEq(a: number, b: number, eps = 1e-6): boolean {
  if (Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= eps * scale;
}

async function readValues(
  store: ResqmlClient,
  uri: string,
  path: string
): Promise<number[]> {
  const da = await store.getDataArray(uri, path);
  // IDataArray.data is a nested ETP union: { data: { item: { _ArrayOf<T>: { values } } } }
  const inner = (da?.data as unknown as { data?: { item?: Record<string, unknown> } })
    ?.data?.item;
  if (!inner) {
    throw new Error(`could not read array ${uri} ${path}`);
  }
  const key = Object.keys(inner).find(k => k.startsWith("_ArrayOf"));
  if (!key) {
    throw new Error(`no _ArrayOf* member in ${uri} ${path}`);
  }
  const member = inner[key] as { values?: ArrayLike<number> };
  const values = member?.values;
  if (!values) {
    throw new Error(`no values in ${uri} ${path}`);
  }
  return Array.from(values, v => Number(v));
}

async function main(): Promise<void> {
  const store = new ResqmlClient();
  store.setCallsTraceability(false);
  log(`store=${storeUrl} spaceFilter='${spaceFilter}'`);
  await store.openSession(
    storeUrl,
    jwt,
    undefined,
    undefined,
    undefined,
    20000000
  );

  try {
    const found = await discoverArrays(store);
    check(found.length > 0, `discovered ${found.length} declared property array(s)`);
    // discovery does not populate dimensions; describe + read arrays until we
    // find a small, non-empty, declared, readable property array. The arith
    // target C must be a *declared* writable array, so we reuse this same
    // declared property array in place as C (snapshotting + restoring around
    // each op), which is the only kind of array the store will upsert into.
    let A: FoundArray | undefined;
    let origA: number[] = [];
    for (const f of found) {
      const meta = await store.getDataArrayMetadata(f.propUri, f.path);
      const dims = (meta?.dimensions ?? []).map(d => Number(d));
      const n = dims.reduce((p, c) => p * c, 1);
      if (dims.length === 0 || n <= 1 || n > 200000) {
        continue;
      }
      try {
        const vals = await readValues(store, f.propUri, f.path);
        if (vals.length === n && vals.some(v => !Number.isNaN(v) && v !== 0)) {
          A = { ...f, dims };
          origA = vals;
          break;
        }
      } catch {
        // not readable (e.g. integer/geometry array) - keep looking
      }
    }
    check(!!A, "found a non-empty, declared, readable operand array A");
    if (!A) {
      throw new Error("no suitable readable property array discovered");
    }
    const count = A.dims.reduce((p, c) => p * c, 1);
    log(`operand A: path=${A.path} dims=[${A.dims.join(",")}] count=${count}`);
    check(origA.length === count, `read A (${origA.length} elements)`);

    // C is the SAME declared array, written in place; restore after each op.
    const aUri = A.epcUri;
    const aPath = A.path;
    const restore = async (): Promise<void> => {
      await store.putDataArray(
        { uri: aUri, pathInResource: aPath },
        A!.dims,
        Float64Array.from(origA)
      );
    };

    // --- scalar: C = mul(A, 2), written in place -------------------------
    const rScalar = await store.getDataArrayArith(
      aUri,
      aPath,
      "mul",
      aUri,
      aPath,
      { scalar: 2, kind: "scalar" }
    );
    check(rScalar !== null, "scalar mul(A,2) returned a summary (not null)");
    if (rScalar) {
      check(rScalar.op === "mul", `scalar summary op='mul' (${rScalar.op})`);
      check(rScalar.kind === "scalar", `scalar summary kind='scalar'`);
      check(rScalar.total === count, `scalar total=${rScalar.total}==${count}`);
      const c = await readValues(store, aUri, aPath);
      const ok = c.every((v, i) => approxEq(v, 2 * origA[i]));
      check(ok, `A == 2*A0 elementwise after scalar mul`);
    }
    await restore();

    // --- binary: C = add(A, A), written in place -------------------------
    const rBinary = await store.getDataArrayArith(
      aUri,
      aPath,
      "add",
      aUri,
      aPath,
      { operandB: aUri, operandBPathInResource: aPath, kind: "binary" }
    );
    check(rBinary !== null, "binary add(A,A) returned a summary");
    if (rBinary) {
      check(rBinary.kind === "binary", `binary summary kind='binary'`);
      const c = await readValues(store, aUri, aPath);
      const ok = c.every((v, i) => approxEq(v, origA[i] + origA[i]));
      check(ok, `A == A0+A0 elementwise after binary add`);
    }
    await restore();

    // --- unary: C = affine(A; a=0.5, b=0), written in place --------------
    const rUnary = await store.getDataArrayArith(
      aUri,
      aPath,
      "affine",
      aUri,
      aPath,
      { scalar: 0.5, scalar2: 0, kind: "unary" }
    );
    check(rUnary !== null, "unary affine(A;0.5,0) returned a summary");
    if (rUnary) {
      check(rUnary.kind === "unary", `unary summary kind='unary'`);
      const c = await readValues(store, aUri, aPath);
      const ok = c.every((v, i) => approxEq(v, 0.5 * origA[i]));
      check(ok, `A == 0.5*A0 elementwise after unary affine`);
    }
    await restore();
  } finally {
    await store.closeSession().catch(() => undefined);
  }

  if (failures > 0) {
    console.error(`[arith-e2e] ${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  log("ALL CHECKS PASSED");
  process.exit(0);
}

main().catch(e => {
  console.error("[arith-e2e] FATAL", e);
  process.exit(2);
});
