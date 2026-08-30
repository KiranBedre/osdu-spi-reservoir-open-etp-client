// ============================================================================
// Copyright 2019-2023 Emerson Paradigm Holding LLC. All rights reserved.
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
  Energistics,
  EtpContentType,
  EtpDataValue,
  EtpUri,
  Resqml20,
  XmlUtils
} from "../index";

import * as Util from "../lib/common/Util";

describe("Schemas", () => {
  const gridType = "resqml20.obj_IjkGridRepresentation";
  const resqmlTypes = new XmlUtils.ResqmlTypeUtils();
  it("Create RESQML JSON schema", () => {
    const s = resqmlTypes.createJSONSchemas(gridType);
    expect(s).toContain(`Citation": {`);
  });
  it("Check derivation", () => {
    const d = resqmlTypes.findInterface(gridType);
    const b = resqmlTypes.findInterface("eml20.AbstractCitedDataObject");
    expect(d).toBeDefined();
    expect(b).toBeDefined();
    if (d && b) {
      resqmlTypes.isDerivingFrom(d[0], b[0]);
    }
  });

  it("Create WITSML JSON schema", () => {
    const s = new XmlUtils.WitsmlTypeUtils().createJSONSchemas("witsml21.Log");
    expect(s).toContain("#/definitions/Citation");
  });
});

describe("JSON serialization", () => {
  const xUtils = new XmlUtils.ResqmlTypeUtils();
  it("Mock object", async () => {
    const o1 = {
      Citation: {
        Title: "test",
        Originator: "me",
        Creation: new Date(),
        Format: ""
      },
      Uuid: "uuid",
      SchemaVersion: "2.0",
      ObjectVersion: "1.0",
      $type: "resqml20.AbstractResqmlDataObject"
    };

    const r = xUtils.checkInterface(o1, "resqml20.AbstractResqmlDataObject")
      ? (o1 as Resqml20.AbstractResqmlDataObject)
      : null;
    expect(r).toBeDefined();

    const oStr = JSON.stringify(o1);
    const o2 = JSON.parse(oStr);
    expect(typeof o2.Citation.Creation).toBe("string");
    const o3 = XmlUtils.parseJSON(oStr);
    expect(o3.Citation.Creation instanceof Date).toBeTruthy();
  });

  it("IJKGrid valid and invalid", done => {
    // Minimal valid IjkGrid XML (trimmed from full RESQML 2.0 specimen)
    const grid = `<?xml version="1.0" encoding="UTF-8"?>
<resqml2:IjkGridRepresentation
  xmlns:resqml2="http://www.energistics.org/energyml/data/resqmlv2"
  xmlns:eml="http://www.energistics.org/energyml/data/commonv2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  schemaVersion="2.0" uuid="9a487aca-44ca-4989-8ba7-653a5358ee80"
  xsi:type="resqml2:obj_IjkGridRepresentation">
  <eml:Citation xsi:type="eml:Citation">
    <eml:Title xsi:type="eml:DescriptionString">flow_simulation_grid</eml:Title>
    <eml:Originator xsi:type="eml:NameString">test</eml:Originator>
    <eml:Creation xsi:type="xsd:dateTime">2013-11-14T13:06:13Z</eml:Creation>
    <eml:Format xsi:type="eml:DescriptionString">test</eml:Format>
  </eml:Citation>
  <resqml2:Nk xsi:type="xsd:positiveInteger">11</resqml2:Nk>
  <resqml2:Ni xsi:type="xsd:positiveInteger">39</resqml2:Ni>
  <resqml2:Nj xsi:type="xsd:positiveInteger">35</resqml2:Nj>
  <resqml2:Geometry xsi:type="resqml2:IjkGridGeometry">
    <resqml2:LocalCrs xsi:type="eml:DataObjectReference">
      <eml:ContentType xsi:type="xsd:string">application/x-resqml+xml;version=2.0;type=obj_LocalDepth3dCrs</eml:ContentType>
      <eml:Title xsi:type="eml:DescriptionString">Default</eml:Title>
      <eml:UUID xsi:type="eml:UuidString">a05e8cb9-f948-4891-85c8-64eabde770e8</eml:UUID>
    </resqml2:LocalCrs>
    <resqml2:Points xsi:type="resqml2:Point3dHdf5Array">
      <resqml2:Coordinates xsi:type="eml:Hdf5Dataset">
        <eml:PathInHdfFile xsi:type="xsd:string">/RESQML/9a487aca/Points</eml:PathInHdfFile>
        <eml:HdfProxy xsi:type="eml:DataObjectReference">
          <eml:ContentType xsi:type="xsd:string">application/x-eml+xml;version=2.0;type=obj_EpcExternalPartReference</eml:ContentType>
          <eml:Title xsi:type="eml:DescriptionString">model.h5</eml:Title>
          <eml:UUID xsi:type="eml:UuidString">f1dc897a-e05e-4c57-944f-3501cb9cd71c</eml:UUID>
        </eml:HdfProxy>
      </resqml2:Coordinates>
    </resqml2:Points>
    <resqml2:KDirection xsi:type="resqml2:KDirection">down</resqml2:KDirection>
    <resqml2:PillarGeometryIsDefined xsi:type="resqml2:BooleanConstantArray">
      <resqml2:Value xsi:type="xsd:boolean">true</resqml2:Value>
      <resqml2:Count xsi:type="xsd:positiveInteger">1440</resqml2:Count>
    </resqml2:PillarGeometryIsDefined>
    <resqml2:PillarShape xsi:type="resqml2:PillarShape">curved</resqml2:PillarShape>
    <resqml2:GridIsRighthanded xsi:type="xsd:boolean">true</resqml2:GridIsRighthanded>
  </resqml2:Geometry>
</resqml2:IjkGridRepresentation>`;
    XmlUtils.xml2typescript(grid, "resqml20.obj_IjkGridRepresentation").then(
      obj => {
        const o2 = obj as any;
        expect(xUtils.checkValidity(o2)).toBe(true);
        delete o2.Citation.Title;
        expect(xUtils.checkValidity(o2)).toBe(false);
        o2.Citation.Title = "test";
        expect(xUtils.checkValidity(o2)).toBe(true);
        done();
      }
    );
  });
});

