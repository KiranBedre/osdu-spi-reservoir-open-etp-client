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

import { BaseHandler } from "../common/BaseHandler";
import {
  MapResponseHandler,
  SuccessMapResponseHandler
} from "../common/ResponseHandlers";

import { ETPCore } from "../common/ETPCore";
import { Energistics, Integer32, Integer64 } from "../common/Etp12";

import {
  DataValue,
  ErrorCode,
  ErrorInfo,
  IArrayId,
  IDataArray,
  IDataArrayMetadata,
  IDataSubarray
} from "../common/EtpTypes";
import Logging from "../common/Logging";

const statsLogger = Logging.getLogger("EtpClient");

export type AnyTypedArray =
  | string
  | Uint8Array
  | Int8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Uint8ClampedArray
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

export interface IArrayInfo {
  logicalType: Energistics.Etp.v12.Datatypes.AnyLogicalArrayType;
  transportType: Energistics.Etp.v12.Datatypes.AnyArrayType;
  size: number;
}

export interface IHDF5ArrayInput {
  data: AnyTypedArray;
  uid: IArrayId;
  preferredSubArrayDimensions?: Integer32[];
  customData: Map<string, DataValue>;
}

interface ISubArrayId extends IArrayId {
  /**
   * @description index of first item in each dimension
   * @maxItems 10
   */
  starts?: Integer32[];
  /**
   * @description number of items in each dimension
   * @maxItems 10
   */
  counts?: Integer32[];
}

/**
 * Fixed-size summary computed server-side by the store (open-etp-server
 * `GetDataArrayStats`) and returned in {@link IDataArrayMetadata.customData}.
 * The array bytes never leave the store; only this O(1) summary is shipped.
 */
export interface IArrayStatsSummary {
  /** false when the array held no finite value (all null/NaN or non-numeric). */
  valid: boolean;
  /** finite (non-null) values folded into the summary. */
  count: number;
  /** explicit-null + NaN values that were skipped. */
  nullCount: number;
  minimum?: number;
  maximum?: number;
  mean?: number;
  /** population standard deviation. */
  stddev?: number;
  sum?: number;
  /** finite values inside the requested [lo, hi] range (only when a range was asked). */
  inRangeCount?: number;
  rangeLo?: number;
  rangeHi?: number;
  /**
   * Per-bin counts of a fixed-width histogram over `[histLo, histHi]`, folded
   * in the same pass (only when a bin count was requested via `STATS|lo|hi|bins`).
   * Bin `i` covers `[histLo + i*w, histLo + (i+1)*w)` with `w = (histHi-histLo)/bins`.
   */
  histogram?: number[];
  /** number of histogram bins (== `histogram.length`). */
  histBins?: number;
  histLo?: number;
  histHi?: number;
  /** finite values below `histLo` (not counted in any bin). */
  histUnderflow?: number;
  /** finite values above `histHi` (not counted in any bin). */
  histOverflow?: number;
  /**
   * Percentiles interpolated from the cumulative histogram (only when a bin
   * count was requested). Approximate to within one bin width; clamped to
   * `[minimum, maximum]`.
   */
  p10?: number;
  p50?: number;
  p90?: number;
  /**
   * Compute wire-contract schema version stamped by the server
   * (`compute.schema`). Undefined for older servers that predate versioning;
   * a known version lets callers branch on future breaking marker/result
   * changes without guessing.
   */
  schema?: number;
}

/** Correlation-id marker recognised by the server's stats extension. */
const STATS_CID = "STATS";

/** Correlation-id markers recognised by the server's reduce/where extensions. */
const REDUCE_CID = "REDUCE";
const WHERE_CID = "WHERE";
const WHEREN_CID = "WHEREN";

/**
 * Correlation-id marker for one predicate of a multi-array (`WHEREN`) query:
 * `WHEREN|<idx 3-digit>|<lo>|<hi>`. The zero-padded index keeps the store's
 * lockstep evaluation order stable regardless of map iteration order; the
 * range travels inline because `GetDataArrayMetadata` has no payload slot.
 */
export function multiWhereCid(
  idx: number,
  range: { lo: number; hi: number }
): string {
  return `${WHEREN_CID}|${String(idx).padStart(3, "0")}|${range.lo}|${range.hi}`;
}

/**
 * Correlation-id markers recognised by the server's array-arithmetic extension.
 * The result target `C` is keyed `ARITH|<op>` (binary), `ARITH|<op>|SCALAR|<k>[|<k2>]`
 * (scalar) or `ARITH|<op>|UNARY|<k>|<k2>` (unary); the operands are keyed
 * `ARITH.IN|0` (A) and, for binary ops, `ARITH.IN|1` (B).
 */
const ARITH_CID = "ARITH";
const ARITH_IN_CID = "ARITH.IN";

/**
 * Server-side K-axis column reduction of a 3-D property `[Nk, Nj, Ni]` into a
 * 2-D `[Nj, Ni]` column map (net-pay / targeting maps), returned in
 * {@link IDataArrayMetadata.customData}. The array bytes never leave the store.
 */
export interface IArrayReduceResult {
  /** echoed operator token (`sum`/`mean`/`min`/`max`/`count`/`net`). */
  op: string;
  /** fastest grid axis of the returned map. */
  ni: number;
  /** middle grid axis of the returned map (map is row-major `[nj, ni]`). */
  nj: number;
  /** number of columns that folded at least one value. */
  columns: number;
  /** row-major `[nj, ni]` column map; empty columns are NaN (min/max/mean) or 0 (sum/count/net). */
  map: number[];
  /** compute wire-contract schema version (`compute.schema`); undefined on older servers. */
  schema?: number;
}

/**
 * Server-side masked predicate over one property: the count of cells whose
 * value is in `[lo, hi]`, their inclusive ijk bounding box, and their ijk
 * centroid (aim point). Returned in {@link IDataArrayMetadata.customData}.
 */
export interface IArrayWhereResult {
  /** false when no cell matched the predicate. */
  valid: boolean;
  /** cells with value in `[rangeLo, rangeHi]`. */
  count: number;
  rangeLo?: number;
  rangeHi?: number;
  /** inclusive ijk bounding box of the matching cells (only when valid). */
  iMin?: number;
  iMax?: number;
  jMin?: number;
  jMax?: number;
  kMin?: number;
  kMax?: number;
  /** ijk centroid (aim point) of the matching cells (only when valid). */
  ci?: number;
  cj?: number;
  ck?: number;
  /** compute wire-contract schema version (`compute.schema`); undefined on older servers. */
  schema?: number;
}

/**
 * Server-side masked predicate over several properties of the same grid: the
 * count of cells that satisfy EVERY per-array `[lo, hi]` predicate (logical
 * AND), their inclusive ijk bounding box, and their ijk centroid (aim point).
 * Returned in {@link IDataArrayMetadata.customData}. The array bytes never leave
 * the store.
 */
export interface IArrayMultiWhereResult {
  /** false when no cell satisfied all predicates. */
  valid: boolean;
  /** number of property arrays that were ANDed together. */
  arrays: number;
  /** cells satisfying every predicate (whole passing set, may be fragmented). */
  count: number;
  /** inclusive ijk bounding box of the surviving cells (only when valid). */
  iMin?: number;
  iMax?: number;
  jMin?: number;
  jMax?: number;
  kMin?: number;
  kMax?: number;
  /** ijk centroid of the whole passing set (only when valid). */
  ci?: number;
  cj?: number;
  ck?: number;

  /**
   * Largest connected body (6-connectivity over the passing cells) — the
   * drillable target. For geological targeting this is the meaningful answer:
   * one contiguous volume, not a dust of isolated cells in tight rock. Compare
   * `bodyCount` against `count` (and read `components`) to judge fragmentation.
   */
  /** number of separate connected bodies in the passing set (only when valid). */
  components?: number;
  /** cell count (volume) of the largest connected body (only when valid). */
  bodyCount?: number;
  /** inclusive ijk bounding box of the largest body (only when valid). */
  biMin?: number;
  biMax?: number;
  bjMin?: number;
  bjMax?: number;
  bkMin?: number;
  bkMax?: number;
  /** ijk centroid (aim point) of the largest body (only when valid). */
  bci?: number;
  bcj?: number;
  bck?: number;
  /** compute wire-contract schema version (`compute.schema`); undefined on older servers. */
  schema?: number;
}

