// supabase/functions/generate-cover/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai";

/** Allow only your domains in production */
const ALLOWED_ORIGINS = new Set<string>([
  "https://yourapp.com",
  "https://www.yourapp.com",
  "http://localhost:3000",
]);

const baseCors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, x-client-info, content-type, x-session-id, x-user-id, x-turnstile-token, x-ai-consent, x-ai-consent-version",
  "Access-Control-Expose-Headers": "x-session-id",
  Vary: "Origin",
} as const;

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") ?? "";
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : "";
  return { ...baseCors, ...(allow ? { "Access-Control-Allow-Origin": allow } : {}), Vary: "Origin" };
}

function jsonResponse(
  body: unknown,
  init: ResponseInit & { cors?: HeadersInit; sessionId?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", ...(init.cors ?? {}) });
  if (init.sessionId) headers.set("x-session-id", init.sessionId);
  return new Response(JSON.stringify(body), { ...init, headers });
}

// ---------- plan & limits ----------
type PlanTier = "free" | "pro" | "premium";
const PLAN_LIMITS = {
  free: { coversPerMonth: 5, rerollsPerCover: 0 },
  pro: { coversPerMonth: 10, rerollsPerCover: 1 },
  premium: { coversPerMonth: 20, rerollsPerCover: 2 },
} as const;

// Guests
const GUEST_PER_MINUTE_PER_IP = 5; // simple burst guard

type Body = {
  bookId?: string;
  userId?: string; // informational only
  bookTitle: string;
  description: string;
  genre?: string;
  subgenre?: string;
  isAuthenticated: boolean;
  // Optional Turnstile token for guests (if TURNSTILE_SECRET is set)
  turnstileToken?: string;
  // Optional future flags
  reroll?: boolean; // if true, treat as reroll for this bookId (attempt > 1)
};

const monthStartUTC = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
};
const minuteBucketUTC = () => {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d.toISOString();
};

const buildPrompt = (title: string, desc: string, genre?: string, subgenre?: string) => {
  const base =
    "High-quality book cover artwork, no text/typography, no logos, no borders, no watermarks. " +
    "Single strong focal composition, cinematic lighting, professional illustration.";
  const hint = genre ? ` Genre: ${genre}.` : "";
  const sub = subgenre ? ` Subgenre: ${subgenre}.` : "";
  const theme = ` Theme cues: ${String(desc || "").slice(0, 400)}`;
  const titleHint = ` Title hint: "${title}". (Do not render text.)`;
  return `${base}${hint}${sub}${theme}${titleHint}`;
};

