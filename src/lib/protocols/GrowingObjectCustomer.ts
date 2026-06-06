// ============================================================================
// Copyright 2024-2026 Equinor ASA. All rights reserved.
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

import { ArrayResponseHandler, SingleResponseHandler } from "../common/ResponseHandlers";
import { BaseHandler } from "../common/BaseHandler";
import { ETPCore } from "../common/ETPCore";
import { Energistics, Integer64 } from "../common/Etp12";

const GrowingObject = Energistics.Etp.v12.Protocol.GrowingObject;
const Core = Energistics.Etp.v12.Protocol.Core;
const PROTOCOL = Energistics.Etp.v12.Datatypes.Protocol;

type ObjectPart = Energistics.Etp.v12.Datatypes.Object.ObjectPart;
type PartsMetadataInfo = Energistics.Etp.v12.Datatypes.Object.PartsMetadataInfo;

/**
 * Implementation of client for GrowingObject protocol (Protocol 6).
 *
 * GrowingObject manages objects that grow over time — primarily well logs and
 * mud logs in WITSML/EnergyML. Parts can be appended, retrieved by UID or
 * range, and change annotations tracked. This is critical for OSDU real-time
 * drilling data where logs grow as new measurements arrive.
 *
 * Key operations:
 * - GetParts / GetPartsByRange: Retrieve log data segments
 * - PutParts: Append new data to growing objects
 * - GetPartsMetadata: Metadata about available parts
 * - GetChangeAnnotations: Track what changed and when
 *
 * @export
 * @class GrowingObjectCustomer
 * @extends {BaseHandler}
 */
export class GrowingObjectCustomer extends BaseHandler {
  private readonly sessionManager: ETPCore;
  private readonly partsResults;
  private readonly metadataResults;
  private readonly deleteResults;
  private readonly putResults;
  private readonly headerResults;

  constructor(sessionManager: ETPCore) {
    super(sessionManager);
    this.sessionManager = sessionManager;
    this._role = "customer";
    this._protocol = PROTOCOL.GrowingObject;
    this.partsResults = new ArrayResponseHandler<ObjectPart>(
      sessionManager.responseTimeoutPeriod
    );
    this.metadataResults = new ArrayResponseHandler<PartsMetadataInfo>(
      sessionManager.responseTimeoutPeriod
    );
    this.deleteResults = new SingleResponseHandler(
      sessionManager.responseTimeoutPeriod
    );
    this.putResults = new SingleResponseHandler(
      sessionManager.responseTimeoutPeriod
    );
    this.headerResults = new SingleResponseHandler(
      sessionManager.responseTimeoutPeriod
    );
  }

