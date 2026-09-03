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

import { restApiRoutePath, swaggerUIUrl } from "./ControllerUtils";

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
    .setDescription(
      `REST API for OSDU Reservoir DMS (M27).`
    )
    .setVersion("1.3.0-M27")
    .setLicense(
      "Apache 2.0",
      "https://www.apache.org/licenses/LICENSE-2.0.html"
    )
    .addBearerAuth(
      { type: "http", scheme: "bearer" },
      "HTTPBearer"
    )
    .addServer(restApiRoutePath.replace(/\/$/, ""))
    .addTag("Health", "Liveness, readiness probes, and server metadata. Use `GET /health/converters` to list all registered RESQML/WITSML → OSDU converter mappings.")
    .addTag("Authentication", "Token info and session management")
    .addTag("Metrics", "Prometheus metrics endpoint")
    .addTag("Dataspaces",
      "Manage dataspaces: list, create, get info, lock/unlock, validate, clone, and delete. " +
      "A dataspace is the top-level container; pass its URL-encoded id as the `dataspaceId` path segment for all resource operations."
    )
    .addTag("Manifest",
      "OSDU manifest generation from ETP dataspaces - read-only, no transaction required. " +
      "Common use case: browse resources, then generate a manifest in a single call. " +
      "Supported source domains: RESQML 2.0.1 & 2.2, PRODML 2.3, WITSML 2.1, EML 2.3. " +
      "Use `GET /health/converters` to list all registered source types and their target OSDU kinds."
    )
    .addTag("Resources",
      "Read-only access to ETP dataspaces, objects, relationships, and data arrays. " +
      "Use `dataspaceId` as a URL-encoded path (e.g., `foo%2Fdrogon` for `foo/drogon`). " +
      "Graph endpoints (`/graph/…`) return edges between resources; flat endpoints (`/resources/…`) return lists without edges. " +
      "**Graph scope**: `self` (direct), `targets` (referenced by), `sources` (referencing), `targetsOrSelf`, `sourcesOrSelf`. " +
      "**Depth**: 1 = immediate, N = recursive, 0 = unlimited (may timeout). " +
      "**Pagination**: `$skip`/`$top` are applied client-side after fetch (ETP has no server-side pagination). " +
      "No transaction required."
    )
    .addTag("Query",
      "Body-driven search across a dataspace or a batch of URIs (ETP Discovery + Store). " +
      "`POST /query/objects/find` returns matching objects with full content; `POST /query/graph/search` runs a batch graph search across multiple URIs (Discovery Protocol 3). " +
      "Use these when a filter or multi-URI batch does not fit a path-addressed `GET /resources/…` call."
    )
    .addTag("Transactions",
      "Start, commit, or rollback a transaction. Required before any write operation. " +
      "Auto-rollback after timeout (default 300 s). One active transaction per dataspace."
    )
    .addTag("Write",
      "Create, update, and delete objects and upload EPC+H5 files. " +
      "**Requires a transaction** - start one first via Transactions, then pass `transactionId`. " +
      "Typical flow: create dataspace → start transaction → put objects → put arrays → commit."
    )
    .addTag("WITSML", "Query and store WITSML/EnergyML objects in ETP dataspaces, plus well-centric search with hierarchy resolution across dataspaces (`GET /wells`). Domain-specific - supports WITSML 2.1 and 1.4.1 container formats.")
    .addTag("PWLS", "PWLS v4.0 curve mnemonic resolution and validation. Domain-specific - maps vendor mnemonics to standard property names.")
    .build();

  const document = SwaggerModule.createDocument(nestApp, config);

  // Group dataspace-lifecycle operations (list/create/info/lock/validate/
  // clone/delete) under their own "Dataspaces" tag so they form a section
  // ahead of Resources, instead of being split between Resources and Write.
  // Then order operations to follow the natural workflow: manage dataspaces,
  // drill down into resources (list -> object -> references/arrays -> array
  // content), search, write, transactions, manifest, domain-specific
  // (WITSML/PWLS) and operational endpoints. This drives both the generated
  // JSON/YAML and (with operationsSorter off) the Swagger UI order.
  if (document.paths) {
    const paths: any = document.paths;

    // 1) Re-tag the dataspace-lifecycle operations into the Dataspaces section.
    const dataspaceOps: Record<string, string[]> = {
      "/dataspaces": ["get", "post"],
      "/dataspaces/{dataspaceId}/info": ["get"],
      "/dataspaces/{dataspaceId}/lock": ["post", "delete"],
      "/dataspaces/{dataspaceId}/validate": ["post"],
      "/dataspaces/{dataspaceId}/clone": ["post"],
      "/dataspaces/{dataspaceId}": ["delete"]
    };
    for (const [p, methods] of Object.entries(dataspaceOps)) {
      const item = paths[p];
      if (!item) continue;
      for (const m of methods) {
        if (item[m]) item[m].tags = ["Dataspaces"];
      }
    }

    // 2) Order the paths.
    const workflowOrder = [
      // ── Dataspaces (lifecycle) ──
      "/dataspaces",                                                                              // list & create dataspaces
      "/dataspaces/{dataspaceId}/info",                                                           // dataspace info
      "/dataspaces/{dataspaceId}/lock",                                                           // lock / unlock
      "/dataspaces/{dataspaceId}/validate",                                                       // validate
      "/dataspaces/{dataspaceId}/clone",                                                          // clone
      "/dataspaces/{dataspaceId}",                                                                // delete
      // ── Manifest ──
      "/manifests/build",
      // ── Resources: read / drill-down ──
      "/dataspaces/{dataspaceId}/resources/all",                                                  // all resources in a dataspace
      "/dataspaces/{dataspaceId}/resources",                                                      // resource types (+ put objects)
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}",                                     // resources by type
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}",                              // one object (+ delete)
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/targets",                      // referenced-by
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/sources",                      // referencing
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays",                       // list arrays of an object
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays/{pathInResource}/metadata", // array metadata
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays/{pathInResource}",      // array content
      "/dataspaces/multi-resources/get-content",                                                  // batch get object content
      "/dataspaces/{dataspaceId}/deleted",                                                        // tombstones
      "/dataspaces/{dataspaceId}/graph/all",                                                      // deprecated graph variants
      "/dataspaces/{dataspaceId}/graph/{dataObjectType}/{guid}/targets",
      "/dataspaces/{dataspaceId}/graph/{dataObjectType}/{guid}/sources",
      // ── Query (search) ──
      "/query/objects/find",
      "/query/graph/search",
      // ── Transactions ──
      "/dataspaces/{dataspaceId}/transactions",
      "/dataspaces/{dataspaceId}/transactions/{transactionId}",
      // ── Write (objects / arrays / epc) ──
      "/dataspaces/{dataspaceId}/resources/arrays",
      "/dataspaces/{dataspaceId}/epc/upload",
      // ── WITSML ──
      "/witsml/store",
      "/witsml/query",
      "/wells",
      // ── PWLS ──
      "/pwls/status",
      "/pwls/resolve",
      "/pwls/validate",
      "/pwls/catalog",
      // ── Operational ──
      "/health/readiness",
      "/health/liveness",
      "/health/info",
      "/health/converters",
      "/auth/token",
      "/metrics"
    ];
    const orderIndex = (p: string): number => {
      const i = workflowOrder.indexOf(p);
      return i === -1 ? workflowOrder.length : i;
    };
    const sorted = Object.entries(paths).sort(
      ([a], [b]) => orderIndex(a) - orderIndex(b) || a.localeCompare(b)
    );
    document.paths = Object.fromEntries(sorted) as typeof document.paths;
  }

  // Generate API file with 2 space indentation forced.
  // Do not generate the file in production
  if (process.env.NODE_ENV !== "production") {
    fs.writeFileSync("./swagger.json", JSON.stringify(document, null, 2));
  }

  SwaggerModule.setup(restApiRoutePath, nestApp, document, {
    swaggerOptions: {
      apisSorter: "alpha",
      // Preserve the spec (workflow) order of operations within each tag
      // rather than sorting alphabetically, so the UI reads as a drill-down.
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
