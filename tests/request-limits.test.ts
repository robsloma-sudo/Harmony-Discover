import { describe, expect, it } from "vitest";
import { isRequestBodyWithinLimit } from "../supabase/functions/_shared/requestLimits";

describe("request body byte limits", () => {
  it("accepts payloads at or below the byte limit", () => {
    expect(isRequestBodyWithinLimit("abcd", 4)).toBe(true);
    expect(isRequestBodyWithinLimit("abc", 4)).toBe(true);
  });

  it("rejects UTF-8 payloads whose byte size exceeds the limit", () => {
    // JavaScript string length is one UTF-16 code unit here, but UTF-8 uses two bytes.
    expect("é".length).toBe(1);
    expect(isRequestBodyWithinLimit("é", 1)).toBe(false);
    expect(isRequestBodyWithinLimit("é", 2)).toBe(true);
  });

  it("fails closed for invalid limits", () => {
    expect(isRequestBodyWithinLimit("x", -1)).toBe(false);
    expect(isRequestBodyWithinLimit("x", Number.NaN)).toBe(false);
  });
});
