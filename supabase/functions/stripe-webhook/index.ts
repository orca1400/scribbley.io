import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@15.12.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const endpointSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const PLAN_MAP: Record<string, { plan_tier: 'free'|'pro'|'premium', interval: 'month'|'year', monthly_word_limit: number, projects_limit: number, rewrites_unlimited: boolean }> = {
  [Deno.env.get("STRIPE_PRICE_PRO_MONTH")!]:     { plan_tier:'pro',     interval:'month', monthly_word_limit: 500000,  projects_limit: 10, rewrites_unlimited: true },
  [Deno.env.get("STRIPE_PRICE_PRO_YEAR")!]:      { plan_tier:'pro',     interval:'year',  monthly_word_limit: 500000,  projects_limit: 10, rewrites_unlimited: true },
  [Deno.env.get("STRIPE_PRICE_PREMIUM_MONTH")!]: { plan_tier:'premium', interval:'month', monthly_word_limit: 2000000, projects_limit: 20, rewrites_unlimited: true },
  [Deno.env.get("STRIPE_PRICE_PREMIUM_YEAR")!]:  { plan_tier:'premium', interval:'year',  monthly_word_limit: 2000000, projects_limit: 20, rewrites_unlimited: true },
};

serve(async (req) => {
  const sig = req.headers.get("stripe-signature")!;
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, endpointSecret);
  } catch (err) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const handleSub = async (sub: Stripe.Subscription) => {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const priceId = (sub.items.data[0].price?.id) ?? "";
    const map = PLAN_MAP[priceId];

    // user lookup by stripe_customer_id
    const { data: userRow } = await admin
      .from("user_profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (!userRow) return;

    // status & fields
    const status = sub.status; // trialing, active, past_due, canceled, unpaid, incomplete, paused (Stripe Pause)
    const current_period_end = new Date(sub.current_period_end * 1000).toISOString();
    const cancel_at_period_end = sub.cancel_at_period_end === true;
    const paused = (sub.pause_collection != null);

    // free fallback on cancel
    let updatePatch: Record<string, unknown> = {
      subscription_status: status,
      cancel_at_period_end,
      current_period_end,
      paused,
      subscription_interval: map?.interval ?? null,
    };

    if (map) {
      updatePatch = {
        ...updatePatch,
        plan_tier: map.plan_tier,
        monthly_word_limit: map.monthly_word_limit,
        projects_limit: map.projects_limit,
        rewrites_unlimited: map.rewrites_unlimited,
        billing_provider: 'stripe',
        billing_period_start: new Date(sub.current_period_start * 1000).toISOString().slice(0,10),
      };
    }

    // wenn canceled/incomplete -> auf free zurück
    if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
      updatePatch = {
        ...updatePatch,
        plan_tier: "free",
        monthly_word_limit: 20000,
        projects_limit: 3,
        rewrites_unlimited: false,
      };
    }

    await admin.from("user_profiles").update(updatePatch).eq("id", userRow.id);
  };

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        await handleSub(sub);
      }
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.created":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSub(sub);
      break;
    }
    default:
      // optional: log
      break;
  }

  return new Response("ok");
});