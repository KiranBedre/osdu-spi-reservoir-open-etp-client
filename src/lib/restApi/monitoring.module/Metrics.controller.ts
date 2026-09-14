// ============================================================================
// Copyright 2022, EPAM Systems
// Copyright 2022, Microsoft
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

import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiInternalServerErrorResponse,
  ApiOperation,
  ApiTags
} from "@nestjs/swagger";

import {
  errorMessageSchema,
  swaggerServers
} from "../ControllerUtils";

import MetricsProvider from './Metrics.provider';
import Logging from '../../common/Logging';

const logger = Logging.getLogger("EtpClient");

@ApiTags("Metrics")
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller('/metrics')
export default class MetricsController {
  constructor(private metricsProvider: MetricsProvider) { }

  @Get()
  @ApiOkResponse({ description: "Success", type: String })
  @ApiOperation({
    summary: "Prometheus metrics.",
    description: "Returns all collected metrics in Prometheus text exposition format. Includes HTTP request counts, response latencies, ETP session statistics, and error rates. Scrape this endpoint with a Prometheus server or use `curl` for ad-hoc inspection.",
    security: [],
    servers: swaggerServers
  })
  public metrics(): Promise<string> {
    logger.info("Fetching metrics...");
    return this.metricsProvider.metrics;
  }
}
