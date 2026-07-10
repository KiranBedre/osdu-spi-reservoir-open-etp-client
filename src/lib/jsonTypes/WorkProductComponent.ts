import {
  EtpUri,
  IResqmlDataObject,
  ResqmlClient,
  URI
} from "../client/ResqmlClient";

import * as eml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/commonv2";
import * as resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
import * as eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import * as resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
import type { SimpleJson } from "../mlTypes/XmlJsonUtil";

import { IDataSubarray } from "../common/EtpTypes";

import { EtpContentType } from "../common/EtpContentType";

import {
  AbstractSpatialLocation,
  AccessControlList,
  LegalMetaData,
  ParentList
} from "./Generated/work-product-component/GenericRepresentation.1.1.0";

import { FrameOfReferenceMetaDataItem } from "./Generated/manifest/Manifest.1.0.0";

import { DataspaceLegalACL, OSDUContext } from "./OsduContext";

import { AbstractCommonResources } from "./Generated/abstract/AbstractCommonResources.1.0.1";
import { AbstractInterpretation } from "./Generated/abstract/AbstractInterpretation.1.1.0";
import { AbstractWPCGroupType } from "./Generated/abstract/AbstractWPCGroupType.1.2.0";
import { AbstractWorkProductComponent } from "./Generated/abstract/AbstractWorkProductComponent.1.1.0";
import { CoordinateReferenceSystem } from "./Generated/reference-data/CoordinateReferenceSystem.1.1.0";
import { context } from "../cxml/cxml";

enum AnyCRSGeoJSONPointType {
  AnyCRSGeometryCollection = "AnyCrsGeometryCollection",
  AnyCRSLineString = "AnyCrsLineString",
  AnyCRSMultiLineString = "AnyCrsMultiLineString",
  AnyCRSMultiPoint = "AnyCrsMultiPoint",
  AnyCRSMultiPolygon = "AnyCrsMultiPolygon",
  AnyCRSPoint = "AnyCrsPoint",
  AnyCRSPolygon = "AnyCrsPolygon"
}

enum FluffyType {
  AnyCRSFeature = "AnyCrsFeature"
}

enum AsIngestedCoordinatesType {
  AnyCRSFeatureCollection = "AnyCrsFeatureCollection"
}

enum Wgs84CoordinatesType {
  FeatureCollection = "FeatureCollection"
}

enum StickyType {
  Feature = "Feature"
}

enum GeoJSONPointType {
  GeometryCollection = "GeometryCollection",
  LineString = "LineString",
  MultiLineString = "MultiLineString",
  MultiPoint = "MultiPoint",
  MultiPolygon = "MultiPolygon",
  Point = "Point",
  Polygon = "Polygon"
}

const DBL_CST_ARRAY = "resqml20.DoubleConstantArray";
const DBL_HDF_ARRAY = "resqml20.DoubleHdf5Array";
const DBL_LAT_ARRAY = "resqml20.DoubleLatticeArray";
const INT_CST_ARRAY = "resqml20.IntegerConstantArray";
const INT_HDF_ARRAY = "resqml20.IntegerHdf5Array";

const DBL_CST_ARRAY22 = "eml23.FloatingPointConstantArray";
const DBL_HDF_ARRAY22 = "eml23.FloatingPointExternalArray";
const DBL_LAT_ARRAY22 = "eml23.FloatingPointLatticeArray";
const DBL_XML_ARRAY22 = "eml23.FloatingPointXmlArray";
const INT_CST_ARRAY22 = "eml23.IntegerConstantArray";
const INT_HDF_ARRAY22 = "eml23.IntegerExternalArray";
const INT_LAT_ARRAY22 = "eml23.IntegerLatticeArray";
const INT_XML_ARRAY22 = "eml23.IntegerXmlArray";
const INT_JAG_ARRAY22 = "eml23.JaggedArray";
const BOO_CST_ARRAY22 = "eml23.BooleanConstantArray";
const BOO_HDF_ARRAY22 = "eml23.BooleanExternalArray";
const BOO_XML_ARRAY22 = "eml23.BooleanXmlArray";

/**
 * Extract an array of integer values from a generic AbstractIntegerArray
 *
 * @param {string} dataspaceUri
 * @param {SimpleJson<resqml20.AbstractIntegerArray|eml23.AbstractIntegerArray>} array
 * @param {ResqmlClient} client
 * @returns {Promise<number[]>}
 */
export const getIntegerValues = async (
  dataspaceUri: string,
  array: SimpleJson<resqml20.AbstractIntegerArray | eml23.AbstractIntegerArray>,
  client: ResqmlClient
): Promise<number[]> => {
  if (array.$type === INT_HDF_ARRAY) {
    const hdfArray = array as resqml20.IntegerHdf5Array;
    const etpType = new EtpContentType(hdfArray.Values.HdfProxy.ContentType)
      .etpType;
    const uri = `${dataspaceUri}/${etpType}(${hdfArray.Values.HdfProxy.UUID})`;
    const da = await client.getDataArray(uri, hdfArray.Values.PathInHdfFile);
    const values = da?.data?.data.item._ArrayOfInt?.values;
    if (!values) {
      return Promise.reject(
        new Error(`Cannot get integer values from HDF5 array ${uri}`)
      );
    }
    return values;
  } else if (array.$type === INT_CST_ARRAY) {
    const constArray = array as resqml20.IntegerConstantArray;
    return new Array(constArray.Count).fill(constArray.Value);
  } else if (array.$type === INT_XML_ARRAY22) {
    const xmlArray = array as eml23.IntegerXmlArray;
    return xmlArray.Values;
  } else if (array.$type === INT_JAG_ARRAY22) {
    const jagArray = array as eml23.JaggedArray;
    const jaggedValues: number[] = [];
    const length = await getIntegerValues(
      dataspaceUri,
      jagArray.CumulativeLength,
      client
    );
    const elements = await getIntegerValues(
      dataspaceUri,
      jagArray.Elements,
      client
    );
    if (length.length !== elements.length) {
      return Promise.reject(
        new Error(
          "Cannot get integer values from Jagged array: Array length mismatch"
        )
      );
    }
    for (let i = 0; i < length.length; i++) {
      for (let j = 0; j < length[i]; j++) {
        jaggedValues.push(elements[i]);
      }
    }
  } else if (array.$type === INT_HDF_ARRAY22) {
    const hdfArray = array as eml23.IntegerExternalArray;
    const etpDataspaceUri = new EtpUri(dataspaceUri).dataSpace;
    const etpUri = new EtpUri(hdfArray.Values.ExternalDataArrayPart[0].URI);

    const uri = EtpUri.createTypedObjectUri(
      etpDataspaceUri,
      etpUri.dataObjectType,
      etpUri.uuid,
      etpUri.version
    ).uri;
    const da = await client.getDataArray(
      uri,
      hdfArray.Values.ExternalDataArrayPart[0].PathInExternalFile
    );
    const values = da?.data?.data.item._ArrayOfInt?.values;
    if (!values) {
      return Promise.reject(
        new Error(`Cannot get integer values from HDF5 array ${uri}`)
      );
    }
    return values;
  } else if (array.$type === INT_CST_ARRAY22) {
    const constArray = array as eml23.IntegerConstantArray;
    return new Array(constArray.Count).fill(constArray.Value);
  }

  return Promise.reject(new Error(`Unsupported array type ${array.$type}`));
};

/**
 * Extract an array of boolean values from a generic AbstractBooleanArray
 *
 * @param {string} dataspaceUri
 * @param {SimpleJson<resqml20.AbstractBooleanArray|eml23.AbstractBooleanArray>} array
 * @param {ResqmlClient} client
 * @returns {Promise<number[]>}
 */
export const getBooleanValues = async (
  dataspaceUri: string,
  array: SimpleJson<resqml20.AbstractBooleanArray | eml23.AbstractBooleanArray>,
  client: ResqmlClient
): Promise<boolean[]> => {
  if (array.$type === "resqml20.BooleanHdf5Array") {
    const hdfArray = array as resqml20.BooleanHdf5Array;
    const etpType = new EtpContentType(hdfArray.Values.HdfProxy.ContentType)
      .etpType;
    const uri = `${dataspaceUri}/${etpType}(${hdfArray.Values.HdfProxy.UUID})`;
    const da = await client.getDataArray(uri, hdfArray.Values.PathInHdfFile);
    const values = da?.data?.data.item._ArrayOfBoolean?.values;
    if (!values) {
      return Promise.reject(
        new Error(`Cannot get boolean values from HDF5 array ${uri}`)
      );
    }
    return values;
  } else if (array.$type === "resqml20.BooleanConstantArray") {
    const constArray = array as resqml20.BooleanConstantArray;
    return new Array(constArray.Count).fill(constArray.Value);
  } else if (array.$type === BOO_HDF_ARRAY22) {
    const hdfArray = array as eml23.BooleanExternalArray;
    const etpDataspaceUri = new EtpUri(dataspaceUri).dataSpace;
    const etpUri = new EtpUri(hdfArray.Values.ExternalDataArrayPart[0].URI);

    const uri = EtpUri.createTypedObjectUri(
      etpDataspaceUri,
      etpUri.dataObjectType,
      etpUri.uuid,
      etpUri.version
    ).uri;
    const da = await client.getDataArray(
      uri,
      hdfArray.Values.ExternalDataArrayPart[0].PathInExternalFile
    );
    const values = da?.data?.data.item._ArrayOfBoolean?.values;
    if (!values) {
      return Promise.reject(
        new Error(`Cannot get boolean values from HDF5 array ${uri}`)
      );
    }
    return values;
  } else if (array.$type === BOO_CST_ARRAY22) {
    const constArray = array as eml23.BooleanConstantArray;
    return new Array(constArray.Count).fill(constArray.Value);
  }
  return Promise.reject(new Error(`Unsupported array type ${array.$type}`));
};

type DoubleVisitorInput = (
  values: boolean[] | number[] | bigint[],
  data: IDataSubarray
) => any;

