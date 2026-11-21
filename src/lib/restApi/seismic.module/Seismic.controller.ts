// ============================================================================
// Copyright 2019-2026 Open ETP Client contributors. All rights reserved.
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

/**
 * Seismic-interpretation write façade.
 *
 * A thin, domain-shaped REST lane over the shared RESQML object-graph builders
 * (`src/lib/builders`). One route, `PUT /dataspaces/{id}/seismic/{kind}`,
 * accepts a domain spec per kind (bin grid, horizon, fault, velocity model,
 * checkshot / TZ curve), builds the spec-correct RESQML
 * object graph + bulk arrays with the *same* builders the SDK uses, and writes
 * them through the existing ETP session write path — so REST and SDK emit
 * byte-identical graphs.
 *
 * ## RESQML version fidelity
 * - **Velocity** projects to a `ContinuousProperty` on every line (full round-trip).
 * - **Checkshots** are full-fidelity on 2.2/2.3 (native
 *   `SeismicWellboreFrameRepresentation`) and best-effort/lossy on 2.0.x
 *   (decomposed WellboreFrame + time property). See `buildCheckshot`.
 *
 * Extending this lane is intentionally cheap: add a builder in
 * `src/lib/builders`, a body schema + `kind` value, and a case in `put()`.
 */

import {
    BadRequestException,
    Body,
    Controller,
    Param,
    Put,
    Query,
    Req,
    UseGuards
} from "@nestjs/common";

import {
    ApiBearerAuth,
    ApiBody,
    ApiForbiddenResponse,
    ApiHeader,
    ApiInternalServerErrorResponse,
    ApiNotFoundResponse,
    ApiOperation,
    ApiParam,
    ApiProperty,
    ApiQuery,
    ApiTags
} from "@nestjs/swagger";

