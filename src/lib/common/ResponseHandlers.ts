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

/* eslint-disable @typescript-eslint/ban-types */
import { BaseHandler } from "./BaseHandler";
import {
  ErrorCode,
  EtpError,
  Resource,
  errorFromProtocolException
} from "./EtpTypes";
import { Energistics, Integer64 } from "../common/Etp12";
import { EtpUri } from "./EtpUri";

/**
 * Equivalent to setTimeout that allows to modify remaining time
 * @example const timer = new Timer(()=>alert('foo'), 5000); // init timer with 5 seconds
 * timer.add(2000); // add 2 seconds
 *
 * @export
 * @class Timer
 */
export class Timer {
  public finished = false;
  private timer: NodeJS.Timeout | null = null;
  private callback: Function;
  private time: number;
  private start: number;

  /**
   *Creates an instance of Timer.
   * @param {Function} callback function to call when timer timeout
   * @param {number} time (ms)
   * @memberof Timer
   */
  constructor(callback: Function, time: number) {
    this.callback = callback;
    this.time = time;
    this.start = Date.now();
    this.setTimeout(callback, time);
  }

  /**
   * Reset time to given time from now
   *
   * @param {number} time (ms)
   * @memberof Timer
   */
  reset(time?: number): void {
    if (!time) {
      time = this.time;
    }
    this.setTimeout(this.callback, time);
  }

  /**
   * Cancel timer, function is not executed
   *
   * @param {boolean} [executeCallback=false] If true the call back wll be executed
   * @memberof Timer
   */
  cancel(executeCallback = false): void {
    if (!this.finished) {
      if (this.timer) {
        clearTimeout(this.timer);
      }
      this.finished = true;
      if (executeCallback) {
        this.callback();
      }
    }
  }

  /**
   * Add extra-time to the timer
   *
   * @param {number} time (ms)
   * @memberof Timer
   */
  add(time: number): void {
    if (!this.finished) {
      const diff = Date.now() - this.start;
      const newTime = this.time - diff + time;
      this.setTimeout(this.callback, newTime);
    }
  }

  /**
   * Whatever the time left in the timer, no time out will occur before the given time
   *
   * @param {number} time (ms)
   * @memberof Timer
   */
  noTimeoutBefore(time: number): void {
    if (!this.finished) {
      time = Math.max(this.time - (Date.now() - this.start), time);
      this.setTimeout(this.callback, time);
    }
  }

  /**
   * Time out will occur when time left expired or when the given time expire
   *
   * @param {number} time (ms)
   * @memberof Timer
   */
  alwaysTimeoutBefore(time: number): void {
    if (!this.finished) {
      // add time to time left
      time = Math.min(this.time - (Date.now() - this.start), time);
      this.setTimeout(this.callback, time);
    }
  }

  private setTimeout(callback: Function, time: number) {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.finished = false;
    this.callback = callback;
    this.time = time;
    this.timer = global.setTimeout(() => {
      this.finished = true;
      callback();
    }, time);
    this.start = Date.now();
  }
}

/**
 * Enhanced version of a map, that can use a timeout that could trigger the automatic
 * deletion of a key, and a reject callback
 *
 * @class ResponseHandler
 * @extends {Map<number, V>}
 * @template V
 */
class ResponseHandler<V> extends Map<Integer64, V> {
  private readonly firstMessageTimeout?: number;
  private readonly subsequentMessageTimeout?: number;
  private readonly timers: Map<Integer64, Timer> = new Map();
  constructor(firstMessageTimeout: number, subsequentMessageTimeout?: number) {
    super();
    this.firstMessageTimeout = firstMessageTimeout;
    this.subsequentMessageTimeout = subsequentMessageTimeout;
  }
  setRequest(requestId: Integer64, value: V, reject: (err: string) => void) {
    if (this.firstMessageTimeout) {
      this.timers.set(
        requestId,
        new Timer(() => {
          reject(
            `Request ${requestId} has timed out after ${this.firstMessageTimeout}ms`
          );
          super.delete(requestId);
          this.timers.delete(requestId);
        }, this.firstMessageTimeout)
      );
    }
    return super.set(requestId, value);
  }

