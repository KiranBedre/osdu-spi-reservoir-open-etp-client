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

import {
  DataObject,
  ErrorCode,
  ErrorInfo,
  EtpError,
  MessageFlags
} from "../common/EtpTypes";

import { BaseHandler } from "../common/BaseHandler";
import { ETPCore } from "../common/ETPCore";
import {
  MapResponseHandler,
  SuccessMapResponseHandler
} from "../common/ResponseHandlers";

import { Energistics, Integer64 } from "../common/Etp12";
import { EtpUri } from "../common/EtpUri";

import { v4 as uuidRandom } from "uuid";
import { EventName } from "../../certification/helper/constants";

const Core = Energistics.Etp.v12.Protocol.Core;
const Store = Energistics.Etp.v12.Protocol.Store;
const PROTOCOL = Energistics.Etp.v12.Datatypes.Protocol;

class DataObjectsResponseHandler extends MapResponseHandler<DataObject> {
  chunkKeys: Map<string, { key: string; correlationId: Integer64 }> = new Map();
  private chunkBuffers: Map<string, Buffer[]> = new Map();

  /**
   * Process the content of a Chunk message
   * Add the chunk data to the data object
   *
   * @param _header header of the chunk message
   * @param chunk chunk message content
   */
  public onChunk(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    chunk: Energistics.Etp.v12.Protocol.Store.Chunk
  ) {
    // Find chunk from UUID
    const uuid = EtpUri.uuidByteArrayToString(chunk.blobId);
    const chunkKey = this.chunkKeys.get(uuid);
    if (!chunkKey) {
      throw new EtpError(
        `Chunk ID {${chunk.blobId.toString()}} not found in data object map`,
        ErrorCode.ENOT_FOUND
      );
    }

    // Find request from chunk header correlationId
    const request = this.get(header.correlationId);

    // Find data object from key
    if (!request) {
      throw new EtpError(
        `Request {${header.correlationId}} not found`,
        ErrorCode.ENOT_FOUND
      );
    }

    const key = chunkKey.key;
    const dataObject = request.results.get(key);
    if (!dataObject) {
      throw new EtpError(
        `Data object {${key}} not found in data object map`,
        ErrorCode.ENOT_FOUND
      );
    }

    // check that data object blobId is the same as chunk blobId
    if (
      !dataObject.blobId ||
      EtpUri.uuidByteArrayToString(dataObject.blobId) !== uuid
    ) {
      throw new EtpError(
        `Data object {${key}} blobId is different from chunk blobId {${uuid}}`,
        ErrorCode.EINVALID_STATE
      );
    }

    // Accumulate chunk data efficiently (avoid O(n²) Buffer.concat in loop)
    let buffers = this.chunkBuffers.get(uuid);
    if (!buffers) {
      buffers = [];
      this.chunkBuffers.set(uuid, buffers);
    }
    buffers.push(chunk.data);

    if (chunk.final) {
      // Concat all chunks at once
      dataObject.data = Buffer.concat(buffers);
      this.chunkBuffers.delete(uuid);
      // Remove chunk from map
      this.chunkKeys.delete(uuid);
      dataObject.blobId = null;
    }
  }

  /**
   * Handle a successful response message.
   * Save chunk information in chunkKeys map then call super.onResponse
   *
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Map<string, Energistics.Etp.v12.Datatypes.Object.DataObject>} items
   * @returns {boolean}
   * @memberof ItemMapResponseHandler
   */
  public onResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    items: Map<string, Energistics.Etp.v12.Datatypes.Object.DataObject>
  ): boolean {
    items.forEach((value, key) => {
      if (value.blobId) {
        const uuid = EtpUri.uuidByteArrayToString(value.blobId);
        this.chunkKeys.set(uuid, { correlationId: header.correlationId, key });
      }
    });
    return super.onResponse(header, items);
  }
}

/**
 * Implementation of client for Store protocol
 *
 * @export
 * @class StoreCustomer
 * @extends {BaseHandler}
 */
export class StoreCustomer extends BaseHandler {
  private readonly storeResolve;
  private readonly successResolve;

