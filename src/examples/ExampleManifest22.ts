// ============================================================================
// Copyright 2019-2026 Emerson Paradigm Holding LLC. All rights reserved.
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
 * Example: Build an OSDU manifest from a RESQML 2.2 dataspace.
 *
 * Connects to an ETP server, reads all objects from a dataspace, and
 * converts them to OSDU work-product-components, reference-data, and
 * master-data records packaged as a Manifest:1.0.0.
 *
 * Supports both RESQML 2.0.1 (resqml20.*) and RESQML 2.2 (resqml22.*)
 * objects via the unified converter registry.
 *
 * Usage:
 *   RDMS_ETP_HOST=localhost RDMS_ETP_PORT=9002 \
 *   npx ts-node src/examples/ExampleManifest22.ts [dataspace]
 *
 * Default dataspace: maap/drogon22
 */

import fs from "fs";

import { ResqmlClient, XmlUtils } from "..";
import { createManifest } from "../lib/jsonTypes/Manifest";
import { OSDUContext } from "../lib/jsonTypes/OsduContext";
import { serverHost, serverPath, serverPort, serverProtocol } from "./Config";

const serverUrl = `${serverProtocol}://${serverHost}:${serverPort}${serverPath}/`;
const dataspace = process.argv[2] || "maap/drogon22";

// eslint-disable-next-line no-console
const log = console.log;

async function main() {
  const client = new ResqmlClient();
  client.setCallsTraceability(false);

  log(`Connecting to ${serverUrl} ...`);
  await client.openSession(serverUrl, XmlUtils.createDefaultJWT());

  // List dataspaces to verify connectivity
  const dataspaces = await client.getDataspaces();
  log(`Available dataspaces: ${dataspaces?.map(d => d.uri).join(", ")}`);

  // Build OSDU manifest from the target dataspace
  const dataspaceUri = `eml:///dataspace('${dataspace}')`;
  log(`\nBuilding manifest for ${dataspaceUri} ...`);

  const context = new OSDUContext("opendes", "fake-token");

  const manifest = await createManifest(
    client,
    [dataspaceUri],
    context,
    // Type patterns: include all RESQML 2.2 and 2.0.1 types
    ["resqml22.*", "resqml20.*", "eml23.*"]
  );

  await client.closeSession();

  // Summary
  const wpcs = manifest.Data?.WorkProductComponents || [];
  const refs = manifest.ReferenceData || [];
  const masters = manifest.MasterData || [];
  const datasets = manifest.Data?.Datasets || [];

  log(`\nManifest built:`);
  log(`  WorkProductComponents: ${wpcs.length}`);
  log(`  ReferenceData:         ${refs.length}`);
  log(`  MasterData:            ${masters.length}`);
  log(`  Datasets:              ${datasets.length}`);

  // Unique OSDU kinds
  const kinds = new Set(wpcs.map((w: any) => w.kind));
  log(`\n  Unique WPC kinds (${kinds.size}):`);
  [...kinds].sort().forEach(k => log(`    ${k}`));

  // Write to file
  const outFile = `manifest_${dataspace.replace("/", "_")}.json`;
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  log(`\nManifest written to ${outFile}`);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
