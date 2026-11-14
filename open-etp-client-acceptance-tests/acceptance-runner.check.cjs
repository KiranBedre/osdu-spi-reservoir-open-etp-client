const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const {
  configuration,
  createApi,
  discoverGroups,
  dataspaceIds,
  orderedRequests,
  fixtureFiles,
  newState,
  validateState,
  cleanup,
  summarizeReport,
  resultsStatePath,
  run
} = require("./acceptance-runner.cjs");

const root = path.resolve(__dirname, "..");
const env = {
  RESERVOIR_DDMS_HOST: "https://example.test/api/reservoir-ddms/v2",
  DATA_PARTITION_ID: "osdu",
  ACCESS_TOKEN: "not-a-real-token"
};
const config = configuration(env);
const transactionId = "dcd9485f-b345-4cc6-b402-384497207e74";
const groups = [
  {
    name: "data.default.owners",
    email: "data.default.owners@osdu.example.test",
    description: "owners"
  },
  {
    name: "data.default.viewers",
    email: "data.default.viewers@osdu.example.test",
    description: "viewers"
  }
];

// Mirrors the live GET /dataspaces item contract.
const listed = id => ({
  uri: `eml:///dataspace('${id}')`,
  path: `${id}/default`,
  storeLastWrite: "2026-01-01T00:00:00Z",
  storeCreated: "2026-01-01T00:00:00Z",
  customData: {}
});

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "etp-acceptance-"));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  return dir;
}

function simulator() {
  const spaces = new Set(["demo/foreign"]);
  const tags = new Set(["shared-tag"]);
  const calls = [];
  let failure;
  const api = async (method, address, body, statuses = [200]) => {
    const url = new URL(address);
    const route = decodeURIComponent(url.pathname);
    calls.push({ method, route, body });
    if (failure?.(method, route)) {
      throw new Error("Injected API failure");
    }
    let status = 200;
    let data;
    if (route.endsWith("/groups")) {
      data = { desId: "client", memberEmail: "client", groups };
    } else if (route.endsWith("/legaltags") && method === "POST") {
      tags.add(body.name);
      status = 201;
      data = body;
    } else if (route.includes("/legaltags/")) {
      const name = route.split("/legaltags/")[1];
      status = tags.has(name) ? 200 : 404;
      if (method === "DELETE") {
        tags.delete(name);
      }
      data = status === 200 ? { name } : undefined;
    } else if (route.endsWith("/dataspaces")) {
      if (method === "POST") {
        body.forEach(space => spaces.add(space.DataspaceId));
        status = 201;
        data = [];
      } else {
        data = [...spaces].map(listed);
      }
    } else if (route.endsWith("/epc/upload")) {
      data = {
        success: true,
        objectsStored: 10,
        arraysStored: 2,
        skippedArrays: 0
      };
    } else if (route.endsWith(`/transactions/${transactionId}`)) {
      data = true;
    } else if (route.endsWith("/lock")) {
      data = true;
    } else if (route.includes("/dataspaces/") && method === "DELETE") {
      spaces.delete(route.split("/dataspaces/")[1]);
      status = 204;
    } else {
      throw new Error(`Unexpected API call ${method} ${route}`);
    }
    assert.ok(
      statuses.includes(status),
      `unexpected status ${status} for ${method} ${route}`
    );
    return { status, data };
  };
  return {
    api,
    spaces,
    tags,
    calls,
    failWhen: predicate => {
      failure = predicate;
    }
  };
}

