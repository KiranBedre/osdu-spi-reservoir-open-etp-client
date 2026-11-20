// ============================================================================
// Unit tests for resolveSubarraySelection — the subarray (starts/counts)
// validation + "-1 whole-dimension" sentinel used by GET arrays/{path}.
//
// The sentinel lets callers take a K-only slab of an I×J×K grid property as
// starts=0,0,k & counts=-1,-1,1 without first computing the I/J extents; the
// helper expands each -1 to dimensions[i] - starts[i] and then bounds-checks.
// No ETP/live-server round-trip is needed; the helper is a pure function.
// ============================================================================

import "jest";
import { BadRequestException } from "@nestjs/common";

import { resolveSubarraySelection } from "../lib/restApi/read-etp.module/Array.controller";

describe("resolveSubarraySelection", () => {
  it("passes explicit, fully-specified selections through unchanged", () => {
    const { starts, counts } = resolveSubarraySelection(
      [100, 3],
      [0, 0],
      [100, 3]
    );
    expect(starts).toEqual([0, 0]);
    expect(counts).toEqual([100, 3]);
  });

  it("expands a -1 whole-dimension sentinel to the remaining extent", () => {
    // K-only slab: whole I and J, a single layer at k=5 of an 8×4×10 grid.
    const { starts, counts } = resolveSubarraySelection(
      [8, 4, 10],
      [0, 0, 5],
      [-1, -1, 1]
    );
    expect(counts).toEqual([8, 4, 1]);
    expect(starts).toEqual([0, 0, 5]);
  });

  it("expands -1 relative to a non-zero start", () => {
    // whole remaining tail of a 100-long axis starting at 40.
    const { counts } = resolveSubarraySelection([100], [40], [-1]);
    expect(counts).toEqual([60]);
  });

  it("rejects a rank mismatch between dimensions and starts/counts", () => {
    expect(() => resolveSubarraySelection([8, 4, 10], [0, 0], [1, 1])).toThrow(
      BadRequestException
    );
  });

  it("rejects a start/count length mismatch", () => {
    expect(() => resolveSubarraySelection([8, 4], [0, 0], [1])).toThrow(
      BadRequestException
    );
  });

  it("rejects a slice that runs past the array bounds", () => {
    expect(() => resolveSubarraySelection([10], [5], [10])).toThrow(
      BadRequestException
    );
  });

  it("rejects a negative start", () => {
    expect(() => resolveSubarraySelection([10], [-2], [3])).toThrow(
      BadRequestException
    );
  });

  it("rejects when an expanded -1 would still overflow (start already at end)", () => {
    // start == dimension -> remaining extent is 0; a -1 resolves to 0 which is
    // in-bounds, but a start beyond the dimension must still fail.
    expect(() => resolveSubarraySelection([10], [11], [-1])).toThrow(
      BadRequestException
    );
  });
});
