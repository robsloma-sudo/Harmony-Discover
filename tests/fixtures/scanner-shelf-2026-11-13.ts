/**
 * Human-reviewed visual annotations for the supplied shelf-scan recording.
 * Bounds are normalized against the complete 512x1112 screen recording.
 *
 * These are approximate physical-object bounds, not detector ground truth.
 * Product identity is intentionally omitted: visible overlay text is not
 * sufficient to certify the identity of a physical bottle.
 */
export type ShelfObjectAnnotation = {
  objectId: string;
  bounds: { x: number; y: number; width: number; height: number };
  visibility: 'full' | 'partial';
  note?: string;
};

export type ShelfFrameAnnotation = {
  timestampSeconds: number;
  objects: ShelfObjectAnnotation[];
};

export const shelfScanCoordinateSpace = 'full-screen-recording' as const;

export const shelfScanAnnotations: ShelfFrameAnnotation[] = [
  {
    timestampSeconds: 5,
    objects: [
      { objectId: 'tall-yellow-container', bounds: { x: 0.291, y: 0.250, width: 0.197, height: 0.334 }, visibility: 'full', note: 'Tall yellow cylindrical package; label appears to read Colonel E.H. Taylor Jr.' },
      { objectId: 'left-squat-glass-bottle', bounds: { x: 0.018, y: 0.374, width: 0.264, height: 0.213 }, visibility: 'full', note: 'Squat clear glass bottle at left; product identity unverified.' },
      { objectId: 'green-round-logo-bottle', bounds: { x: 0.480, y: 0.399, width: 0.164, height: 0.188 }, visibility: 'full', note: 'Green bottle with a prominent round/oval front logo; logo text appears to read Michter’s.' },
      { objectId: 'light-glass-bottle', bounds: { x: 0.637, y: 0.387, width: 0.148, height: 0.198 }, visibility: 'partial', note: 'Partly obscured light/clear bottle behind neighboring objects.' },
      { objectId: 'right-dark-bottle', bounds: { x: 0.789, y: 0.358, width: 0.211, height: 0.225 }, visibility: 'partial', note: 'Dark bottle at right edge; product identity unverified.' }
    ]
  },
  {
    timestampSeconds: 9,
    objects: [
      { objectId: 'tall-yellow-container', bounds: { x: 0.217, y: 0.303, width: 0.213, height: 0.285 }, visibility: 'full', note: 'Same tall yellow cylindrical package, shifted in frame.' },
      { objectId: 'left-squat-glass-bottle', bounds: { x: 0.018, y: 0.378, width: 0.201, height: 0.210 }, visibility: 'full', note: 'Same squat clear glass bottle at left.' },
      { objectId: 'green-round-logo-bottle', bounds: { x: 0.438, y: 0.418, width: 0.166, height: 0.173 }, visibility: 'full', note: 'Same green bottle with prominent round/oval front logo.' },
      { objectId: 'light-glass-bottle', bounds: { x: 0.607, y: 0.391, width: 0.160, height: 0.199 }, visibility: 'partial', note: 'Partly obscured light/clear bottle.' },
      { objectId: 'right-dark-bottle', bounds: { x: 0.801, y: 0.354, width: 0.195, height: 0.234 }, visibility: 'partial', note: 'Dark bottle at right edge.' }
    ]
  },
  {
    timestampSeconds: 18,
    objects: [
      { objectId: 'tall-yellow-container', bounds: { x: 0.000, y: 0.339, width: 0.197, height: 0.309 }, visibility: 'partial', note: 'Same tall yellow package, now clipped by the left edge.' },
      { objectId: 'green-round-logo-bottle', bounds: { x: 0.186, y: 0.420, width: 0.213, height: 0.243 }, visibility: 'full', note: 'Same green bottle with round/oval front logo; camera has panned.' },
      { objectId: 'center-orange-label-bottle', bounds: { x: 0.418, y: 0.425, width: 0.182, height: 0.238 }, visibility: 'full', note: 'Bottle with orange front label; exact product identity unverified.' },
      { objectId: 'right-center-clear-bottle', bounds: { x: 0.615, y: 0.416, width: 0.213, height: 0.243 }, visibility: 'full', note: 'Clear bottle with dark neck/closure; product identity unverified.' },
      { objectId: 'far-right-bottle', bounds: { x: 0.820, y: 0.399, width: 0.180, height: 0.261 }, visibility: 'partial', note: 'Partially visible bottle at far right; product identity unverified.' }
    ]
  }
];
