import {
  createDfineSegOnnxProvider,
  type DfineOnnxProviderOptions,
  type DfineOrtRuntime,
  type DfineSegOnnxProvider,
} from "./dfineSegOnnxProvider";

export const DFINE_SEG_MODEL_URL = "/models/dfine_seg_n_coco.onnx";
export const DFINE_SEG_MODEL_SHA256 = "999b6ae8970461b9a2b4a50f6cf07df3f355b131698a3e5b56cd420fbea5de30";

let modelBytesPromise: Promise<ArrayBuffer> | null = null;
let runtimePromise: Promise<typeof import("onnxruntime-web/wasm")> | null = null;

export async function verifyDfineModelBytes(bytes: ArrayBuffer, expectedSha256 = DFINE_SEG_MODEL_SHA256): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error("D-FINE model checksum mismatch; refusing to initialize inference.");
  }
}

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
