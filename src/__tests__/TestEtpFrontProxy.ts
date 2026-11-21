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

import http from "http";

import {
  client as WsClient,
  connection as WsConnection,
  Message as WsMessage,
  server as WsServer
} from "websocket";

import { EtpFrontProxy } from "../lib/common/EtpFrontProxy";

const SUBPROTOCOL = "etp12.energistics.org";

/**
 * A fake ETP upstream: on connect it sends a greeting identifying itself, then
 * echoes every binary message it receives.
 */
async function startEchoUpstream(
  tag: string
): Promise<{ url: string; close: () => Promise<void> }> {
  const httpServer = http.createServer();
  const ws = new WsServer({ httpServer, autoAcceptConnections: false });
  ws.on("request", req => {
    const proto = req.requestedProtocols[0] ?? null;
    const conn = req.accept(proto, req.origin);
    conn.sendBytes(Buffer.from(tag));
    conn.on("message", (msg: WsMessage) => {
      if (msg.type === "binary" && msg.binaryData) {
        conn.sendBytes(msg.binaryData);
      }
    });
  });
  const port: number = await new Promise(resolve =>
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    })
  );
  return {
    url: `ws://127.0.0.1:${port}/etp`,
    close: () =>
      new Promise<void>(resolve => {
        ws.shutDown();
        httpServer.close(() => resolve());
      })
  };
}

interface ProxyClient {
  conn: WsConnection;
  protocol: string;
  next: () => Promise<Buffer>;
  close: () => void;
}

/** Connect to the proxy and expose a promise-based "next binary frame" reader. */
function connectThroughProxy(url: string): Promise<ProxyClient> {
  return new Promise((resolve, reject) => {
    const client = new WsClient();
    const inbox: Buffer[] = [];
    const waiters: Array<(b: Buffer) => void> = [];
    client.on("connectFailed", reject);
    client.on("connect", conn => {
      conn.on("message", (msg: WsMessage) => {
        if (msg.type === "binary" && msg.binaryData) {
          const waiter = waiters.shift();
          if (waiter) {
            waiter(msg.binaryData);
          } else {
            inbox.push(msg.binaryData);
          }
        }
      });
      resolve({
        conn,
        protocol: conn.protocol ?? "",
        next: () =>
          new Promise<Buffer>(res => {
            const buffered = inbox.shift();
            if (buffered) {
              res(buffered);
            } else {
              waiters.push(res);
            }
          }),
        close: () => conn.close()
      });
    });
    client.connect(url, SUBPROTOCOL);
  });
}

describe("EtpFrontProxy", () => {
  it("routes by path (pure)", () => {
    const proxy = new EtpFrontProxy({
      port: 0,
      storeUrl: "ws://store/etp",
      computeUrl: "ws://compute/etp",
      computePathPrefix: "/compute"
    });
    expect(proxy.upstreamFor("/")).toBe("ws://store/etp");
    expect(proxy.upstreamFor("/etp")).toBe("ws://store/etp");
    expect(proxy.upstreamFor("/compute")).toBe("ws://compute/etp");
    expect(proxy.upstreamFor("/compute/x")).toBe("ws://compute/etp");
    // "/computed" must NOT match the "/compute" prefix.
    expect(proxy.upstreamFor("/computed")).toBe("ws://store/etp");
  });

  it("collapses to the store upstream when compute is unset", () => {
    const proxy = new EtpFrontProxy({ port: 0, storeUrl: "ws://store/etp" });
    expect(proxy.upstreamFor("/compute")).toBe("ws://store/etp");
  });

  describe("end to end", () => {
    let store: { url: string; close: () => Promise<void> };
    let compute: { url: string; close: () => Promise<void> };
    let proxy: EtpFrontProxy;
    let base: string;

    beforeAll(async () => {
      store = await startEchoUpstream("STORE");
      compute = await startEchoUpstream("COMPUTE");
      proxy = new EtpFrontProxy({
        port: 0,
        storeUrl: store.url,
        computeUrl: compute.url,
        computePathPrefix: "/compute"
      });
      const port = await proxy.start();
      base = `ws://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await proxy.stop();
      await store.close();
      await compute.close();
    });

    it("forwards a default-path session to the store and echoes frames", async () => {
      const c = await connectThroughProxy(`${base}/etp`);
      expect(c.protocol).toBe(SUBPROTOCOL);
      expect((await c.next()).toString()).toBe("STORE");
      c.conn.sendBytes(Buffer.from([1, 2, 3, 4]));
      expect([...(await c.next())]).toEqual([1, 2, 3, 4]);
      c.close();
    });

    it("forwards a /compute session to the compute upstream", async () => {
      const c = await connectThroughProxy(`${base}/compute`);
      expect((await c.next()).toString()).toBe("COMPUTE");
      c.conn.sendBytes(Buffer.from([9, 9]));
      expect([...(await c.next())]).toEqual([9, 9]);
      c.close();
    });
  });
});
