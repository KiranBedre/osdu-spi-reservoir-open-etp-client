// ============================================================================
// Copyright 2026, Equinor
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

// Normalize a request path into a low-cardinality Prometheus label (CWE-400).
//
// prom-client keeps one series per distinct label value for the life of the
// process and never evicts them, so using the raw request path (which contains
// GUIDs, dataspace and transaction IDs) lets any client grow heap and the
// /metrics output without bound. We collapse high-cardinality path segments to
// fixed placeholders and cap the overall length / segment count so the number
// of distinct label values stays bounded.

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX_RE = /^[0-9a-f]{16,}$/i;
const ALL_DIGITS_RE = /^\d+$/;

const MAX_SEGMENTS = 12;
const MAX_LABEL_LENGTH = 200;

/**
 * Collapse opaque / caller-controlled path segments to placeholders so the
 * resulting string is safe to use as a Prometheus label value.
 */
export function normalizeMetricRoute(rawPath: string | undefined | null): string {
    if (!rawPath) {
        return "/";
    }

    // Strip query string and fragment if any slipped through.
    let path = rawPath.split("?")[0].split("#")[0];
    if (path.length === 0) {
        return "/";
    }

    const segments = path.split("/");
    const normalized: string[] = [];
    for (const seg of segments) {
        if (seg === "") {
            normalized.push(seg);
            continue;
        }
        // Decode once so encoded GUIDs are also caught; ignore malformed encodings.
        let decoded = seg;
        try {
            decoded = decodeURIComponent(seg);
        } catch {
            decoded = seg;
        }
        if (UUID_RE.test(decoded)) {
            normalized.push(":uuid");
        } else if (ALL_DIGITS_RE.test(decoded)) {
            normalized.push(":n");
        } else if (LONG_HEX_RE.test(decoded)) {
            normalized.push(":id");
        } else if (decoded.length > 40) {
            // Unusually long opaque segment (encoded URIs, tokens, etc.)
            normalized.push(":id");
        } else {
            normalized.push(decoded);
        }
    }

    // Bound the number of segments so deeply nested / unmatched paths cannot
    // each create their own series.
    if (normalized.length > MAX_SEGMENTS) {
        path = normalized.slice(0, MAX_SEGMENTS).join("/") + "/...";
    } else {
        path = normalized.join("/");
    }

    if (path.length > MAX_LABEL_LENGTH) {
        path = path.slice(0, MAX_LABEL_LENGTH);
    }

    return path.length > 0 ? path : "/";
}
