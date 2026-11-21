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

import "jest";

import {
  arrayPathFor,
  parseDataRow,
  extractChannelArrays,
  extractTrajectoryArrays,
  extractProdmlTimeSeriesArrays,
  extractProdmlArrays,
  isDasHdf5Object,
  isDtsChannelObject,
  shouldExtractArrays,
  INLINE_ARRAY_THRESHOLD_BYTES,
  injectExternalArrayRefs
} from "../lib/restApi/shared/channelArrays";

describe("channelArrays: arrayPathFor", () => {
  test("builds /PREFIX/uuid/mnemonic", () => {
    expect(arrayPathFor("WITSML", "abc", "GR")).toBe("/WITSML/abc/GR");
    expect(arrayPathFor("PRODML", "u1", "Value")).toBe("/PRODML/u1/Value");
  });
});

describe("channelArrays: parseDataRow", () => {
  test("parses scalar rows", () => {
    expect(parseDataRow("1000.0, 45.2, 105.3")).toEqual([1000.0, 45.2, 105.3]);
  });

  test("parses bracket-encoded multi-dim cells", () => {
    const out = parseDataRow("8496.0,[7.48 40.85 21.6],42.5");
    expect(out[0]).toBe(8496.0);
    expect(out[1]).toEqual([7.48, 40.85, 21.6]);
    expect(out[2]).toBe(42.5);
  });

  test("tolerates extra whitespace and tabs", () => {
    expect(parseDataRow("  1 ,\t2 ,3 ")).toEqual([1, 2, 3]);
  });
});

describe("channelArrays: extractChannelArrays (WITSML 1.4.1 scalar)", () => {
  const xml = `
    <log xmlns="http://www.witsml.org/schemas/1series">
      <logCurveInfo><mnemonic>MD</mnemonic></logCurveInfo>
      <logCurveInfo><mnemonic>GR</mnemonic></logCurveInfo>
      <logData>
        <data>1000.0,45.2</data>
        <data>1000.5,46.1</data>
        <data>1001.0,44.9</data>
      </logData>
    </log>`;

  test("returns one array per mnemonic with row-length dims", () => {
    const arrays = extractChannelArrays(xml);
    expect(arrays.map(a => a.mnemonic)).toEqual(["MD", "GR"]);
    expect(arrays[0].dimensions).toEqual([3]);
    expect(Array.from(arrays[0].values)).toEqual([1000.0, 1000.5, 1001.0]);
    expect(Array.from(arrays[1].values)).toEqual([45.2, 46.1, 44.9]);
  });
});

