#!/usr/bin/env bash
# ============================================================================
# Local Integration Tests for RDDMS
# Runs against a local docker ETP stack or interop ADME instance.
#
# Usage:
#   ./test-local-integration.sh                    # full pipeline: docker + test
#   ./test-local-integration.sh --skip-docker      # reuse running stack
#   ./test-local-integration.sh --interop          # test against interop ADME
#   ./test-local-integration.sh --interop manifest # interop, manifest tests only
#   ./test-local-integration.sh health             # pass filter to test runner
#
# Pipeline (local docker mode):
#   1. Build RDDMS from source (npx tsc)
#   2. Start docker ETP server + PostgreSQL (docker compose up)
#   3. Start local RDDMS REST server (node dist/...)
#   4. Sanitize & upload Drogon EPC
#   5. Validate dataspace
#   6. Run integration tests (test-preship-integration.sh with local overrides)
#   7. Build manifest
#   8. Tear down (optional)
#
# Prerequisites:
#   - Docker running with ETP server image pulled
#   - ~/ores/demo/drogonresqml/drogon.epc + drogon.h5
#   - For --interop: ~/ores/k8s/secret.yaml with interop credentials
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORES_DIR="$(realpath "$SCRIPT_DIR/../ores" 2>/dev/null || echo "$HOME/ores")"
COMPOSE_FILE="$ORES_DIR/demo/drogonresqml/docker-compose.yaml"
EPC_FILE="$ORES_DIR/demo/drogonresqml/drogon.epc"
H5_FILE="$ORES_DIR/demo/drogonresqml/drogon.h5"
SANITIZER="$ORES_DIR/demo/drogonresqml/sanitize_drogon_epc.py"

PORT=8080
DS="maap/drogon201"
DS_ENC="maap%2Fdrogon201"
PART="opendes"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

MODE="local"
SKIP_DOCKER=false
FILTER=""
RDDMS_PID=""

for arg in "$@"; do
    case "$arg" in
        --interop)   MODE="interop" ;;
        --skip-docker) SKIP_DOCKER=true ;;
        --help|-h)
            sed -n '2,/^# ====/p' "$0" | grep '^#' | sed 's/^# \?//'
            exit 0
            ;;
        *) FILTER="$arg" ;;
    esac
done

cleanup() {
    if [[ -n "$RDDMS_PID" ]]; then
        echo -e "${CYAN}Stopping RDDMS server (PID $RDDMS_PID)...${NC}"
        kill "$RDDMS_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT

# ─── Interop token helper ─────────────────────────────────────────────────── #
get_interop_token() {
    local secret_file="$ORES_DIR/k8s/secret.yaml"
    if [[ ! -f "$secret_file" ]]; then
        echo -e "${RED}Missing $secret_file${NC}" >&2
        exit 1
    fi
    local tenant_id client_id client_secret scope
    tenant_id=$(grep 'INSTANCE_INTEROP_TENANT_ID' "$secret_file" | head -1 | sed 's/.*: *"\?\([^"]*\)"\?/\1/')
    client_id=$(grep 'INSTANCE_INTEROP_CLIENT_ID' "$secret_file" | head -1 | sed 's/.*: *"\?\([^"]*\)"\?/\1/')
    client_secret=$(grep 'INSTANCE_INTEROP_CLIENT_SECRET' "$secret_file" | head -1 | sed 's/.*: *"\?\([^"]*\)"\?/\1/')
    scope=$(grep 'INSTANCE_INTEROP_SCOPE' "$secret_file" | head -1 | sed 's/.*: *"\?\([^"]*\)"\?/\1/')

    curl -sf -X POST "https://login.microsoftonline.com/$tenant_id/oauth2/v2.0/token" \
        -d "grant_type=client_credentials" \
        -d "client_id=$client_id" \
        -d "client_secret=$client_secret" \
        -d "scope=$scope" \
        | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])"
}

# ─── Step 1: Build ─────────────────────────────────────────────────────────── #
step() { echo -e "\n${BOLD}${CYAN}▸ $1${NC}"; }

