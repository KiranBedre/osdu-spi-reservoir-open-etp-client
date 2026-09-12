import "jest";

import { ResqmlClient } from "../lib/client/ResqmlClient";
import { ETPClient } from "../lib/client/ETPClient";
import { ErrorCode } from "../lib/common/EtpTypes";
import { EtpUri } from "../lib/common/EtpUri";

const activeSessionId = [1, ...Array(15).fill(0)];

const createClient = () => {
  const client = new ResqmlClient();
  const etpClient = (client as any).client as ETPClient;
  (etpClient as any).connection = {
    close: jest.fn(),
    readyState: 1,
    send: jest.fn()
  };
  (etpClient as any).sessionId = activeSessionId;
  client.logger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn()
  };
  return { client, etpClient };
};

describe("ResqmlClient.closeSession", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    [0, "CONNECTING"],
    [1, "OPEN"],
    [2, "CLOSING"],
    [3, "CLOSED"],
    [4, "UNKNOWN"]
  ])("reports ready state %s as %s", (readyState, expected) => {
    const { etpClient } = createClient();
    (etpClient as any).connection.readyState = readyState;

    expect(etpClient.getConnectionState().readyState).toBe(expected);
  });

  it("does not report an invalid session as active", async () => {
    const { client, etpClient } = createClient();
    (etpClient as any).sessionId = EtpUri.invalidGuid();

    expect(etpClient.isInSession()).toBe(false);
    await expect(client.closeSession()).resolves.toBeUndefined();
    expect((etpClient as any).connection.send).not.toHaveBeenCalled();
  });

  it("removes close listeners after disconnect", async () => {
    const { client, etpClient } = createClient();
    const initialDisconnectListeners = etpClient.listenerCount("disconnect");

    const close = client.closeSession();
    expect(etpClient.listenerCount("disconnect")).toBe(
      initialDisconnectListeners + 1
    );
    etpClient.emit("disconnect");

    await expect(close).resolves.toBeUndefined();
    expect(JSON.parse(client.logger.info.mock.calls[0][0])).toMatchObject({
      event: "etpCloseSession",
      outcome: "disconnect",
      disconnectionWaitMs: 5000,
      initialReadyState: "OPEN",
      initialSessionActive: true,
      readyState: "OPEN",
      sessionActive: false
    });
    expect(etpClient.listenerCount("disconnect")).toBe(
      initialDisconnectListeners
    );
    expect(etpClient.listenerCount("exception")).toBe(0);
    expect(etpClient.listenerCount("error")).toBe(0);
  });

  it("removes close listeners after a synchronous error", async () => {
    const { client, etpClient } = createClient();
    const initialDisconnectListeners = etpClient.listenerCount("disconnect");
    jest.spyOn(etpClient, "closeSession").mockImplementation(() => {
      throw new Error("send failed");
    });

    await expect(client.closeSession()).rejects.toThrow("send failed");
    expect(JSON.parse(client.logger.error.mock.calls[0][0])).toMatchObject({
      event: "etpCloseSession",
      outcome: "error",
      initialSessionActive: true
    });
    expect(etpClient.listenerCount("disconnect")).toBe(
      initialDisconnectListeners
    );
    expect(etpClient.listenerCount("exception")).toBe(0);
    expect(etpClient.listenerCount("error")).toBe(0);
  });

  it("returns a typed timeout and removes close listeners", async () => {
    jest.useFakeTimers();
    const { client, etpClient } = createClient();
    const initialDisconnectListeners = etpClient.listenerCount("disconnect");

    const close = client.closeSession(5000);
    jest.advanceTimersByTime(5000);

    await expect(close).rejects.toMatchObject({
      code: ErrorCode.ETIMED_OUT
    });
    expect(JSON.parse(client.logger.error.mock.calls[0][0])).toMatchObject({
      event: "etpCloseSession",
      outcome: "timeout",
      disconnectionWaitMs: 5000,
      elapsedMs: 5000,
      initialReadyState: "OPEN",
      initialSessionActive: true,
      readyState: "OPEN",
      sessionActive: false
    });
    expect(JSON.parse(client.logger.error.mock.calls[0][0])).toHaveProperty(
      "eventLoopDelayMaxMs"
    );
    expect(etpClient.isInSession()).toBe(false);
    await expect(client.closeSession(5000)).resolves.toBeUndefined();
    expect(etpClient.listenerCount("disconnect")).toBe(
      initialDisconnectListeners
    );
    expect(etpClient.listenerCount("exception")).toBe(0);
    expect(etpClient.listenerCount("error")).toBe(0);
  });
});