/**
 * Server-side array arithmetic result: the store evaluates `C = op(A, B)`
 * (binary), `C = op(A, k)` (scalar) or `C = op(A)` (unary) **inside the store**
 * and upserts the promoted-double result into the pre-declared target array `C`.
 * Only this summary travels back over the wire; no operand or result bytes are
 * transferred. Returned in {@link IDataArrayMetadata.customData}.
 */
export interface IArrayArithResult {
  /** echoed operator token (`add`/`sub`/`mul`/.../`sqrt`/`affine`). */
  op: string;
  /** form of the operation: `binary` | `scalar` | `unary`. */
  kind: string;
  /** finite result elements written to `C`. */
  count: number;
  /** elements written as null (null-propagation / domain error, e.g. `log` of a negative). */
  nullCount: number;
  /** total elements of operand `A` (= `count` + `nullCount`). */
  total: number;
  /** compute wire-contract schema version (`compute.schema`); undefined on older servers. */
  schema?: number;
}

/** Extract a numeric scalar from an ETP {@link DataValue} union, if present. */
function dataValueToNumber(dv?: DataValue): number | undefined {
  const item = dv?.item as
    | {
      _double?: number;
      _float?: number;
      _long?: bigint | number;
      _int?: number;
    }
    | undefined;
  if (!item) {
    return undefined;
  }
  if (item._double !== undefined) {
    return item._double;
  }
  if (item._float !== undefined) {
    return item._float;
  }
  if (item._long !== undefined) {
    // ETP int64 counts/sums can exceed JS's exact-integer range (2^53-1).
    // Number() would silently round, skewing a derived mean/sum, so warn when
    // that happens instead of returning a corrupted magnitude unnoticed.
    const n = Number(item._long);
    if (!Number.isSafeInteger(n)) {
      statsLogger.warning(
        `ETP _long value ${item._long} exceeds Number.MAX_SAFE_INTEGER; ` +
        `derived stats (mean/sum) may be imprecise.`
      );
    }
    return n;
  }
  if (item._int !== undefined) {
    return item._int;
  }
  return undefined;
}

/**
 * Extract a numeric array from an ETP {@link DataValue} union when it carries an
 * `ArrayOfLong` (the shape the store uses for `stats.histogram`). int64 bin
 * counts are coerced to JS numbers; a bin that overflows the exact-integer range
 * would need billions of cells in one bin and is extremely unlikely, but we warn
 * rather than silently round if it ever happens.
 */
function dataValueToNumberArray(dv?: DataValue): number[] | undefined {
  const item = dv?.item as
    | {
      _ArrayOfLong?: { values?: (bigint | number)[] };
      _ArrayOfInt?: { values?: number[] };
      _ArrayOfDouble?: { values?: number[] };
    }
    | undefined;
  const raw =
    item?._ArrayOfLong?.values ??
    item?._ArrayOfInt?.values ??
    item?._ArrayOfDouble?.values;
  if (raw === undefined) {
    return undefined;
  }
  return raw.map(v => {
    if (typeof v === "bigint") {
      const n = Number(v);
      if (!Number.isSafeInteger(n)) {
        statsLogger.warning(
          `ETP histogram bin count ${v} exceeds Number.MAX_SAFE_INTEGER; ` +
          `the returned count may be imprecise.`
        );
      }
      return n;
    }
    return v;
  });
}

/**
 * Parse the `stats.*` entries the server stamps into
 * {@link IDataArrayMetadata.customData}. Returns null when the store did not
 * emit stats (e.g. an older server that does not understand the STATS marker),
 * so callers can fall back to a client-side reduction.
 */
export function parseArrayStats(
  metadata: IDataArrayMetadata | null | undefined
): IArrayStatsSummary | null {
  const cd = metadata?.customData;
  if (!cd) {
    return null;
  }
  const validItem = cd.get("stats.valid")?.item as
    | { _boolean?: boolean }
    | undefined;
  if (validItem?._boolean === undefined) {
    return null; // server did not produce stats
  }
  const summary: IArrayStatsSummary = {
    valid: validItem._boolean,
    count: dataValueToNumber(cd.get("stats.count")) ?? 0,
    nullCount: dataValueToNumber(cd.get("stats.nullCount")) ?? 0,
    minimum: dataValueToNumber(cd.get("stats.min")),
    maximum: dataValueToNumber(cd.get("stats.max")),
    mean: dataValueToNumber(cd.get("stats.mean")),
    stddev: dataValueToNumber(cd.get("stats.stddev")),
    sum: dataValueToNumber(cd.get("stats.sum"))
  };
  const inRange = dataValueToNumber(cd.get("stats.inRangeCount"));
  if (inRange !== undefined) {
    summary.inRangeCount = inRange;
    summary.rangeLo = dataValueToNumber(cd.get("stats.rangeLo"));
    summary.rangeHi = dataValueToNumber(cd.get("stats.rangeHi"));
  }
  const histogram = dataValueToNumberArray(cd.get("stats.histogram"));
  if (histogram !== undefined) {
    summary.histogram = histogram;
    summary.histBins =
      dataValueToNumber(cd.get("stats.histBins")) ?? histogram.length;
    summary.histLo = dataValueToNumber(cd.get("stats.histLo"));
    summary.histHi = dataValueToNumber(cd.get("stats.histHi"));
    summary.histUnderflow = dataValueToNumber(cd.get("stats.histUnderflow"));
    summary.histOverflow = dataValueToNumber(cd.get("stats.histOverflow"));
    summary.p10 = dataValueToNumber(cd.get("stats.p10"));
    summary.p50 = dataValueToNumber(cd.get("stats.p50"));
    summary.p90 = dataValueToNumber(cd.get("stats.p90"));
  }
  const schema = dataValueToNumber(cd.get("compute.schema"));
  if (schema !== undefined) {
    summary.schema = schema;
  }
  return summary;
}

/** Extract a UTF-8 string scalar from an ETP {@link DataValue} union, if present. */
function dataValueToString(dv?: DataValue): string | undefined {
  const item = dv?.item as { _string?: string } | undefined;
  return item?._string;
}

/**
 * Parse the `reduce.*` entries the server stamps into
 * {@link IDataArrayMetadata.customData}. Returns null when the store did not
 * emit a reduce result (e.g. an older server), so callers can fall back.
 */
export function parseArrayReduce(
  metadata: IDataArrayMetadata | null | undefined
): IArrayReduceResult | null {
  const cd = metadata?.customData;
  if (!cd) {
    return null;
  }
  const map = dataValueToNumberArray(cd.get("reduce.map"));
  if (map === undefined) {
    return null; // server did not produce a reduce result
  }
  return {
    op: dataValueToString(cd.get("reduce.op")) ?? "",
    ni: dataValueToNumber(cd.get("reduce.ni")) ?? 0,
    nj: dataValueToNumber(cd.get("reduce.nj")) ?? 0,
    columns: dataValueToNumber(cd.get("reduce.columns")) ?? 0,
    map,
    schema: dataValueToNumber(cd.get("compute.schema"))
  };
}

/**
 * Parse the `where.*` entries the server stamps into
 * {@link IDataArrayMetadata.customData}. Returns null when the store did not
 * emit a where result (e.g. an older server), so callers can fall back.
 */
