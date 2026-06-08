// ============================================================================
// Copyright 2026 Microsoft. Inc. or its affiliates. All Rights Reserved
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

import "jest";

import { BadRequestException } from "@nestjs/common";

import { XMLBuilder } from "../lib/mlTypes/Json2Xml";

// ---------------------------------------------------------------------------
// XMLBuilder.buildTextValueNode — XSD dateTime / eml20:TimeStamp validation
//
// Regression coverage for WI 72324: PutDataObject returned HTTP 500
// ("Unknown Error: Invalid time value") when a request body contained an
// unparseable date string, because the lenient fallback
// `new Date(value).toISOString()` throws RangeError that was caught as a
// generic 5xx. The fix throws BadRequestException (400) in that case.
// ---------------------------------------------------------------------------

describe("XMLBuilder.buildTextValueNode — xsd:dateTime validation", () => {
  // Access the private method via `as any` (same pattern used elsewhere in
  // this test suite for cross-cutting validation of internal helpers).
  const invoke = (value: string, attrStr: string): string =>
    (new XMLBuilder() as any).buildTextValueNode(value, "Creation", attrStr, 0);

  const xsdDateTime = ' xsi:type="xsd:dateTime"';
  const emlTimestamp = ' xsi:type="eml20:TimeStamp"';

  it("accepts a strict XSD dateTime value (xsd:dateTime)", () => {
    expect(() => invoke("2024-01-01T00:00:00Z", xsdDateTime)).not.toThrow();
  });

  it("accepts a strict XSD dateTime value (eml20:TimeStamp)", () => {
    expect(() => invoke("2024-01-01T00:00:00Z", emlTimestamp)).not.toThrow();
  });

  it("accepts a JS-parseable ISO value that falls outside the strict regex", () => {
    // sub-second precision — accepted by Date, but typically rejected by the
    // strict XSD regex. The lenient fallback should kick in without error.
    expect(() => invoke("2024-01-01T00:00:00.123Z", xsdDateTime)).not.toThrow();
  });

  it.each([
    ["empty string", ""],
    ["all zeros", "0000-00-00"],
    ["plain text", "not-a-date"],
    ["whitespace only", "   "]
  ])(
    "rejects invalid dateTime value (%s) with BadRequestException",
    (_label, badValue) => {
      expect(() => invoke(badValue, xsdDateTime)).toThrow(BadRequestException);
    }
  );

  it("includes the field name and offending value in the BadRequest message", () => {
    try {
      invoke("not-a-date", xsdDateTime);
      fail("Expected BadRequestException to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as {
        description: string;
      };
      expect(response.description).toContain("Creation");
      expect(response.description).toContain("not-a-date");
    }
  });

  it("does NOT validate values when the attribute is not a date type", () => {
    // Non-date attrStr should bypass the validation branch entirely so
    // unrelated fields are never rejected for date parsing.
    expect(() =>
      (new XMLBuilder() as any).buildTextValueNode(
        "not-a-date",
        "Title",
        ' xsi:type="xsd:string"',
        0
      )
    ).not.toThrow();
  });
});
