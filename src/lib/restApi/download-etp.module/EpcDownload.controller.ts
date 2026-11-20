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
 * EPC export lane — the inverse of the EPC uploader.
 *
 * Given a dataspace (and/or an explicit UUID list), gather the requested
 * objects **plus every object they reference through DORs** (CRS, HDF proxy /
 * EpcExternalPartReference, interpretations, features, …), pull the bulk HDF5
 * arrays each object points at, and package the whole self-contained set as a
 * single `.epc` (OPC zip): `[Content_Types].xml` + per-object XML parts + an
 * embedded HDF5 file carrying every referenced dataset.
 *
 * The gather step uses {@link ResqmlClient.buildSearchMap} with deep resolution
 * so the produced EPC is dependency-closed — it can be re-uploaded through the
 * EPC uploader (or opened by fesapi / resqpy) without dangling references.
 */

import {
    BadRequestException,
    Controller,
    Get,
    NotFoundException,
    Param,
    Query,
    Req,
    Res,
    UseGuards
} from "@nestjs/common";

import {
    ApiBearerAuth,
    ApiOkResponse,
    ApiOperation,
    ApiProduces,
    ApiQuery,
    ApiTags
} from "@nestjs/swagger";

import express from "express";
import * as path from "path";

import {
    Energistics,
    EtpUri,
    ResqmlClient,
    byteToString
} from "../../client/ResqmlClient";

import {
    HasBearerGuard,
    HasDataPartitionGuard,
    createSession,
    extractDataPartitionId,
    extractToken,
    httpErrorFromEtpError,
    swaggerServers
} from "../ControllerUtils";

import logging from "../../common/Logging";

const logger = logging.getLogger("EtpClient");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse family / version / type / uuid out of an object URI. */
const OBJ_URI_RE =
    /(?<family>resqml|eml|witsml|prodml)(?<ver>\d+)\.(?<dtype>\w+)\((?<uuid>[0-9a-fA-F-]{36})\)/;

/** ETP domain-version token (e.g. "20") -> content-type version ("2.0"). */
function ctVersion(verToken: string): string {
    if (verToken.length >= 2) {
        return `${verToken[0]}.${verToken.slice(1)}`;
    }
    return verToken;
}

/** Map an ETP AnyArray key to an HDF5 dtype + a typed-array packer. */
const DTYPES: Record<
    string,
    { dtype: string; pack: (v: unknown[]) => ArrayBufferView }
> = {
    _ArrayOfDouble: { dtype: "<f8", pack: v => Float64Array.from(v as number[]) },
    _ArrayOfFloat: { dtype: "<f4", pack: v => Float32Array.from(v as number[]) },
    _ArrayOfInt: { dtype: "<i4", pack: v => Int32Array.from(v as number[]) },
    _ArrayOfLong: {
        dtype: "<i8",
        pack: v => BigInt64Array.from((v as unknown[]).map(x => BigInt(x as never)))
    },
    _ArrayOfBoolean: {
        dtype: "b",
        pack: v => Int8Array.from((v as boolean[]).map(b => (b ? 1 : 0)))
    }
};

interface H5Dataset {
    /** HDF5 path (e.g. "/RESQML/{uuid}/points"). */
    path: string;
    dtype: string;
    shape: number[];
    data: ArrayBufferView;
}

interface EpcPart {
    /** Zip entry name, e.g. "obj_IjkGridRepresentation_{uuid}.xml". */
    partName: string;
    /** OPC content-type override value. */
    contentType: string;
    xml: string;
    dtype: string;
    uuid: string;
}

