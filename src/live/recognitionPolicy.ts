export type LiveRecognitionIntent = {
  cameraGranted: boolean;
  reviewingCapture: boolean;
  scanMode: 'bottle' | 'menu' | 'auto';
  activePanel: string | null;
  /** LiDAR exists only in the native iPhone build. On the web the LiDAR panel must not start paid live reads. */
  platform?: 'web' | 'ios' | 'android' | string;
};

/**
 * Cloud recognition is deliberately opt-in by screen intent.
 * A camera preview alone must not generate paid recognition frames.
 */
export function shouldEnableLiveRecognition(intent: LiveRecognitionIntent): boolean {
  if (!intent.cameraGranted || intent.reviewingCapture) return false;
  if (intent.activePanel === 'lidar' && intent.platform === 'web') return intent.scanMode !== 'auto';
  return intent.scanMode !== 'auto' || intent.activePanel === 'inventory' || intent.activePanel === 'lidar';
}
