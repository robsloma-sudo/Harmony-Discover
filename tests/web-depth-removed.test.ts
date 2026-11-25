import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// S2-B2-005: the browser relative-depth model ran on desktop but nothing used
// its output. It was removed; this keeps it from coming back unconnected.
const root = resolve(__dirname, '..');

describe('web relative depth path is removed', () => {
  it('no longer ships the unused estimator, overlay or worker', () => {
    for (const file of ['src/live/BrowserDepthEstimator.ts', 'src/live/RelativeDepthOverlay.tsx', 'public/discover-depth-worker.js']) {
      expect(existsSync(resolve(root, file)), file).toBe(false);
    }
  });

  it('the web camera surface does not start a depth worker', () => {
    const source = readFileSync(resolve(root, 'src/live/DiscoverARSurface.tsx'), 'utf8');
    expect(source).not.toMatch(/BrowserDepthEstimator|RelativeDepthMap|discover-depth-worker/);
    expect(source).toContain('Web camera has no depth');
  });
});