export function parseArrayWhere(
  metadata: IDataArrayMetadata | null | undefined
): IArrayWhereResult | null {
  const cd = metadata?.customData;
  if (!cd) {
    return null;
  }
  const validItem = cd.get("where.valid")?.item as
    | { _boolean?: boolean }
    | undefined;
  if (validItem?._boolean === undefined) {
    return null; // server did not produce a where result
  }
  const result: IArrayWhereResult = {
    valid: validItem._boolean,
    count: dataValueToNumber(cd.get("where.count")) ?? 0,
    rangeLo: dataValueToNumber(cd.get("where.rangeLo")),
    rangeHi: dataValueToNumber(cd.get("where.rangeHi"))
  };
  if (result.valid) {
    result.iMin = dataValueToNumber(cd.get("where.iMin"));
    result.iMax = dataValueToNumber(cd.get("where.iMax"));
    result.jMin = dataValueToNumber(cd.get("where.jMin"));
    result.jMax = dataValueToNumber(cd.get("where.jMax"));
    result.kMin = dataValueToNumber(cd.get("where.kMin"));
    result.kMax = dataValueToNumber(cd.get("where.kMax"));
    result.ci = dataValueToNumber(cd.get("where.ci"));
    result.cj = dataValueToNumber(cd.get("where.cj"));
    result.ck = dataValueToNumber(cd.get("where.ck"));
  }
  const whereSchema = dataValueToNumber(cd.get("compute.schema"));
  if (whereSchema !== undefined) {
    result.schema = whereSchema;
  }
  return result;
}

/**
 * Parse the `where.*` entries of a multi-array (`WHEREN`) masked predicate the
 * server stamps into {@link IDataArrayMetadata.customData}. Identical to
 * {@link parseArrayWhere} but also surfaces `where.arrays` (the number of ANDed
 * predicates). Returns null when the store did not emit a where result (e.g. an
 * older server that does not understand the WHEREN marker).
 */
export function parseArrayMultiWhere(
  metadata: IDataArrayMetadata | null | undefined
): IArrayMultiWhereResult | null {
  const cd = metadata?.customData;
  if (!cd) {
    return null;
  }
  const validItem = cd.get("where.valid")?.item as
    | { _boolean?: boolean }
    | undefined;
  if (validItem?._boolean === undefined) {
    return null; // server did not produce a where result
  }
  const result: IArrayMultiWhereResult = {
    valid: validItem._boolean,
    arrays: dataValueToNumber(cd.get("where.arrays")) ?? 0,
    count: dataValueToNumber(cd.get("where.count")) ?? 0
  };
  if (result.valid) {
    result.iMin = dataValueToNumber(cd.get("where.iMin"));
    result.iMax = dataValueToNumber(cd.get("where.iMax"));
    result.jMin = dataValueToNumber(cd.get("where.jMin"));
    result.jMax = dataValueToNumber(cd.get("where.jMax"));
    result.kMin = dataValueToNumber(cd.get("where.kMin"));
    result.kMax = dataValueToNumber(cd.get("where.kMax"));
    result.ci = dataValueToNumber(cd.get("where.ci"));
    result.cj = dataValueToNumber(cd.get("where.cj"));
    result.ck = dataValueToNumber(cd.get("where.ck"));
    result.components = dataValueToNumber(cd.get("where.components"));
    result.bodyCount = dataValueToNumber(cd.get("where.bodyCount"));
    result.biMin = dataValueToNumber(cd.get("where.biMin"));
    result.biMax = dataValueToNumber(cd.get("where.biMax"));
    result.bjMin = dataValueToNumber(cd.get("where.bjMin"));
    result.bjMax = dataValueToNumber(cd.get("where.bjMax"));
    result.bkMin = dataValueToNumber(cd.get("where.bkMin"));
    result.bkMax = dataValueToNumber(cd.get("where.bkMax"));
    result.bci = dataValueToNumber(cd.get("where.bci"));
    result.bcj = dataValueToNumber(cd.get("where.bcj"));
    result.bck = dataValueToNumber(cd.get("where.bck"));
  }
  const multiSchema = dataValueToNumber(cd.get("compute.schema"));
  if (multiSchema !== undefined) {
    result.schema = multiSchema;
  }
  return result;
}

/**
 * Parse the `arith.*` entries the server stamps into
 * {@link IDataArrayMetadata.customData}. Returns null when the store did not
 * emit an arith result (e.g. an older server that does not understand the ARITH
 * marker), so callers can detect an unsupported store. A failed operation
 * (unknown op, shape mismatch, missing operand) is surfaced as a thrown ETP
 * error rather than a null result.
 */
export function parseArrayArith(
  metadata: IDataArrayMetadata | null | undefined
): IArrayArithResult | null {
  const cd = metadata?.customData;
  if (!cd) {
    return null;
  }
  const op = dataValueToString(cd.get("arith.op"));
  if (op === undefined) {
    return null; // server did not produce an arith result
  }
  return {
    op,
    kind: dataValueToString(cd.get("arith.kind")) ?? "",
    count: dataValueToNumber(cd.get("arith.count")) ?? 0,
    nullCount: dataValueToNumber(cd.get("arith.nullCount")) ?? 0,
    total: dataValueToNumber(cd.get("arith.total")) ?? 0,
    schema: dataValueToNumber(cd.get("compute.schema"))
  };
}

const Core = Energistics.Etp.v12.Protocol.Core;
const DataArray = Energistics.Etp.v12.Protocol.DataArray;
const Protocols = Energistics.Etp.v12.Datatypes.Protocol;

/** Map storing information for promises returning array of {@link DataSubarray} */

export type MessageBody = any;

/**
 * Implementation of client for DataArray protocol
 *
 * @export
 * @class ArrayCustomer
 * @extends {BaseHandler}
 */
export default class ArrayCustomer extends BaseHandler {
  /**
   * Get the transport data array type from an input
   *
   * @static
   * @param {AnyTypedArray} arrayInput
   * @returns {Energistics.Etp.v12.Datatypes.AnyArrayType}
   * @memberof ArrayCustomer
   */
  public static getTransportArrayType(
    arrayInput: AnyTypedArray
  ): Energistics.Etp.v12.Datatypes.AnyArrayType {
    switch (arrayInput.constructor) {
      case Int16Array:
      case Uint16Array:
      case Uint8ClampedArray:
      case Int32Array:
      case Uint32Array:
        return Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfInt;
      case Float32Array:
        return Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfFloat;
      case Float64Array:
        return Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfDouble;
      case Uint8Array:
      case Int8Array:
      default:
        return Energistics.Etp.v12.Datatypes.AnyArrayType.bytes;
    }
  }

  /**
   * Get the data array type from an input
   *
   * @static
   * @param {AnyTypedArray} arrayInput
   * @returns {Energistics.Etp.v12.Datatypes.AnyArrayType}
   * @memberof ArrayCustomer
   */
  public static getLogicalArrayType(
    arrayInput: AnyTypedArray
  ): Energistics.Etp.v12.Datatypes.AnyLogicalArrayType {
    switch (arrayInput.constructor) {
      case Int16Array:
        return Energistics.Etp.v12.Datatypes.AnyLogicalArrayType.arrayOfInt16LE;
      case Uint16Array:
        return Energistics.Etp.v12.Datatypes.AnyLogicalArrayType
          .arrayOfUInt16LE;
      case Int32Array:
        return Energistics.Etp.v12.Datatypes.AnyLogicalArrayType.arrayOfInt32LE;
      case Uint32Array:
        return Energistics.Etp.v12.Datatypes.AnyLogicalArrayType
          .arrayOfUInt32LE;
      case Float32Array:
        return Energistics.Etp.v12.Datatypes.AnyLogicalArrayType
          .arrayOfFloat32LE;
      case Float64Array:
        return Energistics.Etp.v12.Datatypes.AnyLogicalArrayType
          .arrayOfDouble64LE;
      case Uint8Array:
      case Int8Array:
      case Uint8ClampedArray:
      default:
        return Energistics.Etp.v12.Datatypes.AnyLogicalArrayType.arrayOfUInt8;
    }
  }

