import { describe, expect, it } from "vitest";
import { WorldAnchorObservationGate } from "../src/live/worldAnchorObservationGate";

describe("world-anchor source-frame gate", () => {
  it("counts one detector observation once per original frame", () => {
    const gate = new WorldAnchorObservationGate();
    const key = gate.key(12, 42.125)!;
    expect(gate.claim(key)).toBe(true);
    expect(gate.claim(key)).toBe(false);
  });

  it("allows the same detector track on a later source frame", () => {
    const gate = new WorldAnchorObservationGate();
    expect(gate.claim(gate.key(12, 42.125)!)).toBe(true);
    expect(gate.claim(gate.key(12, 42.250)!)).toBe(true);
  });

  it("maps repeated callbacks to their stable physical bottle ID", () => {
    const gate = new WorldAnchorObservationGate();
    const key = gate.key(12, 42.125)!;
    expect(gate.claim(key)).toBe(true);
    gate.bind(key, "physical-1");
    expect(gate.claim(key)).toBe(false);
    expect(gate.getPhysicalId(key)).toBe("physical-1");
  });

  it("bounds its cache and clears it at a new AR session", () => {
    const gate = new WorldAnchorObservationGate(2);
    const first = gate.key(1, 1)!;
    gate.claim(first);
    gate.bind(first, "physical-1");
    gate.claim(gate.key(1, 2)!);
    gate.claim(gate.key(1, 3)!);
    expect(gate.size).toBe(2);
    expect(gate.getPhysicalId(first)).toBeNull();
    gate.reset();
    expect(gate.size).toBe(0);
    expect(gate.claim(first)).toBe(true);
  });
});
