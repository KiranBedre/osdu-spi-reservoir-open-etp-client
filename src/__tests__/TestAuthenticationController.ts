import "jest";

import { NotFoundException } from "@nestjs/common";

import Authentication from "../lib/restApi/read-etp.module/Auth.controller";

describe("local authentication token", () => {
  const original = process.env.RDMS_ENABLE_LOCAL_TOKEN_ENDPOINT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.RDMS_ENABLE_LOCAL_TOKEN_ENDPOINT;
    } else {
      process.env.RDMS_ENABLE_LOCAL_TOKEN_ENDPOINT = original;
    }
  });

  it("is unavailable unless explicitly enabled", async () => {
    delete process.env.RDMS_ENABLE_LOCAL_TOKEN_ENDPOINT;

    await expect(new Authentication().GetToken()).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it("remains available for explicit local development", async () => {
    process.env.RDMS_ENABLE_LOCAL_TOKEN_ENDPOINT = "true";

    const result = await new Authentication().GetToken();

    expect(result.token).toMatch(/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
  });
});
