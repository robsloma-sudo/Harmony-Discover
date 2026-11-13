import { describe, expect, it } from "vitest";
import { WorldAnchorObservationGate } from "../src/live/worldAnchorObservationGate";

describe("world-anchor source-frame gate", () => {
  it("counts a detector observation once for one original camera frame", () => {
    const gate = new WorldAnchorObservationGate();
    const key = gate.key(12, 42.125);
    expect(key).toBe("12:42.125000");
    expect(gate.claim(key!)).toBe(true);
    expect(gate.claim(key!)).toBe(false);
    expect(gate.size).toBe(1);
  });

  it("allows the same detector track to contribute a later camera frame", () => {
    const gate = new WorldAnchorObservationGate();
    const first = gate.key(12, 42.125)!;
    const second = gate.key(12, 42.250)!;
    expect(gate.claim(first)).toBe(true);
    expect(gate.claim(second)).toBe(true);
  });

  it("maps duplicate source frames back to their stable physical bottle ID", () => {
    const gate = new WorldAnchorObservationGate();
    const key = gate.key(12, 42.125)!;
    expect(gate.claim(key)).toBe(true);
    gate.bind(key, "physical-1");
    expect(gate.claim(key)).toBe(false);
    expect(gate.getPhysicalId(key)).toBe("physical-1");
  });

  it("bounds its cache and clears session state", () => {
    const gate = new WorldAnchorObservationGate(2);
    const first = gate.key(1, 1)!;
    const second = gate.key(1, 2)!;
    const third = gate.key(1, 3)!;
    gate.claim(first);
    gate.bind(first, "physical-1");
    gate.claim(second);
    gate.claim(third);
    expect(gate.size).toBe(2);
    expect(gate.getPhysicalId(first)).toBeNull();
    gate.reset();
    expect(gate.size).toBe(0);
    expect(gate.claim(first)).toBe(true);
  });
});
