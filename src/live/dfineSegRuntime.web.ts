import {
  createDfineSegOnnxProvider,
  type DfineOnnxProviderOptions,
  type DfineOrtRuntime,
  type DfineSegOnnxProvider,
} from "./dfineSegOnnxProvider";
import { DFINE_SEG_MODEL_URL, verifyDfineModelBytes } from "./dfineModelIntegrity";

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

/** Load the browser-hosted WASM runtime and checksum-verify the bundled model. */
export async function loadDfineSegOnnxProvider(
  options: DfineOnnxProviderOptions = {},
): Promise<DfineSegOnnxProvider> {
  const [runtime, modelBytes] = await Promise.all([loadRuntime(), loadModelBytes()]);
  return createDfineSegOnnxProvider(
    runtime,
    modelBytes,
    { bottleClassIds: [39], minimumScore: 0.5, maskThreshold: 0.5, ...options },
  );
}
