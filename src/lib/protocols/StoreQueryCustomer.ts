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

import { ArrayResponseHandler } from "../common/ResponseHandlers";
import { BaseHandler } from "../common/BaseHandler";
import { ETPCore } from "../common/ETPCore";
import { Energistics } from "../common/Etp12";

const StoreQuery = Energistics.Etp.v12.Protocol.StoreQuery;
const Core = Energistics.Etp.v12.Protocol.Core;
const PROTOCOL = Energistics.Etp.v12.Datatypes.Protocol;

type DataObject = Energistics.Etp.v12.Datatypes.Object.DataObject;

/**
 * Implementation of client for StoreQuery protocol (Protocol 14).
 *
 * StoreQuery enables filtered retrieval of data objects by context and scope,
 * returning the full DataObject (including XML body). This is complementary to
 * DiscoveryQuery which returns only Resource metadata. In OSDU context, this
 * enables efficient bulk retrieval for search indexing and data synchronization.
 *
 * @export
 * @class StoreQueryCustomer
 * @extends {BaseHandler}
 */
export class StoreQueryCustomer extends BaseHandler {
  private readonly sessionManager: ETPCore;
  private readonly objectResults;

  constructor(sessionManager: ETPCore) {
    super(sessionManager);
    this.sessionManager = sessionManager;
    this._role = "customer";
    this._protocol = PROTOCOL.StoreQuery;
    this.objectResults = new ArrayResponseHandler<DataObject>(
      sessionManager.responseTimeoutPeriod
    );
  }

  public handleMessage(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody:
      | Energistics.Etp.v12.Protocol.StoreQuery.FindDataObjectsResponse
      | Energistics.Etp.v12.Protocol.StoreQuery.Chunk
      | Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): void {
    if (messageHeader.protocol === PROTOCOL.StoreQuery) {
      switch (messageHeader.messageType) {
        case StoreQuery.MsgFindDataObjectsResponse: {
          this.logTrace(
            `Received StoreQuery.FindDataObjectsResponse message for ${messageHeader.correlationId}.`
          );
          const body =
            messageBody as Energistics.Etp.v12.Protocol.StoreQuery.FindDataObjectsResponse;
          this.onFindDataObjectsResponse(messageHeader, body);
          break;
        }
        case StoreQuery.MsgChunk: {
          this.logTrace(
            `Received StoreQuery.Chunk message for ${messageHeader.correlationId}.`
          );
          // Chunk is used for large objects that exceed message size limits
          // The chunks are assembled by the response handler
          break;
        }
        case Core.MsgProtocolException: {
          this.logTrace(
            `Received StoreQuery.ProtocolException message for ${messageHeader.correlationId}.`
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
        `Unsupported protocol {${messageHeader.protocol}} in StoreQueryCustomer`
      );
    }
  }

  /**
   * Find data objects matching the given context and scope.
   * Returns full DataObject records including XML content.
   *
   * @param {Energistics.Etp.v12.Datatypes.Object.ContextInfo} context Search context
   * @param {Energistics.Etp.v12.Datatypes.Object.ContextScopeKind} scope Graph traversal scope
   * @param {(bigint | null)} [storeLastWriteFilter=null] Timestamp filter
   * @param {(Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind | null)} [activeStatusFilter=null] Active status filter
   * @param {string} [format="xml"] Return format (xml or json)
   * @returns {Promise<DataObject[]>} Matching data objects with content
   * @memberof StoreQueryCustomer
   */
  public async findDataObjects(
    context: Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    scope: Energistics.Etp.v12.Datatypes.Object.ContextScopeKind,
    storeLastWriteFilter: bigint | null = null,
    activeStatusFilter: Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind | null = null,
    format = "xml"
  ): Promise<DataObject[]> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.StoreQuery,
      StoreQuery.MsgFindDataObjects,
      BigInt(0)
    );
    const resourceContext = { ...context, uri: encodeURI(context.uri) };
    const findDataObjects: Energistics.Etp.v12.Protocol.StoreQuery.FindDataObjects =
      {
        activeStatusFilter,
        context: resourceContext,
        scope,
        storeLastWriteFilter,
        format
      };
    return this.objectResults.waitForRequest(
      this.sessionManager.send(header, findDataObjects)
    );
  }

  private onFindDataObjectsResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.StoreQuery.FindDataObjectsResponse
  ): void {
    const objects: DataObject[] = [];
    if (message.dataObjects) {
      for (const obj of message.dataObjects) {
        if (obj.resource) {
          obj.resource.uri = decodeURI(obj.resource.uri);
        }
        objects.push(obj);
      }
    }
    this.objectResults.onResponse(header, objects);
  }

  private onError(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): void {
    this.objectResults.onException(header, message);
  }
}
