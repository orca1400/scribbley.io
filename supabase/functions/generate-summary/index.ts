// functions/generate-summary/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, x-session-id, x-user-id, x-ai-consent, x-ai-consent-version",
  "Access-Control-Expose-Headers": "x-session-id",
};

interface SummaryRequest {
  chapterTitle: string;
  chapterContent: string;
  chapterNumber: number;
  bookTitle: string;
  genre: string;
  subgenre: string;

  // Optional (recommended)
  contentHash?: string;
  userId?: string;
  bookId?: string;
  model?: string;          // default: gpt-4o-mini
  promptVersion?: string;  // default: v1
}

type Json = Record<string, unknown>;

const DEMO_USER_ID = "00000000-0000-0000-0000-000000000000";
const OA_TIMEOUT_MS = 60_000;
const MAX_CHAPTER_CHARS = 120_000;   // guardrail for huge inputs (~> ~60-80k tokens raw text)
const MAX_CHAPTER_WORDS = 20_000;    // additional cap
const MAX_TITLE_CHARS = 400;
const MAX_BOOK_TITLE_CHARS = 400;
const MAX_GENRE_CHARS = 60;
const MAX_SUBGENRE_CHARS = 80;

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/* ---------------------------------- helpers ---------------------------------- */

function json(body: Json, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

function sanitizeTrim(s: string, maxChars: number) {
  const t = (s ?? "").toString().trim().replace(/\s+/g, " ");
  return t.slice(0, maxChars);
}

function clampChapterContent(s: string) {
  const byChars = s.slice(0, MAX_CHAPTER_CHARS);
  const words = byChars.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_CHAPTER_WORDS) return byChars;
  return words.slice(0, MAX_CHAPTER_WORDS).join(" ");
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const h = await crypto.subtle.digest("SHA-256", enc.encode(input));
  const b = new Uint8Array(h);
  return Array.from(b).map((v) => v.toString(16).padStart(2, "0")).join("");
}

async function verifyUserWithJwt(
  bearerJwt: string | null,
  claimedUserId: string | null,
): Promise<{ userId: string | null; valid: boolean }> {
  if (!claimedUserId) return { userId: null, valid: true }; // allow anonymous calls
  if (claimedUserId === DEMO_USER_ID) return { userId: DEMO_USER_ID, valid: true };
  if (!bearerJwt) return { userId: null, valid: false };
  try {
    const { data, error } = await supabase.auth.getUser(bearerJwt);
    if (error) return { userId: null, valid: false };
    const realUserId = data.user?.id ?? null;
    return { userId: realUserId, valid: realUserId === claimedUserId };
  } catch {
    return { userId: null, valid: false };
  }
}

async function checkAIConsent(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("ai_processing_consent")
      .eq("id", userId)
      .single();
    if (error) return false;
    return data?.ai_processing_consent === true;
  } catch {
    return false;
  }
}

async function callOpenAI({
  systemPrompt,
  userPrompt,
  model,
  maxTokens,
  apiKey,
}: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxTokens: number;
  apiKey: string;
}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OA_TIMEOUT_MS);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: maxTokens, // enough for ~120 words
      temperature: 0.3,
    }),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(t));

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = (data?.choices?.[0]?.message?.content || "").trim();
  return text;
}

