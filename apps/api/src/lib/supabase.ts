import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error('Missing development Supabase server configuration');
if (url.includes('lqjtwabzmgjcufftuqvu')) throw new Error('Production Harmony project is prohibited in this development service');

export const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
