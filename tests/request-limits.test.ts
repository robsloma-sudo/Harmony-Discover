import { describe, expect, it } from "vitest";
import { readUtf8RequestBodyWithinLimit } from "../supabase/functions/_shared/requestLimits";

const post = (body: string) => new Request("https://discover.test/frame", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});

describe("streamed request body byte limits", () => {
  it("accepts payloads at or below the UTF-8 byte limit", async () => {
    const result = await readUtf8RequestBodyWithinLimit(post('{"ok":true}'), 11);
    expect(result).toEqual({ body: '{"ok":true}', tooLarge: false });
  });

  it("rejects multi-byte UTF-8 content by byte size, not JS string length", async () => {
    const body = '{"label":"é"}';
    expect(body.length).toBeLessThan(new TextEncoder().encode(body).byteLength);
    const result = await readUtf8RequestBodyWithinLimit(post(body), body.length);
    expect(result).toEqual({ body: "", tooLarge: true });
  });

  it("stops reading once the streamed byte budget is exceeded", async () => {
    const result = await readUtf8RequestBodyWithinLimit(post("x".repeat(100_000)), 100);
    expect(result.tooLarge).toBe(true);
    expect(result.body).toBe("");
  });

  it("fails closed for invalid limits", async () => {
    expect(await readUtf8RequestBodyWithinLimit(post("x"), -1)).toEqual({ body: "", tooLarge: true });
    expect(await readUtf8RequestBodyWithinLimit(post("x"), Number.NaN)).toEqual({ body: "", tooLarge: true });
  });
});
