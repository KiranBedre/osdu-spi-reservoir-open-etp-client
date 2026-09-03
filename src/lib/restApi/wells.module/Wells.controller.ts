import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  ApiBearerAuth,
  ApiGoneResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags
} from "@nestjs/swagger";

import express from "express";

import {
  Energistics,
  EtpUri,
  ResqmlClient
} from "../../client/ResqmlClient";

import {
  HasBearerGuard,
  HasDataPartitionGuard,
  createSession,
  extractToken,
  findResources,
  httpErrorFromEtpError,
  swaggerServers,
  webSocketSessionTerminatedSchema
} from "../ControllerUtils";

import logging from "../../common/Logging";
const logger = logging.getLogger("EtpClient");

interface WellResult {
  name: string;
  uuid: string;
  dataspace: string;
  typeName: string;
  wellbores: ChildObject[];
  logs: ChildObject[];
  trajectories: ChildObject[];
  channelSets: ChildObject[];
}

interface ChildObject {
  uuid: string;
  name: string;
  typeName: string;
  dataspace: string;
}

function parseResource(res: Energistics.Etp.v12.Datatypes.Object.Resource) {
  const uri = new EtpUri(res.uri);
  return {
    uuid: uri.uuid,
    name: res.name,
    typeName: uri.dataObjectType,
    uri: res.uri
  };
}

@Controller("wells")
@ApiTags("WITSML")
@ApiBearerAuth("HTTPBearer")
@UseGuards(HasBearerGuard("jwt"))
@UseGuards(HasDataPartitionGuard())
@ApiGoneResponse(webSocketSessionTerminatedSchema())
export default class WellsController {

  @Get()
  @ApiOperation({
    summary: "Search wells across dataspaces with hierarchy resolution",
    description:
      "Searches for wells (WITSML 2.1 Well or RESQML WellboreFeature) matching a name pattern " +
      "across all accessible dataspaces (or a single specified dataspace). " +
      "For each matching well, resolves child objects (wellbores, logs, trajectories, channelSets) " +
      "via ETP relationship graph traversal.\n\n" +
      "**Name pattern**: Use `*` as wildcard (e.g., `DROGON*` matches all wells starting with DROGON). " +
      "Pattern matching is case-insensitive.\n\n" +
      "**Performance note**: Searching all dataspaces iterates each one sequentially. " +
      "Specify `dataspace` when you know where the wells reside.",
    servers: swaggerServers
  })
  @ApiQuery({ name: "name", required: false, description: "Well name pattern. Use * as wildcard (e.g., 'DROGON*', '*-1', '*'). Case-insensitive. Defaults to '*' (all wells).", example: "DROGON*" })
  @ApiQuery({ name: "dataspace", required: false, description: "Restrict search to a single dataspace path (e.g., 'test/drogon'). Omit to search all dataspaces.", example: "test/drogon" })
  @ApiQuery({ name: "include", required: false, description: "Comma-separated list of child types to resolve: logs, trajectories, channelSets. Omit to include all.", example: "logs,trajectories" })
  @ApiOkResponse({ description: "Array of wells, each with resolved child objects (wellbores always included)" })
  async findWells(
    @Query("name") namePattern: string = "*",
    @Query("dataspace") dataspace?: string,
    @Query("include") include?: string,
    @Req() request?: express.Request
  ) {
    let c: ResqmlClient | undefined;
    try {
      c = await createSession(extractToken(request!));

      // Get dataspaces to search
      let dataspaces: Array<{ path: string }>;
      if (dataspace) {
        dataspaces = [{ path: dataspace }];
      } else {
        const dsResult = await c.getDataspaces();
        dataspaces = (dsResult || []).filter(d => d.path && d.path !== "/");
      }

      const includeSet = new Set(
        include ? include.split(",").map(s => s.trim().toLowerCase()) : ["logs", "trajectories", "channelsets"]
      );

      // Convert user wildcard to regex for client-side name filtering
      const nameRegex = new RegExp("^" + namePattern.replace(/\*/g, ".*") + "$", "i");

      const results: WellResult[] = [];

      for (const ds of dataspaces) {
        const dsPath = ds.path.startsWith("/") ? ds.path.slice(1) : ds.path;
        const dsUri = `eml:///dataspace('${dsPath}')`;

        // Search for WITSML wells
        let wellResources: Energistics.Etp.v12.Datatypes.Object.Resource[] = [];
        try {
          wellResources = await findResources(c,
            { uri: dsUri, depth: 1, dataObjectTypes: ["witsml21.Well"], navigableEdges: "Both" },
            {}
          );
        } catch {
          // dataspace may not have wells
        }

        // Also try RESQML WellboreFeature if no WITSML wells
        if (wellResources.length === 0) {
          try {
            wellResources = await findResources(c,
              { uri: dsUri, depth: 1, dataObjectTypes: ["resqml20.obj_WellboreFeature"], navigableEdges: "Both" },
              {}
            );
          } catch {
            continue;
          }
        }

        for (const wellRes of wellResources) {
          const well = parseResource(wellRes);
          if (!nameRegex.test(well.name)) continue;
          const result: WellResult = {
            name: well.name,
            uuid: well.uuid,
            dataspace: dsPath,
            typeName: well.typeName,
            wellbores: [],
            logs: [],
            trajectories: [],
            channelSets: []
          };

          // Get children (wellbores, logs, trajectories) via targets
          try {
            const children = await findResources(c,
              { uri: wellRes.uri, depth: 2, navigableEdges: "Primary" },
              {},
              "targets"
            );
            for (const childRes of children) {
              const child = parseResource(childRes);
              const ct = child.typeName.toLowerCase();

              if (ct.includes("wellbore")) {
                result.wellbores.push({ uuid: child.uuid, name: child.name, typeName: child.typeName, dataspace: dsPath });
              } else if (includeSet.has("logs") && ct.includes("log")) {
                result.logs.push({ uuid: child.uuid, name: child.name, typeName: child.typeName, dataspace: dsPath });
              } else if (includeSet.has("trajectories") && ct.includes("trajectory")) {
                result.trajectories.push({ uuid: child.uuid, name: child.name, typeName: child.typeName, dataspace: dsPath });
              } else if (includeSet.has("channelsets") && ct.includes("channelset")) {
                result.channelSets.push({ uuid: child.uuid, name: child.name, typeName: child.typeName, dataspace: dsPath });
              }
            }
          } catch (e) {
            logger.debug(`Could not get children of well ${well.uuid}: ${e}`);
          }

          results.push(result);
        }
      }

      await c.closeSession();
      return results;
    } catch (e: any) {
      if (c) await c.closeSession().catch(() => { });
      throw httpErrorFromEtpError(e);
    }
  }
}
