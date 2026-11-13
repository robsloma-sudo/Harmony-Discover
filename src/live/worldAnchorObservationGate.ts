/**
 * Deduplicates world-anchor observations by detector track and original camera frame.
 * React re-renders and depth updates must never count the same camera image as
 * multiple confirmation hits.
 */
export class WorldAnchorObservationGate {
  private readonly seen = new Set<string>();
  private readonly physicalIds = new Map<string, string>();

  constructor(private readonly maxEntries = 512) {}

  key(trackId: number, sourceTimestamp: number): string | null {
    if (!Number.isFinite(trackId) || !Number.isFinite(sourceTimestamp)) return null;
    return `${trackId}:${sourceTimestamp.toFixed(6)}`;
  }

  // Re-renders of one ARFrame must not count as a second physical observation.
  claim(key: string): boolean {
    if (!key || this.seen.has(key)) return false;
    this.seen.add(key);
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.values().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
      this.physicalIds.delete(oldest);
    }
    return true;
  }

  bind(key: string, physicalObjectId: string): void {
    if (this.seen.has(key) && physicalObjectId) this.physicalIds.set(key, physicalObjectId);
  }

  getPhysicalId(key: string): string | null {
    return this.physicalIds.get(key) ?? null;
  }

  retainActive(activeIds: Set<string>): void {
    for (const [key, id] of this.physicalIds) {
      if (!activeIds.has(id)) this.physicalIds.delete(key);
    }
  }

  reset(): void {
    this.seen.clear();
    this.physicalIds.clear();
  }

  get size(): number {
    return this.seen.size;
  }
}
