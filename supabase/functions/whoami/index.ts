// supabase/functions/whoami/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type, x-session-id, x-user-id, x-ai-consent, x-ai-consent-version",
  "Access-Control-Expose-Headers": "x-session-id",
  Vary: "Origin",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: CORS });
  }

  const headers: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) headers[k] = v;

  const bodyText = await req.text().catch(() => "");
  const payload = {
    ok: true,
    method: req.method,
    url: new URL(req.url).pathname,
    headers,
    body: bodyText ? (() => { try { return JSON.parse(bodyText); } catch { return bodyText; } })() : null,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});