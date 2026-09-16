/**
 * NestJS GraphQL module for Reservoir DMS.
 *
 * Configures Apollo Server with:
 *  - Code-first schema generation (auto-generates SDL from decorators)
 *  - Per-request context with ETP session + DataLoaders
 *  - Automatic session cleanup after each request
 *  - JSON scalar for opaque domain object bodies
 *  - Playground enabled in non-production
 */
import { Module } from "@nestjs/common";
import { GraphQLModule } from "@nestjs/graphql";
import { ApolloDriver, ApolloDriverConfig } from "@nestjs/apollo";

import { EtpLoaders, GqlContext } from "./context";
import { RootQueryResolver, ResourceFieldResolver } from "./graphql.resolver";

import logging from "../../common/Logging";
const logger = logging.getLogger("EtpClient");

@Module({
    imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
            driver: ApolloDriver,
            autoSchemaFile: true, // code-first: generate schema in memory
            sortSchema: true,
            playground: process.env.NODE_ENV !== "production",
            introspection: true,
            path: "/graphql",

            // Per-request context factory: extract auth, create loaders, cleanup
            context: ({ req, res }: { req: any; res: any }): GqlContext => {
                const authHeader = req.headers?.authorization ?? "";
                const token = authHeader.startsWith("Bearer ")
                    ? authHeader.slice(7)
                    : "";
                const dataPartitionId = req.headers?.["data-partition-id"] as
                    | string
                    | undefined;

                const loaders = new EtpLoaders(token, dataPartitionId);

                // Register cleanup: close ETP session when response finishes.
                // Uses 'close' event (fires on both success and client abort).
                res.on("close", () => {
                    loaders.dispose().catch(err =>
                        logger.warn("Failed to dispose ETP session", err)
                    );
                });

                return { req, loaders };
            }
        })
    ],
    providers: [RootQueryResolver, ResourceFieldResolver]
})
export default class GqlModule { }