import { IsIn } from "class-validator";
import { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";

import express from "express";

import {
    DataObject as EtpDataObject,
    Energistics,
    EtpUri,
    IArrayId,
    ResqmlClient
} from "../../client/ResqmlClient";

import {
    FindInDataSpaceParams,
    HasBearerGuard,
    HasDataPartitionGuard,
    createSession,
    errorMessageSchema,
    extractDataPartitionId,
    extractToken,
    extractUserInfo,
    httpErrorFromEtpError,
    partitionPattern,
    patternString,
    swaggerServers,
    transactionIdQueryParam
} from "../ControllerUtils";
import { ensureHdfProxies } from "../HdfProxyUtils";

import { XMLBuilder } from "../../mlTypes/Json2Xml";
import { bigIntToString } from "../../mlTypes/XmlJsonUtil";
import { qualifiedTypeRegex } from "../../common/EtpQualifiedType";

import logging from "../../common/Logging";

import {
    BuiltObject,
    CheckshotSpec,
    FaultControlPointsSpec,
    FaultSticksSpec,
    GriddedHorizonSpec,
    HorizonControlPointsSpec,
    RESQML_VERSIONS,
    ResqmlVersion,
    SeismicBinGridSpec,
    isResqmlVersion,
    VelocityModelSpec,
    buildCheckshot,
    buildFaultControlPoints,
    buildFaultSticks,
    buildGriddedHorizon,
    buildHorizonControlPoints,
    buildSeismicBinGrid,
    buildVelocityModel
} from "../../builders";

const logger = logging.getLogger("EtpClient");

const partitionId = process.env.DATA_PARTITION_ID ?? "data-partition-id";

/** Summary of a seismic write (objects + bulk arrays committed). */
interface WriteSummary {
    objects: number;
    arrays: number;
}

/**
 * Seismic-interpretation builders exposed over REST.
 *
 * @export
 * @class SeismicAPI
 */

/**
 * Resolve the `representation` switch of the paired seismic routes: explicit
 * query value wins, otherwise the first marker field present in the body.
 */
function pickRepresentation<T extends string>(
    explicit: string | undefined,
    allowed: readonly T[],
    body: unknown,
    markers: Record<string, T>
): T {
    if (explicit !== undefined) {
        if (!(allowed as readonly string[]).includes(explicit)) {
            throw new BadRequestException({
                description: `representation must be one of ${allowed.join(", ")}`
            });
        }
        return explicit as T;
    }
    const b = (body ?? {}) as Record<string, unknown>;
    for (const [field, kind] of Object.entries(markers)) {
        if (b[field] !== undefined) {
            return kind;
        }
    }
    throw new BadRequestException({
        description: `Cannot infer representation from the body; pass ?representation=${allowed.join("|")} or include one of ${Object.keys(markers).join(", ")}`
    });
}

/** Route-level discriminator: the seismic object family written by `PUT /seismic/{kind}`. */
export const SEISMIC_KINDS = ["bingrid", "horizons", "faults", "velocity", "checkshots"] as const;
export type SeismicKind = (typeof SEISMIC_KINDS)[number];

// Per-kind request bodies. Kept as plain OpenAPI schema literals (not DTO
// classes) because the builders accept interface specs; the merged route
// documents them as a titled `oneOf`.
const velocityBodySchema = {
    type: "object",
    required: ["title", "hdfUuid", "supportingRepUuid", "supportingRepType", "velocityKind", "values"],
    properties: {
        title: { type: "string", description: "Citation title." },
        uuid: { type: "string", description: "ContinuousProperty Uuid (generated when omitted)." },
        version: { type: "string", enum: [...RESQML_VERSIONS], description: "RESQML version (default 2.0.1)." },
        hdfUuid: { type: "string", description: "HDF proxy the value array hangs off. Written automatically when absent from the dataspace." },
        supportingRepUuid: { type: "string", description: "Supporting representation (Grid2d for a layer velocity, IjkGrid for a volume)." },
        supportingRepType: { type: "string", example: "obj_Grid2dRepresentation", description: "Supporting representation object type." },
        velocityKind: { type: "string", enum: ["interval", "average", "rms", "Vp", "Vs", "Vp/Vs"], description: "Canonical velocity kind." },
        values: { type: "array", items: { type: "number" }, description: "Velocity values, aligned to the supporting representation's indexable element." },
        uom: { type: "string", description: "UOM; defaults to m/s (Vp/Vs defaults to euc)." },
        dimensions: { type: "array", items: { type: "integer" }, description: "Array dimensions (defaults to [values.length])." },
        indexable: { type: "string", description: "Indexable element the property is attached to." },
        originator: { type: "string" }
    },
    example: {
        title: "Drogon interval velocity — Top Volantis",
        hdfUuid: "d3f1a5c8-9e42-4b70-8a16-5c2e7f0b9d31",
        version: "2.0.1",
        supportingRepUuid: "9a7c1e50-3b2d-4f68-8e14-6d0a5c9b2f31",
        supportingRepType: "obj_Grid2dRepresentation",
        velocityKind: "interval",
        values: [2560, 2585, 2610, 2635, 2590, 2615, 2640, 2665, 2620],
        uom: "m/s",
        originator: "RDDMS Seismic API"
    }
};

const checkshotBodySchema = {
    type: "object",
    required: ["title", "hdfUuid", "trajectoryUuid", "mds", "times"],
    properties: {
        title: { type: "string", description: "Citation title." },
        uuid: { type: "string", description: "Representation Uuid (generated when omitted)." },
        version: { type: "string", enum: [...RESQML_VERSIONS], description: "RESQML version (default 2.0.1)." },
        hdfUuid: { type: "string", description: "HDF proxy the md/time arrays hang off. Written automatically when absent from the dataspace." },
        trajectoryUuid: { type: "string", description: "Wellbore trajectory the checkshot is tied to." },
        trajectoryType: { type: "string", description: "Trajectory object type (default obj_WellboreTrajectoryRepresentation)." },
        interpretationUuid: { type: "string", description: "Wellbore interpretation (optional but recommended)." },
        interpretationType: { type: "string" },
        mds: { type: "array", items: { type: "number" }, description: "Measured-depth of each pick." },
        times: { type: "array", items: { type: "number" }, description: "Time at each pick (same order/length as mds)." },
        seismicReferenceDatum: { type: "number", description: "Z where seismic time = 0 (2.2/2.3 only)." },
        weatheringVelocity: { type: "number", description: "Seismic replacement / weathering velocity (2.2/2.3 only)." },
        timeCrsUuid: { type: "string", description: "LocalTime3dCrs the time axis is expressed in (2.2/2.3)." },
        timeCrsType: { type: "string" },
        timeKind: { type: "string", enum: ["two-way time", "one-way time"], description: "Time convention for the decomposed 2.0.x property (default two-way time)." },
        timeUom: { type: "string", description: "Time UOM for the decomposed 2.0.x property (default ms)." },
        originator: { type: "string" }
    },
    example: {
        title: "Drogon checkshot — 55/33-1",
        hdfUuid: "d3f1a5c8-9e42-4b70-8a16-5c2e7f0b9d31",
        version: "2.0.1",
        trajectoryUuid: "2c3d4e5f-6071-4b82-9ca3-b4d5e6f70819",
        trajectoryType: "obj_WellboreTrajectoryRepresentation",
        interpretationUuid: "3d4e5f60-7182-4c93-8db4-c5e6f708192a",
        interpretationType: "obj_WellboreInterpretation",
        mds: [0, 550, 1100, 1575, 1650],
        times: [0, 372, 706, 968, 1004],
        seismicReferenceDatum: 0,
        timeKind: "two-way time",
        timeUom: "ms",
        originator: "RDDMS Seismic API"
    }
};

const horizonBodySchema = {
    oneOf: [
        { title: "gridded", ...{
                    type: "object",
                    required: ["title", "hdfUuid", "crsUuid", "ni", "nj", "origin", "iSpacing", "jSpacing", "zValues"],
                    properties: {
                        title: { type: "string", description: "Citation title." },
                        uuid: { type: "string", description: "Grid2dRepresentation Uuid (generated when omitted)." },
                        version: { type: "string", enum: [...RESQML_VERSIONS], description: "RESQML version (default 2.0.1)." },
                        hdfUuid: { type: "string", description: "HDF proxy the Z array hangs off. Written automatically when absent from the dataspace." },
                        crsUuid: { type: "string", description: "CRS the lattice is expressed in." },
                        crsType: { type: "string", description: "CRS object type (default obj_LocalDepth3dCrs)." },
                        domain: { type: "string", enum: ["depth", "time"], description: "Vertical domain of the horizon (default time)." },
                        interpretationUuid: { type: "string", description: "Existing HorizonInterpretation this grid represents (else feature + interpretation are created)." },
                        interpretationType: { type: "string" },
                        interpretationTitle: { type: "string", description: "Title for the auto-created HorizonInterpretation." },
                        interpretationSrn: { type: "string", description: "OSDU SRN of the interpretation. When no interpretationUuid is given, a deterministic UUID is derived from it and the feature + interpretation are created (idempotent, masterdata-linked)." },
                        featureUuid: { type: "string", description: "Existing boundary feature (only used when interpretationUuid is set)." },
                        featureTitle: { type: "string", description: "Title for the auto-created GeneticBoundaryFeature." },
                        featureSrn: { type: "string", description: "OSDU SRN of the boundary feature (deterministic UUID source)." },
                        ni: { type: "integer", description: "Number of nodes along the fastest axis (I)." },
                        nj: { type: "integer", description: "Number of nodes along the slowest axis (J)." },
                        origin: {
                            type: "object",
                            required: ["x", "y"],
                            properties: {
                                x: { type: "number" },
                                y: { type: "number" },
                                z: { type: "number", description: "Defaults to 0." }
                            }
                        },
                        iSpacing: { type: "number", description: "Node spacing along I (fastest)." },
                        jSpacing: { type: "number", description: "Node spacing along J (slowest)." },
                        zValues: { type: "array", items: { type: "number" }, description: "Z values, length ni*nj, row-major (J outer, I inner)." },
                        originator: { type: "string" }
                    },
                    example: {
                        title: "Top Volantis (gridded)",
                        uuid: "9a7c1e50-3b2d-4f68-8e14-6d0a5c9b2f31",
                        hdfUuid: "d3f1a5c8-9e42-4b70-8a16-5c2e7f0b9d31",
                        crsUuid: "0e2b8d14-6f3a-4a5e-9c21-7f0b3d5e1a90",
                        version: "2.0.1",
                        domain: "depth",
                        interpretationTitle: "Top Volantis",
                        featureTitle: "Top Volantis boundary",
                        ni: 3,
                        nj: 3,
                        origin: { x: 456000, y: 5930000, z: 0 },
                        iSpacing: 50,
                        jSpacing: 50,
                        zValues: [1575, 1578, 1582, 1580, 1584, 1589, 1586, 1591, 1597]
                    }
                } },
        { title: "control-points", ...{
                    type: "object",
                    required: ["title", "hdfUuid", "crsUuid", "points"],
                    properties: {
                        title: { type: "string", description: "Citation title." },
                        uuid: { type: "string", description: "PointSetRepresentation Uuid (generated when omitted)." },
                        version: { type: "string", enum: [...RESQML_VERSIONS], description: "RESQML version (default 2.0.1)." },
                        hdfUuid: { type: "string", description: "HDF proxy the XYZ control-point array hangs off. Written automatically when absent from the dataspace." },
                        crsUuid: { type: "string", description: "CRS the points are expressed in." },
                        crsType: { type: "string" },
                        domain: { type: "string", enum: ["depth", "time"], description: "Vertical domain of the horizon (default time)." },
                        originator: { type: "string" },
                        points: { type: "array", items: { type: "number" }, description: "Flat XYZ triples: [x0,y0,z0, x1,y1,z1, ...]." },
                        interpretationUuid: { type: "string", description: "Existing HorizonInterpretation to attach to (else one is created)." },
                        interpretationSrn: { type: "string", description: "OSDU SRN of the interpretation. When no interpretationUuid is given, a deterministic UUID is derived from it and the feature + interpretation are created (idempotent, masterdata-linked)." },
                        featureUuid: { type: "string", description: "Existing boundary feature (only used when interpretationUuid is set)." },
                        featureSrn: { type: "string", description: "OSDU SRN of the boundary feature (deterministic UUID source)." },
                        interpretationTitle: { type: "string" },
                        featureTitle: { type: "string" }
                    },
                    example: {
                        title: "Top Volantis picks",
                        hdfUuid: "d3f1a5c8-9e42-4b70-8a16-5c2e7f0b9d31",
                        crsUuid: "0e2b8d14-6f3a-4a5e-9c21-7f0b3d5e1a90",
                        version: "2.0.1",
                        domain: "depth",
                        interpretationUuid: "1b2c3d4e-5f60-4a71-8b92-a3c4d5e6f708",
                        points: [456010, 5930010, 1575, 456060, 5930010, 1580, 456010, 5930060, 1584],
                        originator: "RDDMS Seismic API"
                    }
                } }
    ]
};

const faultBodySchema = {
    oneOf: [
        { title: "sticks", ...{
                    type: "object",
                    required: ["title", "hdfUuid", "crsUuid", "sticks"],
                    properties: {
                        title: { type: "string", description: "Citation title." },
                        uuid: { type: "string", description: "PolylineSetRepresentation Uuid (generated when omitted)." },
                        version: { type: "string", enum: [...RESQML_VERSIONS], description: "RESQML version (default 2.0.1)." },
                        hdfUuid: { type: "string", description: "HDF proxy the stick point + node-count arrays hang off. Written automatically when absent from the dataspace." },
                        crsUuid: { type: "string", description: "CRS the sticks are expressed in." },
                        crsType: { type: "string" },
                        domain: { type: "string", enum: ["depth", "time"], description: "Vertical domain of the fault (default depth)." },
                        originator: { type: "string" },
                        sticks: {
                            type: "array",
                            items: { type: "array", items: { type: "number" } },
                            description: "One entry per fault stick: flat XYZ triples [x0,y0,z0, x1,y1,z1, ...]."
                        },
                        closed: { type: "boolean", description: "Emit closed polygons instead of open sticks (default false)." },
                        interpretationUuid: { type: "string", description: "Existing FaultInterpretation to attach to (else one is created)." },
                        interpretationSrn: { type: "string", description: "OSDU SRN of the interpretation. When no interpretationUuid is given, a deterministic UUID is derived from it and the feature + interpretation are created (idempotent, masterdata-linked)." },
                        featureUuid: { type: "string", description: "Existing tectonic boundary feature (only used when interpretationUuid is set)." },
                        featureSrn: { type: "string", description: "OSDU SRN of the tectonic boundary feature (deterministic UUID source)." },
                        interpretationTitle: { type: "string" },
                        featureTitle: { type: "string" }
                    },
                    example: {
                        title: "F1 fault sticks",
                        hdfUuid: "d3f1a5c8-9e42-4b70-8a16-5c2e7f0b9d31",
                        crsUuid: "0e2b8d14-6f3a-4a5e-9c21-7f0b3d5e1a90",
                        version: "2.0.1",
                        domain: "depth",
                        interpretationTitle: "F1",
                        featureTitle: "F1 fault",
                        sticks: [
                            [456100, 5930000, 1560, 456120, 5930000, 1600, 456140, 5930000, 1645],
                            [456100, 5930100, 1558, 456120, 5930100, 1598, 456140, 5930100, 1643]
                        ],
                        originator: "RDDMS Seismic API"
                    }
                } },
        { title: "control-points", ...{
                    type: "object",
                    required: ["title", "hdfUuid", "crsUuid", "points"],
                    properties: {
                        title: { type: "string", description: "Citation title." },
                        uuid: { type: "string", description: "PointSetRepresentation Uuid (generated when omitted)." },
                        version: { type: "string", enum: [...RESQML_VERSIONS], description: "RESQML version (default 2.0.1)." },
                        hdfUuid: { type: "string", description: "HDF proxy the XYZ control-point array hangs off. Written automatically when absent from the dataspace." },
                        crsUuid: { type: "string", description: "CRS the points are expressed in." },
                        crsType: { type: "string" },
                        domain: { type: "string", enum: ["depth", "time"], description: "Vertical domain of the fault (default depth)." },
                        originator: { type: "string" },
                        points: { type: "array", items: { type: "number" }, description: "Flat XYZ triples: [x0,y0,z0, x1,y1,z1, ...]." },
                        interpretationUuid: { type: "string", description: "Existing FaultInterpretation to attach to (else one is created)." },
                        interpretationSrn: { type: "string", description: "OSDU SRN of the interpretation. When no interpretationUuid is given, a deterministic UUID is derived from it and the feature + interpretation are created (idempotent, masterdata-linked)." },
                        featureUuid: { type: "string", description: "Existing tectonic boundary feature (only used when interpretationUuid is set)." },
                        featureSrn: { type: "string", description: "OSDU SRN of the tectonic boundary feature (deterministic UUID source)." },
                        interpretationTitle: { type: "string" },
                        featureTitle: { type: "string" }
                    },
                    example: {
                        title: "F1 fault picks",
                        hdfUuid: "d3f1a5c8-9e42-4b70-8a16-5c2e7f0b9d31",
                        crsUuid: "0e2b8d14-6f3a-4a5e-9c21-7f0b3d5e1a90",
                        version: "2.0.1",
                        domain: "depth",
                        interpretationSrn: "osdu:work-product-component--FaultInterpretation:F1",
                        featureTitle: "F1 fault",
                        points: [456100, 5930000, 1560, 456120, 5930050, 1580, 456140, 5930100, 1600],
                        originator: "RDDMS Seismic API"
                    }
                } }
    ]
};

const binGridBodySchema = {
    type: "object",
    required: [
        "title", "crsUuid", "originEasting", "originNorthing", "binWidthOnIaxis",
        "binWidthOnJaxis", "bearingJaxisDeg", "firstInlineIndex", "inlineIndexIncrement",
        "firstCrosslineIndex", "crosslineIndexIncrement", "inlineBinCount", "crosslineBinCount"
    ],
    properties: {
        title: { type: "string", description: "Citation title." },
        uuid: { type: "string", description: "Grid2dRepresentation Uuid (generated when omitted)." },
        version: { type: "string", enum: [...RESQML_VERSIONS], description: "RESQML version (default 2.0.1)." },
        crsUuid: { type: "string", description: "CRS (LocalDepth3dCrs/LocalTime3dCrs) the origin/offsets are expressed in." },
        crsType: { type: "string", description: "CRS object type; defaults from domain." },
        domain: { type: "string", enum: ["depth", "time"], description: "Vertical domain (default depth)." },
        originator: { type: "string" },
        originEasting: { type: "number", description: "P6BinGridOriginEasting." },
        originNorthing: { type: "number", description: "P6BinGridOriginNorthing." },
        originZ: { type: "number", description: "Vertical coordinate of the lattice origin (default 0)." },
        binWidthOnIaxis: { type: "number", description: "P6BinWidthOnIaxis (inline bin width)." },
        binWidthOnJaxis: { type: "number", description: "P6BinWidthOnJaxis (crossline bin width)." },
        bearingJaxisDeg: { type: "number", description: "P6MapGridBearingOfBinGridJaxis (degrees)." },
        bearingIaxisDeg: { type: "number", description: "I-axis bearing (deg); defaults to bearingJaxisDeg - 90." },
        firstInlineIndex: { type: "integer", description: "P6BinGridOriginI." },
        inlineIndexIncrement: { type: "integer", description: "P6BinNodeIncrementOnIaxis." },
        firstCrosslineIndex: { type: "integer", description: "P6BinGridOriginJ." },
        crosslineIndexIncrement: { type: "integer", description: "P6BinNodeIncrementOnJaxis." },
        inlineBinCount: { type: "integer", description: "Number of inline (I) bins; lattice nodes = this + 1." },
        crosslineBinCount: { type: "integer", description: "Number of crossline (J) bins; lattice nodes = this + 1." },
        featureUuid: { type: "string", description: "Reuse an existing SeismicLatticeFeature." },
        interpretationUuid: { type: "string", description: "Reuse an existing GenericFeatureInterpretation." },
        featureTitle: { type: "string" },
        interpretationTitle: { type: "string" }
    },
    example: {
        title: "Drogon 3D bin grid",
        crsUuid: "0e2b8d14-6f3a-4a5e-9c21-7f0b3d5e1a90",
        version: "2.0.1",
        domain: "depth",
        featureTitle: "Drogon 3D survey lattice",
        interpretationTitle: "Drogon 3D bin grid interpretation",
        originEasting: 456000,
        originNorthing: 5930000,
        originZ: 0,
        binWidthOnIaxis: 25,
        binWidthOnJaxis: 12.5,
        bearingJaxisDeg: 30,
        firstInlineIndex: 100,
        inlineIndexIncrement: 1,
        firstCrosslineIndex: 200,
        crosslineIndexIncrement: 1,
        inlineBinCount: 20,
        crosslineBinCount: 40,
        originator: "RDDMS Seismic API"
    }
};

/** Body of `PUT /seismic/{kind}`: one variant per kind (horizons/faults have two carriers each). */
const seismicBodySchema = {
    oneOf: [
        { title: "bingrid", ...binGridBodySchema },
        ...horizonBodySchema.oneOf.map(v => ({ ...v, title: `horizons (${v.title})` })),
        ...faultBodySchema.oneOf.map(v => ({ ...v, title: `faults (${v.title})` })),
        { title: "velocity", ...velocityBodySchema },
        { title: "checkshots", ...checkshotBodySchema }
    ]
} as SchemaObject;

/** Path params of `PUT /seismic/{kind}` (whitelisted so the validation pipe accepts `kind`). */
class SeismicKindParams extends FindInDataSpaceParams {
    @ApiProperty({ name: "kind", enum: SEISMIC_KINDS, description: "Seismic object family to write." })
    @IsIn(SEISMIC_KINDS)
    kind!: SeismicKind;
}

@ApiBearerAuth("HTTPBearer")
@UseGuards(HasBearerGuard("jwt"))
@ApiHeader({
    name: "data-partition-id",
    description: "Data partition id (ex. 'osdu')",
    schema: {
        type: "string",
        example: partitionId,
        maxLength: 1048,
        pattern: patternString(partitionPattern)
    }
})
@UseGuards(HasDataPartitionGuard())
@ApiTags("Seismic")
@ApiForbiddenResponse(errorMessageSchema("Forbidden", 403))
@ApiNotFoundResponse(errorMessageSchema("Not found", 404))
@ApiInternalServerErrorResponse(errorMessageSchema(`Unknown Error`, 500))
@Controller("dataspaces/:dataspaceId/seismic")
export default class SeismicAPI {
    /**
     * One write route for the seismic-interpretation family. `kind` selects
     * the RESQML object graph to build; the body is the matching spec.
     */
    @Put(":kind")
    @ApiParam({
        name: "kind",
        enum: SEISMIC_KINDS,
        description:
            "`bingrid` (P6/98 bin grid -> SeismicLatticeFeature + Grid2dRepresentation), " +
            "`horizons` (Grid2dRepresentation or PointSetRepresentation + HorizonInterpretation), " +
            "`faults` (PolylineSetRepresentation or PointSetRepresentation + FaultInterpretation), " +
            "`velocity` (ContinuousProperty with a canonical velocity kind), " +
            "`checkshots` (SeismicWellboreFrameRepresentation on 2.2/2.3, decomposed frame + time property on 2.0.x)."
    })
    @ApiQuery(transactionIdQueryParam)
    @ApiQuery({
        name: "representation",
        required: false,
        enum: ["gridded", "control-points", "sticks"],
        description:
            "Carrier for `horizons` (`gridded` | `control-points`) and `faults` (`sticks` | `control-points`). " +
            "Inferred from the body when omitted: `zValues` means gridded, `sticks` means sticks, `points` means control-points. Ignored for other kinds."
    })
    @ApiQuery({
        name: "version",
        required: false,
        enum: [...RESQML_VERSIONS],
        description:
            "RESQML version override for `checkshots` and `bingrid` (2.0.1 or 2.2.0; unknown values are rejected with 400); falls back to the spec's `version`. " +
            "Checkshots: 2.2 (EML 2.3) emits a native SeismicWellboreFrameRepresentation (full fidelity), 2.0.x decomposes to a WellboreFrame + time property (lossy). " +
            "Bin grid: 2.0.x emit a Grid2dPatch + Offset lattice with scalar inline/crossline indices, 2.2/2.3 an EML 2.3 Dimension lattice with InlineLabels/CrosslineLabels."
    })
    @ApiBody({
        description:
            "Spec for the selected `kind` (see the titled variants). Horizon and fault writes are FIRP-complete: " +
            "the GeneticBoundaryFeature/TectonicBoundaryFeature + interpretation are created when `interpretationUuid` is omitted, " +
            "and an `interpretationSrn`/`featureSrn` derives a deterministic UUID so a re-PUT upserts the same object.",
        schema: seismicBodySchema
    })
    @ApiOperation({
        summary: "Put a seismic interpretation object (bingrid | horizons | faults | velocity | checkshots)",
        description:
            "Build and write one seismic-domain RESQML object graph with the same builders the SDK uses, " +
            "through the ETP write path (auto-opens a transaction unless `transactionId` is supplied). " +
            "Returns the written UUIDs per kind: `bingrid` -> binGridUuid, interpretationUuid, featureUuid; " +
            "`horizons` -> gridUuid or pointSetUuid, interpretationUuid, featureUuid (when created); " +
            "`faults` -> representationUuid, interpretationUuid, featureUuid (when created); " +
            "`velocity` -> uuid + kindResolution; `checkshots` -> uuids. Every response also carries the object/array counts committed.",
        servers: swaggerServers
    })
    public async put(
        @Param() params: SeismicKindParams,
        @Body() spec: Record<string, unknown>,
        @Query("representation") representation?: string,
        @Query("transactionId") transactionId?: string,
        @Query("version") version?: string,
        @Req() request?: express.Request
    ): Promise<Record<string, unknown>> {
        if (version !== undefined && !isResqmlVersion(version)) {
            throw new BadRequestException({
                description: `version must be one of ${RESQML_VERSIONS.join(", ")} (got "${version}")`
            });
        }
        if (spec?.version !== undefined && !isResqmlVersion(spec.version)) {
            throw new BadRequestException({
                description: `body.version must be one of ${RESQML_VERSIONS.join(", ")} (got "${String(spec.version)}")`
            });
        }
        switch (params.kind) {
            case "velocity":
                return this.putVelocity(spec as unknown as VelocityModelSpec, params, transactionId, request);
            case "checkshots":
                return this.putCheckshots(spec as unknown as CheckshotSpec, params, transactionId, version, request);
            case "horizons":
                return this.putHorizon(
                    spec as unknown as GriddedHorizonSpec | HorizonControlPointsSpec,
                    params,
                    representation,
                    transactionId,
                    request
                );
            case "faults":
                return this.putFault(
                    spec as unknown as FaultSticksSpec | FaultControlPointsSpec,
                    params,
                    representation,
                    transactionId,
                    request
                );
            case "bingrid":
                return this.putBinGrid(spec as unknown as SeismicBinGridSpec, params, transactionId, version, request);
            default:
                throw new BadRequestException({
                    description: `kind must be one of ${SEISMIC_KINDS.join(", ")}`
                });
        }
    }

    /**
     * Create/replace a velocity model (ContinuousProperty with a canonical
     * velocity kind). Full round-trip on every RESQML line.
     */
    private async putVelocity(
        spec: VelocityModelSpec,
        params: FindInDataSpaceParams,
        transactionId?: string,
        request?: express.Request
    ): Promise<Record<string, unknown>> {
        const built = buildVelocityModel(spec);
        const written = await this.execute(
            request,
            params.dataspaceId,
            transactionId,
            [built]
        );
        return {
            uuid: built.object.Uuid,
            kindResolution: built.kindResolution,
            ...written
        };
    }

    /**
     * Create/replace a checkshot / time-depth (TZ) curve. Full fidelity on
     * 2.2/2.3, best-effort (lossy) on 2.0.x — see `buildCheckshot`.
     */
    private async putCheckshots(
        spec: CheckshotSpec,
        params: FindInDataSpaceParams,
        transactionId?: string,
        version?: string,
        request?: express.Request
    ): Promise<Record<string, unknown>> {
        const parts = buildCheckshot({
            ...spec,
            version: (version as ResqmlVersion) ?? spec.version
        });
        const written = await this.execute(
            request,
            params.dataspaceId,
            transactionId,
            parts
        );
        return {
            uuids: parts.map(p => p.object.Uuid),
            ...written
        };
    }

    /**
     * Create/replace a horizon, either as a regular gridded surface
     * (Grid2dRepresentation: lattice XY + Z array) or as the scattered picks it
     * is interpreted from (PointSetRepresentation, flat XYZ). Both are tied to a
     * HorizonInterpretation + GeneticBoundaryFeature which are created in the
     * same call when `interpretationUuid` is omitted (an `interpretationSrn`
     * mints a deterministic, masterdata-linked UUID).
     */
    private async putHorizon(
        spec: GriddedHorizonSpec | HorizonControlPointsSpec,
        params: FindInDataSpaceParams,
        representation?: string,
        transactionId?: string,
        request?: express.Request
    ): Promise<Record<string, unknown>> {
        const kind = pickRepresentation(
            representation,
            ["gridded", "control-points"],
            spec,
            { zValues: "gridded", points: "control-points" }
        );
        if (kind === "gridded") {
            const built = buildGriddedHorizon(spec as GriddedHorizonSpec);
            const written = await this.execute(request, params.dataspaceId, transactionId, built.parts);
            return {
                gridUuid: built.gridUuid,
                interpretationUuid: built.interpretationUuid,
                ...(built.featureUuid ? { featureUuid: built.featureUuid } : {}),
                ...written
            };
        }
        const built = buildHorizonControlPoints(spec as HorizonControlPointsSpec);
        const written = await this.execute(request, params.dataspaceId, transactionId, built.parts);
        return {
            pointSetUuid: built.pointSetUuid,
            interpretationUuid: built.interpretationUuid,
            ...(built.featureUuid ? { featureUuid: built.featureUuid } : {}),
            ...written
        };
    }

    /**
     * Create/replace a fault, either as fault sticks (PolylineSetRepresentation,
     * one polyline per stick or closed polygon) or as the scattered picks
     * (PointSetRepresentation, flat XYZ). Both are tied to a FaultInterpretation
     * + TectonicBoundaryFeature created in the same call when
     * `interpretationUuid` is omitted; an `interpretationSrn` mints a
     * deterministic UUID.
     */
    private async putFault(
        spec: FaultSticksSpec | FaultControlPointsSpec,
        params: FindInDataSpaceParams,
        representation?: string,
        transactionId?: string,
        request?: express.Request
    ): Promise<Record<string, unknown>> {
        const kind = pickRepresentation(
            representation,
            ["sticks", "control-points"],
            spec,
            { sticks: "sticks", points: "control-points" }
        );
        const built =
            kind === "sticks"
                ? buildFaultSticks(spec as FaultSticksSpec)
                : buildFaultControlPoints(spec as FaultControlPointsSpec);
        const written = await this.execute(request, params.dataspaceId, transactionId, built.parts);
        return {
            representationUuid: built.representationUuid,
            interpretationUuid: built.interpretationUuid,
            ...(built.featureUuid ? { featureUuid: built.featureUuid } : {}),
            ...written
        };
    }

    /**
     * Create a seismic bin grid from an OSDU P6/98 SeismicBinGrid definition —
     * the *reverse* of the RESQML → OSDU SeismicBinGrid converter.
     *
     * Given the P6 georeferencing (origin, bin widths, J-axis bearing) and the
     * inline/crossline index space, this synthesises the RESQML object graph
     * (`SeismicLatticeFeature` → `GenericFeatureInterpretation` →
     * `Grid2dRepresentation`) and writes it. The forward converter re-projects
     * the written grid to the *same* P6 record (reversible round-trip). 2.0.1 is
     * the primary line; 2.2/2.3 emit the EML 2.3 lattice/label shapes.
     */
    private async putBinGrid(
        spec: SeismicBinGridSpec,
        params: FindInDataSpaceParams,
        transactionId?: string,
        version?: string,
        request?: express.Request
    ): Promise<Record<string, unknown>> {
        const built = buildSeismicBinGrid({
            ...spec,
            version: (version as ResqmlVersion) ?? spec.version
        });
        const written = await this.execute(
            request,
            params.dataspaceId,
            transactionId,
            built.parts
        );
        return {
            binGridUuid: built.binGridUuid,
            interpretationUuid: built.interpretationUuid,
            featureUuid: built.featureUuid,
            ...written
        };
    }

    // ──────────────────────────────────────────────────────────────────────
    // Shared write path (mirrors write-etp.module/ObjectWrite.controller)
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Open a session (joining `transactionId` when supplied, else auto-commit),
     * write the built parts, and close the session when auto-committing.
     */
    private async execute(
        request: express.Request | undefined,
        dataspaceId: string,
        transactionId: string | undefined,
        parts: BuiltObject[]
    ): Promise<WriteSummary> {
        let c: ResqmlClient | undefined = undefined;
        try {
            logger.info(
                `Seismic write: ${parts.length} object(s) into dataspace ${dataspaceId}` +
                (transactionId ? ` (tx ${transactionId})` : " (auto-commit)")
            );
            c = await createSession(
                extractToken(request),
                extractDataPartitionId(request),
                undefined,
                transactionId,
                extractUserInfo(request)
            );
            const written = await this.writeParts(c, dataspaceId, parts);
            if (!transactionId) {
                await c.closeSession();
            }
            return written;
        } catch (err) {
            logger.error(`Error during seismic write: ${err}`);
            if (!transactionId) {
                await c?.closeSession();
            }
            throw httpErrorFromEtpError(err);
        }
    }

    /** Write built RESQML objects (as XML) followed by their bulk arrays. */
    private async writeParts(
        c: ResqmlClient,
        dataspaceId: string,
        builtParts: BuiltObject[]
    ): Promise<WriteSummary> {
        const xmlBuilder = new XMLBuilder();
        // Prepend any EpcExternalPartReference the arrays point at that is in
        // neither the batch nor the store (else: `Missing array container(s)`).
        const parts = await ensureHdfProxies(c, dataspaceId, builtParts);

        const etpObjects = parts.map(p => {
            const obj = p.object;
            if (!obj.$type) {
                throw new BadRequestException({
                    description: `Built object is missing a $type (uuid ${obj.Uuid})`
                });
            }
            const m = obj.$type.match(qualifiedTypeRegex);
            if (!m?.groups) {
                throw new BadRequestException({
                    description: `Built object has an invalid $type '${obj.$type}'`
                });
            }
            const uri = EtpUri.createObjectUri(
                dataspaceId,
                m.groups.domainFamily ?? "",
                m.groups.domainVersion ?? "",
                m.groups.dataType ?? "",
                obj.Uuid
            ).uri;
            const xml = xmlBuilder.JSONtoEnergistics(JSON.stringify(obj, bigIntToString));
            return {
                resource: {
                    uri,
                    name: obj.Citation?.Title ?? "",
                    alternateUris: [],
                    sourceCount: null,
                    targetCount: null,
                    lastChanged: BigInt(0),
                    storeCreated: BigInt(0),
                    storeLastWrite: BigInt(0),
                    activeStatus:
                        Energistics.Etp.v12.Datatypes.Object.ActiveStatusKind.Active,
                    customData: new Map()
                },
                data: Buffer.from(xml),
                format: "xml",
                blobId: null
            };
        });

        await c.putDataObjects(etpObjects as unknown as EtpDataObject[], { throwOnError: true });

        const arrays = parts.flatMap(p => p.arrays ?? []);
        const arrayInputs = arrays.flatMap(a => {
            if (a.Data === undefined) return [];
            const m = qualifiedTypeRegex.exec(a.ContainerType);
            const uri = EtpUri.createObjectUri(
                dataspaceId,
                m?.groups?.domainFamily ?? "",
                m?.groups?.domainVersion ?? "",
                m?.groups?.dataType ?? "",
                a.ContainerUuid
            ).uri;
            const dataArray: IArrayId = { uri, pathInResource: a.PathInResource };
            return [{ uid: dataArray, dimensions: a.Dimensions, data: this.toTypedArray(a.Data, a.ArrayType) }];
        });
        // Generic bounded-concurrency array write (ResqmlClient.putDataArrays).
        await c.putDataArrays(arrayInputs);

        return { objects: etpObjects.length, arrays: arrayInputs.length };
    }

    /**
     * Convert builder array data (a JSON number[]) to the typed array ETP
     * expects. The builders only emit Float64Array/Int32Array bulk data.
     */
    private toTypedArray(
        data: number[] | string,
        arrayType: string
    ): Float64Array | Int32Array {
        if (typeof data === "string") {
            throw new BadRequestException({
                description: "Base64 array data is not supported by the seismic lane"
            });
        }
        return arrayType === "Int32Array"
            ? Int32Array.from(data)
            : Float64Array.from(data);
    }
}
