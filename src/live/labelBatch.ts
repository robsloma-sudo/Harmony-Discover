export type LabelBatchCandidate = {
  trackId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  bottle?: { brand?: string; product?: string; confidence?: number; label_box?: { x0: number; y0: number; x1: number; y1: number } | null };
};

/** Select incomplete or uncertain, cooldown-eligible tracks fairly, preferring stronger local detections. */
export function selectLabelBatchCandidates(
  candidates: LabelBatchCandidate[],
  lastReadAt: ReadonlyMap<number, number>,
  now: number,
  maximum = 8,
  retryAfterMs = 15_000,
): LabelBatchCandidate[] {
  const limit = Math.max(1, Math.min(8, Math.floor(maximum)));
  return candidates
    .filter(candidate =>
      Number.isSafeInteger(candidate.trackId) &&
      candidate.trackId !== 0 &&
      [candidate.x, candidate.y, candidate.width, candidate.height, candidate.confidence].every(Number.isFinite) &&
      candidate.width > 0 && candidate.height > 0 &&
      // Skip only complete, confident identities; a brand without a product
      // (or a weak read) is re-read so missing fields and wrong reads get fixed.
      !(candidate.bottle?.brand && candidate.bottle?.product && (candidate.bottle.confidence ?? 0) >= 0.85) &&
      now - (lastReadAt.get(candidate.trackId) ?? 0) >= retryAfterMs,
    )
    .sort((a, b) =>
      (lastReadAt.get(a.trackId) ?? 0) - (lastReadAt.get(b.trackId) ?? 0) ||
      b.confidence - a.confidence,
    )
    .slice(0, limit);
}

/**
 * Crops worth a second (stronger, slower) look: the first read came back unsure,
 * looked like a guess, or never came back. Each bottle gets at most one second
 * look per cooldown, and only a few are sent at once to keep cost down.
 */
export function selectSecondLookCrops<T extends { trackId: number }>(
  sent: T[],
  reads: ReadonlyArray<{ trackId: number; needsSecondLook?: boolean }>,
  lastSecondLookAt: ReadonlyMap<number, number>,
  now: number,
  maximum = 4,
  cooldownMs = 8_000,
): T[] {
  const byTrack = new Map(reads.map(read => [read.trackId, read]));
  return sent
    .filter(crop => {
      const read = byTrack.get(crop.trackId);
      return (!read || read.needsSecondLook === true)
        && now - (lastSecondLookAt.get(crop.trackId) ?? -Infinity) >= cooldownMs;
    })
    .slice(0, Math.max(0, Math.min(4, Math.floor(maximum))));
}

/**
 * A read that suggests the box is not around a drink at all: no name, at most one word, and the reader
 * said there is no label (or no drink). A drink whose label is blurry, cut off or turned away does not count.
 */
export function looksLikeNoDrink(read: { brand?: string; words?: string[]; unreadableReason?: string }): boolean {
  if (read.brand) return false;
  if ((read.words?.length ?? 0) > 1) return false;
  return read.unreadableReason === 'no_label' || read.unreadableReason === 'not_a_drink';
}

/** How long a box whose label could not be seen twice waits before it is read again (ms). */
export const NO_LABEL_REST_MS = 20_000;

/**
 * Two "no label, no words" reads in a row pause reading that box for a while; the box stays on screen.
 * (17 Nov 2026: hiding such boxes for good dropped real bottles: E.H. Taylor canisters standing behind
 * a Knob Creek 21 showed no label until the phone moved.) A read with a name clears the count.
 */
export function noLabelStep(
  votes: number,
  read: { brand?: string; words?: string[]; unreadableReason?: string },
  now: number,
): { votes: number; restUntil: number | null } {
  if (read.brand) return { votes: 0, restUntil: null };
  if (!looksLikeNoDrink(read)) return { votes, restUntil: null };
  const next = votes + 1;
  return next >= 2 ? { votes: 0, restUntil: now + NO_LABEL_REST_MS } : { votes: next, restUntil: null };
}
