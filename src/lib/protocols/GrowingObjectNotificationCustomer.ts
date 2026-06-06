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

import { EventEmitter } from "events";
import { BaseHandler } from "../common/BaseHandler";
import { ETPCore } from "../common/ETPCore";
import { Energistics, Integer64 } from "../common/Etp12";

const GrowingObjectNotification =
  Energistics.Etp.v12.Protocol.GrowingObjectNotification;
const Core = Energistics.Etp.v12.Protocol.Core;
const PROTOCOL = Energistics.Etp.v12.Datatypes.Protocol;

/**
 * Event names emitted by GrowingObjectNotificationCustomer.
 * Subscribe to these for real-time updates on growing objects.
 */
export const GrowingObjectEvents = {
  PARTS_CHANGED: "partsChanged",
  PARTS_DELETED: "partsDeleted",
  PARTS_REPLACED_BY_RANGE: "partsReplacedByRange",
  SUBSCRIPTION_ENDED: "subscriptionEnded",
  UNSOLICITED_PARTS: "unsolicitedParts"
} as const;

/**
 * Implementation of client for GrowingObjectNotification protocol (Protocol 7).
 *
 * Provides real-time notification when parts of growing objects change.
 * Critical for OSDU real-time drilling scenarios where well logs receive
 * new measurements continuously. Subscribers get notified when:
 * - New parts are appended (PartsChanged)
 * - Parts are deleted (PartsDeleted)
 * - Parts are replaced by range (PartsReplacedByRange)
 *
 * Usage pattern:
 *   1. Subscribe to a growing object URI
 *   2. Listen for events (partsChanged, partsDeleted, etc.)
 *   3. Unsubscribe when done
 *
 * @export
 * @class GrowingObjectNotificationCustomer
 * @extends {BaseHandler}
 */
export class GrowingObjectNotificationCustomer extends BaseHandler {
  private readonly sessionManager: ETPCore;
  private readonly emitter = new EventEmitter();
  private activeSubscriptions = new Map<string, string>(); // requestUuid -> uri

  constructor(sessionManager: ETPCore) {
    super(sessionManager);
    this.sessionManager = sessionManager;
    this._role = "customer";
    this._protocol = PROTOCOL.GrowingObjectNotification;
  }

  public handleMessage(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody: unknown
  ): void {
    if (messageHeader.protocol === PROTOCOL.GrowingObjectNotification) {
      switch (messageHeader.messageType) {
        case GrowingObjectNotification.MsgSubscribePartNotificationsResponse: {
          this.logTrace(
            `Received GrowingObjectNotification.SubscribePartNotificationsResponse for ${messageHeader.correlationId}.`
          );
          break;
        }
        case GrowingObjectNotification.MsgPartsChanged: {
          this.logTrace(
            `Received GrowingObjectNotification.PartsChanged for ${messageHeader.correlationId}.`
          );
          this.emitter.emit(
            GrowingObjectEvents.PARTS_CHANGED,
            messageBody as Energistics.Etp.v12.Protocol.GrowingObjectNotification.PartsChanged
          );
          break;
        }
        case GrowingObjectNotification.MsgPartsDeleted: {
          this.logTrace(
            `Received GrowingObjectNotification.PartsDeleted for ${messageHeader.correlationId}.`
          );
          this.emitter.emit(
            GrowingObjectEvents.PARTS_DELETED,
            messageBody as Energistics.Etp.v12.Protocol.GrowingObjectNotification.PartsDeleted
          );
          break;
        }
        case GrowingObjectNotification.MsgPartsReplacedByRange: {
          this.logTrace(
            `Received GrowingObjectNotification.PartsReplacedByRange for ${messageHeader.correlationId}.`
          );
          this.emitter.emit(
            GrowingObjectEvents.PARTS_REPLACED_BY_RANGE,
            messageBody as Energistics.Etp.v12.Protocol.GrowingObjectNotification.PartsReplacedByRange
          );
          break;
        }
        case GrowingObjectNotification.MsgPartSubscriptionEnded: {
          this.logTrace(
            `Received GrowingObjectNotification.PartSubscriptionEnded for ${messageHeader.correlationId}.`
          );
          this.emitter.emit(
            GrowingObjectEvents.SUBSCRIPTION_ENDED,
            messageBody as Energistics.Etp.v12.Protocol.GrowingObjectNotification.PartSubscriptionEnded
          );
          break;
        }
        case GrowingObjectNotification.MsgUnsolicitedPartNotifications: {
          this.logTrace(
            `Received GrowingObjectNotification.UnsolicitedPartNotifications for ${messageHeader.correlationId}.`
          );
          this.emitter.emit(
            GrowingObjectEvents.UNSOLICITED_PARTS,
            messageBody
          );
          break;
        }
        case Core.MsgProtocolException: {
          this.logTrace(
            `Received GrowingObjectNotification.ProtocolException for ${messageHeader.correlationId}.`
          );
          break;
        }
        default: {
          super.handleMessage(messageHeader, messageBody);
        }
      }
    } else {
      throw new Error(
        `Unsupported protocol {${messageHeader.protocol}} in GrowingObjectNotificationCustomer`
      );
    }
  }

