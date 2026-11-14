import {
  createDfineSegOnnxProvider,
  type DfineOnnxProviderOptions,
  type DfineOrtRuntime,
  type DfineSegOnnxProvider,
} from "./dfineSegOnnxProvider";
import { DFINE_SEG_MODEL_SHA256, DFINE_SEG_MODEL_URL, verifyDfineModelBytes } from "./dfineModelIntegrity";
import { UPRIGHT_CONTAINER_CLASS_RULES } from "./dfineSegAdapter";
import { DfineSegWorkerProvider, detectorBackendPreference } from "./dfineWorkerProvider";

export { DFINE_SEG_MODEL_URL, DFINE_SEG_MODEL_SHA256, verifyDfineModelBytes } from "./dfineModelIntegrity";

declare global {
  interface Window {
    __discoverOrtRuntime?: DfineOrtRuntime;
  }
}

let modelBytesPromise: Promise<ArrayBuffer> | null = null;
let runtimePromise: Promise<DfineOrtRuntime> | null = null;

async function loadModelBytes(): Promise<ArrayBuffer> {
  if (!modelBytesPromise) {
    modelBytesPromise = (async () => {
      const response = await fetch(DFINE_SEG_MODEL_URL, { cache: "force-cache" });
      if (!response.ok) throw new Error("D-FINE model asset could not be loaded (" + response.status + ").");
      const bytes = await response.arrayBuffer();
      await verifyDfineModelBytes(bytes);
      return bytes;
    })().catch(error => {
      modelBytesPromise = null;
      throw error;
    });
  }
  return modelBytesPromise;
}

async function loadRuntime(): Promise<DfineOrtRuntime> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("D-FINE browser runtime is only available in a browser.");
  }
  if (window.__discoverOrtRuntime) return window.__discoverOrtRuntime;
  if (!runtimePromise) {
    runtimePromise = new Promise<DfineOrtRuntime>((resolve, reject) => {
      const script = document.createElement("script");
      script.type = "module";
      script.async = true;
      script.src = "/ort/ort-loader.js";
      script.onload = () => {
        if (window.__discoverOrtRuntime) resolve(window.__discoverOrtRuntime);
        else reject(new Error("ONNX Runtime browser module loaded without exporting its runtime."));
      };
      script.onerror = () => reject(new Error("ONNX Runtime browser module failed to load."));
      document.head.appendChild(script);
    }).catch(error => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

/** Main-thread fallback: the browser-hosted WASM runtime and the checksum-verified model. */
async function loadMainThreadProvider(options: DfineOnnxProviderOptions): Promise<DfineSegOnnxProvider> {
  const [runtime, modelBytes] = await Promise.all([loadRuntime(), loadModelBytes()]);
  return createDfineSegOnnxProvider(runtime, modelBytes, options);
}

/**
 * Load the local bottle detector. Prefers a dedicated worker (WebGPU when it
 * is available and verified, otherwise WASM) so the camera view never waits
 * for the model; falls back to the main thread if workers cannot start.
 */
export async function loadDfineSegOnnxProvider(
  options: DfineOnnxProviderOptions = {},
  runtimeOptions: { allowGpu?: boolean } = {},
): Promise<(DfineSegWorkerProvider | DfineSegOnnxProvider) & { backend?: string }> {
  const resolved = { bottleClassIds: [39], containerClassRules: UPRIGHT_CONTAINER_CLASS_RULES, minimumScore: 0.5, maskThreshold: 0.5, ...options };
  if (typeof Worker !== "undefined") {
    try {
      return await DfineSegWorkerProvider.create({
        ...resolved,
        modelUrl: DFINE_SEG_MODEL_URL,
        sha256: DFINE_SEG_MODEL_SHA256,
        // An explicit ?detector= / localStorage choice wins; otherwise a past
        // GPU crash keeps this device on WASM.
        backend: (() => {
          const preference = detectorBackendPreference();
          return preference === 'auto' && runtimeOptions.allowGpu === false ? 'wasm' : preference;
        })(),
      });
    } catch {
      // Older browsers without module workers: run on the main thread.
    }
  }
  return loadMainThreadProvider(resolved);
}