  /**
   * Compute the number of bytes that an array will take based on its HDF5 description
   *
   * @static
   * @param {AnyTypedArray} array
   * @returns {number} size in bytes
   * @memberof ArrayCustomer
   */
  public static getArraySize(array: AnyTypedArray): number {
    const transportType: Energistics.Etp.v12.Datatypes.AnyArrayType =
      ArrayCustomer.getTransportArrayType(array);
    if (typeof array === "object") {
      return array.byteLength;
    } else {
      if (transportType === Energistics.Etp.v12.Datatypes.AnyArrayType.bytes) {
        return array.length;
      } else if (
        transportType === Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfInt
      ) {
        return array.length * 5; // Avro encoding require 5 for maxint
      } else if (
        transportType === Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfLong
      ) {
        return array.length * 10; // Avro encoding may require 10
      } else if (
        transportType ===
        Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfDouble
      ) {
        return array.length * 10;
      }
    }
    return array.length * 5;
  }

  /**
   * Compute the number of bytes that an array will take based on its metadata
   *
   * @static
   * @param {IDataArrayMetadata} desc
   * @param {number[]} [dimensions] dimensions of the array, if different from metadata
   * @returns {number} size in bytes
   * @memberof ArrayCustomer
   */
  public static getArraySizeFromMetaData(
    desc: IDataArrayMetadata,
    dimensions: number[] | undefined = desc.dimensions
  ): number {
    if (
      !dimensions ||
      desc.logicalArrayType === undefined ||
      desc.transportArrayType === undefined
    ) {
      return 0;
    }
    const size = dimensions.reduce((p, c) => p * Number(c), 1);
    return size * ArrayCustomer.getElementSizeFromMetaData(desc);
  }

  /**
   * Compute the size of a single item in the array in bytes
   *
   * @static
   * @param {IDataArrayMetadata} desc
   * @returns {number} size in bytes
   * @memberof ArrayCustomer
   */
  public static getElementSizeFromMetaData(desc: IDataArrayMetadata): number {
    if (!desc.dimensions || desc.transportArrayType === undefined) {
      return 0;
    }

    switch (desc.transportArrayType) {
      case Energistics.Etp.v12.Datatypes.AnyArrayType.bytes:
      case Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfBoolean:
      case Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfString:
        return 1;
      case Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfDouble:
      case Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfLong:
        return 10;
      default:
        return 5;
    }
  }

  /**
   * Fill an AnyArray data structure with an array of numbers
   *
   * @static
   * @param {AnyTypedArray} array
   * @param {number[] | Integer64[]} values
   * @returns {Energistics.Etp.v12.Datatypes.AnyArray}
   * @memberof ArrayCustomer
   */
  public static createDataFromValues(
    array: AnyTypedArray,
    values: number[] | Integer64[]
  ): Energistics.Etp.v12.Datatypes.AnyArray {
    switch (array.constructor.name) {
      case "Int16Array":
      case "Uint16Array":
      case "Uint8ClampedArray":
      case "Int32Array":
      case "Uint32Array":
        return {
          item: {
            _ArrayOfInt: { values: values as number[] },
            __keyName: "_ArrayOfInt"
          }
        };
      case "BigInt64Array":
      case "BigUint64Array":
        return {
          item: {
            _ArrayOfLong: { values: values as Integer64[] },
            __keyName: "_ArrayOfLong"
          }
        };
      case "Float32Array":
        return {
          item: {
            _ArrayOfFloat: { values: values as number[] },
            __keyName: "_ArrayOfFloat"
          }
        };
      case "Float64Array":
        return {
          item: {
            _ArrayOfDouble: { values: values as number[] },
            __keyName: "_ArrayOfDouble"
          }
        };
      case "String":
        return {
          item: {
            _ArrayOfBoolean: { values: (values as number[]).map(v => !!v) },
            __keyName: "_ArrayOfBoolean"
          }
        };
      case "Uint8Array":
      case "Int8Array":
      default:
        return {
          item: {
            __keyName: "_bytes",
            _bytes: ArrayBuffer.isView(values)
              ? Buffer.from(values.buffer, values.byteOffset, values.byteLength)
              : Buffer.from(values as number[])
          }
        };
    }
  }

  /**
   * Used to convert from array of (null|T) to array of T
   *
   * @static
   * @param {(Array<IDataSubarray | null> | null | undefined)} value
   * @returns {value is Array<IDataSubarray>}
   * @memberof ArrayCustomer
   */
  public static subArrayNotEmpty(
    value: Array<IDataSubarray | null> | null | undefined
  ): value is IDataSubarray[] {
    return (
      value !== null &&
      value !== undefined &&
      value.length === 1 &&
      value[0] !== null
    );
  }

  /**
   * Compute dimensions from array input
   *
   * @static
   * @param {IHDF5ArrayInput} array
   * @returns {Integer32[]}
   * @memberof ArrayCustomer
   */
  public static computeDataArrayDimensions(array: IHDF5ArrayInput): number[] {
    if (typeof array.data === "object") {
      const o: any = array.data;
      const rank = o.rank;
      if (rank) {
        switch (rank) {
          case 1:
            return [o.rows];
          case 2:
            return [o.rows, o.columns];
          case 3:
            return [o.sections, o.rows, o.columns];
          case 4:
            return [o.rows, o.columns, o.sections, o.files];
          default:
            return [];
        }
      }
    }
    return [array.data.length];
  }

  private readonly sessionManager: ETPCore;
  private readonly dataArrayResolve;
  private readonly dataArrayMetadataResolve;
  private readonly dataSubarrayResolve;
  private readonly successResolve;
  private readonly keyToId;

  constructor(sessionManager: ETPCore) {
    super(sessionManager);
    this.sessionManager = sessionManager;
    this._role = "customer";
    this._protocol = Protocols.DataArray;
    this.successResolve = new SuccessMapResponseHandler(
      sessionManager.responseTimeoutPeriod
    );
    this.dataArrayResolve = new MapResponseHandler<IDataArray>(
      sessionManager.responseTimeoutPeriod
    );
    this.dataArrayMetadataResolve = new MapResponseHandler<IDataArrayMetadata>(
      sessionManager.responseTimeoutPeriod
    );
    this.dataSubarrayResolve = new MapResponseHandler<IDataSubarray>(
      sessionManager.responseTimeoutPeriod
    );
    this.keyToId = new Map<string, ISubArrayId>();
  }

  private pushArrayId(requestId: Integer64, key: string, arrayId: ISubArrayId) {
    this.keyToId.set(`${requestId}:${key}`, arrayId);
  }

  private popArrayId(
    requestId: Integer64,
    key: string
  ): ISubArrayId | undefined {
    const k = `${requestId}:${key}`;
    const arrayId = this.keyToId.get(k);
    if (arrayId) {
      this.keyToId.delete(k);
    }
    return arrayId;
  }

  /**
   * Get the information about a DataArray
   *
   * @param {Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArray} array
   * @returns {IArrayInfo}
   * @memberof ArrayCustomer
   */
  public getArrayInfo(
    array: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArray
  ): IArrayInfo {
    const dimensions: Integer32[] = array.dimensions.map(Number);

    let size = dimensions.reduce((p, c) => p * c, 1);
    let logicalType: Energistics.Etp.v12.Datatypes.AnyLogicalArrayType = 0;
    let transportType: Energistics.Etp.v12.Datatypes.AnyArrayType = 0;
    switch (array.data.item.__keyName) {
      case "_ArrayOfBoolean":
        transportType =
          Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfBoolean;
        logicalType =
          Energistics.Etp.v12.Datatypes.AnyLogicalArrayType.arrayOfBoolean;
        size *= 4;
        break;
      case "_ArrayOfInt":
        transportType = Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfInt;
        logicalType =
          Energistics.Etp.v12.Datatypes.AnyLogicalArrayType.arrayOfInt32LE;
        size *= 5;
        break;
      case "_ArrayOfLong":
        transportType = Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfLong;
        logicalType =
          Energistics.Etp.v12.Datatypes.AnyLogicalArrayType.arrayOfInt64LE;
        size *= 10;
        break;
      case "_ArrayOfFloat":
        transportType = Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfFloat;
        logicalType =
          Energistics.Etp.v12.Datatypes.AnyLogicalArrayType.arrayOfFloat32LE;
        size *= 4;
        break;
      case "_ArrayOfDouble":
        transportType =
          Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfDouble;
        logicalType =
          Energistics.Etp.v12.Datatypes.AnyLogicalArrayType.arrayOfDouble64LE;
        size *= 8;
        break;
      case "_ArrayOfString":
        if (array.data.item._ArrayOfString) {
          return {
            transportType:
              Energistics.Etp.v12.Datatypes.AnyArrayType.arrayOfString,
            logicalType:
              Energistics.Etp.v12.Datatypes.AnyLogicalArrayType.arrayOfString,
            size:
              array.data.item._ArrayOfString?.values.reduce(
                (prev, cur) => prev + cur.length,
                0
              ) * 4
          };
        }
        break;
      default:
        transportType = Energistics.Etp.v12.Datatypes.AnyArrayType.bytes;
        logicalType =
          Energistics.Etp.v12.Datatypes.AnyLogicalArrayType.arrayOfUInt8;
    }
    return { logicalType, transportType, size };
  }

