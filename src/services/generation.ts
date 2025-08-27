// src/services/generation.ts
import { CONSENT_VERSION } from '../config/plans';

/* =========================
   Core fetch helper
   ========================= */

type AuthMode = 'anonIfMissing' | 'userOnly' | 'omit';

export async function callEdge<T = any>({
  url,
  bearer,
  payload,
  extraHeaders,
  signal,
  authMode = 'anonIfMissing',
}: {
  url: string;
  bearer: string | null;                 // user JWT if authed; null for guests
  payload: any;
  extraHeaders?: Record<string, string>;
  signal?: AbortSignal;
  /** 
   * 'anonIfMissing' (default): Bearer <user JWT> if provided, else Bearer <anon key>.
   * 'userOnly': Bearer <user JWT> (throws if missing).
   * 'omit': no Authorization header at all (use for guest calls that shouldn't send anon key).
   */
  authMode?: AuthMode;
}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(extraHeaders ?? {}),
  };

  if (authMode === 'userOnly') {
    if (!bearer) throw new Error('Missing user token for userOnly call');
    headers.Authorization = `Bearer ${bearer}`;
  } else if (authMode === 'anonIfMissing') {
    headers.Authorization = `Bearer ${bearer ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`;
  } else if (authMode === 'omit') {
    // do not attach Authorization at all
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `HTTP ${res.status}`);
  }
  return res.json();
}

/* =========================
   Retry helper
   ========================= */

export function withRetry<T>(fn: () => Promise<T>, tries = 3, delay = 800): Promise<T> {
  return fn().catch(async (e) => {
    if (tries <= 1) throw e;
    await new Promise((r) => setTimeout(r, delay));
    return withRetry(fn, tries - 1, Math.floor(delay * 1.5));
  });
}

/* =========================
   Consent + session helpers
   ========================= */

export const consentHeadersAnon = (consentGiven: boolean) => ({
  'x-ai-consent': consentGiven ? 'true' : 'false',
  'x-ai-consent-version': CONSENT_VERSION,
});

export function getSessionId(): string {
  try {
    let id = localStorage.getItem('session_id');
    if (!id) {
      if (typeof crypto !== 'undefined') {
        if (typeof crypto.randomUUID === 'function') {
          id = crypto.randomUUID();
        } else if (typeof crypto.getRandomValues === 'function') {
          // fallback: generate UUID v4 using getRandomValues
          const buf = new Uint8Array(16);
          crypto.getRandomValues(buf);
          // https://stackoverflow.com/a/2117523/772859
          id = ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ buf[Math.floor(Math.random() * buf.length)] & 15 >> c / 4).toString(16)
          );
        } else {
          throw new Error('No suitable crypto random function');
        }
      } else {
        throw new Error('Secure randomness unavailable');
      }
      localStorage.setItem('session_id', id);
    }
    return id;
  } catch {
    // If secure randomness is unavailable, fail hard rather than use Math.random
    throw new Error('Unable to generate secure session id');
  }
}

/* =========================
   Cover URL resolver
   ========================= */

export function resolveCoverUrlFromResponse(resp: any): string | undefined {
  if (!resp) return undefined;
  if (resp.url) return String(resp.url);
  if (resp.path) {
    return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/book-covers/${resp.path}`;
  }
  if (resp.imageBase64) return `data:image/png;base64,${resp.imageBase64}`;
  return undefined;
}

/* =========================
   High-level API wrappers
   ========================= */

export type GenerateBookGuestArgs = {
  genre: string;
  subgenre: string;
  description: string;     // already composed (base + optional beats)
  beatsActive?: boolean;
  beats?: string[];
  sessionId: string;
  signal?: AbortSignal;
};

/** Guest: generate the full 5-chapter book (no Authorization header) */
export function generateBookGuest(args: GenerateBookGuestArgs) {
  return callEdge<{
    book?: string; content?: string; meta?: any;
  }>({
    url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-book`,
    bearer: null,
    payload: {
      genre: args.genre,
      subgenre: args.subgenre,
      description: args.description,
      beatsActive: args.beatsActive,
      beats: args.beats,
    },
    extraHeaders: {
      ...consentHeadersAnon(true),
      'x-session-id': args.sessionId,
    },
    signal: args.signal,
    authMode: 'omit', // <-- IMPORTANT: do not send anon key as Bearer for guests
  });
}

export type GenerateCoverGuestArgs = {
  description: string;     // same composed description
  genre: string;
  subgenre: string;
  sessionId: string;
  signal?: AbortSignal;
};

/** Guest: first cover (no Authorization header, no bookId) */
export function generateCoverGuest(args: GenerateCoverGuestArgs) {
  return callEdge<any>({
    url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-cover`,
    bearer: null,
    payload: {
      bookId: null,
      bookTitle: '',         // title unknown at prompt time; fine for first pass
      description: args.description,
      genre: args.genre,
      subgenre: args.subgenre,
      isAuthenticated: false,
    },
    extraHeaders: {
      ...consentHeadersAnon(true),
      'x-session-id': args.sessionId,
    },
    signal: args.signal,
    authMode: 'omit', // <-- IMPORTANT for guest cover
  });
}

export type GenerateCoverAuthedArgs = {
  bookId: string;
  userId: string;
  bearer: string;          // user JWT
  bookTitle: string;
  description: string;
  genre?: string;
  subgenre?: string;
  signal?: AbortSignal;
};

/** Authed users: explicit cover generation (called by your "Generate Cover" button in the editor) */
export function generateCoverAuthed(args: GenerateCoverAuthedArgs) {
  return callEdge<any>({
    url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-cover`,
    bearer: args.bearer,
    payload: {
      bookId: args.bookId,
      bookTitle: args.bookTitle,
      description: args.description,
      genre: args.genre,
      subgenre: args.subgenre,
      isAuthenticated: true,
    },
    extraHeaders: {
      'x-user-id': args.userId,
    },
    signal: args.signal,
    authMode: 'userOnly', // require a real user token
  });
}
