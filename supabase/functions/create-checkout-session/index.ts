// deno.json schon vorhanden; runtime: Deno
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
    const { priceId, interval } = await req.json(); // interval: 'month'|'year'
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

    // Hole stripe_customer_id oder erstelle Customer
    const { data: profile } = await admin
      .from("user_profiles")
      .select("id, stripe_customer_id")
      .eq("id", user.id)
      .single();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await admin.from("user_profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
    }

    // Checkout-Session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_types: ["card", "sepa_debit", "paypal"],
      allow_promotion_codes: false,
      subscription_data: {
        trial_period_days: undefined,
        proration_behavior: "always_invoice", // Upgrade sofort, differenz wird verrechnet
      },
      success_url: `${new URL(req.url).origin}/?billing=success`,
      cancel_url: `${new URL(req.url).origin}/?billing=cancel`,
    });

    return new Response(JSON.stringify({ url: session.url }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(`Error: ${e.message}`, { status: 500, headers: cors });
  }
});