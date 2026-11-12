export type SpatialCapabilityInput = {
  secureContext: boolean;
  mediaDevices: boolean;
  webgl2: boolean;
  webgpu: boolean;
  depthModelLoaded: boolean;
  cameraPoseAvailable: boolean;
};

export type SpatialCapabilityReport = {
  camera: boolean;
  gpu: 'webgpu' | 'webgl2' | 'none';
  depth: 'metric' | 'relative' | 'unavailable';
  pose: 'available' | 'unavailable';
  canRender3D: boolean;
  canClaimWorldTracking: boolean;
  blockers: string[];
};

/** Reports only capabilities actually present; GPU support alone is not depth estimation. */
export function assessSpatialCapabilities(input: SpatialCapabilityInput): SpatialCapabilityReport {
  const blockers: string[] = [];
  if (!input.secureContext) blockers.push('HTTPS is required for camera access.');
  if (!input.mediaDevices) blockers.push('This browser does not expose camera capture.');
  if (!input.webgl2 && !input.webgpu) blockers.push('WebGL2 or WebGPU is required for spatial rendering.');
  if (!input.depthModelLoaded) blockers.push('No depth-estimation model is loaded.');
  if (!input.cameraPoseAvailable) blockers.push('Camera pose / visual odometry is not available.');
  return {
    camera: input.secureContext && input.mediaDevices,
    gpu: input.webgpu ? 'webgpu' : input.webgl2 ? 'webgl2' : 'none',
    depth: input.depthModelLoaded ? 'relative' : 'unavailable',
    pose: input.cameraPoseAvailable ? 'available' : 'unavailable',
    canRender3D: (input.webgl2 || input.webgpu) && input.depthModelLoaded,
    canClaimWorldTracking: input.depthModelLoaded && input.cameraPoseAvailable,
    blockers,
  };
}

export function readBrowserSpatialCapabilities(): SpatialCapabilityReport {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return assessSpatialCapabilities({ secureContext: false, mediaDevices: false, webgl2: false, webgpu: false, depthModelLoaded: false, cameraPoseAvailable: false });
  }
  let webgl2 = false;
  try {
    const canvas = document.createElement('canvas');
    webgl2 = !!canvas.getContext('webgl2');
  } catch { webgl2 = false; }
  const nav = navigator as Navigator & { gpu?: unknown };
  return assessSpatialCapabilities({
    secureContext: window.isSecureContext,
    mediaDevices: !!navigator.mediaDevices?.getUserMedia,
    webgl2,
    webgpu: !!nav.gpu,
    // No depth model or visual-odometry provider is installed in this build.
    depthModelLoaded: false,
    cameraPoseAvailable: false,
  });
}