  constructor(public sessionManager: ETPCore) {
    super(sessionManager);
    this._role = "customer";
    this._protocol = PROTOCOL.Store;
    this.successResolve = new SuccessMapResponseHandler(
      sessionManager.responseTimeoutPeriod
    );
    this.storeResolve = new DataObjectsResponseHandler(
      sessionManager.responseTimeoutPeriod
    );
  }
  public handleMessage(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody:
      | Energistics.Etp.v12.Protocol.Store.GetDataObjectsResponse
      | Energistics.Etp.v12.Protocol.Store.PutDataObjectsResponse
      | Energistics.Etp.v12.Protocol.Store.DeleteDataObjectsResponse
      | Energistics.Etp.v12.Protocol.Store.Chunk
      | Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): void {
    if (messageHeader.protocol !== PROTOCOL.Store) {
      throw new Error(
        `Unsupported protocol {${messageHeader.protocol}} in Store`
      );
    }
    switch (messageHeader.messageType) {
      case Store.MsgGetDataObjectsResponse: {
        this.logTrace(
          `Received Store.GetDataObjectsResponse message for ${messageHeader.correlationId}.`
        );
        const body =
          messageBody as Energistics.Etp.v12.Protocol.Store.GetDataObjectsResponse;
        this.onGetDataObjectsResponse(messageHeader, body);
        this.emit(EventName.GET_DATA_OBJECT_RESPONSE, {
          header: messageHeader,
          body
        });
        break;
      }
      case Store.MsgPutDataObjectsResponse: {
        this.logTrace(
          `Received Store.PutDataObjectsResponse message for ${messageHeader.correlationId}.`
        );
        this.onPutDataObjectsResponse(
          messageHeader,
          messageBody as Energistics.Etp.v12.Protocol.Store.PutDataObjectsResponse,
          this.successResolve
        );
        this.emit(EventName.PUT_DATA_OBJECTS_RESPONSE, {
          header: messageHeader,
          body: messageBody
        });
        break;
      }
      case Store.MsgDeleteDataObjectsResponse: {
        this.logTrace(
          `Received Store.DeleteDataObjectsResponse message for ${messageHeader.correlationId}.`
        );
        this.onDeleteDataObjectsResponse(
          messageHeader,
          messageBody as Energistics.Etp.v12.Protocol.Store.DeleteDataObjectsResponse,
          this.successResolve
        );
        this.emit(EventName.DELETE_DATA_OBJECTS_RESPONSE, {
          header: messageHeader,
          body: messageBody
        });
        break;
      }
      case Store.MsgChunk: {
        this.logTrace(
          `Received Store.Chunk message for ${messageHeader.correlationId}.`
        );
        this.onChunk(
          messageHeader,
          messageBody as Energistics.Etp.v12.Protocol.Store.Chunk
        );
        break;
      }
      case Core.MsgProtocolException: {
        this.logTrace(
          `Received Store.ProtocolException message for ${messageHeader.correlationId}.`
        );
        const errorMessage =
          messageBody as Energistics.Etp.v12.Protocol.Core.ProtocolException;
        this.onDataObjectsError(messageHeader, errorMessage);
        this.emit(EventName.PROTOCOL_EXCEPTION, {
          header: messageHeader,
          body: errorMessage
        });
        break;
      }
      default: {
        super.handleMessage(messageHeader, messageBody);
      }
    }
  }

