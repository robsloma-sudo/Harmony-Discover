import { describe, expect, it } from "vitest";
import { isEligibleWorldAnchorCandidate } from "../src/live/worldAnchorFramePolicy";

describe("world-anchor source frame policy", () => {
  it("accepts a cloud candidate paired to its exact ARFrame depth", () => {
    expect(isEligibleWorldAnchorCandidate("cloud", 10, 10)).toBe(true);
    expect(isEligibleWorldAnchorCandidate("cloud", 10, 10.0005)).toBe(true);
    expect(isEligibleWorldAnchorCandidate(undefined, 10, 10)).toBe(false);
  });

  it("never counts local Vision propagation as a physical observation", () => {
    expect(isEligibleWorldAnchorCandidate("local", 10, 10)).toBe(false);
    expect(isEligibleWorldAnchorCandidate("local", 10, 10.05)).toBe(false);
  });

  it("rejects a cloud box paired to a later or older camera frame", () => {
    expect(isEligibleWorldAnchorCandidate("cloud", 10, 10.02)).toBe(false);
    expect(isEligibleWorldAnchorCandidate("cloud", 10, 9.98)).toBe(false);
  });

  it("rejects invalid timestamps", () => {
    expect(isEligibleWorldAnchorCandidate("cloud", undefined, 10)).toBe(false);
    expect(isEligibleWorldAnchorCandidate("cloud", Number.NaN, 10)).toBe(false);
    expect(isEligibleWorldAnchorCandidate("cloud", 10, Number.NaN)).toBe(false);
  });
});
