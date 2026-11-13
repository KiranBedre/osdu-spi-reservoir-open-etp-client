const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");

const BRUNO_VERSION = "4.2.1";
const ROOT = path.resolve(__dirname, "..");
const RESULTS_DIR = "open-etp-client-acceptance-tests/results";
const FOLDERS = ["_Setup", "Health", "Dataspaces", "DrogonSeed", "_Cleanup"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.new`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600
  });
  fs.renameSync(temporary, file);
}

function removePrivateFiles(statePath) {
  const directory = path.join(path.dirname(statePath), "private");
  if (!fs.existsSync(directory)) {
    return;
  }
  for (const name of [
    "environment.json",
    ...FOLDERS.map(folder => `${folder}.json`)
  ]) {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
  fs.rmdirSync(directory);
}

function configuration(env) {
  const base = env.RESERVOIR_DDMS_HOST;
  const partition = env.DATA_PARTITION_ID;
  const token = env.ACCESS_TOKEN;
  const bearer =
    typeof token === "string" ? token.replace(/^Bearer\s+/i, "").trim() : "";
  if (
    !base ||
    !partition ||
    !bearer ||
    token === "undefined" ||
    token === "null"
  ) {
    throw new Error(
      "Required inputs: RESERVOIR_DDMS_HOST, DATA_PARTITION_ID, ACCESS_TOKEN"
    );
  }
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/\/api\/reservoir-ddms\/v2\/?$/.test(url.pathname) ||
    !/^[a-zA-Z0-9_-]+$/.test(partition) ||
    /[\r\n]/.test(token)
  ) {
    throw new Error("Invalid base URL, partition, or authorization input");
  }
  return {
    base: base.replace(/\/$/, ""),
    platform: `${url.origin}${url.pathname.replace(
      /\/api\/reservoir-ddms\/v2\/?$/,
      ""
    )}`,
    partition,
    token: bearer
  };
}

function fixtureFiles(root) {
  const files = ["Demo_Drogon.epc", "Demo_Drogon.h5"].map(name =>
    path.join(root, "data", name)
  );
  const signatures = [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a])
  ];
  files.forEach((file, index) => {
    if (!fs.existsSync(file)) {
      throw new Error(
        `Required Drogon fixture missing: data/${path.basename(
          file
        )}. Supply the matching EPC/H5 pair; Drogon is not optional.`
      );
    }
    const fd = fs.openSync(file, "r");
    try {
      const bytes = Buffer.alloc(signatures[index].length);
      fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (!bytes.equals(signatures[index])) {
        throw new Error(
          `Invalid Drogon fixture signature: data/${path.basename(
            file
          )} (not a real ZIP/HDF5 file)`
        );
      }
    } finally {
      fs.closeSync(fd);
    }
  });
  return files;
}

function createApi(config, fetchImpl = fetch) {
  return async (method, url, body, statuses = [200]) => {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${config.token}`,
          "data-partition-id": config.partition,
          ...(body && !(body instanceof FormData)
            ? { "content-type": "application/json" }
            : {})
        },
        body:
          body instanceof FormData
            ? body
            : body
            ? JSON.stringify(body)
            : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(body instanceof FormData ? 120000 : 15000)
      });
    } catch {
      throw new Error(
        `${method} ${new URL(url).pathname}: transport failure or timeout`
      );
    }
    if (!statuses.includes(response.status)) {
      const error = new Error(
        `${method} ${new URL(url).pathname}: HTTP ${
          response.status
        }; expected ${statuses.join("/")}`
      );
      error.status = response.status;
      throw error;
    }
    const text = await response.text();
    let data;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `${method} ${new URL(url).pathname}: invalid JSON response`
        );
      }
    }
    return { status: response.status, data };
  };
}

async function discoverGroups(api, config) {
  // Caller memberships prove the principal can use the ACL groups it writes.
  const { data } = await api(
    "GET",
    `${config.platform}/api/entitlements/v2/groups`
  );
  if (
    !data ||
    !Array.isArray(data.groups) ||
    data.groups.some(
      group =>
        !group ||
        typeof group.name !== "string" ||
        typeof group.email !== "string"
    )
  ) {
    throw new Error(
      "Entitlements discovery returned an invalid caller groups response"
    );
  }
  const select = name => {
    const matches = data.groups.filter(group => group.name === name);
    if (
      matches.length !== 1 ||
      !new RegExp(`^${name.replace(/\./g, "\\.")}@[^\\s@]+$`).test(
        matches[0].email
      )
    ) {
      throw new Error(
        `Entitlements must return exactly one usable ${name} group for the principal`
      );
    }
    return matches[0].email;
  };
  return {
    owners: select("data.default.owners"),
    viewers: select("data.default.viewers")
  };
}

