# RDDMS M27 Preship — Test Results and Ops Notes

Integration test results and deployment notes for the OSDU Reservoir DDMS **M27 preship** instance.

---

## Action Items for CIMPL Team

### 1. Add Reservoir DDMS Postman collection to the QA preship suite

The Reservoir DDMS Postman collection needs to be included in the official OSDU QA preship CI/CD suite alongside the other DDMS collections (Wellbore, Seismic, etc.).

**Collection files** (on `main`):
- Collection: [`RDDMS_M27.postman_collection.json`](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-client/-/blob/main/RDDMS_M27.postman_collection.json)
- Environment: [`RDDMS_M27_CIMPL_Preship.postman_environment.json`](https://community.opengroup.org/osdu/platform/domain-data-mgmt-services/reservoir/open-etp-client/-/blob/main/RDDMS_M27_CIMPL_Preship.postman_environment.json)

**Target location** in the QA repo: `osdu/qa/Postman Collection/45_CICD_Reservoir_DDMS`

The collection follows the same auth pattern as the other DDMS collections:
- Folder 0 fetches token via `POST {{Token_Fetch_URL}}` with `refresh_token` grant
- 50 requests in 14 numbered folders (0–13), self-contained setup → test → cleanup
- Only requires `refresh_token` secret; all other variables are in the environment file
- All write/delete operations target a dedicated test dataspace — does not touch shared data

### 2. Fix ETP Server Istio VirtualService path rewrite

The ETP WebSocket server at `/api/reservoir-ddms-etp/v2/` is deployed and the REST API connects to it internally (`readiness` returns `true`), but **HTTP requests to `.well-known/etp-server-capabilities` return 404** because the Istio VirtualService path rewrite is not applied.

See [detailed diagnosis](#etp-server-well-known-endpoint-unreachable) below.

### 3. Add OpenAPI spec path to Istio AuthorizationPolicy

The OpenAPI/Swagger JSON spec at `/api/reservoir-ddms/v2-json` returns **404** from the Istio gateway — the request never reaches the application. This is the same class of issue Rene fixed for the Secret service by adding explicit paths to the `AuthorizationPolicy`:

```yaml
# Needed in the RDDMS AuthorizationPolicy (similar to secret-jwt-authz fix):
- to:
  - operation:
      paths:
      - /api/reservoir-ddms/v2-json
      - /api/reservoir-ddms/v2          # Swagger UI
```

The app serves the spec correctly when reached directly — only the Istio layer blocks it.

### 4. Entitlements for test dataspace creation

The `cimpl-users` token lacks entitlements to create dataspaces (`POST /dataspaces` returns 403). The Postman and Bruno collections create a dedicated test dataspace during setup and delete it during cleanup. Without create permissions, setup/cleanup tests pass with tolerance assertions but cannot fully exercise the write path.

---

## Preship Instance

| Property | Value |
|---|---|
| **Host** | `qa.osdu-m27.osdu-cimpl.opengroup.org` |
| **REST API path** | `/api/reservoir-ddms/v2` |
| **ETP path** | `/api/reservoir-ddms-etp/v2/` |
| **Server version** | `1.3.0` |
| **Auth** | Keycloak `refresh_token` grant, client `cimpl-users` (public) |
| **Data partition** | `osdu` |
| **Routes** | 43 of 45 from `og/main` |

Missing routes (merged to `og/main` after M27 build):
- `POST /dataspaces/{dataspaceId}/validate`
- `POST /dataspaces/{dataspaceId}/epc/upload`

## Running the Tests

### Bruno collection (`bruno/`)

```bash
cd bruno/

# Set your refresh token (obtain from Keycloak)
REFRESH_TOKEN="<your-refresh-token>"

TOKEN=$(curl -s -X POST \
  "https://keycloak-qa.osdu-m27.osdu-cimpl.opengroup.org/realms/osdu/protocol/openid-connect/token" \
  -d "grant_type=refresh_token&client_id=cimpl-users&refresh_token=${REFRESH_TOKEN}&scope=email openid profile" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Run all folders
for folder in _Setup Health Auth Metrics Dataspaces Resources Arrays Query \
              PWLS WITSML Wells Transactions Manifest _Cleanup; do
  npx @usebruno/cli run "$folder" --env Preship --env-var "access_token=$TOKEN"
done
```

## Test Results (2026-08-29)

### Postman Collection — `RDDMS_M27.postman_collection.json`

**Reservoir DDMS CI-CD v4.0** — 50 requests in 14 numbered folders.

Aligned with the official OSDU QA preship collection pattern (`osdu/qa/Postman Collection/45_CICD_Reservoir_DDMS`).

| # | Folder | Items | Description |
|---|---|---|---|
| 0 | Auth | 1 | Get Access Token |
| 1 | Health Check | 4 | Server Info, Liveness, Readiness, Converters |
| 2 | Setup | 7 | Legal tag, Create DS, Verify, Start Txn, Put Objects, Put Arrays, Commit |
| 3 | Read Resources | 10 | Dataspace Info, List Types, List All, By Type, Get JSON/XML, Sources, Targets, Multi-Get, Deleted |
| 4 | Graph APIs | 3 | Full Graph, Graph Sources, Graph Targets |
| 5 | Array APIs | 3 | List Arrays, Get Content, Get Metadata |
| 6 | Query APIs | 2 | Find Objects, Batch Graph Search |
| 7 | Transaction Rollback | 4 | Start, Put, Rollback, Verify Not Found |
| 8 | Lock/Unlock/Errors | 7 | Lock, Attempt Delete, Verify, Unlock, Re-Unlock, Wrong DS 404, No-Auth 401 |
| 9 | Manifest Build | 1 | Build Manifest (with WPC dedup validation) |
| 10 | PWLS | 3 | Status, Resolve Mnemonic, Validate Curves |
| 11 | WITSML | 2 | List Objects, Query |
| 12 | Wells | 1 | Search Wells |
| 13 | Cleanup | 2 | Delete Test DS, Verify |

**Auth flow** — matches the official preship pattern:
- Folder 0: `POST {{Token_Fetch_URL}}` with urlencoded body (`grant_type`, `CLIENT_ID`, `CLIENT_SECRET`, `Scope`, `refresh_token`)
- Test script captures `access_token`, `ACCESS_TOKEN`, and `id_token` into environment
- All subsequent requests use `Bearer {{access_token}}` header

**Environment variables required:**

| Variable | Example | Notes |
|---|---|---|
| `Token_Fetch_URL` | `https://keycloak-qa.osdu-m27.../token` | Token endpoint |
| `CLIENT_ID` | `cimpl-users` | Keycloak client |
| `CLIENT_SECRET` | *(empty for public clients)* | |
| `grant_type` | `refresh_token` | |
| `Scope` | `openid` | |
| `refresh_token` | *(secret)* | From Keycloak |
| `RDDMS_URL` | `https://qa.osdu-m27.../api/reservoir-ddms/v2` | RDDMS base URL |
| `LEGAL_URL` | `https://qa.osdu-m27.../api/legal/v1` | Legal service (for S1) |
| `data-partition-id` | `osdu` | |
| `domain` | `.group` | Entitlements group domain |

**Import:**
1. Import `RDDMS_M27.postman_collection.json` into Postman
2. Import `RDDMS_M27_CIMPL_Preship.postman_environment.json` (pre-filled for CIMPL M27)
3. Set `refresh_token` in environment variables (secret)
4. Run with Collection Runner — folders are numbered for correct execution order

### Bruno Collection — `bruno/` with Preship environment

**52 requests, 52 passed, 66/66 tests green** across 14 folders.

| Folder | Requests | Tests | Status |
|---|---|---|---|
| _Setup | 6 | 7/7 | ✓ PASS |
| Health | 4 | 6/6 | ✓ PASS |
| Auth | 1 | 1/1 | ✓ PASS |
| Metrics | 1 | 1/1 | ✓ PASS |
| Dataspaces | 7 | 8/8 | ✓ PASS |
| Resources | 11 | 14/14 | ✓ PASS |
| Arrays | 4 | 4/4 | ✓ PASS |
| Query | 6 | 9/9 | ✓ PASS |
| PWLS | 4 | 4/4 | ✓ PASS |
| WITSML | 3 | 3/3 | ✓ PASS |
| Wells | 1 | 2/2 | ✓ PASS |
| Transactions | 3 | 4/4 | ✓ PASS |
| Manifest | 1 | 2/2 | ✓ PASS |
| _Cleanup | 2 | 3/3 | ✓ PASS |

### Known server-side limitations (not bugs)

| Route | Status | Notes |
|---|---|---|
| Query/Find Resources | 501 | ETP server does not support DiscoveryQuery (13) |
| Query/Channel Metadata | 501 | ETP server does not support ChannelSubscribe (21) |
| Query/Growing Object * | 501 | ETP server does not support GrowingObject (6) |
| Dataspaces/Create | 403 | `cimpl-users` token lacks dataspace-creation entitlements |

---

## ETP Server `.well-known` Endpoint Unreachable

### Summary

The ETP WebSocket server at `/api/reservoir-ddms-etp/v2/` is deployed and the **REST API connects to it internally** (`readiness` returns `true`), but **HTTP requests to `.well-known/etp-server-capabilities` return 404** because the Istio VirtualService path rewrite is not working.

### Evidence

| Test | Result | Interpretation |
|---|---|---|
| `wss://.../api/reservoir-ddms-etp/v2/` (WebSocket upgrade) | **HTTP 412** | ETP server IS alive and reachable |
| `GET /api/reservoir-ddms-etp/v2/.well-known/etp-server-capabilities` | **404**, body: `Unknown resource: /api/reservoir-ddms-etp/v2/.well-known/...`, header `x-envoy-upstream-service-time: 1` | Request reaches upstream but with un-rewritten path |
| `GET /api/reservoir-ddms/v2/health/readiness` | **200** `true` | REST API confirms internal ETP connection works |
| `GET /api/totally-fake-service/` | **404**, no body, no `x-envoy-upstream-service-time` | Pure Istio rejection (no route) |

### Root cause

The VirtualService in `open-etp-server/devops/core-plus/deploy/templates/virtual-service.yaml` defines:

```yaml
http:
  - match:
      - uri:
          prefix: "/api/reservoir-ddms-etp/v2/"
    rewrite:
      uri: /
    route:
      - destination:
          port:
            number: 9002
          host: "oetp-server.{namespace}.svc.cluster.local"
```

The `rewrite: uri: /` should strip the prefix so that `GET /api/reservoir-ddms-etp/v2/.well-known/etp-server-capabilities` arrives at the ETP server as `GET /.well-known/etp-server-capabilities`. However, on M27 preship the 404 body contains the **original un-rewritten path**, meaning the rewrite is not being applied.

### What to check

1. **Verify the deployed VirtualService** matches the repo version:
   ```bash
   kubectl get virtualservice oetp-server -n <namespace> -o yaml
   ```
   Check that the `rewrite.uri` field is present and set to `/`.

2. **Check if the ETP server pod is healthy**:
   ```bash
   kubectl get pods -n <namespace> -l app=oetp-server
   kubectl logs -n <namespace> -l app=oetp-server --tail=50
   ```

3. **Test internally** (from within the cluster):
   ```bash
   kubectl exec -n <namespace> <any-pod> -- \
     curl -s http://oetp-server:9002/.well-known/etp-server-capabilities?GetVersion=etp12.energistics.org
   ```

### Architecture reference

```
                      ┌─ /api/reservoir-ddms/v2/*     → oetp-client:8003  (REST API, works ✓)
Browser → Istio GW ──┤
                      └─ /api/reservoir-ddms-etp/v2/* → oetp-server:9002  (ETP, rewrite broken ✗)
                                                          ↑
                                              oetp-client connects internally via ws://oetp-server:9002/ (works ✓)
```

### CI/CD reference

The CI pipeline in `open-etp-server/devops/core-plus/pipeline/override-stages.yml` connects via:
```bash
openETPServer $* -S wss://${HOST#https://}/api/reservoir-ddms-etp/v2/ \
  --auth bearer --jwt-token ${ACCESS_TOKEN} --data-partition-id ${DATA_PARTITION_ID}
```

The path `/api/reservoir-ddms-etp/v2/` is the correct external URL — the issue is the M27 preship Istio configuration.

---

## Available Dataspaces (preship)

| Dataspace | Resources | Size | Locked | Notes |
|---|---|---|---|---|
| `maap/drogon201` | 0 | 232 kB | No | Empty, stuck transaction prevents deletion |
| `maap/drogon201b` | 28 | 73 MB | **Yes (stuck)** | Primary dataset — used by Postman and Bruno read-only tests (`{{dataspaceId}}`) |
| `maap/drogon201c` | 28 | 648 kB | No | Fresh clone of 201b (objects only, arrays not yet copied) |
| `maap/drogon220b` | — | 45 MB | No | RESQML 2.2 dataset |
