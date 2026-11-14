// Harmony Discover DEV — discover-client-log v0.1.0 (14 Nov 2026).
// Diagnostics only: the scanner page reports page starts, found chips and errors so a
// problem seen on a real phone (e.g. a tab that reloads) can be traced. Nothing is stored
// in the database; each report is one function log line. No images, label text or user ids.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SITE_ORIGIN = /^https:\/\/([a-z0-9-]+--)?harmony-discover(-test)?\.netlify\.app$/;
const EVENTS = new Set(["page_start", "found_added", "client_error", "camera_start"]);
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

function headers(origin: string | null): Headers {
  const h = new Headers({ "content-type": "application/json", "cache-control": "no-store", vary: "Origin" });
  if (origin && SITE_ORIGIN.test(origin)) {
    h.set("access-control-allow-origin", origin);
    h.set("access-control-allow-headers", "authorization,apikey,content-type");
    h.set("access-control-allow-methods", "POST,OPTIONS");
  }
  return h;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !SITE_ORIGIN.test(origin)) return new Response('{"error":"origin_not_allowed"}', { status: 403, headers: headers(null) });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (req.method !== "POST") return new Response('{"error":"method_not_allowed"}', { status: 405, headers: headers(origin) });
  const raw = await req.text();
  if (raw.length > 4000) return new Response('{"error":"too_large"}', { status: 413, headers: headers(origin) });
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw); } catch { return new Response('{"error":"invalid_json"}', { status: 400, headers: headers(origin) }); }
  const evt = clean(body.evt, 40);
  if (!EVENTS.has(evt)) return new Response('{"error":"unknown_event"}', { status: 400, headers: headers(origin) });
  console.log(JSON.stringify({
    evt: "client_" + evt,
    page: clean(body.page, 40),
    starts: num(body.starts),
    uptime_s: num(body.uptime_s),
    chips: num(body.chips),
    conf: num(body.conf),
    msg: clean(body.msg, 300),
    stack: clean(body.stack, 600),
    ua: clean(req.headers.get("user-agent"), 160),
  }));
  return new Response('{"ok":true}', { status: 200, headers: headers(origin) });
});