function newState(config, env = process.env) {
  const runId = `${env.CI_PIPELINE_ID || "local"}-${
    env.CI_JOB_ID || "job"
  }-${crypto.randomUUID()}`;
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) {
    throw new Error("Invalid CI pipeline/job identity");
  }
  return {
    version: 1,
    runId,
    base: config.base,
    platform: config.platform,
    partition: config.partition,
    resources: ["setup", "crud", "clone", "drogon"].map(kind => ({
      kind,
      id: `test/ci-${kind}-${runId}`,
      eligible: false
    })),
    legalTag: { id: `${config.partition}-ci-${runId}`, eligible: false },
    transactions: {},
    cleaned: false
  };
}

function validateState(state, config) {
  if (
    state.version !== 1 ||
    !/^[a-zA-Z0-9-]+$/.test(state.runId) ||
    state.base !== config.base ||
    state.platform !== config.platform ||
    state.partition !== config.partition ||
    !Array.isArray(state.resources) ||
    state.resources.length !== 4 ||
    !state.transactions ||
    typeof state.transactions !== "object" ||
    Array.isArray(state.transactions)
  ) {
    throw new Error(
      "Cleanup state does not match this instance, partition, or schema"
    );
  }
  for (const kind of ["setup", "crud", "clone", "drogon"]) {
    const entries = state.resources.filter(resource => resource.kind === kind);
    if (
      entries.length !== 1 ||
      entries[0].id !== `test/ci-${kind}-${state.runId}` ||
      typeof entries[0].eligible !== "boolean"
    ) {
      throw new Error("Cleanup state contains an unexpected resource");
    }
  }
  if (
    state.legalTag?.id !== `${config.partition}-ci-${state.runId}` ||
    typeof state.legalTag.eligible !== "boolean"
  ) {
    throw new Error("Cleanup state contains an unexpected legal tag");
  }
  for (const [id, transaction] of Object.entries(state.transactions)) {
    if (
      !state.resources.some(
        resource => resource.eligible && resource.id === id
      ) ||
      !UUID.test(transaction)
    ) {
      throw new Error("Cleanup state contains an unexpected transaction");
    }
  }
}

function dataspaceIds(data) {
  if (!Array.isArray(data)) {
    throw new Error("Dataspace inventory must be an array");
  }
  return data.map(item => {
    // `path` is a server storage path (e.g. "<id>/default"); the URI carries the ID.
    const id =
      typeof item?.uri === "string"
        ? /^eml:\/\/\/dataspace\('([^']+)'\)$/.exec(item.uri)?.[1]
        : undefined;
    if (typeof id !== "string") {
      throw new Error("Dataspace inventory contains an invalid ID");
    }
    return id;
  });
}

async function prepareOwnership(api, config, state, statePath) {
  const ids = dataspaceIds(
    (await api("GET", `${config.base}/dataspaces`)).data
  );
  if (state.resources.some(resource => ids.includes(resource.id))) {
    throw new Error(
      "Run resource collision; refusing to adopt or delete existing data"
    );
  }
  await api(
    "GET",
    `${config.platform}/api/legal/v1/legaltags/${encodeURIComponent(
      state.legalTag.id
    )}`,
    undefined,
    [404]
  );
  state.resources.forEach(resource => {
    resource.eligible = true;
  });
  state.legalTag.eligible = true;
  // Persist absence-checked intent before writes, including timeout-after-create.
  save(statePath, state);
}

