/**
 * Keeps late liquid-level results on the right bottle (Liquid Level audit P0).
 *
 * The liquid worker answers after the frame it measured. In the meantime a
 * track can be re-attached from memory (possibly a different bottle in the same
 * spot), absorb another track, or change identity. Each of those bumps the
 * track's generation; a result is accepted only if the track still has the
 * generation it had when the frame was sent.
 */
export class LiquidTrackGuard {
  private generation = new Map<number, number>();
  private submitted = new Map<number, Map<number, number>>();
  private order: number[] = [];

  constructor(private readonly keepFrames = 8) {}

  /** Something about this track changed: results already in flight no longer apply. */
  bump(trackId: number): void {
    this.generation.set(trackId, (this.generation.get(trackId) ?? 0) + 1);
  }

  /** Record which generation each track had when this frame went to the worker. */
  stamp(timestamp: number, trackIds: number[]): void {
    if (!this.submitted.has(timestamp)) this.order.push(timestamp);
    this.submitted.set(timestamp, new Map(trackIds.map(id => [id, this.generation.get(id) ?? 0])));
    while (this.order.length > this.keepFrames) this.submitted.delete(this.order.shift()!);
  }

  /** True only if the result belongs to a frame we sent and the track has not changed since. */
  accepts(timestamp: number, trackId: number): boolean {
    const sent = this.submitted.get(timestamp)?.get(trackId);
    return sent !== undefined && sent === (this.generation.get(trackId) ?? 0);
  }

  clear(): void {
    this.generation.clear();
    this.submitted.clear();
    this.order = [];
  }
}
