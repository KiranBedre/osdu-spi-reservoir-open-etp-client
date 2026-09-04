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

import { Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';

import MetricsProvider from './Metrics.provider';
import Logging from '../../common/Logging';

const logger = Logging.getLogger("EtpClient");

const PROBLEM_JSON = 'application/problem+json';

/** Human-readable title for an HTTP status code (falls back to the number). */
const statusTitle = (status: number): string => {
  const name = Object.entries(HttpStatus).find(
    ([, value]) => value === status
  )?.[0];
  return name
    ? name
      .toLowerCase()
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
    : `HTTP ${status}`;
};

/** Extract a human-readable detail message from an exception. */
const problemDetail = (exception: unknown): string => {
  if (exception instanceof HttpException) {
    const res = exception.getResponse();
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object') {
      const message = (res as { message?: unknown }).message;
      if (Array.isArray(message)) return message.join('; ');
      if (typeof message === 'string') return message;
    }
    return exception.message;
  }
  return 'Internal server error';
};

@Catch()
export default class ExceptionCounterFilter extends BaseExceptionFilter {
  constructor(private metricsProvider: MetricsProvider) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost) {
    logger.error("Exception caught by filter.", exception);

    const errorLabels: string[] = [];

    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const reqPathname = req?.originalUrl?.split('?')[0] ?? '';

    if (exception instanceof HttpException) {
      errorLabels.push('http_exception');
      errorLabels.push(reqPathname);
    } else {
      errorLabels.push('unknown_exception');
      errorLabels.push('');
    }

    this.metricsProvider.registerCounterMetric(
      'any_error_counter',
      'Number of errors',
      ['exception_type', 'additional_info']
    )
      .labels(...errorLabels)
      .inc();

    // Opt-in RFC 7807 problem+json: only when the client explicitly asks for it
    // via the Accept header. Otherwise the default NestJS error shape is kept
    // (non-breaking).
    const accept = req?.headers?.accept;
    if (typeof accept === 'string' && accept.includes(PROBLEM_JSON)) {
      const res = ctx.getResponse<Response>();
      if (res && typeof res.status === 'function') {
        const status =
          exception instanceof HttpException
            ? exception.getStatus()
            : HttpStatus.INTERNAL_SERVER_ERROR;
        res.status(status);
        res.setHeader('Content-Type', PROBLEM_JSON);
        res.json({
          type: 'about:blank',
          title: statusTitle(status),
          status,
          detail: problemDetail(exception),
          instance: reqPathname
        });
        return;
      }
    }

    super.catch(exception, host);
  }
}

