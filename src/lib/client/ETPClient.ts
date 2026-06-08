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

import * as WebSocket from "websocket";
import { stringify as stringifyUuid } from "uuid";
import { BinaryReader, BinaryWriter } from "../common/EtpAvro";

import { Energistics } from "../common/Etp12";
import { EtpDataValue } from "../common/EtpTypes";
import { EtpUri } from "../common/EtpUri";
import { ETPCore, IConfiguration } from "../common/ETPCore";

const Core = Energistics.Etp.v12.Protocol.Core;
const PROTOCOL = Energistics.Etp.v12.Datatypes.Protocol;

export interface IClientConfig extends WebSocket.IConfig {
  url: string;
  dataPartitionId?: string;
  clientId?: string;
  encoding: "binary" | "json";
  authentication?: string;
  noHeaders: boolean;
}

/**
 * Base implementation of an ETP client
 *
 * @export
 * @class ETPClient
 * @extends {ETPCore}
 */
export class ETPClient extends ETPCore {
  public dataSpaceSupported: boolean;
  public dataSpaceOSDUSupported: boolean;
  public transactionSupported: boolean;
  public enableMessageReceptionTracing: boolean;
  private host = "";
  private readonly serverProtocols: Energistics.Etp.v12.Datatypes.SupportedProtocol[] =
    [];
  private buffer: Buffer = Buffer.alloc(2048);

  constructor(config: IConfiguration) {
    super(config);
    this.dataSpaceSupported = false;
    this.dataSpaceOSDUSupported = false;
    this.transactionSupported = false;
    this.enableMessageReceptionTracing = false;
  }

  public connect(config: IClientConfig, socketClass: any = WebSocket): void {
    if (config.url != null) {
      this.host = config.url;
    }

    const encoding = config.encoding ? config.encoding : "binary";
    this.binary = encoding === "binary";
    this.negotiatedSize = config.maxReceivedMessageSize
      ? config.maxReceivedMessageSize
      : 0;

    const headers: { [key: string]: string } = config.clientId
      ? {
          "client-id": config.clientId,
          "etp-encoding": encoding
        }
      : {
          "etp-encoding": encoding
        };

    if (config.noHeaders) {
      this.host = `${this.host}?etp-encoding=${encoding}`;
      if (config.clientId) {
        this.host = `${this.host}&client-id=${config.clientId}`;
      }
      if (headers.Authorization) {
        this.host = `${this.host}&Authorization=${headers.Authorization}`;
      }
      if (config.dataPartitionId) {
        this.host = `${this.host}&data-partition-id=${config.dataPartitionId}`;
      }
    } else {
      if (config.authentication) {
        headers.Authorization = config.authentication;
      }
      if (config.dataPartitionId) {
        headers["data-partition-id"] = config.dataPartitionId;
      }
    }

    if (config.maxReceivedMessageSize) {
      config.maxReceivedFrameSize = config.maxReceivedMessageSize;
    }
    this.connection = new socketClass(
      this.host,
      "etp12.energistics.org", // protocol
      undefined, // origin
      headers, // http headers
      undefined,
      config // pass config through
    );
    if (this.connection) {
      this.connection.onopen = () => {
        if (this.connection && this.connection.readyState === 1) {
          this.emit("connect", this.connection);
        }
      };

      this.connection.onclose = this.onSocketClose.bind(this);

      this.connection.onmessage = this.onSocketMessage.bind(this);

      this.connection.onerror = (err: Error) => {
        if (err instanceof Error) {
          this.emit("log", `Connection Error: ${err.message}`);
        }
        this.emit("error", `Connection Error`);
      };
    }
  }

  /**
   * Disconnect from the server
   * @memberof ETPClient
   * @returns {void}
   */
  public disconnect(): void {
    if (this.connection) {
      this.connection.close();
    }
  }