/**
 * Apply a visitor function to all values of a generic AbstractBooleanArray
 *
 * @param {string} dataspaceUri
 * @param {SimpleJson<resqml20.AbstractBooleanArray|eml23.AbstractBooleanArray>} array
 * @param {ResqmlClient} client
 * @param {DoubleVisitorInput} visitor
 * @returns {Promise<void>}
 */
export const visitBooleanValues = async (
  dataspaceUri: string,
  array: SimpleJson<resqml20.AbstractBooleanArray | eml23.AbstractBooleanArray>,
  client: ResqmlClient,
  visitor: DoubleVisitorInput
): Promise<void> => {
  if (array.$type === "resqml20.BooleanHdf5Array") {
    const hdfArray = array as resqml20.BooleanHdf5Array;
    const etpType = new EtpContentType(hdfArray.Values.HdfProxy.ContentType)
      .etpType;
    const uri = `${dataspaceUri}/${etpType}(${hdfArray.Values.HdfProxy.UUID})`;
    await client.visitDataArrayValues(
      { uri, pathInResource: hdfArray.Values.PathInHdfFile },
      visitor
    );
    return;
  } else if (array.$type === "resqml20.BooleanConstantArray") {
    const constArray = array as resqml20.BooleanConstantArray;
    visitor(new Array(constArray.Count).fill(constArray.Value), {
      uid: { uri: "", pathInResource: "" },
      starts: [0],
      counts: [constArray.Count]
    });
    return;
  } else if (array.$type === "eml23.BooleanExternalArray") {
    const hdfArray = array as eml23.BooleanExternalArray;
    const etpDataspaceUri = new EtpUri(dataspaceUri).dataSpace;
    const etpUri = new EtpUri(hdfArray.Values.ExternalDataArrayPart[0].URI);

    const uri = EtpUri.createTypedObjectUri(
      etpDataspaceUri,
      etpUri.dataObjectType,
      etpUri.uuid,
      etpUri.version
    ).uri;
    await client.visitDataArrayValues(
      {
        uri,
        pathInResource:
          hdfArray.Values.ExternalDataArrayPart[0].PathInExternalFile
      },
      visitor
    );
    return;
  } else if (array.$type === "eml23.BooleanConstantArray") {
    const constArray = array as eml23.BooleanConstantArray;
    visitor(new Array(constArray.Count).fill(constArray.Value), {
      uid: { uri: "", pathInResource: "" },
      starts: [0],
      counts: [constArray.Count]
    });
    return;
  }

  return Promise.reject(new Error(`Unsupported array type ${array.$type}`));
};

/**
 * Apply a visitor function to all values of a generic AbstractIntegerArray
 *
 * @param {string} dataspaceUri
 * @param {SimpleJson<resqml20.AbstractIntegerArray|eml23.AbstractIntegerArray>} array
 * @param {ResqmlClient} client
 * @param {IntegerVisitorInput} visitor
 * @returns {Promise<void>}
 */
export const visitIntegerValues = async (
  dataspaceUri: string,
  array: SimpleJson<resqml20.AbstractIntegerArray | eml23.AbstractIntegerArray>,
  client: ResqmlClient,
  visitor: (
    nullValue: number | undefined,
    values: boolean[] | number[] | bigint[],
    data: IDataSubarray
  ) => any
): Promise<void> => {
  if (array.$type === INT_HDF_ARRAY) {
    const hdfArray = array as resqml20.IntegerHdf5Array;

    const etpType = new EtpContentType(hdfArray.Values.HdfProxy.ContentType)
      .etpType;
    const uri = `${dataspaceUri}/${etpType}(${hdfArray.Values.HdfProxy.UUID})`;
    await client.visitDataArrayValues(
      { uri, pathInResource: hdfArray.Values.PathInHdfFile },
      visitor.bind(this, hdfArray.NullValue)
    );
  } else if (array.$type === INT_CST_ARRAY) {
    const constArray = array as resqml20.IntegerConstantArray;
    visitor(undefined, new Array(constArray.Count).fill(constArray.Value), {
      uid: { uri: "", pathInResource: "" },
      starts: [0],
      counts: [constArray.Count]
    });
  } else if (array.$type === INT_HDF_ARRAY22) {
    const hdfArray = array as eml23.IntegerExternalArray;
    const etpDataspaceUri = new EtpUri(dataspaceUri).dataSpace;
    const etpUri = new EtpUri(hdfArray.Values.ExternalDataArrayPart[0].URI);

    const uri = EtpUri.createTypedObjectUri(
      etpDataspaceUri,
      etpUri.dataObjectType,
      etpUri.uuid,
      etpUri.version
    ).uri;

    await client.visitDataArrayValues(
      {
        uri,
        pathInResource:
          hdfArray.Values.ExternalDataArrayPart[0].PathInExternalFile
      },
      visitor.bind(this, hdfArray.NullValue)
    );
  } else if (array.$type === INT_CST_ARRAY22) {
    const constArray = array as eml23.IntegerConstantArray;
    visitor(undefined, new Array(constArray.Count).fill(constArray.Value), {
      uid: { uri: "", pathInResource: "" },
      starts: [0],
      counts: [constArray.Count]
    });
  } else if (array.$type === INT_XML_ARRAY22) {
    const xmlArray = array as eml23.IntegerXmlArray;
    visitor(undefined, xmlArray.Values, {
      uid: { uri: "", pathInResource: "" },
      starts: [0],
      counts: [xmlArray.CountPerValue]
    });
  } else if (array.$type === INT_JAG_ARRAY22) {
    const jagArray = array as eml23.JaggedArray;
    const jaggedValues: number[] = await getIntegerValues(
      dataspaceUri,
      jagArray,
      client
    );
    visitor(undefined, jaggedValues, {
      uid: { uri: "", pathInResource: "" },
      starts: [0],
      counts: [jaggedValues.length]
    });
  } else {
    return Promise.reject(new Error(`Unsupported array type ${array.$type}`));
  }
};

/**
 * Apply a visitor function to all values of a generic AbstractDoubleArray
 *
 * @param {string} dataspaceUri
 * @param {SimpleJson<resqml20.AbstractDoubleArray|eml23.AbstractFloatingPointArray>} array
 * @param {ResqmlClient} client
 * @param {DoubleVisitorInput} visitor
 * @returns {Promise<void>}
 */
export const visitDoubleValues = async (
  dataspaceUri: string,
  array: SimpleJson<
    resqml20.AbstractDoubleArray | eml23.AbstractFloatingPointArray
  >,
  client: ResqmlClient,
  visitor: DoubleVisitorInput
): Promise<void> => {
  if (array.$type === DBL_HDF_ARRAY) {
    const hdfArray = array as resqml20.DoubleHdf5Array;
    const etpType = new EtpContentType(hdfArray.Values.HdfProxy.ContentType)
      .dataType;
    const uri = `${dataspaceUri}/eml20.${etpType}(${hdfArray.Values.HdfProxy.UUID})`;
    await client.visitDataArrayValues(
      { uri, pathInResource: hdfArray.Values.PathInHdfFile },
      visitor
    );
  } else if (array.$type === DBL_CST_ARRAY) {
    const constArray = array as resqml20.DoubleConstantArray;
    await visitor(new Array(constArray.Count).fill(constArray.Value), {
      uid: { uri: "", pathInResource: "" },
      starts: [0],
      counts: [constArray.Count]
    });
  } else if (array.$type === DBL_LAT_ARRAY) {
    const latticeArray = array as resqml20.DoubleLatticeArray;
    let cur = latticeArray.StartValue;
    let count = 1;
    latticeArray.Offset.forEach(o => (count *= o.Count + 1));
    const val = [cur];
    for (let i = 0; i < latticeArray.Offset[0].Count; i++) {
      cur += latticeArray.Offset[0].Value;
      val.push(cur);
    }

    const counts = latticeArray.Offset.map(() => 1);
    counts[0] = latticeArray.Offset[0].Count;
    await visitor(val, {
      uid: { uri: "", pathInResource: "" },
      starts: latticeArray.Offset.map(() => 0),
      counts
    });

    // return Promise.reject("Not supported type yet");
  } else if (array.$type === DBL_HDF_ARRAY22) {
    const hdfArray = array as eml23.FloatingPointExternalArray;
    const etpDataspaceUri = new EtpUri(dataspaceUri).dataSpace;
    const etpUri = new EtpUri(hdfArray.Values.ExternalDataArrayPart[0].URI);

    const uri = EtpUri.createTypedObjectUri(
      etpDataspaceUri,
      etpUri.dataObjectType,
      etpUri.uuid,
      etpUri.version
    ).uri;

    await client.visitDataArrayValues(
      {
        uri,
        pathInResource:
          hdfArray.Values.ExternalDataArrayPart[0].PathInExternalFile
      },
      visitor
    );
  } else if (array.$type === DBL_CST_ARRAY22) {
    const constArray = array as eml23.FloatingPointConstantArray;
    await visitor(new Array(constArray.Count).fill(constArray.Value), {
      uid: { uri: "", pathInResource: "" },
      starts: [0],
      counts: [constArray.Count]
    });
  } else if (array.$type === DBL_LAT_ARRAY22) {
    const latticeArray = array as eml23.FloatingPointLatticeArray;
    let cur = latticeArray.StartValue;
    let count = 1;
    latticeArray.Offset.forEach(o => (count *= o.Count + 1));
    const val = [cur];
    for (let i = 0; i < latticeArray.Offset[0].Count; i++) {
      cur += latticeArray.Offset[0].Value;
      val.push(cur);
    }

    const counts = latticeArray.Offset.map(() => 1);
    counts[0] = latticeArray.Offset[0].Count;
    await visitor(val, {
      uid: { uri: "", pathInResource: "" },
      starts: latticeArray.Offset.map(() => 0),
      counts
    });
  } else if (array.$type === DBL_XML_ARRAY22) {
    const xmlArray = array as eml23.FloatingPointXmlArray;
    await visitor(xmlArray.Values, {
      uid: { uri: "", pathInResource: "" },
      starts: [0],
      counts: [xmlArray.CountPerValue]
    });
  }
};

