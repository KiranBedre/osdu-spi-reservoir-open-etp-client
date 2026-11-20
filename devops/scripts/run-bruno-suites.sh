#!/usr/bin/env bash
# Run the Bruno collection against a local/CI REST server in ONE `bru run`
# invocation (so runtime vars captured by _Setup - store capabilities, seeded
# guids, transaction ids - are visible to every later folder) and print a
# per-folder summary. Used by CI (devops/osdu/build/open-etp-client.yml) and
# locally:
#
#   BRU_ENV="--env CI --env-var access_token=$TOKEN" \
#     devops/scripts/run-bruno-suites.sh <report-dir> [folder ...]
#
# Env:
#   BRU_ENV          extra `bru run` args (env name + --env-var overrides); required
#   BRUNO_DIR        collection dir (default: bruno)
#   GATED_FOLDERS    space-separated folders whose failure makes the script exit 1
#                    (default: every folder that was run)
#
# Run order: _Setup first, _Cleanup last, everything else alphabetically.
set -uo pipefail

REPORT_DIR="${1:?usage: $0 <report-dir> [folder ...]}"
shift || true
BRUNO_DIR="${BRUNO_DIR:-bruno}"
: "${BRU_ENV:?BRU_ENV must be set (e.g. --env CI --env-var access_token=...)}"

mkdir -p "$REPORT_DIR"
REPORT_DIR="$(cd "$REPORT_DIR" && pwd)"

cd "$BRUNO_DIR"
if [ $# -eq 0 ]; then
  set -- _Setup $(ls -d */ | sed 's#/##' | grep -vE '^(_Setup|_Cleanup|environments)$' | sort) _Cleanup
fi
GATED_FOLDERS="${GATED_FOLDERS:-$*}"

folders=()
for folder in "$@"; do
  [ -d "$folder" ] || { echo "skip $folder (no such folder)"; continue; }
  folders+=("$folder")
done

# shellcheck disable=SC2086
bru run "${folders[@]}" $BRU_ENV \
  --reporter-junit "$REPORT_DIR/bruno-report.xml" \
  --reporter-html  "$REPORT_DIR/bruno-report.html" \
  --reporter-json  "$REPORT_DIR/bruno-report.json" \
  > "$REPORT_DIR/bruno-run.log" 2>&1
tail -n 12 "$REPORT_DIR/bruno-run.log"

python3 - "$REPORT_DIR/bruno-report.json" "$GATED_FOLDERS" "${folders[@]}" <<'EOF'
import json, sys
report, gated, folders = sys.argv[1], set(sys.argv[2].split()), sys.argv[3:]
try:
    runs = json.load(open(report))
except Exception as e:  # bru crashed before writing a report
    print(f"no report ({e})"); sys.exit(1)

def blank():
    return {"requests": 0, "errors": 0, "tests_failed": 0, "asserts_failed": 0, "failing": []}

per = {f: blank() for f in folders}
for run in runs:
    for r in run.get("results", []):
        name = (r.get("test") or {}).get("filename") or r.get("suitename") or ""
        p = per.setdefault(name.split("/")[0], blank())
        p["requests"] += 1
        status = (r.get("response") or {}).get("status")
        err = bool(r.get("error")) or status is None
        tf = sum(1 for t in r.get("testResults", []) if t.get("status") != "pass")
        af = sum(1 for a in r.get("assertionResults", []) if a.get("status") != "pass")
        p["errors"] += err
        p["tests_failed"] += tf
        p["asserts_failed"] += af
        if err or tf or af:
            p["failing"].append(f"{name} [{status}]")

print("=== Bruno folder summary ===")
rc = 0
for f in folders:
    p = per[f]
    ok = not (p["errors"] or p["tests_failed"] or p["asserts_failed"])
    if not ok and f in gated:
        rc = 1
    print(f'{f:<14} {"PASS" if ok else "FAIL":<4} requests={p["requests"]:<3} errors={p["errors"]:<3} '
          f'tests_failed={p["tests_failed"]:<3} asserts_failed={p["asserts_failed"]:<3}'
          + ("" if f in gated else "  (not gated)"))
    for n in p["failing"]:
        print(f"    - {n}")
print("gated:", " ".join(sorted(gated)))
print("RESULT:", "all gated folders passed" if rc == 0 else "gated folder(s) failed")
sys.exit(rc)
EOF
