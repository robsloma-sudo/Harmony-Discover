import {
  createDfineSegOnnxProvider,
  type DfineOnnxProviderOptions,
  type DfineOrtRuntime,
  type DfineSegOnnxProvider,
} from "./dfineSegOnnxProvider";
import { DFINE_SEG_MODEL_SHA256, DFINE_SEG_MODEL_URL, verifyDfineModelBytes } from "./dfineModelIntegrity";

declare global {
  interface Window {
    __discoverOrtRuntime?: DfineOrtRuntime;
  }
}

const LOADER_URL = "/ort/ort-loader.js";

let runtimeLoad: Promise<DfineOrtRuntime> | null = null;
let modelLoad: Promise<Uint8Array> | null = null;

function loadRuntime(): Promise<DfineOrtRuntime> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("D-FINE browser inference requires a browser environment."));
  }
  if (window.__discoverOrtRuntime) return Promise.resolve(window.__discoverOrtRuntime);
  if (runtimeLoad) return runtimeLoad;

  runtimeLoad = new Promise<DfineOrtRuntime>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-discover-ort="true"]');
    const script = existing ?? document.createElement("script");
    const cleanup = () => {
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      if (window.__discoverOrtRuntime) resolve(window.__discoverOrtRuntime);
      else reject(new Error("ONNX Runtime loader completed without exposing its runtime."));
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not load the ONNX Runtime Web assets."));
    };
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = LOADER_URL;
      script.type = "module";
      script.async = true;
      script.dataset.discoverOrt = "true";
      document.head.appendChild(script);
    } else if (window.__discoverOrtRuntime) {
      cleanup();
      resolve(window.__discoverOrtRuntime);
    }
  }).catch(error => {
    runtimeLoad = null;
    throw error;
  });
  return runtimeLoad;
}

async function loadVerifiedModel(): Promise<Uint8Array> {
  if (modelLoad) return modelLoad;
  modelLoad = (async () => {
    const response = await fetch(DFINE_SEG_MODEL_URL, { cache: "force-cache" });
    if (!response.ok) throw new Error(`D-FINE model request failed (${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error("D-FINE model file is empty.");
    if (!globalThis.crypto?.subtle) throw new Error("Secure SHA-256 verification is unavailable in this browser.");
    await verifyDfineModelBytes(bytes.buffer as ArrayBuffer, DFINE_SEG_MODEL_SHA256);
    return bytes;
  })().catch(error => {
    modelLoad = null;
    throw error;
  });
  return modelLoad;
}

/** Load the pinned, checksum-verified D-FINE model using the app's same-origin WASM assets. */
export async function loadDfineSegOnnxProvider(
  options: DfineOnnxProviderOptions = {},
): Promise<DfineSegOnnxProvider> {
  const [runtime, model] = await Promise.all([loadRuntime(), loadVerifiedModel()]);
  return createDfineSegOnnxProvider(runtime, model, options);
}