/**
 * Apply a visitor function to all values of a generic Point3dHdf5Array
 *
 * @param {string} dataspaceUri
 * @param {SimpleJson<resqml20.Point3dHdf5Array|resqml22.Point3dExternalArray>} array
 * @param {ResqmlClient} client
 * @param {DoubleVisitorInput} visitor
 * @returns {Promise<void>}
 */
export const visitPoint3dValues = async (
  dataspaceUri: string,
  array: SimpleJson<resqml20.Point3dHdf5Array | resqml22.Point3dExternalArray>,
  client: ResqmlClient,
  visitor: DoubleVisitorInput
): Promise<void> => {
  if (array.$type === "resqml20.Point3dHdf5Array") {
    const hdfArray = array as SimpleJson<resqml20.Point3dHdf5Array>;
    const etpType = new EtpContentType(
      hdfArray.Coordinates.HdfProxy.ContentType
    ).etpType;
    const uri = `${dataspaceUri}/${etpType}(${hdfArray.Coordinates.HdfProxy.UUID})`;
    await client.visitDataArrayValues(
      { uri, pathInResource: hdfArray.Coordinates.PathInHdfFile },
      visitor,
      0,
      30000
    );
  } else if (array.$type === "resqml22.Point3dExternalArray") {
    const hdfArray = array as SimpleJson<resqml22.Point3dExternalArray>;
    const etpDataspaceUri = new EtpUri(dataspaceUri).dataSpace;
    const etpUri = new EtpUri(
      hdfArray.Coordinates.ExternalDataArrayPart[0].URI
    );

    const uri = EtpUri.createTypedObjectUri(
      etpDataspaceUri,
      etpUri.dataObjectType,
      etpUri.uuid,
      etpUri.version
    ).uri;

    await client.visitDataArrayValues(
      {
        uri,
        pathInResource:
          hdfArray.Coordinates.ExternalDataArrayPart[0].PathInExternalFile
      },
      visitor,
      0,
      30000
    );
  }
};

/**
 * Extract the geometries from representations
 *
 * @param {SimpleJson<resqml20.AbstractRepresentation| resqml22.AbstractRepresentation>} xml
 * @returns {SimpleJson<resqml20.PointGeometry| resqml22.PointGeometry>[]}
 */
export const getGeometries = (
  xml: SimpleJson<
    resqml20.AbstractRepresentation | resqml22.AbstractRepresentation
  >
): SimpleJson<resqml20.PointGeometry | resqml22.PointGeometry>[] => {
  if (xml.$type === "resqml20.obj_Grid2dRepresentation") {
    const grid2d = xml as SimpleJson<resqml20.obj_Grid2dRepresentation>;
    return [grid2d.Grid2dPatch.Geometry];
  } else if (xml.$type === "resqml20.obj_TriangulatedSetRepresentation") {
    const trig = xml as SimpleJson<resqml20.obj_TriangulatedSetRepresentation>;
    return trig.TrianglePatch.map(p => p.Geometry);
  } else if (xml.$type === "resqml20.obj_PolylineSetRepresentation") {
    const polyLine = xml as SimpleJson<resqml20.obj_PolylineSetRepresentation>;
    return polyLine.LinePatch.map(p => p.Geometry);
  } else if (xml.$type === "resqml20.obj_PointSetRepresentation") {
    const points = xml as SimpleJson<resqml20.obj_PointSetRepresentation>;
    return points.NodePatch.map(p => p.Geometry);
  } else if (xml.$type === "resqml20.obj_PolylineRepresentation") {
    const line = xml as SimpleJson<resqml20.obj_PolylineRepresentation>;
    return [line.NodePatch.Geometry];
  } else if (xml.$type === "resqml22.Grid2dRepresentation") {
    const grid2d = xml as SimpleJson<resqml22.Grid2dRepresentation>;
    return [grid2d.Geometry];
  } else if (xml.$type === "resqml22.TriangulatedSetRepresentation") {
    const trig = xml as SimpleJson<resqml22.TriangulatedSetRepresentation>;
    return trig.TrianglePatch.map(p => p.Geometry);
  } else if (xml.$type === "resqml22.PolylineSetRepresentation") {
    const polyLine = xml as SimpleJson<resqml22.PolylineSetRepresentation>;
    return polyLine.LinePatch.map(p => p.Geometry);
  } else if (xml.$type === "resqml22.PointSetRepresentation") {
    const points = xml as SimpleJson<resqml22.PointSetRepresentation>;
    if (!points.NodePatchGeometry) {
      throw new Error(
        `Invalid PointSetRepresentation: NodePatchGeometry is required per RESQML standard`
      );
    }
    return Array.isArray(points.NodePatchGeometry)
      ? points.NodePatchGeometry
      : [points.NodePatchGeometry];
  } else if (xml.$type === "resqml22.PolylineRepresentation") {
    const line = xml as SimpleJson<resqml22.PolylineRepresentation>;
    return [line.NodePatchGeometry];
  }
  return [];
};

/**
 * Get the minimum and maximum coordinate of a Point array
 *
 * @param {ResqmlClient} client
 * @param {string} dataspaceUri
 * @param {SimpleJson<resqml20.AbstractPoint3dArray|resqml22.AbstractPoint3dArray>} geo
 * @returns {Promise<{
 *   minX: number;
 *   minY: number;
 *   minZ: number;
 *   maxX: number;
 *   maxY: number;
 *   maxZ: number;
 *   pNodeCount: number;
 * }>}
 */
export const getMinMaxPoints = async (
  client: ResqmlClient,
  dataspaceUri: string,
  geo: SimpleJson<resqml20.AbstractPoint3dArray | resqml22.AbstractPoint3dArray>
): Promise<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pNodeCount: number;
}> => {
  let minX: number = Number.POSITIVE_INFINITY;
  let maxX: number = Number.NEGATIVE_INFINITY;
  let minY: number = Number.POSITIVE_INFINITY;
  let maxY: number = Number.NEGATIVE_INFINITY;

  let pNodeCount = 0;

  if (geo.$type === "resqml20.Point3dHdf5Array") {
    const hdfArray = geo as SimpleJson<resqml20.Point3dHdf5Array>;
    await visitPoint3dValues(dataspaceUri, hdfArray, client, values => {
      const val = values as number[];
      val.forEach((v, index) => {
        if (!Number.isNaN(v)) {
          const mod = index % 3;
          if (mod === 0) {
            minX = Math.min(v, minX);
            maxX = Math.max(v, maxX);
            pNodeCount++;
          } else if (mod === 1) {
            minY = Math.min(v, minY);
            maxY = Math.max(v, maxY);
          }
        }
      });
    });
  } else if (geo.$type === "resqml20.Point3dParametricArray") {
    const param = geo as SimpleJson<resqml20.Point3dParametricArray>;
    if (param.ParametricLines.$type === "resqml20.ParametricLineArray") {
      const lineArray =
        param.ParametricLines as SimpleJson<resqml20.ParametricLineArray>;
      const v = await getMinMaxPoints(
        client,
        dataspaceUri,
        lineArray.ControlPoints
      );
      minX = v.minX;
      minY = v.minY;
      maxX = v.maxX;
      maxY = v.maxY;
    }
  } else if (geo.$type === "resqml20.Point3dZValueArray") {
    const zArray = geo as SimpleJson<resqml20.Point3dZValueArray>;
    const sup =
      zArray.SupportingGeometry as SimpleJson<resqml20.Point3dZValueArray>;
    return await getMinMaxPoints(client, dataspaceUri, sup);
  } else if (geo.$type === "resqml20.Point3dLatticeArray") {
    const lArray = geo as SimpleJson<resqml20.Point3dLatticeArray>;
    const [ox, oy] = [lArray.Origin.Coordinate1, lArray.Origin.Coordinate2];
    const [u, v] = [lArray.Offset[0], lArray.Offset[1]];
    if (
      u.Spacing.$type === DBL_CST_ARRAY &&
      v.Spacing.$type === DBL_CST_ARRAY
    ) {
      const uSpacing = u.Spacing as SimpleJson<resqml20.DoubleConstantArray>;
      const vSpacing = v.Spacing as SimpleJson<resqml20.DoubleConstantArray>;
      const [uLen, vLen] = [uSpacing.Value, vSpacing.Value];
      const [nu, nv] = [uSpacing.Count + 1, vSpacing.Count + 1];

      const uOffsetLen = Math.sqrt(
        u.Offset.Coordinate1 * u.Offset.Coordinate1 +
        u.Offset.Coordinate2 * u.Offset.Coordinate2
      );

      const vOffsetLen = Math.sqrt(
        v.Offset.Coordinate1 * v.Offset.Coordinate1 +
        v.Offset.Coordinate2 * v.Offset.Coordinate2
      );

      const [ux, uy] =
        uOffsetLen > 1e-6
          ? [
            (uLen * u.Offset.Coordinate1) / uOffsetLen,
            (uLen * u.Offset.Coordinate2) / uOffsetLen
          ]
          : [0, 0];
      const [vx, vy] =
        vOffsetLen > 1e-6
          ? [
            (vLen * v.Offset.Coordinate1) / vOffsetLen,
            (vLen * v.Offset.Coordinate2) / vOffsetLen
          ]
          : [0, 0];
      pNodeCount = nu * nv;
      for (let vv = 0; vv < nv; vv++) {
        for (let uu = 0; uu < nu; uu++) {
          const x = ox + ux * uu + vx * vv;
          const y = oy + uy * uu + vy * vv;
          minX = Math.min(x, minX);
          maxX = Math.max(x, maxX);
          minY = Math.min(y, minY);
          maxY = Math.max(y, maxY);
        }
      }
    }
  } else if (geo.$type === "resqml20.Point3dFromRepresentationLatticeArray") {
    const lArray =
      geo as SimpleJson<resqml20.Point3dFromRepresentationLatticeArray>;
    const rep = lArray.SupportingRepresentation
      ?._data as SimpleJson<resqml20.AbstractRepresentation>;
    const geometries = getGeometries(rep);
    for await (const g of geometries) {
      const v = await getMinMaxPoints(client, dataspaceUri, g.Points);
      minX = Math.min(minX, v.minX);
      minY = Math.min(minY, v.minY);
      maxX = Math.max(maxX, v.maxX);
      maxY = Math.max(maxY, v.maxY);
      pNodeCount += v.pNodeCount;
    }
  } else if (geo.$type === "resqml22.Point3dExternalArray") {
    const hdfArray = geo as SimpleJson<resqml22.Point3dExternalArray>;
    await visitPoint3dValues(dataspaceUri, hdfArray, client, values => {
      const val = values as number[];
      val.forEach((v, index) => {
        if (!Number.isNaN(v)) {
          const mod = index % 3;
          if (mod === 0) {
            minX = Math.min(v, minX);
            maxX = Math.max(v, maxX);
            pNodeCount++;
          } else if (mod === 1) {
            minY = Math.min(v, minY);
            maxY = Math.max(v, maxY);
          }
        }
      });
    });
  } else if (geo.$type === "resqml22.Point3dParametricArray") {
    const param = geo as SimpleJson<resqml22.Point3dParametricArray>;
    if (param.ParametricLines.$type === "resqml22.ParametricLineArray") {
      const lineArray =
        param.ParametricLines as SimpleJson<resqml22.ParametricLineArray>;
      const v = await getMinMaxPoints(
        client,
        dataspaceUri,
        lineArray.ControlPoints
      );
      minX = v.minX;
      minY = v.minY;
      maxX = v.maxX;
      maxY = v.maxY;
    }
  } else if (geo.$type === "resqml22.Point3dZValueArray") {
    const zArray = geo as SimpleJson<resqml22.Point3dZValueArray>;
    const sup =
      zArray.SupportingGeometry as SimpleJson<resqml22.Point3dZValueArray>;
    return await getMinMaxPoints(client, dataspaceUri, sup);
  } else if (geo.$type === "resqml22.Point3dLatticeArray") {
    const lArray = geo as SimpleJson<resqml22.Point3dLatticeArray>;
    const [ox, oy] = [lArray.Origin.Coordinate1, lArray.Origin.Coordinate2];
    const [u, v] = [lArray.Dimension[0], lArray.Dimension[1]];
    if (
      u.Spacing.$type === DBL_CST_ARRAY22 &&
      v.Spacing.$type === DBL_CST_ARRAY22
    ) {
      const uSpacing =
        u.Spacing as SimpleJson<eml23.FloatingPointConstantArray>;
      const vSpacing =
        v.Spacing as SimpleJson<eml23.FloatingPointConstantArray>;
      const [uLen, vLen] = [uSpacing.Value, vSpacing.Value];
      const [nu, nv] = [uSpacing.Count + 1, vSpacing.Count + 1];

      const uOffsetLen = Math.sqrt(
        u.Direction.Coordinate1 * u.Direction.Coordinate1 +
        u.Direction.Coordinate2 * u.Direction.Coordinate2
      );

      const vOffsetLen = Math.sqrt(
        v.Direction.Coordinate1 * v.Direction.Coordinate1 +
        v.Direction.Coordinate2 * v.Direction.Coordinate2
      );

      const [ux, uy] =
        uOffsetLen > 1e-6
          ? [
            (uLen * u.Direction.Coordinate1) / uOffsetLen,
            (uLen * u.Direction.Coordinate2) / uOffsetLen
          ]
          : [0, 0];
      const [vx, vy] =
        vOffsetLen > 1e-6
          ? [
            (vLen * v.Direction.Coordinate1) / vOffsetLen,
            (vLen * v.Direction.Coordinate2) / vOffsetLen
          ]
          : [0, 0];
      pNodeCount = nu * nv;
      for (let vv = 0; vv < nv; vv++) {
        for (let uu = 0; uu < nu; uu++) {
          const x = ox + ux * uu + vx * vv;
          const y = oy + uy * uu + vy * vv;
          minX = Math.min(x, minX);
          maxX = Math.max(x, maxX);
          minY = Math.min(y, minY);
          maxY = Math.max(y, maxY);
        }
      }
    }
  } else if (geo.$type === "resqml22.Point3dFromRepresentationLatticeArray") {
    const lArray =
      geo as SimpleJson<resqml22.Point3dFromRepresentationLatticeArray>;
    const rep = lArray.SupportingRepresentation
      ?._data as SimpleJson<resqml22.AbstractRepresentation>;
    const geometries = getGeometries(rep);
    for await (const g of geometries) {
      const v = await getMinMaxPoints(client, dataspaceUri, g.Points);
      minX = Math.min(minX, v.minX);
      minY = Math.min(minY, v.minY);
      maxX = Math.max(maxX, v.maxX);
      maxY = Math.max(maxY, v.maxY);
      pNodeCount += v.pNodeCount;
    }
  }
  return { minX, minY, maxX, maxY, pNodeCount };
};