/** Build the OPC `[Content_Types].xml` manifest for the gathered parts. */
function buildContentTypes(parts: EpcPart[]): string {
    const overrides = parts
        .map(
            p =>
                `  <Override PartName="/${p.partName}" ContentType="${p.contentType}"/>`
        )
        .join("\n");
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
        `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
        `  <Default Extension="xml" ContentType="application/xml"/>\n` +
        `  <Default Extension="h5" ContentType="application/x-hdf5"/>\n` +
        `${overrides}\n` +
        `</Types>\n`
    );
}

/** Minimal root relationships part (required by the OPC package model). */
const ROOT_RELS =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
    `</Relationships>\n`;

/** Extract EpcExternalPartReference (HDF proxy) UUIDs from an object's XML. */
function extractHdfProxyUuids(xml: string): string[] {
    const out: string[] = [];
    const re =
        /<(?:\w+:)?HdfProxy\b[\s\S]*?<(?:\w+:)?UUID>([0-9a-fA-F-]{36})<\/(?:\w+:)?UUID>[\s\S]*?<\/(?:\w+:)?HdfProxy>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        out.push(m[1]);
    }
    return out;
}

/** Energistics OPC relationship namespace. */
const REL_NS = "http://schemas.energistics.org/package/2012/relationships";

interface Relationship {
    type: string;
    target: string;
    mode?: "External";
}

/**
 * Extract every object reference (DOR + HDF proxy) from an object's XML as
 * `{ dtype, uuid }` pairs. A reference is a `ContentType`/`QualifiedType`
 * naming an `obj_*` type followed (within a short window) by its UUID.
 */
function extractRefs(xml: string): Array<{ dtype: string; uuid: string }> {
    const out: Array<{ dtype: string; uuid: string }> = [];
    const seen = new Set<string>();
    const add = (dtype: string, uuid: string) => {
        const k = `${dtype}_${uuid}`.toLowerCase();
        if (!seen.has(k)) {
            seen.add(k);
            out.push({ dtype, uuid });
        }
    };
    // v2.0: <...ContentType>application/x-<fam>+xml;version=..;type=obj_X</...> .. <...UUID>uuid</...>
    const v20 =
        /type=(obj_\w+)\s*<\/(?:\w+:)?ContentType>[\s\S]{0,400}?<(?:\w+:)?UUID>([0-9a-fA-F-]{36})<\/(?:\w+:)?UUID>/g;
    let m: RegExpExecArray | null;
    while ((m = v20.exec(xml)) !== null) add(m[1], m[2]);
    // v2.2: <...QualifiedType>resqml20.obj_X</...> .. <...Uuid>uuid</...>
    const v22 =
        /<(?:\w+:)?QualifiedType>[\w.]*?\.(obj_\w+)<\/(?:\w+:)?QualifiedType>[\s\S]{0,400}?<(?:\w+:)?Uuid>([0-9a-fA-F-]{36})<\/(?:\w+:)?Uuid>/g;
    while ((m = v22.exec(xml)) !== null) add(m[1], m[2]);
    return out;
}

/** Serialise an OPC `.rels` part. */
function buildRels(rels: Relationship[]): string {
    const items = rels
        .map(
            (r, i) =>
                `  <Relationship Id="_r${i}" Type="${r.type}" Target="${r.target}"` +
                (r.mode ? ` TargetMode="${r.mode}"` : "") +
                `/>`
        )
        .join("\n");
    return (
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
        `${items}\n` +
        `</Relationships>\n`
    );
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags("Resources")
@ApiBearerAuth()
@UseGuards(HasBearerGuard("jwt"), HasDataPartitionGuard())
@Controller("dataspaces")
export default class EpcDownloadController {
    @Get(":dataspaceId/epc")
    @ApiProduces("application/epc+zip")
    @ApiOperation({
        summary: "Download a dependency-closed EPC for a dataspace or object set",
        description:
            "Gather the requested objects (whole dataspace, or the `uuids` subset) " +
            "plus every DOR-referenced child (CRS, HDF proxy, interpretations, …), " +
            "pull their HDF5 arrays and return a self-contained `.epc` (OPC zip with " +
            "an embedded HDF5 file) — the inverse of the EPC uploader.",
        servers: swaggerServers
    })
    @ApiQuery({
        name: "uuids",
        required: false,
        description:
            "Comma-separated object UUIDs to seed the export. When omitted, the " +
            "entire dataspace is exported."
    })
    @ApiQuery({
        name: "includeReferences",
        required: false,
        description:
            "Follow DOR references and include all referenced children (default true)."
    })
    @ApiOkResponse({
        description: "EPC package (application/epc+zip)",
        schema: { type: "string", format: "binary" }
    })
    public async downloadEpc(
        @Param("dataspaceId") dataspaceId: string,
        @Res() res: express.Response,
        @Query("uuids") uuids?: string,
        @Query("includeReferences") includeReferences?: string,
        @Req() request?: express.Request
    ): Promise<void> {
        const withRefs = includeReferences !== "false";
        const wanted = (uuids ?? "")
            .split(",")
            .map(s => s.trim().toLowerCase())
            .filter(Boolean);

        let c: ResqmlClient | undefined;
        try {
            c = await createSession(
                extractToken(request),
                extractDataPartitionId(request)
            );

            const dsUri = EtpUri.createDataSpaceUri(dataspaceId).uri;

            // 1. Seed URIs — the whole dataspace, optionally filtered to `uuids`.
            const resources = await c.getDataspaceResources(dsUri);
            let seedUris = resources.map(r => r.uri);
            if (wanted.length > 0) {
                seedUris = seedUris.filter(u => {
                    const m = OBJ_URI_RE.exec(u);
                    return m?.groups && wanted.includes(m.groups.uuid.toLowerCase());
                });
                if (seedUris.length === 0) {
                    throw new NotFoundException({
                        description: `None of the requested uuids were found in dataspace ${dataspaceId}`
                    });
                }
            }
            if (seedUris.length === 0) {
                throw new NotFoundException({
                    description: `Dataspace ${dataspaceId} contains no objects to export`
                });
            }

            // 2. Dependency closure — recursively follow the store graph's
            //    *targets* (the objects each object references: CRS,
            //    interpretations, features, …) so the EPC is self-contained.
            let allUris = seedUris;
            if (withRefs) {
                const seen = new Set<string>(seedUris);
                let frontier = [...seedUris];
                while (frontier.length > 0) {
                    const next: string[] = [];
                    const batches = await Promise.all(
                        frontier.map(u => c!.getTargets(u).catch(() => []))
                    );
                    for (const targets of batches) {
                        for (const t of targets) {
                            if (t.uri && !seen.has(t.uri)) {
                                seen.add(t.uri);
                                next.push(t.uri);
                            }
                        }
                    }
                    frontier = next;
                }
                allUris = [...seen];
            }

            // 3. Fetch raw object XML for every gathered URI.
            const objects = (await c.getDataObjects(allUris)).filter(
                (o): o is NonNullable<typeof o> => !!o && !!o.data && o.data.length > 0
            );

            const parts: EpcPart[] = [];
            const includedUuids = new Set<string>();
            // EpcExternalPartReference (HDF proxy) objects referenced from
            // object XML — the store graph does not surface these as targets,
            // so gather them explicitly to keep the EPC self-contained.
            const hdfProxyUuids = new Set<string>();
            // Datasets grouped by target HDF5 filename (v2.2 names an explicit
            // file per array; v2.0.1 arrays share one implicit proxy file).
            const defaultH5 = `${dataspaceId.replace(/[^\w.-]+/g, "_")}.h5`;
            const h5Files = new Map<string, H5Dataset[]>();

            for (const obj of objects) {
                const uri = obj.resource.uri;
                const m = OBJ_URI_RE.exec(uri);
                if (!m?.groups) {
                    logger.warn(`[epc-export] skipping unparsable uri ${uri}`);
                    continue;
                }
                const { family, ver, dtype, uuid } = m.groups;
                const xml = byteToString(obj.data as Buffer);

                parts.push({
                    partName: `${dtype}_${uuid}.xml`,
                    contentType: `application/x-${family}+xml;version=${ctVersion(ver)};type=${dtype}`,
                    xml,
                    dtype,
                    uuid
                });
                includedUuids.add(uuid.toLowerCase());

                // EpcExternalPartReference objects carry no bulk arrays.
                if (dtype === "obj_EpcExternalPartReference") continue;

                for (const pu of extractHdfProxyUuids(xml)) {
                    hdfProxyUuids.add(pu);
                }
                await this.collectArrays(c, uri, xml, defaultH5, h5Files);
            }

            // 3b. Pull any referenced EpcExternalPartReference objects not yet
            //     included (they anchor the HDF5 arrays by UUID).
            const missingProxyUris = [...hdfProxyUuids]
                .filter(u => !includedUuids.has(u.toLowerCase()))
                .map(
                    u =>
                        EtpUri.createObjectUri(
                            dataspaceId,
                            "eml",
                            "2.0",
                            "obj_EpcExternalPartReference",
                            u
                        ).uri
                );
            if (missingProxyUris.length > 0) {
                const proxies = (await c.getDataObjects(missingProxyUris)).filter(
                    (o): o is NonNullable<typeof o> =>
                        !!o && !!o.data && o.data.length > 0
                );
                for (const obj of proxies) {
                    const m = OBJ_URI_RE.exec(obj.resource.uri);
                    if (!m?.groups) continue;
                    const { family, ver, dtype, uuid } = m.groups;
                    if (includedUuids.has(uuid.toLowerCase())) continue;
                    parts.push({
                        partName: `${dtype}_${uuid}.xml`,
                        contentType: `application/x-${family}+xml;version=${ctVersion(ver)};type=${dtype}`,
                        xml: byteToString(obj.data as Buffer),
                        dtype,
                        uuid
                    });
                    includedUuids.add(uuid.toLowerCase());
                }
            }

            // 4. Materialise the HDF5 file(s).
            const h5Blobs = new Map<string, Buffer>();
            let totalArrays = 0;
            for (const [name, datasets] of h5Files) {
                if (datasets.length === 0) continue;
                h5Blobs.set(name, await writeH5(datasets));
                totalArrays += datasets.length;
            }

            // 4b. Build the OPC relationship graph (`_rels/*.rels`):
            //   - object → target DOR   : destinationObject / sourceObject
            //   - object → HDF proxy    : mlToExternalPartProxy / externalPartProxyToMl
            //   - HDF proxy → .h5 file  : externalResource (TargetMode=External)
            const partByUuid = new Map<string, EpcPart>();
            for (const p of parts) partByUuid.set(p.uuid.toLowerCase(), p);
            const relsMap = new Map<string, Relationship[]>();
            const addRel = (part: string, rel: Relationship) => {
                const l = relsMap.get(part) ?? [];
                l.push(rel);
                relsMap.set(part, l);
            };
            for (const p of parts) {
                if (p.dtype === "obj_EpcExternalPartReference") continue;
                for (const ref of extractRefs(p.xml)) {
                    const target = partByUuid.get(ref.uuid.toLowerCase());
                    if (!target || target.partName === p.partName) continue;
                    if (ref.dtype === "obj_EpcExternalPartReference") {
                        addRel(p.partName, {
                            type: `${REL_NS}/mlToExternalPartProxy`,
                            target: target.partName
                        });
                        addRel(target.partName, {
                            type: `${REL_NS}/externalPartProxyToMl`,
                            target: p.partName
                        });
                    } else {
                        addRel(p.partName, {
                            type: `${REL_NS}/destinationObject`,
                            target: target.partName
                        });
                        addRel(target.partName, {
                            type: `${REL_NS}/sourceObject`,
                            target: p.partName
                        });
                    }
                }
            }
            const h5Names = [...h5Blobs.keys()];
            for (const p of parts) {
                if (p.dtype !== "obj_EpcExternalPartReference") continue;
                const h5name =
                    h5Names.length === 1
                        ? h5Names[0]
                        : h5Names.find(n => p.xml.includes(n)) ??
                        h5Names[0] ??
                        defaultH5;
                addRel(p.partName, {
                    type: `${REL_NS}/externalResource`,
                    target: h5name,
                    mode: "External"
                });
            }

            // 5. Assemble the OPC package.
            const AdmZip = (await import("adm-zip")).default;
            const zip = new AdmZip();
            zip.addFile(
                "[Content_Types].xml",
                Buffer.from(buildContentTypes(parts), "utf-8")
            );
            zip.addFile("_rels/.rels", Buffer.from(ROOT_RELS, "utf-8"));
            for (const p of parts) {
                zip.addFile(p.partName, Buffer.from(p.xml, "utf-8"));
                const rels = relsMap.get(p.partName);
                if (rels && rels.length > 0) {
                    zip.addFile(
                        `_rels/${p.partName}.rels`,
                        Buffer.from(buildRels(rels), "utf-8")
                    );
                }
            }
            for (const [name, blob] of h5Blobs) {
                zip.addFile(name, blob);
            }
            const out = zip.toBuffer();

            const fileBase = dataspaceId.replace(/[^\w.-]+/g, "_");
            logger.info(
                `[epc-export] ${dataspaceId}: ${parts.length} objects, ` +
                `${totalArrays} arrays, ${h5Blobs.size} h5 file(s), ` +
                `${(out.length / 1e6).toFixed(1)}MB`
            );

            res.set("Content-Type", "application/epc+zip");
            res.set(
                "Content-Disposition",
                `attachment; filename="${fileBase}.epc"`
            );
            res.send(out);

            await c.closeSession();
            c = undefined;
        } catch (err) {
            if (
                err instanceof NotFoundException ||
                err instanceof BadRequestException
            ) {
                await c?.closeSession();
                throw err;
            }
            logger.error(`[epc-export] failed: ${err}`);
            await c?.closeSession();
            throw httpErrorFromEtpError(err);
        }
    }

    /**
     * Scan an object's XML for HDF5 dataset references (v2.0.1 `PathInHdfFile`
     * and v2.2 `ExternalDataArrayPart`/`PathInExternalFile`), fetch each array
     * and append it to the per-file dataset list.
     */
    private async collectArrays(
        c: ResqmlClient,
        uri: string,
        xml: string,
        defaultH5: string,
        h5Files: Map<string, H5Dataset[]>
    ): Promise<void> {
        // Collect (pathInHdf, targetFileName) pairs.
        const refs: Array<{ hdfPath: string; file: string }> = [];

        // v2.0.1: <PathInHdfFile>path</PathInHdfFile>
        const pathRe =
            /<(?:\w+:)?PathInHdfFile[^>]*>([^<]+)<\/(?:\w+:)?PathInHdfFile>/g;
        let mm: RegExpExecArray | null;
        while ((mm = pathRe.exec(xml)) !== null) {
            refs.push({ hdfPath: mm[1].trim(), file: defaultH5 });
        }

        // v2.2: <ExternalDataArrayPart> ... <PathInExternalFile>p</PathInExternalFile> ... <URI>file.h5</URI> ...
        const partRe =
            /<(?:\w+:)?ExternalDataArrayPart[^>]*>([\s\S]*?)<\/(?:\w+:)?ExternalDataArrayPart>/g;
        while ((mm = partRe.exec(xml)) !== null) {
            const block = mm[1];
            const p = /<(?:\w+:)?PathInExternalFile[^>]*>([^<]+)</.exec(block);
            const u = /<(?:\w+:)?URI[^>]*>([^<]+)</.exec(block);
            if (p) {
                refs.push({
                    hdfPath: p[1].trim(),
                    file: u ? path.basename(u[1].trim()) : defaultH5
                });
            }
        }

        for (const ref of refs) {
            const arr = await this.readArrayRaw(c, uri, ref.hdfPath);
            if (!arr) {
                logger.warn(
                    `[epc-export] array not found: ${ref.hdfPath} (obj ${uri})`
                );
                continue;
            }
            const list = h5Files.get(ref.file) ?? [];
            list.push({ path: ref.hdfPath, ...arr });
            h5Files.set(ref.file, list);
        }
    }

    /**
     * Read an array's raw typed values + shape and map its ETP element type to
     * an HDF5 dtype + packed typed array.
     */
    private async readArrayRaw(
        c: ResqmlClient,
        uri: string,
        pathInResource: string
    ): Promise<{ dtype: string; shape: number[]; data: ArrayBufferView } | null> {
        const a = await c.getDataArray(uri, pathInResource);
        if (
            !a ||
            !a.data ||
            a.data instanceof Energistics.Etp.v12.Datatypes.ErrorInfo
        ) {
            return null;
        }
        const any = a.data.data;
        const key = any.item.__keyName;
        const shape = (a.data.dimensions ?? []).map(Number);

        // Boolean (and other 1-byte) arrays are transported as raw bytes — the
        // union branch is `_bytes` (a Buffer) with no `.values` accessor. Store
        // them as int8 (0/1) so booleans round-trip losslessly.
        if (key === "_bytes") {
            const raw = (any.item as Record<string, unknown>)._bytes;
            const bytes =
                raw instanceof Uint8Array
                    ? raw
                    : Buffer.isBuffer(raw)
                        ? new Uint8Array(raw)
                        : ArrayBuffer.isView(raw)
                            ? new Uint8Array(
                                raw.buffer,
                                raw.byteOffset,
                                raw.byteLength
                            )
                            : Uint8Array.from((raw as number[]) ?? []);
            if (bytes.length === 0) return null;
            return {
                dtype: "b",
                shape: shape.length ? shape : [bytes.length],
                data: Int8Array.from(bytes)
            };
        }

        const values = any.item[key]?.values as unknown[] | undefined;
        const spec = DTYPES[key];
        if (!values || !spec) {
            return null;
        }
        return {
            dtype: spec.dtype,
            shape: shape.length ? shape : [values.length],
            data: spec.pack(values)
        };
    }
}