// Parse truthy consent header: "true", "1", "yes"
const parseConsentHeader = (req: Request) => {
  const raw = (req.headers.get("x-ai-consent") ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
};

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET"); // optional

  if (!supabaseUrl || !supabaseKey || !openaiKey) {
    return jsonResponse({ error: "SERVER_MISCONFIGURED" }, { status: 500, cors: CORS });
  }

  const admin = createClient(supabaseUrl, supabaseKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  // Require a session id (guest or authed)
  const sessionId = req.headers.get("x-session-id") ?? "";
  if (sessionId.length < 8) {
    return jsonResponse({ error: "MISSING_SESSION_ID" }, { status: 400, cors: CORS });
  }

  // Best-effort IP (for burst limit)
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  // Parse JSON body
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "INVALID_JSON" }, { status: 400, cors: CORS, sessionId });
  }

  const { bookId, bookTitle, description, genre, subgenre, isAuthenticated, turnstileToken, reroll } = body;

  if (!bookTitle?.trim()) {
    return jsonResponse({ error: "MISSING_BOOK_TITLE" }, { status: 400, cors: CORS, sessionId });
  }
  if (typeof isAuthenticated !== "boolean") {
    return jsonResponse({ error: "MISSING_IS_AUTHENTICATED" }, { status: 400, cors: CORS, sessionId });
  }

  // Optional: Turnstile human check for guests
  if (!isAuthenticated && turnstileSecret) {
    if (!turnstileToken) {
      return jsonResponse({ error: "MISSING_TURNSTILE_TOKEN" }, { status: 400, cors: CORS, sessionId });
    }
    try {
      const form = new URLSearchParams();
      form.set("secret", turnstileSecret);
      form.set("response", turnstileToken);
      form.set("remoteip", ip);
      const cf = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: form,
      }).then((r) => r.json());
      if (!cf?.success) {
        return jsonResponse({ error: "HUMAN_CHECK_FAILED" }, { status: 403, cors: CORS, sessionId });
      }
    } catch {
      return jsonResponse({ error: "HUMAN_CHECK_FAILED" }, { status: 403, cors: CORS, sessionId });
    }
  }

  // Derive authed user from Bearer
  let authedUserId: string | null = null;
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    const { data: gu } = await admin.auth.getUser(token);
    authedUserId = gu?.user?.id ?? null;
  }

  // Consent checks
  const headerConsent = parseConsentHeader(req);
  if (isAuthenticated && authedUserId) {
    // Enforce profile-based consent
    const { data: profile, error: pErr } = await admin
      .from("profiles")
      .select("ai_processing_consent, plan_tier")
      .eq("id", authedUserId)
      .maybeSingle();
    if (pErr) {
      return jsonResponse({ error: "PROFILE_LOOKUP_FAILED" }, { status: 500, cors: CORS, sessionId });
    }
    if (!profile?.ai_processing_consent) {
      return jsonResponse({ error: "AI_CONSENT_REQUIRED" }, { status: 403, cors: CORS, sessionId });
    }
  } else {
    // Guest must explicitly send consent header
    if (!headerConsent) {
      return jsonResponse({ error: "AI_CONSENT_REQUIRED" }, { status: 403, cors: CORS, sessionId });
    }
  }

  // ---------- Minute IP rate limit (simple, low-volume safe) ----------
  try {
    const window_start = minuteBucketUTC();
    const key = `cover-ip:${ip}`;
    // Try fetch existing bucket
    const { data: rl } = await admin
      .from("function_rate_limits")
      .select("count")
      .eq("key", key)
      .eq("window_start", window_start)
      .maybeSingle();

    if (!rl) {
      // create with count 1
      const { error: insErr } = await admin
        .from("function_rate_limits")
        .insert({ key, window_start, count: 1 });
      if (insErr) {
        // ignore transient errors
      }
    } else {
      const next = (rl.count ?? 0) + 1;
      await admin
        .from("function_rate_limits")
        .update({ count: next })
        .eq("key", key)
        .eq("window_start", window_start);
      if (next > GUEST_PER_MINUTE_PER_IP) {
        return jsonResponse({ error: "RATE_LIMITED" }, { status: 429, cors: CORS, sessionId });
      }
    }
  } catch (_) {
    // soft-fail rate limiter
  }

  // ---------- Plan/reroll logic ----------
  let attempt = 1 as number;
  let plan: PlanTier = "free";

  if (isAuthenticated && authedUserId && bookId) {
    // Fetch plan tier for limits
    const { data: profile } = await admin
      .from("profiles")
      .select("plan_tier")
      .eq("id", authedUserId)
      .maybeSingle();
    plan = ((profile?.plan_tier as PlanTier) ?? "free");

    const { coversPerMonth, rerollsPerCover } = PLAN_LIMITS[plan];

    // Count user's initial covers (attempt 1) in current month
    const { count: monthlyInitials, error: cntErr } = await admin
      .from("book_covers")
      .select("*", { count: "exact", head: true })
      .eq("user_id", authedUserId)
      .eq("attempt", 1)
      .gte("created_at", monthStartUTC());
    if (cntErr) {
      return jsonResponse({ error: "COVER_COUNT_FAILED" }, { status: 500, cors: CORS, sessionId });
    }
    if ((monthlyInitials ?? 0) >= coversPerMonth && !reroll) {
      return jsonResponse({ error: "COVER_LIMIT_REACHED" }, { status: 403, cors: CORS, sessionId });
    }

    // Attempt number is the number of rows for this user+book in this month + 1
    const { count: bookAttempts, error: attErr } = await admin
      .from("book_covers")
      .select("*", { count: "exact", head: true })
      .eq("user_id", authedUserId)
      .eq("book_id", bookId)
      .gte("created_at", monthStartUTC());

    if (attErr) {
      return jsonResponse({ error: "ATTEMPT_COUNT_FAILED" }, { status: 500, cors: CORS, sessionId });
    }

    attempt = (bookAttempts ?? 0) + 1;

    // If this is a reroll (attempt > 1), enforce per-cover rerolls
    if (attempt > 1) {
      const usedRerolls = attempt - 1;
      if (usedRerolls > rerollsPerCover) {
        return jsonResponse({ error: "REROLL_LIMIT_REACHED" }, { status: 403, cors: CORS, sessionId });
      }
    }
  } else {
    // Guest session: ensure a row exists and allow exactly one freebie per session
    try {
      const { data: ses } = await admin
        .from("sessions")
        .select("id, is_guest, has_consumed_guest_freebie")
        .eq("id", sessionId)
        .maybeSingle();

      if (!ses) {
        await admin
          .from("sessions")
          .upsert(
            { id: sessionId, user_id: null, is_guest: true, has_consumed_guest_freebie: false },
            { onConflict: "id" },
          );
      } else if (ses.has_consumed_guest_freebie) {
        return jsonResponse({ error: "GUEST_COVER_CONSUMED" }, { status: 403, cors: CORS, sessionId });
      }
    } catch {
      // if sessions table is missing, still proceed (edge freebie not enforced)
    }
  }

  // ---------- Build prompt & call OpenAI ----------
  const prompt = buildPrompt(bookTitle, description ?? "", genre, subgenre);
  const size = !isAuthenticated ? "512x768" : "1024x1024"; // cheaper for guests

  try {
    const img = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size,
      // quality: "high", // optional; costs more
      // user: authedUserId ?? sessionId, // optional for abuse tracing
    });

    const b64: string | null =
      img.data?.[0]?.b64_json ??
      (img.data?.[0] as any)?.b64 ??
      null;

    if (!b64) {
      return jsonResponse({ error: "IMAGE_GENERATION_FAILED" }, { status: 502, cors: CORS, sessionId });
    }

    // Guests: Mark freebie consumed & return base64 (no storage)
    if (!isAuthenticated || !authedUserId || !bookId) {
      try {
        await admin
          .from("sessions")
          .update({ has_consumed_guest_freebie: true })
          .eq("id", sessionId)
          .eq("is_guest", true);
      } catch (_e) {
        /* ignore */
      }
      return jsonResponse({ imageBase64: b64 }, { cors: CORS, sessionId });
    }

    // Authenticated: store image, record DB row
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const path = `covers/${authedUserId}/${bookId}/${attempt}.png`;

    const { error: upErr } = await admin.storage.from("book-covers").upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
    });
    if (upErr) {
      return jsonResponse({ error: "STORAGE_UPLOAD_FAILED" }, { status: 500, cors: CORS, sessionId });
    }

    const { error: insErr } = await admin.from("book_covers").insert({
      user_id: authedUserId,
      book_id: bookId,
      attempt,
      prompt,
      image_path: path,
    });
    if (insErr) {
      return jsonResponse({ error: "DB_INSERT_FAILED" }, { status: 500, cors: CORS, sessionId });
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/book-covers/${path}`;
    return jsonResponse({ url: publicUrl, path, attempt }, { cors: CORS, sessionId });
  } catch (err) {
    console.error("OpenAI image error:", err);
    return jsonResponse({ error: "IMAGE_SERVICE_ERROR" }, { status: 502, cors: CORS, sessionId });
  }
});
