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
RDDMS Manifest Ingestion DAG — Osdu_ingest compatible.

This DAG processes an OSDU manifest produced by the RDDMS manifest builder
and ingests all records into the OSDU Storage Service. It follows the same
interface as the standard Osdu_ingest workflow so that it can be triggered
via the Workflow Service:

    POST /api/workflow/v1/workflow/Osdu_ingest/workflowRun
    {
      "executionContext": {
        "manifest": { ... }
      }
    }

The manifest is expected to be a standard OSDU Manifest:1.0.0 structure
containing Data (Datasets, WorkProductComponents, WorkProduct),
MasterData, and ReferenceData arrays.

Deployment:
  Copy this file to the Airflow DAGs folder on the OSDU Airflow instance,
  or register via the Workflow Service DAG registration API.
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any

from airflow import DAG
from airflow.operators.python import PythonOperator
from airflow.models import Variable
from airflow.utils.dates import days_ago

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration (from Airflow Variables or environment)
# ---------------------------------------------------------------------------
STORAGE_BATCH_SIZE = 500
DAG_ID = "Osdu_ingest_rddms"

default_args = {
    "owner": "rddms",
    "depends_on_past": False,
    "retries": 2,
    "retry_delay": timedelta(minutes=1),
    "execution_timeout": timedelta(minutes=30),
}


# ---------------------------------------------------------------------------
# Task functions
# ---------------------------------------------------------------------------

def extract_manifest(**context: Any) -> dict:
    """Extract manifest from the DAG run configuration."""
    dag_run = context["dag_run"]
    conf = dag_run.conf or {}

    execution_context = conf.get("executionContext", conf)
    manifest = execution_context.get("manifest")

    if not manifest:
        raise ValueError(
            "No manifest found in DAG run conf. "
            "Expected conf.executionContext.manifest or conf.manifest"
        )

    logger.info(
        "Manifest extracted: %d WPCs, %d MasterData, %d ReferenceData",
        len(manifest.get("Data", {}).get("WorkProductComponents", [])),
        len(manifest.get("MasterData") or []),
        len(manifest.get("ReferenceData") or []),
    )
    return manifest


def collect_records(manifest: dict) -> list[dict]:
    """Flatten manifest into a list of OSDU records for Storage Service."""
    records: list[dict] = []

    data = manifest.get("Data", {})
    records.extend(data.get("Datasets") or [])
    records.extend(data.get("WorkProductComponents") or [])
    wp = data.get("WorkProduct")
    if wp:
        records.append(wp)

    records.extend(manifest.get("MasterData") or [])
    records.extend(manifest.get("ReferenceData") or [])

    return records


def get_auth_headers(partition: str, token: str) -> dict[str, str]:
    """Build standard OSDU API headers."""
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "data-partition-id": partition,
    }


def ingest_records(**context: Any) -> dict:
    """Push records to OSDU Storage Service in batches."""
    ti = context["ti"]
    manifest = ti.xcom_pull(task_ids="extract_manifest")

    if not manifest:
        raise ValueError("No manifest available from extract_manifest task")

    records = collect_records(manifest)
    if not records:
        logger.info("No records to ingest")
        return {"recordCount": 0, "status": "completed"}

    # Get configuration
    osdu_url = Variable.get("OSDU_URL", default_var="")
    partition = Variable.get("DATA_PARTITION_ID", default_var="osdu")
    token = Variable.get("OSDU_TOKEN", default_var="")

    if not osdu_url:
        raise ValueError("Airflow Variable 'OSDU_URL' not configured")
    if not token:
        raise ValueError("Airflow Variable 'OSDU_TOKEN' not configured")

    headers = get_auth_headers(partition, token)
    storage_url = f"{osdu_url}/api/storage/v2/records"

    total_pushed = 0
    errors: list[str] = []

    for i in range(0, len(records), STORAGE_BATCH_SIZE):
        batch = records[i : i + STORAGE_BATCH_SIZE]
        batch_num = i // STORAGE_BATCH_SIZE + 1

        try:
            response = requests.put(
                storage_url,
                headers=headers,
                json=batch,
                timeout=60,
            )
            response.raise_for_status()
            result = response.json()
            count = result.get("recordCount", len(batch))
            total_pushed += count
            logger.info("Batch %d: pushed %d records", batch_num, count)
        except requests.exceptions.RequestException as e:
            msg = f"Batch {batch_num} failed: {e}"
            logger.error(msg)
            errors.append(msg)

    result = {
        "recordCount": total_pushed,
        "totalRecords": len(records),
        "status": "completed" if not errors else "partial",
        "errors": errors[:10] if errors else None,  # cap error list
    }
    logger.info("Ingestion complete: %d/%d records pushed", total_pushed, len(records))
    return result


# ---------------------------------------------------------------------------
# DAG definition
# ---------------------------------------------------------------------------
with DAG(
    dag_id=DAG_ID,
    default_args=default_args,
    description="RDDMS manifest ingestion — pushes OSDU manifest records to Storage Service",
    schedule_interval=None,  # triggered externally only
    start_date=days_ago(1),
    catchup=False,
    tags=["rddms", "ingest", "manifest"],
    max_active_runs=5,
) as dag:

    extract_task = PythonOperator(
        task_id="extract_manifest",
        python_callable=extract_manifest,
        provide_context=True,
    )

    ingest_task = PythonOperator(
        task_id="ingest_records",
        python_callable=ingest_records,
        provide_context=True,
    )

    extract_task >> ingest_task
