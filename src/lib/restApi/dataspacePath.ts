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

// Sub-resource path segments that may immediately follow a dataspace id in the
// REST routing table (…/dataspaces/:dataspaceId/<sub-resource>/…). Kept in sync
// with the @Controller/@Get/@Post/@Delete routes under "dataspaces/:dataspaceId".
const DATASPACE_SUBRESOURCES = new Set<string>([
    "info",
    "lock",
    "clone",
    "deleted",
    "resources",
    "graph",
    "transactions"
]);

/**
 * Re-encode "/" characters that belong to a dataspace id but were decoded from
 * "%2F" by an upstream gateway (e.g. Istio/Envoy path normalization).
 *
 * OSDU dataspace ids contain slashes (e.g. "demo/Volve") and are transmitted
 * URL-encoded as a single path segment (…/dataspaces/demo%2FVolve/…). Some
 * ingress layers decode %2F -> / before the request reaches this service,
 * splitting the id across path segments and breaking route matching against
 * "dataspaces/:dataspaceId/…", which yields spurious 404s. This restores the
 * encoded form so the existing routes match on every deployment platform.
 *
 * The function is a no-op when the id is already encoded (a single segment),
 * when the request is not under "/dataspaces/", or for id-less routes. The
 * dataspace id is taken to run from just after "/dataspaces/" up to the first
 * recognized sub-resource keyword (or the end of the path); a dataspace whose
 * final name segment is itself one of those reserved keywords is not supported.
 */
export function normalizeDataspacePath(url: string): string {
    const queryIndex = url.indexOf("?");
    const path = queryIndex === -1 ? url : url.slice(0, queryIndex);
    const query = queryIndex === -1 ? "" : url.slice(queryIndex);

    const marker = "/dataspaces/";
    const markerIndex = path.indexOf(marker);
    if (markerIndex === -1) {
        return url;
    }

    const head = path.slice(0, markerIndex + marker.length);
    const remainder = path.slice(markerIndex + marker.length);
    if (remainder === "") {
        return url;
    }

    const segments = remainder.split("/");

    // Id-less literal collection route (…/dataspaces/multi-resources).
    if (segments[0] === "multi-resources") {
        return url;
    }

    // The dataspace id runs until the first recognized sub-resource keyword.
    let boundary = segments.length;
    for (let i = 1; i < segments.length; i++) {
        if (DATASPACE_SUBRESOURCES.has(segments[i])) {
            boundary = i;
            break;
        }
    }

    const idParts = segments.slice(0, boundary);

    // Only act when the id genuinely spans multiple raw segments (i.e. a gateway
    // decoded its %2F). A single segment is already correctly encoded.
    if (idParts.length <= 1) {
        return url;
    }

    const encodedId = idParts.join("%2F");
    const tail = segments.slice(boundary);
    const rebuiltPath =
        head + encodedId + (tail.length ? "/" + tail.join("/") : "");
    return rebuiltPath + query;
}
