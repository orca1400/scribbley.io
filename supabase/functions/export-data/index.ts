/* Deno Deploy (Supabase Edge Function) */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";

    // Validate user JWT from Authorization Bearer <access_token>
    const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await anon.auth.getUser(token);
    if (userErr || !user) return new Response("Unauthorized", { status: 401 });

    const admin = createClient(supabaseUrl, serviceKey);

    const [books, summaries, usage] = await Promise.all([
      admin.from("user_books").select("*").eq("user_id", user.id),
      admin.from("chapter_summaries").select("*").eq("user_id", user.id),
      admin.from("usage_events").select("*").eq("user_id", user.id),
    ]);

    const payload = {
      user_id: user.id,
      exported_at: new Date().toISOString(),
      books: books.data ?? [],
      chapter_summaries: summaries.data ?? [],
      usage_events: usage.data ?? [],
    };

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="export-${new Date().toISOString().slice(0,10)}.json"`,
      },
    });
  } catch (e) {
    return new Response(e?.message ?? "Error", { status: 500 });
  }
});