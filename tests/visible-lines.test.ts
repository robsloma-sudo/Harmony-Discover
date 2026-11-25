import { describe, expect, it } from 'vitest';
import { visibleLineIds, visibleLinkedLines } from '../src/explore/visibleLines';

const boxes = { a: { y: 0, height: 100 }, b: { y: 110, height: 100 }, c: { y: 500, height: 100 }, d: { y: 1500, height: 100 } };
describe('visible lines', () => {
  it('returns only lines in the viewport', () => {
    expect(visibleLineIds(boxes, 0, 600).sort()).toEqual(['a', 'b', 'c']);
    expect(visibleLineIds(boxes, 1400, 600)).toEqual(['d']);
  });
  it('honours list offset and an unmeasured viewport', () => {
    expect(visibleLineIds(boxes, 0, 300, 1000)).toEqual([]);
    expect(visibleLineIds(boxes, 0, 0)).toEqual([]);
  });
  it('keeps only linked lines', () => {
    const links = [{ line_id: 'a', status: 'linked' }, { line_id: 'b', status: 'unlinked' }, { line_id: 'd', status: 'linked' }] as any;
    expect(visibleLinkedLines(links, boxes, 0, 600).map(l => l.line_id)).toEqual(['a']);
  });
});
