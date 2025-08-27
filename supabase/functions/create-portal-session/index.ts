import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@15.12.0?target=deno";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    const auth = req.headers.get("authorization") || "";
    const token = auth.replace("Bearer ", "");

    const anon = createClient(supabaseUrl, anonKey);
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user } } = await anon.auth.getUser(token);
    if (!user) return new Response("Unauthorized", { status: 401, headers: cors });

    const { data: profile } = await admin
      .from("user_profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return new Response("No Stripe customer", { status: 400, headers: cors });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${new URL(req.url).origin}/?billing=portal-return`,
    });

    return new Response(JSON.stringify({ url: portal.url }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(`Error: ${e.message}`, { status: 500, headers: cors });
  }
});