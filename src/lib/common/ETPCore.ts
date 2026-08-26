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

import { EventEmitter } from "events";
import { w3cwebsocket } from "websocket";

import { EtpSessionTerminatedError, MessageFlags } from "./EtpTypes";
import { SchemaCache } from "./Util";
import { Energistics, Integer64 } from "./Etp12";

import { BaseHandler } from "./BaseHandler";
import { EtpUri } from "./EtpUri";

const Core = Energistics.Etp.v12.Protocol.Core;
const PROTOCOL = Energistics.Etp.v12.Datatypes.Protocol;

export interface IConfiguration {
  name: string;
  traceCalls?: boolean; // If defined, used for tracing
}

export interface IPromiseTimeMap {
  resolve: (value: Integer64) => void;
  reject: (reason?: Integer64 | undefined) => void;
  initialTime: Integer64;
}

/// Base class for either a server or client, implements common core functionality
export class ETPCore extends EventEmitter {
  public traceCalls: boolean;
  public negotiatedSize?: number;
  public responseTimeoutPeriod = 0; // Maximum wait before first message - Default 0
  public multipartMessageTimeoutPeriod = 1000; // Maximum wait between messages
  public messageQueueDepth = 100; // Maximum number of waiting message supported by server
  public enableCertificationTracing: boolean = false;
  protected binary = true;
  protected connection: w3cwebsocket | null = null;
  protected handlers: BaseHandler[] = [];
  protected sessionId: Energistics.Etp.v12.Datatypes.Uuid =
    EtpUri.invalidGuid();
  protected stats = {
    blocks: 0,
    bytesReceived: 0,
    bytesSent: 0,
    connectDate: new Date(),
    dataPoints: 0,
    firstDataBlock: null,
    lastDataBlock: null,
    messagesReceived: 0,
    messagesSent: 0,
    rows: 0
  };
  protected schemaCache = new SchemaCache();
  private messageId = BigInt(0);
  private readonly timeResolve = new Map<Integer64, IPromiseTimeMap>();

  constructor(configuration: IConfiguration) {
    super();
    this.traceCalls = configuration.traceCalls ?? false;
  }

  /// Send an acknowledgement of receipt of a message.
  public acknowledge(messageId: Integer64): void {
    const header = this.createFinalMessageHeader(
      PROTOCOL.Core,
      Core.MsgAcknowledge,
      messageId,
      0
    );
    this.logTrace(`Acknowledgement sent for ${header.correlationId}.`);
    this.send(header, {});
  }

  /// Close the current Session. Other party should respond by closing the socket.
  public closeSession(): void {
    const closed = this.sessionId.every(v => v === 0);
    if (!closed) {
      this.logTrace(`Session closure requested.`);
      this.send(
        this.createFinalMessageHeader(
          PROTOCOL.Core,
          Core.MsgCloseSession,
          BigInt(0)
        ),
        {
          reason: "Regular closure",
          sessionId: this.sessionId
        }
      );
      this.handlers.forEach(h => h?.stop());
      this.sessionId = EtpUri.invalidGuid();
    }
  }

  /// Create a new header for a specific message kind and correlation id
  public createHeader(
    protocol: number,
    messageType: number,
    correlationId = BigInt(0),
    messageFlags = 0
  ): Energistics.Etp.v12.Datatypes.MessageHeader {
    this.messageId = this.messageId + BigInt(2); // Specs request that client use only even non null
    if (this.enableCertificationTracing) {
      this.emit("messageId", this.messageId);
    }
    return {
      correlationId,
      messageFlags,
      messageId: this.messageId,
      messageType,
      protocol
    };
  }

  /// Create a new header for a specific message kind and correlation id
  public createFinalMessageHeader(
    protocol: number,
    messageType: number,
    correlationId = BigInt(0),
    messageFlags = 0
  ): Energistics.Etp.v12.Datatypes.MessageHeader {
    return this.createHeader(
      protocol,
      messageType,
      correlationId,
      messageFlags | MessageFlags.FINALPART
    );
  }

  /// Are we in an active session.
  public isInSession(): boolean {
    return (
      this.connection != null &&
      this.connection.readyState === 1 &&
      this.sessionId !== EtpUri.invalidGuid()
    );
  }

