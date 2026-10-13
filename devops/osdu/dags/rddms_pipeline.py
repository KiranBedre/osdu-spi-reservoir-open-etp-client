# ============================================================================
# Copyright 2024 Open Group. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ============================================================================
"""
RDDMS end-to-end pipeline DAG - generic, step-toggleable.

A single OSDU-compatible DAG that drives the open-etp-client (RDDMS) REST API
through the full ingest lifecycle. Every stage is independently switchable via
``dag_run.conf``, so the *same* DAG covers many scenarios without being tied to
any particular dataset:

    create dataspace -> upload EPC -> validate -> build manifest -> ingest

Trigger via the Workflow Service (or the Airflow REST API):

    POST /api/workflow/v1/workflow/Rddms_pipeline/workflowRun
    {
      "executionContext": {
        "dataspace": "myteam/project1",
        "epc": "/shared/incoming/model.epc",
        "h5":  "/shared/incoming/model.h5",
        "steps": { "validate": false }           # omit validation
      }
    }

Scenario recipes (everything not listed uses the defaults below):

  * Full pipeline from a file (worker-local path or http(s) URL):
        { "dataspace": "team/p1", "epc": "...", "h5": "..." }

  * Ingest an EXISTING dataspace to the catalog (no EPC, no upload):
        { "dataspace": "team/p1",
          "steps": { "createDataspace": false, "uploadEpc": false,
                     "validate": false } }
        -> only build_manifest + ingest_records run.

  * Upload + ingest but SKIP validation:
        { "dataspace": "team/p1", "epc": "...", "steps": { "validate": false } }

  * Build manifest only (no catalog push):
        { "dataspace": "team/p1", "steps": { "ingest": false } }

  * Ingest via the Osdu_ingest workflow instead of a direct Storage PUT:
        { "dataspace": "team/p1", "epc": "...", "ingestMode": "workflow" }
        (ingestMode: "records" (default, direct Storage PUT) | "workflow")

  * Validate an existing dataspace only:
        { "dataspace": "team/p1",
          "steps": { "createDataspace": false, "uploadEpc": false,
                     "buildManifest": false, "ingest": false } }

Configuration precedence: ``dag_run.conf`` overrides Airflow Variables.

  Airflow Variables (defaults):
    RDDMS_URL           e.g. https://host/api/reservoir-ddms/v2   (etpclient base)
    OSDU_URL            e.g. https://host                         (Storage base)
    DATA_PARTITION_ID   e.g. osdu
    OSDU_TOKEN          bearer token (no "Bearer " prefix)
    LEGAL_TAGS          json list, e.g. ["osdu-public-legal-tag"]
    ACL_OWNERS          json list, e.g. ["data.default.owners@osdu..."]
    ACL_VIEWERS         json list, e.g. ["data.default.viewers@osdu..."]

Deployment: copy to the Airflow DAGs folder (or register via the Workflow
Service DAG-registration API).
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from datetime import timedelta
from typing import Any

import requests
from airflow import DAG
from airflow.exceptions import AirflowFailException, AirflowSkipException
from airflow.models import Variable
from airflow.operators.python import PythonOperator
from airflow.utils.dates import days_ago
from airflow.utils.trigger_rule import TriggerRule

logger = logging.getLogger(__name__)

DAG_ID = "Rddms_pipeline"
STORAGE_BATCH_SIZE = 500
MANIFEST_POLL_INTERVAL_S = 5
MANIFEST_POLL_TIMEOUT_S = 25 * 60
HTTP_TIMEOUT_S = 120

# Default on/off state for each stage. conf.steps overrides individual keys.
DEFAULT_STEPS = {
    "createDataspace": True,
    "uploadEpc": True,
    "validate": True,
    "buildManifest": True,
    "ingest": True,
}

default_args = {
    "owner": "rddms",
    "depends_on_past": False,
    "retries": 1,
    "retry_delay": timedelta(minutes=1),
    "execution_timeout": timedelta(minutes=45),
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _var(name: str, default: str = "") -> str:
    return Variable.get(name, default_var=default)


def _var_json(name: str, default: list | None = None) -> list:
    raw = Variable.get(name, default_var="")
    if not raw:
        return default or []
    try:
        val = json.loads(raw)
        return val if isinstance(val, list) else default or []
    except (ValueError, TypeError):
        return default or []


def _headers(cfg: dict, json_body: bool = True) -> dict:
    h = {
        "Authorization": f"Bearer {cfg['token']}",
        "data-partition-id": cfg["partition"],
    }
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def _require_step(cfg: dict, name: str) -> None:
    """Skip the current task (cleanly) when its stage is disabled in conf."""
    if not cfg["steps"].get(name, DEFAULT_STEPS.get(name, True)):
        raise AirflowSkipException(f"step '{name}' disabled in conf")


def _resolve_file(spec: str) -> tuple[str, bool]:
    """Return a local filesystem path for an EPC/H5 spec.

    Accepts a worker-local path (used as-is) or an http(s) URL (downloaded to a
    temp file). Returns (path, is_temp).
    """
    if spec.startswith(("http://", "https://")):
        suffix = os.path.splitext(spec.split("?")[0])[1] or ".bin"
        fd, path = tempfile.mkstemp(suffix=suffix)
        os.close(fd)
        with requests.get(spec, stream=True, timeout=HTTP_TIMEOUT_S) as r:
            r.raise_for_status()
            with open(path, "wb") as fh:
                for chunk in r.iter_content(chunk_size=1 << 20):
                    fh.write(chunk)
        return path, True
    if not os.path.isfile(spec):
        raise AirflowFailException(f"EPC/H5 file not found on worker: {spec}")
    return spec, False


# ---------------------------------------------------------------------------
# Stage: resolve config (always runs; feeds every other task)
# ---------------------------------------------------------------------------
def resolve_config(**context: Any) -> dict:
    conf = (context["dag_run"].conf or {})
    conf = conf.get("executionContext", conf)

    dataspace = conf.get("dataspace") or conf.get("dataspaceId")
    if not dataspace:
        raise AirflowFailException("conf.dataspace is required")

    steps = dict(DEFAULT_STEPS)
    steps.update(conf.get("steps") or {})
    # If no EPC is supplied, there is nothing to create/upload - auto-disable
    # those stages so "ingest an existing dataspace" needs no extra flags.
    if not conf.get("epc"):
        steps["uploadEpc"] = False
        if "createDataspace" not in (conf.get("steps") or {}):
            steps["createDataspace"] = False

    cfg = {
        "rddms_url": (conf.get("rddms_url") or _var("RDDMS_URL")).rstrip("/"),
        "osdu_url": (conf.get("osdu_url") or _var("OSDU_URL")).rstrip("/"),
        "partition": conf.get("partition") or _var("DATA_PARTITION_ID", "osdu"),
        "token": conf.get("token") or _var("OSDU_TOKEN"),
        "dataspace": dataspace,
        "epc": conf.get("epc"),
        "h5": conf.get("h5"),
        "steps": steps,
        "failOnInvalid": bool(conf.get("failOnInvalid", True)),
        # manifest build options (ManifestInputDto)
        "uris": conf.get("uris") or [f"eml:///dataspace('{dataspace}')"],
        "typePatterns": conf.get("typePatterns"),
        "propertyFilter": conf.get("propertyFilter"),
        "excludePatterns": conf.get("excludePatterns"),
        "createMissingReferences": conf.get("createMissingReferences"),
        "followReferences": conf.get("followReferences"),
        "tags": conf.get("tags"),
        # ACL / legal used to patch manifest records + dataspace CustomData
        "legalTags": conf.get("legalTags") or _var_json("LEGAL_TAGS"),
        "acl": conf.get("acl") or {
            "owners": _var_json("ACL_OWNERS"),
            "viewers": _var_json("ACL_VIEWERS"),
        },
        "countries": conf.get("countries") or ["US"],
        # ingest target: 'records' (direct Storage PUT) or 'workflow'
        # (submit manifest to the Osdu_ingest Airflow DAG via Workflow Service)
        "ingestMode": (conf.get("ingestMode") or "records").lower(),
        "ingestWorkflow": conf.get("ingestWorkflow") or "Osdu_ingest",
        # ingest may run against a pre-supplied manifest (build skipped)
        "manifest": conf.get("manifest"),
    }

    if not cfg["rddms_url"]:
        raise AirflowFailException("RDDMS_URL not set (Variable or conf.rddms_url)")
    if not cfg["token"]:
        raise AirflowFailException("OSDU_TOKEN not set (Variable or conf.token)")

    logger.info(
        "Pipeline for dataspace '%s' - stages: %s",
        dataspace,
        {k: v for k, v in steps.items()},
    )
    return cfg


# ---------------------------------------------------------------------------
# Stage: create dataspace
# ---------------------------------------------------------------------------
def create_dataspace(**context: Any) -> dict:
    cfg = context["ti"].xcom_pull(task_ids="resolve_config")
    _require_step(cfg, "createDataspace")

    body = [{
        "DataspaceId": cfg["dataspace"],
        "Path": cfg["dataspace"],
        "CustomData": {
            "owners": cfg["acl"].get("owners", []),
            "viewers": cfg["acl"].get("viewers", []),
            "legaltags": cfg["legalTags"],
            "otherRelevantDataCountries": cfg["countries"],
        },
    }]
    url = f"{cfg['rddms_url']}/dataspaces"
    resp = requests.post(url, headers=_headers(cfg), json=body, timeout=HTTP_TIMEOUT_S)
    if resp.status_code in (200, 201):
        logger.info("Dataspace created: %s", cfg["dataspace"])
    elif resp.status_code in (409, 422):
        logger.info("Dataspace already exists (ignored): %s", cfg["dataspace"])
    else:
        resp.raise_for_status()
    return {"dataspace": cfg["dataspace"], "status": resp.status_code}


# ---------------------------------------------------------------------------
# Stage: upload EPC (+optional H5)
# ---------------------------------------------------------------------------
def upload_epc(**context: Any) -> dict:
    cfg = context["ti"].xcom_pull(task_ids="resolve_config")
    _require_step(cfg, "uploadEpc")
    if not cfg["epc"]:
        raise AirflowFailException("steps.uploadEpc is on but conf.epc is missing")

    epc_path, epc_tmp = _resolve_file(cfg["epc"])
    h5_path, h5_tmp = (None, False)
    if cfg["h5"]:
        h5_path, h5_tmp = _resolve_file(cfg["h5"])

    url = f"{cfg['rddms_url']}/dataspaces/{cfg['dataspace']}/epc/upload"
    files = []
    fhs = []
    try:
        fe = open(epc_path, "rb")
        fhs.append(fe)
        files.append(("epc", (os.path.basename(epc_path), fe, "application/octet-stream")))
        if h5_path:
            fh = open(h5_path, "rb")
            fhs.append(fh)
            files.append(("h5", (os.path.basename(h5_path), fh, "application/octet-stream")))
        resp = requests.post(
            url, headers=_headers(cfg, json_body=False), files=files,
            timeout=max(HTTP_TIMEOUT_S, 600),
        )
        resp.raise_for_status()
    finally:
        for fh in fhs:
            fh.close()
        if epc_tmp:
            os.unlink(epc_path)
        if h5_tmp and h5_path:
            os.unlink(h5_path)

    try:
        out = resp.json()
    except ValueError:
        out = {"status": resp.status_code}
    logger.info("EPC uploaded to %s", cfg["dataspace"])
    return out


# ---------------------------------------------------------------------------
# Stage: validate (open-etp-client validate route - NOT a local validator)
# ---------------------------------------------------------------------------
def validate_dataspace(**context: Any) -> dict:
    cfg = context["ti"].xcom_pull(task_ids="resolve_config")
    _require_step(cfg, "validate")

    url = f"{cfg['rddms_url']}/dataspaces/{cfg['dataspace']}/validate"
    resp = requests.post(url, headers=_headers(cfg), timeout=max(HTTP_TIMEOUT_S, 90))
    resp.raise_for_status()
    report = resp.json()
    logger.info(
        "Validation: is_valid=%s objects=%s errors=%s warnings=%s",
        report.get("is_valid"), report.get("object_count"),
        report.get("error_count"), report.get("warning_count"),
    )
    if cfg["failOnInvalid"] and not report.get("is_valid", False):
        sample = (report.get("errors") or [])[:5]
        raise AirflowFailException(
            f"Dataspace '{cfg['dataspace']}' failed validation: "
            f"{report.get('error_count')} errors. Sample: {json.dumps(sample)[:800]}"
        )
    return report


# ---------------------------------------------------------------------------
# Stage: build manifest (async job + poll)
# ---------------------------------------------------------------------------
def _patch_manifest(manifest: dict, cfg: dict) -> dict:
    """Stamp ACL / legal / partition onto every record (best effort)."""
    acl = {"owners": cfg["acl"].get("owners", []), "viewers": cfg["acl"].get("viewers", [])}
    legal = {"legaltags": cfg["legalTags"], "otherRelevantDataCountries": cfg["countries"]}

    def stamp(rec: dict) -> None:
        if not isinstance(rec, dict):
            return
        if acl["owners"] or acl["viewers"]:
            rec.setdefault("acl", {}).update(acl)
        if cfg["legalTags"]:
            rec.setdefault("legal", {}).update(legal)

    data = manifest.get("Data", {}) or {}
    for key in ("Datasets", "WorkProductComponents"):
        for rec in data.get(key) or []:
            stamp(rec)
    if isinstance(data.get("WorkProduct"), dict):
        stamp(data["WorkProduct"])
    for key in ("MasterData", "ReferenceData"):
        for rec in manifest.get(key) or []:
            stamp(rec)
    return manifest


def build_manifest(**context: Any) -> dict:
    cfg = context["ti"].xcom_pull(task_ids="resolve_config")
    _require_step(cfg, "buildManifest")

    body: dict[str, Any] = {"uris": cfg["uris"], "async": True}
    for k in ("typePatterns", "propertyFilter", "excludePatterns",
              "createMissingReferences", "followReferences", "tags"):
        if cfg.get(k) is not None:
            body[k] = cfg[k]

    url = f"{cfg['rddms_url']}/manifests/build"
    resp = requests.post(url, headers=_headers(cfg), json=body, timeout=HTTP_TIMEOUT_S)
    resp.raise_for_status()

    if resp.status_code == 202:
        job = resp.json()
        job_id = job["jobId"]
        logger.info("Manifest build job %s started; polling...", job_id)
        deadline = time.time() + MANIFEST_POLL_TIMEOUT_S
        job_url = f"{cfg['rddms_url']}/manifests/jobs/{job_id}"
        while True:
            if time.time() > deadline:
                raise AirflowFailException(f"manifest job {job_id} timed out")
            time.sleep(MANIFEST_POLL_INTERVAL_S)
            jr = requests.get(job_url, headers=_headers(cfg), timeout=HTTP_TIMEOUT_S)
            jr.raise_for_status()
            jdoc = jr.json()
            status = jdoc.get("status")
            if status == "completed":
                manifest = jdoc.get("manifest")
                break
            if status == "failed":
                raise AirflowFailException(f"manifest job failed: {jdoc.get('error')}")
            logger.info("manifest job %s: %s", job_id, status)
    else:
        manifest = resp.json()

    if not isinstance(manifest, dict):
        raise AirflowFailException("manifest build returned no manifest body")
    manifest = _patch_manifest(manifest, cfg)
    wpc = len(manifest.get("Data", {}).get("WorkProductComponents") or [])
    logger.info("Manifest built: %d WPCs, %d MasterData, %d ReferenceData",
                wpc, len(manifest.get("MasterData") or []),
                len(manifest.get("ReferenceData") or []))
    return manifest


# ---------------------------------------------------------------------------
# Stage: ingest records to OSDU Storage
# ---------------------------------------------------------------------------
def _collect_records(manifest: dict) -> list[dict]:
    records: list[dict] = []
    data = manifest.get("Data", {}) or {}
    records.extend(data.get("Datasets") or [])
    records.extend(data.get("WorkProductComponents") or [])
    if isinstance(data.get("WorkProduct"), dict):
        records.append(data["WorkProduct"])
    records.extend(manifest.get("MasterData") or [])
    records.extend(manifest.get("ReferenceData") or [])
    return records


def ingest_records(**context: Any) -> dict:
    cfg = context["ti"].xcom_pull(task_ids="resolve_config")
    _require_step(cfg, "ingest")

    manifest = context["ti"].xcom_pull(task_ids="build_manifest")
    if not manifest:
        manifest = cfg.get("manifest")
    if not manifest:
        raise AirflowFailException(
            "ingest is on but no manifest available (build_manifest was skipped "
            "and conf.manifest not supplied)"
        )
    if not cfg["osdu_url"]:
        raise AirflowFailException("OSDU_URL not set (Variable or conf.osdu_url)")

    # Workflow mode: hand the whole manifest to the Osdu_ingest DAG and return.
    if cfg["ingestMode"] == "workflow":
        wf = cfg["ingestWorkflow"]
        url = f"{cfg['osdu_url']}/api/workflow/v1/workflow/{wf}/workflowRun"
        body = {
            "runId": f"{cfg['dataspace'].replace('/', '-')}-{int(time.time())}",
            "executionContext": {
                "Payload": {
                    "AppKey": "rddms-pipeline",
                    "data-partition-id": cfg["partition"],
                },
                "manifest": manifest,
            },
        }
        r = requests.post(url, headers=_headers(cfg), json=body,
                          timeout=max(HTTP_TIMEOUT_S, 120))
        r.raise_for_status()
        run = r.json()
        logger.info("Submitted manifest to workflow %s: runId=%s status=%s",
                    wf, run.get("runId"), run.get("status"))
        return {"status": "submitted", "workflow": wf,
                "runId": run.get("runId"), "workflowStatus": run.get("status")}

    records = _collect_records(manifest)
    if not records:
        logger.info("No records to ingest")
        return {"recordCount": 0, "status": "completed"}

    storage_url = f"{cfg['osdu_url']}/api/storage/v2/records"
    total, errors = 0, []
    for i in range(0, len(records), STORAGE_BATCH_SIZE):
        batch = records[i:i + STORAGE_BATCH_SIZE]
        n = i // STORAGE_BATCH_SIZE + 1
        try:
            r = requests.put(storage_url, headers=_headers(cfg), json=batch,
                             timeout=max(HTTP_TIMEOUT_S, 120))
            r.raise_for_status()
            total += r.json().get("recordCount", len(batch))
            logger.info("Batch %d: ok (%d records)", n, len(batch))
        except requests.exceptions.RequestException as e:
            errors.append(f"batch {n}: {e}")
            logger.error("Batch %d failed: %s", n, e)

    result = {
        "recordCount": total,
        "totalRecords": len(records),
        "status": "completed" if not errors else "partial",
        "errors": errors[:10] or None,
    }
    if errors:
        # surface a partial failure so the run is visibly degraded
        raise AirflowFailException(f"ingest partial: {total}/{len(records)} - {errors[:3]}")
    logger.info("Ingest complete: %d/%d", total, len(records))
    return result


# ---------------------------------------------------------------------------
# DAG wiring
# ---------------------------------------------------------------------------
with DAG(
    dag_id=DAG_ID,
    default_args=default_args,
    description="Generic RDDMS pipeline: create/upload/validate/build/ingest, each step toggleable via conf",
    schedule_interval=None,
    start_date=days_ago(1),
    catchup=False,
    tags=["rddms", "osdu", "pipeline", "ingest"],
    max_active_runs=5,
) as dag:

    t_cfg = PythonOperator(task_id="resolve_config", python_callable=resolve_config)

    # Downstream stages tolerate skipped predecessors: each also depends on
    # resolve_config (always succeeds), so none_failed_min_one_success holds
    # even when an earlier optional stage skipped itself.
    common = dict(trigger_rule=TriggerRule.NONE_FAILED_MIN_ONE_SUCCESS)

    t_create = PythonOperator(task_id="create_dataspace", python_callable=create_dataspace, **common)
    t_upload = PythonOperator(task_id="upload_epc", python_callable=upload_epc, **common)
    t_validate = PythonOperator(task_id="validate_dataspace", python_callable=validate_dataspace, **common)
    t_build = PythonOperator(task_id="build_manifest", python_callable=build_manifest, **common)
    t_ingest = PythonOperator(task_id="ingest_records", python_callable=ingest_records, **common)

    # Sequencing edge (order) ...
    t_cfg >> t_create >> t_upload >> t_validate >> t_build >> t_ingest
    # ... plus a min-one-success anchor so skips don't cascade into skips.
    t_cfg >> [t_upload, t_validate, t_build, t_ingest]