/**
 * Generic class for all WorkProductComponent created from Resqml Objects
 *
 * @export
 * @class WorkProductComponent
 * @template RES_TYPE
 */
export class ResqmlResource<RES_TYPE extends IResqmlDataObject> {
  public acl: AccessControlList = { owners: [], viewers: [] };
  public kind = "";
  public legal: LegalMetaData = {
    legaltags: [],
    otherRelevantDataCountries: []
  };
  public ancestry?: ParentList;
  public createTime: Date;
  public createUser: string;
  public id: string;
  public modifyTime: Date;
  public modifyUser: string;
  public version: number;
  public tags?: { [key: string]: string };
  public OSDUIntegration?: Record<string, unknown>;
  protected authoringSoftware?: string;
  protected __context?: OSDUContext;

  constructor(
    xml: RES_TYPE,
    context: OSDUContext,
    resourceType: string,
    osduType: string
  ) {
    this.__context = context;

    this.ancestry = undefined;
    this.createTime = xml.Citation.Creation;
    this.createUser = xml.Citation.Originator;
    this.modifyTime = xml.Citation.LastUpdate ?? this.createTime;
    this.modifyUser = xml.Citation.Editor ?? this.createUser;
    this.authoringSoftware = xml.Citation.Format;

    const kind = osduType.split(".")[0];

    this.kind = `osdu:wks:${resourceType}--${kind}:${osduType
      .split(".")
      .slice(1)
      .join(".")}`;
    const id = OSDUContext.osduId(xml.Uuid, xml);
    this.id = `${this.__context.partition}:${resourceType}--${kind}:${id}`;
    this.version = 1;

    // Init OSDUIntegration from CustomData if available
    const xml20 = xml as SimpleJson<resqml20.AbstractResqmlDataObject>;
    if (xml20.ExtraMetadata !== undefined) {
      const osduIntegrationMeta = xml20.ExtraMetadata.find(
        e => e.Name === "OSDUIntegration"
      );
      if (osduIntegrationMeta !== undefined) {
        this.OSDUIntegration = JSON.parse(osduIntegrationMeta.Value);
      }
    } else {
      const xml23 = xml as SimpleJson<eml23.AbstractObject>;
      if (xml23.OSDUIntegration !== undefined) {
        this.OSDUIntegration = {
          ...xml23.OSDUIntegration
        };
      }
    }
  }

  /**
   * Return the resource type ("reference-data", "work-product-component", ...)
   *
   * @returns {string}
   * @memberof WorkProductComponent
   */
  public resourceType(): string {
    const split = this.id.split(":");
    return split[1].split("--")[0];
  }

  /**
   * Return the osdu type ("GenericRepresentation", "HorizonInterpretation", ...)
   *
   * @returns {string}
   * @memberof WorkProductComponent
   */
  public osduType(): string {
    const split = this.id.split(":");
    return split[1].split("--")[1];
  }

  /**
   * Convert a Data Object Reference to an OSDU SRN
   *
   * @param {string} uri
   * @param {(SimpleJson<eml20.DataObjectReference|eml23.DataObjectReference> | undefined)} dor
   * @param {ResqmlClient} client
   * @param {OSDUContext} context
   * @returns {Promise<string | undefined>}
   * @static
   * @memberof WorkProductComponent
   */
  public static async dorToSrn(
    uri: string,
    dor:
      | SimpleJson<eml20.DataObjectReference | eml23.DataObjectReference>
      | undefined,
    client: ResqmlClient,
    context: OSDUContext
  ): Promise<string | undefined> {
    const xml = dor
      ? await this.getObjectFromDor(client, uri, dor, context)
      : undefined;
    const dorUri = dor ? ResqmlWorkProductComponent.dorToUri(uri, dor) : undefined;
    const srn = xml === undefined || dorUri === undefined
      ? undefined
      : context.uriToSrn(dorUri, xml);
    return srn === undefined ? undefined : srn + ":";
  }

  /**
   * Convert a Data Object Reference to an ETP URI.
   * Supports both EML 2.0 (ContentType) and EML 2.3 (QualifiedType) DOR formats.
   * @throws {Error} if the DOR has neither ContentType nor QualifiedType
   */
  public static dorToUri(
    uri: string,
    dor: SimpleJson<eml20.DataObjectReference | eml23.DataObjectReference>
  ): string {
    const dor20 = dor as SimpleJson<eml20.DataObjectReference>;
    if (dor20.ContentType !== undefined) {
      const refType = new EtpContentType(dor20.ContentType).etpType;
      const ds = EtpUri.createDataSpaceUri(new EtpUri(uri).dataSpace).uri;
      const uuid = dor20.UUID ?? (dor as any).Uuid;
      return `${ds}/${refType}(${uuid})`;
    }
    const dor23 = dor as SimpleJson<eml23.DataObjectReference>;
    if (dor23.QualifiedType !== undefined) {
      const refType = dor23.QualifiedType;
      const ds = EtpUri.createDataSpaceUri(new EtpUri(uri).dataSpace).uri;
      return `${ds}/${refType}(${dor23.Uuid})`;
    }
    throw new Error(
      `Invalid DataObjectReference: missing ContentType (EML 2.0) or QualifiedType (EML 2.3). URI: ${uri}, DOR: ${JSON.stringify(dor)}`
    );
  }

  /**
   * Transform a string (typically Energistics) to the OSDU naming convention (PascalCase)
   *
   * @param {(string | undefined)} str
   * @returns {(string | undefined)}
   * @memberof WorkProductComponent
   */
  public capitalize(str: string | undefined): string | undefined {
    if (str === undefined) {
      return undefined;
    }
    const dec = str.split(" ");
    return dec
      .map(s => (s.length > 1 ? s.charAt(0).toUpperCase() + s.slice(1) : ""))
      .join("");
  }

