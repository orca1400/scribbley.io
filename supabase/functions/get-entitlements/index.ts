// supabase/functions/get-entitlements/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Expose-Headers": "x-session-id",
  Vary: "Origin",
};

type Tier = "free" | "pro" | "premium";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "SERVER_MISCONFIGURED" }), { status: 500, headers: CORS });
  }

  const supa = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), { status: 401, headers: CORS });
    }
    const token = authHeader.slice("Bearer ".length);

    // validate token -> user id
    const { data: gu, error: guErr } = await supa.auth.getUser(token);
    if (guErr || !gu?.user?.id) {
      return new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), { status: 401, headers: CORS });
    }
    const uid = gu.user.id;

    // ✅ your table name is public.user_profiles
    const { data: profile, error: pErr } = await supa
      .from("user_profiles")
      .select("*")
      .eq("id", uid)
      .maybeSingle();

    if (pErr) console.error("user_profiles select failed:", pErr);

    // Optional: pull the latest subscription row to enrich status/interval
    const { data: subRow, error: sErr } = await supa
      .from("user_subscriptions")
      .select("status, interval, current_period_end, cancel_at_period_end")
      .eq("user_id", uid)
      .order("current_period_end", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sErr) console.error("user_subscriptions select failed:", sErr);

    const tier: Tier = (profile?.plan_tier ?? "free") as Tier;

    // prefer user_subscriptions values if present; fall back to user_profiles columns if you mirror them there
    const subscription_status   = subRow?.status ?? (profile as any)?.subscription_status ?? null;
    const subscription_interval = subRow?.interval ?? (profile as any)?.subscription_interval ?? null;
    const current_period_end    = subRow?.current_period_end ?? (profile as any)?.current_period_end ?? null;
    const cancel_at_period_end  = subRow?.cancel_at_period_end ?? (profile as any)?.cancel_at_period_end ?? null;

    return new Response(
      JSON.stringify({ tier, subscription_status, subscription_interval, current_period_end, cancel_at_period_end }),
      { headers: CORS },
    );
  } catch (err) {
    console.error("get-entitlements fatal:", err);
    // return a safe fallback so the UI keeps working
    return new Response(JSON.stringify({
      tier: "free",
      subscription_status: null,
      subscription_interval: null,
      current_period_end: null,
      cancel_at_period_end: null,
    }), { status: 200, headers: CORS });
  }
});
