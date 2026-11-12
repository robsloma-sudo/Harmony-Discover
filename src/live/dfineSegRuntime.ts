import type { DfineOnnxProviderOptions, DfineSegOnnxProvider } from "./dfineSegOnnxProvider";

export { DFINE_SEG_MODEL_URL, DFINE_SEG_MODEL_SHA256, verifyDfineModelBytes } from "./dfineModelIntegrity";

/**
 * Native platforms intentionally do not load the browser ONNX Runtime.
 * Discover's current live segmentation engine is web-first; native inference
 * will use a dedicated React Native provider in a later phase.
 */
export async function loadDfineSegOnnxProvider(
  _options: DfineOnnxProviderOptions = {},
): Promise<DfineSegOnnxProvider> {
  throw new Error("D-FINE browser WASM inference is only available on web.");
}