function options(t, sim, failFolder) {
  const dir = directory(t);
  const fixtures = [path.join(dir, "test.epc"), path.join(dir, "test.h5")];
  fixtures.forEach(file =>
    fs.writeFileSync(file, "mock payload, not a real dataset")
  );
  return {
    root,
    env,
    statePath: path.join(dir, "state.json"),
    api: sim.api,
    fixtures: () => fixtures,
    bruno: async (folder, variables) => {
      if (folder === "_Setup") {
        sim.spaces.add(variables.testDataspaceIdRaw);
      }
      if (folder === "Dataspaces") {
        sim.spaces.add(variables.acceptanceCrudIdRaw);
        sim.spaces.add(variables.acceptanceCloneIdRaw);
      }
      if (folder === failFolder) {
        const state = JSON.parse(
          fs.readFileSync(variables.acceptanceStatePath, "utf8")
        );
        state.transactions[variables.testDataspaceIdRaw] = transactionId;
        fs.writeFileSync(variables.acceptanceStatePath, JSON.stringify(state));
        throw new Error("Injected assertion failure");
      }
      return { folder, requests: 1, tests: 1, failed: 0, processFailed: false };
    }
  };
}

test("AC-4: only three inputs are required; credentials and URL are validated", () => {
  assert.equal(config.platform, "https://example.test");
  assert.equal(
    configuration({ ...env, ACCESS_TOKEN: "Bearer token" }).token,
    "token"
  );
  for (const key of Object.keys(env)) {
    assert.throws(
      () => configuration({ ...env, [key]: "" }),
      /Required inputs/
    );
  }
  for (const host of [
    "https://user:pass@example.test/api/reservoir-ddms/v2", // pragma: allowlist secret
    "https://example.test/wrong",
    "file:///api/reservoir-ddms/v2"
  ]) {
    assert.throws(
      () => configuration({ ...env, RESERVOIR_DDMS_HOST: host }),
      /Invalid/
    );
  }
});

test("AC-4: discovery uses the caller's returned group emails rather than inventing a domain", async () => {
  const requested = [];
  const api = async (method, url) => {
    requested.push(`${method} ${new URL(url).pathname}${new URL(url).search}`);
    return {
      data: {
        desId: "client",
        memberEmail: "client",
        groups: [{ name: "users", email: "users@osdu.example.test" }, ...groups]
      }
    };
  };
  assert.deepEqual(await discoverGroups(api, config), {
    owners: groups[0].email,
    viewers: groups[1].email
  });
  assert.deepEqual(requested, ["GET /api/entitlements/v2/groups"]);
});

test("AC-4: missing, ambiguous, malformed, and forbidden discovery fail explicitly", async () => {
  for (const data of [
    undefined,
    {},
    { groups: [] },
    { groups: [groups[0]] },
    { groups: [...groups, groups[0]] },
    { groups: [{ ...groups[0], email: "invalid" }, groups[1]] },
    { groups: [{ ...groups[0], email: "other@osdu.example.test" }, groups[1]] },
    { groups: [{ name: groups[0].name }, groups[1]] },
    { groups: [null, ...groups] }
  ]) {
    await assert.rejects(discoverGroups(async () => ({ data }), config));
  }
  await assert.rejects(
    discoverGroups(async () => {
      throw new Error("HTTP 403");
    }, config),
    /403/
  );
});

test("AC-3: HTTP failures and malformed responses never become success", async () => {
  await assert.rejects(
    createApi(config, async () => new Response("denied", { status: 403 }))(
      "GET",
      config.base
    ),
    /HTTP 403/
  );
  await assert.rejects(
    createApi(config, async () => new Response("not json"))("GET", config.base),
    /invalid JSON/
  );
  await assert.rejects(
    createApi(config, async () => {
      throw new Error(env.ACCESS_TOKEN);
    })("GET", config.base),
    /transport failure/
  );
});

test("AC-5: pipeline retries and simultaneous runs have disjoint IDs", () => {
  const a = newState(config, { CI_PIPELINE_ID: "12", CI_JOB_ID: "34" });
  const b = newState(config, { CI_PIPELINE_ID: "12", CI_JOB_ID: "34" });
  assert.notEqual(a.runId, b.runId);
  assert.equal(a.resources.length, 4);
  assert.ok(
    a.resources.every(
      resource => !b.resources.some(other => other.id === resource.id)
    )
  );
});