async function cleanup(api, config, statePath) {
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  validateState(state, config);
  const deadline = Date.now() + 180000;
  const request = (...args) => {
    if (Date.now() >= deadline) {
      throw new Error(
        "Cleanup exceeded its 180 second budget; recover using the saved ownership state"
      );
    }
    return api(...args);
  };
  const failures = [];
  for (const resource of [...state.resources]
    .reverse()
    .filter(item => item.eligible)) {
    const url = `${config.base}/dataspaces/${encodeURIComponent(resource.id)}`;
    try {
      const transaction = state.transactions[resource.id];
      if (transaction) {
        const result = await request(
          "DELETE",
          `${url}/transactions/${transaction}`,
          undefined,
          [200, 404]
        );
        if (result.status === 200 && result.data !== true) {
          throw new Error(`Rollback did not succeed for ${resource.id}`);
        }
        delete state.transactions[resource.id];
        save(statePath, state);
      }
      const ids = dataspaceIds(
        (await request("GET", `${config.base}/dataspaces`)).data
      );
      if (ids.includes(resource.id)) {
        try {
          await request("DELETE", url, undefined, [200, 204, 404]);
        } catch (error) {
          // A test may have failed between lock and unlock. Locked deletes are
          // rejected with 403 by current servers and with 400 by server 1.3.0.
          if (error.status !== 403 && error.status !== 400) {
            throw error;
          }
          const unlocked = await request(
            "DELETE",
            `${url}/lock`,
            undefined,
            [200, 204]
          );
          if (unlocked.status === 200 && unlocked.data !== true) {
            throw new Error(`Unlock did not succeed for ${resource.id}`);
          }
          await request("DELETE", url, undefined, [200, 204, 404]);
        }
      }
      const remaining = dataspaceIds(
        (await request("GET", `${config.base}/dataspaces`)).data
      );
      if (remaining.includes(resource.id)) {
        throw new Error(`Cleanup verification failed for ${resource.id}`);
      }
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (state.legalTag.eligible && failures.length === 0) {
    try {
      const url = `${
        config.platform
      }/api/legal/v1/legaltags/${encodeURIComponent(state.legalTag.id)}`;
      await request("DELETE", url, undefined, [200, 204, 404]);
      await request("GET", url, undefined, [404]);
    } catch (error) {
      failures.push(error.message);
    }
  }
  state.cleaned = failures.length === 0;
  save(statePath, state);
  save(path.join(path.dirname(statePath), "cleanup-report.json"), {
    runId: state.runId,
    cleaned: state.cleaned,
    failures
  });
  removePrivateFiles(statePath);
  if (failures.length) {
    throw new Error(`Cleanup failed: ${failures.join("; ")}`);
  }
}

function summarizeReport(report, expected) {
  if (
    !Array.isArray(report) ||
    report.length !== 1 ||
    !Array.isArray(report[0].results)
  ) {
    throw new Error("Bruno did not produce a single-iteration results report");
  }
  const results = report[0].results;
  if (results.length !== expected) {
    throw new Error(
      `Bruno executed ${results.length} requests; expected ${expected}`
    );
  }
  const counts = { requests: results.length, tests: 0, failed: 0, checks: [] };
  for (const result of results) {
    if (typeof result.test?.filename !== "string") {
      throw new Error("Bruno report contains a request without a filename");
    }
    const status = result.response?.status;
    const check = {
      file: result.test.filename,
      httpStatus: status,
      failedTests: 0,
      // Test names only: assertion messages may echo response data.
      failedTestNames: [],
      requestError: Boolean(result.error || result.status !== "pass")
    };
    if (
      result.error ||
      result.status !== "pass" ||
      !Number.isInteger(status) ||
      status < 200 ||
      status >= 300
    ) {
      counts.failed++;
    }
    for (const key of [
      "testResults",
      "assertionResults",
      "preRequestTestResults",
      "postResponseTestResults"
    ]) {
      for (const test of result[key] || []) {
        counts.tests++;
        if (test.status !== "pass") {
          counts.failed++;
          check.failedTests++;
          check.failedTestNames.push(
            String(test.description || test.name || "unnamed").slice(0, 200)
          );
        }
      }
    }
    counts.checks.push(check);
  }
  if (counts.tests === 0) {
    throw new Error("Bruno executed no assertions");
  }
  return counts;
}

function execute(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { ...options, timeout: 180000, maxBuffer: 16 * 1024 * 1024 },
      error => {
        if (error) {
          reject(
            new Error(
              `Bruno process failed (${
                error.code || error.signal || "unknown"
              }); inspect sanitized test counts`
            )
          );
        } else {
          resolve();
        }
      }
    );
    const stop = () => child.kill("SIGTERM");
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    child.once("close", () => {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    });
  });
}