  /**
   * Reset the message with subsequentMessageTimeout if specified
   *
   * @param {number} requestId
   * @memberof ResponseHandler
   */
  onIntermediateMessage(requestId: Integer64) {
    const timer = this.timers.get(requestId);
    if (timer && this.subsequentMessageTimeout) {
      timer.reset(this.subsequentMessageTimeout);
    }
  }

  /**
   * Remove current timer
   *
   * @param {number} requestId
   * @memberof ResponseHandler
   */
  onFinalMessage(requestId: Integer64) {
    this.delete(requestId);
    const t = this.timers.get(requestId);
    if (t) {
      t.cancel(false);
      this.timers.delete(requestId);
    }
  }
}

/**
 * Timeout-aware handler that wait for an answer returning a single item.
 * @example const handler = new SingleResponseHandler<boolean>(1000); //Create
 * handler.waitForRequest(0).then(value => {}); // wait
 * handler.onResponse(finalHeader, true); // provide a valid answer
 * handler.onError(finalHeader, null); // stop with an error
 *
 * @export
 * @class SingleResponseHandler
 * @extends {(ResponseHandler<{
 *   resolve: (value: T | PromiseLike<T>) => void;
 *   reject: (reason: EtpError | undefined) => void;
 * }>)}
 * @template T
 */
export class SingleResponseHandler<T> extends ResponseHandler<{
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason: EtpError | undefined) => void;
}> {
  waitForRequest(requestId: Integer64): Promise<T> {
    return new Promise<T>((resolve, reject) =>
      this.setRequest(requestId, { resolve, reject }, reject)
    );
  }

  onResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    value: T
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }
    if (BaseHandler.isFinalMessage(header)) {
      request.resolve(value);
      // Remove request information
      this.onFinalMessage(header.correlationId);
    } else {
      this.onIntermediateMessage(header.correlationId);
    }
    return true;
  }

  onError(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    error: Energistics.Etp.v12.Datatypes.ErrorInfo | null
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }
    error
      ? request.reject(new EtpError(`${error.message}`, error.code))
      : request.reject(new EtpError(`Server error`, ErrorCode.EINVALID_STATE));
    if (BaseHandler.isFinalMessage(header)) {
      this.onFinalMessage(header.correlationId);
    } else {
      this.onIntermediateMessage(header.correlationId);
    }
    return true;
  }
}

/**
 * Timeout-aware handler that wait for an answer returning an array.
 * @example const handler = new ArrayResponseHandler<boolean>(1000); //Create
 * handler.waitForRequest(0).then(value => {}); // wait
 * handler.onResponse(finalHeader, [true,false]); // provide a valid answer
 * handler.onException(finalHeader, message); // stop with an error
 *
 * @export
 * @class ArrayResponseHandler
 * @extends {(ResponseHandler<{
 *   resolve: (value: T[] | PromiseLike<T[]>) => void;
 *   reject: (reason: EtpError | undefined) => void;
 *   results: T[];
 * }>)}
 * @template T
 */
export class ArrayResponseHandler<T> extends ResponseHandler<{
  resolve: (value: T[] | PromiseLike<T[]>) => void;
  reject: (reason: EtpError | undefined) => void;
  results: T[];
}> {
  waitForRequest(requestId: Integer64): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) =>
      this.setRequest(requestId, { resolve, reject, results: [] }, reject)
    );
  }

  onResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    value: T[]
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }
    //Cannot use request.results.push(...value) with large arrays
    value.forEach(v => {
      request.results[request.results.length] = v;
    });
    if (BaseHandler.isFinalMessage(header)) {
      request.resolve(request.results);
      // Remove request information
      this.onFinalMessage(header.correlationId);
    } else {
      this.onIntermediateMessage(header.correlationId);
    }
    return true;
  }

  onException(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }

    if (BaseHandler.isFinalMessage(header)) {
      this.onFinalMessage(header.correlationId);
    } else {
      this.onIntermediateMessage(header.correlationId);
    }
    request.reject(errorFromProtocolException(message));
    return true;
  }
}

