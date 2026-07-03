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

import { v5 as uuidNameSpace, v4 as uuidRandom } from "uuid";

import * as websocket from "websocket";
import {
  ErrorCode,
  EtpDataValue,
  EtpError,
  errorFromProtocolException
} from "../common/EtpTypes";

import type {
  DataObject,
  DataValue,
  Dataspace,
  DeletedResource,
  IArrayId,
  IDataArray,
  IDataArrayMetadata,
  IDataSubarray,
  IOptions,
  Resource,
  SupportedType,
  allMessageBodyType
} from "../common/EtpTypes";

import logging from "../common/Logging";

import * as ETPClient from "./ETPClient";

import * as EtpContentType from "../common/EtpContentType";
import { EtpQualifiedType } from "../common/EtpQualifiedType";
import { ArrayByteUuid, EtpUri } from "../common/EtpUri";

import { AvroString, Energistics, Integer64 } from "../common/Etp12";

import ArrayCustomer from "../protocols/ArrayCustomer";
import type {
  AnyTypedArray,
  IHDF5ArrayInput
} from "../protocols/ArrayCustomer";

import { DataspaceCustomer } from "../protocols/DataspaceCustomer";
import { DiscoveryCustomer } from "../protocols/DiscoveryCustomer";
import { StoreCustomer } from "../protocols/StoreCustomer";
import { StoreNotificationCustomer } from "../protocols/StoreNotificationCustomer";
import { SupportedTypesCustomer } from "../protocols/SupportedTypesCustomer";
import { TransactionCustomer } from "../protocols/TransactionCustomer";
import { DiscoveryQueryCustomer } from "../protocols/DiscoveryQueryCustomer";
import { StoreQueryCustomer } from "../protocols/StoreQueryCustomer";
import { GrowingObjectCustomer } from "../protocols/GrowingObjectCustomer";
import { GrowingObjectNotificationCustomer } from "../protocols/GrowingObjectNotificationCustomer";
import { ChannelSubscribeCustomer } from "../protocols/ChannelSubscribeCustomer";

import { ResourceGraph, Timer } from "../common/ResponseHandlers";
import { SimpleJson, simpleJson, xml2typescript } from "../mlTypes/XmlJsonUtil";
import { createODataQueries, queryFilter } from "../oDataParser/oDataUtils";
import { retry, retryOnEtpErrors } from "../common/Util";
import { DataspaceOSDUCustomer } from "../protocols/DataspaceOSDUCustomer";
import * as Eml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/commonv2";
import * as Eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/commonv2";
import * as Resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";

const socket = websocket.w3cwebsocket;

export { EtpDataValue } from "../common/EtpTypes";
export type {
  DataArray,
  DataObject,
  DataQueryOperator,
  DataQueryValue,
  Dataspace,
  DataValue,
  ErrorInfo,
  IArrayId,
  IDataArray,
  IDataArrayMetadata,
  IDataQuery,
  IDataSubarray,
  IOptions,
  Resource,
  SupportedType
} from "../common/EtpTypes";
export { Energistics } from "../common/Etp12";
export type {
  Boolean,
  Bytes,
  Double,
  Float,
  Integer32,
  Integer64,
  Integer8
} from "../common/Etp12";

export type ContextInfo = Energistics.Etp.v12.Datatypes.Object.ContextInfo;
export type URI = string;
export { EtpContentType } from "../common/EtpContentType";
export { EtpQualifiedType } from "../common/EtpQualifiedType";
export { EtpUri } from "../common/EtpUri";
export type { ArrayByteUuid } from "../common/EtpUri";
export { AnyTypedArray, IHDF5ArrayInput } from "../protocols/ArrayCustomer";

export * as ODataUtils from "../oDataParser/oDataUtils";

export * as XmlUtils from "../mlTypes/XmlJsonUtil";
export { SimpleJson } from "../mlTypes/XmlJsonUtil";
export * as Resqml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/resqmlv2";
export * as Resqml22 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv22/resqmlv2";
export * as Eml20 from "../mlTypes/xmlns/www.energistics.org/energyml/resqmlv201/commonv2";
export * as Eml23 from "../mlTypes/xmlns/www.energistics.org/energyml/witsmlv21/commonv2";

const authenticationKeyBase =
  process.env.RDMS_AUTHENTICATION_KEY_BASE || "osdu-rddms";

/**
 * Item 24: SSL TLS options for WSS connections.
 * When RDMS_ETP_SSL_VERIFY is "false", self-signed certificates are accepted.
 * Enables single-image deployment for both SSL and non-SSL environments.
 */
const tlsOptions: object | undefined =
  process.env.RDMS_ETP_SSL_VERIFY === "false"
    ? { rejectUnauthorized: false }
    : undefined;

export type IResqmlDataObject =
  | SimpleJson<Eml23.AbstractObject>
  | SimpleJson<Resqml20.AbstractResqmlDataObject>;

export { Convert } from "../mlTypes/ResqmlTypes";

const notEmpty = <TValue>(
  value: TValue | null | undefined
): value is TValue => {
  return value !== null && value !== undefined;
};
export const notEmptyFilter = notEmpty;

const byteDecoder = new TextDecoder();

/**
 * Convert an array of bytes to a string
 * Avoiding out of range issue.
 *
 * @param {Buffer} bytes
 * @returns {string} bytes converted according to UTF8
 * @memberof ResqmlClient
 */
export const byteToString = (bytes: Buffer): string => {
  return byteDecoder.decode(bytes);
};

/**
 * @default "json"
 */
export type ArrayFormat = "json" | "base64";

export type ArrayOutput = number[] | boolean[] | string[] | string;

export type NumberArray = Int32Array | Float32Array | Float64Array;

function formattedTypedArray<T extends NumberArray>(
  values: number[],
  t: new (arr: number[]) => T,
  format: ArrayFormat
): ArrayOutput | undefined {
  if (format === "base64") {
    const fa = new t(values);
    return Buffer.from(fa.buffer).toString("base64");
  }
  return values;
}

export class AuthorizationError extends EtpError {
  challenges?: string[];
  constructor(message: string, challenges?: string[]) {
    super(message, ErrorCode.EAUTHORIZATION_REQUIRED);
    this.challenges = challenges;
  }
}

/**
 * ETP client allowing to get RESQML information from an ETP server.
 * Represents a single ETP session, if several sessions are requested in parallel, several clients
 * are required.
 *
 * @class ResqmlClient
 */
export class ResqmlClient {
  public logger = logging.getLogger("EtpClient");
  public log: (message?: any, ...optionalParams: any[]) => void =
    this.logger.info.bind(this.logger);
  public readonly options: IOptions = {
    collapseTextElement: true,
    removeNamespace: true
  };

  private readonly client: ETPClient.ETPClient = new ETPClient.ETPClient({
    name: "Resqml ETP Client"
  });
  private readonly dataArray: ArrayCustomer;
  readonly discovery: DiscoveryCustomer = new DiscoveryCustomer(this.client);
  private readonly supportedTypes: SupportedTypesCustomer =
    new SupportedTypesCustomer(this.client);
  readonly store: StoreCustomer = new StoreCustomer(this.client);
  private readonly storeNotification: StoreNotificationCustomer =
    new StoreNotificationCustomer(this.client);
  private readonly dataspace: DataspaceCustomer = new DataspaceCustomer(
    this.client
  );
  private readonly dataspaceOSDU: DataspaceOSDUCustomer =
    new DataspaceOSDUCustomer(this.client);
  private readonly transaction: TransactionCustomer = new TransactionCustomer(
    this.client
  );
  readonly discoveryQuery: DiscoveryQueryCustomer = new DiscoveryQueryCustomer(
    this.client
  );
  readonly storeQuery: StoreQueryCustomer = new StoreQueryCustomer(this.client);
  readonly growingObject: GrowingObjectCustomer = new GrowingObjectCustomer(
    this.client
  );
  readonly growingObjectNotification: GrowingObjectNotificationCustomer =
    new GrowingObjectNotificationCustomer(this.client);
  readonly channelSubscribe: ChannelSubscribeCustomer =
    new ChannelSubscribeCustomer(this.client);
  private connected = false;

  private readonly overhead = 1024; // Represents the overhead to add on top of array size
  // Corresponding to the array definitions

  /** Check whether the connected ETP server supports a given protocol. */
  public isProtocolSupported(protocolId: number): boolean {
    return this.client.isProtocolSupported(protocolId);
  }

