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
import { Energistics, Integer64 } from "../common/Etp12";

const DiscoveryQuery = Energistics.Etp.v12.Protocol.DiscoveryQuery;
const Core = Energistics.Etp.v12.Protocol.Core;
const PROTOCOL = Energistics.Etp.v12.Datatypes.Protocol;

type Resource = Energistics.Etp.v12.Datatypes.Object.Resource;

/**
 * Implementation of client for DiscoveryQuery protocol (Protocol 13).
 *
 * DiscoveryQuery provides URI-based resource discovery with filtering by
 * context, scope, last-write timestamp and active status. It is the query
 * counterpart to Discovery (Protocol 3) and is useful for OSDU search
 * integration where resources need to be enumerated across dataspaces.
 *
 * @export
 * @class DiscoveryQueryCustomer
 * @extends {BaseHandler}
 */
export class DiscoveryQueryCustomer extends BaseHandler {
  private readonly sessionManager: ETPCore;
  private readonly resourceResults;

  constructor(sessionManager: ETPCore) {
    super(sessionManager);
    this.sessionManager = sessionManager;
    this._role = "customer";
    this._protocol = PROTOCOL.DiscoveryQuery;
    this.resourceResults = new ArrayResponseHandler<Resource>(
      sessionManager.responseTimeoutPeriod
    );
  }

  public handleMessage(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody:
      | Energistics.Etp.v12.Protocol.DiscoveryQuery.FindResourcesResponse
      | Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): void {
    if (messageHeader.protocol === PROTOCOL.DiscoveryQuery) {
      switch (messageHeader.messageType) {
        case DiscoveryQuery.MsgFindResourcesResponse: {
          this.logTrace(
            `Received DiscoveryQuery.FindResourcesResponse message for ${messageHeader.correlationId}.`
          );
          const body =
            messageBody as Energistics.Etp.v12.Protocol.DiscoveryQuery.FindResourcesResponse;
          if (body) {
            body.resources = body.resources.map(r => {
              r.uri = decodeURI(r.uri);
              return r;
            });
          }
          this.onFindResourcesResponse(messageHeader, body);
          break;
        }
        case Core.MsgProtocolException: {
          this.logTrace(
            `Received DiscoveryQuery.ProtocolException message for ${messageHeader.correlationId}.`
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
        `Unsupported protocol {${messageHeader.protocol}} in DiscoveryQueryCustomer`
      );
    }
  }

  /**
   * Find resources matching the given context and scope filters.
   * This is the query-oriented counterpart to Discovery.GetResources,
   * designed for bulk enumeration and filtering scenarios.
   *
   * @param {Energistics.Etp.v12.Datatypes.Object.ContextInfo} context Search context (URI + depth + data object types)
   * @param {Energistics.Etp.v12.Datatypes.Object.ContextScopeKind} scope How to walk the resource graph
   * @param {(Integer64 | null)} [storeLastWriteFilter=null] Only return resources modified after this timestamp
   * @param {(Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind | null)} [activeStatusFilter=null] Filter by active/inactive status
   * @returns {Promise<Resource[]>} Matching resources
   * @memberof DiscoveryQueryCustomer
   */
  public async findResources(
    context: Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    scope: Energistics.Etp.v12.Datatypes.Object.ContextScopeKind,
    storeLastWriteFilter: Integer64 | null = null,
    activeStatusFilter: Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind | null = null
  ): Promise<Resource[]> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.DiscoveryQuery,
      DiscoveryQuery.MsgFindResources,
      BigInt(0)
    );
    const resourceContext = { ...context, uri: encodeURI(context.uri) };
    const findResources: Energistics.Etp.v12.Protocol.DiscoveryQuery.FindResources =
      {
        activeStatusFilter,
        context: resourceContext,
        scope,
        storeLastWriteFilter
      };
    return this.resourceResults.waitForRequest(
      this.sessionManager.send(header, findResources)
    );
  }

  private onFindResourcesResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.DiscoveryQuery.FindResourcesResponse
  ): void {
    this.resourceResults.onResponse(header, message.resources);
  }

  private onError(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): void {
    this.resourceResults.onException(header, message);
  }
}
