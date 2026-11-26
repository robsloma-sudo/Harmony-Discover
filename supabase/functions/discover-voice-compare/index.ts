// The hidden Marty listening test is gone (P-20261126-0102, Rob 26 Nov: "delete the voice listening tests").
// Marty's ElevenLabs voice now lives in discover-voice-session. This stub answers every request with 410 "gone",
// reads no secrets, checks no sign-in, touches no database and calls no paid provider.
// CORS headers are kept for the Discover website so an old app copy gets a readable answer instead of a network error.

function siteOrigin(origin: string): boolean {
  const prefix = "https://";
  const suffix = "harmony-discover.netlify.app";
  if (!origin.startsWith(prefix) || !origin.endsWith(suffix)) return false;
  const label = origin.slice(prefix.length, origin.length - suffix.length);
  if (label === "") return true;
  if (!label.endsWith("--") || label.length < 3) return false;
  return label.slice(0, -2).split("").every((c) => (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c === "-");
}

export const GONE_BODY = { error: "The listening test has been removed.", code: "gone" } as const;

export function goneResponse(request: Request): Response {
  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private",
    "Vary": "Origin",
  });
  if (origin && siteOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  return new Response(JSON.stringify(GONE_BODY), { status: 410, headers });
}

Deno.serve(goneResponse);
