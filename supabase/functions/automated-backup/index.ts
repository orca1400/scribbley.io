// supabase/functions/automated-backup/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface BackupRequest {
  userId?: string; // If provided, backup specific user; otherwise backup all active users
  includeUsageEvents?: boolean;
  maxUsageEvents?: number;
}

interface BackupMetrics {
  total_users: number;
  total_books: number;
  total_summaries: number;
  total_usage_events: number;
  backup_size_mb: number;
  created_at: string;
}

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify this is an internal/admin request
    const authHeader = req.headers.get("Authorization");
    const apiKey = authHeader?.replace("Bearer ", "");
    
    // Simple API key check (you should set BACKUP_API_KEY in your environment)
    const expectedKey = Deno.env.get("BACKUP_API_KEY");
    if (!expectedKey || apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: BackupRequest = await req.json().catch(() => ({}));
    const { 
      userId, 
      includeUsageEvents = true, 
      maxUsageEvents = 10000 
    } = body;

    console.log(`Starting automated backup for ${userId ? `user ${userId}` : 'all users'}`);

    // Determine which users to backup
    let userIds: string[] = [];
    if (userId) {
      userIds = [userId];
    } else {
      // Get all users who have been active in the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: activeUsers, error: usersError } = await supabase
        .from('user_profiles')
        .select('id')
        .gte('updated_at', thirtyDaysAgo.toISOString())
        .limit(1000); // Safety limit
      
      if (usersError) throw usersError;
      userIds = activeUsers?.map(u => u.id) || [];
    }

    if (userIds.length === 0) {
      return new Response(JSON.stringify({ 
        message: "No users found for backup",
        metrics: { total_users: 0 } as BackupMetrics 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Backing up ${userIds.length} users`);

    // Fetch all data for these users
    const [profilesResult, booksResult, summariesResult, usageResult] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('*')
        .in('id', userIds),
      
      supabase
        .from('user_books')
        .select('*')
        .in('user_id', userIds)
        .order('created_at', { ascending: false }),
      
      supabase
        .from('chapter_summaries')
        .select('*')
        .in('user_id', userIds)
        .order('book_id, chapter_number'),
      
      includeUsageEvents ? supabase
        .from('usage_events')
        .select('*')
        .in('user_id', userIds)
        .order('created_at', { ascending: false })
        .limit(maxUsageEvents) : Promise.resolve({ data: [], error: null })
    ]);

    // Check for errors
    if (profilesResult.error) throw profilesResult.error;
    if (booksResult.error) throw booksResult.error;
    if (summariesResult.error) throw summariesResult.error;
    if (usageResult.error) throw usageResult.error;

    const profiles = profilesResult.data || [];
    const books = booksResult.data || [];
    const summaries = summariesResult.data || [];
    const usage = usageResult.data || [];

    // Create backup structure
    const backupData = {
      version: "1.0.0",
      backup_type: userId ? "user" : "system",
      created_at: new Date().toISOString(),
      user_ids: userIds,
      data: {
        profiles,
        books,
        chapter_summaries: summaries,
        usage_events: usage,
      },
      metrics: {
        total_users: profiles.length,
        total_books: books.length,
        total_summaries: summaries.length,
        total_usage_events: usage.length,
        backup_size_mb: 0, // Will be calculated
        created_at: new Date().toISOString(),
      } as BackupMetrics,
    };

    // Calculate size
    const jsonString = JSON.stringify(backupData);
    backupData.metrics.backup_size_mb = Math.round((jsonString.length / 1024 / 1024) * 100) / 100;

    // Store backup in a dedicated table (optional - you might want to store in external storage)
    try {
      const { error: storeError } = await supabase
        .from('system_backups')
        .insert({
          backup_type: userId ? 'user' : 'system',
          user_ids: userIds,
          metrics: backupData.metrics,
          data_size_mb: backupData.metrics.backup_size_mb,
          created_at: new Date().toISOString(),
        });
      
      if (storeError) {
        console.error('Failed to log backup:', storeError);
        // Non-fatal - continue with response
      }
    } catch (logError) {
      console.error('Backup logging error:', logError);
      // Non-fatal
    }

    console.log(`Backup completed: ${backupData.metrics.backup_size_mb}MB for ${userIds.length} users`);

    return new Response(JSON.stringify({
      success: true,
      message: `Backup completed for ${userIds.length} user(s)`,
      metrics: backupData.metrics,
      // Note: In production, you might want to store the backup data in external storage
      // and return a download URL instead of the full data
      backup_data: userId ? backupData : undefined, // Only return data for single user backups
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Automated backup error:", error);
    return new Response(JSON.stringify({ 
      error: "Backup failed", 
      details: (error as Error).message 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});