/**
 * Write a set of datasets to an in-memory HDF5 file via h5wasm and return the
 * file bytes. Intermediate groups are created explicitly (h5wasm does not
 * auto-create parents).
 */
async function writeH5(datasets: H5Dataset[]): Promise<Buffer> {
    const h5NodeEntry = path.resolve(
        __dirname,
        "..", "..", "..", "..", "..",
        "node_modules", "h5wasm", "dist", "node", "hdf5_hl.js"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h5wasm: any = await import(h5NodeEntry);
    await h5wasm.ready;

    const fname = `epc_export_${Date.now()}_${Math.random().toString(36).slice(2)}.h5`;
    const f = new h5wasm.File(fname, "w");
    try {
        const madeGroups = new Set<string>();
        for (const ds of datasets) {
            const clean = ds.path.replace(/^\//, "");
            const segments = clean.split("/");
            // Create every ancestor group.
            for (let i = 1; i < segments.length; i++) {
                const g = segments.slice(0, i).join("/");
                if (g && !madeGroups.has(g)) {
                    try {
                        f.create_group(g);
                    } catch {
                        // group may already exist
                    }
                    madeGroups.add(g);
                }
            }
            f.create_dataset({
                name: clean,
                data: ds.data,
                shape: ds.shape,
                dtype: ds.dtype
            });
        }
        f.flush();
    } finally {
        f.close();
    }
    const bytes: Uint8Array = h5wasm.FS.readFile(fname);
    const buf = Buffer.from(bytes);
    try {
        h5wasm.FS.unlink(fname);
    } catch {
        // best-effort cleanup of the virtual FS
    }
    return buf;
}