const dataspaceName = "demo/Volve";
const dataspace = `eml:///dataspace('${dataspaceName}')`;

describe("EtpUri", () => {
  it("Invalid URI", () => {
    expect(EtpUri.invalidGuid()).toStrictEqual(Array(16).fill(0));
  });

  it("Array conversion", () => {
    const uid = `0ac4d3a2-d209-433f-8f7a-c59b13dab196`;
    const a = EtpUri.uuidStringToByteArray(uid);
    expect(EtpUri.uuidByteArrayToString(a)).toStrictEqual(uid);
  });

  it("Object URI", async () => {
    const deprecated = EtpUri.create(
      dataspaceName,
      "resqml",
      "2.0",
      `obj_SeismicLatticeFeature`,
      `0ac4d3a2-d209-433f-8f7a-c59b13dab196`
    );
    const uri = `${dataspace}/resqml20.obj_SeismicLatticeFeature(0ac4d3a2-d209-433f-8f7a-c59b13dab196)`;
    expect(deprecated).toStrictEqual(uri);
    const etpUri = new EtpUri(uri);
    expect(etpUri.isWitsml).toBe(false);
    expect(etpUri.domain).toBe("resqml20");
    expect(etpUri.domainFamily).toBe("resqml");
    expect(etpUri.domainVersion).toBe("20");
    expect(etpUri.isRoot).toBe(false);
    expect(etpUri.hasDataSpace).toBe(true);
    expect(etpUri.objectType).toBe("obj_SeismicLatticeFeature");
    expect(etpUri.dataSpace).toBe(dataspaceName);
    expect(etpUri.dataObjectType).toBe("resqml20.obj_SeismicLatticeFeature");
    expect(etpUri.uuid).toBe(`0ac4d3a2-d209-433f-8f7a-c59b13dab196`);
  });
  it("Versioned Object URI", async () => {
    const uri = `${dataspace}/resqml20.obj_SeismicLatticeFeature(uuid=0ac4d3a2-d209-433f-8f7a-c59b13dab196,version='v1')`;
    const etpUri = new EtpUri(uri);
    expect(etpUri.isWitsml).toBe(false);
    expect(etpUri.domain).toBe("resqml20");
    expect(etpUri.domainFamily).toBe("resqml");
    expect(etpUri.domainVersion).toBe("20");
    expect(etpUri.isRoot).toBe(false);
    expect(etpUri.hasDataSpace).toBe(true);
    expect(etpUri.objectType).toBe("obj_SeismicLatticeFeature");
    expect(etpUri.dataSpace).toBe(dataspaceName);
    expect(etpUri.dataObjectType).toBe("resqml20.obj_SeismicLatticeFeature");
    expect(etpUri.uuid).toBe(`0ac4d3a2-d209-433f-8f7a-c59b13dab196`);
    expect(etpUri.version).toBe("v1");
  });

  it("Uri Creation", () => {
    const created = EtpUri.createObjectUri(
      dataspaceName,
      "resqml",
      "2.0",
      `obj_SeismicLatticeFeature`,
      `0ac4d3a2-d209-433f-8f7a-c59b13dab196`,
      "v1",
      { skip: 1, top: 4, filter: "Ni ge 10", orderby: "Citation/Title" }
    );
    const uri = created.uri;
    expect(uri).toStrictEqual(
      `${dataspace}/resqml20.obj_SeismicLatticeFeature(uuid=0ac4d3a2-d209-433f-8f7a-c59b13dab196,version='v1')` +
      "?$filter=Ni ge 10&$top=4&$skip=1&$orderby=Citation/Title"
    );
    expect(created.guid).toStrictEqual(
      EtpUri.uuidStringToByteArray("0ac4d3a2-d209-433f-8f7a-c59b13dab196")
    );
  });

  it("URI with query", async () => {
    const uri = `${dataspace}?$top=10&$skip=2&$orderby=Citation/Title&$filter=Ni ge 10`;
    const etpUri = new EtpUri(uri);
    expect(etpUri.isValid).toBeTruthy();
    expect(etpUri.hasDataSpace).toBe(true);
    expect(etpUri.dataSpace).toBe(dataspaceName);
    expect(etpUri.uriPath).toBe(dataspace);
    expect(etpUri.uriQuery).toBe(
      "?$top=10&$skip=2&$orderby=Citation/Title&$filter=Ni ge 10"
    );
    expect(etpUri.query?.top).toBe(10);
    expect(etpUri.query?.skip).toBe(2);
    expect(etpUri.query?.orderby).toBe(`Citation/Title`);
    expect(etpUri.query?.filter).toBe("Ni ge 10");
    expect(etpUri.top).toBe(10);
    expect(etpUri.skip).toBe(2);
    expect(etpUri.orderby).toBe(`Citation/Title`);
    expect(etpUri.filter).toBe("Ni ge 10");
  });

  it("Object URN", async () => {
    const urn = "urn:uuid:0ac4d3a2-d209-433f-8f7a-c59b13dab196";
    const etpUri = new EtpUri(urn);
    expect(etpUri.isWitsml).toBe(false);
    expect(etpUri.domain).toBe("");
    expect(etpUri.domainFamily).toBe("");
    expect(etpUri.isRoot).toBe(false);
    expect(etpUri.hasDataSpace).toBe(false);
    expect(etpUri.objectType).toBe("");
    expect(etpUri.dataSpace).toBe("");
  });
});

