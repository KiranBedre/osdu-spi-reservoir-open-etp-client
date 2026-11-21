#!/usr/bin/env bash
# Wait for a Reservoir DDMS REST endpoint to be ready, mint a dev JWT and wait
# for the seeded dataspace, then write a sourceable env file for the test
# runners (Bruno, newman, jest). Used by the CI integration jobs
# (devops/osdu/build/open-etp-client.yml) and locally:
#
#   devops/scripts/wait-for-rddms.sh http://localhost:8003/Reservoir/v2
#   . /tmp/rddms.env     # RDDMS_BASE_URL RDDMS_GRAPHQL_URL RDDMS_TOKEN
#
# Usage: wait-for-rddms.sh <base-url> [seeded-dataspace] [timeout-seconds]
#
# Env:
#   RDDMS_ENV_FILE   output file (default /tmp/rddms.env)
#
# The token comes from GET <base>/auth/token, the unauthenticated development
# route of RDMS_DATA_PARTITION_MODE=single deployments; it is a JWT signed with
# RDMS_JWT_SECRET, so the store accepts it as well.
set -uo pipefail

BASE_URL="${1:?usage: $0 <base-url> [seeded-dataspace] [timeout-seconds]}"
SEEDED="${2:-demo/Drogon}"
TIMEOUT="${3:-300}"
ENV_FILE="${RDDMS_ENV_FILE:-/tmp/rddms.env}"

BASE_URL="${BASE_URL%/}"
ORIGIN="$(python3 -c 'from urllib.parse import urlsplit; import sys; u=urlsplit(sys.argv[1]); print(f"{u.scheme}://{u.netloc}")' "$BASE_URL")"
GRAPHQL_URL="$ORIGIN/graphql"

deadline=$(( $(date +%s) + TIMEOUT ))
remaining() { echo $(( deadline - $(date +%s) )); }

echo "waiting for $BASE_URL/health/readiness ..."
until [ "$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$BASE_URL/health/readiness")" = "200" ]; do
  if [ "$(remaining)" -le 0 ]; then echo "REST readiness timed out"; exit 1; fi
  sleep 2
done
echo "REST ready"

TOKEN="$(curl -s -m 10 "$BASE_URL/auth/token" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])' 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then echo "could not mint a token from $BASE_URL/auth/token"; exit 1; fi
echo "token minted"

echo "waiting for seeded dataspace $SEEDED ..."
until curl -s -m 10 -H "Authorization: Bearer $TOKEN" "$BASE_URL/dataspaces" \
    | python3 -c 'import json,sys; ds=json.load(sys.stdin); sys.exit(0 if any(d.get("path")==sys.argv[1] for d in ds) else 1)' "$SEEDED" 2>/dev/null; do
  if [ "$(remaining)" -le 0 ]; then echo "seeded dataspace $SEEDED did not appear"; exit 1; fi
  sleep 5
done
echo "seeded dataspace $SEEDED present"

cat > "$ENV_FILE" <<EOF
export RDDMS_BASE_URL='$BASE_URL'
export RDDMS_GRAPHQL_URL='$GRAPHQL_URL'
export RDDMS_TOKEN='$TOKEN'
EOF
echo "wrote $ENV_FILE"