test("AC-3: missing or LFS/corrupt fixtures fail before any API writes", async t => {
  const sim = simulator();
  const opts = options(t, sim);
  const fixtureRoot = directory(t);
  opts.fixtures = fixtureFiles;
  opts.root = fixtureRoot;
  await assert.rejects(run(opts), /Required Drogon fixture missing/);
  assert.equal(sim.calls.length, 0);
  fs.mkdirSync(path.join(fixtureRoot, "data"));
  fs.writeFileSync(
    path.join(fixtureRoot, "data/Demo_Drogon.epc"),
    "version https://git-lfs.github.com/spec/v1"
  );
  assert.throws(() => fixtureFiles(fixtureRoot), /Invalid Drogon fixture/);
});

test("AC-5: successful lifecycle cleans all owned data, preserving foreign data and shared tags", async t => {
  const sim = simulator();
  const opts = options(t, sim);
  const report = await run(opts);
  assert.equal(report.passed, true);
  assert.deepEqual([...sim.spaces], ["demo/foreign"]);
  assert.deepEqual([...sim.tags], ["shared-tag"]);
  assert.equal(JSON.parse(fs.readFileSync(opts.statePath)).cleaned, true);
  assert.deepEqual(report.operations, [
    "legal-tag-created",
    "drogon-dataspace-created",
    "drogon-epc-h5-uploaded"
  ]);
  assert.ok(
    !fs
      .readFileSync(
        path.join(path.dirname(opts.statePath), "report.json"),
        "utf8"
      )
      .includes(env.ACCESS_TOKEN)
  );
});

test("AC-5: simultaneous runners share no owned resources and cannot clean each other's data", async t => {
  const sim = simulator();
  const first = options(t, sim);
  const second = options(t, sim);
  const reports = await Promise.all([run(first), run(second)]);
  assert.ok(reports.every(report => report.passed));
  assert.notEqual(reports[0].runId, reports[1].runId);
  assert.deepEqual([...sim.spaces], ["demo/foreign"]);
  assert.deepEqual([...sim.tags], ["shared-tag"]);
});

for (const folder of [
  "_Setup",
  "Health",
  "Dataspaces",
  "DrogonSeed",
  "_Cleanup"
]) {
  test(`AC-5: ${folder} failure rolls back and removes all owned resources`, async t => {
    const sim = simulator();
    const opts = options(t, sim, folder);
    await assert.rejects(run(opts), /Injected assertion failure/);
    assert.deepEqual([...sim.spaces], ["demo/foreign"]);
    assert.deepEqual([...sim.tags], ["shared-tag"]);
    assert.ok(
      sim.calls.some(call =>
        call.route.endsWith(`/transactions/${transactionId}`)
      )
    );
    assert.equal(JSON.parse(fs.readFileSync(opts.statePath)).cleaned, true);
  });
}

test("AC-5: timeout-after-create still cleans the absence-checked intended resource", async t => {
  const sim = simulator();
  const opts = options(t, sim);
  opts.bruno = async (_folder, variables) => {
    sim.spaces.add(variables.testDataspaceIdRaw);
    throw new Error("Create response timed out");
  };
  await assert.rejects(run(opts), /timed out/);
  assert.deepEqual([...sim.spaces], ["demo/foreign"]);
});

test("AC-5: a failed create response still reconciles and removes its legal tag", async t => {
  const sim = simulator();
  const opts = options(t, sim);
  opts.api = async (...args) => {
    const response = await sim.api(...args);
    if (args[0] === "POST" && args[1].endsWith("/legaltags")) {
      throw new Error("Legal create response lost");
    }
    return response;
  };
  await assert.rejects(run(opts), /Legal create response lost/);
  assert.deepEqual([...sim.tags], ["shared-tag"]);
});