  public handleMessage(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody: unknown
  ): void {
    if (messageHeader.protocol === PROTOCOL.GrowingObject) {
      switch (messageHeader.messageType) {
        case GrowingObject.MsgGetPartsResponse: {
          this.logTrace(
            `Received GrowingObject.GetPartsResponse for ${messageHeader.correlationId}.`
          );
          this.onGetPartsResponse(
            messageHeader,
            messageBody as Energistics.Etp.v12.Protocol.GrowingObject.GetPartsResponse
          );
          break;
        }
        case GrowingObject.MsgGetPartsByRangeResponse: {
          this.logTrace(
            `Received GrowingObject.GetPartsByRangeResponse for ${messageHeader.correlationId}.`
          );
          this.onGetPartsByRangeResponse(
            messageHeader,
            messageBody as Energistics.Etp.v12.Protocol.GrowingObject.GetPartsByRangeResponse
          );
          break;
        }
        case GrowingObject.MsgGetPartsMetadataResponse: {
          this.logTrace(
            `Received GrowingObject.GetPartsMetadataResponse for ${messageHeader.correlationId}.`
          );
          this.onGetPartsMetadataResponse(
            messageHeader,
            messageBody as Energistics.Etp.v12.Protocol.GrowingObject.GetPartsMetadataResponse
          );
          break;
        }
        case GrowingObject.MsgGetChangeAnnotationsResponse: {
          this.logTrace(
            `Received GrowingObject.GetChangeAnnotationsResponse for ${messageHeader.correlationId}.`
          );
          // Change annotations handled via metadata results
          break;
        }
        case GrowingObject.MsgDeletePartsResponse: {
          this.logTrace(
            `Received GrowingObject.DeletePartsResponse for ${messageHeader.correlationId}.`
          );
          this.deleteResults.onResponse(messageHeader, true);
          break;
        }
        case GrowingObject.MsgPutPartsResponse: {
          this.logTrace(
            `Received GrowingObject.PutPartsResponse for ${messageHeader.correlationId}.`
          );
          this.putResults.onResponse(messageHeader, true);
          break;
        }
        case GrowingObject.MsgGetGrowingDataObjectsHeaderResponse: {
          this.logTrace(
            `Received GrowingObject.GetGrowingDataObjectsHeaderResponse for ${messageHeader.correlationId}.`
          );
          this.headerResults.onResponse(messageHeader, messageBody);
          break;
        }
        case GrowingObject.MsgPutGrowingDataObjectsHeaderResponse: {
          this.logTrace(
            `Received GrowingObject.PutGrowingDataObjectsHeaderResponse for ${messageHeader.correlationId}.`
          );
          this.putResults.onResponse(messageHeader, true);
          break;
        }
        case Core.MsgProtocolException: {
          this.logTrace(
            `Received GrowingObject.ProtocolException for ${messageHeader.correlationId}.`
          );
          const errorMessage =
            messageBody as Energistics.Etp.v12.Protocol.Core.ProtocolException;
          this.onError(messageHeader, errorMessage);
          break;
        }
        default: {
          super.handleMessage(messageHeader, messageBody);
        }
      }
    } else {
      throw new Error(
        `Unsupported protocol {${messageHeader.protocol}} in GrowingObjectCustomer`
      );
    }
  }

