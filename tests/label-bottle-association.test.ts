import { describe, expect, it } from 'vitest';
import { associateLabelSignalsToBottles } from '../src/live/labelBottleAssociation';

const bottleA = { x0: 0.05, y0: 0.1, x1: 0.45, y1: 0.9 };
const bottleB = { x0: 0.55, y0: 0.1, x1: 0.95, y1: 0.9 };

describe('label and barcode to bottle association', () => {
  it('assigns OCR and barcode regions to the bottle that contains them', () => {
    const result = associateLabelSignalsToBottles(
      [bottleA, bottleB],
      [{ text: 'BOURBON', confidence: 0.91, box: { x0: 0.12, y0: 0.3, x1: 0.36, y1: 0.4 } }],
      [{ value: '0123456789012', symbology: 'ean13', box: { x0: 0.62, y0: 0.72, x1: 0.85, y1: 0.8 } }],
    );
    expect(result[0].text).toEqual(['BOURBON']);
    expect(result[0].barcodes).toEqual([]);
    expect(result[1].barcodes).toEqual(['0123456789012']);
  });

  it('leaves a signal unassigned when adjacent bottle boxes are ambiguous', () => {
    const result = associateLabelSignalsToBottles(
      [bottleA, { x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.9 }],
      [{ text: 'SHARED EDGE', confidence: 0.99, box: { x0: 0.32, y0: 0.35, x1: 0.42, y1: 0.45 } }],
      [],
    );
    expect(result.every(item => item.text.length === 0)).toBe(true);
  });

  it('rejects invalid coordinates and low-confidence OCR', () => {
    const result = associateLabelSignalsToBottles(
      [bottleA],
      [
        { text: 'LOW', confidence: 0.1, box: { x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.3 } },
        { text: 'INVALID', confidence: 0.99, box: { x0: -0.1, y0: 0.2, x1: 0.2, y1: 0.3 } },
      ],
      [],
    );
    expect(result[0].text).toEqual([]);
  });
});