if [[ "$MODE" == "local" ]]; then
    step "Building RDDMS from source"
    cd "$SCRIPT_DIR"
    npx tsc --skipLibCheck 2>&1 | tail -3
    echo -e "${GREEN}Build OK${NC}"

    # ─── Step 2: Docker stack ──────────────────────────────────────────────── #
    if [[ "$SKIP_DOCKER" == false ]]; then
        step "Starting docker ETP stack"
        docker compose -f "$COMPOSE_FILE" up -d postgres etp-server 2>&1 | tail -5
        echo "Waiting for ETP server health..."
        for i in $(seq 1 30); do
            if docker compose -f "$COMPOSE_FILE" ps etp-server 2>/dev/null | grep -q healthy; then
                echo -e "${GREEN}ETP server healthy${NC}"
                break
            fi
            sleep 2
            [[ $i -eq 30 ]] && { echo -e "${RED}ETP server failed to start${NC}"; exit 1; }
        done
    fi

    # ─── Step 3: Start local RDDMS ────────────────────────────────────────── #
    step "Starting local RDDMS REST server on port $PORT"
    kill -9 "$(lsof -t -i:$PORT 2>/dev/null)" 2>/dev/null || true
    sleep 1

    RDMS_ETP_HOST=localhost \
    RDMS_ETP_PORT=9002 \
    RDMS_ETP_PROTOCOL=ws \
    RDMS_ETP_PATH="" \
    RDMS_REST_PORT=$PORT \
    RDMS_REST_ROOT_PATH=/api/reservoir-ddms/v2/ \
    RDMS_DATA_PARTITION_MODE=single \
    RDMS_DATA_PARTITION_ID=$PART \
    RDMS_AUTH_MODE=none \
    RDMS_SSL_VERIFY=false \
    node dist/src/lib/restApi/RestServer.js > /tmp/rddms-local-test.log 2>&1 &
    RDDMS_PID=$!

    echo "Waiting for RDDMS (PID $RDDMS_PID)..."
    for i in $(seq 1 20); do
        if curl -sf "http://localhost:$PORT/api/reservoir-ddms/v2/health/liveness" >/dev/null 2>&1; then
            echo -e "${GREEN}RDDMS ready${NC}"
            break
        fi
        sleep 1
        [[ $i -eq 20 ]] && { echo -e "${RED}RDDMS failed to start. Log:${NC}"; tail -20 /tmp/rddms-local-test.log; exit 1; }
    done

    TOKEN="dummy"
    BASE="http://localhost:$PORT/api/reservoir-ddms/v2"

    # ─── Step 4: Sanitize & upload EPC ─────────────────────────────────────── #
    step "Sanitizing Drogon EPC"
    if [[ -f "$SANITIZER" ]]; then
        python3 "$SANITIZER" 2>&1 | tail -3
    else
        echo -e "${YELLOW}Sanitizer not found, skipping${NC}"
    fi

    step "Creating dataspace $DS"
    curl -sf -X POST "$BASE/dataspaces" \
        -H "data-partition-id: $PART" -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "[{\"DataspaceId\":\"$DS\",\"Path\":\"$DS\"}]" 2>/dev/null || true

    step "Uploading EPC + H5"
    if [[ -f "$EPC_FILE" && -f "$H5_FILE" ]]; then
        UPLOAD_RESULT=$(curl -sf -X POST "$BASE/dataspaces/$DS_ENC/epc/upload" \
            -H "data-partition-id: $PART" -H "Authorization: Bearer $TOKEN" \
            -F "epc=@$EPC_FILE" -F "h5=@$H5_FILE" 2>/dev/null || echo '{"error":"upload failed"}')
        STORED=$(echo "$UPLOAD_RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('objectsStored','?'))" 2>/dev/null || echo "?")
        echo -e "${GREEN}Objects stored: $STORED${NC}"
    else
        echo -e "${YELLOW}EPC/H5 files not found, skipping upload${NC}"
    fi

    # ─── Step 5: Validate ──────────────────────────────────────────────────── #
    step "Validating dataspace $DS"
    VALIDATE=$(curl -sf -X POST "$BASE/dataspaces/$DS_ENC/validate" \
        -H "data-partition-id: $PART" -H "Authorization: Bearer $TOKEN" 2>/dev/null || echo '{}')
    echo "$VALIDATE" | python3 -c "
import json, sys
r = json.load(sys.stdin)
v = r.get('is_valid', '?')
e = r.get('error_count', '?')
w = r.get('warning_count', '?')
o = r.get('object_count', '?')
print(f'  Valid: {v}  Errors: {e}  Warnings: {w}  Objects: {o}')
" 2>/dev/null || echo "  (validation unavailable)"

