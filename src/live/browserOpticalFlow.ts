export type OpticalFlowBox = { x: number; y: number; width: number; height: number };
export type OpticalFlowResult = { box: OpticalFlowBox; trackedPoints: number; quality: number };

const sample = (image: Uint8Array, width: number, height: number, x: number, y: number): number => {
  const ix = Math.round(x), iy = Math.round(y);
  if (ix < 1 || iy < 1 || ix >= width - 1 || iy >= height - 1) return Number.NaN;
  return image[iy * width + ix]!;
};

/**
 * Sparse, single-scale Lucas–Kanade optical flow for short camera-frame steps.
 * Boxes are normalized to the cropped camera image. The caller should feed
 * consecutive grayscale frames at a fixed resolution (roughly 320px long edge).
 */
export function trackBoxesWithOpticalFlow(
  previous: Uint8Array,
  current: Uint8Array,
  width: number,
  height: number,
  boxes: OpticalFlowBox[],
): Array<OpticalFlowResult | null> {
  if (width < 16 || height < 16 || previous.length !== width * height || current.length !== width * height) {
    return boxes.map(() => null);
  }

  const trackPoint = (px: number, py: number) => {
    const radius = 2;
    let qx = px, qy = py;
    let finalError = 0;
    for (let iteration = 0; iteration < 5; iteration++) {
      let gxx = 0, gxy = 0, gyy = 0, bx = 0, by = 0, error = 0, samples = 0;
      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const oldValue = sample(previous, width, height, px + ox, py + oy);
          const newValue = sample(current, width, height, qx + ox, qy + oy);
          const left = sample(current, width, height, qx + ox - 1, qy + oy);
          const right = sample(current, width, height, qx + ox + 1, qy + oy);
          const up = sample(current, width, height, qx + ox, qy + oy - 1);
          const down = sample(current, width, height, qx + ox, qy + oy + 1);
          if (![oldValue, newValue, left, right, up, down].every(Number.isFinite)) continue;
          const ix = (right - left) * 0.5, iy = (down - up) * 0.5;
          const it = newValue - oldValue;
          gxx += ix * ix; gxy += ix * iy; gyy += iy * iy;
          bx += ix * it; by += iy * it;
          error += Math.abs(it); samples++;
        }
      }
      const determinant = gxx * gyy - gxy * gxy;
      if (samples < 16 || determinant < 1200) return null;
      const dx = (-gyy * bx + gxy * by) / determinant;
      const dy = (gxy * bx - gxx * by) / determinant;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) > 5) return null;
      qx += dx; qy += dy;
      finalError = error / samples;
      if (Math.hypot(dx, dy) < 0.08) break;
    }
    if (finalError > 38 || qx < 3 || qy < 3 || qx >= width - 3 || qy >= height - 3) return null;
    return { dx: qx - px, dy: qy - py, error: finalError };
  };

  return boxes.map(box => {
    const left = box.x * width, top = box.y * height;
    const right = (box.x + box.width) * width, bottom = (box.y + box.height) * height;
    const points: Array<{ dx: number; dy: number; error: number }> = [];
    // Spread points over the bottle body; avoid the box edge where background
    // motion and adjacent bottles can contaminate the estimate.
    for (const fy of [0.22, 0.42, 0.62, 0.80]) {
      for (const fx of [0.24, 0.50, 0.76]) {
        const point = trackPoint(left + box.width * width * fx, top + box.height * height * fy);
        if (point) points.push(point);
      }
    }
    if (points.length < 3) return null;
    const median = (values: number[]) => {
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)]!;
    };
    const dx = median(points.map(point => point.dx));
    const dy = median(points.map(point => point.dy));
    const inliers = points.filter(point => Math.hypot(point.dx - dx, point.dy - dy) <= 2.8);
    if (inliers.length < 3) return null;
    const moveX = median(inliers.map(point => point.dx)) / width;
    const moveY = median(inliers.map(point => point.dy)) / height;
    const nextX = Math.max(0, Math.min(1 - box.width, box.x + moveX));
    const nextY = Math.max(0, Math.min(1 - box.height, box.y + moveY));
    return {
      box: { ...box, x: nextX, y: nextY },
      trackedPoints: inliers.length,
      quality: inliers.length / points.length,
    };
  });
}

export function rgbaToGrayscale(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0, pixel = 0; pixel < gray.length; pixel++, i += 4) {
    gray[pixel] = Math.round(rgba[i]! * 0.299 + rgba[i + 1]! * 0.587 + rgba[i + 2]! * 0.114);
  }
  return gray;
}
