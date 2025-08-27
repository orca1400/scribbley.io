import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Tier = 'free' | 'pro' | 'premium';

type Entitlements = {
  tier: Tier;
  subscription_status?: string | null;
  subscription_interval?: 'month' | 'year' | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
};

export function useEntitlements(userId?: string) {
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    const ac = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        // Not logged in → treat as free and stop.
        if (!token) {
          if (!ignore) {
            setEntitlements({ tier: 'free' });
            setLoading(false);
          }
          return;
        }

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-entitlements`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,                       // user JWT
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string, // important for Supabase proxy
            'x-client-info': 'web',
          },
          body: '{}',
          signal: ac.signal,
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          throw new Error(txt || `HTTP ${res.status}`);
        }

        const json = await res.json() as Entitlements;
        if (ignore) return;
        setEntitlements(json);
        setLoading(false);
      } catch (e: any) {
        // React StrictMode unmounts & re-mounts effects in dev → ignore AbortError
        if (e?.name === 'AbortError') return;
        if (ignore) return;
        setError(e?.message || String(e));
        setEntitlements({ tier: 'free' }); // safe fallback
        setLoading(false);
      }
    })();

    return () => {
      ignore = true;
      ac.abort();
    };
  }, [userId]);

  return { entitlements, loading, error };
}