// Bruno runs explicitly listed files in argument order, so honour meta.seq.
function orderedRequests(directory) {
  return fs
    .readdirSync(directory)
    .filter(name => name.endsWith(".bru") && name !== "folder.bru")
    .map(name => {
      const meta = /^meta\s*\{([^}]*)\}/m.exec(
        fs.readFileSync(path.join(directory, name), "utf8")
      );
      const seq = Number(/^\s*seq:\s*(\d+)\s*$/m.exec(meta?.[1] || "")?.[1]);
      if (!Number.isInteger(seq)) {
        throw new Error(`Bruno request ${name} has no integer meta seq`);
      }
      return { name, seq };
    })
    .sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name))
    .map(request => request.name);
}

async function runBruno(folder, variables, root, privateDir, command = "bru") {
  const environment = path.join(privateDir, "environment.json");
  // The environment and raw reporter output can contain secrets; never publish them.
  fs.writeFileSync(
    environment,
    JSON.stringify({
      name: "CIMPL acceptance",
      variables: Object.entries(variables).map(([name, value]) => ({
        name,
        value,
        enabled: true,
        secret: name === "access_token"
      }))
    }),
    { mode: 0o600 }
  );
  let files = orderedRequests(path.join(root, "bruno", folder));
  if (folder === "_Setup") {
    files = files.filter(name => !name.startsWith("S1b "));
  }
  if (folder === "DrogonSeed") {
    files = files.filter(name => !/^S0[12] /.test(name));
  }
  const reportPath = path.join(privateDir, `${folder}.json`);
  let processError;
  try {
    await execute(
      command,
      [
        "run",
        ...files.map(file => `${folder}/${file}`),
        "--env-file",
        environment,
        "--sandbox",
        "developer",
        "--reporter-json",
        reportPath,
        "--reporter-skip-all-headers",
        "--reporter-skip-body"
      ],
      { cwd: path.join(root, "bruno") }
    );
  } catch (error) {
    processError = error;
  }
  if (!fs.existsSync(reportPath)) {
    throw processError || new Error(`No Bruno report for ${folder}`);
  }
  const counts = summarizeReport(
    JSON.parse(fs.readFileSync(reportPath, "utf8")),
    files.length
  );
  return { folder, ...counts, processFailed: Boolean(processError) };
}

function resultsStatePath(env = process.env, root = ROOT) {
  return path.resolve(
    root,
    env.ACCEPTANCE_RESULTS_DIR || RESULTS_DIR,
    "state.json"
  );
}

