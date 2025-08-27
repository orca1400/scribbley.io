/* Deno Deploy (Supabase Edge Function) */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*", // ggf. deine Origin statt *
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...corsHeaders(), "Allow": "POST, OPTIONS" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return new Response("Server misconfiguration: missing env vars", {
        status: 500,
        headers: corsHeaders(),
      });
    }

    // Authentifizierten User aus Authorization: Bearer <token>
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders() });
    }

    const anon = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !user) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders() });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Tabellen in sicherer Reihenfolge löschen (abhängige zuerst)
    const tables = [
      "chapter_summaries",
      "user_books",
      "usage_events",
      "sessions",
      "user_profiles",
    ] as const;

    // Mapping: welche Spalte referenziert den Auth-User?
    const userCol: Record<(typeof tables)[number], string> = {
      chapter_summaries: "user_id",
      user_books: "user_id",
      usage_events: "user_id",
      sessions: "user_id",
      user_profiles: "id", // <- bei dir ist es 'id', nicht 'user_id'
    };

    // Helfer: robustes Löschen pro Tabelle
    async function deleteFromTable(table: (typeof tables)[number]) {
      const col = userCol[table] ?? "user_id";
      const { error } = await admin.from(table).delete().eq(col, user.id);
      // 42P01 = undefined_table, 42703 = undefined_column -> nicht fatal
      if (error && error.code !== "42P01" && error.code !== "42703") {
        throw new Error(`Delete failed on table ${table}: ${error.message}`);
      }
    }

    for (const t of tables) {
      await deleteFromTable(t);
    }

    // Auth-User löschen
    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      return new Response(delErr.message ?? "Failed to delete user", {
        status: 500,
        headers: corsHeaders(),
      });
    }

    return new Response("OK", { status: 200, headers: corsHeaders() });
  } catch (e: any) {
    return new Response(e?.message ?? "Error", {
      status: 500,
      headers: corsHeaders(),
    });
  }
});