/**
 * Represents an edge connecting two resources in a graph.
 * @type Edge
 */
export type Edge = {
  targetUri: string;
  sourceUri: string;
  path?: string;
};

/**
 * Represents a graph of resources with edges connecting them.
 */
export class ResourceGraph extends Map<string, Resource> {
  edges: Edge[];
  dataObjectTypes: Set<string>;
  targetMap: Map<string, Array<string>> | undefined;
  sourceMap: Map<string, Array<string>> | undefined;

  /**
   * Creates an instance of ResourceGraph.
   * @param {Resource[]} nodes - The nodes of the graph.
   * @param {Edge[]} edges - The edges of the graph.
   */
  constructor(nodes: Resource[], edges: Edge[]) {
    super(nodes.map(n => [n.uri, n]));
    this.edges = edges;
    this.dataObjectTypes = new Set<string>();
    this.targetMap = undefined;
    this.sourceMap = undefined;
  }

  /**
   * Returns a rebuilt target map from the graph edges.
   * Allows on demand optimization for targets discovery.
   *
   * @readonly
   * @returns {Map<string, Array<string>>}
   */
  getTargetMap(): Map<string, Array<string>> {
    if (this.targetMap === undefined) {
      this.targetMap = new Map<string, Array<string>>();
      this.edges.forEach(e => {
        this.targetMap?.has(e.sourceUri)
          ? this.targetMap.get(e.sourceUri)?.push(e.targetUri)
          : this.targetMap?.set(e.sourceUri, [e.targetUri]);
      });
    }
    return this.targetMap;
  }

  /**
   * Returns a rebuilt source map from the graph edges.
   * Allows on demand optimization for sources discovery.
   *
   * @readonly
   * @returns {Map<string, Array<string>>}
   */
  getSourceMap(): Map<string, Array<string>> {
    if (this.sourceMap === undefined) {
      this.sourceMap = new Map<string, Array<string>>();
      this.edges.forEach(e => {
        this.sourceMap?.has(e.targetUri)
          ? this.sourceMap.get(e.targetUri)?.push(e.sourceUri)
          : this.sourceMap?.set(e.targetUri, [e.sourceUri]);
      });
    }
    return this.sourceMap;
  }

