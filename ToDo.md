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

---

# ToDo: Manifest Builder – Remaining Issues

Migrated from `ores/demo/drogonresqml/MANIFEST_BUILDER_DEFICIENCIES.md` (2026-05-20).
Issues §1–§6, §8–§10 resolved as of 2026-08-30.

## Open

### WellLog depth range not populated
- `TopMeasuredDepth` / `BottomMeasuredDepth` / `SamplingInterval` are `null`
- Root cause: `extractDepthRange()` reads NodeMd subarrays via ETP `GetDataSubarray` which fails silently on some servers (fesapi returns empty or errors swallowed by catch block)
- Fix options:
  1. Fall back to scanning attached ContinuousProperty min/max for the depth/MD curve
  2. Read the full NodeMd array instead of subarrays (first/last element)
  3. Add error logging in the catch block to diagnose ETP failures

### SpatialArea / bounding box incomplete (was §7)
- Only 9/145 WPCs have `SpatialArea` (StructureMaps via Grid2d geometry)
- Missing on: IjkGrid, WellboreTrajectory, PolylineSet, PointSet, WellLog, GenericProperty
- Requires CRS → WGS84 coordinate transformation for proper `Wgs84Coordinates`
- At minimum: populate local XY extent from representation geometry

### Reservoir MasterData not synthesized
- `GeobodyInterpretation` converter exists (→ WPC) but does not create `master-data--Reservoir` side-effect
- Pattern: same as BoundaryFeature/Well/Wellbore — deterministic SRN, dedup via `getOSDUResourceVersion`
- Need Generated types for `Reservoir.2.0.0` / `ReservoirSegment.2.0.0` or use `ResqmlResource<any>`
- Drogon EPC currently lacks GeobodyInterpretation objects — must be added to EPC builder first

### P02/P03 PropertyKind validation errors in Drogon source data
- 23× P02: `"volume per volume"` is abstract — should use concrete descendant (e.g. `"porosity"`)
- 9× P02: `"dimensionless"` is abstract
- 9× P03: DiscreteProperty uses continuous-hierarchy kind `"length"`
- Fix in EPC builder (`build_drogon_demo_epc.py`): assign concrete PropertyKind names

### RESQML 2.2 coverage
- Current converters focus on RESQML 2.0.1; 2.2 variants exist for some types but untested end-to-end
- `maap/drogon22` dataspace on interop needs validation + manifest build test