  /// Handle a parsed message. Overloaded in all handlers.  Includes default handling for common messages
  public handleMessage(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody:
      | Energistics.Etp.v12.Protocol.Core.Acknowledge
      | Energistics.Etp.v12.Protocol.Core.ProtocolException
      | Energistics.Etp.v12.Protocol.Core.Ping
      | Energistics.Etp.v12.Protocol.Core.Pong
  ): void {
    switch (messageHeader.messageType) {
      case Core.MsgAcknowledge:
        this.onAcknowledge(messageHeader, messageBody);
        break;
      case Core.MsgProtocolException:
        this.onException(
          messageHeader,
          messageBody as Energistics.Etp.v12.Protocol.Core.ProtocolException
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
    }
  }

  /// Log a message
  public log(message: string): void {
    this.emit("log", message);
  }

  /**
   * Log message if traceCalls is on
   *
   * @param {string} str
   * @memberof BaseHandler
   */
  public logTrace(str: string): void {
    if (this.traceCalls) {
      this.log(str);
    }
  }

  /// Send the ping message. Expecting a Pong response
  public ping(): Promise<Integer64 | null> {
    const header = this.createFinalMessageHeader(
      PROTOCOL.Core,
      Core.MsgPing,
      BigInt(0),
      0
    );
    const currentDateTime = BigInt(new Date().getTime()) * BigInt(1000); // In microseconds
    const ping: Energistics.Etp.v12.Protocol.Core.Ping = {
      currentDateTime
    };
    return new Promise<Integer64>((resolve, reject) => {
      this.timeResolve.set(this.send(header, ping), {
        reject,
        resolve,
        initialTime: currentDateTime
      });
    });
  }

  /// Handle the ping message. Responding with a Pong
  public onPing(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.Ping
  ): void {
    const currentDateTime = BigInt(new Date().getTime()) * BigInt(1000); // In microseconds
    const deltaTime = message.currentDateTime
      ? currentDateTime - message.currentDateTime
      : undefined;
    this.logTrace(
      `Received Ping message for session ${this.sessionId} sent ${deltaTime ?? "unknown"
      } microseconds ago`
    );
    const responseHeader = this.createFinalMessageHeader(
      PROTOCOL.Core,
      Core.MsgPong,
      header.messageId,
      0
    );
    const pong: Energistics.Etp.v12.Protocol.Core.Pong = {
      currentDateTime
    };
    this.emit("ping");
    this.send(responseHeader, pong);
  }

  /// Handle the pong message. Resolving with the round trip time.
  public onPong(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.Pong
  ): void {
    const currentDateTime = BigInt(new Date().getTime()) * BigInt(1000);
    if (!header.correlationId) {
      throw new Error(`No correlation ID on success response message`);
    }
    const timeItem = this.timeResolve.get(header.correlationId);
    if (!timeItem) {
      throw new Error(
        `Value returned on unknown success response message ${header.correlationId}`
      );
    }
    const oneWayTime = message.currentDateTime - timeItem.initialTime;
    const totalTime = currentDateTime - timeItem.initialTime;
    timeItem.resolve(totalTime);
    this.timeResolve.delete(header.correlationId);
    this.logTrace(
      `Received Ping response for session ${this.sessionId} sent ${totalTime} microseconds ago, first leg was ${oneWayTime} microseconds`
    );
    this.emit("pong");
  }

  /// Handle the close session message. This can come from server or client on protocol 0
  public onCloseSession(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.CloseSession
  ): void {
    this.handlers.forEach(h => h?.stop());
    this.logTrace(
      `Received CloseSession message for session ${this.sessionId}. Reason ${message.reason}. Closing WebSocket.`
    );
    this.sessionId = EtpUri.invalidGuid();
    this.connection?.close();
    this.emit("close");
  }

  /// Handle an acknowledgement model.
  public onAcknowledge(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: unknown
  ): void {
    this.logTrace(
      `Received Acknowledge message for ${header.correlationId}: ${message}.`
    );
    this.emit("acknowledge", header, message);
  }

  /// Handle an exception message.
  public onException(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.Core.ProtocolException
  ): void {
    this.logTrace(
      `Received Exception message for ${header.correlationId}: ${message}.`
    );
    this.emit("exception", header, message);
  }

  /// Register a new handler for a protocol
  public registerHandler(id: number, handler: BaseHandler): BaseHandler {
    this.handlers[id] = handler;
    return handler;
  }

  public send(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: unknown
  ): Integer64 {
    if (!this.binary) {
      throw new Error(
        "JSON message no longer supported, only binary is supported"
      );
    }
    const data: ArrayBuffer = this.computeData(header, message);
    return this.sendData(header.messageId, data);
  }

  public sendData(id: Integer64, data: ArrayBuffer): Integer64 {
    if (!this.binary) {
      throw new Error(
        "JSON message no longer supported, only binary is supported"
      );
    }
    // Guard against a previously-open WebSocket that has been closed (or is
    // closing) by the peer. Without this check, `this.connection.send(data)`
    // would throw a raw "cannot call send() while not connected" transport
    // error from W3CWebSocket - which the REST layer used to wrap as an
    // opaque HTTP 500 (see WI 70414 cascade). Surface a typed error instead
    // so callers learn the session is gone (mapped to HTTP 410 Gone by
    // httpErrorFromEtpError). The `connection == null` case retains its
    // historical silent no-op behavior so callers that legitimately operate
    // without an open socket (e.g., unit tests, pre-session work) are not
    // broken.
    // Only treat the socket as terminated when it is actually closed or
    // closing. `readyState !== OPEN` would also match `CONNECTING` and
    // misreport a not-yet-ready socket as a terminated session.
    if (
      this.connection &&
      (this.connection.readyState === w3cwebsocket.CLOSED ||
        this.connection.readyState === w3cwebsocket.CLOSING)
    ) {
      throw new EtpSessionTerminatedError(
        "ETP WebSocket session is not connected; cannot send message"
      );
    }
    this.stats.bytesSent += data.byteLength;
    this.stats.messagesSent++;
    this.connection?.send(data);
    return id;
  }

  /// Send an exception, either direction
  public sendException(
    code: number,
    message: string,
    correlationId: Integer64
  ): void {
    const header = this.createFinalMessageHeader(
      PROTOCOL.Core,
      Core.MsgProtocolException,
      correlationId
    );
    const info = { code, message };
    this.logTrace(
      `Send Exception message for ${correlationId}: code ${code} message ${message}.`
    );
    this.send(header, info);
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  // Default body, so client and server can fill in their own way
  public computeData(
    _header: Energistics.Etp.v12.Datatypes.MessageHeader,
    _message: unknown
  ): ArrayBuffer {
    return new ArrayBuffer(0);
  }
}
