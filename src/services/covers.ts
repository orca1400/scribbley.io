// src/services/covers.ts
import { supabase } from "../lib/supabase";
import { getSessionId } from "../lib/session";

/* ========================================================================== */
/* Types                                                                      */
/* ========================================================================== */

export type GenerateCoverParams = {
  /** Required when authenticated (server stores & enforces limits). Optional for anon (returns base64 only). */
  bookId?: string;
  bookTitle: string;
  description: string;
  genre?: string;
  subgenre?: string;
  /** Tells the edge function whether to store or just return base64. */
  isAuthenticated: boolean;
  /** Optional consent flags (harmless for cover gen; server may ignore). */
  aiConsent?: boolean;
  aiConsentVersion?: string;
};

export type GenerateCoverResponse = {
  // Anonymous flow:
  imageBase64?: string;

  // Authenticated flow (public bucket upload):
  url?: string;
  path?: string; // e.g. covers/<uid>/<bookId>/1.png
  attempt?: number; // 1 for initial cover
  error?: string;
};

export type RerollCoverResponse = {
  url?: string;
  path?: string;
  attempt?: number; // 2, 3, ...
  error?: string;
};

export type StreamEvent =
  | { type: "partial"; b64: string } // kept for API parity; not used by this non-stream flow
  | { type: "final"; url?: string; imageBase64?: string; path?: string; attempt?: number }
  | { type: "error"; message: string }
  | { type: "done" };

/* ========================================================================== */
/* URL helpers                                                                */
/* ========================================================================== */

function edgeUrl(fnName: string) {
  const override = import.meta.env.VITE_EDGE_BASE as string | undefined;
  if (override) return `${override.replace(/\/+$/, "")}/functions/v1/${fnName}`;
  if (import.meta.env.DEV) return `/functions/v1/${fnName}`;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) throw new Error("VITE_SUPABASE_URL is undefined");
  return `${base.replace(/\/+$/, "")}/functions/v1/${fnName}`;
}

export function toPublicCoverUrl(path: string) {
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!base) throw new Error("VITE_SUPABASE_URL is undefined");
  const cleanBase = base.replace(/\/+$/, "");
  const cleanPath = String(path || "").replace(/^\/+/, "");
  return `${cleanBase}/storage/v1/object/public/book-covers/${cleanPath}`;
}

/* ========================================================================== */
/* UI helpers                                                                 */
/* ========================================================================== */

export function dataUrlFromBase64(b64: string, mime = "image/png") {
  return `data:${mime};base64,${b64}`;
}

export function prettyCoverError(msg: string, plan?: string | null) {
  const m = String(msg || "");
  if (/NOT_AUTHENTICATED/i.test(m)) return "Please sign in to do that.";
  if (/REROLL_NOT_ALLOWED/i.test(m)) return "Rerolls are not available on your plan.";
  if (/REROLL_LIMIT_REACHED/i.test(m)) {
    return plan === "pro"
      ? "You have used your 1 reroll (Pro)."
      : "You have used your 2 rerolls (Premium).";
  }
  if (/COVER_LIMIT_REACHED/i.test(m)) {
    return plan === "free"
      ? "Cover limit reached for Free plan this month."
      : "Cover limit reached for your plan this month.";
  }
  if (/SERVER_MISCONFIGURED/i.test(m)) return "Server configuration is incomplete.";
  if (/IMAGE_GENERATION_FAILED|IMAGE_API_FAILED/i.test(m)) return "Image generation failed. Please try again.";
  if (/STORAGE_UPLOAD_FAILED/i.test(m)) return "Upload to storage failed.";
  if (/DB_INSERT_FAILED/i.test(m)) return "Failed to record the cover in the database.";
  if (/STREAM_FAILED/i.test(m)) return "Cover stream failed. Please try again.";
  return m || "Unknown cover error";
}

/* ========================================================================== */
/* Auth headers                                                               */
/* ========================================================================== */

