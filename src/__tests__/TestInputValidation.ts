// ============================================================================
// Copyright 2025 Microsoft. Inc. or its affiliates. All Rights Reserved
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

// NOTE: These tests require the following env vars (set automatically via `npm test`):
//   RDMS_ETP_PROTOCOL, RDMS_ETP_HOST, RDMS_ETP_PORT, RDMS_REST_ROOT_PATH, RDMS_REST_PORT

import "jest";
import "reflect-metadata";

import { validate } from "class-validator";

import { ManifestInputDto } from "../lib/restApi/read-etp.module/Manifest.controller";
import { CreateTransactionDto } from "../lib/restApi/write-etp.module/Transactions.controller";
import { UrisDto } from "../lib/restApi/read-etp.module/MultiObject.controller";

// ---------------------------------------------------------------------------
// ManifestInputDto
// ---------------------------------------------------------------------------

describe("ManifestInputDto - uris field", () => {
  it("accepts a valid uris array", async () => {
    const dto = new ManifestInputDto();
    dto.uris = ["eml:///dataspace('demo/Volve')/resqml20.obj_Grid(5d27775e-5c7f-4786-a048-9a303fa1165a)"];
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "uris")).toHaveLength(0);
  });

  it("rejects an empty uris array", async () => {
    const dto = new ManifestInputDto();
    dto.uris = [];
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "uris").length).toBeGreaterThan(0);
  });

  it("rejects a non-array uris value", async () => {
    const dto = new ManifestInputDto();
    (dto as any).uris = "not-an-array";
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "uris").length).toBeGreaterThan(0);
  });

  it("rejects a uris array containing an empty string", async () => {
    const dto = new ManifestInputDto();
    dto.uris = ["eml:///dataspace('demo/Volve')", ""];
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "uris").length).toBeGreaterThan(0);
  });
});

describe("ManifestInputDto - typePatterns field", () => {
  it("accepts omitted typePatterns (optional)", async () => {
    const dto = new ManifestInputDto();
    dto.uris = ["eml:///dataspace('demo/Volve')"];
    // typePatterns intentionally not set
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "typePatterns")).toHaveLength(0);
  });

  it("accepts a valid typePatterns array", async () => {
    const dto = new ManifestInputDto();
    dto.uris = ["eml:///dataspace('demo/Volve')"];
    dto.typePatterns = ["resqml20.obj_*Representation"];
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "typePatterns")).toHaveLength(0);
  });

  it("rejects typePatterns containing an empty string", async () => {
    const dto = new ManifestInputDto();
    dto.uris = ["eml:///dataspace('demo/Volve')"];
    dto.typePatterns = ["resqml20.obj_*", ""];
    const errors = await validate(dto);
    expect(
      errors.filter(e => e.property === "typePatterns").length
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CreateTransactionDto
// ---------------------------------------------------------------------------

describe("CreateTransactionDto - TimeoutPeriod field", () => {
  it("accepts omitted TimeoutPeriod (optional)", async () => {
    const dto = new CreateTransactionDto();
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "TimeoutPeriod")).toHaveLength(0);
  });

  it("accepts TimeoutPeriod at minimum boundary (1)", async () => {
    const dto = new CreateTransactionDto();
    dto.TimeoutPeriod = 1;
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "TimeoutPeriod")).toHaveLength(0);
  });

  it("accepts TimeoutPeriod at maximum boundary (86400)", async () => {
    const dto = new CreateTransactionDto();
    dto.TimeoutPeriod = 86400;
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "TimeoutPeriod")).toHaveLength(0);
  });

  it("rejects TimeoutPeriod below minimum (0)", async () => {
    const dto = new CreateTransactionDto();
    dto.TimeoutPeriod = 0;
    const errors = await validate(dto);
    expect(
      errors.filter(e => e.property === "TimeoutPeriod").length
    ).toBeGreaterThan(0);
  });

  it("rejects TimeoutPeriod above maximum (86401)", async () => {
    const dto = new CreateTransactionDto();
    dto.TimeoutPeriod = 86401;
    const errors = await validate(dto);
    expect(
      errors.filter(e => e.property === "TimeoutPeriod").length
    ).toBeGreaterThan(0);
  });

  it("rejects non-integer TimeoutPeriod (1.5)", async () => {
    const dto = new CreateTransactionDto();
    dto.TimeoutPeriod = 1.5;
    const errors = await validate(dto);
    expect(
      errors.filter(e => e.property === "TimeoutPeriod").length
    ).toBeGreaterThan(0);
  });
});

