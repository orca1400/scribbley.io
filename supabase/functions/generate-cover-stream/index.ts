// supabase/functions/generate-cover-stream/index.ts
import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import OpenAI from "npm:openai";

/** Allow only your domains in prod */
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

type PlanTier = "free" | "pro" | "premium";
const PLAN_LIMITS = {
  free:    { coversPerMonth: 5,  rerollsPerCover: 0 },
  pro:     { coversPerMonth: 10, rerollsPerCover: 1 },
  premium: { coversPerMonth: 20, rerollsPerCover: 2 },
} as const;

// Simple per-IP burst guard
const GUEST_PER_MINUTE_PER_IP = 5;

type Body = {
  bookId?: string;
  userId?: string;            // informational
  bookTitle: string;
  description: string;
  genre?: string;
  subgenre?: string;
  isAuthenticated: boolean;
  turnstileToken?: string;    // optional guest human check
  reroll?: boolean;           // optional hint; server still counts attempts
};

const monthStartUTC = () => {
  const d = new Date();
  d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0);
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
    "Strong single-subject composition, cinematic lighting, professional illustration.";
  const hint = genre ? ` Genre: ${genre}.` : "";
  const sub  = subgenre ? ` Subgenre: ${subgenre}.` : "";
  const theme = ` Theme cues: ${String(desc || "").slice(0, 400)}`;
  const titleHint = ` Title hint: "${title}". (Do not render text.)`;
  return `${base}${hint}${sub}${theme}${titleHint}`;
};