  /**
   * Get some XML objects from the server
   *
   * @param {string[]} uriString
   * @returns {(Promise<Array<DataObject | null>>)}
   * @memberof StoreCustomer
   */
  public get(uriString: string[]): Promise<Array<DataObject | null>> {
    this.logTrace(`Getting ${uriString} from store`);
    let header: Energistics.Etp.v12.Datatypes.MessageHeader =
      this.sessionManager.createFinalMessageHeader(
        PROTOCOL.Store,
        Store.MsgGetDataObjects,
        BigInt(0)
      );
    const uris = new Map<string, string>();
    const keys: string[] = uriString.map((u: string) => {
      const key = encodeURI(u);
      uris.set(key, key);
      return key;
    });
    const getDataObject: Energistics.Etp.v12.Protocol.Store.GetDataObjects = {
      format: "xml",
      uris
    };
    const data = this.sessionManager.computeData(header, getDataObject);
    this.logTrace(`Sending Store.GetDataObjects ${header.messageId}.`);

    // Size of message exceed allowed size
    if (
      this.sessionManager.negotiatedSize &&
      data.byteLength > this.sessionManager.negotiatedSize
    ) {
      const nbPart = Math.ceil(
        data.byteLength / this.sessionManager.negotiatedSize
      );
      const partSize = Math.ceil(uris.size / nbPart);
      let nbUris = 0;
      for (let i = 0; i < nbPart; i++) {
        const uriMap = new Map<string, string>();
        for (let j = 0; j < partSize && nbUris < keys.length; j++, nbUris++) {
          const key = keys[nbUris];
          uriMap.set(key, key);
        }
        const getDataObject2: Energistics.Etp.v12.Protocol.Store.GetDataObjects =
        {
          format: "xml",
          uris: uriMap
        };
        const data2 = this.sessionManager.computeData(header, getDataObject2);
        if (i === nbPart - 1) {
          // Last part, create a promise
          return this.storeResolve.waitForRequest(
            this.sessionManager.sendData(header.messageId, data2),
            keys
          );
        } else {
          // Not last part, do not wait, create new header
          this.sessionManager.sendData(header.messageId, data2);
          header = this.sessionManager.createFinalMessageHeader(
            PROTOCOL.Store,
            Store.MsgGetDataObjects,
            BigInt(0)
          );
        }
      }
      return this.storeResolve.waitForRequest(
        this.sessionManager.sendData(header.messageId, data),
        keys
      );
    } else {
      return this.storeResolve.waitForRequest(
        this.sessionManager.sendData(header.messageId, data),
        keys
      );
    }
  }

