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

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

import MetricsProvider from './Metrics.provider';
import { normalizeMetricRoute } from './normalizeMetricRoute';

const NS_PER_SEC = 1e9;
const NS_TO_MS = 1e6;

// buckets for response time from 0.1ms to 500ms
const RESPONSE_TIME_BUCKETS = [0.10, 5, 15, 50, 100, 200, 300, 400, 500];

const getDurationInMilliseconds = (startTime: [number, number]): number => {
  const diff = process.hrtime(startTime);

  return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
}

@Injectable()
export default class ResponseDurationMiddleware implements NestMiddleware {
  constructor(private metricsProvider: MetricsProvider) { }

  use(req: Request, res: Response, next: NextFunction) {
    const startReqTime = process.hrtime();

    res.on('finish', () => {
      this.handleResponse(req, startReqTime, 'finished');
    });

    res.on('close', () => {
      this.handleResponse(req, startReqTime, 'closed');
    });

    next();
  }

  handleResponse(req: Request, startReqTime: [number, number], eventName: string) {
    const reqPathname = normalizeMetricRoute(req.originalUrl);
    const durationInMilliseconds = getDurationInMilliseconds(startReqTime);

    this.metricsProvider.registerHistogram(
      `http_request_duration_ms_${eventName}`,
      `Duration of HTTP [${eventName}] requests in ms`,
      ['route'],
      RESPONSE_TIME_BUCKETS
    )
      .labels(reqPathname)
      .observe(durationInMilliseconds);
  }
}