  /**
   * Creates an instance of ResqmlClient.
   * @param {Options} [opt] Defines how the xml should be translated into JS
   * @memberof ResqmlClient
   */
  constructor(opt?: IOptions) {
    this.client.on("log", this.logger.info.bind(this.logger));
    this.client.on("disconnect", this.onSocketDisconnect.bind(this));
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.Dataspace,
      this.dataspace
    );
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.Discovery,
      this.discovery
    );
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.Store,
      this.store
    );
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.SupportedTypes,
      this.supportedTypes
    );
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.Transaction,
      this.transaction
    );
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.StoreNotification,
      this.storeNotification
    );
    this.dataArray = new ArrayCustomer(this.client);
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.DataArray,
      this.dataArray
    );
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.DataspaceOSDU,
      this.dataspaceOSDU
    );
    // Extended protocols — always registered; the ETP session negotiation
    // determines which ones the server actually supports.  REST endpoints
    // check `isProtocolSupported()` and return 501 when unavailable.
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.DiscoveryQuery,
      this.discoveryQuery
    );
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.StoreQuery,
      this.storeQuery
    );
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.GrowingObject,
      this.growingObject
    );
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.GrowingObjectNotification,
      this.growingObjectNotification
    );
    this.client.registerHandler(
      Energistics.Etp.v12.Datatypes.Protocol.ChannelSubscribe,
      this.channelSubscribe
    );
    if (opt) {
      this.options = opt;
    }
  }

  /**
   * Add a callback invoked for any received message
   * @param onMessage
   */
  public addMessageTracer(
    onMessage: (header: Energistics.Etp.v12.Datatypes.MessageHeader) => void
  ): void {
    this.client.enableMessageReceptionTracing = true;
    this.client.on("messageHeader", onMessage);
  }

  /**
   * Add a callback invoked for any received message, or sent messageId.
   * Attention! This should only to be used in the ETP certification program as this may seriously degrade performance.
   * @param callback
   */
  public addCertificationTracer(
    type: "message",
    callback: (
      header: Energistics.Etp.v12.Datatypes.MessageHeader,
      body: allMessageBodyType
    ) => void
  ): void;
  public addCertificationTracer(
    type: "messageId",
    callback: (messageId: bigint) => void
  ): void;
  public addCertificationTracer(
    type: "message" | "messageId",
    callback:
      | ((
        header: Energistics.Etp.v12.Datatypes.MessageHeader,
        body: allMessageBodyType
      ) => void)
      | ((messageId: bigint) => void)
  ): void {
    this.client.enableCertificationTracing = true;
    this.client.on(type, callback);
  }

  /**
   * Connect to a server using its URL and create a new ETP session
   *
   * @param {string} url URL of the server including port. Example 'ws://localhost:9004'
   * @param {string} [jwToken] JWT token used by authentication,
   *                            When undefined <code>authenticationKey</code> and <code>userInfo</code> are used for authentication
   * @param {string} [authenticationKey] key used to match vendor client & server. When undefined no vendor specific check is done.
   *                           When <code>jwToken</code> is not provided, authenticationKey is also used to generate a JWT from <code>userInfo</code>
   * @param {{ username: string; password: string } | string} [userInfo] Information used to create authentication when no <code>jwToken</code>.
   *                           If a string is given it will be passed as-is else user/password will be encoded,
   *                           If <code>authenticationKey</code> is present, JWT authentication is generated, else basic non-encrypted is used
   * @returns {Promise<void>}
   * @memberof ResqmlClient
   */
  public async openSession(
    url: string,
    jwToken?: string,
    dataPartitionId?: string,
    userInfo?: { username: string; password: string } | string,
    authenticationKey?: string,
    maxMessagePayloadSize = 10000000
  ): Promise<void> {
    let authentication = jwToken ? `Bearer ${jwToken}` : "";
    if (!jwToken) {
      if (typeof userInfo === "string") {
        authentication = userInfo;
      } else {
        const { username, password } = userInfo ?? {
          username: "",
          password: ""
        };
        const buffer = Buffer.from(`${username}:${password}`);
        authentication = `Basic ${buffer.toString("base64")}`;
      }
    }
    await new Promise((resolve, reject) => {
      const config: ETPClient.IClientConfig = {
        authentication,
        clientId: authenticationKey
          ? uuidNameSpace(authenticationKey, authenticationKeyBase)
          : undefined,
        dataPartitionId,
        encoding: "binary",
        maxReceivedMessageSize: maxMessagePayloadSize,
        noHeaders: false,
        url,
        ...(tlsOptions ? { tlsOptions } : {})
      };
      try {
        this.client.on("connect", resolve);
        this.client.on("error", reject);
        this.client.on(
          "exception",
          (_, m: Energistics.Etp.v12.Protocol.Core.ProtocolException) =>
            reject(errorFromProtocolException(m))
        );
        this.client.connect(config, socket);
      } catch (err) {
        reject(err);
      }
    });
    return this.requestSession();
  }

  /**

   * Connect to a server using its URL but does not establish a session.
   *
   * @param {string} url URL of the server including port. Example 'ws://localhost:9004'
   * @param {string} [authentication] Authentication header to use when connecting to the server, when undefined authentication should be done later if required
   * @param {string} [dataPartitionId] Data partition to use when connecting to the server, when undefined the server will use the default data partition
   * @param {string} [clientId] Client id to use when connecting to the server, when undefined the server will generate a client id
   * @param {number} [maxMessagePayloadSize=10000000] Maximum size of a message payload in bytes
   * @returns {Promise<void>}
   * @memberof ResqmlClient
   */
  public async connect(
    url: string,
    authentication?: string,
    dataPartitionId?: string,
    clientId?: string,
    maxMessagePayloadSize = 10000000
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const config: ETPClient.IClientConfig = {
        authentication,
        clientId,
        dataPartitionId,
        encoding: "binary",
        maxReceivedMessageSize: maxMessagePayloadSize,
        noHeaders: false,
        url,
        ...(tlsOptions ? { tlsOptions } : {})
      };
      try {
        this.client.on("connect", resolve);
        this.client.on("error", reject);
        this.client.on(
          "exception",
          (_, m: Energistics.Etp.v12.Protocol.Core.ProtocolException) =>
            reject(errorFromProtocolException(m))
        );
        this.client.connect(config, socket);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Request a new Authorize with given authentication token
   *
   * @public
   * @param {string} [jwToken] [jwtToken] JWT token used by authentication,
   *                            When undefined <code>authenticationKey</code> and <code>userInfo</code> are used for authentication
   * @param {{ username: string; password: string } | string} [userInfo] Information used to create authentication when no <code>jwToken</code>.
   *                             If a string is given it will be passed as-is else user/password will be encoded,
   *                             If <code>authenticationKey</code> is present, JWT authentication is generated, else basic non-encrypted is used
   * @returns {Promise<void>} void promise
   * @memberof ResqmlClient
   */
  public async requestAuthorize(
    jwToken?: string,
    userInfo?: { username: string; password: string } | string
  ): Promise<void> {
    let authentication = jwToken ? `Bearer ${jwToken}` : "";
    if (!jwToken) {
      if (typeof userInfo === "string") {
        authentication = userInfo;
      } else {
        const { username, password } = userInfo ?? {
          username: "",
          password: ""
        };
        const buffer = Buffer.from(`${username}:${password}`);
        authentication = `Basic ${buffer.toString("base64")}`;
      }
    }
    return new Promise((resolve, reject) => {
      this.client.on("authorize", (_, m) => {
        if (m.success) {
          resolve();
        } else {
          reject(new AuthorizationError("Authorization Error", m.challenges));
        }
      });
      this.client.on("error", err => {
        reject(new AuthorizationError(`Authorization Error: ${err.message}`));
      });
      this.client.on(
        "exception",
        (_, err: Energistics.Etp.v12.Protocol.Core.ProtocolException) => {
          const message = err?.error?.message ?? "Unknown";
          const auth = new AuthorizationError(
            `Authorization Error: ${message}`
          );
          if (err.error?.code === ErrorCode.EAUTHORIZATION_EXPIRED) {
            auth.message = "Authorization Error: Authorization expired";
            auth.code = ErrorCode.EAUTHORIZATION_EXPIRED;
          }
          reject(auth);
        }
      );
      this.client.requestAuthorize(authentication);
    });
  }

  /**
   * Close the session
   *
   * @param {number} [disconnectionWait=5000] Maximum time to wait for disconnection
   * @returns {Promise<void>}
   * @memberof ResqmlClient
   */
  public async closeSession(disconnectionWait = 5000): Promise<void> {
    if (this.client.isInSession()) {
      return new Promise((resolve, reject) => {
        const timer = new Timer(() => reject("timeout"), disconnectionWait);
        this.client.on("disconnect", () => {
          timer.cancel(false);
          resolve();
        });
        this.client.on(
          "exception",
          (_, m: Energistics.Etp.v12.Protocol.Core.ProtocolException) => {
            timer.cancel(false);
            const err = errorFromProtocolException(m);
            err.message = `Cannot close session: ${err.message}`;
            reject(err);
          }
        );
        this.client.on("error", () => {
          timer.cancel(false);
          reject("Cannot close session");
        });
        this.client.closeSession();
      });
    } else {
      return Promise.resolve();
    }
  }

  public async disconnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const disconnectionWait = 5000;
      const timer = new Timer(reject, disconnectionWait);
      this.client.on("disconnect", () => {
        timer.cancel(false);
        resolve();
      });
      this.client.disconnect();
    });
  }

  /**
   * Register a callback to be invoked when the client disconnects.
   * The callback may optionally receive the connection, WebSocket close code
   * and close reason emitted by `ETPClient.onSocketClose`.
   *
   * @param callback The callback to invoke on disconnect
   * @memberof ResqmlClient
   */
  public onDisconnect(
    callback: (
      connection?: unknown,
      closeCode?: number,
      closeReason?: string
    ) => void
  ): void {
    this.client.on("disconnect", callback);
  }

  /**
   * Unregister a disconnect callback
   *
   * @param callback The callback to remove
   * @memberof ResqmlClient
   */
  public offDisconnect(
    callback: (
      connection?: unknown,
      closeCode?: number,
      closeReason?: string
    ) => void
  ): void {
    this.client.off("disconnect", callback);
  }

  /**
   * @returns true if client currently in open session
   *
   * @memberof ResqmlClient
   */
  public isInSession(): boolean {
    return this.client.isInSession();
  }

  /**
   * Indicates if the client is currently connected
   *
   * @returns true if client currently connected to server
   * @memberof ResqmlClient
   */
  public isConnected(): boolean {
    return this.connected;
  }

  /**
   * Ping the server
   *
   * @returns {(Promise<Integer64 | null>)} Roundtrip time in microseconds
   * @memberof ResqmlClient
   */
  public async ping(): Promise<Integer64 | null> {
    return this.client.ping();
  }

  /**
   * Returns the negotiated size of message
   *
   * @returns {(number | null)}
   * @memberof ResqmlClient
   */
  public negotiatedSize(): number | null {
    return this.client.negotiatedSize ? this.client.negotiatedSize : null;
  }

  /**
   * Return the size of the queue negotiated with the server
   *
   * @returns {number}
   * @memberof ResqmlClient
   */
  public messageQueueDepth(): number {
    return this.client.messageQueueDepth;
  }

  /**
   * Returns the overhead size of message
   *
   * @returns {(number | null)}
   * @memberof ResqmlClient
   */
  public overheadSize(): number {
    return this.overhead;
  }

  /**
   * Start a client transaction
   *
   * @param {boolean} readOnly Indicate that the transaction contains only read only messages
   * @param {URI[]} dataSpaces List of dataspaces (uris) that the messages will impact
   * @param {string} message Commit message
   * @param {number} [retriesLeft=6] Number of retries
   * @param {number} [interval=400] Time interval (ms) after first retry
   * @param {number} [factor=2] Factor to increase the interval between retries
   * @returns {Promise<ArrayByteUuid>} Transaction identifier
   * @memberof ResqmlClient
   */
  public startTransaction(
    readOnly: boolean,
    dataSpaces: URI[],
    message: string,
    retriesLeft: number = 6,
    interval: number = 400,
    factor: number = 2
  ): Promise<ArrayByteUuid> {
    return retryOnEtpErrors(
      () => this.transaction.startTransaction(readOnly, dataSpaces, message),
      [ErrorCode.EMAX_TRANSACTIONS_EXCEEDED],
      retriesLeft,
      interval,
      factor
    );
  }

  /**
   * Commit a previously started transaction
   *
   * @param {ArrayByteUuid} uuid Transaction identifier (from startTransaction)
   * @returns {Promise<boolean>} Transaction success
   * @memberof ResqmlClient
   */
  public commitTransaction(uuid: ArrayByteUuid): Promise<boolean> {
    return this.transaction.commitTransaction(uuid);
  }

  /**
   * Rollback a previously started transaction (from startTransaction)
   *
   * @param {ArrayByteUuid} uuid Transaction identifier
   * @returns {Promise<boolean>} Rollback success
   * @memberof ResqmlClient
   */
  public rollbackTransaction(uuid: ArrayByteUuid): Promise<boolean> {
    return this.transaction.rollbackTransaction(uuid);
  }

  /**
   * From the store get the data Objects corresponding to the given URIs.
   * This is the raw content with an XML representation in the data.
   *
   * @param {string} uris Array of uri of the objects to get
   * @returns {Promise<Array<DataObject | null>>} Raw objects as returned by server
   * @memberof ResqmlClient
   */
  public getDataObjects(uris: URI[]): Promise<Array<DataObject | null>> {
    return this.store.get(
      uris.map(u => {
        const index = u.indexOf("?");
        return index === -1 ? u : u.slice(0, index);
      })
    );
  }

  /**
   * Send xml objects to server
   *
   * @param {Array<DataObject>} objects
   * @returns {Promise<boolean>} Put success
   * @memberof ResqmlClient
   */
  public async putDataObjects(objects: DataObject[]): Promise<boolean> {
    return this.store
      .put(objects)
      .then(this.checkErrors.bind(this))
      .catch(reason => {
        this.logger.error(reason);
        return false;
      });
  }

  /**
   * Transform a string to a byte array
   *
   * @param {string} str string to convert
   * @returns {number[]} byte array corresponding to string conversion
   * @memberof ResqmlClient
   */
  public stringToByteArray(str: string): number[] {
    const byteArray: number[] = [];
    str.split("-").forEach((n: string) => {
      const rev = n.match(/.{1,2}/g);
      if (rev) {
        rev.forEach((b: string) => byteArray.push(parseInt(b, 16)));
      }
    });
    return byteArray;
  }

  /**
   * Subscribe for notifications about dataSpace change
   *
   * @param {URI} dataspaceURI to be notified about
   * @param {string[]} [dataObjectTypes=[]] Types to listen to
   * @param {number} [startTime=Date.now()] Start of the notification (can go back in time)
   * @param {((e: Energistics.Etp.v12.Protocol.StoreNotification.ObjectChanged) => void)} [onChanged] Callback when an object is changed
   * @param {((e: Energistics.Etp.v12.Protocol.StoreNotification.ObjectDeleted) => void)} [onDeleted] Callback when an object is deleted
   * @returns {Promise<Energistics.Etp.v12.Datatypes.Uuid | null>} Identifier of notification
   * @memberof ResqmlClient
   */
  public async subscribeNotifications(
    dataspaceURI: URI,
    dataObjectTypes: string[] = [],
    startTime: number = Date.now(),
    onChanged?: (
      e: Energistics.Etp.v12.Protocol.StoreNotification.ObjectChanged
    ) => void,
    onDeleted?: (
      e: Energistics.Etp.v12.Protocol.StoreNotification.ObjectDeleted
    ) => void
  ): Promise<Energistics.Etp.v12.Datatypes.Uuid | null> {
    const uuid: string = uuidRandom();
    const requestUuid = EtpUri.uuidStringToByteArray(uuid);
    const subscription: Energistics.Etp.v12.Protocol.StoreNotification.SubscribeNotifications =
    {
      request: new Map([
        [
          "project",
          {
            context: {
              dataObjectTypes,
              depth: 10,
              includeSecondarySources: false,
              includeSecondaryTargets: false,
              navigableEdges:
                Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both,
              uri: dataspaceURI
            },
            format: "xml",
            includeObjectData: false,
            requestUuid,
            scope: Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.self,
            startTime
          }
        ]
      ])
    };
    if (onChanged) {
      this.storeNotification.on(
        "objectChanged",
        (e: {
          header: Energistics.Etp.v12.Datatypes.MessageHeader;
          body: Energistics.Etp.v12.Protocol.StoreNotification.ObjectChanged;
        }) => {
          if (EtpUri.uuidByteArrayToString(e.body.requestUuid) === uuid) {
            onChanged(e.body);
          }
        }
      );
    }
    if (onDeleted) {
      this.storeNotification.on(
        "objectDeleted",
        (e: {
          header: Energistics.Etp.v12.Datatypes.MessageHeader;
          body: Energistics.Etp.v12.Protocol.StoreNotification.ObjectDeleted;
        }) => {
          if (EtpUri.uuidByteArrayToString(e.body.requestUuid) === uuid) {
            onDeleted(e.body);
          }
        }
      );
    }
    return this.storeNotification
      .subscribeNotifications(subscription)
      .then(() => requestUuid)
      .catch(() => null);
  }

  /**
   * Remove a notification subscription
   *
   * @param {Energistics.Etp.v12.Datatypes.Uuid} requestUuid Notification identifier
   * @memberof ResqmlClient
   */
  public unsubscribeNotifications(
    requestUuid: Energistics.Etp.v12.Datatypes.Uuid
  ): void {
    const subscription: Energistics.Etp.v12.Protocol.StoreNotification.UnsubscribeNotifications =
    {
      requestUuid
    };
    this.storeNotification.unSubscribeNotifications(subscription);
  }

  /**
   * Use the supportedTypes service to get the SupportedTypes in a given project.
   * Create a promise that will be resolved by {@link onGetSupportedTypes}
   *
   * @param {URI} dataspaceURI uri of the dataspace
   * @returns {Promise<SupportedType[]>} List of types present in the dataspace
   * @memberof ResqmlClient
   */
  public getDataspaceTypes(dataspaceURI: URI): Promise<SupportedType[]> {
    return this.supportedTypes.getSupportedTypes(
      this.client.dataSpaceSupported && dataspaceURI ? dataspaceURI : `eml:///`,
      true
    );
  }

  /**
   * Use the supportedTypes service to get the SupportedTypes in a given project.
   * Create a promise that will be resolved by {@link onGetSupportedTypes}
   * @deprecated Use {@link getDataspaceTypes} function instead.
   *
   * @param {URI} projectURI uri of the project
   * @returns {Promise<SupportedType[]>} List of types present in the project
   * @memberof ResqmlClient
   */
  public getProjectTypes(projectURI: URI): Promise<SupportedType[]> {
    return this.getDataspaceTypes(projectURI);
  }

  /**
   * Look for all dataspaces, if server does not support dataspaces, return null
   *
   * @param {Integer64} [storeLastWriteFilter] Filter on last write date
   * @returns {(Promise<Dataspace[]> | null )} List of project resources, null if no server support
   * @memberof ResqmlClient
   */
  public getDataspaces(
    storeLastWriteFilter?: Integer64
  ): Promise<Dataspace[] | null> {
    if (!this.isInSession()) {
      return Promise.resolve(null);
    }
    return this.client.dataSpaceSupported
      ? this.dataspace.getDataspaces(storeLastWriteFilter)
      : Promise.resolve([
        // Handle servers with no dataspace support
        {
          path: "/default",
          uri: "eml:///",
          storeCreated: BigInt(0),
          storeLastWrite: BigInt(0),
          customData: new Map()
        }
      ]);
  }

  /**
   * Look for all dataspaces, if server does not support dataspaces, return null
   * @deprecated Use {@link getDataspaces} function instead.
   *
   * @returns {(Promise<Dataspace[]> | null )} List of project resources, null if no server support
   * @memberof ResqmlClient
   */
  public getProjects(): Promise<Dataspace[] | null> {
    return this.getDataspaces();
  }

  /**
   * Create a list of new dataspaces
   *
   * @param {Dataspace[]} dataspaces List of dataspaces to create
   * @returns {Promise<boolean>} Return creation success
   * @memberof ResqmlClient
   */
  public async createDataspaces(dataspaces: Dataspace[]): Promise<boolean> {
    if (!this.client.dataSpaceSupported) {
      throw new EtpError(
        "Server do not support Dataspace protocol",
        ErrorCode.ENOSUPPORTEDPROTOCOLS
      );
    }
    return this.dataspace
      .PutDataspaces(dataspaces)
      .then(this.checkErrors.bind(this));
  }

  /**
   * Create a list of new dataspaces corresponding to scenario
   * @deprecated Use {@link createDataspaces} function instead.
   *
   * @param {Dataspace[]} dataspaces List of projects to create
   * @returns {Promise<boolean>} Return creation success
   * @memberof ResqmlClient
   */
  public async createProjects(dataspaces: Dataspace[]): Promise<boolean> {
    return this.createDataspaces(dataspaces);
  }

  /**
   * Find an existing dataspace or create a new one
   *
   * @param {string} dataspaceUid UUID of the dataspace
   * @param {string} path path of the dataspace if it needs to be created
   * @param {Map<string, DataValue>} [customData=new Map<string, DataValue>()] path path of the dataspace if it needs to be created
   * @returns {Promise<boolean>}
   * @memberof ResqmlClient
   */
  public async findOrCreateDataspace(
    dataspaceUid: string,
    path: string,
    customData: Map<string, DataValue> = new Map<string, DataValue>()
  ): Promise<boolean> {
    const uri = EtpUri.createDataSpaceUri(dataspaceUid).uri;
    return this.getDataspaces()
      .then(dataspaces => dataspaces?.filter(f => f.uri === uri))
      .then(dataspaces => {
        if (dataspaces && dataspaces.length > 0) {
          return true;
        }
        const p: Dataspace = {
          uri,
          path,
          storeCreated: BigInt(Date.now()),
          storeLastWrite: BigInt(Date.now()),
          customData
        };
        return this.createDataspaces([p]);
      })
      .catch(err => {
        this.logger.error(err);
        return false;
      });
  }

  /**
   * Get dataspace information
   *
   * @param {URI[]} dataspaceUris List of dataspace uris
   * @returns {Promise<(Dataspace | null)[]>} List of dataspace information
   * @memberof ResqmlClient
   * @public
   * @async
   * @example
   * const dataspaceUris = ["eml:///space/space1", "eml:///space/space2"];
   * const dataspaceInfo = await client.getDataspaceInfo(dataspaceUris);
   */
  public async getDataspaceInfo(
    dataspaceUris: URI[]
  ): Promise<(Dataspace | null)[]> {
    if (!this.isInSession()) {
      return dataspaceUris.map(() => null);
    }
    if (this.client.dataSpaceOSDUSupported) {
      return this.dataspaceOSDU.getDataspaceInfo(dataspaceUris);
    }
    if (this.client.dataSpaceSupported) {
      return (await this.dataspace.getDataspaces()).filter(uri =>
        dataspaceUris.includes(uri.uri)
      );
    }
    return dataspaceUris.map(() => null);
  }

  /**
   * Duplicate existing dataspace
   *
   * @param {string} dataspaceUid UUID of the dataspace
   * @param {string} path path of the dataspace if it needs to be created
   * @param {URI} originURI URI of the origin dataspace
   * @param {Map<string, DataValue>} [customData=new Map<string, DataValue>()] path path of the dataspace if it needs to be created
   * @returns {Promise<boolean>}
   * @memberof ResqmlClient
   */
  public async cloneDataspace(
    dataspaceUid: string,
    path: string,
    originURI: URI,
    customData: Map<string, DataValue> = new Map<string, DataValue>()
  ): Promise<boolean> {
    const uri = EtpUri.createDataSpaceUri(dataspaceUid).uri;

    const p: Dataspace = {
      uri,
      path,
      storeCreated: BigInt(Date.now()),
      storeLastWrite: BigInt(Date.now()),
      customData
    };

    if (this.client.dataSpaceOSDUSupported) {
      return this.dataspace
        .PutDataspaces([p])
        .then(this.checkErrors.bind(this))
        .then(() => this.dataspaceOSDU.copyDataspacesContent([originURI], uri))
        .then(this.checkErrors.bind(this))
        .catch(async err => {
          // Rollback: delete the destination dataspace to avoid orphaned empty dataspaces
          try {
            await this.dataspace.DeleteDataspaces([uri]);
          } catch (cleanupErr) {
            this.logger.error(
              "Failed to clean up destination dataspace after clone failure",
              cleanupErr
            );
          }
          throw err;
        });
    }

    if (!this.client.dataSpaceSupported) {
      return false;
    }

    const dataspaces = await this.getDataspaces();
    if (!dataspaces || dataspaces.findIndex(f => f.uri === uri) !== -1) {
      return false;
    }
    if (dataspaces.findIndex(f => f.uri === originURI) === -1) {
      return false;
    }

    customData.set("fromDataspace", EtpDataValue.avroString(originURI));

    return this.createDataspaces([p]);
  }

  /**
   * Copy content of dataspaces into another dataspace
   *
   * @param {URI} destination URI of the dataspace that will receive the copied content
   * @param {URI[]} sources List of dataspace uris to copy
   * @returns {Promise<boolean>} Success of copy
   */
  public async copyDataspacesContent(
    destination: URI,
    sources: URI[]
  ): Promise<boolean> {
    if (!this.client.dataSpaceOSDUSupported) {
      this.logger.error("DataspaceOSDU not supported by server");
      return Promise.resolve(false);
    }
    return this.dataspaceOSDU
      .copyDataspacesContent(sources, destination)
      .then(this.checkErrors.bind(this))
      .catch(reason => {
        this.logger.error(reason);
        return false;
      });
  }

  /**
   * Copy resource from into another dataspace
   * Note: this requires the resources to be in a read only dataspaces
   *
   * @param {URI} dataspaceUri Target dataspace
   * @param {URI[]} resources Resources to import
   * @returns {Promise<boolean>}
   * @memberof DataspaceCustomer
   */
  public copyToDataspace(
    dataspaceUri: URI,
    resources: URI[]
  ): Promise<boolean> {
    if (!this.client.dataSpaceOSDUSupported) {
      this.logger.error("DataspaceOSDU not supported by server");
      return Promise.resolve(false);
    }
    return this.dataspaceOSDU
      .copyToDataspace(resources, dataspaceUri)
      .then(this.checkErrors.bind(this))
      .catch(reason => {
        this.logger.error(reason);
        return false;
      });
  }

  /**
   * Find an existing dataspace or create a new one
   * @deprecated Use {@link findOrCreateDataspace} function instead.
   *
   * @param {string} dataspaceUid UUID of the dataspace
   * @param {string} path path of the dataspace if it needs to be created
   * @param {Map<string, DataValue>} [customData=new Map<string, DataValue>()] path path of the dataspace if it needs to be created
   * @returns {Promise<boolean>}
   * @memberof ResqmlClient
   */
  public async findOrCreateProject(
    dataspaceUid: string,
    path: string,
    customData: Map<string, DataValue> = new Map<string, DataValue>()
  ): Promise<boolean> {
    return this.findOrCreateDataspace(dataspaceUid, path, customData);
  }

  /**
   * Delete dataspaces
   *
   * @param {URI[]} dataspaces List of project dataspaces URI
   * @returns {Promise<boolean>} Success of deletion
   * @memberof ResqmlClient
   */
  public async deleteDataspaces(dataspaces: URI[]): Promise<boolean> {
    return this.client.dataSpaceSupported && dataspaces.length > 0
      ? this.dataspace
        .DeleteDataspaces(dataspaces)
        .then(this.checkErrors.bind(this))
      : false;
  }

  /**
   * Delete projects
   * @deprecated Use {@link deleteDataspaces} function instead.
   *
   * @param {URI[]} dataspaces List of project dataspaces URI
   * @returns {Promise<boolean>} Success of deletion
   * @memberof ResqmlClient
   */
  public async deleteProjects(dataspaces: URI[]): Promise<boolean> {
    return this.deleteDataspaces(dataspaces);
  }

  /**
   * Lock dataspaces as read only
   *
   * @param dataspaces List of dataspaces URI to lock
   * @returns {Promise<boolean>} Success of locking
   */
  public async lockDataspaces(dataspaces: URI[]): Promise<boolean> {
    return this.client.dataSpaceOSDUSupported && dataspaces.length > 0
      ? this.dataspaceOSDU
        .lockDataspaces(dataspaces)
        .then(this.checkErrors.bind(this))
        .catch(reason => {
          this.logger.error(reason);
          return false;
        })
      : false;
  }

  /**
   * Unlock dataspaces as read write
   *
   * @param dataspaces List of dataspaces URI to unlock
   * @returns {Promise<boolean>} Success of unlocking
   */
  public async unlockDataspaces(dataspaces: URI[]): Promise<boolean> {
    return this.client.dataSpaceOSDUSupported && dataspaces.length > 0
      ? this.dataspaceOSDU
        .lockDataspaces(dataspaces, false)
        .then(this.checkErrors.bind(this))
        .catch(reason => {
          this.logger.error(reason);
          return false;
        })
      : false;
  }

  /**
   * Get JS Objects corresponding to the given uris.
   * None of the reference inside the objects will be resolved.
   * If there is a need for resolved objects use {@link getResolvedObjects} instead.
   *
   * @param {URI[]} uris of the objects to get
   * @param {boolean} [_usingSchema=true] allow not to use schema for conversion, which is faster but very dangerous if you have an array in any part of the path when accessing an element.
   * @returns {Promise<Array<IResqmlDataObject|null>} Resulting object in order of query, null if query fail
   * @memberof ResqmlClient
   */
  public async getObjects(
    uris: URI[],
    _usingSchema = true
  ): Promise<Array<IResqmlDataObject | null>> {
    if (uris.length === 0) {
      return [];
    }
    return this.getDataObjects(uris).then(dobs =>
      Promise.all(
        dobs.map(dob =>
          dob
            ? xml2typescript(
              byteToString(dob.data),
              new EtpUri(dob.resource.uri).dataObjectType
            ).catch(err => {
              this.logger.warn(`xml2typescript failed for ${new EtpUri(dob.resource.uri).dataObjectType}: ${err}`);
              return null;
            })
            : null
        )
      )
    );
  }

  /**
   * Fill dataArrays map with HDF5 array content
   *
   * @private
   * @param {(Map<URI, IDataArray)} dataArrays
   * @returns
   * @memberof ResqmlClient
   */
  private async getArraysContent(dataArrays: Map<URI, IDataArray>) {
    return Promise.all(
      Array.from(dataArrays.values()).map(({ uid }) =>
        this.getDataArray(uid.uri, uid.pathInResource).then(
          a =>
            a && dataArrays.set(`${a.uid.uri}${a.uid.pathInResource}`, { ...a })
        )
      )
    ).then(() => dataArrays);
  }

  /**
   * Add array numerical values to HDF5 datasets
   *
   *
   * @param {URI} uri
   * @param {IResqmlDataObject} obj
   * @returns {Promise<IResqmlDataObject>}
   * @memberof ResqmlClient
   */
  public async addArrayValues(
    uri: URI,
    obj: IResqmlDataObject,
    arrayFormat: ArrayFormat = "base64"
  ): Promise<IResqmlDataObject> {
    const dataArrays = new Map<URI, IDataArray>(); // Map URI=>DataArray
    this.findDataArrays(uri, obj, dataArrays);
    return this.getArraysContent(dataArrays).then(() => {
      this.resolveReferences(
        uri,
        obj,
        new Map(),
        dataArrays,
        new Map(),
        arrayFormat,
        false
      );
      return obj;
    });
  }

  /**
   * Delete a series of object through their URis
   *
   * @param {URI[]} uris
   * @returns
   * @memberof ResqmlClient
   */
  public async deleteObjects(
    uris: URI[]
  ): Promise<Energistics.Etp.v12.Datatypes.ErrorInfo[]> {
    return this.store.deleteObjects(uris);
  }

  /**
   * Get Resources recursively
   *
   * @param {(URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo)} context
   * @param {Energistics.Etp.v12.Datatypes.Object.ContextScopeKind} scope
   * @param {string[]} [dataObjectTypes] If defined, it will overwrite the content of context, If not empty, filter on specified type
   * @param {boolean} [countObjects=false] Indicates that the server is requested to provide the source and target count
   * @param {(Integer64 | null)} [storeLastWriteFilter=null]
   * @param {Map<URI, IResqmlDataObject>} [objects]
   * @returns {Promise<Resource[]>}
   * @memberof ResqmlClient
   */
  public async getResources(
    context: URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    scope: Energistics.Etp.v12.Datatypes.Object.ContextScopeKind,
    dataObjectTypes?: string[],
    countObjects = false,
    storeLastWriteFilter: Integer64 | null = null,
    activeStatusFilter: Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind | null = null,
    objects?: Map<URI, IResqmlDataObject>
  ): Promise<Resource[]> {
    let uri: EtpUri;
    if (typeof context === "string") {
      uri = new EtpUri(context);
      context = {
        dataObjectTypes: dataObjectTypes ?? [],
        depth: 1,
        includeSecondarySources: false,
        includeSecondaryTargets: false,
        navigableEdges:
          Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both,
        uri: this.client.dataSpaceSupported && context ? uri.uriPath : `eml:///`
      };
    } else {
      uri = new EtpUri(context.uri);
      context.uri = uri.uriPath;
      if (dataObjectTypes && !context.dataObjectTypes.length) {
        context.dataObjectTypes = dataObjectTypes;
      }
    }
    return this.discovery
      .getResources(
        context,
        scope,
        countObjects,
        storeLastWriteFilter,
        activeStatusFilter
      )
      .then(resources =>
        uri.query?.filter
          ? this.filterResources(resources, [uri.query.filter], objects)
          : resources
      );
  }

  /**
   * Get Resources deleted from a dataspace
   *
   * @param {URI} dataspace dataspace URI
   * @param {string[]} [dataObjectTypes] If not empty, filter on specified type
   * @param {(Integer64 | null)} [storeDeletedFilter=null]
   * @returns {Promise<DeletedResource[]>}
   * @async
   * @memberof ResqmlClient
   */
  public async getDeletedResources(
    dataspace: URI,
    dataObjectTypes?: string[],
    storeDeletedFilter: Integer64 | null = null
  ): Promise<DeletedResource[]> {
    const uri: EtpUri = new EtpUri(dataspace);
    if (!uri.isValid) {
      return Promise.reject(
        new EtpError(
          `Invalid dataspace URI ${dataspace}`,
          ErrorCode.EINVALID_URI
        )
      );
    }
    return this.discovery.getDeletedResources(
      dataspace,
      dataObjectTypes ?? [],
      storeDeletedFilter
    );
  }

  /**
   * Get Resources recursively and build a graph of relationships between them
   *
   * @param {(URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo)} context Context URI or ContextInfo object (see ETP documentation)
   * @param {Energistics.Etp.v12.Datatypes.Object.ContextScopeKind} scope Scope of the context (see ETP documentation)
   * @param {boolean} [countObjects=false] Indicates that the server is requested to provide the source and target count
   * @param {string[]} [dataObjectTypes] If defined, it will overwrite the content of context, If not empty, filter on specified type
   * @param {(Integer64 | null)} [storeLastWriteFilter=null] If defined, only return objects with a lastWrite time greater than this value
   * @param {Map<URI, IResqmlDataObject>} [objects] If defined, will be filled with the objects found in the graph, useful to avoid multiple calls to the server
   * @returns {Promise<ResourceGraph>} A graph of resources and their relationships with other resources (see ETP documentation)
   * @memberof ResqmlClient
   */
  public async getGraph(
    context: URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    scope: Energistics.Etp.v12.Datatypes.Object.ContextScopeKind,
    countObjects = false,
    dataObjectTypes?: string[],
    storeLastWriteFilter: Integer64 | null = null,
    activeStatusFilter: Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind | null = null,
    objects?: Map<URI, IResqmlDataObject>
  ): Promise<ResourceGraph> {
    let uri: EtpUri;
    if (typeof context === "string") {
      uri = new EtpUri(context);
      context = {
        dataObjectTypes: dataObjectTypes ?? [],
        depth: 1,
        includeSecondarySources: false,
        includeSecondaryTargets: false,
        navigableEdges:
          Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both,
        uri: this.client.dataSpaceSupported && context ? uri.uriPath : `eml:///`
      };
    } else {
      uri = new EtpUri(context.uri);
      context.uri = uri.uriPath;
      if (dataObjectTypes && !context.dataObjectTypes.length) {
        context.dataObjectTypes = dataObjectTypes;
      }
    }
    return this.discovery
      .getGraph(
        context,
        scope,
        countObjects,
        storeLastWriteFilter,
        activeStatusFilter
      )
      .then(async graph => {
        if (uri.query?.filter) {
          const nodes = await this.filterResources(
            [...graph.values()],
            [uri.query.filter],
            objects
          );
          return graph.filter(n => nodes.includes(n));
        }
        return graph;
      });
  }

  /**
   * Implement the search for sources,
   * make sure that we don't search in a loop by tracking already found items
   *
   * @param {(URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo)} context The context to search for sources in
   * @param {boolean} [includeSelf=false] Specifies if initial resource must be included
   * @param {string[]} [dataObjectTypes=[]] If not empty, filter on specified type
   * @param {Map<URI, IResqmlDataObject>} [objects] Already found objects
   * @returns {Promise<Resource[]>} Matching results
   * @memberof ResqmlClient
   */
  public async getSources(
    context: URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    includeSelf = false,
    dataObjectTypes: string[] = [],
    objects?: Map<URI, IResqmlDataObject>
  ): Promise<Resource[]> {
    return this.getResources(
      context,
      includeSelf
        ? Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.sourcesOrSelf
        : Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.sources,
      dataObjectTypes,
      false,
      null,
      null,
      objects
    );
  }

  /**
   * Implement the search for targets,
   * make sure that we don't search in a loop by tracking already found items
   *
   * @param {(URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo)} context The context to search for targets in
   * @param {boolean} [includeSelf=false] Specifies if initial resource must be included
   * @param {string[]} [dataObjectTypes=[]] If not empty, filter on specified type
   * @param {Map<URI, IResqmlDataObject>} [objects] Already found objects
   * @returns {Promise<Resource[]>} Matching results
   * @memberof ResqmlClient
   */
  public async getTargets(
    context: URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    includeSelf = false,
    dataObjectTypes: string[] = [],
    objects?: Map<URI, IResqmlDataObject>
  ): Promise<Resource[]> {
    return this.getResources(
      context,
      includeSelf
        ? Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.targetsOrSelf
        : Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.targets,
      dataObjectTypes,
      false,
      null,
      null,
      objects
    );
  }

  /**
   * Get the direct targets of an object (one level) by parsing its xml content.
   * When the objects content is required anyway, it allows to resolved  multiple objects faster.
   *
   * @param {string} dataSpace
   * @param {IResqmlDataObject} resqmlObj
   * @param {Set<URI>} [uris=new Set<URI>()]
   * @memberof ResqmlClient
   */
  public getObjectTargets(
    dataSpace: string,
    resqmlObj: IResqmlDataObject,
    uris: Set<URI> = new Set<URI>()
  ): void {
    const obj = resqmlObj as Record<string, any>;
    Object.keys(obj).forEach(key => {
      if (!obj[key] || typeof obj[key] !== "object") {
        return;
      } else if (Array.isArray(obj[key])) {
        obj[key].map((o: IResqmlDataObject) =>
          this.getObjectTargets(dataSpace, o, uris)
        );
      } else {
        const qualifiedType = new EtpQualifiedType(obj[key]?.$type);
        if (qualifiedType.dataType.endsWith("DataObjectReference")) {
          const is20 = qualifiedType.domainVersion.startsWith("2.0");
          // Resolve the object reference
          const dataObjectType: EtpQualifiedType = is20
            ? new EtpContentType.EtpContentType(obj[key].ContentType)
              .qualifiedType
            : new EtpQualifiedType(obj[key].QualifiedType);
          const nURI = EtpUri.createObjectUri(
            dataSpace,
            dataObjectType.domainFamily,
            dataObjectType.domainVersion,
            dataObjectType.dataType,
            is20 ? obj[key].UUID : obj[key].Uuid,
            is20 ? obj[key].Version : obj[key].objectVersion
          );
          if (nURI.isValid) {
            uris.add(nURI.uri);
          }
        } else {
          this.getObjectTargets(dataSpace, obj[key], uris);
        }
      }
    });
  }

  /**
   * From the store get the resolved objects corresponding to the given URIs.
   * If only the non resolved object is needed, use {@link getObjects} instead
   *
   * @param {URI[]} uris of the objects to get
   * @param {Map<URI, IResqmlDataObject>} [objects=new Map<URI, IResqmlDataObject>()] map of existing objects URI=>object
   * @param {boolean} [includeArrayValues=false]
   * @param {boolean} [includeArrayMetadata=false]
   * @param {ArrayFormat} [arrayFormat="base64"] Format of the array values
   * @param {boolean} [includeReferences=true] Include references in the resolved objects
   * @returns {Promise<Array<IResqmlDataObject|null>>} resolved objects in order or query, null for failed queries
   * @memberof ResqmlClient
   */
  public async getResolvedObjects(
    uris: URI[],
    objects: Map<URI, IResqmlDataObject> = new Map<URI, IResqmlDataObject>(),
    includeArrayValues = false,
    includeArrayMetadata = false,
    arrayFormat: ArrayFormat = "base64",
    includeReferences = true
  ): Promise<Array<IResqmlDataObject | null>> {
    if (uris.length === 0) {
      throw new Error("Empty uris");
    }
    uris = uris.map(u => {
      const index = u.indexOf("?");
      return index === -1 ? u : u.substring(0, index);
    });
    try {
      let cURIs = uris;
      const ancestors = new Map<URI, IResqmlDataObject>();
      while (cURIs.length > 0) {
        const tUris = cURIs.filter(u => !objects.get(u));
        if (tUris.length > 0) {
          try {
            const fetched = await this.getObjects(tUris);
            const fetchedCount = fetched.filter(o => o !== null).length;
            this.logger.info(`[perf] getObjects: requested=${tUris.length}, got=${fetchedCount}`);
            fetched.forEach(
              // eslint-disable-next-line no-loop-func
              (o, i) => o && objects.set(tUris[i], o)
            );
          } catch (refErr: any) {
            // Some referenced objects may not exist — continue with what we have
            this.logger.warn(
              `Failed to fetch ${tUris.length} referenced object(s): ${refErr?.message ?? refErr}`
            );
          }
        }
        const nUris = new Set<URI>();
        cURIs.forEach(uri => {
          const o = objects.get(uri);
          if (o) {
            ancestors.set(uri, o);
            const u = new EtpUri(uri);
            this.getObjectTargets(u.dataSpace, o, nUris);
          }
        });
        cURIs = Array.from(nUris.keys()).filter(
          u => objects.get(u) === undefined
        );
      }

      const dataArrays = new Map<URI, IDataArray>(); // Map URI=>DataArray
      if (includeArrayValues || includeArrayMetadata) {
        ancestors.forEach((o, uri) => this.findDataArrays(uri, o, dataArrays));
        if (includeArrayValues) {
          await this.getArraysContent(dataArrays);
        }
        if (includeArrayMetadata) {
          // Fill dataArrays map with HDF5 metadata
          await Promise.all(
            Array.from(dataArrays.values()).map(({ uid }) =>
              this.getDataArrayMetadata(uid.uri, uid.pathInResource).then(a => {
                if (a) {
                  const aa = dataArrays.get(
                    `${a.uid.uri}${a.uid.pathInResource}`
                  );
                  dataArrays.set(`${a.uid.uri}${a.uid.pathInResource}`, {
                    logicalArrayType: a.logicalArrayType,
                    transportArrayType: a.transportArrayType,
                    dimensions: a.dimensions,
                    preferredSubarrayDimensions: a.preferredSubarrayDimensions,
                    customData: a.customData,
                    storeCreated: a.storeCreated,
                    storeLastWrite: a.storeLastWrite,
                    uid: a.uid,
                    data: aa ? aa.data : undefined
                  });
                }
              })
            )
          );
        }
      }

      const alreadyResolved = new Map<URI, IResqmlDataObject>();
      return uris.map(uri => {
        const iu = objects.get(uri);
        if (!iu) {
          return null;
        }
        const resolved = this.resolveReferences(
          uri,
          iu,
          objects,
          dataArrays,
          alreadyResolved,
          arrayFormat,
          includeReferences
        ) as IResqmlDataObject;
        objects.set(uri, resolved);
        return resolved;
      });
    } catch (e) {
      this.logger.error(e);
      return [];
    }
  }

  /**
   * Equivalent of array reduce between two indices
   *
   * @private
   * @param {number[]} dims array of number to reduce
   * @param {number} start first index of slice
   * @param {number} end last index (non included) of slice
   * @returns {number} product of all numbers between two indices
   * @memberof ResqmlClient
   */
  private reduceArraySizeDimension(
    dims: number[],
    start: number,
    end: number
  ): number {
    let res = 1;
    for (let i = start; i < end; i++) {
      res *= dims[i];
    }
    return res;
  }

  /**
   * Compute the subarray definitions allowing to fetch a large (sub)array using subArray requests
   * that do not exceed the negotiated bandwidth.
   * According to negotiated bandwidth, the resulting decomposition will either return a single
   * subarray request for the whole (sub)array or multiple a subarray requests that decompose the
   * initial (sub)array along an optimal direction.
   *
   * @param {IDataArrayMetadata} desc
   * @param {number[]} starts start index of the subarray in each dimension
   * @param {number[]} counts number of elements in each dimension
   * @returns {Energistics.Etp.v12.Datatypes.DataArrayTypes.GetDataSubarraysType[]}
   * @memberof ResqmlClient
   */
  public subarraySlicingToFitMessage(
    desc: IDataArrayMetadata,
    starts: number[],
    counts: number[]
  ): Energistics.Etp.v12.Datatypes.DataArrayTypes.GetDataSubarraysType[] {
    if (!desc?.uid.uri || !desc.uid.pathInResource || !desc.dimensions) {
      return [];
    }

    const subarraysDefinition: Energistics.Etp.v12.Datatypes.DataArrayTypes.GetDataSubarraysType[] =
      [];

    const size = ArrayCustomer.getArraySizeFromMetaData(desc, counts);

    const requestDimensions = [...counts];
    if (
      this.client.negotiatedSize &&
      size + this.overhead > this.client.negotiatedSize
    ) {
      // Identify which dimension should be used to decompose the array into parts
      let dividingDimension = 0;
      const eSize = ArrayCustomer.getElementSizeFromMetaData(desc);
      let curSize = eSize;
      for (let il = requestDimensions.length - 1; il >= 0; il--) {
        curSize *= requestDimensions[il];
        dividingDimension = il;
        if (curSize + this.overhead > this.client.negotiatedSize) {
          break;
        }
      }

      // Identify:
      // - The number of messages to send
      // - How many indices along the dividing dimension will be used in each message (including the last one)
      const sizeOfSingleIndex =
        eSize *
        this.reduceArraySizeDimension(
          requestDimensions,
          dividingDimension + 1,
          requestDimensions.length
        );
      const nbIndicesInMessage = Math.floor(
        (this.client.negotiatedSize - this.overhead) / sizeOfSingleIndex
      );
      const nbMessages = Math.ceil(
        requestDimensions[dividingDimension] / nbIndicesInMessage
      );
      let nbIndicesInLastMessage =
        requestDimensions[dividingDimension] % nbIndicesInMessage;
      if (nbIndicesInLastMessage === 0) {
        nbIndicesInLastMessage = nbIndicesInMessage;
      }

      // Compute the maximum length of an array in message to help compute offset
      const sliceCounts: number[] = [...requestDimensions];
      for (let e = 0; e < dividingDimension; e++) {
        sliceCounts[e] = 1;
      }
      sliceCounts[dividingDimension] = nbIndicesInMessage;

      // Get the number of loops to perform outside the dividing dimensions
      const nbExternalLoop = this.reduceArraySizeDimension(
        requestDimensions,
        0,
        dividingDimension
      );

      const sliceStarts: number[] = [...starts];

      for (let e = 0; e < nbExternalLoop; e++) {
        // Compute starts for each dimension of external loop
        let externalIndices = e;
        for (let il = 0; il < dividingDimension; il++) {
          const lp = this.reduceArraySizeDimension(
            requestDimensions,
            il + 1,
            dividingDimension
          );
          sliceStarts[il] = externalIndices / lp;
          externalIndices = externalIndices % lp;
        }

        // Create each message by decomposing along the dividing dimension
        for (let d = 0; d < nbMessages; d++) {
          sliceStarts[dividingDimension] =
            starts[dividingDimension] + d * nbIndicesInMessage;
          sliceCounts[dividingDimension] =
            d === nbMessages - 1 ? nbIndicesInLastMessage : nbIndicesInMessage;

          subarraysDefinition.push({
            counts: sliceCounts.map(BigInt),
            starts: sliceStarts.map(BigInt),
            uid: desc.uid
          });
        }
      }
    } else {
      // Everything in one
      subarraysDefinition.push({
        counts: counts.map(BigInt),
        starts: starts.map(BigInt),
        uid: desc.uid
      });
    }
    return subarraysDefinition;
  }

  /**
   * From the data array store get the array corresponding to the given metadata.
   * The array is obtained subarray by subarray. Each subarray correspond to one value along
   * the slowest axis.
   *
   * @param {IDataArrayMetadata} desc description of the array
   * @returns {Promise<DataArray|null>} data array corresponding to uri
   * @memberof ResqmlClient
   */
  public async getDataArrayBySlices(
    desc: IDataArrayMetadata
  ): Promise<IDataArray | null> {
    if (!desc.dimensions) {
      return null;
    }

    try {
      const subarrays: Energistics.Etp.v12.Datatypes.AnyArray[] = [];
      const subarraysDefinition = this.subarraySlicingToFitMessage(
        desc,
        desc.dimensions.map(() => 0),
        desc.dimensions
      );
      while (subarraysDefinition.length > 0) {
        const sp = subarraysDefinition
          .splice(0, this.messageQueueDepth())
          .map(a => this.dataArray.getSubarrays([a]));
        // Limit concurrent requests to what server can handle
        (await Promise.all(sp))
          .filter(ArrayCustomer.subArrayNotEmpty)
          .map(
            a =>
              a[0]
                .data as Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArray
          )
          .filter(a => a !== null)
          .map(a => a.data)
          .filter(a => a !== null)
          .forEach(a => subarrays.push(a));
      }
      if (subarrays.length === 0) {
        return null;
      }

      const keyName = subarrays[0].item.__keyName;

      let values: any[] = [];
      for (const subarray of subarrays) {
        const temp = subarray.item;
        // Extract the values from the AnyArray (using the first property of the array)
        // and concatenate to the large array of values
        values = values.concat(temp[keyName]?.values);
      }
      // Build a new large array based on the type parameters of the first subarray
      // and the large array of values and dimensions
      const s = subarrays[0];
      const nData: Energistics.Etp.v12.Datatypes.AnyArray = {
        // Note: use of Object.assign is intentional, as the spread operator can use huge
        // amounts of memory for large arrays.
        item: Object.assign({}, s.item)
      };
      if (nData.item.__keyName && nData.item.__keyName !== "_bytes") {
        nData.item[nData.item.__keyName] = { values };
      }
      return {
        data: { data: nData, dimensions: desc.dimensions.map(BigInt) },
        uid: desc.uid
      };
    } catch (err) {
      this.logger.error("getDataArrayBySubarray", err);
      return null;
    }
  }

  /**
   * From the data array store get the array corresponding to the given metadata.
   * The array is obtained subarray by subarray. Each subarray correspond to one value along
   * the slowest axis.
   *
   * @param {IDataArrayMetadata} desc description of the array
   * @param {number[]} starts start index of the subarray in each dimension
   * @param {number[]} counts number of elements in each dimension
   * @returns {Promise<DataArray|null>} data array corresponding to uri
   * @memberof ResqmlClient
   */
  public async getSubDataArrayBySlices(
    desc: IDataArrayMetadata,
    starts: number[],
    counts: number[]
  ): Promise<IDataSubarray | null> {
    try {
      if (!desc.dimensions || !desc.uid.uri || !desc.uid.pathInResource) {
        return null;
      }
      const subarrays: Energistics.Etp.v12.Datatypes.AnyArray[] = [];
      const subarraysDefinition = this.subarraySlicingToFitMessage(
        desc,
        starts,
        counts
      );
      while (subarraysDefinition.length > 0) {
        const sp = subarraysDefinition
          .splice(0, this.messageQueueDepth())
          .map(a => this.dataArray.getSubarrays([a]));
        // Limit concurrent requests to what server can handle
        (await Promise.all(sp))
          .filter(ArrayCustomer.subArrayNotEmpty)
          .map(
            a =>
              a[0]
                .data as Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArray
          )
          .filter(a => a !== null)
          .map(a => a.data)
          .filter(a => a !== null)
          .forEach(a => subarrays.push(a));
      }
      if (subarrays.length === 0) {
        return null;
      }

      const keyName = subarrays[0].item.__keyName;

      let values: any[] = [];
      for (const subarray of subarrays) {
        const temp = subarray.item;
        // Extract the values from the AnyArray (using the first property of the array)
        // and concatenate to the large array of values
        values = values.concat(temp[keyName]?.values);
      }
      // Build a new large array based on the type parameters of the first subarray
      // and the large array of values and dimensions
      const s = subarrays[0];
      const nData: Energistics.Etp.v12.Datatypes.AnyArray = {
        // Note: use of Object.assign is intentional, as the spread operator can use huge
        // amounts of memory for large arrays.
        item: Object.assign({}, s.item)
      };
      if (nData.item.__keyName && nData.item.__keyName !== "_bytes") {
        nData.item[nData.item.__keyName] = { values };
      }
      return {
        data: { data: nData, dimensions: desc.dimensions.map(BigInt) },
        starts,
        counts,
        uid: desc.uid
      };
    } catch (err) {
      this.logger.error("getSubDataArrayBySubarray", err);
      return null;
    }
  }

  /**
   * Get the EpcExternalPartReference URI from object URI and path
   * If Object is EpcExternalPartReference return the same URI,
   * but if object is a domain object return the EpcExternalPartReference it reference for this array
   *
   * @private
   * @param {URI} uri of EpcExternalPartReference or containing domain object
   * @param {string} pathInResource Array path
   * @returns {Promise<IArrayId>}
   * @memberof ResqmlClient
   */
  private async getArrayId(
    uri: URI,
    pathInResource: string
  ): Promise<IArrayId> {
    const index = uri.indexOf("?");
    uri = index === -1 ? uri : uri.substring(0, index);
    if (uri.indexOf("EpcExternalPartReference") !== -1) {
      return { uri, pathInResource };
    }
    return this.getObjects([uri]).then(dob => {
      if (dob.length === 0 || dob[0] === null) {
        return { uri, pathInResource };
      }
      const arrays = new Map<string, IDataArray>();
      this.findDataArrays(uri, dob[0], arrays);
      for (const a of arrays.values()) {
        if (a.uid.pathInResource === pathInResource) {
          return { uri: a.uid.uri, pathInResource };
        }
      }
      return { uri, pathInResource };
    });
  }

  /**
   * Return the metadata associated with array
   *
   * @param {URI} uri
   * @param {string} pathInResource
   * @returns {Promise<IDataArrayMetadata>}
   * @memberof ResqmlClient
   */
  public async getDataArrayMetadata(
    uri: URI,
    pathInResource: string
  ): Promise<IDataArrayMetadata | null> {
    return this.getArrayId(uri, pathInResource).then(id =>
      this.dataArray
        .describe([id])
        .then(desc =>
          desc.length !== 1 || !desc[0] || !desc[0].dimensions ? null : desc[0]
        )
    );
  }

  /**
   * Get the information about multiple data arrays
   *
   * @param {IArrayId[]} dataArrays
   * @returns {(Promise<Array<IDataArrayMetadata | null>>)}
   * @memberof ResqmlClient
   */
  public getArrayDescription(
    dataArrays: IArrayId[]
  ): Promise<Array<IDataArrayMetadata | null>> {
    return this.dataArray.describe(dataArrays);
  }

  /**
   * Fetch an array using subarrays and visit its values by applying a visitor function on each of them.
   * The main use is for large arrays.
   * This will create an optimum number of GetSubArrays requests by filling the negotiated bandwidth
   * with an optimized subarray size.
   * Using the visitor avoid creating the large consolidated array when memory is limited.
   * Can either visit the whole array or a subarray defined by a start and count in the slowest (0) axis.
   * This would allow for example to visit a limited number of layers in a 3D array.
   *
   * @param {IArrayId} dataArray description of the data array to fetch
   * @param {(value: number[] | boolean[]) => any} visitor function to apply on every values
   * @param {number} [slowStart] Define an optional start index for the slowest axis [0], when undefined visit the entire array
   * @param {number} [slowCount] Define an optional number of indices for the slowest axis [0], when undefined visit the entire array from slowStart
   * @returns
   * @memberof ResqmlClient
   */
  public async visitDataArrayValues(
    dataArray: IArrayId,
    visitor: (
      values: number[] | boolean[] | Integer64[],
      da: IDataSubarray
    ) => any,
    slowStart?: number,
    slowCount?: number
  ): Promise<void> {
    try {
      const metaData = await this.getArrayDescription([dataArray]);
      if (!metaData?.[0] || !metaData[0].dimensions) {
        throw new Error(
          `Cannot get metadata of ${dataArray.uri}/${dataArray.pathInResource}`
        );
      }

      const starts = metaData[0].dimensions.map(() => 0);
      if (slowStart !== undefined && slowStart < metaData[0].dimensions[0]) {
        starts[0] = slowStart;
      }

      const counts = [...metaData[0].dimensions];
      if (slowCount) {
        counts[0] =
          slowCount + starts[0] > counts[0] ? counts[0] - starts[0] : slowCount;
      }

      const subarraysDefinition = this.subarraySlicingToFitMessage(
        metaData[0],
        starts,
        counts
      );
      for (const a of subarraysDefinition) {
        const subArray = await this.dataArray.getSubarrays([a]);
        if (subArray?.[0]) {
          this.visitSubArray(subArray[0], visitor);
        }
      }
    } catch (err) {
      const errMessage = `Cannot get metadata of ${dataArray.uri}/${dataArray.pathInResource}`;
      this.logger.error(errMessage);
      throw new Error(errMessage);
    }
  }

  /**
   * From the data array store get the array corresponding to the given URI
   *
   * @param {URI} uri of the object containing the array
   * @param {string} pathInResource identifier of the array
   * @returns {Promise<DataArray|null>} data array corresponding to uri, null if failure
   * @memberof ResqmlClient
   */
  public async getDataArray(
    uri: URI,
    pathInResource: string,
    metaData?: IDataArrayMetadata
  ): Promise<IDataArray | null> {
    if (!this.dataArray) {
      return null;
    }

    return this.getArrayId(uri, pathInResource).then(async id => {
      if (!metaData) {
        try {
          const m = await this.dataArray.describe([id]);
          if (m[0]) {
            metaData = m[0];
          }
        } catch (e) {
          // Keep metadata unknown
        }
      }
      if (metaData?.dimensions) {
        const size = ArrayCustomer.getArraySizeFromMetaData(metaData);
        if (
          this.client.negotiatedSize &&
          size + this.overhead > this.client.negotiatedSize
        ) {
          return this.getDataArrayBySlices(metaData);
        }
      }
      return this.dataArray.get([id]).then(a => (a.length === 1 ? a[0] : null));
    });
  }

  /**
   * Transfer a data array to the server
   *
   * @param {IArrayId} uid Array identifier
   * @param {number[]} dimensions Dimensions along each direction
   * @param {AnyTypedArray} array Array content
   * @param {number[]} [preferredSubArrayDimensions=[]] Preferred slab size
   * @param {Map<string, DataValue>} [customData=new Map()] Additional attributes to store
   * @returns {Promise<boolean>}
   * @memberof ResqmlClient
   */
  public async putDataArray(
    uid: IArrayId,
    dimensions: number[],
    array: AnyTypedArray,
    preferredSubArrayDimensions: number[] = [],
    customData: Map<string, DataValue> = new Map()
  ): Promise<boolean> {
    const size = ArrayCustomer.getArraySize(array);
    const transportType: Energistics.Etp.v12.Datatypes.AnyArrayType =
      ArrayCustomer.getTransportArrayType(array);
    const logicalType: Energistics.Etp.v12.Datatypes.AnyLogicalArrayType =
      ArrayCustomer.getLogicalArrayType(array);

    // If small array or array size is below negotiated => send entire array
    if (
      this.client.negotiatedSize &&
      size + this.overhead < this.client.negotiatedSize
    ) {
      const data = ArrayCustomer.createDataFromValues(
        array,
        Array.prototype.slice.call(array)
      );
      const da: Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataArraysType =
      {
        array: {
          data,
          dimensions: dimensions.map(BigInt)
        },
        uid,
        customData
      };
      return this.dataArray.put([da]).then(e => {
        // If no error info returned, assume success
        if (e.length === 0) {
          return true;
        }

        // Check for any errors
        const errors = e.filter(error => error.code !== 0);
        if (errors.length > 0) {
          // Throw the first error found
          throw new EtpError(errors[0].message, errors[0].code);
        }

        // All operations succeeded
        return true;
      });
    }
    if (!transportType) {
      return Promise.reject(
        new EtpError(`Invalid array type`, ErrorCode.EINVALID_ARGUMENT)
      );
    }

    const { nbParts, nbSliceInPart, nbSliceExtraPart } =
      this.initPartsAndSlices(dimensions[0], size);

    const promises: Array<Promise<boolean>> = this.initDataArrayPromises(
      logicalType,
      transportType,
      dimensions,
      preferredSubArrayDimensions ?? [],
      customData,
      uid
    );

    const { starts, counts, maxSliceLength } = this.initStartsAndCounts(
      dimensions,
      nbSliceInPart
    );
    for (let d = 0; d < nbParts; d++) {
      starts[0] = d * nbSliceInPart;
      counts[0] =
        d === nbParts - 1 && nbSliceExtraPart > 0
          ? nbSliceExtraPart
          : nbSliceInPart;
      const sliceLength = counts.reduce((p, c) => p * c, 1);
      const values: number[] = Array.from({
        length: sliceLength
      });
      const start = d * maxSliceLength;
      for (let i = 0; i < sliceLength; i++) {
        values[i] = array[start + i] as number;
      }

      promises.push(
        this.dataArray.sendSubArray(
          uid,
          [...starts],
          [...counts],
          array,
          values
        )
      );
    }
    return Promise.all(promises).then(b => b.reduce((p, c) => p && c, true));
  }

  /**
   * Transfer am HDF5 data array to the server
   *
   * @param {array} IHDF5ArrayInput HDF5 Array data
   * @returns {Promise<boolean>} Put success
   * @memberof ResqmlClient
   */
  public async putHdf5DataArray(array: IHDF5ArrayInput): Promise<boolean> {
    const dimensions: number[] =
      ArrayCustomer.computeDataArrayDimensions(array);
    return this.putDataArray(
      array.uid,
      dimensions,
      array.data,
      array.preferredSubArrayDimensions ?? [],
      array.customData
    );
  }

  /**
   * Send the content of a subarray to the server,
   * Warning: The subarray is sent as is independently of the size limits
   *
   * @param {IArrayId} uid
   * @param {number[]} starts
   * @param {number[]} counts
   * @param {AnyTypedArray} array
   * @returns {Promise<boolean>}
   * @memberof ResqmlClient
   */
  public putDataSubArray(
    uid: IArrayId,
    starts: number[],
    counts: number[],
    array: AnyTypedArray
  ): Promise<boolean> {
    if (typeof array === "string") {
      return Promise.resolve(false);
    }
    if (array instanceof BigInt64Array || array instanceof BigUint64Array) {
      // Separate call for bigint vs number so Array.from is not confused
      return this.dataArray.sendSubArray(
        uid,
        starts,
        counts,
        array,
        Array.from(array)
      );
    }
    return this.dataArray.sendSubArray(
      uid,
      starts,
      counts,
      array,
      Array.from(array)
    );
  }

  /**
   * Create an empty data array on the server
   *
   * @param {IArrayId} uid Array identifier
   * @param {AnyTypedArray} array Array content
   * @param {number[]} dimensions Dimensions along each direction
   * @param {number[]} [preferredSubArrayDimensions=[]] Preferred slab size
   * @returns {Promise<boolean>}
   * @memberof ResqmlClient
   */
  public async putEmptyDataArray(
    uid: IArrayId,
    array: AnyTypedArray,
    dimensions: number[],
    preferredSubArrayDimensions: number[] = [],
    customData: Map<string, DataValue> = new Map()
  ): Promise<boolean> {
    const transportArrayType: Energistics.Etp.v12.Datatypes.AnyArrayType =
      ArrayCustomer.getTransportArrayType(array);
    const logicalArrayType: Energistics.Etp.v12.Datatypes.AnyLogicalArrayType =
      ArrayCustomer.getLogicalArrayType(array);
    const metadata: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayMetadata =
    {
      dimensions: dimensions.map(BigInt),
      preferredSubarrayDimensions: preferredSubArrayDimensions.map(BigInt),
      customData,
      transportArrayType,
      logicalArrayType,
      storeCreated: BigInt(Date.now()),
      storeLastWrite: BigInt(Date.now())
    };
    return this.dataArray
      .putUninitializedArray([
        {
          uid,
          metadata
        }
      ])
      .then(err => {
        // If no error info returned, assume success
        if (!err || err.length === 0) {
          return true;
        }

        // Check for any errors
        const errors = err.filter(error => error.code !== ErrorCode.IS_OK);
        if (errors.length > 0) {
          // Throw the first error found
          throw new EtpError(errors[0].message, errors[0].code);
        }

        // All operations succeeded
        return true;
      });
  }

  private initPartsAndSlices(dimension: number, size: number) {
    let nbParts = dimension;
    let nbSliceInPart = 1;
    let nbSliceExtraPart = 0;
    if (this.client.negotiatedSize) {
      const sliceSize = size / dimension;
      nbSliceInPart = Math.floor(
        (this.client.negotiatedSize - this.overhead) / sliceSize
      );
      nbParts = Math.ceil(dimension / nbSliceInPart);
      nbSliceExtraPart = dimension % nbSliceInPart;
    }
    return { nbParts, nbSliceInPart, nbSliceExtraPart };
  }

  private initDataArrayPromises(
    logicalArrayType: Energistics.Etp.v12.Datatypes.AnyLogicalArrayType,
    transportArrayType: Energistics.Etp.v12.Datatypes.AnyArrayType,
    dimensions: number[],
    preferredSubarrayDimensions: number[],
    customData: Map<string, DataValue>,
    uid: Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArrayIdentifier
  ) {
    const promises: Array<Promise<boolean>> = [];
    const di: Energistics.Etp.v12.Datatypes.DataArrayTypes.PutUninitializedDataArrayType =
    {
      metadata: {
        logicalArrayType,
        transportArrayType,
        dimensions: dimensions.map(BigInt),
        preferredSubarrayDimensions: preferredSubarrayDimensions.map(BigInt),
        customData,
        storeCreated: BigInt(Date.now()),
        storeLastWrite: BigInt(Date.now())
      },
      uid
    };
    promises.push(
      this.dataArray
        .putUninitializedArray([di])
        .then(b => b.map(e => e.code === ErrorCode.IS_OK))
        .then(b => b.reduce((p, c) => p && c, true))
    );
    return promises;
  }

  private initStartsAndCounts(dimensions: number[], nbSliceInPart: number) {
    const starts: number[] = Array.from<number>({
      length: dimensions.length
    }).fill(0);
    const counts = [...dimensions];
    counts[0] = nbSliceInPart;
    const maxSliceLength = counts.reduce((p, c) => p * c, 1);
    return { starts, counts, maxSliceLength };
  }

  /**
   * In case of small array send the array using a sinle message
   * @param {Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataArraysType} array
   * @returns {Promise<boolean>} Put success
   * @memberof ResqmlClient
   */
  private async putArrayInOneMessage(
    array: Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataArraysType
  ): Promise<boolean> {
    try {
      const e = await this.dataArray.put([array]);

      // If no error info returned, assume success
      if (e.length === 0) {
        return true;
      }

      // Check for any errors
      const errors = e.filter(error => error.code !== 0);
      if (errors.length > 0) {
        // Throw the first error found
        throw new EtpError(errors[0].message, errors[0].code);
      }

      // All operations succeeded
      return true;
    } catch (err) {
      if (err instanceof Error) {
        return Promise.reject(
          new EtpError(err.message, ErrorCode.EINVALID_STATE)
        );
      } else if (typeof err === "string") {
        return Promise.reject(new EtpError(err, ErrorCode.EINVALID_STATE));
      } else {
        return Promise.reject(
          new EtpError("Unknown error", ErrorCode.EINVALID_STATE)
        );
      }
    }
  }

  /**
   * Transfer an array to the server
   *
   * @param {Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataArraysType} array
   * @returns {Promise<boolean>} Put success
   * @memberof ResqmlClient
   */
  public async putUsingPutDataArraysType(
    array: Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataArraysType
  ): Promise<boolean> {
    const dimensions: number[] = array.array.dimensions.map(Number);

    const arrayInfo = this.dataArray.getArrayInfo(array.array);
    const logicalArrayType = arrayInfo.logicalType;
    const transportArrayType = arrayInfo.transportType;
    const size = arrayInfo.size;

    // If small array or array size is below negotiated => send entire array
    if (
      this.client.negotiatedSize &&
      size + this.overhead < this.client.negotiatedSize
    ) {
      return this.putArrayInOneMessage(array);
    }
    if (!logicalArrayType || !transportArrayType) {
      return Promise.reject(
        new EtpError("Invalid array type", ErrorCode.EINVALID_ARGUMENT)
      );
    }

    const { nbParts, nbSliceInPart, nbSliceExtraPart } =
      this.initPartsAndSlices(dimensions[0], size);

    const preferredSubarrayDimensions: number[] = [];

    const promises: Array<Promise<boolean>> = this.initDataArrayPromises(
      logicalArrayType,
      transportArrayType,
      dimensions,
      preferredSubarrayDimensions,
      array.customData,
      array.uid
    );

    const { starts, counts, maxSliceLength } = this.initStartsAndCounts(
      dimensions,
      nbSliceInPart
    );
    for (let d = 0; d < nbParts; d++) {
      starts[0] = d * nbSliceInPart;
      counts[0] =
        d === nbParts - 1 && nbSliceExtraPart > 0
          ? nbSliceExtraPart
          : nbSliceInPart;
      const sliceLength = counts.reduce((p, c) => p * c, 1);
      const start = d * maxSliceLength;

      const da: Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataSubarraysType =
      {
        counts: counts.map(BigInt),
        data: this.dataArray.getArraySlice(
          array.array,
          start,
          start + sliceLength
        ),
        starts: starts.map(BigInt),
        uid: array.uid
      };
      promises.push(
        retry(() =>
          this.dataArray
            .putSubarrays([da])
            .then(b => b.map(e => e.code === ErrorCode.IS_OK))
            .then(b => b.reduce((p, c) => p && c, true))
        )
      );
    }
    return Promise.all(promises).then(results =>
      results.reduce((previous, current) => previous && current, true)
    );
  }

  /**
   * Transfer data arrays to the server, without checking for message size
   *
   * @param {IHDF5ArrayInput[]} arrays
   * @returns {Promise<boolean>}
   * @memberof ResqmlClient
   */
  public async putHdf5DataArraysUnsafe(
    arrays: IHDF5ArrayInput[]
  ): Promise<boolean> {
    const das: Energistics.Etp.v12.Datatypes.DataArrayTypes.PutDataArraysType[] =
      arrays.map(a => ({
        array: {
          data: ArrayCustomer.createDataFromValues(
            a.data,
            Array.prototype.slice.call(a.data)
          ),
          dimensions: ArrayCustomer.computeDataArrayDimensions(a).map(BigInt)
        },
        customData: a.customData,
        uid: a.uid
      }));
    return retry(() => this.dataArray.put(das).then(e => {
      // If no error info returned, assume success
      if (e.length === 0) {
        return true;
      }

      // Check for any errors
      const errors = e.filter(error => error.code !== 0);
      if (errors.length > 0) {
        // Throw the first error found
        throw new EtpError(errors[0].message, errors[0].code);
      }

      // All operations succeeded
      return true;
    }));
  }

  /**
   * From the data array store get the array subarray corresponding to the given URI and index range.
   * Index range is expressed a starting index and count for each dimension.
   *
   * @param {URI} uri of the object containing the array
   * @param {string} pathInResource identifier of the array
   * @param {number[]} starts beginning index for each direction
   * @param {number[]} counts number of elements for each direction
   * @param {boolean} safe if true, use subarray slicing to fit message size
   * @returns {Promise<DataArray|null>} resulting array or null if failure
   * @memberof ResqmlClient
   */
  public async getDataSubarray(
    uri: URI,
    pathInResource: string,
    starts: number[],
    counts: number[],
    safe: boolean = true
  ): Promise<IDataSubarray | null> {
    return this.getArrayId(uri, pathInResource).then(async uid => {
      if (safe) {
        const metaData = await this.getDataArrayMetadata(
          uid.uri,
          uid.pathInResource
        );
        if (!metaData) {
          return null;
        }
        const size = ArrayCustomer.getArraySizeFromMetaData(metaData);
        if (
          this.client.negotiatedSize &&
          size + this.overhead > this.client.negotiatedSize
        ) {
          return this.getSubDataArrayBySlices(metaData, starts, counts);
        }
      }
      return this.dataArray
        .getSubarrays([
          {
            uid,
            starts: starts.map(BigInt),
            counts: counts.map(BigInt)
          }
        ])
        .then(subarrays => (subarrays.length === 1 ? subarrays[0] : null));
    });
  }

  /**
   * Get the resources contained by a given project
   *
   * @param {URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo} dataSpaceContext uri of dataspace
   * @param {string[]} dataObjectTypes object types to filter against
   * @param {boolean} [countObjects=false] Indicates that the server is requested to provide the source and target count
   * @param {(Integer64 | null)} [lastChangedFilter=null] Indicates that the only the resources created after the given time is provided
   * @returns {Promise<Resource>} resource map for the data space
   * @memberof ResqmlClient
   */
  public async getDataspaceResources(
    dataSpaceContext: URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    dataObjectTypes: string[] = [],
    countObjects = false,
    lastChangedFilter: Integer64 | null = null,
    objects?: Map<URI, IResqmlDataObject>
  ): Promise<Resource[]> {
    return this.getResources(
      dataSpaceContext,
      Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.self,
      dataObjectTypes,
      countObjects,
      lastChangedFilter,
      null,
      objects
    );
  }

  /**
   * Get the resources graph of a given dataspace
   *
   * @param {URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo} dataSpaceContext uri of dataspace
   * @param {string[]} dataObjectTypes object types to filter against
   * @param {(Integer64 | null)} [lastChangedFilter=null] Indicates that the only the resources created after the given time is provided
   * @param {Map<URI, IResqmlDataObject>} [objects] Map of objects to be used for resolving relationships
   * @returns {Promise<ResourceGraph>} resource map for the data space
   * @memberof ResqmlClient
   */
  public async getDataspaceGraph(
    dataSpaceContext: URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    countObjects = false,
    dataObjectTypes: string[] = [],
    lastChangedFilter: Integer64 | null = null,
    objects?: Map<URI, IResqmlDataObject>
  ): Promise<ResourceGraph> {
    return this.getGraph(
      dataSpaceContext,
      Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.self,
      countObjects,
      dataObjectTypes,
      lastChangedFilter,
      null,
      objects
    );
  }

  /**
   * Get the resources contained by a given project
   * @deprecated Use {@link getDataspaceResources} function instead.
   *
   * @param {URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo} dataSpaceContext uri of project
   * @param {string[]} dataObjectTypes object types to filter against
   * @param {boolean} [countObjects=false] Indicates that the server is requested to provide the source and target count
   * @param {(Integer64 | null)} [lastChangedFilter=null] Indicates that the only the resources created after the given time is provided
   * @returns {Promise<Resource>} resource map for the data space
   * @memberof ResqmlClient
   */
  public async getProjectResources(
    dataSpaceContext: URI | Energistics.Etp.v12.Datatypes.Object.ContextInfo,
    dataObjectTypes: string[] = [],
    countObjects = false,
    lastChangedFilter: Integer64 | null = null,
    objects?: Map<URI, IResqmlDataObject>
  ): Promise<Resource[]> {
    return this.getDataspaceResources(
      dataSpaceContext,
      dataObjectTypes,
      countObjects,
      lastChangedFilter,
      objects
    );
  }

  /**
   * Find a resource from its uri
   *
   * @param {URI} uri
   * @returns {(Promise<Resource | null>)}
   * @memberof ResqmlClient
   */
  public async findResource(uri: URI): Promise<Resource | null> {
    const etpUri = new EtpUri(uri);
    if (!etpUri.uuid) {
      return null;
    }
    const context = {
      dataObjectTypes: [],
      depth: 1,
      includeSecondarySources: false,
      includeSecondaryTargets: false,
      navigableEdges:
        Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Both,
      uri: etpUri.uriPath
    };
    return this.discovery
      .getResources(
        context,
        Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.self
      )
      .then((resourcesObjects: Resource[]) => {
        const results = resourcesObjects.filter(r => r.uri === uri);
        return results.length === 1 ? results[0] : null;
      });
  }

  /**
   * Create a search map to allow searching inside XML
   *
   * @param {URI[]} uris
   * @param {boolean} deepSearch Whether or not to resolve the objects given by uris
   * @param {Map<URI, IResqmlDataObject>} objects The initial search map to use. Defaults to empty map
   * @returns {Promise<Map<URI, IResqmlDataObject>>}
   * @memberof ResqmlClient
   */
  public async buildSearchMap(
    uris: URI[],
    deepSearch: boolean,
    objects: Map<URI, IResqmlDataObject> = new Map<URI, IResqmlDataObject>()
  ): Promise<Map<URI, IResqmlDataObject>> {
    uris = uris
      .map(u => {
        const index = u.indexOf("?");
        return index === -1 ? u : u.substring(0, index);
      })
      .filter(u => !objects.get(u));
    const chunk = 100;
    for (let c = 0; c < uris.length; c += chunk) {
      const temp = uris.slice(c, c + chunk);
      (await this.getObjects(temp)).forEach(
        (v, i) => v && objects.set(temp[i], v)
      );
    }

    if (deepSearch) {
      try {
        await this.getResolvedObjects(
          uris,
          objects,
          false,
          false,
          "json",
          true
        );
      } catch (e) {
        // Do Nothing
      }
    }
    return objects;
  }

  /**
   * Filter a list of resources, following given queries
   * @param {Resource[]} resources list of resources to filter
   * @param {string[]} filters list of oData filters to apply to the resources
   * @param {Map<URI, IResqmlDataObject>} objects The initial search map to use. Defaults to empty map
   * @returns {Promise<Resource[]>}
   * @memberof ResqmlClient
   */
  public async filterResources(
    resources: Resource[],
    filters: string[],
    objects: Map<URI, IResqmlDataObject> = new Map<URI, IResqmlDataObject>()
  ): Promise<Resource[]> {
    let deepSearch = false;
    filters.forEach((f: any) => {
      if (typeof f === "string" && f.indexOf("_data") !== -1) {
        deepSearch = true;
      }
    });

    const queries = createODataQueries(filters);
    return queries.length === 0
      ? resources
      : this.buildSearchMap(
        resources.map(r => r.uri),
        deepSearch,
        objects
      ).then(map => resources.filter(r => queryFilter(map, queries, r.uri)));
  }

  /**
   * Get the data arrays an object is referencing
   * Add the result in DataArray map
   *
   * @param {URI} uri of object
   * @param {Map<string, IDataArray>} dataArrays map of found data arrays
   * @memberof ResqmlClient
   */
  public async getObjectDataArrays(
    uri: URI,
    dataArrays: Map<string, IDataArray>
  ): Promise<void> {
    return this.getObjects([uri]).then(o => {
      if (o.length > 0 && o[0] !== null) {
        this.findDataArrays(uri, o[0], dataArrays);
      }
    });
  }

  /**
   * Analyze a JS object coming from XML, in order to identify the data arrays it is referencing
   * Add the URI of the data array as a property of data_arrays
   *
   * @param {URI} uri of object
   * @param {Record<string, any>} obj object containing the data array
   * @param {Map<string, IDataArray>} dataArrays map of found data arrays
   * @memberof ResqmlClient
   */
  public findDataArrays(
    uri: URI,
    obj: Record<string, any>,
    dataArrays: Map<string, IDataArray>
  ): void {
    const etpUri = new EtpUri(uri);

    if (obj.$type && obj.$type.lastIndexOf("Hdf5Dataset") !== -1) {
      let contentType = "obj_EpcExternalPartReference";
      if (obj.HdfProxy?.ContentType) {
        contentType = obj.HdfProxy.ContentType.substring(
          obj.HdfProxy.ContentType.indexOf("type=") + 5
        );
      }

      const nURI = EtpUri.createObjectUri(
        etpUri.dataSpace,
        "eml",
        "20",
        contentType,
        obj.HdfProxy.UUID,
        obj.HdfProxy.Version
      ).uriPath;
      dataArrays.set(nURI + obj.PathInHdfFile, {
        uid: {
          pathInResource: obj.PathInHdfFile,
          uri: nURI
        }
      });
    } else if (obj.$type && obj.$type === "eml23.ExternalDataArrayPart") {
      dataArrays.set(uri + obj.PathInExternalFile, {
        uid: {
          pathInResource: obj.PathInExternalFile,
          uri
        }
      });
    } else {
      // ─── WITSML channel array discovery ──────────────────────────────
      // For WITSML objects (ChannelSet, Log), detect Channel/LogCurveInfo
      // and synthesize array IDs using path /WITSML/{uuid}/{mnemonic}
      const uuid = etpUri.uuid;
      if (uuid) {
        // WITSML 2.1: <Index><Mnemonic>MD</Mnemonic>...</Index>
        if (obj.Index) {
          const indices = Array.isArray(obj.Index) ? obj.Index : [obj.Index];
          for (const idx of indices) {
            if (idx?.Mnemonic) {
              const path = `/WITSML/${uuid}/${idx.Mnemonic}`;
              dataArrays.set(uri + path, {
                uid: { pathInResource: path, uri: etpUri.uriPath }
              });
            }
          }
        }
        // WITSML 2.1: <Channel><Mnemonic>GR</Mnemonic>...</Channel>
        if (obj.Channel) {
          const channels = Array.isArray(obj.Channel)
            ? obj.Channel
            : [obj.Channel];
          for (const ch of channels) {
            if (ch?.Mnemonic) {
              const path = `/WITSML/${uuid}/${ch.Mnemonic}`;
              dataArrays.set(uri + path, {
                uid: { pathInResource: path, uri: etpUri.uriPath }
              });
            }
          }
        }
        // WITSML 1.4.1: <logCurveInfo><mnemonic>GR</mnemonic>...</logCurveInfo>
        if (obj.LogCurveInfo || obj.logCurveInfo) {
          const curves = Array.isArray(obj.LogCurveInfo ?? obj.logCurveInfo)
            ? (obj.LogCurveInfo ?? obj.logCurveInfo)
            : [obj.LogCurveInfo ?? obj.logCurveInfo];
          for (const curve of curves) {
            const mnem = curve?.Mnemonic ?? curve?.mnemonic;
            if (mnem) {
              const path = `/WITSML/${uuid}/${mnem}`;
              dataArrays.set(uri + path, {
                uid: { pathInResource: path, uri: etpUri.uriPath }
              });
            }
          }
        }
        // WITSML 1.4.1 Trajectory: <trajectoryStation><md>/<incl>/<azi>
        if (obj.trajectoryStation || obj.TrajectoryStation) {
          const stations = Array.isArray(
            obj.trajectoryStation ?? obj.TrajectoryStation
          )
            ? (obj.trajectoryStation ?? obj.TrajectoryStation)
            : [obj.trajectoryStation ?? obj.TrajectoryStation];
          if (stations.length > 0) {
            for (const mnem of ["MD", "Inclination", "Azimuth"]) {
              const path = `/WITSML/${uuid}/${mnem}`;
              dataArrays.set(uri + path, {
                uid: { pathInResource: path, uri: etpUri.uriPath }
              });
            }
          }
        }
      }
      // ─── End WITSML channel discovery ────────────────────────────────

      for (const key of Object.keys(obj)) {
        if (Array.isArray(obj[key])) {
          for (const e of obj[key]) {
            this.findDataArrays(etpUri.uriPath, e, dataArrays);
          }
        } else if (obj[key] && typeof obj[key] === "object") {
          if (
            obj[key].$type &&
            obj[key].$type.lastIndexOf("DataObjectReference") === -1 &&
            typeof obj[key] === "object"
          ) {
            this.findDataArrays(etpUri.uriPath, obj[key], dataArrays);
          }
        }
      }
    }
  }

  /**
   * Set the traceability of the calls
   *
   * @param {boolean} trace activate traceability of the calls
   * @memberof ResqmlClient
   */
  public setCallsTraceability(trace: boolean): void {
    this.client.traceCalls = trace;
  }

  /**
   * Get the objects of specific types inside a dataspace
   *
   * @param {string} dataspaceId id of the dataspace
   * @param {string[]} objectTypes list of object types
   * @returns {Promise<IResqmlDataObject[]>}
   * @memberof ResqmlClient
   */
  public getObjectsFromTypes = async (
    dataspaceId: string,
    objectTypes: string[]
  ): Promise<IResqmlDataObject[]> => {
    const uri = EtpUri.createDataSpaceUri(dataspaceId);
    const resources = await this.getDataspaceResources(uri.uri, objectTypes);
    const objs = await this.getObjects(resources.map(r => r.uri));
    return objs.filter(o => o !== null).map(o => o as IResqmlDataObject);
  };

  /**
   * Copy a series of resource to another dataspace
   *
   * @param {URI[]} resourcesOrigin
   * @param {URI} targetSpaceUri
   * @returns {Promise<boolean>}
   * @memberof ResqmlClient
   */
  public async copyResourcesToDataspace(
    clientOrigin: ResqmlClient,
    resourcesOrigin: URI[],
    targetSpaceUri: URI
  ): Promise<boolean> {
    const target = new EtpUri(targetSpaceUri);
    const transactionId = await this.startTransaction(
      false,
      [targetSpaceUri],
      `Merge ${resourcesOrigin.length} resources to ${targetSpaceUri}`
    );

    try {
      while (resourcesOrigin.length > 0) {
        const toTransfer = resourcesOrigin.splice(0, 10);

        const dataArrays = new Map<URI, IDataArray>(); // Map URI=>DataArray
        const objects = (await clientOrigin.getDataObjects(toTransfer)).filter(
          notEmpty
        );
        const copies = await Promise.all(
          objects.map(async r => {
            const etpUri = new EtpUri(r.resource.uri);
            const copyUri = EtpUri.createObjectUri(
              target.dataSpace,
              etpUri.domainFamily,
              etpUri.domainVersion,
              etpUri.objectType,
              etpUri.uuid,
              etpUri.version
            );

            const jsObj = await xml2typescript(
              byteToString(r.data),
              etpUri.dataObjectType
            );
            clientOrigin.findDataArrays(r.resource.uri, jsObj, dataArrays);
            return {
              ...r,
              resource: {
                ...r.resource,
                uri: copyUri.uri
              }
            };
          })
        );

        await Promise.all(
          Array.from(dataArrays.values()).map(async v =>
            clientOrigin
              .getDataArray(v.uid.uri, v.uid.pathInResource)
              .then(dataset => {
                if (dataset?.data) {
                  const etpUri = new EtpUri(v.uid.uri);
                  const hdfUri = EtpUri.createObjectUri(
                    target.dataSpace,
                    etpUri.domainFamily,
                    etpUri.domainVersion,
                    etpUri.objectType,
                    etpUri.uuid,
                    etpUri.version
                  );
                  return this.putUsingPutDataArraysType({
                    uid: {
                      uri: hdfUri.uri,
                      pathInResource: v.uid.pathInResource
                    },
                    array: dataset.data,
                    customData: new Map<
                      AvroString,
                      Energistics.Etp.v12.Datatypes.DataValue
                    >()
                  });
                } else {
                  return Promise.reject(
                    new EtpError(
                      `Cannot send array : ${v.uid}`,
                      ErrorCode.EINVALID_STATE
                    )
                  );
                }
              })
          )
        );
        await this.putDataObjects(copies);
      }
    } catch (e) {
      this.rollbackTransaction(transactionId);
      return false;
    }
    return this.commitTransaction(transactionId);
  }

  /**
   * Request a new session, can be separate from the connection
   *
   * @public
   * @returns {Promise<void>} void promise
   * @memberof ResqmlClient
   * @async
   */
  public async requestSession(): Promise<void> {
    this.connected = true;
    return new Promise((resolve, reject) => {
      try {
        this.client.on("open", resolve);
        this.client.on("error", (h, m) => {
          reject(m);
        });
        this.client.on(
          "exception",
          (_, m: Energistics.Etp.v12.Protocol.Core.ProtocolException) => {
            reject(errorFromProtocolException(m));
          }
        );
        this.client.requestSession(
          process.env.SERVICE_NAME
            ? process.env.SERVICE_NAME
            : "open-etp-client",
          "0.0.1"
        );
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Socket was disconnected.
   *
   * @private
   * @memberof ResqmlClient
   */
  private onSocketDisconnect() {
    this.client.logTrace("Disconnected");
    this.connected = false;
  }

  /**
   * Format the data array as either JSON or Base64
   *
   * @param {Energistics.Etp.v12.Datatypes.AnyArray} array
   * @param {ArrayFormat} format
   * @returns {(number[] | boolean[] | string[] | string | undefined)}
   */
  public formatArrayData(
    array: Energistics.Etp.v12.Datatypes.AnyArray,
    format: ArrayFormat
  ): ArrayOutput | undefined {
    const values = array.item[array.item.__keyName]?.values;
    if (!values) {
      return undefined;
    }
    switch (array.item.__keyName) {
      case "_ArrayOfBoolean": {
        const typedValues = values as boolean[];
        if (format === "base64") {
          const fa = new Int8Array(typedValues.map(v => (v ? 1 : 0)));
          return Buffer.from(fa.buffer).toString("base64");
        }
        return typedValues;
      }
      case "_ArrayOfFloat": {
        return formattedTypedArray<Float32Array>(
          values as number[],
          Float32Array,
          format
        );
      }
      case "_ArrayOfDouble": {
        return formattedTypedArray<Float64Array>(
          values as number[],
          Float64Array,
          format
        );
      }
      case "_ArrayOfInt": {
        return formattedTypedArray<Int32Array>(
          values as number[],
          Int32Array,
          format
        );
      }
      case "_ArrayOfLong": {
        const typedValues = values as bigint[];
        if (format === "base64") {
          const fa = new BigInt64Array(typedValues);
          return Buffer.from(fa.buffer).toString("base64");
        }
        return typedValues.map(v => v.toString() + "n");
      }
      case "_ArrayOfString": {
        const typedValues = values as string[];
        if (format === "base64") {
          return Buffer.from(typedValues.join(",")).toString("base64");
        }
        return typedValues;
      }
    }

    return values.toString();
  }

  /**
   * Replace the object and data array references inside the given object, using the content of the
   * objects and a dataArrays map.
   *
   * @private
   * @param {URI} uri of obj
   * @param {IResqmlDataObject} resqmlObj object for which the referenced should be solved
   * @param {Map<URI, IResqmlDataObject>} objects map of found data objects
   * @param {Map<URI, IDataArray>} dataArrays map of found data arrays
   * @param {Map<URI, IResqmlDataObject>} resolved map of resolved objects
   * @param {ArrayFormat} arrayFormat format of the array data
   * @param {boolean} includeReferences include references to other objects in the resolved object
   * @returns {IResqmlDataObject} resolved object
   * @memberof ResqmlClient
   */
  private resolveReferences(
    uri: URI,
    obj: Record<string, any>,
    objects: Map<URI, IResqmlDataObject>,
    dataArrays: Map<URI, IDataArray>,
    resolved: Map<URI, IResqmlDataObject>,
    arrayFormat: ArrayFormat,
    includeReferences: boolean,
    inProgress?: Set<string>
  ): Record<string, any> {
    const etpUri = new EtpUri(uri);
    const r = resolved.get(etpUri.uriPath);
    if (r) {
      return r;
    }

    // Track objects currently being resolved to detect circular refs
    if (!inProgress) inProgress = new Set<string>();
    if (inProgress.has(etpUri.uriPath)) {
      // Circular reference detected — return obj as-is without further resolution
      return obj;
    }
    inProgress.add(etpUri.uriPath);

    if (
      // EML2.3 Array
      obj.$type === "eml23.ExternalDataArrayPart"
    ) {
      // Resolve the data arrays
      const nURI = `${obj.URI}${obj.PathInExternalFile}`;

      const arr = dataArrays.get(nURI);
      if (arr?.data) {
        const arrayData = this.formatArrayData(arr.data.data, arrayFormat);
        const o = { ...arr, data: { ...arr.data, data: arrayData } };
        return {
          ...obj,
          _data: simpleJson(o, "2.3")
        };
      } else if (arr) {
        return {
          ...obj,
          _data: simpleJson(arr, "2.3")
        };
      }
    } else {
      Object.keys(obj).forEach((key: string) => {
        if (!obj[key] || typeof obj[key] !== "object") {
          return;
        } else if (Array.isArray(obj[key])) {
          obj[key] = obj[key].map((o: IResqmlDataObject) =>
            this.resolveReferences(
              uri,
              o,
              objects,
              dataArrays,
              resolved,
              arrayFormat,
              includeReferences,
              inProgress
            )
          );
        } else if (
          // EML2.0 Array
          obj[key].$type === "eml20.Hdf5Dataset"
        ) {
          // Resolve the data arrays
          let contentType = "obj_EpcExternalPartReference";
          if (obj[key].HdfProxy?.ContentType) {
            contentType = obj[key].HdfProxy.ContentType.substring(
              obj[key].HdfProxy.ContentType.indexOf("type=") + 5
            );
          }
          const nURI = `${EtpUri.createObjectUri(
            etpUri.dataSpace,
            "eml",
            "2.0",
            contentType,
            obj[key].HdfProxy.UUID,
            obj[key].HdfProxy.Version
          ).uri
            }${obj[key].PathInHdfFile}`;

          const arr = dataArrays.get(nURI);
          if (arr?.data) {
            const arrayData = this.formatArrayData(arr.data.data, arrayFormat);
            const o = { ...arr, data: { ...arr.data, data: arrayData } };
            obj[key] = { ...obj[key], _data: simpleJson(o, "2.0") };
          } else if (arr) {
            obj[key] = { ...obj[key], _data: simpleJson(arr, "2.0") };
          }
        } else if (
          includeReferences &&
          (obj[key].$type === "eml20.DataObjectReference" ||
            obj[key].$type === "eml23.DataObjectReference")
        ) {
          let nURI: EtpUri = new EtpUri("");
          // TODO: Use of obj[key].EnergisticsUri for external references
          if (obj[key].$type === "eml20.DataObjectReference") {
            const ref = obj[key] as Eml20.DataObjectReference;
            const dataObjectType: EtpContentType.EtpContentType =
              new EtpContentType.EtpContentType(obj[key].ContentType);
            nURI = EtpUri.createObjectUri(
              etpUri.dataSpace,
              dataObjectType.domainFamily,
              dataObjectType.domainVersion,
              dataObjectType.dataType,
              ref.UUID,
              ref.VersionString
            );
          } else {
            const ref = obj[key] as Eml23.DataObjectReference;
            const qualifiedType = new EtpQualifiedType(obj[key].QualifiedType);
            nURI = EtpUri.createObjectUri(
              etpUri.dataSpace,
              qualifiedType.domainFamily,
              qualifiedType.domainVersion,
              qualifiedType.dataType,
              ref.Uuid,
              ref.ObjectVersion
            );
          }

          if (nURI.isValid) {
            // Resolve the object reference
            let o = objects.get(nURI.uri) as IResqmlDataObject | undefined;
            if (!o) {
              o = objects.get(
                EtpUri.createObjectUri(
                  nURI.dataSpace,
                  nURI.domainFamily,
                  nURI.domainVersion,
                  nURI.objectType,
                  nURI.uuid
                ).uri
              );
            }
            if (o) {
              // Skip if this reference is currently being resolved (cycle)
              const refPath = new EtpUri(nURI.uri).uriPath;
              if (inProgress!.has(refPath)) {
                // Circular ref — leave DataObjectReference without _data
              } else {
                const res = this.resolveReferences(
                  nURI.uri,
                  o,
                  objects,
                  dataArrays,
                  resolved,
                  arrayFormat,
                  includeReferences,
                  inProgress
                ) as IResqmlDataObject;
                obj[key] = { ...obj[key], _data: res };
                resolved.set(nURI.uri, res);
              }
            }
          }
        } else {
          obj[key] = this.resolveReferences(
            etpUri.uriPath,
            obj[key],
            objects,
            dataArrays,
            resolved,
            arrayFormat,
            includeReferences,
            inProgress
          );
        }
      });
    }
    // Mark as fully resolved and remove from in-progress
    resolved.set(etpUri.uriPath, obj as IResqmlDataObject);
    inProgress!.delete(etpUri.uriPath);
    return obj;
  }

  /**
   * Check if any of the errors code indicates an actual error
   *
   * @private
   * @param {Energistics.Etp.v12.Datatypes.ErrorInfo[]} errors
   * @returns {boolean}
   * @memberof ResqmlClient
   */
  private checkErrors(
    errors: Energistics.Etp.v12.Datatypes.ErrorInfo[]
  ): boolean {
    let ok = true;
    const error_message: string[] = [];
    let code: ErrorCode = ErrorCode.IS_OK;
    errors.forEach(e => {
      if (e.code !== ErrorCode.IS_OK) {
        ok = false;
        code = e.code;
        error_message.push(e.message);
        this.logger.error(e.message);
      }
    });
    if (!ok) {
      throw new EtpError(
        `${error_message.length} failures on ${errors.length
        } request: ${error_message.join(", ")}`,
        code
      );
    }
    return ok;
  }

  /**
   * Visit a single subArray
   *
   * @private
   * @param {(IDataSubarray | null)} subArray
   * @param {((values: number[] | boolean[], da: IDataSubarray) => any)} visitor
   * @returns
   * @memberof ResqmlClient
   */
  private visitSubArray(
    subArray: IDataSubarray | null,
    visitor: (values: number[] | boolean[], da: IDataSubarray) => any
  ) {
    if (!subArray?.data) {
      return;
    }
    const da =
      subArray.data as Energistics.Etp.v12.Datatypes.DataArrayTypes.DataArray;
    if (!da) {
      return;
    }
    const temp = da.data.item;
    const tempKeyName = temp[temp.__keyName];
    if (!tempKeyName) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(tempKeyName, "values")) {
      const values = tempKeyName.values as number[] | boolean[];
      visitor(values, subArray);
    } else {
      visitor(Array.from(tempKeyName as Iterable<number>), subArray);
    }
  }
}
