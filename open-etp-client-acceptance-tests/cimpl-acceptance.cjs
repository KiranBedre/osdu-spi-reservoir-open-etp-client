const fs = require("node:fs");
const {
  configuration,
  createApi,
  cleanup,
  run,
  resultsStatePath
} = require("./acceptance-runner.cjs");

async function main() {
  if (
    process.argv.length > 3 ||
    (process.argv[2] && process.argv[2] !== "--cleanup")
  ) {
    throw new Error("Usage: node cimpl-acceptance.cjs [--cleanup]");
  }
  const cleanupOnly = process.argv[2] === "--cleanup";
  if (cleanupOnly && !fs.existsSync(resultsStatePath())) {
    console.log(
      "No acceptance ownership state; nothing was created by the runner"
    );
    return;
  }
  const required = [
    "CIMPL_TOKEN_URI",
    "CIMPL_CLIENT_ID",
    "CIMPL_CLIENT_SECRET",
    "CIMPL_DNS_NAME",
    "DATA_PARTITION_ID"
  ];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing CIMPL adapter inputs: ${missing.join(", ")}`);
  }
  const response = await fetch(process.env.CIMPL_TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.CIMPL_CLIENT_ID,
      client_secret: process.env.CIMPL_CLIENT_SECRET,
      scope: "openid"
    }),
    redirect: "error",
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new Error(`CIMPL token acquisition failed: HTTP ${response.status}`);
  }
  const token = await response.json();
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw new Error("CIMPL token acquisition returned no access token");
  }
  const host = process.env.CIMPL_DNS_NAME.replace(/^https?:\/\//, "").replace(
    /\/$/,
    ""
  );
  const env = {
    ...process.env,
    RESERVOIR_DDMS_HOST: `https://${host}/api/reservoir-ddms/v2`,
    ACCESS_TOKEN: token.access_token
  };
  if (cleanupOnly) {
    const config = configuration(env);
    await cleanup(createApi(config), config, resultsStatePath(env));
  } else {
    await run({ env });
  }
}

if (require.main === module) {
  main()
    .then(() => console.log("CIMPL acceptance operation succeeded"))
    .catch(error => {
      // Upstream response bodies and credentials are deliberately not logged.
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { main };