describe("SchemaCache", () => {
  const cache = new Util.SchemaCache();
  try {
    cache.find(34, 34);
  } catch (err: any) {
    expect(err.message).toBe("Schema for [34:34] not found.");
  }
  expect(cache.find(3, 1001).protocol === 0);
});

describe("miscellaneous", () => {
  it("getFilePath", () => {
    expect(
      XmlUtils.getFilePath("resqmlv2.d.ts", "resqmlv201").endsWith(
        "mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2.d.ts"
      )
    ).toBe(true);
  });
  it("parseJSON", () => {
    const stringified = JSON.stringify({ test: "2013-11-14T13:06:19Z" });
    expect(XmlUtils.parseJSON(stringified)).toStrictEqual({
      test: new Date("2013-11-14T13:06:19Z")
    });
  });
});

describe("EtpContentType", () => {
  it("EtpContentType", () => {
    const contentType = EtpContentType.createContentType(
      "resqml",
      "20",
      "obj_ContinuousProperty"
    );
    expect(contentType).toStrictEqual(
      "application/x-resqml+xml;version=2.0;type=obj_ContinuousProperty"
    );
    const EtpCT = new EtpContentType(contentType);
    expect(EtpCT.valid).toBeTruthy();
    expect(EtpCT.etpType).toStrictEqual("resqml20.obj_ContinuousProperty");
    expect(EtpCT.domainFamily).toStrictEqual("resqml");
    expect(EtpCT.domainVersion).toStrictEqual("2.0");
    expect(EtpCT.dataType).toStrictEqual("obj_ContinuousProperty");
    expect(EtpCT.hasPlural).toBeFalsy();
    expect(EtpCT.singularName).toBe("ContinuousProperty");
    expect(EtpCT.pluralName).toBe("ContinuousPropertys");
    expect(EtpCT.contentType).toStrictEqual(contentType);
  });
});