describe("channelArrays: extractChannelArrays (array channel)", () => {
  const xml = `
    <log>
      <logCurveInfo><mnemonic>MD</mnemonic></logCurveInfo>
      <logCurveInfo><mnemonic>T2</mnemonic></logCurveInfo>
      <logData>
        <data>10.0,[1 2 3]</data>
        <data>10.5,[4 5 6]</data>
      </logData>
    </log>`;

  test("flattens a 2-D array channel with dims [rows, dim]", () => {
    const arrays = extractChannelArrays(xml);
    const t2 = arrays.find(a => a.mnemonic === "T2")!;
    expect(t2.dimensions).toEqual([2, 3]);
    expect(Array.from(t2.values)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("channelArrays: extractChannelArrays (WITSML 2.1 Index/Channel)", () => {
  const xml = `
    <ChannelSet>
      <Index><Mnemonic>TIME</Mnemonic></Index>
      <Channel><Mnemonic>ROP</Mnemonic></Channel>
      <Data><Data>0,12.0</Data><Data>1,13.5</Data></Data>
    </ChannelSet>`;

  test("discovers index + channel mnemonics", () => {
    const arrays = extractChannelArrays(xml);
    expect(arrays.map(a => a.mnemonic)).toEqual(["TIME", "ROP"]);
    expect(Array.from(arrays[1].values)).toEqual([12.0, 13.5]);
  });
});

describe("channelArrays: extractTrajectoryArrays", () => {
  const xml = `
    <trajectory>
      <trajectoryStation><md uom="m">0</md><incl>0.1</incl><azi>10</azi></trajectoryStation>
      <trajectoryStation><md uom="m">30</md><incl>1.2</incl><azi>12</azi></trajectoryStation>
    </trajectory>`;

  test("extracts MD / Inclination / Azimuth", () => {
    const arrays = extractTrajectoryArrays(xml);
    expect(arrays.map(a => a.mnemonic)).toEqual(["MD", "Inclination", "Azimuth"]);
    expect(Array.from(arrays[0].values)).toEqual([0, 30]);
    expect(Array.from(arrays[1].values)).toEqual([0.1, 1.2]);
    expect(Array.from(arrays[2].values)).toEqual([10, 12]);
  });

  test("returns [] when no stations present", () => {
    expect(extractTrajectoryArrays("<trajectory></trajectory>")).toEqual([]);
  });
});

describe("channelArrays: extractProdmlTimeSeriesArrays", () => {
  const xml = `
    <TimeSeriesData>
      <DataValue><value>120.5</value><dTim>2026-01-01T00:00:00Z</dTim></DataValue>
      <DataValue><Value uom="m3/d">133.2</Value><dTim>2026-01-02T00:00:00Z</dTim></DataValue>
      <DataValue><value>128.7</value><dTim>2026-01-03T00:00:00Z</dTim></DataValue>
    </TimeSeriesData>`;

  test("produces aligned Time + Value channels", () => {
    const arrays = extractProdmlTimeSeriesArrays(xml);
    expect(arrays.map(a => a.mnemonic)).toEqual(["Time", "Value"]);
    expect(arrays[1].dimensions).toEqual([3]);
    expect(Array.from(arrays[1].values)).toEqual([120.5, 133.2, 128.7]);
  });

  test("Time channel is strictly increasing epoch millis", () => {
    const [time] = extractProdmlTimeSeriesArrays(xml);
    const t = Array.from(time.values);
    expect(t.every(v => Number.isFinite(v))).toBe(true);
    expect(t[0]).toBeLessThan(t[1]);
    expect(t[1]).toBeLessThan(t[2]);
  });

  test("falls back to ordinal index when no timestamp", () => {
    const noTime = `
      <TimeSeriesData>
        <DataValue><value>1</value></DataValue>
        <DataValue><value>2</value></DataValue>
      </TimeSeriesData>`;
    const [time] = extractProdmlTimeSeriesArrays(noTime);
    expect(Array.from(time.values)).toEqual([0, 1]);
  });

  test("returns [] when no samples present", () => {
    expect(extractProdmlTimeSeriesArrays("<TimeSeriesData/>")).toEqual([]);
  });
});

describe("channelArrays: injectExternalArrayRefs", () => {
  const arrays = extractProdmlTimeSeriesArrays(
    `<X><DataValue><value>1</value><dTim>2026-01-01T00:00:00Z</dTim></DataValue></X>`
  );

  test("declares xmlns:eml and inserts refs before the closing root tag", () => {
    const out = injectExternalArrayRefs("<Root>body</Root>", "u1", arrays, "PRODML");
    expect(out).toContain('xmlns:eml="http://www.energistics.org/energyml/data/commonv2"');
    expect(out).toContain(
      "<eml:PathInExternalFile>/PRODML/u1/Value</eml:PathInExternalFile>"
    );
    // refs land before the final </Root>
    expect(out.indexOf("ExternalDataArrayPart")).toBeLessThan(out.lastIndexOf("</Root>"));
  });

  test("defaults the path prefix to WITSML", () => {
    const out = injectExternalArrayRefs("<Root/>", "w1", arrays);
    expect(out).toContain(
      "<eml:PathInExternalFile>/WITSML/w1/Value</eml:PathInExternalFile>"
    );
  });

  test("does not duplicate an existing xmlns:eml declaration", () => {
    const withNs = '<Root xmlns:eml="http://www.energistics.org/energyml/data/commonv2">x</Root>';
    const out = injectExternalArrayRefs(withNs, "u1", arrays, "PRODML");
    const count = (out.match(/xmlns:eml=/g) || []).length;
    expect(count).toBe(1);
  });
});

describe("channelArrays: N-D tensor readiness (UDAR / deep azimuthal resistivity)", () => {
  // There is no standardized WITSML object for ultra-deep azimuthal resistivity
  // yet; vendors emit proprietary tensor channels. This test does not assume a
  // wire format — it proves the shared storage helpers are shape-agnostic, so an
  // adapter that produces an N-D ChannelArray (e.g. [depth, spacing, frequency])
  // flows through injection + path convention unchanged once a format is defined.
  const depth = 4, spacing = 3, freq = 2;
  const total = depth * spacing * freq;
  const tensor = {
    mnemonic: "UDAR_Rt",
    values: Float64Array.from({ length: total }, (_, i) => i),
    dimensions: [depth, spacing, freq]
  };

  test("Count reflects the full flattened tensor length", () => {
    const out = injectExternalArrayRefs("<Root/>", "u9", [tensor], "WITSML");
    expect(out).toContain(`<eml:Count>${total}</eml:Count>`);
    expect(out).toContain(
      "<eml:PathInExternalFile>/WITSML/u9/UDAR_Rt</eml:PathInExternalFile>"
    );
  });

  test("dimensions are carried as an arbitrary-rank number[]", () => {
    expect(tensor.dimensions).toEqual([4, 3, 2]);
    expect(tensor.dimensions.reduce((a, b) => a * b, 1)).toBe(total);
    // arrayPathFor is independent of rank
    expect(arrayPathFor("WITSML", "u9", tensor.mnemonic)).toBe("/WITSML/u9/UDAR_Rt");
  });
});

describe("channelArrays: ProdML DAS/DTS classification", () => {
  test("isDasHdf5Object matches DAS raw/fbe/spectra/acquisition/processed", () => {
    for (const t of ["DasAcquisition", "DasRaw", "DasFbe", "DasSpectra", "DasProcessed"]) {
      expect(isDasHdf5Object(`eml:///dataspace('d')/prodml23.${t}(uuid)`)).toBe(true);
    }
    expect(isDasHdf5Object("prodml23.TimeSeriesData")).toBe(false);
    expect(isDasHdf5Object("prodml23.DtsMeasurement")).toBe(false);
  });

  test("isDtsChannelObject matches DTS + ChannelSet carriers", () => {
    for (const t of ["DtsMeasurement", "DtsMeasurementTrace", "DtsInterpretationData", "ChannelSet"]) {
      expect(isDtsChannelObject(`prodml23.${t}`)).toBe(true);
    }
    expect(isDtsChannelObject("prodml23.DasRaw")).toBe(false);
  });
});

describe("channelArrays: extractProdmlArrays dispatcher", () => {
  test("DAS objects yield no inline arrays (HDF5/EPC route)", () => {
    const dasXml =
      `<DasRaw uuid="d1"><RawData><RawReference>h5:/das/raw</RawReference></RawData></DasRaw>`;
    const { arrays, kind } = extractProdmlArrays(dasXml, "prodml23.DasRaw(d1)");
    expect(kind).toBe("das");
    expect(arrays).toHaveLength(0);
  });

  test("time-series objects dispatch to Time/Value channels", () => {
    const tsXml =
      `<TimeSeriesData uuid="t1">` +
      `<DataValue><dTim>2026-01-01T00:00:00Z</dTim><Value>10.5</Value></DataValue>` +
      `<DataValue><dTim>2026-01-01T00:00:01Z</dTim><Value>11.0</Value></DataValue>` +
      `</TimeSeriesData>`;
    const { arrays, kind } = extractProdmlArrays(tsXml, "prodml23.TimeSeriesData(t1)");
    expect(kind).toBe("timeseries");
    expect(arrays.map(a => a.mnemonic)).toEqual(["Time", "Value"]);
    expect(Array.from(arrays[1].values)).toEqual([10.5, 11.0]);
  });

  test("DTS ChannelSet dispatches to per-mnemonic temperature channels", () => {
    const dtsXml =
      `<DtsInterpretationData uuid="dt1">` +
      `<Index><Mnemonic>facilityDistance</Mnemonic></Index>` +
      `<Channel><Mnemonic>adjustedTemperature</Mnemonic></Channel>` +
      `<Data><Data>0.0, 55.1</Data><Data>1.0, 55.4</Data><Data>2.0, 55.9</Data></Data>` +
      `</DtsInterpretationData>`;
    const { arrays, kind } = extractProdmlArrays(dtsXml, "prodml23.DtsInterpretationData(dt1)");
    expect(kind).toBe("channel");
    expect(arrays.map(a => a.mnemonic)).toEqual(["facilityDistance", "adjustedTemperature"]);
    expect(Array.from(arrays[0].values)).toEqual([0.0, 1.0, 2.0]);
    expect(Array.from(arrays[1].values)).toEqual([55.1, 55.4, 55.9]);
  });

  test("objects with no inline samples yield kind 'none'", () => {
    const { arrays, kind } = extractProdmlArrays("<FiberOpticalPath uuid='f1'/>", "prodml23.FiberOpticalPath(f1)");
    expect(kind).toBe("none");
    expect(arrays).toHaveLength(0);
  });
});

describe("channelArrays: shouldExtractArrays (first-class ingest policy)", () => {
  const big = INLINE_ARRAY_THRESHOLD_BYTES + 1;
  const small = 1024;

  test("explicit override 'false' disables extraction at any size", () => {
    expect(shouldExtractArrays({ override: "false", byteLength: big })).toBe(false);
  });

  test("explicit override 'true' forces extraction at any size", () => {
    expect(shouldExtractArrays({ override: "true", byteLength: small })).toBe(true);
  });

  test("auto (unset) extracts only payloads over the inline threshold", () => {
    expect(shouldExtractArrays({ byteLength: small })).toBe(false);
    expect(shouldExtractArrays({ byteLength: big })).toBe(true);
    // exactly at the threshold stays inline (server inlines ≤ threshold)
    expect(shouldExtractArrays({ byteLength: INLINE_ARRAY_THRESHOLD_BYTES })).toBe(false);
  });

  test("custom inlineThreshold is honoured", () => {
    expect(shouldExtractArrays({ byteLength: 2048, inlineThreshold: 1024 })).toBe(true);
    expect(shouldExtractArrays({ byteLength: 512, inlineThreshold: 1024 })).toBe(false);
  });
});
