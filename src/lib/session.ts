// src/lib/session.ts
import { supabase } from './supabase';

export interface Session {
  id: string;
  user_id: string | null;
  is_guest: boolean;
  has_consumed_guest_freebie: boolean;
  created_at: string; // for guests we fake this locally
}

/** Storage keys / cookie names */
const SESSION_ID_KEY = 'session_id';
const GUEST_FREEBIE_PREFIX = 'guest_freebie_';

/** Safe UUID generator */
function safeUuid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {}
  // Fallback
  return 'xxxxxxxxyxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Read session id from localStorage first; fall back to cookie */
export function getSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fromLS = window.localStorage.getItem(SESSION_ID_KEY);
    if (fromLS) return fromLS;
  } catch {}
  return getSessionCookie();
}

/** Persist session id primarily to localStorage, and mirror to cookie */
function setSessionId(id: string) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SESSION_ID_KEY, id);
    } catch {}
  }
  setSessionCookie(id);
}

/** Get session ID from cookie */
function getSessionCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const raw = document.cookie;
  if (!raw) return null;
  const parts = raw.split(';').map((c) => c.trim());
  for (const p of parts) {
    if (p.startsWith(`${SESSION_ID_KEY}=`)) {
      try {
        return decodeURIComponent(p.split('=').slice(1).join('='));
      } catch {
        return p.split('=').slice(1).join('=');
      }
    }
  }
  return null;
}

/** Set session ID cookie with 1 year expiry (Lax; Secure when HTTPS) */
function setSessionCookie(sessionId: string): void {
  if (typeof document === 'undefined') return;
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  const secure = (typeof location !== 'undefined' && location.protocol === 'https:') ? '; Secure' : '';
  const value = encodeURIComponent(sessionId);
  document.cookie = `${SESSION_ID_KEY}=${value}; expires=${expiryDate.toUTCString()}; path=/; SameSite=Lax${secure}`;
}

/** Clear session id everywhere (for logout) */
export function clearSessionCookie(): void {
  if (typeof document !== 'undefined') {
    const secure = (typeof location !== 'undefined' && location.protocol === 'https:') ? '; Secure' : '';
    document.cookie = `${SESSION_ID_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax${secure}`;
  }
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(SESSION_ID_KEY); } catch {}
  }
}

/** Local-only tracking for guest freebie */
function getGuestFreebieLocal(sessionId: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(`${GUEST_FREEBIE_PREFIX}${sessionId}`) === '1';
}
function setGuestFreebieLocal(sessionId: string, consumed: boolean): void {
  if (typeof localStorage === 'undefined') return;
  const key = `${GUEST_FREEBIE_PREFIX}${sessionId}`;
  if (consumed) localStorage.setItem(key, '1');
  else localStorage.removeItem(key);
}

/**
 * Get or create a session for the current user/guest.
 * - AUTHENTICATED: read/create in DB (passes RLS because user_id = auth.uid()).
 * - GUEST: no DB I/O from the browser; we track a stable id in localStorage (mirrored to cookie).
 *          Edge Functions (service role) can upsert the session server-side using the same ID.
 */
export async function getOrCreateSession(): Promise<Session> {
  // 1) Are we authenticated?
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // AUTHENTICATED FLOW: read most recent non-guest session
    const { data: existingSession, error: fetchError } = await supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_guest', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching user session:', fetchError);
    }

    if (existingSession) {
      // keep client-side id in sync for headers
      setSessionId(existingSession.id);
      return existingSession as Session;
    }

    // Create a new authenticated session in DB (RLS passes because user_id = auth.uid())
    const newId = safeUuid();
    const { data: newSession, error: createError } = await supabase
      .from('sessions')
      .insert({
        id: newId,
        user_id: user.id,
        is_guest: false,
        has_consumed_guest_freebie: false,
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating user session:', createError);
      // As a last resort, return a local object so the app can continue
      const fallback = {
        id: newId,
        user_id: user.id,
        is_guest: false,
        has_consumed_guest_freebie: false,
        created_at: new Date().toISOString(),
      };
      setSessionId(fallback.id);
      return fallback;
    }

    // Auth session created successfully; sync local store/cookie for consistent headers
    setSessionId(newSession.id);
    return newSession as Session;
  }

  // 2) GUEST FLOW: local-only session; NO DB writes/reads here.
  let id = getSessionId();
  if (!id) {
    id = safeUuid();
    setSessionId(id);
  }

  // Track guest freebie locally to avoid DB writes
  const consumed = getGuestFreebieLocal(id);

  return {
    id,
    user_id: null,
    is_guest: true,
    has_consumed_guest_freebie: consumed,
    created_at: new Date().toISOString(),
  };
}

/**
 * Mark that a guest freebie was consumed.
 * - AUTHENTICATED: write to DB (allowed by RLS).
 * - GUEST: store locally; Edge Function can persist server-side later.
 */
export async function markGuestFreebieConsumed(sessionId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Guest: store locally and return
    setGuestFreebieLocal(sessionId, true);
    return;
  }

  // Authenticated: safe to update DB (RLS: auth.uid() = user_id)
  const { error } = await supabase
    .from('sessions')
    .update({ has_consumed_guest_freebie: true })
    .eq('id', sessionId)
    .eq('user_id', user.id); // ensure we only update our own row

  if (error) {
    console.error('Error marking guest freebie as consumed:', error);
    // As a fallback, also store locally
    setGuestFreebieLocal(sessionId, true);
  }
}
