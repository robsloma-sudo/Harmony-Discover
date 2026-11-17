import { describe, expect, it } from 'vitest';
import { NO_LABEL_REST_MS, noLabelStep } from '../src/live/labelBatch';

const noLabel = { brand: '', words: [], unreadableReason: 'no_label' };

describe('boxes whose label cannot be seen', () => {
  it('pauses reading after two no-label reads but never hides the box for good', () => {
    const first = noLabelStep(0, noLabel, 1000);
    expect(first).toEqual({ votes: 1, restUntil: null });
    const second = noLabelStep(first.votes, noLabel, 2000);
    expect(second).toEqual({ votes: 0, restUntil: 2000 + NO_LABEL_REST_MS });
  });

  it('a canister behind another bottle is read again after the pause and named once its label shows', () => {
    let votes = 0;
    votes = noLabelStep(votes, noLabel, 0).votes;
    const paused = noLabelStep(votes, noLabel, 1000);
    expect(paused.restUntil).toBe(1000 + NO_LABEL_REST_MS);
    // after the pause the phone has moved and the label is visible
    expect(noLabelStep(paused.votes, { brand: 'Colonel E.H. Taylor', words: ['E.H. TAYLOR'] }, 25_000)).toEqual({ votes: 0, restUntil: null });
  });

  it('blurry, cut-off or turned-away labels do not count as "no label"', () => {
    expect(noLabelStep(1, { brand: '', words: [], unreadableReason: 'blurry' }, 0)).toEqual({ votes: 1, restUntil: null });
    expect(noLabelStep(1, { brand: '', words: [], unreadableReason: 'turned_away' }, 0)).toEqual({ votes: 1, restUntil: null });
  });
});