async function authHeaders() {
  const { data: auth } = await supabase.auth.getSession();
  const bearer = auth?.session?.access_token ?? null;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  // Use user token if present, else fall back to anon key (for guests)
  const token = (bearer && bearer.trim()) || (anonKey && anonKey.trim());
  if (!token) {
    throw new Error("MISSING_AUTH: provide user access_token or VITE_SUPABASE_ANON_KEY");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (anonKey) headers.apikey = anonKey; // Supabase Functions gateway expects this
  return headers;
}

/* ========================================================================== */
/* Generate initial cover (single HTTP request; emits final/done)             */
/* ========================================================================== */

/**
 * Calls /generate-cover once (non-streaming) and emits final/done or error.
 * - Guests: server returns { imageBase64 } → we emit { type: 'final', imageBase64 }
 * - Authed + bookId: server stores to bucket and returns { url } or { path }
 */
export async function streamInitialCover(
  params: GenerateCoverParams,
  onEvent: (e: StreamEvent) => void,
  opts?: { signal?: AbortSignal }
): Promise<void> {
  const url = edgeUrl("generate-cover");
  const headers = await authHeaders();

  // Attribute usage/guest freebie by session id
  const sessionId = getSessionId();
  if (sessionId) headers["x-session-id"] = sessionId;

  // Optional: pass claimed user for server-side assertions (when authed)
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth?.session?.user?.id ?? null;
  if (params.isAuthenticated && userId) headers["x-user-id"] = userId;

  // Fire request
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        bookId: params.bookId,
        bookTitle: params.bookTitle,
        description: params.description,
        genre: params.genre,
        subgenre: params.subgenre,
        isAuthenticated: !!params.isAuthenticated,
        // Consent flags: harmless; server may ignore for cover gen
        aiConsent: !!params.aiConsent,
        aiConsentVersion: params.aiConsentVersion ?? null,
      }),
      signal: opts?.signal,
    });
  } catch (e: any) {
    onEvent({ type: "error", message: e?.message || "Network error calling generate-cover" });
    onEvent({ type: "done" });
    return;
  }

  let payload: any = null;
  try {
    const text = await res.text();
    payload = text ? JSON.parse(text) : {};
  } catch {
    // ignore parse errors; payload stays null
  }

  if (!res.ok) {
    const msg = (payload && (payload.error || payload.message)) || `HTTP ${res.status}`;
    onEvent({ type: "error", message: msg });
    onEvent({ type: "done" });
    return;
  }

  // Guest flow
  if (payload?.imageBase64) {
    onEvent({ type: "final", imageBase64: payload.imageBase64 });
    onEvent({ type: "done" });
    return;
  }

  // Authed flow
  if (payload?.url) {
    onEvent({ type: "final", url: payload.url, attempt: payload.attempt, path: payload.path });
    onEvent({ type: "done" });
    return;
  }
  if (payload?.path) {
    onEvent({ type: "final", url: toPublicCoverUrl(payload.path), attempt: payload.attempt, path: payload.path });
    onEvent({ type: "done" });
    return;
  }

  onEvent({ type: "error", message: "No image returned from server" });
  onEvent({ type: "done" });
}

/**
 * Backward-compatible wrapper for legacy imports.
 * Resolves once a "final" event arrives from `streamInitialCover`.
 */
export async function generateInitialCover(
  params: GenerateCoverParams,
  options?: { signal?: AbortSignal }
): Promise<GenerateCoverResponse> {
  return new Promise<GenerateCoverResponse>((resolve, reject) => {
    let settled = false;
    streamInitialCover(
      params,
      (evt) => {
        if (evt.type === "final") {
          settled = true;
          resolve({
            url: evt.url,
            path: (evt as any).path,
            attempt: (evt as any).attempt,
            imageBase64: (evt as any).imageBase64,
          });
        } else if (evt.type === "error") {
          settled = true;
          reject(new Error(evt.message));
        }
      },
      options
    ).catch((e) => {
      if (!settled) reject(e);
    });
  });
}

/* ========================================================================== */
/* Queries                                                                     */
/* ========================================================================== */

/**
 * Best-effort: construct public URL for attempt #1 by convention.
 * If you later track attempts in `book_covers`, swap this to a DB query.
 */
export async function fetchLatestCoverPublicUrl(bookId: string): Promise<string | null> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth?.session?.user?.id;
  if (!userId) return null;
  return toPublicCoverUrl(`covers/${userId}/${bookId}/1.png`);
}

/* ========================================================================== */
/* Reroll (tries /reroll-cover then falls back to /generate-cover)            */
/* ========================================================================== */

export async function rerollCover(
  bookId: string,
  options?: { signal?: AbortSignal }
): Promise<RerollCoverResponse> {
  const headers = await authHeaders();

  const sessionId = getSessionId();
  if (sessionId) headers["x-session-id"] = sessionId;

  const { data: auth } = await supabase.auth.getSession();
  const userId = auth?.session?.user?.id;
  if (!userId) throw new Error("NOT_AUTHENTICATED");
  headers["x-user-id"] = userId;

  const endpoints = [edgeUrl("reroll-cover"), edgeUrl("generate-cover")];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ bookId, isAuthenticated: true }),
        signal: options?.signal,
      });

      const text = await res.text();
      const payload = text ? JSON.parse(text) : {};

      if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`);

      if (payload?.url) return { url: payload.url, attempt: payload.attempt, path: payload.path };
      if (payload?.path) return { path: payload.path, attempt: payload.attempt };
    } catch {
      // try next endpoint
    }
  }

  throw new Error("REROLL_FAILED");
}