  /**
   * Get parts (rows/segments) of a growing object by their UIDs.
   *
   * @param {string} uri URI of the growing object (e.g., a WellLog)
   * @param {Map<string, string>} uids Map of part UIDs to retrieve
   * @param {string} [format="xml"] Return format
   * @returns {Promise<ObjectPart[]>} Retrieved parts
   */
  public async getParts(
    uri: string,
    uids: Map<string, string>,
    format = "xml"
  ): Promise<ObjectPart[]> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.GrowingObject,
      GrowingObject.MsgGetParts,
      BigInt(0)
    );
    const getParts: Energistics.Etp.v12.Protocol.GrowingObject.GetParts = {
      uri: encodeURI(uri),
      uids,
      format
    };
    return this.partsResults.waitForRequest(
      this.sessionManager.send(header, getParts)
    );
  }

  /**
   * Get parts of a growing object within a specified index range.
   * Essential for retrieving well log data between specific depths or times.
   *
   * @param {string} uri URI of the growing object
   * @param {Energistics.Etp.v12.Datatypes.Object.IndexInterval} indexInterval Range specification (start/stop index)
   * @param {boolean} [includeOverlappingIntervals=false] Include parts that overlap the range boundary
   * @param {string} [format="xml"] Return format
   * @returns {Promise<ObjectPart[]>} Parts within the specified range
   */
  public async getPartsByRange(
    uri: string,
    indexInterval: Energistics.Etp.v12.Datatypes.Object.IndexInterval,
    includeOverlappingIntervals = false,
    format = "xml"
  ): Promise<ObjectPart[]> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.GrowingObject,
      GrowingObject.MsgGetPartsByRange,
      BigInt(0)
    );
    const getPartsByRange: Energistics.Etp.v12.Protocol.GrowingObject.GetPartsByRange =
      {
        uri: encodeURI(uri),
        indexInterval,
        includeOverlappingIntervals,
        format
      };
    return this.partsResults.waitForRequest(
      this.sessionManager.send(header, getPartsByRange)
    );
  }

  /**
   * Get metadata about parts in a growing object without retrieving the data.
   * Useful for determining available depth/time ranges before requesting data.
   *
   * @param {string} uri URI of the growing object
   * @returns {Promise<PartsMetadataInfo[]>} Metadata for each part
   */
  public async getPartsMetadata(uri: string): Promise<PartsMetadataInfo[]> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.GrowingObject,
      GrowingObject.MsgGetPartsMetadata,
      BigInt(0)
    );
    const uris = new Map<string, string>();
    uris.set("0", encodeURI(uri));
    const getPartsMetadata: Energistics.Etp.v12.Protocol.GrowingObject.GetPartsMetadata =
      {
        uris
      };
    return this.metadataResults.waitForRequest(
      this.sessionManager.send(header, getPartsMetadata)
    );
  }

  /**
   * Append new parts to a growing object (e.g., new log rows during drilling).
   *
   * @param {string} uri URI of the growing object
   * @param {Map<string, ObjectPart>} parts Parts to append, keyed by UID
   * @returns {Promise<boolean>} Success
   */
  public async putParts(
    uri: string,
    parts: Map<string, ObjectPart>
  ): Promise<boolean> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.GrowingObject,
      GrowingObject.MsgPutParts,
      BigInt(0)
    );
    const putParts: Energistics.Etp.v12.Protocol.GrowingObject.PutParts = {
      uri: encodeURI(uri),
      parts,
      format: "xml"
    };
    return this.putResults.waitForRequest(
      this.sessionManager.send(header, putParts)
    ) as Promise<boolean>;
  }

  /**
   * Delete specific parts from a growing object.
   *
   * @param {string} uri URI of the growing object
   * @param {Map<string, string>} uids UIDs of parts to delete
   * @returns {Promise<boolean>} Success
   */
  public async deleteParts(
    uri: string,
    uids: Map<string, string>
  ): Promise<boolean> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.GrowingObject,
      GrowingObject.MsgDeleteParts,
      BigInt(0)
    );
    const deleteParts: Energistics.Etp.v12.Protocol.GrowingObject.DeleteParts = {
      uri: encodeURI(uri),
      uids
    };
    return this.deleteResults.waitForRequest(
      this.sessionManager.send(header, deleteParts)
    ) as Promise<boolean>;
  }

  /**
   * Get the header (metadata) of growing data objects.
   *
   * @param {string} uri URI of the growing object
   * @returns {Promise<unknown>} Header data
   */
  public async getGrowingDataObjectsHeader(uri: string): Promise<unknown> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.GrowingObject,
      GrowingObject.MsgGetGrowingDataObjectsHeader,
      BigInt(0)
    );
    const uris = new Map<string, string>();
    uris.set("0", encodeURI(uri));
    const msg: Energistics.Etp.v12.Protocol.GrowingObject.GetGrowingDataObjectsHeader =
      {
        uris,
        format: "xml"
      };
    return this.headerResults.waitForRequest(
      this.sessionManager.send(header, msg)
    );
  }

  private onGetPartsResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.GrowingObject.GetPartsResponse
  ): void {
    const parts: ObjectPart[] = [];
    if (message.parts) {
      for (const [, part] of message.parts) {
        parts.push(part);
      }
    }
    this.partsResults.onResponse(header, parts);
  }

  private onGetPartsByRangeResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.GrowingObject.GetPartsByRangeResponse
  ): void {
    this.partsResults.onResponse(header, message.parts ?? []);
  }

  private onGetPartsMetadataResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.GrowingObject.GetPartsMetadataResponse
  ): void {
    const metadata: PartsMetadataInfo[] = [];
    if (message.metadata) {
      for (const [, info] of message.metadata) {
        metadata.push(info);
      }
    }
    this.metadataResults.onResponse(header, metadata);
  }

  private onError(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): void {
    if (this.partsResults.onException(header, message)) return;
    if (this.metadataResults.onException(header, message)) return;
    if (this.deleteResults.onError(header, message.error ?? null)) return;
    if (this.putResults.onError(header, message.error ?? null)) return;
    if (this.headerResults.onError(header, message.error ?? null)) return;
  }
}
