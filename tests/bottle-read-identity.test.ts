import { describe, expect, it } from "vitest";
import type { BottleRead } from "../src/services/discoverLiveApi";
import { associateBottleReadTracks } from "../src/live/bottleReadIdentity";

function bottle(x: number, brand: string, product: string, category = "whiskey", confidence = 0.9) {
  return {
    box: { x0: x, y0: 0.1, x1: x + 0.16, y1: 0.9 },
    brand, product, category, detectionConfidence: confidence,
    match: null,
  } as unknown as BottleRead;
}

describe("stable bottle instance identity", () => {
  it("keeps physical IDs when the detector returns bottles in a different order", () => {
    const first = associateBottleReadTracks([
      bottle(0.1, "Maker A", "Reserve"),
      bottle(0.55, "Maker B", "12 Year"),
    ], [], 1000, 1);
    const second = associateBottleReadTracks([
      bottle(0.56, "Maker B", "12 Year"),
      bottle(0.11, "Maker A", "Reserve"),
    ], first.tracks, 3500, first.nextId);
    expect(second.tracks.map(track => track.trackId)).toEqual([
      first.tracks[1].trackId,
      first.tracks[0].trackId,
    ]);
  });

  it("uses product identity to strengthen a match when boxes move slightly", () => {
    const first = associateBottleReadTracks([bottle(0.2, "Maker A", "Reserve")], [], 1000, 1);
    const second = associateBottleReadTracks([bottle(0.24, "Maker A", "Reserve")], first.tracks, 3000, first.nextId);
    expect(second.tracks[0].trackId).toBe(first.tracks[0].trackId);
    expect(second.tracks[0].identityKey).toBe("maker a reserve");
  });

  it("does not match across conflicting bottle categories", () => {
    const first = associateBottleReadTracks([bottle(0.2, "Maker A", "Reserve", "whiskey")], [], 1000, 1);
    const second = associateBottleReadTracks([bottle(0.2, "Maker A", "Reserve", "wine")], first.tracks, 2000, first.nextId);
    expect(second.tracks[0].trackId).not.toBe(first.tracks[0].trackId);
  });

  it("retains an unseen bottle briefly so it can be reacquired after occlusion", () => {
    const first = associateBottleReadTracks([bottle(0.2, "Maker A", "Reserve")], [], 1000, 1);
    const hidden = associateBottleReadTracks([], first.tracks, 3000, first.nextId);
    const returned = associateBottleReadTracks([bottle(0.21, "Maker A", "Reserve")], hidden.tracks, 4000, hidden.nextId);
    expect(returned.tracks[0].trackId).toBe(first.tracks[0].trackId);
  });
});
