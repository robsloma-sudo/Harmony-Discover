import { describe, expect, it } from "vitest";
import { verifyDfineModelBytes } from "../src/live/dfineSegRuntime";

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}

describe("D-FINE model runtime integrity", () => {
  it("accepts bytes with the expected SHA-256 checksum", async () => {
    const bytes = new TextEncoder().encode("verified model fixture");
    await expect(verifyDfineModelBytes(bytes.buffer, await sha256(bytes))).resolves.toBeUndefined();
  });

  it("rejects bytes whose checksum does not match the pinned model", async () => {
    const bytes = new TextEncoder().encode("tampered model fixture");
    await expect(verifyDfineModelBytes(bytes.buffer, "0".repeat(64))).rejects.toThrow(/checksum mismatch/i);
  });
});
