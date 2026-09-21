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
  ArrayResponseHandler,
  GraphResponseHandler,
  ResourceGraph
} from "../common/ResponseHandlers";
import { BaseHandler } from "../common/BaseHandler";
import { ETPCore } from "../common/ETPCore";
import { Energistics, Integer64 } from "../common/Etp12";

const Discovery = Energistics.Etp.v12.Protocol.Discovery;
const Core = Energistics.Etp.v12.Protocol.Core;
const PROTOCOL = Energistics.Etp.v12.Datatypes.Protocol;

type DeletedResource = Energistics.Etp.v12.Datatypes.Object.DeletedResource;
type Resource = Energistics.Etp.v12.Datatypes.Object.Resource;

/**
 * Implementation of client for Discovery protocol
 *
 * @export
 * @class DiscoveryCustomer
 * @extends {BaseHandler}
 */
export class DiscoveryCustomer extends BaseHandler {
  private readonly sessionManager: ETPCore;
  private readonly resourceResults;
  private readonly deletedResourceResults;

  constructor(sessionManager: ETPCore) {
    super(sessionManager);
    this.sessionManager = sessionManager;
    this._role = "customer";
    this._protocol = PROTOCOL.Discovery;
    this.resourceResults = new GraphResponseHandler(
      sessionManager.responseTimeoutPeriod
    );
    this.deletedResourceResults = new ArrayResponseHandler<DeletedResource>(
      sessionManager.responseTimeoutPeriod
    );
  }

  public handleMessage(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody:
      | Energistics.Etp.v12.Protocol.Discovery.GetDeletedResourcesResponse
      | Energistics.Etp.v12.Protocol.Discovery.GetResourcesEdgesResponse
      | Energistics.Etp.v12.Protocol.Discovery.GetResourcesResponse
      | Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): void {
    if (messageHeader.protocol === PROTOCOL.Discovery) {
      switch (messageHeader.messageType) {
        case Discovery.MsgGetResourcesResponse: {
          this.logTrace(
            `Received Discovery.GetResourcesResponse message for ${messageHeader.correlationId}.`
          );
          const body =
            messageBody as Energistics.Etp.v12.Protocol.Discovery.GetResourcesResponse;
          if (body) {
            body.resources = body.resources.map(r => {
              r.uri = decodeURI(r.uri);
              return r;
            });
          }
          this.onGetResourcesResponse(messageHeader, body);
          break;
        }
        case Discovery.MsgGetResourcesEdgesResponse: {
          this.logTrace(
            `Received Discovery.GetResourcesEdgesResponse message for ${messageHeader.correlationId}.`
          );
          const body =
            messageBody as Energistics.Etp.v12.Protocol.Discovery.GetResourcesEdgesResponse;
          if (body) {
            body.edges = body.edges.map(r => {
              r.sourceUri = decodeURI(r.sourceUri);
              r.targetUri = decodeURI(r.targetUri);
              return r;
            });
          }
          this.onGetResourcesEdgesResponse(messageHeader, body);
          break;
        }
        case Discovery.MsgGetDeletedResourcesResponse: {
          this.logTrace(
            `Received Discovery.GetDeletedResourcesResponse message for ${messageHeader.correlationId}.`
          );
          const body =
            messageBody as Energistics.Etp.v12.Protocol.Discovery.GetDeletedResourcesResponse;
          if (body) {
            body.deletedResources = body.deletedResources.map(r => {
              r.uri = decodeURI(r.uri);
              return r;
            });
          }
          this.onGetDeletedResourcesResponse(messageHeader, body);
          break;
        }
        case Core.MsgProtocolException: {
          this.logTrace(
            `Received Discovery.ProtocolException message for ${messageHeader.correlationId}.`
          );
          const errorMessage =
            messageBody as Energistics.Etp.v12.Protocol.Core.ProtocolException;
          this.onDiscoveryError(messageHeader, errorMessage);
          break;
        }
        default: {
          super.handleMessage(messageHeader, messageBody);
        }
      }
    } else {
      throw new Error(
        `Unsupported protocol {${messageHeader.protocol}} in DiscoveryCustomer`
      );
    }
  }

