export type LiveRecognitionIntent = {
  cameraGranted: boolean;
  reviewingCapture: boolean;
  scanMode: 'bottle' | 'menu' | 'auto';
  activePanel: string | null;
  /** LiDAR exists only in the native iPhone build. On the web the LiDAR panel must not start paid live reads. */
  platform?: 'web' | 'ios' | 'android' | string;
};

/**
 * The camera viewfinder is the primary Discover experience, so automatic
 * bottle recognition starts when that view is open. Detailed capture review
 * pauses live reads, and utility panels do not silently consume recognition.
 */
export function shouldEnableLiveRecognition(intent: LiveRecognitionIntent): boolean {
  if (!intent.cameraGranted || intent.reviewingCapture) return false;
  if (intent.activePanel === 'lidar' && intent.platform === 'web') return intent.scanMode !== 'auto';
  if (intent.activePanel && intent.activePanel !== 'inventory' && intent.activePanel !== 'lidar' && intent.scanMode === 'auto') return false;
  return true;
}