/* ---------------------------------- handler ---------------------------------- */

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    // headers
    const authHeader = req.headers.get("Authorization");
    const bearerJwt = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    const rawSessionId = req.headers.get("x-session-id");
    const sessionId = rawSessionId ?? crypto.randomUUID();

    const claimedUserId = req.headers.get("x-user-id");
    const aiConsentHeader = (req.headers.get("x-ai-consent") || "false").toLowerCase();
    const aiConsent = aiConsentHeader === "true";

    // verify claimed user (if present)
    const { valid: jwtOk, userId: verifiedUserId } = await verifyUserWithJwt(bearerJwt, claimedUserId);
    if (claimedUserId && !jwtOk) {
      return json({ error: "Invalid or missing authentication." }, 401);
    }

    // Enforce consent:
    // - anonymous: must send x-ai-consent: true
    // - authenticated (non-demo): must have consent in profile
    if (!claimedUserId) {
      if (!aiConsent) {
        return json({ error: "AI consent required for anonymous users." }, 400);
      }
    } else if (claimedUserId !== DEMO_USER_ID) {
      const ok = await checkAIConsent(claimedUserId);
      if (!ok) {
        return json({
          error: "AI processing consent required. Please update consent in account settings.",
        }, 403);
      }
    }

    // read body
    let body: SummaryRequest;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    let {
      chapterTitle,
      chapterContent,
      chapterNumber,
      bookTitle,
      genre,
      subgenre,
      contentHash,
      userId,
      bookId,
      model = "gpt-4o-mini",
      promptVersion = "v1",
    } = body;

    // sanitize
    chapterTitle = sanitizeTrim(chapterTitle ?? "", MAX_TITLE_CHARS);
    bookTitle = sanitizeTrim(bookTitle ?? "", MAX_BOOK_TITLE_CHARS);
    genre = sanitizeTrim(genre ?? "", MAX_GENRE_CHARS).toLowerCase();
    subgenre = sanitizeTrim(subgenre ?? "", MAX_SUBGENRE_CHARS);
    chapterContent = clampChapterContent(chapterContent ?? "");
    chapterNumber = Number.isFinite(chapterNumber as number) ? Number(chapterNumber) : 0;

    if (!chapterTitle || !chapterContent || !chapterNumber || !bookTitle) {
      return json({ error: "Missing required fields" }, 400);
    }
    if (chapterNumber < 1) {
      return json({ error: "chapterNumber must be >= 1" }, 400);
    }

    // If DB identifiers are provided but user header is absent/mismatched, prefer verified header user
    if (!userId && verifiedUserId) userId = verifiedUserId;

    // compute hash if not provided (content + key metadata)
    if (!contentHash) {
      contentHash = await sha256Hex(
        `${chapterNumber}|${chapterTitle}|${bookTitle}|${genre}|${subgenre}|${chapterContent}`,
      );
    }

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) {
      return json({ error: "OPENAI_API_KEY not configured" }, 500);
    }

    // If we can use DB and have hash, see if we can reuse
    const canUseDb = Boolean(userId && bookId);
    if (canUseDb) {
      const { data: existing, error: exErr } = await supabase
        .from("chapter_summaries")
        .select("summary, content_hash")
        .eq("book_id", bookId!)
        .eq("chapter_number", chapterNumber)
        .single();

      if (!exErr && existing?.content_hash && existing.content_hash === contentHash) {
        return new Response(
          JSON.stringify({ summary: existing.summary, reused: true, contentHash }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "x-session-id": sessionId } }
        );
      }
    }

    // prompts
    const systemPrompt = `You are a professional editor creating concise chapter summaries for a ${genre} book in the ${subgenre} genre titled "${bookTitle}".

Create a summary of **80–120 words** that includes:
- Key plot events in this chapter
- Important character developments/interactions
- New information revealed
- How the chapter advances the overall story
- Any cliffhangers or hooks

Write in third person, present tense. Avoid spoilers beyond this chapter.`;

    const userPrompt = `Summarize Chapter ${chapterNumber}: "${chapterTitle}"

Chapter Content:
${chapterContent}

Create a single paragraph of 80–120 words.`;

    // OpenAI call (with timeout)
    const summary = await callOpenAI({
      systemPrompt,
      userPrompt,
      model,
      maxTokens: 220,
      apiKey: openaiApiKey,
    });

    if (!summary) {
      return json({ error: "No summary generated" }, 500);
    }

    // Upsert when identifiers provided
    if (canUseDb) {
      const { data: saved, error: upErr } = await supabase
        .from("chapter_summaries")
        .upsert(
          {
            user_id: userId!,
            book_id: bookId!,
            chapter_number: chapterNumber,
            summary,
            content_hash: contentHash,
            model,
            prompt_version: promptVersion,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "book_id,chapter_number" }
        )
        .select("summary, content_hash")
        .single();

      if (upErr) {
        console.error("DB upsert failed:", upErr);
        // Still return the generated summary
        return new Response(
          JSON.stringify({ summary, contentHash, reused: false }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "x-session-id": sessionId } }
        );
      }

      return new Response(
        JSON.stringify({ summary: saved.summary, contentHash: saved.content_hash, reused: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json", "x-session-id": sessionId } }
      );
    }

    // No DB identifiers supplied: return the summary
    return new Response(JSON.stringify({ summary, reused: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-session-id": sessionId },
    });
  } catch (error) {
    console.error("generate-summary error:", error);
    const isAbort = (error as any)?.name === "AbortError";
    return json({ error: isAbort ? "OpenAI request timed out" : "Internal server error" }, 500);
  }
});
