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

import app from "./App";
import { restApiPort } from "./ControllerUtils";
import { drainTransactions } from "./ControllerUtils";

let server: http.Server;

const gracefulShutdown = async (signal: string) => {
  console.log(`${signal} received, starting graceful shutdown`);
  if (server) {
    server.close();
  }
  await Promise.race([
    drainTransactions(),
    new Promise(resolve => setTimeout(resolve, 30_000))
  ]);
  process.exit(0);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

const main = async (p: number): Promise<void> => {
  return app().then((a: any) => {
    server = a.listen(p);
  });
};
main(restApiPort);
