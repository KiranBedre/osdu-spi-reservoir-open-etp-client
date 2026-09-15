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

import "jest";
import { Level } from 'log4js';

import * as providers from "../../lib/providers";

import { AwsConfig } from "../../lib/providers/aws/Config";

import Logging from "../../lib/common/Logging";
import { LoggerFactory } from "../../lib/providers/LoggerFactory";
import { Logger as AwsLogger, getAwsLogger } from "../../lib/providers/aws/Logger";

const CLOUD_PROVIDER = "aws";
const DEFAULT_LOGGER_NAME = "EtpClient";

describe("Aws", () => {
    beforeAll(() => {
        jest.resetModules();
        process.env = { CLOUD_PROVIDER };
        providers.Config.setCloudProvider(process.env.CLOUD_PROVIDER || '');
    });

    describe("Logger", () => {
        beforeEach(() => {
            LoggerFactory.register(CLOUD_PROVIDER)(AwsLogger);
        });

        it("Get default logger", () => {
            const logObj = getAwsLogger();
            expect(logObj.category).toEqual('default');
            expect((logObj.level as Level).levelStr).toEqual('debug'.toUpperCase());
        });

        it("Get az logger", () => {
            const logObj = Logging.getLogger(DEFAULT_LOGGER_NAME);
            expect(logObj).toBeInstanceOf(AwsLogger);
        });

        it("Test log levels", () => {
            const logObj = Logging.getLogger(DEFAULT_LOGGER_NAME);
            logObj.info("test info");
            logObj.warning("test warning");
            logObj.error("test error");
        });
    });

    describe("Config", () => {
        beforeEach(() => {
            providers.ConfigFactory.register(CLOUD_PROVIDER)(AwsConfig);
            process.env = {
                ...process.env,
                AWS_LOG_LEVEL: 'info',
                AWS_LOG_FORMAT: '%p: %m%n',
            };
        });

        it("Get default az config", () => {
            const config = providers.ConfigFactory.build(CLOUD_PROVIDER);
            expect(config).toBeInstanceOf(AwsConfig);
            expect(AwsConfig.AWS_LOG_LEVEL).toEqual('debug');
        });

        it("Get custom az config", () => {
            const config = providers.ConfigFactory.build(CLOUD_PROVIDER);
            config.init();
            expect(config).toBeInstanceOf(AwsConfig);
            expect(AwsConfig.AWS_LOG_LEVEL).toEqual('info');
            expect(AwsConfig.AWS_LOG_FORMAT).toEqual('%p: %m%n');
        });
    });
});