for (const status of [403, 400]) {
  test(`AC-5: locked owned resources are unlocked when deletion reports HTTP ${status}`, async t => {
    const sim = simulator();
    const opts = options(t, sim);
    let locked = true;
    opts.api = async (...args) => {
      const [method, address] = args;
      if (method === "DELETE" && address.includes("ci-clone-")) {
        if (address.endsWith("/lock")) {
          locked = false;
        } else if (locked) {
          const error = new Error(`HTTP ${status}`);
          error.status = status;
          throw error;
        }
      }
      return sim.api(...args);
    };
    await run(opts);
    assert.equal(locked, false);
    assert.equal(
      sim.calls.filter(call => call.route.endsWith("/lock")).length,
      1
    );
    assert.deepEqual([...sim.spaces], ["demo/foreign"]);
  });
}

test("AC-5: Bruno requests run in meta seq order, not file-name order", t => {
  assert.deepEqual(orderedRequests(path.join(root, "bruno", "Dataspaces")), [
    "List Dataspaces.bru",
    "Get Dataspace Info.bru",
    "Create Dataspace.bru",
    "Clone Dataspace.bru",
    "Lock Dataspace.bru",
    "Unlock Dataspace.bru",
    "Delete Dataspace.bru"
  ]);
  const dir = directory(t);
  fs.writeFileSync(path.join(dir, "A.bru"), "meta {\n  name: A\n}\n");
  assert.throws(() => orderedRequests(dir), /no integer meta seq/);
});

test("AC-5: failed rollback remains recoverable and does not prevent other resources being cleaned", async t => {
  const sim = simulator();
  const opts = options(t, sim, "Dataspaces");
  sim.failWhen(
    (method, route) =>
      method === "DELETE" && route.endsWith(`/transactions/${transactionId}`)
  );
  await assert.rejects(run(opts), /Injected assertion failure.*Cleanup failed/);
  const state = JSON.parse(fs.readFileSync(opts.statePath));
  assert.equal(state.cleaned, false);
  assert.equal(Object.keys(state.transactions).length, 1);
  assert.equal(sim.spaces.size, 2);
  sim.failWhen(undefined);
  await cleanup(sim.api, config, opts.statePath);
  assert.deepEqual([...sim.spaces], ["demo/foreign"]);
});

test("AC-5: a successful delete status is insufficient when the exact ID remains listed", async t => {
  const sim = simulator();
  const opts = options(t, sim);
  opts.api = async (...args) => {
    if (args[0] === "DELETE" && args[1].includes("ci-clone-")) {
      return { status: 204 };
    }
    return sim.api(...args);
  };
  await assert.rejects(run(opts), /Cleanup verification failed/);
  assert.equal(JSON.parse(fs.readFileSync(opts.statePath)).cleaned, false);
});

test("AC-5: cleanup continues after a delete failure and retains the legal tag until resources are removed", async t => {
  const sim = simulator();
  const opts = options(t, sim);
  sim.failWhen(
    (method, route) =>
      method === "DELETE" &&
      route.includes("ci-clone-") &&
      !route.endsWith("/lock")
  );
  await assert.rejects(run(opts), /Cleanup failed/);
  const state = JSON.parse(fs.readFileSync(opts.statePath));
  assert.equal(state.cleaned, false);
  assert.equal(sim.spaces.size, 2);
  assert.equal(sim.tags.size, 2);
  sim.failWhen(undefined);
  await cleanup(sim.api, config, opts.statePath);
  await cleanup(sim.api, config, opts.statePath);
  assert.deepEqual([...sim.spaces], ["demo/foreign"]);
  assert.deepEqual([...sim.tags], ["shared-tag"]);
});

test("AC-5: cleanup rejects state from another partition or a forged resource", () => {
  const state = newState(config);
  assert.throws(
    () => validateState(state, { ...config, partition: "foreign" }),
    /does not match/
  );
  state.resources[0].id = "demo/foreign";
  assert.throws(() => validateState(state, config), /unexpected resource/);
});