  /**
   * Send a single object to the server, if object is smaller than negotiated size send it in one PutDataObjects message,
   * otherwise split it in multiple messages using Chunk messages.
   *
   * @param key The key to use for the object (URI)
   * @param value The object to send
   * @param negotiatedSize The negotiated size for message (optional)
   * @returns {Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]>} The promise waiting for the response
   */
  public sendSingleObject(
    key: string,
    value: DataObject,
    negotiatedSize?: number
  ): Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.Store,
      Store.MsgPutDataObjects,
      BigInt(0)
    );

    const map = new Map<string, DataObject>();
    map.set(value.resource.uri, value);

    // If negotiated size is not defined or object fit in one message, send the message
    const allBuffer = this.sessionManager.computeData(header, {
      dataObjects: map,
      pruneContainedObjects: false
    });
    if (
      negotiatedSize === undefined ||
      allBuffer.byteLength <= negotiatedSize
    ) {
      this.logTrace(
        `Sending Store.PutDataObjects ${header.messageId} : ${key}}.`
      );
      return this.successResolve.waitForRequest(
        this.sessionManager.sendData(header.messageId, allBuffer),
        [key]
      );
    }

    // Object is too big, split it in multiple messages

    // Initialize blob information
    const chunkData = value.data;
    value.data = Buffer.alloc(0);
    value.blobId = EtpUri.uuidStringToByteArray(uuidRandom());

    // Send first parent message
    const putDataObject: Energistics.Etp.v12.Protocol.Store.PutDataObjects =
      new Energistics.Etp.v12.Protocol.Store.PutDataObjects();
    putDataObject.dataObjects.set(key, value);
    // Remove MessageFlags.FINALPART bit from header.messageFlags
    header.messageFlags = header.messageFlags & ~MessageFlags.FINALPART;

    const parentId = this.sessionManager.send(header, putDataObject);
    this.logTrace(
      `Sending Store.PutDataObjects ${header.messageId} : ${key}} in chunks.`
    );

    // Send the data as chunks maximum size of negotiated size

    const chunk: Energistics.Etp.v12.Protocol.Store.Chunk = {
      blobId: value.blobId,
      data: Buffer.alloc(0),
      final: false
    };
    // Compute the size of the header plus buffer
    const headerChunkSize = 50;

    const chunkSize = negotiatedSize - headerChunkSize;

    for (let i = 0; i < chunkData.length; i += chunkSize) {
      const headerChunk = this.sessionManager.createHeader(
        PROTOCOL.Store,
        Store.MsgChunk,
        parentId
      );
      // For some reason the subarray is not working as expected as it does not return a Buffer
      // so we create a new Buffer from the subarray
      chunk.blobId = value.blobId;
      chunk.data = Buffer.from(chunkData.subarray(i, i + chunkSize));
      chunk.final = i + chunkSize >= chunkData.length;

      if (chunk.final) {
        headerChunk.messageFlags =
          headerChunk.messageFlags | MessageFlags.FINALPART;
        this.sessionManager.send(headerChunk, chunk);
        return this.successResolve.waitForRequest(parentId, [key]);
      } else {
        this.sessionManager.send(headerChunk, chunk);
      }
    }
    return Promise.reject(
      new EtpError(
        `Cannot Chunk ${value.resource.uri}`,
        ErrorCode.EINVALID_STATE
      )
    );
  }

  public async put(
    data: Energistics.Etp.v12.Datatypes.Object.DataObject[]
  ): Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]> {
    const dataObjects = new Map<
      string,
      Energistics.Etp.v12.Datatypes.Object.DataObject
    >();
    data.forEach(d => {
      d.resource.uri = encodeURI(d.resource.uri);
      dataObjects.set(d.resource.uri, d);
    });

    const promises: Array<Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]>> =
      [];

    const negotiatedSize = this.sessionManager.negotiatedSize;
    if (negotiatedSize) {
      // Try to group the objects without exceeding message size

      const header = this.sessionManager.createFinalMessageHeader(
        PROTOCOL.Store,
        Store.MsgPutDataObjects,
        BigInt(0)
      );

      const allBuffer = this.sessionManager.computeData(header, {
        dataObjects,
        pruneContainedObjects: false
      });
      if (allBuffer.byteLength < negotiatedSize) {
        // Remaining objects fit in one message, send them
        promises.push(
          this.successResolve.waitForRequest(
            this.sessionManager.sendData(header.messageId, allBuffer),
            Array.from(dataObjects.keys())
          )
        );
      }
    }
    // No batch send, carefully send objects one by one
    if (promises.length == 0) {
      let count = 0;
      dataObjects.forEach((value, key) => {
        count++;
        const putDataObject: Energistics.Etp.v12.Protocol.Store.PutDataObjects =
          new Energistics.Etp.v12.Protocol.Store.PutDataObjects();
        putDataObject.dataObjects.set(key, value);

        promises.push(this.sendSingleObject(key, value, negotiatedSize));
      });
    }
    return Promise.all(promises)
      .then(res => res.flat(1))
      .catch(() => {
        const info = new Energistics.Etp.v12.Datatypes.ErrorInfo();
        info.code = ErrorCode.EINVALID_STATE;
        info.message = "Unknown error";
        return Array.from({ length: data.length }, () => info);
      });
  }

  /**
   * Delete a series of objects
   *
   * @param {string[]} uriString
   * @returns {Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]>}
   * @memberof StoreCustomer
   */
  public deleteObjects(
    uriString: string[]
  ): Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]> {
    return this.deleteObjectsWithPrune(uriString, false);
  }

  /**
   * Delete a series of objects
   *
   * @param {string[]} uriString
   * @param {pruneContainedObjects} boolean
   * @returns {Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]>}
   * @memberof StoreCustomer
   */
  public deleteObjectsWithPrune(
    uriString: string[],
    pruneContainedObjects: boolean
  ): Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]> {
    this.logTrace(`Deleting ${uriString} from store`);
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.Store,
      Store.MsgDeleteDataObjects,
      BigInt(0)
    );
    const uris = new Map<string, string>();
    const keys: string[] = uriString.map((u: string) => {
      const key = encodeURI(u);
      uris.set(key, key);
      return key;
    });
    const deleteDataObject: Energistics.Etp.v12.Protocol.Store.DeleteDataObjects =
    {
      pruneContainedObjects: pruneContainedObjects,
      uris
    };

    const data = this.sessionManager.computeData(header, deleteDataObject);
    this.logTrace(`Sending Store.DeleteDataObjects ${header.messageId}.`);

    // Size of message exceed allowed size
    if (
      this.sessionManager.negotiatedSize &&
      data.byteLength > this.sessionManager.negotiatedSize
    ) {
      const nbPart = Math.ceil(
        data.byteLength / this.sessionManager.negotiatedSize
      );
      const partSize = Math.ceil(uris.size / nbPart);
      let nbUris = 0;
      for (let i = 0; i < nbPart; i++) {
        const uriMap = new Map<string, string>();
        for (let j = 0; j < partSize; j++, nbUris++) {
          const key = keys[nbUris];
          uriMap.set(key, key);
        }
        const deleteDataObject2: Energistics.Etp.v12.Protocol.Store.DeleteDataObjects =
        {
          pruneContainedObjects: pruneContainedObjects,
          uris: uriMap
        };
        const data2 = this.sessionManager.computeData(
          header,
          deleteDataObject2
        );
        if (i === nbPart - 1) {
          // Last part, create a promise
          header.messageFlags = header.messageFlags | MessageFlags.FINALPART;
          return this.successResolve.waitForRequest(
            this.sessionManager.sendData(header.messageId, data2),
            keys
          );
        } else {
          // Not last part, do not wait.
          this.sessionManager.sendData(header.messageId, data2);
        }
      }
      return this.successResolve.waitForRequest(
        this.sessionManager.sendData(header.messageId, data),
        keys
      );
    } else {
      return this.successResolve.waitForRequest(
        this.sessionManager.sendData(header.messageId, data),
        keys
      );
    }
  }

  /**
   * Resolve a PutDataObjects response message query corresponding to the correlationId
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param message
   * @returns nothing
   * @memberof StoreCustomer
   */
  protected onPutDataObjectsResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Store.PutDataObjectsResponse,
    map: SuccessMapResponseHandler
  ): void {
    const m = new Map<string, ErrorInfo>();
    message.success.forEach((value, key) => {
      if (value.createdContainedObjectUris.length > 0) {
        m.set(key, {
          code: ErrorCode.IS_OK,
          message: ""
        });
      }
    });
    map.onException(header, { error: null, errors: m });
  }

  /**
   * Resolve a DeleteDataObjects response message query corresponding to the correlationId
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param message
   * @returns nothing
   * @memberof StoreCustomer
   */
  protected onDeleteDataObjectsResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Store.DeleteDataObjectsResponse,
    map: SuccessMapResponseHandler
  ): void {
    const m = new Map<string, ErrorInfo>();
    message.deletedUris.forEach((_, key) => {
      m.set(key, {
        code: ErrorCode.IS_OK,
        message: ""
      });
    });
    map.onException(header, { error: null, errors: m });
  }

  /**
   * Resolve a DataObject query corresponding to the correlationId.
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Energistics.Etp.v12.Protocol.Store.GetDataObjectResponse} message
   * @memberof StoreCustomer
   */
  private async onGetDataObjectsResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Store.GetDataObjectsResponse
  ) {
    return this.storeResolve.onResponse(header, message.dataObjects);
  }

  /**
   * Build a DataObject chunk by chunk and resolve the query corresponding to the correlationId.
   *
   * @private
   * @param header
   * @param message
   * @returns response message handler
   * @memberof StoreCustomer
   */

  private async onChunk(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Store.Chunk
  ) {
    return this.storeResolve.onChunk(header, message);
  }

  /**
   * Cancel the object request
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Energistics.Etp.v12.Protocol.Core.ProtocolExceptionTest} message
   * @returns nothing
   * @memberof StoreCustomer
   */
  private onDataObjectsError(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ) {
    if (this.successResolve.onException(header, message)) {
      return;
    }
    if (this.storeResolve.onException(header, message)) {
      return;
    }
  }
}
