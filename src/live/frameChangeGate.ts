/** Low-resolution luminance sampling for deciding whether a live camera frame is worth sending. */
export function sampleLumaGrid(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  gridSize = 24,
): Uint8Array {
  if (width < 1 || height < 1 || rgba.length < width * height * 4 || gridSize < 1) {
    throw new Error('invalid_frame_data');
  }
  const samples = new Uint8Array(gridSize * gridSize);
  for (let gy = 0; gy < gridSize; gy += 1) {
    const y = Math.min(height - 1, Math.floor(((gy + 0.5) / gridSize) * height));
    for (let gx = 0; gx < gridSize; gx += 1) {
      const x = Math.min(width - 1, Math.floor(((gx + 0.5) / gridSize) * width));
      const offset = (y * width + x) * 4;
      samples[gy * gridSize + gx] = Math.round(
        rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722,
      );
    }
  }
  return samples;
}

/** Fraction of sampled pixels whose luminance changed by at least minDelta. */
export function changedCellRatio(
  previous: Uint8Array | null,
  current: Uint8Array,
  minDelta = 18,
): number {
  if (!previous || previous.length !== current.length || current.length === 0) return 1;
  let changed = 0;
  for (let i = 0; i < current.length; i += 1) {
    if (Math.abs(current[i] - previous[i]) >= minDelta) changed += 1;
  }
  return changed / current.length;
}

/** Always read the first frame; later reads require visible scene change. */
export function shouldReadChangedFrame(
  previous: Uint8Array | null,
  current: Uint8Array,
  minimumChangedRatio = 0.025,
): boolean {
  return !previous || changedCellRatio(previous, current) >= minimumChangedRatio;
}