elif [[ "$MODE" == "interop" ]]; then
    step "Getting interop token"
    TOKEN=$(get_interop_token)
    echo -e "${GREEN}Token acquired (${#TOKEN} chars)${NC}"

    # Start local RDDMS pointing to interop ETP
    step "Starting local RDDMS → interop ETP"
    cd "$SCRIPT_DIR"
    npx tsc --skipLibCheck 2>&1 | tail -3

    kill -9 "$(lsof -t -i:$PORT 2>/dev/null)" 2>/dev/null || true
    sleep 1

    RDMS_ETP_HOST=admeinterop.energy.azure.com \
    RDMS_ETP_PORT=443 \
    RDMS_ETP_PROTOCOL=wss \
    RDMS_ETP_PATH=/api/reservoir-ddms-etp/v2 \
    RDMS_REST_PORT=$PORT \
    RDMS_REST_ROOT_PATH=/api/reservoir-ddms/v2/ \
    RDMS_DATA_PARTITION_MODE=single \
    RDMS_DATA_PARTITION_ID=$PART \
    RDMS_OSDU_URL=https://admeinterop.energy.azure.com \
    RDMS_AUTH_MODE=none \
    RDMS_SSL_VERIFY=false \
    node dist/src/lib/restApi/RestServer.js > /tmp/rddms-interop-test.log 2>&1 &
    RDDMS_PID=$!

    echo "Waiting for RDDMS (PID $RDDMS_PID)..."
    for i in $(seq 1 20); do
        if curl -sf "http://localhost:$PORT/api/reservoir-ddms/v2/health/liveness" >/dev/null 2>&1; then
            echo -e "${GREEN}RDDMS ready${NC}"
            break
        fi
        sleep 1
        [[ $i -eq 20 ]] && { echo -e "${RED}RDDMS failed to start${NC}"; tail -20 /tmp/rddms-interop-test.log; exit 1; }
    done

    BASE="http://localhost:$PORT/api/reservoir-ddms/v2"
fi

# ─── Step 6: Run integration tests ────────────────────────────────────────── #
step "Running integration tests"
export PRESHIP_BASE="$BASE"
export TOKEN
export PRESHIP_DS="$DS"

if [[ -f "$SCRIPT_DIR/test-preship-integration.sh" ]]; then
    bash "$SCRIPT_DIR/test-preship-integration.sh" ${FILTER:-all}
else
    echo -e "${YELLOW}test-preship-integration.sh not found, running basic checks${NC}"

    # Basic smoke tests
    echo -n "  Health: "
    curl -sf "$BASE/health/liveness" -H "Authorization: Bearer $TOKEN" >/dev/null && echo -e "${GREEN}OK${NC}" || echo -e "${RED}FAIL${NC}"

    echo -n "  Dataspaces: "
    COUNT=$(curl -sf "$BASE/dataspaces" -H "data-partition-id: $PART" -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
    echo -e "${GREEN}$COUNT${NC}"

    echo -n "  Resources: "
    COUNT=$(curl -sf "$BASE/dataspaces/$DS_ENC/resources" -H "data-partition-id: $PART" -H "Authorization: Bearer $TOKEN" | python3 -c "import json,sys; print(sum(o.get('count',0) for o in json.load(sys.stdin)))" 2>/dev/null || echo "?")
    echo -e "${GREEN}$COUNT objects${NC}"
fi

# ─── Step 7: Build manifest ───────────────────────────────────────────────── #
step "Building manifest from $DS"
URIS=$(curl -sf "$BASE/dataspaces/$DS_ENC/resources/all" \
    -H "data-partition-id: $PART" -H "Authorization: Bearer $TOKEN" 2>/dev/null \
    | python3 -c "import json,sys; r=json.load(sys.stdin); print(json.dumps({'uris':[o['uri'] for o in r]}))" 2>/dev/null)

if [[ -n "$URIS" ]]; then
    MANIFEST=$(curl -sf -X POST "$BASE/manifests/build" \
        -H "data-partition-id: $PART" -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "$URIS" 2>/dev/null)

    echo "$MANIFEST" | python3 -c "
import json, sys
r = json.load(sys.stdin)
data = r.get('Data', {})
wpcs = data.get('WorkProductComponents', [])
md = r.get('MasterData', [])
rd = r.get('ReferenceData', [])
ds = data.get('Datasets', [])
print(f'  WPCs: {len(wpcs)}, MasterData: {len(md)}, ReferenceData: {len(rd)}, Datasets: {len(ds)}')
print(f'  Total records: {len(wpcs)+len(md)+len(rd)+len(ds)}')
" 2>/dev/null || echo "  (manifest build failed)"

    # Save manifest for inspection
    echo "$MANIFEST" > /tmp/manifest_result.json 2>/dev/null
    echo "  Saved to /tmp/manifest_result.json"
else
    echo -e "${YELLOW}  No resources found, skipping manifest${NC}"
fi

echo -e "\n${BOLD}${GREEN}Done.${NC}"
