/**
 * Live-store capability probe for the integration gate.
 *
 * Jest registers `describe` / `it` synchronously, before any `beforeAll` can talk
 * to the server, so a suite cannot decide at registration time which protocol
 * blocks apply to the connected store unless that answer already exists. This
 * module is the jest `globalSetup`: it opens one ETP session, records the set of
 * negotiated protocols in `process.env[ETP_NEGOTIATED_ENV]` (inherited by the
 * test workers) and closes the session. TestProtocolsIntegration then registers
 *
 *   - the full block of a protocol when the store negotiates it,
 *   - the client's fallback block (P3 instead of P13, 501 for growing-object
 *     routes) when it does not, and
 *   - the unused twin with `.skip`, so the junit report shows SKIPPED never passed.
 *
 * The probe only runs when the integration suite is part of the run (i.e. not
 * excluded by testPathIgnorePatterns), so `npm test` never touches the network.
 * An unreachable store leaves the variable unset; the suite's beforeAll then
 * fails on connectivity exactly as before.
 */
import type { Config } from "@jest/types";

import { Energistics, ResqmlClient, XmlUtils } from "../../index";
import { etpServerUrl } from "../../lib/common/config";

export const ETP_NEGOTIATED_ENV = "RDMS_ETP_NEGOTIATED";
const INTEGRATION_SUITE = "TestProtocolsIntegration";
const PROBE_TIMEOUT_MS = 30000;

type ProtocolId = Energistics.Etp.v12.Datatypes.Protocol;
const Protocol = Energistics.Etp.v12.Datatypes.Protocol;

/** All ETP 1.2 protocol ids the client knows (the enum is numeric <-> name). */
const allProtocols = (): ProtocolId[] =>
  Object.values(Protocol).filter((v): v is ProtocolId => typeof v === "number");

/** Open a session, return the negotiated protocol ids, close. */
export const probeNegotiatedProtocols = async (
  url: string,
  partitionId: string
): Promise<ProtocolId[]> => {
  const client = new ResqmlClient();
  client.setCallsTraceability(false);
  try {
    await client.openSession(url, XmlUtils.createDefaultJWT(), partitionId);
    return allProtocols().filter(p => client.isProtocolSupported(p));
  } finally {
    if (client.isConnected()) {
      await client.closeSession();
    }
  }
};

/** Parse what the probe recorded; undefined when no probe ran / store unreachable. */
export const negotiatedProtocolsFromEnv = (): ProtocolId[] | undefined => {
  const raw = process.env[ETP_NEGOTIATED_ENV];
  if (raw === undefined) {
    return undefined;
  }
  return raw
    .split(",")
    .filter(s => s.length > 0)
    .map(s => Number(s) as ProtocolId);
};

const withTimeout = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what}: timed out after ${ms} ms`)), ms);
    p.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      e => {
        clearTimeout(t);
        reject(e);
      }
    );
  });

const globalSetup = async (_: Config.GlobalConfig, projectConfig: Config.ProjectConfig): Promise<void> => {
  const suitePath = `${projectConfig.rootDir}/src/__tests__/${INTEGRATION_SUITE}.ts`;
  const excluded = projectConfig.testPathIgnorePatterns.some(p => new RegExp(p).test(suitePath));
  if (excluded) {
    return;
  }
  const partitionId = process.env.RDMS_TEST_DATA_PARTITION_ID || "osdu";
  try {
    const negotiated = await withTimeout(
      probeNegotiatedProtocols(etpServerUrl, partitionId),
      PROBE_TIMEOUT_MS,
      `ETP capability probe ${etpServerUrl}`
    );
    process.env[ETP_NEGOTIATED_ENV] = negotiated.join(",");
    // eslint-disable-next-line no-console
    console.log(`[etp-capabilities] ${etpServerUrl} negotiates: ${negotiated.map(p => Protocol[p]).join(", ")}`);
  } catch (e) {
    delete process.env[ETP_NEGOTIATED_ENV];
    // eslint-disable-next-line no-console
    console.warn(`[etp-capabilities] no store reachable at ${etpServerUrl}: ${(e as Error).message}`);
  }
};

export default globalSetup;
