// ============================================================================
// Copyright 2026 Open Group. All rights reserved.
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
 * SSRF mitigation boundary for all outbound HTTP calls made from the REST
 * gateway to configured back-end services (e.g. the OSDU Schema / Storage /
 * Workflow services).
 *
 * The target base URLs are operator-configured (RDMS_OSDU_URL and friends),
 * never end-user supplied, but these values still flow into `fetch()` from
 * variables. `assertSafeOutboundUrl` turns that into an explicit, auditable
 * sanitizer that:
 *
 *   1. rejects malformed URLs,
 *   2. allows only the http/https schemes (no file:, ftp:, gopher:, data: …),
 *   3. optionally restricts the destination host to an operator-defined
 *      allowlist (RDMS_OUTBOUND_ALLOWED_HOSTS, comma-separated host[:port]).
 *
 * By default (no allowlist configured) any http/https host is permitted so
 * that on-prem / internal OSDU deployments keep working; set the allowlist in
 * hardened environments to pin the exact back-ends the gateway may reach.
 */

/** Parse the RDMS_OUTBOUND_ALLOWED_HOSTS env var into a normalized Set. */
function parseAllowedHosts(): Set<string> | undefined {
    const raw = process.env.RDMS_OUTBOUND_ALLOWED_HOSTS;
    if (!raw || !raw.trim()) return undefined;
    const hosts = raw
        .split(",")
        .map(h => h.trim().toLowerCase())
        .filter(h => h.length > 0);
    return hosts.length > 0 ? new Set(hosts) : undefined;
}

/**
 * Validate an outbound URL and return a normalized URL object.
 *
 * @throws Error when the URL is malformed, uses a disallowed scheme, or
 *         targets a host outside the configured allowlist.
 */
export function assertSafeOutboundUrl(rawUrl: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(
            `Refusing to make outbound request to malformed URL: ${rawUrl}`
        );
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error(
            `Refusing to make outbound request with unsupported scheme '${parsed.protocol}' (only http/https allowed)`
        );
    }

    const allowedHosts = parseAllowedHosts();
    if (allowedHosts) {
        const host = parsed.host.toLowerCase(); // host includes the port when present
        const hostname = parsed.hostname.toLowerCase();
        if (!allowedHosts.has(host) && !allowedHosts.has(hostname)) {
            throw new Error(
                `Refusing to make outbound request to non-allowlisted host '${parsed.host}'`
            );
        }
    }

    return parsed;
}

/**
 * Drop-in replacement for `fetch` that validates the destination URL through
 * {@link assertSafeOutboundUrl} before the request leaves the process.
 */
export function safeFetch(
    rawUrl: string,
    init?: RequestInit
): Promise<Response> {
    const safeUrl = assertSafeOutboundUrl(rawUrl);
    return fetch(safeUrl.toString(), init);
}
