/**
 * Shared helper for the builder-backed write lanes (Table / Well / Seismic).
 *
 * Those lanes take `hdfUuid` from the caller and the builders emit arrays
 * whose `ContainerType`/`ContainerUuid` point at that EpcExternalPartReference.
 * If the proxy object has never been written, the store rejects the array
 * batch with `Missing array container(s)`. `ensureHdfProxies` inspects the
 * built parts, looks up each referenced proxy in the dataspace (through the
 * same session, so a joined transaction is honoured) and prepends a freshly
 * built proxy object for every container that is neither part of the batch nor
 * already in the store. The Grid lane already writes its proxy; this brings
 * the other lanes to parity without changing their request bodies.
 */

import { EtpUri, ResqmlClient } from "../client/ResqmlClient";
import logging from "../common/Logging";
import { BuiltObject, ResqmlVersion, buildHdfProxy } from "../builders";

const logger = logging.getLogger("EtpClient");

/** EML 2.0 `eml20.obj_EpcExternalPartReference` and EML 2.3 `eml23.EpcExternalPartReference`. */
const proxyTypeRegex = /^eml(20|23)\.(obj_)?EpcExternalPartReference$/;

/** Map the proxy's qualified type back to the builder version line. */
function versionForProxyType(containerType: string): ResqmlVersion {
    return containerType.startsWith("eml23.") ? "2.2.0" : "2.0.1";
}

/** Both proxy flavours for one uuid: the store resolves the container by uuid, so either satisfies the reference. */
function proxyUris(dataspaceId: string, uuid: string): string[] {
    return [
        EtpUri.createObjectUri(dataspaceId, "eml", "20", "obj_EpcExternalPartReference", uuid).uri,
        EtpUri.createObjectUri(dataspaceId, "eml", "23", "EpcExternalPartReference", uuid).uri
    ];
}

/**
 * Return `parts` with an `EpcExternalPartReference` prepended for every array
 * container referenced by the batch that is missing from both the batch and
 * the store. A proxy already stored under the same uuid in the other EML
 * version counts as present (writing a second one would collide on uuid).
 * Lookup failures are treated as "absent" so the write proceeds and the store
 * reports the authoritative error if anything is still wrong.
 */
export async function ensureHdfProxies(
    c: ResqmlClient,
    dataspaceId: string,
    parts: BuiltObject[]
): Promise<BuiltObject[]> {
    const inBatch = new Set(parts.map(p => String(p.object.Uuid)));
    const wanted = new Map<string, string>(); // uuid -> ContainerType
    for (const p of parts) {
        for (const a of p.arrays ?? []) {
            if (proxyTypeRegex.test(a.ContainerType) && !inBatch.has(a.ContainerUuid)) {
                wanted.set(a.ContainerUuid, a.ContainerType);
            }
        }
    }
    if (wanted.size === 0) return parts;

    const missing: BuiltObject[] = [];
    for (const [uuid, containerType] of wanted) {
        let present = false;
        for (const uri of proxyUris(dataspaceId, uuid)) {
            try {
                const objs = await c.getDataObjects([uri]);
                if (objs?.some(o => o && o.data && o.data.length > 0)) {
                    present = true;
                    break;
                }
            } catch (err) {
                logger.debug(`HDF proxy lookup for ${uri} failed (${err})`);
            }
        }
        if (!present) {
            logger.info(
                `HDF proxy ${containerType}(${uuid}) absent from dataspace ${dataspaceId}; writing it with the batch`
            );
            const proxy = buildHdfProxy({ uuid, version: versionForProxyType(containerType) });
            missing.push({ object: proxy.object, arrays: [] });
        }
    }
    return missing.length ? [...missing, ...parts] : parts;
}
