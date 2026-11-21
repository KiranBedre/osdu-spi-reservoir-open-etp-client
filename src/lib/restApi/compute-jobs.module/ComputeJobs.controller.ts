// ============================================================================
// Copyright 2019-2022 Emerson Paradigm Holding LLC. All rights reserved.
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

// Lifecycle of asynchronous compute jobs. Jobs are created by
// `POST /dataspaces/{dataspaceId}/arrays/compute` with `async: true`
// (see ArrayCompute.controller.ts); this controller lists, polls and cancels
// them. Results are retained in memory until evicted by the queue.

import { Controller, Delete, Get, NotFoundException, Param } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { computeJobQueue, ComputeJobView } from "./ComputeJobQueue";

@ApiTags("Query")
@Controller()
export default class ComputeJobsController {
  @Get("compute/jobs")
  @ApiOperation({
    summary: "List compute jobs",
    description:
      "Jobs are submitted with `POST /dataspaces/{dataspaceId}/arrays/compute` and `async: true`."
  })
  @ApiOkResponse({ description: "Known jobs, oldest first." })
  public listJobs(): ComputeJobView[] {
    return computeJobQueue.list();
  }

  @Get("compute/jobs/:id")
  @ApiOperation({ summary: "Get a compute job status and result" })
  public getJob(@Param("id") id: string): ComputeJobView {
    const job = computeJobQueue.get(id);
    if (!job) {
      throw new NotFoundException({ description: `Job ${id} not found` });
    }
    return job;
  }

  @Delete("compute/jobs/:id")
  @ApiOperation({ summary: "Cancel a queued or running compute job" })
  public cancelJob(@Param("id") id: string): { canceled: boolean } {
    const job = computeJobQueue.get(id);
    if (!job) {
      throw new NotFoundException({ description: `Job ${id} not found` });
    }
    return { canceled: computeJobQueue.cancel(id) };
  }
}
