// ============================================================================
// Copyright 2026 Microsoft. Inc. or its affiliates. All Rights Reserved
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
import request from "supertest";

import restApp from "../lib/restApi/App";
import { restApiServerPath } from "../lib/common/config";

// ─────────────────────────────────────────────────────────────────────────────
// HTTP-level tests for the new linked-data controllers and the opt-in
// RFC 7807 problem+json error representation. These endpoints are public and
// do not require an ETP session, so they can be exercised end-to-end.
//
// A single Nest application instance is shared across the file: creating the
// app more than once re-registers the Prometheus metrics and throws.
// ─────────────────────────────────────────────────────────────────────────────

describe("New read-only controllers and problem+json", () => {
    let server: any;

    beforeAll(async () => {
        const nestApp = await restApp();
        server = (await nestApp.init()).getHttpServer();
    });

    describe("GET /rdf/context", () => {
        it("returns the JSON-LD context document", async () => {
            const res = await request(server)
                .get(`${restApiServerPath}/rdf/context`)
                .expect("Content-Type", /ld\+json/)
                .expect(200);
            expect(res.body).toHaveProperty("@context");
        });
    });

    describe("GET /rdf/ontology", () => {
        it("returns Turtle by default", async () => {
            const res = await request(server)
                .get(`${restApiServerPath}/rdf/ontology`)
                .expect("Content-Type", /turtle/)
                .expect(200);
            expect(res.text).toContain("@prefix");
        });

        it("honours ?format=jsonld", async () => {
            const res = await request(server)
                .get(`${restApiServerPath}/rdf/ontology?format=jsonld`)
                .expect("Content-Type", /ld\+json/)
                .expect(200);
            expect(res.body).toHaveProperty("@context");
        });

        it("honours the Accept header (N-Triples)", async () => {
            const res = await request(server)
                .get(`${restApiServerPath}/rdf/ontology`)
                .set("Accept", "application/n-triples")
                .expect("Content-Type", /n-triples/)
                .expect(200);
            expect(res.text).toContain("<http");
        });
    });

    describe("GET /rdf/alignment", () => {
        it("returns the OWL alignment as Turtle", async () => {
            const res = await request(server)
                .get(`${restApiServerPath}/rdf/alignment`)
                .expect("Content-Type", /turtle/)
                .expect(200);
            expect(res.text).toContain("owl:equivalentClass");
        });
    });

    describe("GET /pwls/catalog", () => {
        it("returns the catalogue as JSON by default", async () => {
            const res = await request(server)
                .get(`${restApiServerPath}/pwls/catalog`)
                .expect("Content-Type", /json/)
                .expect(200);
            expect(res.body).toHaveProperty("properties");
            expect(Array.isArray(res.body.properties)).toBe(true);
            expect(res.body.properties.length).toBeGreaterThan(0);
        });

        it("returns a SKOS concept scheme when Turtle is requested", async () => {
            const res = await request(server)
                .get(`${restApiServerPath}/pwls/catalog`)
                .set("Accept", "text/turtle")
                .expect("Content-Type", /turtle/)
                .expect(200);
            expect(res.text).toContain("skos:ConceptScheme");
        });
    });

    describe("RFC 7807 problem+json (opt-in)", () => {
        it("returns problem+json when the client asks for it", async () => {
            const res = await request(server)
                .get(`${restApiServerPath}/this-route-does-not-exist`)
                .set("Accept", "application/problem+json")
                .expect("Content-Type", /application\/problem\+json/)
                .expect(404);

            expect(res.body).toMatchObject({
                type: "about:blank",
                status: 404
            });
            expect(res.body).toHaveProperty("title");
            expect(res.body).toHaveProperty("detail");
            expect(res.body).toHaveProperty("instance");
            expect(res.body.instance).toContain("/this-route-does-not-exist");
        });

        it("keeps the default NestJS error shape when problem+json is not requested", async () => {
            const res = await request(server)
                .get(`${restApiServerPath}/this-route-does-not-exist`)
                .expect(404);

            expect(res.headers["content-type"]).not.toContain("problem+json");
            expect(res.body).toHaveProperty("statusCode", 404);
            expect(res.body).not.toHaveProperty("type");
        });
    });
});
