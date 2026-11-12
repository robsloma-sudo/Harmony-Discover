export type LiveRecognitionIntent = {
  cameraGranted: boolean;
  reviewingCapture: boolean;
  scanMode: 'bottle' | 'menu' | 'auto';
  activePanel: string | null;
};

/**
 * Cloud recognition is deliberately opt-in by screen intent.
 * A camera preview alone must not generate paid recognition frames.
 */
export function shouldEnableLiveRecognition(intent: LiveRecognitionIntent): boolean {
  if (!intent.cameraGranted || intent.reviewingCapture) return false;
  return intent.scanMode !== 'auto' || intent.activePanel === 'inventory' || intent.activePanel === 'lidar';
}