// --- Consent header parser ---
const parseConsentHeader = (req: Request) => {
  const raw = (req.headers.get("x-ai-consent") ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
};

// --- SSE helpers ---
const enc = new TextEncoder();
const sseData = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);
const sseComment = (txt: string) => enc.encode(`: ${txt}\n\n`);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  // Env
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openaiKey   = Deno.env.get("OPENAI_API_KEY");
  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET"); // optional
  if (!supabaseUrl || !supabaseKey || !openaiKey) {
    return new Response(JSON.stringify({ error: "SERVER_MISCONFIGURED" }), { status: 500, headers: CORS });
  }

  const admin = createClient(supabaseUrl, supabaseKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  // Require session id (guest or authed)
  const sessionId = req.headers.get("x-session-id") ?? "";
  if (sessionId.length < 8) {
    return new Response(JSON.stringify({ error: "MISSING_SESSION_ID" }), { status: 400, headers: CORS });
  }

  // Best-effort IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  // Body
  let body: Body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "INVALID_JSON" }), { status: 400, headers: CORS });
  }

  const { bookId, bookTitle, description, genre, subgenre, isAuthenticated, turnstileToken } = body;
  if (!bookTitle?.trim()) return new Response(JSON.stringify({ error: "MISSING_BOOK_TITLE" }), { status: 400, headers: CORS });
  if (typeof isAuthenticated !== "boolean") {
    return new Response(JSON.stringify({ error: "MISSING_IS_AUTHENTICATED" }), { status: 400, headers: CORS });
  }

  // Optional: Turnstile for guests
  if (!isAuthenticated && turnstileSecret) {
    const token = turnstileToken || req.headers.get("x-turnstile-token") || "";
    if (!token) return new Response(JSON.stringify({ error: "MISSING_TURNSTILE_TOKEN" }), { status: 400, headers: CORS });
    try {
      const form = new URLSearchParams();
      form.set("secret", turnstileSecret);
      form.set("response", token);
      form.set("remoteip", ip);
      const cf = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form })
        .then(r => r.json());
      if (!cf?.success) return new Response(JSON.stringify({ error: "HUMAN_CHECK_FAILED" }), { status: 403, headers: CORS });
    } catch {
      return new Response(JSON.stringify({ error: "HUMAN_CHECK_FAILED" }), { status: 403, headers: CORS });
    }
  }

  // Derive authed user
  let authedUserId: string | null = null;
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    const { data: gu } = await admin.auth.getUser(token);
    authedUserId = gu?.user?.id ?? null;
  }

  // Consent
  const headerConsent = parseConsentHeader(req);
  if (isAuthenticated && authedUserId) {
    const { data: profile, error: pErr } = await admin
      .from("profiles")
      .select("ai_processing_consent, plan_tier")
      .eq("id", authedUserId)
      .maybeSingle();
    if (pErr) return new Response(JSON.stringify({ error: "PROFILE_LOOKUP_FAILED" }), { status: 500, headers: CORS });
    if (!profile?.ai_processing_consent) {
      return new Response(JSON.stringify({ error: "AI_CONSENT_REQUIRED" }), { status: 403, headers: CORS });
    }
  } else {
    if (!headerConsent) {
      return new Response(JSON.stringify({ error: "AI_CONSENT_REQUIRED" }), { status: 403, headers: CORS });
    }
  }

  // Per-IP minute rate-limit
  try {
    const key = `cover-ip:${ip}`;
    const window_start = minuteBucketUTC();
    const { data: rl } = await admin
      .from("function_rate_limits").select("count").eq("key", key).eq("window_start", window_start).maybeSingle();
    if (!rl) {
      await admin.from("function_rate_limits").insert({ key, window_start, count: 1 });
    } else {
      const next = (rl.count ?? 0) + 1;
      await admin.from("function_rate_limits").update({ count: next }).eq("key", key).eq("window_start", window_start);
      if (next > GUEST_PER_MINUTE_PER_IP) {
        return new Response(JSON.stringify({ error: "RATE_LIMITED" }), { status: 429, headers: CORS });
      }
    }
  } catch { /* soft-fail */ }

  // Prompt
  const prompt = buildPrompt(bookTitle, description ?? "", genre, subgenre);

  // Plan + attempts + guest freebie
  let attempt = 1 as number;
  let plan: PlanTier = "free";

  if (isAuthenticated && authedUserId && bookId) {
    const { data: profile } = await admin.from("profiles").select("plan_tier").eq("id", authedUserId).maybeSingle();
    plan = ((profile?.plan_tier as PlanTier) ?? "free");
    const { coversPerMonth, rerollsPerCover } = PLAN_LIMITS[plan];

    // How many attempts for this book this month?
    const { count: bookAttempts, error: attErr } = await admin
      .from("book_covers")
      .select("*", { count: "exact", head: true })
      .eq("user_id", authedUserId)
      .eq("book_id", bookId)
      .gte("created_at", monthStartUTC());
    if (attErr) return new Response(JSON.stringify({ error: "ATTEMPT_COUNT_FAILED" }), { status: 500, headers: CORS });

    attempt = (bookAttempts ?? 0) + 1;

    if (attempt === 1) {
      // Enforce monthly initial-cover quota
      const { count: monthlyInitials, error: cntErr } = await admin
        .from("book_covers")
        .select("*", { count: "exact", head: true })
        .eq("user_id", authedUserId)
        .eq("attempt", 1)
        .gte("created_at", monthStartUTC());
      if (cntErr) return new Response(JSON.stringify({ error: "COVER_COUNT_FAILED" }), { status: 500, headers: CORS });
      if ((monthlyInitials ?? 0) >= coversPerMonth) {
        return new Response(JSON.stringify({ error: "COVER_LIMIT_REACHED" }), { status: 403, headers: CORS });
      }
    } else {
      // Reroll limits per plan
      const usedRerolls = attempt - 1;
      if (usedRerolls > rerollsPerCover) {
        return new Response(JSON.stringify({ error: "REROLL_LIMIT_REACHED" }), { status: 403, headers: CORS });
      }
    }
  } else {
    // Guest: 1 freebie per session
    try {
      const { data: ses } = await admin
        .from("sessions")
        .select("id, is_guest, has_consumed_guest_freebie")
        .eq("id", sessionId)
        .maybeSingle();
      if (!ses) {
        await admin.from("sessions").upsert(
          { id: sessionId, user_id: null, is_guest: true, has_consumed_guest_freebie: false },
          { onConflict: "id" },
        );
      } else if (ses.has_consumed_guest_freebie) {
        return new Response(JSON.stringify({ error: "GUEST_COVER_CONSUMED" }), { status: 403, headers: CORS });
      }
    } catch { /* if table missing, skip */ }
  }

  // Start SSE
  const stream = new ReadableStream({
    async start(controller) {
      const ping = setInterval(() => controller.enqueue(sseComment("ping")), 15000);
      const done = () => { clearInterval(ping); try { controller.close(); } catch {} };

      try {
        // Stream partial images
        const respStream = await openai.responses.stream({
          model: "gpt-4.1", // or "gpt-4o"
          input: prompt,
          stream: true,
          tools: [{ type: "image_generation", partial_images: 2 }],
        });

        let lastB64: string | null = null;

        for await (const ev of respStream) {
          // Partial images (shape may vary by SDK version; be defensive)
          const t = (ev as any)?.type || "";
          if (t === "response.image_generation_call.partial_image") {
            const b64 = (ev as any)?.partial_image_b64;
            if (b64) {
              lastB64 = b64;
              controller.enqueue(sseData({ type: "partial", b64 }));
            }
            continue;
          }
          // Early surfaced errors
          if (t.endsWith(".failed") || t === "response.error") {
            const msg = (ev as any)?.error?.message || "STREAM_FAILED";
            controller.enqueue(sseData({ type: "error", message: msg }));
            done();
            return;
          }
        }

        // Final response (best effort)
        const final = await respStream.finalResponse().catch(() => null);

        // Try to extract final base64
        let finalB64: string | null = null;
        try {
          const out = (final as any)?.output ?? (final as any)?.output_text ?? (final as any)?.content ?? [];
          const arr = Array.isArray(out) ? out : [];
          const imgItem = arr.find((c: any) => c?.type?.includes("image"));
          finalB64 = imgItem?.image_base64 || imgItem?.image?.base64 || null;
          if (!finalB64 && lastB64) finalB64 = lastB64;
        } catch { /* ignore */ }

        // Guests: emit final base64 and mark freebie consumed
        if (!isAuthenticated || !authedUserId || !bookId) {
          if (finalB64) controller.enqueue(sseData({ type: "final", imageBase64: finalB64 }));
          else controller.enqueue(sseData({ type: "error", message: "IMAGE_GENERATION_FAILED" }));
          controller.enqueue(sseData({ type: "done" }));
          try {
            await admin.from("sessions")
              .update({ has_consumed_guest_freebie: true })
              .eq("id", sessionId)
              .eq("is_guest", true);
          } catch {}
          done();
          return;
        }

        // Authed: store image + row
        if (!finalB64) {
          controller.enqueue(sseData({ type: "error", message: "IMAGE_GENERATION_FAILED" }));
          done();
          return;
        }

        const bytes = Uint8Array.from(atob(finalB64), (c) => c.charCodeAt(0));
        const path = `covers/${authedUserId}/${bookId}/${attempt}.png`;

        const { error: upErr } = await admin.storage.from("book-covers").upload(path, bytes, {
          contentType: "image/png",
          upsert: true,
        });
        if (upErr) {
          controller.enqueue(sseData({ type: "error", message: "STORAGE_UPLOAD_FAILED" }));
          done();
          return;
        }

        const { error: insErr } = await admin.from("book_covers").insert({
          user_id: authedUserId,
          book_id: bookId,
          attempt,
          prompt,
          image_path: path,
        });
        if (insErr) {
          controller.enqueue(sseData({ type: "error", message: "DB_INSERT_FAILED" }));
          done();
          return;
        }

        const publicUrl = `${supabaseUrl}/storage/v1/object/public/book-covers/${path}`;
        controller.enqueue(sseData({ type: "final", url: publicUrl, path, attempt }));
        controller.enqueue(sseData({ type: "done" }));
        done();
      } catch (err) {
        controller.enqueue(sseData({ type: "error", message: String((err as Error)?.message || err) }));
        done();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...CORS,
      "x-session-id": sessionId,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Content-Type-Options": "nosniff",
      // Hint some proxies
      "X-Accel-Buffering": "no",
    },
  });
});
