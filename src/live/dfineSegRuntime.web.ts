import {
  createDfineSegOnnxProvider,
  type DfineOnnxProviderOptions,
  type DfineOrtRuntime,
  type DfineSegOnnxProvider,
} from "./dfineSegOnnxProvider";
import { DFINE_SEG_MODEL_URL, verifyDfineModelBytes } from "./dfineModelIntegrity";

export { DFINE_SEG_MODEL_URL, DFINE_SEG_MODEL_SHA256, verifyDfineModelBytes } from "./dfineModelIntegrity";

let modelBytesPromise: Promise<ArrayBuffer> | null = null;
let runtimePromise: Promise<typeof import("onnxruntime-web/wasm")> | null = null;

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

async function loadRuntime(): Promise<typeof import("onnxruntime-web/wasm")> {
  if (!runtimePromise) {
    runtimePromise = import("onnxruntime-web/wasm").catch(error => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

/** Load and checksum-verify the bundled model before creating a WASM-only session. */
export async function loadDfineSegOnnxProvider(
  options: DfineOnnxProviderOptions = {},
): Promise<DfineSegOnnxProvider> {
  const [runtime, modelBytes] = await Promise.all([loadRuntime(), loadModelBytes()]);
  return createDfineSegOnnxProvider(
    runtime as unknown as DfineOrtRuntime,
    modelBytes,
    { bottleClassIds: [39], minimumScore: 0.5, maskThreshold: 0.5, ...options },
  );
}