describe("CreateTransactionDto - Retries field", () => {
  it("accepts omitted Retries (optional)", async () => {
    const dto = new CreateTransactionDto();
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "Retries")).toHaveLength(0);
  });

  it("accepts Retries at minimum boundary (1)", async () => {
    const dto = new CreateTransactionDto();
    dto.Retries = 1;
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "Retries")).toHaveLength(0);
  });

  it("accepts Retries at maximum boundary (100)", async () => {
    const dto = new CreateTransactionDto();
    dto.Retries = 100;
    const errors = await validate(dto);
    expect(errors.filter(e => e.property === "Retries")).toHaveLength(0);
  });

  it("rejects Retries below minimum (0)", async () => {
    const dto = new CreateTransactionDto();
    dto.Retries = 0;
    const errors = await validate(dto);
    expect(
      errors.filter(e => e.property === "Retries").length
    ).toBeGreaterThan(0);
  });

  it("rejects Retries above maximum (101)", async () => {
    const dto = new CreateTransactionDto();
    dto.Retries = 101;
    const errors = await validate(dto);
    expect(
      errors.filter(e => e.property === "Retries").length
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// UrisDto
// ---------------------------------------------------------------------------

describe("UrisDto - uris field", () => {
  it("accepts a valid uris array", async () => {
    const dto = new UrisDto();
    dto.uris = ["eml:///dataspace('demo/Volve')/resqml20.obj_Grid(5d27775e-5c7f-4786-a048-9a303fa1165a)"];
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it("rejects an empty uris array", async () => {
    const dto = new UrisDto();
    dto.uris = [];
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects a non-array uris value", async () => {
    const dto = new UrisDto();
    (dto as any).uris = "not-an-array";
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects a uris array containing an empty string", async () => {
    const dto = new UrisDto();
    dto.uris = ["valid-uri", ""];
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects a uris array containing a non-string element", async () => {
    const dto = new UrisDto();
    (dto as any).uris = ["valid-uri", 42];
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Dimensions validation guard (ObjectWrite.controller.ts)
// Mirrors the condition:
//   !Array.isArray(a.Dimensions) ||
//   a.Dimensions.length === 0 ||
//   !a.Dimensions.every(d => Number.isInteger(d) && d >= 1)
// ---------------------------------------------------------------------------

const isDimensionsValid = (dimensions: unknown): boolean =>
  Array.isArray(dimensions) &&
  dimensions.length > 0 &&
  (dimensions as unknown[]).every(
    d => Number.isInteger(d) && (d as number) >= 1
  );

describe("Dimensions validation guard", () => {
  it("rejects undefined", () => {
    expect(isDimensionsValid(undefined)).toBe(false);
  });

  it("rejects null", () => {
    expect(isDimensionsValid(null)).toBe(false);
  });

  it("rejects a non-array value", () => {
    expect(isDimensionsValid("3,3")).toBe(false);
    expect(isDimensionsValid(3)).toBe(false);
  });

  it("rejects an empty array", () => {
    expect(isDimensionsValid([])).toBe(false);
  });

  it("rejects an array containing zero", () => {
    expect(isDimensionsValid([3, 0])).toBe(false);
  });

  it("rejects an array containing a negative integer", () => {
    expect(isDimensionsValid([-1, 3])).toBe(false);
  });

  it("rejects an array containing a non-integer float", () => {
    expect(isDimensionsValid([1.5, 3])).toBe(false);
  });

  it("accepts a valid single-dimension array", () => {
    expect(isDimensionsValid([1])).toBe(true);
  });

  it("accepts a valid multi-dimensional array", () => {
    expect(isDimensionsValid([3, 3])).toBe(true);
    expect(isDimensionsValid([10, 20, 5])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CustomData Object.keys enumeration (DataspaceWrite.controller.ts)
// Validates that `for (const e of Object.keys(obj))` only visits own
// enumerable properties - not inherited ones as `for (const e in obj)` would.
// ---------------------------------------------------------------------------

describe("CustomData Object.keys enumeration", () => {
  it("iterates only own properties, not inherited prototype properties", () => {
    const parent = { inheritedKey: "should-not-appear" };
    const obj = Object.create(parent) as Record<string, unknown>;
    obj["ownKey"] = "my-value";

    const visited: string[] = [];
    for (const e of Object.keys(obj)) {
      visited.push(e);
    }

    expect(visited).toEqual(["ownKey"]);
    expect(visited).not.toContain("inheritedKey");
  });

  it("collects all own string-valued properties into a Map", () => {
    const customData: Record<string, string> = { foo: "bar", baz: "qux" };
    const result = new Map<string, string>();

    for (const e of Object.keys(customData)) {
      result.set(e, customData[e]);
    }

    expect(result.size).toBe(2);
    expect(result.get("foo")).toBe("bar");
    expect(result.get("baz")).toBe("qux");
  });
});