  /**
   * Build a subarray from a slice of a large one
   *
   * @param {Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArray} array
   * @param {Integer32} start
   * @param {Integer32} end
   * @returns {Energistics.Etp.v12.Datatypes.AnyArray}
   * @memberof ArrayCustomer
   */
  public getArraySlice(
    array: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArray,
    start: Integer32,
    end: Integer32
  ): Energistics.Etp.v12.Datatypes.AnyArray {
    switch (array.data.item.__keyName) {
      case "_ArrayOfBoolean":
        if (array.data.item._ArrayOfBoolean) {
          return {
            item: {
              _ArrayOfBoolean: {
                values: array.data.item._ArrayOfBoolean.values.slice(start, end)
              },
              __keyName: "_ArrayOfBoolean"
            }
          };
        }
        break;
      case "_ArrayOfInt":
        if (array.data.item._ArrayOfInt) {
          return {
            item: {
              _ArrayOfInt: {
                values: array.data.item._ArrayOfInt.values.slice(start, end)
              },
              __keyName: "_ArrayOfInt"
            }
          };
        }
        break;
      case "_ArrayOfLong":
        if (array.data.item._ArrayOfLong) {
          return {
            item: {
              _ArrayOfLong: {
                values: array.data.item._ArrayOfLong.values.slice(start, end)
              },
              __keyName: "_ArrayOfLong"
            }
          };
        }
        break;
      case "_ArrayOfFloat":
        if (array.data.item._ArrayOfFloat) {
          return {
            item: {
              _ArrayOfFloat: {
                values: array.data.item._ArrayOfFloat.values.slice(start, end)
              },
              __keyName: "_ArrayOfFloat"
            }
          };
        }
        break;
      case "_ArrayOfDouble":
        if (array.data.item._ArrayOfDouble) {
          return {
            item: {
              _ArrayOfDouble: {
                values: array.data.item._ArrayOfDouble.values.slice(start, end)
              },
              __keyName: "_ArrayOfDouble"
            }
          };
        }
        break;
      case "_ArrayOfString":
        if (array.data.item._ArrayOfString) {
          return {
            item: {
              _ArrayOfString: {
                values: array.data.item._ArrayOfString.values.slice(start, end)
              },
              __keyName: "_ArrayOfString"
            }
          };
        }
        break;
    }
    return {
      item: {
        _bytes: array.data.item._bytes?.subarray(start, end),
        __keyName: "_bytes"
      }
    };
  }

  /**
   * Create a promise to send a subArray
   *
   * @param {IArrayId} uid
   * @param {Integer32[]} starts
   * @param {Integer32[]} counts
   * @param {AnyTypedArray} array
   * @param {(number[] | Integer64[])} values
   * @returns {Promise<boolean>}
   * @memberof ArrayCustomer
   * @async
   */
  public async sendSubArray(
    uid: IArrayId,
    starts: Integer32[],
    counts: Integer32[],
    array: AnyTypedArray,
    values: number[] | Integer64[]
  ): Promise<boolean> {
    const da: Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataSubarraysType =
    {
      counts: counts.map(BigInt),
      data: ArrayCustomer.createDataFromValues(array, values),
      starts: starts.map(BigInt),
      uid
    };
    return this.putSubarrays([da])
      .then(b => b.map(e => e.code === ErrorCode.IS_OK))
      .then(b => b.reduce((p, c) => p && c, true));
  }

  public handleMessage(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody: MessageBody
  ): void {
    if (messageHeader.protocol === Protocols.DataArray) {
      switch (messageHeader.messageType) {
        case DataArray.MsgGetDataArraysResponse: {
          this.logTrace(
            `Received DataArray.GetDataArraysResponse message for ${messageHeader.correlationId}.`
          );
          const body =
            messageBody as Energistics.Etp.v12.Protocol.DataArray.GetDataArraysResponse;
          this.onGetDataArraysResponse(messageHeader, body);
          break;
        }
        case DataArray.MsgPutDataArraysResponse: {
          this.logTrace(
            `Received DataArray.PutDataArraysResponse message for ${messageHeader.correlationId}.`
          );
          this.successResolve.onResponse(messageHeader, messageBody.success);
          break;
        }
        case DataArray.MsgGetDataSubarraysResponse: {
          this.logTrace(
            `Received DataArray.GetDataSubarraysResponse message for ${messageHeader.correlationId}.`
          );
          const bodySubarray =
            messageBody as Energistics.Etp.v12.Protocol.DataArray.GetDataSubarraysResponse;
          this.onGetDataSubarraysResponse(messageHeader, bodySubarray);
          break;
        }
        case DataArray.MsgPutDataSubarraysResponse: {
          this.logTrace(
            `Received DataArray.PutDataSubarraysResponse message for ${messageHeader.correlationId}.`
          );
          this.successResolve.onResponse(messageHeader, messageBody.success);
          break;
        }
        case DataArray.MsgGetDataArrayMetadataResponse: {
          this.logTrace(
            `Received DataArray.GetDataArrayMetadataResponse message for ${messageHeader.correlationId}.`
          );
          const bodyMetadata =
            messageBody as Energistics.Etp.v12.Protocol.DataArray.GetDataArrayMetadataResponse;
          this.onGetDataArrayMetadataResponse(messageHeader, bodyMetadata);
          break;
        }
        case DataArray.MsgPutUninitializedDataArraysResponse: {
          this.logTrace(
            `Received DataArray.PutUninitializedDataArraysResponse message for ${messageHeader.correlationId}.`
          );
          this.successResolve.onResponse(messageHeader, messageBody.success);
          break;
        }
        case Core.MsgProtocolException: {
          this.logTrace(
            `Received DataArray.ProtocolException message for ${messageHeader.correlationId}.`
          );
          this.onProtocolException(
            messageHeader,
            messageBody as Energistics.Etp.v12.Protocol.Core.ProtocolException
          );
          break;
        }
        default: {
          super.handleMessage(messageHeader, messageBody);
        }
      }
    } else {
      throw new Error(
        `Unsupported protocol ${messageHeader.protocol} in DataArrayStore`
      );
    }
  }
  public get(
    dataArrayIds: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier[]
  ): Promise<Array<IDataArray | null>> {
    dataArrayIds.forEach(d =>
      this.logTrace(
        `Getting data ${d.uri}, ${d.pathInResource} from data array`
      )
    );
    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgGetDataArrays,
      BigInt(0)
    );

    const getDataArray =
      new Energistics.Etp.v12.Protocol.DataArray.GetDataArrays();
    dataArrayIds.forEach(d => {
      const key = `${d.uri}${d.pathInResource}`;
      getDataArray.dataArrays.set(key, { ...d, uri: encodeURI(d.uri) });
    });

    this.logTrace(
      `Sending DataArray.GetDataArrays message ${header.messageId}.`
    );

    const keys: string[] = [];
    const requestId = this.sessionManager.send(header, getDataArray);
    dataArrayIds.forEach(d => {
      const key = `${d.uri}${d.pathInResource}`;
      this.pushArrayId(requestId, key, d);
      keys.push(key);
    });

