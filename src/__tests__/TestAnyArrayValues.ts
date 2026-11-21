// ============================================================================
// AnyArray union access (ResqmlClient.anyArrayValues / formatArrayData /
// arrayDataToBuffer)
//
// Int8 / UInt8 / boolean arrays travel over ETP as the `_bytes` union branch,
// which is a raw Buffer rather than `{ values: [...] }`. Reading `.values` on
// that Buffer yields Buffer.prototype.values (an iterator function), so the
// REST array routes used to answer `"function values() { [native code] }"`.
// ============================================================================

import "jest";

import { Energistics } from "../lib/common/Etp12";
import {
  ResqmlClient,
  anyArrayValues,
  type ArrayFormat
} from "../lib/client/ResqmlClient";

type AnyArray = Energistics.Etp.v12.Datatypes.AnyArray;

const bytesArray = (bytes: number[]): AnyArray =>
  ({ item: { __keyName: "_bytes", _bytes: Buffer.from(bytes) } }) as AnyArray;

const doubleArray = (values: number[]): AnyArray =>
  ({
    item: { __keyName: "_ArrayOfDouble", _ArrayOfDouble: { values } }
  }) as AnyArray;

const client = Object.create(ResqmlClient.prototype) as ResqmlClient;

describe("anyArrayValues", () => {
  it("returns the values of a typed union branch", () => {
    expect(Array.from(anyArrayValues(doubleArray([1, 2, 3]))!)).toEqual([
      1, 2, 3
    ]);
  });

  it("exposes the _bytes branch as a signed Int8 view", () => {
    const v = anyArrayValues(bytesArray([65, 66, 255]));
    expect(v).toBeInstanceOf(Int8Array);
    expect(Array.from(v as Int8Array)).toEqual([65, 66, -1]);
  });

  it("returns undefined for an empty union", () => {
    expect(anyArrayValues({ item: {} } as AnyArray)).toBeUndefined();
    expect(
      anyArrayValues({ item: { __keyName: "_bytes" } } as AnyArray)
    ).toBeUndefined();
  });
});

describe("formatArrayData with _bytes", () => {
  it("json: numbers, never a stringified function", () => {
    const out = client.formatArrayData(
      bytesArray([65, 66, 67, 68]),
      "json" as ArrayFormat
    );
    expect(out).toEqual([65, 66, 67, 68]);
  });

  it("base64: raw bytes", () => {
    const out = client.formatArrayData(bytesArray([65, 66, 67, 68]), "base64");
    expect(out).toBe(Buffer.from("ABCD").toString("base64"));
  });

  it("empty _bytes union is reported as undefined (not a string)", () => {
    expect(
      client.formatArrayData(
        { item: { __keyName: "_bytes" } } as AnyArray,
        "json"
      )
    ).toBeUndefined();
  });
});

describe("arrayDataToBuffer with _bytes", () => {
  it("streams the bytes unchanged and labels them Int8Array", () => {
    const out = client.arrayDataToBuffer(bytesArray([1, 2, 3]));
    expect(out?.arrayType).toBe("Int8Array");
    expect(Array.from(out!.buffer)).toEqual([1, 2, 3]);
  });
});
