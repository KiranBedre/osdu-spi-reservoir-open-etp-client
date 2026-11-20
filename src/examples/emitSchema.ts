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

// Emits the code-first GraphQL SDL snapshot (src/schema.gql) from the resolver
// decorators, without booting the full REST app or opening any ETP session.
// This is the GraphQL counterpart to the OpenAPI/Swagger JSON: a committed,
// reviewable, diffable artifact of the `/graphql` surface.

import { NestFactory } from "@nestjs/core";
import { GraphQLSchemaBuilderModule, GraphQLSchemaFactory } from "@nestjs/graphql";
import { printSchema, lexicographicSortSchema } from "graphql";
import { writeFileSync } from "fs";
import { resolve } from "path";

import {
    RootQueryResolver,
    ResourceFieldResolver
} from "../lib/restApi/graphql.module/graphql.resolver";

const OUT = resolve(__dirname, "../schema.gql");

const main = async (): Promise<void> => {
    const app = await NestFactory.create(GraphQLSchemaBuilderModule, {
        logger: false
    });
    await app.init();
    const schemaFactory = app.get(GraphQLSchemaFactory);
    const schema = await schemaFactory.create([
        RootQueryResolver,
        ResourceFieldResolver
    ]);
    writeFileSync(OUT, printSchema(lexicographicSortSchema(schema)) + "\n");
    await app.close();
    // eslint-disable-next-line no-console
    console.log(`GraphQL SDL snapshot written to ${OUT}`);
    process.exit(0);
};

main();
