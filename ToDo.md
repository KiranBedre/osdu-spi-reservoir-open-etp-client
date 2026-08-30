# ToDo: Unsupported ETP Protocols

Removed from `open-etp-client` on 2026-08-30 because `open-etp-server` does not implement them.
These protocols were never functional — the server has no handler classes and does not advertise them during ETP session negotiation.

## History

- Originally gated behind `RDMS_ETP_EXTENDED_PROTOCOLS=true` env var
- Commit `5479b1a` (2026-07-02) removed the env var, always registered handlers, added `requireProtocol()` guards returning 501
- Routes were always `@ApiExcludeEndpoint()` (hidden from Swagger)
- No ETP server (local docker, preship, or production) ever supported these protocols

## Protocols to Re-enable

### DiscoveryQuery (Protocol 13)

- **Purpose**: URI-pattern resource search with scope, depth, and type filtering
- **REST route**: `POST /query/resources/find`
- **Client handler**: `DiscoveryQueryCustomer.ts` (deleted — recover from git: `git show HEAD~1:src/lib/protocols/DiscoveryQueryCustomer.ts`)
- **Server requirement**: New `DiscoveryQueryProto.cpp` handler in `open-etp-server` `src/lib/oes/eml/openkv/`, plus registration in `ServerConfig.cpp` supported protocols list and `protocol_factory_` lambda
- **ETP messages**: `FindResources` → `FindResourcesResponse`

### GrowingObject (Protocol 6)

- **Purpose**: Retrieve/update parts of growing objects (WellLog curves, MudLog, Trajectory stations) by index range
- **REST routes**: `POST /query/growing/metadata`, `POST /query/growing/range`
- **Client handler**: `GrowingObjectCustomer.ts` (deleted — recover from git)
- **Server requirement**: New `GrowingObjectProto.cpp` in etp-server
- **ETP messages**: `GetParts`, `GetPartsByRange`, `PutParts`, `DeleteParts`, `GetPartsMetadata`

### GrowingObjectNotification (Protocol 7)

- **Purpose**: Push notifications when growing object parts change
- **Client handler**: `GrowingObjectNotificationCustomer.ts` (deleted — recover from git)
- **Server requirement**: New `GrowingObjectNotificationProto.cpp`
- **ETP messages**: `SubscribePartNotifications`, `PartsChanged`, `PartsDeleted`, `UnsubscribePartNotification`

### ChannelSubscribe (Protocol 21)

- **Purpose**: Real-time channel metadata discovery and streaming for WellLog/ChannelSet
- **REST route**: `POST /query/channels/metadata`
- **Client handler**: `ChannelSubscribeCustomer.ts` (deleted — recover from git)
- **Server requirement**: New `ChannelSubscribeProto.cpp`
- **ETP messages**: `GetChannelMetadata`, `SubscribeChannels`, `ChannelData`, `GetRanges`

## Re-enablement Steps

1. **ETP Server**: Implement protocol handlers in `open-etp-server` (GitLab project 828)
   - Follow existing patterns: `DiscoProto.cpp`, `StoreProto.cpp`, `ArrayProto.cpp`, `TransProto.cpp`
   - Add protocol IDs to `ServerConfig.cpp` `m_supportedProtocols` list (~line 300)
   - Add factory cases in `protocol_factory_` lambda (~line 310)
2. **ETP Client**: Restore handler files from git history and re-register in `ResqmlClient.ts`
3. **REST Routes**: Restore route methods and DTOs in `Query.controller.ts`
4. **Tests**: Restore `TestProtocols.ts` from git history
5. **Bruno**: Restore `.bru` files from git history
6. **Docs**: Update `ReleaseNotes.md`, rddmscg docs