  /**
   * Returns true if the specified types are supported by the graph
   *
   * @param {string[]} dataObjectTypes - The specified type filter
   * @returns true if specified types are supported by the graph
   */
  supportTypes(dataObjectTypes: string[]): boolean {
    for (const d of dataObjectTypes) {
      if (!this.dataObjectTypes.has(d)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get the EtpUri class corresponding to this node
   * @param {string} uri
   * @returns {EtpUri}
   */
  public static etpUri(uri: string): EtpUri {
    return new EtpUri(uri);
  }

  /**
   * Return the values as an Array of resource
   *
   * @readonly
   * @type {Resource[]}
   */
  get resources(): Resource[] {
    return Array.from(this.values());
  }

  /**
   * Returns the resource with the specified URI.
   *
   * @param {string} uri - The URI of the resource to retrieve.
   * @returns {(Resource | undefined)} - The resource with the specified URI, or undefined if it does not exist.
   */
  resource(uri: string): Resource | undefined {
    return this.get(uri);
  }

  findResource = this.resource;

  /**
   * Returns an array of targets URIs whose sources are in specified URI list.
   *
   * @param {string[]} uris - The list of URI of the source resource.
   * @param {string[]} [dataObjectTypes=[]] - An array of data object types to filter the target URIs.
   * @param {number} [depth=1] - The depth of the search.
   * @returns {string[]} - An array of target URIs whose source is the specified URI.
   */
  targetsForList(
    uris: string[],
    dataObjectTypes: string[] = [],
    depth = 1
  ): string[] {
    const targetMap = this.getTargetMap();
    let targets: Array<string> = [];
    if (depth === 1 && uris.length == 1) {
      targets = targetMap.get(uris[0]) ?? [];
    } else {
      let previousTargets = new Set<string>();
      uris.forEach(u => previousTargets.add(u));

      const targetSet = new Set<string>();
      if (depth === 1) {
        previousTargets.forEach(p => {
          const targets = targetMap.get(p);
          if (targets !== undefined) {
            targets.forEach(t => targetSet.add(t));
          }
        });
      } else {
        while (depth-- > 0 && previousTargets.size > 0) {
          const currentTargets = new Set<string>();

          previousTargets.forEach(p => {
            const targets = targetMap.get(p);
            if (targets !== undefined) {
              targets.forEach(t => currentTargets.add(t));
            }
          });
          // Add current targets to the set
          currentTargets.forEach(t => targetSet.add(t));
          previousTargets = currentTargets;
        }
      }
      targets = Array.from(targetSet);
    }
    return dataObjectTypes.length === 0
      ? targets
      : targets.filter(t =>
        dataObjectTypes.includes(new EtpUri(t).dataObjectType)
      );
  }

  /**
   * Returns an array of target URIs whose source is the specified URI.
   *
   * @param {string} uri - The URI of the source resource.
   * @param {string[]} [dataObjectTypes=[]] - An array of data object types to filter the target URIs.
   * @param {number} [depth=1] - The depth of the search.
   * @returns {string[]} - An array of target URIs whose source is the specified URI.
   */
  targets(uri: string, dataObjectTypes: string[] = [], depth = 1): string[] {
    return this.targetsForList([uri], dataObjectTypes, depth);
  }

  /**
   * Return the list of targets as array of Resource
   *
   * @param {(string | Resource)} resource where requested resources are pointing to
   * @param {string[]} [dataObjectTypes=[]] filter on data object types
   * @param {number} [depth=1] depth of the search
   * @returns {Resource[]}
   */
  findTargets(
    resource: string | Resource,
    dataObjectTypes: string[] = [],
    depth = 1
  ): Resource[] {
    const uri: string = typeof resource === "string" ? resource : resource.uri;
    return this.targets(uri, dataObjectTypes, depth)
      .map(s => this.get(s))
      .filter(r => r !== undefined) as Resource[];
  }

  /**
   * Returns an array of sources URIs whose targets are in specified URI list.
   *
   * @param {string[]} uris - The list of URI of the target resource.
   * @param {string[]} [dataObjectTypes=[]] - An array of data object types to filter the target URIs.
   * @param {number} [depth=1] - The depth of the search.
   * @returns {string[]} - An array of target URIs whose source is the specified URI.
   */
  sourcesForList(
    uris: string[],
    dataObjectTypes: string[] = [],
    depth = 1
  ): string[] {
    const sourceMap = this.getSourceMap();
    let sources: Array<string> = [];
    if (depth === 1 && uris.length == 1) {
      sources = sourceMap.get(uris[0]) ?? [];
    } else {
      let previousSources = new Set<string>();
      uris.forEach(u => previousSources.add(u));

      const sourceSet = new Set<string>();
      if (depth === 1) {
        previousSources.forEach(p => {
          const sources = sourceMap.get(p);
          if (sources !== undefined) {
            sources.forEach(t => sourceSet.add(t));
          }
        });
      } else {
        while (depth-- > 0 && previousSources.size > 0) {
          const currentSources = new Set<string>();
          previousSources.forEach(p => {
            const sources = sourceMap.get(p);
            if (sources !== undefined) {
              sources.forEach(t => currentSources.add(t));
            }
          });
          // Add current sources to the set
          currentSources.forEach(t => sourceSet.add(t));
          previousSources = currentSources;
        }
      }
      sources = Array.from(sourceSet);
    }
    return dataObjectTypes.length === 0
      ? sources
      : sources.filter(t =>
        dataObjectTypes.includes(new EtpUri(t).dataObjectType)
      );
  }

  /**
   * Returns an array of source URIs whose target is the specified URI.
   * @param {string} uri - The URI of the target resource.
   * @param {string[]} [dataObjectTypes=[]] - An array of data object types to filter the source URIs.
   * @param {number} [depth=1] - The depth of the search.
   * @returns {string[]} - An array of source URIs whose target is the specified URI.
   * @example const graph = new ResourceGraph(...);
   * const sources = graph.sources(uri);
   */
  sources(uri: string, dataObjectTypes: string[] = [], depth = 1): string[] {
    return this.sourcesForList([uri], dataObjectTypes, depth);
  }

  /**
   * Return the list of sources as array of Resource
   *
   * @param {(string | Resource)} resource where requested resources are pointing to
   * @param {string[]} [dataObjectTypes=[]] filter on data object types
   * @param {number} [depth=1] depth of the search
   * @returns {Resource[]}
   */
  findSources(
    resource: string | Resource,
    dataObjectTypes: string[] = [],
    depth = 1
  ): Resource[] {
    const uri: string = typeof resource === "string" ? resource : resource.uri;
    return this.sources(uri, dataObjectTypes, depth)
      .map(s => this.get(s))
      .filter(r => r !== undefined) as Resource[];
  }

  /**
   * Creates a new graph by filtering the current graph.
   * Only the resources matching the filter are kept,
   * and the edges that connect them.
   * @param {(resource: Resource) => boolean} filter - The filter function.
   * @returns {ResourceGraph} - The new graph.
   * @example const graph = new ResourceGraph(...);
   * const newGraph = graph.filter(r => typeArray.includes(r.type));
   */
  filter(filter: (resource: Resource) => boolean): ResourceGraph {
    const nodes = Array.from(this.values()).filter(filter);
    const graph = new ResourceGraph(nodes, []);
    graph.edges = this.edges.filter(
      e => graph.has(e.sourceUri) && graph.has(e.targetUri)
    );
    return graph;
  }
}

/**
 * Timeout-aware handler that wait for an answer returning a graph.
 * @example const handler = new GraphResponseHandler(1000); //Create
 * handler.waitForRequest(0).then(value => {}); // wait
 * handler.onResponse(finalHeader, [true,false]); // provide a valid answer
 * handler.onException(finalHeader, message); // stop with an error
 *
 * @export
 * @class GraphResponseHandler
 * @extends {ResponseHandler<{
 *   resolve: (value: Resource[] | PromiseLike<Resource[]>) => void;
 *   reject: (reason: EtpError | undefined) => void;
 *   graph: ResourceGraph;
 * }>}
 * @template T
 */
export class GraphResponseHandler extends ResponseHandler<{
  resolve: (value: ResourceGraph | PromiseLike<ResourceGraph>) => void;
  reject: (reason: EtpError | undefined) => void;
  graph: ResourceGraph;
}> {
  /**
   * Send a request for a graph of discovery to the server and wait for the responses.
   * When successful, the answer messages must be either GetResourcesResponse or GetResourceEdgesResponse.
   * @param {Integer64} requestId Id of the request
   * @returns Promise of the graph
   * @memberof GraphResponseHandler
   */
  waitForRequest(requestId: Integer64): Promise<ResourceGraph> {
    return new Promise<ResourceGraph>((resolve, reject) =>
      this.setRequest(
        requestId,
        { resolve, reject, graph: new ResourceGraph([], []) },
        reject
      )
    );
  }

  /**
   * Handle a successful GetResourcesResponse message
   * @param header Message header
   * @param value Graph of discovery
   * @returns true if the message is handled
   * @memberof GraphResponseHandler
   */
  onResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    value: Resource[]
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }
    value.forEach(v => {
      request.graph.set(v.uri, v);
    });
    if (BaseHandler.isFinalMessage(header)) {
      request.resolve(request.graph);
      // Remove request information
      this.onFinalMessage(header.correlationId);
    } else {
      this.onIntermediateMessage(header.correlationId);
    }
    return true;
  }

  /**
   * Handle a successful GetResourceEdgesResponse message
   * @param header Message header
   * @param value Graph edges
   * @returns true if the message is handled
   * @memberof GraphResponseHandler
   */
  onEdgesResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    value: Energistics.Etp.v12.Datatypes.Object.Edge[]
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }
    if (request.graph.edges !== undefined) {
      //Cannot use request.results.push(...value) with large arrays
      value.forEach(v => {
        request.graph.edges[request.graph.edges.length] = {
          targetUri: v.targetUri,
          sourceUri: v.sourceUri,
          path: v.customData?.get("path")?.item?._string
        };
      });
    }
    if (BaseHandler.isFinalMessage(header)) {
      request.resolve(request.graph);
      // Remove request information
      this.onFinalMessage(header.correlationId);
    } else {
      this.onIntermediateMessage(header.correlationId);
    }
    return true;
  }

  /**
   * Handle an error response message
   * @param header Message header
   * @param message Error message
   * @returns true if the message is handled
   * @memberof GraphResponseHandler
   */
  onException(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }
    request.reject(errorFromProtocolException(message));
    if (BaseHandler.isFinalMessage(header)) {
      this.onFinalMessage(header.correlationId);
    } else {
      this.onIntermediateMessage(header.correlationId);
    }
    return true;
  }
}

