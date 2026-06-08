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

// This is needed until we upgrade eslint, currently nestjs generate false positive
import fs from "fs";

import { APP_FILTER, NestFactory } from "@nestjs/core";
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  ValidationPipe
} from "@nestjs/common";

import { NestExpressApplication } from "@nestjs/platform-express";

import express from "express";
import { globSync } from "glob";
import helmet from "helmet";

import { bigIntToString } from "../mlTypes/XmlJsonUtil";

import * as clouds from "../providers";
import Logging from "../common/Logging";

import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { restApiRoutePath, serverUIUrl, swaggerUIUrl } from "./ControllerUtils";

import ExceptionCounterFilter from "../restApi/monitoring.module/ExceptionCounter.filter";

Logging.getLogger("EtpClient");

// requires all the files which conform to the given pattern and returns the list of defaults exports
function requireDefaults(pattern: string) {
  return globSync(pattern, { cwd: __dirname, absolute: true })
    .map(require)
    .map(imported => imported.default);
}

// requires all the controllers in the app
const controllers = requireDefaults("*.module/*.controller.+(js|ts)");

// requires all the controllers in the app
const providers = requireDefaults("*.module/*.provider.+(js|ts)");

// requires all the global middleware in the app
const middleware = requireDefaults("*.module/*.middleware.+(js|ts)");

@Module({
  controllers,
  providers: [
    ...providers,
    {
      provide: APP_FILTER,
      useClass: ExceptionCounterFilter
    }
  ]
})
class ApplicationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): MiddlewareConsumer | void {
    consumer.apply(...middleware).forRoutes("/");
  }
}

export default async function app(): Promise<NestExpressApplication> {
  if (process.env.CLOUD_PROVIDER) {
    clouds.Config.setCloudProvider(process.env.CLOUD_PROVIDER);
    await clouds.ConfigFactory.build(clouds.Config.CLOUD_PROVIDER).init();
  }

  const etpLogger = Logging.getLogger("EtpClient");
  etpLogger.info(
    `- Initializing ${clouds.Config.CLOUD_PROVIDER || "default"} configurations`
  );

  const nestApp =
    await NestFactory.create<NestExpressApplication>(ApplicationModule);

  // allows for validation to be used
  nestApp.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      skipUndefinedProperties: true,
      transformerPackage: require("class-transformer"),
      validatorPackage: require("class-validator"),
      // Enhanced validation options to catch deserialization failures
      whitelist: true, // Strip properties that don't have decorators
      forbidNonWhitelisted: true, // Throw error for non-whitelisted properties
      disableErrorMessages: false, // Enable detailed error messages
      validateCustomDecorators: true, // Validate custom decorators
      forbidUnknownValues: true, // Reject unknown values
      stopAtFirstError: false, // Show all validation errors
      dismissDefaultMessages: false, // Keep default error messages
      validationError: {
        target: false, // Don't include the target object in error
        value: false // Don't include the value in error (security)
      }
    })
  );

  etpLogger.info(`- Swagger running on ${swaggerUIUrl}`);

  // allows for NestJS's auto documentation feature to be used
  const config = new DocumentBuilder()
    .setTitle("Reservoir DMS")
    .setDescription("Rest API for OSDU Reservoir DMS")
    .setVersion("1.2")
    .setLicense(
      "Apache 2.0",
      "https://www.apache.org/licenses/LICENSE-2.0.html"
    )
    .addBearerAuth(
      { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      "access-token"
    )
    .addServer(`${serverUIUrl}`)
    .build();

  const document = SwaggerModule.createDocument(nestApp, config);
  // Generate API file with 2 space indentation forced.
  // Do not generate the file in production
  if (process.env.NODE_ENV !== "production") {
    fs.writeFileSync("./swagger.json", JSON.stringify(document, null, 2));
  }

  SwaggerModule.setup(restApiRoutePath, nestApp, document, {
    swaggerOptions: {
      apisSorter: "alpha",
      operationsSorter: "alpha",
      tagsSorter: "alpha"
    }
  });

  nestApp.setGlobalPrefix(restApiRoutePath);

  nestApp.use(express.json({ limit: "50mb" }));
  nestApp.use(express.urlencoded({ limit: "50mb", extended: true }));
  nestApp.use(helmet());
  nestApp.use(helmet.hidePoweredBy());
  nestApp.use(helmet.noSniff());
  nestApp.use(helmet.contentSecurityPolicy());

  // Set REST allowed methods to add security
  const allowedMethods = ["POST", "GET", "DELETE", "PUT"];
  nestApp.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (!allowedMethods.includes(req.method)) {
        res.status(405).send("Method Not Allowed");
        return;
      }
      return next();
    }
  );

  const adapt = nestApp.getHttpAdapter().getInstance();
  adapt.get("/swagger-ui/index.html", function (req, res) {
    return res.redirect(302, restApiRoutePath);
  });

  /*****************************************************************/
  /// Swagger endpoints
  nestApp.set("json replacer", bigIntToString);
  return nestApp;
}