  /**
   * Implement the search of associated resource.
   * The search is based on a context and a scope.
   * The context can be a URI or a complex search structure.
   * The scope can be a single level or a full graph walk.
   * The result is a list of resources.
   * The result can be filtered by last write date and active status.
   *
   * @param {Energistics.Etp.v12.Datatypes.Object.ContextInfo} context Context of the search, can be a URI or mon complex search structure
   * @param {Energistics.Etp.v12.Datatypes.Object.ContextScopeKind} scope Indicate how to walk the graph
   * @param {boolean} [countObjects=false] Indicates that the server is requested to provide the source and target count
   * @param {(Integer64 | null)} [storeLastWriteFilter=null] Filter on the last write date of the resource
   * @param {(Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind | null)} [activeStatusFilter=null] Filter on the active status of the resource
   * @returns {Promise<Resource[]>}
   * @memberof DiscoveryCustomer
   */
  public async getResources(
    context: Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    scope: Energistics.Etp.v12.Datatypes.Object.ContextScopeKind,
    countObjects = false,
    storeLastWriteFilter: Integer64 | null = null,
    activeStatusFilter: Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind | null = null
  ): Promise<Resource[]> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.Discovery,
      Discovery.MsgGetResources,
      BigInt(0)
    );
    const resourceContext = { ...context, uri: encodeURI(context.uri) };
    const getResources: Energistics.Etp.v12.Protocol.Discovery.GetResources = {
      activeStatusFilter,
      context: resourceContext,
      countObjects,
      includeEdges: false,
      scope,
      storeLastWriteFilter
    };
    return this.resourceResults
      .waitForRequest(this.sessionManager.send(header, getResources))
      .then(graph => [...graph.values()]);
  }

  /**
   * Retrieves a list of deleted resources based on the provided filters.
   *
   * @param {string} dataspaceUri The URI of the dataspace to search in.
   * @param {string[]} dataObjectTypes An array of data object types to filter the search by.
   * @param {(Integer64 | null)} [deleteTimeFilter=null] Indicates that only resources deleted after the given time should be provided.
   * @returns {Promise<DeletedResource[]>} A promise that resolves to an array of deleted resources.
   * @memberof DiscoveryCustomer
   */
  public async getDeletedResources(
    dataspaceUri: string,
    dataObjectTypes: string[],
    deleteTimeFilter: Integer64 | null = null
  ): Promise<DeletedResource[]> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.Discovery,
      Discovery.MsgGetDeletedResources,
      BigInt(0)
    );
    const getDeletedResources: Energistics.Etp.v12.Protocol.Discovery.GetDeletedResources =
      {
        dataspaceUri: encodeURI(dataspaceUri),
        dataObjectTypes,
        deleteTimeFilter
      };
    return this.deletedResourceResults.waitForRequest(
      this.sessionManager.send(header, getDeletedResources)
    );
  }

  /**
   * Implement the search of associated resources, and return their graph.
   * The search is based on a context and a scope.
   * The context can be a URI or a complex search structure.
   * The scope can be a single level or a full graph walk.
   * The result is a graph of resources.
   * The result can be filtered by last write date and active status.
   * The graph is a list of resources and a list of edges.
   * The edges are the links between the resources.
   *
   * @param {Energistics.Etp.v12.Datatypes.Object.ContextInfo} context Context of the search, can be a URI or mon complex search structure
   * @param {Energistics.Etp.v12.Datatypes.Object.ContextScopeKind} scope Indicate how to walk the graph
   * @param {boolean} [countObjects=false] Indicates that the server is requested to provide the source and target count
   * @param {(Integer64 | null)} [storeLastWriteFilter=null] Indicates that the only the resources created after the given time is provided
   * @param {(Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind | null)} [activeStatusFilter=null] Indicates that the only the resources with the given active status is provided
   * @returns {Promise<ResourceGraph>}
   * @memberof DiscoveryCustomer
   */
  public async getGraph(
    context: Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    scope: Energistics.Etp.v12.Datatypes.Object.ContextScopeKind,
    countObjects = false,
    storeLastWriteFilter: Integer64 | null = null,
    activeStatusFilter: Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind | null = null
  ): Promise<ResourceGraph> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.Discovery,
      Discovery.MsgGetResources,
      BigInt(0)
    );
    const resourceContext = { ...context, uri: encodeURI(context.uri) };
    const getResources: Energistics.Etp.v12.Protocol.Discovery.GetResources = {
      activeStatusFilter,
      context: resourceContext,
      countObjects,
      includeEdges: true,
      scope,
      storeLastWriteFilter
    };
    return this.resourceResults.waitForRequest(
      this.sessionManager.send(header, getResources)
    );
  }

  /**
   * Resolve a Resource query corresponding to the correlationId.
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Energistics.Etp.v12.Protocol.Discovery.GetResourcesResponse} message
   * @returns {void}
   * @memberof DiscoveryCustomer
   */
  private onGetResourcesResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Discovery.GetResourcesResponse
  ): void {
    this.resourceResults.onResponse(header, message.resources);
  }

  /**
   * Handle the response of a GetResourcesEdges request
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header The message header
   * @param {Energistics.Etp.v12.Protocol.Discovery.GetResourcesEdgesResponse} message The message body
   * @memberof DiscoveryCustomer
   */
  private onGetResourcesEdgesResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Discovery.GetResourcesEdgesResponse
  ): void {
    // Pass the received edges to the resourceResults object
    this.resourceResults.onEdgesResponse(header, message.edges);
  }

  /**
   * Handle the response of a GetDeletedResources request
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header The message header
   * @param {Energistics.Etp.v12.Protocol.Discovery.GetDeletedResourcesResponse} message The message body
   * @memberof DiscoveryCustomer
   */
  private onGetDeletedResourcesResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Discovery.GetDeletedResourcesResponse
  ): void {
    this.deletedResourceResults.onResponse(header, message.deletedResources);
  }

  /**
   * Cancel the discovery request and throw an error with the server message
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Energistics.Etp.v12.Protocol.Core.ProtocolExceptionTest} message
   * @returns nothing
   * @memberof DiscoveryCustomer
   */
  private onDiscoveryError(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ) {
    // A ProtocolException may correlate to an in-flight GetResources/-Edges
    // request or a GetDeletedResources request. Offer it to both handlers so
    // the matching pending request is rejected. Previously only resourceResults
    // was notified, so an error reply to GetDeletedResources (e.g. ENOT_FOUND
    // for a missing dataspace) was dropped and waitForRequest hung forever.
    if (this.resourceResults.onException(header, message)) {
      return;
    }
    if (this.deletedResourceResults.onException(header, message)) {
      return;
    }
    this.logTrace(
      `Discovery.ProtocolException not claimed by any handler for ${header.correlationId}.`
    );
  }
}
