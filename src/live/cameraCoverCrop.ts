export type CameraCropRect = { x: number; y: number; width: number; height: number };

/**
 * Source-pixel rectangle visible through a CSS object-fit: cover video.
 * Detection, optical flow, and cloud frame capture must all use this same crop
 * so normalized model coordinates map to the pixels the user sees.
 */
export function getObjectFitCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number,
): CameraCropRect | null {
  if (![sourceWidth, sourceHeight, displayWidth, displayHeight].every(Number.isFinite)
    || sourceWidth <= 0 || sourceHeight <= 0 || displayWidth <= 0 || displayHeight <= 0) {
    return null;
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const displayAspect = displayWidth / displayHeight;
  let x = 0, y = 0, width = sourceWidth, height = sourceHeight;

  if (sourceAspect > displayAspect) {
    width = sourceHeight * displayAspect;
    x = (sourceWidth - width) / 2;
  } else if (sourceAspect < displayAspect) {
    height = sourceWidth / displayAspect;
    y = (sourceHeight - height) / 2;
  }

  return { x, y, width, height };
}
