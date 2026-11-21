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

// Phase 5 of the dedicated-compute design (docs/computeServerDesign.md §3.2):
// a thin native-ETP front proxy so a single public WebSocket endpoint can
// front both the store and the compute tier. When a REST wrapper is not in
// front (a native ETP client that must hit one endpoint), the proxy routes the
// whole ETP session to the store or compute upstream and pipes the raw frames
// through untouched — it does NOT decode the Avro payload. Routing is by
// connection path (default: paths under `/compute` → compute upstream, all
// else → store upstream), which lets a load balancer expose one host:port and
// still land compute sessions on the read-only tier. (Per-message marker
// dispatch, §3.2 option 2, would require Avro decode and is left as future
// work.)

import http from "http";

import {
  connection as WsConnection,
  Message as WsMessage,
  request as WsRequest,
  server as WsServer,
  client as WsClient
} from "websocket";

import Logging from "./Logging";

const logger = Logging.getLogger("EtpClient");

export interface EtpFrontProxyOptions {
  /** Port to listen on. 0 picks a free port (resolved via {@link EtpFrontProxy.start}). */
  port: number;
  /** Upstream ETP WebSocket URL for store/transaction traffic. */
  storeUrl: string;
  /** Upstream ETP WebSocket URL for compute traffic (defaults to storeUrl). */
  computeUrl?: string;
  /** Path prefix that selects the compute upstream. Default `/compute`. */
  computePathPrefix?: string;
  /** Max ETP frame/message size forwarded, bytes. Default 100 MiB. */
  maxMessageSize?: number;
}

/**
 * Connection-level ETP reverse proxy. Each inbound WebSocket is bound to one
 * upstream (store or compute) for its whole lifetime and frames are forwarded
 * verbatim in both directions.
 */
export class EtpFrontProxy {
  private readonly storeUrl: string;
  private readonly computeUrl: string;
  private readonly computePathPrefix: string;
  private readonly maxMessageSize: number;
  private readonly httpServer: http.Server;
  private readonly wsServer: WsServer;
  private boundPort = 0;

  constructor(private readonly options: EtpFrontProxyOptions) {
    this.storeUrl = options.storeUrl;
    this.computeUrl = options.computeUrl || options.storeUrl;
    this.computePathPrefix = normalizePrefix(
      options.computePathPrefix ?? "/compute"
    );
    this.maxMessageSize = options.maxMessageSize ?? 100 * 1024 * 1024;
    this.httpServer = http.createServer((_req, res) => {
      // Minimal health endpoint for liveness probes.
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("etp-front-proxy\n");
    });
    this.wsServer = new WsServer({
      httpServer: this.httpServer,
      autoAcceptConnections: false,
      maxReceivedFrameSize: this.maxMessageSize,
      maxReceivedMessageSize: this.maxMessageSize
    });
    this.wsServer.on("request", req => this.onRequest(req));
  }