/**
 * Timeout-aware handler that wait for an answer returning the values of a Map.
 * @example const handler = new MapResponseHandler<boolean>(1000); //Create
 * const keys = ["key1", "key2"];
 * handler.waitForRequest(0,keys).then(value => {}); // wait
 * const map = new Map<string, boolean>();
 * map.set("key1", true);
 * map.set("key2", false);
 * handler.onResponse(finalHeader, map); // provide a valid answer
 * handler.onException(finalHeader, message); // stop with an error
 *
 * @export
 * @class MapResponseHandler
 * @extends {(ResponseHandler<{
 *   resolve: (value: Array<T | null> | PromiseLike<Array<T | null>>) => void;
 *   reject: (reason: EtpError | undefined) => void;
 *   results: Map<string, T>;
 *   errors: Map<string, Energistics.Etp.v12.Datatypes.ErrorInfo>;
 *   keys: string[];
 * }>)}
 * @template T
 */
export class MapResponseHandler<T> extends ResponseHandler<{
  resolve: (value: Array<T | null> | PromiseLike<Array<T | null>>) => void;
  reject: (reason: EtpError | undefined) => void;
  results: Map<string, T>;
  errors: Map<string, Energistics.Etp.v12.Datatypes.ErrorInfo>;
  keys: string[];
}> {
  waitForRequest(
    requestId: Integer64,
    keys: string[]
  ): Promise<Array<T | null>> {
    return new Promise<Array<T | null>>((resolve, reject) =>
      this.setRequest(
        requestId,
        { keys, resolve, reject, results: new Map(), errors: new Map() },
        reject
      )
    );
  }

  /**
   * Handle a successful response message
   *
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Map<string, T>} items
   * @returns {boolean}
   * @memberof ItemMapResponseHandler
   */
  public onResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    items: Map<string, T>
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }

    items.forEach((v, k) => request.results.set(k, v));
    return this.processLastMapItem(
      header.correlationId,
      BaseHandler.isFinalMessage(header)
    );
  }

  /**
   * Handle an error response message
   *
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Map<string, Energistics.Etp.v12.Datatypes.ErrorInfo>} errors
   * @returns {boolean}
   * @memberof ItemMapResponseHandler
   */
  public onException(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }

    if (message.errors.size > 0) {
      message.errors.forEach((v, k) => request.errors.set(k, v));
    } else if (message.error) {
      const str = message.error;
      request.keys.forEach(v => request.errors.set(v, str));
    }
    return this.processLastMapItem(
      header.correlationId,
      BaseHandler.isFinalMessage(header)
    );
  }

  /**
   * Process last message, if some part of the request is successful, resolve the promise, else reject
   *
   * @private
   * @param {bigint} requestId  Id of the request to correlate with the response
   * @returns {boolean} finalMessage true if this is the last message
   * @memberof ItemMapResponseHandler
   */
  private processLastMapItem(
    requestId: bigint,
    finalMessage: boolean
  ): boolean {
    const request = this.get(requestId);
    if (!request) {
      return false;
    }

    if (!finalMessage) {
      this.onIntermediateMessage(requestId);
      return true;
    }

    if (request.errors.size === request.keys.length) {
      const errorMessages: string[] = [];
      request.errors.forEach(v => errorMessages.push(v.message));
      const code =
        request.errors.size > 0
          ? Array.from(request.errors.values())[0].code
          : ErrorCode.EINVALID_STATE;
      request.reject(new EtpError(errorMessages.join(","), code));
    } else {
      const values: Array<T | null> = request.keys.map(key => {
        const item: T | undefined = request.results.get(key);
        return item === undefined ? null : item;
      });
      request.resolve(values);
    }

    this.onFinalMessage(requestId);
    return true;
  }
}

