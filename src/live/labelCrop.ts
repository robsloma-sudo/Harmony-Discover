export type NormalizedLabelBox = { x0: number; y0: number; x1: number; y1: number };
export type PixelCrop = { sx: number; sy: number; sw: number; sh: number; outputWidth: number; outputHeight: number };

/**
 * Convert a normalized label region into a padded source-image crop.
 * Output dimensions preserve source detail, cap very large uploads, and only
 * upscale small crops modestly. Upscaling never creates source information.
 */
export function calculateLabelCrop(
  box: NormalizedLabelBox,
  sourceWidth: number,
  sourceHeight: number,
  options: { paddingX?: number; paddingY?: number; maxLongEdge?: number; maxUpscale?: number } = {},
): PixelCrop | null {
  if (![sourceWidth, sourceHeight, box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) ||
      sourceWidth < 2 || sourceHeight < 2 ||
      box.x0 < 0 || box.y0 < 0 || box.x1 > 1 || box.y1 > 1 ||
      box.x1 <= box.x0 || box.y1 <= box.y0) return null;

  const paddingX = Math.max(0, Math.min(0.3, options.paddingX ?? 0.10));
  const paddingY = Math.max(0, Math.min(0.3, options.paddingY ?? 0.12));
  const padX = (box.x1 - box.x0) * paddingX;
  const padY = (box.y1 - box.y0) * paddingY;
  const x0 = Math.max(0, box.x0 - padX), y0 = Math.max(0, box.y0 - padY);
  const x1 = Math.min(1, box.x1 + padX), y1 = Math.min(1, box.y1 + padY);
  const sx = Math.max(0, Math.floor(x0 * sourceWidth));
  const sy = Math.max(0, Math.floor(y0 * sourceHeight));
  const right = Math.min(sourceWidth, Math.ceil(x1 * sourceWidth));
  const bottom = Math.min(sourceHeight, Math.ceil(y1 * sourceHeight));
  const sw = right - sx, sh = bottom - sy;
  if (sw < 2 || sh < 2) return null;

  const maxLongEdge = Math.max(256, options.maxLongEdge ?? 2048);
  const maxUpscale = Math.max(1, Math.min(2, options.maxUpscale ?? 2));
  const scale = Math.min(maxUpscale, maxLongEdge / Math.max(sw, sh));
  return {
    sx, sy, sw, sh,
    outputWidth: Math.max(2, Math.round(sw * scale)),
    outputHeight: Math.max(2, Math.round(sh * scale)),
  };
}
