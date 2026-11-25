// Harmony Discover DEV: CORS front door for the test site (harmony-discover-test.netlify.app).
// It only forwards the request server-to-server to discover-live-read, which still does all
// auth (signed-in user JWT), rate limits, daily caps and the DEV-project guard. No data is stored here.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TEST_ORIGIN = /^https:\/\/([a-z0-9-]+--)?harmony-discover-test\.netlify\.app$/;
const MAX_BODY_BYTES = 450_000;

function cors(origin: string): Headers {
  return new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization,apikey,content-type",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-max-age": "600",
    vary: "Origin",
    "cache-control": "no-store",
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (!TEST_ORIGIN.test(origin)) {
    return new Response(JSON.stringify({ error: "origin_not_allowed" }), { status: 403, headers: { "content-type": "application/json" } });
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") {
    const h = cors(origin); h.set("content-type", "application/json");
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: h });
  }
  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    const h = cors(origin); h.set("content-type", "application/json");
    return new Response(JSON.stringify({ error: "payload_too_large" }), { status: 413, headers: h });
  }
  const forwardHeaders = new Headers({ "content-type": "application/json" });
  for (const name of ["authorization", "apikey"]) {
    const value = req.headers.get(name);
    if (value) forwardHeaders.set(name, value);
  }
  const upstream = await fetch((Deno.env.get("SUPABASE_URL") || "") + "/functions/v1/discover-live-read", {
    method: "POST",
    headers: forwardHeaders,
    body,
  });
  const h = cors(origin);
  h.set("content-type", upstream.headers.get("content-type") || "application/json");
  return new Response(await upstream.text(), { status: upstream.status, headers: h });
});
