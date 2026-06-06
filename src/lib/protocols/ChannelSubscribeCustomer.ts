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
import { ArrayResponseHandler } from "../common/ResponseHandlers";

const ChannelSubscribe = Energistics.Etp.v12.Protocol.ChannelSubscribe;
const Core = Energistics.Etp.v12.Protocol.Core;
const PROTOCOL = Energistics.Etp.v12.Datatypes.Protocol;

type ChannelMetadataRecord =
  Energistics.Etp.v12.Datatypes.ChannelData.ChannelMetadataRecord;
type DataItem = Energistics.Etp.v12.Datatypes.ChannelData.DataItem;

/**
 * Event names emitted by ChannelSubscribeCustomer.
 */
export const ChannelEvents = {
  CHANNEL_DATA: "channelData",
  CHANNELS_TRUNCATED: "channelsTruncated",
  RANGE_REPLACED: "rangeReplaced",
  SUBSCRIPTIONS_STOPPED: "subscriptionsStopped"
} as const;

/**
 * Implementation of client for ChannelSubscribe protocol (Protocol 21).
 *
 * ChannelSubscribe enables real-time streaming of channel (curve) data from
 * the ETP server. Channels represent time-series or depth-indexed measurements
 * (e.g., gamma ray, resistivity during drilling). In OSDU context, this maps
 * to WellLog channels and enables real-time data integration.
 *
 * Flow:
 *   1. GetChannelMetadata → discover available channels
 *   2. SubscribeChannels → start receiving real-time data
 *   3. Listen for ChannelData events
 *   4. UnsubscribeChannels → stop streaming
 *
 * Also supports GetRanges for historical data retrieval within specific
 * index ranges (depth or time windows).
 *
 * @export
 * @class ChannelSubscribeCustomer
 * @extends {BaseHandler}
 */
export class ChannelSubscribeCustomer extends BaseHandler {
  private readonly sessionManager: ETPCore;
  private readonly emitter = new EventEmitter();
  private readonly metadataResults;
  private readonly rangeResults;

  constructor(sessionManager: ETPCore) {
    super(sessionManager);
    this.sessionManager = sessionManager;
    this._role = "customer";
    this._protocol = PROTOCOL.ChannelSubscribe;
    this.metadataResults = new ArrayResponseHandler<ChannelMetadataRecord>(
      sessionManager.responseTimeoutPeriod
    );
    this.rangeResults = new ArrayResponseHandler<DataItem>(
      sessionManager.responseTimeoutPeriod
    );
  }

  public handleMessage(
    messageHeader: Energistics.Etp.v12.Datatypes.MessageHeader,
    messageBody: unknown
  ): void {
    if (messageHeader.protocol === PROTOCOL.ChannelSubscribe) {
      switch (messageHeader.messageType) {
        case ChannelSubscribe.MsgGetChannelMetadataResponse: {
          this.logTrace(
            `Received ChannelSubscribe.GetChannelMetadataResponse for ${messageHeader.correlationId}.`
          );
          const body =
            messageBody as Energistics.Etp.v12.Protocol.ChannelSubscribe.GetChannelMetadataResponse;
          this.onGetChannelMetadataResponse(messageHeader, body);
          break;
        }
        case ChannelSubscribe.MsgSubscribeChannelsResponse: {
          this.logTrace(
            `Received ChannelSubscribe.SubscribeChannelsResponse for ${messageHeader.correlationId}.`
          );
          break;
        }
        case ChannelSubscribe.MsgChannelData: {
          this.logTrace(
            `Received ChannelSubscribe.ChannelData for ${messageHeader.correlationId}.`
          );
          const body =
            messageBody as Energistics.Etp.v12.Protocol.ChannelSubscribe.ChannelData;
          this.emitter.emit(ChannelEvents.CHANNEL_DATA, body.data);
          break;
        }
        case ChannelSubscribe.MsgChannelsTruncated: {
          this.logTrace(
            `Received ChannelSubscribe.ChannelsTruncated for ${messageHeader.correlationId}.`
          );
          this.emitter.emit(ChannelEvents.CHANNELS_TRUNCATED, messageBody);
          break;
        }
        case ChannelSubscribe.MsgGetRangesResponse: {
          this.logTrace(
            `Received ChannelSubscribe.GetRangesResponse for ${messageHeader.correlationId}.`
          );
          const body =
            messageBody as Energistics.Etp.v12.Protocol.ChannelSubscribe.GetRangesResponse;
          this.onGetRangesResponse(messageHeader, body);
          break;
        }
        case ChannelSubscribe.MsgRangeReplaced: {
          this.logTrace(
            `Received ChannelSubscribe.RangeReplaced for ${messageHeader.correlationId}.`
          );
          this.emitter.emit(ChannelEvents.RANGE_REPLACED, messageBody);
          break;
        }
        case ChannelSubscribe.MsgSubscriptionsStopped: {
          this.logTrace(
            `Received ChannelSubscribe.SubscriptionsStopped for ${messageHeader.correlationId}.`
          );
          this.emitter.emit(ChannelEvents.SUBSCRIPTIONS_STOPPED, messageBody);
          break;
        }
        case Core.MsgProtocolException: {
          this.logTrace(
            `Received ChannelSubscribe.ProtocolException for ${messageHeader.correlationId}.`
          );
          const err =
            messageBody as Energistics.Etp.v12.Protocol.Core.ProtocolException;
          this.metadataResults.onException(messageHeader, err);
          this.rangeResults.onException(messageHeader, err);
          break;
        }
        default: {
          super.handleMessage(messageHeader, messageBody);
        }
      }
    } else {
      throw new Error(
        `Unsupported protocol {${messageHeader.protocol}} in ChannelSubscribeCustomer`
      );
    }
  }

