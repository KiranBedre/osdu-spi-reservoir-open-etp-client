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

import { normalizeDataspacePath } from "./dataspacePath";

import ExceptionCounterFilter from "../restApi/monitoring.module/ExceptionCounter.filter";
import GqlModule from "./graphql.module/graphql.module";

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
  imports: [GqlModule],
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
  // Subclass that skips validation for GraphQL custom params (@Parent, @Context)
  class GqlSafeValidationPipe extends ValidationPipe {
    async transform(value: any, metadata: any) {
      if (metadata.type === 'custom') return value;
      return super.transform(value, metadata);
    }
  }
  nestApp.useGlobalPipes(
    new GqlSafeValidationPipe({
      transform: true,
      skipUndefinedProperties: true,
      transformerPackage: require("class-transformer"),
      validatorPackage: require("class-validator"),
      whitelist: true,
      forbidNonWhitelisted: true,
      disableErrorMessages: false,
      validateCustomDecorators: false,
      forbidUnknownValues: false,
      stopAtFirstError: false,
      dismissDefaultMessages: false,
      validationError: {
        target: false,
        value: false
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
    .addTag("Authentication", "Token info and session management")
    .addTag("Health", "Liveness and readiness probes")
    .addTag("Resources", "ETP dataspace and object read operations")
    .addTag("Query & Growing Objects", "Deep search, growing object metadata and channel range queries")
    .addTag("Write", "ETP object write (PutDataObjects, DeleteDataObjects)")
    .addTag("Transactions", "ETP transaction lifecycle (start, commit, rollback)")
    .addTag("Manifest", "OSDU manifest generation from ETP dataspaces")
    .addTag("Wells", "Well search, WITSML query/store, and PWLS curve catalog")
    .addTag("Metrics", "Prometheus metrics endpoint")
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
      modelsSorter: "alpha",
      tagsSorter: (a: any, b: any) => {
        const order = document.tags?.map((t: any) => t.name) ?? [];
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      }
    }
  });

  nestApp.setGlobalPrefix(restApiRoutePath);

  // Some ingress layers (e.g. Istio/Envoy path normalization) decode the "%2F"
  // in a dataspace id (e.g. "demo/Volve" -> …/dataspaces/demo%2FVolve/…) back
  // to a literal "/" before the request reaches this pod, which splits the id
  // across path segments and breaks route matching (spurious 404s). Re-encode
  // it here so slash-containing dataspace ids route correctly on every platform.
  nestApp.use(
    (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction
    ) => {
      const normalized = normalizeDataspacePath(req.url);
      if (normalized !== req.url) {
        req.url = normalized;
      }
      return next();
    }
  );

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
