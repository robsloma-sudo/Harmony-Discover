import { describe, expect, it } from "vitest";
import type { BottleRead } from "../src/services/discoverLiveApi";
import { attachBottleReadsToCandidates, normalizedBoxIoU } from "../src/services/bottleCandidateAssociation";

const bottle = (x0: number, x1: number, brand: string): BottleRead => ({
  box: { x0, y0: 0.1, x1, y1: 0.9 },
  words: [],
  brand,
  product: brand + " expression",
  category: "whiskey",
  proof: "",
  size: "",
  origin: "",
  confidence: 0.9,
  detectionConfidence: 0.9,
  fieldConfidence: {},
  researchSources: [],
  details: {},
  match: null,
  state: "reported",
});

describe("live bottle candidate association", () => {
  it("uses normalized box overlap to associate a read with its visual track", () => {
    const read = bottle(0.1, 0.4, "Bottle A");
    const [candidate] = attachBottleReadsToCandidates(
      [{ trackId: 1, x: 0.11, y: 0.12, width: 0.28, height: 0.75 }],
      [read],
    );
    expect(candidate.bottle).toBe(read);
  });

  it("does not assign one recognition result to two different tracks", () => {
    const read = bottle(0.1, 0.4, "Bottle A");
    const candidates = attachBottleReadsToCandidates([
      { trackId: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.8 },
      { trackId: 2, x: 0.12, y: 0.1, width: 0.3, height: 0.8 },
    ], [read]);
    expect(candidates.filter(candidate => candidate.bottle).length).toBe(1);
  });

  it("does not attach a read when the boxes do not overlap enough", () => {
    const [candidate] = attachBottleReadsToCandidates(
      [{ trackId: 1, x: 0.7, y: 0.1, width: 0.2, height: 0.8 }],
      [bottle(0.1, 0.35, "Bottle A")],
    );
    expect(candidate.bottle).toBeUndefined();
  });

  it("preserves an identity already attached to the track", () => {
    const trackedRead = bottle(0.1, 0.4, "Tracked identity");
    const nearbyRead = bottle(0.12, 0.42, "Nearby identity");
    const [candidate] = attachBottleReadsToCandidates(
      [{ trackId: 1, x: 0.1, y: 0.1, width: 0.3, height: 0.8, bottle: trackedRead }],
      [nearbyRead],
    );
    expect(candidate.bottle).toBe(trackedRead);
  });

  it("returns zero for disjoint or zero-area boxes", () => {
    expect(normalizedBoxIoU(
      { x0: 0, y0: 0, x1: 0, y1: 0 },
      { x0: 0.5, y0: 0.5, x1: 0.8, y1: 0.8 },
    )).toBe(0);
  });
});