    return this.dataArrayResolve.waitForRequest(requestId, keys);
  }

  public describe(
    dataArrayIds: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier[]
  ): Promise<Array<IDataArrayMetadata | null>> {
    dataArrayIds.forEach(d =>
      this.logTrace(
        `Getting metadata ${d.uri}, ${d.pathInResource} from data array`
      )
    );
    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgGetDataArrayMetadata,
      BigInt(0)
    );

    const describeDataArrayMetadata =
      new Energistics.Etp.v12.Protocol.DataArray.GetDataArrayMetadata();
    dataArrayIds.forEach(d => {
      const key = `${d.uri}${d.pathInResource}`;
      describeDataArrayMetadata.dataArrays.set(key, {
        ...d,
        uri: encodeURI(d.uri)
      });
    });

    this.logTrace(
      `Sending DataArray.GetDataArrayMetadata message ${header.messageId}.`
    );

    const keys: string[] = [];
    const requestId = this.sessionManager.send(
      header,
      describeDataArrayMetadata
    );
    dataArrayIds.forEach(d => {
      const key = `${d.uri}${d.pathInResource}`;
      this.pushArrayId(requestId, key, {
        ...d,
        uri: encodeURI(d.uri)
      });
      keys.push(key);
    });
    return this.dataArrayMetadataResolve.waitForRequest(requestId, keys);
  }

  /**
   * Ask the store to fold a single array into a fixed-size summary and return
   * it, without ever transferring the array bytes. Implemented as a
   * `GetDataArrayMetadata` whose correlation-id carries the `STATS` marker
   * (optionally `STATS|lo|hi` for an in-pass range count, or `STATS|lo|hi|bins`
   * to also fold a `bins`-bin histogram over `[lo, hi]` and derive p10/p50/p90);
   * the server replies with the summary in {@link IDataArrayMetadata.customData}.
   * Returns null (and leaves the caller to fall back) when the store does not
   * support it.
   *
   * @param dataArrayId array to summarise
   * @param range optional inclusive [lo, hi] predicate counted in the same pass
   * @param histogramBins optional number of fixed bins over `[lo, hi]`; requires
   *   `range` (the histogram shares the range domain). Ignored when <= 0 or when
   *   no range is supplied.
   */
  /**
   * True when the server positively advertised its endpoint capabilities WITHOUT
   * `supportedArrayExtensions` -- a known un-updated M27 store that cannot run the
   * array-compute reductions. An `undefined` capability (never negotiated, e.g. a
   * unit test with a mocked session) is NOT treated as a guard hit, so existing
   * behaviour and the per-request null fallback are preserved.
   */
  private serverLacksArrayCompute(): boolean {
    return this.sessionManager.serverSupportsArrayExtensions === false;
  }

  public async stats(
    dataArrayId: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier,
    range?: { lo: number; hi: number },
    histogramBins?: number
  ): Promise<IArrayStatsSummary | null> {
    if (this.serverLacksArrayCompute()) {
      return null;
    }
    const wantHist =
      range !== undefined &&
      histogramBins !== undefined &&
      Number.isFinite(histogramBins) &&
      histogramBins > 0;
    const cid =
      range !== undefined
        ? wantHist
          ? `${STATS_CID}|${range.lo}|${range.hi}|${Math.floor(
            histogramBins as number
          )}`
          : `${STATS_CID}|${range.lo}|${range.hi}`
        : STATS_CID;

    this.logTrace(
      `Getting stats ${dataArrayId.uri}, ${dataArrayId.pathInResource} (cid=${cid})`
    );

    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgGetDataArrayMetadata,
      BigInt(0)
    );

    const statsRequest =
      new Energistics.Etp.v12.Protocol.DataArray.GetDataArrayMetadata();
    statsRequest.dataArrays.set(cid, {
      ...dataArrayId,
      uri: encodeURI(dataArrayId.uri)
    });

    this.logTrace(
      `Sending DataArray.GetDataArrayMetadata (stats) message ${header.messageId}.`
    );

    const requestId = this.sessionManager.send(header, statsRequest);
    this.pushArrayId(requestId, cid, {
      ...dataArrayId,
      uri: encodeURI(dataArrayId.uri)
    });

    const results = await this.dataArrayMetadataResolve.waitForRequest(
      requestId,
      [cid]
    );
    return parseArrayStats(results.length === 1 ? results[0] : null);
  }

  /**
   * Ask the store to collapse a 3-D property `[Nk, Nj, Ni]` over the K axis into
   * a 2-D `[Nj, Ni]` column map (net-pay / targeting maps) without transferring
   * the array bytes. Implemented as a `GetDataArrayMetadata` whose correlation-id
   * carries the `REDUCE|<op>` marker (optionally restricted to a `[k0, k1)` K-zone
   * and, for `count`/`net`, a `[lo, hi]` predicate). Returns null when the store
   * does not support it, so callers can fall back to a client-side reduction.
   *
   * @param dataArrayId array to reduce
   * @param op reduction operator: `sum`, `mean`, `min`, `max`, `count`, `net`
   * @param opts optional K-zone `[k0, k1)`, `[lo, hi]` predicate (count/net), and
   *   per-cell thickness `cellDz` (net-thickness only)
   */
  public async reduce(
    dataArrayId: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier,
    op: "sum" | "mean" | "min" | "max" | "count" | "net",
    opts?: {
      kRange?: { k0: number; k1: number };
      range?: { lo: number; hi: number };
      cellDz?: number;
    }
  ): Promise<IArrayReduceResult | null> {
    if (this.serverLacksArrayCompute()) {
      return null;
    }
    // Marker grammar (server `is_array_reduce_req`):
    //   REDUCE|<op>[|<k0>|<k1>[|<lo>|<hi>[|<dz>]]]
    // Fields are positional: a range implies a K-zone slot, which must be the
    // explicit "no K-zone" placeholder `-|-` when no zone is requested. The
    // server rejects a `0|0` placeholder (k1 <= k0) as malformed.
    let cid = `${REDUCE_CID}|${op}`;
    const hasK = opts?.kRange !== undefined;
    const hasRange = opts?.range !== undefined;
    if (hasK || hasRange) {
      const kSlot = hasK
        ? `${Math.floor(opts!.kRange!.k0)}|${Math.floor(opts!.kRange!.k1)}`
        : "-|-";
      cid = `${REDUCE_CID}|${op}|${kSlot}`;
      if (hasRange) {
        cid += `|${opts!.range!.lo}|${opts!.range!.hi}`;
        if (opts?.cellDz !== undefined && opts.cellDz !== 1) {
          cid += `|${opts.cellDz}`;
        }
      }
    }

    this.logTrace(
      `Getting reduce ${dataArrayId.uri}, ${dataArrayId.pathInResource} (cid=${cid})`
    );

    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgGetDataArrayMetadata,
      BigInt(0)
    );
    const request =
      new Energistics.Etp.v12.Protocol.DataArray.GetDataArrayMetadata();
    request.dataArrays.set(cid, {
      ...dataArrayId,
      uri: encodeURI(dataArrayId.uri)
    });

    const requestId = this.sessionManager.send(header, request);
    this.pushArrayId(requestId, cid, {
      ...dataArrayId,
      uri: encodeURI(dataArrayId.uri)
    });

    const results = await this.dataArrayMetadataResolve.waitForRequest(
      requestId,
      [cid]
    );
    return parseArrayReduce(results.length === 1 ? results[0] : null);
  }

  /**
   * Ask the store to evaluate a `[lo, hi]` predicate over one property and return
   * the count of matching cells, their inclusive ijk bounding box, and their ijk
   * centroid (aim point) without transferring the array bytes. Implemented as a
   * `GetDataArrayMetadata` whose correlation-id carries the `WHERE|<lo>|<hi>`
   * marker. Returns null when the store does not support it.
   *
   * @param dataArrayId array to mask
   * @param range inclusive `[lo, hi]` predicate
   * @param andAlso optional extra `{ dataArrayId, range }` predicates; when supplied
   *   (and non-empty) the call ANDs every predicate over the shared grid and resolves
   *   to an {@link IArrayMultiWhereResult} instead (equivalent to {@link where.whereMulti}).
   */
  public async where(
    dataArrayId: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier,
    range: { lo: number; hi: number }
  ): Promise<IArrayWhereResult | null>;
  public async where(
    dataArrayId: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier,
    range: { lo: number; hi: number },
    andAlso: {
      dataArrayId: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier;
      range: { lo: number; hi: number };
    }[]
  ): Promise<IArrayMultiWhereResult | null>;
  public async where(
    dataArrayId: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier,
    range: { lo: number; hi: number },
    andAlso?: {
      dataArrayId: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier;
      range: { lo: number; hi: number };
    }[]
  ): Promise<IArrayWhereResult | IArrayMultiWhereResult | null> {
    if (andAlso && andAlso.length > 0) {
      return this.whereMulti([{ dataArrayId, range }, ...andAlso]);
    }

    if (this.serverLacksArrayCompute()) {
      return null;
    }

    const cid = `${WHERE_CID}|${range.lo}|${range.hi}`;

    this.logTrace(
      `Getting where ${dataArrayId.uri}, ${dataArrayId.pathInResource} (cid=${cid})`
    );

    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgGetDataArrayMetadata,
      BigInt(0)
    );
    const request =
      new Energistics.Etp.v12.Protocol.DataArray.GetDataArrayMetadata();
    request.dataArrays.set(cid, {
      ...dataArrayId,
      uri: encodeURI(dataArrayId.uri)
    });

    const requestId = this.sessionManager.send(header, request);
    this.pushArrayId(requestId, cid, {
      ...dataArrayId,
      uri: encodeURI(dataArrayId.uri)
    });

    const results = await this.dataArrayMetadataResolve.waitForRequest(
      requestId,
      [cid]
    );
    return parseArrayWhere(results.length === 1 ? results[0] : null);
  }

  /**
   * Ask the store to AND several `[lo, hi]` predicates over several properties of
   * the same grid and return the count of cells that satisfy EVERY predicate,
   * their inclusive ijk bounding box, and their ijk centroid (aim point) without
   * transferring any array bytes. Implemented as a single `GetDataArrayMetadata`
   * whose correlation-ids carry one `WHEREN|<idx>|<lo>|<hi>` marker per predicate;
   * the store evaluates them in lockstep over the shared grid. Returns null when
   * the store does not support it (e.g. an older server).
   *
   * All referenced arrays must share the same `[Nk, Nj, Ni]` shape.
   *
   * @param predicates one `{ dataArrayId, range }` per property to AND together
   */
  public async whereMulti(
    predicates: {
      dataArrayId: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier;
      range: { lo: number; hi: number };
    }[]
  ): Promise<IArrayMultiWhereResult | null> {
    if (predicates.length === 0) {
      return null;
    }

    if (this.serverLacksArrayCompute()) {
      return null;
    }

    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgGetDataArrayMetadata,
      BigInt(0)
    );
    const request =
      new Energistics.Etp.v12.Protocol.DataArray.GetDataArrayMetadata();

    // The store returns the single AND result under the FIRST predicate's cid.
    let firstCid = "";
    predicates.forEach((p, idx) => {
      const cid = multiWhereCid(idx, p.range);
      if (idx === 0) {
        firstCid = cid;
      }
      request.dataArrays.set(cid, {
        ...p.dataArrayId,
        uri: encodeURI(p.dataArrayId.uri)
      });
    });

    this.logTrace(
      `Getting multi-where over ${predicates.length} arrays (cid=${firstCid})`
    );

    const requestId = this.sessionManager.send(header, request);
    this.pushArrayId(requestId, firstCid, {
      ...predicates[0].dataArrayId,
      uri: encodeURI(predicates[0].dataArrayId.uri)
    });

    const results = await this.dataArrayMetadataResolve.waitForRequest(
      requestId,
      [firstCid]
    );
    return parseArrayMultiWhere(results.length === 1 ? results[0] : null);
  }

  /**
   * Ask the store to evaluate array arithmetic **inside the store** and upsert
   * the promoted-double result into the pre-declared target array `C`, without
   * transferring any operand or result bytes. Three forms:
   *   - binary `C = op(A, B)` — pass `opts.operandB`;
   *   - scalar `C = op(A, k)` — pass `opts.scalar` (and `kind: "scalar"`);
   *   - unary  `C = op(A)`    — pass `kind: "unary"` (affine uses `scalar`/`scalar2`).
   * Binary/scalar ops: `add`, `sub`, `mul`, `div`, `min`, `max`, `rsub`, `rdiv`,
   * `pow`, `mod`. Unary ops: `neg`, `abs`, `sqrt`, `log`, `exp`, `recip`, `affine`.
   * Implemented as a `GetDataArrayMetadata` whose correlation-id carries the
   * `ARITH|<op>[...]` result marker plus `ARITH.IN|0`/`ARITH.IN|1` operand markers.
   * Returns null when the store does not support the ARITH extension; a failed
   * operation (unknown op, shape mismatch, missing operand, non-writable target)
   * is surfaced as a thrown ETP error.
   *
   * @param result pre-declared target array `C` (object + array path) to upsert
   * @param op operator token
   * @param operandA operand `A` (object + array path)
   * @param opts `operandB` (binary), `scalar`/`scalar2` (scalar/affine), and the
   *   `kind` discriminator (`binary` | `scalar` | `unary`); defaults to `binary`
   *   when `operandB` is supplied, otherwise `scalar`.
   */
  public async arith(
    result: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier,
    op: string,
    operandA: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier,
    opts?: {
      operandB?: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier;
      scalar?: number;
      scalar2?: number;
      kind?: "binary" | "scalar" | "unary";
    }
  ): Promise<IArrayArithResult | null> {
    if (this.serverLacksArrayCompute()) {
      return null;
    }

    const kind =
      opts?.kind ?? (opts?.operandB !== undefined ? "binary" : "scalar");
    const isBinary = kind === "binary";
    if (isBinary && opts?.operandB === undefined) {
      throw new Error("Binary arith requires opts.operandB");
    }

    let cid = `${ARITH_CID}|${op}`;
    if (kind === "scalar") {
      cid += `|SCALAR|${opts?.scalar ?? 0}`;
      if (opts?.scalar2 !== undefined) {
        cid += `|${opts.scalar2}`;
      }
    } else if (kind === "unary") {
      cid += `|UNARY|${opts?.scalar ?? 0}|${opts?.scalar2 ?? 0}`;
    }

    this.logTrace(
      `Arith ${op} (${kind}) -> ${result.uri}, ${result.pathInResource} (cid=${cid})`
    );

    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgGetDataArrayMetadata,
      BigInt(0)
    );
    const request =
      new Energistics.Etp.v12.Protocol.DataArray.GetDataArrayMetadata();
    request.dataArrays.set(cid, {
      ...result,
      uri: encodeURI(result.uri)
    });
    request.dataArrays.set(`${ARITH_IN_CID}|0`, {
      ...operandA,
      uri: encodeURI(operandA.uri)
    });
    if (isBinary) {
      request.dataArrays.set(`${ARITH_IN_CID}|1`, {
        ...opts!.operandB!,
        uri: encodeURI(opts!.operandB!.uri)
      });
    }

    const requestId = this.sessionManager.send(header, request);
    // Only the result C comes back, keyed by the ARITH result marker.
    this.pushArrayId(requestId, cid, {
      ...result,
      uri: encodeURI(result.uri)
    });

    const results = await this.dataArrayMetadataResolve.waitForRequest(
      requestId,
      [cid]
    );
    return parseArrayArith(results.length === 1 ? results[0] : null);
  }

  public async put(
    dataArrays: Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataArraysType[]
  ): Promise<ErrorInfo[]> {
    dataArrays.forEach(d =>
      this.logTrace(
        `Putting ${d.uid.uri},${d.uid.pathInResource} in data array`
      )
    );
    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgPutDataArrays,
      BigInt(0)
    );
    const putDataArray =
      new Energistics.Etp.v12.Protocol.DataArray.PutDataArrays();
    const keys: string[] = [];
    dataArrays.forEach(d => {
      const key = `${d.uid.uri}/${d.uid.pathInResource}`;
      putDataArray.dataArrays.set(key, {
        ...d,
        uid: {
          uri: encodeURI(d.uid.uri),
          pathInResource: d.uid.pathInResource
        }
      });
      keys.push(key);
    });
    this.logTrace(`Sending DataArray.PutDataArrays ${header.messageId}.`);

    // Backpressure: drain the socket send buffer before emitting this bulk
    // array frame so a fast producer cannot balloon memory / latency.
    await this.sessionManager.awaitWritable();
    return this.successResolve.waitForRequest(
      this.sessionManager.send(header, putDataArray),
      keys
    );
  }

  public getSubarrays(
    slices: Energistics.Etp.v12.Datatypes.DataArrayTypes.GetDataSubarraysType[]
  ): Promise<Array<IDataSubarray | null>> {
    slices.forEach(d =>
      this.logTrace(
        `Getting slice ${d.uid.uri},${d.uid.pathInResource}, ${d.starts} in data array`
      )
    );
    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgGetDataSubarrays,
      BigInt(0)
    );
    const getDataSubarray =
      new Energistics.Etp.v12.Protocol.DataArray.GetDataSubarrays();
    slices.forEach(d => {
      const key = `${d.uid.uri}/${d.uid.pathInResource}/${d.starts.toString()}`;
      getDataSubarray.dataSubarrays.set(key, {
        ...d,
        uid: {
          uri: encodeURI(d.uid.uri),
          pathInResource: d.uid.pathInResource
        }
      });
    });
    this.logTrace(`Sending DataArray.GetDataSubarrays ${header.messageId}.`);
    const keys: string[] = [];
    const requestId = this.sessionManager.send(header, getDataSubarray);
    slices.forEach(d => {
      const key = `${d.uid.uri}/${d.uid.pathInResource}/${d.starts.toString()}`;
      this.pushArrayId(requestId, key, {
        counts: d.counts.map(Number),
        pathInResource: d.uid.pathInResource,
        starts: d.starts.map(Number),
        uri: encodeURI(d.uid.uri)
      });
      keys.push(key);
    });
    return this.dataSubarrayResolve.waitForRequest(requestId, keys);
  }

  public async putSubarrays(
    slices: Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataSubarraysType[]
  ): Promise<ErrorInfo[]> {
    slices.forEach(d =>
      this.logTrace(
        `Putting slice ${d.uid.uri}, ${d.uid.pathInResource}, ${d.starts} in data array`
      )
    );
    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgPutDataSubarrays,
      BigInt(0)
    );
    const putDataSubarray =
      new Energistics.Etp.v12.Protocol.DataArray.PutDataSubarrays();
    const keys: string[] = [];
    slices.forEach(d => {
      const key = `${d.uid.uri}/${d.uid.pathInResource}/${d.starts.toString()}`;
      putDataSubarray.dataSubarrays.set(key, {
        ...d,
        uid: {
          uri: encodeURI(d.uid.uri),
          pathInResource: d.uid.pathInResource
        }
      });
      keys.push(key);
    });

    this.logTrace(`Sending DataArray.PutDataSubarrays ${header.messageId}.`);
    await this.sessionManager.awaitWritable();
    return this.successResolve.waitForRequest(
      this.sessionManager.send(header, putDataSubarray),
      keys
    );
  }

  public putUninitializedArray(
    slices: Energistics.Etp.v12.Datatypes.DataArrayTypes.PutUninitializedDataArrayType[]
  ): Promise<ErrorInfo[]> {
    slices.forEach(d =>
      this.logTrace(
        `Creating uninitialized array ${d.uid.uri}, ${d.uid.pathInResource} in data array`
      )
    );
    const header = this.sessionManager.createFinalMessageHeader(
      Protocols.DataArray,
      DataArray.MsgPutUninitializedDataArrays,
      BigInt(0)
    );
    const putArray =
      new Energistics.Etp.v12.Protocol.DataArray.PutUninitializedDataArrays();
    const keys: string[] = [];
    slices.forEach(d => {
      const key = `${d.uid.uri}/${d.uid.pathInResource}`;
      putArray.dataArrays.set(key, {
        ...d,
        uid: {
          uri: encodeURI(d.uid.uri),
          pathInResource: d.uid.pathInResource
        }
      });
      keys.push(key);
    });

    this.logTrace(
      `Sending DataArray.PutUninitializedDataArrays ${header.messageId}.`
    );
    return this.successResolve.waitForRequest(
      this.sessionManager.send(header, putArray),
      keys
    );
  }

  /**
   * Resolve a DataArrays query corresponding to the correlationId
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Energistics.Etp.v12.Protocol.DataArray.GetDataArraysResponse} message
   * @returns {boolean}
   * @memberof ArrayCustomer
   */
  private onGetDataArraysResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.DataArray.GetDataArraysResponse
  ): boolean {
    const map = new Map<string, IDataArray>();
    message.dataArrays.forEach((value, key) => {
      const item = this.popArrayId(header.correlationId, key);
      if (item) {
        map.set(key, {
          uid: { uri: item.uri, pathInResource: item.pathInResource },
          dimensions: value.dimensions.map(Number),
          data: value
        });
      }
    });
    return this.dataArrayResolve.onResponse(header, map);
  }

  /**
   * Resolve a DataArray query corresponding to the correlationId
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Energistics.Etp.v12.Protocol.DataArray.DataArray} message
   * @returns nothing
   * @memberof ArrayCustomer
   */
  private onGetDataArrayMetadataResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.DataArray.GetDataArrayMetadataResponse
  ) {
    const map = new Map<string, IDataArrayMetadata>();
    message.arrayMetadata.forEach((value, key) => {
      const item = this.popArrayId(header.correlationId, key);
      if (item) {
        map.set(key, {
          uid: { uri: item.uri, pathInResource: item.pathInResource },
          dimensions: value.dimensions.map(Number),
          preferredSubarrayDimensions:
            value.preferredSubarrayDimensions.map(Number),
          logicalArrayType: value.logicalArrayType,
          transportArrayType: value.transportArrayType,
          storeLastWrite: new Date(Number(value.storeLastWrite / BigInt(1000))),
          storeCreated: new Date(Number(value.storeCreated / BigInt(1000))),
          customData: value.customData
        });
      }
    });
    return this.dataArrayMetadataResolve.onResponse(header, map);
  }

  /**
   * Fill the error map
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Energistics.Etp.v12.Protocol.Core.ProtocolExceptionTest} message
   * @returns nothing
   * @memberof ArrayCustomer
   */
  private onProtocolException(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ) {
    if (this.dataSubarrayResolve.onException(header, message)) {
      return;
    }
    if (this.dataArrayResolve.onException(header, message)) {
      return;
    }
    if (this.dataArrayMetadataResolve.onException(header, message)) {
      return;
    }
    if (this.successResolve.onException(header, message)) {
      return;
    }
    throw new Error(
      `Error returned on unknown data array message ${header.correlationId}`
    );
  }

  /**
   * Resolve a DataSubarrays query corresponding to the correlationId
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Energistics.Protocol.DataArray.Energistics.Etp.v12.Protocol.DataArray.GetDataSubarraysResponse} message
   * @returns nothing
   * @memberof ArrayCustomer
   */
  private onGetDataSubarraysResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.DataArray.GetDataSubarraysResponse
  ) {
    const map = new Map<string, IDataSubarray>();
    message.dataSubarrays.forEach((value, key) => {
      const item = this.popArrayId(header.correlationId, key);
      if (item?.starts && item.counts) {
        map.set(key, {
          uid: { uri: item.uri, pathInResource: item.pathInResource },
          starts: item.starts,
          counts: item.counts,
          data: value
        });
      }
    });
    return this.dataSubarrayResolve.onResponse(header, map);
  }
}
