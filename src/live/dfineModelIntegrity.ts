export const DFINE_SEG_MODEL_URL = "/models/dfine_seg_n_coco.onnx";
export const DFINE_SEG_MODEL_SHA256 = "999b6ae8970461b9a2b4a50f6cf07df3f355b131698a3e5b56cd420fbea5de30";

export async function verifyDfineModelBytes(bytes: ArrayBuffer, expectedSha256 = DFINE_SEG_MODEL_SHA256): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error("D-FINE model checksum mismatch; refusing to initialize inference.");
  }
}
