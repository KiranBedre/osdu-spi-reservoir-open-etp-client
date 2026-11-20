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
import yaml from "js-yaml";
import compression from "compression";

import { bigIntToString } from "../mlTypes/XmlJsonUtil";

import * as clouds from "../providers";
import Logging from "../common/Logging";

import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { restApiRoutePath, swaggerUIUrl } from "./ControllerUtils";
import { restApiBodyLimit } from "../common/config";

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

  // Mount every controller under the configured route prefix. Registered
  // BEFORE the OpenAPI document is generated so @nestjs/swagger emits the
  // absolute route in each path key ("/api/reservoir-ddms/v2/info") instead
  // of a prefix-relative one plus a `servers` entry. That is the convention
  // of the other OSDU DDMS specs (e.g. rafs-ddms: "/api/rafs-ddms/v2/info")
  // and what path-keyed consumers (gateway inventories, the CIMPL spec drift
  // check) expect. `specBase` is the same prefix without a trailing slash,
  // the form the generated path keys carry.
  nestApp.setGlobalPrefix(restApiRoutePath);
  const specBase = restApiRoutePath.replace(/\/+$/, "");
  // Route tables below are written prefix-relative (the prefix is deployment
  // config, not API design); these two helpers translate to/from the absolute
  // path keys of the generated document.
  const absolute = (relPath: string): string => `${specBase}${relPath}`;
  const relative = (absPath: string): string =>
    absPath.startsWith(specBase) ? absPath.slice(specBase.length) : absPath;

  // allows for NestJS's auto documentation feature to be used
  const config = new DocumentBuilder()
    .setTitle("Reservoir DMS")
    .setDescription(
      `REST API for OSDU Reservoir DMS (M28).`
    )
    .setVersion("1.3.0-M28")
    .setLicense(
      "Apache 2.0",
      "https://www.apache.org/licenses/LICENSE-2.0.html"
    )
    .addBearerAuth(
      { type: "http", scheme: "bearer" },
      "HTTPBearer"
    )
    .addTag("Health",
      "Service identity and operational probes: `GET /info` (version, build, connected store, capabilities), liveness/readiness, " +
      "converter and capability registries, and the Prometheus `GET /metrics` scrape endpoint."
    )
    .addTag("Authentication", "Token info and session management.")
    .addTag("Dataspaces",
      "Manage dataspaces: list, create, get info, lock/unlock, validate, clone, and delete. " +
      "A dataspace is the top-level container; pass its URL-encoded id as the `dataspaceId` path segment for all resource operations."
    )
    .addTag("Manifest",
      "OSDU manifest generation from ETP dataspaces (read-only, no transaction required). " +
      "`GET /health/converters` lists the registered source types and their target OSDU kinds."
    )
    .addTag("Resources",
      "Read-only, path-addressed access to objects, relationships and data arrays of one dataspace, plus EPC export. " +
      "`dataspaceId` is URL-encoded (`foo%2Fdrogon`). Graph endpoints (`/graph/...`) return edges; flat endpoints (`/resources/...`) return lists. " +
      "`$skip`/`$top` paginate client-side (ETP has no server-side pagination). No transaction required."
    )
    .addTag("Query",
      "Everything reached by a filter, a query language or a computation rather than a single path: " +
      "object/graph search and growing-object reads (`/query/*`), the three graph query languages (`/graphql` typed records, `/cypher` traversal, `/sparql` RDF), " +
      "linked-data metadata (`/rdf/{artifact}`), and server-side array compute with its async jobs (`/arrays/compute`, `/compute/jobs`). " +
      "Each operation documents its own dialect and limits."
    )
    .addTag("Write",
      "Transactions and writes. Start a transaction (`POST /transactions`), pass its `transactionId` to put objects, arrays, tables or an EPC+H5 upload, then commit (or rollback). " +
      "One active transaction per dataspace; auto-rollback after the timeout (default 300 s). " +
      "Domain writes under Well, Seismic and Reservoir auto-open a transaction when none is supplied."
    )
    .addTag("Well",
      "Well lifecycle: discover wells, store/read WITSML 2.1 and 1.4.1, import well logs from the OSDU Wellbore DDMS while keeping their master-data identity (`/wells/logs/import`), " +
      "enrich with marker frames, align log curves, and resolve/validate curve mnemonics with PWLS v4 (`/pwls/*`)."
    )
    .addTag("Seismic",
      "Seismic interpretation writes: one route, `PUT /seismic/{kind}`, for bin grids, horizons, faults, velocity models and checkshots, " +
      "plus a standalone `POST /seismic/validate` shape check. Horizon and fault writes are FIRP-complete and upsert by SRN-derived UUID."
    )
    .addTag("Reservoir",
      "Reservoir layer: grid import/export (`/grids`, `/grids/{uuid}/export`), the two organisation " +
      "interpretations that are tedious to hand-assemble (`PUT /reservoir/{kind}`: zones, fluid-model) " +
      "and the OSDU/RESQML/GRDECL keyword registry. Grid-referencing representations (connection sets, " +
      "blocked wellbores, stratigraphic/fluid-phase units, region properties) go through the generic " +
      "`PUT /resources` + `PUT /resources/arrays` routes or the SDK builders."
    )
    .build();

  const document = SwaggerModule.createDocument(nestApp, config);

  // Paths are absolute, so there is no server to declare; DocumentBuilder
  // still emits `servers: []`, drop it rather than publish an empty list.
  if (!document.servers?.length) delete document.servers;

  // Group dataspace-lifecycle operations (list/create/info/lock/validate/
  // clone/delete) under their own "Dataspaces" tag so they form a section
  // ahead of Resources, instead of being split between Resources and Write.
  // Then order operations to follow the natural workflow: manage dataspaces,
  // drill down into resources (list -> object -> references/arrays -> array
  // content), query, write, then the domain sections (Well, Seismic,
  // Reservoir); Health and Authentication lead, as in the M27 base. This drives
  // both the generated JSON/YAML and (with operationsSorter off) the Swagger UI order.
  if (document.paths) {
    const paths: any = document.paths;

    // 0) Document the Apollo-served GraphQL endpoint. `/graphql` is mounted by
    // the Apollo driver (not a NestJS controller), so it is absent from the
    // generated spec; inject a documentation-only POST so GraphQL sits in the
    // Query section alongside its graph-query siblings /cypher and /sparql.
    if (!paths[absolute("/graphql")]) {
      paths[absolute("/graphql")] = {
        post: {
          tags: ["Query"],
          summary: "Execute a GraphQL query over the RESQML/ETP graph",
          description:
            "Apollo GraphQL endpoint (code-first schema, SDL at `src/schema.gql`, " +
            "introspection + playground enabled in non-production). The typed, " +
            "field-selection sibling of `/cypher` (traversal) and `/sparql` (RDF): " +
            "request objects, fields, arrays and nested `targets`/`sources` in one " +
            "round-trip. Standard GraphQL-over-HTTP POST body.",
          security: [{ HTTPBearer: [] }],
          parameters: [
            {
              name: "data-partition-id",
              in: "header",
              required: true,
              description: "Data partition id (ex. 'osdu')",
              schema: { type: "string", example: "osdu" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["query"],
                  properties: {
                    query: {
                      type: "string",
                      description: "GraphQL document (query or mutation).",
                      example:
                        "query ($uri: String!) { resource(uri: $uri) { uri name type targets { uri type } } }"
                    },
                    variables: {
                      type: "object",
                      additionalProperties: true,
                      description: "Values for the query's `$`-variables.",
                      example: {
                        uri: "eml:///dataspace('demo/drogon')/resqml20.obj_IjkGridRepresentation(0c8a1e2f-3b7d-4e56-9a81-2f6c4b0d9e73)"
                      }
                    },
                    operationName: {
                      type: "string",
                      description: "Operation to run when the document defines several.",
                      nullable: true
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description:
                "Standard GraphQL response: `{ data, errors? }`. HTTP 200 even " +
                "when `errors` is present (GraphQL-over-HTTP semantics).",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "object", additionalProperties: true, nullable: true },
                      errors: { type: "array", items: { type: "object", additionalProperties: true } }
                    }
                  }
                }
              }
            }
          }
        }
      };
    }

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
      const item = paths[absolute(p)];
      if (!item) continue;
      for (const m of methods) {
        if (item[m]) item[m].tags = ["Dataspaces"];
      }
    }

    // 1b) Normalise section membership. NestJS merges class-level and
    // method-level @ApiTags, so an operation could end up double-tagged and
    // appear twice. Assign each operation exactly one of the ten canonical
    // sections here (Health, Authentication, Dataspaces, Manifest, Resources,
    // Query, Write, Well, Seismic, Reservoir). This map is the single source
    // of truth and overrides whatever the decorators produced.
    const sectionByPath: Record<string, string> = {
      // Health: identity, probes, registries, metrics.
      "/info": "Health",
      "/health/info": "Health",
      "/health/liveness": "Health",
      "/health/readiness": "Health",
      "/health/capabilities": "Health",
      "/health/converters": "Health",
      "/metrics": "Health",
      // Query: search, growing/channel reads, graph query languages,
      // linked-data metadata, array compute + jobs.
      "/query/resources/find": "Query",
      "/query/growing": "Query",
      "/rdf/{artifact}": "Query",
      "/graphql": "Query",
      "/cypher": "Query",
      "/sparql": "Query",
      "/dataspaces/{dataspaceId}/arrays/compute": "Query",
      "/compute/jobs": "Query",
      "/compute/jobs/{id}": "Query",
      // Resources: read-side EPC export and the GET array compute shortcut.
      "/dataspaces/{dataspaceId}/epc": "Resources",
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays/{pathInResource}/compute": "Resources",
      // Write: transactions belong with the writes they guard.
      "/dataspaces/{dataspaceId}/transactions": "Write",
      "/dataspaces/{dataspaceId}/transactions/{transactionId}": "Write",
      // Well: PWLS mnemonics and log-structure alignment are well-log helpers.
      "/pwls/resolve": "Well",
      "/pwls/validate": "Well",
      "/pwls/catalog": "Well",
      "/pwls/status": "Well",
      "/dataspaces/{dataspaceId}/log-structure/align": "Well",
      // Reservoir: grid I/O, framework objects, grid re-authoring, registry.
      "/dataspaces/{dataspaceId}/grids": "Reservoir",
      "/dataspaces/{dataspaceId}/grids/{uuid}/export": "Reservoir",
      "/dataspaces/{dataspaceId}/reservoir/{kind}": "Reservoir",
      "/dataspaces/grid-property-mappings": "Reservoir"
    };
    for (const [p, tag] of Object.entries(sectionByPath)) {
      const item = paths[absolute(p)];
      if (!item) continue;
      for (const op of Object.values(item)) {
        if (op && typeof op === "object") (op as { tags?: string[] }).tags = [tag];
      }
    }

    // 2) Order the paths. One section per topic, in the order a user meets
    // them; inside a section the common calls come first and the niche /
    // deprecated ones sit at the bottom. Every route must be listed here:
    // anything missing falls to the end alphabetically.
    const workflowOrder = [
      // ── Health (identity → probes → registries → metrics → deprecated) ──
      "/info",
      "/health/readiness",
      "/health/liveness",
      "/health/capabilities",
      "/health/converters",
      "/metrics",
      "/health/info",                                     // deprecated (M26), use /info
      // ── Authentication ──
      "/auth/token",
      // ── Dataspaces (lifecycle: create → inspect → lock → validate → clone → delete) ──
      "/dataspaces",                                                              // list & create
      "/dataspaces/{dataspaceId}/info",                                           // info
      "/dataspaces/{dataspaceId}/lock",                                           // lock / unlock
      "/dataspaces/{dataspaceId}/validate",                                       // validate content
      "/dataspaces/{dataspaceId}/clone",                                          // clone (new dataspace, or ?intoExisting)
      "/dataspaces/{dataspaceId}",                                                // delete
      // ── Manifest (build → poll the async job) ──
      "/manifests/build",
      "/manifests/jobs/{jobId}",
      // ── Resources: drill-down (dataspace → type → object → references → arrays → array content) ──
      "/dataspaces/{dataspaceId}/resources/all",                                  // all resources
      "/dataspaces/{dataspaceId}/resources",                                      // types (+ put objects)
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}",                     // by type
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}",              // one object (+ delete)
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/targets",      // referenced-by
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/sources",      // referencing
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays",       // arrays of an object
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays/{pathInResource}/metadata", // array metadata
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays/{pathInResource}",          // array content (sub-array)
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/arrays/{pathInResource}/compute",  // ?op=stats|where
      // ── Resources: export, projections, rarely used / deprecated (section bottom) ──
      "/dataspaces/{dataspaceId}/epc",                                            // export dataspace / uuid subset as EPC+H5
      "/dataspaces/{dataspaceId}/resources/{dataObjectType}/{guid}/rdf",          // single-object RDF projection
      "/dataspaces/multi-resources/get-content",                                  // batch get object content
      "/dataspaces/{dataspaceId}/deleted",                                        // tombstones
      "/dataspaces/{dataspaceId}/graph/all",                                      // deprecated graph variants
      "/dataspaces/{dataspaceId}/graph/{dataObjectType}/{guid}/targets",
      "/dataspaces/{dataspaceId}/graph/{dataObjectType}/{guid}/sources",
      // ── Query (find → growing/channel reads → graph languages → linked data → compute → jobs) ──
      "/query/resources/find",                                                    // DiscoveryQuery (13) / Discovery (3): find, content, edges
      "/query/growing",                                                           // GrowingObject (6) + ChannelSubscribe (21)
      "/graphql",                                                                 // typed record retrieval
      "/cypher",                                                                  // property-graph traversal
      "/sparql",                                                                  // RDF / semantic web
      "/rdf/{artifact}",                                                          // linked-data metadata (context, ontology, alignment)
      "/dataspaces/{dataspaceId}/arrays/compute",                                 // compute envelope (sync or async)
      "/compute/jobs",                                                            // list jobs
      "/compute/jobs/{id}",                                                       // poll / cancel
      // ── Write (transaction → objects → arrays → tables → EPC upload) ──
      "/dataspaces/{dataspaceId}/transactions",
      "/dataspaces/{dataspaceId}/transactions/{transactionId}",
      "/dataspaces/{dataspaceId}/resources/arrays",
      "/dataspaces/{dataspaceId}/resources/tables/column-based",
      "/dataspaces/{dataspaceId}/epc/upload",
      // ── Well (discover → store/read WITSML → import → enrich → helpers → PWLS) ──
      "/wells",                                           // discover wells across dataspaces
      "/witsml/store",                                    // ingest WITSML/EnergyML containers
      "/witsml/query",                                    // read stored WITSML objects back
      "/dataspaces/{dataspaceId}/wells/logs/import",      // copy a Wellbore DDMS WellLog in as WITSML ChannelSet + Wellbore/Well
      "/dataspaces/{dataspaceId}/wells/markers",          // marker frame enrichment
      "/dataspaces/{dataspaceId}/log-structure/align",    // co-index curves onto one index axis (helper)
      "/pwls/resolve",                                    // mnemonic or property, ?include=hierarchy
      "/pwls/validate",
      "/pwls/catalog",
      "/pwls/status",
      // ── Seismic (one write route per kind → standalone check) ──
      "/dataspaces/{dataspaceId}/seismic/{kind}",         // bingrid | horizons | faults | velocity | checkshots
      "/seismic/validate",
      // ── Reservoir (grid I/O → framework interpretations → registry) ──
      "/dataspaces/{dataspaceId}/grids",                                          // import grid (GRDECL)
      "/dataspaces/{dataspaceId}/grids/{uuid}/export",                            // export grid (grdecl|egrid|init)
      "/dataspaces/{dataspaceId}/reservoir/{kind}",                               // zones | fluid-model
      "/dataspaces/grid-property-mappings"                                        // keyword registry
    ];
    const orderIndex = (p: string): number => {
      const i = workflowOrder.indexOf(relative(p));
      return i === -1 ? workflowOrder.length : i;
    };
    const sorted = Object.entries(paths).sort(
      ([a], [b]) => orderIndex(a) - orderIndex(b) || a.localeCompare(b)
    );
    document.paths = Object.fromEntries(sorted) as typeof document.paths;
  }

  // Generate the API spec files with 2-space indentation forced. All three are
  // derived from the same in-memory `document` so they never drift:
  //   - swagger.json   : historical filename kept for backwards compatibility
  //   - openapi.json   : canonical OpenAPI 3 JSON (byte-identical to swagger.json)
  //   - openapi.yaml   : YAML rendering of the same document
  // Do not generate the files in production.
  if (process.env.NODE_ENV !== "production") {
    const specJson = JSON.stringify(document, null, 2);
    fs.writeFileSync("./swagger.json", specJson);
    fs.writeFileSync("./openapi.json", specJson);
    fs.writeFileSync(
      "./openapi.yaml",
      yaml.dump(document, { noRefs: true })
    );
  }

  // default document URLs are siblings of the UI path ("<path>-json"/"-yaml"),
  // e.g. "/api/reservoir-ddms/v2-json". Prefix-scoped ingress (the cimpl Istio
  // VirtualService matches the segment-aware prefix "/api/reservoir-ddms/v2")
  // does NOT route that sibling segment, so the spec 404s at the gateway.
  // Nesting the documents under the prefix keeps the raw JSON/YAML reachable
  // through the ingress ("<path>/openapi.json" and "<path>/openapi.yaml").
  SwaggerModule.setup(restApiRoutePath, nestApp, document, {
    jsonDocumentUrl: `${specBase}/openapi.json`,
    yamlDocumentUrl: `${specBase}/openapi.yaml`,
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

  nestApp.use(express.json({ limit: restApiBodyLimit }));
  nestApp.use(express.urlencoded({ limit: restApiBodyLimit, extended: true }));
  // Raw body parser for binary array uploads (PUT .../arrays/:path with
  // `Content-Type: application/octet-stream`). Only octet-stream requests are
  // matched, so JSON/urlencoded routes are unaffected.
  nestApp.use(
    express.raw({ type: "application/octet-stream", limit: restApiBodyLimit })
  );
  // Compress responses (gzip/brotli via Accept-Encoding negotiation). This is a
  // pure bytes-on-wire win for the JSON routes — especially large numeric array
  // payloads, which compress very well. We explicitly skip
  // `application/octet-stream` (our raw binary array responses) so we don't burn
  // CPU gzipping already-compact, poorly-compressible float/int buffers and can
  // keep streaming them straight through. `Cache-Control: no-transform` is still
  // honoured by the default filter for every other type.
  nestApp.use(
    compression({
      filter: (req, res) => {
        const type = res.getHeader("Content-Type");
        if (
          typeof type === "string" &&
          type.includes("application/octet-stream")
        ) {
          return false;
        }
        return compression.filter(req, res);
      }
    })
  );
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