test("AC-5: cleanup stops at its 180-second budget and preserves recovery state", async t => {
  const dir = directory(t);
  const file = path.join(dir, "state.json");
  const state = newState(config);
  state.resources.forEach(resource => {
    resource.eligible = true;
  });
  state.legalTag.eligible = true;
  fs.writeFileSync(file, JSON.stringify(state));
  const sim = simulator();
  let clock = 0;
  t.mock.method(Date, "now", () => clock);
  let requests = 0;
  const api = async (...args) => {
    requests++;
    const result = await sim.api(...args);
    clock = 180000;
    return result;
  };
  await assert.rejects(cleanup(api, config, file), /180 second budget/);
  assert.equal(requests, 1);
  assert.equal(JSON.parse(fs.readFileSync(file)).cleaned, false);
});

test("AC-5: dataspace inventory uses the live URI identity, not the storage path", () => {
  assert.deepEqual(
    dataspaceIds([listed("test/ci-a"), { uri: "eml:///dataspace('demo/b')" }]),
    ["test/ci-a", "demo/b"]
  );
  for (const data of [
    {},
    [null],
    [{ DataspaceId: "test/ci-a" }],
    [{ path: "test/ci-a" }],
    [{ uri: "" }],
    [{ uri: "eml:///dataspace(test)" }]
  ]) {
    assert.throws(() => dataspaceIds(data), /Dataspace inventory/);
  }
});

test("AC-5: a preflight collision cannot authorize deletion of existing data", async t => {
  const sim = simulator();
  const opts = options(t, sim);
  const original = opts.api;
  opts.api = async (method, address, body, statuses) => {
    if (method === "GET" && address.endsWith("/dataspaces")) {
      const state = JSON.parse(fs.readFileSync(opts.statePath));
      return {
        status: 200,
        data: state.resources.map(resource => listed(resource.id))
      };
    }
    return original(method, address, body, statuses);
  };
  await assert.rejects(run(opts), /collision/);
  assert.ok(!sim.calls.some(call => call.method === "DELETE"));
});

test("AC-3: green Bruno processes cannot hide HTTP errors, failed assertions, skipped or empty runs", () => {
  const result = {
    test: { filename: "Health/Liveness.bru" },
    status: "pass",
    response: { status: 200 },
    testResults: [{ status: "pass" }]
  };
  const summarize = row => summarizeReport([{ results: [row] }], 1);
  assert.equal(summarize(result).failed, 0);
  assert.equal(summarize({ ...result, response: { status: 412 } }).failed, 1);
  assert.equal(summarize({ ...result, status: "skipped" }).failed, 1);
  const failed = summarize({
    ...result,
    testResults: [
      { status: "fail", description: "status is 200", error: "secret body" }
    ]
  });
  assert.equal(failed.failed, 1);
  assert.deepEqual(failed.checks[0].failedTestNames, ["status is 200"]);
  assert.ok(!JSON.stringify(failed).includes("secret body"));
  assert.throws(() => summarizeReport([{ results: [] }], 1), /expected 1/);
  assert.throws(
    () => summarize({ ...result, testResults: [] }),
    /no assertions/
  );
  assert.throws(() => summarizeReport({}, 1), /single-iteration/);
});

test("results directory defaults inside the suite and is overridable", () => {
  assert.equal(
    resultsStatePath({}, root),
    path.join(root, "open-etp-client-acceptance-tests/results/state.json")
  );
  assert.equal(
    resultsStatePath({ ACCEPTANCE_RESULTS_DIR: "out/acc" }, root),
    path.join(root, "out/acc/state.json")
  );
});

const cli = process.env.BRU_COMMAND || "bru";
const cliAvailable =
  spawnSync(cli, ["--version"], { encoding: "utf8" }).status === 0;