async function run(options = {}) {
  const env = options.env || process.env;
  const root = options.root || ROOT;
  const statePath = options.statePath
    ? path.resolve(root, options.statePath)
    : resultsStatePath(env, root);
  const reportPath = path.join(path.dirname(statePath), "report.json");
  const report = {
    passed: false,
    startedAt: new Date().toISOString(),
    source: env.CI_COMMIT_SHA || null,
    brunoVersion: BRUNO_VERSION,
    folders: [],
    operations: [],
    failures: []
  };
  const config = configuration(env);
  const api = options.api || createApi(config);
  const privateDir = path.join(path.dirname(statePath), "private");
  let ownsState = false;
  try {
    const fixtures = (options.fixtures || fixtureFiles)(root);
    const groups = await discoverGroups(api, config);
    if (
      fs.existsSync(statePath) &&
      !JSON.parse(fs.readFileSync(statePath, "utf8")).cleaned
    ) {
      throw new Error(
        "Unfinished acceptance state exists; run explicit cleanup before starting again"
      );
    }
    const state = newState(config, env);
    report.runId = state.runId;
    save(statePath, state);
    ownsState = true;
    await prepareOwnership(api, config, state, statePath);
    const expirationDate = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    await api(
      "POST",
      `${config.platform}/api/legal/v1/legaltags`,
      {
        name: state.legalTag.id,
        description: "Owned CIMPL acceptance fixture",
        properties: {
          contractId: "123456",
          countryOfOrigin: ["US"],
          dataType: "Third Party Data",
          exportClassification: "EAR99",
          originator: "RDDMS CI",
          personalData: "No Personal Data",
          securityClassification: "Private",
          expirationDate
        }
      },
      [200, 201]
    );
    report.operations.push("legal-tag-created");
    const ids = Object.fromEntries(
      state.resources.map(resource => [resource.kind, resource.id])
    );
    const variables = {
      host: config.base,
      RESERVOIR_DDMS_HOST: config.base,
      access_token: config.token,
      "data-partition-id": config.partition,
      DATA_PARTITION_ID: config.partition,
      acceptanceStrict: "true",
      acceptanceStatePath: statePath,
      defaultOwners: groups.owners,
      defaultViewers: groups.viewers,
      defaultLegalTag: state.legalTag.id,
      dataspaceId: encodeURIComponent(ids.setup),
      dataspaceIdRaw: ids.setup,
      testDataspaceId: encodeURIComponent(ids.setup),
      testDataspaceIdRaw: ids.setup,
      acceptanceCrudIdRaw: ids.crud,
      acceptanceCloneIdRaw: ids.clone,
      drogonSeedId: encodeURIComponent(ids.drogon),
      drogonSeedIdRaw: ids.drogon
    };
    fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
    for (const folder of FOLDERS) {
      if (folder === "DrogonSeed") {
        await api(
          "POST",
          `${config.base}/dataspaces`,
          [
            {
              DataspaceId: ids.drogon,
              Path: ids.drogon,
              CustomData: {
                owners: [groups.owners],
                viewers: [groups.viewers],
                legaltags: [state.legalTag.id],
                otherRelevantDataCountries: ["US"]
              }
            }
          ],
          [200, 201]
        );
        report.operations.push("drogon-dataspace-created");
        const form = new FormData();
        form.append("epc", await fs.openAsBlob(fixtures[0]), "Demo_Drogon.epc");
        form.append("h5", await fs.openAsBlob(fixtures[1]), "Demo_Drogon.h5");
        // REST->ETP is the acceptance scope; do not auto-ingest additional OSDU records.
        const { data } = await api(
          "POST",
          `${config.base}/dataspaces/${encodeURIComponent(
            ids.drogon
          )}/epc/upload`,
          form,
          [200, 201]
        );
        if (
          !data ||
          data.success !== true ||
          !(data.objectsStored > 0) ||
          !(data.arraysStored > 0) ||
          data.skippedArrays !== 0
        ) {
          throw new Error("Drogon upload did not store objects successfully");
        }
        report.operations.push("drogon-epc-h5-uploaded");
      }
      const counts = await (options.bruno || runBruno)(
        folder,
        variables,
        root,
        privateDir,
        env.BRU_COMMAND || "bru"
      );
      report.folders.push(counts);
      if (counts.failed || counts.processFailed) {
        throw new Error(`Required ${folder} acceptance checks failed`);
      }
    }
  } catch (error) {
    report.failures.push(error.message.replaceAll(config.token, "[REDACTED]"));
  } finally {
    if (ownsState) {
      try {
        await cleanup(api, config, statePath);
      } catch (error) {
        report.failures.push(
          error.message.replaceAll(config.token, "[REDACTED]")
        );
      }
    }
    if (ownsState) {
      removePrivateFiles(statePath);
    }
    report.passed = report.failures.length === 0;
    report.finishedAt = new Date().toISOString();
    save(reportPath, report);
  }
  if (!report.passed) {
    throw new Error(report.failures.join("; "));
  }
  return report;
}

module.exports = {
  BRUNO_VERSION,
  RESULTS_DIR,
  resultsStatePath,
  configuration,
  createApi,
  discoverGroups,
  dataspaceIds,
  orderedRequests,
  fixtureFiles,
  newState,
  validateState,
  prepareOwnership,
  cleanup,
  summarizeReport,
  runBruno,
  run
};

if (require.main === module) {
  if (
    process.argv.length > 3 ||
    (process.argv[2] && process.argv[2] !== "--cleanup")
  ) {
    console.error("Usage: node acceptance-runner.cjs [--cleanup]");
    process.exitCode = 1;
  } else {
    const config = () => configuration(process.env);
    const task =
      process.argv[2] === "--cleanup"
        ? cleanup(createApi(config()), config(), resultsStatePath())
        : run();
    task
      .then(() => console.log("CIMPL acceptance completed successfully"))
      .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