  public handleMessage(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody:
      | Energistics.Etp.v12.Protocol.Core.OpenSession
      | Energistics.Etp.v12.Protocol.Core.CloseSession
      | Energistics.Etp.v12.Protocol.Core.AuthorizeResponse
      | Energistics.Etp.v12.Protocol.Core.Ping
      | Energistics.Etp.v12.Protocol.Core.Pong
      | Energistics.Etp.v12.Protocol.Core.ProtocolException
      | Energistics.Etp.v12.Protocol.Core.Acknowledge
  ): void {
    if (this.enableMessageReceptionTracing) {
      this.emit("messageHeader", messageHeader);
    }
    if (this.enableCertificationTracing) {
      this.emit("message", messageHeader, messageBody);
    }
    if (messageHeader.protocol === PROTOCOL.Core) {
      switch (messageHeader.messageType) {
        case Core.MsgOpenSession:
          this.onOpenSession(
            messageHeader,
            messageBody as Energistics.Etp.v12.Protocol.Core.OpenSession
          );
          break;
        case Core.MsgCloseSession:
          this.onCloseSession(
            messageHeader,
            messageBody as Energistics.Etp.v12.Protocol.Core.CloseSession
          );
          break;
        case Core.MsgAuthorizeResponse:
          this.onAuthorizeResponse(
            messageHeader,
            messageBody as Energistics.Etp.v12.Protocol.Core.AuthorizeResponse
          );
          break;
        case Core.MsgPing:
          this.onPing(
            messageHeader,
            messageBody as Energistics.Etp.v12.Protocol.Core.Ping
          );
          break;
        case Core.MsgPong:
          this.onPong(
            messageHeader,
            messageBody as Energistics.Etp.v12.Protocol.Core.Pong
          );
          break;
        default:
          super.handleMessage(messageHeader, messageBody);
      }
    } else {
      this.handlers[messageHeader.protocol].handleMessage(
        messageHeader,
        messageBody
      );
    }
  }

  public onOpenSession(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody: Energistics.Etp.v12.Protocol.Core.OpenSession
  ): void {
    this.logTrace(
      `Opened Session ${stringifyUuid(messageBody.serverInstanceId)} with ${
        this.host
      }`
    );
    this.sessionId = messageBody.serverInstanceId;
    const payloadSize = messageBody.endpointCapabilities.get(
      "MaxWebSocketMessagePayloadSize"
    );
    if (
      payloadSize &&
      payloadSize.item &&
      typeof payloadSize.item === "object"
    ) {
      const t = payloadSize.item as any;
      const val = t[t.__keyName];
      if (!this.negotiatedSize || this.negotiatedSize > val) {
        this.negotiatedSize = val;
      }
    }
    const timeout = messageBody.endpointCapabilities.get(
      "ResponseTimeoutPeriod"
    )?.item?._int;
    if (timeout) {
      this.responseTimeoutPeriod = timeout;
    }
    const multiPartTimeout = messageBody.endpointCapabilities.get(
      "MultipartMessageTimeoutPeriod"
    )?.item?._int;
    if (multiPartTimeout) {
      this.multipartMessageTimeoutPeriod = multiPartTimeout;
    }

    const messageQueueDepth =
      messageBody.endpointCapabilities.get("MessageQueueDepth")?.item?._long;
    if (messageQueueDepth) {
      this.messageQueueDepth = Number(messageQueueDepth);
    }

    messageBody.supportedProtocols.forEach(
      (protocol: Energistics.Etp.v12.Datatypes.SupportedProtocol) => {
        const protocolId = protocol.protocol;

        if (
          protocolId ===
          Energistics.Etp.v12.Protocol.Dataspace.DeleteDataspaces._protocol
        ) {
          this.dataSpaceSupported = true;
        }

        if (
          protocolId ===
          Energistics.Etp.v12.Protocol.DataspaceOSDU.GetDataspaceInfo._protocol
        ) {
          this.dataSpaceOSDUSupported = true;
        }

        if (
          protocolId ===
          Energistics.Etp.v12.Protocol.Transaction.StartTransaction._protocol
        ) {
          this.transactionSupported = true;
        }

        // Save it, so handlers can have access to any capabilities.
        this.serverProtocols[protocolId] = protocol;
        if (this.handlers[protocolId]) {
          this.handlers[protocolId].start();
        }
      }
    );
    this.emit("open");
  }

