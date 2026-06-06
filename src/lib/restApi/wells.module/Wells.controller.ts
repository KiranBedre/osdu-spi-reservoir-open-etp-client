import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  ApiBearerAuth,
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
  swaggerServers
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
@ApiTags("Wells")
@ApiBearerAuth("access-token")
@UseGuards(HasBearerGuard("jwt"))
@UseGuards(HasDataPartitionGuard())
export default class WellsController {

  @Get()
  @ApiOperation({
    summary: "Unified well search across all dataspaces",
    description:
      "Finds wells matching the name pattern across all dataspaces, " +
      "resolves the hierarchy: wellbores, logs, trajectories, channelSets.",
    servers: swaggerServers
  })
  @ApiQuery({ name: "name", required: true, description: "Well name pattern (* wildcard)", example: "DROGON*" })
  @ApiQuery({ name: "dataspace", required: false, description: "Limit to specific dataspace" })
  @ApiQuery({ name: "include", required: false, description: "Comma-separated: logs,trajectories,channelSets (default: all)" })
  @ApiOkResponse({ description: "Array of wells with child objects" })
  async findWells(
    @Query("name") namePattern: string,
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
      if (c) await c.closeSession().catch(() => {});
      throw httpErrorFromEtpError(e);
    }
  }
}
