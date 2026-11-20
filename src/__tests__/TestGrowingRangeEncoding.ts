/**
 * Regression tests for the GrowingObject (Protocol 6) / ChannelSubscribe (21)
 * REST front-ends:
 *  - IndexValue.item is an Avro union [null,long,double,PassIndexedDepth];
 *    the gateway wraps it as { _double: v, __keyName: "_double" }. The schema
 *    validator used to reject that wrapper (while the writer accepted it), so
 *    every POST /query/growing (range) failed before reaching the server.
 *  - Object URIs with an empty / unresolved UUID must be rejected with 400
 *    rather than forwarded to the store.
 */
import { BadRequestException } from "@nestjs/common";
import { Energistics } from "../lib/common/Etp12";
import { BinaryReader, BinaryWriter } from "../lib/common/EtpAvro";
import { SchemaCache } from "../lib/common/Util";
import { requireObjectUri } from "../lib/restApi/query.module/Query.controller";

const schemas = new SchemaCache();

const indexValue = (v: number, key: "_double" | "_long") => {
  const iv = new Energistics.Etp.v12.Datatypes.IndexValue();
  iv.item = { [key]: key === "_long" ? BigInt(v) : v, __keyName: key } as any;
  return iv;
};

const roundTrip = (msg: unknown) => {
  const schema = Energistics.Etp.v12.Protocol.GrowingObject.GetPartsByRange._schema;
  const w = new BinaryWriter(schemas, undefined);
  w.writeDatum(schema, msg, true);
  return new BinaryReader(schemas, w.getBuffer()).readDatum(schema);
};

describe("GetPartsByRange IndexValue union encoding", () => {
  it("validates and round-trips a double-indexed interval", () => {
    const out = roundTrip({
      uri: "eml:///dataspace('d')/witsml21.WellLog(7a4d2e91-6c05-4f38-9b12-8e0a1c3d5f60)",
      indexInterval: {
        startIndex: indexValue(2500, "_double"),
        endIndex: indexValue(3000, "_double"),
        uom: "m",
        depthDatum: ""
      },
      includeOverlappingIntervals: true,
      format: "xml"
    });
    expect(out.indexInterval.startIndex.item).toEqual({
      __keyName: "_double",
      _double: 2500
    });
    expect(out.indexInterval.endIndex.item._double).toBe(3000);
    expect(out.includeOverlappingIntervals).toBe(true);
  });

  it("validates and round-trips a long-indexed (time) interval", () => {
    const out = roundTrip({
      uri: "eml:///dataspace('d')/witsml21.WellLog(7a4d2e91-6c05-4f38-9b12-8e0a1c3d5f60)",
      indexInterval: {
        startIndex: indexValue(1700000000000000, "_long"),
        endIndex: indexValue(1700000001000000, "_long"),
        uom: "us",
        depthDatum: ""
      },
      includeOverlappingIntervals: false,
      format: "xml"
    });
    expect(out.indexInterval.startIndex.item.__keyName).toBe("_long");
    expect(BigInt(out.indexInterval.startIndex.item._long)).toBe(
      BigInt(1700000000000000)
    );
  });

  it("still rejects a wrapper naming a branch that is not in the union", () => {
    expect(() =>
      roundTrip({
        uri: "eml:///x",
        indexInterval: {
          startIndex: { item: { _string: "abc", __keyName: "_string" } },
          endIndex: indexValue(1, "_double"),
          uom: "m",
          depthDatum: ""
        },
        includeOverlappingIntervals: false,
        format: "xml"
      })
    ).toThrow(/Invalid value/);
  });
});

describe("requireObjectUri", () => {
  const good =
    "eml:///dataspace('demo/drogon')/witsml21.WellLog(7a4d2e91-6c05-4f38-9b12-8e0a1c3d5f60)";

  it("accepts a well-formed object URI", () => {
    expect(requireObjectUri(good).uuid).toBe(
      "7a4d2e91-6c05-4f38-9b12-8e0a1c3d5f60"
    );
  });

  it.each([
    ["empty uuid", "eml:///dataspace('demo/drogon')/witsml21.WellLog()"],
    ["unresolved template", "eml:///dataspace('d')/witsml21.WellLog({{guid}})"],
    ["dataspace only", "eml:///dataspace('demo/drogon')"],
    ["garbage", "not-a-uri"]
  ])("rejects %s with 400", (_label, uri) => {
    expect(() => requireObjectUri(uri)).toThrow(BadRequestException);
  });
});