describe("DataValues", () => {
  expect(EtpDataValue.toBoolean(EtpDataValue.boolean(true))).toEqual(true);
  expect(EtpDataValue.toBoolean(EtpDataValue.int(1))).toBeUndefined();
  expect(EtpDataValue.toNumber(EtpDataValue.int(1))).toEqual(1);
  expect(EtpDataValue.toNumber(EtpDataValue.long(BigInt(1)))).toBeUndefined();
  expect(EtpDataValue.toNumber(EtpDataValue.float(1.0))).toEqual(1.0);
  expect(EtpDataValue.toNumber(EtpDataValue.double(1.0))).toEqual(1.0);
  expect(EtpDataValue.toBigInt(EtpDataValue.long(BigInt(1)))).toEqual(
    BigInt(1)
  );
  expect(EtpDataValue.toBigInt(EtpDataValue.int(1))).toBeUndefined();
  expect(EtpDataValue.toAvroString(EtpDataValue.avroString("test"))).toEqual(
    "test"
  );
  expect(EtpDataValue.toAvroString(EtpDataValue.int(1))).toBeUndefined();
  expect(
    EtpDataValue.toBytes(EtpDataValue.bytes(Buffer.from([0, 1, 2])))?.toJSON()
      ?.data
  ).toEqual([0, 1, 2]);
  const aBool = new Energistics.Etp.v12.Datatypes.ArrayOfBoolean();
  aBool.values = [false, true];
  expect(EtpDataValue.toArray(EtpDataValue.array(aBool))).toEqual([
    false,
    true
  ]);
  const aNBool = new Energistics.Etp.v12.Datatypes.ArrayOfNullableBoolean();
  aNBool.values = [false, true, null];
  expect(EtpDataValue.toArray(EtpDataValue.array(aNBool))).toEqual([
    false,
    true,
    null
  ]);
  const aInt = new Energistics.Etp.v12.Datatypes.ArrayOfInt();
  aInt.values = [1, 2];
  expect(EtpDataValue.toArray(EtpDataValue.array(aInt))).toEqual([1, 2]);
  const aNInt = new Energistics.Etp.v12.Datatypes.ArrayOfNullableInt();
  aNInt.values = [1, 2, null];
  expect(EtpDataValue.toArray(EtpDataValue.array(aNInt))).toEqual([1, 2, null]);
  const aLong = new Energistics.Etp.v12.Datatypes.ArrayOfLong();
  aLong.values = [BigInt(1), BigInt(2)];
  expect(EtpDataValue.toArray(EtpDataValue.array(aLong))).toEqual([
    BigInt(1),
    BigInt(2)
  ]);
  const aNLong = new Energistics.Etp.v12.Datatypes.ArrayOfNullableLong();
  aNLong.values = [BigInt(1), BigInt(2), null];
  expect(EtpDataValue.toArray(EtpDataValue.array(aNLong))).toEqual([
    BigInt(1),
    BigInt(2),
    null
  ]);
  const aFloat = new Energistics.Etp.v12.Datatypes.ArrayOfFloat();
  aFloat.values = [1.0, 2.0];
  expect(EtpDataValue.toArray(EtpDataValue.array(aFloat))).toEqual([1.0, 2.0]);
  const aDouble = new Energistics.Etp.v12.Datatypes.ArrayOfDouble();
  aDouble.values = [1.0, 2.0];
  expect(EtpDataValue.toArray(EtpDataValue.array(aDouble))).toEqual([1.0, 2.0]);
  const aString = new Energistics.Etp.v12.Datatypes.ArrayOfString();
  aString.values = ["t1", "t2"];
  expect(EtpDataValue.toArray(EtpDataValue.array(aString))).toEqual([
    "t1",
    "t2"
  ]);
  const aBytes = new Energistics.Etp.v12.Datatypes.ArrayOfBytes();
  aBytes.values = [Buffer.from([0, 1]), Buffer.from([2, 3])];
  expect(
    EtpDataValue.toArray(EtpDataValue.array(aBytes))?.map(m => m.toJSON().data)
  ).toEqual([
    [0, 1],
    [2, 3]
  ]);
  const sa = new Energistics.Etp.v12.Datatypes.AnySparseArray();
  sa.slices.push({
    slice: {
      item: { _ArrayOfFloat: { values: [0, 1] }, __keyName: "_ArrayOfFloat" }
    },
    start: BigInt(1)
  });
  expect(EtpDataValue.toArray(EtpDataValue.sparseArray(sa))).toBeUndefined();
  expect(EtpDataValue.toBytes(EtpDataValue.int(1))).toBeUndefined();
});
