// supabase/functions/_shared/supabaseAdmin.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!, // from env
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // from env
  { auth: { persistSession: false } }
);