  /**
   * Get resqml objects based on ETP URIs using the context cache
   *
   * @param {ResqmlClient} client
   * @param {string[]} uris
   * @param {OSDUContext} context
   * @returns {(Promise<(IResqmlDataObject | undefined)[]>)}
   * @memberof WorkProductComponent
   */
  public static async getObjects(
    client: ResqmlClient,
    uris: string[],
    context: OSDUContext
  ): Promise<(IResqmlDataObject | undefined)[]> {
    const toFind = uris.filter(s => context?.uriToObject.get(s) === undefined);
    const objects = await client.getObjects(toFind);
    objects.forEach((o, i) => o && context?.uriToObject.set(toFind[i], o));
    return uris.map(u => context?.uriToObject.get(u));
  }

  /**
   * Get a resqml object based on container ETP URI (dataspace or object) and a Data Object Reference inside the container
   *
   * @static
   * @param {ResqmlClient} client
   * @param {string} uri URI of the containing object
   * @param {SimpleJson<eml20.DataObjectReference|eml23.DataObjectReference>} dor
   * @param {OSDUContext} context
   * @returns {(Promise<IResqmlDataObject | undefined>)}
   * @memberof WorkProductComponent
   */
  public static async getObjectFromDor(
    client: ResqmlClient,
    uri: string,
    dor: SimpleJson<eml20.DataObjectReference | eml23.DataObjectReference>,
    context: OSDUContext
  ): Promise<IResqmlDataObject | undefined> {
    if (!dor) {
      return undefined;
    }
    if (dor._data) {
      return dor._data;
    }
    const dorUri = ResqmlWorkProductComponent.dorToUri(uri, dor);
    const objects = await this.getObjects(client, [dorUri], context);
    return objects.length === 1 && objects[0] !== null ? objects[0] : undefined;
  }

  public assignExtraMetaData(
    extraMetadata?: SimpleJson<
      resqml20.NameValuePair | eml23.ExtensionNameValue
    >[]
  ): void {
    if (extraMetadata === undefined) {
      return;
    }
    extraMetadata
      .filter(x => x.Name.startsWith("osdu/"))
      .forEach(x => {
        const path = x.Name.split("/");
        path.shift(); // remove the "osdu" prefix

        // check that the decomposed path corresponds to a valid path in the object prototype
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let curObj: Record<string, any> = this;
        let pathInObject = true;
        const lastindex = path.length - 1;

        for (let i = 0; i < lastindex; i++) {
          if (path[i] in curObj) {
            const key = path[i];
            if (curObj[key] === undefined) {
              curObj[key] = {};
            } else if (typeof curObj[key] !== "object") {
              pathInObject = false;
              break;
            }
            curObj = curObj[key];
          } else {
            pathInObject = false;
            break;
          }
        }

        // If path is valid, set the value
        if (pathInObject) {
          let value = x.Value;
          try {
            if (typeof x.Value === "object") {
              value = JSON.parse((x.Value as any)._);
            } else {
              value = JSON.parse(x.Value);
            }
          } catch (e) {
            value = x.Value;
          }
          curObj[path[lastindex]] = value;
        } else if ("data" in this && typeof this.data === "object") {
          // If path is not valid, set the value in the ExtensionProperties
          const data = this.data as Record<string, any>;
          if (data["ExtensionProperties"] === undefined) {
            data["ExtensionProperties"] = {};
          }
          data.ExtensionProperties[path.join("/")] = x.Value;
        }
      });

    // Preserve authoring software (Citation.Format) for round-trip fidelity
    if (this.authoringSoftware && "data" in this && typeof this.data === "object") {
      const data = this.data as Record<string, any>;
      if (data["ExtensionProperties"] === undefined) {
        data["ExtensionProperties"] = {};
      }
      data.ExtensionProperties["AuthoringSoftware"] = this.authoringSoftware;
    }
  }

  /**
   * Create the AbstractCommonResources part of WPC Data
   *
   * @return {Promise<AbstractCommonResources>}
   * @memberof WorkProductComponent
   */
  public async AbstractCommonResources(
    context: OSDUContext
  ): Promise<AbstractCommonResources> {
    return {
      ExistenceKind: context.addReferenceData("ExistenceKind", "Prototype"),
      ResourceCurationStatus: undefined,
      ResourceHomeRegionID: undefined,
      ResourceHostRegionIDs: undefined,
      ResourceLifecycleStatus: undefined,
      ResourceSecurityClassification: undefined,
      Source: undefined,
      TechnicalAssuranceID: undefined
    };
  }
}

/**
 * Generic class for all WorkProductComponent created from Resqml Objects
 *
 * @export
 * @class ResqmlWorkProductComponent
 * @template RES_TYPE
 */
export class ResqmlWorkProductComponent<
  RES_TYPE extends IResqmlDataObject