  /**
   * Discover available channels (curves) for a given URI.
   * Returns metadata including channel name, UOM, data type, and index info.
   *
   * @param {string} uri URI of the object containing channels (e.g., a WellLog)
   * @returns {Promise<ChannelMetadataRecord[]>} Channel metadata
   */
  public async getChannelMetadata(
    uri: string
  ): Promise<ChannelMetadataRecord[]> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.ChannelSubscribe,
      ChannelSubscribe.MsgGetChannelMetadata,
      BigInt(0)
    );
    const uris = new Map<string, string>();
    uris.set("0", encodeURI(uri));
    const msg: Energistics.Etp.v12.Protocol.ChannelSubscribe.GetChannelMetadata =
      {
        uris
      };
    return this.metadataResults.waitForRequest(
      this.sessionManager.send(header, msg)
    );
  }

  /**
   * Subscribe to receive real-time data from specified channels.
   * After subscribing, ChannelData events will be emitted as new data arrives.
   *
   * @param {Map<string, Energistics.Etp.v12.Datatypes.ChannelData.ChannelSubscribeInfo>} channels Channel subscription info
   */
  public subscribeChannels(
    channels: Map<
      string,
      Energistics.Etp.v12.Datatypes.ChannelData.ChannelSubscribeInfo
    >
  ): void {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.ChannelSubscribe,
      ChannelSubscribe.MsgSubscribeChannels,
      BigInt(0)
    );
    const msg: Energistics.Etp.v12.Protocol.ChannelSubscribe.SubscribeChannels =
      { channels };
    this.sessionManager.send(header, msg);
  }

  /**
   * Unsubscribe from previously subscribed channels.
   *
   * @param {number[]} channelIds IDs of channels to unsubscribe from
   */
  public unsubscribeChannels(channelIds: number[]): void {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.ChannelSubscribe,
      ChannelSubscribe.MsgUnsubscribeChannels,
      BigInt(0)
    );
    const channelIdsMap = new Map<string, Integer64>();
    channelIds.forEach((id, i) => channelIdsMap.set(String(i), BigInt(id)));
    const msg: Energistics.Etp.v12.Protocol.ChannelSubscribe.UnsubscribeChannels =
      { channelIds: channelIdsMap };
    this.sessionManager.send(header, msg);
  }

  /**
   * Retrieve historical channel data within an index range.
   * Useful for fetching well log data for a specific depth/time window.
   *
   * @param {Energistics.Etp.v12.Datatypes.Object.IndexInterval[]} rangeInfo Index ranges to fetch
   * @param {number[]} channelIds Channels to fetch data from
   * @returns {Promise<DataItem[]>} Historical data items
   */
  public async getRanges(
    rangeInfo: Energistics.Etp.v12.Datatypes.Object.IndexInterval[],
    channelIds: number[]
  ): Promise<DataItem[]> {
    const header = this.sessionManager.createFinalMessageHeader(
      PROTOCOL.ChannelSubscribe,
      ChannelSubscribe.MsgGetRanges,
      BigInt(0)
    );
    const channelRanges: Energistics.Etp.v12.Datatypes.ChannelData.ChannelRangeInfo[] =
      rangeInfo.map(interval => {
        const range = new Energistics.Etp.v12.Datatypes.ChannelData.ChannelRangeInfo();
        range.channelIds = channelIds.map(id => BigInt(id));
        range.interval = interval;
        return range;
      });
    const requestUuid: Energistics.Etp.v12.Datatypes.Uuid = [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ];
    const msg: Energistics.Etp.v12.Protocol.ChannelSubscribe.GetRanges = {
      requestUuid,
      channelRanges
    };
    return this.rangeResults.waitForRequest(
      this.sessionManager.send(header, msg)
    );
  }

  /**
   * Register a listener for channel events.
   */
  public on(
    event: (typeof ChannelEvents)[keyof typeof ChannelEvents],
    listener: (...args: unknown[]) => void
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  /**
   * Remove a listener for channel events.
   */
  public off(
    event: (typeof ChannelEvents)[keyof typeof ChannelEvents],
    listener: (...args: unknown[]) => void
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  private onGetChannelMetadataResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.ChannelSubscribe.GetChannelMetadataResponse
  ): void {
    const records: ChannelMetadataRecord[] = [];
    if (message.metadata) {
      for (const [, record] of message.metadata) {
        records.push(record);
      }
    }
    this.metadataResults.onResponse(header, records);
  }

  private onGetRangesResponse(
    header: Energistics.Etp.v12.Datatypes.MessageHeader,
    message: Energistics.Etp.v12.Protocol.ChannelSubscribe.GetRangesResponse
  ): void {
    const items: DataItem[] = message.data || [];
    this.rangeResults.onResponse(header, items);
  }
}
