// supabase/functions/reroll-cover/index.ts
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
    "authorization, apikey, x-client-info, content-type, x-session-id, x-user-id, x-ai-consent, x-ai-consent-version",
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

const REROLL_PER_MINUTE_PER_IP = 10;

const minuteBucketUTC = () => {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d.toISOString();
};

// Keep prompt format consistent with initial cover endpoints
const buildPrompt = (title: string, desc: string, genre?: string | null, subgenre?: string | null) => {
  const base =
    "High-quality book cover artwork, no text/typography, no logos, no borders, no watermarks. " +
    "Strong single-subject composition, cinematic lighting, professional illustration.";
  const hint = genre ? ` Genre: ${genre}.` : "";
  const sub  = subgenre ? ` Subgenre: ${subgenre}.` : "";
  const theme = ` Theme cues: ${String(desc || "").slice(0, 400)}`;
  const titleHint = ` Title hint: "${title}". (Do not render text.)`;
  return `${base}${hint}${sub}${theme}${titleHint}`;
};

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiKey   = Deno.env.get("OPENAI_API_KEY");
    if (!supabaseUrl || !supabaseKey || !openaiKey) {
      return new Response(JSON.stringify({ error: "SERVER_MISCONFIGURED" }), { status: 500, headers: CORS });
    }

    const admin = createClient(supabaseUrl, supabaseKey);
    const openai = new OpenAI({ apiKey: openaiKey });

    // Best-effort IP for burst limiting
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";

    // Auth (required for reroll)
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), { status: 401, headers: CORS });
    }
    const token = authHeader.slice("Bearer ".length);
    const { data: gu } = await admin.auth.getUser(token);
    const userId = gu?.user?.id ?? null;
    if (!userId) return new Response(JSON.stringify({ error: "UNAUTHENTICATED" }), { status: 401, headers: CORS });

    // Body
    let body: { bookId?: string };
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "INVALID_JSON" }), { status: 400, headers: CORS });
    }
    const bookId = body?.bookId;
    if (!bookId) return new Response(JSON.stringify({ error: "MISSING_BOOK_ID" }), { status: 400, headers: CORS });

    // IP minute rate-limit
    try {
      const key = `reroll-ip:${ip}`;
      const window_start = minuteBucketUTC();
      const { data: rl } = await admin
        .from("function_rate_limits").select("count").eq("key", key).eq("window_start", window_start).maybeSingle();
      if (!rl) {
        await admin.from("function_rate_limits").insert({ key, window_start, count: 1 });
      } else {
        const next = (rl.count ?? 0) + 1;
        await admin.from("function_rate_limits").update({ count: next }).eq("key", key).eq("window_start", window_start);
        if (next > REROLL_PER_MINUTE_PER_IP) {
          return new Response(JSON.stringify({ error: "RATE_LIMITED" }), { status: 429, headers: CORS });
        }
      }
    } catch { /* soft-fail if table missing */ }

    // Ownership check & book info
    const { data: book, error: bookErr } = await admin
      .from("user_books")
      .select("id, user_id, title, genre, subgenre, description")
      .eq("id", bookId)
      .eq("user_id", userId)
      .maybeSingle();
    if (bookErr) return new Response(JSON.stringify({ error: "BOOK_LOOKUP_FAILED" }), { status: 500, headers: CORS });
    if (!book) return new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404, headers: CORS });

    // Consent + plan
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("plan_tier, ai_processing_consent")
      .eq("id", userId)
      .maybeSingle();
    if (profErr) return new Response(JSON.stringify({ error: "PROFILE_LOOKUP_FAILED" }), { status: 500, headers: CORS });
    if (!profile?.ai_processing_consent) {
      return new Response(JSON.stringify({ error: "AI_CONSENT_REQUIRED" }), { status: 403, headers: CORS });
    }
    const plan = (profile?.plan_tier ?? "free") as PlanTier;
    const maxRerolls = PLAN_LIMITS[plan].rerollsPerCover;
    if (maxRerolls <= 0) {
      return new Response(JSON.stringify({ error: "REROLL_NOT_ALLOWED" }), { status: 403, headers: CORS });
    }

    // Find latest cover attempt for this book
    const { data: latest, error: latestErr } = await admin
      .from("book_covers")
      .select("attempt, prompt")
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .order("attempt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) return new Response(JSON.stringify({ error: "COVER_LOOKUP_FAILED" }), { status: 500, headers: CORS });

    const lastAttempt = latest?.attempt ?? 0;
    if (lastAttempt < 1) {
      // User hasn’t generated the initial cover yet
      return new Response(JSON.stringify({ error: "NO_INITIAL_COVER" }), { status: 400, headers: CORS });
    }

    const usedRerolls = Math.max(0, lastAttempt - 1);
    if (usedRerolls >= maxRerolls) {
      return new Response(JSON.stringify({ error: "REROLL_LIMIT_REACHED" }), { status: 403, headers: CORS });
    }

    const prompt =
      latest?.prompt ??
      buildPrompt(book.title, book.description ?? "", book.genre ?? null, book.subgenre ?? null);

    // Generate reroll (portrait looks nicer for covers)
    const img = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1536",
    });

    const b64 = img.data?.[0]?.b64_json ?? (img.data?.[0] as any)?.b64 ?? null;
    if (!b64) {
      return new Response(JSON.stringify({ error: "IMAGE_GENERATION_FAILED" }), { status: 502, headers: CORS });
    }

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const nextAttempt = lastAttempt + 1;
    const path = `covers/${userId}/${bookId}/${nextAttempt}.png`;

    // Upload to consistent bucket
    const { error: upErr } = await admin.storage.from("book-covers").upload(path, bytes, {
      contentType: "image/png",
      upsert: true,
    });
    if (upErr) {
      return new Response(JSON.stringify({ error: "STORAGE_UPLOAD_FAILED" }), { status: 500, headers: CORS });
    }

    const { error: insErr } = await admin.from("book_covers").insert({
      user_id: userId,
      book_id: bookId,
      attempt: nextAttempt,
      prompt,
      image_path: path,
    });
    if (insErr) {
      return new Response(JSON.stringify({ error: "DB_INSERT_FAILED" }), { status: 500, headers: CORS });
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/book-covers/${path}`;
    return new Response(JSON.stringify({ url: publicUrl, attempt: nextAttempt, path }), { headers: CORS });

  } catch (e) {
    console.error("reroll-cover fatal:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: corsHeaders(req) }
    );
  }
});
