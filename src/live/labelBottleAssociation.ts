export type NormalizedImageBox = { x0: number; y0: number; x1: number; y1: number };
export type LocatedText = { text: string; confidence: number; box: NormalizedImageBox };
export type LocatedBarcode = { value: string; symbology: string; box: NormalizedImageBox };
export type BottleLabelSignals = { text: string[]; barcodes: string[] };

function validBox(box: NormalizedImageBox): boolean {
  return [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)
    && box.x0 >= 0 && box.y0 >= 0 && box.x1 <= 1 && box.y1 <= 1
    && box.x1 > box.x0 && box.y1 > box.y0;
}

/** Fraction of a label signal's area covered by a bottle detection. */
function coverage(label: NormalizedImageBox, bottle: NormalizedImageBox): number {
  const w = Math.max(0, Math.min(label.x1, bottle.x1) - Math.max(label.x0, bottle.x0));
  const h = Math.max(0, Math.min(label.y1, bottle.y1) - Math.max(label.y0, bottle.y0));
  const area = (label.x1 - label.x0) * (label.y1 - label.y0);
  return area > 0 ? (w * h) / area : 0;
}

function uniqueBottleIndex(box: NormalizedImageBox, bottleBoxes: NormalizedImageBox[]): number | null {
  if (!validBox(box)) return null;
  const ranked = bottleBoxes.map((candidate, index) => ({
    index,
    score: validBox(candidate) ? coverage(box, candidate) : 0,
  })).sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < 0.55) return null;
  // Adjacent bottles often overlap in a loose detector box. Refuse to guess
  // when two bottles explain the same OCR/barcode region almost equally well.
  if (ranked[1] && ranked[0].score - ranked[1].score < 0.18) return null;
  return ranked[0].index;
}

/**
 * Joins native Vision label/barcode rectangles to bottle detections in the
 * same normalized, upright camera frame. Ambiguous signals remain unassigned.
 */
export function associateLabelSignalsToBottles(
  bottleBoxes: NormalizedImageBox[],
  textItems: LocatedText[],
  barcodeItems: LocatedBarcode[],
): BottleLabelSignals[] {
  const result = bottleBoxes.map(() => ({ text: [] as string[], barcodes: [] as string[] }));
  for (const item of textItems) {
    const index = uniqueBottleIndex(item.box, bottleBoxes);
    const text = item.text.trim();
    if (index !== null && text && item.confidence >= 0.25 && !result[index].text.includes(text)) {
      result[index].text.push(text);
    }
  }
  for (const item of barcodeItems) {
    const index = uniqueBottleIndex(item.box, bottleBoxes);
    const value = item.value.trim();
    if (index !== null && value && !result[index].barcodes.includes(value)) {
      result[index].barcodes.push(value);
    }
  }
  return result;
}
