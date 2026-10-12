import fs from "fs";
import Logger from "bunyan";
import { Energistics } from "../lib/common/Etp12";

export const logger = Logger.createLogger({ name: "Certification" });

// Read configuration from json file provided as argument
const fileName = process.argv[2];
if (!fileName || !fs.existsSync(fileName)) {
  logger.error("Usage: npm run certification <config_file>");
  process.exit(1);
}

const config: {
  etpServerUrl: string;
  jwtToken?: string;
  dataPartition?: string;
  dataPartitionMode?: string;
  supportApplicationAuthentication?: boolean;
  supportTransportAuthentication?: boolean;
  serverRequiresAuthorization?: boolean;
  runExperimental?: boolean;
  protocols: {
    discovery: {
      supported: boolean;
    };
    store: {
      supported: boolean;
      supportsWrite: boolean;
      // Optional sub-protocol parameters. When omitted, the store
      // certification tests fall back to their built-in default values,
      // so existing configurations remain fully backward compatible.
      wellUriForGet?: string;
      trajectoryUriForGet?: string;
      wellBoreUriForGet?: string;
      channelUriForGet?: string;
      unsupportedDataObjectUri?: string;
      resourceNotFoundUri?: string;
      unsupportedDeleteUri?: string;
      uriForDelete1?: string;
      uriForDelete2?: string;
      // Tunables consumed directly by 4.storeProtocol.cert.ts
      wellUuidForGet?: string;
      wellboreUuidForGet?: string;
      invalidUri?: string;
      invalidUuid?: string;
    };
  };
} = JSON.parse(fs.readFileSync(fileName, "utf8"));

export const itif = (condition?: boolean) => (condition ? it : it.skip);
export const describeif = (condition?: boolean) =>
  condition ? describe : describe.skip;

export const failIfError = (err: Error) => {
  expect(err).toBeFalsy();
};

export const successIfError = (err: Error) => {
  expect(err).toBeTruthy();
};

export const failIfNoError = () => {
  expect(true).toBeFalsy();
};

export const fail = (message: string) => {
  expect(message).toBeFalsy(); // Force test to fail
};

export const dataPatitionMode = config.dataPartitionMode || "single";
export const dataPartition = config.dataPartition;

export const sleep = (milliseconds: number) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
};

config.supportApplicationAuthentication =
  config.supportApplicationAuthentication === undefined
    ? true
    : config.supportApplicationAuthentication;

config.supportTransportAuthentication =
  config.supportTransportAuthentication === undefined
    ? true
    : config.supportTransportAuthentication;

config.serverRequiresAuthorization =
  config.serverRequiresAuthorization === undefined
    ? true
    : config.serverRequiresAuthorization;

jest.setTimeout(300000);

export default config;
