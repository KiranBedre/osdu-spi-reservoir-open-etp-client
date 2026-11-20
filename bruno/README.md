# Bruno collection — REST → ETP gateway route tests

[Bruno](https://www.usebruno.com/) collection covering every route the gateway
exposes, from the generic dataspace/resource CRUD to the Drogon real-data
lifecycle. The collection is the CI gate for `devops/osdu/build/open-etp-client.yml`
(`bruno-integration-test`) and is meant to be run exactly the same way locally.

## Running

```sh
# 1. local stack: postgres + open-etp-server + init container that seeds demo/Drogon
npm run docker:compose:start
npm run start                                    # REST gateway on :8003

# 2. token + environment overrides (single-partition dev token)
export BRU_ENV="--env CI \
  --env-var access_token=$(curl -s http://localhost:8003/Reservoir/v2/auth/token | node -pe 'JSON.parse(require("fs").readFileSync(0)).token') \
  --env-var RESERVOIR_DDMS_HOST=http://localhost:8003/Reservoir/v2 \
  --env-var graphqlHost=http://localhost:8003/graphql \
  --env-var DATA_PARTITION_ID=osdu \
  --env-var ENTITLEMENTS_DOMAIN=example.com"

# 3. everything (one `bru run`, per-folder summary, non-zero exit on any failure)
devops/scripts/run-bruno-suites.sh reports

# or a subset — _Setup first is mandatory, _Cleanup last is good manners
devops/scripts/run-bruno-suites.sh reports _Setup Drogon _Cleanup
```

`run-bruno-suites.sh` runs all requested folders in **one** `bru run` invocation:
runtime variables captured by `_Setup` (store capabilities, seeded guids, array
paths, transaction ids) are only visible to later folders inside the same
invocation. Reports: `bruno-report.{xml,html,json}` + `bruno-run.log`.

The GUI works the same way: run `_Setup/` once, then any folder, then `_Cleanup/`.

## Dataspace contract

The environment (`environments/*.bru`) is the **single source of truth** for every
dataspace a request may touch. No request may reassign these variables; folders
that need their own dataspace create, use and delete *their* id and nothing else.

| Variable (`…Id` = URL-encoded, `…IdRaw` = plain) | Default         | Owner / lifecycle                                                                                   |
| ------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `seededDataspaceId`                               | `demo/Drogon`   | Seeded by the compose init container (`RDMS_SEED_DATASPACE`) or the target environment. **Read-only**: Seeded, Query, Resources, Cypher, Sparql, Semantic, Manifest, Wells, WITSML/Query\*, Dataspaces copy source. |
| `testDataspaceId`                                 | `test/bruno`    | Created by `_Setup`, filled with the minimal RESQML seed (CRS + PointSet + array), deleted by `_Cleanup`. Write targets: Arrays, Write, Seismic, Grids, WITSML/Store\*, Dataspaces export/validate/clone source. |
| `crudDataspaceId`                                 | `test/bruno-crud`  | Dataspaces folder only: create → lock/unlock → mappings → delete.                                 |
| `cloneDataspaceId`                                | `test/bruno-clone` | Dataspaces folder: clone of `testDataspaceId`, deleted again, then the source is unlocked.        |
| `copyDataspaceId`                                 | `test/bruno-copy`  | Dataspaces folder: `?intoExisting` copy target of `seededDataspaceId`, deleted, source unlocked.  |
| `drogonDataspaceId`                               | `test/Drogon`   | Drogon folder: self-contained real-data lifecycle (upload EPC+H5 → read → compute → write → delete). |
| `witsmlDataspaceId`                               | `test/witsml`   | WitsmlGrowing folder: synthetic Well + Trajectory, growing-object reads, delete.                    |
| `prodmlDataspaceId`                               | `test/prodml`   | PRODML folder: TimeSeries / DTS array extracts, delete.                                             |

`_Cleanup/CL2 Verify Cleanup` asserts that none of the non-seeded ids is still
listed, so a folder that leaks its dataspace fails the run.

Cloning (plain or `intoExisting`) shares arrays by reference: the **source stays
locked while the clone exists**. Folders that clone therefore delete the clone
and then `DELETE /dataspaces/{source}/lock` (Dataspaces seq 5–6 and 9–10).

## Store capabilities

`_Setup/S1 Store Capabilities` records what the store advertises
(`storeProtocols`, `storeArrayExtensions`, `storeVersion`). Tests for optional
features read those variables instead of hard-coding a server version:

- ETP GrowingObject (6): `WitsmlGrowing/W05–W06` expect 200 when supported, else
  the gateway's `501 … does not support GrowingObject (6)`.
- Server-side array arithmetic (`arith` extension): `Drogon/D79` expects a 200
  summary when advertised, else `501 … does not support server-side array arithmetic`.
- Baseline protocols 0/3/4/9/18 and the `stats,histogram,reduce,where,wheren`
  extensions are mandatory.

## Auto-import Activities

With the store default `--check-activities true`, every commit is wrapped in a
generated `Scenario_automated_import_<ts>` Activity referencing the written
objects. Deleting such an object directly answers `412` (`rel_dst_id_fkey`).
Requests that delete objects first discover and delete the Activity
(`Write/Find Surface Referrers` + `Delete Import Activity`, `Drogon/D26–D27`).

## Fixture

`data/Demo_Drogon.epc` + `data/drogon_small.h5` (186 objects, 158 arrays, 2×2×2
IJK grid) is the only committed dataset. The compose init container imports it
into `demo/Drogon`; the Drogon folder uploads the same two files into
`test/Drogon`. The `.h5` file name must match the `.rels` of the EPC — do not rename.

## Environments

| Name      | Target                                   | Token                                |
| --------- | ---------------------------------------- | ------------------------------------ |
| `CI`      | compose stack via `--env-var` overrides  | `GET /auth/token` dev JWT            |
| `Local`   | `http://localhost:8003/Reservoir/v2`     | `GET /auth/token` dev JWT            |
| `Preship` | CIMPL preship (Keycloak)                 | refresh-token flow (`collection.bru`) |
| `Interop` / `Azure` | ADME / Azure tenants           | refresh-token / client-credentials   |

Secrets (`token_url`, `client_id`, `refresh_token`, …) are `vars:secret` and never
committed; `collection.bru` refreshes the access token when they are present.