> extends ResqmlResource<RES_TYPE> {
  constructor(xml: RES_TYPE, context: OSDUContext, osduType: string) {
    super(xml, context, "work-product-component", osduType);
  }

  /**
   * Compute the age of an interpretation using feature information
   *
   * @static
   * @param {ResqmlClient} client
   * @param {string} uri
   * @param {(SimpleJson<resqml20.AbstractFeatureInterpretation|resqml22.AbstractFeatureInterpretation>
   *       | undefined)} interpretation
   * @returns {(Promise<number | undefined>)}
   * @memberof ResqmlWorkProductComponent
   */
  public async age(
    client: ResqmlClient,
    uri: string,
    interpretation:
      | SimpleJson<
        | resqml20.AbstractFeatureInterpretation
        | resqml22.AbstractFeatureInterpretation
      >
      | undefined
  ): Promise<number | undefined> {
    if (interpretation === undefined || this.__context === undefined) {
      return undefined;
    }
    const int2 =
      interpretation as SimpleJson<resqml22.BoundaryFeatureInterpretation>;
    const a = int2?.AbsoluteAge?.AgeOffsetAttribute;
    if (a !== undefined) {
      return a;
    }
    const feat = (await ResqmlWorkProductComponent.getObjectFromDor(
      client,
      uri,
      interpretation.InterpretedFeature,
      this.__context
    )) as SimpleJson<resqml20.obj_GeneticBoundaryFeature>;
    return feat?.AbsoluteAge?.YearOffset;
  }

  /**
   * Create the reference to a coordinate system
   *
   * @param {(CoordinateReferenceSystem | undefined)} crs
   * @param {number} code
   * @param {OSDUContext} context
   * @returns {(string|undefined)}
   * @memberof ResqmlWorkProductComponent
   */
  public static referenceSystemId(
    crs: CoordinateReferenceSystem | undefined,
    code: number,
    context: OSDUContext
  ): string | undefined {
    return crs !== undefined
      ? crs.id + ":"
      : context.addReferenceData(
        "CoordinateReferenceSystem",
        `Projected:EPSG::${code}`
      );
  }

  /**
   * Extract the persistence string for a coordinate system
   *
   * @param {(CoordinateReferenceSystem | undefined)} crs
   * @param {number} code
   * @returns {string | undefined}
   * @memberof ResqmlWorkProductComponent
   */
  public static persistableReferenceSystem(
    crs: CoordinateReferenceSystem | undefined,
    code: number
  ): string | undefined {
    if (crs?.data?.PersistableReference !== undefined) {
      return crs.data.PersistableReference;
    } else {
      return JSON.stringify({
        authCode: {
          auth: "EPSG",
          code: code
        }
      });
    }
  }

  /**
   * Create the OSDU spatial information from an array of points
   *
   * @param {ResqmlClient} client
   * @param {string} dataspaceUri
   * @param {[number, number][]} pointCoordinates
   * @param {SimpleJson<resqml20.obj_LocalDepth3dCrs>| SimpleJson<eml23.LocalEngineeringCompoundCrs>} crs
   * @returns {(Promise<{
   *     SpatialPoint: AbstractSpatialLocation | undefined;
   *     SpatialArea: AbstractSpatialLocation | undefined;
   *     FrameOfReferenceCRS: FrameOfReferenceMetaDataItem;
   *   }>)}
   * @memberof ResqmlWorkProductComponent
   */
  public static async createSpatialInfoFrom2dPoints(
    client: ResqmlClient,
    dataspaceUri: string,
    pointCoordinates: [number, number][],
    crs:
      | SimpleJson<resqml20.AbstractLocal3dCrs>
      | SimpleJson<eml23.LocalEngineeringCompoundCrs>,
    context: OSDUContext
  ): Promise<{
    SpatialPoint: AbstractSpatialLocation | undefined;
    SpatialArea: AbstractSpatialLocation | undefined;
    FrameOfReferenceCRS: FrameOfReferenceMetaDataItem;
    Wgs84Coordinates: [number, number][] | undefined;
    localFrame?: Record<string, string | number | boolean>;
  }> {
    if (pointCoordinates.length === 0) {
      return Promise.reject(new Error("No geometry provided"));
    }

    let aMinX: number = Number.POSITIVE_INFINITY;
    let aMaxX: number = Number.NEGATIVE_INFINITY;
    let aMinY: number = Number.POSITIVE_INFINITY;
    let aMaxY: number = Number.NEGATIVE_INFINITY;

    for (const g of pointCoordinates) {
      if (g[0] === Number.POSITIVE_INFINITY) {
        break;
      } // Ignore invalid points
      aMinX = Math.min(g[0], aMinX);
      aMinY = Math.min(g[1], aMinY);
      aMaxX = Math.max(g[0], aMaxX);
      aMaxY = Math.max(g[1], aMaxY);
    }

    let CoordinateReferenceSystemID = undefined;
    let persistableReferenceCrs = "";
    let Wgs84Coordinates = undefined;
    let SpatialPoint: AbstractSpatialLocation | undefined;
    let SpatialArea: AbstractSpatialLocation | undefined;
    let epsgCode = -1;
    let epsgCrs: CoordinateReferenceSystem | undefined = undefined;

    let XOffset = 0;
    let YOffset = 0;
    let rotationRad = 0;
    let crsVersion = "";
    let ZOffset = 0;
    let projectedAxisOrder = "";
    let projectedUom = "";
    let verticalUom = "";
    let zIncreasingDownward = false;
    let verticalEpsgCode = -1;
    let verticalCrsId: string | undefined;
    let persistableRefVerticalCrs: string | undefined;

    if (crs.$type === "eml23.LocalEngineeringCompoundCrs") {
      const crs23 = crs as SimpleJson<eml23.LocalEngineeringCompoundCrs>;
      crsVersion = "eml23";
      const projectedCrs = (await this.getObjectFromDor(
        client,
        dataspaceUri,
        crs23.LocalEngineering2dCrs,
        context
      )) as SimpleJson<eml23.LocalEngineering2dCrs>;
      if (projectedCrs) {
        if (
          projectedCrs.OriginProjectedCrs.AbstractProjectedCrs.$type ===
          "eml23.ProjectedEpsgCrs"
        ) {
          epsgCode = (
            projectedCrs.OriginProjectedCrs
              .AbstractProjectedCrs as SimpleJson<eml23.ProjectedEpsgCrs>
          ).EpsgCode;
        }
        XOffset = projectedCrs.OriginProjectedCoordinate1;
        YOffset = projectedCrs.OriginProjectedCoordinate2;
      }
    } else {
      const crs20 = crs as SimpleJson<resqml20.AbstractLocal3dCrs>;
      crsVersion = "eml20";
      if (crs20.ProjectedCrs.$type === "eml20.ProjectedCrsEpsgCode") {
        epsgCode = (
          crs20.ProjectedCrs as SimpleJson<eml20.ProjectedCrsEpsgCode>
        ).EpsgCode;
      } else if (crs20.ProjectedCrs.$type === "eml20.ProjectedUnknownCrs") {
        const unknownVal = (crs20.ProjectedCrs as any).Unknown as string | undefined;
        if (unknownVal && /^PROJC(RS|S)\[/.test(unknownVal)) {
          persistableReferenceCrs = unknownVal;
          CoordinateReferenceSystemID = `ProjectedCRS:WKT:${(crs20 as any).Citation?.Title ?? "Unknown"}`;
        } else if (unknownVal) {
          // ETP server may store a truncated placeholder (e.g. "WKT") instead of
          // the full WKT string. Use the CRS title as a fallback identifier.
          CoordinateReferenceSystemID = `ProjectedCRS:Unknown:${(crs20 as any).Citation?.Title ?? unknownVal}`;
        }
      }
      XOffset = crs20.XOffset;
      YOffset = crs20.YOffset;
      ZOffset = (crs20 as any).ZOffset ?? 0;
      projectedAxisOrder = (crs20 as any).ProjectedAxisOrder ?? "";
      projectedUom = (crs20 as any).ProjectedUom ?? "";
      verticalUom = (crs20 as any).VerticalUom ?? "";
      zIncreasingDownward = (crs20 as any).ZIncreasingDownward ?? false;
      const ar = (crs20 as any).ArealRotation;
      if (ar != null) {
        const val = typeof ar === "number" ? ar : ar._;
        const uom = typeof ar === "number" ? "rad" : (ar.Uom ?? "rad");
        rotationRad = uom === "dega" ? (val * Math.PI) / 180 : val;
      }
      // Vertical CRS extraction
      const vertCrs = (crs20 as any).VerticalCrs;
      if (vertCrs?.$type === "eml20.VerticalCrsEpsgCode") {
        verticalEpsgCode = vertCrs.EpsgCode;
      } else if (vertCrs?.$type === "eml20.VerticalUnknownCrs") {
        const vertUnknownVal = vertCrs.Unknown as string | undefined;
        if (vertUnknownVal && /^VERT(CRS|_CS)\[/.test(vertUnknownVal)) {
          persistableRefVerticalCrs = vertUnknownVal;
          verticalCrsId = `VerticalCRS:WKT:${(crs20 as any).Citation?.Title ?? "Unknown"}`;
        } else if (vertUnknownVal) {
          verticalCrsId = `VerticalCRS:Unknown:${(crs20 as any).Citation?.Title ?? vertUnknownVal}`;
        }
      }
    }
    if (epsgCode !== -1) {
      try {
        epsgCrs = await context.findProjectedEPSGCrs(epsgCode);

        CoordinateReferenceSystemID = this.referenceSystemId(
          epsgCrs,
          epsgCode,
          context
        );
        persistableReferenceCrs =
          this.persistableReferenceSystem(epsgCrs, epsgCode) ?? "";
        if (aMinX !== Number.POSITIVE_INFINITY) {
          Wgs84Coordinates = await context.convertPointsWGS84(
            pointCoordinates,
            epsgCode
          );
        }
      } catch (e) {
        ///Nothing
      }
    }

    const FrameOfReferenceCRS = {
      kind: "CRS",
      persistableReference: persistableReferenceCrs,
      coordinateReferenceSystemID: CoordinateReferenceSystemID
    };

    if (aMinX !== Number.POSITIVE_INFINITY) {
      // Local-to-projected CRS transform (inverse rotation + translation)
      const toProjected = (p: [number, number]): [number, number] => [
        Math.cos(rotationRad) * p[0] + Math.sin(rotationRad) * p[1] + XOffset,
        -Math.sin(rotationRad) * p[0] + Math.cos(rotationRad) * p[1] + YOffset
      ];
      const projectedCoords = pointCoordinates.map(toProjected);

      const Wgs84Min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
      const Wgs84Max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
      if (Wgs84Coordinates !== undefined) {
        for (const g of Wgs84Coordinates) {
          Wgs84Min[0] = Math.min(g[0], Wgs84Min[0]);
          Wgs84Min[1] = Math.min(g[1], Wgs84Min[1]);
          Wgs84Max[0] = Math.max(g[0], Wgs84Max[0]);
          Wgs84Max[1] = Math.max(g[1], Wgs84Max[1]);
        }
      }

      SpatialPoint = {
        AsIngestedCoordinates: {
          CoordinateReferenceSystemID,
          features: [
            {
              type: FluffyType.AnyCRSFeature,
              geometry: {
                type: AnyCRSGeoJSONPointType.AnyCRSPoint,
                coordinates: toProjected(pointCoordinates[0])
              },
              properties: {}
            }
          ],
          persistableReferenceCrs,
          type: AsIngestedCoordinatesType.AnyCRSFeatureCollection,
          ...(verticalEpsgCode !== -1 ? {
            VerticalCoordinateReferenceSystemID: `VerticalCRS:EPSG:${verticalEpsgCode}`,
            persistableReferenceVerticalCrs: JSON.stringify({ authCode: { auth: "EPSG", code: verticalEpsgCode } })
          } : verticalCrsId ? {
            VerticalCoordinateReferenceSystemID: verticalCrsId,
            ...(persistableRefVerticalCrs ? { persistableReferenceVerticalCrs: persistableRefVerticalCrs } : {})
          } : {})
        },
        Wgs84Coordinates:
          Wgs84Coordinates === undefined
            ? undefined
            : {
              type: Wgs84CoordinatesType.FeatureCollection,
              features: [
                {
                  type: StickyType.Feature,
                  properties: {},
                  geometry: {
                    type: GeoJSONPointType.Point,
                    coordinates: Wgs84Coordinates[0]
                  }
                }
              ]
            }
      };
      SpatialArea = {
        AsIngestedCoordinates: {
          type: AsIngestedCoordinatesType.AnyCRSFeatureCollection,
          CoordinateReferenceSystemID,
          persistableReferenceCrs,
          features: [
            {
              type: FluffyType.AnyCRSFeature,
              properties: {},
              geometry: {
                type: AnyCRSGeoJSONPointType.AnyCRSPolygon,
                coordinates: [projectedCoords]
              }
            }
          ],
          bbox: [
            Math.min(...projectedCoords.map(p => p[0])),
            Math.min(...projectedCoords.map(p => p[1])),
            Math.max(...projectedCoords.map(p => p[0])),
            Math.max(...projectedCoords.map(p => p[1]))
          ]
        },
        Wgs84Coordinates:
          Wgs84Coordinates === undefined
            ? undefined
            : {
              type: Wgs84CoordinatesType.FeatureCollection,
              features: [
                {
                  type: StickyType.Feature,
                  properties: {},
                  geometry: {
                    type: GeoJSONPointType.Polygon,
                    coordinates: [Wgs84Coordinates]
                  }
                }
              ],
              bbox: [Wgs84Min[0], Wgs84Min[1], Wgs84Max[0], Wgs84Max[1]]
            }
      };
      if (SpatialPoint !== undefined && context.spatialPoint === undefined) {
        context.spatialPoint = SpatialPoint;
      }
    }

    const localFrame: Record<string, string | number | boolean> | undefined =
      crsVersion ? {
        "rddms/localFrame/xOffset": XOffset,
        "rddms/localFrame/yOffset": YOffset,
        "rddms/localFrame/zOffset": ZOffset,
        "rddms/localFrame/arealRotationDeg": rotationRad * 180 / Math.PI,
        "rddms/localFrame/projectedAxisOrder": projectedAxisOrder,
        "rddms/localFrame/projectedUom": projectedUom,
        "rddms/localFrame/verticalUom": verticalUom,
        "rddms/localFrame/zIncreasingDownward": zIncreasingDownward,
        "rddms/localFrame/crsVersion": crsVersion,
      } : undefined;

    return { SpatialPoint, SpatialArea, FrameOfReferenceCRS, Wgs84Coordinates, localFrame };
  }

  /**
   * Create the OSDU spatial information from a list of geometries
   *
   * @param {ResqmlClient} client
   * @param {string} dataspaceUri
   * @param {SimpleJson<resqml20.PointGeometry|resqml22.PointGeometry>[]} geometries
   * @param {OSDUContext} context
   * @returns {Promise<{
   *     SpatialPoint: AbstractSpatialLocation|undefined;
   *     SpatialArea: AbstractSpatialLocation|undefined;
   *     FrameOfReferenceCRS: FrameOfReferenceMetaDataItem;
   *     NodeCount: number;
   *   }>}
   * @memberof ResqmlWorkProductComponent
   */
  public static async createSpatialInfo(
    client: ResqmlClient,
    dataspaceUri: string,
    geometries: SimpleJson<resqml20.PointGeometry | resqml22.PointGeometry>[],
    context: OSDUContext,
    OSDUIntegration?: SimpleJson<eml23.OSDUIntegration>
  ): Promise<{
    SpatialPoint: AbstractSpatialLocation | undefined;
    SpatialArea: AbstractSpatialLocation | undefined;
    FrameOfReferenceCRS: FrameOfReferenceMetaDataItem;
    NodeCount: number | undefined;
    Domain: string;
  }> {
    if (geometries.length < 1) {
      return Promise.reject(new Error("No geometry provided"));
    }

    const crsObj = await this.getObjectFromDor(
      client,
      dataspaceUri,
      geometries[0].LocalCrs,
      context
    );
    const isDepthCrs =
      crsObj?.$type === "resqml20.obj_LocalDepth3dCrs" ||
      crsObj?.$type === "resqml22.LocalDepth3dCrs";
    const isTimeCrs =
      crsObj?.$type === "resqml20.obj_LocalTime3dCrs" ||
      crsObj?.$type === "resqml22.LocalTime3dCrs";
    const isEml23Crs =
      crsObj?.$type === "eml23.LocalEngineeringCompoundCrs";

    if (!isDepthCrs && !isTimeCrs && !isEml23Crs) {
      // TODO: Other CRS
      return Promise.reject(
        new Error(
          "Only resqml20.obj_LocalDepth3dCrs or resqml20.obj_LocalTime3dCrs or eml23.LocalEngineeringCompoundCrs are supported to create spatial info"
        )
      );
    }
    const crs = isDepthCrs
      ? (crsObj as SimpleJson<resqml20.obj_LocalDepth3dCrs>)
      : isTimeCrs
        ? (crsObj as SimpleJson<resqml20.obj_LocalTime3dCrs>)
        : (crsObj as SimpleJson<eml23.LocalEngineeringCompoundCrs>);
    if (!crs) {
      return Promise.reject(new Error("Invalid CRS"));
    }

    const Domain = isDepthCrs
      ? "Depth"
      : isTimeCrs
        ? "Time"
        : (crsObj as SimpleJson<eml23.LocalEngineeringCompoundCrs>).VerticalAxis
          .IsTime
          ? "Time"
          : "Depth";

    if (
      OSDUIntegration &&
      OSDUIntegration.WGS84Latitude &&
      OSDUIntegration.WGS84Longitude
    ) {
      if (
        OSDUIntegration.WGS84Latitude !== undefined &&
        OSDUIntegration.WGS84Longitude !== undefined
      ) {
        const spatialLocation: AbstractSpatialLocation = {
          Wgs84Coordinates: {
            type: Wgs84CoordinatesType.FeatureCollection,
            features: [
              {
                type: StickyType.Feature,
                properties: {},
                geometry: {
                  type: GeoJSONPointType.Point,
                  coordinates: [
                    OSDUIntegration.WGS84Latitude._,
                    OSDUIntegration.WGS84Longitude._
                  ]
                }
              }
            ]
          }
        };
      }
    }

    let aMinX: number = Number.POSITIVE_INFINITY;
    let aMaxX: number = Number.NEGATIVE_INFINITY;
    let aMinY: number = Number.POSITIVE_INFINITY;
    let aMaxY: number = Number.NEGATIVE_INFINITY;

    let NodeCount = undefined;

    if (context.useDataArrayForManifest) {
      NodeCount = 0;
      for await (const g of geometries) {
        const { minX, minY, maxX, maxY, pNodeCount } = await getMinMaxPoints(
          client,
          dataspaceUri,
          g.Points
        );
        aMinX = Math.min(minX, aMinX);
        aMinY = Math.min(minY, aMinY);
        aMaxX = Math.max(maxX, aMaxX);
        aMaxY = Math.max(maxY, aMaxY);
        NodeCount += pNodeCount;
      }
    }

    const { SpatialPoint, SpatialArea, FrameOfReferenceCRS } =
      await this.createSpatialInfoFrom2dPoints(
        client,
        dataspaceUri,
        [
          [aMinX, aMinY],
          [aMaxX, aMinY],
          [aMaxX, aMaxY],
          [aMinX, aMaxY],
          [aMinX, aMinY]
        ],
        crs,
        context
      );

    return {
      SpatialPoint,
      SpatialArea,
      FrameOfReferenceCRS,
      NodeCount,
      Domain
    };
  }

  /**
   * Get the array information
   * @param array to evaluate
   * @returns {rowCount?: number, valuePerRow?: number, valueType?: string}
   */
  public arrayInfos(array: SimpleJson<eml23.AbstractValueArray>): {
    rowCount?: number;
    valuePerRow?: number;
    valueType?: string;
  } {
    switch (array.$type) {
      case BOO_CST_ARRAY22: {
        const dbc = array as SimpleJson<eml23.BooleanConstantArray>;
        return { rowCount: dbc.Count, valuePerRow: 1, valueType: "boolean" };
      }
      case BOO_HDF_ARRAY22: {
        const dbe = array as SimpleJson<eml23.BooleanExternalArray>;
        const dbeRowCount = dbe.Values.ExternalDataArrayPart.reduce(
          (prev, part) => prev + part.Count.reduce((p, c) => p * c, 1),
          0
        );
        return { rowCount: dbeRowCount, valuePerRow: 1, valueType: "boolean" };
      }
      case BOO_XML_ARRAY22: {
        const dbx = array as SimpleJson<eml23.BooleanXmlArray>;
        return {
          rowCount: dbx.Values.length,
          valuePerRow: dbx.CountPerValue,
          valueType: "boolean"
        };
      }
      case INT_CST_ARRAY22: {
        const dic = array as SimpleJson<eml23.IntegerConstantArray>;
        return { rowCount: dic.Count, valuePerRow: 1, valueType: "integer" };
      }
      case INT_HDF_ARRAY22: {
        const die = array as SimpleJson<eml23.IntegerExternalArray>;
        const dieRowCount = die.Values.ExternalDataArrayPart.reduce(
          (prev, part) => prev + part.Count.reduce((p, c) => p * c, 1),
          0
        );
        return { rowCount: dieRowCount, valuePerRow: 1, valueType: "integer" };
      }
      case INT_XML_ARRAY22: {
        const dix = array as SimpleJson<eml23.IntegerXmlArray>;
        return {
          rowCount: dix.Values.length,
          valuePerRow: dix.CountPerValue,
          valueType: "integer"
        };
      }
      case INT_JAG_ARRAY22:
        return { valuePerRow: 1, valueType: "integer" };
      case INT_LAT_ARRAY22:
        return { valuePerRow: 1, valueType: "integer" };
      case DBL_CST_ARRAY22: {
        const dfc = array as SimpleJson<eml23.FloatingPointConstantArray>;
        return { rowCount: dfc.Count, valuePerRow: 1, valueType: "number" };
      }
      case DBL_HDF_ARRAY22: {
        const dfe = array as SimpleJson<eml23.FloatingPointExternalArray>;
        const dfeRowCount = dfe.Values.ExternalDataArrayPart.reduce(
          (prev, part) => prev + part.Count.reduce((p, c) => p * c, 1),
          0
        );
        return {
          rowCount: dfeRowCount,
          valuePerRow: dfe.CountPerValue,
          valueType: "number"
        };
      }
      case DBL_XML_ARRAY22: {
        const dfx = array as SimpleJson<eml23.FloatingPointXmlArray>;
        return {
          rowCount: dfx.Values.length,
          valuePerRow: dfx.CountPerValue,
          valueType: "number"
        };
      }
      case DBL_LAT_ARRAY22:
        return { valuePerRow: 1, valueType: "number" };
    }
    return { valuePerRow: 1 };
  }

  public refUuid(
    dor: SimpleJson<eml20.DataObjectReference | eml23.DataObjectReference>
  ): string {
    const dor20 = dor as SimpleJson<eml20.DataObjectReference>;
    if (dor20.UUID !== undefined) {
      return dor20.UUID;
    }
    const dor23 = dor as SimpleJson<eml23.DataObjectReference>;
    return dor23.Uuid;
  }

  /**
   * Get the objects involved in creating an object
   *
   * @param {ResqmlClient} client
   * @param {string} objectUri
   * @returns {Promise<SimpleJson<eml20.DataObjectReference>[]>}
   * @memberof ResqmlWorkProductComponent
   */
  public async getCreatingObjects(
    client: ResqmlClient,
    objectUri: string
  ): Promise<
    SimpleJson<eml20.DataObjectReference | eml23.DataObjectReference>[]
  > {
    if (!this.__context) {
      return [];
    }
    const RESQML20_ACTIVITY_TYPE = `resqml20.obj_Activity`;
    const sources = await client.getSources(objectUri, false, [
      RESQML20_ACTIVITY_TYPE
    ]);

    const EML23_ACTIVITY_TYPE = `eml23.Activity`;
    sources.push(
      ...(await client.getSources(objectUri, false, [EML23_ACTIVITY_TYPE]))
    );

    const matchingDors: SimpleJson<
      eml20.DataObjectReference | eml23.DataObjectReference
    >[] = [];

    // Find all activities for which the the object is an output
    const etpUri = new EtpUri(objectUri);
    const activities: SimpleJson<resqml20.obj_Activity | eml23.Activity>[] = (
      await ResqmlWorkProductComponent.getObjects(
        client,
        sources.map(r => r.uri),
        this.__context
      )
    ).filter(r => r !== undefined) as SimpleJson<
      resqml20.obj_Activity | eml23.Activity
    >[];

    const dors: SimpleJson<
      eml20.DataObjectReference | eml23.DataObjectReference
    >[] = [];
    for (const a of activities) {
      const temp = await ResqmlWorkProductComponent.getObjectFromDor(
        client,
        objectUri,
        a.ActivityDescriptor,
        this.__context
      );
      if (temp === undefined) {
        continue;
      }
      if (temp.$type === "resqml20.obj_ActivityTemplate") {
        const template = temp as SimpleJson<resqml20.obj_ActivityTemplate>;
        for (const p of a.Parameter) {
          const dop = p as SimpleJson<resqml20.DataObjectParameter>;
          if (dop.DataObject?.UUID === etpUri.uuid) {
            const tp = template.Parameter.find(t => t.Title === dop.Title);
            if (tp?.IsOutput) {
              for (const p of a.Parameter) {
                if (p.$type !== "resqml20.DataObjectParameter") {
                  continue;
                }
                const tp2 = template.Parameter.find(t => t.Title === p.Title);
                if (tp2?.IsInput !== true) {
                  continue;
                }
                const dop20 = p as SimpleJson<resqml20.DataObjectParameter>;
                if (this.refUuid(dop20.DataObject) !== etpUri.uuid) {
                  dors.push(dop20.DataObject);
                }
              }
            }
          }
        }
      } else if (temp.$type === "eml23.ActivityTemplate") {
        const template = temp as SimpleJson<eml23.ActivityTemplate>;
        for (const p of a.Parameter) {
          const dop = p as SimpleJson<eml23.DataObjectParameter>;
          if (dop.DataObject?.Uuid === etpUri.uuid) {
            const tp = template.Parameter.find(t => t.Title === dop.Title);
            if (tp?.IsOutput) {
              for (const p of a.Parameter) {
                if (p.$type !== "eml23.DataObjectParameter") {
                  continue;
                }
                const tp2 = template.Parameter.find(t => t.Title === p.Title);
                if (tp2?.IsInput !== true) {
                  continue;
                }
                const dop22 = p as SimpleJson<eml23.DataObjectParameter>;
                if (this.refUuid(dop22.DataObject) !== etpUri.uuid) {
                  dors.push(dop22.DataObject);
                }
              }
            }
          }
        }
      }
    }

    // From objects that are input of the activity, identify the one
    // pointing to the same target (Typically interpretation) that is not a crs or
    // hdf
    if (dors.length === 0) {
      return dors;
    }
    const tgUris = new Set<URI>();
    const xml = await ResqmlWorkProductComponent.getObjects(
      client,
      [objectUri],
      this.__context
    );
    if (xml.length !== 1 || xml[0] === undefined) {
      return dors;
    }
    client.getObjectTargets(new EtpUri(objectUri).dataSpace, xml[0], tgUris);
    for (const d of dors) {
      const tg = await ResqmlWorkProductComponent.getObjectFromDor(
        client,
        objectUri,
        d,
        this.__context
      );
      const oUris = new Set<URI>();
      if (tg) {
        client.getObjectTargets(new EtpUri(objectUri).dataSpace, tg, oUris);
        if (
          [...oUris].some(o => {
            if (!tgUris.has(o)) {
              return false;
            }
            const ou = new EtpUri(o).dataObjectType;
            return (
              ou.indexOf("Crs") === -1 && ou.indexOf("ExternalPart") === -1
            );
          }) &&
          !matchingDors.some(m => this.refUuid(d) === this.refUuid(m))
        ) {
          matchingDors.push(d);
        }
      }
    }
    return matchingDors;
  }

  /**
   * Create the AbstractWPCGroupType part of WPC Data
   *
   * @param {string} ReservoirDMSUrl
   * @param {OSDUContext} context
   * @returns {Promise<AbstractWPCGroupType>}
   * @memberof WorkProductComponent
   */
  public async AbstractWPCGroupType(
    ReservoirDMSUrl: string,
    context: OSDUContext
  ): Promise<AbstractWPCGroupType> {
    const aclLegal = context.dataspaceACLs.get(
      new EtpUri(ReservoirDMSUrl).dataSpace
    );
    return {
      Artefacts: undefined,
      DDMSDatasets: [
        ReservoirDMSUrl.replace("eml:///", `eml://${context.rddmsId}/`)
      ],
      IsDiscoverable: true,
      IsExtendedLoad: false,
      NameAliases: undefined,
      TechnicalAssurances: context.technicalAssurances
    };
  }

  /**
   * Create the AbstractACLandLegal part of WPC Data
   *
   * @param {OSDUContext} context
   * @param {string} uri
   * @return {DataspaceLegalACL}
   * @memberof ResqmlWorkProductComponent
   */
  public AbstractACLandLegal(
    context: OSDUContext,
    uri: string
  ): DataspaceLegalACL {
    const aclLegal = context.dataspaceACLs.get(new EtpUri(uri).dataSpace);
    return (
      aclLegal ?? {
        acl: { owners: [], viewers: [] },
        legal: { legaltags: [], otherRelevantDataCountries: [] }
      }
    );
  }

  /**
   * Create the AbstractWorkProductComponent part of WPC Data
   *
   * @param {SimpleJson<resqml20.AbstractResqmlDataObject| eml23.AbstractObject>} xml
   * @param {OSDUContext} context
   * @return {Promise<AbstractWorkProductComponent>}
   * @memberof ResqmlWorkProductComponent
   */
  public async AbstractWorkProductComponent(
    xml: SimpleJson<resqml20.AbstractResqmlDataObject | eml23.AbstractObject>,
    context: OSDUContext
  ): Promise<AbstractWorkProductComponent> {
    return {
      AuthorIDs: undefined,
      BusinessActivities: undefined,
      CreationDateTime: this.createTime,
      Description: xml.Citation.Description,
      GeoContexts: undefined,
      LineageAssertions: undefined,
      Name: xml.Citation.Title,
      SpatialArea: undefined,
      SpatialPoint: undefined,
      SubmitterName: context.submitter,
      Tags: undefined
    };
  }

  /**
   * Create the AbstractInterpretation part of WPC Data
   *
   * @param {string} ReservoirDMSUrl
   * @param {SimpleJson<resqml20.AbstractFeatureInterpretation| resqml22.AbstractFeatureInterpretation>} xml
   * @param {ResqmlClient} client
   * @param {OSDUContext} context
   * @returns {Promise<AbstractInterpretation>}
   * @memberof ResqmlWorkProductComponent
   */
  public async AbstractInterpretation(
    ReservoirDMSUrl: string,
    xml: SimpleJson<
      | resqml20.AbstractFeatureInterpretation
      | resqml22.AbstractFeatureInterpretation
    >,
    client: ResqmlClient,
    context: OSDUContext
  ): Promise<AbstractInterpretation> {
    const feat = (await ResqmlWorkProductComponent.getObjectFromDor(
      client,
      ReservoirDMSUrl,
      xml.InterpretedFeature,
      context
    )) as SimpleJson<resqml20.AbstractFeature | resqml22.AbstractFeature>;

    const strAge = await this.age(client, ReservoirDMSUrl, xml);
    let OlderPossibleAge = strAge;
    let YoungerPossibleAge = strAge;
    const xml20 = xml as SimpleJson<resqml20.AbstractFeatureInterpretation>;
    if (xml20.HasOccuredDuring?.ChronoBottom !== undefined) {
      const bot = (await ResqmlWorkProductComponent.getObjectFromDor(
        client,
        ReservoirDMSUrl,
        xml20.HasOccuredDuring?.ChronoBottom,
        context
      )) as SimpleJson<
        | resqml20.obj_StratigraphicUnitInterpretation
        | resqml22.StratigraphicUnitInterpretation
      >;
      OlderPossibleAge = await this.age(client, ReservoirDMSUrl, bot);
    }
    if (xml20.HasOccuredDuring?.ChronoTop !== undefined) {
      const top = (await ResqmlWorkProductComponent.getObjectFromDor(
        client,
        ReservoirDMSUrl,
        xml20.HasOccuredDuring?.ChronoTop,
        context
      )) as SimpleJson<
        | resqml20.obj_StratigraphicUnitInterpretation
        | resqml22.StratigraphicUnitInterpretation
      >;
      YoungerPossibleAge = await this.age(client, ReservoirDMSUrl, top);
    }

    const xml22 = xml as SimpleJson<resqml22.AbstractFeatureInterpretation>;
    if (xml22.HasOccurredDuring !== undefined) {
      const boundInterval =
        xml22.HasOccurredDuring as SimpleJson<resqml22.GeneticBoundaryBasedTimeInterval>;

      if (boundInterval.ChronoBottom !== undefined) {
        const bot = (await ResqmlWorkProductComponent.getObjectFromDor(
          client,
          ReservoirDMSUrl,
          boundInterval.ChronoBottom,
          context
        )) as SimpleJson<
          | resqml20.obj_StratigraphicUnitInterpretation
          | resqml22.StratigraphicUnitInterpretation
        >;
        OlderPossibleAge = await this.age(client, ReservoirDMSUrl, bot);
      }
      if (boundInterval.ChronoTop !== undefined) {
        const top = (await ResqmlWorkProductComponent.getObjectFromDor(
          client,
          ReservoirDMSUrl,
          boundInterval.ChronoTop,
          context
        )) as SimpleJson<
          | resqml20.obj_StratigraphicUnitInterpretation
          | resqml22.StratigraphicUnitInterpretation
        >;
        YoungerPossibleAge = await this.age(client, ReservoirDMSUrl, top);
      }

      const timeInterval =
        xml22.HasOccurredDuring as SimpleJson<resqml22.GeologicTimeBasedTimeInterval>;
      OlderPossibleAge = timeInterval.Start.AgeOffsetAttribute;
      YoungerPossibleAge = timeInterval.End.AgeOffsetAttribute;
    }

    return {
      DomainTypeID: context.addReferenceData(
        "DomainType",
        this.capitalize(xml.Domain)
      ),
      FeatureID: await ResqmlWorkProductComponent.dorToSrn(
        ReservoirDMSUrl,
        xml.InterpretedFeature,
        client,
        context
      ),
      FeatureName: feat.Citation.Title,
      MeanPossibleAge:
        OlderPossibleAge !== undefined && YoungerPossibleAge !== undefined
          ? (OlderPossibleAge + YoungerPossibleAge) / 2
          : OlderPossibleAge ?? YoungerPossibleAge,
      OlderPossibleAge,
      YoungerPossibleAge
    };
  }
}
