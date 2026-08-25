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

  public put(
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

  public putSubarrays(
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
