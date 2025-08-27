// src/lib/billing.ts
import { supabase } from './supabase';

type Cadence = 'month' | 'year';
type Tier = 'pro' | 'premium';

type CheckoutArgs =
  | { priceId: string; interval?: Cadence; successUrl?: string; cancelUrl?: string }
  | { plan: Tier; interval: Cadence; successUrl?: string; cancelUrl?: string };

function edgeBase() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) throw new Error('VITE_SUPABASE_URL is missing');
  return `${url.replace(/\/+$/, '')}/functions/v1`;
}

async function getAuthOrThrow() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const uid = data?.session?.user?.id;
  if (!token || !uid) throw new Error('Not authenticated');
  return { token, uid };
}

/** Start Stripe Checkout.
 *  Unterstützt entweder { priceId } ODER { plan, interval }.
 */
export async function startCheckout(args: CheckoutArgs) {
  const { token, uid } = await getAuthOrThrow();
  const payload =
    'priceId' in args
      ? {
          priceId: args.priceId,
          interval: args.interval ?? 'month',
          success_url: args.successUrl ?? `${location.origin}?checkout=success`,
          cancel_url: args.cancelUrl ?? `${location.origin}?checkout=cancel`,
        }
      : {
          plan: args.plan,
          interval: args.interval,
          success_url: args.successUrl ?? `${location.origin}?checkout=success`,
          cancel_url: args.cancelUrl ?? `${location.origin}?checkout=cancel`,
        };

  const res = await fetch(`${edgeBase()}/create-checkout-session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-user-id': uid,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Checkout start failed (${res.status})`);
  }

  const { url } = await res.json();
  if (!url) throw new Error('Missing Checkout URL from server');
  window.location.assign(url);
}

export async function openBillingPortal(returnUrl?: string) {
  const { token, uid } = await getAuthOrThrow();

  const res = await fetch(`${edgeBase()}/create-portal-session`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-user-id': uid,
    },
    body: JSON.stringify({
      return_url: returnUrl ?? `${location.origin}/`,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(txt || `Portal start failed (${res.status})`);
  }

  const { url } = await res.json();
  if (!url) throw new Error('Missing Portal URL from server');
  window.location.assign(url);
}
