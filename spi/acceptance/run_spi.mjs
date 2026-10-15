#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.join(scriptDir, "results", "reservoir-client.xml");

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`invalid argument near '${key ?? ""}'`);
    }
    values[key.slice(2)] = value;
  }

  for (const required of ["gateway", "partition", "token", "domain", "legal-tag"]) {
    if (!values[required]) {
      fail(`--${required} is required`);
    }
  }
  return values;
}

const args = parseArguments(process.argv.slice(2));
const gateway = new URL(args.gateway);
gateway.pathname = gateway.pathname.replace(/\/+$/, "");
const host = `${gateway.toString().replace(/\/+$/, "")}/api/reservoir-ddms/v2`;
const runId = randomBytes(6).toString("hex");
const dataspaceIdRaw = `test/ci-bruno-${runId}`;
const drogonThrowawayIdRaw = `test/ci-drogon-lifecycle-${runId}`;
const drogonSeedIdRaw = `test/ci-drogon-seed-${runId}`;
const environment = {
  host,
  access_token: args.token,
  "data-partition-id": args.partition,
  domain: args.domain,
  defaultLegalTag: args["legal-tag"],
  defaultOwners: `data.default.owners@${args.partition}.${args.domain}`,
  defaultViewers: `data.default.viewers@${args.partition}.${args.domain}`,
  dataspaceId: encodeURIComponent(dataspaceIdRaw),
  dataspaceIdRaw,
  testDataspaceId: encodeURIComponent(dataspaceIdRaw),
  testDataspaceIdRaw: dataspaceIdRaw,
  drogonDataspaceId: encodeURIComponent(dataspaceIdRaw),
  drogonDataspaceIdRaw: dataspaceIdRaw,
  drogonThrowawayId: encodeURIComponent(drogonThrowawayIdRaw),
  drogonThrowawayIdRaw,
  drogonSeedId: encodeURIComponent(drogonSeedIdRaw),
  drogonSeedIdRaw,
};
const environmentArguments = Object.entries(environment).flatMap(([key, value]) => [
  "--env-var",
  `${key}=${value}`,
]);

fs.mkdirSync(path.dirname(reportPath), { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    path.join(scriptDir, "node_modules", "@usebruno", "cli", "bin", "bru.js"),
    "run",
    ".",
    "-r",
    "--env",
    "CI",
    ...environmentArguments,
    "--reporter-junit",
    reportPath,
    "--reporter-skip-all-headers",
  ],
  {
    cwd: path.join(scriptDir, "bruno"),
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