test(
  "AC-2/3/4/5: pinned Bruno executes the real selected collection against an isolated HTTP server",
  { skip: !cliAvailable, timeout: 120000 },
  async t => {
    const sim = simulator();
    const opts = options(t, sim);
    const gridGuid = "5d44d152-0034-45e9-9dc6-164036e17b65";
    const observed = [];
    let denyClone = false;
    let validateErrors = 55;
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks).toString();
      const route = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname
      );
      observed.push({ method: req.method, route });
      try {
        assert.equal(req.headers.authorization, `Bearer ${env.ACCESS_TOKEN}`);
        let status = 200;
        let data = true;
        if (route.includes("/health/")) {
          data = route.endsWith("/info")
            ? { version: "mock" }
            : route.endsWith("/converters")
            ? [1]
            : {};
        } else if (route.endsWith("/dataspaces")) {
          if (req.method === "POST") {
            const input = JSON.parse(body);
            input.forEach(space => sim.spaces.add(space.DataspaceId));
            data = input;
          } else {
            data = [...sim.spaces].map(listed);
          }
        } else if (route.endsWith("/clone")) {
          const input = JSON.parse(body);
          if (denyClone) {
            status = 403;
            data = { error: "Simulated forbidden clone" };
          } else {
            sim.spaces.add(input.DataspaceId);
            data = true;
          }
        } else if (route.endsWith("/transactions")) {
          data = transactionId;
        } else if (route.endsWith("/validate")) {
          status = 201;
          // Mirrors the server 1.3.0 report for the known-invalid Drogon fixture.
          data = {
            is_valid: false,
            version: "mock",
            object_count: 348,
            validated_count: 336,
            error_count: validateErrors,
            warning_count: 316,
            errors: []
          };
        } else if (route.endsWith("/resources/all")) {
          data = [
            { uri: `eml:///resqml20.obj_IjkGridRepresentation(${gridGuid})` }
          ];
        } else if (route.includes(gridGuid)) {
          data = { Uuid: gridGuid };
        } else if (req.method === "DELETE" && !route.endsWith("/lock")) {
          sim.spaces.delete(route.split("/dataspaces/")[1]);
          status = 204;
        }
        res.writeHead(status, { "content-type": "application/json" });
        res.end(status === 204 ? undefined : JSON.stringify(data));
      } catch (error) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${
      server.address().port
    }/api/reservoir-ddms/v2`;
    opts.env = { ...env, RESERVOIR_DDMS_HOST: base, BRU_COMMAND: cli };
    delete opts.bruno;
    const report = await run(opts);
    assert.equal(report.passed, true);
    assert.equal(
      report.folders.reduce((total, folder) => total + folder.requests, 0),
      23
    );
    assert.ok(
      observed.every(
        call =>
          !call.route.includes("bruno-collection") &&
          !call.route.includes("bruno-clone")
      )
    );
    assert.deepEqual([...sim.spaces], ["demo/foreign"]);
    const position = (method, pattern) =>
      observed.findIndex(
        call => call.method === method && pattern.test(call.route)
      );
    assert.ok(
      position("POST", /\/dataspaces$/) <
        position("POST", /ci-crud-.*\/clone$/) &&
        position("POST", /ci-crud-.*\/clone$/) <
          position("POST", /ci-crud-.*\/lock$/) &&
        position("POST", /ci-crud-.*\/lock$/) <
          position("DELETE", /ci-crud-.*\/lock$/),
      "Dataspaces requests run in meta seq order against the CRUD dataspace"
    );
    validateErrors = 56;
    await assert.rejects(
      run(opts),
      /Required DrogonSeed acceptance checks failed/,
      "errors beyond the known fixture baseline fail the run"
    );
    assert.deepEqual([...sim.spaces], ["demo/foreign"]);
    validateErrors = 55;
    denyClone = true;
    await assert.rejects(
      run(opts),
      /Required Dataspaces acceptance checks failed/
    );
    const failed = JSON.parse(
      fs.readFileSync(path.join(path.dirname(opts.statePath), "report.json"))
    );
    const folder = failed.folders.find(item => item.folder === "Dataspaces");
    assert.equal(
      folder.processFailed,
      false,
      "legacy permissive Bruno assertions still exit zero"
    );
    assert.ok(
      folder.failed > 0,
      "the strict runner detects the otherwise false-green HTTP 403"
    );
    assert.deepEqual([...sim.spaces], ["demo/foreign"]);
  }
);