  public onAuthorizeResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.AuthorizeResponse
  ): void {
    this.logTrace(
      `Received Authorize message for ${header.correlationId}: Authorization ${message.success}.`
    );
    this.emit("authorize", header, message);
  }

  public onSocketClose(event: WebSocket.ICloseEvent): void {
    this.sessionId = EtpUri.invalidGuid();
    this.connection &&
      this.logTrace(
        `Peer ${this.connection.url} disconnected: ${event.reason}.`
      );
    // Forward close code/reason to disconnect listeners so callers can
    // surface them in structured error responses (HTTP 410 body for the
    // REST layer). EventEmitter passes extra args through transparently;
    // listeners that ignore them keep working unchanged.
    this.emit("disconnect", this.connection, event.code, event.reason);
  }

  public onSocketMessage(msg: WebSocket.IMessageEvent): void {
    let header: Energistics.Etp.v12.Datatypes.MessageHeader | null = null;
    let message = null;
    this.stats.messagesReceived++;
    if (typeof msg.data === "object") {
      this.stats.bytesReceived += msg.data.byteLength;
      const reader = new BinaryReader(this.schemaCache, Buffer.from(msg.data));
      if (reader) {
        header = reader.readDatum(
          "Energistics.Etp.v12.Datatypes.MessageHeader"
        );
        message = header
          ? reader.readDatum(
              this.schemaCache.find(header.protocol, header.messageType)
            )
          : null;
      }
    } else {
      this.stats.bytesReceived += msg.data.length;
      const data = JSON.parse(msg.data);
      header = data[0];
      message = data[1];
    }
    try {
      header && this.handleMessage(header, message);
    } catch (err: any) {
      this.log(`Error message from server: ${err.message}`);
    }
  }

  public requestSession(
    applicationName: string,
    applicationVersion: string,
    endpointCapabilities?: Map<string, Energistics.Etp.v12.Datatypes.DataValue>
  ): void {
    const requestedProtocols: Energistics.Etp.v12.Datatypes.SupportedProtocol[] =
      [];
    this.handlers.forEach(handler => {
      if (handler.role === "customer") {
        requestedProtocols.push({
          protocol: handler.protocol,
          protocolCapabilities: handler.capabilities,
          protocolVersion: handler.version,
          role: "store"
        });
      }
    });
    const header: Energistics.Etp.v12.Datatypes.MessageHeader =
      this.createFinalMessageHeader(
        PROTOCOL.Core,
        Core.MsgRequestSession,
        BigInt(0)
      );
    const sessionUuid: Energistics.Etp.v12.Datatypes.Uuid = [
      1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2
    ];
    const dataObjectCapabilities = new Map<
      string,
      Energistics.Etp.v12.Datatypes.DataValue
    >();
    dataObjectCapabilities.set("SupportsGet", EtpDataValue.boolean(true));
    dataObjectCapabilities.set("SupportsPut", EtpDataValue.boolean(true));
    dataObjectCapabilities.set("SupportsDelete", EtpDataValue.boolean(true));
    const message: Energistics.Etp.v12.Protocol.Core.RequestSession = {
      applicationName,
      applicationVersion,
      clientInstanceId: sessionUuid,
      currentDateTime: BigInt(new Date().getTime()) * BigInt(1000), //Time in microseconds
      earliestRetainedChangeTime: BigInt(new Date().getTime()) * BigInt(1000),
      endpointCapabilities: new Map<
        string,
        Energistics.Etp.v12.Datatypes.DataValue
      >(),
      requestedProtocols,
      serverAuthorizationRequired: false,
      supportedCompression: [],
      supportedDataObjects: [
        { qualifiedType: "witsml21.*", dataObjectCapabilities },
        { qualifiedType: "resqml20.*", dataObjectCapabilities },
        { qualifiedType: "eml20.*", dataObjectCapabilities }
      ],
      supportedFormats: ["xml"]
    };
    if (this.negotiatedSize) {
      message.endpointCapabilities.set(
        "MaxWebSocketMessagePayloadSize",
        EtpDataValue.long(BigInt(this.negotiatedSize))
      );
      this.buffer = Buffer.alloc(this.negotiatedSize);
    }
    if (endpointCapabilities) {
      endpointCapabilities.forEach((value, key) => {
        message.endpointCapabilities.set(key, value);
      });
    }
    this.send(header, message);
  }

  public requestAuthorize(authentication?: string): void {
    const header: Energistics.Etp.v12.Datatypes.MessageHeader =
      this.createFinalMessageHeader(
        PROTOCOL.Core,
        Core.MsgAuthorize,
        BigInt(0)
      );

    const authorization = authentication ? `${authentication}` : "";
    const message: Energistics.Etp.v12.Protocol.Core.Authorize = {
      authorization,
      supplementalAuthorization: new Map<string, string>()
    };
    this.send(header, message);
  }

  public computeData(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: unknown
  ): ArrayBuffer {
    const encoder = new BinaryWriter(this.schemaCache, this.buffer);
    encoder.writeDatum(
      Energistics.Etp.v12.Datatypes.MessageHeader._schema.fullName,
      header,
      true
    );
    if (message) {
      const schemaName = this.schemaCache.schemaName(
        header.protocol,
        header.messageType
      );
      encoder.writeDatum(schemaName, message, true);
    }
    return encoder.getBuffer();
  }
}
