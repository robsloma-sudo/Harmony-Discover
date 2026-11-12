import { describe, expect, it } from 'vitest';
import { matchDetectionsToTracks } from '../src/live/overlayTrackAssociation';

describe('live overlay track association', () => {
  it('uses smoothed track geometry for a matching detection', () => {
    const result = matchDetectionsToTracks(
      [{ x: 0.1, y: 0.1, width: 0.3, height: 0.7 }],
      [{ trackId: 7, x: 0.11, y: 0.1, width: 0.3, height: 0.7 }],
    );
    expect(result[0]?.trackId).toBe(7);
    expect(result[0]?.x).toBe(0.11);
  });

  it('does not assign one candidate to two adjacent detections', () => {
    const result = matchDetectionsToTracks(
      [
        { x: 0.1, y: 0.1, width: 0.4, height: 0.8 },
        { x: 0.3, y: 0.1, width: 0.4, height: 0.8 },
      ],
      [{ trackId: 9, x: 0.2, y: 0.1, width: 0.4, height: 0.8 }],
    );
    expect(result.filter(Boolean)).toHaveLength(1);
  });

  it('falls back when a candidate does not overlap enough', () => {
    const result = matchDetectionsToTracks(
      [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
      [{ trackId: 4, x: 0.8, y: 0.8, width: 0.1, height: 0.1 }],
    );
    expect(result).toEqual([null]);
  });

  it('rejects invalid candidate geometry', () => {
    const result = matchDetectionsToTracks(
      [{ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }],
      [{ trackId: 4, x: Number.NaN, y: 0.1, width: 0.1, height: 0.1 }],
    );
    expect(result).toEqual([null]);
  });
});
