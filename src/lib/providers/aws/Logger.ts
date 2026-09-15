// ============================================================================
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the “License”).
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an “AS IS” BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ============================================================================

import { AbstractLogger } from '../../common/Logging';
import { LoggerFactory } from '../LoggerFactory';
import { AwsConfig } from './Config';
import log4js from 'log4js';

export const getAwsLogger = (): log4js.Logger => {
    log4js.configure({
        appenders: {
            out: {
                type: 'stdout', layout: {
                    type: 'pattern',
                    pattern: AwsConfig.AWS_LOG_FORMAT,
                }
            }
        },
        categories: { default: { appenders: ['out'], level: AwsConfig.AWS_LOG_LEVEL } }
    });

    return log4js.getLogger();
};

@LoggerFactory.register('aws')
export class Logger extends AbstractLogger {
    private logger: log4js.Logger;

    public constructor() {
        super();
        this.logger = getAwsLogger();
    }

    public debug(data: string): void {
        this.logger.debug(data);
    }

    public info(data: string): void {
        this.logger.info(data);
    }

    public warning(data: string): void {
        this.logger.warn(data);
    }

    public error(data: string): void {
        this.logger.error(data);
    }
}