  /**
   * Subscribe to part change notifications on a growing object.
   *
   * @param {string} uri URI of the growing object to monitor
   * @param {boolean} [includeObjectBody=false] Include full object body in notifications
   * @returns {void}
   */
  public subscribePartNotifications(
    uri: string,
    includeObjectBody = false
  ): void {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.GrowingObjectNotification,
      GrowingObjectNotification.MsgSubscribePartNotifications,
      BigInt(0)
    );
    const requestUuid = this.generateUuid();
    const subscriptionInfo = new Energistics.Etp.v12.Datatypes.Object.SubscriptionInfo();
    subscriptionInfo.context.uri = encodeURI(uri);
    subscriptionInfo.context.depth = 0;
    subscriptionInfo.context.dataObjectTypes = [];
    subscriptionInfo.context.navigableEdges =
      Energistics.Etp.v12.Datatypes.Object.RelationshipKind.Primary;
    subscriptionInfo.context.includeSecondaryTargets = false;
    subscriptionInfo.context.includeSecondarySources = false;
    subscriptionInfo.scope = Energistics.Etp.v12.Datatypes.Object.ContextScopeKind.self;
    subscriptionInfo.requestUuid = requestUuid;
    subscriptionInfo.includeObjectData = includeObjectBody;
    subscriptionInfo.format = "xml";

    const requestMap = new Map<string, Energistics.Etp.v12.Datatypes.Object.SubscriptionInfo>();
    requestMap.set("0", subscriptionInfo);

    const request: Energistics.Etp.v12.Protocol.GrowingObjectNotification.SubscribePartNotifications =
      {
        request: requestMap
      };
    this.sessionManager.send(header, request);
    this.activeSubscriptions.set(
      Buffer.from(requestUuid as unknown as number[]).toString("hex"),
      uri
    );
  }

  /**
   * Unsubscribe from part change notifications.
   *
   * @param {string} requestUuid The UUID of the subscription to cancel
   */
  public unsubscribePartNotification(requestUuid: string): void {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.GrowingObjectNotification,
      GrowingObjectNotification.MsgUnsubscribePartNotification,
      BigInt(0)
    );
    const msg: Energistics.Etp.v12.Protocol.GrowingObjectNotification.UnsubscribePartNotification =
      {
        requestUuid: Array.from(Buffer.from(requestUuid.replace(/-/g, ""), "hex")) as unknown as Energistics.Etp.v12.Datatypes.Uuid
      };
    this.sessionManager.send(header, msg);
    this.activeSubscriptions.delete(requestUuid);
  }

  /**
   * Register a listener for growing object notification events.
   */
  public on(
    event: (typeof GrowingObjectEvents)[keyof typeof GrowingObjectEvents],
    listener: (...args: unknown[]) => void
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  /**
   * Remove a listener for growing object notification events.
   */
  public off(
    event: (typeof GrowingObjectEvents)[keyof typeof GrowingObjectEvents],
    listener: (...args: unknown[]) => void
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  private generateUuid(): Energistics.Etp.v12.Datatypes.Uuid {
    const uuid = crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        });
    const bytes = Array.from(Buffer.from(uuid.replace(/-/g, ""), "hex"));
    return bytes as unknown as Energistics.Etp.v12.Datatypes.Uuid;
  }
}
