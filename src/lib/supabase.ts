// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
// If you have generated types from Supabase, you can use them like this:
// import type { Database } from '../types/supabase'; // <- your generated types
// export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, { ... });

/** Centralized demo user constant (keep in sync across app) */
export const DEMO_USER_ID = '00000000-0000-0000-0000-000000000000';

function mustEnv(name: string): string {
  const v = (import.meta as any).env?.[name];
  if (!v || String(v).trim() === '') {
    const msg = `[supabase] Missing ${name}. Add it to your .env.local (Vite requires VITE_*).`;
    // In dev: show clear console error; in prod: throw to avoid "Failed to fetch" mysteries.
    if (import.meta.env?.DEV) console.error(msg);
    throw new Error(msg);
  }
  return String(v).trim();
}

const supabaseUrl = mustEnv('VITE_SUPABASE_URL');
const supabaseAnonKey = mustEnv('VITE_SUPABASE_ANON_KEY');

// Extra sanity: catch common copy/paste mistakes
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
  console.warn('[supabase] VITE_SUPABASE_URL does not look like a Supabase project URL:', supabaseUrl);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  // Explicit browser-friendly auth defaults
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce', // safer than 'implicit'
  },
  global: {
    // Helps PostgREST identify your app; useful for debugging/logs
    headers: { 'x-client-info': 'ai-bookgen-web' },
  },
  // db: { schema: 'public' }, // uncomment if you use a non-default schema
});

/* -------------------------- tiny helpers you’ll reuse -------------------------- */

/** Returns the current access token (or null if signed out). */
export async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Builds the Authorization header for calling your Supabase Edge Functions.
 * - If signed in: uses the user's JWT
 * - If signed out: uses the project's anon key (as Bearer), which Functions accept
 *
 * Usage:
 *   const headers = { ...(await authHeader()), 'Content-Type': 'application/json' };
 */
export async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  // Using anon key as Bearer for Functions is expected/valid for public calls
  const bearer = token ?? supabaseAnonKey;
  return { Authorization: `Bearer ${bearer}` };
}

/** Convenience: check if a user id is the demo user. */
export function isDemoUserId(id: string | null | undefined): boolean {
  return id === DEMO_USER_ID;
}

/** Convenience: safely read the current user id (or null). */
export async function getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

// Optional: quick visibility in dev (never logs actual secrets)
if (import.meta.env?.DEV) {
  console.log('[supabase] url:', supabaseUrl);
  console.log('[supabase] anon key present:', !!supabaseAnonKey);
}