  /** The port the proxy is actually listening on (valid after {@link start}). */
  get port(): number {
    return this.boundPort;
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.httpServer.once("error", reject);
      this.httpServer.listen(this.options.port, () => {
        this.httpServer.removeListener("error", reject);
        const addr = this.httpServer.address();
        this.boundPort =
          addr && typeof addr === "object" ? addr.port : this.options.port;
        logger.info(
          `ETP front proxy listening on :${this.boundPort} ` +
            `(store=${this.storeUrl}, compute=${this.computeUrl}, ` +
            `computePath=${this.computePathPrefix})`
        );
        resolve(this.boundPort);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise(resolve => {
      this.wsServer.shutDown();
      this.httpServer.close(() => resolve());
    });
  }

  /** Expose routing for tests/metrics without opening a socket. */
  upstreamFor(pathname: string): string {
    const normalized = pathname || "/";
    if (
      this.computeUrl !== this.storeUrl &&
      (normalized === this.computePathPrefix ||
        normalized.startsWith(this.computePathPrefix + "/"))
    ) {
      return this.computeUrl;
    }
    return this.storeUrl;
  }

  private onRequest(req: WsRequest): void {
    const pathname = req.resourceURL?.pathname ?? "/";
    const upstreamUrl = this.upstreamFor(pathname);
    // ETP negotiates a subprotocol (`etp12.energistics.org`); echo the first
    // requested one so the handshake succeeds end to end.
    const requested = req.requestedProtocols ?? [];
    const subprotocol = requested.length > 0 ? requested[0] : null;

    const client = new WsClient({
      maxReceivedFrameSize: this.maxMessageSize,
      maxReceivedMessageSize: this.maxMessageSize
    });

    client.on("connectFailed", err => {
      logger.warn(
        `ETP front proxy: upstream connect to ${upstreamUrl} failed: ${err.message}`
      );
      // 502-equivalent for the WebSocket handshake.
      req.reject(502, "Upstream connection failed");
    });

    client.on("connect", upstream => {
      let downstream: WsConnection;
      try {
        downstream = req.accept(subprotocol, req.origin);
      } catch (err) {
        upstream.close();
        logger.warn(
          `ETP front proxy: accept failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        return;
      }
      this.pipe(downstream, upstream);
    });

    client.connect(upstreamUrl, subprotocol ?? undefined);
  }

  private pipe(downstream: WsConnection, upstream: WsConnection): void {
    const forward = (from: WsConnection, to: WsConnection) => {
      from.on("message", (msg: WsMessage) => {
        if (!to.connected) {
          return;
        }
        if (msg.type === "binary" && msg.binaryData) {
          to.sendBytes(msg.binaryData);
        } else if (msg.type === "utf8" && msg.utf8Data !== undefined) {
          to.sendUTF(msg.utf8Data);
        }
      });
      from.on("close", (code, desc) => {
        if (to.connected) {
          to.close(sanitizeCloseCode(code), desc);
        }
      });
      from.on("error", () => {
        if (to.connected) {
          to.drop();
        }
      });
    };
    forward(downstream, upstream);
    forward(upstream, downstream);
  }
}

function normalizePrefix(prefix: string): string {
  let p = prefix.trim();
  if (!p.startsWith("/")) {
    p = "/" + p;
  }
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

// The `websocket` library only allows application close codes in [1000, 4999]
// or the normal 1000; forwarding a reserved code throws. Fall back to 1000.
function sanitizeCloseCode(code?: number): number {
  if (code !== undefined && code >= 1000 && code <= 4999 && code !== 1004 && code !== 1005 && code !== 1006) {
    return code;
  }
  return 1000;
}

/**
 * Build (but do not start) a proxy from environment variables. Independent of
 * the REST wrapper's config so the proxy can be deployed as its own process:
 * - `RDMS_ETP_PROXY_PORT` (default 9100)
 * - `RDMS_ETP_PROXY_STORE_URL` (required)
 * - `RDMS_ETP_PROXY_COMPUTE_URL` (optional; defaults to the store URL)
 * - `RDMS_ETP_PROXY_COMPUTE_PATH` (optional; default `/compute`)
 */
export function etpFrontProxyFromEnv(): EtpFrontProxy {
  const storeUrl = process.env.RDMS_ETP_PROXY_STORE_URL;
  if (!storeUrl) {
    throw new Error("RDMS_ETP_PROXY_STORE_URL must be set");
  }
  const port = Number(process.env.RDMS_ETP_PROXY_PORT ?? 9100);
  return new EtpFrontProxy({
    port: Number.isFinite(port) ? port : 9100,
    storeUrl,
    computeUrl: process.env.RDMS_ETP_PROXY_COMPUTE_URL || undefined,
    computePathPrefix: process.env.RDMS_ETP_PROXY_COMPUTE_PATH || undefined
  });
}

// Allow `node EtpFrontProxy.js` to run the proxy standalone.
if (require.main === module) {
  const proxy = etpFrontProxyFromEnv();
  proxy.start().catch(err => {
    logger.error(`ETP front proxy failed to start: ${err}`);
    process.exitCode = 1;
  });
}