/**
 * Timeout-aware handler that wait for an answer returning the values of a Success Map.
 * @example const handler = new SuccessMapResponseHandler(1000); //Create
 * const keys = ["key1", "key2"];
 * handler.waitForRequest(0,keys).then(value => {}); // wait
 * const map = new Map<string, string>();
 * map.set("key1", "");
 * map.set("key2", "");
 * handler.onResponse(finalHeader, map); // provide a valid answer
 * handler.onException(finalHeader, message); // stop with an error
 *
 * @export
 * @class SuccessMapResponseHandler
 * @extends {(ResponseHandler<{
 *   resolve: (
 *     value:
 *       | Energistics.Etp.v12.Datatypes.ErrorInfo[]
 *       | PromiseLike<Energistics.Etp.v12.Datatypes.ErrorInfo[]>
 *   ) => void;
 *   reject: (reason: EtpError | undefined) => void;
 *   results: Map<string, Energistics.Etp.v12.Datatypes.ErrorInfo>;
 *   keys: string[];
 * }>)}
 */
export class SuccessMapResponseHandler extends ResponseHandler<{
  resolve: (
    value:
      | Energistics.Etp.v12.Datatypes.ErrorInfo[]
      | PromiseLike<Energistics.Etp.v12.Datatypes.ErrorInfo[]>
  ) => void;
  reject: (reason: EtpError | undefined) => void;
  results: Map<string, Energistics.Etp.v12.Datatypes.ErrorInfo>;
  keys: string[];
}> {
  waitForRequest(
    requestId: Integer64,
    keys: string[]
  ): Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]> {
    return new Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]>(
      (resolve, reject) =>
        this.setRequest(
          requestId,
          { keys, resolve, reject, results: new Map() },
          reject
        )
    );
  }

  onException(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }
    message.errors.forEach((value, key) => {
      request.results.set(key, value);
    });
    if (BaseHandler.isFinalMessage(header)) {
      if (message.error) {
        request.reject(errorFromProtocolException(message));
        return true;
      }
      const results: Energistics.Etp.v12.Datatypes.ErrorInfo[] =
        request.keys.map(k => {
          const e = request.results.get(k);
          return e ?? new Energistics.Etp.v12.Datatypes.ErrorInfo();
        });
      request.resolve(results);
      // Remove request information
      this.onFinalMessage(header.correlationId);
    } else {
      this.onIntermediateMessage(header.correlationId);
    }
    return true;
  }

  /**
   * Resolve a string based response message query
   *
   * @protected
   * @param {Energistics.Etp.v12.Datatypes.MessageHeader} header
   * @param {Map<string, string>} messages
   * @returns {boolean}
   * @memberof SuccessResponseHandler
   */
  public onResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    messages: Map<string, string>
  ): boolean {
    const request = this.get(header.correlationId);
    if (!request) {
      return false;
    }

    messages.forEach((value, key) => {
      request.results.set(key, {
        code: ErrorCode.IS_OK,
        message: value
      });
    });

    if (BaseHandler.isFinalMessage(header)) {
      const errors: Energistics.Etp.v12.Datatypes.ErrorInfo[] =
        request.keys.map(k => {
          const e = request.results.get(k);
          return e ?? new Energistics.Etp.v12.Datatypes.ErrorInfo();
        });
      request.resolve(errors);
      // Remove request information
      this.onFinalMessage(header.correlationId);
    } else {
      this.onIntermediateMessage(header.correlationId);
    }
    return true;
  }
}
